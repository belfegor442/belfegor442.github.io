import { MAX_PLAYERS, SPEED, RADIUS, MOVE_TOLERANCE, PROX, LIMITS, token } from './protocol.js';
import { getScene, listScenes } from './world.js';
import { ROOM_KINDS, VOTE_MS } from './scenes.js';
import { Registry } from './activities.js';
import { normalizeSkin } from './skins.js';
import {
  createMachine, machineView, startSpin, stopReel, cashoutOverbrew, failOverbrew,
  clampStake, winningsFor, decayHeat
} from './machine.js';

const clampAngle = a => (isFinite(a) ? Math.atan2(Math.sin(a), Math.cos(a)) : 0);
const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);

export class Host {
  constructor(room) {
    this.room = room;
    this.players = new Map();
    this.occupancy = new Map();
    this.activity = null;
    this.vote = null;          // { id, kind, by, startedAt, deadline, accepted, declined }
    this.machines = new Map(); // uid -> skill-stop session (src/machine.js)
    this.objects = { lights: false };
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
      skin: normalizeSkin(info.skin),
      scene: 'lobby',
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
    if (p.seat) {
      const W = getScene(p.scene) || getScene('lobby');
      const s = W && W.SEAT_BY_ID.get(p.seat);
      if (s && s.occupiedBy === uid) s.occupiedBy = null;
      p.seat = null;
    }
    msgs.push(...this.closeMachine(uid, false));
    if (this.vote) {
      if (this.vote.by === uid) { this.vote = null; msgs.push(this.emit('vote.close', { reason: 'starter-left' })); }
      else { this.vote.accepted.delete(uid); this.vote.declined.delete(uid); }
    }
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
    const W = getScene(p.scene);
    const r = W.move(p.x, p.y, tx, ty, RADIUS);
    const moved = Math.abs(r.x - p.x) > 0.01 || Math.abs(r.y - p.y) > 0.01;
    const dir = clampAngle(mv.dir);
    const anim = mv.anim === 'walk' ? 'walk' : 'idle';
    if (moved || dir !== p.dir || anim !== p.anim) p.dirty = true;
    p.x = r.x; p.y = r.y; p.dir = dir; p.anim = anim;
    return p;
  }

  sit(uid, seatId) {
    const p = this.players.get(uid);
    if (!p) return { error: 'unknown-player' };
    if (p.status !== 'standing') return { error: 'busy' };
    const W = getScene(p.scene);
    const s = W.SEAT_BY_ID.get(seatId);
    if (!s) return { error: 'no-seat' };
    if (s.occupiedBy && s.occupiedBy !== uid) return { error: 'taken' };
    if (Math.hypot(s.x - p.x, s.y - p.y) > PROX.interact + 10) return { error: 'too-far' };
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
    const W = getScene(p.scene);
    const s = W.SEAT_BY_ID.get(p.seat);
    if (s && s.occupiedBy === uid) s.occupiedBy = null;
    p.seat = null; p.status = 'standing'; p.anim = 'idle';
    // The seat sits on a chair (nav-blocked): pop to the nearest open cell so
    // the player doesn't come up frozen inside the furniture.
    const e = W.eject(p.x, p.y);
    p.x = e.x; p.y = e.y;
    p.dirty = true;
    return { ok: this.emit('stand', { uid, x: p.x, y: p.y }) };
  }

  emote(uid, key) {
    const p = this.players.get(uid);
    if (!p) return { error: 'unknown-player' };
    p.emote = clean(key, 24); p.emoteAt = Date.now(); p.dirty = true;
    return { ok: this.emit('emote', { uid, key: p.emote, at: p.emoteAt }) };
  }

  applySkin(uid, skin) {
    const p = this.players.get(uid);
    if (!p) return { error: 'unknown-player' };
    const id = normalizeSkin(skin);
    if (p.skin === id) return null;
    p.skin = id; p.dirty = true;
    return { ok: this.emit('skin', { uid, skin: id }) };
  }

