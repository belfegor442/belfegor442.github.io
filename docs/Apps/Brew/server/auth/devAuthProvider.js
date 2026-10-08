import crypto from 'node:crypto';
import { AuthProvider } from './authProvider.js';
import { randomId } from '../util/ids.js';

function sign(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const mac = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${mac}`;
}

function verify(token, secret) {
  if (typeof token !== 'string') return null;
  const dot = token.lastIndexOf('.');
  if (dot < 1) return null;
  const body = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

export class DevAuthProvider extends AuthProvider {
  constructor({ secret, sessionTtlMs, usernameMin, usernameMax }) {
    super();
    this.secret = secret;
    this.sessionTtlMs = sessionTtlMs;
    this.usernameMin = usernameMin;
    this.usernameMax = usernameMax;
  }

  normalizeUsername(raw) {
    if (typeof raw !== 'string') return null;
    const cleaned = raw.trim().replace(/\s+/g, ' ');
    if (cleaned.length < this.usernameMin || cleaned.length > this.usernameMax) return null;
    if (!/^[\p{L}\p{N} _.-]+$/u.test(cleaned)) return null;
    return cleaned;
  }

  async authenticate({ username, playerId = null }) {
    const name = this.normalizeUsername(username);
    if (!name) return { ok: false, code: 'AUTH_INVALID' };
    const id = playerId || `player_${crypto.randomBytes(8).toString('hex')}`;
    return { ok: true, playerId: id, username: name };
  }

  issueSession(playerId) {
    const expiresAt = Date.now() + this.sessionTtlMs;
    return {
      sessionToken: sign({ sub: playerId, typ: 'session', exp: expiresAt, jti: randomId() }, this.secret),
      reconnectToken: sign({ sub: playerId, typ: 'reconnect', exp: expiresAt, jti: randomId() }, this.secret),
      expiresAt,
    };
  }

  verifySession(token) {
    const payload = verify(token, this.secret);
    if (!payload || payload.typ !== 'session') return null;
    if (payload.exp < Date.now()) return { expired: true };
    return { playerId: payload.sub };
  }

  issueReconnect(playerId, ttlMs = 60000) {
    return {
      reconnectToken: sign({ sub: playerId, typ: 'reconnect', exp: Date.now() + ttlMs, jti: randomId() }, this.secret),
      expiresAt: Date.now() + ttlMs,
    };
  }

  verifyReconnect(token) {
    const payload = verify(token, this.secret);
    if (!payload || payload.typ !== 'reconnect') return null;
    if (payload.exp < Date.now()) return { expired: true };
    return { playerId: payload.sub };
  }
}

export function createAuthProvider(config) {
  if (config.auth.provider !== 'dev') {
    throw new Error(`Unknown auth provider: ${config.auth.provider}`);
  }
  return new DevAuthProvider({
    secret: config.auth.secret,
    sessionTtlMs: config.auth.sessionTtlMs,
    usernameMin: config.auth.minUsernameLength,
    usernameMax: config.auth.maxUsernameLength,
  });
}
