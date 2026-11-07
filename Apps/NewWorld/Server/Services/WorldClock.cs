using System.Collections.Concurrent;
using NewWorld.Server.Models;

namespace NewWorld.Server.Services;

public sealed class WorldClock(
    GameStore store, GameHub hub, TimeProvider timeProvider, ILogger<WorldClock> logger) : BackgroundService
{
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
                    var advance = WorldClockRules.Accumulate(game.ClockAccumulatorTicks, elapsed);
                    var daysDue = advance.DaysDue;
                    game.ClockAccumulatorTicks = advance.RemainingTicks;
                    for (long day = 0; day < daysDue; day++)
                    {
                        if (game.Day == int.MaxValue || game.WorldDate == DateOnly.MaxValue)
                            return "The world reached the supported calendar limit.";

                        game.Day++;
                        game.WorldDate = game.WorldDate.AddDays(1);
                        game.LastTickUtc = game.LastTickUtc.Add(WorldClockRules.DayLength);
                        foreach (var settlementEvent in SettlementRules.AdvanceDaily(game))
                        {
                            GameStore.AddActivity(game, settlementEvent.Description);
                            GameStore.AddWorldEvent(
                                game, settlementEvent.EventType, null, settlementEvent.StateId, null,
                                settlementEvent.Description,
                                occurredAtUtc: game.LastTickUtc,
                                worldVersion: game.WorldVersion + 1);
                        }
                        foreach (var government in game.Territories)
                        {
                            var balance = SimulationRules.CalculateGovernmentBalance(game, government);
                            var balanceBefore = government.Treasury;
                            var dailyChange =
                                SimulationRules.AccrueDailyBalance(government, balance.MonthlyBalance);
                            if (dailyChange != 0)
                                GameStore.AddEconomicTransaction(
                                    game,
                                    government,
                                    EconomicTransactionType.DailyBalance,
                                    balanceBefore,
                                    government.Treasury,
                                    $"Daily balance change from a monthly balance of {balance.MonthlyBalance}.",
                                    recordedAtUtc: game.LastTickUtc);
                        }
                        var (productionResults, productionError) =
                            EconomyRules.AdvanceDailyProduction(game);
                        if (productionError is not null)
                            return productionError;
                        foreach (var result in productionResults)
                        {
                            var company = game.Companies.Single(item => item.Id == result.CompanyId);
                            var outputs = result.OutputsProduced.Select(output =>
                            {
                                var good = game.Goods.Single(item => item.Id == output.Key);
                                return $"{output.Value} {good.Unit} {good.Name}";
                            });
                            var productionDescription =
                                $"{company.Name} completed {result.Batches} batch(es): {string.Join(", ", outputs)}.";
                            GameStore.AddActivity(game, productionDescription);
                            GameStore.AddWorldEvent(
                                game, "economy.production_completed", null, company.StateId, null,
                                productionDescription, worldVersion: game.WorldVersion + 1);
                        }
                        var (marketSettlements, marketError) =
                            MarketClearingRules.ClearDailyMarkets(game);
                        if (marketError is not null)
                            return marketError;
                        foreach (var settlement in marketSettlements)
                        {
                            var market = game.Markets.Single(item =>
                                item.StateId == settlement.StateId &&
                                item.GoodId == settlement.GoodId);
                            var good = game.Goods.Single(item => item.Id == settlement.GoodId);
                            var state = game.Territories.Single(item => item.StateId == settlement.StateId);
                            var marketDescription =
                                $"{state.Name} market cleared {good.Name}: sold {settlement.QuantitySold} " +
                                $"of {settlement.Demand} {good.Unit} demanded at {market.CurrentPrice} " +
                                $"per {good.Unit}; {settlement.UnmetDemand} demand unmet.";
                            GameStore.AddActivity(game, marketDescription);
                            GameStore.AddWorldEvent(
                                game,
                                "economy.market_cleared",
                                null,
                                settlement.StateId,
                                null,
                                marketDescription,
                                worldVersion: game.WorldVersion + 1);
                        }
                        foreach (var movement in MilitaryRules.AdvanceDailyMovement(game))
                        {
                            GameStore.AddActivity(game, movement.Description);
                            GameStore.AddWorldEvent(
                                game,
                                movement.EventType,
                                movement.PlayerId,
                                movement.StateId,
                                movement.OrderId,
                                movement.Description,
                                occurredAtUtc: game.LastTickUtc,
                                worldVersion: game.WorldVersion + 1);
                        }
                        foreach (var research in ResearchRules.AdvanceDailyResearch(game))
                        {
                            GameStore.AddActivity(game, research.Description);
                            GameStore.AddWorldEvent(
                                game,
                                research.EventType,
                                null,
                                research.StateId,
                                research.ProjectId,
                                research.Description,
                                occurredAtUtc: game.LastTickUtc,
                                worldVersion: game.WorldVersion + 1);
                        }
                        foreach (var occupation in OccupationRules.AdvanceDaily(game))
                        {
                            GameStore.AddActivity(game, occupation.Description);
                            GameStore.AddWorldEvent(
                                game,
                                occupation.EventType,
                                null,
                                occupation.StateId,
                                occupation.OccupationId,
                                occupation.Description,
                                occurredAtUtc: game.LastTickUtc,
                                worldVersion: game.WorldVersion + 1);
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
