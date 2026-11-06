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
        await using var backupCommand = new NpgsqlCommand("""
            CREATE TABLE IF NOT EXISTS new_world_game_backups (
                game_id uuid PRIMARY KEY REFERENCES new_world_games(id) ON DELETE CASCADE,
                snapshot_json text NOT NULL,
                sha256 text NOT NULL,
                created_at timestamptz NOT NULL DEFAULT now()
            )
            """, connection);
        await backupCommand.ExecuteNonQueryAsync(cancellationToken);
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
            EconomyVersion = 3,
            MapGeometryVersion = MapGeometryCatalog.MapVersion,
            HostPlayerId = playerId,
            LastTickUtc = DateTimeOffset.UtcNow,
            Players = [new PlayerState { Id = playerId, Name = playerName, IsHost = true, TokenHash = Hash(playerToken) }],
            Territories = GameCatalog.InitialTerritories.Select((definition, index) => new TerritoryState
            {
                StateId = ScenarioIdentity.Create("state", definition.StableKey),
                Index = index,
                Name = definition.Name,
                Population = Math.Clamp(26000 + ((index * 7919 + 1337) % 56000), 1, 2000000),
                Prosperity = 42 + (index * 13 % 48),
                Infrastructure = 1 + index % 4
            }).ToList(),
            Activity = [$"{playerName} created a private world."]
        };
        game.Currencies = game.Territories.Select(territory =>
        {
            var currency = new StateCurrency
            {
                Id = ScenarioIdentity.Create(
                    "currency", GameCatalog.InitialTerritories[territory.Index].StableKey),
                StateId = territory.StateId
            };
            territory.CurrencyId = currency.Id;
            return currency;
        }).ToList();
        game.PoliticalSystems = game.Territories.Select(territory =>
            new StatePoliticalSystem { StateId = territory.StateId }).ToList();
        AddWorldEvent(
            game, "world.created", playerId, null, null,
            "A private multiplayer world was created.");

        var initialSnapshot = WorldSnapshotRules.Serialize(game);
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            "INSERT INTO new_world_games (id, invite_code_hash, state) VALUES (@id, @codeHash, @state)",
            connection, transaction);
        command.Parameters.AddWithValue("id", id);
        command.Parameters.AddWithValue("codeHash", Hash(inviteCode));
        command.Parameters.AddWithValue("state", NpgsqlDbType.Jsonb, initialSnapshot);
        await command.ExecuteNonQueryAsync(cancellationToken);
        await using var backupCommand = new NpgsqlCommand("""
            INSERT INTO new_world_game_backups (game_id, snapshot_json, sha256, created_at)
            VALUES (@id, @snapshot, @sha256, now())
            """, connection, transaction);
        backupCommand.Parameters.AddWithValue("id", id);
        backupCommand.Parameters.AddWithValue("snapshot", initialSnapshot);
        backupCommand.Parameters.AddWithValue(
            "sha256", WorldSnapshotRules.CalculateChecksum(initialSnapshot));
        await backupCommand.ExecuteNonQueryAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return (game, inviteCode, playerToken);
    }

    public async Task<(WorldState? Game, string? Error, bool NotFound, bool Unauthorized)> RecoverPreviousAsync(
        Guid gameId, string token, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);

        await using (var lockCommand = new NpgsqlCommand(
            "SELECT id FROM new_world_games WHERE id = @id FOR UPDATE",
            connection, transaction))
        {
            lockCommand.Parameters.AddWithValue("id", gameId);
            if (await lockCommand.ExecuteScalarAsync(cancellationToken) is null)
                return (null, "World not found.", true, false);
        }

        var currentSnapshot = await ReadCurrentSnapshotAsync(
            connection, transaction, gameId, cancellationToken);
        WorldState? currentGame = null;
        try
        {
            currentGame = WorldSnapshotRules.DeserializeAndValidate(currentSnapshot, gameId);
        }
        catch (InvalidDataException exception)
        {
            logger.LogWarning(exception, "Current save for world {GameId} failed validation; checking its backup.", gameId);
        }
        var hasVersionMarkers = WorldSnapshotRules.TryReadVersionMarkers(
            currentSnapshot, out var currentWorldVersion, out var currentEventSequence);
        if (!hasVersionMarkers)
            logger.LogWarning("Current save for world {GameId} has no usable version markers.", gameId);
        if (currentGame is not null)
        {
            if (!WorldSnapshotRules.IsAuthorizedHost(currentGame, token))
                return (null, "Only the host can recover this world.", false, true);
            return (null, "The current save passes integrity validation; recovery was not performed.", false, false);
        }

        string? backupSnapshot;
        string? backupChecksum;
        await using (var backupCommand = new NpgsqlCommand(
            "SELECT snapshot_json, sha256 FROM new_world_game_backups WHERE game_id = @id FOR UPDATE",
            connection, transaction))
        {
            backupCommand.Parameters.AddWithValue("id", gameId);
            await using var reader = await backupCommand.ExecuteReaderAsync(cancellationToken);
            if (!await reader.ReadAsync(cancellationToken))
                return (null, "No previous valid save is available.", false, false);
            backupSnapshot = reader.GetString(0);
            backupChecksum = reader.GetString(1);
        }

        var restore = WorldSnapshotRules.ValidateRestore(
            backupSnapshot, backupChecksum, gameId, token);
        if (restore.Unauthorized)
            return (null, restore.Error, false, true);
        if (restore.Game is null)
        {
            logger.LogWarning(
                "Backup for world {GameId} could not be restored: {Reason}",
                gameId,
                restore.Error);
            return (null, restore.Error + " The current save was not replaced.", false, false);
        }
        var recoveredGame = restore.Game;
        var host = recoveredGame.Players.Single(player => player.Id == recoveredGame.HostPlayerId);

        if (hasVersionMarkers)
        {
            recoveredGame.WorldVersion = Math.Max(recoveredGame.WorldVersion, currentWorldVersion);
            recoveredGame.EventSequence = Math.Max(recoveredGame.EventSequence, currentEventSequence);
        }
        if (recoveredGame.WorldVersion == long.MaxValue ||
            recoveredGame.EventSequence == long.MaxValue)
            return (null, "The previous save has reached the world version limit.", false, false);

        recoveredGame.WorldVersion++;
        recoveredGame.LastTickUtc = DateTimeOffset.UtcNow;
        const string recoveryDescription = "The host recovered the world from its previous validated save.";
        AddActivity(recoveredGame, recoveryDescription);
        AddWorldEvent(
            recoveredGame,
            "world.recovered",
            host.Id,
            null,
            null,
            recoveryDescription,
            occurredAtUtc: recoveredGame.LastTickUtc);

        var serializedSnapshot = WorldSnapshotRules.Serialize(recoveredGame);
        await using var updateCommand = new NpgsqlCommand(
            "UPDATE new_world_games SET state = @state, updated_at = now() WHERE id = @id",
            connection, transaction);
        updateCommand.Parameters.AddWithValue("id", gameId);
        updateCommand.Parameters.AddWithValue("state", NpgsqlDbType.Jsonb, serializedSnapshot);
        if (await updateCommand.ExecuteNonQueryAsync(cancellationToken) != 1)
            throw new InvalidDataException("The world disappeared during save recovery.");

        await transaction.CommitAsync(cancellationToken);
        return (recoveredGame, null, false, false);
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
        AddWorldEvent(game, "player.joined", game.Players[^1].Id, null, null,
            $"{playerName} joined the world.");
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
        CancellationToken cancellationToken,
        string eventType,
        Guid? eventStateId = null)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        var game = await FindByIdAsync(connection, transaction, gameId, true, cancellationToken);
        if (game is null)
            return (null, null, "World not found.");
        var player = FindPlayer(game, token);
        if (player is null)
            return (null, null, "Invalid player token.");

        var result = GameOrderRules.ApplyMutationAtomically(game, player.Id, (candidate, candidatePlayer) =>
        {
            var error = mutation(candidate, candidatePlayer);
            return error is null ? null : new OrderRejection("MUTATION_REJECTED", error);
        });
        var error = result.Rejection?.Message;
        if (error is not null)
            return (game, player, error);

        game = result.Game;
        player = result.Player;
        game.WorldVersion++;
        var description = game.Activity.FirstOrDefault() ?? $"World state changed ({eventType}).";
        AddWorldEvent(game, eventType, player.Id, eventStateId, null, description);
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
            DateOnly? targetWorldDate,
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
            game, player.Id, orderId, stateId, orderType, payload, expectedWorldVersion, targetWorldDate);
        if (replayError is not null)
        {
            var auditStateId = stateId is Guid requestedStateId &&
                               game.Territories.Any(territory => territory.StateId == requestedStateId)
                ? requestedStateId
                : (Guid?)null;
            var occurredAtUtc = DateTimeOffset.UtcNow;
            AddWorldEvent(
                game, "order.rejected", player.Id, auditStateId, null,
                $"Rejected reused order ID {orderId:N}: {replayError}",
                "ORDER_ID_REUSED", occurredAtUtc);
            AddActivity(game, $"{player.Name}'s order was rejected (ORDER_ID_REUSED).");
            await SaveAsync(connection, transaction, game, cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return (game, player, CreateRejectedOrderResult(orderId, "ORDER_ID_REUSED", replayError), null);
        }
        if (replay is not null)
        {
            await transaction.CommitAsync(cancellationToken);
            return (game, player, replay, null);
        }

        OrderRejection? rejection = GameOrderRules.CheckWorldAvailability(game, orderType);
        if (rejection is null)
            rejection = GameOrderRules.CheckMembership(game, player.Id, stateId, orderType);
        if (rejection is null)
            rejection = GameOrderRules.CheckWorldVersion(expectedWorldVersion, game.WorldVersion);
        if (rejection is null)
            rejection = GameOrderRules.CheckTargetWorldDate(targetWorldDate, game.WorldDate);

        if (rejection is null)
        {
            var result = GameOrderRules.ApplyMutationAtomically(game, player.Id, mutation);
            rejection = result.Rejection;
            if (rejection is null)
            {
                game = result.Game;
                player = result.Player;
            }
        }

        var orderResult = GameOrderRules.RecordOutcome(
            game, player, orderId, stateId, orderType, payload,
            expectedWorldVersion, targetWorldDate, rejection, DateTimeOffset.UtcNow);

        await SaveAsync(connection, transaction, game, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return (game, player, orderResult, null);
    }

    private static GameOrderResult CreateRejectedOrderResult(
        Guid orderId, string code, string message) =>
        new(orderId, false, code, message, false);

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
        return DeserializeState(value, gameId);
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
        string? previousSnapshot;
        await using (var readCommand = new NpgsqlCommand(
            "SELECT state::text FROM new_world_games WHERE id = @id FOR UPDATE",
            connection, transaction))
        {
            readCommand.Parameters.AddWithValue("id", game.Id);
            previousSnapshot = await readCommand.ExecuteScalarAsync(cancellationToken) as string;
        }
        if (previousSnapshot is null)
            throw new InvalidDataException("The existing world save is missing; the update was not written.");

        _ = WorldSnapshotRules.DeserializeAndValidate(previousSnapshot, game.Id);
        var checksum = WorldSnapshotRules.CalculateChecksum(previousSnapshot);
        await using (var backupCommand = new NpgsqlCommand("""
            INSERT INTO new_world_game_backups (game_id, snapshot_json, sha256, created_at)
            VALUES (@id, @snapshot, @sha256, now())
            ON CONFLICT (game_id) DO UPDATE
            SET snapshot_json = EXCLUDED.snapshot_json,
                sha256 = EXCLUDED.sha256,
                created_at = EXCLUDED.created_at
            """, connection, transaction))
        {
            backupCommand.Parameters.AddWithValue("id", game.Id);
            backupCommand.Parameters.AddWithValue("snapshot", previousSnapshot);
            backupCommand.Parameters.AddWithValue("sha256", checksum);
            await backupCommand.ExecuteNonQueryAsync(cancellationToken);
        }

        var serializedSnapshot = WorldSnapshotRules.Serialize(game);
        await using var command = new NpgsqlCommand(
            "UPDATE new_world_games SET state = @state, updated_at = now() WHERE id = @id",
            connection, transaction);
        command.Parameters.AddWithValue("id", game.Id);
        command.Parameters.AddWithValue("state", NpgsqlDbType.Jsonb, serializedSnapshot);
        if (await command.ExecuteNonQueryAsync(cancellationToken) != 1)
            throw new InvalidDataException("The world disappeared during its save.");
    }

    private static async Task<string> ReadCurrentSnapshotAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction transaction,
        Guid gameId,
        CancellationToken cancellationToken)
    {
        await using var command = new NpgsqlCommand(
            "SELECT state::text FROM new_world_games WHERE id = @id",
            connection, transaction);
        command.Parameters.AddWithValue("id", gameId);
        return await command.ExecuteScalarAsync(cancellationToken) as string
            ?? throw new InvalidDataException("The world save is missing.");
    }

    private static PlayerState? FindPlayer(WorldState game, string token)
    {
        var tokenHash = Hash(token);
        return game.Players.FirstOrDefault(player =>
            CryptographicOperations.FixedTimeEquals(
                Convert.FromHexString(player.TokenHash), Convert.FromHexString(tokenHash)));
    }

    private static WorldState? DeserializeState(object? value, Guid? expectedGameId = null)
    {
        var game = value switch
        {
            string json => JsonSerializer.Deserialize<WorldState>(json, JsonOptions),
            JsonDocument document => DeserializeDocument(document),
            JsonElement element => element.Deserialize<WorldState>(JsonOptions),
            _ => null
        };
        if (game is not null)
            WorldSnapshotRules.Validate(game, expectedGameId ?? game.Id);
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

    public static void AddEconomicTransaction(
        WorldState game,
        TerritoryState state,
        EconomicTransactionType type,
        long balanceBefore,
        long balanceAfter,
        string description,
        Guid? orderId = null,
        Guid? membershipId = null,
        DateTimeOffset? recordedAtUtc = null)
    {
        if (state.StateId == Guid.Empty ||
            state.CurrencyId == Guid.Empty ||
            balanceBefore is < 0 or > int.MaxValue ||
            balanceAfter is < 0 or > int.MaxValue ||
            balanceAfter != state.Treasury ||
            !Enum.IsDefined(type) ||
            string.IsNullOrWhiteSpace(description))
            throw new InvalidDataException("A State treasury transaction is invalid.");

        game.FinancialTransactions.Add(new EconomicTransaction(
            Guid.NewGuid(),
            state.StateId,
            state.CurrencyId,
            type,
            balanceAfter - balanceBefore,
            balanceBefore,
            balanceAfter,
            game.WorldDate,
            recordedAtUtc ?? DateTimeOffset.UtcNow,
            orderId,
            membershipId,
            description));
    }

    public static void AddCompanyFinancialTransaction(
        WorldState game,
        EconomicCompany company,
        Guid currencyId,
        long balanceBefore,
        long balanceAfter,
        string goodId,
        long quantity,
        long unitPrice,
        Guid? tradeRouteId,
        string description,
        CompanyTransactionType type = CompanyTransactionType.MarketSale)
    {
        if (company.Id == Guid.Empty ||
            company.StateId == Guid.Empty ||
            currencyId == Guid.Empty ||
            balanceBefore < 0 ||
            balanceAfter < 0 ||
            (type is CompanyTransactionType.OpeningBalance or
                CompanyTransactionType.MarketSale or CompanyTransactionType.TradeSale) &&
            balanceAfter < balanceBefore ||
            type == CompanyTransactionType.TradePurchase && balanceAfter > balanceBefore ||
            company.CashBalances.GetValueOrDefault(currencyId) != balanceAfter ||
            !Enum.IsDefined(type) ||
            type == CompanyTransactionType.OpeningBalance &&
            (balanceBefore != 0 || balanceAfter <= 0 ||
             !string.IsNullOrEmpty(goodId) || quantity != 0 || unitPrice != 0 || tradeRouteId is not null) ||
            (type is CompanyTransactionType.MarketSale or
                CompanyTransactionType.TradeSale or CompanyTransactionType.TradePurchase) &&
            (string.IsNullOrWhiteSpace(goodId) || quantity <= 0 || unitPrice <= 0 ||
             tradeRouteId is null && type != CompanyTransactionType.MarketSale ||
             tradeRouteId is Guid routeId && !game.TradeRoutes.Any(route => route.Id == routeId) ||
             type == CompanyTransactionType.MarketSale &&
             balanceAfter - balanceBefore != checked(quantity * unitPrice) ||
             type == CompanyTransactionType.TradeSale &&
             balanceAfter - balanceBefore != checked(quantity * unitPrice) ||
             type == CompanyTransactionType.TradePurchase &&
             balanceAfter - balanceBefore != -checked(quantity * unitPrice)) ||
            string.IsNullOrWhiteSpace(description))
            throw new InvalidDataException("A company financial transaction is invalid.");

        game.CompanyFinancialTransactions.Add(new CompanyFinancialTransaction(
            Guid.NewGuid(),
            company.Id,
            company.StateId,
            currencyId,
            type,
            balanceAfter - balanceBefore,
            balanceBefore,
            balanceAfter,
            game.WorldDate,
            tradeRouteId,
            goodId,
            quantity,
            unitPrice,
            description));
    }

    public static WorldEvent AddWorldEvent(
        WorldState game,
        string type,
        Guid? actorPlayerId,
        Guid? stateId,
        Guid? orderId,
        string description,
        string? resultCode = null,
        DateTimeOffset? occurredAtUtc = null,
        long? worldVersion = null)
    {
        var worldEvent = new WorldEvent(
            Guid.NewGuid(),
            game.Id,
            orderId,
            actorPlayerId,
            stateId,
            type,
            resultCode,
            occurredAtUtc ?? DateTimeOffset.UtcNow,
            game.WorldDate,
            worldVersion ?? game.WorldVersion,
            description,
            ++game.EventSequence);
        game.Events.Add(worldEvent);
        return worldEvent;
    }
}