  chat(uid, text) {
    const p = this.players.get(uid);
    const body = clean(text, LIMITS.chat);
    if (!p || !body) return { error: 'empty' };
    const to = [uid];
    for (const o of this.players.values()) {
      if (o.id === uid || o.scene !== p.scene) continue;
      if (Math.hypot(o.x - p.x, o.y - p.y) <= PROX.chat) to.push(o.id);
    }
    return { ok: this.emit('chat', { uid, text: body, to, at: Date.now() }) };
  }

  objectState(uid, id, val) {
    const p = this.players.get(uid);
    if (!p) return { error: 'unknown-player' };
    const W = getScene(p.scene);
    const o = W.OBJ_BY_ID.get(id);
    if (!o) return { error: 'unknown-object' };
    if (o.type !== 'switch') return { error: 'not-interactive' };
    if (Math.hypot(o.x + o.w / 2 - p.x, o.y + o.h / 2 - p.y) > PROX.interact + 60) return { error: 'too-far' };
    this.objects.lights = !!val;
    p.dirty = true;
    return { ok: this.emit('obj', { id, val: !!val, by: uid }) };
  }

  // --- room votes ---------------------------------------------------------
  // Standing in the lobby next to a game's vote point starts a timed vote.
  // Majority of the lobby (accepted > lobbyCount / 2, no auto-accept) teleports
  // EVERYONE in the lobby — decliners and non-voters included — into the room.

  serializeVote() {
    const v = this.vote;
    if (!v) return null;
    return {
      id: v.id, kind: v.kind, by: v.by, deadline: v.deadline,
      accepted: [...v.accepted], declined: [...v.declined]
    };
  }

  lobbyPlayers() {
    return [...this.players.values()].filter(p => p.scene === 'lobby');
  }

  startVote(uid, kind) {
    const p = this.players.get(uid);
    if (!p) return { error: 'unknown-player' };
    if (p.scene !== 'lobby') return { error: 'wrong-scene' };
    if (p.status !== 'standing') return { error: 'busy' };
    if (!ROOM_KINDS.includes(kind)) return { error: 'unknown-activity' };
    if (this.vote) return { error: 'vote-running' };
    if (this.activity) return { error: 'activity-running' };
    const W = getScene('lobby');
    const near = W.nearestVotePoint(p.x, p.y, PROX.interact + 10);
    if (!near || near.kind !== kind) return { error: 'too-far' };
    this.vote = {
      id: 'vote-' + (++this.seq) + '-' + Date.now().toString(36),
      kind, by: uid,
      startedAt: Date.now(),
      deadline: Date.now() + VOTE_MS,
      accepted: new Set(),
      declined: new Set()
    };
    return { ok: this.emit('vote.open', this.serializeVote()) };
  }

  castVote(uid, accept) {
    const v = this.vote;
    if (!v) return { error: 'no-vote' };
    const p = this.players.get(uid);
    if (!p || p.scene !== 'lobby') return { error: 'wrong-scene' };
    if (v.accepted.has(uid) || v.declined.has(uid)) return { error: 'already-voted' };
    if (accept) v.accepted.add(uid); else v.declined.add(uid);
    const msgs = [];
    const pass = this.checkVote();
    if (pass) msgs.push(...pass);
    else msgs.push(this.emit('vote.update', this.serializeVote()));
    return { msgs };
  }

  checkVote() {
    const v = this.vote;
    if (!v) return null;
    const lobby = this.lobbyPlayers();
    const yes = lobby.filter(p => v.accepted.has(p.id)).length;
    if (yes * 2 > lobby.length) return this.passVote();
    return null;
  }

  passVote() {
    const v = this.vote;
    this.vote = null;
    const kind = v.kind;
    const room = getScene(kind);
    const lobby = getScene('lobby');
    const msgs = [this.emit('vote.close', { id: v.id, kind, passed: true })];
    const moved = [];
    let i = 0;
    for (const p of this.players.values()) {
      if (p.scene !== 'lobby') continue;
      if (p.seat) {
        const s = lobby.SEAT_BY_ID.get(p.seat);
        if (s && s.occupiedBy === p.id) s.occupiedBy = null;
        p.seat = null;
      }
      msgs.push(...this.closeMachine(p.id, false));
      const sp = room.SPAWNS[i % room.SPAWNS.length]; i++;
      const e = room.eject(sp.x, sp.y);
      p.scene = kind; p.x = e.x; p.y = e.y;
      p.status = 'standing'; p.anim = 'idle'; p.dirty = true;
      moved.push({ id: p.id, x: p.x, y: p.y });
    }
    msgs.push(this.emit('scene.teleport', { scene: kind, players: moved }));
    return msgs;
  }

