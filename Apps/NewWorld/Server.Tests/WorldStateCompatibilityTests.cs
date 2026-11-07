using System.Text.Json;
using NewWorld.Server.Models;
using NewWorld.Server.Services;

namespace NewWorld.Server.Tests;

public sealed class WorldStateCompatibilityTests
{
    [Theory]
    [InlineData(1)]
    [InlineData(2)]
    public void NormalizeUpgradesCompatibleBelelandMapGeometryVersions(int previousVersion)
    {
        var game = new WorldState
        {
            Id = Guid.NewGuid(),
            MapGeometryVersion = previousVersion,
            Players = [],
            Territories = []
        };

        WorldStateCompatibility.Normalize(game);

        Assert.Equal(3, game.MapGeometryVersion);
    }

    [Fact]
    public void NormalizeRejectsMapGeometryVersionsFromTheFuture()
    {
        var game = new WorldState
        {
            Id = Guid.NewGuid(),
            MapGeometryVersion = MapGeometryCatalog.MapVersion + 1,
            Players = [],
            Territories = []
        };

        Assert.Throws<InvalidDataException>(() => WorldStateCompatibility.Normalize(game));
    }

    [Fact]
    public void NormalizeMigratesLegacyPlayerAssignmentsToStableMemberships()
    {
        var gameId = Guid.NewGuid();
        var playerId = Guid.NewGuid();
        var legacyState = $$"""
            {
              "id": "{{gameId}}",
              "started": true,
              "day": 366,
              "players": [
                {
                  "id": "{{playerId}}",
                  "name": "Player One",
                  "countryIndex": 0,
                  "treasury": 1600,
                  "dailyBalanceRemainder": 17
                }
              ],
              "territories": [
                { "index": 0, "name": "Coimbrila" }
              ]
            }
            """;

        var game = JsonSerializer.Deserialize<WorldState>(legacyState, new JsonSerializerOptions(JsonSerializerDefaults.Web))!;
        WorldStateCompatibility.Normalize(game);

        Assert.Equal(new DateOnly(1501, 1, 1), game.WorldDate);
        Assert.Equal(GameStatus.Running, game.Status);
        var membership = Assert.Single(game.Memberships);
        Assert.Equal(game.Id, membership.GameId);
        Assert.Equal(playerId, membership.PlayerId);
        Assert.Equal(game.Territories[0].StateId, membership.StateId);
        Assert.NotEqual(Guid.Empty, membership.Id);
        Assert.Equal(1600, game.Territories[0].Treasury);
        Assert.Equal(17, game.Territories[0].DailyBalanceRemainder);
        Assert.Equal(0, game.Players[0].Treasury);
        var currency = Assert.Single(game.Currencies);
        Assert.Equal(game.Territories[0].StateId, currency.StateId);
        Assert.Equal(currency.Id, game.Territories[0].CurrencyId);
        var openingBalance = Assert.Single(game.FinancialTransactions);
        Assert.Equal(EconomicTransactionType.OpeningBalance, openingBalance.Type);
        Assert.Equal(1600, openingBalance.BalanceAfter);

        var stableStateId = game.Territories[0].StateId;
        var stableMembershipId = membership.Id;
        var stableCurrencyId = currency.Id;
        var stableTransactionId = openingBalance.Id;
        WorldStateCompatibility.Normalize(game);

        Assert.Equal(stableStateId, game.Territories[0].StateId);
        Assert.Equal(stableMembershipId, Assert.Single(game.Memberships).Id);
        Assert.Equal(stableCurrencyId, Assert.Single(game.Currencies).Id);
        Assert.Equal(stableTransactionId, Assert.Single(game.FinancialTransactions).Id);
        Assert.Equal(1600, game.Territories[0].Treasury);
    }

