using NewWorld.Server.Models;

namespace NewWorld.Server.Services;

public sealed record OccupationChange(
    Guid StateId,
    Guid OccupationId,
    string EventType,
    string Description);

public static class OccupationRules
{
    public static IReadOnlyList<OccupationChange> AdvanceDaily(WorldState game)
    {
        var changes = new List<OccupationChange>();
        foreach (var occupation in game.Occupations.OrderBy(item => item.Id))
        {
            if (occupation.DurationDays < int.MaxValue)
                occupation.DurationDays++;

            if (occupation.RequiredControlDays == 0)
                continue;

            if (occupation.ControlEffective &&
                occupation.OccupyingForce <= occupation.Resistance)
            {
                var previousControl = game.TerritorialControls.Single(item =>
                    item.Id == occupation.ControlRecordId);
                previousControl.EffectiveUntil = game.WorldDate;
                occupation.ControlEffective = false;
                occupation.ControlRecordId = null;
                changes.Add(new OccupationChange(
                    occupation.OccupyingStateId,
                    occupation.Id,
                    "territory.occupation_control_lost",
                    $"Effective military control was lost in {ProvinceName(game, occupation.ProvinceId)}; sovereignty did not change."));
                continue;
            }

            if (occupation.ControlEffective ||
                occupation.DurationDays < occupation.RequiredControlDays ||
                occupation.OccupyingForce <= occupation.Resistance)
                continue;

            var control = new TerritorialControl
            {
                Id = WorldStateCompatibility.CreateStableId(
                    $"occupation-control:{occupation.Id:N}:{game.WorldDate:yyyy-MM-dd}"),
                ProvinceId = occupation.ProvinceId,
                StateId = occupation.OccupyingStateId,
                Type = TerritorialControlType.Military,
                EffectiveFrom = game.WorldDate,
                Cause = $"Effective occupation control ({occupation.Id:N})."
            };
            game.TerritorialControls.Add(control);
            occupation.ControlEffective = true;
            occupation.ControlRecordId = control.Id;
            changes.Add(new OccupationChange(
                occupation.OccupyingStateId,
                occupation.Id,
                "territory.occupation_control_established",
                $"Effective military control was established in {ProvinceName(game, occupation.ProvinceId)}; sovereignty remains unchanged."));
        }

        return changes;
    }

    private static string ProvinceName(WorldState game, Guid provinceId) =>
        game.Provinces.Single(item => item.Id == provinceId).Name;
}
