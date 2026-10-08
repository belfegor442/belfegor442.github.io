import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalize360,
  angleDistance,
  qualityFor,
  qualityScore,
  comboMultiplier,
  heatTier,
  speedMultiplierForHeat,
  reelAngleAt,
  nextActiveReel,
  roundComplete,
  effectiveStopTime,
} from '../../shared/machineMath.js';
import { MACHINE } from '../../shared/constants.js';

test('normalize360 wraps positive and negative angles', () => {
  assert.equal(normalize360(0), 0);
  assert.equal(normalize360(360), 0);
  assert.equal(normalize360(450), 90);
  assert.equal(normalize360(-90), 270);
  assert.ok(normalize360(-720) === 0, 'wraps to zero (may be -0)');
});

test('angleDistance takes the shortest arc', () => {
  assert.equal(angleDistance(0, 10), 10);
  assert.equal(angleDistance(350, 10), 20);
  assert.equal(angleDistance(180, 0), 180);
  assert.equal(angleDistance(270, 90), 180);
});

test('qualityFor maps angles into quality windows', () => {
  assert.equal(qualityFor(0), 'PERFECT');
  assert.equal(qualityFor(MACHINE.perfectWindow), 'PERFECT');
  assert.equal(qualityFor(MACHINE.perfectWindow + 1), 'GOOD');
  assert.equal(qualityFor(MACHINE.goodWindow), 'GOOD');
  assert.equal(qualityFor(MACHINE.goodWindow + 1), 'OK');
  assert.equal(qualityFor(MACHINE.okWindow), 'OK');
  assert.equal(qualityFor(MACHINE.okWindow + 1), 'MISS');
  assert.equal(qualityFor(180), 'MISS');
  assert.equal(qualityFor(355), qualityFor(5));
});

test('qualityScore uses configured stop scores', () => {
  assert.equal(qualityScore('PERFECT'), MACHINE.stopScores.PERFECT);
  assert.equal(qualityScore('MISS'), 0);
  assert.equal(qualityScore('UNKNOWN'), 0);
  assert.ok(qualityScore('PERFECT') > qualityScore('GOOD'));
  assert.ok(qualityScore('GOOD') > qualityScore('OK'));
});

test('comboMultiplier grows with combo and caps at comboMax', () => {
  assert.equal(comboMultiplier(0), 1);
  assert.equal(comboMultiplier(1), 1 + MACHINE.comboStep);
  assert.equal(comboMultiplier(1000), MACHINE.comboMax);
});

test('heatTier reports escalating tiers', () => {
  assert.equal(heatTier(0), 'NOMINAL');
  assert.equal(heatTier(MACHINE.heat.pressureAt), 'PRESSURE');
  assert.equal(heatTier(MACHINE.heat.riskAt), 'RISK');
  assert.equal(heatTier(MACHINE.heat.criticalAt), 'CRITICAL');
});

test('speedMultiplierForHeat never slows the reels down', () => {
  assert.equal(speedMultiplierForHeat(0), 1);
  const hot = speedMultiplierForHeat(MACHINE.heat.overbrewAt);
  assert.ok(hot >= speedMultiplierForHeat(MACHINE.heat.pressureAt));
  assert.ok(hot > 1);
});

test('reelAngleAt advances by speed over elapsed time', () => {
  const spin = {
    startedAt: 1000,
    reels: [{ baseAngle: 10, speed: 90 }, { baseAngle: 0, speed: 0 }],
    wobbleAmp: 0,
    wobblePeriodMs: 640,
  };
  assert.equal(reelAngleAt(spin, 0, 1000), 10);
  assert.equal(reelAngleAt(spin, 0, 2000), 100);
  assert.equal(reelAngleAt(spin, 0, 6000), 100, 'wraps at 360 degrees');
  assert.equal(reelAngleAt(spin, 1, 5000), 0);
});

test('reelAngleAt applies wobble when present', () => {
  const spin = {
    startedAt: 0,
    reels: [{ baseAngle: 0, speed: 0 }],
    wobbleAmp: 34,
    wobblePeriodMs: 640,
  };
  const atQuarterPeriod = reelAngleAt(spin, 0, 160);
  const atRest = reelAngleAt(spin, 0, 0);
  assert.notEqual(atQuarterPeriod, atRest);
  assert.equal(reelAngleAt(spin, 0, 0), 0);
});

test('nextActiveReel and roundComplete track reel state', () => {
  const machine = {
    reels: [
      { stopped: false },
      { stopped: true },
      { stopped: false },
    ],
  };
  assert.equal(nextActiveReel(machine), 0);
  assert.equal(roundComplete(machine), false);
  machine.reels[0].stopped = true;
  machine.reels[2].stopped = true;
  assert.equal(nextActiveReel(machine), -1);
  assert.equal(roundComplete(machine), true);
});

test('effectiveStopTime clamps latency to the spin window', () => {
  const start = 1000;
  const now = 3000;
  assert.equal(effectiveStopTime(now, start, 0), now);
  assert.equal(effectiveStopTime(now, start, 200), 2800);
  assert.equal(effectiveStopTime(now, start, 99999), 2600, 'latency capped at maxInputLatencyMs');
  assert.equal(effectiveStopTime(500, start, 200), 500, 'now wins when now precedes the spin');
  assert.equal(effectiveStopTime(now, start, -50), now, 'negative latency clamps to zero');
});
