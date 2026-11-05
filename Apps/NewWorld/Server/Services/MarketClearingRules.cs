using System.Numerics;
using NewWorld.Server.Models;

namespace NewWorld.Server.Services;

public static class MarketClearingRules
{
    public static (IReadOnlyList<MarketSettlement> Settlements, string? Error) ClearDailyMarkets(
        WorldState game)
    {
        var settlements = new List<MarketSettlement>();
        var territories = game.Territories.ToDictionary(territory => territory.StateId);
        var inventories = game.Companies.ToDictionary(
            company => company.Id,
            company => new Dictionary<string, long>(company.Inventory, StringComparer.Ordinal));
        var cashBalances = game.Companies.ToDictionary(
            company => company.Id,
            company => new Dictionary<Guid, long>(company.CashBalances));
        var marketBlockedInventory = game.Companies.ToDictionary(
            company => company.Id,
            _ => new Dictionary<string, long>(StringComparer.Ordinal));
        var populationRemainders = game.PopulationGroups.ToDictionary(
            group => group.Id,
            group => new Dictionary<string, long>(group.DailyDemandRemainders, StringComparer.Ordinal));
        var populationDemand = new Dictionary<(Guid StateId, string GoodId), BigInteger>();
        foreach (var group in game.PopulationGroups)
        foreach (var need in group.Needs)
        {
            var remainder = populationRemainders[group.Id].GetValueOrDefault(need.GoodId);
            var dailyAmount =
                (BigInteger)group.Population * need.DailyQuantityPerThousandPeople + remainder;
            var quantity = dailyAmount / 1000;
            if (quantity > long.MaxValue)
                return ([], "Population demand exceeds the supported market limit.");
            populationRemainders[group.Id][need.GoodId] = (long)(dailyAmount % 1000);
            var marketKey = (group.StateId, need.GoodId);
            populationDemand[marketKey] = populationDemand.GetValueOrDefault(marketKey) + quantity;
        }

        var companiesByStateAndGood = game.Companies
            .SelectMany(company => company.Inventory
                .Where(stock => stock.Value > 0)
                .Select(stock => (Key: (company.StateId, stock.Key), Company: company)))
            .GroupBy(item => item.Key)
            .ToDictionary(
                group => group.Key,
                group => group.Select(item => item.Company).OrderBy(company => company.Id).ToList());
        var routesByImportMarket = game.TradeRoutes
            .Where(route => route.Enabled)
            .GroupBy(route => (route.ImportStateId, route.GoodId))
            .ToDictionary(
                group => group.Key,
                group => group.OrderBy(route => route.Id).ToList());
        var transactionWorld = new WorldState
        {
            WorldDate = game.WorldDate,
            TradeRoutes = game.TradeRoutes
        };
        var companyById = game.Companies.ToDictionary(company => company.Id);
        var companyTradeError = ClearBilateralCompanyRoutes(
            game,
            territories,
            companyById,
            inventories,
            cashBalances,
            marketBlockedInventory,
            transactionWorld);
        if (companyTradeError is not null)
            return ([], companyTradeError);

        var marketPrices = game.Markets.ToDictionary(
            market => (market.StateId, market.GoodId),
            market => market.CurrentPrice);
        foreach (var market in game.Markets
                     .OrderBy(item => territories[item.StateId].Index)
                     .ThenBy(item => item.GoodId, StringComparer.Ordinal))
        {
            var good = game.Goods.Single(item => item.Id == market.GoodId);
            var currencyId = territories[market.StateId].CurrencyId;
            var offers = BuildOffers(
                market,
                inventories,
                marketBlockedInventory,
                companiesByStateAndGood,
                routesByImportMarket);
            var totalSupply = offers.Aggregate(BigInteger.Zero, (sum, offer) => sum + offer.Quantity);
            var domesticSupply = CappedSum(offers
                .Where(offer => offer.TradeRouteId is null)
                .Select(offer => offer.Quantity));
            var importedSupply = CappedSum(offers
                .Where(offer => offer.TradeRouteId is not null)
                .Select(offer => offer.Quantity));
            var marketKey = (market.StateId, market.GoodId);
            var groupDemand = populationDemand.GetValueOrDefault(marketKey);
            var totalDemand = (BigInteger)market.DailyDemand + groupDemand;
            if (totalDemand > long.MaxValue)
                return ([], "Population demand exceeds the supported market limit.");
            var demand = (long)totalDemand;
            var priceBefore = marketPrices[marketKey];
            var priceAfter = CalculatePrice(market, priceBefore, demand, totalSupply);
            marketPrices[marketKey] = priceAfter;

            var affordableDemand = market.DailyConsumerBudget / priceAfter;
            var quantitySold = (long)BigInteger.Min(
                demand,
                BigInteger.Min(totalSupply, affordableDemand));
            var allocations = Allocate(offers, quantitySold);
            var spending = checked(quantitySold * priceAfter);
            foreach (var (offer, quantity) in allocations)
            {
                if (quantity == 0)
                    continue;

                if (offer.Quantity < quantity)
                    return ([], "Market allocation exceeds a company's available inventory.");
                var revenue = checked(quantity * priceAfter);
                var companyCash = cashBalances[offer.Company.Id];
                var balanceBefore = companyCash.GetValueOrDefault(currencyId);
                if (balanceBefore > long.MaxValue - revenue)
                    return ([], "A company's cash balance would exceed the supported limit.");

                inventories[offer.Company.Id][market.GoodId] -= quantity;
                companyCash[currencyId] = balanceBefore + revenue;
                var transactionCompany = new EconomicCompany
                {
                    Id = offer.Company.Id,
                    StateId = offer.Company.StateId,
                    CurrencyId = offer.Company.CurrencyId,
                    CashBalances = companyCash
                };
                GameStore.AddCompanyFinancialTransaction(
                    transactionWorld,
                    transactionCompany,
                    currencyId,
                    balanceBefore,
                    balanceBefore + revenue,
                    market.GoodId,
                    quantity,
                    priceAfter,
                    offer.TradeRouteId,
                    offer.TradeRouteId is null
                        ? $"Sold {quantity} {good.Unit} {good.Name} in the domestic market."
                        : $"Exported {quantity} {good.Unit} {good.Name} to {territories[market.StateId].Name}.");
            }

            var settlement = new MarketSettlement(
                market.StateId,
                market.GoodId,
                currencyId,
                game.WorldDate,
                demand,
                domesticSupply,
                importedSupply,
                quantitySold,
                demand - quantitySold,
                priceBefore,
                priceAfter,
                market.DailyConsumerBudget,
                spending,
                (long)groupDemand);
            settlements.Add(settlement);
        }

        foreach (var company in game.Companies)
        {
            company.Inventory = inventories[company.Id];
            company.CashBalances = cashBalances[company.Id];
        }
        foreach (var group in game.PopulationGroups)
            group.DailyDemandRemainders = populationRemainders[group.Id];
        foreach (var market in game.Markets)
            market.CurrentPrice = marketPrices[(market.StateId, market.GoodId)];
        game.CompanyFinancialTransactions.AddRange(transactionWorld.CompanyFinancialTransactions);
        game.MarketHistory.AddRange(settlements);
        foreach (var transaction in transactionWorld.CompanyFinancialTransactions.Where(item =>
                     item.Type == CompanyTransactionType.TradeSale))
        {
            var description = transaction.Description;
            GameStore.AddActivity(game, description);
            GameStore.AddWorldEvent(
                game,
                "economy.trade_completed",
                null,
                transaction.StateId,
                null,
                description,
                worldVersion: game.WorldVersion + 1);
        }
        if (game.MarketHistory.Count > 1000)
            game.MarketHistory.RemoveRange(0, game.MarketHistory.Count - 1000);
        return (settlements, null);
    }

