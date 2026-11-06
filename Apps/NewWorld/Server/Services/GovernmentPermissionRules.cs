namespace NewWorld.Server.Services;

public enum GovernmentAction
{
    EstablishAdministration,
    ConstructBuilding,
    ProposeLaw,
    ApproveBudget,
    AppointOffice,
    VoteOnDecision,
    StartResearch
}

public static class GovernmentPermissionRules
{
    public const string MemberPermissionSetId = "government-member";
    public const string CouncilPermissionSetId = "government-council";
    public const string ExecutivePermissionSetId = "government-executive";
    public const string ObserverPermissionSetId = "government-observer";

    public static IReadOnlySet<string> AllPermissionSetIds { get; } =
        new HashSet<string>(StringComparer.Ordinal)
        {
            MemberPermissionSetId,
            CouncilPermissionSetId,
            ExecutivePermissionSetId,
            ObserverPermissionSetId
        };

    public static bool IsKnown(string? permissionSetId) =>
        !string.IsNullOrWhiteSpace(permissionSetId) && AllPermissionSetIds.Contains(permissionSetId);

    public static bool Allows(string permissionSetId, GovernmentAction action) =>
        permissionSetId switch
        {
            MemberPermissionSetId => action is
                GovernmentAction.EstablishAdministration or
                GovernmentAction.ConstructBuilding or
                GovernmentAction.ProposeLaw or
                GovernmentAction.VoteOnDecision or
                GovernmentAction.StartResearch,
            CouncilPermissionSetId => action is
                GovernmentAction.EstablishAdministration or
                GovernmentAction.ConstructBuilding or
                GovernmentAction.ProposeLaw or
                GovernmentAction.ApproveBudget or
                GovernmentAction.AppointOffice or
                GovernmentAction.VoteOnDecision or
                GovernmentAction.StartResearch,
            ExecutivePermissionSetId => action is
                GovernmentAction.EstablishAdministration or
                GovernmentAction.ConstructBuilding or
                GovernmentAction.ProposeLaw or
                GovernmentAction.ApproveBudget or
                GovernmentAction.AppointOffice or
                GovernmentAction.VoteOnDecision or
                GovernmentAction.StartResearch,
            _ => false
        };
}
