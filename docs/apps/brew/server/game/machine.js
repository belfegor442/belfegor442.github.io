import { MACHINE } from '../../shared/constants.js';
import {
  qualityFor,
  qualityScore,
  comboMultiplier,
  heatTier,
  speedMultiplierForHeat,
  reelAngleAt,
  nextActiveReel,
  roundComplete,
  effectiveStopTime,
  normalize360,
} from '../../shared/machineMath.js';
import { createRng } from '../util/rng.js';

const HOLD_VALUE = MACHINE.holdValue;

function bucketTarget(machine) {
  if (machine.challenge) return machine.challenge;
  if (machine.practice) return machine.practice;
  return machine;
}

export function addScore(machine, amount) {
  const target = bucketTarget(machine);
  target.score += amount;
  return target.score;
}

export function currentScore(machine) {
  return bucketTarget(machine).score;
}

export function createMachine(stationId, seed = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0) {
  return {
    stationId,
    ownerId: null,
    controllerId: null,
    mode: 'LIVE',
    phase: 'IDLE',
    score: 0,
    combo: 0,
    maxCombo: 0,
    heat: 0,
    holds: [false, false, false],
    reels: [0, 1, 2].map((index) => ({
      index,
      angle: 0,
      stopped: true,
      quality: null,
      held: false,
    })),
    spin: null,
    activeReel: -1,
    round: 0,
    roundEarned: 0,
    lastStopAt: 0,
    lastRoundAt: 0,
    stunUntil: 0,
    overbrewDeadline: 0,
    effects: [],
    challenge: null,
    practice: null,
    seed,
    rng: createRng(seed),
    stats: {
      stops: 0,
      perfects: 0,
      good: 0,
      ok: 0,
      misses: 0,
      rounds: 0,
      maxCombo: 0,
      heatPeak: 0,
      overbrewSuccess: 0,
      overbrewFail: 0,
    },
    lastTickAt: 0,
  };
}

export function resetMachineForOwner(machine, playerId) {
  machine.ownerId = playerId;
  machine.controllerId = playerId;
  machine.phase = 'IDLE';
  machine.spin = null;
  machine.activeReel = -1;
  machine.combo = 0;
  machine.heat = 0;
  machine.score = 0;
  machine.holds = [false, false, false];
  machine.challenge = null;
  machine.practice = null;
  machine.effects = [];
  machine.overbrewDeadline = 0;
  machine.stunUntil = 0;
  machine.round = 0;
  machine.lastStopAt = 0;
  machine.lastRoundAt = 0;
  machine.seed = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
  machine.rng = createRng(machine.seed);
  for (const reel of machine.reels) {
    reel.angle = 0;
    reel.stopped = true;
    reel.quality = null;
    reel.held = false;
  }
  machine.stats = {
    stops: 0,
    perfects: 0,
    good: 0,
    ok: 0,
    misses: 0,
    rounds: 0,
    maxCombo: 0,
    heatPeak: 0,
    overbrewSuccess: 0,
    overbrewFail: 0,
  };
}

export function releaseMachine(machine) {
  machine.ownerId = null;
  machine.controllerId = null;
  machine.challenge = null;
  machine.practice = null;
  machine.spin = null;
  machine.phase = 'IDLE';
  machine.combo = 0;
  machine.heat = 0;
  machine.effects = [];
}

function riskMultiplier(heat) {
  return heat >= MACHINE.heat.riskAt ? 1.5 : 1;
}

export function scoreMultiplierFor(machine, roomScoreMult = 1) {
  return comboMultiplier(machine.combo) * riskMultiplier(machine.heat) * roomScoreMult;
}

export function activeMachineEffects(machine, now) {
  return machine.effects.filter((effect) => effect.until > now);
}

function hasWobble(machine, now) {
  return activeMachineEffects(machine, now).some((effect) => effect.kind === 'JOLT' || effect.kind === 'SPLASH');
}

