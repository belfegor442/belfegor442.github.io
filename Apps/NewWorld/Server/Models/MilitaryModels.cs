namespace NewWorld.Server.Models;

public enum MilitaryUnitCategory
{
    Infantry,
    Cavalry,
    Artillery,
    Navy,
    Garrison
}

public enum MilitaryUnitStatus
{
    Active,
    Recruiting,
    Supplied,
    Isolated,
    Disbanded
}

public enum MilitaryOrderType
{
    Move,
    Defend,
    Attack,
    Retreat,
    Patrol,
    Siege,
    Transport,
    Resupply
}

public enum MilitaryOrderStatus
{
    Pending,
    InProgress,
    Completed,
    Interrupted,
    Rejected
}

public enum MilitaryCasualtyType
{
    Killed,
    Wounded,
    Missing,
    Captured,
    Deserted
}

public sealed class MilitaryUnitType
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public MilitaryUnitCategory Category { get; set; }
    public long RequiredPersonnel { get; set; }
    public Dictionary<string, long> RequiredEquipment { get; set; } = [];
    public int RecruitmentDays { get; set; }
    public Dictionary<Guid, long> RecruitmentCosts { get; set; } = [];
    public Dictionary<Guid, long> DailyMaintenanceCosts { get; set; } = [];
    public long SupplyCapacity { get; set; }
    public long Mobility { get; set; }
    public HashSet<string> RequiredTechnologyIds { get; set; } = [];
    public HashSet<string> CommandPermissionSetIds { get; set; } = [];
}

public sealed class MilitaryCommander
{
    public Guid Id { get; set; }
    public Guid StateId { get; set; }
    public string Name { get; set; } = "";
    public Dictionary<string, decimal> Attributes { get; set; } = [];
}

public sealed class MilitaryUnit
{
    public Guid Id { get; set; }
    public Guid StateId { get; set; }
    public string UnitTypeId { get; set; } = "";
    public Guid ProvinceId { get; set; }
    public long Personnel { get; set; }
    public Dictionary<string, long> Equipment { get; set; } = [];
    public Dictionary<string, long> Supplies { get; set; } = [];
    public decimal Training { get; set; }
    public decimal Morale { get; set; }
    public decimal Experience { get; set; }
    public Guid? CommanderId { get; set; }
    public MilitaryUnitStatus Status { get; set; } = MilitaryUnitStatus.Active;
}

public sealed class MilitaryRoute
{
    public Guid Id { get; set; }
    public Guid OriginProvinceId { get; set; }
    public Guid DestinationProvinceId { get; set; }
    public List<Guid> ProvincePath { get; set; } = [];
    public List<int> SegmentTravelDays { get; set; } = [];
    public int TravelDays { get; set; }
    public long Capacity { get; set; }
    public string CapacityUnit { get; set; } = "";
    public decimal Risk { get; set; }
    public string RiskBasis { get; set; } = "";
    public Dictionary<string, long> DailySupplyConsumption { get; set; } = [];
    public HashSet<Guid> PermittedStateIds { get; set; } = [];
    public bool Enabled { get; set; } = true;
}

public sealed class MilitaryOrder
{
    public Guid Id { get; set; }
    public Guid GameId { get; set; }
    public Guid StateId { get; set; }
    public Guid UnitId { get; set; }
    public Guid IssuerPlayerId { get; set; }
    public MilitaryOrderType Type { get; set; }
    public Guid? DestinationProvinceId { get; set; }
    public Guid? TargetUnitId { get; set; }
    public Guid? RouteId { get; set; }
    public DateOnly SubmittedOnWorldDate { get; set; }
    public MilitaryOrderStatus Status { get; set; }
    public int TravelDaysRemaining { get; set; }
    public int CurrentPathIndex { get; set; }
    public int DaysToNextProvince { get; set; }
    public string? RejectionReason { get; set; }
}

public sealed class MilitaryBattle
{
    public Guid Id { get; set; }
    public Guid ProvinceId { get; set; }
    public DateOnly WorldDate { get; set; }
    public List<Guid> ParticipantUnitIds { get; set; } = [];
    public Dictionary<Guid, Dictionary<MilitaryCasualtyType, long>> CasualtiesByUnit { get; set; } = [];
    public string? Result { get; set; }
    public List<string> Phases { get; set; } = [];
}

public sealed class SupplyRoute
{
    public Guid Id { get; set; }
    public Guid StateId { get; set; }
    public Guid OriginProvinceId { get; set; }
    public Guid DestinationProvinceId { get; set; }
    public List<Guid> ProvincePath { get; set; } = [];
    public List<int> SegmentTravelDays { get; set; } = [];
    public long Capacity { get; set; }
    public string CapacityUnit { get; set; } = "";
    public int TravelDays { get; set; }
    public decimal Risk { get; set; }
    public string RiskBasis { get; set; } = "";
    public Dictionary<string, long> DailySupplyConsumption { get; set; } = [];
    public bool Enabled { get; set; } = true;
}

public sealed class Occupation
{
    public Guid Id { get; set; }
    public Guid ProvinceId { get; set; }
    public Guid OccupyingStateId { get; set; }
    public Guid? SovereignStateId { get; set; }
    public DateOnly StartedOn { get; set; }
    public long OccupyingForce { get; set; }
    public long Resistance { get; set; }
    public int DurationDays { get; set; }
    public int RequiredControlDays { get; set; }
    public bool ControlEffective { get; set; }
    public Guid? ControlRecordId { get; set; }
}

public sealed record MilitaryScenarioRequest(
    long ExpectedWorldVersion,
    IReadOnlyList<MilitaryUnitType> UnitTypes,
    IReadOnlyList<MilitaryCommander> Commanders,
    IReadOnlyList<MilitaryUnit> Units,
    IReadOnlyList<MilitaryRoute> Routes,
    IReadOnlyList<SupplyRoute> SupplyRoutes,
    IReadOnlyList<Occupation>? Occupations = null);
