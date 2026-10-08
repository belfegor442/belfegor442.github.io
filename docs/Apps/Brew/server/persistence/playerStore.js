import fs from 'node:fs';
import path from 'node:path';
import { AVATAR_COLORS } from '../../shared/constants.js';

export class PlayerStore {
  constructor({ filePath, enabled = true, flushIntervalMs = 4000, logger = null }) {
    this.filePath = filePath;
    this.enabled = enabled;
    this.flushIntervalMs = flushIntervalMs;
    this.logger = logger;
    this.players = new Map();
    this.usernames = new Map();
    this.dirty = new Set();
    this.timer = null;
    this.writeQueue = Promise.resolve();
    this.writes = 0;
    this.ioErrors = 0;
  }

  async init() {
    if (!this.enabled) return;
    await this.load();
    this.timer = setInterval(() => this.flush(), this.flushIntervalMs);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  async load() {
    if (!fs.existsSync(this.filePath)) return;
    try {
      const raw = await fs.promises.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      const list = Array.isArray(parsed) ? parsed : parsed.players || [];
      for (const record of list) {
        if (!record || !record.id) continue;
        const normalized = normalizeRecord(record);
        this.players.set(normalized.id, normalized);
        this.usernames.set(normalized.username.toLowerCase(), normalized.id);
      }
      if (this.logger) this.logger.info('player store loaded', { players: this.players.size });
    } catch (err) {
      this.ioErrors += 1;
      if (this.logger) this.logger.error('player store load failed', { error: err.message });
    }
  }

  get(id) {
    return this.players.get(id) || null;
  }

  findByUsername(username) {
    const id = this.usernames.get(String(username).toLowerCase());
    return id ? this.players.get(id) || null : null;
  }

  create({ playerId, username }) {
    const key = username.toLowerCase();
    const existing = this.usernames.get(key);
    if (existing) return this.players.get(existing);
    const record = normalizeRecord({ id: playerId, username });
    this.players.set(record.id, record);
    this.usernames.set(key, record.id);
    this.markDirty(record.id);
    return record;
  }

  getOrCreate({ playerId, username }) {
    return this.get(playerId) || this.create({ playerId, username });
  }

  markDirty(id) {
    if (!this.enabled) return;
    this.dirty.add(id);
  }

  update(id, mutator) {
    const record = this.players.get(id);
    if (!record) return null;
    mutator(record);
    record.updatedAt = Date.now();
    this.markDirty(id);
    return record;
  }

  all() {
    return [...this.players.values()];
  }

  flush() {
    if (!this.enabled || this.dirty.size === 0) return this.writeQueue;
    const ids = [...this.dirty];
    this.dirty.clear();
    const snapshot = ids
      .map((id) => this.players.get(id))
      .filter(Boolean)
      .map((record) => JSON.parse(JSON.stringify(record)));
    if (!snapshot.length) return this.writeQueue;
    const writeSet = snapshot;
    this.writeQueue = this.writeQueue
      .then(() => this.persist(writeSet))
      .catch((err) => {
        this.ioErrors += 1;
        if (this.logger) this.logger.error('player store flush failed', { error: err.message });
      });
    return this.writeQueue;
  }

  async persist(records) {
    const dir = path.dirname(this.filePath);
    await fs.promises.mkdir(dir, { recursive: true });
    const merged = new Map();
    for (const record of this.all()) merged.set(record.id, record);
    for (const record of records) merged.set(record.id, record);
    const tmp = `${this.filePath}.${process.pid}.tmp`;
    const payload = JSON.stringify({ version: 1, players: [...merged.values()] }, null, 0);
    await fs.promises.writeFile(tmp, payload, 'utf8');
    await fs.promises.rename(tmp, this.filePath);
    this.writes += 1;
  }

  async close() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.flush();
    await this.writeQueue;
  }
}

export function normalizeRecord(record) {
  const base = {
    id: record.id,
    username: record.username || 'Player',
    displayName: record.displayName || record.username || 'Player',
    createdAt: record.createdAt || Date.now(),
    updatedAt: record.updatedAt || Date.now(),
    lastSeenAt: record.lastSeenAt || Date.now(),
    avatar: {
      color: record.avatar?.color || AVATAR_COLORS[0],
      style: record.avatar?.style || 'bartender',
      accessory: record.avatar?.accessory || null,
    },
    cosmetics: {
      unlocked: Array.isArray(record.cosmetics?.unlocked) ? record.cosmetics.unlocked : [],
      equipped: record.cosmetics?.equipped || {},
    },
    stats: {
      gamesPlayed: 0,
      scoreTotal: 0,
      bestScore: 0,
      stops: 0,
      perfects: 0,
      rounds: 0,
      maxCombo: 0,
      overbrewSuccess: 0,
      overbrewFail: 0,
      heatPeak: 0,
      sabotageThrown: 0,
      sabotageHit: 0,
      challengesPlayed: 0,
      challengesWon: 0,
      spectated: 0,
      distanceWalked: 0,
      roomEvents: 0,
      ...record.stats,
    },
    achievements: Array.isArray(record.achievements) ? record.achievements : [],
    progression: { xp: 0, level: 1, ...record.progression },
    preferences: { sound: true, volume: 0.7, ...record.preferences },
  };
  if (record.updatedAt) base.updatedAt = record.updatedAt;
  return base;
}
