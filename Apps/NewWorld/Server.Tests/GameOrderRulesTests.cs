using NewWorld.Server.Models;
using NewWorld.Server.Services;

namespace NewWorld.Server.Tests;

public sealed class GameOrderRulesTests
{
    [Theory]
    [InlineData("claim", GameOrderType.EstablishAdministration)]
    [InlineData("build", GameOrderType.ConstructBuilding)]
    [InlineData("approveBudget", GameOrderType.ApproveBudget)]
    [InlineData("proposeLaw", GameOrderType.ProposeLaw)]
    [InlineData("appointOffice", GameOrderType.AppointOffice)]
    [InlineData("negotiateTreaty", GameOrderType.NegotiateTreaty)]
    [InlineData("mobilizeUnit", GameOrderType.MobilizeUnit)]
    [InlineData("startProject", GameOrderType.StartProject)]
    [InlineData("pause", GameOrderType.PauseWorld)]
    [InlineData("resume", GameOrderType.ResumeWorld)]
    [InlineData("unknown", GameOrderType.Unsupported)]
    public void ClientIntentsMapToExplicitOrderTypes(string messageType, GameOrderType expectedType)
    {
        Assert.Equal(expectedType, GameOrderRules.ParseType(messageType));
    }

    [Fact]
    public void RejectedMutationCannotPartiallyChangeThePersistedWorld()
    {
        var player = new PlayerState { Id = Guid.NewGuid() };
        var state = new TerritoryState { StateId = Guid.NewGuid(), Treasury = 900 };
        var game = new WorldState
        {
            Id = Guid.NewGuid(),
            Players = [player],
            Territories = [state]
        };

        var result = GameOrderRules.ApplyMutationAtomically(game, player.Id, (candidate, _) =>
        {
            candidate.Territories[0].Treasury -= 450;
            candidate.Activity.Add("partially applied");
            return new OrderRejection("CONFLICT", "The order cannot be applied.");
        });

        Assert.Same(game, result.Game);
        Assert.Equal(900, game.Territories[0].Treasury);
        Assert.Empty(game.Activity);
        Assert.Equal("CONFLICT", result.Rejection?.Code);
    }

    [Fact]
    public void AcceptedMutationReturnsAnIsolatedWorldCopy()
    {
        var player = new PlayerState { Id = Guid.NewGuid() };
        var state = new TerritoryState { StateId = Guid.NewGuid(), Treasury = 900 };
        var game = new WorldState
        {
            Id = Guid.NewGuid(),
            Players = [player],
            Territories = [state]
        };

        var result = GameOrderRules.ApplyMutationAtomically(game, player.Id, (candidate, _) =>
        {
            candidate.Territories[0].Treasury -= 450;
            return null;
        });

        Assert.Null(result.Rejection);
        Assert.NotSame(game, result.Game);
        Assert.Equal(900, game.Territories[0].Treasury);
        Assert.Equal(450, result.Game.Territories[0].Treasury);
    }

    [Fact]
    public void RejectedOrderIsAuditedWithoutAdvancingTheWorldVersion()
    {
        var player = new PlayerState { Id = Guid.NewGuid() };
        var state = new TerritoryState { StateId = Guid.NewGuid(), Treasury = 900 };
        var game = new WorldState
        {
            Id = Guid.NewGuid(),
            WorldVersion = 4,
            WorldDate = new DateOnly(1500, 1, 1),
            Players = [player],
            Memberships =
            [
                new GovernmentMembership
                {
                    PlayerId = player.Id,
                    StateId = state.StateId,
                    PermissionSetId = GovernmentPermissionRules.MemberPermissionSetId
                }
            ],
            Territories = [state]
        };
        var orderId = Guid.NewGuid();

        var result = GameOrderRules.RecordOutcome(
            game, player, orderId, state.StateId, GameOrderType.ConstructBuilding,
            new GameOrderPayload(null, 1, "farm"), 4, null,
            new OrderRejection("INSUFFICIENT_FUNDS", "Insufficient treasury."),
            DateTimeOffset.UtcNow);

        Assert.False(result.Accepted);
        Assert.Equal(4, game.WorldVersion);
        Assert.Equal(900, game.Territories[0].Treasury);
        Assert.Equal(4, Assert.Single(game.Orders).WorldVersion);
        var worldEvent = Assert.Single(game.Events);
        Assert.Equal(orderId, worldEvent.OrderId);
        Assert.Equal("INSUFFICIENT_FUNDS", worldEvent.ResultCode);
        Assert.Equal(4, worldEvent.WorldVersion);
    }

