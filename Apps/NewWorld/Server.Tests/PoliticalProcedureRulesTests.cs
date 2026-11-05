using NewWorld.Server.Models;
using NewWorld.Server.Services;

namespace NewWorld.Server.Tests;

public sealed class PoliticalProcedureRulesTests
{
    [Fact]
    public void HostCanConfigurePoliticalSystemsBeforeTheWorldStarts()
    {
        var game = new WorldState
        {
            Id = Guid.NewGuid(),
            WorldVersion = 1,
            Territories = [new TerritoryState { StateId = Guid.NewGuid(), Index = 0, Name = "State" }]
        };
        var stateId = game.Territories[0].StateId;
        var institutionId = Guid.NewGuid();
        var system = new StatePoliticalSystem
        {
            StateId = stateId,
            Regime = new PoliticalRegime { Id = Guid.NewGuid(), Name = "Republic" },
            Constitution = new Constitution
            {
                Id = Guid.NewGuid(),
                EffectiveFrom = new DateOnly(1500, 1, 1),
                CompetenceRules =
                [
                    new ConstitutionalCompetenceRule
                    {
                        Id = Guid.NewGuid(),
                        Competence = PoliticalCompetence.ProposeLaw,
                        InstitutionId = institutionId,
                        LegalBasis = "Article 1",
                        ApprovalRequired = false,
                        ProposerPermissionSetIds = [GovernmentPermissionRules.MemberPermissionSetId],
                        VoterPermissionSetIds = [GovernmentPermissionRules.MemberPermissionSetId]
                    }
                ]
            },
            Institutions =
            [
                new PoliticalInstitution
                {
                    Id = institutionId,
                    Name = "Assembly",
                    Branch = PoliticalBranch.Legislative
                }
            ]
        };

        var error = PoliticalSetupRules.Configure(game, new PoliticalScenarioRequest(1, [system]));

        Assert.Null(error);
        Assert.Equal(stateId, Assert.Single(game.PoliticalSystems).StateId);
        Assert.Equal("Republic", game.PoliticalSystems[0].Regime!.Name);
    }

    [Fact]
    public void InvalidPoliticalConfigurationIsRejectedBeforeTheWorldStarts()
    {
        var game = new WorldState
        {
            Id = Guid.NewGuid(),
            WorldVersion = 1,
            Territories = [new TerritoryState { StateId = Guid.NewGuid(), Index = 0, Name = "State" }]
        };

        var error = PoliticalSetupRules.Configure(
            game,
            new PoliticalScenarioRequest(1, [new StatePoliticalSystem { StateId = Guid.NewGuid() }]));

        Assert.StartsWith("Invalid political configuration:", error);
    }

    [Fact]
    public void LawProposalRequiresAnExplicitConstitutionalCompetence()
    {
        var (game, player, stateId) = CreatePoliticalWorld(approvalThreshold: 50, minimumVotes: 1);
        game.PoliticalSystems.Single().Constitution = null;

        var error = PoliticalProcedureRules.ProposeLaw(
            game, player, Guid.NewGuid(), stateId, "Public road", "Authorize a road project.");

        Assert.Equal("CONSTITUTION_NOT_CONFIGURED", error?.Code);
        Assert.Empty(game.PoliticalSystems.Single().Decisions);
    }

    [Fact]
    public void ConfiguredConstitutionRecordsLawAndApprovalBasis()
    {
        var (game, player, stateId) = CreatePoliticalWorld(approvalThreshold: 67, minimumVotes: 2);
        var decisionId = Guid.NewGuid();

        var error = PoliticalProcedureRules.ProposeLaw(
            game, player, decisionId, stateId, "Public road", "Authorize a road project.");

        Assert.Null(error);
        var decision = Assert.Single(game.PoliticalSystems.Single().Decisions);
        Assert.Equal(decisionId, decision.Id);
        Assert.Equal(player.Id, decision.ProposerPlayerId);
        Assert.Equal("Article 4: legislative procedure", decision.LegalBasis);
        Assert.Equal(1, decision.ConstitutionVersion);
        Assert.Equal(PoliticalDecisionStatus.PendingApproval, decision.Status);
        var law = Assert.Single(game.PoliticalSystems.Single().Laws);
        Assert.Equal(decision.Id, law.DecisionId);
        Assert.Equal(PoliticalLawStatus.Proposed, law.Status);
        Assert.Null(law.EffectiveFrom);
        Assert.Single(WorldStateCompatibility.Clone(game).PoliticalSystems.Single().Laws);
    }

