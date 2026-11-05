using NewWorld.Server.Models;

namespace NewWorld.Server.Services;

public static class PoliticalProcedureRules
{
    public static OrderRejection? ProposeLaw(
        WorldState game,
        PlayerState actor,
        Guid orderId,
        Guid? stateId,
        string? title,
        string? text)
    {
        if (stateId is not Guid selectedStateId)
            return new OrderRejection("INVALID_PAYLOAD", "A government State is required.");
        if (string.IsNullOrWhiteSpace(title) || title.Trim().Length is < 4 or > 120 ||
            string.IsNullOrWhiteSpace(text) || text.Trim().Length is < 20 or > 4000 ||
            title.Any(char.IsControl) ||
            text.Any(character => char.IsControl(character) && character is not ('\n' or '\r' or '\t')))
            return new OrderRejection("INVALID_PAYLOAD", "A law needs a title and structured text within the supported limits.");

        var (system, rule, error) = FindRule(game, selectedStateId, PoliticalCompetence.ProposeLaw);
        if (error is not null)
            return error;

        var membership = game.Memberships.FirstOrDefault(item =>
            item.PlayerId == actor.Id &&
            item.StateId == selectedStateId &&
            item.Status == MembershipStatus.Active);
        if (membership is null ||
            !rule!.ProposerPermissionSetIds.Contains(membership.PermissionSetId))
            return new OrderRejection(
                "INSUFFICIENT_PERMISSION", "Your government permissions do not allow proposing laws.");
        if (rule.ApprovalRequired && !HasEligibleVoters(game, selectedStateId, rule))
            return new OrderRejection(
                "NO_ELIGIBLE_VOTERS", "This procedure has no active members eligible to vote.");
        if (system!.Decisions.Any(decision => decision.Id == orderId) ||
            system.Laws.Any(law => law.Id == orderId))
            return new OrderRejection("DECISION_ID_CONFLICT", "This decision ID is already in use.");

        var decision = new PoliticalDecision
        {
            Id = orderId,
            StateId = selectedStateId,
            Competence = PoliticalCompetence.ProposeLaw,
            ProposerPlayerId = actor.Id,
            InstitutionId = rule.InstitutionId,
            ConstitutionVersion = system.Constitution!.Version,
            Title = title.Trim(),
            Text = text.Trim(),
            LegalBasis = rule.LegalBasis,
            Status = rule.ApprovalRequired
                ? PoliticalDecisionStatus.PendingApproval
                : PoliticalDecisionStatus.Approved,
            ProposedOnWorldDate = game.WorldDate,
            ResolvedOnWorldDate = rule.ApprovalRequired ? null : game.WorldDate
        };
        system.Decisions.Add(decision);
        system.Laws.Add(new PoliticalLaw
        {
            Id = orderId,
            StateId = selectedStateId,
            ProposerPlayerId = actor.Id,
            DecisionId = decision.Id,
            Title = decision.Title,
            Text = decision.Text,
            LegalBasis = decision.LegalBasis,
            Status = rule.ApprovalRequired
                ? PoliticalLawStatus.Proposed
                : PoliticalLawStatus.InForce,
            ProposedOnWorldDate = game.WorldDate,
            EffectiveFrom = rule.ApprovalRequired ? null : game.WorldDate
        });
        var outcome = rule.ApprovalRequired ? "proposed a law in" : "enacted a law in";
        GameStore.AddActivity(game,
            $"{actor.Name} {outcome} {game.Territories.Single(item => item.StateId == selectedStateId).Name}.");
        return null;
    }

