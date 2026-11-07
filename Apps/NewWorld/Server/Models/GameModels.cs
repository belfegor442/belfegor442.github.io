using System.Text.Json.Serialization;

namespace NewWorld.Server.Models;

public sealed class WorldState
{
    public Guid Id { get; set; }
    public string Name { get; set; } = "New World";
    public Guid HostPlayerId { get; set; }
    public bool Started { get; set; }
    public bool Paused { get; set; }
    public GameStatus Status { get; set; } = GameStatus.Lobby;
    public int Day { get; set; } = 1;
    public DateOnly WorldDate { get; set; }
    public long WorldVersion { get; set; } = 1;
    public int EconomyVersion { get; set; }
    public string ScenarioId { get; set; } = "beleland";
    public string ScenarioVersion { get; set; } = "1.0";
    public int MapGeometryVersion { get; set; } = 1;
    public int MaxHumanPlayers { get; set; } = GameCatalog.MaxHumanPlayers;
    public DateTimeOffset LastTickUtc { get; set; }
    public long ClockAccumulatorTicks { get; set; }
    public long EventSequence { get; set; }
    public HashSet<Guid> PauseVotes { get; set; } = [];
    public List<PlayerState> Players { get; set; } = [];
    public List<GovernmentMembership> Memberships { get; set; } = [];
    public List<TerritoryState> Territories { get; set; } = [];
    public List<Province> Provinces { get; set; } = [];
    public List<Settlement> Settlements { get; set; } = [];
    public List<ProvinceConnection> ProvinceConnections { get; set; } = [];
    public List<TerritorialControl> TerritorialControls { get; set; } = [];
    public List<SovereigntyHistory> SovereigntyHistory { get; set; } = [];
    public List<MilitaryUnitType> MilitaryUnitTypes { get; set; } = [];
    public List<MilitaryCommander> MilitaryCommanders { get; set; } = [];
    public List<MilitaryUnit> MilitaryUnits { get; set; } = [];
    public List<MilitaryOrder> MilitaryOrders { get; set; } = [];
    public List<MilitaryBattle> MilitaryBattles { get; set; } = [];
    public List<MilitaryRoute> MilitaryRoutes { get; set; } = [];
    public List<SupplyRoute> SupplyRoutes { get; set; } = [];
    public List<Occupation> Occupations { get; set; } = [];
    public List<Technology> Technologies { get; set; } = [];
    public List<ResearchInstitution> ResearchInstitutions { get; set; } = [];
    public List<ResearchProject> ResearchProjects { get; set; } = [];
    public List<TechnologyUnlock> TechnologyUnlocks { get; set; } = [];
    public List<TechnologyAdoption> TechnologyAdoptions { get; set; } = [];
    public List<StatePoliticalSystem> PoliticalSystems { get; set; } = [];
    public List<EconomicGood> Goods { get; set; } = [];
    public List<ProductionRecipe> ProductionRecipes { get; set; } = [];
    public List<PopulationGroup> PopulationGroups { get; set; } = [];
    public List<EconomicCompany> Companies { get; set; } = [];
    public List<EconomicMarket> Markets { get; set; } = [];
    public List<EconomicTradeRoute> TradeRoutes { get; set; } = [];
    public List<StateCurrency> Currencies { get; set; } = [];
    public List<EconomicTransaction> FinancialTransactions { get; set; } = [];
    public List<CompanyFinancialTransaction> CompanyFinancialTransactions { get; set; } = [];
    public List<MarketSettlement> MarketHistory { get; set; } = [];
    public List<GameOrder> Orders { get; set; } = [];
    public List<WorldEvent> Events { get; set; } = [];
    public List<string> Activity { get; set; } = [];
}

public enum GameStatus
{
    Lobby,
    Running,
    Paused,
    Recovering,
    Closed
}

public enum MembershipStatus
{
    Invited,
    Active,
    Suspended,
    Left
}

public enum GameOrderType
{
    EstablishAdministration,
    ConstructBuilding,
    ApproveBudget,
    ProposeLaw,
    AppointOffice,
    NegotiateTreaty,
    MobilizeUnit,
    StartProject,
    CancelProject,
    AdoptTechnology,
    VotePoliticalDecision,
    PauseWorld,
    ResumeWorld,
    Unsupported
}

public enum GameOrderStatus
{
    Rejected,
    Executed
}

public sealed record GameOrder(
    Guid GameId,
    Guid Id,
    Guid PlayerId,
    Guid? StateId,
    GameOrderType Type,
    GameOrderStatus Status,
    GameOrderPayload Payload,
    long ExpectedWorldVersion,
    DateTimeOffset SubmittedAtUtc,
    DateOnly SubmittedOnWorldDate,
    string? ResultCode,
    string? Result,
    long WorldVersion,
    string? PermissionSetId = null,
    DateOnly? TargetWorldDate = null);

