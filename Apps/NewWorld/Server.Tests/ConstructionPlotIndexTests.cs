using NewWorld.Server.Models;
using Xunit;

namespace NewWorld.Server.Tests;

public sealed class ConstructionPlotIndexTests
{
    [Theory]
    [InlineData(-1, false)]
    [InlineData(0, true)]
    [InlineData(143, true)]
    [InlineData(144, true)]
    [InlineData(524944, true)]
    [InlineData(1048719, true)]
    [InlineData(1048720, false)]
    public void ConstructionPlotValidationCoversTheEntireOpenWorld(int plotIndex, bool expected)
    {
        Assert.Equal(expected, GameCatalog.IsValidConstructionPlotIndex(plotIndex));
    }

    [Theory]
    [InlineData(0, 518794)]
    [InlineData(143, 530069)]
    public void LegacyPlotsNormalizeToTheirOriginalCentralWorldCoordinates(int legacyIndex, int worldIndex)
    {
        Assert.Equal(worldIndex, GameCatalog.NormalizeConstructionPlotIndex(legacyIndex));
    }

    [Fact]
    public void WorldMapHasMoreThanOneMillionBuildableCoordinates()
    {
        Assert.Equal(1024, GameCatalog.WorldMapSize);
        Assert.Equal(144 + 1024 * 1024, GameCatalog.MaximumConstructionPlotIndexExclusive);
    }
}