    [Fact]
    public void NormalizeMigratesLegacyPlayerBuildingsIntoTheirGovernmentTerritory()
    {
        var gameId = Guid.NewGuid();
        var playerId = Guid.NewGuid();
        var game = new WorldState
        {
            Id = gameId,
            EconomyVersion = 3,
            WorldDate = new DateOnly(1500, 1, 1),
            Players =
            [
                new PlayerState
                {
                    Id = playerId,
                    Name = "Builder",
                    LegacyCountryIndex = 0,
                    Buildings = { [0] = GameCatalog.Buildings["farm"] }
                }
            ],
            Territories =
            [
                new TerritoryState { Index = 0, Name = "Coimbrila", Population = 10000 }
            ]
        };

        WorldStateCompatibility.Normalize(game);

        var migrated = Assert.Single(game.Territories[0].Buildings);
        Assert.Equal(GameCatalog.NormalizeConstructionPlotIndex(0), migrated.Key);
        Assert.Equal("farm", migrated.Value.Id);
        Assert.Equal(0, migrated.Value.DaysRemaining);
        Assert.Empty(game.Players[0].Buildings);
        Assert.Equal(10000, game.Territories[0].BaseHousingCapacity);
        Assert.Equal(10000, game.Territories[0].BaseFoodCapacity);
        Assert.Equal(10000, game.Territories[0].BaseWaterCapacity);

        WorldStateCompatibility.Normalize(game);
        Assert.Single(game.Territories[0].Buildings);
        Assert.Empty(game.Players[0].Buildings);
    }

    [Fact]
    public void NormalizeConvertsLegacyTerritoryPlotKeysAndRestoresCanonicalBuildingEffects()
    {
        var game = new WorldState
        {
            EconomyVersion = 3,
            Players = [],
            Territories =
            [
                new TerritoryState
                {
                    Index = 0,
                    Name = "Coimbrila",
                    Population = 10000,
                    Buildings =
                    {
                        [0] = GameCatalog.Buildings["housing"] with { Cost = 1, HousingCapacity = 1 }
                    }
                }
            ]
        };

        WorldStateCompatibility.Normalize(game);

        var building = Assert.Single(game.Territories[0].Buildings);
        Assert.Equal(GameCatalog.NormalizeConstructionPlotIndex(0), building.Key);
        Assert.Equal(180, building.Value.Cost);
        Assert.Equal(1000, building.Value.HousingCapacity);
    }

    [Fact]
    public void NormalizeRejectsLegacyAndCanonicalBuildingsOnTheSamePlot()
    {
        var game = new WorldState
        {
            EconomyVersion = 3,
            Players = [],
            Territories =
            [
                new TerritoryState
                {
                    Index = 0,
                    Name = "Coimbrila",
                    Population = 10000,
                    Buildings =
                    {
                        [0] = GameCatalog.Buildings["housing"],
                        [GameCatalog.NormalizeConstructionPlotIndex(0)] = GameCatalog.Buildings["farm"]
                    }
                }
            ]
        };

        Assert.Throws<InvalidDataException>(() => WorldStateCompatibility.Normalize(game));
    }

    [Fact]
    public void NormalizeRejectsStateTreasuryWithoutFinancialHistory()
    {
        var stateId = Guid.NewGuid();
        var currencyId = Guid.NewGuid();
        var game = new WorldState
        {
            WorldDate = new DateOnly(1500, 1, 1),
            EconomyVersion = 2,
            Territories =
            [
                new TerritoryState
                {
                    StateId = stateId,
                    CurrencyId = currencyId,
                    Treasury = 100
                }
            ],
            Currencies =
            [
                new StateCurrency
                {
                    Id = currencyId,
                    StateId = stateId
                }
            ]
        };

        Assert.Throws<InvalidDataException>(() => WorldStateCompatibility.Normalize(game));
    }

    [Fact]
    public void NormalizeCapsLegacyPlayerLimitAtTwenty()
    {
        var game = new WorldState { MaxHumanPlayers = 64 };

        WorldStateCompatibility.Normalize(game);

        Assert.Equal(20, game.MaxHumanPlayers);
    }

