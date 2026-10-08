import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createMachine,
  startSpin,
  stopReel,
  toggleHold,
  releaseOverbrew,
  machineTick,
  machineSnapshot,
  currentScore,
} from '../../server/game/machine.js';
import { MACHINE } from '../../shared/constants.js';
import { qualityFor, comboMultiplier } from '../../shared/machineMath.js';

function spinAt(machine, now, forceAngle = null) {
  const result = startSpin(machine, now);
  assert.equal(result.ok, true, `startSpin failed: ${result.code}`);
  if (forceAngle !== null) {
    for (const reel of machine.spin.reels) {
      if (!reel) continue;
      reel.baseAngle = forceAngle;
      reel.speed = 0;
    }
  }
  return result;
}

function stopReelAt(machine, now, latencyMs = 0) {
  const result = stopReel(machine, now, { latencyMs });
  assert.equal(result.ok, true, `stopReel failed: ${result.code}`);
  return result;
}

test('createMachine starts idle with three stopped reels', () => {
  const machine = createMachine(3, 12345);
  assert.equal(machine.stationId, 3);
  assert.equal(machine.phase, 'IDLE');
  assert.equal(machine.reels.length, MACHINE.reelCount);
  assert.ok(machine.reels.every((reel) => reel.stopped));
  assert.equal(machine.activeReel, -1);
  assert.equal(machine.combo, 0);
  assert.equal(machine.heat, 0);
  assert.deepEqual(machine.holds, [false, false, false]);
});

test('spin starts a round and reports MACHINE_SPIN', () => {
  const machine = createMachine(0, 7);
  const { event } = spinAt(machine, 10_000);
  assert.equal(event.event, 'MACHINE_SPIN');
  assert.equal(event.payload.stationId, 0);
  assert.equal(event.payload.round, 1);
  assert.equal(machine.phase, 'SPINNING');
  assert.equal(machine.activeReel, 0);
  assert.ok(event.payload.spin.reels.length === MACHINE.reelCount);
  assert.equal(startSpin(machine, 10_050).ok, false, 'cannot spin twice');
});

test('stopping reels scores quality, heat and combo', () => {
  const machine = createMachine(0, 7);
  spinAt(machine, 10_000, 0);
  const first = stopReelAt(machine, 10_400);
  assert.equal(first.quality, 'PERFECT');
  assert.equal(first.gained, Math.round(MACHINE.stopScores.PERFECT * comboMultiplier(0)));
  assert.equal(machine.reels[0].stopped, true);
  assert.equal(machine.reels[0].quality, 'PERFECT');
  assert.equal(machine.combo, MACHINE.comboPerPerfect);
  assert.equal(machine.heat, MACHINE.heat.PERFECT);
  assert.equal(machine.activeReel, 1);

  const second = stopReelAt(machine, 10_800);
  assert.equal(second.quality, 'PERFECT');
  assert.equal(second.events[0].payload.mult, comboMultiplier(machine.combo), 'event reports post-increment combo');
  assert.equal(second.gained, Math.round(MACHINE.stopScores.PERFECT * comboMultiplier(machine.combo - MACHINE.comboPerPerfect)));
  assert.equal(machine.activeReel, 2);

  const third = stopReelAt(machine, 11_200);
  assert.equal(machine.phase, 'IDLE', 'round ends when every reel is stopped');
  assert.equal(machine.spin, null);
  assert.equal(machine.activeReel, -1);
  assert.equal(third.events.some((e) => e.event === 'MACHINE_ROUND_END'), true);
  assert.ok(currentScore(machine) > 0);
});

test('misses break the combo and heat only grows with quality', () => {
  const machine = createMachine(0, 99);
  spinAt(machine, 20_000, 180);
  machine.combo = 4;
  const result = stopReelAt(machine, 20_400);
  assert.equal(result.quality, 'MISS');
  assert.equal(machine.combo, 0);
  assert.equal(machine.heat, MACHINE.heat.MISS);
  assert.equal(result.gained, 0);
});

test('stop respects min stop interval and stun', () => {
  const machine = createMachine(0, 5);
  spinAt(machine, 30_000, 0);
  stopReelAt(machine, 30_400);
  const tooFast = stopReel(machine, 30_400 + MACHINE.minStopIntervalMs - 1);
  assert.equal(tooFast.ok, false);
  assert.equal(tooFast.code, 'COOLDOWN');

  const stunnedMachine = createMachine(0, 6);
  spinAt(stunnedMachine, 31_000, 0);
  stunnedMachine.stunUntil = 32_000;
  const stunned = stopReel(stunnedMachine, 31_400);
  assert.equal(stunned.ok, false);
  assert.equal(stunned.code, 'INVALID_ACTION');
  assert.equal(stopReel(stunnedMachine, 32_001).ok, true, 'stun expires');
});

