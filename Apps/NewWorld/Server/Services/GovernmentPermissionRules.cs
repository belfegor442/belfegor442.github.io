namespace NewWorld.Server.Services;

public enum GovernmentAction
{
    EstablishAdministration,
    ConstructBuilding
}

public static class GovernmentPermissionRules
{
    public const string MemberPermissionSetId = "government-member";

    public static bool Allows(string permissionSetId, GovernmentAction action) =>
        permissionSetId == MemberPermissionSetId && action is
            GovernmentAction.EstablishAdministration or GovernmentAction.ConstructBuilding;
}
