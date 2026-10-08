import { Connection } from './net/connection.js';
import { decode, C2S, S2C, ERROR_CODES, ERROR_TEXT, makeError } from '../shared/protocol.js';
import { RATE_LIMITS, PROTOCOL_VERSION, TICK_RATE, MISCHIEF, WORLD } from '../shared/constants.js';
import * as actions from './rooms/roomActions.js';
import { evaluateAchievements, applyProgression, xpForLevel } from './game/achievements.js';

const RATE_CATEGORY = {
  [C2S.MOVE]: 'MOVE',
  [C2S.MACHINE_INPUT]: 'MACHINE_INPUT',
  [C2S.SABOTAGE]: 'SABOTAGE',
  [C2S.CHAT]: 'CHAT',
  [C2S.REACTION]: 'REACTION',
  [C2S.INTERACTION]: 'INTERACTION',
  [C2S.CREATE_ROOM]: 'CREATE_ROOM',
  [C2S.JOIN_ROOM]: 'JOIN_ROOM',
  [C2S.REQUEST_STATE_SYNC]: 'REQUEST_STATE_SYNC',
  [C2S.HELLO]: 'AUTH',
};

const REQUIRES_ROOM = new Set([
  C2S.LEAVE_ROOM,
  C2S.SET_READY,
  C2S.START_MATCH,
  C2S.MOVE,
  C2S.MOUNT_STATION,
  C2S.DISMOUNT,
  C2S.MACHINE_INPUT,
  C2S.INTERACTION,
  C2S.SABOTAGE,
  C2S.REACTION,
  C2S.CHAT,
  C2S.REQUEST_STATE_SYNC,
]);

export class GameServer {
  constructor({ config, logger, metrics, auth, store, roomManager }) {
    this.config = config;
    this.logger = logger;
    this.metrics = metrics;
    this.auth = auth;
    this.store = store;
    this.roomManager = roomManager;
    this.connections = new Set();
    this.sessions = new Map();
    this.startedAt = Date.now();
    this.messagesWindow = { count: 0, at: Date.now(), perSec: 0 };
    this.tickTimer = null;
    this.heartbeatTimer = null;
    this.metricTimer = null;
    this.shuttingDown = false;
  }

  start() {
    const tickMs = 1000 / this.config.net.tickRate;
    this.tickTimer = setInterval(() => this.tick(), tickMs);
    this.heartbeatTimer = setInterval(() => this.heartbeat(), 1000);
    this.metricTimer = setInterval(() => this.sampleMetrics(), 1000);
    for (const timer of [this.tickTimer, this.heartbeatTimer, this.metricTimer]) {
      if (typeof timer.unref === 'function') timer.unref();
    }
    this.logger.info('game server started', {
      tickRate: this.config.net.tickRate,
      maxRooms: this.config.rooms.maxRooms,
      profile: this.config.profile,
    });
  }

  tick() {
    const now = Date.now();
    this.roomManager.tickAll(now);
  }

  heartbeat() {
    const now = Date.now();
    for (const conn of this.connections) conn.heartbeat(now);
    this.metrics.set('connected_players', this.sessions.size);
    const summary = this.roomManager.summary();
    this.metrics.set('active_rooms', summary.rooms);
    this.metrics.set('room_players', summary.players);
  }

  sampleMetrics() {
    const now = Date.now();
    const window = this.messagesWindow;
    const elapsed = (now - window.at) / 1000;
    if (elapsed >= 1) {
      window.perSec = Math.round(window.count / elapsed);
      window.count = 0;
      window.at = now;
      this.metrics.set('messages_per_sec', window.perSec);
    }
    this.metrics.set('uptime_ms', now - this.startedAt);
  }

