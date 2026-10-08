import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { handleUpgrade } from './net/websocket.js';
import { APP_ROOT } from './config.js';
import { RATE_LIMITS } from '../shared/constants.js';
import { RateLimiter } from './security/rateLimiter.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

const ALLOWED_DIRS = new Set(['client', 'shared', 'assets', 'Assets', 'src']);
const ALLOWED_ROOT_FILES = new Set([
  'index.html',
  'play.html',
  'app.js',
  'style.css',
  'server.css',
  'favicon.ico',
  'robots.txt',
]);

export function createHttpServer({ config, logger, metrics, auth, store, gameServer }) {
  const authLimiter = new RateLimiter({
    limits: RATE_LIMITS,
    enabled: config.rateLimits.enabled,
    multiplier: config.rateLimits.multiplier,
  });
  const ipBuckets = new Map();
  const limiterFor = (ip) => {
    let bucket = ipBuckets.get(ip);
    if (!bucket) {
      bucket = new RateLimiter({ limits: RATE_LIMITS, enabled: true, multiplier: 1 });
      ipBuckets.set(ip, bucket);
      if (ipBuckets.size > 5000) ipBuckets.delete(ipBuckets.keys().next().value);
    }
    return bucket;
  };

  const server = http.createServer((req, res) => {
    handleRequest(req, res).catch((err) => {
      logger.error('http request failed', { error: err.message, stack: err.stack, url: req.url });
      sendJson(res, 500, { error: 'INTERNAL' });
    });
  });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== '/ws') {
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    const conn = handleUpgrade(req, socket, head, {
      maxPayload: config.net.maxPacketBytes,
      onOpen: (ws) => gameServer.attach(req, ws),
    });
    if (!conn) logger.warn('websocket upgrade failed', { url: req.url });
  });

  async function handleRequest(req, res) {
    const url = new URL(req.url, 'http://localhost');
    cors(res, req);
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { Allow: 'GET, POST, OPTIONS' });
      res.end();
      return;
    }
    if (url.pathname === '/healthz') {
      sendJson(res, 200, {
        ok: true,
        profile: config.profile,
        uptimeMs: Date.now() - server.startedAt,
        ...gameServer.roomManager.summary(),
        openConnections: gameServer.connections.size,
      });
      return;
    }
    if (url.pathname === '/readyz') {
      const ready = !gameServer.shuttingDown;
      sendJson(res, ready ? 200 : 503, { ready });
      return;
    }
    if (url.pathname === '/metrics') {
      if (!config.metricsEnabled) {
        sendJson(res, 404, { error: 'metrics disabled' });
        return;
      }
      const accept = String(req.headers.accept || '');
      if (accept.includes('application/json')) {
        sendJson(res, 200, metrics.snapshot());
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' });
      res.end(metrics.prometheus());
      return;
    }
    if (url.pathname === '/auth' && req.method === 'POST') {
      await handleAuth(req, res, limiterFor(clientIp(req, config)));
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405, { error: 'METHOD_NOT_ALLOWED' });
      return;
    }
    if (config.serveStatic) {
      const served = serveStatic(req, res, url.pathname);
      if (served) return;
    }
    sendJson(res, 404, { error: 'NOT_FOUND' });
  }

  async function handleAuth(req, res, limiter) {
    if (!limiter.allow('AUTH')) {
      sendJson(res, 429, { error: 'RATE_LIMITED' });
      return;
    }
    if (authLimiter.allow('default')) {
      // shared burst budget across all auth attempts
    } else {
      sendJson(res, 429, { error: 'RATE_LIMITED' });
      return;
    }
    const body = await readBody(req, 4096);
    if (body === null) {
      sendJson(res, 400, { error: 'INVALID_BODY' });
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      sendJson(res, 400, { error: 'INVALID_JSON' });
      return;
    }
    const username = auth.normalizeUsername(parsed && parsed.username);
    if (!username) {
      metrics.inc('auth_failures_total', { reason: 'username' });
      sendJson(res, 400, { error: 'AUTH_INVALID' });
      return;
    }
    const existing = store.findByUsername(username);
    const result = await auth.authenticate({ username, playerId: existing ? existing.id : null });
    if (!result.ok) {
      metrics.inc('auth_failures_total', { reason: 'provider' });
      sendJson(res, 400, { error: result.code || 'AUTH_INVALID' });
      return;
    }
    const profile = store.getOrCreate({ playerId: result.playerId, username: result.username });
    const tokens = auth.issueSession(profile.id, profile.username);
    metrics.inc('auth_tokens_issued_total');
    logger.info('auth token issued', { playerId: profile.id, username: profile.username });
    sendJson(res, 200, {
      playerId: profile.id,
      profile,
      sessionToken: tokens.sessionToken,
      reconnectToken: tokens.reconnectToken,
      expiresAt: tokens.expiresAt,
    });
  }

  server.startedAt = Date.now();
  return server;
}

function serveStatic(req, res, rawPath) {
  let pathname;
  try {
    pathname = decodeURIComponent(rawPath);
  } catch {
    return false;
  }
  if (pathname.includes('\0')) return false;
  const normalized = path.posix.normalize(pathname === '/' ? '/index.html' : pathname);
  const rel = normalized.replace(/^\/+/, '');
  if (rel.includes('..')) return false;
  const top = rel.split('/')[0];
  const isDirAllowed = ALLOWED_DIRS.has(top);
  const isRootFile = !rel.includes('/') && ALLOWED_ROOT_FILES.has(rel);
  if (!isDirAllowed && !isRootFile) return false;

  const full = path.join(APP_ROOT, ...rel.split('/'));
  if (!full.startsWith(APP_ROOT)) return false;
  let target = full;
  if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
    target = path.join(target, 'index.html');
  }
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
    if (!path.extname(rel)) {
      const fallback = path.join(APP_ROOT, 'index.html');
      if (fs.existsSync(fallback)) {
        streamFile(req, res, fallback, 'index.html');
        return true;
      }
    }
    return false;
  }
  streamFile(req, res, target, path.basename(target));
  return true;
}

function streamFile(req, res, file, name) {
  const ext = path.extname(file).toLowerCase();
  const stat = fs.statSync(file);
  const etag = `W/"${stat.size}-${Math.floor(stat.mtimeMs)}"`;
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { ETag: etag });
    res.end();
    return;
  }
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': name.endsWith('.html') ? 'no-cache' : 'public, max-age=300',
    ETag: etag,
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  fs.createReadStream(file).pipe(res);
}

function readBody(req, limit) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        req.destroy();
        resolve(null);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => resolve(null));
  });
}

function clientIp(req, config) {
  if (config.security.trustProxy) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length) return forwarded.split(',')[0].trim();
  }
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

function cors(res, req) {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Vary', 'Origin');
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}
