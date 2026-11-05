using NewWorld.Server.Models;

namespace NewWorld.Server.Services;

public static class GameOrderRules
{
    public static GameOrderType ParseType(string messageType) => messageType switch
    {
        "claim" => GameOrderType.EstablishAdministration,
        "build" => GameOrderType.ConstructBuilding,
        "approveBudget" => GameOrderType.ApproveBudget,
        "proposeLaw" => GameOrderType.ProposeLaw,
        "appointOffice" => GameOrderType.AppointOffice,
        "negotiateTreaty" => GameOrderType.NegotiateTreaty,
        "mobilizeUnit" => GameOrderType.MobilizeUnit,
        "startProject" => GameOrderType.StartProject,
        "pause" => GameOrderType.PauseWorld,
        "resume" => GameOrderType.ResumeWorld,
        _ => GameOrderType.Unsupported
    };

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

    public static GameOrderResult RecordOutcome(
        WorldState game,
        PlayerState player,
        Guid orderId,
        Guid? stateId,
        GameOrderType orderType,
        GameOrderPayload payload,
        long expectedWorldVersion,
        DateOnly? targetWorldDate,
        OrderRejection? rejection,
        DateTimeOffset submittedAtUtc)
    {
        if (rejection is null)
            game.WorldVersion++;

        var permissionSetId = stateId is Guid selectedStateId
            ? game.Memberships.FirstOrDefault(membership =>
                membership.PlayerId == player.Id &&
                membership.StateId == selectedStateId &&
                membership.Status == MembershipStatus.Active)?.PermissionSetId
            : null;
        var order = new GameOrder(
            game.Id,
            orderId,
            player.Id,
            stateId,
            orderType,
            rejection is null ? GameOrderStatus.Executed : GameOrderStatus.Rejected,
            payload,
            expectedWorldVersion,
            submittedAtUtc,
            game.WorldDate,
            rejection?.Code,
            rejection?.Message,
            game.WorldVersion,
            permissionSetId,
            targetWorldDate ?? game.WorldDate);
        game.Orders.Add(order);
        GameStore.AddActivity(game, rejection is null
            ? $"{player.Name} submitted {orderType} (order {orderId:N})."
            : $"{player.Name}'s {orderType} order was rejected ({rejection.Code}): {rejection.Message}");

        var eventStateId = stateId is Guid requestedStateId &&
                           game.Territories.Any(territory => territory.StateId == requestedStateId)
            ? requestedStateId
            : (Guid?)null;
        game.Events.Add(new WorldEvent(
            Guid.NewGuid(),
            game.Id,
            orderId,
            player.Id,
            eventStateId,
            rejection is null ? "order.executed" : "order.rejected",
            rejection?.Code,
            submittedAtUtc,
            game.WorldDate,
            game.WorldVersion,
            rejection is null ? $"Executed {orderType}." : rejection.Message));

        return new GameOrderResult(
            orderId, rejection is null, rejection?.Code, rejection?.Message, false);
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

    public static OrderRejection? CheckMembership(
        WorldState game, Guid playerId, Guid? stateId)
    {
        if (!game.Memberships.Any(membership =>
                membership.PlayerId == playerId && membership.Status == MembershipStatus.Active))
            return new OrderRejection("NOT_MEMBER", "This player has not been assigned a state.");

        if (stateId is not Guid selectedStateId ||
            !game.Memberships.Any(membership =>
                membership.PlayerId == playerId &&
                membership.StateId == selectedStateId &&
                membership.Status == MembershipStatus.Active))
            return new OrderRejection("NOT_MEMBER", "You are not a member of the selected government.");

        return null;
    }

    public static OrderRejection? CheckWorldVersion(long expectedWorldVersion, long currentWorldVersion) =>
        expectedWorldVersion == currentWorldVersion
            ? null
            : new OrderRejection(
                "STALE_WORLD_VERSION", "The world changed. Review the latest state and retry.");

    public static OrderRejection? CheckTargetWorldDate(DateOnly? targetDate, DateOnly currentDate)
    {
        if (targetDate is not DateOnly requestedDate || requestedDate == currentDate)
            return null;
        if (requestedDate < currentDate)
            return new OrderRejection("TARGET_DATE_IN_PAST", "The target world date has already passed.");
        return new OrderRejection(
            "SCHEDULED_ORDERS_UNSUPPORTED", "Orders cannot be scheduled for a future world date yet.");
    }

    public static (GameOrderResult? Replay, string? Error) FindReplay(
        WorldState game, Guid playerId, Guid orderId, Guid? stateId,
        GameOrderType type, GameOrderPayload payload, long expectedWorldVersion, DateOnly? targetWorldDate = null)
    {
        var previousOrder = game.Orders.FirstOrDefault(order => order.Id == orderId);
        if (previousOrder is null)
            return (null, null);
        if (previousOrder.PlayerId != playerId ||
            previousOrder.Type != type ||
            previousOrder.StateId != stateId ||
            previousOrder.Payload != payload ||
            previousOrder.ExpectedWorldVersion != expectedWorldVersion ||
            (previousOrder.TargetWorldDate ?? previousOrder.SubmittedOnWorldDate) !=
            (targetWorldDate ?? previousOrder.SubmittedOnWorldDate))
            return (null, "This order ID was already used for a different request.");
        return (new GameOrderResult(
            previousOrder.Id, previousOrder.Status == GameOrderStatus.Executed,
            previousOrder.ResultCode, previousOrder.Result, true), null);
    }
}
