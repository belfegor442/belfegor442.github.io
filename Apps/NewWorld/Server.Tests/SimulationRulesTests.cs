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
        var government = new TerritoryState { Treasury = 1000 };

        for (var day = 0; day < days; day++)
            SimulationRules.AccrueDailyBalance(government, monthlyBalance);

        Assert.Equal(1000 + expectedChange, government.Treasury);
        Assert.Equal(0, government.DailyBalanceRemainder);
    }

    [Fact]
    public void AccrueDailyBalanceCarriesFractionsAcrossChangingDailyBalances()
    {
        var government = new TerritoryState { Treasury = 1000 };

        for (var day = 0; day < 15; day++)
            SimulationRules.AccrueDailyBalance(government, 93);
        for (var day = 0; day < 15; day++)
            SimulationRules.AccrueDailyBalance(government, 60);

        Assert.Equal(1076, government.Treasury);
        Assert.Equal(15, government.DailyBalanceRemainder);
    }

    [Fact]
    public void AccrueDailyBalanceNeverCreatesTreasuryDebt()
    {
        var government = new TerritoryState { Treasury = 2 };

        var change = SimulationRules.AccrueDailyBalance(government, -90);

        Assert.Equal(-2, change);
        Assert.Equal(0, government.Treasury);
        Assert.Equal(0, government.DailyBalanceRemainder);
    }

    [Fact]
    public void AccrueDailyBalanceSaturatesAtTreasuryLimit()
    {
        var government = new TerritoryState { Treasury = int.MaxValue - 1 };

        var change = SimulationRules.AccrueDailyBalance(government, int.MaxValue);

        Assert.Equal(1, change);
        Assert.Equal(int.MaxValue, government.Treasury);
        Assert.Equal(0, government.DailyBalanceRemainder);
    }

    [Fact]
    public void CalculateGovernmentBalanceCombinesMembersAndTheirAdministeredTerritories()
    {
        var firstPlayer = new PlayerState
        {
            Id = Guid.NewGuid(),
            LegacyCountryIndex = 0
        };
        var secondPlayer = new PlayerState { Id = Guid.NewGuid(), LegacyCountryIndex = 0 };
        var otherPlayer = new PlayerState { Id = Guid.NewGuid(), LegacyCountryIndex = 2 };
        var government = new TerritoryState
        {
            StateId = Guid.NewGuid(),
            Index = 0,
            Buildings = { [150] = GameCatalog.Buildings["farm"] }
        };
        var game = new WorldState
        {
            Players = [firstPlayer, secondPlayer, otherPlayer],
            Territories =
            [
                government,
                new TerritoryState { Index = 1, Population = 30000, Prosperity = 50, OwnerPlayerId = firstPlayer.Id },
                new TerritoryState { Index = 2, Population = 60000, Prosperity = 100, OwnerPlayerId = otherPlayer.Id }
            ],
            Memberships =
            [
                new GovernmentMembership { PlayerId = firstPlayer.Id, StateId = government.StateId },
                new GovernmentMembership { PlayerId = secondPlayer.Id, StateId = government.StateId }
            ]
        };

        var balance = SimulationRules.CalculateGovernmentBalance(game, government);

        Assert.Equal(10, balance.TerritoryIncome);
        Assert.Equal(188, balance.CityIncome);
        Assert.Equal(3, balance.Upkeep);
        Assert.Equal(195, balance.MonthlyBalance);
    }

    [Fact]
    public void SnapshotExposesSharedStateTreasuryAndBalanceToEveryMember()
    {
        var stateId = Guid.NewGuid();
        var players = new[]
        {
            new PlayerState { Id = Guid.NewGuid(), LegacyCountryIndex = 0 },
            new PlayerState { Id = Guid.NewGuid(), LegacyCountryIndex = 0 }
        };
        var game = new WorldState
        {
            Players = players.ToList(),
            Territories = [new TerritoryState { StateId = stateId, Index = 0, Treasury = 2400 }],
            Memberships = players.Select(player => new GovernmentMembership
            {
                PlayerId = player.Id,
                StateId = stateId
            }).ToList()
        };

        var snapshot = GameHub.BuildSnapshot(game, new HashSet<Guid>());

        Assert.All(snapshot.Players, player => Assert.Equal(2400, player.Treasury));
        Assert.Equal(170, Assert.Single(snapshot.Territories).MonthlyBalance);
    }
}