  attach(request, ws) {
    if (this.shuttingDown || this.connections.size >= this.config.net.maxConnections) {
      ws.close(1013, 'server busy');
      this.metrics.inc('connection_rejected_total');
      return null;
    }
    const conn = new Connection(ws, request, {
      config: this.config,
      limiterLimits: RATE_LIMITS,
      rateLimits: this.config.rateLimits,
      logger: this.logger,
      metrics: this.metrics,
      onMessage: (c, text) => this.onMessage(c, text),
      onClose: (c) => this.onClose(c),
    });
    this.connections.add(conn);
    this.metrics.inc('connections_total');
    this.metrics.set('open_connections', this.connections.size);
    this.logger.debug('connection opened', { connectionId: conn.id, address: conn.remoteAddress });
    return conn;
  }

  onClose(conn) {
    this.connections.delete(conn);
    this.metrics.set('open_connections', this.connections.size);
    this.metrics.inc('disconnections_total');
    if (!conn.playerId) return;
    const session = this.sessions.get(conn.playerId);
    if (session && session.connection === conn) {
      session.connection = null;
      session.lastSeenAt = Date.now();
      const room = this.roomManager.findByPlayer(conn.playerId);
      if (room) {
        const player = room.getPlayer(conn.playerId);
        if (player) {
          player.status = 'DISCONNECTED';
          player.disconnectedAt = Date.now();
          player.connection = null;
          room.markPlayerDirty(player);
          room.broadcastEvent('PLAYER_DISCONNECTED', {
            playerId: player.id,
            graceMs: this.config.rooms.reconnectGraceMs,
            until: player.disconnectedAt + this.config.rooms.reconnectGraceMs,
          });
          room.updatePhase('disconnect');
        }
      }
      this.logger.info('player disconnected', {
        playerId: conn.playerId,
        roomId: room ? room.id : null,
        graceMs: this.config.rooms.reconnectGraceMs,
      });
    }
  }

  onMessage(conn, text) {
    this.messagesWindow.count += 1;
    const decoded = decode(text);
    if (!decoded.ok) {
      this.metrics.inc('invalid_packets_total', { code: decoded.code });
      const requestId = requestIdOf(text);
      if (requestId) conn.replyError(requestId, decoded.code, ERROR_TEXT[decoded.code] || 'Invalid packet');
      else conn.reject(decoded.code, ERROR_TEXT[decoded.code] || 'Invalid packet');
      return;
    }
    const msg = decoded.msg;
    const category = RATE_CATEGORY[msg.type] || 'default';
    if (!conn.allow(category)) return;
    if (conn.markDuplicate(msg.requestId)) {
      conn.send({ type: S2C.ACK, requestId: msg.requestId, payload: { duplicate: true } });
      this.metrics.inc('duplicate_requests_total');
      return;
    }
    try {
      this.dispatch(conn, msg);
    } catch (err) {
      this.logger.error('message dispatch failed', {
        connectionId: conn.id,
        type: msg.type,
        error: err.message,
        stack: err.stack,
      });
      this.metrics.inc('dispatch_errors_total', { type: msg.type });
      conn.replyError(msg.requestId, ERROR_CODES.INTERNAL, ERROR_TEXT[ERROR_CODES.INTERNAL]);
    }
  }

