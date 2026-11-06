namespace NewWorld.Server.Models;

public enum TechnologyDomain
{
    Agriculture,
    Metallurgy,
    Military,
    Navigation,
    Medicine,
    Industry,
    Science,
    Education,
    Administration,
    Energy,
    Communication,
    Construction
}

public enum ResearchInstitutionType
{
    Public,
    Private
}

public enum ResearchProjectStatus
{
    Proposed,
    Active,
    Suspended,
    Completed,
    Cancelled
}

public sealed class Technology
{
    public string Id { get; set; } = "";
    public TechnologyDomain Domain { get; set; }
    public string Name { get; set; } = "";
    public string Description { get; set; } = "";
    public string Category { get; set; } = "";
    public List<string> PrerequisiteTechnologyIds { get; set; } = [];
    public Dictionary<string, long> RequiredMaterials { get; set; } = [];
    public Dictionary<string, long> RequiredKnowledge { get; set; } = [];
    public List<TechnologyEffect> Effects { get; set; } = [];
}

public sealed record TechnologyEffect(string EffectId, decimal Value, string Unit, string Basis);

public sealed class ResearchInstitution
{
    public Guid Id { get; set; }
    public Guid StateId { get; set; }
    public Guid CurrencyId { get; set; }
    public ResearchInstitutionType Type { get; set; }
    public Guid? ProvinceId { get; set; }
    public string Name { get; set; } = "";
    public long Staff { get; set; }
    public long Funding { get; set; }
    public Dictionary<string, long> Facilities { get; set; } = [];
    public HashSet<TechnologyDomain> Specializations { get; set; } = [];
}

public sealed class ResearchProject
{
    public Guid Id { get; set; }
    public Guid StateId { get; set; }
    public Guid InstitutionId { get; set; }
    public Guid CurrencyId { get; set; }
    public string TechnologyId { get; set; } = "";
    public long Budget { get; set; }
    public long Staff { get; set; }
    public Dictionary<string, long> MaterialsReserved { get; set; } = [];
    public long Progress { get; set; }
    public long RequiredProgress { get; set; }
    public long DailyProgress { get; set; }
    public long DailyFunding { get; set; }
    public long FundingRemaining { get; set; }
    public ResearchProjectStatus Status { get; set; }
    public DateOnly StartedOn { get; set; }
}

public sealed class TechnologyUnlock
{
    public string TechnologyId { get; set; } = "";
    public Guid StateId { get; set; }
    public Guid? DiscoveringInstitutionId { get; set; }
    public Guid? FundingStateId { get; set; }
    public DateOnly DiscoveredOn { get; set; }
    public string Cause { get; set; } = "";
}

public sealed class TechnologyAdoption
{
    public string TechnologyId { get; set; } = "";
    public Guid StateId { get; set; }
    public Guid? ProvinceId { get; set; }
    public string Sector { get; set; } = "";
    public DateOnly AdoptedOn { get; set; }
    public string Cause { get; set; } = "";
}

public sealed record TechnologyScenarioRequest(
    long ExpectedWorldVersion,
    IReadOnlyList<Technology> Technologies,
    IReadOnlyList<ResearchInstitution> ResearchInstitutions,
    IReadOnlyList<ResearchProject> ResearchProjects,
    IReadOnlyList<TechnologyUnlock> TechnologyUnlocks,
    IReadOnlyList<TechnologyAdoption> TechnologyAdoptions);
