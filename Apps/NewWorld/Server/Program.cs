using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading.RateLimiting;
using NewWorld.Server.Models;
using NewWorld.Server.Services;
using Npgsql;

var builder = WebApplication.CreateBuilder(args);
builder.Services.ConfigureHttpJsonOptions(options =>
    options.SerializerOptions.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.CamelCase)));
var allowedOrigins = (Environment.GetEnvironmentVariable("NEW_WORLD_ALLOWED_ORIGINS") ??
        "http://localhost:8765;http://127.0.0.1:8765;https://belfegor442.github.io")
    .Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
    .ToHashSet(StringComparer.OrdinalIgnoreCase);
var connectionString = builder.Configuration.GetConnectionString("NewWorld")
    ?? throw new InvalidOperationException("Set ConnectionStrings__NewWorld before starting the server.");

builder.Services.AddSingleton(NpgsqlDataSource.Create(connectionString));
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddSingleton<GameStore>();
builder.Services.AddSingleton<GameHub>();
builder.Services.AddHostedService<WorldClock>();
builder.Services.AddCors(options => options.AddDefaultPolicy(policy =>
    policy.WithOrigins(allowedOrigins.ToArray()).AllowAnyHeader().AllowAnyMethod()));
builder.Services.AddRateLimiter(options =>
{
    options.AddPolicy("lobby", context =>
        RateLimitPartition.GetFixedWindowLimiter(
            context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 30,
                Window = TimeSpan.FromMinutes(1),
                QueueLimit = 0,
                AutoReplenishment = true
            }));
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
});

var app = builder.Build();
app.UseExceptionHandler("/error");
app.Map("/error", () => Results.Problem("The server could not complete the request."));
app.UseRateLimiter();
app.UseCors();
app.UseWebSockets(new WebSocketOptions { KeepAliveInterval = TimeSpan.FromSeconds(30) });

var store = app.Services.GetRequiredService<GameStore>();
await store.InitializeAsync(app.Lifetime.ApplicationStopping);

app.MapGet("/api/health", async (NpgsqlDataSource database, CancellationToken cancellationToken) =>
{
    await using var connection = await database.OpenConnectionAsync(cancellationToken);
    await using var command = new NpgsqlCommand("SELECT 1", connection);
    await command.ExecuteScalarAsync(cancellationToken);
    return Results.Ok(new { status = "ready" });
});

app.MapPost("/api/games", async (CreateGameRequest request, GameStore gameStore, CancellationToken cancellationToken) =>
{
    if (!TryNormalizeName(request.PlayerName, out var playerName))
        return Results.BadRequest(new ApiError("Player name must be 2–24 characters."));

    var (game, inviteCode, playerToken) = await gameStore.CreateAsync(playerName, cancellationToken);
    var snapshot = GameHub.BuildSnapshot(game, new HashSet<Guid>());
    return Results.Ok(new SessionResponse(game.Id, inviteCode, game.HostPlayerId, playerToken, snapshot));
}).RequireRateLimiting("lobby");

app.MapPost("/api/games/join", async (JoinGameRequest request, GameStore gameStore, GameHub hub, CancellationToken cancellationToken) =>
{
    if (!TryNormalizeName(request.PlayerName, out var playerName))
        return Results.BadRequest(new ApiError("Player name must be 2–24 characters."));
    if (string.IsNullOrWhiteSpace(request.InviteCode) || request.InviteCode.Length > 64)
        return Results.BadRequest(new ApiError("A valid invite code is required."));

    var (game, playerToken, error) = await gameStore.JoinAsync(request.InviteCode.Trim(), playerName, cancellationToken);
    if (error is not null)
        return Results.BadRequest(new ApiError(error));

    var player = game!.Players.Single(item => item.TokenHash == GameStore.Hash(playerToken!));
    await hub.BroadcastAsync(game.Id, cancellationToken);
    var snapshot = GameHub.BuildSnapshot(game, hub.ConnectedPlayers(game.Id));
    return Results.Ok(new SessionResponse(game.Id, "", player.Id, playerToken!, snapshot));
}).RequireRateLimiting("lobby");

app.MapGet("/api/games/{gameId:guid}", async (
    Guid gameId, long? afterEventSequence, HttpContext context, GameStore gameStore, GameHub hub,
    CancellationToken cancellationToken) =>
{
    var token = GetBearerToken(context);
    if (token is null)
        return Results.Unauthorized();
    var (game, player) = await gameStore.GetAuthorizedAsync(gameId, token, cancellationToken);
    if (game is null || player is null)
        return Results.Unauthorized();
    return Results.Ok(GameHub.BuildSnapshot(
        game, hub.ConnectedPlayers(gameId),
        Math.Clamp(afterEventSequence ?? 0, 0, game.EventSequence)));
});

app.MapGet("/api/games/{gameId:guid}/orders", async (
    Guid gameId, HttpContext context, GameStore gameStore, CancellationToken cancellationToken) =>
{
    var token = GetBearerToken(context);
    if (token is null)
        return Results.Unauthorized();
    var (game, player) = await gameStore.GetAuthorizedAsync(gameId, token, cancellationToken);
    if (game is null || player is null)
        return Results.Unauthorized();
    return Results.Ok(game.Orders);
});

