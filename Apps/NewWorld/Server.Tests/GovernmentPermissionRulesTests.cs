using NewWorld.Server.Services;

namespace NewWorld.Server.Tests;

public sealed class GovernmentPermissionRulesTests
{
    [Theory]
    [InlineData(GovernmentAction.EstablishAdministration)]
    [InlineData(GovernmentAction.ConstructBuilding)]
    [InlineData(GovernmentAction.ProposeLaw)]
    [InlineData(GovernmentAction.VoteOnDecision)]
    public void GovernmentMemberCanPerformCoreGovernmentActions(GovernmentAction action)
    {
        Assert.True(GovernmentPermissionRules.Allows(
            GovernmentPermissionRules.MemberPermissionSetId, action));
    }

    [Theory]
    [InlineData(GovernmentAction.ApproveBudget)]
    [InlineData(GovernmentAction.AppointOffice)]
    public void GovernmentCouncilAndExecutiveCanHandlePolicyAuthorities(GovernmentAction action)
    {
        Assert.True(GovernmentPermissionRules.Allows(
            GovernmentPermissionRules.CouncilPermissionSetId, action));
        Assert.True(GovernmentPermissionRules.Allows(
            GovernmentPermissionRules.ExecutivePermissionSetId, action));
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
        Assert.False(GovernmentPermissionRules.Allows(
            permissionSetId, GovernmentAction.ProposeLaw));
        Assert.False(GovernmentPermissionRules.Allows(
            permissionSetId, GovernmentAction.ApproveBudget));
        Assert.False(GovernmentPermissionRules.Allows(
            permissionSetId, GovernmentAction.AppointOffice));
        Assert.False(GovernmentPermissionRules.Allows(
            permissionSetId, GovernmentAction.VoteOnDecision));
    }
}
