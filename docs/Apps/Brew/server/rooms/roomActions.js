import { ERROR_CODES, S2C } from '../../shared/protocol.js';
import { STATION, CHALLENGE } from '../../shared/constants.js';
import { nearestStation, nearStation } from '../game/world.js';
import {
  startSpin,
  stopReel,
  toggleHold,
  releaseOverbrew,
  resetMachineForOwner,
  startChallenge,
  startPractice,
  stopPractice,
  machineSnapshot,
} from '../game/machine.js';
import { resolveSabotage } from '../game/sabotage.js';
import { newPendingId } from './player.js';
import { dist2 } from '../util/ids.js';

function fail(code) {
  return { ok: false, code };
}

function syncScore(player, machine) {
  if (machine.challenge || machine.practice) return;
  player.stats.score = machine.score;
}

function emit(room, result) {
  const events = Array.isArray(result)
    ? result
    : [result?.event, ...(result?.events || [])].filter(Boolean);
  for (const event of events) room.broadcastEvent(event.event, event.payload);
}

function controllerStation(room, player) {
  if (player.stationId !== null) {
    const station = room.stationById(player.stationId);
    if (station && station.machine.controllerId === player.id) return station;
  }
  for (const station of room.world.stations) {
    if (station.machine.controllerId === player.id) return station;
  }
  return null;
}

export function handleMove(room, player, payload) {
  if (player.status !== 'ONLINE') return fail(ERROR_CODES.FORBIDDEN);
  if (player.stationId !== null) return fail(ERROR_CODES.INVALID_ACTION);
  let dx = payload.dx;
  let dz = payload.dz;
  const mag = Math.hypot(dx, dz);
  if (mag > 1) {
    dx /= mag;
    dz /= mag;
  }
  player.intent = { dx, dz };
  if (mag > 0.01 && player.anim !== 'WALK') {
    player.anim = 'WALK';
    room.markPlayerDirty(player);
  }
  return { ok: true, quiet: true };
}

export function handleMount(room, player, payload) {
  if (player.stationId !== null) return fail(ERROR_CODES.INVALID_ACTION);
  let station = null;
  if (payload.stationId !== undefined) {
    station = room.stationById(payload.stationId);
    if (!station) return fail(ERROR_CODES.INVALID_TARGET);
  } else if (player.stationIndex >= 0) {
    station = room.stationById(player.stationIndex);
  } else {
    station = nearestStation(player, room.world, STATION.interactionRange + 2);
  }
  if (!station) return fail(ERROR_CODES.INVALID_TARGET);
  if (station.assignedTo !== null && station.assignedTo !== player.id) {
    return fail(ERROR_CODES.NOT_AUTHORIZED);
  }
  if (station.occupiedBy && station.occupiedBy !== player.id) {
    return fail(ERROR_CODES.STATION_OCCUPIED);
  }
  if (!nearStation(player, station, STATION.interactionRange + 1.5)) {
    return fail(ERROR_CODES.OUT_OF_RANGE);
  }

  player.stationId = station.id;
  station.occupiedBy = player.id;
  player.intent = { dx: 0, dz: 0 };
  player.x = station.standX;
  player.z = station.standZ;
  player.facing = station.facing;
  player.anim = 'USING';
  player.moving = false;
  const machine = station.machine;
  if (machine.ownerId !== player.id) resetMachineForOwner(machine, player.id);
  machine.controllerId = player.id;
  room.markPlayerDirty(player);
  room.broadcastEvent('STATION_MOUNTED', {
    stationId: station.id,
    playerId: player.id,
    machine: machineSnapshot(machine, Date.now()),
  });
  return { ok: true };
}

export function handleDismount(room, player) {
  if (player.stationId === null) return fail(ERROR_CODES.INVALID_ACTION);
  const station = room.stationById(player.stationId);
  player.stationId = null;
  if (station && station.occupiedBy === player.id) station.occupiedBy = null;
  player.x = station ? station.approachX : player.x;
  player.z = station ? station.approachZ : player.z + 1.1;
  player.facing = Math.PI / 2;
  player.anim = 'IDLE';
  room.markPlayerDirty(player);
  room.broadcastEvent('STATION_DISMOUNTED', { stationId: station ? station.id : -1, playerId: player.id });
  return { ok: true };
}

