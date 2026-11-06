using System.Numerics;
using NewWorld.Server.Models;

namespace NewWorld.Server.Services;

public sealed record ResearchProgressChange(
    Guid StateId,
    Guid ProjectId,
    string EventType,
    string Description);

public static class ResearchRules
{
    public static OrderRejection? StartProject(
        WorldState game,
        PlayerState player,
        Guid? stateId,
        Guid? projectId)
    {
        if (stateId is not Guid selectedStateId ||
            projectId is not Guid selectedProjectId)
            return new OrderRejection("INVALID_PAYLOAD", "A State and research project are required.");

        var membership = game.Memberships.SingleOrDefault(item =>
            item.PlayerId == player.Id &&
            item.StateId == selectedStateId &&
            item.Status == MembershipStatus.Active);
        if (membership is null)
            return new OrderRejection("NOT_MEMBER", "You are not a member of the selected government.");
        if (!GovernmentPermissionRules.Allows(
                membership.PermissionSetId, GovernmentAction.StartResearch))
            return new OrderRejection(
                "INSUFFICIENT_PERMISSION",
                "Your government permissions do not allow starting research.");

        var project = game.ResearchProjects.SingleOrDefault(item =>
            item.Id == selectedProjectId && item.StateId == selectedStateId);
        if (project is null)
            return new OrderRejection("RESEARCH_PROJECT_NOT_FOUND", "The selected project is unavailable.");
        if (project.Status is not (ResearchProjectStatus.Proposed or ResearchProjectStatus.Suspended))
            return new OrderRejection(
                "RESEARCH_PROJECT_NOT_STARTABLE",
                "Only a proposed or suspended research project can be started or resumed.");
        var isNewProject = project.Status == ResearchProjectStatus.Proposed;
        if (project.DailyProgress < 1 || project.DailyFunding < 1)
            return new OrderRejection(
                "RESEARCH_RULES_PENDING",
                "The scenario must configure positive daily progress and funding for this project.");

        var institution = game.ResearchInstitutions.Single(item => item.Id == project.InstitutionId);
        if (project.Staff < 1 || project.Staff > institution.Staff)
            return new OrderRejection(
                "RESEARCH_STAFF_UNAVAILABLE",
                "The research institution does not have the configured project staff.");
        var requiredFunding = (BigInteger)RequiredDays(project) * project.DailyFunding;
        if (isNewProject &&
                (project.Budget < project.DailyFunding || project.Budget < requiredFunding) ||
            !isNewProject && project.FundingRemaining < requiredFunding)
            return new OrderRejection(
                "RESEARCH_BUDGET_INSUFFICIENT",
                "The reserved project funding cannot cover its remaining configured daily cycles.");

        var technology = game.Technologies.Single(item => item.Id == project.TechnologyId);
        var knownTechnologies = game.TechnologyUnlocks
            .Where(item => item.StateId == selectedStateId)
            .Select(item => item.TechnologyId)
            .ToHashSet(StringComparer.Ordinal);
        if (technology.PrerequisiteTechnologyIds.Any(id => !knownTechnologies.Contains(id)))
            return new OrderRejection(
                "RESEARCH_PREREQUISITES_UNMET",
                "The State has not discovered every prerequisite technology.");
        if (technology.RequiredKnowledge.Keys.Any(id => !knownTechnologies.Contains(id)))
            return new OrderRejection(
                "RESEARCH_KNOWLEDGE_UNAVAILABLE",
                "The State has not discovered every technology required as knowledge.");
        if (technology.RequiredMaterials.Any(requirement =>
                project.MaterialsReserved.GetValueOrDefault(requirement.Key) < requirement.Value))
            return new OrderRejection(
                "RESEARCH_MATERIALS_NOT_RESERVED",
                "The project has not reserved all required research materials.");
        if (isNewProject && technology.RequiredMaterials.Any(requirement =>
                game.Companies
                    .Where(company => company.StateId == selectedStateId)
                    .Aggregate(
                        BigInteger.Zero,
                        (total, company) =>
                            total + company.Inventory.GetValueOrDefault(requirement.Key)) <
                requirement.Value))
            return new OrderRejection(
                "RESEARCH_MATERIALS_UNAVAILABLE",
                "The State's companies do not hold enough configured research materials.");

        var state = game.Territories.Single(item => item.StateId == selectedStateId);
        if (isNewProject && institution.Type == ResearchInstitutionType.Public)
        {
            if (project.Budget > int.MaxValue || state.Treasury < project.Budget)
                return new OrderRejection(
                    "INSUFFICIENT_FUNDS",
                    "The State treasury cannot cover the configured project budget.");
        }
        else if (isNewProject)
        {
            if (institution.Funding < project.Budget)
                return new OrderRejection(
                    "RESEARCH_PRIVATE_FUNDING_UNAVAILABLE",
                    "The private institution cannot cover the configured project budget.");
        }

        if (isNewProject && institution.Type == ResearchInstitutionType.Public)
        {
            var balanceBefore = state.Treasury;
            state.Treasury -= (int)project.Budget;
            GameStore.AddEconomicTransaction(
                game,
                state,
                EconomicTransactionType.ResearchFunding,
                balanceBefore,
                state.Treasury,
                $"Reserved funding for research project {technology.Name}.");
        }
        else if (isNewProject)
        {
            institution.Funding -= project.Budget;
        }

        if (isNewProject)
        {
            foreach (var requirement in technology.RequiredMaterials)
            {
                var remaining = requirement.Value;
                foreach (var company in game.Companies
                    .Where(item => item.StateId == selectedStateId)
                    .OrderBy(item => item.Id))
                {
                    var available = company.Inventory.GetValueOrDefault(requirement.Key);
                    var consumed = Math.Min(remaining, available);
                    if (consumed == 0)
                        continue;
                    company.Inventory[requirement.Key] = available - consumed;
                    remaining -= consumed;
                    if (remaining == 0)
                        break;
                }
            }
        }

        if (isNewProject)
        {
            project.Progress = 0;
            project.FundingRemaining = project.Budget;
        }
        project.Status = ResearchProjectStatus.Active;
        project.StartedOn = game.WorldDate;
        GameStore.AddActivity(game, $"{player.Name} started research on {technology.Name}.");
        return null;
    }

