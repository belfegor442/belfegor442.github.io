// Host-side skill-stop sessions for the in-room slot cabinets. Pure session
// state + math (node-safe, no DOM): the authority in state.js owns balances
// and the wire messages, this module owns spin/stop/heat/combo state.

import { MACHINE } from '../shared/constants.js';
import {
  normalize360, qualityFor, qualityScore, comboMultiplier, heatTier,
  speedMultiplierForHeat, reelAngleAt, nextActiveReel, roundComplete,
  effectiveStopTime
} from '../shared/machineMath.js';

export const MIN_STAKE = 1;
export const MAX_STAKE = 1000;

export function clampStake(v) {
  const n = Math.round(Number(v) || 0);
  if (!n) return MIN_STAKE;
  return Math.max(MIN_STAKE, Math.min(MAX_STAKE, n));
}

export function createMachine(uid, stake, machineId) {
  return {
    uid,
    machineId,
    stake: clampStake(stake),
    phase: 'idle', // idle | spinning | overbrew
    score: 0,
    combo: 0,
    maxCombo: 0,
    heat: 0,
    reels: [0, 1, 2].map(i => ({ index: i, angle: Math.random() * 360, stopped: true, quality: null })),
    spin: null,
    roundEarned: 0,
    overbrewDeadline: 0,
    lastStopAt: 0,
    lastRoundAt: 0,
    lastDecayAt: Date.now(),
    lastTouch: Date.now()
  };
}

// Idle machines cool down. Mathematically folded into every snapshot so the
// client's heat bar drains between packets without extra ticks.
export function decayHeat(s, now) {
  if (s.phase !== 'idle') { s.lastDecayAt = now; return; }
  const dt = Math.min(30, Math.max(0, (now - s.lastDecayAt) / 1000));
  s.lastDecayAt = now;
  if (s.heat > 0) s.heat = Math.max(0, s.heat - MACHINE.heat.decayPerSecIdle * dt);
}

export function machineView(s, now) {
  decayHeat(s, now);
  return {
    phase: s.phase,
    stake: s.stake,
    score: s.score,
    combo: s.combo,
    maxCombo: s.maxCombo,
    heat: s.heat,
    tier: heatTier(s.heat),
    reels: s.reels.map(r => ({ i: r.index, angle: r.angle, stopped: r.stopped, quality: r.quality })),
    spin: s.spin ? {
      startedAt: s.spin.startedAt,
      wobbleAmp: s.spin.wobbleAmp,
      wobblePeriodMs: s.spin.wobblePeriodMs,
      reels: s.spin.reels
    } : null,
    roundEarned: s.roundEarned,
    overbrewDeadline: s.overbrewDeadline || 0
  };
}

export function startSpin(s, now) {
  if (s.phase !== 'idle') return { error: 'busy' };
  if (now - s.lastRoundAt < MACHINE.minSpinGapMs) return { error: 'busy' };
  const mult = speedMultiplierForHeat(s.heat);
  s.phase = 'spinning';
  s.roundEarned = 0;
  s.overbrewDeadline = 0;
  s.spin = {
    startedAt: now,
    wobbleAmp: MACHINE.wobblePerReel,
    wobblePeriodMs: 900,
    reels: [0, 1, 2].map(i => ({
      baseAngle: Math.random() * 360,
      speed: MACHINE.baseSpeeds[i] * mult
    }))
  };
  s.reels = s.spin.reels.map((r, i) => ({ index: i, angle: r.baseAngle, stopped: false, quality: null }));
  s.lastTouch = now;
  return {};
}

function finishRound(s, now, mult) {
  const total = Math.round(s.roundEarned * mult);
  s.phase = 'idle';
  s.spin = null;
  s.roundEarned = 0;
  s.overbrewDeadline = 0;
  s.lastRoundAt = now;
  s.reels = [0, 1, 2].map(i => ({ index: i, angle: Math.random() * 360, stopped: true, quality: null }));
  return { total, mult };
}

// Chips won for a finished round: the score total is a per-200-points rate on
// the stake (a PERFECT-heavy round banks well, a sloppy one loses the stake).
export function winningsFor(s, result) {
  return Math.round(s.stake * result.total / 200);
}

export function stopReel(s, now, reelIdx, latencyMs) {
  reelIdx = Number(reelIdx);
  if (!Number.isInteger(reelIdx) || reelIdx < 0 || reelIdx >= MACHINE.reelCount) return { error: 'bad-reel' };
  if (s.phase === 'overbrew') return { error: 'busy' };
  if (s.phase !== 'spinning') return { error: 'busy' };
  if (reelIdx !== nextActiveReel(s)) return { error: 'bad-pick' };
  if (now - s.lastStopAt < MACHINE.minStopIntervalMs) return { error: 'busy' };

  const t = effectiveStopTime(now, s.spin.startedAt, latencyMs);
  const angle = reelAngleAt(s.spin, reelIdx, t);
  const quality = qualityFor(angle);
  const gained = Math.round(qualityScore(quality) * comboMultiplier(s.combo));

  if (quality === 'PERFECT') {
    if (s.lastStopAt && now - s.lastStopAt <= MACHINE.comboWindowMs) s.combo += 1;
    else s.combo = 1;
  } else if (quality === 'MISS') {
    s.combo = 0;
  } else if (!s.lastStopAt || now - s.lastStopAt > MACHINE.comboWindowMs) {
    s.combo = 0;
  }
  if (s.combo > s.maxCombo) s.maxCombo = s.combo;

  s.heat = Math.min(MACHINE.heat.overbrewAt, s.heat + (MACHINE.heat[quality] || 0));
  const tier = heatTier(s.heat);
  if (quality === 'MISS' && (tier === 'RISK' || tier === 'CRITICAL')) {
    s.heat = Math.min(MACHINE.heat.overbrewAt, s.heat + MACHINE.heat.riskHeatOnMiss);
  }

  s.roundEarned += gained;
  const reel = s.reels[reelIdx];
  reel.angle = normalize360(angle);
  reel.stopped = true;
  reel.quality = quality;
  s.lastStopAt = now;
  s.lastTouch = now;

  let result = null;
  if (s.heat >= MACHINE.heat.overbrewAt) {
    s.phase = 'overbrew';
    s.overbrewDeadline = now + MACHINE.overbrewWindowMs;
  } else if (roundComplete(s)) {
    result = finishRound(s, now, 1);
  }
  return { quality, gained, result };
}

export function cashoutOverbrew(s, now) {
  if (s.phase !== 'overbrew') return { error: 'busy' };
  s.heat = MACHINE.heat.coolOnOverbrewSuccess;
  s.combo += 2;
  if (s.combo > s.maxCombo) s.maxCombo = s.combo;
  return finishRound(s, now, MACHINE.overbrewMultiplier);
}

export function failOverbrew(s, now) {
  if (s.phase !== 'overbrew') return null;
  s.heat = 0;
  s.combo = 0;
  return finishRound(s, now, MACHINE.overbrewFailPenalty);
}
