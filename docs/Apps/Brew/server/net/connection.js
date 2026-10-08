import { randomId } from '../util/ids.js';
import { RateLimiter } from '../security/rateLimiter.js';
import { encode, makeError, ERROR_TEXT, ERROR_CODES } from '../../shared/protocol.js';

export class Connection {
  constructor(ws, request, { config, limiterLimits, rateLimits, logger, metrics, onMessage, onClose }) {
    this.id = randomId('conn');
    this.ws = ws;
    this.request = request;
    this.config = config;
    this.logger = logger;
    this.metrics = metrics;
    this.onMessage = onMessage;
    this.onCloseCallback = onClose;
    this.seq = 0;
    this.state = 'CONNECTED';
    this.auth = null;
    this.playerId = null;
    this.roomId = null;
    this.createdAt = Date.now();
    this.lastInboundAt = Date.now();
    this.lastActivityAt = Date.now();
    this.rttMs = 0;
    this.pingAt = 0;
    this.pingCount = 0;
    this.messagesIn = 0;
    this.messagesOut = 0;
    this.remoteAddress = resolveAddress(request, config);
    this.limiter = new RateLimiter({
      limits: limiterLimits,
      enabled: rateLimits.enabled,
      multiplier: rateLimits.multiplier,
    });
    this.seenRequests = new Map();

    ws.on('message', (text) => this.handleInbound(text));
    ws.on('pong', () => {
      if (this.pingAt) {
        this.rttMs = Date.now() - this.pingAt;
        this.pingAt = 0;
        this.metrics.observe('socket_rtt_ms', this.rttMs);
      }
      this.lastInboundAt = Date.now();
    });
    ws.on('malformed', () => this.reject(ERROR_CODES.INVALID_PACKET, 'Malformed frame'));
    ws.on('error', (err) => {
      this.logger.warn('connection socket error', { connectionId: this.id, error: err.message });
    });
    ws.on('close', () => this.handleClose());
  }

  handleInbound(text) {
    this.lastInboundAt = Date.now();
    this.lastActivityAt = Date.now();
    this.messagesIn += 1;
    this.metrics.inc('messages_in_total');
    if (typeof text !== 'string') {
      this.reject(ERROR_CODES.INVALID_PACKET, 'Binary frames are not supported');
      return;
    }
    if (Buffer.byteLength(text, 'utf8') > this.config.net.maxPacketBytes) {
      this.reject(ERROR_CODES.PACKET_TOO_LARGE, ERROR_TEXT[ERROR_CODES.PACKET_TOO_LARGE]);
      return;
    }
    if (this.onMessage) this.onMessage(this, text);
  }

  markDuplicate(requestId) {
    if (!requestId) return false;
    const now = Date.now();
    if (this.seenRequests.has(requestId)) return true;
    this.seenRequests.set(requestId, now);
    if (this.seenRequests.size > 256) {
      const oldest = this.seenRequests.keys().next().value;
      this.seenRequests.delete(oldest);
    }
    return false;
  }

  allow(category) {
    const ok = this.limiter.allow(category);
    if (!ok) {
      this.metrics.inc('rate_limited_total', { category });
      this.reject(ERROR_CODES.RATE_LIMITED, ERROR_TEXT[ERROR_CODES.RATE_LIMITED], null, { category });
    }
    return ok;
  }

  reject(code, message, requestId = null, extra = {}) {
    this.send(makeError(code, message, requestId, extra));
    this.metrics.inc('errors_out_total', { code });
  }

  replyError(requestId, code, message, extra = {}) {
    this.send(makeError(code, message, requestId, extra));
    this.metrics.inc('errors_out_total', { code });
  }

  send(obj) {
    if (this.state === 'CLOSED') return false;
    const payload = { ...obj, sequence: (this.seq += 1) };
    const ok = this.ws.send(encode(payload));
    this.messagesOut += 1;
    this.metrics.inc('messages_out_total');
    return ok;
  }

  sendLowPriority(obj) {
    if (this.state === 'CLOSED') return false;
    if (this.ws.bufferedAmount > 65536) {
      this.metrics.inc('state_messages_dropped_total');
      return false;
    }
    return this.send(obj);
  }

  heartbeat(now) {
    if (this.state === 'CLOSED') return;
    if (now - this.lastInboundAt > this.config.net.heartbeatTimeoutMs) {
      this.metrics.inc('heartbeat_timeouts_total');
      this.close('heartbeat timeout');
      return;
    }
    if (now - (this.lastPingAt || 0) >= this.config.net.pingIntervalMs) {
      this.lastPingAt = now;
      this.pingAt = now;
      this.pingCount += 1;
      this.ws.ping();
    }
  }

  handleClose() {
    if (this.state === 'CLOSED') return;
    this.state = 'CLOSED';
    if (this.onCloseCallback) this.onCloseCallback(this);
  }

  close(reason = 'closed') {
    if (this.state === 'CLOSED') return;
    this.state = 'CLOSING';
    this.ws.close(1000, reason);
    const timer = setTimeout(() => this.handleClose(), 500);
    if (typeof timer.unref === 'function') timer.unref();
  }

  destroy() {
    this.state = 'CLOSED';
    try {
      this.ws.close(1000, 'destroy');
    } catch {
      /* already gone */
    }
  }
}

function resolveAddress(request, config) {
  if (config.security.trustProxy) {
    const forwarded = request.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length) return forwarded.split(',')[0].trim();
  }
  return (request.socket && request.socket.remoteAddress) || 'unknown';
}