public sealed record WorldEvent(
    Guid Id,
    Guid GameId,
    Guid? OrderId,
    Guid? ActorPlayerId,
    Guid? StateId,
    string Type,
    string? ResultCode,
    DateTimeOffset OccurredAtUtc,
    DateOnly WorldDate,
    long WorldVersion,
    string Description,
    long Sequence = 0);

public sealed record GameOrderPayload(
    int? TerritoryIndex,
    int? PlotIndex,
    string? BuildingId,
    Guid? DecisionId = null,
    string? DecisionTitle = null,
    string? DecisionText = null,
    PoliticalVoteChoice? VoteChoice = null,
    Guid? OfficeId = null,
    Guid? AppointeePlayerId = null,
    int? ProposedBudget = null,
    Guid? MilitaryUnitId = null,
    MilitaryOrderType? MilitaryOrderType = null,
    Guid? DestinationProvinceId = null,
    Guid? MilitaryRouteId = null,
    Guid? ResearchProjectId = null,
    string? TechnologyId = null,
    string? ResearchSector = null,
    Guid? ProvinceId = null);

public sealed record OrderRejection(string Code, string Message);
public sealed record GameOrderResult(Guid Id, bool Accepted, string? Code, string? Error, bool Replayed);

public sealed class GovernmentMembership
{
    public Guid Id { get; set; }
    public Guid GameId { get; set; }
    public Guid PlayerId { get; set; }
    public Guid StateId { get; set; }
    public MembershipStatus Status { get; set; } = MembershipStatus.Active;
    public string PermissionSetId { get; set; } = "government-member";
    public DateOnly JoinedAtWorldDate { get; set; } = new(1500, 1, 1);
}

public sealed class PlayerState
{
    public Guid Id { get; set; }
    public string Name { get; set; } = "";
    public string TokenHash { get; set; } = "";
    public bool IsHost { get; set; }
    [JsonPropertyName("countryIndex")]
    public int? LegacyCountryIndex { get; set; }
    public int Treasury { get; set; } = 1200;
    public int DailyBalanceRemainder { get; set; }
    public Dictionary<int, BuildingState> Buildings { get; set; } = [];
}

public sealed class TerritoryState
{
    public Guid StateId { get; set; }
    public Guid CurrencyId { get; set; }
    public int Index { get; set; }
    public string Name { get; set; } = "";
    public int Treasury { get; set; }
    public int DailyBalanceRemainder { get; set; }
    public int Population { get; set; }
    public int Prosperity { get; set; }
    public int Infrastructure { get; set; }
    public Guid? OwnerPlayerId { get; set; }
}

public sealed record BuildingState(string Id, string Name, int Cost, int Income, string Icon, string Description);

public sealed record CreateGameRequest(string PlayerName);
public sealed record JoinGameRequest(string InviteCode, string PlayerName);
public sealed record AssignCountryRequest(Guid PlayerId, int? CountryIndex);
public sealed record UpdateGovernmentPermissionRequest(Guid MembershipId, string PermissionSetId);
public sealed record ApiError(string Error);
public sealed record SessionResponse(Guid GameId, string InviteCode, Guid PlayerId, string PlayerToken, GameSnapshot Game);
public sealed record GameSnapshot(
    Guid Id,
    bool Started,
    int Day,
    Guid HostPlayerId,
    bool Paused,
    IReadOnlyList<Guid> PauseVotePlayerIds,
    IReadOnlyList<PlayerView> Players,
    IReadOnlyList<TerritoryView> Territories,
    IReadOnlyList<string> Activity,
    string Name,
    GameStatus Status,
    DateOnly WorldDate,
    long WorldVersion,
    string ScenarioId,
    string ScenarioVersion,
    IReadOnlyList<GovernmentMembershipView> Memberships,
    long EventSequence,
    IReadOnlyList<WorldEvent> Events,
    IReadOnlyList<PoliticalStateView> PoliticalSystems,
    IReadOnlyList<EconomicGood> Goods,
    IReadOnlyList<ProductionRecipe> ProductionRecipes,
    IReadOnlyList<PopulationGroup> PopulationGroups,
    IReadOnlyList<EconomicMarket> Markets,
    IReadOnlyList<EconomicTradeRoute> TradeRoutes,
    IReadOnlyList<StateCurrency> Currencies,
    IReadOnlyList<EconomicTransaction> FinancialTransactions,
    IReadOnlyList<CompanyFinancialTransaction> CompanyFinancialTransactions,
    IReadOnlyList<MarketSettlement> MarketHistory,
    IReadOnlyList<EconomicCompanyView> Companies,
    IReadOnlyList<Province> Provinces,
    IReadOnlyList<Settlement> Settlements,
    IReadOnlyList<ProvinceConnection> ProvinceConnections,
    IReadOnlyList<TerritorialControl> TerritorialControls,
    IReadOnlyList<SovereigntyHistory> SovereigntyHistory,
    IReadOnlyList<MilitaryUnitType> MilitaryUnitTypes,
    IReadOnlyList<MilitaryCommander> MilitaryCommanders,
    IReadOnlyList<MilitaryUnit> MilitaryUnits,
    IReadOnlyList<MilitaryOrder> MilitaryOrders,
    IReadOnlyList<MilitaryBattle> MilitaryBattles,
    IReadOnlyList<MilitaryRoute> MilitaryRoutes,
    IReadOnlyList<SupplyRoute> SupplyRoutes,
    IReadOnlyList<Occupation> Occupations,
    IReadOnlyList<Technology> Technologies,
    IReadOnlyList<ResearchInstitution> ResearchInstitutions,
    IReadOnlyList<ResearchProject> ResearchProjects,
    IReadOnlyList<TechnologyUnlock> TechnologyUnlocks,
    IReadOnlyList<TechnologyAdoption> TechnologyAdoptions);
