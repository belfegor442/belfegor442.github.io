namespace NewWorld.Server.Models;

public enum PoliticalBranch
{
    Executive,
    Legislative,
    Judicial,
    Regional,
    Other
}

public enum PoliticalCompetence
{
    ProposeLaw,
    ApproveBudget,
    AppointOffice,
    NegotiateTreaty,
    DeclareEmergency
}

public enum PoliticalDecisionStatus
{
    PendingApproval,
    Approved,
    Rejected
}

public enum PoliticalLawStatus
{
    Proposed,
    InForce,
    Rejected
}

public enum ApprovalThresholdBasis
{
    Unspecified,
    VotesCast,
    EligibleVoters
}

public enum PoliticalVoteChoice
{
    Approve,
    Reject
}

public sealed class StatePoliticalSystem
{
    public Guid StateId { get; set; }
    public PoliticalRegime? Regime { get; set; }
    public Constitution? Constitution { get; set; }
    public PoliticalGovernment? Government { get; set; }
    public List<PoliticalInstitution> Institutions { get; set; } = [];
    public List<PoliticalOffice> Offices { get; set; } = [];
    public List<PoliticalParty> Parties { get; set; } = [];
    public List<PoliticalLaw> Laws { get; set; } = [];
    public List<PoliticalDecision> Decisions { get; set; } = [];
}

public sealed class PoliticalRegime
{
    public Guid Id { get; set; }
    public string Name { get; set; } = "";
    public string Description { get; set; } = "";
}

public sealed class Constitution
{
    public Guid Id { get; set; }
    public int Version { get; set; } = 1;
    public DateOnly EffectiveFrom { get; set; }
    public List<ConstitutionalCompetenceRule> CompetenceRules { get; set; } = [];
    public StabilityWeights? StabilityWeights { get; set; }
}

public sealed record StabilityWeights(
    int Legitimacy,
    int InstitutionalSupport,
    int Tensions,
    int EconomicCondition,
    int ConflictPressure,
    int Compliance);

public sealed class ConstitutionalCompetenceRule
{
    public Guid Id { get; set; }
    public PoliticalCompetence Competence { get; set; }
    public Guid InstitutionId { get; set; }
    public string LegalBasis { get; set; } = "";
    public bool ApprovalRequired { get; set; }
    public int MinimumVotes { get; set; }
    public int ApprovalThresholdPercent { get; set; }
    public ApprovalThresholdBasis ApprovalThresholdBasis { get; set; }
    public HashSet<string> ProposerPermissionSetIds { get; set; } = [];
    public HashSet<string> VoterPermissionSetIds { get; set; } = [];
}

public sealed class PoliticalGovernment
{
    public Guid Id { get; set; }
    public string Program { get; set; } = "";
    public int Budget { get; set; }
    public int Legitimacy { get; set; }
    public int InstitutionalSupport { get; set; }
    public int Tensions { get; set; }
    public int EconomicCondition { get; set; }
    public int ConflictPressure { get; set; }
    public int Compliance { get; set; }
}

public sealed class PoliticalInstitution
{
    public Guid Id { get; set; }
    public string Name { get; set; } = "";
    public PoliticalBranch Branch { get; set; }
    public List<Guid> OfficeIds { get; set; } = [];
}

public sealed class PoliticalOffice
{
    public Guid Id { get; set; }
    public string Name { get; set; } = "";
    public Guid InstitutionId { get; set; }
    public Guid? HolderPlayerId { get; set; }
    public DateOnly? TermStartsOn { get; set; }
    public DateOnly? TermEndsOn { get; set; }
    public HashSet<PoliticalCompetence> Competences { get; set; } = [];
}

public sealed class PoliticalParty
{
    public Guid Id { get; set; }
    public string Name { get; set; } = "";
    public string Program { get; set; } = "";
    public string? IdeologyId { get; set; }
    public HashSet<Guid> MemberPlayerIds { get; set; } = [];
    public int Seats { get; set; }
}

public sealed class PoliticalLaw
{
    public Guid Id { get; set; }
    public Guid StateId { get; set; }
    public Guid ProposerPlayerId { get; set; }
    public Guid DecisionId { get; set; }
    public string Title { get; set; } = "";
    public string Text { get; set; } = "";
    public string LegalBasis { get; set; } = "";
    public PoliticalLawStatus Status { get; set; }
    public DateOnly ProposedOnWorldDate { get; set; }
    public DateOnly? EffectiveFrom { get; set; }
}

public sealed class PoliticalDecision
{
    public Guid Id { get; set; }
    public Guid StateId { get; set; }
    public PoliticalCompetence Competence { get; set; }
    public Guid ProposerPlayerId { get; set; }
    public Guid InstitutionId { get; set; }
    public int ConstitutionVersion { get; set; }
    public string Title { get; set; } = "";
    public string Text { get; set; } = "";
    public string LegalBasis { get; set; } = "";
    public PoliticalDecisionStatus Status { get; set; }
    public DateOnly ProposedOnWorldDate { get; set; }
    public DateOnly? ResolvedOnWorldDate { get; set; }
    public List<PoliticalVote> Votes { get; set; } = [];
}

public sealed record PoliticalVote(
    Guid PlayerId,
    Guid MembershipId,
    PoliticalVoteChoice Choice,
    DateOnly CastOnWorldDate);

public sealed record PoliticalDecisionRequest(string Title, string Text, Guid? DecisionId);
public sealed record PoliticalVoteRequest(Guid DecisionId, PoliticalVoteChoice Choice);

public sealed record PoliticalStateView(
    Guid StateId,
    bool ConfigurationPending,
    PoliticalRegime? Regime,
    Constitution? Constitution,
    PoliticalGovernment? Government,
    IReadOnlyList<PoliticalInstitution> Institutions,
    IReadOnlyList<PoliticalOffice> Offices,
    IReadOnlyList<PoliticalParty> Parties,
    IReadOnlyList<PoliticalLaw> Laws,
    IReadOnlyList<PoliticalDecision> Decisions,
    int? Stability);