    [Theory]
    [InlineData(true, false, GameStatus.Paused, GameStatus.Running, false)]
    [InlineData(true, true, GameStatus.Running, GameStatus.Paused, true)]
    [InlineData(false, true, GameStatus.Paused, GameStatus.Lobby, false)]
    public void NormalizeKeepsStartedPausedAndSessionStatusConsistent(
        bool started, bool paused, GameStatus savedStatus, GameStatus expectedStatus, bool expectedPaused)
    {
        var game = new WorldState
        {
            Started = started,
            Paused = paused,
            Status = savedStatus
        };

        WorldStateCompatibility.Normalize(game);

        Assert.Equal(expectedStatus, game.Status);
        Assert.Equal(expectedPaused, game.Paused);
    }

    [Fact]
    public void NormalizeRejectsMembershipsReferencingAnotherGame()
    {
        var gameId = Guid.NewGuid();
        var playerId = Guid.NewGuid();
        var stateId = Guid.NewGuid();
        var game = new WorldState
        {
            Id = gameId,
            Players = [new PlayerState { Id = playerId }],
            Territories = [new TerritoryState { StateId = stateId }],
            Memberships =
            [
                new GovernmentMembership
                {
                    Id = Guid.NewGuid(),
                    GameId = Guid.NewGuid(),
                    PlayerId = playerId,
                    StateId = stateId
                }
            ]
        };

        Assert.Throws<InvalidDataException>(() => WorldStateCompatibility.Normalize(game));
    }

    [Fact]
    public void NormalizeUsesGregorianDatesIncludingLeapYears()
    {
        var game = new WorldState { Day = 1461 };

        WorldStateCompatibility.Normalize(game);

        Assert.Equal(new DateOnly(1504, 1, 1), game.WorldDate);
        Assert.Equal(new DateOnly(1504, 2, 29), game.WorldDate.AddDays(59));
    }

    [Fact]
    public void NormalizeRejectsAnInvalidClockAccumulator()
    {
        var game = new WorldState { ClockAccumulatorTicks = TimeSpan.FromMinutes(5).Ticks };

        Assert.Throws<InvalidDataException>(() => WorldStateCompatibility.Normalize(game));
    }

    [Fact]
    public void NormalizePreservesValidPersistentOrderHistory()
    {
        var gameId = Guid.NewGuid();
        var playerId = Guid.NewGuid();
        var stateId = Guid.NewGuid();
        var order = new GameOrder(
            gameId, Guid.NewGuid(), playerId, stateId, GameOrderType.ConstructBuilding,
            GameOrderStatus.Rejected, new GameOrderPayload(null, 2, "farm"), 3,
            DateTimeOffset.UtcNow, new DateOnly(1500, 1, 1),
            "INSUFFICIENT_FUNDS", "Insufficient treasury.", 4, "government-member");
        var game = new WorldState
        {
            Id = gameId,
            WorldVersion = 4,
            Players = [new PlayerState { Id = playerId }],
            Territories = [new TerritoryState { StateId = stateId }],
            Orders = [order]
        };

        WorldStateCompatibility.Normalize(game);

        Assert.Equal(order, Assert.Single(game.Orders));
        Assert.Equal("government-member", game.Orders[0].PermissionSetId);
    }

    [Fact]
    public void NormalizeRejectsDuplicateOrderIdsForOnePlayer()
    {
        var playerId = Guid.NewGuid();
        var gameId = Guid.NewGuid();
        var orderId = Guid.NewGuid();
        var firstOrder = new GameOrder(
            gameId, orderId, playerId, null, GameOrderType.PauseWorld,
            GameOrderStatus.Executed, new GameOrderPayload(null, null, null), 1,
            DateTimeOffset.UtcNow, new DateOnly(1500, 1, 1), null, null, 2);
        var game = new WorldState
        {
            Id = gameId,
            Players = [new PlayerState { Id = playerId }],
            Orders = [firstOrder, firstOrder with { Type = GameOrderType.ResumeWorld }]
        };

        Assert.Throws<InvalidDataException>(() => WorldStateCompatibility.Normalize(game));
    }

