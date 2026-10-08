import {
  ROOM,
  WORLD,
  STATE_BROADCAST_EVERY,
  TICK_MS,
  CHALLENGE,
  ROOM_EVENTS,
} from '../../shared/constants.js';
import { S2C } from '../../shared/protocol.js';
import { buildWorld, applyMovement } from '../game/world.js';
import {
  createMachine,
  machineTick,
  machineSnapshot,
  releaseMachine,
  endChallenge,
} from '../game/machine.js';
import { updateMischief } from '../game/sabotage.js';
import { markDirty, playerPublic, isOnline } from './player.js';

const LEAVE_TRANSIENT_MS = 1500;
const READY_TO_PLAY_MS = 800;

export class Room {
  constructor({ id, code, name, maxPlayers, config, logger, metrics, hooks = {} }) {
    this.id = id;
    this.code = code;
    this.name = name;
    this.maxPlayers = maxPlayers;
    this.config = config;
    this.logger = logger;
    this.metrics = metrics;
    this.hooks = hooks;
    this.createdAt = Date.now();
    this.lastActivityAt = Date.now();
    this.players = new Map();
    this.hostId = null;
    this.phase = 'LOBBY';
    this.basePhase = 'LOBBY';
    this.transientPhase = null;
    this.leaveTransientUntil = 0;
    this.matchStarted = false;
    this.readySince = 0;
    this.phaseChangedAt = Date.now();
    this.tick = 0;
    this.seq = 0;
    this.interactionSeq = 0;
    this.lastTickAt = 0;
    this.stateCounter = 0;
    this.dirty = new Set();
    this.areasDirty = false;
    this.pending = new Map();
    this.social = {
      spectating: new Map(),
      pairs: new Map(),
      challenges: new Map(),
      takeovers: new Map(),
    };
    this.areaEffects = [];
    this.world = buildWorld(maxPlayers);
    for (const station of this.world.stations) {
      station.machine = createMachine(station.id, (Math.random() * 0xffffffff) >>> 0);
    }
    this.activeEvent = null;
    this.nextRoomEventAt = this.createdAt + randomBetween(ROOM.eventMinGapMs, ROOM.eventMaxGapMs);
    this.stats = { joins: 0, leaves: 0, reconnects: 0, messages: 0 };
    this.spawnCursor = 0;
  }

  nextInteractionId() {
    this.interactionSeq += 1;
    return `i${this.interactionSeq}`;
  }

  get playerCount() {
    return this.players.size;
  }

  get onlineCount() {
    let n = 0;
    for (const player of this.players.values()) if (player.status === 'ONLINE') n += 1;
    return n;
  }

  getPlayer(id) {
    return this.players.get(id) || null;
  }

  stationById(stationId) {
    return this.world.stations[stationId] || null;
  }

  stationForPlayer(playerId) {
    const player = this.players.get(playerId);
    if (!player || player.stationId === null) return null;
    return this.stationById(player.stationId);
  }

  stationMachineFor(playerId) {
    const station = this.stationForPlayer(playerId);
    return station ? station.machine : null;
  }

  markPlayerDirty(player) {
    markDirty(player);
    this.dirty.add(player.id);
  }

  markAreasDirty() {
    this.areasDirty = true;
  }

  applyPhase(reason = '') {
    const next = this.transientPhase || this.basePhase;
    if (this.phase === next) return false;
    const previous = this.phase;
    this.phase = next;
    this.phaseChangedAt = Date.now();
    this.broadcastEvent('ROOM_PHASE', { phase: next, previous, reason, at: this.phaseChangedAt });
    return true;
  }