public sealed record PlayerView(
    Guid Id, string Name, bool IsHost, int? CountryIndex, int Treasury,
    IReadOnlyDictionary<int, BuildingState> Buildings, bool Connected,
    IReadOnlyList<GovernmentMembershipView> Memberships);
public sealed record GovernmentMembershipView(
    Guid Id, Guid PlayerId, Guid StateId, int StateIndex, MembershipStatus Status, string PermissionSetId);
public sealed record TerritoryView(
    Guid StateId, int Index, string Name, int Treasury, int TerritoryIncome, int CityIncome, int Upkeep,
    int MonthlyBalance, int Population, int Prosperity, int Infrastructure, Guid? OwnerPlayerId,
    Guid CurrencyId = default);
public sealed record ClientMessage(
    string Type, string? Token, Guid? GameId, int? TerritoryIndex, int? PlotIndex,
    string? BuildingId, Guid? OrderId, long? ExpectedWorldVersion, Guid? StateId,
    DateOnly? TargetWorldDate = null, long? LastEventSequence = null,
    Guid? DecisionId = null, string? DecisionTitle = null, string? DecisionText = null,
    PoliticalVoteChoice? VoteChoice = null,
    Guid? OfficeId = null, Guid? AppointeePlayerId = null,
    int? ProposedBudget = null,
    Guid? MilitaryUnitId = null,
    MilitaryOrderType? MilitaryOrderType = null,
    Guid? DestinationProvinceId = null,
    Guid? MilitaryRouteId = null,
    Guid? ResearchProjectId = null,
    string? TechnologyId = null,
    string? ResearchSector = null,
    Guid? ProvinceId = null);
public sealed record ServerMessage(
    string Type, string? Error = null, GameSnapshot? Game = null, GameOrderResult? Order = null);

public sealed record InitialTerritoryDefinition(string StableKey, string Name);

public static class GameCatalog
{
    public const int MaxHumanPlayers = 20;
    public const int LegacyConstructionPlotCount = 144;
    public const int WorldMapSize = 1024;
    public const int MaximumConstructionPlotIndexExclusive =
        LegacyConstructionPlotCount + WorldMapSize * WorldMapSize;

    public static bool IsValidConstructionPlotIndex(int? plotIndex) =>
        plotIndex is >= 0 && plotIndex < MaximumConstructionPlotIndexExclusive;

    public static int NormalizeConstructionPlotIndex(int plotIndex)
    {
        if (plotIndex < 0 || plotIndex >= LegacyConstructionPlotCount) return plotIndex;
        var row = WorldMapSize / 2 - 6 + plotIndex / 12;
        var col = WorldMapSize / 2 - 6 + plotIndex % 12;
        return LegacyConstructionPlotCount + row * WorldMapSize + col;
    }

    public static readonly InitialTerritoryDefinition[] InitialTerritories =
    [
        new("coimbrila", "Kingdom of Coimbrila"),
        new("gania", "United Provinces of Gania"),
        new("chungia", "Chungia"),
        new("calcilacia", "Calcilacia"),
        new("pician-empire", "Pician Empire"),
        new("meityeun-theocracy", "Meityeun Theocracy"),
        new("swabing", "Swabing"),
        new("alba", "Alba"),
        new("knosian-despotate", "Knosian Despotate"),
        new("kalestos", "Kalestos"),
        new("gorkirch", "Gorkirch"),
        new("shonewesia", "Duchy of Shonewesia"),
        new("shahtehaq", "Shahtehaq"),
        new("kvinian-empire", "Kvinian Empire"),
        new("shi", "Shi"),
        new("kueopia", "Kueopia")
    ];

    public static readonly string[] TerritoryNames =
        InitialTerritories.Select(item => item.Name).ToArray();

    public static readonly IReadOnlyDictionary<string, BuildingState> Buildings =
        new Dictionary<string, BuildingState>(StringComparer.Ordinal)
        {
            ["farm"] = new("farm", "FARM", 120, 18, "♧", "Food production and rural employment."),
            ["market"] = new("market", "MARKET", 220, 34, "⌂", "Local exchange and commercial activity."),
            ["workshop"] = new("workshop", "WORKSHOP", 360, 52, "⚒", "Small-scale manufacturing."),
            ["housing"] = new("housing", "HOUSING", 180, 8, "▦", "Raises the settlement population.")
        };
}
