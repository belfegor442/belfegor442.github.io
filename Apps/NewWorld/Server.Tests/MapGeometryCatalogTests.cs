using System.Security.Cryptography;
using System.Xml.Linq;
using NewWorld.Server.Services;

namespace NewWorld.Server.Tests;

public sealed class MapGeometryCatalogTests
{
    [Fact]
    public void VersionedCatalogMatchesGeometryIdsAndHashOfOriginalSvg()
    {
        var svgPath = Path.Combine(AppContext.BaseDirectory, "map.svg");
        var svgBytes = System.Text.Encoding.UTF8.GetBytes(
            File.ReadAllText(svgPath).Replace("\r\n", "\n", StringComparison.Ordinal).Replace('\r', '\n'));
        var svg = XDocument.Load(svgPath);
        var excludedDefinitions = new HashSet<string>(
            ["defs", "clipPath", "mask", "pattern", "filter", "symbol"],
            StringComparer.Ordinal);
        var expectedIds = svg.Descendants()
            .Where(element => element.Name.LocalName is "path" or "g")
            .Where(element => !element.Ancestors().Any(ancestor =>
                excludedDefinitions.Contains(ancestor.Name.LocalName)))
            .Where(element => element.Name.LocalName != "g" ||
                element.Descendants().Any(descendant => descendant.Name.LocalName == "path"))
            .Select(element => (string?)element.Attribute("id"))
            .Where(id => !string.IsNullOrWhiteSpace(id))
            .Order(StringComparer.Ordinal)
            .ToArray();

        Assert.Equal(expectedIds, MapGeometryCatalog.ElementIds.Order(StringComparer.Ordinal));
        Assert.Equal(
            Convert.ToHexString(SHA256.HashData(svgBytes)),
            MapGeometryCatalog.SvgSha256);
        Assert.True(MapGeometryCatalog.MapVersion > 0);
    }

    [Fact]
    public void CatalogAcceptsRealMapGeometryAndRejectsUnknownIds()
    {
        Assert.True(MapGeometryCatalog.Contains("state1"));
        Assert.False(MapGeometryCatalog.Contains("province-not-in-the-map"));
    }
}