app.MapGet("/api/games/{gameId:guid}/events", async (
    Guid gameId, HttpContext context, GameStore gameStore, CancellationToken cancellationToken) =>
{
    var token = GetBearerToken(context);
    if (token is null)
        return Results.Unauthorized();
    var (game, player) = await gameStore.GetAuthorizedAsync(gameId, token, cancellationToken);
    if (game is null || player is null)
        return Results.Unauthorized();
    return Results.Ok(game.Events);
});

app.MapPost("/api/games/{gameId:guid}/assign", async (
    Guid gameId, AssignCountryRequest request, HttpContext context, GameStore gameStore, GameHub hub,
    CancellationToken cancellationToken) =>
{
    var token = GetBearerToken(context);
    if (token is null)
        return Results.Unauthorized();
    if (request.CountryIndex is < 0 or >= 16)
        return Results.BadRequest(new ApiError("Invalid state assignment."));

    var result = await gameStore.MutateAsync(gameId, token, (game, actor) =>
    {
        if (!actor.IsHost)
            return "Only the host can assign states.";
        if (game.Started)
            return "State assignments are locked after the world starts.";
        var assignmentError = GovernmentMembershipRules.Assign(game, request.PlayerId, request.CountryIndex);
        if (assignmentError is not null)
            return assignmentError;
        var target = game.Players.Single(player => player.Id == request.PlayerId);
        GameStore.AddActivity(game, request.CountryIndex is int
            ? $"{actor.Name} assigned {game.Territories[request.CountryIndex.Value].Name} to {target.Name}."
            : $"{actor.Name} unassigned {target.Name}.");
        return null;
    }, cancellationToken, "government.membership_changed");

    if (result.Error is not null)
        return Results.BadRequest(new ApiError(result.Error));
    await hub.BroadcastAsync(gameId, cancellationToken);
    return Results.Ok(GameHub.BuildSnapshot(result.Game!, hub.ConnectedPlayers(gameId)));
});

app.MapPost("/api/games/{gameId:guid}/start", async (
    Guid gameId, HttpContext context, GameStore gameStore, GameHub hub, CancellationToken cancellationToken) =>
{
    var token = GetBearerToken(context);
    if (token is null)
        return Results.Unauthorized();
    var result = await gameStore.MutateAsync(gameId, token, (game, player) =>
    {
        if (!player.IsHost)
            return "Only the host can start the world.";
        if (game.Started)
            return "The world has already started.";
        if (game.Players.Any(item => !game.Memberships.Any(membership =>
                membership.PlayerId == item.Id && membership.Status == MembershipStatus.Active)))
            return "Assign a state to every player before starting.";
        game.Started = true;
        game.Status = GameStatus.Running;
        game.LastTickUtc = DateTimeOffset.UtcNow;
        GameStore.AddActivity(game, "The world began.");
        return null;
    }, cancellationToken, "world.started");

    if (result.Error is not null)
        return Results.BadRequest(new ApiError(result.Error));
    await hub.BroadcastAsync(gameId, cancellationToken);
    return Results.Ok(GameHub.BuildSnapshot(result.Game!, hub.ConnectedPlayers(gameId)));
});

app.MapPut("/api/games/{gameId:guid}/economy", async (
    Guid gameId, EconomyScenarioRequest request, HttpContext context,
    GameStore gameStore, GameHub hub, CancellationToken cancellationToken) =>
{
    var token = GetBearerToken(context);
    if (token is null)
        return Results.Unauthorized();
    var result = await gameStore.MutateAsync(
        gameId,
        token,
        (game, player) =>
        {
            if (!player.IsHost)
                return "Only the host can configure the technical scenario before it starts.";
            return EconomySetupRules.Configure(game, request);
        },
        cancellationToken,
        "economy.scenario_configured");
    if (result.Error is not null)
        return Results.BadRequest(new ApiError(result.Error));
    await hub.BroadcastAsync(gameId, cancellationToken);
    return Results.Ok(GameHub.BuildSnapshot(result.Game!, hub.ConnectedPlayers(gameId)));
});

app.MapPut("/api/games/{gameId:guid}/politics", async (
    Guid gameId, PoliticalScenarioRequest request, HttpContext context,
    GameStore gameStore, GameHub hub, CancellationToken cancellationToken) =>
{
    var token = GetBearerToken(context);
    if (token is null)
        return Results.Unauthorized();
    var result = await gameStore.MutateAsync(
        gameId,
        token,
        (game, player) =>
        {
            if (!player.IsHost)
                return "Only the host can configure political systems before the world starts.";
            return PoliticalSetupRules.Configure(game, request);
        },
        cancellationToken,
        "politics.configured");
    if (result.Error is not null)
        return Results.BadRequest(new ApiError(result.Error));
    await hub.BroadcastAsync(gameId, cancellationToken);
    return Results.Ok(GameHub.BuildSnapshot(result.Game!, hub.ConnectedPlayers(gameId)));
});

app.Map("/ws", (HttpContext context, GameHub hub) => hub.HandleAsync(context, allowedOrigins));

app.Run();

static string? GetBearerToken(HttpContext context)
{
    var header = context.Request.Headers.Authorization.ToString();
    return header.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase)
        ? header[7..].Trim()
        : null;
}

static bool TryNormalizeName(string? value, out string name)
{
    name = value?.Trim() ?? "";
    return name.Length is >= 2 and <= 24 && !name.Any(char.IsControl);
}