  updatePhase(reason = '') {
    const now = Date.now();
    if (this.players.size === 0) this.transientPhase = 'CLOSING';
    else if (this.social.challenges.size > 0 || this.social.pairs.size > 0) this.transientPhase = 'ACTIVE_SOCIAL_STATE';
    else if (now < this.leaveTransientUntil) this.transientPhase = 'PLAYER_LEAVES';
    else this.transientPhase = null;

    if (this.players.size === 0) {
      this.basePhase = 'LOBBY';
      this.matchStarted = false;
      this.readySince = 0;
    } else if (this.matchStarted) {
      this.basePhase = 'PLAYING';
    } else {
      const online = [...this.players.values()].filter((p) => p.status === 'ONLINE');
      const allReady = online.length > 0 && online.every((p) => p.ready);
      const enough = this.players.size >= Math.min(this.maxPlayers, 2);
      if (!allReady || !enough) {
        this.readySince = 0;
        this.basePhase = 'ROOM_JOINED';
      } else {
        if (!this.readySince) this.readySince = now;
        if (now - this.readySince >= READY_TO_PLAY_MS) {
          this.matchStarted = true;
          this.basePhase = 'PLAYING';
        } else {
          this.basePhase = 'READY';
        }
      }
    }
    return this.applyPhase(reason);
  }

  startMatch(reason = 'host start') {
    if (this.players.size === 0) return false;
    this.matchStarted = true;
    return this.updatePhase(reason);
  }

  addPlayer(player) {
    if (this.players.has(player.id)) return { ok: false, code: 'ALREADY_IN_ROOM' };
    if (this.players.size >= this.maxPlayers) return { ok: false, code: 'ROOM_FULL' };
    const station = this.world.stations.find((s) => s.assignedTo === null && s.occupiedBy === null);
    player.stationId = null;
    player.host = this.hostId === null;
    if (!this.hostId) this.hostId = player.id;
    if (station) {
      station.assignedTo = player.id;
      player.x = station.approachX;
      player.z = station.approachZ + 0.8;
      player.facing = -Math.PI / 2;
    } else {
      const spawn = this.world.spawnPoints[this.spawnCursor % this.world.spawnPoints.length];
      this.spawnCursor += 1;
      player.x = spawn.x;
      player.z = spawn.z;
    }
    player.stationIndex = station ? station.id : -1;
    this.players.set(player.id, player);
    this.stats.joins += 1;
    this.lastActivityAt = Date.now();
    this.markPlayerDirty(player);
    this.updatePhase('player joined');
    this.broadcastEvent('PLAYER_JOINED', { player: playerPublic(player), phase: this.phase, stationIndex: player.stationIndex }, player.id);
    this.logger?.info('room player joined', {
      roomId: this.id,
      playerId: player.id,
      players: this.players.size,
    });
    return { ok: true, stationIndex: player.stationIndex };
  }

  isStationReserved(stationId) {
    for (const pending of this.pending.values()) {
      if (pending.kind === 'TAKEOVER_REQUEST' && pending.toStationId === stationId) return true;
    }
    return false;
  }

  removePlayer(playerId, reason = 'leave') {
    const player = this.players.get(playerId);
    if (!player) return null;
    this.detachPlayerFromWorld(player);
    for (const station of this.world.stations) {
      if (station.assignedTo === playerId) station.assignedTo = null;
    }
    this.players.delete(playerId);
    this.stats.leaves += 1;
    this.lastActivityAt = Date.now();
    if (this.hostId === playerId) {
      this.hostId = null;
      const next = [...this.players.values()].sort((a, b) => a.joinedAt - b.joinedAt)[0];
      if (next) {
        next.host = true;
        this.hostId = next.id;
      }
    }
    this.leaveTransientUntil = Date.now() + LEAVE_TRANSIENT_MS;
    this.updatePhase(reason);
    this.broadcastEvent('PLAYER_LEFT', { playerId, reason, phase: this.phase });
    this.logger?.info('room player left', { roomId: this.id, playerId, reason, players: this.players.size });
    if (this.players.size === 0 && this.hooks.onEmpty) this.hooks.onEmpty(this);
    return player;
  }