    [Fact]
    public void ConstitutionCanEnactALawWithoutApprovalWhenThatProcedureIsExplicit()
    {
        var (game, player, stateId) = CreatePoliticalWorld(approvalThreshold: 50, minimumVotes: 1);
        var rule = game.PoliticalSystems.Single().Constitution!.CompetenceRules.Single();
        rule.ApprovalRequired = false;
        rule.VoterPermissionSetIds.Clear();

        var error = PoliticalProcedureRules.ProposeLaw(
            game, player, Guid.NewGuid(), stateId, "Public road", "Authorize a road project.");

        Assert.Null(error);
        var decision = Assert.Single(game.PoliticalSystems.Single().Decisions);
        var law = Assert.Single(game.PoliticalSystems.Single().Laws);
        Assert.Equal(PoliticalDecisionStatus.Approved, decision.Status);
        Assert.Equal(game.WorldDate, decision.ResolvedOnWorldDate);
        Assert.Equal(PoliticalLawStatus.InForce, law.Status);
        Assert.Equal(game.WorldDate, law.EffectiveFrom);
        Assert.Empty(decision.Votes);
        var clonedLaw = WorldStateCompatibility.Clone(game).PoliticalSystems.Single().Laws.Single();
        Assert.Equal(game.WorldDate, clonedLaw.EffectiveFrom);
    }

    [Fact]
    public void UnpermittedHostCannotProposeLawByVirtueOfHosting()
    {
        var (game, player, stateId) = CreatePoliticalWorld(approvalThreshold: 50, minimumVotes: 1);
        player.IsHost = true;
        game.HostPlayerId = player.Id;
        game.Memberships.Single().PermissionSetId = "observer";

        var error = PoliticalProcedureRules.ProposeLaw(
            game, player, Guid.NewGuid(), stateId, "Public road", "Authorize a road project.");

        Assert.Equal("INSUFFICIENT_PERMISSION", error?.Code);
        Assert.Empty(game.PoliticalSystems.Single().Decisions);
    }

    [Fact]
    public void ProposalCannotBeVotedOnByAnIneligibleMemberOrTwice()
    {
        var (game, proposer, stateId) = CreatePoliticalWorld(approvalThreshold: 50, minimumVotes: 2);
        var otherVoter = AddEligibleVoters(game, stateId, 1).Single();
        var outsider = new PlayerState { Id = Guid.NewGuid(), Name = "Observer" };
        game.Players.Add(outsider);
        game.Memberships.Add(new GovernmentMembership
        {
            Id = Guid.NewGuid(),
            GameId = game.Id,
            PlayerId = outsider.Id,
            StateId = stateId,
            PermissionSetId = "observer"
        });
        var decisionId = Guid.NewGuid();
        Assert.Null(PoliticalProcedureRules.ProposeLaw(
            game, proposer, decisionId, stateId, "Public road", "Authorize a road project."));

        var unauthorized = PoliticalProcedureRules.VoteOnDecision(
            game, outsider, stateId, decisionId, PoliticalVoteChoice.Approve);
        Assert.Equal("INSUFFICIENT_PERMISSION", unauthorized?.Code);
        Assert.Empty(game.PoliticalSystems.Single().Decisions.Single().Votes);

        Assert.Null(PoliticalProcedureRules.VoteOnDecision(
            game, proposer, stateId, decisionId, PoliticalVoteChoice.Approve));
        var duplicate = PoliticalProcedureRules.VoteOnDecision(
            game, proposer, stateId, decisionId, PoliticalVoteChoice.Reject);

        Assert.Equal("ALREADY_VOTED", duplicate?.Code);
        Assert.Null(PoliticalProcedureRules.VoteOnDecision(
            game, otherVoter, stateId, decisionId, PoliticalVoteChoice.Approve));
        Assert.Equal(PoliticalDecisionStatus.Approved,
            game.PoliticalSystems.Single().Decisions.Single().Status);
        var law = Assert.Single(game.PoliticalSystems.Single().Laws);
        Assert.Equal(PoliticalLawStatus.InForce, law.Status);
        Assert.Equal(game.WorldDate, law.EffectiveFrom);
    }

