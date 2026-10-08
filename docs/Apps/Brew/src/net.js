import { topics } from './protocol.js';

function orderFor(room, brokers) {
  let h = 0;
  for (const ch of room) h = (h * 131 + ch.charCodeAt(0)) >>> 0;
  const s = brokers.length ? h % brokers.length : 0;
  return brokers.slice(s).concat(brokers.slice(0, s));
}

export class Net {
  constructor(brokers) {
    this.brokers = brokers.filter(Boolean);
    this.conns = [];
    this.role = null;
    this.topics = null;
    this.room = null;
    this.will = null;
    this.onStatus = () => {};
    this.onMessage = () => {};
    this.onFirstUp = () => {};
    this.onReconnect = () => {};
    this.closed = false;
    this.attempt = 0;
    this.reconnectTimer = null;
    this.connectedOnce = false;
  }

  get up() { return this.conns.some(c => c.connected); }

  clearReconnect() {
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
  }

  destroyConnections() {
    const list = this.conns.splice(0);
    for (const c of list) {
      try { c.removeAllListeners(); c.on('error', () => {}); c.end(true); } catch (e) {}
    }
  }

  close() {
    this.closed = true;
    this.clearReconnect();
    this.destroyConnections();
  }

  handle(topic, payload) {
    let msg;
    try { msg = JSON.parse(payload.toString()); } catch (e) { return; }
    if (!msg || typeof msg.t !== 'string') return;
    this.onMessage(topic, msg);
  }

  publish(topic, obj, opts = { qos: 0 }) {
    if (!topic) return false;
    const payload = JSON.stringify(obj);
    let sent = false;
    for (const c of this.conns) {
      if (c.connected) {
        try { c.publish(topic, payload, opts); sent = true; } catch (e) {}
      }
    }
    return sent;
  }

  connectOne(url, will, onOk, onFail) {
    if (typeof mqtt === 'undefined') { onFail(new Error('mqtt-unavailable')); return; }
    let c;
    try {
      c = mqtt.connect(url, {
        connectTimeout: 10000,
        reconnectPeriod: 0,
        keepalive: 30,
        protocolVersion: 4,
        clean: true,
        resubscribe: false,
        queueQoSZero: true,
        reconnectOnConnackError: true,
        clientId: 'brew-' + Math.random().toString(36).slice(2, 14),
        will: will || undefined
      });
    } catch (e) { onFail(e); return; }

    let settled = false;
    const timer = setTimeout(() => fail(new Error('timeout')), 11000);
    const cleanup = () => {
      clearTimeout(timer);
      c.removeListener('connect', connected);
      c.removeListener('error', fail);
      c.removeListener('offline', fail);
    };
    const fail = err => {
      if (settled) return;
      settled = true;
      cleanup();
      try { c.removeAllListeners(); c.on('error', () => {}); c.end(true); } catch (e) {}
      onFail(err || new Error('mqtt-connect-failed'));
    };
    const connected = () => {
      if (settled) return;
      settled = true;
      cleanup();
      c.on('error', () => {});
      onOk(c, url);
    };
    c.once('connect', connected);
    c.once('error', fail);
    c.once('offline', fail);
  }

  setupConnection(c, role) {
    this.conns = [c];
    c.on('message', (t, p) => this.handle(t, p));
    c.on('close', () => {
      if (this.closed) return;
      this.conns = this.conns.filter(x => x !== c);
      this.onStatus('Connection lost — reconnecting…');
      this.scheduleReconnect();
    });
    c.on('error', () => {});
    if (role === 'guest') {
      c.on('reconnect', () => this.onStatus('Reconnecting…'));
    } else {
      c.on('reconnect', () => this.onStatus('Reconnecting…'));
    }
  }

  subscribeAndReady(c, role, firstConnection) {
    const subs = role === 'host'
      ? [this.topics.c, this.topics.pAll]
      : [this.topics.s, this.topics.host];
    c.subscribe(subs, { qos: 1 }, err => {
      if (err || !c.connected || this.closed) {
        try { c.removeAllListeners(); c.on('error', () => {}); c.end(true); } catch (e) {}
        if (!this.closed) this.scheduleReconnect();
        return;
      }
      if (role === 'host') {
        c.publish(this.topics.host, '{"t":"presence","on":1}', { retain: true, qos: 1 }, () => {
          if (firstConnection) {
            this.connectedOnce = true;
            this.onStatus('ready');
            this.onFirstUp();
          }
        });
      } else {
        this.connectedOnce = true;
        this.onStatus('connected');
        this.onFirstUp();
      }
    });
  }

  scheduleReconnect() {
    if (this.closed || this.reconnectTimer || !this.brokers.length) return;
    const delay = Math.min(8000, 1000 + this.attempt * 1000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connectCurrent();
    }, delay);
  }

  connectCurrent() {
    if (this.closed || !this.brokers.length) return;
    const list = orderFor(this.room, this.brokers);
    const url = list[this.attempt % list.length];
    const index = this.attempt % list.length;
    this.onStatus(this.connectedOnce ? 'Reconnecting…' : 'Connecting to the network…');
    this.connectOne(url, this.will, c => {
      if (this.closed) { try { c.end(true); } catch (e) {} return; }
      this.attempt = index;
      this.setupConnection(c, this.role);
      this.subscribeAndReady(c, this.role, !this.connectedOnce);
    }, () => {
      this.attempt = (index + 1) % list.length;
      this.scheduleReconnect();
    });
  }

  host(room, will) {
    this.close();
    this.closed = false;
    this.role = 'host';
    this.room = room;
    this.will = will || null;
    this.topics = topics(room);
    this.attempt = 0;
    this.connectedOnce = false;
    this.onStatus('Connecting to the network…');
    this.connectCurrent();
  }

  guest(room, will) {
    this.close();
    this.closed = false;
    this.role = 'guest';
    this.room = room;
    this.will = will || null;
    this.topics = topics(room);
    this.attempt = 0;
    this.connectedOnce = false;
    this.onStatus('Connecting to the network…');
    this.connectCurrent();
  }

  rotate() {
    if (this.role !== 'guest' || !this.brokers.length) return;
    const list = orderFor(this.room, this.brokers);
    const current = list[this.attempt % list.length];
    const idx = list.indexOf(current);
    this.destroyConnections();
    this.clearReconnect();
    this.attempt = (idx + 1) % list.length;
    this.connectedOnce = false;
    this.onStatus('Looking in another network…');
    this.connectCurrent();
  }
}