    public static OrderRejection? AppointOffice(
        WorldState game,
        PlayerState actor,
        Guid orderId,
        Guid? stateId,
        Guid? officeId,
        Guid? appointeePlayerId)
    {
        if (stateId is not Guid selectedStateId ||
            officeId is not Guid selectedOfficeId ||
            appointeePlayerId is not Guid selectedAppointeeId ||
            selectedStateId == Guid.Empty ||
            selectedOfficeId == Guid.Empty ||
            selectedAppointeeId == Guid.Empty)
            return new OrderRejection("INVALID_PAYLOAD", "A State, office, and appointee are required.");

        var (system, rule, error) =
            FindRule(game, selectedStateId, PoliticalCompetence.AppointOffice);
        if (error is not null)
            return error;

        var proposerMembership = game.Memberships.FirstOrDefault(item =>
            item.PlayerId == actor.Id &&
            item.StateId == selectedStateId &&
            item.Status == MembershipStatus.Active);
        if (proposerMembership is null ||
            !rule!.ProposerPermissionSetIds.Contains(proposerMembership.PermissionSetId))
            return new OrderRejection(
                "INSUFFICIENT_PERMISSION", "Your government permissions do not allow appointing office holders.");
        if (rule.ApprovalRequired && !HasEligibleVoters(game, selectedStateId, rule))
            return new OrderRejection(
                "NO_ELIGIBLE_VOTERS", "This procedure has no active members eligible to vote.");

        var office = system!.Offices.SingleOrDefault(item => item.Id == selectedOfficeId);
        if (office is null)
            return new OrderRejection("OFFICE_NOT_FOUND", "The selected office does not exist in this State.");
        if (office.InstitutionId != rule.InstitutionId)
            return new OrderRejection(
                "INSTITUTION_MISMATCH", "This constitutional competence does not control the selected institution.");
        if (!game.Players.Any(player => player.Id == selectedAppointeeId) ||
            !game.Memberships.Any(item =>
                item.PlayerId == selectedAppointeeId &&
                item.StateId == selectedStateId &&
                item.Status == MembershipStatus.Active))
            return new OrderRejection(
                "APPOINTEE_NOT_MEMBER", "The appointee must be an active member of this State government.");
        if (office.HolderPlayerId == selectedAppointeeId)
            return new OrderRejection("APPOINTEE_ALREADY_HOLDS_OFFICE", "This player already holds the selected office.");
        if (system.Decisions.Any(decision => decision.Id == orderId) ||
            system.Laws.Any(law => law.Id == orderId))
            return new OrderRejection("DECISION_ID_CONFLICT", "This decision ID is already in use.");
        if (system.Decisions.Any(decision =>
                decision.Competence == PoliticalCompetence.AppointOffice &&
                decision.OfficeId == selectedOfficeId &&
                decision.Status == PoliticalDecisionStatus.PendingApproval))
            return new OrderRejection(
                "OFFICE_APPOINTMENT_PENDING", "An appointment decision is already pending for this office.");

        var appointeeName = game.Players.Single(player => player.Id == selectedAppointeeId).Name;
        var decision = new PoliticalDecision
        {
            Id = orderId,
            StateId = selectedStateId,
            Competence = PoliticalCompetence.AppointOffice,
            ProposerPlayerId = actor.Id,
            InstitutionId = rule.InstitutionId,
            ConstitutionVersion = system.Constitution!.Version,
            Title = $"Appoint {appointeeName} as {office.Name}",
            Text = $"Appoint {appointeeName} to the office of {office.Name}.",
            LegalBasis = rule.LegalBasis,
            OfficeId = office.Id,
            AppointeePlayerId = selectedAppointeeId,
            Status = rule.ApprovalRequired
                ? PoliticalDecisionStatus.PendingApproval
                : PoliticalDecisionStatus.Approved,
            ProposedOnWorldDate = game.WorldDate,
            ResolvedOnWorldDate = rule.ApprovalRequired ? null : game.WorldDate
        };
        system.Decisions.Add(decision);
        if (!rule.ApprovalRequired)
            ApplyAppointment(game, system, decision);

        var outcome = rule.ApprovalRequired ? "proposed an appointment to" : "appointed";
        GameStore.AddActivity(game, $"{actor.Name} {outcome} {office.Name}.");
        return null;
    }