    public static OrderRejection? CancelProject(
        WorldState game,
        PlayerState player,
        Guid? stateId,
        Guid? projectId)
    {
        if (stateId is not Guid selectedStateId ||
            projectId is not Guid selectedProjectId)
            return new OrderRejection("INVALID_PAYLOAD", "A State and research project are required.");

        var membership = game.Memberships.SingleOrDefault(item =>
            item.PlayerId == player.Id &&
            item.StateId == selectedStateId &&
            item.Status == MembershipStatus.Active);
        if (membership is null)
            return new OrderRejection("NOT_MEMBER", "You are not a member of the selected government.");
        if (!GovernmentPermissionRules.Allows(
                membership.PermissionSetId, GovernmentAction.StartResearch))
            return new OrderRejection(
                "INSUFFICIENT_PERMISSION",
                "Your government permissions do not allow managing research projects.");

        var project = game.ResearchProjects.SingleOrDefault(item =>
            item.Id == selectedProjectId && item.StateId == selectedStateId);
        if (project is null)
            return new OrderRejection("RESEARCH_PROJECT_NOT_FOUND", "The selected project is unavailable.");
        if (project.Status is ResearchProjectStatus.Completed or ResearchProjectStatus.Cancelled)
            return new OrderRejection(
                "RESEARCH_PROJECT_NOT_CANCELLABLE",
                "A completed or already cancelled research project cannot be cancelled.");

        var institution = game.ResearchInstitutions.Single(item => item.Id == project.InstitutionId);
        var technology = game.Technologies.Single(item => item.Id == project.TechnologyId);
        RefundUnusedFunding(game, project, institution, technology.Name);
        project.Status = ResearchProjectStatus.Cancelled;
        GameStore.AddActivity(game, $"{player.Name} cancelled research on {technology.Name}.");
        return null;
    }

    public static OrderRejection? AdoptTechnology(
        WorldState game,
        PlayerState player,
        Guid? stateId,
        string? technologyId,
        string? sector,
        Guid? provinceId)
    {
        if (stateId is not Guid selectedStateId ||
            string.IsNullOrWhiteSpace(technologyId) ||
            technologyId.Length > 120 ||
            sector is { Length: > 120 })
            return new OrderRejection(
                "INVALID_PAYLOAD",
                "A State and valid technology ID are required.");

        var membership = game.Memberships.SingleOrDefault(item =>
            item.PlayerId == player.Id &&
            item.StateId == selectedStateId &&
            item.Status == MembershipStatus.Active);
        if (membership is null)
            return new OrderRejection("NOT_MEMBER", "You are not a member of the selected government.");
        if (!GovernmentPermissionRules.Allows(
                membership.PermissionSetId, GovernmentAction.StartResearch))
            return new OrderRejection(
                "INSUFFICIENT_PERMISSION",
                "Your government permissions do not allow adopting technology.");

        var technology = game.Technologies.SingleOrDefault(item =>
            item.Id == technologyId);
        if (technology is null)
            return new OrderRejection("TECHNOLOGY_NOT_FOUND", "The selected technology is unavailable.");
        if (!game.TechnologyUnlocks.Any(item =>
                item.StateId == selectedStateId && item.TechnologyId == technology.Id))
            return new OrderRejection(
                "TECHNOLOGY_NOT_DISCOVERED",
                "A State must discover technology before adopting it.");
        if (provinceId is Guid selectedProvinceId &&
            game.Provinces.All(item =>
                item.Id != selectedProvinceId || item.SovereignStateId != selectedStateId))
            return new OrderRejection(
                "PROVINCE_UNAVAILABLE",
                "The province must be part of the selected State.");

        var normalizedSector = sector?.Trim() ?? "";
        if (game.TechnologyAdoptions.Any(item =>
                item.StateId == selectedStateId &&
                item.TechnologyId == technology.Id &&
                item.ProvinceId == provinceId &&
                string.Equals(item.Sector, normalizedSector, StringComparison.Ordinal)))
            return new OrderRejection(
                "TECHNOLOGY_ALREADY_ADOPTED",
                "This State, sector, or province has already adopted the technology.");

        game.TechnologyAdoptions.Add(new TechnologyAdoption
        {
            TechnologyId = technology.Id,
            StateId = selectedStateId,
            ProvinceId = provinceId,
            Sector = normalizedSector,
            AdoptedOn = game.WorldDate,
            Cause = $"Adopted by {player.Name} after discovery."
        });
        GameStore.AddActivity(
            game,
            $"{player.Name} adopted {technology.Name}" +
            (normalizedSector.Length > 0 ? $" in {normalizedSector}" : "") +
            (provinceId is Guid province
                ? $" in {game.Provinces.Single(item => item.Id == province).Name}."
                : "."));
        return null;
    }

