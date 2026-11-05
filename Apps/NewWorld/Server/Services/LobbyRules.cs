using NewWorld.Server.Models;

namespace NewWorld.Server.Services;

public static class LobbyRules
{
    public static string? GetJoinError(WorldState game, string playerName)
    {
        if (game.Started)
            return "This world has already started.";
        if (game.Players.Count >= Math.Min(game.MaxHumanPlayers, GameCatalog.MaxHumanPlayers))
            return "This world has reached its player limit.";
        if (game.Players.Any(player =>
                string.Equals(player.Name, playerName, StringComparison.OrdinalIgnoreCase)))
            return "That player name is already in use.";
        return null;
    }
}

public static class GovernmentMembershipRules
{
    public static string? Assign(
        WorldState game, Guid targetPlayerId, int? stateIndex)
    {
        var player = game.Players.SingleOrDefault(item => item.Id == targetPlayerId);
        if (player is null)
            return "Player not found.";
        if (stateIndex is int index && !game.Territories.Any(territory => territory.Index == index))
            return "Invalid state assignment.";

        var activeMemberships = game.Memberships.Where(item =>
            item.PlayerId == targetPlayerId && item.Status == MembershipStatus.Active).ToList();
        if (stateIndex is null)
        {
            foreach (var membership in activeMemberships)
                membership.Status = MembershipStatus.Left;
            foreach (var stateId in activeMemberships.Select(item => item.StateId).Distinct())
            {
                var territory = game.Territories.SingleOrDefault(item => item.StateId == stateId);
                if (territory?.OwnerPlayerId == targetPlayerId &&
                    !game.Memberships.Any(item => item.StateId == stateId && item.Status == MembershipStatus.Active))
                    territory.OwnerPlayerId = null;
            }
        }

        player.LegacyCountryIndex = stateIndex;
        if (stateIndex is int assignedIndex)
        {
            var territory = game.Territories.Single(item => item.Index == assignedIndex);
            if (!activeMemberships.Any(membership => membership.StateId == territory.StateId))
            {
                var accumulatedRemainder = (long)territory.DailyBalanceRemainder + player.DailyBalanceRemainder;
                var treasuryIncrease = (long)player.Treasury + accumulatedRemainder / 30;
                if (territory.Treasury > int.MaxValue - treasuryIncrease)
                    return "The state treasury has reached its limit.";

                territory.Treasury += (int)treasuryIncrease;
                territory.DailyBalanceRemainder = (int)(accumulatedRemainder % 30);
                player.Treasury = 0;
                player.DailyBalanceRemainder = 0;
                territory.OwnerPlayerId ??= player.Id;
                game.Memberships.Add(new GovernmentMembership
                {
                    Id = Guid.NewGuid(),
                    GameId = game.Id,
                    PlayerId = player.Id,
                    StateId = territory.StateId,
                    JoinedAtWorldDate = game.WorldDate
                });
            }
        }

        return null;
    }
}
