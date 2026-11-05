using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using NewWorld.Server.Models;

namespace NewWorld.Server.Services;

public static class WorldStateCompatibility
{
    private static readonly DateOnly ScenarioStartDate = new(1500, 1, 1);
    private static readonly JsonSerializerOptions CloneOptions = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) }
    };

    public static WorldState Clone(WorldState game)
    {
        var clone = JsonSerializer.Deserialize<WorldState>(
            JsonSerializer.Serialize(game, CloneOptions), CloneOptions)
            ?? throw new InvalidDataException("The saved world could not be cloned.");
        Normalize(clone);
        return clone;
    }

    public static void Normalize(WorldState game)
    {
        game.Players ??= [];
        game.Memberships ??= [];
        game.Territories ??= [];
        game.PoliticalSystems ??= [];
        game.Orders ??= [];
        game.Events ??= [];
        game.Activity ??= [];
        game.PauseVotes ??= [];

        if (game.Day < 1)
            game.Day = 1;
        if (game.WorldDate == default)
        {
            var elapsedDays = (int)Math.Min(
                (long)game.Day - 1,
                DateOnly.MaxValue.DayNumber - ScenarioStartDate.DayNumber);
            game.WorldDate = ScenarioStartDate.AddDays(elapsedDays);
        }

        if (game.WorldVersion < 1)
            game.WorldVersion = 1;
        if (!Enum.IsDefined(game.Status))
            throw new InvalidDataException("The saved world has an invalid session status.");
        if (game.ClockAccumulatorTicks < 0 ||
            game.ClockAccumulatorTicks >= TimeSpan.FromMinutes(5).Ticks)
            throw new InvalidDataException("The saved world has an invalid clock accumulator.");
        if (game.MaxHumanPlayers < 1)
            game.MaxHumanPlayers = GameCatalog.MaxHumanPlayers;
        game.MaxHumanPlayers = Math.Min(game.MaxHumanPlayers, GameCatalog.MaxHumanPlayers);
        if (game.Started && game.Status is GameStatus.Lobby or GameStatus.Running or GameStatus.Paused)
            game.Status = game.Paused ? GameStatus.Paused : GameStatus.Running;
        else if (!game.Started && game.Status is (GameStatus.Running or GameStatus.Paused))
        {
            game.Status = GameStatus.Lobby;
            game.Paused = false;
        }

        foreach (var territory in game.Territories)
        {
            if (territory.StateId == Guid.Empty)
                territory.StateId = CreateStableId($"{game.Id:N}:state:{territory.Index}");
        }

        var stateIds = game.Territories.Select(territory => territory.StateId).ToHashSet();
        var playerIds = game.Players.Select(player => player.Id).ToHashSet();
        foreach (var territory in game.Territories)
        {
            if (game.PoliticalSystems.All(system => system.StateId != territory.StateId))
                game.PoliticalSystems.Add(new StatePoliticalSystem { StateId = territory.StateId });
        }

        var politicalStateIds = new HashSet<Guid>();
        foreach (var system in game.PoliticalSystems)
        {
            if (!stateIds.Contains(system.StateId) || !politicalStateIds.Add(system.StateId))
                throw new InvalidDataException("The saved world contains an invalid State political system.");

            system.Institutions ??= [];
            system.Offices ??= [];
            system.Parties ??= [];
            system.Laws ??= [];
            system.Decisions ??= [];
            if (system.Constitution is not null)
            {
                system.Constitution.CompetenceRules ??= [];
                foreach (var rule in system.Constitution.CompetenceRules)
                {
                    rule.ProposerPermissionSetIds ??= [];
                    rule.VoterPermissionSetIds ??= [];
                }
            }

            var institutionIds = new HashSet<Guid>();
            foreach (var institution in system.Institutions)
            {
                institution.OfficeIds ??= [];
                if (institution.Id == Guid.Empty ||
                    string.IsNullOrWhiteSpace(institution.Name) ||
                    !Enum.IsDefined(institution.Branch) ||
                    !institutionIds.Add(institution.Id))
                    throw new InvalidDataException("The saved world contains an invalid political institution.");
            }

            if (system.Regime is not null &&
                (system.Regime.Id == Guid.Empty || string.IsNullOrWhiteSpace(system.Regime.Name)))
                throw new InvalidDataException("The saved world contains an invalid political regime.");

            if (system.Constitution is not null)
            {
                var constitution = system.Constitution;
                var ruleIds = new HashSet<Guid>();
                var competences = new HashSet<PoliticalCompetence>();
                if (constitution.Id == Guid.Empty || constitution.Version < 1 ||
                    constitution.EffectiveFrom == default ||
                    constitution.CompetenceRules.Any(rule =>
                        rule.Id == Guid.Empty ||
                        !Enum.IsDefined(rule.Competence) ||
                        !competences.Add(rule.Competence) ||
                        !ruleIds.Add(rule.Id) ||
                        !institutionIds.Contains(rule.InstitutionId) ||
                        string.IsNullOrWhiteSpace(rule.LegalBasis) ||
                        rule.ProposerPermissionSetIds.Count == 0 ||
                        rule.ProposerPermissionSetIds.Any(string.IsNullOrWhiteSpace) ||
                        rule.ApprovalRequired &&
                        (rule.MinimumVotes < 1 ||
                         rule.ApprovalThresholdPercent is < 1 or > 100 ||
                         rule.ApprovalThresholdBasis is not (ApprovalThresholdBasis.VotesCast or ApprovalThresholdBasis.EligibleVoters) ||
                         rule.VoterPermissionSetIds.Count == 0 ||
                         rule.VoterPermissionSetIds.Any(string.IsNullOrWhiteSpace))))
                    throw new InvalidDataException("The saved world contains an invalid constitution.");
            }

            if (system.Government is PoliticalGovernment government &&
                (government.Id == Guid.Empty ||
                 government.Budget < 0 ||
                 government.Legitimacy is < 0 or > 100 ||
                 government.InstitutionalSupport is < 0 or > 100 ||
                 government.Tensions is < 0 or > 100 ||
                 government.EconomicCondition is < 0 or > 100 ||
                 government.ConflictPressure is < 0 or > 100 ||
                 government.Compliance is < 0 or > 100))
                throw new InvalidDataException("The saved world contains an invalid government.");
            if (system.Constitution?.StabilityWeights is StabilityWeights weights &&
                (weights.Legitimacy < 0 || weights.InstitutionalSupport < 0 ||
                 weights.Tensions < 0 || weights.EconomicCondition < 0 ||
                 weights.ConflictPressure < 0 || weights.Compliance < 0 ||
                 (long)weights.Legitimacy + weights.InstitutionalSupport + weights.Tensions +
                 weights.EconomicCondition + weights.ConflictPressure + weights.Compliance == 0))
                throw new InvalidDataException("The saved world contains invalid stability weights.");

            var officeIds = new HashSet<Guid>();
            foreach (var office in system.Offices)
            {
                office.Competences ??= [];
                if (office.Id == Guid.Empty ||
                    string.IsNullOrWhiteSpace(office.Name) ||
                    !institutionIds.Contains(office.InstitutionId) ||
                    office.HolderPlayerId is Guid holderId && !playerIds.Contains(holderId) ||
                    office.TermStartsOn is DateOnly starts &&
                    office.TermEndsOn is DateOnly ends && ends < starts ||
                    office.Competences.Any(competence => !Enum.IsDefined(competence)) ||
                    !officeIds.Add(office.Id))
                    throw new InvalidDataException("The saved world contains an invalid political office.");
            }

            foreach (var party in system.Parties)
                party.MemberPlayerIds ??= [];

            if (system.Institutions.Any(institution =>
                    institution.OfficeIds.Any(officeId =>
                        !officeIds.Contains(officeId) ||
                        system.Offices.Single(office => office.Id == officeId).InstitutionId != institution.Id)) ||
                system.Parties.Any(party =>
                    party.Id == Guid.Empty ||
                    string.IsNullOrWhiteSpace(party.Name) ||
                    party.Seats < 0 ||
                    party.MemberPlayerIds.Any(playerId => !playerIds.Contains(playerId))) ||
                system.Parties.Select(party => party.Id).Distinct().Count() != system.Parties.Count)
                throw new InvalidDataException("The saved world contains invalid political representation.");

            var decisionIds = new HashSet<Guid>();
            foreach (var decision in system.Decisions)
            {
                decision.Votes ??= [];
                if (decision.Id == Guid.Empty ||
                    decision.StateId != system.StateId ||
                    !Enum.IsDefined(decision.Competence) ||
                    !Enum.IsDefined(decision.Status) ||
                    !playerIds.Contains(decision.ProposerPlayerId) ||
                    !institutionIds.Contains(decision.InstitutionId) ||
                    string.IsNullOrWhiteSpace(decision.Title) ||
                    string.IsNullOrWhiteSpace(decision.Text) ||
                    string.IsNullOrWhiteSpace(decision.LegalBasis) ||
                    decision.ConstitutionVersion < 1 ||
                    decision.Competence == PoliticalCompetence.ProposeLaw &&
                    (decision.OfficeId is not null ||
                     decision.AppointeePlayerId is not null ||
                     decision.ProposedBudget is not null) ||
                    decision.Competence == PoliticalCompetence.AppointOffice &&
                    (decision.OfficeId is not Guid officeId ||
                     !officeIds.Contains(officeId) ||
                     decision.AppointeePlayerId is not Guid appointeeId ||
                     !playerIds.Contains(appointeeId) ||
                     decision.ProposedBudget is not null) ||
                    decision.Competence == PoliticalCompetence.ApproveBudget &&
                    (system.Government is null ||
                     decision.ProposedBudget is not int proposedBudget ||
                     proposedBudget < 0 ||
                     decision.OfficeId is not null ||
                     decision.AppointeePlayerId is not null) ||
                    decision.Competence is not (PoliticalCompetence.ProposeLaw or
                        PoliticalCompetence.AppointOffice or PoliticalCompetence.ApproveBudget) ||
                    decision.ProposedOnWorldDate == default ||
                    decision.ProposedOnWorldDate > game.WorldDate ||
                    decision.Status == PoliticalDecisionStatus.PendingApproval &&
                    decision.ResolvedOnWorldDate is not null ||
                    decision.Status != PoliticalDecisionStatus.PendingApproval &&
                    (decision.ResolvedOnWorldDate is not DateOnly resolvedOn ||
                     resolvedOn < decision.ProposedOnWorldDate || resolvedOn > game.WorldDate) ||
                    !decisionIds.Add(decision.Id) ||
                    decision.Votes.Any(vote =>
                        !playerIds.Contains(vote.PlayerId) ||
                        !Enum.IsDefined(vote.Choice) ||
                        vote.CastOnWorldDate < decision.ProposedOnWorldDate ||
                        vote.CastOnWorldDate > game.WorldDate ||
                        !game.Memberships.Any(membership =>
                            membership.Id == vote.MembershipId &&
                            membership.PlayerId == vote.PlayerId &&
                            membership.StateId == system.StateId)) ||
                    decision.Votes.Select(vote => vote.PlayerId).Distinct().Count() != decision.Votes.Count)
                    throw new InvalidDataException("The saved world contains an invalid political decision.");
            }

            var decisionsById = system.Decisions.ToDictionary(decision => decision.Id);
            var lawIds = new HashSet<Guid>();
            foreach (var law in system.Laws)
            {
                if (law.Id == Guid.Empty ||
                    law.StateId != system.StateId ||
                    !playerIds.Contains(law.ProposerPlayerId) ||
                    !decisionsById.TryGetValue(law.DecisionId, out var decision) ||
                    law.Id != decision.Id ||
                    law.ProposerPlayerId != decision.ProposerPlayerId ||
                    law.Title != decision.Title ||
                    law.Text != decision.Text ||
                    law.LegalBasis != decision.LegalBasis ||
                    !Enum.IsDefined(law.Status) ||
                    law.ProposedOnWorldDate != decision.ProposedOnWorldDate ||
                    !lawIds.Add(law.Id) ||
                    decision.Status == PoliticalDecisionStatus.PendingApproval &&
                    (law.Status != PoliticalLawStatus.Proposed || law.EffectiveFrom is not null) ||
                    decision.Status == PoliticalDecisionStatus.Approved &&
                    (law.Status != PoliticalLawStatus.InForce ||
                     law.EffectiveFrom is null ||
                     law.EffectiveFrom != decision.ResolvedOnWorldDate) ||
                    decision.Status == PoliticalDecisionStatus.Rejected &&
                    (law.Status != PoliticalLawStatus.Rejected || law.EffectiveFrom is not null) ||
                    law.EffectiveFrom is DateOnly effectiveFrom &&
                    (effectiveFrom < law.ProposedOnWorldDate || effectiveFrom > game.WorldDate))
                    throw new InvalidDataException("The saved world contains an invalid political law.");
            }
            var lawDecisionIds = system.Decisions
                .Where(decision => decision.Competence == PoliticalCompetence.ProposeLaw)
                .Select(decision => decision.Id)
                .ToHashSet();
            if (lawIds.Count != lawDecisionIds.Count ||
                lawIds.Any(lawId => !lawDecisionIds.Contains(lawId)))
                throw new InvalidDataException("The saved world contains a legislative decision without a corresponding law.");
        }

        var membershipIds = new HashSet<Guid>();
        var activePlayerStates = new HashSet<(Guid PlayerId, Guid StateId)>();
        foreach (var player in game.Players)
        {
            if (player.LegacyCountryIndex is not int countryIndex ||
                countryIndex < 0 ||
                countryIndex >= game.Territories.Count ||
                game.Memberships.Any(membership =>
                    membership.PlayerId == player.Id && membership.Status == MembershipStatus.Active))
                continue;

            var territory = game.Territories.Single(item => item.Index == countryIndex);
            game.Memberships.Add(new GovernmentMembership
            {
                Id = CreateStableId($"{game.Id:N}:membership:{player.Id:N}:{territory.StateId:N}"),
                GameId = game.Id,
                PlayerId = player.Id,
                StateId = territory.StateId,
                JoinedAtWorldDate = game.WorldDate
            });
        }

        foreach (var membership in game.Memberships)
        {
            if (membership.Id == Guid.Empty)
                membership.Id = CreateStableId(
                    $"{game.Id:N}:membership:{membership.PlayerId:N}:{membership.StateId:N}");
            if (membership.GameId == Guid.Empty)
                membership.GameId = game.Id;
            if (membership.GameId != game.Id ||
                !playerIds.Contains(membership.PlayerId) ||
                !stateIds.Contains(membership.StateId) ||
                !Enum.IsDefined(membership.Status) ||
                string.IsNullOrWhiteSpace(membership.PermissionSetId) ||
                !membershipIds.Add(membership.Id) ||
                membership.Status == MembershipStatus.Active &&
                !activePlayerStates.Add((membership.PlayerId, membership.StateId)))
                throw new InvalidDataException("The saved world contains an invalid government membership.");
        }

        if (game.Players.Any(player =>
                player.Treasury < 0 || player.DailyBalanceRemainder is < 0 or >= 30))
            throw new InvalidDataException("The saved world contains invalid legacy player finances.");

        var ordersById = new Dictionary<Guid, GameOrder>();
        foreach (var order in game.Orders)
        {
            if (order.GameId != game.Id ||
                order.Id == Guid.Empty ||
                !playerIds.Contains(order.PlayerId) ||
                order.Payload is null ||
                !Enum.IsDefined(order.Type) ||
                !Enum.IsDefined(order.Status) ||
                order.PermissionSetId is not null && string.IsNullOrWhiteSpace(order.PermissionSetId) ||
                order.ExpectedWorldVersion < 1 ||
                !ordersById.TryAdd(order.Id, order) ||
                (order.Status == GameOrderStatus.Executed &&
                    order.StateId is Guid executedStateId && !stateIds.Contains(executedStateId)) ||
                (order.Status == GameOrderStatus.Executed &&
                    (order.ResultCode is not null || order.Result is not null)) ||
                (order.Status == GameOrderStatus.Executed &&
                    order.TargetWorldDate is DateOnly targetDate && targetDate != order.SubmittedOnWorldDate) ||
                (order.Status == GameOrderStatus.Rejected &&
                    (string.IsNullOrWhiteSpace(order.ResultCode) || string.IsNullOrWhiteSpace(order.Result))) ||
                order.WorldVersion < 1 ||
                order.WorldVersion > game.WorldVersion)
                throw new InvalidDataException("The saved world contains an invalid order record.");
        }

        if (game.EventSequence < 0)
            throw new InvalidDataException("The saved world has an invalid event sequence.");
        var knownEventSequences = new HashSet<long>();
        foreach (var worldEvent in game.Events)
        {
            if (worldEvent.Sequence < 0 ||
                worldEvent.Sequence > 0 && !knownEventSequences.Add(worldEvent.Sequence))
                throw new InvalidDataException("The saved world contains duplicate event sequences.");
            game.EventSequence = Math.Max(game.EventSequence, worldEvent.Sequence);
        }
        for (var index = 0; index < game.Events.Count; index++)
        {
            if (game.Events[index].Sequence != 0)
                continue;
            game.EventSequence++;
            game.Events[index] = game.Events[index] with { Sequence = game.EventSequence };
        }

        var eventIds = new HashSet<Guid>();
        var eventOrderIds = new HashSet<Guid>();
        var validatedEventSequences = new HashSet<long>();
        foreach (var worldEvent in game.Events)
        {
            var linkedOrder = worldEvent.OrderId is Guid eventOrderId
                ? ordersById.GetValueOrDefault(eventOrderId)
                : null;
            if (worldEvent.Id == Guid.Empty ||
                worldEvent.GameId != game.Id ||
                worldEvent.ActorPlayerId is Guid actorId && !playerIds.Contains(actorId) ||
                worldEvent.StateId is Guid eventStateId && !stateIds.Contains(eventStateId) ||
                worldEvent.OrderId is not null && linkedOrder is null ||
                worldEvent.OrderId is Guid linkedOrderId && !eventOrderIds.Add(linkedOrderId) ||
                string.IsNullOrWhiteSpace(worldEvent.Type) ||
                string.IsNullOrWhiteSpace(worldEvent.Description) ||
                worldEvent.Sequence < 1 ||
                worldEvent.Sequence > game.EventSequence ||
                !validatedEventSequences.Add(worldEvent.Sequence) ||
                worldEvent.WorldVersion < 1 ||
                worldEvent.WorldVersion > game.WorldVersion ||
                linkedOrder is not null &&
                (worldEvent.ActorPlayerId != linkedOrder.PlayerId ||
                 worldEvent.StateId != (linkedOrder.StateId is Guid linkedStateId && stateIds.Contains(linkedStateId)
                     ? linkedStateId
                     : null) ||
                 worldEvent.WorldVersion != linkedOrder.WorldVersion ||
                 worldEvent.ResultCode != linkedOrder.ResultCode ||
                 worldEvent.Type != (linkedOrder.Status == GameOrderStatus.Executed
                     ? "order.executed"
                     : "order.rejected")) ||
                !eventIds.Add(worldEvent.Id))
                throw new InvalidDataException("The saved world contains an invalid world event.");
        }

        foreach (var order in game.Orders)
        {
            if (!eventOrderIds.Add(order.Id))
                continue;
            Guid? stateId = order.StateId is Guid requestedStateId && stateIds.Contains(requestedStateId)
                ? requestedStateId
                : null;
            game.Events.Add(new WorldEvent(
                CreateStableId($"{game.Id:N}:order-event:{order.Id:N}"),
                game.Id,
                order.Id,
                order.PlayerId,
                stateId,
                order.Status == GameOrderStatus.Executed ? "order.executed" : "order.rejected",
                order.ResultCode,
                order.SubmittedAtUtc,
                order.SubmittedOnWorldDate,
                order.WorldVersion,
                order.Status == GameOrderStatus.Executed
                    ? $"Executed {order.Type}."
                    : order.Result!,
                ++game.EventSequence));
        }

        if (game.EconomyVersion < 1)
        {
            foreach (var player in game.Players)
            {
                var activeMemberships = game.Memberships.Where(membership =>
                    membership.PlayerId == player.Id && membership.Status == MembershipStatus.Active).ToList();
                if (activeMemberships.Count == 0)
                    continue;

                var membership = activeMemberships.FirstOrDefault(item =>
                    game.Territories.Single(territory => territory.StateId == item.StateId).Index ==
                    player.LegacyCountryIndex) ?? activeMemberships[0];
                var government = game.Territories.Single(territory => territory.StateId == membership.StateId);
                var accumulatedRemainder =
                    (long)government.DailyBalanceRemainder + player.DailyBalanceRemainder;
                var treasuryIncrease = (long)player.Treasury + accumulatedRemainder / 30;
                if (government.Treasury > int.MaxValue - treasuryIncrease)
                    throw new InvalidDataException("The saved world exceeds the supported state treasury limit.");

                government.Treasury += (int)treasuryIncrease;
                government.DailyBalanceRemainder = (int)(accumulatedRemainder % 30);
                player.Treasury = 0;
                player.DailyBalanceRemainder = 0;
            }
            game.EconomyVersion = 1;
        }

        foreach (var territory in game.Territories)
        {
            if (territory.Treasury < 0 || territory.DailyBalanceRemainder is < 0 or >= 30)
                throw new InvalidDataException("The saved world contains invalid state finances.");
        }
    }

    public static Guid CreateStableId(string value)
    {
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(value));
        return new Guid(hash.AsSpan(0, 16));
    }
}
