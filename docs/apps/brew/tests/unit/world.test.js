import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildWorld,
  clampToWorld,
  resolveCollisions,
  effectSpeedMultiplier,
  applyMovement,
  nearStation,
  nearestStation,
} from '../../server/game/world.js';
import { WORLD, PLAYER, STATION, EFFECTS } from '../../shared/constants.js';

test('buildWorld lays out stations, obstacles and spawns', () => {
  const world = buildWorld(4);
  assert.equal(world.maxPlayers, 4);
  assert.equal(world.stations.length, 4);
  assert.equal(world.spawnPoints.length, 8);
  assert.ok(world.obstacles.length >= world.stations.length + 1, 'station boxes plus furniture');
  for (const station of world.stations) {
    assert.equal(station.assignedTo, null);
    assert.equal(station.occupiedBy, null);
    assert.ok(station.x >= WORLD.minX && station.x <= WORLD.maxX);
    assert.equal(typeof station.approachZ, 'number');
  }
  const xs = world.stations.map((s) => s.x);
  assert.equal(new Set(xs).size, xs.length, 'stations do not overlap');
});

test('buildWorld clamps the station count', () => {
  assert.equal(buildWorld(0).stations.length, 1);
  assert.equal(buildWorld(99).stations.length, 8);
  assert.equal(buildWorld(6).stations.length, 6);
});

test('clampToWorld keeps players inside the playable bounds', () => {
  assert.deepEqual(clampToWorld(0, 0), {
    x: WORLD.minX + PLAYER.radius,
    z: WORLD.minZ + PLAYER.radius,
  });
  assert.deepEqual(clampToWorld(999, -999), {
    x: WORLD.maxX - PLAYER.radius,
    z: WORLD.minZ + PLAYER.radius,
  });
  assert.deepEqual(clampToWorld(-999, 999), {
    x: WORLD.minX + PLAYER.radius,
    z: WORLD.maxZ - PLAYER.radius,
  });
  const inside = clampToWorld(WORLD.width / 2, WORLD.depth / 2);
  assert.equal(inside.x, WORLD.width / 2);
  assert.equal(inside.z, WORLD.depth / 2);
});

function penetration(x, z, box, radius) {
  const cx = Math.min(Math.max(x, box.minX), box.maxX);
  const cz = Math.min(Math.max(z, box.minZ), box.maxZ);
  return radius - Math.hypot(x - cx, z - cz);
}

test('resolveCollisions pushes a player out of solid boxes', () => {
  const box = { minX: 10, maxX: 12, minZ: 10, maxZ: 12 };
  const resolved = resolveCollisions(11, 11, PLAYER.radius, [box]);
  assert.ok(resolved.x !== 11 || resolved.z !== 11, 'player was pushed');
  assert.ok(
    penetration(resolved.x, resolved.z, box, PLAYER.radius) <= 1e-6,
    'no deeper than touching distance remains',
  );
  const far = resolveCollisions(2, 2, PLAYER.radius, [box]);
  assert.equal(far.x, 2, 'untouched when already clear');
  assert.equal(far.z, 2);
});

test('resolveCollisions escapes when exactly on the box centre', () => {
  const box = { minX: 10, maxX: 12, minZ: 10, maxZ: 12 };
  const resolved = resolveCollisions(11, 11, PLAYER.radius, [box]);
  assert.ok(
    penetration(resolved.x, resolved.z, box, PLAYER.radius) <= 1e-6,
    'pushed completely clear',
  );
});

test('effectSpeedMultiplier multiplies negative effects', () => {
  assert.equal(effectSpeedMultiplier([], Date.now()), 1);
  const now = Date.now();
  assert.equal(
    effectSpeedMultiplier([{ kind: 'SPLASH', until: now + 1000 }], now),
    EFFECTS.SPLASH.speedMult,
  );
  assert.equal(
    effectSpeedMultiplier([{ kind: 'SPLASH', until: now - 1 }], now),
    1,
    'expired effects are ignored',
  );
  const stacked = effectSpeedMultiplier(
    [
      { kind: 'SPLASH', until: now + 1000 },
      { kind: 'SMOKE', until: now + 1000 },
    ],
    now,
  );
  assert.ok(stacked < 1);
});

test('applyMovement walks a player by intent and refuses while mounted', () => {
  const world = buildWorld(4);
  const spawn = world.spawnPoints[0];
  const player = { x: spawn.x, z: spawn.z, effects: [], stationId: null, anim: 'IDLE' };
  const result = applyMovement(player, { dx: 1, dz: 0 }, 1000, world, 1_000);
  assert.equal(result.moved, true);
  assert.ok(result.distance > 0, 'covered ground');
  assert.equal(player.anim, 'WALK');
  assert.ok(player.x > spawn.x, 'moved in the intent direction');

  const idle = applyMovement(player, { dx: 0, dz: 0 }, 1000, world, 2_000);
  assert.equal(idle.moved, false);
  assert.equal(idle.distance, 0);

  const mounted = { x: spawn.x, z: spawn.z, effects: [], stationId: 2 };
  const blocked = applyMovement(mounted, { dx: 1, dz: 1 }, 1000, world, 3_000);
  assert.equal(blocked.moved, false, 'mounted players do not walk');
  assert.equal(mounted.x, spawn.x);

  const corner = { x: WORLD.maxX - PLAYER.radius, z: WORLD.maxZ - PLAYER.radius, effects: [], stationId: null };
  applyMovement(corner, { dx: 1, dz: 1 }, 5000, world, 4_000);
  assert.ok(corner.x <= WORLD.maxX - PLAYER.radius + 1e-9);
  assert.ok(corner.z <= WORLD.maxZ - PLAYER.radius + 1e-9);
});

test('nearStation and nearestStation use the interaction range', () => {
  const world = buildWorld(4);
  const station = world.stations[0];
  assert.equal(nearStation({ x: station.approachX, z: station.approachZ }, station, STATION.interactionRange), true);
  assert.equal(nearStation({ x: 0, z: 0 }, station, STATION.interactionRange), false);
  const near = nearestStation({ x: station.x + 0.4, z: station.approachZ }, world, 5);
  assert.equal(near.id, station.id);
  assert.equal(nearestStation({ x: 0, z: 0 }, world, 0.001), null, 'out of every range returns null');
});