  dispatch(conn, msg) {
    if (msg.type === C2S.HELLO) {
      this.handleHello(conn, msg);
      return;
    }
    if (!conn.auth) {
      conn.replyError(msg.requestId, ERROR_CODES.AUTH_REQUIRED, ERROR_TEXT[ERROR_CODES.AUTH_REQUIRED]);
      return;
    }
    if (msg.type === C2S.PING) {
      conn.send({ type: S2C.PONG, requestId: msg.requestId, payload: { t: msg.payload.t, serverTime: Date.now() } });
      return;
    }
    if (msg.type === C2S.ROOM_LIST) {
      conn.send({
        type: S2C.ROOM_LIST_RESULT,
        requestId: msg.requestId,
        payload: { rooms: this.roomManager.list() },
      });
      return;
    }
    if (msg.type === C2S.CREATE_ROOM) {
      this.handleCreateRoom(conn, msg);
      return;
    }
    if (msg.type === C2S.JOIN_ROOM) {
      this.handleJoinRoom(conn, msg);
      return;
    }

    const room = this.roomManager.findByPlayer(conn.playerId);
    if (REQUIRES_ROOM.has(msg.type) && !room) {
      conn.replyError(msg.requestId, ERROR_CODES.NOT_IN_ROOM, ERROR_TEXT[ERROR_CODES.NOT_IN_ROOM]);
      return;
    }
    const player = room ? room.getPlayer(conn.playerId) : null;
    if (REQUIRES_ROOM.has(msg.type) && !player) {
      conn.replyError(msg.requestId, ERROR_CODES.NOT_IN_ROOM, ERROR_TEXT[ERROR_CODES.NOT_IN_ROOM]);
      return;
    }

    let result = null;
    switch (msg.type) {
      case C2S.LEAVE_ROOM:
        this.handleLeaveRoom(conn, room, player, msg);
        return;
      case C2S.SET_READY:
        result = actions.handleReady(room, player, msg.payload);
        break;
      case C2S.START_MATCH:
        result = actions.handleStartMatch(room, player);
        break;
      case C2S.MOVE:
        result = actions.handleMove(room, player, msg.payload);
        break;
      case C2S.MOUNT_STATION:
        result = actions.handleMount(room, player, msg.payload);
        break;
      case C2S.DISMOUNT:
        result = actions.handleDismount(room, player);
        break;
      case C2S.MACHINE_INPUT:
        result = actions.handleMachineInput(room, player, msg.payload, conn.rttMs);
        break;
      case C2S.SABOTAGE:
        result = actions.handleSabotage(room, player, msg.payload);
        break;
      case C2S.REACTION:
        result = actions.handleReaction(room, player, msg.payload);
        break;
      case C2S.CHAT:
        result = actions.handleChat(room, player, msg.payload);
        break;
      case C2S.INTERACTION:
        result = actions.handleInteraction(room, player, msg.payload, {
          interactionTimeoutMs: 20000,
        });
        break;
      case C2S.REQUEST_STATE_SYNC:
        result = actions.handleStateSync(room, player);
        break;
      default:
        conn.replyError(msg.requestId, ERROR_CODES.UNKNOWN_MESSAGE, ERROR_TEXT[ERROR_CODES.UNKNOWN_MESSAGE]);
        return;
    }

    if (!result.ok) {
      this.metrics.inc('rejected_actions_total', { code: result.code });
      conn.replyError(msg.requestId, result.code, ERROR_TEXT[result.code] || 'Rejected', {
        action: msg.type,
      });
      return;
    }
    if (!result.quiet) {
      conn.send({
        type: S2C.ACK,
        requestId: msg.requestId,
        payload: { ok: true, ...(result.pendingId ? { pendingId: result.pendingId } : {}) },
      });
    }
    room.touch(player);
  }

