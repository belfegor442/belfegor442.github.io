import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSabotage, updateMischief, SABOTAGE_EVENTS } from '../../server/game/sabotage.js';
import { createMachine, startSpin } from '../../server/game/machine.js';
import { SABOTAGE, MISCHIEF, EFFECTS } from '../../shared/constants.js';
import { ERROR_CODES } from '../../shared/protocol.js';

function makePlayer(overrides = {}) {
  return {
    id: 'player_a',
    displayName: 'Ada',
    x: 10,
    z: 10,
    mischief: MISCHIEF.start,
    sabotageCooldowns: {},
    stats: { sabotageThrown: 0, sabotageHit: 0, roomsCleaned: 0 },
    effects: [],
    status: 'ONLINE',
    ...overrides,
  };
}

function makeRoom(target, machine = null) {
  const players = new Map([[target.id, target]]);
  let interactionSeq = 0;
  return {
    players,
    seq: 1,
    tick: 42,
    areaEffects: [],
    getPlayer: (id) => players.get(id) || null,
    stationMachineFor: () => machine,
    nextInteractionId: () => `int_${(interactionSeq += 1)}`,
  };
}

test('throwing beer costs mischief, applies splash and broadcasts', () => {
  const target = makePlayer({ id: 'player_b', displayName: 'Bob', x: 12, z: 10 });
  const sender = makePlayer();
  const room = makeRoom(target);
  const def = SABOTAGE.THROW_BEER;
  const before = sender.mischief;

  const result = resolveSabotage({ room, sender, payload: { action: 'THROW_BEER', targetPlayerId: 'player_b' }, now: 1_000 });
  assert.equal(result.ok, true);
  assert.equal(sender.mischief, before - def.cost);
  assert.ok(sender.sabotageCooldowns.THROW_BEER > 1_000);
  assert.equal(sender.stats.sabotageThrown, 1);
  assert.equal(sender.stats.sabotageHit, 1);

  const kinds = result.events.map((e) => e.event);
  assert.ok(kinds.includes(SABOTAGE_EVENTS.THROW_BEER));
  assert.ok(kinds.includes('MISCHIEF_CHANGED'));
  const hit = result.events.find((e) => e.event === SABOTAGE_EVENTS.THROW_BEER).payload;
  assert.equal(hit.senderId, sender.id);
  assert.equal(hit.targetId, target.id);
  assert.equal(hit.effect, 'SPLASH');

  const splash = target.effects.find((e) => e.kind === 'SPLASH');
  assert.ok(splash, 'target is splashed');
  assert.equal(splash.until, 1_000 + EFFECTS.SPLASH.durationMs);
});

test('sabotage rejects out of range, unknown actions and broke players', () => {
  const target = makePlayer({ id: 'player_b', x: 60, z: 60 });
  const sender = makePlayer();
  const room = makeRoom(target);

  const tooFar = resolveSabotage({ room, sender, payload: { action: 'THROW_BEER', targetPlayerId: 'player_b' }, now: 1_000 });
  assert.equal(tooFar.ok, false);
  assert.equal(tooFar.code, ERROR_CODES.OUT_OF_RANGE);

  const unknown = resolveSabotage({ room, sender, payload: { action: 'NOPE', targetPlayerId: 'player_b' }, now: 1_000 });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.code, ERROR_CODES.INVALID_ACTION);

  const missing = resolveSabotage({ room, sender, payload: { action: 'THROW_BEER', targetPlayerId: 'player_zzz' }, now: 1_000 });
  assert.equal(missing.ok, false);
  assert.equal(missing.code, ERROR_CODES.INVALID_TARGET);

  sender.mischief = 1;
  const broke = resolveSabotage({ room, sender, payload: { action: 'THROW_BEER', targetPlayerId: 'player_b' }, now: 1_000 });
  assert.equal(broke.ok, false);
  assert.equal(broke.code, ERROR_CODES.NOT_ENOUGH_MISCHIEF);
  assert.equal(sender.mischief, 1, 'failed attempts are free');
});