    [Fact]
    public void AcceptedOrderAuditsTheResultAtTheNewWorldVersion()
    {
        var player = new PlayerState { Id = Guid.NewGuid() };
        var state = new TerritoryState { StateId = Guid.NewGuid(), Treasury = 900 };
        var game = new WorldState
        {
            Id = Guid.NewGuid(),
            WorldVersion = 4,
            WorldDate = new DateOnly(1500, 1, 1),
            Players = [player],
            Memberships =
            [
                new GovernmentMembership
                {
                    PlayerId = player.Id,
                    StateId = state.StateId,
                    PermissionSetId = GovernmentPermissionRules.MemberPermissionSetId
                }
            ],
            Territories = [state]
        };

        var result = GameOrderRules.RecordOutcome(
            game, player, Guid.NewGuid(), state.StateId, GameOrderType.ConstructBuilding,
            new GameOrderPayload(null, 1, "farm"), 4, null, null, DateTimeOffset.UtcNow);

        Assert.True(result.Accepted);
        Assert.Equal(5, game.WorldVersion);
        var order = Assert.Single(game.Orders);
        Assert.Equal(5, order.WorldVersion);
        Assert.Equal(GovernmentPermissionRules.MemberPermissionSetId, order.PermissionSetId);
        Assert.Equal(5, Assert.Single(game.Events).WorldVersion);
    }

    [Theory]
    [InlineData(GameOrderType.ConstructBuilding, GameStatus.Paused, "WORLD_NOT_RUNNING")]
    [InlineData(GameOrderType.ConstructBuilding, GameStatus.Closed, "WORLD_NOT_RUNNING")]
    [InlineData(GameOrderType.PauseWorld, GameStatus.Paused, "PAUSE_STATE_CONFLICT")]
    [InlineData(GameOrderType.ResumeWorld, GameStatus.Running, "PAUSE_STATE_CONFLICT")]
    public void WorldAvailabilityRejectsOrdersInIncompatibleStates(
        GameOrderType orderType, GameStatus status, string expectedCode)
    {
        var result = GameOrderRules.CheckWorldAvailability(
            new WorldState { Started = true, Status = status }, orderType);

        Assert.Equal(expectedCode, result?.Code);
    }

    [Fact]
    public void WorldAvailabilityRejectsOrdersBeforeTheWorldStarts()
    {
        var result = GameOrderRules.CheckWorldAvailability(
            new WorldState { Status = GameStatus.Lobby }, GameOrderType.ConstructBuilding);

        Assert.Equal("WORLD_NOT_STARTED", result?.Code);
    }

    [Fact]
    public void MembershipAuthorizationUsesPlayerAndSelectedStateWithoutHostPrivilege()
    {
        var hostId = Guid.NewGuid();
        var otherPlayerId = Guid.NewGuid();
        var firstStateId = Guid.NewGuid();
        var secondStateId = Guid.NewGuid();
        var game = new WorldState
        {
            HostPlayerId = hostId,
            Players =
            [
                new PlayerState { Id = hostId, IsHost = true },
                new PlayerState { Id = otherPlayerId }
            ],
            Memberships =
            [
                new GovernmentMembership
                {
                    PlayerId = hostId, StateId = firstStateId, Status = MembershipStatus.Active
                },
                new GovernmentMembership
                {
                    PlayerId = otherPlayerId, StateId = secondStateId, Status = MembershipStatus.Active
                }
            ]
        };

        Assert.Null(GameOrderRules.CheckMembership(game, hostId, firstStateId));
        Assert.Equal("NOT_MEMBER", GameOrderRules.CheckMembership(game, hostId, secondStateId)?.Code);
        Assert.Equal("NOT_MEMBER", GameOrderRules.CheckMembership(game, otherPlayerId, firstStateId)?.Code);
    }