  detachPlayerFromWorld(player) {
    for (const station of this.world.stations) {
      const machine = station.machine;
      if (station.occupiedBy === player.id) station.occupiedBy = null;
      if (machine.ownerId === player.id) {
        this.harvestMachine(player, machine);
        releaseMachine(machine);
      }
    }
    player.stationId = null;
    for (const [viewerId, targetId] of this.social.spectating) {
      if (viewerId === player.id) this.social.spectating.delete(viewerId);
      if (targetId === player.id) this.social.spectating.delete(viewerId);
    }
    for (const [id, pair] of this.social.pairs) {
      if (pair.teacherId === player.id || pair.studentId === player.id) this.social.pairs.delete(id);
    }
    for (const [id, challenge] of this.social.challenges) {
      if (challenge.a === player.id || challenge.b === player.id) this.social.challenges.delete(id);
    }
    for (const [stationId, takeover] of this.social.takeovers) {
      if (takeover.byId === player.id) {
        const station = this.stationById(stationId);
        if (station) station.machine.controllerId = takeover.ownerId;
        this.social.takeovers.delete(stationId);
      }
    }
    for (const [id, pending] of this.pending) {
      if (pending.fromId === player.id || pending.toId === player.id) this.pending.delete(id);
    }
  }

  harvestMachine(player, machine) {
    if (!machine || machine.mode !== 'LIVE') return;
    const stats = player.stats;
    stats.score = Math.max(stats.score, machine.score);
    stats.stops += machine.stats.stops;
    stats.perfects += machine.stats.perfects;
    stats.good += machine.stats.good;
    stats.ok += machine.stats.ok;
    stats.misses += machine.stats.misses;
    stats.rounds += machine.stats.rounds;
    stats.maxCombo = Math.max(stats.maxCombo, machine.stats.maxCombo, machine.maxCombo);
    stats.heatPeak = Math.max(stats.heatPeak, machine.stats.heatPeak);
    stats.overbrewSuccess += machine.stats.overbrewSuccess;
    stats.overbrewFail += machine.stats.overbrewFail;
  }

  attachPlayer(player, connection) {
    player.connection = connection;
    player.connectionId = connection ? connection.id : null;
    player.status = 'ONLINE';
    player.rejoined = true;
    player.disconnectedAt = 0;
    if (player.stationId !== null) {
      const station = this.stationById(player.stationId);
      if (station) station.occupiedBy = player.id;
    }
    this.lastActivityAt = Date.now();
    this.markPlayerDirty(player);
    this.updatePhase();
    this.broadcastEvent('PLAYER_RECONNECTED', { playerId: player.id }, player.id);
  }

  snapshot(playerId = null) {
    const now = Date.now();
    const machines = this.world.stations.map((station) => machineSnapshot(station.machine, now));
    return {
      room: {
        id: this.id,
        code: this.code,
        name: this.name,
        maxPlayers: this.maxPlayers,
        phase: this.phase,
        createdAt: this.createdAt,
        lastActivityAt: this.lastActivityAt,
        tick: this.tick,
        serverTime: now,
        activeEvent: this.activeEvent,
        world: {
          width: WORLD.width,
          depth: WORLD.depth,
          stations: this.world.stations.map((s) => ({
            id: s.id,
            x: s.x,
            machineZ: s.machineZ,
            standX: s.standX,
            standZ: s.standZ,
            approachX: s.approachX,
            approachZ: s.approachZ,
            facing: s.facing,
            assignedTo: s.assignedTo,
            occupiedBy: s.occupiedBy,
          })),
          obstacles: this.world.obstacles,
        },
      },
      players: [...this.players.values()].map((p) => playerPublic(p, now)),
      machines,
      areas: this.areaEffects.map((area) => ({ ...area })),
      pending: [...this.pending.values()].map((p) => publicPending(p, now)),
      social: {
        spectating: [...this.social.spectating.entries()].map(([viewerId, targetId]) => ({ viewerId, targetId })),
        pairs: [...this.social.pairs.values()],
        challenges: [...this.social.challenges.values()].map((c) => ({
          id: c.id,
          a: c.a,
          b: c.b,
          endsAt: c.endsAt,
          scoreA: c.scoreA,
          scoreB: c.scoreB,
        })),
        takeovers: [...this.social.takeovers.values()].map((t) => ({ ...t })),
      },
      self: playerId ? this.whoAmI(playerId, now) : null,
    };
  }

