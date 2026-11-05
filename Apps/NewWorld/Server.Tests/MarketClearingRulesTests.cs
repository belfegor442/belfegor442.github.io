using NewWorld.Server.Models;
using NewWorld.Server.Services;

namespace NewWorld.Server.Tests;

public sealed class MarketClearingRulesTests
{
    [Fact]
    public void DomesticMarketClearsSalesAndPricesReactToSupply()
    {
        var (game, company, market) = CreateMarketWorld();
        company.Inventory["flour"] = 8;
        market.DailyDemand = 6;
        market.DailyConsumerBudget = 60;

        var firstDay = MarketClearingRules.ClearDailyMarkets(game);

        Assert.Null(firstDay.Error);
        var firstSettlement = Assert.Single(firstDay.Settlements);
        Assert.Equal(8, firstSettlement.DomesticSupply);
        Assert.Equal(0, firstSettlement.ImportedSupply);
        Assert.Equal(6, firstSettlement.QuantitySold);
        Assert.Equal(0, firstSettlement.UnmetDemand);
        Assert.Equal(10, firstSettlement.PriceBefore);
        Assert.Equal(7, firstSettlement.PriceAfter);
        Assert.Equal(42, firstSettlement.ConsumerSpending);
        Assert.Equal(2, company.Inventory["flour"]);
        Assert.Equal(42, company.CashBalances[company.CurrencyId]);

        game.WorldDate = game.WorldDate.AddDays(1);
        var secondDay = MarketClearingRules.ClearDailyMarkets(game);
        var secondSettlement = Assert.Single(secondDay.Settlements);

        Assert.Equal(2, secondSettlement.DomesticSupply);
        Assert.Equal(2, secondSettlement.QuantitySold);
        Assert.Equal(4, secondSettlement.UnmetDemand);
        Assert.Equal(30, secondSettlement.PriceAfter);
        Assert.Equal(102, company.CashBalances[company.CurrencyId]);
        Assert.Equal(2, game.CompanyFinancialTransactions.Count);
        Assert.Equal(2, game.MarketHistory.Count);
        WorldStateCompatibility.Normalize(game);
        var snapshot = GameHub.BuildSnapshot(game, new HashSet<Guid>());
        Assert.Equal(6, Assert.Single(snapshot.Markets).DailyDemand);
        Assert.Equal(2, snapshot.CompanyFinancialTransactions.Count);
        Assert.Equal(2, snapshot.MarketHistory.Count);
    }

    [Fact]
    public void TradeRouteMovesGoodsAndPaysExporterInImportingStateCurrency()
    {
        var (game, exporter, importingMarket) = CreateMarketWorld();
        var importingState = Guid.NewGuid();
        game.Territories.Add(new TerritoryState
        {
            StateId = importingState,
            Index = 1,
            Name = "Importing State"
        });
        importingMarket.StateId = importingState;
        importingMarket.DailyDemand = 5;
        importingMarket.DailyConsumerBudget = 100;
        exporter.Inventory["flour"] = 8;
        game.TradeRoutes.Add(new EconomicTradeRoute
        {
            Id = Guid.NewGuid(),
            ExportStateId = exporter.StateId,
            ImportStateId = importingState,
            GoodId = "flour",
            DailyCapacity = 4
        });
        WorldStateCompatibility.Normalize(game);
        var importingCurrency = game.Territories.Single(item => item.StateId == importingState).CurrencyId;

        var result = MarketClearingRules.ClearDailyMarkets(game);

        Assert.Null(result.Error);
        var settlement = Assert.Single(result.Settlements);
        Assert.Equal(0, settlement.DomesticSupply);
        Assert.Equal(4, settlement.ImportedSupply);
        Assert.Equal(4, settlement.QuantitySold);
        Assert.Equal(1, settlement.UnmetDemand);
        Assert.Equal(12, settlement.PriceAfter);
        Assert.Equal(48, exporter.CashBalances[importingCurrency]);
        Assert.Equal(0, exporter.CashBalances[exporter.CurrencyId]);
        var transaction = Assert.Single(game.CompanyFinancialTransactions);
        Assert.Equal(importingCurrency, transaction.CurrencyId);
        Assert.Equal(game.TradeRoutes[0].Id, transaction.TradeRouteId);
        Assert.Equal(4, transaction.Quantity);
        Assert.Equal(48, transaction.Amount);
        WorldStateCompatibility.Normalize(game);
    }

