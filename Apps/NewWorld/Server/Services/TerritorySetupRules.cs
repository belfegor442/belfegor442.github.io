using NewWorld.Server.Models;

namespace NewWorld.Server.Services;

public static class TerritorySetupRules
{
    public static string? Configure(WorldState game, TerritoryScenarioRequest request)
    {
        if (game.Started)
            return "Territorial scenario data is locked after the world starts.";
        if (game.MapGeometryVersion != MapGeometryCatalog.MapVersion)
            return "The saved world uses a different map geometry version than this server.";
        if (request.ExpectedWorldVersion != game.WorldVersion)
            return "The world changed. Reload it before configuring territorial data.";
        if (request.Provinces is null ||
            request.Settlements is null ||
            request.Connections is null ||
            request.Controls is null ||
            request.SovereigntyHistory is null)
            return "All territorial scenario collections are required; use empty arrays for unused systems.";
        if (request.Provinces.Any(item => item is null) ||
            request.Settlements.Any(item => item is null) ||
            request.Connections.Any(item => item is null) ||
            request.Controls.Any(item => item is null) ||
            request.SovereigntyHistory.Any(item => item is null))
            return "Territorial scenario collections cannot contain null entries.";
        if (request.Provinces.Count > 100_000 ||
            request.Settlements.Count > 100_000 ||
            request.Connections.Count > 500_000 ||
            request.Controls.Count > 500_000 ||
            request.SovereigntyHistory.Count > 500_000)
            return "The territorial scenario exceeds a supported collection limit.";

        var candidate = WorldStateCompatibility.Clone(game);
        candidate.Provinces = request.Provinces.ToList();
        candidate.Settlements = request.Settlements.ToList();
        candidate.ProvinceConnections = request.Connections.ToList();
        candidate.TerritorialControls = request.Controls.ToList();
        candidate.SovereigntyHistory = request.SovereigntyHistory.ToList();
        try
        {
            WorldStateCompatibility.Normalize(candidate);
        }
        catch (InvalidDataException exception)
        {
            return $"Invalid territorial scenario: {exception.Message}";
        }

        game.Provinces = candidate.Provinces;
        game.Settlements = candidate.Settlements;
        game.ProvinceConnections = candidate.ProvinceConnections;
        game.TerritorialControls = candidate.TerritorialControls;
        game.SovereigntyHistory = candidate.SovereigntyHistory;
        GameStore.AddActivity(game, "The host configured territorial data before the world started.");
        return null;
    }

