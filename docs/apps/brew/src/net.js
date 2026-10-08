import { topics } from './protocol.js';

function orderFor(room, brokers) {
  let h = 0;
  for (const ch of room) h = (h * 131 + ch.charCodeAt(0)) >>> 0;
  const s = h % brokers.length;
  return brokers.slice(s).concat(brokers.slice(0, s));
}

export class Net {
  constructor(brokers) {
    this.brokers = brokers;
    this.conns = [];
    this.pending = [];
    this.role = null;
    this.topics = null;
    this.room = null;
    this.onStatus = () => {};
    this.onMessage = () => {};
    this.onFirstUp = () => {};
    this.onReconnect = () => {};
    this.retryTimer = null;
    this.gIdx = 0;
    this.gSwitch = 0;
    this.closed = false;
  }

  get up() { return this.conns.some(c => c.connected); }

  close() {
    this.closed = true;
    if (this.retryTimer) { clearInterval(this.retryTimer); this.retryTimer = null; }
    const list = this.conns;
    this.conns = [];
    for (const c of list) {
      try { c.removeAllListeners(); c.on('error', () => {}); c.end(true); } catch (e) {}
    }
  }

  handle(topic, payload) {
    let msg;
    try { msg = JSON.parse(payload.toString()); } catch (e) { return; }
    if (!msg || typeof msg.t !== 'string') return;
    this.onMessage(topic, msg);
  }

  publish(topic, obj, opts) {
    const payload = JSON.stringify(obj);
    for (const c of this.conns) {
      if (c.connected) { try { c.publish(topic, payload, opts || { qos: 0 }); } catch (e) {} }
    }
  }

  connectOne(url, will, onOk, onFail) {
    if (typeof mqtt === 'undefined') { onFail(); return; }
    let c;
    try {
      c = mqtt.connect(url, {
        connectTimeout: 6000, reconnectPeriod: 2500, keepalive: 15,
        resubscribe: true, queueQoSZero: true, will: will || undefined
      });
    } catch (e) { onFail(); return; }
    let settled = false;
    const fail = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { c.removeAllListeners(); c.on('error', () => {}); c.end(true); } catch (e) {}
      onFail();
    };
    const ok = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      c.removeListener('error', fail);
      c.removeListener('offline', fail);
      c.on('error', () => {});
      onOk(c, url);
    };
    const timer = setTimeout(fail, 7000);
    c.once('connect', ok);
    c.on('error', fail);
    c.on('offline', fail);
  }

  host(room, will) {
    this.close();
    this.closed = false;
    this.role = 'host';
    this.room = room;
    this.topics = topics(room);
    this.onStatus('Connecting to the network…');
    const list = orderFor(room, this.brokers);
    let left = list.length, up = 0, first = true;
    const attach = c => {
      up++;
      this.conns.push(c);
      c.on('message', (t, p) => this.handle(t, p));
      c.on('reconnect', () => {
        if (!this.up) this.onStatus('Reconnecting…');
        try { c.publish(this.topics.host, '{"t":"presence","on":1}', { retain: true }); } catch (e) {}
      });
      c.on('close', () => { if (!this.up) this.onStatus('Connection lost — reconnecting…'); });
      c.subscribe([this.topics.c, this.topics.pAll], () => {});
      c.publish(this.topics.host, '{"t":"presence","on":1}', { retain: true });
      if (first) { first = false; this.onStatus('ready'); this.onFirstUp(); }
    };
    for (const url of list) {
      this.connectOne(url, will, attach, () => {
        if (this.pending.indexOf(url) < 0) this.pending.push(url);
        left--;
        if (up === 0 && left === 0) this.onStatus('Cannot reach the game network. Check your connection and try again.');
      });
    }
    this.retryTimer = setInterval(() => {
      if (this.closed || !this.pending.length) return;
      const url = this.pending.shift();
      this.connectOne(url, will, attach, () => { if (this.pending.indexOf(url) < 0) this.pending.push(url); });
    }, 25000);
  }

  guest(room, will) {
    this.close();
    this.closed = false;
    this.role = 'guest';
    this.room = room;
    this.will = will || null;
    this.topics = topics(room);
    this.gIdx = 0;
    this.gSwitch = 0;
    this.onStatus('Connecting to the network…');
    this.guestAttempt();
  }

  rotate() {
    if (this.role !== 'guest') return;
    this.gIdx = (this.gIdx + 1) % this.brokers.length;
    this.gSwitch = 0;
    const list = this.conns;
    this.conns = [];
    for (const c of list) {
      try { c.removeAllListeners(); c.on('error', () => {}); c.end(true); } catch (e) {}
    }
    this.onStatus('Looking in another network…');
    this.guestAttempt();
  }

  guestAttempt() {
    if (this.closed) return;
    const list = orderFor(this.room, this.brokers);
    const rotated = list.slice(this.gIdx).concat(list.slice(0, this.gIdx));
    const attempt = (i) => {
      if (this.closed) return;
      if (i >= rotated.length) {
        this.gSwitch++;
        this.gIdx = (this.gIdx + 1) % this.brokers.length;
        if (this.gSwitch < this.brokers.length * 2) setTimeout(() => this.guestAttempt(), 500);
        else this.onStatus('Cannot reach the game network. Check your connection and try again.');
        return;
      }
      this.connectOne(rotated[i], this.will, c => {
        if (this.closed) { try { c.removeAllListeners(); c.end(true); } catch (e) {} return; }
        this.conns = [c];
        c.on('message', (t, p) => this.handle(t, p));
        c.on('reconnect', () => { this.onStatus('Reconnecting…'); this.onReconnect(); });
        c.on('close', () => { if (!this.up) this.onStatus('Connection lost — reconnecting…'); });
        c.subscribe([this.topics.s, this.topics.host], () => {});
        this.onStatus('connected');
        this.onFirstUp();
      }, () => attempt(i + 1));
    };
    attempt(0);
  }
}
