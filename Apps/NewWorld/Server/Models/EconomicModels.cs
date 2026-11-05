namespace NewWorld.Server.Models;

public enum EconomicGoodCategory
{
    Resource,
    Intermediate,
    Consumer,
    Capital,
    Service
}

public enum EconomicTransactionType
{
    OpeningBalance,
    MembershipTransfer,
    AdministrationCost,
    ConstructionCost,
    DailyBalance
}

public enum CompanyTransactionType
{
    OpeningBalance,
    MarketSale,
    TradeSale,
    TradePurchase
}

public sealed class EconomicMarket
{
    public Guid StateId { get; set; }
    public string GoodId { get; set; } = "";
    public long DailyDemand { get; set; }
    public long DailyConsumerBudget { get; set; }
    public long BasePrice { get; set; }
    public long CurrentPrice { get; set; }
    public long MinimumPrice { get; set; }
    public long MaximumPrice { get; set; }
    public int PriceSmoothingPercent { get; set; } = 100;
}

public sealed class EconomicTradeRoute
{
    public Guid Id { get; set; }
    public Guid ExportStateId { get; set; }
    public Guid ImportStateId { get; set; }
    public string GoodId { get; set; } = "";
    public long DailyCapacity { get; set; }
    public Guid? ExporterCompanyId { get; set; }
    public Guid? ImporterCompanyId { get; set; }
    public long DailyQuantity { get; set; }
    public long UnitPrice { get; set; }
    public bool Enabled { get; set; } = true;
}

public sealed class StateCurrency
{
    public Guid Id { get; set; }
    public Guid StateId { get; set; }
    public string? Name { get; set; }
    public string? Code { get; set; }
    public int? MinorUnitScale { get; set; }
}

public sealed record EconomicTransaction(
    Guid Id,
    Guid StateId,
    Guid CurrencyId,
    EconomicTransactionType Type,
    long Amount,
    long BalanceBefore,
    long BalanceAfter,
    DateOnly WorldDate,
    DateTimeOffset RecordedAtUtc,
    Guid? OrderId,
    Guid? MembershipId,
    string Description);

public sealed class EconomicGood
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string Unit { get; set; } = "";
    public EconomicGoodCategory Category { get; set; }
    public long? StorageCapacity { get; set; }
}

public sealed class ProductionRecipe
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public int DaysPerBatch { get; set; } = 1;
    public Dictionary<string, long> Inputs { get; set; } = [];
    public Dictionary<string, long> Outputs { get; set; } = [];
}

public sealed class EconomicCompany
{
    public Guid Id { get; set; }
    public Guid StateId { get; set; }
    public Guid CurrencyId { get; set; }
    public Dictionary<Guid, long> CashBalances { get; set; } = [];
    public string Name { get; set; } = "";
    public string Sector { get; set; } = "";
    public Dictionary<string, long> Inventory { get; set; } = [];
    public List<ProductionFacility> Facilities { get; set; } = [];
}

public sealed record CompanyFinancialTransaction(
    Guid Id,
    Guid CompanyId,
    Guid StateId,
    Guid CurrencyId,
    CompanyTransactionType Type,
    long Amount,
    long BalanceBefore,
    long BalanceAfter,
    DateOnly WorldDate,
    Guid? TradeRouteId,
    string GoodId,
    long Quantity,
    long UnitPrice,
    string Description);

public sealed record MarketSettlement(
    Guid StateId,
    string GoodId,
    Guid CurrencyId,
    DateOnly WorldDate,
    long Demand,
    long DomesticSupply,
    long ImportedSupply,
    long QuantitySold,
    long UnmetDemand,
    long PriceBefore,
    long PriceAfter,
    long ConsumerBudget,
    long ConsumerSpending,
    long PopulationDemand = 0);

public sealed record EconomyScenarioRequest(
    long ExpectedWorldVersion,
    IReadOnlyList<EconomicGood> Goods,
    IReadOnlyList<ProductionRecipe> ProductionRecipes,
    IReadOnlyList<EconomicCompany> Companies,
    IReadOnlyList<EconomicMarket> Markets,
    IReadOnlyList<EconomicTradeRoute> TradeRoutes,
    IReadOnlyList<PopulationGroup>? PopulationGroups = null);

public sealed class ProductionFacility
{
    public Guid Id { get; set; }
    public string RecipeId { get; set; } = "";
    public int BatchesPerCycle { get; set; } = 1;
    public int ProgressDays { get; set; }
}

public sealed record ProductionResult(
    Guid CompanyId,
    Guid FacilityId,
    string RecipeId,
    int Batches,
    IReadOnlyDictionary<string, long> InputsConsumed,
    IReadOnlyDictionary<string, long> OutputsProduced);

public sealed record EconomicCompanyView(
    Guid Id,
    Guid StateId,
    Guid CurrencyId,
    IReadOnlyDictionary<Guid, long> CashBalances,
    string Name,
    string Sector,
    IReadOnlyDictionary<string, long> Inventory,
    IReadOnlyList<ProductionFacilityView> Facilities);

public sealed record ProductionFacilityView(
    Guid Id,
    string RecipeId,
    string RecipeName,
    int BatchesPerCycle,
    int ProgressDays,
    int DaysPerBatch);
