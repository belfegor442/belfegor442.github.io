using NewWorld.Server.Models;
using NewWorld.Server.Services;

namespace NewWorld.Server.Tests;

public sealed class GameOrderRulesTests
{
    [Fact]
    public void RetryReturnsOriginalResultWithoutChangingTheOrder()
    {
        var playerId = Guid.NewGuid();
        var gameId = Guid.NewGuid();
        var orderId = Guid.NewGuid();
        var order = new GameOrder(
            gameId, orderId, playerId, Guid.NewGuid(), GameOrderType.ConstructBuilding,
            new GameOrderPayload(null, 4, "farm"),
            DateTimeOffset.UtcNow, new DateOnly(1500, 1, 1), false, "Insufficient treasury.", 5);
        var game = new WorldState { Id = gameId, Orders = [order] };

        var (replay, error) = GameOrderRules.FindReplay(
            game, playerId, orderId, order.Type, order.Payload);

        Assert.Null(error);
        Assert.Equal(new GameOrderResult(orderId, false, "Insufficient treasury.", true), replay);
        Assert.Single(game.Orders);
    }

    [Fact]
    public void OrderIdsAreScopedToTheirSubmittingPlayer()
    {
        var orderId = Guid.NewGuid();
        var firstPlayer = Guid.NewGuid();
        var secondPlayer = Guid.NewGuid();
        var game = new WorldState
        {
            Orders =
            [
                new GameOrder(Guid.Empty, orderId, firstPlayer, null, GameOrderType.PauseWorld,
                    new GameOrderPayload(null, null, null),
                    DateTimeOffset.UtcNow, new DateOnly(1500, 1, 1), true, null, 2)
            ]
        };

        Assert.Null(GameOrderRules.FindReplay(game, secondPlayer, orderId, GameOrderType.PauseWorld,
            new GameOrderPayload(null, null, null)).Replay);
        Assert.NotNull(GameOrderRules.FindReplay(game, firstPlayer, orderId, GameOrderType.PauseWorld,
            new GameOrderPayload(null, null, null)).Replay);
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
                new GameOrder(Guid.NewGuid(), orderId, playerId, null, GameOrderType.EstablishAdministration,
                    new GameOrderPayload(2, null, null),
                    DateTimeOffset.UtcNow, new DateOnly(1500, 1, 1), false, "Invalid territory.", 1)
            ]
        };

        var (_, error) = GameOrderRules.FindReplay(
            game, playerId, orderId, GameOrderType.EstablishAdministration,
            new GameOrderPayload(3, null, null));

        Assert.Equal("This order ID was already used for a different request.", error);
    }
}
