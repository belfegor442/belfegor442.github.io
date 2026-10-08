import { MAX_PLAYERS, SPEED, RADIUS, MOVE_TOLERANCE, PROX, LIMITS, token } from './protocol.js';
import { SEATS, SEAT_BY_ID, OBJ_BY_ID, move as collide, seatsAt } from './world.js';
import { Registry } from './activities.js';

const clampAngle = a => (isFinite(a) ? Math.atan2(Math.sin(a), Math.cos(a)) : 0);
const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);

export class Host {
  constructor(room) {
    this.room = room;
    this.players = new Map();
    this.occupancy = new Map();
    this.activity = null;
    this.objects = { lights: true };
    this.seq = 0;
    this.startedAt = Date.now();
  }

  emit(t, extra) { return Object.assign({ t }, extra); }

  addPlayer(info) {
    if (this.players.size >= MAX_PLAYERS) return null;
    if ([...this.players.values()].some(p => p.name === info.name && p.pid === info.pid)) return null;
    const p = {
      id: info.id,
      name: clean(info.name, LIMITS.name) || 'PLAYER',
      pid: clean(info.pid, LIMITS.pid).toUpperCase() || '----',
      seed: (Number(info.seed) || 0) % 6,
      x: info.x, y: info.y, dir: info.dir || 0, anim: 'idle',
      status: 'standing', seat: null, emote: null, emoteAt: 0,
      balance: Math.max(0, Math.min(100000, Number(info.balance) || 1000)),
      joinedAt: Date.now(), lastT: Date.now(), dirty: true
    };
    this.players.set(p.id, p);
    return p;
  }

  removePlayer(uid) {
    const p = this.players.get(uid);
    if (!p) return [];
    const msgs = [];
    if (p.seat) { const s = SEAT_BY_ID.get(p.seat); if (s) s.occupiedBy = null; p.seat = null; }
    this.players.delete(uid);
    if (this.activity && this.activity.players.includes(uid)) {
      msgs.push(...this.endActivity('player-left'));
    }
    msgs.unshift(this.emit('leave', { uid }));
    return msgs;
  }

  applyMove(uid, mv, now) {
    const p = this.players.get(uid);
    if (!p || p.status !== 'standing') return null;
    const x = Number(mv.x), y = Number(mv.y);
    if (!isFinite(x) || !isFinite(y)) return null;
    const dt = Math.min(0.5, Math.max(0.005, (now - p.lastT) / 1000));
    p.lastT = now;
    const d = Math.hypot(x - p.x, y - p.y);
    const max = SPEED * dt * MOVE_TOLERANCE + 8;
    let tx = x, ty = y;
    if (d > max) { const k = max / d; tx = p.x + (x - p.x) * k; ty = p.y + (y - p.y) * k; }
    const r = collide(p.x, p.y, tx, ty, RADIUS);
    const moved = Math.abs(r.x - p.x) > 0.01 || Math.abs(r.y - p.y) > 0.01;
    const dir = clampAngle(mv.dir);
    const anim = mv.anim === 'walk' ? 'walk' : 'idle';
    if (moved || dir !== p.dir || anim !== p.anim) p.dirty = true;
    p.x = r.x; p.y = r.y; p.dir = dir; p.anim = anim;
    return p;
  }

  sit(uid, seatId) {
    const p = this.players.get(uid);
    const s = SEAT_BY_ID.get(seatId);
    if (!p) return { error: 'unknown-player' };
    if (p.status !== 'standing') return { error: 'busy' };
    if (!s) return { error: 'no-seat' };
    if (s.occupiedBy && s.occupiedBy !== uid) return { error: 'taken' };
    if (Math.hypot(s.x - p.x, s.y - p.y) > PROX.interact + 70) return { error: 'too-far' };
    if (s.table && this.activity && this.activity.table === s.table && !this.activity.players.includes(uid)) {
      return { error: 'activity-running' };
    }
    s.occupiedBy = uid;
    p.seat = s.id; p.status = 'seated'; p.x = s.x; p.y = s.y; p.dir = s.dir; p.anim = 'sit'; p.dirty = true;
    return { ok: this.emit('sit', { uid, seat: s.id, x: s.x, y: s.y, dir: s.dir }) };
  }

  stand(uid) {
    const p = this.players.get(uid);
    if (!p || p.status !== 'seated') return { error: 'not-seated' };
    if (this.activity && this.activity.players.includes(uid)) return { error: 'in-activity' };
    const s = SEAT_BY_ID.get(p.seat);
    if (s && s.occupiedBy === uid) s.occupiedBy = null;
    p.seat = null; p.status = 'standing'; p.anim = 'idle'; p.dirty = true;
    return { ok: this.emit('stand', { uid }) };
  }

  emote(uid, key) {
    const p = this.players.get(uid);
    if (!p) return { error: 'unknown-player' };
    p.emote = clean(key, 24); p.emoteAt = Date.now(); p.dirty = true;
    return { ok: this.emit('emote', { uid, key: p.emote, at: p.emoteAt }) };
  }

  chat(uid, text) {
    const p = this.players.get(uid);
    const body = clean(text, LIMITS.chat);
    if (!p || !body) return { error: 'empty' };
    const to = [uid];
    for (const o of this.players.values()) {
      if (o.id === uid) continue;
      if (Math.hypot(o.x - p.x, o.y - p.y) <= PROX.chat) to.push(o.id);
    }
    return { ok: this.emit('chat', { uid, text: body, to, at: Date.now() }) };
  }

