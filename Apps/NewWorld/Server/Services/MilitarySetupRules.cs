using NewWorld.Server.Models;

namespace NewWorld.Server.Services;

public static class MilitarySetupRules
{
    public static string? Configure(WorldState game, MilitaryScenarioRequest request)
    {
        if (game.Started)
            return "Military scenario data is locked after the world starts.";
        if (request.ExpectedWorldVersion != game.WorldVersion)
            return "The world changed. Reload it before configuring military data.";
        if (request.UnitTypes is null ||
            request.Commanders is null ||
            request.Units is null ||
            request.Routes is null ||
            request.SupplyRoutes is null)
            return "All military scenario collections are required; use empty arrays for unused systems.";
        if (request.UnitTypes.Any(item => item is null) ||
            request.Commanders.Any(item => item is null) ||
            request.Units.Any(item => item is null) ||
            request.Routes.Any(item => item is null) ||
            request.SupplyRoutes.Any(item => item is null) ||
            request.Occupations?.Any(item => item is null) == true)
            return "Military scenario collections cannot contain null entries.";
        if (request.UnitTypes.Count > 500 ||
            request.Commanders.Count > 100_000 ||
            request.Units.Count > 100_000 ||
            request.Routes.Count > 100_000 ||
            request.SupplyRoutes.Count > 100_000 ||
            request.Occupations?.Count > 100_000)
            return "The military scenario exceeds a supported collection limit.";

        var candidate = WorldStateCompatibility.Clone(game);
        candidate.MilitaryUnitTypes = request.UnitTypes.ToList();
        candidate.MilitaryCommanders = request.Commanders.ToList();
        candidate.MilitaryUnits = request.Units.ToList();
        candidate.MilitaryRoutes = request.Routes.ToList();
        candidate.SupplyRoutes = request.SupplyRoutes.ToList();
        candidate.MilitaryOrders = [];
        candidate.MilitaryBattles = [];
        candidate.Occupations = request.Occupations?.ToList() ?? [];
        try
        {
            WorldStateCompatibility.Normalize(candidate);
        }
        catch (InvalidDataException exception)
        {
            return $"Invalid military scenario: {exception.Message}";
        }

        game.MilitaryUnitTypes = candidate.MilitaryUnitTypes;
        game.MilitaryCommanders = candidate.MilitaryCommanders;
        game.MilitaryUnits = candidate.MilitaryUnits;
        game.MilitaryRoutes = candidate.MilitaryRoutes;
        game.SupplyRoutes = candidate.SupplyRoutes;
        game.MilitaryOrders = candidate.MilitaryOrders;
        game.MilitaryBattles = candidate.MilitaryBattles;
        game.Occupations = candidate.Occupations;
        GameStore.AddActivity(game, "The host configured military data before the world started.");
        return null;
    }

