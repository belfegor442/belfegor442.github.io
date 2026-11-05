using System.Collections.Concurrent;
using NewWorld.Server.Models;

namespace NewWorld.Server.Services;

public sealed class WorldClock(
    GameStore store, GameHub hub, TimeProvider timeProvider, ILogger<WorldClock> logger) : BackgroundService
{
    private static readonly TimeSpan DayLength = TimeSpan.FromMinutes(5);
    private readonly ConcurrentDictionary<Guid, ClockAnchor> _clockAnchors = new();

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await PauseWorldsWithoutPlayersAsync(stoppingToken);
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(5));
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            var gameIds = await store.GetGameIdsAsync(stoppingToken);
            foreach (var gameId in gameIds)
            {
                if (hub.ConnectedPlayers(gameId).Count == 0)
                {
                    _clockAnchors.TryRemove(gameId, out _);
                    continue;
                }

                var nowTimestamp = timeProvider.GetTimestamp();
                ClockAnchor? nextAnchor = null;
                var resetAnchor = false;
                var stopClock = false;
                var didAdvance = false;
                var result = await store.MutateSystemAsync(gameId, game =>
                {
                    if (!game.Started || game.Paused)
                    {
                        stopClock = true;
                        return "The world clock is stopped.";
                    }

                    if (!_clockAnchors.TryGetValue(gameId, out var anchor) ||
                        anchor.LastTickUtc != game.LastTickUtc)
                    {
                        nextAnchor = new ClockAnchor(nowTimestamp, game.LastTickUtc);
                        resetAnchor = true;
                        return "Clock anchor reset.";
                    }

                    var elapsed = timeProvider.GetElapsedTime(anchor.Timestamp, nowTimestamp);
                    var accumulatedTicks = checked(game.ClockAccumulatorTicks + elapsed.Ticks);
                    var daysDue = accumulatedTicks / DayLength.Ticks;
                    game.ClockAccumulatorTicks = accumulatedTicks % DayLength.Ticks;
                    for (long day = 0; day < daysDue; day++)
                    {
                        if (game.Day == int.MaxValue || game.WorldDate == DateOnly.MaxValue)
                            return "The world reached the supported calendar limit.";

                        game.Day++;
                        game.WorldDate = game.WorldDate.AddDays(1);
                        game.LastTickUtc = game.LastTickUtc.Add(DayLength);
                        foreach (var government in game.Territories)
                        {
                            var balance = SimulationRules.CalculateGovernmentBalance(game, government);
                            SimulationRules.AccrueDailyBalance(government, balance.MonthlyBalance);
                        }
                        if (game.WorldDate.Month == 1 && game.WorldDate.Day == 1)
                        {
                            foreach (var territory in game.Territories.Where(item => item.OwnerPlayerId is not null))
                                territory.Population = (int)Math.Round(territory.Population * 1.003);
                        }
                        var description = $"{game.WorldDate:yyyy-MM-dd} began (day {game.Day}).";
                        GameStore.AddActivity(game, description);
                        GameStore.AddWorldEvent(
                            game, "world.day_advanced", null, null, null, description,
                            worldVersion: game.WorldVersion + 1);
                    }
                    didAdvance = daysDue > 0;
                    nextAnchor = new ClockAnchor(nowTimestamp, game.LastTickUtc);
                    return null;
                }, stoppingToken, _ => didAdvance);

                if (result.Error is null)
                {
                    if (nextAnchor is not null)
                        _clockAnchors[gameId] = nextAnchor;
                    if (didAdvance)
                        await hub.BroadcastAsync(gameId, stoppingToken);
                }
                else if (resetAnchor && nextAnchor is not null)
                    _clockAnchors[gameId] = nextAnchor;
                else if (stopClock)
                    _clockAnchors.TryRemove(gameId, out _);
                else
                    logger.LogDebug("World {GameId} did not advance: {Reason}", gameId, result.Error);
            }
        }
    }

    private async Task PauseWorldsWithoutPlayersAsync(CancellationToken cancellationToken)
    {
        var gameIds = await store.GetGameIdsAsync(cancellationToken);
        foreach (var gameId in gameIds)
        {
            if (hub.ConnectedPlayers(gameId).Count > 0)
                continue;

            var result = await store.MutateSystemAsync(gameId, game =>
                PauseVoteRules.PauseForNoConnectedPlayers(game, timeProvider.GetUtcNow())
                    ? null
                    : "No pause state change is required.", cancellationToken);
            if (result.Error is not null && result.Error != "No pause state change is required.")
                logger.LogWarning("Could not pause disconnected world {GameId}: {Reason}", gameId, result.Error);
        }
    }

    private sealed record ClockAnchor(long Timestamp, DateTimeOffset LastTickUtc);
}