export function handleMachineInput(room, player, payload, latencyMs) {
  const station = controllerStation(room, player);
  if (!station) return fail(ERROR_CODES.NOT_IN_ROOM);
  const machine = station.machine;
  if (machine.controllerId !== player.id) return fail(ERROR_CODES.NOT_AUTHORIZED);
  const now = Date.now();
  const roomScoreMult = room.scoreMultiplier();
  let result;
  switch (payload.action) {
    case 'SPIN':
      result = startSpin(machine, now, { roomScoreMult });
      break;
    case 'STOP':
      result = stopReel(machine, now, { latencyMs, roomScoreMult });
      break;
    case 'HOLD':
      result = toggleHold(machine, payload.reel, payload.hold);
      break;
    case 'RELEASE':
      result = releaseOverbrew(machine, now, { roomScoreMult });
      break;
    default:
      return fail(ERROR_CODES.INVALID_ACTION);
  }
  if (!result.ok) return result;
  syncScore(player, machine);
  emit(room, result);
  if (payload.action !== 'HOLD') room.sendMachineState(player.id);
  return { ok: true, result };
}

export function handleSabotage(room, player, payload) {
  const result = resolveSabotage({ room, sender: player, payload, now: Date.now() });
  if (!result.ok) return result;
  room.markPlayerDirty(player);
  if (result.target && result.target.id !== player.id) room.markPlayerDirty(result.target);
  emit(room, result);
  room.metrics?.inc('sabotage_total', { action: payload.action });
  return { ok: true };
}

export function handleReaction(room, player, payload) {
  player.emote = payload.emote;
  player.emoteUntil = Date.now() + 1800;
  room.markPlayerDirty(player);
  return { ok: true, quiet: true };
}

export function handleChat(room, player, payload) {
  const text = sanitizeText(payload.text);
  if (!text) return fail(ERROR_CODES.INVALID_PAYLOAD);
  const now = Date.now();
  player.chatBurst = player.chatBurst.filter((t) => now - t < 10000);
  if (player.chatBurst.length >= 5) return fail(ERROR_CODES.RATE_LIMITED);
  player.chatBurst.push(now);
  room.broadcastEvent('CHAT', { playerId: player.id, name: player.displayName, text, at: now });
  return { ok: true, quiet: true };
}

export function handleReady(room, player, payload) {
  player.ready = Boolean(payload.ready);
  room.markPlayerDirty(player);
  room.updatePhase('ready changed');
  room.broadcastEvent('PLAYER_READY', { playerId: player.id, ready: player.ready, phase: room.phase });
  return { ok: true };
}

export function handleStartMatch(room, player) {
  if (room.hostId !== player.id) return fail(ERROR_CODES.NOT_AUTHORIZED);
  if (room.players.size < 1) return fail(ERROR_CODES.NOT_READY);
  room.startMatch('host start');
  return { ok: true };
}

export function handleInteraction(room, player, payload, ctx = {}) {
  const now = Date.now();
  switch (payload.kind) {
    case 'SPECTATE':
      return startSpectate(room, player, payload);
    case 'STOP_SPECTATE':
      return stopSpectate(room, player, now);
    case 'RESPONSE':
      return respondInteraction(room, player, payload, now);
    case 'TEACH_REQUEST':
    case 'PRACTICE_REQUEST':
    case 'CHALLENGE_REQUEST':
    case 'TAKEOVER_REQUEST':
      return requestInteraction(room, player, payload, now, ctx);
    default:
      return fail(ERROR_CODES.INVALID_ACTION);
  }
}

function startSpectate(room, player, payload) {
  const target = room.getPlayer(payload.targetPlayerId);
  if (!target) return fail(ERROR_CODES.INVALID_TARGET);
  if (target.id === player.id) return fail(ERROR_CODES.INVALID_TARGET);
  if (target.stationId === null) return fail(ERROR_CODES.STATION_EMPTY);
  const spectators = room.spectatorsOf(target.id);
  if (spectators.length >= CHALLENGE.maxSpectators) return fail(ERROR_CODES.SERVER_BUSY);
  room.social.spectating.set(player.id, target.id);
  player.spectatorOf = target.id;
  player.stats.spectated += 1;
  room.sendMachineState(target.id);
  room.broadcastEvent('SPECTATE_STARTED', { viewerId: player.id, targetId: target.id });
  return { ok: true, quiet: true };
}

function stopSpectate(room, player, now) {
  const targetId = room.social.spectating.get(player.id);
  room.social.spectating.delete(player.id);
  player.spectatorOf = null;
  for (const [id, pair] of room.social.pairs) {
    if (pair.studentId !== player.id && pair.teacherId !== player.id) continue;
    room.social.pairs.delete(id);
    const otherId = pair.studentId === player.id ? pair.teacherId : pair.studentId;
    const other = room.getPlayer(otherId);
    if (other && other.stationId !== null) {
      const otherStation = room.stationById(other.stationId);
      if (otherStation && !otherStation.machine.challenge) stopPractice(otherStation.machine, now);
    }
    room.broadcastEvent('PAIR_ENDED', { pairId: id, reason: 'stopped' });
    room.sendMachineState(otherId);
    room.updatePhase();
  }
  if (targetId) room.broadcastEvent('SPECTATE_STOPPED', { viewerId: player.id, targetId });
  return { ok: true, quiet: true };
}

