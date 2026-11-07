using System.Numerics;
using NewWorld.Server.Models;

namespace NewWorld.Server.Services;

public sealed record SettlementMetrics(
    long HousingCapacity,
    long FoodCapacity,
    long WaterCapacity,
    long JobCapacity,
    long WorkingAgePopulation,
    long AvailableJobs,
    long HealthCapacity,
    long EducationCapacity,
    int BuildingCount,
    int ConstructionCount);

public sealed record SettlementEvent(Guid StateId, string EventType, string Description);

public static class SettlementRules
{
    private const int GrowthDenominator = 10_000;
    private const int ProsperityPeriodDays = 30;

    public static SettlementMetrics CalculateMetrics(TerritoryState territory)
    {
        ArgumentNullException.ThrowIfNull(territory);
        var completed = territory.Buildings.Values.Where(building => building.DaysRemaining == 0).ToArray();
        var housing = SumCapacity(territory.BaseHousingCapacity, completed, building => building.HousingCapacity);
        var food = SumCapacity(territory.BaseFoodCapacity, completed, building => building.FoodCapacity);
        var water = SumCapacity(territory.BaseWaterCapacity, completed, building => building.WaterCapacity);
        var jobs = SumCapacity(territory.BaseJobSlots, completed, building => building.JobSlots);
        var health = SumCapacity(territory.BaseHealthCapacity, completed, building => building.HealthCapacity);
        var education = SumCapacity(territory.BaseEducationCapacity, completed, building => building.EducationCapacity);
        var workingAge = Math.Max(0L, (long)territory.Population * 62 / 100);
        return new SettlementMetrics(
            housing, food, water, jobs, workingAge, Math.Min(workingAge, jobs), health, education,
            territory.Buildings.Count, territory.Buildings.Values.Count(building => building.DaysRemaining > 0));
    }

    private static long SumCapacity(
        int baseCapacity, IEnumerable<BuildingState> buildings, Func<BuildingState, int> selector) =>
        Math.Max(0, baseCapacity) + buildings.Sum(building => (long)Math.Max(0, selector(building)));

    public static bool IsBuildableLand(int territoryIndex, int? constructionPlotIndex)
    {
        if (!GameCatalog.IsValidConstructionPlotIndex(constructionPlotIndex))
            return false;
        var plot = GameCatalog.NormalizeConstructionPlotIndex(constructionPlotIndex!.Value);
        var worldIndex = plot - GameCatalog.LegacyConstructionPlotCount;
        if (worldIndex < 0 || worldIndex >= GameCatalog.WorldMapSize * GameCatalog.WorldMapSize)
            return false;
        var row = worldIndex / GameCatalog.WorldMapSize;
        var col = worldIndex % GameCatalog.WorldMapSize;
        var moisture = ValueNoise(row, col, 23, 17, territoryIndex);
        var elevation = ValueNoise(row, col, 37, 31, territoryIndex);
        return !(elevation < 0.105 && moisture > 0.77);
    }

    public static string? ValidateConstruction(
        TerritoryState territory,
        int? constructionPlotIndex,
        string? buildingId,
        out int normalizedPlotIndex,
        out BuildingState? building)
    {
        ArgumentNullException.ThrowIfNull(territory);
        normalizedPlotIndex = -1;
        building = null;
        if (!GameCatalog.IsValidConstructionPlotIndex(constructionPlotIndex) ||
            string.IsNullOrWhiteSpace(buildingId) ||
            !GameCatalog.Buildings.TryGetValue(buildingId, out building))
            return "INVALID_PAYLOAD";
        normalizedPlotIndex = GameCatalog.NormalizeConstructionPlotIndex(constructionPlotIndex!.Value);
        if (!IsBuildableLand(territory.Index, normalizedPlotIndex))
            return "INVALID_TERRAIN";
        if (territory.Buildings.ContainsKey(normalizedPlotIndex))
            return "TARGET_UNAVAILABLE";
        return null;
    }

    private static double ValueNoise(int row, int col, int scale, int salt, int regionIndex)
    {
        var x = (double)row / scale;
        var y = (double)col / scale;
        var x0 = (int)Math.Floor(x);
        var y0 = (int)Math.Floor(y);
        var tx = Smooth(x - x0);
        var ty = Smooth(y - y0);
        var a = Lerp(Hash(x0, y0, salt, regionIndex), Hash(x0 + 1, y0, salt, regionIndex), tx);
        var b = Lerp(Hash(x0, y0 + 1, salt, regionIndex), Hash(x0 + 1, y0 + 1, salt, regionIndex), tx);
        return Lerp(a, b, ty);
    }