    [Fact]
    public void CompanyTradeRouteTransfersIntermediateGoodsAndBalancesBothCashLedgers()
    {
        var (game, exporter, _) = CreateMarketWorld();
        var importingState = Guid.NewGuid();
        game.Territories.Add(new TerritoryState
        {
            StateId = importingState,
            Index = 1,
            Name = "Importing State"
        });
        WorldStateCompatibility.Normalize(game);
        var importingCurrency = game.Territories.Single(item => item.StateId == importingState).CurrencyId;
        game.Markets.Add(new EconomicMarket
        {
            StateId = importingState,
            GoodId = "flour",
            DailyDemand = 3,
            DailyConsumerBudget = 100,
            BasePrice = 10,
            CurrentPrice = 10,
            MinimumPrice = 1,
            MaximumPrice = 100,
            PriceSmoothingPercent = 100
        });
        var importer = new EconomicCompany
        {
            Id = Guid.NewGuid(),
            StateId = importingState,
            CurrencyId = importingCurrency,
            Name = "Importing Factory",
            Sector = "Manufacturing",
            CashBalances = new Dictionary<Guid, long> { [importingCurrency] = 20 },
            Inventory = new Dictionary<string, long> { ["flour"] = 0 }
        };
        var secondExporter = new EconomicCompany
        {
            Id = Guid.NewGuid(),
            StateId = exporter.StateId,
            CurrencyId = exporter.CurrencyId,
            Name = "Second Exporter",
            Sector = "Food processing",
            Inventory = new Dictionary<string, long> { ["flour"] = 2 }
        };
        exporter.Inventory["flour"] = 8;
        game.Companies.AddRange([importer, secondExporter]);
        game.TradeRoutes.AddRange([
            new EconomicTradeRoute
            {
                Id = Guid.NewGuid(),
                ExportStateId = exporter.StateId,
                ImportStateId = importingState,
                GoodId = "flour",
                DailyCapacity = 5,
                ExporterCompanyId = exporter.Id,
                ImporterCompanyId = importer.Id,
                DailyQuantity = 4,
                UnitPrice = 3
            },
            new EconomicTradeRoute
            {
                Id = Guid.NewGuid(),
                ExportStateId = exporter.StateId,
                ImportStateId = importingState,
                GoodId = "flour",
                DailyCapacity = 2,
                ExporterCompanyId = secondExporter.Id,
                ImporterCompanyId = importer.Id,
                DailyQuantity = 2,
                UnitPrice = 3
            }
        ]);
        game.EconomyVersion = 2;
        WorldStateCompatibility.Normalize(game);

        var result = MarketClearingRules.ClearDailyMarkets(game);

        Assert.Null(result.Error);
        Assert.Equal(4, exporter.Inventory["flour"]);
        Assert.Equal(0, secondExporter.Inventory["flour"]);
        Assert.Equal(6, importer.Inventory["flour"]);
        Assert.Equal(2, importer.CashBalances[importingCurrency]);
        Assert.Equal(12, exporter.CashBalances[importingCurrency]);
        Assert.Equal(6, secondExporter.CashBalances[importingCurrency]);
        var purchases = game.CompanyFinancialTransactions.Where(item =>
            item.Type == CompanyTransactionType.TradePurchase).ToList();
        var sales = game.CompanyFinancialTransactions.Where(item =>
            item.Type == CompanyTransactionType.TradeSale).ToList();
        Assert.Equal(2, purchases.Count);
        Assert.Equal(2, sales.Count);
        Assert.DoesNotContain(game.CompanyFinancialTransactions, item =>
            item.Type == CompanyTransactionType.MarketSale);
        var importingSettlement = Assert.Single(result.Settlements, item =>
            item.StateId == importingState);
        Assert.Equal(0, importingSettlement.ImportedSupply);
        Assert.Equal(0, importingSettlement.QuantitySold);
        Assert.Equal(-18, purchases.Sum(item => item.Amount));
        Assert.Equal(18, sales.Sum(item => item.Amount));
        Assert.Equal(2, game.Events.Count(item => item.Type == "economy.trade_completed"));

        game.WorldVersion++;
        WorldStateCompatibility.Normalize(game);
    }

