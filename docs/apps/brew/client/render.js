import { WORLD, STATION, AVATAR_COLORS } from '../shared/constants.js';
import { Renderer as GLRenderer } from '../src/renderPlay.js';

const S = 40;
const CHAT_MS = 6500;

function scaleWorld(world) {
  const width = ((world && world.width) || WORLD.width) * S;
  const depth = ((world && world.depth) || WORLD.depth) * S;
  const stations = ((world && world.stations) || []).map((st) => ({
    id: st.id,
    x: st.x * S,
    machineZ: st.machineZ * S,
    standX: st.standX * S,
    standZ: st.standZ * S,
    approachX: st.approachX * S,
    approachZ: st.approachZ * S,
    facing: st.facing,
    occupiedBy: st.occupiedBy,
  }));
  const obstacles = ((world && world.obstacles) || []).map((o) => ({
    kind: o.kind,
    ref: o.ref,
    minX: o.minX * S,
    maxX: o.maxX * S,
    minZ: o.minZ * S,
    maxZ: o.maxZ * S,
  }));
  return { width, depth, stations, obstacles };
}

class PickCamera {
  constructor(renderer) {
    this.renderer = renderer;
  }

  screenToWorld(px, py) {
    const p = this.renderer.gl.groundAt(px, py);
    if (!p) return { x: WORLD.width / 2, z: WORLD.depth / 2 };
    return { x: p.x / S, z: p.z / S };
  }
}

export class Renderer {
  constructor(canvas, store) {
    this.canvas = canvas;
    this.store = store;
    this.selection = null;
    this.hover = null;
    this.particles = [];
    this._worldKey = null;
    this._emoteAt = new Map();
    this.camera = new PickCamera(this);
    this.gl = new GLRenderer(canvas, {
      world: scaleWorld(null),
      follow: false,
      orbitDrag: false,
    });
    window.addEventListener('resize', () => this.gl.resize());
  }

  _syncWorld() {
    const w = this.store.room && this.store.room.world;
    const width = (w && w.width) || WORLD.width;
    const depth = (w && w.depth) || WORLD.depth;
    const sc = (w && w.stations && w.stations.length) || 0;
    const oc = (w && w.obstacles && w.obstacles.length) || 0;
    const key = `${width}x${depth}:${sc}:${oc}`;
    if (key === this._worldKey) return;
    this._worldKey = key;
    this.gl.setWorld(scaleWorld(w));
  }

  _latestChat(now) {
    const map = new Map();
    for (const entry of this.store.chat) {
      if (now - entry.at > CHAT_MS) continue;
      map.set(entry.playerId, { text: entry.text, at: entry.at });
    }
    return map;
  }

  _mapPlayer(p, now, chatBy) {
    const mounted = p.stationId !== null && p.stationId !== undefined;
    const prev = this._emoteAt.get(p.id);
    if (p.emote && (!prev || prev.text !== p.emote)) {
      this._emoteAt.set(p.id, { text: p.emote, at: now });
    }
    const stamp = this._emoteAt.get(p.id);
    const dim = p.online === false;
    const base = p.name || p.username || 'Player';
    return {
      id: p.id,
      name: `${base}${p.ready ? ' *' : ''}${dim ? ' (off)' : ''}`,
      x: p.x * S,
      y: p.z * S,
      dir: p.facing || 0,
      anim: mounted ? 'sit' : p.anim === 'WALK' ? 'walk' : 'idle',
      status: mounted ? 'seated' : 'standing',
      color: p.color || AVATAR_COLORS[0],
      chat: chatBy ? chatBy.get(p.id) || null : null,
      emote: p.emote || null,
      emoteAt: stamp && stamp.text === p.emote ? stamp.at : 0,
      effects: p.effects || [],
      mischief: p.mischief,
    };
  }

  draw(now = Date.now()) {
    this._syncWorld();
    const inRoom = !!(this.store.room && this.store.self);
    const chatBy = inRoom ? this._latestChat(now) : null;
    const list = inRoom
      ? this.store.renderPlayers(now).map((p) => this._mapPlayer(p, now, chatBy))
      : [];
    const me = this.store.self
      ? list.find((m) => m.id === this.store.self.id) || null
      : null;
    this.gl.time = now / 1000;
    this.gl.draw(me, list, null, 0.016);
    if (this.gl.gl) this._drawExtras(now, list, me);
  }