    public static OrderRejection? ApproveBudget(
        WorldState game,
        PlayerState actor,
        Guid orderId,
        Guid? stateId,
        int? proposedBudget)
    {
        if (stateId is not Guid selectedStateId ||
            selectedStateId == Guid.Empty ||
            proposedBudget is not int budget ||
            budget < 0)
            return new OrderRejection("INVALID_PAYLOAD", "A State and a non-negative budget amount are required.");

        var (system, rule, error) =
            FindRule(game, selectedStateId, PoliticalCompetence.ApproveBudget);
        if (error is not null)
            return error;
        if (system!.Government is null)
            return new OrderRejection(
                "GOVERNMENT_NOT_CONFIGURED", "This State has no configured government budget.");

        var membership = game.Memberships.FirstOrDefault(item =>
            item.PlayerId == actor.Id &&
            item.StateId == selectedStateId &&
            item.Status == MembershipStatus.Active);
        if (membership is null ||
            !rule!.ProposerPermissionSetIds.Contains(membership.PermissionSetId))
            return new OrderRejection(
                "INSUFFICIENT_PERMISSION", "Your government permissions do not allow approving a budget.");
        if (rule.ApprovalRequired && !HasEligibleVoters(game, selectedStateId, rule))
            return new OrderRejection(
                "NO_ELIGIBLE_VOTERS", "This procedure has no active members eligible to vote.");
        if (system.Decisions.Any(decision => decision.Id == orderId) ||
            system.Laws.Any(law => law.Id == orderId))
            return new OrderRejection("DECISION_ID_CONFLICT", "This decision ID is already in use.");

        var decision = new PoliticalDecision
        {
            Id = orderId,
            StateId = selectedStateId,
            Competence = PoliticalCompetence.ApproveBudget,
            ProposerPlayerId = actor.Id,
            InstitutionId = rule.InstitutionId,
            ConstitutionVersion = system.Constitution!.Version,
            Title = "Approve government budget",
            Text = $"Set the government budget plan to {budget}.",
            LegalBasis = rule.LegalBasis,
            ProposedBudget = budget,
            Status = rule.ApprovalRequired
                ? PoliticalDecisionStatus.PendingApproval
                : PoliticalDecisionStatus.Approved,
            ProposedOnWorldDate = game.WorldDate,
            ResolvedOnWorldDate = rule.ApprovalRequired ? null : game.WorldDate
        };
        system.Decisions.Add(decision);
        if (!rule.ApprovalRequired)
            system.Government.Budget = budget;

        var outcome = rule.ApprovalRequired ? "proposed" : "approved";
        GameStore.AddActivity(game, $"{actor.Name} {outcome} a government budget of {budget}.");
        return null;
    }

