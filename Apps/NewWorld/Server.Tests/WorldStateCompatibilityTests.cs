using System.Text.Json;
using NewWorld.Server.Models;
using NewWorld.Server.Services;

namespace NewWorld.Server.Tests;

public sealed class WorldStateCompatibilityTests
{
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

        var stableStateId = game.Territories[0].StateId;
        var stableMembershipId = membership.Id;
        WorldStateCompatibility.Normalize(game);

        Assert.Equal(stableStateId, game.Territories[0].StateId);
        Assert.Equal(stableMembershipId, Assert.Single(game.Memberships).Id);
        Assert.Equal(1600, game.Territories[0].Treasury);
    }

    [Fact]
    public void NormalizeCapsLegacyPlayerLimitAtTwenty()
    {
        var game = new WorldState { MaxHumanPlayers = 64 };

        WorldStateCompatibility.Normalize(game);

        Assert.Equal(20, game.MaxHumanPlayers);
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
            "INSUFFICIENT_FUNDS", "Insufficient treasury.", 4);
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
}
