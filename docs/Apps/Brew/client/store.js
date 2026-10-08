import { PLAYER, WORLD, EFFECTS, MACHINE } from '../shared/constants.js';
import { reelAngleAt, heatTier, speedMultiplierForHeat, comboMultiplier } from '../shared/machineMath.js';

const INTERP_DELAY_MS = 100;
const SELF_SMOOTHING = 12;
const MAX_CHAT = 80;
const MAX_TOASTS = 24;

export class BrewStore {
  constructor() {
    this.room = null;
    this.players = new Map();
    this.machines = new Map();
    this.self = null;
    this.pending = [];
    this.social = { spectating: [], pairs: [], challenges: [], takeovers: [] };
    this.areas = [];
    this.chat = [];
    this.toasts = [];
    this.roomList = [];
    this.events = [];
    this.clockOffset = 0;
    this.intent = { dx: 0, dz: 0 };
    this.listeners = new Map();
    this.dirty = true;
    this.lastStateAt = 0;
  }

  on(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(handler);
    return () => this.listeners.get(type).delete(handler);
  }

  emit(type, payload) {
    const set = this.listeners.get(type);
    if (!set) return;
    for (const handler of set) handler(payload);
  }

  reset() {
    this.room = null;
    this.players.clear();
    this.machines.clear();
    this.self = null;
    this.pending = [];
    this.social = { spectating: [], pairs: [], challenges: [], takeovers: [] };
    this.areas = [];
    this.dirty = true;
    this.emit('room', null);
  }

  serverNow() {
    return Date.now() + this.clockOffset;
  }

  applySnapshot(msg) {
    const snap = msg.payload;
    if (msg.serverTime) this.clockOffset = msg.serverTime - Date.now();
    this.room = snap.room;
    this.self = snap.self;
    this.pending = snap.pending || [];
    this.social = normalizeSocial(snap.social);
    this.areas = snap.areas || [];

    const seen = new Set();
    for (const pub of snap.players || []) {
      seen.add(pub.id);
      const existing = this.players.get(pub.id);
      if (existing) adopt(existing, pub, true);
      else this.players.set(pub.id, makePlayer(pub, true));
    }
    for (const id of [...this.players.keys()]) {
      if (!seen.has(id)) this.players.delete(id);
    }
    for (const machine of snap.machines || []) this.machines.set(machine.stationId, machine);

    this.lastStateAt = Date.now();
    this.dirty = true;
    this.emit('snapshot', snap);
    this.emit('room', this.room);
    this.emit('players', this);
    this.emit('machines', this);
  }

  applyState(msg) {
    const payload = msg.payload || {};
    if (msg.serverTime) this.clockOffset = msg.serverTime - Date.now();
    for (const pub of payload.players || []) {
      const existing = this.players.get(pub.id);
      if (existing) adopt(existing, pub, false);
      else this.players.set(pub.id, makePlayer(pub, false));
    }
    if (payload.areas) this.areas = payload.areas;
    if (this.self) {
      const me = this.players.get(this.self.id);
      if (me) {
        this.self.stationId = me.stationId;
        this.self.mischief = me.mischief;
        this.self.stats = me.stats;
        this.self.ready = me.ready;
        this.self.host = me.host;
        this.self.score = me.score;
        this.self.online = me.online;
      }
    }
    this.lastStateAt = Date.now();
    this.dirty = true;
    this.emit('players', this);
  }