  handleHello(conn, msg) {
    const payload = msg.payload;
    const verified = this.auth.verifySession(payload.sessionToken);
    if (!verified) {
      this.metrics.inc('auth_failures_total');
      conn.replyError(msg.requestId, ERROR_CODES.AUTH_INVALID, ERROR_TEXT[ERROR_CODES.AUTH_INVALID]);
      conn.close('auth failed');
      return;
    }
    if (verified.expired) {
      this.metrics.inc('auth_failures_total');
      conn.replyError(msg.requestId, ERROR_CODES.AUTH_EXPIRED, ERROR_TEXT[ERROR_CODES.AUTH_EXPIRED]);
      conn.close('session expired');
      return;
    }
    if (payload.reconnectToken) {
      const reconnect = this.auth.verifyReconnect(payload.reconnectToken);
      if (!reconnect || reconnect.playerId !== verified.playerId) {
        this.metrics.inc('reconnect_failures_total');
        conn.replyError(msg.requestId, ERROR_CODES.RECONNECT_FAILED, ERROR_TEXT[ERROR_CODES.RECONNECT_FAILED]);
        conn.close('bad reconnect token');
        return;
      }
    }
    if (payload.protocol !== undefined && payload.protocol !== PROTOCOL_VERSION) {
      conn.replyError(msg.requestId, ERROR_CODES.PROTOCOL_MISMATCH, ERROR_TEXT[ERROR_CODES.PROTOCOL_MISMATCH]);
      conn.close('protocol mismatch');
      return;
    }

    const playerId = verified.playerId;
    const profile = this.store.get(playerId);
    if (!profile) {
      conn.replyError(msg.requestId, ERROR_CODES.AUTH_INVALID, ERROR_TEXT[ERROR_CODES.AUTH_INVALID]);
      conn.close('unknown profile');
      return;
    }

    const existing = this.sessions.get(playerId);
    if (existing && existing.connection && existing.connection !== conn) {
      existing.connection.reject(ERROR_CODES.AUTH_INVALID, 'Signed in from another connection');
      existing.connection.close('replaced');
      this.metrics.inc('session_replaced_total');
    }

    const wasReconnect = Boolean(existing && !existing.connection);
    const session = existing || {
      sessionId: `sess_${playerId}`,
      playerId,
      connection: null,
      roomId: null,
      createdAt: Date.now(),
      lastSeenAt: Date.now(),
      reconnects: 0,
    };
    session.connection = conn;
    session.lastSeenAt = Date.now();
    this.sessions.set(playerId, session);

    conn.auth = { playerId, sessionToken: payload.sessionToken };
    conn.playerId = playerId;
    profile.lastSeenAt = Date.now();
    this.store.markDirty(playerId);

    const reconnectTokens = this.auth.issueSession(playerId, profile.username);
    session.reconnects += wasReconnect ? 1 : 0;
    if (wasReconnect) this.metrics.inc('reconnections_total');

    conn.send({
      type: S2C.SESSION_ESTABLISHED,
      requestId: msg.requestId,
      payload: {
        playerId,
        sessionId: session.sessionId,
        sessionToken: reconnectTokens.sessionToken,
        reconnectToken: reconnectTokens.reconnectToken,
        expiresAt: reconnectTokens.expiresAt,
        protocol: PROTOCOL_VERSION,
        serverTime: Date.now(),
        tickRate: TICK_RATE,
        profile,
        config: {
          world: { width: WORLD.width, depth: WORLD.depth },
          mischiefMax: MISCHIEF.max,
          reconnectGraceMs: this.config.rooms.reconnectGraceMs,
          heartbeatIntervalMs: this.config.net.heartbeatIntervalMs,
        },
        rejoined: wasReconnect,
      },
    });
    this.metrics.inc('auth_success_total');
    this.logger.info('session established', { playerId, connectionId: conn.id, reconnect: wasReconnect });

    const room = this.roomManager.findByPlayer(playerId);
    if (room) {
      const player = room.getPlayer(playerId);
      if (player) {
        room.attachPlayer(player, conn);
        session.roomId = room.id;
        conn.send({
          type: S2C.ROOM_SNAPSHOT,
          roomSequence: room.seq,
          tick: room.tick,
          serverTime: Date.now(),
          payload: room.snapshot(playerId),
        });
        this.logger.info('session resumed into room', { playerId, roomId: room.id, code: room.code });
      }
    }
  }

  handleCreateRoom(conn, msg) {
    const current = this.roomManager.findByPlayer(conn.playerId);
    if (current) {
      conn.replyError(msg.requestId, ERROR_CODES.ALREADY_IN_ROOM, ERROR_TEXT[ERROR_CODES.ALREADY_IN_ROOM]);
      return;
    }
    const created = this.roomManager.create({
      maxPlayers: msg.payload.maxPlayers,
      name: msg.payload.name,
    });
    if (!created.ok) {
      conn.replyError(msg.requestId, created.code, ERROR_TEXT[created.code]);
      return;
    }
    this.joinAs(conn, msg, created.room);
  }

  handleJoinRoom(conn, msg) {
    this.joinAs(conn, msg, null, msg.payload);
  }

