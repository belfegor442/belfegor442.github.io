namespace NewWorld.Server.Models;

public sealed class PopulationGroup
{
    public Guid Id { get; set; }
    public Guid StateId { get; set; }
    public string Name { get; set; } = "";
    public long Population { get; set; }
    public List<PopulationNeed> Needs { get; set; } = [];
    public Dictionary<string, long> DailyDemandRemainders { get; set; } =
        new(StringComparer.Ordinal);
}

public sealed class PopulationNeed
{
    public string GoodId { get; set; } = "";
    public long DailyQuantityPerThousandPeople { get; set; }
}