  pickPlayer(worldX, worldZ, players) {
    let best = null;
    let bestDist = 1.2 * 1.2;
    for (const player of players) {
      const dx = player.x - worldX;
      const dz = player.z - worldZ;
      const d = dx * dx + dz * dz;
      if (d < bestDist) {
        bestDist = d;
        best = player;
      }
    }
    return best;
  }

  addBurst(worldX, worldZ, color, count = 10) {
    for (let i = 0; i < count; i += 1) {
      this.particles.push({
        x: worldX,
        z: worldZ,
        vx: (Math.random() - 0.5) * 3,
        vz: (Math.random() - 0.5) * 2,
        life: 700,
        born: Date.now(),
        color,
      });
    }
    if (this.particles.length > 300) this.particles.splice(0, this.particles.length - 300);
  }

  _drawExtras(now, list, me) {
    const g = this.gl;
    const o = g.octx;
    o.setTransform(g.dpr, 0, 0, g.dpr, 0, 0);
    o.textAlign = 'left';
    o.textBaseline = 'alphabetic';
    const world = this.store.room && this.store.room.world;
    if (world) {
      for (const st of world.stations) this._drawMachine(o, st, now);
    }
    this._drawAreas(o, now);
    this._drawSelection(o, list);
    this._drawPlayerExtras(o, list, me);
    this._drawParticles(o, now);
    this._drawEvent(o, now);
  }

