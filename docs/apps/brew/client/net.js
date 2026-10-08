import { C2S, S2C, ERROR_CODES } from '../shared/protocol.js';
import { CLIENT_VERSION, PROTOCOL_VERSION, NET } from '../shared/constants.js';

const STORAGE_KEY = 'brew.session.v1';

export class BrewNet {
  constructor({ url = null, onEvent = null, onStatus = null, onError = null, logger = console } = {}) {
    this.url = url || defaultWsUrl();
    this.onEvent = onEvent;
    this.onStatus = onStatus;
    this.onError = onError;
    this.logger = logger;
    this.ws = null;
    this.status = 'IDLE';
    this.session = loadSession();
    this.playerId = null;
    this.profile = null;
    this.config = null;
    this.requestId = 0;
    this.pending = new Map();
    this.sequence = 0;
    this.gaps = 0;
    this.rttMs = 0;
    this.lastPongAt = 0;
    this.pingTimer = null;
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    this.closedByUser = false;
    this.wantRoomResume = false;
    this.connectPromise = null;
  }

  setStatus(status, detail = {}) {
    this.status = status;
    if (this.onStatus) this.onStatus(status, detail);
  }

  async signIn(username) {
    const res = await fetch('/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw Object.assign(new Error(body.error || 'AUTH_FAILED'), { code: body.error || 'AUTH_FAILED' });
    }
    const body = await res.json();
    this.session = {
      playerId: body.playerId,
      sessionToken: body.sessionToken,
      reconnectToken: body.reconnectToken,
      expiresAt: body.expiresAt,
    };
    this.playerId = body.playerId;
    this.profile = body.profile;
    saveSession(this.session);
    return body;
  }

  connect({ resume = true } = {}) {
    if (this.connectPromise) return this.connectPromise;
    this.closedByUser = false;
    this.wantRoomResume = resume;
    this.connectPromise = this._connect().finally(() => {
      this.connectPromise = null;
    });
    return this.connectPromise;
  }

  async _connect() {
    if (!this.session || !this.session.sessionToken) {
      const err = new Error('NO_SESSION');
      err.code = ERROR_CODES.AUTH_REQUIRED;
      throw err;
    }
    this.setStatus('CONNECTING');
    const ws = new WebSocket(this.url);
    this.ws = ws;
    await new Promise((resolve, reject) => {
      const onOpen = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        const err = new Error('SOCKET_ERROR');
        err.code = ERROR_CODES.SERVER_UNAVAILABLE;
        reject(err);
      };
      const onClose = () => {
        cleanup();
        const err = new Error('SOCKET_CLOSED');
        err.code = ERROR_CODES.SERVER_UNAVAILABLE;
        reject(err);
      };
      const cleanup = () => {
        ws.removeEventListener('open', onOpen);
        ws.removeEventListener('error', onError);
        ws.removeEventListener('close', onClose);
      };
      ws.addEventListener('open', onOpen);
      ws.addEventListener('error', onError);
      ws.addEventListener('close', onClose);
    });

    ws.addEventListener('message', (ev) => this._onMessage(ev.data));
    ws.addEventListener('close', (ev) => this._onClose(ev));
    ws.addEventListener('error', () => {
      /* handled through close */
    });

