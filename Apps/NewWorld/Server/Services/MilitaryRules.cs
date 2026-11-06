using System.Numerics;
using NewWorld.Server.Models;

namespace NewWorld.Server.Services;

public sealed record MilitaryMovementChange(
    Guid StateId,
    Guid OrderId,
    Guid PlayerId,
    string EventType,
    string Description);

public static class MilitaryRules
{
    public static OrderRejection? SubmitOrder(
        WorldState game,
        PlayerState player,
        Guid orderId,
        Guid? stateId,
        MilitaryOrderType? orderType,
        Guid? unitId,
        Guid? destinationProvinceId,
        Guid? routeId)
    {
        if (stateId is not Guid selectedStateId ||
            unitId is not Guid selectedUnitId ||
            orderType is null)
            return new OrderRejection("INVALID_PAYLOAD", "A State, unit, and military order type are required.");
        if (orderType != MilitaryOrderType.Move)
            return new OrderRejection(
                "MILITARY_RULES_PENDING",
                "This military order requires rules that are not configured yet.");

        var membership = game.Memberships.SingleOrDefault(item =>
            item.PlayerId == player.Id &&
            item.StateId == selectedStateId &&
            item.Status == MembershipStatus.Active);
        if (membership is null)
            return new OrderRejection("NOT_MEMBER", "You are not a member of the selected government.");

        var unit = game.MilitaryUnits.SingleOrDefault(item => item.Id == selectedUnitId);
        if (unit is null || unit.StateId != selectedStateId)
            return new OrderRejection("TARGET_UNAVAILABLE", "The selected military unit is unavailable.");
        if (unit.Status is not (MilitaryUnitStatus.Active or MilitaryUnitStatus.Supplied))
            return new OrderRejection("UNIT_NOT_OPERATIONAL", "The selected unit is not operational.");
        var unitType = game.MilitaryUnitTypes.Single(item => item.Id == unit.UnitTypeId);
        if (!unitType.CommandPermissionSetIds.Contains(membership.PermissionSetId))
            return new OrderRejection(
                "INSUFFICIENT_PERMISSION",
                "Your government permission set is not authorized to command this unit.");

        if (routeId is not Guid selectedRouteId ||
            destinationProvinceId is not Guid selectedDestinationId)
            return new OrderRejection("INVALID_PAYLOAD", "A destination and configured route are required.");
        var route = game.MilitaryRoutes.SingleOrDefault(item => item.Id == selectedRouteId);
        if (route is null ||
            !route.Enabled ||
            route.OriginProvinceId != unit.ProvinceId ||
            route.DestinationProvinceId != selectedDestinationId)
            return new OrderRejection("TARGET_UNAVAILABLE", "No enabled route connects this unit to the destination.");
        if (!string.Equals(route.CapacityUnit, "personnel", StringComparison.Ordinal))
            return new OrderRejection(
                "MILITARY_CAPACITY_UNIT_UNSUPPORTED",
                "The route capacity must be expressed in personnel to validate this movement.");
        var reservedCapacity = game.MilitaryOrders
            .Where(item => item.RouteId == route.Id &&
                item.Status is MilitaryOrderStatus.Pending or MilitaryOrderStatus.InProgress)
            .Select(item => game.MilitaryUnits.Single(unitItem => unitItem.Id == item.UnitId).Personnel)
            .Aggregate(BigInteger.Zero, (total, value) => total + value);
        if (reservedCapacity + unit.Personnel > route.Capacity)
            return new OrderRejection("ROUTE_CAPACITY_EXCEEDED", "The route has insufficient available capacity.");

        var routeStates = route.ProvincePath
            .Select(provinceId => game.Provinces.Single(item => item.Id == provinceId).SovereignStateId)
            .Where(provinceStateId => provinceStateId != selectedStateId)
            .Distinct()
            .ToList();
        if (routeStates.Any(provinceStateId => !route.PermittedStateIds.Contains(provinceStateId)))
            return new OrderRejection(
                "TERRITORY_ACCESS_DENIED",
                "The route crosses territory without configured access.");
        for (var index = 1; index < route.ProvincePath.Count; index++)
        {
            var fromProvinceId = route.ProvincePath[index - 1];
            var toProvinceId = route.ProvincePath[index];
            var connections = game.ProvinceConnections.Where(connection =>
                connection.FromProvinceId == fromProvinceId &&
                connection.ToProvinceId == toProvinceId ||
                connection.Bidirectional &&
                connection.FromProvinceId == toProvinceId &&
                connection.ToProvinceId == fromProvinceId);
            if (!connections.Any(connection =>
                    connection.RestrictedToStateIds.Count == 0 ||
                    connection.RestrictedToStateIds.Contains(selectedStateId)))
                return new OrderRejection(
                    "TERRITORY_ACCESS_DENIED",
                    "The route contains a geographic connection restricted to another State.");
        }

        if (game.MilitaryOrders.Any(item =>
                item.UnitId == unit.Id &&
                item.Status is MilitaryOrderStatus.Pending or MilitaryOrderStatus.InProgress))
            return new OrderRejection("CONFLICTING_ORDER", "The unit already has an active military order.");

        game.MilitaryOrders.Add(new MilitaryOrder
        {
            Id = orderId,
            GameId = game.Id,
            StateId = selectedStateId,
            UnitId = unit.Id,
            IssuerPlayerId = player.Id,
            Type = orderType.Value,
            DestinationProvinceId = selectedDestinationId,
            RouteId = route.Id,
            SubmittedOnWorldDate = game.WorldDate,
            Status = MilitaryOrderStatus.Pending,
            TravelDaysRemaining = route.TravelDays
        });
        GameStore.AddActivity(game, $"{player.Name} ordered a military unit to move.");
        return null;
    }