    [Fact]
    public void DifferentConstitutionalThresholdsProduceDifferentDecisionResults()
    {
        var (firstGame, firstPlayer, firstStateId) =
            CreatePoliticalWorld(approvalThreshold: 60, minimumVotes: 3);
        var (secondGame, secondPlayer, secondStateId) =
            CreatePoliticalWorld(approvalThreshold: 75, minimumVotes: 3);
        var firstOtherVoters = AddEligibleVoters(firstGame, firstStateId, 2);
        var secondOtherVoters = AddEligibleVoters(secondGame, secondStateId, 2);
        var firstDecisionId = Guid.NewGuid();
        var secondDecisionId = Guid.NewGuid();
        Assert.Null(PoliticalProcedureRules.ProposeLaw(
            firstGame, firstPlayer, firstDecisionId, firstStateId, "First law", "A constitutional proposal."));
        Assert.Null(PoliticalProcedureRules.ProposeLaw(
            secondGame, secondPlayer, secondDecisionId, secondStateId, "Second law", "A constitutional proposal."));

        Assert.Null(PoliticalProcedureRules.VoteOnDecision(
            firstGame, firstPlayer, firstStateId, firstDecisionId, PoliticalVoteChoice.Approve));
        Assert.Null(PoliticalProcedureRules.VoteOnDecision(
            firstGame, firstOtherVoters[0], firstStateId, firstDecisionId, PoliticalVoteChoice.Reject));
        Assert.Null(PoliticalProcedureRules.VoteOnDecision(
            firstGame, firstOtherVoters[1], firstStateId, firstDecisionId, PoliticalVoteChoice.Approve));
        Assert.Null(PoliticalProcedureRules.VoteOnDecision(
            secondGame, secondPlayer, secondStateId, secondDecisionId, PoliticalVoteChoice.Approve));
        Assert.Null(PoliticalProcedureRules.VoteOnDecision(
            secondGame, secondOtherVoters[0], secondStateId, secondDecisionId, PoliticalVoteChoice.Reject));
        Assert.Null(PoliticalProcedureRules.VoteOnDecision(
            secondGame, secondOtherVoters[1], secondStateId, secondDecisionId, PoliticalVoteChoice.Approve));

        Assert.Equal(PoliticalDecisionStatus.Approved,
            firstGame.PoliticalSystems.Single().Decisions.Single().Status);
        Assert.Equal(PoliticalDecisionStatus.Rejected,
            secondGame.PoliticalSystems.Single().Decisions.Single().Status);
        var rejectedLaw = Assert.Single(secondGame.PoliticalSystems.Single().Laws);
        Assert.Equal(PoliticalLawStatus.Rejected, rejectedLaw.Status);
        Assert.Null(rejectedLaw.EffectiveFrom);
    }

    [Fact]
    public void StabilityIsCalculatedOnlyWhenAConfiguredFormulaExists()
    {
        var system = new StatePoliticalSystem
        {
            Government = new PoliticalGovernment
            {
                Id = Guid.NewGuid(),
                Legitimacy = 80,
                InstitutionalSupport = 60,
                Tensions = 20,
                EconomicCondition = 50,
                ConflictPressure = 10,
                Compliance = 70
            }
        };

        Assert.Null(PoliticalProcedureRules.CalculateStability(system));

        system.Constitution = new Constitution
        {
            Id = Guid.NewGuid(),
            StabilityWeights = new StabilityWeights(1, 1, 1, 1, 1, 1)
        };

        Assert.Equal(72, PoliticalProcedureRules.CalculateStability(system));
    }

