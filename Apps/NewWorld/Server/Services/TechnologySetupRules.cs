using NewWorld.Server.Models;

namespace NewWorld.Server.Services;

public static class TechnologySetupRules
{
    public static string? Configure(WorldState game, TechnologyScenarioRequest request)
    {
        if (game.Started)
            return "Technology scenario data is locked after the world starts.";
        if (request.ExpectedWorldVersion != game.WorldVersion)
            return "The world changed. Reload it before configuring technology data.";
        if (request.Technologies is null ||
            request.ResearchInstitutions is null ||
            request.ResearchProjects is null ||
            request.TechnologyUnlocks is null ||
            request.TechnologyAdoptions is null)
            return "All technology scenario collections are required; use empty arrays for unused systems.";
        if (request.Technologies.Any(item => item is null) ||
            request.ResearchInstitutions.Any(item => item is null) ||
            request.ResearchProjects.Any(item => item is null) ||
            request.TechnologyUnlocks.Any(item => item is null) ||
            request.TechnologyAdoptions.Any(item => item is null))
            return "Technology scenario collections cannot contain null entries.";
        if (request.Technologies.Count > 10_000 ||
            request.ResearchInstitutions.Count > 100_000 ||
            request.ResearchProjects.Count > 100_000 ||
            request.TechnologyUnlocks.Count > 500_000 ||
            request.TechnologyAdoptions.Count > 500_000)
            return "The technology scenario exceeds a supported collection limit.";

        var candidate = WorldStateCompatibility.Clone(game);
        candidate.Technologies = request.Technologies.ToList();
        candidate.ResearchInstitutions = request.ResearchInstitutions.ToList();
        candidate.ResearchProjects = request.ResearchProjects.ToList();
        candidate.TechnologyUnlocks = request.TechnologyUnlocks.ToList();
        candidate.TechnologyAdoptions = request.TechnologyAdoptions.ToList();
        try
        {
            WorldStateCompatibility.Normalize(candidate);
        }
        catch (InvalidDataException exception)
        {
            return $"Invalid technology scenario: {exception.Message}";
        }

        game.Technologies = candidate.Technologies;
        game.ResearchInstitutions = candidate.ResearchInstitutions;
        game.ResearchProjects = candidate.ResearchProjects;
        game.TechnologyUnlocks = candidate.TechnologyUnlocks;
        game.TechnologyAdoptions = candidate.TechnologyAdoptions;
        GameStore.AddActivity(game, "The host configured technology data before the world started.");
        return null;
    }

