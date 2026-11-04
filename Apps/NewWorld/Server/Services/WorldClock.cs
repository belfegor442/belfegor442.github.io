using NewWorld.Server.Models;

namespace NewWorld.Server.Services;

public sealed class WorldClock(GameStore store, GameHub hub, ILogger<WorldClock> logger) : BackgroundService
{
    private static readonly TimeSpan DayLength = TimeSpan.FromMinutes(5);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(5));
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            var gameIds = await store.GetGameIdsAsync(stoppingToken);
            foreach (var gameId in gameIds)
            {
                if (hub.ConnectedPlayers(gameId).Count == 0)
                    continue;

                var now = DateTimeOffset.UtcNow;
                var result = await store.MutateSystemAsync(gameId, game =>
                {
                    if (!game.Started || game.Paused || now - game.LastTickUtc < DayLength)
                        return "No tick is due.";

                    game.Day++;
                    game.LastTickUtc = now;
                    foreach (var player in game.Players)
                        SimulationRules.AccrueDailyBalance(
                            player, SimulationRules.CalculateMonthlyBalance(game, player));
                    if ((game.Day - 1) % 365 == 0)
                    {
                        foreach (var territory in game.Territories.Where(item => item.OwnerPlayerId is not null))
                            territory.Population = (int)Math.Round(territory.Population * 1.003);
                    }
                    GameStore.AddActivity(game, $"Day {game.Day} began.");
                    return null;
                }, stoppingToken);

                if (result.Error is null)
                    await hub.BroadcastAsync(gameId, stoppingToken);
                else if (result.Error != "No tick is due.")
                    logger.LogDebug("World {GameId} did not advance: {Reason}", gameId, result.Error);
            }
        }
    }

}