    [Fact]
    public void ApprovalThresholdCanBeBasedOnTheEligibleElectorate()
    {
        var (game, proposer, stateId) = CreatePoliticalWorld(approvalThreshold: 60, minimumVotes: 2);
        var otherVoters = AddEligibleVoters(game, stateId, 2);
        var rule = game.PoliticalSystems.Single().Constitution!.CompetenceRules.Single();
        rule.ApprovalThresholdBasis = ApprovalThresholdBasis.EligibleVoters;
        var decisionId = Guid.NewGuid();
        Assert.Null(PoliticalProcedureRules.ProposeLaw(
            game, proposer, decisionId, stateId, "Public road", "Authorize a road project."));

        Assert.Null(PoliticalProcedureRules.VoteOnDecision(
            game, proposer, stateId, decisionId, PoliticalVoteChoice.Approve));
        Assert.Null(PoliticalProcedureRules.VoteOnDecision(
            game, otherVoters[0], stateId, decisionId, PoliticalVoteChoice.Approve));

        Assert.Equal(PoliticalDecisionStatus.Approved,
            game.PoliticalSystems.Single().Decisions.Single().Status);
    }

    [Fact]
    public void OfficeCanBeAppointedDirectlyWhenConstitutionDoesNotRequireApproval()
    {
        var (game, player, stateId) = CreatePoliticalWorld(approvalThreshold: 50, minimumVotes: 1);
        var office = AddAppointmentRule(game, approvalRequired: false);

        var error = PoliticalProcedureRules.AppointOffice(
            game, player, Guid.NewGuid(), stateId, office.Id, player.Id);

        Assert.Null(error);
        Assert.Equal(player.Id, office.HolderPlayerId);
        Assert.Equal(game.WorldDate, office.TermStartsOn);
        var decision = Assert.Single(game.PoliticalSystems.Single().Decisions);
        Assert.Equal(PoliticalCompetence.AppointOffice, decision.Competence);
        Assert.Equal(PoliticalDecisionStatus.Approved, decision.Status);
        Assert.Single(WorldStateCompatibility.Clone(game).PoliticalSystems.Single().Offices);
    }

    [Fact]
    public void OfficeAppointmentWaitsForConfiguredApprovalAndVote()
    {
        var (game, proposer, stateId) = CreatePoliticalWorld(approvalThreshold: 50, minimumVotes: 1);
        var appointee = AddEligibleVoters(game, stateId, 1).Single();
        var office = AddAppointmentRule(game, approvalRequired: true, minimumVotes: 2);
        var decisionId = Guid.NewGuid();

        Assert.Null(PoliticalProcedureRules.AppointOffice(
            game, proposer, decisionId, stateId, office.Id, appointee.Id));
        Assert.Null(office.HolderPlayerId);
        Assert.Null(PoliticalProcedureRules.VoteOnDecision(
            game, proposer, stateId, decisionId, PoliticalVoteChoice.Approve));
        Assert.Null(office.HolderPlayerId);
        Assert.Null(PoliticalProcedureRules.VoteOnDecision(
            game, appointee, stateId, decisionId, PoliticalVoteChoice.Approve));

        Assert.Equal(PoliticalDecisionStatus.Approved,
            game.PoliticalSystems.Single().Decisions.Single().Status);
        Assert.Equal(appointee.Id, office.HolderPlayerId);
    }

    [Fact]
    public void OfficeAppointmentRequiresConstitutionalPermissionAndActiveMembership()
    {
        var (game, proposer, stateId) = CreatePoliticalWorld(approvalThreshold: 50, minimumVotes: 1);
        var office = AddAppointmentRule(game, approvalRequired: false);
        game.Memberships.Single().PermissionSetId = "observer";

        var unauthorized = PoliticalProcedureRules.AppointOffice(
            game, proposer, Guid.NewGuid(), stateId, office.Id, proposer.Id);

        Assert.Equal("INSUFFICIENT_PERMISSION", unauthorized?.Code);
        Assert.Empty(game.PoliticalSystems.Single().Decisions);
        game.Memberships.Single().PermissionSetId = "legislative-member";
        var inactivePlayer = AddEligibleVoters(game, stateId, 1).Single();
        game.Memberships.Single(item => item.PlayerId == inactivePlayer.Id).Status =
            MembershipStatus.Suspended;
        var inactiveAppointee = PoliticalProcedureRules.AppointOffice(
            game, proposer, Guid.NewGuid(), stateId, office.Id, inactivePlayer.Id);
        Assert.Equal("APPOINTEE_NOT_MEMBER", inactiveAppointee?.Code);
    }

