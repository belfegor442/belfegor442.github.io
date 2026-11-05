using NewWorld.Server.Models;

namespace NewWorld.Server.Services;

public static class GameOrderRules
{
    public static (GameOrderResult? Replay, string? Error) FindReplay(
        WorldState game, Guid playerId, Guid orderId, GameOrderType type, GameOrderPayload payload)
    {
        var previousOrder = game.Orders.FirstOrDefault(order =>
            order.Id == orderId && order.PlayerId == playerId);
        if (previousOrder is null)
            return (null, null);
        if (previousOrder.Type != type || previousOrder.Payload != payload)
            return (null, "This order ID was already used for a different request.");
        return (new GameOrderResult(previousOrder.Id, previousOrder.Accepted, previousOrder.Result, true), null);
    }
}
