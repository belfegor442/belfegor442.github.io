using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Text.Json;
using System.Text.Json.Serialization;
using NewWorld.Server.Models;

namespace NewWorld.Server.Services;

public sealed class GameHub(GameStore store, ILogger<GameHub> logger)
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) }
    };
    private readonly ConcurrentDictionary<Guid, ConcurrentDictionary<Guid, Connection>> _games = new();

    public IReadOnlySet<Guid> ConnectedPlayers(Guid gameId) =>
        _games.TryGetValue(gameId, out var connections) ? connections.Keys.ToHashSet() : new HashSet<Guid>();

    public bool IsAllowedOrigin(string? origin, IReadOnlySet<string> allowedOrigins) =>
        origin is not null && allowedOrigins.Contains(origin);

    public async Task HandleAsync(HttpContext context, IReadOnlySet<string> allowedOrigins)
    {
        if (!IsAllowedOrigin(context.Request.Headers.Origin, allowedOrigins))
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            return;
        }
        if (!context.WebSockets.IsWebSocketRequest)
        {
            context.Response.StatusCode = StatusCodes.Status400BadRequest;
            return;
        }

        using var socket = await context.WebSockets.AcceptWebSocketAsync();
        Connection? connection = null;
        Guid gameId = Guid.Empty;
        try
        {
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(context.RequestAborted);
            timeout.CancelAfter(TimeSpan.FromSeconds(10));
            var auth = await ReceiveAsync(socket, timeout.Token);
            if (auth is null || auth.Type != "authenticate" || auth.GameId is null ||
                string.IsNullOrWhiteSpace(auth.Token))
            {
                await SendAsync(socket, new ServerMessage("error", "Authentication is required."), context.RequestAborted);
                return;
            }

            var authorized = await store.GetAuthorizedAsync(auth.GameId.Value, auth.Token, context.RequestAborted);
            if (authorized.Game is null || authorized.Player is null)
            {
                await SendAsync(socket, new ServerMessage("error", "Invalid world or player token."), context.RequestAborted);
                return;
            }

            gameId = auth.GameId.Value;
            connection = new Connection(authorized.Player.Id, socket);
            var connections = _games.GetOrAdd(gameId, _ => new ConcurrentDictionary<Guid, Connection>());
            var wasEmpty = connections.IsEmpty;
            if (!connections.TryAdd(connection.PlayerId, connection))
            {
                await SendAsync(socket, new ServerMessage("error", "This player is already connected."), context.RequestAborted);
                connection = null;
                return;
            }

            if (wasEmpty)
                await ResetClockAsync(gameId, context.RequestAborted);
            await ResetPauseVotesAsync(gameId, context.RequestAborted);
            await SendSnapshotAsync(connection, authorized.Game, context.RequestAborted);
            await BroadcastAsync(gameId, context.RequestAborted);
            while (socket.State == WebSocketState.Open && !context.RequestAborted.IsCancellationRequested)
            {
                var message = await ReceiveAsync(socket, context.RequestAborted);
                if (message is null)
                    break;
                await HandleMessageAsync(gameId, auth.Token, connection, message, context.RequestAborted);
            }
        }
        catch (OperationCanceledException) when (context.RequestAborted.IsCancellationRequested)
        {
        }
        catch (OperationCanceledException)
        {
            if (socket.State == WebSocketState.Open)
                await socket.CloseAsync(WebSocketCloseStatus.PolicyViolation, "Authentication timed out.", CancellationToken.None);
        }
        catch (WebSocketException exception)
        {
            logger.LogDebug(exception, "WebSocket connection closed for game {GameId}.", gameId);
        }
        catch (JsonException exception)
        {
            logger.LogWarning(exception, "Malformed WebSocket message for game {GameId}.", gameId);
        }
        finally
        {
            if (connection is not null && _games.TryGetValue(gameId, out var connections))
            {
                connections.TryRemove(connection.PlayerId, out _);
                await ResetPauseVotesAsync(gameId, CancellationToken.None);
                if (connections.IsEmpty)
                {
                    _games.TryRemove(gameId, out _);
                    await ResetClockAsync(gameId, CancellationToken.None, pauseIfEmpty: true);
                }
                await BroadcastAsync(gameId, CancellationToken.None);
            }
        }
    }

    private async Task ResetClockAsync(
        Guid gameId, CancellationToken cancellationToken, bool pauseIfEmpty = false)
    {
        var result = await store.MutateSystemAsync(gameId, game =>
        {
            if (pauseIfEmpty)
            {
                return PauseVoteRules.PauseForNoConnectedPlayers(game, DateTimeOffset.UtcNow)
                    ? null
                    : "No pause state change is required.";
            }

            if (!game.Started)
                return "The world clock has not started.";
            game.LastTickUtc = DateTimeOffset.UtcNow;
            return null;
        }, cancellationToken);
        if (result.Error is not null && result.Error != "The world clock has not started." &&
            result.Error != "No pause state change is required.")
            logger.LogWarning("Could not reset the world clock for {GameId}: {Reason}", gameId, result.Error);
    }

    public async Task BroadcastAsync(Guid gameId, CancellationToken cancellationToken)
    {
        if (!_games.TryGetValue(gameId, out var connections) || connections.IsEmpty)
            return;
        var (game, _) = await store.GetAuthorizedAsync(gameId, "", cancellationToken);
        if (game is null)
            return;
        var snapshot = BuildSnapshot(game, ConnectedPlayers(gameId));
        await Task.WhenAll(connections.Values.Select(connection =>
            SendAsync(connection, new ServerMessage("snapshot", Game: snapshot), cancellationToken)));
    }

    public static GameSnapshot BuildSnapshot(WorldState game, IReadOnlySet<Guid> connectedPlayers)
    {
        var stateIndices = game.Territories.ToDictionary(territory => territory.StateId, territory => territory.Index);
        var memberships = game.Memberships
            .Where(membership => membership.Status == MembershipStatus.Active)
            .Select(membership => new GovernmentMembershipView(
                membership.Id,
                membership.PlayerId,
                membership.StateId,
                stateIndices[membership.StateId],
                membership.Status,
                membership.PermissionSetId))
            .ToList();
        var membershipsByPlayer = memberships
            .GroupBy(membership => membership.PlayerId)
            .ToDictionary(group => group.Key, group => (IReadOnlyList<GovernmentMembershipView>)group.ToList());
        var players = game.Players.Select(player =>
        {
            membershipsByPlayer.TryGetValue(player.Id, out var playerMemberships);
            var countryIndex = playerMemberships?.FirstOrDefault(membership =>
                membership.StateIndex == player.LegacyCountryIndex)?.StateIndex ??
                playerMemberships?.FirstOrDefault()?.StateIndex ??
                player.LegacyCountryIndex;
            var governmentTreasury = countryIndex is int index
                ? game.Territories.SingleOrDefault(territory => territory.Index == index)?.Treasury
                : null;
            return new PlayerView(
                player.Id,
                player.Name,
                player.IsHost,
                countryIndex,
                governmentTreasury ?? player.Treasury,
                player.Buildings,
                connectedPlayers.Contains(player.Id),
                playerMemberships ?? []);
        }).ToList();

        return new GameSnapshot(
            game.Id,
            game.Started,
            game.Day,
            game.HostPlayerId,
            game.Paused,
            game.PauseVotes.Where(connectedPlayers.Contains).ToList(),
            players,
            game.Territories.Select(territory =>
            {
                var (territoryIncome, cityIncome, upkeep, monthlyBalance) =
                    SimulationRules.CalculateGovernmentBalance(game, territory);
                return new TerritoryView(
                    territory.StateId, territory.Index, territory.Name, territory.Treasury, territoryIncome,
                    cityIncome, upkeep, monthlyBalance, territory.Population, territory.Prosperity,
                    territory.Infrastructure, territory.OwnerPlayerId);
            }).ToList(),
            game.Activity,
            game.Name,
            game.Status,
            game.WorldDate,
            game.WorldVersion,
            game.ScenarioId,
            game.ScenarioVersion,
            memberships);
    }

    private async Task HandleMessageAsync(
        Guid gameId, string token, Connection connection, ClientMessage message, CancellationToken cancellationToken)
    {
        var connectedPlayers = ConnectedPlayers(gameId);
        var result = await store.MutateAsync(gameId, token, (game, player) =>
        {
            if (!game.Started)
                return "The host must start the world before actions are allowed.";
            if (!game.Memberships.Any(membership =>
                    membership.PlayerId == player.Id && membership.Status == MembershipStatus.Active))
                return "This player has not been assigned a state.";
            var governmentMembership = game.Memberships.FirstOrDefault(membership =>
                membership.PlayerId == player.Id &&
                membership.Status == MembershipStatus.Active &&
                game.Territories.Single(territory => territory.StateId == membership.StateId).Index ==
                player.LegacyCountryIndex) ??
                game.Memberships.First(membership =>
                    membership.PlayerId == player.Id && membership.Status == MembershipStatus.Active);
            var government = game.Territories.Single(territory =>
                territory.StateId == governmentMembership.StateId);

            switch (message.Type)
            {
                case "pause":
                case "resume":
                    var shouldPause = message.Type == "pause";
                    if (game.Paused == shouldPause)
                        return shouldPause ? "The world is already paused." : "The world is not paused.";
                    if (!connectedPlayers.Contains(player.Id))
                        return "Only connected players can vote.";

                    var voteResult = PauseVoteRules.Toggle(game, player.Id, connectedPlayers);
                    switch (voteResult)
                    {
                        case PauseVoteResult.Added:
                            GameStore.AddActivity(game,
                                $"{player.Name} voted to {(shouldPause ? "pause" : "resume")} the world.");
                            break;
                        case PauseVoteResult.Withdrawn:
                            GameStore.AddActivity(game,
                                $"{player.Name} withdrew their vote to {(shouldPause ? "pause" : "resume")} the world.");
                            break;
                        case PauseVoteResult.Paused:
                            GameStore.AddActivity(game, "The connected players voted to pause the world.");
                            break;
                        case PauseVoteResult.Resumed:
                            GameStore.AddActivity(game, "The connected players voted to resume the world.");
                            break;
                    }
                    return null;

                case "claim":
                    if (message.TerritoryIndex is not int territoryIndex ||
                        territoryIndex < 0 || territoryIndex >= game.Territories.Count)
                        return "Invalid territory.";
                    var territory = game.Territories[territoryIndex];
                    if (territory.OwnerPlayerId is not null)
                        return "This territory is already administered.";
                    if (government.Treasury < 450)
                        return "Insufficient treasury (¤450 required).";
                    government.Treasury -= 450;
                    territory.OwnerPlayerId = player.Id;
                    territory.Infrastructure++;
                    GameStore.AddActivity(game, $"{player.Name} established an administration in {territory.Name}.");
                    return null;

                case "build":
                    if (message.PlotIndex is not int plot || plot < 0 || plot >= 144)
                        return "Invalid construction plot.";
                    if (message.BuildingId is null || !GameCatalog.Buildings.TryGetValue(message.BuildingId, out var building))
                        return "Unknown building.";
                    if (player.Buildings.ContainsKey(plot))
                        return "This plot is already developed.";
                    if (government.Treasury < building.Cost)
                        return "Insufficient treasury.";
                    government.Treasury -= building.Cost;
                    player.Buildings.Add(plot, building);
                    GameStore.AddActivity(game, $"{player.Name} constructed a {building.Name.ToLowerInvariant()}.");
                    return null;

                default:
                    return "Unsupported action.";
            }
        }, cancellationToken);

        if (result.Error is not null)
        {
            await SendAsync(connection, new ServerMessage("error", result.Error), cancellationToken);
            return;
        }
        await BroadcastAsync(gameId, cancellationToken);
    }

    private async Task ResetPauseVotesAsync(Guid gameId, CancellationToken cancellationToken)
    {
        var result = await store.MutateSystemAsync(gameId, game =>
        {
            if (game.PauseVotes.Count == 0)
                return null;
            game.PauseVotes.Clear();
            GameStore.AddActivity(game, "The pause vote was reset because the connected players changed.");
            return null;
        }, cancellationToken);
        if (result.Error is not null)
            logger.LogWarning("Could not reset pause votes for {GameId}: {Reason}", gameId, result.Error);
    }

    private async Task SendSnapshotAsync(Connection connection, WorldState game, CancellationToken cancellationToken)
    {
        var snapshot = BuildSnapshot(game, ConnectedPlayers(game.Id));
        await SendAsync(connection, new ServerMessage("snapshot", Game: snapshot), cancellationToken);
    }

    private static async Task<ClientMessage?> ReceiveAsync(WebSocket socket, CancellationToken cancellationToken)
    {
        var buffer = new byte[2048];
        using var stream = new MemoryStream();
        WebSocketReceiveResult result;
        do
        {
            result = await socket.ReceiveAsync(buffer, cancellationToken);
            if (result.MessageType == WebSocketMessageType.Close)
                return null;
            if (result.MessageType != WebSocketMessageType.Text || stream.Length + result.Count > 4096)
            {
                await socket.CloseAsync(WebSocketCloseStatus.MessageTooBig, "Invalid message.", CancellationToken.None);
                return null;
            }
            stream.Write(buffer, 0, result.Count);
        } while (!result.EndOfMessage);

        return JsonSerializer.Deserialize<ClientMessage>(stream.ToArray(), JsonOptions);
    }

    private static Task SendAsync(WebSocket socket, ServerMessage message, CancellationToken cancellationToken) =>
        socket.SendAsync(JsonSerializer.SerializeToUtf8Bytes(message, JsonOptions),
            WebSocketMessageType.Text, true, cancellationToken);

    private static async Task SendAsync(Connection connection, ServerMessage message, CancellationToken cancellationToken)
    {
        await connection.SendLock.WaitAsync(cancellationToken);
        try
        {
            if (connection.Socket.State == WebSocketState.Open)
                await SendAsync(connection.Socket, message, cancellationToken);
        }
        catch (WebSocketException)
        {
        }
        finally
        {
            connection.SendLock.Release();
        }
    }

    private sealed class Connection(Guid playerId, WebSocket socket)
    {
        public Guid PlayerId { get; } = playerId;
        public WebSocket Socket { get; } = socket;
        public SemaphoreSlim SendLock { get; } = new(1, 1);
    }
}
