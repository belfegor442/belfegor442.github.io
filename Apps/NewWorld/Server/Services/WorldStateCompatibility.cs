using System.Security.Cryptography;
using System.Text;
using NewWorld.Server.Models;

namespace NewWorld.Server.Services;

public static class WorldStateCompatibility
{
    private static readonly DateOnly ScenarioStartDate = new(1500, 1, 1);

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
        if (game.ClockAccumulatorTicks < 0 ||
            game.ClockAccumulatorTicks >= TimeSpan.FromMinutes(5).Ticks)
            throw new InvalidDataException("The saved world has an invalid clock accumulator.");
        if (game.MaxHumanPlayers < 1)
            game.MaxHumanPlayers = GameCatalog.MaxHumanPlayers;
        game.MaxHumanPlayers = Math.Min(game.MaxHumanPlayers, GameCatalog.MaxHumanPlayers);
        if (game.Started && game.Status == GameStatus.Lobby)
            game.Status = game.Paused ? GameStatus.Paused : GameStatus.Running;

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
                string.IsNullOrWhiteSpace(membership.PermissionSetId) ||
                !membershipIds.Add(membership.Id) ||
                membership.Status == MembershipStatus.Active &&
                !activePlayerStates.Add((membership.PlayerId, membership.StateId)))
                throw new InvalidDataException("The saved world contains an invalid government membership.");
        }

        if (game.Players.Any(player =>
                player.Treasury < 0 || player.DailyBalanceRemainder is < 0 or >= 30))
            throw new InvalidDataException("The saved world contains invalid legacy player finances.");

        var orderKeys = new HashSet<(Guid PlayerId, Guid OrderId)>();
        foreach (var order in game.Orders)
        {
            if (order.GameId != game.Id ||
                order.Id == Guid.Empty ||
                !playerIds.Contains(order.PlayerId) ||
                order.StateId is Guid stateId && !stateIds.Contains(stateId) ||
                order.Payload is null ||
                !Enum.IsDefined(order.Type) ||
                !orderKeys.Add((order.PlayerId, order.Id)) ||
                order.Accepted == (order.Result is not null))
                throw new InvalidDataException("The saved world contains an invalid order record.");
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
