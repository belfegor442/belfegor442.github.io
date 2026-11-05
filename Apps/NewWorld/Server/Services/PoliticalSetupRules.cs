using NewWorld.Server.Models;

namespace NewWorld.Server.Services;

public static class PoliticalSetupRules
{
    public static string? Configure(WorldState game, PoliticalScenarioRequest request)
    {
        if (game.Started)
            return "Political configuration is locked after the world starts.";
        if (request.ExpectedWorldVersion != game.WorldVersion)
            return "The world changed. Reload it before configuring the political system.";
        if (request.PoliticalSystems is null)
            return "The political configuration requires a list of State systems.";
        if (request.PoliticalSystems.Any(system => system is null))
            return "Political configuration entries cannot be null.";

        var configuredStateIds = request.PoliticalSystems
            .Select(system => system.StateId)
            .ToList();
        var distinctConfiguredStateIds = configuredStateIds.Distinct().ToList();
        if (distinctConfiguredStateIds.Count != request.PoliticalSystems.Count)
            return "Invalid political configuration: Political configuration entries cannot repeat the same State.";
        if (configuredStateIds.Any(stateId => stateId == Guid.Empty))
            return "Invalid political configuration: Every political system must correspond to a real State.";
        if (game.Territories.Count > 0 &&
            distinctConfiguredStateIds.Count != game.Territories.Count)
            return "Invalid political configuration: Each State must have exactly one political system configured.";
        if (game.Territories.Any(territory => !distinctConfiguredStateIds.Contains(territory.StateId)))
            return "Invalid political configuration: Every State in the world must be covered by a political configuration.";
        if (request.PoliticalSystems.Any(system => !game.Territories.Any(territory => territory.StateId == system.StateId)))
            return "Invalid political configuration: Unknown State IDs are not allowed in the political configuration.";

        var candidate = WorldStateCompatibility.Clone(game);
        candidate.PoliticalSystems = request.PoliticalSystems.ToList();
        try
        {
            WorldStateCompatibility.Normalize(candidate);
        }
        catch (InvalidDataException exception)
        {
            return $"Invalid political configuration: {exception.Message}";
        }

        game.PoliticalSystems = candidate.PoliticalSystems;
        GameStore.AddActivity(game, "The host configured the State political systems before the world started.");
        return null;
    }
}
