using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using NewWorld.Server.Models;

namespace NewWorld.Server.Services;

public static class WorldSnapshotRules
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) }
    };

    public static string Serialize(WorldState game)
    {
        var snapshot = JsonSerializer.Serialize(game, JsonOptions);
        _ = DeserializeAndValidate(snapshot, game.Id);
        return snapshot;
    }

    public static WorldState DeserializeAndValidate(string snapshot, Guid expectedGameId)
    {
        WorldState game;
        try
        {
            game = JsonSerializer.Deserialize<WorldState>(snapshot, JsonOptions)
                ?? throw new InvalidDataException("The saved world snapshot is empty.");
        }
        catch (JsonException exception)
        {
            throw new InvalidDataException("The saved world snapshot has an invalid schema.", exception);
        }

        return Validate(game, expectedGameId);
    }

    public static WorldState Validate(WorldState game, Guid expectedGameId)
    {
        WorldStateCompatibility.Normalize(game);
        if (game.Id != expectedGameId ||
            game.HostPlayerId == Guid.Empty ||
            game.MapGeometryVersion < 1 ||
            !game.Players.Any(player => player.Id == game.HostPlayerId && player.IsHost))
            throw new InvalidDataException("The saved world snapshot contains invalid game or host references.");

        return game;
    }

    public static string CalculateChecksum(string snapshot) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(snapshot)));

    public static bool HasValidChecksum(string snapshot, string? checksum)
    {
        if (checksum is null)
            return false;

        byte[] expectedChecksum;
        try
        {
            expectedChecksum = Convert.FromHexString(checksum);
        }
        catch (FormatException)
        {
            return false;
        }

        return expectedChecksum.Length == SHA256.HashSizeInBytes &&
               CryptographicOperations.FixedTimeEquals(
                   expectedChecksum,
                   SHA256.HashData(Encoding.UTF8.GetBytes(snapshot)));
    }

    public static (WorldState? Game, string? Error, bool Unauthorized) ValidateRestore(
        string snapshot, string? checksum, Guid expectedGameId, string token)
    {
        if (!HasValidChecksum(snapshot, checksum))
            return (null, "The previous save failed its integrity check.", false);

        WorldState game;
        try
        {
            game = DeserializeAndValidate(snapshot, expectedGameId);
        }
        catch (InvalidDataException)
        {
            return (null, "The previous save failed schema or reference validation.", false);
        }

        if (!IsAuthorizedHost(game, token))
            return (null, "Only the host can recover this world.", true);

        return (game, null, false);
    }

    public static bool IsAuthorizedHost(WorldState game, string token)
    {
        var host = game.Players.SingleOrDefault(player =>
            player.Id == game.HostPlayerId && player.IsHost);
        if (host is null)
            return false;

        try
        {
            return CryptographicOperations.FixedTimeEquals(
                Convert.FromHexString(host.TokenHash),
                Convert.FromHexString(GameStore.Hash(token)));
        }
        catch (FormatException)
        {
            return false;
        }
    }

    public static bool TryReadVersionMarkers(
        string snapshot, out long worldVersion, out long eventSequence)
    {
        worldVersion = 0;
        eventSequence = 0;
        try
        {
            using var document = JsonDocument.Parse(snapshot);
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object ||
                !TryReadNonNegativeInt64(root, "worldVersion", out worldVersion) ||
                !TryReadNonNegativeInt64(root, "eventSequence", out eventSequence))
                return false;
            return true;
        }
        catch (JsonException)
        {
            return false;
        }
    }

    private static bool TryReadNonNegativeInt64(JsonElement value, string propertyName, out long result)
    {
        result = 0;
        return value.TryGetProperty(propertyName, out var property) &&
               property.ValueKind == JsonValueKind.Number &&
               property.TryGetInt64(out result) &&
               result >= 0;
    }
}