    [Fact]
    public void CompanyTradeRouteHonorsInventoryStorageAndBuyerFunds()
    {
        var (game, exporter, _) = CreateMarketWorld();
        game.Goods[0].StorageCapacity = 5;
        exporter.Inventory["flour"] = 4;
        var importingState = Guid.NewGuid();
        game.Territories.Add(new TerritoryState
        {
            StateId = importingState,
            Index = 1,
            Name = "Importing State"
        });
        WorldStateCompatibility.Normalize(game);
        var importingCurrency = game.Territories.Single(item => item.StateId == importingState).CurrencyId;
        var importer = new EconomicCompany
        {
            Id = Guid.NewGuid(),
            StateId = importingState,
            CurrencyId = importingCurrency,
            Name = "Importing Factory",
            Sector = "Manufacturing",
            CashBalances = new Dictionary<Guid, long> { [importingCurrency] = 6 },
            Inventory = new Dictionary<string, long> { ["flour"] = 3 }
        };
        game.Companies.Add(importer);
        game.TradeRoutes.Add(new EconomicTradeRoute
        {
            Id = Guid.NewGuid(),
            ExportStateId = exporter.StateId,
            ImportStateId = importingState,
            GoodId = "flour",
            DailyCapacity = 4,
            ExporterCompanyId = exporter.Id,
            ImporterCompanyId = importer.Id,
            DailyQuantity = 4,
            UnitPrice = 2
        });
        game.EconomyVersion = 2;
        WorldStateCompatibility.Normalize(game);

        var result = MarketClearingRules.ClearDailyMarkets(game);

        Assert.Null(result.Error);
        Assert.Equal(2, exporter.Inventory["flour"]);
        Assert.Equal(5, importer.Inventory["flour"]);
        Assert.Equal(2, importer.CashBalances[importingCurrency]);
        var purchase = Assert.Single(game.CompanyFinancialTransactions, item =>
            item.Type == CompanyTransactionType.TradePurchase);
        Assert.Equal(2, purchase.Quantity);
        Assert.Equal(-4, purchase.Amount);
    }

    [Fact]
    public void CompanyCannotResellGoodsImportedEarlierInTheSameDay()
    {
        var (game, exporter, _) = CreateMarketWorld();
        exporter.Inventory["flour"] = 5;
        var middleState = Guid.NewGuid();
        var finalState = Guid.NewGuid();
        game.Territories.AddRange([
            new TerritoryState { StateId = middleState, Index = 1, Name = "Middle State" },
            new TerritoryState { StateId = finalState, Index = 2, Name = "Final State" }
        ]);
        WorldStateCompatibility.Normalize(game);
        var middleCurrency = game.Territories.Single(item => item.StateId == middleState).CurrencyId;
        var finalCurrency = game.Territories.Single(item => item.StateId == finalState).CurrencyId;
        var middleCompany = new EconomicCompany
        {
            Id = Guid.NewGuid(),
            StateId = middleState,
            CurrencyId = middleCurrency,
            Name = "Middle Factory",
            Sector = "Manufacturing",
            CashBalances = new Dictionary<Guid, long> { [middleCurrency] = 20 },
            Inventory = new Dictionary<string, long> { ["flour"] = 0 }
        };
        var finalCompany = new EconomicCompany
        {
            Id = Guid.NewGuid(),
            StateId = finalState,
            CurrencyId = finalCurrency,
            Name = "Final Factory",
            Sector = "Manufacturing",
            CashBalances = new Dictionary<Guid, long> { [finalCurrency] = 20 },
            Inventory = new Dictionary<string, long> { ["flour"] = 0 }
        };
        game.Companies.AddRange([middleCompany, finalCompany]);
        game.TradeRoutes.AddRange([
            new EconomicTradeRoute
            {
                Id = Guid.NewGuid(),
                ExportStateId = exporter.StateId,
                ImportStateId = middleState,
                GoodId = "flour",
                DailyCapacity = 5,
                ExporterCompanyId = exporter.Id,
                ImporterCompanyId = middleCompany.Id,
                DailyQuantity = 5,
                UnitPrice = 2
            },
            new EconomicTradeRoute
            {
                Id = Guid.NewGuid(),
                ExportStateId = middleState,
                ImportStateId = finalState,
                GoodId = "flour",
                DailyCapacity = 5,
                ExporterCompanyId = middleCompany.Id,
                ImporterCompanyId = finalCompany.Id,
                DailyQuantity = 5,
                UnitPrice = 2
            }
        ]);
        game.EconomyVersion = 2;
        WorldStateCompatibility.Normalize(game);

        var result = MarketClearingRules.ClearDailyMarkets(game);

        Assert.Null(result.Error);
        Assert.Equal(5, middleCompany.Inventory["flour"]);
        Assert.Equal(0, finalCompany.Inventory["flour"]);
        Assert.Equal(1, game.CompanyFinancialTransactions.Count(item =>
            item.Type == CompanyTransactionType.TradeSale));
        Assert.DoesNotContain(game.CompanyFinancialTransactions, item =>
            item.Type == CompanyTransactionType.TradePurchase &&
            item.CompanyId == finalCompany.Id);
    }

