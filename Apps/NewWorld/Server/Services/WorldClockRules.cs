namespace NewWorld.Server.Services;

public readonly record struct ClockAccumulatorAdvance(long DaysDue, long RemainingTicks);

public static class WorldClockRules
{
    public static readonly TimeSpan DayLength = TimeSpan.FromMinutes(5);

    public static ClockAccumulatorAdvance Accumulate(long accumulatedTicks, TimeSpan elapsed)
    {
        ArgumentOutOfRangeException.ThrowIfNegative(accumulatedTicks);
        ArgumentOutOfRangeException.ThrowIfLessThan(elapsed, TimeSpan.Zero);

        var totalTicks = checked(accumulatedTicks + elapsed.Ticks);
        return new ClockAccumulatorAdvance(
            totalTicks / DayLength.Ticks,
            totalTicks % DayLength.Ticks);
    }
}
