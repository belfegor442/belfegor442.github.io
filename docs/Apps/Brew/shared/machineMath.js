import { MACHINE } from './constants.js';

export function normalize360(deg) {
  let a = deg % 360;
  if (a < 0) a += 360;
  return a;
}

export function angleDistance(a, b) {
  let d = Math.abs(normalize360(a) - normalize360(b));
  if (d > 180) d = 360 - d;
  return d;
}

export function qualityFor(angle) {
  const d = angleDistance(angle, 0);
  if (d <= MACHINE.perfectWindow) return 'PERFECT';
  if (d <= MACHINE.goodWindow) return 'GOOD';
  if (d <= MACHINE.okWindow) return 'OK';
  return 'MISS';
}

export function qualityScore(quality) {
  return MACHINE.stopScores[quality] || 0;
}

export function comboMultiplier(combo) {
  return Math.min(1 + combo * MACHINE.comboStep, MACHINE.comboMax);
}

export function heatTier(heat) {
  if (heat >= MACHINE.heat.criticalAt) return 'CRITICAL';
  if (heat >= MACHINE.heat.riskAt) return 'RISK';
  if (heat >= MACHINE.heat.pressureAt) return 'PRESSURE';
  return 'NOMINAL';
}

export function speedMultiplierForHeat(heat) {
  for (const tier of MACHINE.speedByThreshold) {
    if (heat >= tier.at) return tier.mult;
  }
  return 1;
}

export function reelAngleAt(spin, reelIndex, atTimeMs) {
  const reel = spin.reels[reelIndex];
  const elapsed = (atTimeMs - spin.startedAt) / 1000;
  let angle = reel.baseAngle + reel.speed * elapsed;
  if (spin.wobbleAmp) {
    angle += spin.wobbleAmp * Math.sin((elapsed * 1000) / spin.wobblePeriodMs * Math.PI * 2);
  }
  return normalize360(angle);
}

export function heldAngleAt(machine, reelIndex) {
  return machine.reels[reelIndex].angle;
}

export function nextActiveReel(machine) {
  for (let i = 0; i < machine.reels.length; i += 1) {
    if (!machine.reels[i].stopped) return i;
  }
  return -1;
}

export function roundComplete(machine) {
  return machine.reels.every((reel) => reel.stopped);
}

export function effectiveStopTime(nowMs, spinStartedAt, latencyMs) {
  const latency = Math.min(Math.max(latencyMs || 0, 0), MACHINE.maxInputLatencyMs);
  const candidate = nowMs - latency;
  return Math.min(Math.max(candidate, spinStartedAt), nowMs);
}
