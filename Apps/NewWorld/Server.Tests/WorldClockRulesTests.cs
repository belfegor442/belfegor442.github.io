using NewWorld.Server.Services;

namespace NewWorld.Server.Tests;

public sealed class WorldClockRulesTests
{
    [Theory]
    [InlineData(299, 0, 299)]
    [InlineData(300, 1, 0)]
    [InlineData(301, 1, 1)]
    public void AccumulateUsesExactlyFiveMinutesPerGameDay(
        int elapsedSeconds,
        long expectedDays,
        int expectedRemainingSeconds)
    {
        var result = WorldClockRules.Accumulate(0, TimeSpan.FromSeconds(elapsedSeconds));

        Assert.Equal(expectedDays, result.DaysDue);
        Assert.Equal(TimeSpan.FromSeconds(expectedRemainingSeconds).Ticks, result.RemainingTicks);
    }

    [Fact]
    public void AccumulateCarriesPartialTimeAcrossTicks()
    {
        var firstAdvance = WorldClockRules.Accumulate(0, TimeSpan.FromSeconds(299));
        var secondAdvance = WorldClockRules.Accumulate(
            firstAdvance.RemainingTicks,
            TimeSpan.FromSeconds(1));

        Assert.Equal(0, firstAdvance.DaysDue);
        Assert.Equal(1, secondAdvance.DaysDue);
        Assert.Equal(0, secondAdvance.RemainingTicks);
    }
}