    public static void Validate(WorldState game)
    {
        var stateIds = game.Territories.Select(item => item.StateId).ToHashSet();
        var currencyIds = game.Currencies.Select(item => item.Id).ToHashSet();
        var provinces = game.Provinces.ToDictionary(item => item.Id);
        var goods = game.Goods.Select(item => item.Id).ToHashSet(StringComparer.Ordinal);
        var technologyIds = game.Technologies.Select(item => item.Id).ToHashSet(StringComparer.Ordinal);
        var unitTypes = new Dictionary<string, MilitaryUnitType>(StringComparer.Ordinal);
        foreach (var type in game.MilitaryUnitTypes)
        {
            type.RequiredEquipment ??= new Dictionary<string, long>(StringComparer.Ordinal);
            type.RequiredTechnologyIds ??= new HashSet<string>(StringComparer.Ordinal);
            type.RecruitmentCosts ??= [];
            type.DailyMaintenanceCosts ??= [];
            type.CommandPermissionSetIds ??= [];
            if (string.IsNullOrWhiteSpace(type.Id) ||
                string.IsNullOrWhiteSpace(type.Name) ||
                !Enum.IsDefined(type.Category) ||
                type.RequiredPersonnel < 0 ||
                type.RecruitmentDays < 0 ||
                type.RecruitmentCosts.Any(item => !currencyIds.Contains(item.Key) || item.Value < 0) ||
                type.DailyMaintenanceCosts.Any(item => !currencyIds.Contains(item.Key) || item.Value < 0) ||
                type.SupplyCapacity < 0 ||
                type.Mobility < 0 ||
                !HasValidGoods(type.RequiredEquipment, goods) ||
                type.RequiredTechnologyIds.Any(id => !technologyIds.Contains(id)) ||
                type.CommandPermissionSetIds.Any(id => !GovernmentPermissionRules.IsKnown(id)) ||
                !unitTypes.TryAdd(type.Id, type))
                throw new InvalidDataException("The saved world contains an invalid military unit type.");
        }

        foreach (var route in game.MilitaryRoutes)
        {
            route.ProvincePath ??= [];
            route.SegmentTravelDays ??= [];
            route.PermittedStateIds ??= [];
            route.DailySupplyConsumption ??= new Dictionary<string, long>(StringComparer.Ordinal);
        }
        foreach (var route in game.SupplyRoutes)
            route.DailySupplyConsumption ??= new Dictionary<string, long>(StringComparer.Ordinal);
        var commanders = new HashSet<Guid>();
        foreach (var commander in game.MilitaryCommanders)
        {
            commander.Attributes ??= new Dictionary<string, decimal>(StringComparer.Ordinal);
            if (commander.Id == Guid.Empty ||
                !commanders.Add(commander.Id) ||
                !stateIds.Contains(commander.StateId) ||
                string.IsNullOrWhiteSpace(commander.Name) ||
                commander.Attributes.Any(item => string.IsNullOrWhiteSpace(item.Key)))
                throw new InvalidDataException("The saved world contains an invalid military commander.");
        }

        var unitIds = new HashSet<Guid>();
        foreach (var unit in game.MilitaryUnits)
        {
            unit.Equipment ??= new Dictionary<string, long>(StringComparer.Ordinal);
            unit.Supplies ??= new Dictionary<string, long>(StringComparer.Ordinal);
            if (unit.Id == Guid.Empty ||
                !unitIds.Add(unit.Id) ||
                !stateIds.Contains(unit.StateId) ||
                !unitTypes.ContainsKey(unit.UnitTypeId) ||
                !provinces.ContainsKey(unit.ProvinceId) ||
                unit.CommanderId is Guid commanderId &&
                game.MilitaryCommanders.All(item =>
                    item.Id != commanderId || item.StateId != unit.StateId) ||
                unit.Personnel < 0 ||
                unit.Training < 0 ||
                unit.Morale < 0 ||
                unit.Experience < 0 ||
                !Enum.IsDefined(unit.Status) ||
                !HasValidGoods(unit.Equipment, goods) ||
                !HasValidGoods(unit.Supplies, goods))
                throw new InvalidDataException("The saved world contains an invalid military unit.");
        }

        ValidateRoutes(game.MilitaryRoutes.Select(route => new RouteData(
            route.Id, route.OriginProvinceId, route.DestinationProvinceId, route.ProvincePath,
            route.SegmentTravelDays, route.TravelDays, route.Capacity, route.CapacityUnit,
            route.Risk, route.RiskBasis, route.Enabled,
            route.PermittedStateIds, route.DailySupplyConsumption)), game, provinces, goods);
        foreach (var supplyRoute in game.SupplyRoutes)
        {
            supplyRoute.ProvincePath ??= [];
            supplyRoute.SegmentTravelDays ??= [];
        }
        ValidateRoutes(game.SupplyRoutes.Select(route => new RouteData(
            route.Id, route.OriginProvinceId, route.DestinationProvinceId, route.ProvincePath,
            route.SegmentTravelDays, route.TravelDays, route.Capacity, route.CapacityUnit,
            route.Risk, route.RiskBasis, route.Enabled,
            new HashSet<Guid> { route.StateId }, route.DailySupplyConsumption)), game, provinces, goods);

        var orderIds = new HashSet<Guid>();
        foreach (var order in game.MilitaryOrders)
        {
            if (order.Id == Guid.Empty ||
                !orderIds.Add(order.Id) ||
                order.GameId != game.Id ||
                !stateIds.Contains(order.StateId) ||
                !unitIds.Contains(order.UnitId) ||
                !game.Players.Any(player => player.Id == order.IssuerPlayerId) ||
                !Enum.IsDefined(order.Type) ||
                !Enum.IsDefined(order.Status) ||
                order.SubmittedOnWorldDate == default ||
                order.SubmittedOnWorldDate > game.WorldDate ||
                order.TravelDaysRemaining < 0 ||
                order.CurrentPathIndex < 0 ||
                order.DaysToNextProvince < 0 ||
                order.RouteId is Guid routeId && game.MilitaryRoutes.All(item => item.Id != routeId) ||
                order.DestinationProvinceId is Guid destinationId &&
                !provinces.ContainsKey(destinationId))
                throw new InvalidDataException("The saved world contains an invalid military order.");
        }

        var battleIds = new HashSet<Guid>();
        foreach (var battle in game.MilitaryBattles)
        {
            battle.ParticipantUnitIds ??= [];
            battle.CasualtiesByUnit ??= [];
            battle.Phases ??= [];
            if (battle.Id == Guid.Empty ||
                !battleIds.Add(battle.Id) ||
                !provinces.ContainsKey(battle.ProvinceId) ||
                battle.WorldDate == default ||
                battle.WorldDate > game.WorldDate ||
                battle.ParticipantUnitIds.Count < 2 ||
                battle.ParticipantUnitIds.Distinct().Count() != battle.ParticipantUnitIds.Count ||
                battle.ParticipantUnitIds.Any(id => !unitIds.Contains(id)) ||
                battle.CasualtiesByUnit.Any(item =>
                    !battle.ParticipantUnitIds.Contains(item.Key) ||
                    item.Value.Any(casualty =>
                        !Enum.IsDefined(casualty.Key) || casualty.Value < 0)))
                throw new InvalidDataException("The saved world contains an invalid military battle.");
        }

        var occupationIds = new HashSet<Guid>();
        foreach (var occupation in game.Occupations)
        {
            if (occupation.Id == Guid.Empty ||
                !occupationIds.Add(occupation.Id) ||
                !provinces.TryGetValue(occupation.ProvinceId, out var province) ||
                !stateIds.Contains(occupation.OccupyingStateId) ||
                occupation.SovereignStateId != province.SovereignStateId ||
                occupation.StartedOn == default ||
                occupation.StartedOn > game.WorldDate ||
                occupation.OccupyingForce < 0 ||
                occupation.Resistance < 0 ||
                occupation.DurationDays < 0 ||
                occupation.RequiredControlDays < 0 ||
                occupation.ControlEffective &&
                (occupation.RequiredControlDays < 1 ||
                 occupation.DurationDays < occupation.RequiredControlDays ||
                 occupation.OccupyingForce <= occupation.Resistance ||
                 occupation.ControlRecordId is not Guid controlId ||
                 game.TerritorialControls.All(item =>
                     item.Id != controlId ||
                     item.ProvinceId != occupation.ProvinceId ||
                     item.StateId != occupation.OccupyingStateId ||
                     item.Type != TerritorialControlType.Military ||
                     item.EffectiveUntil is not null)) ||
                !occupation.ControlEffective && occupation.ControlRecordId is not null)
                throw new InvalidDataException("The saved world contains an invalid occupation.");
        }
    }