    [Fact]
    public void NormalizePreservesValidEventsLinkedToTheirOrder()
    {
        var gameId = Guid.NewGuid();
        var playerId = Guid.NewGuid();
        var stateId = Guid.NewGuid();
        var orderId = Guid.NewGuid();
        var order = new GameOrder(
            gameId, orderId, playerId, stateId, GameOrderType.ConstructBuilding,
            GameOrderStatus.Executed, new GameOrderPayload(null, 2, "farm"), 3,
            DateTimeOffset.UtcNow, new DateOnly(1500, 1, 1), null, null, 4);
        var worldEvent = new WorldEvent(
            Guid.NewGuid(), gameId, orderId, playerId, stateId, "order.executed", null,
            order.SubmittedAtUtc, order.SubmittedOnWorldDate, order.WorldVersion, "Executed ConstructBuilding.");
        var game = new WorldState
        {
            Id = gameId,
            WorldVersion = 4,
            Players = [new PlayerState { Id = playerId }],
            Territories = [new TerritoryState { StateId = stateId }],
            Orders = [order],
            Events = [worldEvent]
        };

        WorldStateCompatibility.Normalize(game);

        Assert.Equal(worldEvent with { Sequence = 1 }, Assert.Single(game.Events));
        Assert.Equal(1, game.EventSequence);
    }

    [Fact]
    public void NormalizeRejectsEventsWithMismatchedOrderVersions()
    {
        var gameId = Guid.NewGuid();
        var playerId = Guid.NewGuid();
        var stateId = Guid.NewGuid();
        var order = new GameOrder(
            gameId, Guid.NewGuid(), playerId, stateId, GameOrderType.ConstructBuilding,
            GameOrderStatus.Executed, new GameOrderPayload(null, 2, "farm"), 3,
            DateTimeOffset.UtcNow, new DateOnly(1500, 1, 1), null, null, 4);
        var worldEvent = new WorldEvent(
            Guid.NewGuid(), gameId, order.Id, playerId, stateId, "order.executed", null,
            order.SubmittedAtUtc, order.SubmittedOnWorldDate, 3, "Executed ConstructBuilding.");
        var game = new WorldState
        {
            Id = gameId,
            WorldVersion = 4,
            Players = [new PlayerState { Id = playerId }],
            Territories = [new TerritoryState { StateId = stateId }],
            Orders = [order],
            Events = [worldEvent]
        };

        Assert.Throws<InvalidDataException>(() => WorldStateCompatibility.Normalize(game));
    }

    [Fact]
    public void NormalizeAllowsRejectedOrdersThatExpectedAFutureWorldVersion()
    {
        var gameId = Guid.NewGuid();
        var playerId = Guid.NewGuid();
        var order = new GameOrder(
            gameId, Guid.NewGuid(), playerId, null, GameOrderType.PauseWorld,
            GameOrderStatus.Rejected, new GameOrderPayload(null, null, null), 5,
            DateTimeOffset.UtcNow, new DateOnly(1500, 1, 1),
            "STALE_WORLD_VERSION", "The world changed.", 2);
        var game = new WorldState
        {
            Id = gameId,
            WorldVersion = 2,
            Players = [new PlayerState { Id = playerId }],
            Orders = [order]
        };

        WorldStateCompatibility.Normalize(game);

        Assert.Equal(order, Assert.Single(game.Orders));
    }