    [Fact]
    public void BudgetIsAppliedOnlyWhenTheConfiguredApprovalProcedureCompletes()
    {
        var (game, proposer, stateId) = CreatePoliticalWorld(approvalThreshold: 50, minimumVotes: 1);
        var voter = AddEligibleVoters(game, stateId, 1).Single();
        game.PoliticalSystems.Single().Government = new PoliticalGovernment
        {
            Id = Guid.NewGuid(),
            Budget = 300
        };
        AddBudgetRule(game, approvalRequired: true, minimumVotes: 2);
        var decisionId = Guid.NewGuid();

        Assert.Null(PoliticalProcedureRules.ApproveBudget(
            game, proposer, decisionId, stateId, 700));
        Assert.Equal(300, game.PoliticalSystems.Single().Government!.Budget);
        Assert.Null(PoliticalProcedureRules.VoteOnDecision(
            game, proposer, stateId, decisionId, PoliticalVoteChoice.Approve));
        Assert.Equal(300, game.PoliticalSystems.Single().Government!.Budget);
        Assert.Null(PoliticalProcedureRules.VoteOnDecision(
            game, voter, stateId, decisionId, PoliticalVoteChoice.Approve));

        Assert.Equal(700, game.PoliticalSystems.Single().Government!.Budget);
        Assert.Equal(PoliticalDecisionStatus.Approved,
            game.PoliticalSystems.Single().Decisions.Single().Status);
        Assert.Equal(700,
            WorldStateCompatibility.Clone(game).PoliticalSystems.Single().Government!.Budget);
    }

    [Fact]
    public void BudgetAppliesDirectlyWhenTheConstitutionDoesNotRequireApproval()
    {
        var (game, player, stateId) = CreatePoliticalWorld(approvalThreshold: 50, minimumVotes: 1);
        game.PoliticalSystems.Single().Government = new PoliticalGovernment
        {
            Id = Guid.NewGuid(),
            Budget = 300
        };
        AddBudgetRule(game, approvalRequired: false);

        Assert.Null(PoliticalProcedureRules.ApproveBudget(
            game, player, Guid.NewGuid(), stateId, 700));

        Assert.Equal(700, game.PoliticalSystems.Single().Government!.Budget);
        Assert.Equal(PoliticalDecisionStatus.Approved,
            game.PoliticalSystems.Single().Decisions.Single().Status);
        Assert.Equal(game.WorldDate,
            WorldStateCompatibility.Clone(game).PoliticalSystems.Single().Decisions.Single().ResolvedOnWorldDate);
    }

    [Fact]
    public void BudgetRequiresPermissionAndRejectsNegativeAmounts()
    {
        var (game, player, stateId) = CreatePoliticalWorld(approvalThreshold: 50, minimumVotes: 1);
        game.PoliticalSystems.Single().Government = new PoliticalGovernment
        {
            Id = Guid.NewGuid(),
            Budget = 300
        };
        AddBudgetRule(game, approvalRequired: false);
        game.Memberships.Single().PermissionSetId = "observer";

        var unauthorized = PoliticalProcedureRules.ApproveBudget(
            game, player, Guid.NewGuid(), stateId, 700);
        Assert.Equal("INSUFFICIENT_PERMISSION", unauthorized?.Code);
        game.Memberships.Single().PermissionSetId = "legislative-member";
        var invalidAmount = PoliticalProcedureRules.ApproveBudget(
            game, player, Guid.NewGuid(), stateId, -1);
        Assert.Equal("INVALID_PAYLOAD", invalidAmount?.Code);
        Assert.Equal(300, game.PoliticalSystems.Single().Government!.Budget);
    }