export function startSpin(machine, now, { roomScoreMult = 1 } = {}) {
  if (machine.phase !== 'IDLE') return { ok: false, code: 'INVALID_ACTION' };
  if (machine.stunUntil > now) return { ok: false, code: 'INVALID_ACTION' };
  if (now - machine.lastRoundAt < MACHINE.minSpinGapMs && machine.round > 0) {
    return { ok: false, code: 'COOLDOWN' };
  }
  if (roundComplete(machine) === false) return { ok: false, code: 'STATE_MISMATCH' };

  const heatMult = speedMultiplierForHeat(machine.heat);
  const reels = [];
  for (let i = 0; i < MACHINE.reelCount; i += 1) {
    const held = machine.holds[i];
    const reel = machine.reels[i];
    reel.held = held;
    if (held) {
      reel.stopped = true;
      reels.push(null);
      continue;
    }
    reel.stopped = false;
    reel.quality = null;
    reels.push({
      baseAngle: normalize360(machine.rng() * 360),
      speed: MACHINE.baseSpeeds[i] * heatMult,
    });
  }

  machine.spin = {
    startedAt: now,
    reels,
    wobbleAmp: hasWobble(machine, now) ? MACHINE.wobblePerReel : 0,
    wobblePeriodMs: 640,
    heatMult,
    roomScoreMult,
  };
  machine.phase = 'SPINNING';
  machine.activeReel = nextActiveReel(machine);
  machine.round += 1;
  machine.roundEarned = 0;

  return {
    ok: true,
    event: {
      event: 'MACHINE_SPIN',
      payload: {
        stationId: machine.stationId,
        round: machine.round,
        spin: publicSpin(machine),
        activeReel: machine.activeReel,
        heat: machine.heat,
        combo: machine.combo,
      },
    },
  };
}

export function publicSpin(machine) {
  if (!machine.spin) return null;
  return {
    startedAt: machine.spin.startedAt,
    reels: machine.spin.reels.map((reel) => (reel ? { baseAngle: reel.baseAngle, speed: reel.speed } : null)),
    wobbleAmp: machine.spin.wobbleAmp,
    wobblePeriodMs: machine.spin.wobblePeriodMs,
  };
}

export function stopReel(machine, now, { latencyMs = 0, roomScoreMult = 1 } = {}) {
  if (machine.phase !== 'SPINNING') return { ok: false, code: 'INVALID_ACTION' };
  if (machine.stunUntil > now) return { ok: false, code: 'INVALID_ACTION' };
  if (now - machine.lastStopAt < MACHINE.minStopIntervalMs) return { ok: false, code: 'COOLDOWN' };
  const reelIndex = machine.activeReel;
  if (reelIndex < 0 || machine.reels[reelIndex].stopped) return { ok: false, code: 'STATE_MISMATCH' };

  const at = effectiveStopTime(now, machine.spin.startedAt, latencyMs);
  const angle = reelAngleAt(machine.spin, reelIndex, at);
  const quality = qualityFor(angle);
  const reel = machine.reels[reelIndex];
  reel.stopped = true;
  reel.angle = normalize360(angle);
  reel.quality = quality;

  const windowExpired = machine.lastStopAt > 0 && now - machine.lastStopAt > MACHINE.comboWindowMs;
  if (windowExpired) machine.combo = 0;

  const mult = scoreMultiplierFor(machine, roomScoreMult);
  const base = qualityScore(quality);
  const gained = Math.round(base * mult);
  const target = bucketTarget(machine);
  if (gained > 0) target.score += gained;
  machine.roundEarned += gained;

  machine.stats.stops += 1;
  if (quality === 'PERFECT') machine.stats.perfects += 1;
  else if (quality === 'GOOD') machine.stats.good += 1;
  else if (quality === 'OK') machine.stats.ok += 1;
  else machine.stats.misses += 1;

  if (quality === 'PERFECT') machine.combo = Math.min(machine.combo + MACHINE.comboPerPerfect, 16);
  else if (quality === 'MISS' || quality === 'OK') machine.combo = 0;
  if (machine.combo > machine.maxCombo) machine.maxCombo = machine.combo;
  if (machine.combo > machine.stats.maxCombo) machine.stats.maxCombo = machine.combo;

  let heatDelta = MACHINE.heat[quality] || 0;
  const tier = heatTier(machine.heat);
  if (quality === 'MISS' && (tier === 'RISK' || tier === 'CRITICAL')) heatDelta += MACHINE.heat.riskHeatOnMiss;
  machine.heat = Math.min(MACHINE.heat.overbrewAt, Math.max(0, machine.heat + heatDelta));
  if (machine.heat > machine.stats.heatPeak) machine.stats.heatPeak = machine.heat;
  machine.lastStopAt = now;
  machine.activeReel = nextActiveReel(machine);

  const events = [
    {
      event: 'MACHINE_STOP',
      payload: {
        stationId: machine.stationId,
        playerId: machine.controllerId,
        reel: reelIndex,
        quality,
        angle: reel.angle,
        combo: machine.combo,
        mult: scoreMultiplierFor(machine, roomScoreMult),
        gained,
        score: target.score,
        heat: machine.heat,
        tier: heatTier(machine.heat),
        activeReel: machine.activeReel,
        stoppedAt: now,
      },
    },
  ];

  let overbrew = false;
  if (machine.heat >= MACHINE.heat.overbrewAt && machine.phase === 'SPINNING') {
    machine.phase = 'OVERBREW';
    machine.overbrewDeadline = now + MACHINE.overbrewWindowMs;
    overbrew = true;
    events.push({
      event: 'MACHINE_OVERBREW_START',
      payload: {
        stationId: machine.stationId,
        playerId: machine.controllerId,
        deadline: machine.overbrewDeadline,
        heat: machine.heat,
      },
    });
  }

  if (!overbrew && roundComplete(machine)) {
    events.push(...finishRound(machine, now, roomScoreMult));
  }

  return { ok: true, events, quality, gained, overbrew };
}

