using NewWorld.Server.Models;

namespace NewWorld.Server.Services;

public static class EconomySetupRules
{
    public static string? Configure(WorldState game, EconomyScenarioRequest request)
    {
        if (game.Started)
            return "Economic scenario data is locked after the world starts.";
        if (request.ExpectedWorldVersion != game.WorldVersion)
            return "The world changed. Reload it before configuring the economic scenario.";
        if (request.Goods is null ||
            request.ProductionRecipes is null ||
            request.Companies is null ||
            request.Markets is null ||
            request.TradeRoutes is null)
            return "All economic scenario collections are required; use empty arrays for unused systems.";
        if (request.Goods.Any(item => item is null) ||
            request.ProductionRecipes.Any(item => item is null) ||
            request.Companies.Any(item => item is null) ||
            request.Markets.Any(item => item is null) ||
            request.TradeRoutes.Any(item => item is null))
            return "Economic scenario collections cannot contain null entries.";
        if (request.Goods.Count > 500 ||
            request.ProductionRecipes.Count > 2000 ||
            request.Companies.Count > 10000 ||
            request.Markets.Count > 8000 ||
            request.TradeRoutes.Count > 50000 ||
            request.Companies.Sum(company => (long)(company.Inventory?.Count ?? 0)) > 1_000_000 ||
            request.Companies.Sum(company => (long)(company.Facilities?.Count ?? 0)) > 100_000)
            return "The economic scenario exceeds a supported collection limit.";

        var candidate = WorldStateCompatibility.Clone(game);
        candidate.Goods = request.Goods.ToList();
        candidate.ProductionRecipes = request.ProductionRecipes.ToList();
        candidate.Companies = request.Companies.ToList();
        candidate.Markets = request.Markets.ToList();
        candidate.TradeRoutes = request.TradeRoutes.ToList();
        candidate.CompanyFinancialTransactions = [];
        candidate.MarketHistory = [];
        candidate.EconomyVersion = 2;
        try
        {
            WorldStateCompatibility.Normalize(candidate);
        }
        catch (InvalidDataException exception)
        {
            return $"Invalid economic scenario: {exception.Message}";
        }

        game.Goods = candidate.Goods;
        game.ProductionRecipes = candidate.ProductionRecipes;
        game.Companies = candidate.Companies;
        game.Markets = candidate.Markets;
        game.TradeRoutes = candidate.TradeRoutes;
        game.CompanyFinancialTransactions = candidate.CompanyFinancialTransactions;
        game.MarketHistory = candidate.MarketHistory;
        game.EconomyVersion = candidate.EconomyVersion;
        GameStore.AddActivity(game, "The host configured the economic scenario before the world started.");
        return null;
    }
}