    public static IReadOnlyList<ResearchProgressChange> AdvanceDailyResearch(WorldState game)
    {
        var changes = new List<ResearchProgressChange>();
        foreach (var project in game.ResearchProjects
            .Where(item => item.Status == ResearchProjectStatus.Active)
            .OrderBy(item => item.Id))
        {
            var institution = game.ResearchInstitutions.Single(item => item.Id == project.InstitutionId);
            var technology = game.Technologies.Single(item => item.Id == project.TechnologyId);
            if (project.DailyProgress < 1 ||
                project.DailyFunding < 1 ||
                project.Staff < 1 ||
                project.Staff > institution.Staff ||
                project.FundingRemaining < project.DailyFunding)
            {
                project.Status = ResearchProjectStatus.Suspended;
                changes.Add(new ResearchProgressChange(
                    project.StateId,
                    project.Id,
                    "research.project_suspended",
                    $"Research on {technology.Name} was suspended because configured staff, funding, or progress rules are unavailable."));
                continue;
            }

            project.FundingRemaining -= project.DailyFunding;
            project.Progress = (long)BigInteger.Min(
                project.RequiredProgress,
                (BigInteger)project.Progress + project.DailyProgress);
            if (project.Progress < project.RequiredProgress)
                continue;

            project.Status = ResearchProjectStatus.Completed;
            if (game.TechnologyUnlocks.All(item =>
                    item.StateId != project.StateId || item.TechnologyId != project.TechnologyId))
            {
                game.TechnologyUnlocks.Add(new TechnologyUnlock
                {
                    TechnologyId = project.TechnologyId,
                    StateId = project.StateId,
                    DiscoveringInstitutionId = institution.Id,
                    FundingStateId = institution.Type == ResearchInstitutionType.Public
                        ? project.StateId
                        : null,
                    DiscoveredOn = game.WorldDate,
                    Cause = $"Completed research project {project.Id}."
                });
            }

            RefundUnusedFunding(game, project, institution, technology.Name);
            changes.Add(new ResearchProgressChange(
                project.StateId,
                project.Id,
                "research.technology_discovered",
                $"{technology.Name} was discovered. Adoption remains a separate decision."));
        }

        return changes;
    }

    private static long RequiredDays(ResearchProject project)
    {
        var remaining = project.RequiredProgress - project.Progress;
        return remaining <= 0
            ? 0
            : (remaining - 1) / project.DailyProgress + 1;
    }

    private static void RefundUnusedFunding(
        WorldState game,
        ResearchProject project,
        ResearchInstitution institution,
        string technologyName)
    {
        if (project.FundingRemaining <= 0)
            return;

        if (institution.Type == ResearchInstitutionType.Private)
        {
            institution.Funding = checked(institution.Funding + project.FundingRemaining);
            project.FundingRemaining = 0;
            return;
        }

        var state = game.Territories.Single(item => item.StateId == project.StateId);
        if (project.FundingRemaining > int.MaxValue - state.Treasury)
            throw new InvalidDataException("Unused research funding exceeds the State treasury limit.");
        var balanceBefore = state.Treasury;
        state.Treasury += (int)project.FundingRemaining;
        GameStore.AddEconomicTransaction(
            game,
            state,
            EconomicTransactionType.ResearchFunding,
            balanceBefore,
            state.Treasury,
            $"Returned unused funding from research project {technologyName}.");
        project.FundingRemaining = 0;
    }
}
