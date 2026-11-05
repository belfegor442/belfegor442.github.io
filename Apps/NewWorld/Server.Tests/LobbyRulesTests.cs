using NewWorld.Server.Models;
using NewWorld.Server.Services;

namespace NewWorld.Server.Tests;

public sealed class LobbyRulesTests
{
    [Fact]
    public void LobbyAllowsTwentyPlayersRegardlessOfStateCount()
    {
        var game = new WorldState
        {
            Players = Enumerable.Range(0, GameCatalog.MaxHumanPlayers)
                .Select(index => new PlayerState { Name = $"Player {index}" })
                .ToList()
        };

        Assert.Equal("This world has reached its player limit.", LobbyRules.GetJoinError(game, "Player 21"));
    }

    [Fact]
    public void LobbyAcceptsTwentiethPlayer()
    {
        var game = new WorldState
        {
            Players = Enumerable.Range(0, GameCatalog.MaxHumanPlayers - 1)
                .Select(index => new PlayerState { Name = $"Player {index}" })
                .ToList()
        };

        Assert.Null(LobbyRules.GetJoinError(game, "Player 20"));
    }

    [Fact]
    public void MultiplePlayersCanShareTheSameGovernment()
    {
        var game = new WorldState
        {
            Id = Guid.NewGuid(),
            Territories = [new TerritoryState { Index = 0, StateId = Guid.NewGuid(), Name = "Coimbrila" }],
            Players =
            [
                new PlayerState { Id = Guid.NewGuid(), Name = "Player One" },
                new PlayerState { Id = Guid.NewGuid(), Name = "Player Two" }
            ]
        };

        Assert.Null(GovernmentMembershipRules.Assign(game, game.Players[0].Id, 0));
        Assert.Null(GovernmentMembershipRules.Assign(game, game.Players[1].Id, 0));

        Assert.Equal(2, game.Memberships.Count(membership =>
            membership.StateId == game.Territories[0].StateId &&
            membership.Status == MembershipStatus.Active));
        Assert.Equal(2400, game.Territories[0].Treasury);
        Assert.All(game.Players, player => Assert.Equal(0, player.Treasury));
    }

    [Fact]
    public void PlayerCanHoldMembershipsInMultipleGovernments()
    {
        var player = new PlayerState { Id = Guid.NewGuid(), Name = "Player One" };
        var game = new WorldState
        {
            Id = Guid.NewGuid(),
            WorldDate = new DateOnly(1500, 1, 1),
            Players = [player],
            Territories =
            [
                new TerritoryState { Index = 0, StateId = Guid.NewGuid(), Name = "Coimbrila" },
                new TerritoryState { Index = 1, StateId = Guid.NewGuid(), Name = "Gania" }
            ]
        };

        Assert.Null(GovernmentMembershipRules.Assign(game, player.Id, 0));
        Assert.Null(GovernmentMembershipRules.Assign(game, player.Id, 1));

        Assert.Equal(2, game.Memberships.Count(membership =>
            membership.PlayerId == player.Id && membership.Status == MembershipStatus.Active));
        Assert.Equal(1, player.LegacyCountryIndex);
        var snapshot = GameHub.BuildSnapshot(game, new HashSet<Guid> { player.Id });
        Assert.Equal(2, Assert.Single(snapshot.Players).Memberships.Count);
        Assert.Equal(new DateOnly(1500, 1, 1), snapshot.WorldDate);
        Assert.Equal(1200, game.Territories[0].Treasury);
        Assert.Equal(0, game.Territories[1].Treasury);
    }
}