function requestInteraction(room, player, payload, now, ctx) {
  const target = room.getPlayer(payload.targetPlayerId);
  if (!target) return fail(ERROR_CODES.INVALID_TARGET);
  if (target.id === player.id) return fail(ERROR_CODES.INVALID_TARGET);
  if (target.status !== 'ONLINE') return fail(ERROR_CODES.INVALID_TARGET);

  for (const pendingId of player.pendingTo) {
    const pending = room.pending.get(pendingId);
    if (pending && pending.toId === target.id && pending.kind === payload.kind) {
      return fail(ERROR_CODES.COOLDOWN);
    }
  }

  const meta = {};
  if (payload.kind === 'TEACH_REQUEST') {
    if (player.stationId === null) return fail(ERROR_CODES.NOT_IN_ROOM);
  } else if (payload.kind === 'PRACTICE_REQUEST') {
    if (target.stationId === null) return fail(ERROR_CODES.STATION_EMPTY);
  } else if (payload.kind === 'CHALLENGE_REQUEST') {
    if (player.stationId === null || target.stationId === null) return fail(ERROR_CODES.NOT_IN_ROOM);
    if (player.challengeCooldownUntil > now) return fail(ERROR_CODES.COOLDOWN);
    if (target.challengeCooldownUntil > now) return fail(ERROR_CODES.COOLDOWN);
    if (room.social.challenges.size >= 4) return fail(ERROR_CODES.SERVER_BUSY);
    for (const challenge of room.social.challenges.values()) {
      if (challenge.a === target.id || challenge.b === target.id) return fail(ERROR_CODES.INVALID_ACTION);
    }
  } else if (payload.kind === 'TAKEOVER_REQUEST') {
    if (target.stationId === null) return fail(ERROR_CODES.STATION_EMPTY);
    const station = room.stationById(target.stationId);
    if (!station) return fail(ERROR_CODES.STATION_EMPTY);
    if (room.social.takeovers.has(station.id)) return fail(ERROR_CODES.INVALID_ACTION);
    if (dist2(player.x, player.z, station.approachX, station.approachZ) > 4.5 * 4.5) {
      return fail(ERROR_CODES.OUT_OF_RANGE);
    }
    meta.toStationId = station.id;
  }

  const id = newPendingId();
  const timeout = ctx.interactionTimeoutMs || 20000;
  const pending = {
    id,
    kind: payload.kind,
    fromId: player.id,
    toId: target.id,
    fromName: player.displayName,
    toName: target.displayName,
    createdAt: now,
    expiresAt: now + timeout,
    meta,
  };
  room.pending.set(id, pending);
  player.pendingTo.add(id);
  target.pendingFrom.add(id);
  room.broadcastEvent('INTERACTION_REQUEST', {
    pendingId: id,
    kind: payload.kind,
    fromId: player.id,
    toId: target.id,
    fromName: player.displayName,
    expiresAt: pending.expiresAt,
    meta,
  });
  room.metrics?.inc('interaction_requests_total', { kind: payload.kind });
  return { ok: true, pendingId: id };
}