    [Fact]
    public void DisabledCompanyTradeRouteDoesNotTransferGoodsOrMoney()
    {
        var (game, exporter, _) = CreateMarketWorld();
        exporter.Inventory["flour"] = 5;
        var importingState = Guid.NewGuid();
        game.Territories.Add(new TerritoryState
        {
            StateId = importingState,
            Index = 1,
            Name = "Importing State"
        });
        WorldStateCompatibility.Normalize(game);
        var importingCurrency = game.Territories.Single(item => item.StateId == importingState).CurrencyId;
        var importer = new EconomicCompany
        {
            Id = Guid.NewGuid(),
            StateId = importingState,
            CurrencyId = importingCurrency,
            Name = "Importing Factory",
            Sector = "Manufacturing",
            CashBalances = new Dictionary<Guid, long> { [importingCurrency] = 10 },
            Inventory = new Dictionary<string, long> { ["flour"] = 0 }
        };
        game.Companies.Add(importer);
        game.TradeRoutes.Add(new EconomicTradeRoute
        {
            Id = Guid.NewGuid(),
            ExportStateId = exporter.StateId,
            ImportStateId = importingState,
            GoodId = "flour",
            DailyCapacity = 5,
            ExporterCompanyId = exporter.Id,
            ImporterCompanyId = importer.Id,
            DailyQuantity = 5,
            UnitPrice = 2,
            Enabled = false
        });
        game.EconomyVersion = 2;
        WorldStateCompatibility.Normalize(game);
        var initialTransactionCount = game.CompanyFinancialTransactions.Count;

        var result = MarketClearingRules.ClearDailyMarkets(game);

        Assert.Null(result.Error);
        Assert.Equal(5, exporter.Inventory["flour"]);
        Assert.Equal(0, importer.Inventory["flour"]);
        Assert.Equal(10, importer.CashBalances[importingCurrency]);
        Assert.Equal(initialTransactionCount, game.CompanyFinancialTransactions.Count);
    }

    [Fact]
    public void FailedCompanyTradeDoesNotPartiallyMutateTheWorld()
    {
        var (game, exporter, _) = CreateMarketWorld();
        exporter.Inventory["flour"] = 1;
        var importingState = Guid.NewGuid();
        game.Territories.Add(new TerritoryState
        {
            StateId = importingState,
            Index = 1,
            Name = "Importing State"
        });
        WorldStateCompatibility.Normalize(game);
        var importingCurrency = game.Territories.Single(item => item.StateId == importingState).CurrencyId;
        var importer = new EconomicCompany
        {
            Id = Guid.NewGuid(),
            StateId = importingState,
            CurrencyId = importingCurrency,
            Name = "Importing Factory",
            Sector = "Manufacturing",
            CashBalances = new Dictionary<Guid, long> { [importingCurrency] = 10 },
            Inventory = new Dictionary<string, long> { ["flour"] = 0 }
        };
        exporter.CashBalances[importingCurrency] = long.MaxValue - 1;
        game.Companies.Add(importer);
        game.TradeRoutes.Add(new EconomicTradeRoute
        {
            Id = Guid.NewGuid(),
            ExportStateId = exporter.StateId,
            ImportStateId = importingState,
            GoodId = "flour",
            DailyCapacity = 1,
            ExporterCompanyId = exporter.Id,
            ImporterCompanyId = importer.Id,
            DailyQuantity = 1,
            UnitPrice = 2
        });
        game.EconomyVersion = 2;
        WorldStateCompatibility.Normalize(game);
        var initialTransactionCount = game.CompanyFinancialTransactions.Count;
        var initialEventCount = game.Events.Count;

        var result = MarketClearingRules.ClearDailyMarkets(game);

        Assert.Equal("A company's cash balance would exceed the supported limit.", result.Error);
        Assert.Equal(1, exporter.Inventory["flour"]);
        Assert.Equal(0, importer.Inventory["flour"]);
        Assert.Equal(10, importer.CashBalances[importingCurrency]);
        Assert.Equal(long.MaxValue - 1, exporter.CashBalances[importingCurrency]);
        Assert.Equal(initialTransactionCount, game.CompanyFinancialTransactions.Count);
        Assert.Equal(initialEventCount, game.Events.Count);
    }