test('latency compensation picks the stop time before the input arrived', () => {
  const machine = createMachine(0, 5);
  spinAt(machine, 40_000);
  for (const reel of machine.spin.reels) {
    reel.baseAngle = 45;
    reel.speed = 0;
  }
  const result = stopReel(machine, 41_000, { latencyMs: 500 });
  assert.equal(result.quality, qualityFor(45));
});

test('holds can only be toggled while idle and are capped', () => {
  const machine = createMachine(0, 11);
  spinAt(machine, 50_000, 0);
  const duringSpin = toggleHold(machine, 0, true);
  assert.equal(duringSpin.ok, false);
  assert.equal(duringSpin.code, 'INVALID_ACTION');

  stopReelAt(machine, 50_400);
  machine.phase = 'IDLE';
  machine.reels[0].quality = 'GOOD';
  const held = toggleHold(machine, 0, true);
  assert.equal(held.ok, true);
  assert.equal(machine.holds[0], true);
  assert.equal(held.event.payload.holds[0], true);

  for (let i = 1; i < MACHINE.maxHolds + 1; i += 1) {
    machine.reels[i].stopped = true;
    machine.reels[i].quality = 'GOOD';
    toggleHold(machine, i, true);
  }
  assert.equal(machine.holds.filter(Boolean).length, MACHINE.maxHolds);
  assert.equal(toggleHold(machine, 0, false).ok, true);
  assert.equal(toggleHold(machine, 99, true).code, 'INVALID_PAYLOAD');
});

test('overbrew triggers at max heat and can be cashed out', () => {
  const machine = createMachine(0, 21);
  spinAt(machine, 60_000, 0);
  machine.heat = MACHINE.heat.overbrewAt;
  const stop = stopReelAt(machine, 60_400);
  assert.equal(machine.phase, 'OVERBREW');
  assert.equal(stop.overbrew, true);
  assert.ok(stop.events.some((e) => e.event === 'MACHINE_OVERBREW_START'));
  assert.ok(machine.overbrewDeadline > 60_400);

  const released = releaseOverbrew(machine, 60_600);
  assert.equal(released.ok, true);
  assert.equal(machine.heat, MACHINE.heat.coolOnOverbrewSuccess);
  assert.ok(machine.combo >= 2);
  assert.ok(released.events.some((e) => e.event === 'MACHINE_OVERBREW_SUCCESS'));
  assert.equal(machine.overbrewDeadline, 0);

  const stale = createMachine(0, 22);
  stale.phase = 'OVERBREW';
  stale.overbrewDeadline = 100;
  const late = releaseOverbrew(stale, 1_000);
  assert.equal(late.ok, false);
  assert.equal(late.code, 'STATE_MISMATCH');
});

test('overbrew deadline expires through machineTick', () => {
  const machine = createMachine(0, 33);
  spinAt(machine, 70_000, 0);
  machine.heat = MACHINE.heat.overbrewAt;
  stopReelAt(machine, 70_400);
  assert.equal(machine.phase, 'OVERBREW');
  const deadline = machine.overbrewDeadline;
  const events = machineTick(machine, deadline + 1, 16);
  assert.ok(events.some((e) => e.event === 'MACHINE_OVERBREW_FAIL'));
  assert.equal(machine.phase, 'IDLE');
  assert.equal(machine.heat, 0);
  assert.equal(machine.combo, 0);
});

test('idle heat decays over time', () => {
  const machine = createMachine(0, 44);
  machine.heat = 40;
  machineTick(machine, 1_000, 1000);
  assert.ok(machine.heat < 40);
  machine.heat = 0;
  machineTick(machine, 2_000, 1000);
  assert.equal(machine.heat, 0, 'heat never goes negative');
});

test('machineSnapshot exposes the public machine view', () => {
  const machine = createMachine(2, 55);
  machine.controllerId = 'player_1';
  spinAt(machine, 80_000, 0);
  stopReelAt(machine, 80_400);
  const snapshot = machineSnapshot(machine, 80_500);
  assert.equal(snapshot.stationId, 2);
  assert.equal(snapshot.controllerId, 'player_1');
  assert.equal(snapshot.phase, 'SPINNING');
  assert.equal(snapshot.reels.length, MACHINE.reelCount);
  assert.deepEqual(
    snapshot.reels.map((reel) => reel.i),
    [0, 1, 2],
  );
  assert.equal(snapshot.reels[0].stopped, true);
  assert.equal(snapshot.reels[1].stopped, false);
  assert.ok(typeof snapshot.score === 'number');
  assert.ok(typeof snapshot.heat === 'number');
  assert.ok(snapshot.spin);
});