    public static OrderRejection? VoteOnDecision(
        WorldState game,
        PlayerState actor,
        Guid? stateId,
        Guid? decisionId,
        PoliticalVoteChoice? choice)
    {
        if (stateId is not Guid selectedStateId ||
            decisionId is not Guid selectedDecisionId ||
            choice is not PoliticalVoteChoice voteChoice ||
            !Enum.IsDefined(voteChoice))
            return new OrderRejection("INVALID_PAYLOAD", "A State, decision, and valid vote are required.");

        var system = game.PoliticalSystems.SingleOrDefault(item => item.StateId == selectedStateId);
        var decision = system?.Decisions.SingleOrDefault(item =>
            item.Id == selectedDecisionId && item.StateId == selectedStateId);
        if (decision is null)
            return new OrderRejection("DECISION_NOT_FOUND", "The political decision does not exist in this State.");
        if (decision.Status != PoliticalDecisionStatus.PendingApproval)
            return new OrderRejection("DECISION_CLOSED", "This political decision is no longer open for votes.");

        var (configuredSystem, rule, error) =
            FindRule(game, selectedStateId, decision.Competence);
        if (error is not null)
            return error;
        system = configuredSystem!;
        var votingRule = rule!;
        if (decision.Competence != votingRule.Competence ||
            decision.InstitutionId != votingRule.InstitutionId ||
            decision.ConstitutionVersion != system.Constitution!.Version)
            return new OrderRejection(
                "CONSTITUTION_CHANGED", "The decision no longer matches the State's current constitution.");
        if (!votingRule.ApprovalRequired)
            return new OrderRejection(
                "APPROVAL_NOT_REQUIRED", "This constitutional procedure does not require a vote.");
        if (decision.Competence == PoliticalCompetence.AppointOffice &&
            (decision.AppointeePlayerId is not Guid appointeeId ||
             !game.Memberships.Any(item =>
                 item.PlayerId == appointeeId &&
                 item.StateId == selectedStateId &&
                 item.Status == MembershipStatus.Active)))
            return new OrderRejection(
                "APPOINTEE_NOT_MEMBER", "The proposed appointee is no longer an active member of this State government.");
        if (decision.Competence == PoliticalCompetence.ApproveBudget && system.Government is null)
            return new OrderRejection(
                "GOVERNMENT_NOT_CONFIGURED", "This State has no configured government budget.");

        var membership = game.Memberships.FirstOrDefault(item =>
            item.PlayerId == actor.Id &&
            item.StateId == selectedStateId &&
            item.Status == MembershipStatus.Active);
        if (membership is null || !votingRule.VoterPermissionSetIds.Contains(membership.PermissionSetId))
            return new OrderRejection(
                "INSUFFICIENT_PERMISSION", "Your government permissions do not allow voting on this decision.");
        if (decision.Votes.Any(vote => vote.PlayerId == actor.Id))
            return new OrderRejection("ALREADY_VOTED", "Each eligible member can vote once on this decision.");

        decision.Votes.Add(new PoliticalVote(
            actor.Id, membership.Id, voteChoice, game.WorldDate));
        var eligibleVoters = game.Memberships
            .Where(item => item.StateId == selectedStateId &&
                           item.Status == MembershipStatus.Active &&
                           votingRule.VoterPermissionSetIds.Contains(item.PermissionSetId))
            .Select(item => item.PlayerId)
            .ToHashSet();
        var approvalVotes = decision.Votes.Count(vote => vote.Choice == PoliticalVoteChoice.Approve);
        var thresholdBase = votingRule.ApprovalThresholdBasis switch
        {
            ApprovalThresholdBasis.VotesCast => decision.Votes.Count,
            ApprovalThresholdBasis.EligibleVoters => eligibleVoters.Count,
            _ => throw new InvalidDataException("A constitutional approval threshold basis is not configured.")
        };
        var requiredApprovalVotes = (thresholdBase * votingRule.ApprovalThresholdPercent + 99) / 100;
        if (decision.Votes.Count >= votingRule.MinimumVotes && approvalVotes >= requiredApprovalVotes)
        {
            decision.Status = PoliticalDecisionStatus.Approved;
            decision.ResolvedOnWorldDate = game.WorldDate;
        }
        else if (eligibleVoters.All(playerId =>
                     decision.Votes.Any(vote => vote.PlayerId == playerId)))
        {
            decision.Status = PoliticalDecisionStatus.Rejected;
            decision.ResolvedOnWorldDate = game.WorldDate;
        }

        if (decision.Status == PoliticalDecisionStatus.Approved)
        {
            if (decision.Competence == PoliticalCompetence.ProposeLaw)
            {
                var law = system.Laws.SingleOrDefault(item => item.DecisionId == decision.Id)
                    ?? throw new InvalidDataException("A legislative decision has no corresponding law record.");
                law.Status = PoliticalLawStatus.InForce;
                law.EffectiveFrom = game.WorldDate;
            }
            else if (decision.Competence == PoliticalCompetence.AppointOffice)
            {
                ApplyAppointment(game, system, decision);
            }
            else if (decision.Competence == PoliticalCompetence.ApproveBudget)
            {
                if (system.Government is null || decision.ProposedBudget is not int approvedBudget)
                    throw new InvalidDataException("An approved budget decision has no configured government or amount.");
                system.Government.Budget = approvedBudget;
            }
            else
            {
                throw new InvalidDataException("An approved political decision has an unsupported competence.");
            }
        }
        else if (decision.Status == PoliticalDecisionStatus.Rejected &&
                 decision.Competence == PoliticalCompetence.ProposeLaw)
        {
            var law = system.Laws.SingleOrDefault(item => item.DecisionId == decision.Id)
                ?? throw new InvalidDataException("A legislative decision has no corresponding law record.");
            law.Status = PoliticalLawStatus.Rejected;
            law.EffectiveFrom = null;
        }

        var choiceText = voteChoice == PoliticalVoteChoice.Approve ? "approved" : "rejected";
        GameStore.AddActivity(game, $"{actor.Name} voted to {choiceText} \"{decision.Title}\".");
        return null;
    }