  // Standing in front of a room's EXIT portal returns that player to the lobby.
  exitRoom(uid) {
    const p = this.players.get(uid);
    if (!p) return { error: 'unknown-player' };
    if (p.scene === 'lobby') return { error: 'wrong-scene' };
    if (p.status !== 'standing') return { error: 'busy' };
    if (this.activity && this.activity.players.includes(uid)) return { error: 'in-activity' };
    const room = getScene(p.scene);
    const portal = room.nearestPortal(p.x, p.y, PROX.interact + 24);
    if (!portal) return { error: 'too-far' };
    const msgs = this.closeMachine(uid, false);
    const lobby = getScene('lobby');
    const e = lobby.eject(lobby.SPAWNS[0].x, lobby.SPAWNS[0].y);
    p.scene = 'lobby'; p.x = e.x; p.y = e.y; p.dirty = true;
    msgs.push(this.emit('scene.teleport', { scene: 'lobby', players: [{ id: p.id, x: p.x, y: p.y }] }));
    return { msgs };
  }

  // --- skill-stop machines (rooms/slots only) ------------------------------

  machineStart(uid, kind, stake) {
    const p = this.players.get(uid);
    if (!p) return { error: 'unknown-player' };
    if (kind !== 'slots' || p.scene !== 'slots') return { error: 'wrong-scene' };
    if (p.status !== 'standing') return { error: 'busy' };
    if (this.machines.has(uid)) return { error: 'busy' };
    const W = getScene(p.scene);
    const cab = W.nearestMachine(p.x, p.y, PROX.interact + 10);
    if (!cab) return { error: 'too-far' };
    const st = clampStake(stake);
    if (p.balance < st) return { error: 'no-balance' };
    const s = createMachine(uid, st, cab.id);
    this.machines.set(uid, s);
    p.status = 'machine'; p.dirty = true;
    return { ok: this.emit('machine.open', Object.assign({ uid }, machineView(s, Date.now()))) };
  }

  machineSpin(uid, stake) {
    const p = this.players.get(uid);
    const s = this.machines.get(uid);
    if (!p || !s) return { error: 'no-machine' };
    if (p.status !== 'machine') return { error: 'no-machine' };
    const st = clampStake(stake != null ? stake : s.stake);
    if (p.balance < st) return { error: 'no-balance' };
    s.stake = st;
    const now = Date.now();
    const r = startSpin(s, now);
    if (r.error) return { error: r.error };
    p.balance -= st; p.dirty = true;
    return { ok: this.emit('machine.spin', Object.assign({ uid }, machineView(s, now))) };
  }

  machineStop(uid, reel, latencyMs) {
    const s = this.machines.get(uid);
    if (!s) return { error: 'no-machine' };
    const now = Date.now();
    const r = stopReel(s, now, reel, latencyMs);
    if (r.error) return { error: r.error };
    const p = this.players.get(uid);
    const out = Object.assign({ uid }, machineView(s, now), {
      stop: { reel: Number(reel), quality: r.quality, gained: r.gained }
    });
    if (r.result) {
      const win = winningsFor(s, r.result);
      s.score += win;
      if (p) { p.balance += win; p.dirty = true; }
      out.result = { total: r.result.total, mult: r.result.mult, winnings: win, delta: win - s.stake };
    }
    return { msgs: [this.emit('machine.update', out)] };
  }

  machineCashout(uid) {
    const s = this.machines.get(uid);
    if (!s) return { error: 'no-machine' };
    const now = Date.now();
    const r = cashoutOverbrew(s, now);
    if (r.error) return { error: r.error };
    const win = winningsFor(s, r);
    s.score += win;
    const p = this.players.get(uid);
    if (p) { p.balance += win; p.dirty = true; }
    return { ok: this.emit('machine.update', Object.assign({ uid }, machineView(s, now), {
      result: { total: r.total, mult: r.mult, winnings: win, delta: win - s.stake }
    })) };
  }