    private static List<MarketOffer> BuildOffers(
        EconomicMarket market,
        IReadOnlyDictionary<Guid, Dictionary<string, long>> inventories,
        IReadOnlyDictionary<Guid, Dictionary<string, long>> marketBlockedInventory,
        IReadOnlyDictionary<(Guid StateId, string GoodId), List<EconomicCompany>> companiesByStateAndGood,
        IReadOnlyDictionary<(Guid ImportStateId, string GoodId), List<EconomicTradeRoute>> routesByImportMarket)
    {
        var offers = companiesByStateAndGood
            .GetValueOrDefault((market.StateId, market.GoodId), [])
            .Select(company => new MarketOffer(
                company,
                Math.Max(0,
                    inventories[company.Id].GetValueOrDefault(market.GoodId) -
                    marketBlockedInventory[company.Id].GetValueOrDefault(market.GoodId)),
                null))
            .Where(offer => offer.Quantity > 0)
            .ToList();

        foreach (var route in routesByImportMarket.GetValueOrDefault((market.StateId, market.GoodId), []))
        {
            var exporters = companiesByStateAndGood
                .GetValueOrDefault((route.ExportStateId, market.GoodId), [])
                .Where(company =>
                    inventories[company.Id].GetValueOrDefault(market.GoodId) -
                    marketBlockedInventory[company.Id].GetValueOrDefault(market.GoodId) > 0)
                .ToList();
            var routeSupply = exporters.Aggregate(
                BigInteger.Zero,
                (sum, company) => sum + inventories[company.Id].GetValueOrDefault(market.GoodId) -
                    marketBlockedInventory[company.Id].GetValueOrDefault(market.GoodId));
            var quantityToShip = (long)BigInteger.Min(route.DailyCapacity, routeSupply);
            foreach (var (company, quantity) in AllocateCompanies(
                         exporters, market.GoodId, inventories, marketBlockedInventory, quantityToShip))
                if (quantity > 0)
                    offers.Add(new MarketOffer(company, quantity, route.Id));
        }

        return offers;
    }