export function finishRound(machine, now, roomScoreMult = 1) {
  const events = [];
  let heldScore = 0;
  const mult = scoreMultiplierFor(machine, roomScoreMult);
  for (let i = 0; i < machine.reels.length; i += 1) {
    const reel = machine.reels[i];
    if (machine.holds[i] && reel.quality) {
      heldScore += Math.round(qualityScore(reel.quality) * HOLD_VALUE * mult);
    }
  }
  if (heldScore > 0) addScore(machine, heldScore);
  machine.roundEarned += heldScore;
  machine.stats.rounds += 1;
  machine.phase = 'IDLE';
  machine.spin = null;
  machine.activeReel = -1;
  machine.lastRoundAt = now;
  events.push({
    event: 'MACHINE_ROUND_END',
    payload: {
      stationId: machine.stationId,
      playerId: machine.controllerId,
      round: machine.round,
      heldScore,
      score: currentScore(machine),
      combo: machine.combo,
      heat: machine.heat,
      phase: machine.phase,
    },
  });
  return events;
}

export function toggleHold(machine, reelIndex, value) {
  if (machine.phase !== 'IDLE') return { ok: false, code: 'INVALID_ACTION' };
  if (!Number.isInteger(reelIndex) || reelIndex < 0 || reelIndex >= MACHINE.reelCount) {
    return { ok: false, code: 'INVALID_PAYLOAD' };
  }
  const reel = machine.reels[reelIndex];
  if (!reel.stopped || !reel.quality) return { ok: false, code: 'INVALID_ACTION' };
  const next = value === undefined ? !machine.holds[reelIndex] : Boolean(value);
  if (next && !machine.holds[reelIndex]) {
    const heldCount = machine.holds.filter(Boolean).length;
    if (heldCount >= MACHINE.maxHolds) return { ok: false, code: 'INVALID_ACTION' };
  }
  machine.holds[reelIndex] = next;
  reel.held = next;
  return {
    ok: true,
    event: {
      event: 'MACHINE_HOLD',
      payload: {
        stationId: machine.stationId,
        playerId: machine.controllerId,
        reel: reelIndex,
        holds: machine.holds.slice(),
        score: currentScore(machine),
      },
    },
  };
}

