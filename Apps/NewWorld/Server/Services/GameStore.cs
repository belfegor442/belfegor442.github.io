using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using NewWorld.Server.Models;
using Npgsql;
using NpgsqlTypes;

namespace NewWorld.Server.Services;

public sealed class GameStore(NpgsqlDataSource dataSource, ILogger<GameStore> logger)
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) }
    };

    public async Task InitializeAsync(CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand("""
            CREATE TABLE IF NOT EXISTS new_world_games (
                id uuid PRIMARY KEY,
                invite_code_hash text NOT NULL UNIQUE,
                state jsonb NOT NULL,
                updated_at timestamptz NOT NULL DEFAULT now()
            )
            """, connection);
        await command.ExecuteNonQueryAsync(cancellationToken);
        logger.LogInformation("New World PostgreSQL store is ready.");
    }

    public async Task<(WorldState Game, string InviteCode, string PlayerToken)> CreateAsync(
        string playerName, CancellationToken cancellationToken)
    {
        var id = Guid.NewGuid();
        var playerId = Guid.NewGuid();
        var inviteCode = CreateSecret();
        var playerToken = CreateSecret();
        var game = new WorldState
        {
            Id = id,
            WorldDate = new DateOnly(1500, 1, 1),
            EconomyVersion = 1,
            HostPlayerId = playerId,
            LastTickUtc = DateTimeOffset.UtcNow,
            Players = [new PlayerState { Id = playerId, Name = playerName, IsHost = true, TokenHash = Hash(playerToken) }],
            Territories = GameCatalog.TerritoryNames.Select((name, index) => new TerritoryState
            {
                StateId = Guid.NewGuid(),
                Index = index,
                Name = name,
                Population = Math.Clamp(26000 + ((index * 7919 + 1337) % 56000), 1, 2000000),
                Prosperity = 42 + (index * 13 % 48),
                Infrastructure = 1 + index % 4
            }).ToList(),
            Activity = [$"{playerName} created a private world."]
        };

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            "INSERT INTO new_world_games (id, invite_code_hash, state) VALUES (@id, @codeHash, @state)",
            connection);
        command.Parameters.AddWithValue("id", id);
        command.Parameters.AddWithValue("codeHash", Hash(inviteCode));
        command.Parameters.AddWithValue("state", NpgsqlDbType.Jsonb, JsonSerializer.Serialize(game, JsonOptions));
        await command.ExecuteNonQueryAsync(cancellationToken);
        return (game, inviteCode, playerToken);
    }

    public async Task<(WorldState? Game, string? PlayerToken, string? Error)> JoinAsync(
        string inviteCode, string playerName, CancellationToken cancellationToken)
    {
        var playerToken = CreateSecret();
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        var game = await FindByInviteCodeAsync(connection, transaction, Hash(inviteCode), true, cancellationToken);
        if (game is null)
            return (null, null, "Invite code is invalid.");
        var joinError = LobbyRules.GetJoinError(game, playerName);
        if (joinError is not null)
            return (null, null, joinError);

        game.Players.Add(new PlayerState { Id = Guid.NewGuid(), Name = playerName, TokenHash = Hash(playerToken) });
        game.WorldVersion++;
        AddActivity(game, $"{playerName} joined the world.");
        await SaveAsync(connection, transaction, game, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return (game, playerToken, null);
    }

    public async Task<(WorldState? Game, PlayerState? Player)> GetAuthorizedAsync(
        Guid gameId, string token, CancellationToken cancellationToken)
    {
        var game = await FindByIdAsync(gameId, cancellationToken);
        return game is null ? (null, null) : (game, FindPlayer(game, token));
    }

    public async Task<(WorldState? Game, PlayerState? Player, string? Error)> MutateAsync(
        Guid gameId,
        string token,
        Func<WorldState, PlayerState, string?> mutation,
        CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        var game = await FindByIdAsync(connection, transaction, gameId, true, cancellationToken);
        if (game is null)
            return (null, null, "World not found.");
        var player = FindPlayer(game, token);
        if (player is null)
            return (null, null, "Invalid player token.");

        var error = mutation(game, player);
        if (error is not null)
            return (game, player, error);

        game.WorldVersion++;
        await SaveAsync(connection, transaction, game, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return (game, player, null);
    }

    public async Task<(WorldState? Game, PlayerState? Player, GameOrderResult? Order, string? Error)>
        ExecuteOrderAsync(
            Guid gameId,
            string token,
            Guid orderId,
            Guid? stateId,
            GameOrderType orderType,
            GameOrderPayload payload,
            long expectedWorldVersion,
            Func<WorldState, PlayerState, OrderRejection?> mutation,
            CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        var game = await FindByIdAsync(connection, transaction, gameId, true, cancellationToken);
        if (game is null)
            return (null, null, null, "World not found.");
        var player = FindPlayer(game, token);
        if (player is null)
            return (null, null, null, "Invalid player token.");

        var (replay, replayError) = GameOrderRules.FindReplay(
            game, player.Id, orderId, stateId, orderType, payload, expectedWorldVersion);
        if (replayError is not null)
            return (game, player, CreateRejectedOrderResult(orderId, "ORDER_ID_REUSED", replayError, true), null);
        if (replay is not null)
        {
            await transaction.CommitAsync(cancellationToken);
            return (game, player, replay, null);
        }

        OrderRejection? rejection = GameOrderRules.CheckWorldAvailability(game, orderType);
        if (rejection is null && !game.Memberships.Any(membership =>
                     membership.PlayerId == player.Id && membership.Status == MembershipStatus.Active))
            rejection = new OrderRejection("NOT_MEMBER", "This player has not been assigned a state.");
        else if (rejection is null && (stateId is not Guid selectedStateId ||
                 !game.Memberships.Any(membership =>
                     membership.PlayerId == player.Id &&
                     membership.StateId == selectedStateId &&
                     membership.Status == MembershipStatus.Active)))
            rejection = new OrderRejection("NOT_MEMBER", "You are not a member of the selected government.");
        else if (rejection is null)
            rejection = GameOrderRules.CheckWorldVersion(expectedWorldVersion, game.WorldVersion);

        if (rejection is null)
        {
            var result = GameOrderRules.ApplyMutationAtomically(game, player.Id, mutation);
            rejection = result.Rejection;
            if (rejection is null)
            {
                game = result.Game;
                player = result.Player;
                game.WorldVersion++;
            }
        }

        var order = new GameOrder(
            game.Id,
            orderId,
            player.Id,
            stateId,
            orderType,
            rejection is null ? GameOrderStatus.Executed : GameOrderStatus.Rejected,
            payload,
            expectedWorldVersion,
            DateTimeOffset.UtcNow,
            game.WorldDate,
            rejection?.Code,
            rejection?.Message,
            game.WorldVersion);
        game.Orders.Add(order);
        AddActivity(game, rejection is null
            ? $"{player.Name} submitted {orderType} (order {orderId:N})."
            : $"{player.Name}'s {orderType} order was rejected ({rejection.Code}): {rejection.Message}");
        game.Events.Add(new WorldEvent(
            Guid.NewGuid(),
            game.Id,
            orderId,
            player.Id,
            stateId is Guid eventStateId &&
            game.Territories.Any(territory => territory.StateId == eventStateId)
                ? eventStateId
                : null,
            rejection is null ? "order.executed" : "order.rejected",
            rejection?.Code,
            order.SubmittedAtUtc,
            game.WorldDate,
            game.WorldVersion,
            rejection is null ? $"Executed {orderType}." : rejection.Message));

        await SaveAsync(connection, transaction, game, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return (game, player, new GameOrderResult(
            orderId, rejection is null, rejection?.Code, rejection?.Message, false), null);
    }

    private static GameOrderResult CreateRejectedOrderResult(
        Guid orderId, string code, string message, bool replayed = false) =>
        new(orderId, false, code, message, replayed);

    public async Task<(WorldState? Game, string? Error)> MutateSystemAsync(
        Guid gameId,
        Func<WorldState, string?> mutation,
        CancellationToken cancellationToken,
        Func<WorldState, bool>? shouldAdvanceWorldVersion = null)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        var game = await FindByIdAsync(connection, transaction, gameId, true, cancellationToken);
        if (game is null)
            return (null, "World not found.");

        var error = mutation(game);
        if (error is not null)
            return (game, error);

        if (shouldAdvanceWorldVersion?.Invoke(game) ?? true)
            game.WorldVersion++;
        await SaveAsync(connection, transaction, game, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return (game, null);
    }

    public async Task<List<Guid>> GetGameIdsAsync(CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand("SELECT id FROM new_world_games", connection);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        var ids = new List<Guid>();
        while (await reader.ReadAsync(cancellationToken))
            ids.Add(reader.GetGuid(0));
        return ids;
    }

    private async Task<WorldState?> FindByIdAsync(Guid gameId, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        return await FindByIdAsync(connection, null, gameId, false, cancellationToken);
    }

    private static async Task<WorldState?> FindByIdAsync(
        NpgsqlConnection connection, NpgsqlTransaction? transaction, Guid gameId, bool forUpdate, CancellationToken cancellationToken)
    {
        var sql = "SELECT state FROM new_world_games WHERE id = @id" + (forUpdate ? " FOR UPDATE" : "");
        await using var command = new NpgsqlCommand(sql, connection, transaction);
        command.Parameters.AddWithValue("id", gameId);
        var value = await command.ExecuteScalarAsync(cancellationToken);
        return DeserializeState(value);
    }

    private static async Task<WorldState?> FindByInviteCodeAsync(
        NpgsqlConnection connection, NpgsqlTransaction transaction, string codeHash, bool forUpdate, CancellationToken cancellationToken)
    {
        var sql = "SELECT state FROM new_world_games WHERE invite_code_hash = @codeHash" + (forUpdate ? " FOR UPDATE" : "");
        await using var command = new NpgsqlCommand(sql, connection, transaction);
        command.Parameters.AddWithValue("codeHash", codeHash);
        var value = await command.ExecuteScalarAsync(cancellationToken);
        return DeserializeState(value);
    }

    private static async Task SaveAsync(
        NpgsqlConnection connection, NpgsqlTransaction transaction, WorldState game, CancellationToken cancellationToken)
    {
        await using var command = new NpgsqlCommand(
            "UPDATE new_world_games SET state = @state, updated_at = now() WHERE id = @id",
            connection, transaction);
        command.Parameters.AddWithValue("id", game.Id);
        command.Parameters.AddWithValue("state", NpgsqlDbType.Jsonb, JsonSerializer.Serialize(game, JsonOptions));
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static PlayerState? FindPlayer(WorldState game, string token)
    {
        var tokenHash = Hash(token);
        return game.Players.FirstOrDefault(player =>
            CryptographicOperations.FixedTimeEquals(
                Convert.FromHexString(player.TokenHash), Convert.FromHexString(tokenHash)));
    }

    private static WorldState? DeserializeState(object? value)
    {
        var game = value switch
        {
            string json => JsonSerializer.Deserialize<WorldState>(json, JsonOptions),
            JsonDocument document => DeserializeDocument(document),
            JsonElement element => element.Deserialize<WorldState>(JsonOptions),
            _ => null
        };
        if (game is not null)
            WorldStateCompatibility.Normalize(game);
        return game;
    }

    private static WorldState? DeserializeDocument(JsonDocument document)
    {
        using (document)
            return document.RootElement.Deserialize<WorldState>(JsonOptions);
    }

    public static string CreateSecret() => Convert.ToHexString(RandomNumberGenerator.GetBytes(24));
    public static string Hash(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value)));

    public static void AddActivity(WorldState game, string activity)
    {
        game.Activity.Insert(0, activity);
        if (game.Activity.Count > 20)
            game.Activity.RemoveAt(game.Activity.Count - 1);
    }
}
