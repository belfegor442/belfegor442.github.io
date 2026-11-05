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