    private static void ApplyAppointment(
        WorldState game,
        StatePoliticalSystem system,
        PoliticalDecision decision)
    {
        if (decision.OfficeId is not Guid officeId ||
            decision.AppointeePlayerId is not Guid appointeePlayerId ||
            !game.Memberships.Any(item =>
                item.PlayerId == appointeePlayerId &&
                item.StateId == system.StateId &&
                item.Status == MembershipStatus.Active))
            throw new InvalidDataException("The approved office appointment has an invalid appointee.");

        var office = system.Offices.SingleOrDefault(item => item.Id == officeId)
            ?? throw new InvalidDataException("The approved office appointment references a missing office.");
        office.HolderPlayerId = appointeePlayerId;
        office.TermStartsOn = game.WorldDate;
    }

    private static bool HasEligibleVoters(
        WorldState game, Guid stateId, ConstitutionalCompetenceRule rule) =>
        game.Memberships.Any(item =>
            item.StateId == stateId &&
            item.Status == MembershipStatus.Active &&
            rule.VoterPermissionSetIds.Contains(item.PermissionSetId));

    public static int? CalculateStability(StatePoliticalSystem system)
    {
        var government = system.Government;
        var weights = system.Constitution?.StabilityWeights;
        if (government is null || weights is null)
            return null;

        var components = new[]
        {
            (government.Legitimacy, weights.Legitimacy),
            (government.InstitutionalSupport, weights.InstitutionalSupport),
            (100 - government.Tensions, weights.Tensions),
            (government.EconomicCondition, weights.EconomicCondition),
            (100 - government.ConflictPressure, weights.ConflictPressure),
            (government.Compliance, weights.Compliance)
        };
        if (components.Any(component => component.Item1 is < 0 or > 100 || component.Item2 < 0))
            return null;
        var totalWeight = components.Sum(component => component.Item2);
        if (totalWeight == 0)
            return null;
        return (int)Math.Round(
            components.Sum(component => (long)component.Item1 * component.Item2) / (double)totalWeight,
            MidpointRounding.AwayFromZero);
    }

    private static (
        StatePoliticalSystem? System,
        ConstitutionalCompetenceRule? Rule,
        OrderRejection? Error) FindRule(
        WorldState game, Guid stateId, PoliticalCompetence competence)
    {
        var system = game.PoliticalSystems.SingleOrDefault(item => item.StateId == stateId);
        var constitution = system?.Constitution;
        if (system is null || constitution is null)
            return (system, null, new OrderRejection(
                "CONSTITUTION_NOT_CONFIGURED", "This State's constitutional rules have not been defined."));
        if (constitution.Id == Guid.Empty || constitution.Version < 1 ||
            constitution.EffectiveFrom > game.WorldDate)
            return (system, null, new OrderRejection(
                "INVALID_CONSTITUTION", "The State's constitution is invalid or not yet in force."));

        var matchingRules = constitution.CompetenceRules
            .Where(rule => rule.Competence == competence)
            .ToList();
        if (matchingRules.Count != 1)
            return (system, null, new OrderRejection(
                "COMPETENCE_NOT_CONFIGURED", "This constitutional competence is not configured."));

        var rule = matchingRules[0];
        var institutionExists = system.Institutions.Any(institution =>
            institution.Id == rule.InstitutionId && Enum.IsDefined(institution.Branch));
        if (rule.Id == Guid.Empty || !institutionExists ||
            string.IsNullOrWhiteSpace(rule.LegalBasis) ||
            rule.ProposerPermissionSetIds.Count == 0 ||
            rule.ProposerPermissionSetIds.Any(string.IsNullOrWhiteSpace) ||
            rule.ApprovalRequired &&
            (rule.MinimumVotes < 1 ||
             rule.ApprovalThresholdPercent is < 1 or > 100 ||
             rule.ApprovalThresholdBasis is not (ApprovalThresholdBasis.VotesCast or ApprovalThresholdBasis.EligibleVoters) ||
             rule.VoterPermissionSetIds.Count == 0 ||
             rule.VoterPermissionSetIds.Any(string.IsNullOrWhiteSpace)))
            return (system, null, new OrderRejection(
                "INVALID_CONSTITUTION", "The configured procedure is incomplete or invalid."));

        return (system, rule, null);
    }
}
