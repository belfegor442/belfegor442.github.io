using NewWorld.Server.Models;

namespace NewWorld.Server.Services;

public static class SimulationRules
{
    private const int DaysPerFinancialPeriod = 30;

    public static (int TerritoryIncome, int CityIncome, int Upkeep, int MonthlyBalance)
        CalculateGovernmentBalance(WorldState game, TerritoryState government)
    {
        var members = game.Memberships
            .Where(membership => membership.StateId == government.StateId &&
                membership.Status == MembershipStatus.Active)
            .Select(membership => game.Players.Single(player => player.Id == membership.PlayerId))
            .ToList();
        var cityOwners = members.Where(player => player.LegacyCountryIndex == government.Index).ToList();
        var cityOwnerIds = cityOwners.Select(player => player.Id).ToHashSet();
        var territoryIncome = game.Territories
            .Where(territory => territory.OwnerPlayerId is Guid ownerId && cityOwnerIds.Contains(ownerId))
            .Sum(territory => (int)Math.Round(territory.Population / 1500d * (territory.Prosperity / 100d)));
        var completedBuildings = government.Buildings.Values
            .Where(building => building.DaysRemaining == 0).ToArray();
        var cityIncome = cityOwners.Count * 85 + completedBuildings.Sum(building => building.Income);
        var upkeep = completedBuildings.Sum(building => building.Upkeep);
        return (territoryIncome, cityIncome, upkeep, territoryIncome + cityIncome - upkeep);
    }

    public static int AccrueDailyBalance(TerritoryState government, int monthlyBalance)
    {
        var accumulated = (long)government.DailyBalanceRemainder + monthlyBalance;
        var dailyChange = (int)(accumulated / DaysPerFinancialPeriod);
        government.DailyBalanceRemainder = (int)(accumulated % DaysPerFinancialPeriod);

        var treasury = (long)government.Treasury + dailyChange;
        if (treasury < 0)
        {
            dailyChange = -government.Treasury;
            treasury = 0;
            government.DailyBalanceRemainder = 0;
        }
        else if (treasury > int.MaxValue)
        {
            dailyChange = int.MaxValue - government.Treasury;
            treasury = int.MaxValue;
            government.DailyBalanceRemainder = 0;
        }

        government.Treasury = (int)treasury;
        return dailyChange;
    }
}