    [Fact]
    public void ConsumerBudgetCapsPurchasesAndLeavesUnsoldInventoryAvailable()
    {
        var (game, company, market) = CreateMarketWorld();
        company.Inventory["flour"] = 10;
        market.DailyDemand = 10;
        market.DailyConsumerBudget = 15;

        var result = MarketClearingRules.ClearDailyMarkets(game);

        var settlement = Assert.Single(result.Settlements);
        Assert.Equal(10, settlement.PriceAfter);
        Assert.Equal(1, settlement.QuantitySold);
        Assert.Equal(10, settlement.ConsumerSpending);
        Assert.Equal(9, company.Inventory["flour"]);
    }

    [Fact]
    public void PriceSmoothingAlwaysMovesTowardItsTarget()
    {
        var (game, company, market) = CreateMarketWorld();
        company.Inventory["flour"] = 1;
        market.DailyDemand = 100;
        market.DailyConsumerBudget = 1000;
        market.PriceSmoothingPercent = 1;

        var result = MarketClearingRules.ClearDailyMarkets(game);

        Assert.Null(result.Error);
        Assert.Equal(11, market.CurrentPrice);
    }

    [Fact]
    public void PopulationNeedsContributeDemandAndCarryFractionalQuantitiesAcrossDays()
    {
        var (game, company, market) = CreateMarketWorld();
        company.Inventory["flour"] = 10;
        market.DailyDemand = 1;
        market.DailyConsumerBudget = 100;
        game.PopulationGroups.Add(new PopulationGroup
        {
            Id = Guid.NewGuid(),
            StateId = market.StateId,
            Name = "Rural households",
            Population = 500,
            Needs =
            [
                new PopulationNeed
                {
                    GoodId = "flour",
                    DailyQuantityPerThousandPeople = 3
                }
            ]
        });
        WorldStateCompatibility.Normalize(game);

        var firstDay = MarketClearingRules.ClearDailyMarkets(game);
        var firstSettlement = Assert.Single(firstDay.Settlements);

        Assert.Null(firstDay.Error);
        Assert.Equal(1, firstSettlement.PopulationDemand);
        Assert.Equal(1, firstSettlement.PopulationQuantitySold);
        Assert.Equal(0, firstSettlement.PopulationUnmetDemand);
        Assert.Equal(2, firstSettlement.Demand);
        Assert.Equal(2, firstSettlement.QuantitySold);
        Assert.Equal(500, game.PopulationGroups[0].DailyDemandRemainders["flour"]);

        game.WorldDate = game.WorldDate.AddDays(1);
        var secondDay = MarketClearingRules.ClearDailyMarkets(game);
        var secondSettlement = Assert.Single(secondDay.Settlements);

        Assert.Null(secondDay.Error);
        Assert.Equal(2, secondSettlement.PopulationDemand);
        Assert.Equal(2, secondSettlement.PopulationQuantitySold);
        Assert.Equal(0, secondSettlement.PopulationUnmetDemand);
        Assert.Equal(3, secondSettlement.Demand);
        Assert.Equal(3, secondSettlement.QuantitySold);
        Assert.Equal(0, game.PopulationGroups[0].DailyDemandRemainders["flour"]);
        WorldStateCompatibility.Normalize(game);
        var snapshot = GameHub.BuildSnapshot(game, new HashSet<Guid>());
        Assert.Equal(500, Assert.Single(snapshot.PopulationGroups).Population);
        Assert.Equal(2, snapshot.MarketHistory.Count);
    }