  _drawMachine(o, st, now) {
    const g = this.gl;
    const machine = this.store.machines.get(st.id);
    const z = (st.machineZ + STATION.machineDepth / 2) * S + 3;
    const x0 = (st.x - STATION.machineWidth / 2) * S;
    const x1 = (st.x + STATION.machineWidth / 2) * S;
    const b0 = g.sp(x0, 40, z), b1 = g.sp(x1, 40, z);
    const t1 = g.sp(x1, 84, z), t0 = g.sp(x0, 84, z);
    if (!b0 || !b1 || !t1 || !t0) return;
    const q = (u, v) => ({
      x: (b0.x * (1 - u) + b1.x * u) * (1 - v) + (t0.x * (1 - u) + t1.x * u) * v,
      y: (b0.y * (1 - u) + b1.y * u) * (1 - v) + (t0.y * (1 - u) + t1.y * u) * v,
    });
    const quad = (u0, v0, u1, v1) => {
      const p1 = q(u0, v0), p2 = q(u1, v0), p3 = q(u1, v1), p4 = q(u0, v1);
      o.beginPath();
      o.moveTo(p1.x, p1.y);
      o.lineTo(p2.x, p2.y);
      o.lineTo(p3.x, p3.y);
      o.lineTo(p4.x, p4.y);
      o.closePath();
    };

    o.fillStyle = 'rgba(0,0,0,0.45)';
    quad(0.05, 0.0, 0.95, 1.0);
    o.fill();
    o.fillStyle = '#0a0d17';
    quad(0.07, 0.16, 0.93, 0.96);
    o.fill();

    const view = this.store.machineView(machine, now);
    for (let i = 0; i < 3; i += 1) {
      const u = 0.25 + i * 0.25;
      const c = q(u, 0.56);
      const e0 = q(u - 0.11, 0.56);
      const e1 = q(u + 0.11, 0.56);
      const r = Math.hypot(e1.x - e0.x, e1.y - e0.y) / 2;
      if (r < 2) continue;
      o.save();
      o.beginPath();
      o.arc(c.x, c.y, r, 0, Math.PI * 2);
      o.fillStyle = '#11162a';
      o.fill();
      o.clip();
      const reel = view && view.reels ? view.reels[i] : null;
      const angle = reel ? ((reel.angle % 360) * Math.PI) / 180 : 0;
      o.strokeStyle = reel && reel.stopped ? qualityColor(reel.quality) : '#5f6b96';
      o.lineWidth = Math.max(3, r * 0.22);
      o.beginPath();
      o.moveTo(c.x - Math.cos(angle) * r, c.y - Math.sin(angle) * r);
      o.lineTo(c.x + Math.cos(angle) * r, c.y + Math.sin(angle) * r);
      o.stroke();
      o.strokeStyle = 'rgba(255,255,255,0.55)';
      o.lineWidth = 2;
      o.beginPath();
      o.moveTo(c.x - r * 0.5, c.y);
      o.lineTo(c.x + r * 0.5, c.y);
      o.stroke();
      o.restore();
      o.strokeStyle = 'rgba(255,255,255,0.18)';
      o.lineWidth = 1.5;
      o.beginPath();
      o.arc(c.x, c.y, r, 0, Math.PI * 2);
      o.stroke();
      if (view && view.holds && view.holds[i]) {
        o.fillStyle = 'rgba(80,180,255,0.9)';
        o.font = `700 ${Math.max(8, Math.round(r * 0.6))}px Arial`;
        o.textAlign = 'center';
        o.textBaseline = 'middle';
        o.fillText('H', c.x, q(u, 0.9).y);
        o.textAlign = 'left';
        o.textBaseline = 'alphabetic';
      }
    }

    const heat = machine ? machine.heat : 0;
    o.fillStyle = 'rgba(0,0,0,0.6)';
    quad(0.12, 0.04, 0.88, 0.12);
    o.fill();
    const frac = Math.max(0, Math.min(100, heat)) / 100;
    if (frac > 0.01) {
      o.fillStyle = heat >= 90 ? '#ff4d3d' : heat >= 75 ? '#ff9d3d' : heat >= 50 ? '#ffd93d' : '#4fd07a';
      quad(0.12, 0.04, 0.12 + 0.76 * frac, 0.12);
      o.fill();
    }

    const top = g.sp(st.x * S, 96, z);
    if (top) {
      o.textAlign = 'center';
      o.textBaseline = 'alphabetic';
      o.font = '600 12px Arial';
      o.fillStyle = 'rgba(0,0,0,.85)';
      o.fillText(`#${st.id + 1}`, top.x + 1, top.y + 1);
      o.fillStyle = 'rgba(255,255,255,0.75)';
      o.fillText(`#${st.id + 1}`, top.x, top.y);
      if (machine && machine.ownerId) {
        const owner = this.store.players.get(machine.ownerId);
        if (owner && owner.name) {
          o.font = '500 11px Arial';
          o.fillStyle = owner.color || '#fff';
          o.fillText(owner.name.slice(0, 10), top.x, top.y + 14);
        }
      }
      if (machine && machine.overbrewDeadline && machine.overbrewDeadline > now) {
        const remain = Math.max(0, (machine.overbrewDeadline - now) / 1000);
        o.font = '800 14px Arial';
        o.fillStyle = '#ff5b45';
        o.fillText(remain.toFixed(1), top.x, top.y - 14);
      }
      o.textAlign = 'left';
      o.textBaseline = 'alphabetic';
    }
  }

  _drawAreas(o, now) {
    const g = this.gl;
    for (const area of this.store.areas || []) {
      if (area.until && area.until < now) continue;
      const r = (area.radius || 3) * S;
      const cx = (area.x != null ? area.x : WORLD.width / 2) * S;
      const cz = (area.z != null ? area.z : WORLD.depth / 2) * S;
      const c = g.sp(cx, 2, cz);
      const px = g.sp(cx + r, 2, cz);
      const pz = g.sp(cx, 2, cz + r);
      if (!c || !px || !pz) continue;
      const rx = Math.hypot(px.x - c.x, px.y - c.y);
      const rz = Math.hypot(pz.x - c.x, pz.y - c.y);
      if (rx < 2 || rz < 2 || rx > 3000) continue;
      o.save();
      o.translate(c.x, c.y);
      o.scale(rx / 64, rz / 64);
      const grd = o.createRadialGradient(0, 0, 0, 0, 0, 64);
      grd.addColorStop(0, 'rgba(130,150,175,0.40)');
      grd.addColorStop(1, 'rgba(130,150,175,0)');
      o.fillStyle = grd;
      o.beginPath();
      o.arc(0, 0, 64, 0, Math.PI * 2);
      o.fill();
      o.restore();
    }
  }

