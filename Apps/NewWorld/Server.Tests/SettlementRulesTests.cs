using NewWorld.Server.Models;
using NewWorld.Server.Services;
using Xunit;

namespace NewWorld.Server.Tests;

public sealed class SettlementRulesTests
{
    [Fact]
    public void TerritoryCapacitiesIncludeCompletedBuildingsButExcludeConstructionSites()
    {
        var territory = new TerritoryState
        {
            Population = 1000,
            BaseHousingCapacity = 1000,
            BaseFoodCapacity = 1000,
            BaseWaterCapacity = 1000,
            BaseHealthCapacity = 200,
            BaseEducationCapacity = 150,
            BaseJobSlots = 350,
            Buildings =
            {
                [150] = GameCatalog.Buildings["housing"],
                [151] = GameCatalog.Buildings["farm"],
                [152] = GameCatalog.Buildings["clinic"] with { DaysRemaining = 2 },
                [153] = GameCatalog.Buildings["road"]
            }
        };

        var metrics = SettlementRules.CalculateMetrics(territory);

        Assert.Equal(2000, metrics.HousingCapacity);
        Assert.Equal(6000, metrics.FoodCapacity);
        Assert.Equal(1000, metrics.WaterCapacity);
        Assert.Equal(1590, metrics.JobCapacity);
        Assert.Equal(200, metrics.HealthCapacity);
        Assert.Equal(150, metrics.EducationCapacity);
        Assert.Equal(620, metrics.WorkingAgePopulation);
        Assert.Equal(620, metrics.AvailableJobs);
        Assert.Equal(4, metrics.BuildingCount);
        Assert.Equal(1, metrics.ConstructionCount);
    }

    [Fact]
    public void ConstructionProgressesDailyAndCapacityOnlyAppearsWhenComplete()
    {
        var territory = new TerritoryState
        {
            StateId = Guid.NewGuid(),
            Index = 0,
            Name = "Test territory",
            Population = 10000,
            BaseHousingCapacity = 10000,
            BaseFoodCapacity = 10000,
            BaseWaterCapacity = 10000,
            BaseJobSlots = 3500,
            Buildings =
            {
                [150] = GameCatalog.Buildings["housing"] with { DaysRemaining = 2 }
            }
        };
        var game = new WorldState { Day = 2, Territories = [territory] };

        var firstDay = SettlementRules.AdvanceDaily(game);
        Assert.Empty(firstDay);
        Assert.Equal(1, territory.Buildings[150].DaysRemaining);
        Assert.Equal(10000, SettlementRules.CalculateMetrics(territory).HousingCapacity);

        var secondDay = SettlementRules.AdvanceDaily(game);
        var completed = Assert.Single(secondDay);
        Assert.Equal("settlement.construction_completed", completed.EventType);
        Assert.Equal(0, territory.Buildings[150].DaysRemaining);
        Assert.Equal(11000, SettlementRules.CalculateMetrics(territory).HousingCapacity);
    }

    [Fact]
    public void UnderConstructionBuildingsDoNotEarnIncomeOrChargeMaintenance()
    {
        var player = new PlayerState { Id = Guid.NewGuid(), LegacyCountryIndex = 0 };
        var stateId = Guid.NewGuid();
        var territory = new TerritoryState
        {
            StateId = stateId,
            Index = 0,
            Buildings =
            {
                [150] = GameCatalog.Buildings["workshop"] with { DaysRemaining = 2 },
                [151] = GameCatalog.Buildings["road"]
            }
        };
        var game = new WorldState
        {
            Players = [player],
            Territories = [territory],
            Memberships = [new GovernmentMembership { PlayerId = player.Id, StateId = stateId }]
        };

        var duringConstruction = SimulationRules.CalculateGovernmentBalance(game, territory);
        Assert.Equal(85, duringConstruction.CityIncome);
        Assert.Equal(1, duringConstruction.Upkeep);

        territory.Buildings[150] = territory.Buildings[150] with { DaysRemaining = 0 };
        var afterCompletion = SimulationRules.CalculateGovernmentBalance(game, territory);
        Assert.Equal(137, afterCompletion.CityIncome);
        Assert.Equal(6, afterCompletion.Upkeep);
    }

    [Fact]
    public void SnapshotPublishesTerritorySpecificBuildingsAndSettlementCapacity()
    {
        var territory = new TerritoryState
        {
            StateId = Guid.NewGuid(),
            Index = 0,
            Name = "Settlement",
            Population = 1200,
            BaseHousingCapacity = 1200,
            BaseFoodCapacity = 1200,
            BaseWaterCapacity = 1200,
            BaseJobSlots = 420,
            Buildings =
            {
                [150] = GameCatalog.Buildings["housing"],
                [151] = GameCatalog.Buildings["road"] with { DaysRemaining = 1 }
            }
        };
        var game = new WorldState { Territories = [territory] };
        WorldStateCompatibility.Normalize(game);

        var snapshot = GameHub.BuildSnapshot(game, new HashSet<Guid>());
        var view = Assert.Single(snapshot.Territories);

        Assert.Contains(150, view.Buildings!.Keys);
        Assert.Contains(151, view.Buildings.Keys);
        Assert.Equal(420, view.AvailableJobs);
        Assert.Equal(2200, view.HousingCapacity);
        Assert.Equal(1200, view.FoodCapacity);
        Assert.Equal(1200, view.WaterCapacity);
        Assert.Equal(2, view.BuildingCount);
        Assert.Equal(1, view.ConstructionCount);
    }