    private static string? ClearBilateralCompanyRoutes(
        WorldState game,
        IReadOnlyDictionary<Guid, TerritoryState> territories,
        IReadOnlyDictionary<Guid, EconomicCompany> companies,
        IDictionary<Guid, Dictionary<string, long>> inventories,
        IDictionary<Guid, Dictionary<Guid, long>> cashBalances,
        IDictionary<Guid, Dictionary<string, long>> marketBlockedInventory,
        WorldState transactionWorld)
    {
        var goods = game.Goods.ToDictionary(good => good.Id, StringComparer.Ordinal);
        foreach (var route in game.TradeRoutes
                     .Where(item => item.Enabled && item.ExporterCompanyId is not null)
                     .OrderBy(item => item.Id))
        {
            var exporter = companies[route.ExporterCompanyId!.Value];
            var importer = companies[route.ImporterCompanyId!.Value];
            var currencyId = territories[route.ImportStateId].CurrencyId;
            var good = goods[route.GoodId];
            var availableStorage = good.StorageCapacity is long capacity
                ? Math.Max(0, capacity - inventories[importer.Id].GetValueOrDefault(route.GoodId))
                : long.MaxValue - inventories[importer.Id].GetValueOrDefault(route.GoodId);
            var buyerBalance = cashBalances[importer.Id].GetValueOrDefault(currencyId);
            var affordableQuantity = buyerBalance / route.UnitPrice;
            var exporterInventory = inventories[exporter.Id].GetValueOrDefault(route.GoodId);
            var exporterAvailableInventory = Math.Max(
                0,
                exporterInventory - marketBlockedInventory[exporter.Id].GetValueOrDefault(route.GoodId));
            var quantity = (long)BigInteger.Min(
                route.DailyQuantity,
                BigInteger.Min(
                    route.DailyCapacity,
                    BigInteger.Min(
                        exporterAvailableInventory,
                        BigInteger.Min(availableStorage, affordableQuantity))));
            if (quantity == 0)
                continue;

            var payment = checked(quantity * route.UnitPrice);
            var sellerBalance = cashBalances[exporter.Id].GetValueOrDefault(currencyId);
            if (sellerBalance > long.MaxValue - payment)
                return "A company's cash balance would exceed the supported limit.";

            inventories[exporter.Id][route.GoodId] -= quantity;
            inventories[importer.Id][route.GoodId] =
                inventories[importer.Id].GetValueOrDefault(route.GoodId) + quantity;
            marketBlockedInventory[importer.Id][route.GoodId] =
                marketBlockedInventory[importer.Id].GetValueOrDefault(route.GoodId) + quantity;
            cashBalances[importer.Id][currencyId] = buyerBalance - payment;
            cashBalances[exporter.Id][currencyId] = sellerBalance + payment;

            var transactionImporter = new EconomicCompany
            {
                Id = importer.Id,
                StateId = importer.StateId,
                CurrencyId = importer.CurrencyId,
                CashBalances = cashBalances[importer.Id]
            };
            GameStore.AddCompanyFinancialTransaction(
                transactionWorld,
                transactionImporter,
                currencyId,
                buyerBalance,
                buyerBalance - payment,
                route.GoodId,
                quantity,
                route.UnitPrice,
                route.Id,
                $"Purchased {quantity} {good.Unit} {good.Name} from {territories[route.ExportStateId].Name}.",
                CompanyTransactionType.TradePurchase);

            var transactionExporter = new EconomicCompany
            {
                Id = exporter.Id,
                StateId = exporter.StateId,
                CurrencyId = exporter.CurrencyId,
                CashBalances = cashBalances[exporter.Id]
            };
            GameStore.AddCompanyFinancialTransaction(
                transactionWorld,
                transactionExporter,
                currencyId,
                sellerBalance,
                sellerBalance + payment,
                route.GoodId,
                quantity,
                route.UnitPrice,
                route.Id,
                $"Sold {quantity} {good.Unit} {good.Name} to {territories[route.ImportStateId].Name}.",
                CompanyTransactionType.TradeSale);
        }

        return null;
    }

