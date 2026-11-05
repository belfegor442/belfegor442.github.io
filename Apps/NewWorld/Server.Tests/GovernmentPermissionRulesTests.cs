using NewWorld.Server.Services;

namespace NewWorld.Server.Tests;

public sealed class GovernmentPermissionRulesTests
{
    [Theory]
    [InlineData(GovernmentAction.EstablishAdministration)]
    [InlineData(GovernmentAction.ConstructBuilding)]
    public void GovernmentMemberCanPerformExistingEconomicActions(GovernmentAction action)
    {
        Assert.True(GovernmentPermissionRules.Allows(
            GovernmentPermissionRules.MemberPermissionSetId, action));
    }

    [Theory]
    [InlineData("government-observer")]
    [InlineData("unknown-permission-set")]
    [InlineData("")]
    public void UnknownOrNonMemberPermissionSetsFailClosed(string permissionSetId)
    {
        Assert.False(GovernmentPermissionRules.Allows(
            permissionSetId, GovernmentAction.EstablishAdministration));
        Assert.False(GovernmentPermissionRules.Allows(
            permissionSetId, GovernmentAction.ConstructBuilding));
    }
}
