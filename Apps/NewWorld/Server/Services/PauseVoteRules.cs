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
        game.PauseVotes.Clear();
        if (!game.Paused)
            game.LastTickUtc = DateTimeOffset.UtcNow;
        return game.Paused ? PauseVoteResult.Paused : PauseVoteResult.Resumed;
    }
}