test('sabotage cooldown blocks repeat spam', () => {
  const target = makePlayer({ id: 'player_b', x: 11, z: 10 });
  const sender = makePlayer();
  const room = makeRoom(target);
  const now = 5_000;
  assert.equal(resolveSabotage({ room, sender, payload: { action: 'PEANUT', targetPlayerId: 'player_b' }, now }).ok, true);
  const again = resolveSabotage({ room, sender, payload: { action: 'PEANUT', targetPlayerId: 'player_b' }, now: now + 10 });
  assert.equal(again.ok, false);
  assert.equal(again.code, ERROR_CODES.COOLDOWN);
  const later = resolveSabotage({
    room,
    sender,
    payload: { action: 'PEANUT', targetPlayerId: 'player_b' },
    now: now + SABOTAGE.PEANUT.cooldownMs + 1,
  });
  assert.equal(later.ok, true, 'cooldown eventually expires');
});

test('machine-targeted sabotage also hits the machine', () => {
  const machine = createMachine(0, 5);
  startSpin(machine, 1_000);
  machine.combo = 3;
  const target = makePlayer({ id: 'player_b', x: 10, z: 10, stationId: 0 });
  const sender = makePlayer({ x: 10.5, z: 10 });
  const room = makeRoom(target, machine);

  const result = resolveSabotage({ room, sender, payload: { action: 'COIN', targetPlayerId: 'player_b' }, now: 2_000 });
  assert.equal(result.ok, true);
  const kinds = result.events.map((e) => e.event);
  assert.ok(kinds.includes('MACHINE_COMBO_BREAK'), 'coin toss breaks the combo');
  assert.equal(machine.combo, 0);

  const cooler = resolveSabotage({ room, sender, payload: { action: 'COOLER', targetPlayerId: 'player_b' }, now: 15_000 });
  assert.equal(cooler.ok, true);
  assert.ok(cooler.events.some((e) => e.event === 'MACHINE_HEAT_CHANGED'));
});

test('smoke bomb creates a lingering area effect', () => {
  const target = makePlayer({ id: 'player_b', x: 10, z: 10 });
  const sender = makePlayer();
  const room = makeRoom(target);
  const result = resolveSabotage({ room, sender, payload: { action: 'SMOKE', targetPlayerId: 'player_b' }, now: 3_000 });
  assert.equal(result.ok, true);
  assert.equal(room.areaEffects.length, 1);
  assert.equal(room.areaEffects[0].kind, 'SMOKE_AREA');
  assert.equal(room.areaEffects[0].ownerId, sender.id);
});

test('cleanse targets self and wipes own effects', () => {
  const sender = makePlayer({ effects: [{ kind: 'SPLASH', until: 9_999, from: 'player_b' }] });
  const room = makeRoom(sender);
  const result = resolveSabotage({ room, sender, payload: { action: 'CLEAN' }, now: 4_000 });
  assert.equal(result.ok, true);
  assert.equal(sender.effects.length, 0, 'own debuffs cleared');
  assert.equal(sender.stats.roomsCleaned, 1);
  assert.equal(sender.stats.sabotageHit, 0, 'self-cleanse is not scored as a hit');
  assert.ok(result.events.some((e) => e.event === SABOTAGE_EVENTS.CLEAN));
  assert.equal(sender.mischief, MISCHIEF.start - SABOTAGE.CLEAN.cost);
});

test('updateMischief regenerates up to the cap', () => {
  const player = { mischief: MISCHIEF.max };
  assert.equal(updateMischief(player, 1_000, 1_000), false, 'already full');

  player.mischief = 50;
  const changed = updateMischief(player, 1_000, 1_000);
  assert.equal(changed, true);
  assert.ok(player.mischief > 50);

  player.mischief = MISCHIEF.max - 1;
  updateMischief(player, 2_000, 60_000);
  assert.equal(player.mischief, MISCHIEF.max, 'never exceeds the cap');
});
