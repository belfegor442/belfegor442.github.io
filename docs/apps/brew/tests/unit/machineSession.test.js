import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createMachine, machineView, startSpin, stopReel, cashoutOverbrew, failOverbrew,
  decayHeat, winningsFor, clampStake
} from '../../src/machine.js';
import { MACHINE } from '../../shared/constants.js';

function fresh(stake = 25) {
  const s = createMachine('u1', stake, 'sm-0');
  s.lastRoundAt = 0;
  return s;
}

test('clampStake bounds the stake to [1, 1000]', () => {
  assert.equal(clampStake(0), 1);
  assert.equal(clampStake(-5), 1);
  assert.equal(clampStake('x'), 1);
  assert.equal(clampStake(2500), 1000);
  assert.equal(clampStake(25.4), 25);
});

test('startSpin enters spinning with three live reels and heat-scaled speeds', () => {
  const s = fresh();
  const now = Date.now();
  assert.deepEqual(startSpin(s, now), {});
  assert.equal(s.phase, 'spinning');
  assert.equal(s.spin.reels.length, 3);
  assert.ok(s.reels.every(r => !r.stopped));
  // Busy while already spinning.
  assert.deepEqual(startSpin(s, now + 10), { error: 'busy' });
});

test('stopping the wrong reel is bad-pick; stopping out of order too', () => {
  const s = fresh();
  const now = Date.now();
  startSpin(s, now);
  assert.equal(stopReel(s, now + 200, 1, 0).error, 'bad-pick');
  assert.equal(stopReel(s, now + 200, 9, 0).error, 'bad-reel');
  assert.equal(stopReel(s, now + 200, -1, 0).error, 'bad-reel');
});

test('a full round completes, pays by score/200 and returns to idle', () => {
  const s = fresh(100);
  const now = Date.now();
  startSpin(s, now);
  let last = null;
  for (let i = 0; i < 3; i++) {
    s.lastStopAt = 0;
    last = stopReel(s, now + 200 + i * 200, i, 0);
    assert.equal(last.error, undefined);
  }
  assert.ok(last.result, 'round finished');
  assert.equal(s.phase, 'idle');
  assert.equal(s.spin, null);
  const win = winningsFor(s, last.result);
  assert.equal(win, Math.round(100 * last.result.total / 200));
  assert.ok(s.heat >= 0 && s.heat <= MACHINE.heat.overbrewAt);
});

test('heat at 100 opens the overbrew window; cashout doubles, timeout quarters', () => {
  const s = fresh();
  const now = Date.now();
  startSpin(s, now);
  s.heat = MACHINE.heat.overbrewAt - 1;
  s.lastStopAt = 0;
  const r = stopReel(s, now + 300, 0, 0);
  assert.equal(r.error, undefined);
  assert.equal(s.phase, 'overbrew');
  assert.ok(s.overbrewDeadline > now);
  // Stop attempts during overbrew are refused.
  assert.equal(stopReel(s, now + 400, 1, 0).error, 'busy');
  const cash = cashoutOverbrew(s, now + 500);
  assert.equal(cash.mult, MACHINE.overbrewMultiplier);
  assert.equal(s.phase, 'idle');
  assert.equal(s.heat, MACHINE.heat.coolOnOverbrewSuccess);

  // And the fail path quarters the round.
  const s2 = fresh();
  startSpin(s2, now);
  s2.heat = MACHINE.heat.overbrewAt;
  s2.phase = 'overbrew';
  const fail = failOverbrew(s2, now + 3000);
  assert.equal(fail.mult, MACHINE.overbrewFailPenalty);
  assert.equal(s2.phase, 'idle');
  assert.equal(s2.heat, 0);
  assert.equal(s2.combo, 0);
});

test('idle heat decays at decayPerSecIdle, folded into snapshots', () => {
  const s = fresh();
  s.heat = 60;
  s.lastDecayAt = Date.now() - 2000;
  const view = machineView(s, Date.now());
  assert.ok(view.heat < 60, 'heat decayed in the view');
  assert.ok(view.heat >= 60 - MACHINE.heat.decayPerSecIdle * 2.01);
  decayHeat(s, Date.now() + 100000);
  assert.equal(s.heat, 0, 'clamped at zero');
});

test('latency is clamped to maxInputLatencyMs', () => {
  const s = fresh();
  const now = Date.now();
  startSpin(s, now);
  s.lastStopAt = 0;
  // Huge latency is clamped, so the evaluated angle is still in range.
  const r = stopReel(s, now + 1000, 0, 999999);
  assert.equal(r.error, undefined);
  assert.ok(['PERFECT', 'GOOD', 'OK', 'MISS'].includes(r.quality));
});
