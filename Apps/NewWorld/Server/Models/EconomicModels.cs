namespace NewWorld.Server.Models;

public enum EconomicGoodCategory
{
    Resource,
    Intermediate,
    Consumer,
    Capital,
    Service
}

public sealed class EconomicGood
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string Unit { get; set; } = "";
    public EconomicGoodCategory Category { get; set; }
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
    public string Name { get; set; } = "";
    public string Sector { get; set; } = "";
    public Dictionary<string, long> Inventory { get; set; } = [];
    public List<ProductionFacility> Facilities { get; set; } = [];
}

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