    private static List<(EconomicCompany Company, long Quantity)> AllocateCompanies(
        IReadOnlyList<EconomicCompany> companies,
        string goodId,
        IReadOnlyDictionary<Guid, Dictionary<string, long>> inventories,
        IReadOnlyDictionary<Guid, Dictionary<string, long>> marketBlockedInventory,
        long quantity)
    {
        var offers = companies.Select(company => new MarketOffer(
            company,
            inventories[company.Id].GetValueOrDefault(goodId) -
                marketBlockedInventory[company.Id].GetValueOrDefault(goodId),
            null)).ToList();
        return Allocate(offers, quantity)
            .Select(allocation => (allocation.Offer.Company, allocation.Quantity))
            .ToList();
    }

    private static List<(MarketOffer Offer, long Quantity)> Allocate(
        IReadOnlyList<MarketOffer> offers,
        long quantity)
    {
        if (quantity == 0)
            return offers.Select(offer => (offer, 0L)).ToList();

        var total = offers.Aggregate(BigInteger.Zero, (sum, offer) => sum + offer.Quantity);
        if (total < quantity)
            throw new InvalidDataException("Market demand exceeds the available offers.");

        var allocations = offers.Select(offer => (Offer: offer, Quantity: (long)(
            (BigInteger)quantity * offer.Quantity / total))).ToList();
        var remaining = quantity - allocations.Sum(allocation => allocation.Quantity);
        for (var index = 0; remaining > 0; index++)
        {
            if (allocations[index].Quantity >= allocations[index].Offer.Quantity)
                continue;
            allocations[index] = (allocations[index].Offer, allocations[index].Quantity + 1);
            remaining--;
        }
        return allocations;
    }

    private static long CalculatePrice(
        EconomicMarket market, long currentPrice, long demand, BigInteger supply)
    {
        BigInteger target;
        if (demand == 0)
            target = market.MinimumPrice;
        else if (supply == 0)
            target = market.MaximumPrice;
        else
            target = BigInteger.Clamp(
                (BigInteger)market.BasePrice * demand / supply,
                market.MinimumPrice,
                market.MaximumPrice);

        var difference = target - currentPrice;
        var change = difference * market.PriceSmoothingPercent / 100;
        if (change == 0 && difference != 0)
            change = difference > 0 ? BigInteger.One : BigInteger.MinusOne;
        var next = currentPrice + change;
        return (long)BigInteger.Clamp(next, market.MinimumPrice, market.MaximumPrice);
    }

    private static long CappedSum(IEnumerable<long> values)
    {
        var sum = values.Aggregate(BigInteger.Zero, (total, value) => total + value);
        return (long)BigInteger.Min(sum, long.MaxValue);
    }

    private sealed record MarketOffer(EconomicCompany Company, long Quantity, Guid? TradeRouteId);
}
