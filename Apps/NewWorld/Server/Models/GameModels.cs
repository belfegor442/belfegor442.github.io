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
    public int MaxHumanPlayers { get; set; } = GameCatalog.MaxHumanPlayers;
    public DateTimeOffset LastTickUtc { get; set; }
    public long ClockAccumulatorTicks { get; set; }
    public HashSet<Guid> PauseVotes { get; set; } = [];
    public List<PlayerState> Players { get; set; } = [];
    public List<GovernmentMembership> Memberships { get; set; } = [];
    public List<TerritoryState> Territories { get; set; } = [];
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
    string Description);

public sealed record GameOrderPayload(int? TerritoryIndex, int? PlotIndex, string? BuildingId);

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
    IReadOnlyList<GovernmentMembershipView> Memberships);
public sealed record PlayerView(
    Guid Id, string Name, bool IsHost, int? CountryIndex, int Treasury,
    IReadOnlyDictionary<int, BuildingState> Buildings, bool Connected,
    IReadOnlyList<GovernmentMembershipView> Memberships);
public sealed record GovernmentMembershipView(
    Guid Id, Guid PlayerId, Guid StateId, int StateIndex, MembershipStatus Status, string PermissionSetId);
public sealed record TerritoryView(
    Guid StateId, int Index, string Name, int Treasury, int TerritoryIncome, int CityIncome, int Upkeep,
    int MonthlyBalance, int Population, int Prosperity, int Infrastructure, Guid? OwnerPlayerId);
public sealed record ClientMessage(
    string Type, string? Token, Guid? GameId, int? TerritoryIndex, int? PlotIndex,
    string? BuildingId, Guid? OrderId, long? ExpectedWorldVersion, Guid? StateId,
    DateOnly? TargetWorldDate = null);
public sealed record ServerMessage(
    string Type, string? Error = null, GameSnapshot? Game = null, GameOrderResult? Order = null);

public static class GameCatalog
{
    public const int MaxHumanPlayers = 20;

    public static readonly string[] TerritoryNames =
    [
        "Kingdom of Coimbrila", "United Provinces of Gania", "Chungia", "Calcilacia",
        "Pician Empire", "Meityeun Theocracy", "Swabing", "Alba", "Knosian Despotate",
        "Kalestos", "Gorkirch", "Duchy of Shonewesia", "Shahtehaq", "Kvinian Empire",
        "Shi", "Kueopia"
    ];

    public static readonly IReadOnlyDictionary<string, BuildingState> Buildings =
        new Dictionary<string, BuildingState>(StringComparer.Ordinal)
        {
            ["farm"] = new("farm", "FARM", 120, 18, "♧", "Food production and rural employment."),
            ["market"] = new("market", "MARKET", 220, 34, "⌂", "Local exchange and commercial activity."),
            ["workshop"] = new("workshop", "WORKSHOP", 360, 52, "⚒", "Small-scale manufacturing."),
            ["housing"] = new("housing", "HOUSING", 180, 8, "▦", "Raises the settlement population.")
        };
}
