namespace NewWorld.Server.Models;

public enum GeographicConnectionType
{
    Land,
    Sea
}

public enum TerritorialControlType
{
    Military,
    Administrative,
    Treaty
}

public sealed class Province
{
    public Guid Id { get; set; }
    public Guid SovereignStateId { get; set; }
    public string Name { get; set; } = "";
    public string SvgElementId { get; set; } = "";
    public string TerrainId { get; set; } = "";
    public string ClimateId { get; set; } = "";
    public Guid? CapitalSettlementId { get; set; }
    public long Population { get; set; }
    public Dictionary<string, long> Resources { get; set; } = [];
    public Dictionary<string, long> Infrastructure { get; set; } = [];
}

public sealed class Settlement
{
    public Guid Id { get; set; }
    public Guid ProvinceId { get; set; }
    public string Name { get; set; } = "";
    public string Type { get; set; } = "";
    public long Population { get; set; }
    public Dictionary<string, long> Infrastructure { get; set; } = [];
    public Dictionary<string, long> Services { get; set; } = [];
    public Dictionary<string, long> Buildings { get; set; } = [];
}

public sealed class ProvinceConnection
{
    public Guid Id { get; set; }
    public Guid FromProvinceId { get; set; }
    public Guid ToProvinceId { get; set; }
    public GeographicConnectionType Type { get; set; }
    public long AbstractDistance { get; set; }
    public bool Bidirectional { get; set; } = true;
    public HashSet<Guid> RestrictedToStateIds { get; set; } = [];
}

public sealed class TerritorialControl
{
    public Guid Id { get; set; }
    public Guid ProvinceId { get; set; }
    public Guid StateId { get; set; }
    public TerritorialControlType Type { get; set; }
    public DateOnly EffectiveFrom { get; set; }
    public DateOnly? EffectiveUntil { get; set; }
    public string Cause { get; set; } = "";
}

public sealed class SovereigntyHistory
{
    public Guid Id { get; set; }
    public Guid ProvinceId { get; set; }
    public Guid? PreviousStateId { get; set; }
    public Guid NewStateId { get; set; }
    public DateOnly EffectiveOn { get; set; }
    public string LegalMechanism { get; set; } = "";
    public Guid? CausalEventId { get; set; }
}

public sealed record TerritoryScenarioRequest(
    long ExpectedWorldVersion,
    IReadOnlyList<Province> Provinces,
    IReadOnlyList<Settlement> Settlements,
    IReadOnlyList<ProvinceConnection> Connections,
    IReadOnlyList<TerritorialControl> Controls,
    IReadOnlyList<SovereigntyHistory> SovereigntyHistory);