  whoAmI(playerId, now) {
    const player = this.players.get(playerId);
    if (!player) return null;
    return {
      id: player.id,
      stationId: player.stationId,
      host: player.host,
      ready: player.ready,
      mischief: Math.floor(player.mischief),
      cooldowns: cooldownMap(player, now),
      stats: { ...player.stats },
      pendingFrom: [...player.pendingFrom],
      pendingTo: [...player.pendingTo],
      challengeCooldownUntil: player.challengeCooldownUntil,
    };
  }

  broadcastEvent(event, payload, exceptPlayerId = null) {
    this.seq += 1;
    const message = { type: S2C.ROOM_EVENT, roomSequence: this.seq, event, payload, serverTime: Date.now() };
    for (const player of this.players.values()) {
      if (player.id === exceptPlayerId) continue;
      if (!isOnline(player)) continue;
      player.connection.send(message);
    }
  }

  sendTo(playerId, message) {
    const player = this.players.get(playerId);
    if (!player || !isOnline(player)) return false;
    return player.connection.send(message);
  }

  sendState() {
    if (this.dirty.size === 0 && !this.areasDirty) return;
    this.seq += 1;
    this.stateCounter += 1;
    const now = Date.now();
    const players = [];
    for (const id of this.dirty) {
      const player = this.players.get(id);
      if (player) players.push(playerPublic(player, now));
    }
    const payload = { players };
    if (this.areasDirty) {
      payload.areas = this.areaEffects.map((area) => ({ ...area }));
      this.areasDirty = false;
    }
    this.dirty.clear();
    const message = {
      type: S2C.ROOM_STATE,
      roomSequence: this.seq,
      tick: this.tick,
      serverTime: now,
      payload,
    };
    for (const player of this.players.values()) {
      if (!isOnline(player)) continue;
      player.connection.sendLowPriority(message);
    }
  }

  touch(player) {
    this.lastActivityAt = Date.now();
    if (player) player.lastSeenAt = Date.now();
  }

  sendMischief(player, now) {
    const value = Math.floor(player.mischief);
    if (value === player.lastMischiefSync) return;
    player.lastMischiefSync = value;
    this.seq += 1;
    player.connection.send({
      type: S2C.ROOM_EVENT,
      roomSequence: this.seq,
      event: 'MISCHIEF_CHANGED',
      payload: { playerId: player.id, mischief: value },
      serverTime: now,
    });
  }

  scheduleRoomEvent(now) {
    if (this.phase !== 'PLAYING' && this.phase !== 'ACTIVE_SOCIAL_STATE') return;
    if (this.activeEvent) {
      if (now >= this.activeEvent.endsAt) {
        const kind = this.activeEvent.kind;
        this.activeEvent = null;
        this.broadcastEvent('ROOM_EVENT_END', { kind, serverTime: now });
        this.nextRoomEventAt = now + randomBetween(ROOM.eventMinGapMs, ROOM.eventMaxGapMs);
      }
      return;
    }
    if (now < this.nextRoomEventAt) return;
    const kinds = Object.keys(ROOM_EVENTS);
    const kind = kinds[Math.floor(Math.random() * kinds.length)];
    this.activeEvent = { kind, startedAt: now, endsAt: now + ROOM.eventDurationMs, ...ROOM_EVENTS[kind] };
    for (const player of this.players.values()) player.stats.roomEvents += 1;
    this.broadcastEvent('ROOM_EVENT_START', {
      kind,
      endsAt: this.activeEvent.endsAt,
      serverTime: now,
      ...ROOM_EVENTS[kind],
    });
    this.metrics?.inc('room_events_total', { kind });
  }