    [Fact]
    public void MembershipAuthorizationRejectsLeftGovernmentMembers()
    {
        var playerId = Guid.NewGuid();
        var stateId = Guid.NewGuid();
        var game = new WorldState
        {
            Memberships =
            [
                new GovernmentMembership
                {
                    PlayerId = playerId, StateId = stateId, Status = MembershipStatus.Left
                }
            ]
        };

        Assert.Equal("NOT_MEMBER", GameOrderRules.CheckMembership(game, playerId, stateId)?.Code);
    }

    [Fact]
    public void HostWithoutGovernmentPermissionCannotUseHostingPrivilegesToMutateAState()
    {
        var host = new PlayerState { Id = Guid.NewGuid(), IsHost = true };
        var state = new TerritoryState { StateId = Guid.NewGuid(), Treasury = 900 };
        var game = new WorldState
        {
            Id = Guid.NewGuid(),
            Started = true,
            Status = GameStatus.Running,
            HostPlayerId = host.Id,
            WorldDate = new DateOnly(1500, 1, 1),
            Players = [host],
            Territories = [state],
            Memberships =
            [
                new GovernmentMembership
                {
                    PlayerId = host.Id,
                    StateId = state.StateId,
                    PermissionSetId = "government-observer"
                }
            ]
        };
        Assert.Null(GameOrderRules.CheckMembership(game, host.Id, state.StateId));

        var applied = GameOrderRules.ApplyMutationAtomically(game, host.Id, (candidate, player) =>
        {
            var membership = candidate.Memberships.Single();
            if (!GovernmentPermissionRules.Allows(
                    membership.PermissionSetId, GovernmentAction.ConstructBuilding))
                return new OrderRejection("INSUFFICIENT_PERMISSION", "Construction is not permitted.");
            candidate.Territories[0].Treasury -= 450;
            return null;
        });
        var orderResult = GameOrderRules.RecordOutcome(
            game, host, Guid.NewGuid(), state.StateId, GameOrderType.ConstructBuilding,
            new GameOrderPayload(null, 0, "farm"), 1, null,
            applied.Rejection, DateTimeOffset.UtcNow);

        Assert.False(orderResult.Accepted);
        Assert.Equal(900, game.Territories[0].Treasury);
        Assert.Equal(1, game.WorldVersion);
        Assert.Equal("government-observer", Assert.Single(game.Orders).PermissionSetId);
    }

    [Fact]
    public void StaleWorldVersionsAreRejectedWithStableCode()
    {
        Assert.Null(GameOrderRules.CheckWorldVersion(4, 4));
        Assert.Equal("STALE_WORLD_VERSION", GameOrderRules.CheckWorldVersion(3, 4)?.Code);
    }

    [Fact]
    public void OrdersCanTargetTheCurrentDateButCannotBeBackdatedOrScheduled()
    {
        var currentDate = new DateOnly(1500, 1, 1);

        Assert.Null(GameOrderRules.CheckTargetWorldDate(null, currentDate));
        Assert.Null(GameOrderRules.CheckTargetWorldDate(currentDate, currentDate));
        Assert.Equal("TARGET_DATE_IN_PAST",
            GameOrderRules.CheckTargetWorldDate(currentDate.AddDays(-1), currentDate)?.Code);
        Assert.Equal("SCHEDULED_ORDERS_UNSUPPORTED",
            GameOrderRules.CheckTargetWorldDate(currentDate.AddDays(1), currentDate)?.Code);
    }

