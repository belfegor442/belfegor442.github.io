namespace NewWorld.Server.Models;

public sealed class WorldState
{
    public Guid Id { get; set; }
    public Guid HostPlayerId { get; set; }
    public bool Started { get; set; }
    public int Day { get; set; } = 1;
    public DateTimeOffset LastTickUtc { get; set; }
    public List<PlayerState> Players { get; set; } = [];
    public List<TerritoryState> Territories { get; set; } = [];
    public List<string> Activity { get; set; } = [];
}

public sealed class PlayerState
{
    public Guid Id { get; set; }
    public string Name { get; set; } = "";
    public string TokenHash { get; set; } = "";
    public bool IsHost { get; set; }
    public int? CountryIndex { get; set; }
    public int Treasury { get; set; } = 1200;
    public Dictionary<int, BuildingState> Buildings { get; set; } = [];
}

public sealed class TerritoryState
{
    public int Index { get; set; }
    public string Name { get; set; } = "";
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
    IReadOnlyList<PlayerView> Players,
    IReadOnlyList<TerritoryView> Territories,
    IReadOnlyList<string> Activity);
public sealed record PlayerView(Guid Id, string Name, bool IsHost, int? CountryIndex, int Treasury, IReadOnlyDictionary<int, BuildingState> Buildings, bool Connected);
public sealed record TerritoryView(int Index, string Name, int Population, int Prosperity, int Infrastructure, Guid? OwnerPlayerId);
public sealed record ClientMessage(string Type, string? Token, Guid? GameId, int? TerritoryIndex, int? PlotIndex, string? BuildingId);
public sealed record ServerMessage(string Type, string? Error = null, GameSnapshot? Game = null);

public static class GameCatalog
{
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
