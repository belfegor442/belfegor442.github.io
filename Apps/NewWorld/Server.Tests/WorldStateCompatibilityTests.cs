using System.Text.Json;
using NewWorld.Server.Models;
using NewWorld.Server.Services;

namespace NewWorld.Server.Tests;

public sealed class WorldStateCompatibilityTests
{
    [Fact]
    public void NormalizeMigratesLegacyPlayerAssignmentsToStableMemberships()
    {
        var gameId = Guid.NewGuid();
        var playerId = Guid.NewGuid();
        var legacyState = $$"""
            {
              "id": "{{gameId}}",
              "started": true,
              "day": 366,
              "players": [
                { "id": "{{playerId}}", "name": "Player One", "countryIndex": 0 }
              ],
              "territories": [
                { "index": 0, "name": "Coimbrila" }
              ]
            }
            """;

        var game = JsonSerializer.Deserialize<WorldState>(legacyState, new JsonSerializerOptions(JsonSerializerDefaults.Web))!;
        WorldStateCompatibility.Normalize(game);

        Assert.Equal(new DateOnly(1501, 1, 1), game.WorldDate);
        Assert.Equal(GameStatus.Running, game.Status);
        var membership = Assert.Single(game.Memberships);
        Assert.Equal(game.Id, membership.GameId);
        Assert.Equal(playerId, membership.PlayerId);
        Assert.Equal(game.Territories[0].StateId, membership.StateId);
        Assert.NotEqual(Guid.Empty, membership.Id);

        var stableStateId = game.Territories[0].StateId;
        var stableMembershipId = membership.Id;
        WorldStateCompatibility.Normalize(game);

        Assert.Equal(stableStateId, game.Territories[0].StateId);
        Assert.Equal(stableMembershipId, Assert.Single(game.Memberships).Id);
    }

    [Fact]
    public void NormalizeCapsLegacyPlayerLimitAtTwenty()
    {
        var game = new WorldState { MaxHumanPlayers = 64 };

        WorldStateCompatibility.Normalize(game);

        Assert.Equal(20, game.MaxHumanPlayers);
    }

    [Fact]
    public void NormalizeRejectsMembershipsReferencingAnotherGame()
    {
        var gameId = Guid.NewGuid();
        var playerId = Guid.NewGuid();
        var stateId = Guid.NewGuid();
        var game = new WorldState
        {
            Id = gameId,
            Players = [new PlayerState { Id = playerId }],
            Territories = [new TerritoryState { StateId = stateId }],
            Memberships =
            [
                new GovernmentMembership
                {
                    Id = Guid.NewGuid(),
                    GameId = Guid.NewGuid(),
                    PlayerId = playerId,
                    StateId = stateId
                }
            ]
        };

        Assert.Throws<InvalidDataException>(() => WorldStateCompatibility.Normalize(game));
    }

    [Fact]
    public void NormalizeUsesGregorianDatesIncludingLeapYears()
    {
        var game = new WorldState { Day = 1461 };

        WorldStateCompatibility.Normalize(game);

        Assert.Equal(new DateOnly(1504, 1, 1), game.WorldDate);
        Assert.Equal(new DateOnly(1504, 2, 29), game.WorldDate.AddDays(59));
    }

    [Fact]
    public void NormalizeRejectsAnInvalidClockAccumulator()
    {
        var game = new WorldState { ClockAccumulatorTicks = TimeSpan.FromMinutes(5).Ticks };

        Assert.Throws<InvalidDataException>(() => WorldStateCompatibility.Normalize(game));
    }
}