    [Fact]
    public void NormalizeMigratesLegacyOrdersIntoStableWorldEvents()
    {
        var gameId = Guid.NewGuid();
        var playerId = Guid.NewGuid();
        var stateId = Guid.NewGuid();
        var order = new GameOrder(
            gameId, Guid.NewGuid(), playerId, stateId, GameOrderType.ConstructBuilding,
            GameOrderStatus.Rejected, new GameOrderPayload(null, 2, "farm"), 1,
            DateTimeOffset.UtcNow, new DateOnly(1500, 1, 1),
            "INSUFFICIENT_FUNDS", "Insufficient treasury.", 2);
        var game = new WorldState
        {
            Id = gameId,
            WorldVersion = 2,
            Players = [new PlayerState { Id = playerId }],
            Territories = [new TerritoryState { StateId = stateId }],
            Orders = [order]
        };

        WorldStateCompatibility.Normalize(game);

        var worldEvent = Assert.Single(game.Events);
        Assert.Equal(order.Id, worldEvent.OrderId);
        Assert.Equal(order.PlayerId, worldEvent.ActorPlayerId);
        Assert.Equal(order.StateId, worldEvent.StateId);
        Assert.Equal("order.rejected", worldEvent.Type);
        Assert.Equal("INSUFFICIENT_FUNDS", worldEvent.ResultCode);

        var eventId = worldEvent.Id;
        var eventSequence = worldEvent.Sequence;
        WorldStateCompatibility.Normalize(game);

        Assert.Equal(eventId, Assert.Single(game.Events).Id);
        Assert.Equal(eventSequence, Assert.Single(game.Events).Sequence);
    }

    [Fact]
    public void NormalizeKeepsRejectedOrdersWithUnknownStateReferencesAuditable()
    {
        var gameId = Guid.NewGuid();
        var playerId = Guid.NewGuid();
        var unknownStateId = Guid.NewGuid();
        var order = new GameOrder(
            gameId, Guid.NewGuid(), playerId, unknownStateId, GameOrderType.ConstructBuilding,
            GameOrderStatus.Rejected, new GameOrderPayload(null, 2, "farm"), 1,
            DateTimeOffset.UtcNow, new DateOnly(1500, 1, 1),
            "NOT_MEMBER", "You are not a member of the selected government.", 2);
        var game = new WorldState
        {
            Id = gameId,
            WorldVersion = 2,
            Players = [new PlayerState { Id = playerId }],
            Territories = [new TerritoryState { StateId = Guid.NewGuid() }],
            Orders = [order]
        };

        WorldStateCompatibility.Normalize(game);

        var worldEvent = Assert.Single(game.Events);
        Assert.Equal(order.Id, worldEvent.OrderId);
        Assert.Null(worldEvent.StateId);
        Assert.Equal(unknownStateId, Assert.Single(game.Orders).StateId);
    }

    [Fact]
    public void NormalizeRejectsDuplicateWorldEventSequences()
    {
        var gameId = Guid.NewGuid();
        var game = new WorldState
        {
            Id = gameId,
            WorldVersion = 2,
            Events =
            [
                new WorldEvent(Guid.NewGuid(), gameId, null, null, null, "world.changed",
                    null, DateTimeOffset.UtcNow, new DateOnly(1500, 1, 1), 2, "First.", 1),
                new WorldEvent(Guid.NewGuid(), gameId, null, null, null, "world.changed",
                    null, DateTimeOffset.UtcNow, new DateOnly(1500, 1, 1), 2, "Second.", 1)
            ]
        };

        Assert.Throws<InvalidDataException>(() => WorldStateCompatibility.Normalize(game));
    }

    [Fact]
    public void AddWorldEventAssignsMonotonicSequenceAndCurrentWorldMetadata()
    {
        var game = new WorldState
        {
            Id = Guid.NewGuid(),
            WorldDate = new DateOnly(1500, 1, 2),
            WorldVersion = 7,
            EventSequence = 4
        };
        var occurredAt = DateTimeOffset.UtcNow;

        var worldEvent = GameStore.AddWorldEvent(
            game, "world.day_advanced", null, null, null, "Day advanced.",
            occurredAtUtc: occurredAt, worldVersion: 8);

        Assert.Equal(5, game.EventSequence);
        Assert.Equal(5, worldEvent.Sequence);
        Assert.Equal(game.Id, worldEvent.GameId);
        Assert.Equal(game.WorldDate, worldEvent.WorldDate);
        Assert.Equal(8, worldEvent.WorldVersion);
        Assert.Equal(occurredAt, worldEvent.OccurredAtUtc);
        Assert.Same(worldEvent, Assert.Single(game.Events));
    }
}