    private static (WorldState Game, PlayerState Player, Guid StateId) CreatePoliticalWorld(
        int approvalThreshold,
        int minimumVotes)
    {
        var gameId = Guid.NewGuid();
        var stateId = Guid.NewGuid();
        var institutionId = Guid.NewGuid();
        var player = new PlayerState { Id = Guid.NewGuid(), Name = "Member" };
        var role = "legislative-member";
        var institution = new PoliticalInstitution
        {
            Id = institutionId,
            Name = "Assembly",
            Branch = PoliticalBranch.Legislative
        };
        var game = new WorldState
        {
            Id = gameId,
            WorldDate = new DateOnly(1500, 1, 1),
            Players = [player],
            Territories = [new TerritoryState { StateId = stateId, Index = 0, Name = "State" }],
            Memberships =
            [
                new GovernmentMembership
                {
                    Id = Guid.NewGuid(),
                    GameId = gameId,
                    PlayerId = player.Id,
                    StateId = stateId,
                    PermissionSetId = role
                }
            ],
            PoliticalSystems =
            [
                new StatePoliticalSystem
                {
                    StateId = stateId,
                    Regime = new PoliticalRegime { Id = Guid.NewGuid(), Name = "Configured regime" },
                    Constitution = new Constitution
                    {
                        Id = Guid.NewGuid(),
                        EffectiveFrom = new DateOnly(1500, 1, 1),
                        CompetenceRules =
                        [
                            new ConstitutionalCompetenceRule
                            {
                                Id = Guid.NewGuid(),
                                Competence = PoliticalCompetence.ProposeLaw,
                                InstitutionId = institutionId,
                                LegalBasis = "Article 4: legislative procedure",
                                ApprovalRequired = true,
                                MinimumVotes = minimumVotes,
                                ApprovalThresholdPercent = approvalThreshold,
                                ApprovalThresholdBasis = ApprovalThresholdBasis.VotesCast,
                                ProposerPermissionSetIds = [role],
                                VoterPermissionSetIds = [role]
                            }
                        ]
                    },
                    Institutions = [institution]
                }
            ]
        };
        return (game, player, stateId);
    }

    private static List<PlayerState> AddEligibleVoters(WorldState game, Guid stateId, int count)
    {
        var players = Enumerable.Range(0, count)
            .Select(index => new PlayerState { Id = Guid.NewGuid(), Name = $"Voter {index}" })
            .ToList();
        foreach (var player in players)
        {
            game.Players.Add(player);
            game.Memberships.Add(new GovernmentMembership
            {
                Id = Guid.NewGuid(),
                GameId = game.Id,
                PlayerId = player.Id,
                StateId = stateId,
                PermissionSetId = "legislative-member"
            });
        }
        return players;
    }

    private static PoliticalOffice AddAppointmentRule(
        WorldState game,
        bool approvalRequired,
        int minimumVotes = 0)
    {
        var system = game.PoliticalSystems.Single();
        var institution = system.Institutions.Single();
        var office = new PoliticalOffice
        {
            Id = Guid.NewGuid(),
            Name = "Minister",
            InstitutionId = institution.Id
        };
        system.Offices.Add(office);
        institution.OfficeIds.Add(office.Id);
        system.Constitution!.CompetenceRules.Add(new ConstitutionalCompetenceRule
        {
            Id = Guid.NewGuid(),
            Competence = PoliticalCompetence.AppointOffice,
            InstitutionId = institution.Id,
            LegalBasis = "Article 5: appointment procedure",
            ApprovalRequired = approvalRequired,
            MinimumVotes = minimumVotes,
            ApprovalThresholdPercent = approvalRequired ? 50 : 0,
            ApprovalThresholdBasis = approvalRequired
                ? ApprovalThresholdBasis.VotesCast
                : ApprovalThresholdBasis.Unspecified,
            ProposerPermissionSetIds = ["legislative-member"],
            VoterPermissionSetIds = approvalRequired ? ["legislative-member"] : []
        });
        return office;
    }

    private static void AddBudgetRule(
        WorldState game,
        bool approvalRequired,
        int minimumVotes = 0)
    {
        var system = game.PoliticalSystems.Single();
        var institution = system.Institutions.Single();
        system.Constitution!.CompetenceRules.Add(new ConstitutionalCompetenceRule
        {
            Id = Guid.NewGuid(),
            Competence = PoliticalCompetence.ApproveBudget,
            InstitutionId = institution.Id,
            LegalBasis = "Article 6: budget procedure",
            ApprovalRequired = approvalRequired,
            MinimumVotes = minimumVotes,
            ApprovalThresholdPercent = approvalRequired ? 50 : 0,
            ApprovalThresholdBasis = approvalRequired
                ? ApprovalThresholdBasis.VotesCast
                : ApprovalThresholdBasis.Unspecified,
            ProposerPermissionSetIds = ["legislative-member"],
            VoterPermissionSetIds = approvalRequired ? ["legislative-member"] : []
        });
    }
}