    const hello = await this.request(C2S.HELLO, {
      sessionToken: this.session.sessionToken,
      reconnectToken: this.session.reconnectToken,
      clientVersion: CLIENT_VERSION,
      protocol: PROTOCOL_VERSION,
    });
    this.playerId = hello.playerId;
    this.profile = hello.profile;
    this.config = hello.config;
    this.session = {
      playerId: hello.playerId,
      sessionToken: hello.sessionToken,
      reconnectToken: hello.reconnectToken,
      expiresAt: hello.expiresAt,
    };
    saveSession(this.session);
    this.reconnectAttempts = 0;
    this._startHeartbeat();
    this.setStatus('CONNECTED', { rejoined: hello.rejoined });
    return hello;
  }

  _startHeartbeat() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = setInterval(() => {
      if (!this.isOpen()) return;
      const started = performance.now();
      this.request(C2S.PING, { t: started })
        .then((payload) => {
          this.rttMs = Math.round(performance.now() - started);
          this.lastPongAt = Date.now();
          if (payload && typeof payload.serverTime === 'number') this.serverClockOffset = payload.serverTime - Date.now();
        })
        .catch(() => {});
    }, NET.heartbeatIntervalMs || 5000);
  }

  isOpen() {
    return Boolean(this.ws && this.ws.readyState === WebSocket.OPEN);
  }

  _onMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (typeof msg.sequence === 'number') {
      if (this.sequence && msg.sequence > this.sequence + 1) {
        this.gaps += 1;
        this.request(C2S.REQUEST_STATE_SYNC, {}).catch(() => {});
      }
      this.sequence = Math.max(this.sequence, msg.sequence);
    }

    if (msg.type === S2C.ACK) {
      const entry = this.pending.get(msg.requestId);
      if (entry) {
        this.pending.delete(msg.requestId);
        clearTimeout(entry.timer);
        if (msg.payload && msg.payload.duplicate) entry.onDuplicate ? entry.onDuplicate(msg.payload) : entry.resolve(msg.payload);
        else entry.resolve(msg.payload || {});
      }
      return;
    }
    if (msg.type === S2C.ERROR) {
      const entry = msg.requestId ? this.pending.get(msg.requestId) : null;
      if (entry) {
        this.pending.delete(msg.requestId);
        clearTimeout(entry.timer);
        const err = new Error(msg.message || msg.code);
        err.code = msg.code;
        err.payload = msg.payload || {};
        entry.reject(err);
        return;
      }
      const err = new Error(msg.message || msg.code);
      err.code = msg.code;
      err.payload = msg.payload || {};
      if (this.onError) this.onError(err, msg);
      return;
    }
    if (msg.type === S2C.PONG) {
      this.lastPongAt = Date.now();
      this._resolvePending(msg);
      return;
    }
    this._resolvePending(msg);
    if (this.onEvent) this.onEvent(msg);
  }

  _resolvePending(msg) {
    if (!msg.requestId) return;
    const entry = this.pending.get(msg.requestId);
    if (!entry) return;
    this.pending.delete(msg.requestId);
    clearTimeout(entry.timer);
    entry.resolve(msg.payload || {});
  }

  _onClose(ev) {
    this._stopHeartbeat();
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      const err = new Error('CONNECTION_LOST');
      err.code = ERROR_CODES.SERVER_UNAVAILABLE;
      entry.reject(err);
    }
    this.pending.clear();
    if (this.closedByUser) {
      this.setStatus('CLOSED');
      return;
    }
    this.setStatus('DISCONNECTED', { code: ev.code, willReconnect: true });
    this._scheduleReconnect();
  }

  _scheduleReconnect() {
    if (this.reconnectTimer) return;
    const attempt = this.reconnectAttempts;
    this.reconnectAttempts += 1;
    const delay = Math.min(5000, 250 * 2 ** Math.min(attempt, 5));
    this.setStatus('RECONNECTING', { attempt, delay });
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        await this.connect({ resume: this.wantRoomResume });
        if (this.onEvent) this.onEvent({ type: 'CLIENT_RECONNECTED' });
      } catch {
        this._scheduleReconnect();
      }
    }, delay);
  }

  request(type, payload = {}, { timeoutMs = NET.ackTimeoutMs } = {}) {
    if (!this.isOpen()) {
      const err = new Error('NOT_CONNECTED');
      err.code = ERROR_CODES.SERVER_UNAVAILABLE;
      return Promise.reject(err);
    }
    const requestId = `c${(this.requestId += 1)}`;
    const envelope = { type, requestId, payload, timestamp: Date.now() };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        const err = new Error('REQUEST_TIMEOUT');
        err.code = ERROR_CODES.REQUEST_TIMEOUT;
        reject(err);
      }, timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer });
      try {
        this.ws.send(JSON.stringify(envelope));
      } catch (err) {
        this.pending.delete(requestId);
        clearTimeout(timer);
        reject(err);
      }
    });
  }

  send(type, payload = {}) {
    if (!this.isOpen()) return false;
    const requestId = `c${(this.requestId += 1)}`;
    try {
      this.ws.send(JSON.stringify({ type, requestId, payload, timestamp: Date.now() }));
      return true;
    } catch {
      return false;
    }
  }

  _stopHeartbeat() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  close() {
    this.closedByUser = true;
    this._stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.close(1000, 'client close');
      } catch {
        /* already closing */
      }
      this.ws = null;
    }
    this.setStatus('CLOSED');
  }

  signOut() {
    this.close();
    this.session = null;
    this.playerId = null;
    this.profile = null;
    clearSession();
  }
}

function defaultWsUrl() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws`;
}

function loadSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.sessionToken) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveSession(session) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    /* storage unavailable */
  }
}

function clearSession() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable */
  }
}