  scoreMultiplier() {
    return this.activeEvent ? this.activeEvent.scoreMult : 1;
  }

  heatDecayMultiplier() {
    return this.activeEvent ? this.activeEvent.heatDecayMult || 1 : 1;
  }

  expirePending(now) {
    for (const [id, pending] of this.pending) {
      if (now < pending.expiresAt) continue;
      this.pending.delete(id);
      const from = this.players.get(pending.fromId);
      const to = this.players.get(pending.toId);
      if (from) from.pendingTo.delete(id);
      if (to) to.pendingFrom.delete(id);
      this.broadcastEvent('INTERACTION_EXPIRED', { pendingId: id, kind: pending.kind });
    }
  }

  expireSocial(now) {
    for (const [id, challenge] of this.social.challenges) {
      if (now < challenge.endsAt) continue;
      this.social.challenges.delete(id);
      this.finishChallenge(challenge, now);
      this.updatePhase();
    }
    for (const [stationId, takeover] of this.social.takeovers) {
      if (now < takeover.until) continue;
      this.social.takeovers.delete(stationId);
      const station = this.stationById(stationId);
      if (station) {
        station.machine.controllerId = takeover.ownerId;
        this.broadcastEvent('TAKEOVER_ENDED', { stationId, ownerId: takeover.ownerId, byId: takeover.byId });
        this.sendStationMachineState(
          stationId,
          [takeover.ownerId, takeover.byId, ...this.spectatorsOf(takeover.ownerId)],
        );
      }
      this.updatePhase();
    }
  }

  finishChallenge(challenge, now) {
    const stationA = this.stationForPlayer(challenge.a);
    const stationB = this.stationForPlayer(challenge.b);
    const machineA = stationA ? stationA.machine : null;
    const machineB = stationB ? stationB.machine : null;
    const scoreA = machineA && machineA.challenge ? machineA.challenge.score : 0;
    const scoreB = machineB && machineB.challenge ? machineB.challenge.score : 0;
    if (machineA) endChallenge(machineA);
    if (machineB) endChallenge(machineB);
    let winner = null;
    if (scoreA > scoreB) winner = challenge.a;
    else if (scoreB > scoreA) winner = challenge.b;
    const a = this.players.get(challenge.a);
    const b = this.players.get(challenge.b);
    for (const player of [a, b]) {
      if (!player) continue;
      player.challengeCooldownUntil = now + CHALLENGE.cooldownMs;
      player.stats.challengesPlayed += 1;
      if (winner === player.id) player.stats.challengesWon += 1;
      this.sendMachineState(player.id);
    }
    this.broadcastEvent('CHALLENGE_RESULT', {
      challengeId: challenge.id,
      a: challenge.a,
      b: challenge.b,
      scoreA,
      scoreB,
      winner,
      endsAt: now,
    });
    this.metrics?.inc('challenges_completed_total');
  }

  spectatorsOf(targetId) {
    const out = [];
    for (const [viewerId, target] of this.social.spectating) {
      if (target === targetId) out.push(viewerId);
    }
    return out;
  }

  sendStationMachineState(stationId, recipients) {
    const station = this.stationById(stationId);
    if (!station) return;
    const payload = machineSnapshot(station.machine, Date.now());
    this.seq += 1;
    const message = {
      type: S2C.ROOM_EVENT,
      roomSequence: this.seq,
      event: 'MACHINE_SYNC',
      payload,
      serverTime: Date.now(),
    };
    for (const id of new Set(recipients.filter(Boolean))) this.sendTo(id, message);
  }

  sendMachineState(playerId) {
    const station = this.stationForPlayer(playerId);
    if (!station) return;
    this.sendStationMachineState(station.id, [
      playerId,
      station.machine.controllerId,
      ...this.spectatorsOf(playerId),
    ]);
  }

