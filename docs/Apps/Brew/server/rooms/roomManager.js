import { Room } from './room.js';
import { createRoomPlayer } from './player.js';
import { randomId, roomCode as generateCode } from '../util/ids.js';
import { ROOM } from '../../shared/constants.js';
import { ERROR_CODES } from '../../shared/protocol.js';

export class RoomManager {
  constructor({ config, logger, metrics, store }) {
    this.config = config;
    this.logger = logger;
    this.metrics = metrics;
    this.store = store;
    this.rooms = new Map();
    this.codeIndex = new Map();
    this.closing = new Map();
    this.stats = { created: 0, destroyed: 0, joins: 0, leaves: 0 };
  }

  list() {
    return [...this.rooms.values()]
      .filter((room) => room.phase !== 'CLOSING')
      .map((room) => room.summary())
      .sort((a, b) => b.players - a.players || b.createdAt - a.createdAt);
  }

  get(roomId) {
    if (!roomId) return null;
    return this.rooms.get(roomId) || this.rooms.get(this.codeIndex.get(String(roomId).toUpperCase())) || null;
  }

  create({ maxPlayers, name }) {
    if (this.rooms.size >= this.config.rooms.maxRooms) {
      return { ok: false, code: ERROR_CODES.MAX_ROOMS };
    }
    const size = ROOM.sizes.includes(maxPlayers) ? maxPlayers : this.config.rooms.defaultMaxPlayers;
    let code = generateCode(this.config.rooms.codeLength);
    let guard = 0;
    while (this.codeIndex.has(code) && guard < 50) {
      code = generateCode(this.config.rooms.codeLength);
      guard += 1;
    }
    const id = randomId('room');
    const room = new Room({
      id,
      code,
      name: typeof name === 'string' && name.trim() ? name.trim().slice(0, 24) : `Room ${code}`,
      maxPlayers: Math.min(size, this.config.rooms.maxPlayersPerRoom),
      config: this.config,
      logger: this.logger,
      metrics: this.metrics,
      hooks: { onEmpty: (r) => this.markClosing(r) },
    });
    this.rooms.set(id, room);
    this.codeIndex.set(code, id);
    this.stats.created += 1;
    this.metrics?.inc('rooms_created_total');
    this.logger?.info('room created', { roomId: id, code, maxPlayers: room.maxPlayers });
    return { ok: true, room };
  }

  join(profile, { roomId, roomCode }, connection) {
    const existing = this.findByPlayer(profile.id);
    if (existing) return { ok: false, code: ERROR_CODES.ALREADY_IN_ROOM, room: existing };
    let room = this.get(roomId || roomCode);
    if (!room) {
      const created = this.create({ maxPlayers: this.config.rooms.defaultMaxPlayers });
      if (!created.ok) return created;
      room = created.room;
    }
    if (room.phase === 'CLOSING') {
      this.closing.delete(room.id);
      room.phase = 'ROOM_JOINED';
      room.basePhase = 'ROOM_JOINED';
    }
    const spawnIndex = room.world.spawnPoints.length ? room.stats.joins % room.world.spawnPoints.length : 0;
    const player = createRoomPlayer({
      profile,
      connection,
      spawn: room.world.spawnPoints[spawnIndex] || { x: 13, z: 14.5 },
    });
    const result = room.addPlayer(player);
    if (!result.ok) return result;
    this.stats.joins += 1;
    this.metrics?.inc('room_joins_total');
    return { ok: true, room, player, stationIndex: result.stationIndex };
  }

  findByPlayer(playerId) {
    for (const room of this.rooms.values()) {
      if (room.getPlayer(playerId)) return room;
    }
    return null;
  }

  leave(room, playerId, reason = 'leave') {
    const player = room.removePlayer(playerId, reason);
    if (player) {
      this.stats.leaves += 1;
      this.metrics?.inc('room_leaves_total');
      if (room.players.size === 0) this.markClosing(room);
    }
    return player;
  }

  markClosing(room) {
    if (this.closing.has(room.id)) return;
    room.updatePhase('empty');
    this.closing.set(room.id, Date.now() + this.config.rooms.emptyGraceMs);
    this.logger?.info('room closing scheduled', { roomId: room.id, code: room.code });
  }

  sweep(now) {
    for (const [roomId, deadline] of this.closing) {
      if (now < deadline) continue;
      const room = this.rooms.get(roomId);
      this.closing.delete(roomId);
      if (!room) continue;
      if (room.players.size > 0) continue;
      this.destroy(room);
    }
    for (const room of this.rooms.values()) {
      if (room.phase === 'CLOSING' && !this.closing.has(room.id) && room.players.size === 0) {
        this.markClosing(room);
      }
    }
  }

  destroy(room) {
    this.rooms.delete(room.id);
    this.codeIndex.delete(room.code);
    this.closing.delete(room.id);
    this.stats.destroyed += 1;
    this.metrics?.inc('rooms_destroyed_total');
    room.destroy();
    this.logger?.info('room destroyed', { roomId: room.id, code: room.code });
  }

  tickAll(now) {
    for (const room of this.rooms.values()) {
      const started = Date.now();
      try {
        room.tickLoop(now);
      } catch (err) {
        this.logger?.error('room tick failed', { roomId: room.id, error: err.message, stack: err.stack });
        this.metrics?.inc('room_tick_errors_total');
      }
      this.metrics?.observe('room_tick_total_ms', Date.now() - started);
    }
    this.sweep(now);
  }

  shutdown() {
    for (const room of this.rooms.values()) room.destroy();
    this.rooms.clear();
    this.codeIndex.clear();
    this.closing.clear();
  }

  summary() {
    let players = 0;
    let online = 0;
    for (const room of this.rooms.values()) {
      players += room.players.size;
      online += room.onlineCount;
    }
    return { rooms: this.rooms.size, players, online, stats: { ...this.stats } };
  }
}
