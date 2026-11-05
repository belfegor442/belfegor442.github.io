using NewWorld.Server.Models;
using NewWorld.Server.Services;

namespace NewWorld.Server.Tests;

public sealed class EconomyRulesTests
{
    [Fact]
    public void ProductionConsumesInputsAndCreatesOutputsOnlyAfterConfiguredDuration()
    {
        var (game, company, facility) = CreateProductionWorld(
            daysPerBatch: 2,
            batchesPerCycle: 2,
            inputStock: 9);

        var firstDay = EconomyRules.AdvanceDailyProduction(game);

        Assert.Null(firstDay.Error);
        Assert.Empty(firstDay.Results);
        Assert.Equal(1, facility.ProgressDays);
        Assert.Equal(9L, company.Inventory["grain"]);

        var secondDay = EconomyRules.AdvanceDailyProduction(game);

        Assert.Null(secondDay.Error);
        var result = Assert.Single(secondDay.Results);
        Assert.Equal(2, result.Batches);
        Assert.Equal(6L, result.InputsConsumed["grain"]);
        Assert.Equal(4L, result.OutputsProduced["flour"]);
        Assert.Equal(3L, company.Inventory["grain"]);
        Assert.Equal(4L, company.Inventory["flour"]);
        Assert.Equal(0, facility.ProgressDays);
    }

    [Fact]
    public void ProductionScalesDownToAvailableInputs()
    {
        var (game, company, _) = CreateProductionWorld(
            daysPerBatch: 1,
            batchesPerCycle: 5,
            inputStock: 7);

        var result = Assert.Single(EconomyRules.AdvanceDailyProduction(game).Results);

        Assert.Equal(2, result.Batches);
        Assert.Equal(1L, company.Inventory["grain"]);
        Assert.Equal(4L, company.Inventory["flour"]);
    }

    [Fact]
    public void ProductionRespectsConfiguredStorageCapacityWithoutConsumingInputs()
    {
        var (game, company, facility) = CreateProductionWorld(
            daysPerBatch: 1,
            batchesPerCycle: 5,
            inputStock: 9);
        game.Goods.Single(good => good.Id == "flour").StorageCapacity = 3;

        var firstDay = EconomyRules.AdvanceDailyProduction(game);

        Assert.Null(firstDay.Error);
        Assert.Equal(1, Assert.Single(firstDay.Results).Batches);
        Assert.Equal(6L, company.Inventory["grain"]);
        Assert.Equal(2L, company.Inventory["flour"]);

        var blockedDay = EconomyRules.AdvanceDailyProduction(game);

        Assert.Null(blockedDay.Error);
        Assert.Empty(blockedDay.Results);
        Assert.Equal(6L, company.Inventory["grain"]);
        Assert.Equal(2L, company.Inventory["flour"]);
        Assert.Equal(0, facility.ProgressDays);
    }

    [Fact]
    public void NormalizeRejectsGoodsWithInvalidOrExceededStorageCapacity()
    {
        var (game, company, _) = CreateProductionWorld(
            daysPerBatch: 1,
            batchesPerCycle: 1,
            inputStock: 3);
        game.Goods.Single(good => good.Id == "grain").StorageCapacity = 0;

        Assert.Throws<InvalidDataException>(() => WorldStateCompatibility.Normalize(game));

        game.Goods.Single(good => good.Id == "grain").StorageCapacity = 2;
        Assert.Throws<InvalidDataException>(() => WorldStateCompatibility.Normalize(game));

        game.Goods.Single(good => good.Id == "grain").StorageCapacity = 3;
        WorldStateCompatibility.Normalize(game);
        Assert.Equal(3L, company.Inventory["grain"]);
    }

    [Fact]
    public void FacilityDoesNotAdvanceWhenRequiredInputsAreUnavailable()
    {
        var (game, company, facility) = CreateProductionWorld(
            daysPerBatch: 3,
            batchesPerCycle: 1,
            inputStock: 2,
            progressDays: 1);

        var result = EconomyRules.AdvanceDailyProduction(game);

        Assert.Null(result.Error);
        Assert.Empty(result.Results);
        Assert.Equal(1, facility.ProgressDays);
        Assert.Equal(2L, company.Inventory["grain"]);
        Assert.Equal(0L, company.Inventory["flour"]);
    }

    [Fact]
    public void InventoryOverflowRejectsTheWholeProductionCycle()
    {
        var (game, company, facility) = CreateProductionWorld(
            daysPerBatch: 1,
            batchesPerCycle: 1,
            inputStock: 3);
        company.Inventory["flour"] = long.MaxValue - 1;

        var result = EconomyRules.AdvanceDailyProduction(game);

        Assert.Equal("Production would exceed the supported inventory limit.", result.Error);
        Assert.Equal(3L, company.Inventory["grain"]);
        Assert.Equal(long.MaxValue - 1, company.Inventory["flour"]);
        Assert.Equal(0, facility.ProgressDays);
    }

    [Fact]
    public void SnapshotExposesConfiguredCompaniesAndProductionFacilities()
    {
        var (game, company, _) = CreateProductionWorld(
            daysPerBatch: 2,
            batchesPerCycle: 1,
            inputStock: 3);

        var savedGame = WorldStateCompatibility.Clone(game);
        var snapshot = GameHub.BuildSnapshot(savedGame, new HashSet<Guid>());
        var companyView = Assert.Single(snapshot.Companies);

        Assert.Equal(company.Id, companyView.Id);
        Assert.Equal(3L, companyView.Inventory["grain"]);
        var facilityView = Assert.Single(companyView.Facilities);
        Assert.Equal("Mill flour", facilityView.RecipeName);
        Assert.Equal(2, facilityView.DaysPerBatch);
    }

    private static (WorldState Game, EconomicCompany Company, ProductionFacility Facility)
        CreateProductionWorld(int daysPerBatch, int batchesPerCycle, long inputStock, int progressDays = 0)
    {
        var stateId = Guid.NewGuid();
        var company = new EconomicCompany
        {
            Id = Guid.NewGuid(),
            StateId = stateId,
            Name = "Test Mill",
            Sector = "Food processing",
            Inventory = new Dictionary<string, long>
            {
                ["grain"] = inputStock,
                ["flour"] = 0
            }
        };
        var facility = new ProductionFacility
        {
            Id = Guid.NewGuid(),
            RecipeId = "mill-flour",
            BatchesPerCycle = batchesPerCycle,
            ProgressDays = progressDays
        };
        company.Facilities.Add(facility);
        var game = new WorldState
        {
            Id = Guid.NewGuid(),
            WorldDate = new DateOnly(1500, 1, 1),
            Territories = [new TerritoryState { StateId = stateId, Index = 0, Name = "State" }],
            Goods =
            [
                new EconomicGood { Id = "grain", Name = "Grain", Unit = "tonne", Category = EconomicGoodCategory.Resource },
                new EconomicGood { Id = "flour", Name = "Flour", Unit = "tonne", Category = EconomicGoodCategory.Intermediate }
            ],
            ProductionRecipes =
            [
                new ProductionRecipe
                {
                    Id = "mill-flour",
                    Name = "Mill flour",
                    DaysPerBatch = daysPerBatch,
                    Inputs = new Dictionary<string, long> { ["grain"] = 3 },
                    Outputs = new Dictionary<string, long> { ["flour"] = 2 }
                }
            ],
            Companies = [company]
        };
        return (game, company, facility);
    }
}
