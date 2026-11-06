using NewWorld.Server.Models;
using NewWorld.Server.Services;

namespace NewWorld.Server.Tests;

public sealed class WorldSnapshotRulesTests
{
    [Fact]
    public void SnapshotRoundTripsAWorldWithValidHostReferences()
    {
        var host = new PlayerState
        {
            Id = Guid.NewGuid(),
            IsHost = true,
            TokenHash = GameStore.Hash("host-token")
        };
        var game = new WorldState
        {
            Id = Guid.NewGuid(),
            HostPlayerId = host.Id,
            Players = [host]
        };

        var serialized = WorldSnapshotRules.Serialize(game);
        var restored = WorldSnapshotRules.DeserializeAndValidate(serialized, game.Id);

        Assert.Equal(game.Id, restored.Id);
        Assert.Equal(host.Id, restored.HostPlayerId);
        Assert.Equal(host.TokenHash, Assert.Single(restored.Players).TokenHash);
    }

    [Fact]
    public void SnapshotRejectsAWorldBelongingToAnotherGame()
    {
        var game = CreateValidGame();

        Assert.Throws<InvalidDataException>(
            () => WorldSnapshotRules.DeserializeAndValidate(
                WorldSnapshotRules.Serialize(game), Guid.NewGuid()));
    }

    [Fact]
    public void SnapshotRejectsAnUnsupportedMapGeometryVersion()
    {
        var game = CreateValidGame();
        game.MapGeometryVersion = 0;

        Assert.Throws<InvalidDataException>(() => WorldSnapshotRules.Serialize(game));
    }

    [Fact]
    public void SnapshotRejectsInvalidCrossGameReferences()
    {
        var game = CreateValidGame();
        var player = Assert.Single(game.Players);
        var stateId = Guid.NewGuid();
        game.Territories.Add(new TerritoryState { StateId = stateId, Index = 0, Name = "State" });
        game.Memberships.Add(new GovernmentMembership
        {
            Id = Guid.NewGuid(),
            GameId = Guid.NewGuid(),
            PlayerId = player.Id,
            StateId = stateId
        });

        Assert.Throws<InvalidDataException>(() => WorldSnapshotRules.Serialize(game));
    }

    [Fact]
    public void SnapshotChecksumDetectsModificationAndMalformedValues()
    {
        const string snapshot = "{\"state\":\"valid\"}";
        var checksum = WorldSnapshotRules.CalculateChecksum(snapshot);

        Assert.True(WorldSnapshotRules.HasValidChecksum(snapshot, checksum));
        Assert.False(WorldSnapshotRules.HasValidChecksum(snapshot + " ", checksum));
        Assert.False(WorldSnapshotRules.HasValidChecksum(snapshot, "not-a-checksum"));
    }

    [Fact]
    public void BackupRecoveryRequiresValidChecksumReferencesAndHostToken()
    {
        const string hostToken = "host-token";
        var game = CreateValidGame();
        game.Players[0].TokenHash = GameStore.Hash(hostToken);
        var snapshot = WorldSnapshotRules.Serialize(game);
        var checksum = WorldSnapshotRules.CalculateChecksum(snapshot);

        var recovered = WorldSnapshotRules.ValidateRestore(snapshot, checksum, game.Id, hostToken);
        Assert.Equal(game.Id, recovered.Game?.Id);
        Assert.Null(recovered.Error);
        Assert.False(recovered.Unauthorized);

        var unauthorized = WorldSnapshotRules.ValidateRestore(snapshot, checksum, game.Id, "wrong-token");
        Assert.Null(unauthorized.Game);
        Assert.True(unauthorized.Unauthorized);

        var corrupted = WorldSnapshotRules.ValidateRestore(snapshot + " ", checksum, game.Id, hostToken);
        Assert.Null(corrupted.Game);
        Assert.Contains("integrity", corrupted.Error);
        Assert.False(corrupted.Unauthorized);
    }

    [Fact]
    public void RecoveryPreservesVersionMarkersFromAnInvalidCurrentSnapshot()
    {
        const string currentSnapshot = "{\"worldVersion\":17,\"eventSequence\":44,\"memberships\":\"invalid\"}";

        Assert.True(WorldSnapshotRules.TryReadVersionMarkers(
            currentSnapshot, out var worldVersion, out var eventSequence));
        Assert.Equal(17, worldVersion);
        Assert.Equal(44, eventSequence);
        Assert.False(WorldSnapshotRules.TryReadVersionMarkers(
            "{\"worldVersion\":\"invalid\"}", out _, out _));
    }

    private static WorldState CreateValidGame()
    {
        var host = new PlayerState
        {
            Id = Guid.NewGuid(),
            IsHost = true,
            TokenHash = GameStore.Hash("host-token")
        };
        return new WorldState
        {
            Id = Guid.NewGuid(),
            HostPlayerId = host.Id,
            Players = [host]
        };
    }
}