    [Fact]
    public void PopulationGrowthRequiresSpareHousingFoodAndWaterCapacity()
    {
        var territory = new TerritoryState
        {
            StateId = Guid.NewGuid(),
            Population = 10000,
            Prosperity = 75,
            BaseHousingCapacity = 11000,
            BaseFoodCapacity = 11000,
            BaseWaterCapacity = 10000,
            BaseJobSlots = 10000,
            BaseHealthCapacity = 10000,
            BaseEducationCapacity = 10000
        };
        var game = new WorldState { Day = 1, Territories = [territory] };

        Assert.Empty(SettlementRules.AdvanceDaily(game));

        Assert.Equal(10000, territory.Population);
        Assert.Equal(0, territory.LastPopulationGrowth);
        Assert.Equal(0, territory.PopulationGrowthRemainder);
    }

    [Fact]
    public void PopulationGrowsWithinEssentialCapacityAndScalesConsumptionGroups()
    {
        var stateId = Guid.NewGuid();
        var territory = new TerritoryState
        {
            StateId = stateId,
            Population = 10000,
            Prosperity = 50,
            BaseHousingCapacity = 10001,
            BaseFoodCapacity = 10001,
            BaseWaterCapacity = 10001,
            BaseJobSlots = 10000,
            BaseHealthCapacity = 10000,
            BaseEducationCapacity = 10000
        };
        var game = new WorldState
        {
            Day = 1,
            Territories = [territory],
            PopulationGroups =
            [
                new PopulationGroup { Id = Guid.NewGuid(), StateId = stateId, Name = "Urban households", Population = 6000,
                    Needs = [new PopulationNeed { GoodId = "food", DailyQuantityPerThousandPeople = 1 }] },
                new PopulationGroup { Id = Guid.NewGuid(), StateId = stateId, Name = "Rural households", Population = 4000,
                    Needs = [new PopulationNeed { GoodId = "food", DailyQuantityPerThousandPeople = 1 }] }
            ]
        };

        var results = SettlementRules.AdvanceDaily(game);

        Assert.Equal(10001, territory.Population);
        Assert.Equal(1, territory.LastPopulationGrowth);
        Assert.Contains(results, item => item.EventType == "settlement.population_growth");
        Assert.Equal(6001, game.PopulationGroups[0].Population);
        Assert.Equal(4000, game.PopulationGroups[1].Population);
    }

    [Fact]
    public void PopulationDoesNotExceedTheMostConstrainedEssentialCapacity()
    {
        var territory = new TerritoryState
        {
            Population = 9999,
            Prosperity = 100,
            BaseHousingCapacity = 12000,
            BaseFoodCapacity = 12000,
            BaseWaterCapacity = 10000,
            BaseJobSlots = 12000,
            BaseHealthCapacity = 12000,
            BaseEducationCapacity = 12000,
            PopulationGrowthRemainder = 9999
        };
        var game = new WorldState { Day = 1, Territories = [territory] };

        SettlementRules.AdvanceDaily(game);

        Assert.Equal(10000, territory.Population);
        Assert.Equal(1, territory.LastPopulationGrowth);
    }

    [Fact]
    public void ConstructionValidationRejectsWaterAndTracksTheSameCoordinatesPerTerritory()
    {
        var firstTerritory = new TerritoryState { Index = 0 };
        var secondTerritory = new TerritoryState { Index = 1 };

        var waterError = SettlementRules.ValidateConstruction(
            firstTerritory, 144, "housing", out _, out _);
        Assert.Equal("INVALID_TERRAIN", waterError);

        var accepted = SettlementRules.ValidateConstruction(
            firstTerritory, 150, "housing", out var firstPlot, out var firstBuilding);
        Assert.Null(accepted);
        Assert.Equal(150, firstPlot);
        Assert.Equal("housing", firstBuilding!.Id);

        firstTerritory.Buildings.Add(firstPlot, firstBuilding);
        Assert.Equal("TARGET_UNAVAILABLE", SettlementRules.ValidateConstruction(
            firstTerritory, 150, "farm", out _, out _));

        Assert.Null(SettlementRules.ValidateConstruction(
            secondTerritory, 144, "waterworks", out var secondPlot, out _));
        Assert.Equal(144, secondPlot);
    }

    [Fact]
    public void ServerTerrainMatchesTheBrowserWaterAndDryLandAtKnownCoordinates()
    {
        Assert.False(SettlementRules.IsBuildableLand(0, 144)); // row 0, col 0 is water.
        Assert.True(SettlementRules.IsBuildableLand(0, 150)); // row 0, col 6 is dry land.
        Assert.True(SettlementRules.IsBuildableLand(1, 144)); // Region one has a different seed.
        Assert.False(SettlementRules.IsBuildableLand(0, -1));
    }
}
