using NewWorld.Server.Models;

namespace NewWorld.Server.Services;

public static class GameOrderRules
{
    public static (WorldState Game, PlayerState Player, OrderRejection? Rejection) ApplyMutationAtomically(
        WorldState game,
        Guid playerId,
        Func<WorldState, PlayerState, OrderRejection?> mutation)
    {
        var candidate = WorldStateCompatibility.Clone(game);
        var candidatePlayer = candidate.Players.SingleOrDefault(player => player.Id == playerId)
            ?? throw new InvalidDataException("The order actor is missing from the cloned world.");
        var rejection = mutation(candidate, candidatePlayer);
        return rejection is null
            ? (candidate, candidatePlayer, null)
            : (game, game.Players.Single(player => player.Id == playerId), rejection);
    }

    public static OrderRejection? CheckWorldAvailability(WorldState game, GameOrderType orderType)
    {
        if (!game.Started)
            return new OrderRejection(
                "WORLD_NOT_STARTED", "The host must start the world before actions are allowed.");

        if (orderType == GameOrderType.PauseWorld && game.Status != GameStatus.Running ||
            orderType == GameOrderType.ResumeWorld && game.Status != GameStatus.Paused)
            return new OrderRejection(
                "PAUSE_STATE_CONFLICT", "The world pause state changed before this order was processed.");

        if (orderType is not (GameOrderType.PauseWorld or GameOrderType.ResumeWorld) &&
            game.Status != GameStatus.Running)
            return new OrderRejection(
                "WORLD_NOT_RUNNING", "This action is unavailable while the world is not running.");

        return null;
    }

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