  objectState(uid, id, val) {
    const p = this.players.get(uid);
    const o = OBJ_BY_ID.get(id);
    if (!p || !o) return { error: 'unknown-object' };
    if (o.type !== 'switch') return { error: 'not-interactive' };
    if (Math.hypot(o.x + o.w / 2 - p.x, o.y + o.h / 2 - p.y) > PROX.interact + 60) return { error: 'too-far' };
    if (o.type === 'switch') this.objects.lights = !!val;
    p.dirty = true;
    return { ok: this.emit('obj', { id, val: !!val, by: uid }) };
  }

  startActivity(kind, uid, opts = {}) {
    const reg = Registry[kind];
    if (!reg) return { error: 'unknown-activity' };
    if (this.activity) return { error: 'activity-running' };
    const p = this.players.get(uid);
    if (!p || p.status !== 'seated' || !p.seat) return { error: 'must-sit' };
    const seat = SEAT_BY_ID.get(p.seat);
    const table = seat && seat.table;
    if (!table) return { error: 'no-table' };
    const seated = seatsAt(table).map(s => s.occupiedBy).filter(Boolean);
    const need = Math.max(1, Number(reg.minPlayers) || 2);
    if (seated.length < need) return { error: need <= 1 ? 'need-one-player' : 'need-two-players' };
    if (seated.some(id => { const pl = this.players.get(id); return !pl || pl.status === 'activity'; })) return { error: 'need-two-players' };
    const act = {
      id: kind + '-' + (++this.seq) + '-' + Date.now().toString(36),
      kind, table, players: seated.slice(), phase: 'picking',
      inputs: {}, data: {}, startedAt: Date.now(),
      stake: Math.max(1, Math.min(1000, Number(opts.stake) || 25))
    };
    if (reg.validate) { const e = reg.validate(this, act); if (e) return { error: e }; }
    this.activity = act;
    for (const id of act.players) { const pl = this.players.get(id); if (pl) { pl.status = 'activity'; pl.dirty = true; } }
    const res = { ok: this.emit('activity.start', { activity: this.serialize(act) }) };
    if (reg.deal) {
      const dealt = reg.deal(this, act) || [];
      res.dms = dealt.map(d => ({ uid: d.uid, msg: { t: 'activity.hand', id: act.id, cards: d.cards } }));
    }
    return res;
  }

  inputActivity(uid, payload) {
    const act = this.activity;
    if (!act) return { error: 'no-activity' };
    if (!act.players.includes(uid)) return { error: 'not-playing' };
    const reg = Registry[act.kind];
    if (!reg || !reg.input) return { error: 'unknown-activity' };
    const res = reg.input(this, act, uid, payload);
    if (res && res.error) return res;
    if (res && res.done) return this.resolveActivity(res.update);
    return { ok: this.emit('activity.update', { id: act.id, phase: act.phase, waiting: this.waitingOn(), activity: this.serialize(act) }) };
  }

  waitingOn() {
    const act = this.activity;
    if (!act) return [];
    return act.players.filter(id => !act.inputs[id]);
  }

  resolveActivity(update) {
    const act = this.activity;
    if (!act) return { error: 'no-activity' };
    Object.assign(act, update || {});
    act.phase = 'result';
    act.resultAt = Date.now();
    return { ok: this.emit('activity.update', { id: act.id, phase: 'result', activity: this.serialize(act) }) };
  }

  tick(now) {
    const act = this.activity;
    if (!act) return [];
    if (act.phase === 'result' && now - act.resultAt > 3400) return this.endActivity('done');
    if (now - act.startedAt > 120000) return this.endActivity('timeout');
    return [];
  }

  endActivity(reason) {
    const act = this.activity;
    if (!act) return [];
    this.activity = null;
    for (const id of act.players) { const p = this.players.get(id); if (p && p.status === 'activity') { p.status = p.seat ? 'seated' : 'standing'; p.dirty = true; } }
    return [this.emit('activity.end', { id: act.id, reason, activity: this.serialize(act) })];
  }

  serialize(act) {
    if (!act) return null;
    const out = {
      id: act.id, kind: act.kind, table: act.table, players: act.players,
      phase: act.phase, stake: act.stake, inputs: Object.assign({}, act.inputs),
      data: Object.assign({}, act.data), balances: act.balances || null, result: act.result || null
    };
    const reg = Registry[act.kind];
    if (reg && reg.redact) return reg.redact(out);
    return out;
  }

  snapshot() {
    return {
      players: [...this.players.values()].map(p => ({
        id: p.id, name: p.name, pid: p.pid, seed: p.seed, x: p.x, y: p.y, dir: p.dir,
        anim: p.anim, status: p.status, seat: p.seat, emote: p.emote, emoteAt: p.emoteAt, balance: p.balance
      })),
      seats: [...this.occupancyEntries()],
      obj: Object.assign({}, this.objects),
      activity: this.serialize(this.activity)
    };
  }

  *occupancyEntries() {
    for (const s of SEATS) if (s.occupiedBy) yield [s.id, s.occupiedBy];
  }

  dirtyPlayers() {
    const list = [...this.players.values()].filter(p => p.dirty).map(p => ({
      id: p.id, x: p.x, y: p.y, dir: p.dir, anim: p.anim, status: p.status, seat: p.seat,
      name: p.name, emote: p.emote, emoteAt: p.emoteAt, balance: p.balance
    }));
    for (const p of this.players.values()) p.dirty = false;
    return list;
  }

  count() { return this.players.size; }
}