export function releaseOverbrew(machine, now, { roomScoreMult = 1 } = {}) {
  if (machine.phase !== 'OVERBREW') return { ok: false, code: 'INVALID_ACTION' };
  if (now > machine.overbrewDeadline) return { ok: false, code: 'STATE_MISMATCH' };
  machine.overbrewDeadline = 0;
  machine.stats.overbrewSuccess += 1;
  const banked = machine.roundEarned;
  if (banked > 0) addScore(machine, banked);
  machine.roundEarned = 0;
  machine.heat = MACHINE.heat.coolOnOverbrewSuccess;
  machine.phase = roundComplete(machine) ? 'IDLE' : 'SPINNING';
  machine.combo = Math.min(machine.combo + 2, 16);
  const events = [
    {
      event: 'MACHINE_OVERBREW_SUCCESS',
      payload: {
        stationId: machine.stationId,
        playerId: machine.controllerId,
        heat: machine.heat,
        combo: machine.combo,
        score: currentScore(machine),
        banked,
      },
    },
  ];
  if (machine.phase === 'IDLE') {
    machine.spin = null;
    machine.activeReel = -1;
    machine.lastRoundAt = now;
    events.push({
      event: 'MACHINE_ROUND_END',
      payload: {
        stationId: machine.stationId,
        playerId: machine.controllerId,
        round: machine.round,
        heldScore: 0,
        score: currentScore(machine),
        combo: machine.combo,
        heat: machine.heat,
        phase: machine.phase,
      },
    });
  }
  return { ok: true, events };
}

export function failOverbrew(machine, now) {
  machine.overbrewDeadline = 0;
  machine.stats.overbrewFail += 1;
  const target = bucketTarget(machine);
  target.score = Math.max(0, Math.floor(target.score * (1 - MACHINE.overbrewFailPenalty)));
  machine.heat = 0;
  machine.combo = 0;
  machine.phase = 'IDLE';
  machine.spin = null;
  machine.activeReel = -1;
  machine.roundEarned = 0;
  machine.lastRoundAt = now;
  machine.effects = machine.effects.filter((effect) => effect.kind !== 'JOLT' && effect.kind !== 'SPLASH');
  for (const reel of machine.reels) {
    if (!reel.stopped) {
      reel.stopped = true;
      reel.quality = null;
    }
  }
  return {
    event: 'MACHINE_OVERBREW_FAIL',
    payload: {
      stationId: machine.stationId,
      playerId: machine.controllerId,
      score: currentScore(machine),
      heat: 0,
      combo: 0,
      phase: machine.phase,
    },
  };
}

export function machineTick(machine, now, dtMs, { heatDecayMult = 1 } = {}) {
  const events = [];
  if (machine.phase === 'OVERBREW' && now >= machine.overbrewDeadline) {
    events.push(failOverbrew(machine, now));
  }
  if (machine.effects.length) {
    const before = machine.effects.length;
    machine.effects = machine.effects.filter((effect) => effect.until > now);
    if (machine.effects.length !== before && machine.spin) {
      const wobble = hasWobble(machine, now);
      if (machine.spin.wobbleAmp && !wobble) machine.spin.wobbleAmp = 0;
    }
  }
  if (machine.stunUntil && now >= machine.stunUntil) machine.stunUntil = 0;
  if (machine.phase === 'IDLE' && machine.heat > 0) {
    const decay = MACHINE.heat.decayPerSecIdle * heatDecayMult * (dtMs / 1000);
    machine.heat = Math.max(0, machine.heat - decay);
  }
  machine.lastTickAt = now;
  return events;
}

export function applyMachineEffect(machine, kind, now) {
  const events = [];
  if (kind === 'JOLT' || kind === 'SPLASH') {
    const duration = kind === 'JOLT' ? 2000 : 3000;
    machine.effects.push({ kind, until: now + duration });
    if (machine.spin && !machine.spin.wobbleAmp) {
      machine.spin.wobbleAmp = MACHINE.wobblePerReel;
      events.push({
        event: 'MACHINE_SPIN_UPDATE',
        payload: {
          stationId: machine.stationId,
          spin: publicSpin(machine),
          cause: kind,
        },
      });
    }
  } else if (kind === 'DING') {
    machine.stunUntil = Math.max(machine.stunUntil, now + 600);
    machine.heat = Math.min(MACHINE.heat.overbrewAt, machine.heat + 5);
    events.push({
      event: 'MACHINE_STUN',
      payload: {
        stationId: machine.stationId,
        playerId: machine.controllerId,
        stunUntil: machine.stunUntil,
        heat: machine.heat,
      },
    });
  } else if (kind === 'COIN') {
    if (machine.combo > 0) {
      machine.combo = 0;
      events.push({
        event: 'MACHINE_COMBO_BREAK',
        payload: { stationId: machine.stationId, playerId: machine.controllerId, combo: 0 },
      });
    }
  } else if (kind === 'COOL') {
    machine.heat = Math.max(0, machine.heat - MACHINE.heat.coolFromCooler);
    events.push({
      event: 'MACHINE_HEAT_CHANGED',
      payload: { stationId: machine.stationId, playerId: machine.controllerId, heat: machine.heat, cause: 'COOLER' },
    });
  } else if (kind === 'CLEAN') {
    machine.effects = [];
    machine.stunUntil = 0;
    if (machine.spin) machine.spin.wobbleAmp = 0;
    events.push({
      event: 'MACHINE_CLEANED',
      payload: { stationId: machine.stationId, playerId: machine.controllerId },
    });
  }
  return events;
}

