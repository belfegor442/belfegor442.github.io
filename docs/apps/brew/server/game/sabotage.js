import { SABOTAGE, EFFECTS, MISCHIEF } from '../../shared/constants.js';
import { ERROR_CODES } from '../../shared/protocol.js';
import { dist2 } from '../util/ids.js';
import { applyMachineEffect } from './machine.js';

export const SABOTAGE_EVENTS = {
  THROW_BEER: 'BEER_THROW',
  PEANUT: 'PEANUT_THROW',
  BELL: 'BELL_RING',
  SMOKE: 'SMOKE_DEPLOYED',
  COIN: 'COIN_TOSS',
  COOLER: 'COOLER_HIT',
  CLEAN: 'CLEANSED',
};

const LINGERING = new Set(['SPLASH', 'JOLT', 'DING']);

export function resolveSabotage({ room, sender, payload, now }) {
  const def = SABOTAGE[payload.action];
  if (!def) return { ok: false, code: ERROR_CODES.INVALID_ACTION };

  if (sender.sabotageCooldowns[payload.action] > now) {
    return { ok: false, code: ERROR_CODES.COOLDOWN };
  }
  if (sender.mischief < def.cost) {
    return { ok: false, code: ERROR_CODES.NOT_ENOUGH_MISCHIEF };
  }

  let target = sender;
  if (def.target === 'PLAYER') {
    target = room.getPlayer(payload.targetPlayerId);
    if (!target) return { ok: false, code: ERROR_CODES.INVALID_TARGET };
    if (target.id === sender.id) return { ok: false, code: ERROR_CODES.INVALID_TARGET };
    if (target.status === 'DISCONNECTED') return { ok: false, code: ERROR_CODES.INVALID_TARGET };
    const rangeSq = def.range * def.range;
    if (dist2(sender.x, sender.z, target.x, target.z) > rangeSq) {
      return { ok: false, code: ERROR_CODES.OUT_OF_RANGE };
    }
  }

  sender.mischief -= def.cost;
  sender.sabotageCooldowns[payload.action] = now + def.cooldownMs;
  sender.stats.sabotageThrown += 1;

  const events = [];
  const effectKind = def.effect;
  const effectDef = EFFECTS[effectKind];
  const durationMs = effectDef ? effectDef.durationMs : 0;

  if (LINGERING.has(effectKind) && durationMs > 0) {
    target.effects = target.effects.filter((effect) => effect.kind !== effectKind);
    target.effects.push({ kind: effectKind, until: now + durationMs, from: sender.id });
  }

  const machine = room.stationMachineFor(target.id);
  if (machine && (effectKind === 'JOLT' || effectKind === 'DING' || effectKind === 'COIN' || effectKind === 'COOL' || effectKind === 'CLEAN')) {
    events.push(...applyMachineEffect(machine, effectKind, now));
  }
  if (effectKind === 'CLEAN') {
    target.effects = [];
    target.stats.roomsCleaned = (target.stats.roomsCleaned || 0) + 1;
  }

  const hit = effectKind !== 'CLEAN';
  if (hit) sender.stats.sabotageHit += 1;

  if (effectKind === 'SMOKE') {
    room.areaEffects.push({
      id: `smoke_${room.seq}_${Math.floor(Math.random() * 1000)}`,
      kind: 'SMOKE_AREA',
      x: target.x,
      z: target.z,
      radius: EFFECTS.SMOKE_AREA.radius,
      until: now + EFFECTS.SMOKE_AREA.durationMs,
      ownerId: sender.id,
    });
  }

  events.push({
    event: SABOTAGE_EVENTS[payload.action],
    payload: {
      interactionId: `sab_${room.nextInteractionId()}`,
      action: payload.action,
      senderId: sender.id,
      senderName: sender.displayName,
      targetId: target.id,
      targetName: target.displayName,
      from: { x: sender.x, z: sender.z },
      to: { x: target.x, z: target.z },
      effect: effectKind,
      durationMs,
      cost: def.cost,
      tick: room.tick,
      serverTime: now,
    },
  });

  events.push({
    event: 'MISCHIEF_CHANGED',
    payload: { playerId: sender.id, mischief: Math.floor(sender.mischief) },
  });

  return { ok: true, events, target };
}

export function updateMischief(player, now, dtMs, regenPerSec = MISCHIEF.regenPerSec) {
  if (player.mischief >= MISCHIEF.max) return false;
  const before = player.mischief;
  player.mischief = Math.min(MISCHIEF.max, player.mischief + (regenPerSec * dtMs) / 1000);
  if (Math.floor(player.mischief) !== Math.floor(before)) return true;
  return false;
}