  applyEvent(msg) {
    const { event, payload = {} } = msg;
    switch (event) {
      case 'ROOM_SNAPSHOT':
        break;
      case 'PLAYER_JOINED':
        if (payload.player && !this.players.has(payload.player.id)) {
          this.players.set(payload.player.id, makePlayer(payload.player, true));
        }
        break;
      case 'PLAYER_LEFT':
        this.players.delete(payload.playerId);
        break;
      case 'PLAYER_DISCONNECTED': {
        const p = this.players.get(payload.playerId);
        if (p) p.online = false;
        break;
      }
      case 'PLAYER_RECONNECTED': {
        const p = this.players.get(payload.playerId);
        if (p) p.online = true;
        break;
      }
      case 'MACHINE_SYNC':
      case 'MACHINE_SPIN':
      case 'MACHINE_STOP':
      case 'MACHINE_HOLD':
      case 'MACHINE_ROUND_END':
      case 'MACHINE_SPIN_UPDATE':
      case 'MACHINE_OVERBREW_START':
      case 'MACHINE_OVERBREW_SUCCESS':
      case 'MACHINE_OVERBREW_FAIL':
      case 'MACHINE_STUN':
      case 'MACHINE_COMBO_BREAK':
      case 'MACHINE_HEAT_CHANGED':
      case 'MACHINE_CLEANED':
        this.applyMachineEvent(event, payload);
        break;
      case 'CHAT':
        this.chat.push({
          id: `${msg.roomSequence}-${payload.playerId}`,
          playerId: payload.playerId,
          name: payload.name,
          text: payload.text,
          at: payload.at || Date.now(),
        });
        if (this.chat.length > MAX_CHAT) this.chat.splice(0, this.chat.length - MAX_CHAT);
        this.emit('chat', this.chat);
        break;
      case 'MISCHIEF_CHANGED': {
        const p = this.players.get(payload.playerId);
        if (p) p.mischief = payload.mischief;
        if (this.self && this.self.id === payload.playerId) this.self.mischief = payload.mischief;
        this.emit('players', this);
        break;
      }
      case 'INTERACTION_REQUEST':
        this.pending.push({
          pendingId: payload.pendingId,
          kind: payload.kind,
          fromId: payload.fromId,
          toId: payload.toId,
          fromName: payload.fromName,
          expiresAt: payload.expiresAt,
          meta: payload.meta || {},
          incoming: this.self ? payload.toId === this.self.id : false,
        });
        this.emit('pending', this.pending);
        break;
      case 'INTERACTION_DECLINED':
      case 'INTERACTION_EXPIRED':
        this.pending = this.pending.filter(
          (p) => p.pendingId !== (payload.pendingId || payload.id),
        );
        this.emit('pending', this.pending);
        break;
      case 'PAIR_STARTED':
        this.toast(`${payload.kind === 'TEACH_REQUEST' ? 'Lesson' : 'Practice'} started`, 'info');
        this.emit('social', this.social);
        break;
      case 'PAIR_ENDED':
        this.toast('Pair ended', 'info');
        this.emit('social', this.social);
        break;
      case 'CHALLENGE_STARTED':
        this.toast('Challenge started!', 'warn');
        this.emit('social', this.social);
        break;
      case 'CHALLENGE_RESULT': {
        const winnerIsMe = this.self && payload.winner === this.self.id;
        this.toast(
          payload.winner ? (winnerIsMe ? 'You won the challenge!' : 'You lost the challenge') : 'Challenge draw',
          winnerIsMe ? 'good' : 'warn',
        );
        this.emit('social', this.social);
        break;
      }
      case 'TAKEOVER_STARTED':
        this.toast('Machine hijacked!', 'warn');
        break;
      case 'TAKEOVER_ENDED':
        this.toast('Machine restored', 'info');
        break;
      case 'SABOTAGE_HIT':
      case 'SABOTAGE_THROWN':
      case 'MACHINE_EVENT':
      case 'STATION_MOUNTED':
      case 'STATION_DISMOUNTED':
      case 'ROOM_PHASE':
        if (event === 'ROOM_PHASE' && this.room) this.room.phase = payload.phase;
        else if (event === 'STATION_MOUNTED' && payload.machine) {
          this.machines.set(payload.machine.stationId, payload.machine);
          this.emit('machines', this);
        }
        break;
      case 'ROOM_EVENT_START':
        this.toast(`${prettyEvent(payload.kind)}!`, 'good');
        break;
      case 'ROOM_EVENT_END':
        break;
      case 'PLAYER_READY':
        break;
      case 'ACHIEVEMENT_UNLOCKED':
        this.toast(`Achievement: ${payload.achievement ? payload.achievement.name : ''}`, 'good');
        break;
      default:
        break;
    }
    this.events.push({ event, payload, at: Date.now() });
    if (this.events.length > 200) this.events.shift();
    this.emit('event', { event, payload });
    this.dirty = true;
  }

