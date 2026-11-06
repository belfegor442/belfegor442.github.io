using System.Reflection;
using System.Text.Json;

namespace NewWorld.Server.Services;

public static class MapGeometryCatalog
{
    private const string ResourceName = "NewWorld.Server.Data.beleland-map-geometry.json";
    private static readonly Lazy<GeometryCatalog> Catalog = new(Load);

    public static int MapVersion => Catalog.Value.MapVersion;
    public static string SvgSha256 => Catalog.Value.SvgSha256;
    public static IReadOnlyCollection<string> ElementIds => Catalog.Value.ElementIds.ToArray();

    public static bool Contains(string elementId) =>
        Catalog.Value.ElementIds.Contains(elementId);

    private static GeometryCatalog Load()
    {
        using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(ResourceName)
            ?? throw new InvalidDataException("The versioned Beleland map geometry catalog is missing.");
        using var document = JsonDocument.Parse(stream);
        var root = document.RootElement;
        var mapId = root.GetProperty("mapId").GetString();
        var mapVersion = root.GetProperty("mapVersion").GetInt32();
        var svgSha256 = root.GetProperty("svgSha256").GetString();
        var elementIds = root.GetProperty("elementIds")
            .EnumerateArray()
            .Select(item => item.GetString())
            .ToArray();

        if (mapId != "beleland" ||
            mapVersion < 1 ||
            svgSha256 is null ||
            elementIds.Length == 0 ||
            elementIds.Any(string.IsNullOrWhiteSpace))
            throw new InvalidDataException("The versioned Beleland map geometry catalog is invalid.");

        try
        {
            if (Convert.FromHexString(svgSha256).Length != 32)
                throw new InvalidDataException("The Beleland SVG checksum is invalid.");
        }
        catch (FormatException exception)
        {
            throw new InvalidDataException("The Beleland SVG checksum is invalid.", exception);
        }

        var uniqueIds = new HashSet<string>(elementIds!, StringComparer.Ordinal);
        if (uniqueIds.Count != elementIds.Length)
            throw new InvalidDataException("The Beleland map geometry catalog contains duplicate IDs.");

        return new GeometryCatalog(mapVersion, svgSha256, uniqueIds);
    }

    private sealed record GeometryCatalog(int MapVersion, string SvgSha256, HashSet<string> ElementIds);
}
