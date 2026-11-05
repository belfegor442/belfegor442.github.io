using NewWorld.Server.Models;

namespace NewWorld.Server.Services;

public enum PauseVoteResult
{
    Added,
    Withdrawn,
    Paused,
    Resumed
}

public static class PauseVoteRules
{
    public static bool PauseForNoConnectedPlayers(WorldState game, DateTimeOffset now)
    {
        var votesChanged = game.PauseVotes.Count > 0;
        if (votesChanged)
            game.PauseVotes.Clear();

        if (!game.Started)
            return votesChanged;

        var shouldPause = !game.Paused;
        if (!shouldPause && !votesChanged)
            return false;

        game.Paused = true;
        game.Status = GameStatus.Paused;
        game.LastTickUtc = now;
        GameStore.AddActivity(game, shouldPause
            ? "The world paused because no players are connected."
            : "Pending pause votes were cleared because no players are connected.");
        return true;
    }

    public static PauseVoteResult Toggle(WorldState game, Guid playerId, IReadOnlySet<Guid> connectedPlayers)
    {
        if (!game.PauseVotes.Add(playerId))
        {
            game.PauseVotes.Remove(playerId);
            return PauseVoteResult.Withdrawn;
        }

        if (game.PauseVotes.Count <= connectedPlayers.Count / 2)
            return PauseVoteResult.Added;

        game.Paused = !game.Paused;
        game.Status = game.Paused ? GameStatus.Paused : GameStatus.Running;
        game.PauseVotes.Clear();
        if (!game.Paused)
            game.LastTickUtc = DateTimeOffset.UtcNow;
        return game.Paused ? PauseVoteResult.Paused : PauseVoteResult.Resumed;
    }
}