function respondInteraction(room, player, payload, now) {
  const pendingId = payload.pendingId || payload.targetPlayerId;
  const pending = room.pending.get(pendingId);
  if (!pending) return fail(ERROR_CODES.REQUEST_TIMEOUT);
  if (pending.toId !== player.id) return fail(ERROR_CODES.NOT_AUTHORIZED);
  room.pending.delete(pendingId);
  const from = room.getPlayer(pending.fromId);
  if (from) from.pendingTo.delete(pendingId);
  player.pendingFrom.delete(pendingId);

  if (payload.accept !== true) {
    room.broadcastEvent('INTERACTION_DECLINED', {
      pendingId,
      kind: pending.kind,
      fromId: pending.fromId,
      toId: pending.toId,
    });
    return { ok: true, pendingId };
  }

  switch (pending.kind) {
    case 'TEACH_REQUEST':
    case 'PRACTICE_REQUEST': {
      const teacherId = pending.kind === 'TEACH_REQUEST' ? pending.fromId : pending.toId;
      const studentId = pending.kind === 'TEACH_REQUEST' ? pending.toId : pending.fromId;
      const student = room.getPlayer(studentId);
      const teacher = room.getPlayer(teacherId);
      if (!student || !teacher) return fail(ERROR_CODES.INVALID_TARGET);
      if (student.stationId === null) return fail(ERROR_CODES.STATION_EMPTY);
      const station = room.stationById(student.stationId);
      if (!station) return fail(ERROR_CODES.STATION_EMPTY);
      const practice = startPractice(station.machine, now);
      if (!practice.ok) return practice;
      room.social.pairs.set(pendingId, {
        id: pendingId,
        kind: pending.kind,
        teacherId,
        studentId,
        startedAt: now,
      });
      const watcher = pending.kind === 'TEACH_REQUEST' ? studentId : teacherId;
      const watched = pending.kind === 'TEACH_REQUEST' ? teacherId : studentId;
      room.social.spectating.set(watcher, watched);
      room.getPlayer(watcher).spectatorOf = watched;
      room.sendMachineState(watched);
      room.broadcastEvent('PAIR_STARTED', {
        pairId: pendingId,
        kind: pending.kind,
        teacherId,
        studentId,
        startedAt: now,
      });
      room.sendMachineState(studentId);
      room.updatePhase('pair started');
      return { ok: true, pendingId };
    }
    case 'CHALLENGE_REQUEST': {
      const a = room.getPlayer(pending.fromId);
      const b = player;
      if (!a || !b) return fail(ERROR_CODES.INVALID_TARGET);
      const stationA = room.stationById(a.stationId);
      const stationB = room.stationById(b.stationId);
      if (!stationA || !stationB) return fail(ERROR_CODES.NOT_IN_ROOM);
      if (stationA.machine.phase !== 'IDLE' || stationB.machine.phase !== 'IDLE') {
        return fail(ERROR_CODES.INVALID_ACTION);
      }
      const started = startChallenge(stationA.machine, b.id, now, CHALLENGE.durationMs, CHALLENGE.startHeat);
      if (!started.ok) return started;
      startChallenge(stationB.machine, a.id, now, CHALLENGE.durationMs, CHALLENGE.startHeat);
      room.social.challenges.set(pendingId, {
        id: pendingId,
        a: a.id,
        b: b.id,
        startedAt: now,
        endsAt: now + CHALLENGE.durationMs,
        scoreA: 0,
        scoreB: 0,
      });
      a.stats.challengesPlayed += 1;
      b.stats.challengesPlayed += 1;
      room.broadcastEvent('CHALLENGE_STARTED', {
        challengeId: pendingId,
        a: a.id,
        b: b.id,
        endsAt: now + CHALLENGE.durationMs,
        startHeat: CHALLENGE.startHeat,
      });
      room.sendMachineState(a.id);
      room.sendMachineState(b.id);
      room.updatePhase('challenge started');
      return { ok: true, pendingId };
    }
    case 'TAKEOVER_REQUEST': {
      const stationId = pending.meta.toStationId;
      const station = room.stationById(stationId);
      if (!station) return fail(ERROR_CODES.STATION_EMPTY);
      const owner = room.getPlayer(station.assignedTo);
      if (!owner) return fail(ERROR_CODES.STATION_EMPTY);
      room.social.takeovers.set(stationId, {
        stationId,
        ownerId: owner.id,
        byId: pending.fromId,
        startedAt: now,
        until: now + CHALLENGE.takeoverDurationMs,
      });
      station.machine.controllerId = pending.fromId;
      room.broadcastEvent('TAKEOVER_STARTED', {
        stationId,
        ownerId: owner.id,
        byId: pending.fromId,
        until: now + CHALLENGE.takeoverDurationMs,
      });
      room.sendStationMachineState(stationId, [owner.id, pending.fromId]);
      return { ok: true, pendingId };
    }
    default:
      return fail(ERROR_CODES.INVALID_ACTION);
  }
}

export function handleStateSync(room, player) {
  room.sendTo(player.id, {
    type: S2C.ROOM_SNAPSHOT,
    roomSequence: room.seq,
    tick: room.tick,
    serverTime: Date.now(),
    payload: room.snapshot(player.id),
  });
  return { ok: true, quiet: true };
}

export function sanitizeText(text) {
  const source = String(text);
  let out = '';
  for (let i = 0; i < source.length; i += 1) {
    const code = source.charCodeAt(i);
    if (code < 32 || code === 127) continue;
    out += source[i];
  }
  return out.replace(/\s+/g, ' ').trim().slice(0, 160);
}

export { controllerStation, syncScore, emit };
