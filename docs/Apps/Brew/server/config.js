import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOM, NET, TICK_RATE } from '../shared/constants.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const APP_ROOT = path.resolve(here, '..');

function parseEnvFile(file) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const rawLine of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function num(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function bool(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function list(value, fallback) {
  if (!value) return fallback;
  return String(value)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function loadConfig(env = process.env) {
  const fileEnv = {
    ...parseEnvFile(path.join(APP_ROOT, 'config', 'default.env')),
    ...parseEnvFile(path.join(APP_ROOT, 'config', `${env.BREW_PROFILE || 'development'}.env`)),
    ...parseEnvFile(path.join(APP_ROOT, '.env')),
  };
  const get = (key, fallback) => {
    if (env[key] !== undefined && env[key] !== '') return env[key];
    if (fileEnv[key] !== undefined && fileEnv[key] !== '') return fileEnv[key];
    return fallback;
  };

  const profile = get('BREW_PROFILE', 'development');
  const isProduction = profile === 'production';

  const config = {
    profile,
    isProduction,
    host: get('BREW_HOST', '0.0.0.0'),
    port: num(get('BREW_PORT'), 8137),
    publicServerUrl: get('BREW_PUBLIC_URL', ''),
    serveStatic: bool(get('BREW_SERVE_STATIC'), true),
    logLevel: get('BREW_LOG_LEVEL', isProduction ? 'info' : 'debug'),
    logFormat: get('BREW_LOG_FORMAT', isProduction ? 'json' : 'pretty'),
    metricsEnabled: bool(get('BREW_METRICS'), true),

    auth: {
      provider: get('BREW_AUTH_PROVIDER', 'dev'),
      secret: get('BREW_SECRET', isProduction ? '' : 'brew-dev-secret-change-me'),
      sessionTtlMs: num(get('BREW_SESSION_TTL_MS'), 12 * 60 * 60 * 1000),
      maxSessions: num(get('BREW_MAX_SESSIONS'), 5000),
      minUsernameLength: 3,
      maxUsernameLength: 16,
    },

    database: {
      url: get('BREW_DATABASE_URL', ''),
      path: get('BREW_DB_PATH', path.join(APP_ROOT, 'data', 'players.json')),
      flushIntervalMs: num(get('BREW_DB_FLUSH_MS'), 4000),
      enabled: bool(get('BREW_DB_ENABLED'), true),
    },

    rooms: {
      maxRooms: num(get('BREW_MAX_ROOMS'), ROOM.maxRooms),
      maxPlayersPerRoom: num(get('BREW_MAX_PLAYERS_PER_ROOM'), 8),
      defaultMaxPlayers: num(get('BREW_DEFAULT_ROOM_SIZE'), 4),
      reconnectGraceMs: num(get('BREW_RECONNECT_GRACE_MS'), ROOM.reconnectGraceMs),
      emptyGraceMs: num(get('BREW_EMPTY_GRACE_MS'), ROOM.emptyGraceMs),
      idleTimeoutMs: num(get('BREW_IDLE_TIMEOUT_MS'), ROOM.idleTimeoutMs),
      codeLength: ROOM.codeLength,
    },

    net: {
      tickRate: num(get('BREW_TICK_RATE'), TICK_RATE),
      heartbeatIntervalMs: num(get('BREW_HEARTBEAT_MS'), NET.heartbeatIntervalMs),
      heartbeatTimeoutMs: num(get('BREW_HEARTBEAT_TIMEOUT_MS'), NET.heartbeatTimeoutMs),
      pingIntervalMs: num(get('BREW_PING_INTERVAL_MS'), NET.pingIntervalMs),
      maxPacketBytes: num(get('BREW_MAX_PACKET_BYTES'), NET.maxPacketBytes),
      maxConnections: num(get('BREW_MAX_CONNECTIONS'), 500),
      stateBroadcastEvery: num(get('BREW_STATE_BROADCAST_EVERY'), 2),
    },

    rateLimits: {
      enabled: bool(get('BREW_RATE_LIMIT_ENABLED'), true),
      multiplier: num(get('BREW_RATE_LIMIT_MULTIPLIER'), 1),
    },

    security: {
      trustProxy: bool(get('BREW_TRUST_PROXY'), false),
      requireAuth: bool(get('BREW_REQUIRE_AUTH'), true),
    },
  };

  if (isProduction && !config.auth.secret) {
    throw new Error('BREW_SECRET must be set when BREW_PROFILE=production');
  }
  if (!config.auth.secret) {
    config.auth.secret = 'brew-dev-secret-change-me';
  }
  return Object.freeze(config);
}

export const config = loadConfig();
