using NewWorld.Server.Models;
using NewWorld.Server.Services;

namespace NewWorld.Server.Tests;

public sealed class InitialScenarioTests
{
    [Fact]
    public void InitialScenarioHasSixteenStatesWithStableDistinctIdentities()
    {
        Assert.Equal(
            new[]
            {
                "Kingdom of Coimbrila", "United Provinces of Gania", "Chungia", "Calcilacia",
                "Pician Empire", "Meityeun Theocracy", "Swabing", "Alba", "Knosian Despotate",
                "Kalestos", "Gorkirch", "Duchy of Shonewesia", "Shahtehaq", "Kvinian Empire",
                "Shi", "Kueopia"
            },
            GameCatalog.TerritoryNames);
        Assert.Equal(16, GameCatalog.InitialTerritories.Length);
        Assert.Equal(
            GameCatalog.InitialTerritories.Length,
            GameCatalog.InitialTerritories.Select(item => item.StableKey)
                .Distinct(StringComparer.Ordinal).Count());

        var stateIds = GameCatalog.InitialTerritories
            .Select(item => ScenarioIdentity.Create("state", item.StableKey))
            .ToArray();
        var repeatedStateIds = GameCatalog.InitialTerritories
            .Select(item => ScenarioIdentity.Create("state", item.StableKey))
            .ToArray();
        var currencyIds = GameCatalog.InitialTerritories
            .Select(item => ScenarioIdentity.Create("currency", item.StableKey))
            .ToArray();

        Assert.Equal(stateIds, repeatedStateIds);
        Assert.Equal(stateIds.Length, stateIds.Distinct().Count());
        Assert.Equal(currencyIds.Length, currencyIds.Distinct().Count());
        Assert.Empty(stateIds.Intersect(currencyIds));
    }
}