    private static void ValidateRoutes(
        IEnumerable<RouteData> routes,
        WorldState game,
        IReadOnlyDictionary<Guid, Province> provinces,
        IReadOnlySet<string> goods)
    {
        var routeIds = new HashSet<Guid>();
        foreach (var route in routes)
        {
            var path = route.ProvincePath ?? [];
            var segmentTravelDays = route.SegmentTravelDays ?? [];
            if (route.Id == Guid.Empty ||
                !routeIds.Add(route.Id) ||
                !provinces.ContainsKey(route.OriginProvinceId) ||
                !provinces.ContainsKey(route.DestinationProvinceId) ||
                path.Count < 2 ||
                path[0] != route.OriginProvinceId ||
                path[^1] != route.DestinationProvinceId ||
                path.Any(id => !provinces.ContainsKey(id)) ||
                route.Enabled &&
                (route.TravelDays < 1 ||
                 route.Capacity < 1 ||
                 string.IsNullOrWhiteSpace(route.CapacityUnit) ||
                 string.IsNullOrWhiteSpace(route.RiskBasis) ||
                 segmentTravelDays.Count != path.Count - 1 ||
                 segmentTravelDays.Any(days => days < 1) ||
                 segmentTravelDays.Sum(days => (long)days) != route.TravelDays) ||
                route.Risk < 0 ||
                !HasValidGoods(route.DailySupplyConsumption, goods) ||
                route.PermittedStateIds.Any(id => !game.Territories.Any(state => state.StateId == id)))
                throw new InvalidDataException("The saved world contains an invalid military route.");

            for (var index = 1; index < path.Count; index++)
            {
                var previous = path[index - 1];
                var current = path[index];
                if (!game.ProvinceConnections.Any(connection =>
                        connection.FromProvinceId == previous && connection.ToProvinceId == current ||
                        connection.Bidirectional &&
                        connection.FromProvinceId == current && connection.ToProvinceId == previous))
                    throw new InvalidDataException("A military route contains provinces without a configured connection.");
            }
        }
    }

    private static bool HasValidGoods(
        IReadOnlyDictionary<string, long> quantities, IReadOnlySet<string> goods) =>
        quantities.All(item =>
            !string.IsNullOrWhiteSpace(item.Key) && goods.Contains(item.Key) && item.Value >= 0);

    private sealed record RouteData(
        Guid Id,
        Guid OriginProvinceId,
        Guid DestinationProvinceId,
        List<Guid> ProvincePath,
        List<int> SegmentTravelDays,
        int TravelDays,
        long Capacity,
        string CapacityUnit,
        decimal Risk,
        string RiskBasis,
        bool Enabled,
        HashSet<Guid> PermittedStateIds,
        Dictionary<string, long> DailySupplyConsumption);
}