    private static double Hash(int row, int col, int salt, int regionIndex)
    {
        unchecked
        {
            var value = (row + 1) * 374761393 ^
                        (col + 1) * 668265263 ^
                        (regionIndex + salt + 1) * 1442695041;
            value = (value ^ (int)((uint)value >> 13)) * 1274126177;
            value = (value ^ (int)((uint)value >> 16)) * -2048144777;
            return (uint)(value ^ (int)((uint)value >> 13)) / 4294967296d;
        }
    }

    private static double Smooth(double value) => value * value * (3 - 2 * value);
    private static double Lerp(double from, double to, double amount) => from + (to - from) * amount;

    public static IReadOnlyList<SettlementEvent> AdvanceDaily(WorldState game)
    {
        ArgumentNullException.ThrowIfNull(game);
        var events = new List<SettlementEvent>();
        foreach (var territory in game.Territories.OrderBy(item => item.Index))
        {
            foreach (var (plotIndex, building) in territory.Buildings.ToArray())
            {
                if (building.DaysRemaining <= 0)
                    continue;
                var remaining = building.DaysRemaining - 1;
                territory.Buildings[plotIndex] = building with { DaysRemaining = remaining };
                if (remaining == 0)
                    events.Add(new SettlementEvent(
                        territory.StateId,
                        "settlement.construction_completed",
                        $"{building.Name} completed in {territory.Name} at plot {plotIndex}."));
            }

            var metrics = CalculateMetrics(territory);
            var essentialCapacity = Math.Min(metrics.HousingCapacity,
                Math.Min(metrics.FoodCapacity, metrics.WaterCapacity));
            var availablePlaces = Math.Max(0L, essentialCapacity - territory.Population);
            territory.LastPopulationGrowth = 0;
            if (availablePlaces > 0 && territory.Population > 0)
            {
                var rate = 2 + Math.Clamp(territory.Prosperity, 0, 100) / 25;
                if (metrics.WorkingAgePopulation > 0 &&
                    metrics.AvailableJobs * 100 >= metrics.WorkingAgePopulation * 70)
                    rate += 2;
                if (metrics.HealthCapacity * 100 >= (long)territory.Population * 50)
                    rate++;
                if (metrics.EducationCapacity * 100 >= (long)territory.Population * 50)
                    rate++;
                rate = Math.Min(rate, 10);
                var accumulated = (long)territory.Population * rate + territory.PopulationGrowthRemainder;
                var populationHeadroom = Math.Max(0L, int.MaxValue - (long)territory.Population);
                var growth = Math.Min(availablePlaces, Math.Min(populationHeadroom, accumulated / GrowthDenominator));
                territory.PopulationGrowthRemainder = (int)(accumulated % GrowthDenominator);
                if (growth > 0)
                {
                    var previousPopulation = territory.Population;
                    territory.Population = checked(previousPopulation + (int)growth);
                    territory.LastPopulationGrowth = (int)growth;
                    ScalePopulationGroups(game, territory.StateId, previousPopulation, territory.Population);
                    events.Add(new SettlementEvent(
                        territory.StateId,
                        "settlement.population_growth",
                        $"{territory.Name} gained {growth:N0} residents; population is now {territory.Population:N0}."));
                }
            }
            else if (availablePlaces == 0)
            {
                territory.PopulationGrowthRemainder = 0;
            }

            if (game.Day % ProsperityPeriodDays == 0)
                UpdateProsperity(territory, CalculateMetrics(territory));
        }
        return events;
    }

    private static void ScalePopulationGroups(WorldState game, Guid stateId, int oldPopulation, int newPopulation)
    {
        var groups = game.PopulationGroups.Where(group => group.StateId == stateId).ToArray();
        if (groups.Length == 0 || oldPopulation <= 0)
            return;
        foreach (var group in groups)
        {
            var scaled = ((BigInteger)group.Population * newPopulation + oldPopulation / 2) / oldPopulation;
            group.Population = scaled > long.MaxValue ? long.MaxValue : (long)scaled;
        }
    }

    private static void UpdateProsperity(TerritoryState territory, SettlementMetrics metrics)
    {
        var essentialsCovered = metrics.HousingCapacity >= territory.Population &&
                                metrics.FoodCapacity >= territory.Population &&
                                metrics.WaterCapacity >= territory.Population;
        var jobCoverageHealthy = metrics.WorkingAgePopulation == 0 ||
                                metrics.AvailableJobs * 100 >= metrics.WorkingAgePopulation * 45;
        var servicesDeveloped = metrics.HealthCapacity * 100 >= (long)territory.Population * 40 &&
                                metrics.EducationCapacity * 100 >= (long)territory.Population * 40;
        if (!essentialsCovered || !jobCoverageHealthy)
            territory.Prosperity = Math.Max(0, territory.Prosperity - 1);
        else if (servicesDeveloped && metrics.AvailableJobs * 100 >= metrics.WorkingAgePopulation * 65)
            territory.Prosperity = Math.Min(100, territory.Prosperity + 1);
    }
}