    [Fact]
    public void RetryReturnsOriginalResultWithoutChangingTheOrder()
    {
        var playerId = Guid.NewGuid();
        var gameId = Guid.NewGuid();
        var orderId = Guid.NewGuid();
        var order = new GameOrder(
            gameId, orderId, playerId, Guid.NewGuid(), GameOrderType.ConstructBuilding,
            GameOrderStatus.Rejected, new GameOrderPayload(null, 4, "farm"), 5,
            DateTimeOffset.UtcNow, new DateOnly(1500, 1, 1),
            "INSUFFICIENT_FUNDS", "Insufficient treasury.", 5);
        var game = new WorldState { Id = gameId, Orders = [order] };

        var (replay, error) = GameOrderRules.FindReplay(
            game, playerId, orderId, order.StateId, order.Type, order.Payload, order.ExpectedWorldVersion);

        Assert.Null(error);
        Assert.Equal(new GameOrderResult(
            orderId, false, "INSUFFICIENT_FUNDS", "Insufficient treasury.", true), replay);
        Assert.Single(game.Orders);
    }

    [Fact]
    public void OrderIdsCannotBeReusedByAnotherPlayer()
    {
        var orderId = Guid.NewGuid();
        var firstPlayer = Guid.NewGuid();
        var secondPlayer = Guid.NewGuid();
        var game = new WorldState
        {
            Orders =
            [
                new GameOrder(Guid.Empty, orderId, firstPlayer, null, GameOrderType.PauseWorld,
                    GameOrderStatus.Executed, new GameOrderPayload(null, null, null), 1,
                    DateTimeOffset.UtcNow, new DateOnly(1500, 1, 1), null, null, 2)
            ]
        };

        Assert.Equal("This order ID was already used for a different request.",
            GameOrderRules.FindReplay(game, secondPlayer, orderId, null, GameOrderType.PauseWorld,
                new GameOrderPayload(null, null, null), 1).Error);
        Assert.NotNull(GameOrderRules.FindReplay(game, firstPlayer, orderId, null, GameOrderType.PauseWorld,
            new GameOrderPayload(null, null, null), 1).Replay);
    }

    [Fact]
    public void ReusingAnOrderIdWithDifferentPayloadIsRejected()
    {
        var playerId = Guid.NewGuid();
        var orderId = Guid.NewGuid();
        var game = new WorldState
        {
            Orders =
            [
                new GameOrder(Guid.NewGuid(), orderId, playerId, null,
                    GameOrderType.EstablishAdministration, GameOrderStatus.Rejected,
                    new GameOrderPayload(2, null, null), 1,
                    DateTimeOffset.UtcNow, new DateOnly(1500, 1, 1),
                    "INVALID_PAYLOAD", "Invalid territory.", 1)
            ]
        };

        var (_, error) = GameOrderRules.FindReplay(
            game, playerId, orderId, null, GameOrderType.EstablishAdministration,
            new GameOrderPayload(3, null, null), 1);

        Assert.Equal("This order ID was already used for a different request.", error);
        Assert.Equal("This order ID was already used for a different request.",
            GameOrderRules.FindReplay(game, playerId, orderId, null, GameOrderType.EstablishAdministration,
                new GameOrderPayload(2, null, null), 2).Error);
    }

    [Fact]
    public void ReusingAnOrderIdWithDifferentTargetDateIsRejected()
    {
        var playerId = Guid.NewGuid();
        var orderId = Guid.NewGuid();
        var submittedDate = new DateOnly(1500, 1, 1);
        var game = new WorldState
        {
            Orders =
            [
                new GameOrder(Guid.NewGuid(), orderId, playerId, null,
                    GameOrderType.PauseWorld, GameOrderStatus.Rejected,
                    new GameOrderPayload(null, null, null), 1,
                    DateTimeOffset.UtcNow, submittedDate, "NOT_MEMBER", "No membership.", 1,
                    TargetWorldDate: submittedDate)
            ]
        };

        var (_, error) = GameOrderRules.FindReplay(
            game, playerId, orderId, null, GameOrderType.PauseWorld,
            new GameOrderPayload(null, null, null), 1, submittedDate.AddDays(1));

        Assert.Equal("This order ID was already used for a different request.", error);
    }
}