export function startChallenge(machine, opponentId, now, durationMs, startHeat) {
  if (machine.challenge) return { ok: false, code: 'INVALID_ACTION' };
  if (machine.practice) return { ok: false, code: 'INVALID_ACTION' };
  machine.challenge = {
    opponentId,
    endsAt: now + durationMs,
    score: 0,
    saved: { score: machine.score, combo: machine.combo, heat: machine.heat, phase: machine.phase },
  };
  machine.mode = 'CHALLENGE';
  machine.phase = 'IDLE';
  machine.spin = null;
  machine.activeReel = -1;
  machine.score = 0;
  machine.combo = 0;
  machine.heat = startHeat;
  machine.holds = [false, false, false];
  for (const reel of machine.reels) {
    reel.stopped = true;
    reel.quality = null;
    reel.held = false;
    reel.angle = 0;
  }
  return { ok: true };
}

export function endChallenge(machine) {
  if (!machine.challenge) return null;
  const challenge = machine.challenge;
  const earned = challenge.score;
  machine.challenge = null;
  machine.mode = 'LIVE';
  machine.phase = 'IDLE';
  machine.spin = null;
  machine.activeReel = -1;
  machine.combo = challenge.saved.combo;
  machine.heat = challenge.saved.heat;
  machine.score = challenge.saved.score + earned;
  machine.holds = [false, false, false];
  for (const reel of machine.reels) {
    reel.stopped = true;
    reel.quality = null;
    reel.held = false;
    reel.angle = 0;
  }
  return { earned, finalScore: machine.score };
}

export function startPractice(machine, now) {
  if (machine.phase === 'SPINNING' || machine.phase === 'OVERBREW') return { ok: false, code: 'INVALID_ACTION' };
  machine.practice = { score: 0, startedAt: now };
  machine.mode = 'PRACTICE';
  return { ok: true };
}

export function stopPractice(machine) {
  const score = machine.practice ? machine.practice.score : 0;
  machine.practice = null;
  machine.mode = machine.challenge ? 'CHALLENGE' : 'LIVE';
  return { score };
}

export function machineSnapshot(machine, now) {
  return {
    stationId: machine.stationId,
    ownerId: machine.ownerId,
    controllerId: machine.controllerId,
    mode: machine.mode,
    phase: machine.phase,
    score: currentScore(machine),
    sessionScore: machine.score,
    combo: machine.combo,
    maxCombo: machine.maxCombo,
    heat: Math.round(machine.heat * 10) / 10,
    tier: heatTier(machine.heat),
    holds: machine.holds.slice(),
    activeReel: machine.activeReel,
    round: machine.round,
    stunUntil: machine.stunUntil,
    overbrewDeadline: machine.overbrewDeadline,
    spin: publicSpin(machine),
    reels: machine.reels.map((reel) => ({
      i: reel.index,
      angle: Math.round(reel.angle * 100) / 100,
      stopped: reel.stopped,
      quality: reel.quality,
      held: reel.held,
    })),
    effects: activeMachineEffects(machine, now).map((effect) => ({ kind: effect.kind, until: effect.until })),
    challenge: machine.challenge
      ? {
          opponentId: machine.challenge.opponentId,
          endsAt: machine.challenge.endsAt,
          score: machine.challenge.score,
        }
      : null,
    practice: machine.practice ? { score: machine.practice.score } : null,
    stats: { ...machine.stats },
  };
}

export function machineInputAllowed(machine, now) {
  if (machine.stunUntil > now) return false;
  return true;
}
