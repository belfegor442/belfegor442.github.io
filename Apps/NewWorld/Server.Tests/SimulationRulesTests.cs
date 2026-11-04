using NewWorld.Server.Models;
using NewWorld.Server.Services;

namespace NewWorld.Server.Tests;

public sealed class SimulationRulesTests
{
    [Theory]
    [InlineData(85, 30, 85)]
    [InlineData(93, 30, 93)]
    [InlineData(-93, 30, -93)]
    [InlineData(1, 30, 1)]
    public void AccrueDailyBalancePreservesMonthlyTotal(int monthlyBalance, int days, int expectedChange)
    {
        var player = new PlayerState { Treasury = 1000 };

        for (var day = 0; day < days; day++)
            SimulationRules.AccrueDailyBalance(player, monthlyBalance);

        Assert.Equal(1000 + expectedChange, player.Treasury);
        Assert.Equal(0, player.DailyBalanceRemainder);
    }

    [Fact]
    public void AccrueDailyBalanceCarriesFractionsAcrossChangingDailyBalances()
    {
        var player = new PlayerState { Treasury = 1000 };

        for (var day = 0; day < 15; day++)
            SimulationRules.AccrueDailyBalance(player, 93);
        for (var day = 0; day < 15; day++)
            SimulationRules.AccrueDailyBalance(player, 60);

        Assert.Equal(1076, player.Treasury);
        Assert.Equal(15, player.DailyBalanceRemainder);
    }

    [Fact]
    public void AccrueDailyBalanceNeverCreatesTreasuryDebt()
    {
        var player = new PlayerState { Treasury = 2 };

        var change = SimulationRules.AccrueDailyBalance(player, -90);

        Assert.Equal(-2, change);
        Assert.Equal(0, player.Treasury);
        Assert.Equal(0, player.DailyBalanceRemainder);
    }

    [Fact]
    public void AccrueDailyBalanceSaturatesAtTreasuryLimit()
    {
        var player = new PlayerState { Treasury = int.MaxValue - 1 };

        var change = SimulationRules.AccrueDailyBalance(player, int.MaxValue);

        Assert.Equal(1, change);
        Assert.Equal(int.MaxValue, player.Treasury);
        Assert.Equal(0, player.DailyBalanceRemainder);
    }

    [Fact]
    public void CalculateMonthlyBalanceUsesOnlyPlayersOwnedTerritoriesAndBuildings()
    {
        var playerId = Guid.NewGuid();
        var otherPlayerId = Guid.NewGuid();
        var game = new WorldState
        {
            Territories =
            [
                new TerritoryState { Population = 30000, Prosperity = 50, OwnerPlayerId = playerId },
                new TerritoryState { Population = 60000, Prosperity = 100, OwnerPlayerId = otherPlayerId }
            ]
        };
        var player = new PlayerState
        {
            Id = playerId,
            Buildings = { [0] = GameCatalog.Buildings["farm"] }
        };

        Assert.Equal(111, SimulationRules.CalculateMonthlyBalance(game, player));
    }
}
