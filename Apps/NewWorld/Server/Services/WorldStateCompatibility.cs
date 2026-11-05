using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using NewWorld.Server.Models;

namespace NewWorld.Server.Services;

public static class WorldStateCompatibility
{
    private static readonly DateOnly ScenarioStartDate = new(1500, 1, 1);
    private static readonly JsonSerializerOptions CloneOptions = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) }
    };

    public static WorldState Clone(WorldState game)
    {
        var clone = JsonSerializer.Deserialize<WorldState>(
            JsonSerializer.Serialize(game, CloneOptions), CloneOptions)
            ?? throw new InvalidDataException("The saved world could not be cloned.");
        Normalize(clone);
        return clone;
    }

    public static void Normalize(WorldState game)
    {
        if (game.Day < 1)
            game.Day = 1;
        if (game.WorldDate == default)
        {
            var elapsedDays = (int)Math.Min(
                (long)game.Day - 1,
                DateOnly.MaxValue.DayNumber - ScenarioStartDate.DayNumber);
            game.WorldDate = ScenarioStartDate.AddDays(elapsedDays);
        }

        if (game.WorldVersion < 1)
            game.WorldVersion = 1;
        if (!Enum.IsDefined(game.Status))
            throw new InvalidDataException("The saved world has an invalid session status.");
        if (game.ClockAccumulatorTicks < 0 ||
            game.ClockAccumulatorTicks >= TimeSpan.FromMinutes(5).Ticks)
            throw new InvalidDataException("The saved world has an invalid clock accumulator.");
        if (game.MaxHumanPlayers < 1)
            game.MaxHumanPlayers = GameCatalog.MaxHumanPlayers;
        game.MaxHumanPlayers = Math.Min(game.MaxHumanPlayers, GameCatalog.MaxHumanPlayers);
        if (game.Started && game.Status is GameStatus.Lobby or GameStatus.Running or GameStatus.Paused)
            game.Status = game.Paused ? GameStatus.Paused : GameStatus.Running;
        else if (!game.Started && game.Status is (GameStatus.Running or GameStatus.Paused))
        {
            game.Status = GameStatus.Lobby;
            game.Paused = false;
        }

        foreach (var territory in game.Territories)
        {
            if (territory.StateId == Guid.Empty)
                territory.StateId = CreateStableId($"{game.Id:N}:state:{territory.Index}");
        }

        var stateIds = game.Territories.Select(territory => territory.StateId).ToHashSet();
        var playerIds = game.Players.Select(player => player.Id).ToHashSet();
        var membershipIds = new HashSet<Guid>();
        var activePlayerStates = new HashSet<(Guid PlayerId, Guid StateId)>();
        foreach (var player in game.Players)
        {
            if (player.LegacyCountryIndex is not int countryIndex ||
                countryIndex < 0 ||
                countryIndex >= game.Territories.Count ||
                game.Memberships.Any(membership =>
                    membership.PlayerId == player.Id && membership.Status == MembershipStatus.Active))
                continue;

            var territory = game.Territories.Single(item => item.Index == countryIndex);
            game.Memberships.Add(new GovernmentMembership
            {
                Id = CreateStableId($"{game.Id:N}:membership:{player.Id:N}:{territory.StateId:N}"),
                GameId = game.Id,
                PlayerId = player.Id,
                StateId = territory.StateId,
                JoinedAtWorldDate = game.WorldDate
            });
        }

        foreach (var membership in game.Memberships)
        {
            if (membership.Id == Guid.Empty)
                membership.Id = CreateStableId(
                    $"{game.Id:N}:membership:{membership.PlayerId:N}:{membership.StateId:N}");
            if (membership.GameId == Guid.Empty)
                membership.GameId = game.Id;
            if (membership.GameId != game.Id ||
                !playerIds.Contains(membership.PlayerId) ||
                !stateIds.Contains(membership.StateId) ||
                !Enum.IsDefined(membership.Status) ||
                string.IsNullOrWhiteSpace(membership.PermissionSetId) ||
                !membershipIds.Add(membership.Id) ||
                membership.Status == MembershipStatus.Active &&
                !activePlayerStates.Add((membership.PlayerId, membership.StateId)))
                throw new InvalidDataException("The saved world contains an invalid government membership.");
        }

        if (game.Players.Any(player =>
                player.Treasury < 0 || player.DailyBalanceRemainder is < 0 or >= 30))
            throw new InvalidDataException("The saved world contains invalid legacy player finances.");

        var ordersById = new Dictionary<Guid, GameOrder>();
        foreach (var order in game.Orders)
        {
            if (order.GameId != game.Id ||
                order.Id == Guid.Empty ||
                !playerIds.Contains(order.PlayerId) ||
                order.Payload is null ||
                !Enum.IsDefined(order.Type) ||
                !Enum.IsDefined(order.Status) ||
                order.PermissionSetId is not null && string.IsNullOrWhiteSpace(order.PermissionSetId) ||
                order.ExpectedWorldVersion < 1 ||
                !ordersById.TryAdd(order.Id, order) ||
                (order.Status == GameOrderStatus.Executed &&
                    order.StateId is Guid executedStateId && !stateIds.Contains(executedStateId)) ||
                (order.Status == GameOrderStatus.Executed &&
                    (order.ResultCode is not null || order.Result is not null)) ||
                (order.Status == GameOrderStatus.Executed &&
                    order.TargetWorldDate is DateOnly targetDate && targetDate != order.SubmittedOnWorldDate) ||
                (order.Status == GameOrderStatus.Rejected &&
                    (string.IsNullOrWhiteSpace(order.ResultCode) || string.IsNullOrWhiteSpace(order.Result))) ||
                order.WorldVersion < 1 ||
                order.WorldVersion > game.WorldVersion)
                throw new InvalidDataException("The saved world contains an invalid order record.");
        }

        var eventIds = new HashSet<Guid>();
        var eventOrderIds = new HashSet<Guid>();
        foreach (var worldEvent in game.Events)
        {
            var linkedOrder = worldEvent.OrderId is Guid eventOrderId
                ? ordersById.GetValueOrDefault(eventOrderId)
                : null;
            if (worldEvent.Id == Guid.Empty ||
                worldEvent.GameId != game.Id ||
                worldEvent.ActorPlayerId is Guid actorId && !playerIds.Contains(actorId) ||
                worldEvent.StateId is Guid eventStateId && !stateIds.Contains(eventStateId) ||
                worldEvent.OrderId is not null && linkedOrder is null ||
                worldEvent.OrderId is Guid linkedOrderId && !eventOrderIds.Add(linkedOrderId) ||
                string.IsNullOrWhiteSpace(worldEvent.Type) ||
                string.IsNullOrWhiteSpace(worldEvent.Description) ||
                worldEvent.WorldVersion < 1 ||
                worldEvent.WorldVersion > game.WorldVersion ||
                linkedOrder is not null &&
                (worldEvent.ActorPlayerId != linkedOrder.PlayerId ||
                 worldEvent.StateId != (linkedOrder.StateId is Guid linkedStateId && stateIds.Contains(linkedStateId)
                     ? linkedStateId
                     : null) ||
                 worldEvent.WorldVersion != linkedOrder.WorldVersion ||
                 worldEvent.ResultCode != linkedOrder.ResultCode ||
                 worldEvent.Type != (linkedOrder.Status == GameOrderStatus.Executed
                     ? "order.executed"
                     : "order.rejected")) ||
                !eventIds.Add(worldEvent.Id))
                throw new InvalidDataException("The saved world contains an invalid world event.");
        }

        foreach (var order in game.Orders)
        {
            if (!eventOrderIds.Add(order.Id))
                continue;
            Guid? stateId = order.StateId is Guid requestedStateId && stateIds.Contains(requestedStateId)
                ? requestedStateId
                : null;
            game.Events.Add(new WorldEvent(
                CreateStableId($"{game.Id:N}:order-event:{order.Id:N}"),
                game.Id,
                order.Id,
                order.PlayerId,
                stateId,
                order.Status == GameOrderStatus.Executed ? "order.executed" : "order.rejected",
                order.ResultCode,
                order.SubmittedAtUtc,
                order.SubmittedOnWorldDate,
                order.WorldVersion,
                order.Status == GameOrderStatus.Executed
                    ? $"Executed {order.Type}."
                    : order.Result!));
        }

        if (game.EconomyVersion < 1)
        {
            foreach (var player in game.Players)
            {
                var activeMemberships = game.Memberships.Where(membership =>
                    membership.PlayerId == player.Id && membership.Status == MembershipStatus.Active).ToList();
                if (activeMemberships.Count == 0)
                    continue;

                var membership = activeMemberships.FirstOrDefault(item =>
                    game.Territories.Single(territory => territory.StateId == item.StateId).Index ==
                    player.LegacyCountryIndex) ?? activeMemberships[0];
                var government = game.Territories.Single(territory => territory.StateId == membership.StateId);
                var accumulatedRemainder =
                    (long)government.DailyBalanceRemainder + player.DailyBalanceRemainder;
                var treasuryIncrease = (long)player.Treasury + accumulatedRemainder / 30;
                if (government.Treasury > int.MaxValue - treasuryIncrease)
                    throw new InvalidDataException("The saved world exceeds the supported state treasury limit.");

                government.Treasury += (int)treasuryIncrease;
                government.DailyBalanceRemainder = (int)(accumulatedRemainder % 30);
                player.Treasury = 0;
                player.DailyBalanceRemainder = 0;
            }
            game.EconomyVersion = 1;
        }

        foreach (var territory in game.Territories)
        {
            if (territory.Treasury < 0 || territory.DailyBalanceRemainder is < 0 or >= 30)
                throw new InvalidDataException("The saved world contains invalid state finances.");
        }
    }

    public static Guid CreateStableId(string value)
    {
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(value));
        return new Guid(hash.AsSpan(0, 16));
    }
}