  closeMachine(uid, emit) {
    const s = this.machines.get(uid);
    if (!s) return [];
    this.machines.delete(uid);
    const p = this.players.get(uid);
    if (p && p.status === 'machine') {
      p.status = p.seat ? 'seated' : 'standing';
      p.dirty = true;
    }
    return emit ? [this.emit('machine.close', { uid })] : [];
  }

  // --- table activities ----------------------------------------------------

  startActivity(kind, uid, opts = {}) {
    const reg = Registry[kind];
    if (!reg) return { error: 'unknown-activity' };
    if (this.activity) return { error: 'activity-running' };
    const p = this.players.get(uid);
    if (!p) return { error: 'unknown-player' };
    if (reg.scene && p.scene !== reg.scene) return { error: 'wrong-scene' };
    if (!p.seat || p.status !== 'seated') return { error: 'must-sit' };
    const W = getScene(p.scene);
    const seat = W.SEAT_BY_ID.get(p.seat);
    const table = seat && seat.table;
    if (!table) return { error: 'no-table' };
    const players = W.seatsAt(table).map(s => s.occupiedBy).filter(Boolean);
    const need = Math.max(1, Number(reg.minPlayers) || 2);
    if (players.length < need) return { error: need <= 1 ? 'need-one-player' : 'need-two-players' };
    if (players.some(id => { const pl = this.players.get(id); return !pl || pl.status === 'activity'; })) return { error: 'need-two-players' };
    const act = {
      id: kind + '-' + (++this.seq) + '-' + Date.now().toString(36),
      kind, table, players, phase: 'picking',
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
    const msgs = [];
    if (this.vote && now > this.vote.deadline) {
      const v = this.vote;
      this.vote = null;
      msgs.push(this.emit('vote.close', { id: v.id, kind: v.kind, passed: false }));
    }
    for (const [uid, s] of this.machines) {
      decayHeat(s, now);
      if (s.phase === 'overbrew' && now > s.overbrewDeadline) {
        const r = failOverbrew(s, now);
        if (r) {
          const win = winningsFor(s, r);
          s.score += win;
          const p = this.players.get(uid);
          if (p) { p.balance += win; p.dirty = true; }
          msgs.push(this.emit('machine.update', Object.assign({ uid }, machineView(s, now), {
            result: { total: r.total, mult: r.mult, winnings: win, delta: win - s.stake },
            over: true
          })));
        }
      }
    }
    const act = this.activity;
    if (act) {
      if (act.phase === 'result' && now - act.resultAt > 3400) msgs.push(...this.endActivity('done'));
      else if (now - act.startedAt > 120000) msgs.push(...this.endActivity('timeout'));
    }
    return msgs;
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
        id: p.id, name: p.name, pid: p.pid, seed: p.seed, skin: p.skin, scene: p.scene,
        x: p.x, y: p.y, dir: p.dir, anim: p.anim, status: p.status, seat: p.seat,
        emote: p.emote, emoteAt: p.emoteAt, balance: p.balance
      })),
      seats: [...this.occupancyEntries()],
      obj: Object.assign({}, this.objects),
      activity: this.serialize(this.activity),
      vote: this.serializeVote()
    };
  }

  *occupancyEntries() {
    for (const id of listScenes()) {
      const w = getScene(id);
      if (!w) continue;
      for (const s of w.SEATS) if (s.occupiedBy) yield [s.id, s.occupiedBy];
    }
  }

  dirtyPlayers() {
    const list = [...this.players.values()].filter(p => p.dirty).map(p => ({
      id: p.id, x: p.x, y: p.y, dir: p.dir, anim: p.anim, status: p.status, seat: p.seat,
      scene: p.scene, name: p.name, emote: p.emote, emoteAt: p.emoteAt, balance: p.balance, skin: p.skin
    }));
    for (const p of this.players.values()) p.dirty = false;
    return list;
  }

  count() { return this.players.size; }
}