  applyMachineEvent(event, payload) {
    if (!payload || typeof payload.stationId !== 'number') return;
    let machine = this.machines.get(payload.stationId);
    if (!machine) {
      machine = { stationId: payload.stationId, phase: 'IDLE', score: 0, combo: 0, heat: 0, reels: [], holds: [false, false, false] };
      this.machines.set(payload.stationId, machine);
    }
    for (const key of Object.keys(payload)) {
      if (payload[key] !== undefined) machine[key] = payload[key];
    }
    if (event === 'MACHINE_SPIN') {
      machine.phase = 'SPINNING';
      if (Array.isArray(machine.reels)) {
        for (const reel of machine.reels) {
          reel.stopped = false;
          reel.quality = null;
        }
      }
    } else if (event === 'MACHINE_STOP' && typeof payload.reel === 'number' && Array.isArray(machine.reels)) {
      const reel = machine.reels[payload.reel];
      if (reel) {
        reel.stopped = true;
        reel.angle = payload.angle;
        reel.quality = payload.quality;
      }
      if (payload.phase) machine.phase = payload.phase;
    } else if (event === 'MACHINE_ROUND_END') {
      machine.phase = payload.phase || 'IDLE';
      machine.spin = null;
      machine.activeReel = -1;
      if (Array.isArray(machine.reels)) {
        for (const reel of machine.reels) {
          reel.stopped = false;
          reel.quality = null;
        }
      }
    } else if (event === 'MACHINE_OVERBREW_SUCCESS' || event === 'MACHINE_OVERBREW_FAIL') {
      machine.phase = payload.phase || 'IDLE';
      if (event === 'MACHINE_OVERBREW_FAIL' && Array.isArray(machine.reels)) {
        for (const reel of machine.reels) {
          reel.stopped = false;
          reel.quality = null;
        }
      }
    }
    this.emit('machines', this);
  }

  toast(text, kind = 'info') {
    const item = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, text, kind, at: Date.now() };
    this.toasts.push(item);
    if (this.toasts.length > MAX_TOASTS) this.toasts.shift();
    this.emit('toast', item);
    return item;
  }

  setIntent(dx, dz) {
    this.intent.dx = dx;
    this.intent.dz = dz;
  }

  tick(dtMs, now = Date.now()) {
    const me = this.self ? this.players.get(this.self.id) : null;
    if (me && me.stationId === null && me.online !== false) {
      const { dx, dz } = this.intent;
      const mag = Math.hypot(dx, dz);
      if (mag > 0.01) {
        const nx = dx / Math.max(1, mag);
        const nz = dz / Math.max(1, mag);
        const speed = PLAYER.speed * speedFromEffects(me.effects);
        const step = (speed * dtMs) / 1000;
        me.predX = clamp(me.predX + nx * step, WORLD.minX + PLAYER.radius, WORLD.maxX - PLAYER.radius);
        me.predZ = clamp(me.predZ + nz * step, WORLD.minZ + PLAYER.radius, WORLD.maxZ - PLAYER.radius);
        me.anim = 'WALK';
        me.facing = Math.atan2(nz, nx);
      } else if (me.anim === 'WALK') {
        me.anim = 'IDLE';
      }
      const k = Math.min(1, (SELF_SMOOTHING * dtMs) / 1000);
      me.renderX += (me.predX - me.renderX) * k;
      me.renderZ += (me.predZ - me.renderZ) * k;
    }
    for (const player of this.players.values()) {
      if (this.self && player.id === this.self.id) continue;
      interpolate(player, now - INTERP_DELAY_MS);
    }
    this.dirty = true;
  }

  renderPlayers(now = Date.now()) {
    const out = [];
    for (const player of this.players.values()) {
      if (this.self && player.id === this.self.id) {
        out.push({ ...player, x: player.renderX, z: player.renderZ });
      } else {
        interpolate(player, now - INTERP_DELAY_MS);
        out.push({ ...player, x: player.renderX, z: player.renderZ });
      }
    }
    return out;
  }

  machineView(machine, now = Date.now()) {
    if (!machine) return null;
    const heat = machine.heat;
    const spin = machine.spin;
    const reels = (machine.reels || []).map((reel) => {
      let angle = reel.angle;
      if (spin && spin.reels && spin.reels[reel.i] && !reel.stopped) {
        const sample = spin.reels[reel.i];
        const elapsed = now - (spin.startedAt + this.clockOffset);
        angle = reelAngleAt({ ...spin, startedAt: spin.startedAt + this.clockOffset }, reel.i, Math.max(0, elapsed));
        void sample;
      }
      return { ...reel, angle };
    });
    return {
      ...machine,
      reels,
      tier: heatTier(heat),
      heatMult: speedMultiplierForHeat(heat),
      comboMult: comboMultiplier(machine.combo),
      overbrewRisk: heat >= MACHINE.heat.riskAt,
    };
  }

  roomSummary() {
    if (!this.room) return null;
    return {
      code: this.room.code,
      name: this.room.name,
      phase: this.room.phase,
      players: this.players.size,
      maxPlayers: this.room.maxPlayers,
      host: this.self ? this.self.host : false,
      activeEvent: this.room.activeEvent,
    };
  }
}