  joinAs(conn, msg, presetRoom, joinPayload = null) {
    const profile = this.store.get(conn.playerId);
    const target = presetRoom || this.roomManager.get(joinPayload.roomId || joinPayload.roomCode);
    if (!presetRoom && !target) {
      conn.replyError(msg.requestId, ERROR_CODES.ROOM_NOT_FOUND, ERROR_TEXT[ERROR_CODES.ROOM_NOT_FOUND]);
      return;
    }
    const result = this.roomManager.join(profile, { roomId: target ? target.id : null }, conn);
    if (!result.ok) {
      conn.replyError(msg.requestId, result.code, ERROR_TEXT[result.code]);
      return;
    }
    const session = this.sessions.get(conn.playerId);
    if (session) session.roomId = result.room.id;
    conn.send({
      type: S2C.ACK,
      requestId: msg.requestId,
      payload: {
        ok: true,
        roomId: result.room.id,
        code: result.room.code,
        stationIndex: result.stationIndex,
        phase: result.room.phase,
      },
    });
    conn.send({
      type: S2C.ROOM_SNAPSHOT,
      roomSequence: result.room.seq,
      tick: result.room.tick,
      serverTime: Date.now(),
      payload: roomSnapshotFor(result.room, conn.playerId),
    });
    this.logger.info('player joined room', {
      playerId: conn.playerId,
      roomId: result.room.id,
      code: result.room.code,
      players: result.room.players.size,
    });
  }

  handleLeaveRoom(conn, room, player, msg) {
    const session = this.sessions.get(conn.playerId);
    if (session) session.roomId = null;
    this.roomManager.leave(room, conn.playerId, 'leave');
    conn.send({ type: S2C.ACK, requestId: msg.requestId, payload: { ok: true, left: true } });
    this.finalizePlayerStats(conn, player);
  }

  finalizePlayerStats(conn, player) {
    if (!player) return;
    const profile = this.store.get(player.id);
    if (!profile) return;
    const stats = profile.stats;
    stats.gamesPlayed += 1;
    stats.scoreTotal += player.stats.score;
    stats.bestScore = Math.max(stats.bestScore, player.stats.score);
    stats.stops += player.stats.stops;
    stats.perfects += player.stats.perfects;
    stats.rounds += player.stats.rounds;
    stats.maxCombo = Math.max(stats.maxCombo, player.stats.maxCombo);
    stats.heatPeak = Math.max(stats.heatPeak, player.stats.heatPeak);
    stats.overbrewSuccess += player.stats.overbrewSuccess;
    stats.overbrewFail += player.stats.overbrewFail;
    stats.sabotageThrown += player.stats.sabotageThrown;
    stats.sabotageHit += player.stats.sabotageHit;
    stats.challengesPlayed += player.stats.challengesPlayed;
    stats.challengesWon += player.stats.challengesWon;
    stats.spectated += player.stats.spectated;
    stats.distanceWalked += player.stats.distanceWalked;
    stats.roomEvents += player.stats.roomEvents;
    const achievementResult = evaluateAchievements(stats, profile.achievements);
    profile.achievements = achievementResult.unlocked;
    profile.progression = applyProgression(profile.progression, Math.round(player.stats.score / 50) + player.stats.rounds);
    this.store.markDirty(profile.id);
    if (achievementResult.gained.length) {
      this.metrics.inc('achievements_unlocked_total', {}, achievementResult.gained.length);
      const room = this.roomManager.findByPlayer(profile.id);
      if (room) {
        for (const achievement of achievementResult.gained) {
          room.broadcastEvent('ACHIEVEMENT_UNLOCKED', {
            playerId: profile.id,
            name: profile.displayName,
            achievement: { id: achievement.id, name: achievement.name, description: achievement.description },
          });
        }
      }
    }
  }

  async shutdown() {
    this.shuttingDown = true;
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.metricTimer) clearInterval(this.metricTimer);
    for (const conn of [...this.connections]) conn.close('server shutdown');
    this.roomManager.shutdown();
    await this.store.flush();
    this.logger.info('game server stopped');
  }
}

function roomSnapshotFor(room, playerId) {
  return room.snapshot(playerId);
}

function requestIdOf(raw) {
  if (typeof raw !== 'string' || raw.length > 8192) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.requestId === 'string' && parsed.requestId.length <= 64) {
      return parsed.requestId;
    }
  } catch {
    return null;
  }
  return null;
}

export { makeError };
