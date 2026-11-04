using NewWorld.Server.Models;

namespace NewWorld.Server.Services;

public static class SimulationRules
{
    private const int DaysPerFinancialPeriod = 30;

    public static int CalculateMonthlyBalance(WorldState game, PlayerState player)
    {
        var territoryIncome = game.Territories
            .Where(territory => territory.OwnerPlayerId == player.Id)
            .Sum(territory => (int)Math.Round(territory.Population / 1500d * (territory.Prosperity / 100d)));
        var cityIncome = 85 + player.Buildings.Values.Sum(building => building.Income);
        return territoryIncome + cityIncome - player.Buildings.Count * 2;
    }

    public static int AccrueDailyBalance(PlayerState player, int monthlyBalance)
    {
        var accumulated = (long)player.DailyBalanceRemainder + monthlyBalance;
        var dailyChange = (int)(accumulated / DaysPerFinancialPeriod);
        player.DailyBalanceRemainder = (int)(accumulated % DaysPerFinancialPeriod);

        var treasury = (long)player.Treasury + dailyChange;
        if (treasury < 0)
        {
            dailyChange = -player.Treasury;
            treasury = 0;
            player.DailyBalanceRemainder = 0;
        }
        else if (treasury > int.MaxValue)
        {
            dailyChange = int.MaxValue - player.Treasury;
            treasury = int.MaxValue;
            player.DailyBalanceRemainder = 0;
        }

        player.Treasury = (int)treasury;
        return dailyChange;
    }
}