  _drawSelection(o, list) {
    const id = this.selection || this.hover;
    if (!id) return;
    const m = list.find((p) => p.id === id);
    if (!m) return;
    const g = this.gl;
    const c = g.sp(m.x, 1.5, m.y);
    const px = g.sp(m.x + 17, 1.5, m.y);
    const pz = g.sp(m.x, 1.5, m.y + 17);
    if (!c || !px || !pz) return;
    const rx = Math.hypot(px.x - c.x, px.y - c.y);
    const rz = Math.hypot(pz.x - c.x, pz.y - c.y);
    if (rx < 2 || rz < 2) return;
    o.strokeStyle = this.selection === id ? '#ffd76a' : 'rgba(255,255,255,0.6)';
    o.lineWidth = 2;
    o.beginPath();
    o.ellipse(c.x, c.y, rx, rz, 0, 0, Math.PI * 2);
    o.stroke();
  }

  _drawPlayerExtras(o, list, me) {
    const g = this.gl;
    for (const m of list) {
      if (!m.effects || !m.effects.length) continue;
      const base = g.sp(m.x, 34, m.y);
      if (!base) continue;
      let ex = base.x + 24;
      for (const kind of m.effects) {
        o.fillStyle = effectColor(kind);
        o.beginPath();
        o.arc(ex, base.y, 4, 0, Math.PI * 2);
        o.fill();
        ex += 9;
      }
    }
    if (me && me.mischief !== undefined) {
      const base = g.sp(me.x, 0, me.y);
      if (base) {
        const barW = 56;
        const barX = base.x - barW / 2;
        const barY = base.y + 6;
        o.fillStyle = 'rgba(0,0,0,0.5)';
        roundRect(o, barX, barY, barW, 5, 3);
        o.fill();
        o.fillStyle = '#a55fe0';
        roundRect(o, barX, barY, (barW * Math.min(100, me.mischief)) / 100, 5, 3);
        o.fill();
      }
    }
  }

  _drawParticles(o, now) {
    const g = this.gl;
    this.particles = this.particles.filter((p) => now - p.born < p.life);
    for (const p of this.particles) {
      const age = (now - p.born) / p.life;
      const c = g.sp((p.x + p.vx * age) * S, 12, (p.z + p.vz * age) * S);
      if (!c) continue;
      o.globalAlpha = 1 - age;
      o.fillStyle = p.color;
      o.beginPath();
      o.arc(c.x, c.y, 3, 0, Math.PI * 2);
      o.fill();
    }
    o.globalAlpha = 1;
  }

  _drawEvent(o, now) {
    const g = this.gl;
    const ev = this.store.room && this.store.room.activeEvent;
    if (!ev) return;
    const remain = (ev.endsAt || 0) - now;
    if (remain <= 0) return;
    o.save();
    o.globalAlpha = 0.12 + 0.05 * Math.sin(now / 300);
    o.fillStyle = ev.kind === 'HAPPY_HOUR' ? '#ffd93d' : '#4fd0ff';
    o.fillRect(0, 0, g.vw, g.vh);
    o.restore();
    o.fillStyle = 'rgba(255,255,255,0.85)';
    o.font = '700 13px Arial';
    o.textAlign = 'left';
    o.textBaseline = 'alphabetic';
    o.fillText(`${ev.kind} · ${Math.ceil(remain / 1000)}s`, 16, g.vh - 16);
  }
}

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function qualityColor(quality) {
  if (quality === 'PERFECT') return '#ffd93d';
  if (quality === 'GOOD') return '#4fd07a';
  if (quality === 'OK') return '#5fa8ff';
  return '#8b93ad';
}

function effectColor(kind) {
  switch (kind) {
    case 'SPLASH':
      return '#4fb4ff';
    case 'SMOKE':
      return '#8b8b8b';
    case 'JOLT':
      return '#ffe14f';
    case 'DING':
      return '#ff9de0';
    case 'COIN':
      return '#ffcf5c';
    case 'COOL':
      return '#66e0ff';
    default:
      return '#ffffff';
  }
}