    public static IReadOnlyList<MilitaryMovementChange> AdvanceDailyMovement(WorldState game)
    {
        var changes = new List<MilitaryMovementChange>();
        foreach (var order in game.MilitaryOrders
            .Where(item => item.Status is MilitaryOrderStatus.Pending or MilitaryOrderStatus.InProgress)
            .OrderBy(item => item.Id))
        {
            if (order.Type != MilitaryOrderType.Move ||
                order.RouteId is not Guid routeId)
                continue;
            var route = game.MilitaryRoutes.Single(item => item.Id == routeId);
            var unit = game.MilitaryUnits.Single(item => item.Id == order.UnitId);
            if (!route.Enabled)
            {
                order.Status = MilitaryOrderStatus.Interrupted;
                order.RejectionReason = "The configured route is no longer enabled.";
                changes.Add(new MilitaryMovementChange(
                    order.StateId, order.Id, order.IssuerPlayerId,
                    "military.movement_interrupted",
                    $"{unit.UnitTypeId} movement was interrupted because its route is disabled."));
                continue;
            }

            if (order.Status == MilitaryOrderStatus.Pending)
            {
                order.Status = MilitaryOrderStatus.InProgress;
                order.CurrentPathIndex = 0;
                order.DaysToNextProvince = route.SegmentTravelDays[0];
            }

            var missingSupply = route.DailySupplyConsumption.FirstOrDefault(consumption =>
                unit.Supplies.GetValueOrDefault(consumption.Key) < consumption.Value);
            if (!string.IsNullOrEmpty(missingSupply.Key))
            {
                order.Status = MilitaryOrderStatus.Interrupted;
                order.RejectionReason = "The unit does not have the configured daily movement supplies.";
                unit.Status = MilitaryUnitStatus.Isolated;
                changes.Add(new MilitaryMovementChange(
                    order.StateId, order.Id, order.IssuerPlayerId,
                    "military.movement_interrupted",
                    $"{unit.UnitTypeId} movement was interrupted because supplies were unavailable."));
                continue;
            }

            foreach (var consumption in route.DailySupplyConsumption)
                unit.Supplies[consumption.Key] -= consumption.Value;
            order.DaysToNextProvince--;
            order.TravelDaysRemaining--;
            if (order.DaysToNextProvince > 0)
                continue;

            order.CurrentPathIndex++;
            unit.ProvinceId = route.ProvincePath[order.CurrentPathIndex];
            if (order.CurrentPathIndex == route.ProvincePath.Count - 1)
            {
                order.Status = MilitaryOrderStatus.Completed;
                changes.Add(new MilitaryMovementChange(
                    order.StateId, order.Id, order.IssuerPlayerId,
                    "military.unit_arrived",
                    $"{unit.UnitTypeId} arrived at its configured destination."));
                continue;
            }

            order.DaysToNextProvince = route.SegmentTravelDays[order.CurrentPathIndex];
            changes.Add(new MilitaryMovementChange(
                order.StateId, order.Id, order.IssuerPlayerId,
                "military.unit_moved",
                $"{unit.UnitTypeId} advanced to the next province on its route."));
        }

        return changes;
    }
}