    public static void Validate(WorldState game)
    {
        var stateIds = game.Territories.Select(item => item.StateId).ToHashSet();
        var provinceIds = new HashSet<Guid>();
        var geometryIds = new HashSet<string>(StringComparer.Ordinal);
        foreach (var province in game.Provinces)
        {
            province.Resources ??= new Dictionary<string, long>(StringComparer.Ordinal);
            province.Infrastructure ??= new Dictionary<string, long>(StringComparer.Ordinal);
            if (province.Id == Guid.Empty ||
                !provinceIds.Add(province.Id) ||
                !stateIds.Contains(province.SovereignStateId) ||
                string.IsNullOrWhiteSpace(province.Name) ||
                string.IsNullOrWhiteSpace(province.SvgElementId) ||
                !MapGeometryCatalog.Contains(province.SvgElementId) ||
                !geometryIds.Add(province.SvgElementId) ||
                province.Population < 0 ||
                province.Resources.Any(item => string.IsNullOrWhiteSpace(item.Key) || item.Value < 0) ||
                province.Infrastructure.Any(item => string.IsNullOrWhiteSpace(item.Key) || item.Value < 0))
                throw new InvalidDataException("The saved world contains an invalid province or SVG mapping.");
        }

        var settlementIds = new HashSet<Guid>();
        foreach (var settlement in game.Settlements)
        {
            settlement.Infrastructure ??= new Dictionary<string, long>(StringComparer.Ordinal);
            settlement.Services ??= new Dictionary<string, long>(StringComparer.Ordinal);
            settlement.Buildings ??= new Dictionary<string, long>(StringComparer.Ordinal);
            if (settlement.Id == Guid.Empty ||
                !settlementIds.Add(settlement.Id) ||
                !provinceIds.Contains(settlement.ProvinceId) ||
                string.IsNullOrWhiteSpace(settlement.Name) ||
                string.IsNullOrWhiteSpace(settlement.Type) ||
                settlement.Population < 0 ||
                HasInvalidValues(settlement.Infrastructure) ||
                HasInvalidValues(settlement.Services) ||
                HasInvalidValues(settlement.Buildings))
                throw new InvalidDataException("The saved world contains an invalid settlement.");
        }

        foreach (var province in game.Provinces)
        {
            if (province.CapitalSettlementId is Guid capitalId &&
                game.Settlements.All(item =>
                    item.Id != capitalId || item.ProvinceId != province.Id))
                throw new InvalidDataException("A province capital must be a settlement in that province.");
        }

        var connectionIds = new HashSet<Guid>();
        var connectionKeys = new HashSet<(Guid From, Guid To, GeographicConnectionType Type)>();
        foreach (var connection in game.ProvinceConnections)
        {
            connection.RestrictedToStateIds ??= [];
            var key = (connection.FromProvinceId, connection.ToProvinceId, connection.Type);
            var reverseKey = (connection.ToProvinceId, connection.FromProvinceId, connection.Type);
            if (connection.Id == Guid.Empty ||
                !connectionIds.Add(connection.Id) ||
                connection.FromProvinceId == connection.ToProvinceId ||
                !provinceIds.Contains(connection.FromProvinceId) ||
                !provinceIds.Contains(connection.ToProvinceId) ||
                !Enum.IsDefined(connection.Type) ||
                connection.AbstractDistance <= 0 ||
                connection.RestrictedToStateIds.Any(id => !stateIds.Contains(id)) ||
                !connectionKeys.Add(key) ||
                connection.Bidirectional && connectionKeys.Contains(reverseKey))
                throw new InvalidDataException("The saved world contains an invalid province connection.");
        }

        var controlIds = new HashSet<Guid>();
        foreach (var control in game.TerritorialControls)
        {
            if (control.Id == Guid.Empty ||
                !controlIds.Add(control.Id) ||
                !provinceIds.Contains(control.ProvinceId) ||
                !stateIds.Contains(control.StateId) ||
                !Enum.IsDefined(control.Type) ||
                control.EffectiveFrom == default ||
                control.EffectiveFrom > game.WorldDate ||
                control.EffectiveUntil is DateOnly effectiveUntil &&
                (effectiveUntil < control.EffectiveFrom || effectiveUntil > game.WorldDate) ||
                string.IsNullOrWhiteSpace(control.Cause))
                throw new InvalidDataException("The saved world contains an invalid territorial control record.");
        }

        var historyIds = new HashSet<Guid>();
        foreach (var entry in game.SovereigntyHistory)
        {
            if (entry.Id == Guid.Empty ||
                !historyIds.Add(entry.Id) ||
                !provinceIds.Contains(entry.ProvinceId) ||
                !stateIds.Contains(entry.NewStateId) ||
                entry.PreviousStateId is Guid previousId &&
                (!stateIds.Contains(previousId) || previousId == entry.NewStateId) ||
                entry.EffectiveOn == default ||
                entry.EffectiveOn > game.WorldDate ||
                string.IsNullOrWhiteSpace(entry.LegalMechanism) ||
                entry.CausalEventId is Guid eventId &&
                game.Events.All(worldEvent => worldEvent.Id != eventId))
                throw new InvalidDataException("The saved world contains an invalid sovereignty history entry.");
        }

        foreach (var provinceGroup in game.SovereigntyHistory
            .GroupBy(item => item.ProvinceId))
        {
            var latest = provinceGroup.OrderBy(item => item.EffectiveOn).Last();
            if (game.Provinces.Single(item => item.Id == provinceGroup.Key).SovereignStateId !=
                latest.NewStateId)
                throw new InvalidDataException("Province sovereignty does not match its latest history entry.");
        }
    }

    private static bool HasInvalidValues(IReadOnlyDictionary<string, long> values) =>
        values.Any(item => string.IsNullOrWhiteSpace(item.Key) || item.Value < 0);
}
