using NewWorld.Server.Models;
using NewWorld.Server.Services;

namespace NewWorld.Server.Tests;

public sealed class EconomySetupRulesTests
{
    [Fact]
    public void ConfigureReplacesTheLobbyEconomyAndNormalizesCurrencyAccounts()
    {
        var (game, company, market) = CreateWorld();
        var request = new EconomyScenarioRequest(
            game.WorldVersion,
            game.Goods,
            game.ProductionRecipes,
            [company],
            [market],
            []);

        var error = EconomySetupRules.Configure(game, request);

        Assert.Null(error);
        Assert.Equal(3, game.EconomyVersion);
        Assert.Equal(game.Territories[0].CurrencyId, Assert.Single(game.Companies).CurrencyId);
        Assert.Equal(250, Assert.Single(game.Companies).CashBalances[game.Territories[0].CurrencyId]);
        Assert.Single(game.Markets);
        var openingBalance = Assert.Single(game.CompanyFinancialTransactions);
        Assert.Equal(CompanyTransactionType.OpeningBalance, openingBalance.Type);
        Assert.Equal(250, openingBalance.BalanceAfter);
        WorldStateCompatibility.Normalize(game);
    }

    [Fact]
    public void ConfigureRejectsStartedStaleAndInvalidScenariosWithoutChangingWorld()
    {
        var (game, company, market) = CreateWorld();
        var request = new EconomyScenarioRequest(
            game.WorldVersion,
            game.Goods,
            game.ProductionRecipes,
            [company],
            [market],
            []);

        game.WorldVersion++;
        Assert.Contains("world changed", EconomySetupRules.Configure(game, request));
        Assert.Empty(game.Companies);

        request = request with { ExpectedWorldVersion = game.WorldVersion };
        game.Started = true;
        Assert.Contains("locked", EconomySetupRules.Configure(game, request));
        game.Started = false;

        market.MinimumPrice = 0;
        request = request with { Markets = [market] };
        Assert.Contains("Invalid economic scenario", EconomySetupRules.Configure(game, request));
        Assert.Empty(game.Companies);
    }

    private static (WorldState Game, EconomicCompany Company, EconomicMarket Market) CreateWorld()
    {
        var stateId = Guid.NewGuid();
        var territory = new TerritoryState { StateId = stateId, Index = 0, Name = "Test State" };
        var game = new WorldState
        {
            Id = Guid.NewGuid(),
            WorldDate = new DateOnly(1500, 1, 1),
            Territories = [territory],
            Goods =
            [
                new EconomicGood
                {
                    Id = "grain",
                    Name = "Grain",
                    Unit = "tonne",
                    Category = EconomicGoodCategory.Consumer
                }
            ],
            EconomyVersion = 3
        };
        WorldStateCompatibility.Normalize(game);
        var company = new EconomicCompany
        {
            Id = Guid.NewGuid(),
            StateId = stateId,
            CurrencyId = territory.CurrencyId,
            Name = "Test Company",
            Sector = "Test",
            CashBalances = new Dictionary<Guid, long> { [territory.CurrencyId] = 250 },
            Inventory = new Dictionary<string, long> { ["grain"] = 0 }
        };
        var market = new EconomicMarket
        {
            StateId = stateId,
            GoodId = "grain",
            DailyDemand = 1,
            DailyConsumerBudget = 10,
            BasePrice = 10,
            CurrentPrice = 10,
            MinimumPrice = 1,
            MaximumPrice = 100
        };
        return (game, company, market);
    }
}
