using NewWorld.Server.Models;

namespace NewWorld.Server.Services;

public static class GameOrderRules
{
    public static OrderRejection? CheckWorldVersion(long expectedWorldVersion, long currentWorldVersion) =>
        expectedWorldVersion == currentWorldVersion
            ? null
            : new OrderRejection(
                "STALE_WORLD_VERSION", "The world changed. Review the latest state and retry.");

    public static (GameOrderResult? Replay, string? Error) FindReplay(
        WorldState game, Guid playerId, Guid orderId, Guid? stateId,
        GameOrderType type, GameOrderPayload payload, long expectedWorldVersion)
    {
        var previousOrder = game.Orders.FirstOrDefault(order => order.Id == orderId);
        if (previousOrder is null)
            return (null, null);
        if (previousOrder.PlayerId != playerId ||
            previousOrder.Type != type ||
            previousOrder.StateId != stateId ||
            previousOrder.Payload != payload ||
            previousOrder.ExpectedWorldVersion != expectedWorldVersion)
            return (null, "This order ID was already used for a different request.");
        return (new GameOrderResult(
            previousOrder.Id, previousOrder.Status == GameOrderStatus.Executed,
            previousOrder.ResultCode, previousOrder.Result, true), null);
    }
}
