using NewWorld.Server.Models;
using NewWorld.Server.Services;

namespace NewWorld.Server.Tests;

public sealed class GameOrderRulesTests
{
    [Fact]
    public void RejectedMutationCannotPartiallyChangeThePersistedWorld()
    {
        var player = new PlayerState { Id = Guid.NewGuid() };
        var state = new TerritoryState { StateId = Guid.NewGuid(), Treasury = 900 };
        var game = new WorldState
        {
            Id = Guid.NewGuid(),
            Players = [player],
            Territories = [state]
        };

        var result = GameOrderRules.ApplyMutationAtomically(game, player.Id, (candidate, _) =>
        {
            candidate.Territories[0].Treasury -= 450;
            candidate.Activity.Add("partially applied");
            return new OrderRejection("CONFLICT", "The order cannot be applied.");
        });

        Assert.Same(game, result.Game);
        Assert.Equal(900, game.Territories[0].Treasury);
        Assert.Empty(game.Activity);
        Assert.Equal("CONFLICT", result.Rejection?.Code);
    }

    [Fact]
    public void AcceptedMutationReturnsAnIsolatedWorldCopy()
    {
        var player = new PlayerState { Id = Guid.NewGuid() };
        var state = new TerritoryState { StateId = Guid.NewGuid(), Treasury = 900 };
        var game = new WorldState
        {
            Id = Guid.NewGuid(),
            Players = [player],
            Territories = [state]
        };

        var result = GameOrderRules.ApplyMutationAtomically(game, player.Id, (candidate, _) =>
        {
            candidate.Territories[0].Treasury -= 450;
            return null;
        });

        Assert.Null(result.Rejection);
        Assert.NotSame(game, result.Game);
        Assert.Equal(900, game.Territories[0].Treasury);
        Assert.Equal(450, result.Game.Territories[0].Treasury);
    }

    [Theory]
    [InlineData(GameOrderType.ConstructBuilding, GameStatus.Paused, "WORLD_NOT_RUNNING")]
    [InlineData(GameOrderType.ConstructBuilding, GameStatus.Closed, "WORLD_NOT_RUNNING")]
    [InlineData(GameOrderType.PauseWorld, GameStatus.Paused, "PAUSE_STATE_CONFLICT")]
    [InlineData(GameOrderType.ResumeWorld, GameStatus.Running, "PAUSE_STATE_CONFLICT")]
    public void WorldAvailabilityRejectsOrdersInIncompatibleStates(
        GameOrderType orderType, GameStatus status, string expectedCode)
    {
        var result = GameOrderRules.CheckWorldAvailability(
            new WorldState { Started = true, Status = status }, orderType);

        Assert.Equal(expectedCode, result?.Code);
    }

    [Fact]
    public void WorldAvailabilityRejectsOrdersBeforeTheWorldStarts()
    {
        var result = GameOrderRules.CheckWorldAvailability(
            new WorldState { Status = GameStatus.Lobby }, GameOrderType.ConstructBuilding);

        Assert.Equal("WORLD_NOT_STARTED", result?.Code);
    }

    [Fact]
    public void StaleWorldVersionsAreRejectedWithStableCode()
    {
        Assert.Null(GameOrderRules.CheckWorldVersion(4, 4));
        Assert.Equal("STALE_WORLD_VERSION", GameOrderRules.CheckWorldVersion(3, 4)?.Code);
    }

    [Fact]
    public void RetryReturnsOriginalResultWithoutChangingTheOrder()
    {
        var playerId = Guid.NewGuid();
        var gameId = Guid.NewGuid();
        var orderId = Guid.NewGuid();
        var order = new GameOrder(
            gameId, orderId, playerId, Guid.NewGuid(), GameOrderType.ConstructBuilding,
            GameOrderStatus.Rejected, new GameOrderPayload(null, 4, "farm"), 5,
            DateTimeOffset.UtcNow, new DateOnly(1500, 1, 1),
            "INSUFFICIENT_FUNDS", "Insufficient treasury.", 5);
        var game = new WorldState { Id = gameId, Orders = [order] };

        var (replay, error) = GameOrderRules.FindReplay(
            game, playerId, orderId, order.StateId, order.Type, order.Payload, order.ExpectedWorldVersion);

        Assert.Null(error);
        Assert.Equal(new GameOrderResult(
            orderId, false, "INSUFFICIENT_FUNDS", "Insufficient treasury.", true), replay);
        Assert.Single(game.Orders);
    }

    [Fact]
    public void OrderIdsCannotBeReusedByAnotherPlayer()
    {
        var orderId = Guid.NewGuid();
        var firstPlayer = Guid.NewGuid();
        var secondPlayer = Guid.NewGuid();
        var game = new WorldState
        {
            Orders =
            [
                new GameOrder(Guid.Empty, orderId, firstPlayer, null, GameOrderType.PauseWorld,
                    GameOrderStatus.Executed, new GameOrderPayload(null, null, null), 1,
                    DateTimeOffset.UtcNow, new DateOnly(1500, 1, 1), null, null, 2)
            ]
        };

        Assert.Equal("This order ID was already used for a different request.",
            GameOrderRules.FindReplay(game, secondPlayer, orderId, null, GameOrderType.PauseWorld,
                new GameOrderPayload(null, null, null), 1).Error);
        Assert.NotNull(GameOrderRules.FindReplay(game, firstPlayer, orderId, null, GameOrderType.PauseWorld,
            new GameOrderPayload(null, null, null), 1).Replay);
    }

    [Fact]
    public void ReusingAnOrderIdWithDifferentPayloadIsRejected()
    {
        var playerId = Guid.NewGuid();
        var orderId = Guid.NewGuid();
        var game = new WorldState
        {
            Orders =
            [
                new GameOrder(Guid.NewGuid(), orderId, playerId, null,
                    GameOrderType.EstablishAdministration, GameOrderStatus.Rejected,
                    new GameOrderPayload(2, null, null), 1,
                    DateTimeOffset.UtcNow, new DateOnly(1500, 1, 1),
                    "INVALID_PAYLOAD", "Invalid territory.", 1)
            ]
        };

        var (_, error) = GameOrderRules.FindReplay(
            game, playerId, orderId, null, GameOrderType.EstablishAdministration,
            new GameOrderPayload(3, null, null), 1);

        Assert.Equal("This order ID was already used for a different request.", error);
        Assert.Equal("This order ID was already used for a different request.",
            GameOrderRules.FindReplay(game, playerId, orderId, null, GameOrderType.EstablishAdministration,
                new GameOrderPayload(2, null, null), 2).Error);
    }
}