    [Fact]
    public void PopulationSettlementRecordsUnmetNeedWhenSupplyIsInsufficient()
    {
        var (game, company, market) = CreateMarketWorld();
        company.Inventory["flour"] = 1;
        market.DailyConsumerBudget = 100;
        game.PopulationGroups.Add(new PopulationGroup
        {
            Id = Guid.NewGuid(),
            StateId = market.StateId,
            Name = "Households",
            Population = 1000,
            Needs =
            [
                new PopulationNeed
                {
                    GoodId = "flour",
                    DailyQuantityPerThousandPeople = 3
                }
            ]
        });
        WorldStateCompatibility.Normalize(game);

        var result = MarketClearingRules.ClearDailyMarkets(game);
        var settlement = Assert.Single(result.Settlements);

        Assert.Null(result.Error);
        Assert.Equal(3, settlement.PopulationDemand);
        Assert.Equal(1, settlement.PopulationQuantitySold);
        Assert.Equal(2, settlement.PopulationUnmetDemand);
        Assert.Equal(2, settlement.UnmetDemand);
        WorldStateCompatibility.Normalize(game);
    }

    [Fact]
    public void ExcessivePopulationDemandDoesNotPartiallyAdvanceRemaindersOrMarkets()
    {
        var (game, company, market) = CreateMarketWorld();
        company.Inventory["flour"] = 4;
        market.DailyDemand = 1;
        market.DailyConsumerBudget = 100;
        var group = new PopulationGroup
        {
            Id = Guid.NewGuid(),
            StateId = market.StateId,
            Name = "Oversized group",
            Population = long.MaxValue,
            Needs =
            [
                new PopulationNeed
                {
                    GoodId = "flour",
                    DailyQuantityPerThousandPeople = long.MaxValue
                }
            ]
        };
        group.DailyDemandRemainders["flour"] = 999;
        game.PopulationGroups.Add(group);

        var result = MarketClearingRules.ClearDailyMarkets(game);

        Assert.Equal("Population demand exceeds the supported market limit.", result.Error);
        Assert.Equal(4, company.Inventory["flour"]);
        Assert.Equal(10, market.CurrentPrice);
        Assert.Equal(999, group.DailyDemandRemainders["flour"]);
        Assert.Empty(game.MarketHistory);
    }

    [Fact]
    public void FailedSettlementDoesNotPartiallyMutateMarketsOrCompanyAccounts()
    {
        var (game, company, market) = CreateMarketWorld();
        company.Inventory["flour"] = 1;
        company.CashBalances[company.CurrencyId] = long.MaxValue - 5;
        market.DailyDemand = 1;
        market.DailyConsumerBudget = 10;

        var result = MarketClearingRules.ClearDailyMarkets(game);

        Assert.Equal("A company's cash balance would exceed the supported limit.", result.Error);
        Assert.Equal(1, company.Inventory["flour"]);
        Assert.Equal(10, market.CurrentPrice);
        Assert.Empty(game.CompanyFinancialTransactions);
        Assert.Empty(game.MarketHistory);
    }

    [Fact]
    public void MarketConfigurationAndLedgerRejectInvalidOrInconsistentData()
    {
        var (game, company, market) = CreateMarketWorld();
        company.Inventory["flour"] = 1;
        market.DailyDemand = 1;
        market.DailyConsumerBudget = 10;
        MarketClearingRules.ClearDailyMarkets(game);
        company.CashBalances[company.CurrencyId]++;

        Assert.Throws<InvalidDataException>(() => WorldStateCompatibility.Normalize(game));
    }

    private static (WorldState Game, EconomicCompany Company, EconomicMarket Market) CreateMarketWorld()
    {
        var stateId = Guid.NewGuid();
        var company = new EconomicCompany
        {
            Id = Guid.NewGuid(),
            StateId = stateId,
            Name = "Test Mill",
            Sector = "Food processing",
            Inventory = new Dictionary<string, long> { ["flour"] = 0 }
        };
        var market = new EconomicMarket
        {
            StateId = stateId,
            GoodId = "flour",
            DailyDemand = 0,
            DailyConsumerBudget = 0,
            BasePrice = 10,
            CurrentPrice = 10,
            MinimumPrice = 1,
            MaximumPrice = 100,
            PriceSmoothingPercent = 100
        };
        var game = new WorldState
        {
            Id = Guid.NewGuid(),
            WorldDate = new DateOnly(1500, 1, 1),
            Territories = [new TerritoryState { StateId = stateId, Index = 0, Name = "Exporting State" }],
            Goods =
            [
                new EconomicGood
                {
                    Id = "flour",
                    Name = "Flour",
                    Unit = "tonne",
                    Category = EconomicGoodCategory.Consumer
                }
            ],
            Companies = [company],
            Markets = [market]
        };
        WorldStateCompatibility.Normalize(game);
        return (game, company, market);
    }
}