function makePlayer(pub, immediate) {
  const player = {
    ...pub,
    color: colorOf(pub),
    samples: [],
    renderX: pub.x,
    renderZ: pub.z,
    predX: pub.x,
    predZ: pub.z,
    online: pub.status !== 'DISCONNECTED',
    effects: pub.effects || [],
  };
  player.samples.push({ t: Date.now(), x: pub.x, z: pub.z, facing: pub.facing, anim: pub.anim });
  if (immediate) {
    player.renderX = pub.x;
    player.renderZ = pub.z;
    player.predX = pub.x;
    player.predZ = pub.z;
  }
  return player;
}

function adopt(existing, pub, immediate) {
  existing.x = pub.x;
  existing.z = pub.z;
  existing.anim = pub.anim;
  existing.facing = pub.facing;
  existing.status = pub.status;
  existing.stationId = pub.stationId;
  existing.mischief = pub.mischief;
  existing.effects = pub.effects || [];
  existing.emote = pub.emote;
  existing.host = pub.host;
  existing.ready = pub.ready;
  existing.spectating = pub.spectating;
  existing.online = pub.status !== 'DISCONNECTED';
  existing.name = pub.name;
  existing.color = colorOf(pub);
  existing.score = pub.score;
  const last = existing.samples[existing.samples.length - 1];
  if (!last || Math.abs(last.x - pub.x) > 1e-4 || Math.abs(last.z - pub.z) > 1e-4) {
    existing.samples.push({ t: Date.now(), x: pub.x, z: pub.z, facing: pub.facing, anim: pub.anim });
    if (existing.samples.length > 12) existing.samples.shift();
  }
  if (immediate) {
    existing.renderX = pub.x;
    existing.renderZ = pub.z;
    existing.predX = pub.x;
    existing.predZ = pub.z;
    existing.samples = [{ t: Date.now(), x: pub.x, z: pub.z, facing: pub.facing, anim: pub.anim }];
  }
}

function interpolate(player, renderAt) {
  const samples = player.samples;
  if (!samples || samples.length === 0) return;
  if (samples.length === 1) {
    player.renderX = samples[0].x;
    player.renderZ = samples[0].z;
    return;
  }
  for (let i = 0; i < samples.length - 1; i += 1) {
    const a = samples[i];
    const b = samples[i + 1];
    if (renderAt <= a.t) {
      player.renderX = a.x;
      player.renderZ = a.z;
      return;
    }
    if (renderAt <= b.t) {
      const span = Math.max(1, b.t - a.t);
      const k = (renderAt - a.t) / span;
      player.renderX = a.x + (b.x - a.x) * k;
      player.renderZ = a.z + (b.z - a.z) * k;
      player.facing = b.facing;
      return;
    }
  }
  const last = samples[samples.length - 1];
  const age = Date.now() - last.t;
  if (age > 700) {
    player.renderX = last.x;
    player.renderZ = last.z;
    if (player.anim === 'WALK') player.anim = 'IDLE';
    return;
  }
  player.renderX = last.x;
  player.renderZ = last.z;
}

function speedFromEffects(effects) {
  let mult = 1;
  for (const kind of effects || []) {
    const def = EFFECTS[kind];
    if (def && def.speedMult) mult *= def.speedMult;
  }
  return mult;
}

function colorOf(pub) {
  if (pub.color) return pub.color;
  if (pub.avatar && pub.avatar.color) return pub.avatar.color;
  return '#e0533f';
}

function normalizeSocial(social) {
  if (!social) return { spectating: [], pairs: [], challenges: [], takeovers: [] };
  return {
    spectating: social.spectating || [],
    pairs: social.pairs || [],
    challenges: social.challenges || [],
    takeovers: social.takeovers || [],
  };
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

function prettyEvent(kind) {
  return String(kind || '')
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
