using NewWorld.Server.Models;
using NewWorld.Server.Services;

namespace NewWorld.Server.Tests;

public sealed class PauseVoteRulesTests
{
    [Fact]
    public void PauseForNoConnectedPlayersPausesWorldAndClearsVotes()
    {
        var now = DateTimeOffset.UtcNow;
        var game = new WorldState
        {
            Started = true,
            Status = GameStatus.Running,
            Paused = false,
            LastTickUtc = now.AddMinutes(-1),
            PauseVotes = [Guid.NewGuid()]
        };

        Assert.True(PauseVoteRules.PauseForNoConnectedPlayers(game, now));
        Assert.True(game.Paused);
        Assert.Equal(GameStatus.Paused, game.Status);
        Assert.Equal(now, game.LastTickUtc);
        Assert.Empty(game.PauseVotes);
    }

    [Fact]
    public void PauseForNoConnectedPlayersDoesNotChangeAlreadyPausedWorld()
    {
        var lastTick = DateTimeOffset.UtcNow.AddMinutes(-1);
        var game = new WorldState
        {
            Started = true,
            Status = GameStatus.Paused,
            Paused = true,
            LastTickUtc = lastTick
        };

        Assert.False(PauseVoteRules.PauseForNoConnectedPlayers(game, DateTimeOffset.UtcNow));
        Assert.Equal(lastTick, game.LastTickUtc);
    }

    [Fact]
    public void ToggleRequiresStrictMajorityOfConnectedPlayers()
    {
        var game = new WorldState();
        var firstPlayer = Guid.NewGuid();
        var secondPlayer = Guid.NewGuid();
        var connectedPlayers = new HashSet<Guid> { firstPlayer, secondPlayer };

        Assert.Equal(PauseVoteResult.Added, PauseVoteRules.Toggle(game, firstPlayer, connectedPlayers));
        Assert.False(game.Paused);
        Assert.Equal(PauseVoteResult.Paused, PauseVoteRules.Toggle(game, secondPlayer, connectedPlayers));
        Assert.True(game.Paused);
        Assert.Empty(game.PauseVotes);
    }

    [Fact]
    public void ToggleAllowsConnectedMajorityAndResetsClockWhenResuming()
    {
        var previousTick = DateTimeOffset.UtcNow.AddMinutes(-1);
        var game = new WorldState { Paused = true, LastTickUtc = previousTick };
        var players = new[] { Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid() };
        var connectedPlayers = players.ToHashSet();

        Assert.Equal(PauseVoteResult.Added, PauseVoteRules.Toggle(game, players[0], connectedPlayers));
        Assert.Equal(PauseVoteResult.Resumed, PauseVoteRules.Toggle(game, players[1], connectedPlayers));
        Assert.False(game.Paused);
        Assert.True(game.LastTickUtc > previousTick);
        Assert.Empty(game.PauseVotes);
    }

    [Fact]
    public void ToggleCanWithdrawPendingVote()
    {
        var game = new WorldState();
        var player = Guid.NewGuid();
        var connectedPlayers = new HashSet<Guid> { player, Guid.NewGuid(), Guid.NewGuid() };

        Assert.Equal(PauseVoteResult.Added, PauseVoteRules.Toggle(game, player, connectedPlayers));
        Assert.Equal(PauseVoteResult.Withdrawn, PauseVoteRules.Toggle(game, player, connectedPlayers));
        Assert.Empty(game.PauseVotes);
        Assert.False(game.Paused);
    }

    [Fact]
    public void SnapshotIncludesOnlyVotesFromConnectedPlayers()
    {
        var connectedVoter = Guid.NewGuid();
        var disconnectedVoter = Guid.NewGuid();
        var game = new WorldState
        {
            Paused = true,
            PauseVotes = [connectedVoter, disconnectedVoter]
        };

        var snapshot = GameHub.BuildSnapshot(game, new HashSet<Guid> { connectedVoter });

        Assert.True(snapshot.Paused);
        Assert.Equal(new[] { connectedVoter }, snapshot.PauseVotePlayerIds);
    }
}