    public static void Validate(WorldState game)
    {
        var states = game.Territories.ToDictionary(item => item.StateId);
        var provinces = game.Provinces.ToDictionary(item => item.Id);
        var goods = game.Goods.Select(item => item.Id).ToHashSet(StringComparer.Ordinal);
        var technologies = new Dictionary<string, Technology>(StringComparer.Ordinal);
        foreach (var technology in game.Technologies)
        {
            technology.PrerequisiteTechnologyIds ??= [];
            technology.RequiredMaterials ??= new Dictionary<string, long>(StringComparer.Ordinal);
            technology.RequiredKnowledge ??= new Dictionary<string, long>(StringComparer.Ordinal);
            technology.Effects ??= [];
            if (string.IsNullOrWhiteSpace(technology.Id) ||
                string.IsNullOrWhiteSpace(technology.Name) ||
                !Enum.IsDefined(technology.Domain) ||
                technology.PrerequisiteTechnologyIds.Contains(technology.Id, StringComparer.Ordinal) ||
                technology.PrerequisiteTechnologyIds.Distinct(StringComparer.Ordinal).Count() !=
                technology.PrerequisiteTechnologyIds.Count ||
                technology.RequiredMaterials.Any(item =>
                    !goods.Contains(item.Key) || item.Value < 0) ||
                technology.RequiredKnowledge.Any(item =>
                    string.IsNullOrWhiteSpace(item.Key) || item.Value < 0) ||
                technology.Effects.Any(item =>
                    item is null ||
                    string.IsNullOrWhiteSpace(item.EffectId) ||
                    string.IsNullOrWhiteSpace(item.Unit) ||
                    string.IsNullOrWhiteSpace(item.Basis)) ||
                !technologies.TryAdd(technology.Id, technology))
                throw new InvalidDataException("The saved world contains an invalid technology.");
        }

        ValidatePrerequisiteGraph(technologies);

        var institutions = new Dictionary<Guid, ResearchInstitution>();
        foreach (var institution in game.ResearchInstitutions)
        {
            institution.Facilities ??= new Dictionary<string, long>(StringComparer.Ordinal);
            institution.Specializations ??= [];
            var state = states.GetValueOrDefault(institution.StateId);
            if (institution.Id == Guid.Empty ||
                state is null ||
                institution.CurrencyId != state.CurrencyId ||
                !Enum.IsDefined(institution.Type) ||
                string.IsNullOrWhiteSpace(institution.Name) ||
                institution.Staff < 0 ||
                institution.Funding < 0 ||
                institution.Facilities.Any(item =>
                    string.IsNullOrWhiteSpace(item.Key) || item.Value < 0) ||
                institution.Specializations.Any(domain => !Enum.IsDefined(domain)) ||
                institution.ProvinceId is Guid provinceId &&
                (!provinces.TryGetValue(provinceId, out var province) ||
                 province.SovereignStateId != institution.StateId) ||
                !institutions.TryAdd(institution.Id, institution))
                throw new InvalidDataException("The saved world contains an invalid research institution.");
        }

        var projects = new HashSet<Guid>();
        foreach (var project in game.ResearchProjects)
        {
            project.MaterialsReserved ??= new Dictionary<string, long>(StringComparer.Ordinal);
            if (project.Id == Guid.Empty ||
                !projects.Add(project.Id) ||
            !states.TryGetValue(project.StateId, out var state) ||
            project.CurrencyId != state.CurrencyId ||
                !institutions.TryGetValue(project.InstitutionId, out var institution) ||
                institution.StateId != project.StateId ||
                !technologies.ContainsKey(project.TechnologyId) ||
                project.Budget < 0 ||
                project.Staff < 0 ||
                project.RequiredProgress < 1 ||
                project.Progress < 0 ||
                project.Progress > project.RequiredProgress ||
                project.DailyProgress < 0 ||
                project.DailyFunding < 0 ||
                project.FundingRemaining < 0 ||
                project.FundingRemaining > project.Budget ||
                !Enum.IsDefined(project.Status) ||
                project.Status == ResearchProjectStatus.Completed &&
                project.Progress != project.RequiredProgress ||
                project.Status != ResearchProjectStatus.Completed &&
                project.Progress == project.RequiredProgress ||
                project.StartedOn == default ||
                project.StartedOn > game.WorldDate ||
                project.MaterialsReserved.Any(item =>
                    !goods.Contains(item.Key) || item.Value < 0))
                throw new InvalidDataException("The saved world contains an invalid research project.");
        }

        var unlocks = new Dictionary<(Guid StateId, string TechnologyId), TechnologyUnlock>();
        foreach (var unlock in game.TechnologyUnlocks)
        {
            unlock.Cause ??= "";
            if (!states.ContainsKey(unlock.StateId) ||
                !technologies.ContainsKey(unlock.TechnologyId) ||
                unlock.DiscoveredOn == default ||
                unlock.DiscoveredOn > game.WorldDate ||
                string.IsNullOrWhiteSpace(unlock.Cause) ||
                unlock.DiscoveringInstitutionId is Guid discovererId &&
                (!institutions.TryGetValue(discovererId, out var discoverer) ||
                 discoverer.StateId != unlock.StateId) ||
                unlock.FundingStateId is Guid fundingStateId &&
                !states.ContainsKey(fundingStateId) ||
                !unlocks.TryAdd((unlock.StateId, unlock.TechnologyId), unlock))
                throw new InvalidDataException("The saved world contains an invalid technology unlock.");
        }

        var adoptions = new HashSet<(Guid StateId, string TechnologyId, Guid? ProvinceId, string Sector)>();
        foreach (var adoption in game.TechnologyAdoptions)
        {
            adoption.Cause ??= "";
            if (!states.ContainsKey(adoption.StateId) ||
                !unlocks.TryGetValue((adoption.StateId, adoption.TechnologyId), out var unlock) ||
                adoption.AdoptedOn == default ||
                adoption.AdoptedOn > game.WorldDate ||
                adoption.AdoptedOn < unlock.DiscoveredOn ||
                string.IsNullOrWhiteSpace(adoption.Cause) ||
                adoption.ProvinceId is Guid provinceId &&
                (!provinces.TryGetValue(provinceId, out var province) ||
                 province.SovereignStateId != adoption.StateId) ||
                !adoptions.Add((adoption.StateId, adoption.TechnologyId, adoption.ProvinceId, adoption.Sector)))
                throw new InvalidDataException("The saved world contains an invalid technology adoption.");
        }
    }

    private static void ValidatePrerequisiteGraph(IReadOnlyDictionary<string, Technology> technologies)
    {
        var completed = new HashSet<string>(StringComparer.Ordinal);
        var active = new HashSet<string>(StringComparer.Ordinal);
        foreach (var id in technologies.Keys)
            Visit(id);

        void Visit(string id)
        {
            if (completed.Contains(id))
                return;
            if (!active.Add(id))
                throw new InvalidDataException("The technology prerequisite graph contains a cycle.");
            foreach (var prerequisiteId in technologies[id].PrerequisiteTechnologyIds)
            {
                if (!technologies.ContainsKey(prerequisiteId))
                    throw new InvalidDataException("A technology requires an unknown prerequisite.");
                Visit(prerequisiteId);
            }
            active.Remove(id);
            completed.Add(id);
        }
    }
}