  expireDisconnected(now) {
    for (const player of this.players.values()) {
      if (player.status !== 'DISCONNECTED') continue;
      if (now - player.disconnectedAt < this.config.rooms.reconnectGraceMs) continue;
      this.removePlayer(player.id, 'reconnect grace expired');
    }
  }

  sweepIdle(now) {
    for (const player of this.players.values()) {
      if (player.status !== 'ONLINE') continue;
      if (now - player.lastSeenAt < this.config.rooms.idleTimeoutMs) continue;
      this.logger?.info('player idle timeout', { roomId: this.id, playerId: player.id });
      player.status = 'DISCONNECTED';
      player.disconnectedAt = now;
      player.connection.close('idle timeout');
    }
  }

  tickLoop(now) {
    const dt = this.lastTickAt ? Math.min(now - this.lastTickAt, 250) : TICK_MS;
    this.lastTickAt = now;
    this.tick += 1;
    const events = [];

    for (const player of this.players.values()) {
      if (player.status !== 'ONLINE') continue;
      const result = applyMovement(player, player.intent, dt, this.world, now);
      if (result.moved) {
        player.stats.distanceWalked += result.distance;
        this.markPlayerDirty(player);
      } else if (player.anim === 'WALK') {
        player.anim = 'IDLE';
        this.markPlayerDirty(player);
      }
      if (player.emote && player.emoteUntil <= now) {
        player.emote = null;
        this.markPlayerDirty(player);
      }
      if (player.effects.length) {
        const before = player.effects.length;
        player.effects = player.effects.filter((effect) => effect.until > now);
        if (player.effects.length !== before) this.markPlayerDirty(player);
      }
      const regen = updateMischief(player, now, dt);
      if (regen) this.sendMischief(player, now);
    }

    const heatDecayMult = this.heatDecayMultiplier();
    for (const station of this.world.stations) {
      const machine = station.machine;
      if (!machine.ownerId) continue;
      const machineEvents = machineTick(machine, now, dt, { heatDecayMult });
      events.push(...machineEvents);
    }

    if (this.areaEffects.length) {
      const before = this.areaEffects.length;
      this.areaEffects = this.areaEffects.filter((area) => area.until > now);
      if (this.areaEffects.length !== before) this.markAreasDirty();
    }

    this.expirePending(now);
    this.expireSocial(now);
    this.expireDisconnected(now);
    this.sweepIdle(now);
    this.scheduleRoomEvent(now);
    this.updatePhase();

    for (const event of events) this.broadcastEvent(event.event, event.payload);
    if (this.tick % STATE_BROADCAST_EVERY === 0) this.sendState();
    this.metrics?.observe('room_tick_ms', Date.now() - now);
  }

  summary() {
    return {
      id: this.id,
      code: this.code,
      name: this.name,
      players: this.players.size,
      maxPlayers: this.maxPlayers,
      phase: this.phase,
      createdAt: this.createdAt,
      lastActivityAt: this.lastActivityAt,
    };
  }

  destroy() {
    this.players.clear();
    this.pending.clear();
    this.social.spectating.clear();
    this.social.pairs.clear();
    this.social.challenges.clear();
    this.social.takeovers.clear();
  }
}

function publicPending(pending, now) {
  return {
    id: pending.id,
    kind: pending.kind,
    fromId: pending.fromId,
    toId: pending.toId,
    fromName: pending.fromName,
    toName: pending.toName,
    expiresAt: pending.expiresAt,
    meta: pending.meta || {},
    remaining: Math.max(0, pending.expiresAt - now),
  };
}

function cooldownMap(player, now) {
  const out = {};
  for (const [action, until] of Object.entries(player.sabotageCooldowns)) {
    if (until > now) out[action] = until;
  }
  return out;
}

function randomBetween(min, max) {
  return Math.floor(min + Math.random() * (max - min));
}
