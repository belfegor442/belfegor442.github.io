import { WORLD, STATION, PLAYER, AVATAR_COLORS } from '../shared/constants.js';

const SQUASH = 0.66;

export class Camera {
  constructor() {
    this.scale = 40;
    this.offsetX = 0;
    this.offsetY = 0;
    this.width = 800;
    this.height = 600;
  }

  resize(width, height) {
    this.width = width;
    this.height = height;
    const margin = 1.5;
    const sx = width / (WORLD.width + margin * 2);
    const sy = height / ((WORLD.depth + margin * 2) * SQUASH);
    this.scale = Math.min(sx, sy);
    this.offsetX = width / 2 - (WORLD.width / 2) * this.scale;
    this.offsetY = height / 2 - (WORLD.depth / 2) * this.scale * SQUASH + height * 0.03;
  }

  worldToScreen(x, z) {
    return {
      x: x * this.scale + this.offsetX,
      y: z * this.scale * SQUASH + this.offsetY,
    };
  }

  screenToWorld(sx, sy) {
    return {
      x: (sx - this.offsetX) / this.scale,
      z: (sy - this.offsetY) / (this.scale * SQUASH),
    };
  }

  unit(dy = 1) {
    return { x: this.scale, y: this.scale * SQUASH * dy };
  }
}

export class Renderer {
  constructor(canvas, store) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.store = store;
    this.camera = new Camera();
    this.selection = null;
    this.hover = null;
    this.particles = [];
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(320, Math.floor(rect.width || window.innerWidth));
    const height = Math.max(240, Math.floor(rect.height || window.innerHeight));
    this.canvas.width = Math.floor(width * dpr);
    this.canvas.height = Math.floor(height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.cssWidth = width;
    this.cssHeight = height;
    this.camera.resize(width, height);
  }

  worldToScreen(x, z) {
    return this.camera.worldToScreen(x, z);
  }

  screenToWorld(x, y) {
    return this.camera.screenToWorld(x, y);
  }

  draw(now = Date.now()) {
    const ctx = this.ctx;
    const store = this.store;
    ctx.clearRect(0, 0, this.cssWidth, this.cssHeight);
    this.drawBackdrop(ctx);
    this.drawFloor(ctx, now);
    this.drawAreaEffects(ctx, store.areas, now);

    const drawables = [];
    for (const obstacle of this._obstacles()) drawables.push({ z: (obstacle.minZ + obstacle.maxZ) / 2, kind: 'obstacle', data: obstacle });
    const stations = this._stations();
    for (const station of stations) {
      drawables.push({ z: station.machineZ + 0.4, kind: 'station', data: station });
    }
    for (const player of store.renderPlayers(now)) {
      drawables.push({ z: player.z, kind: 'player', data: player });
    }
    drawables.sort((a, b) => a.z - b.z);
    for (const item of drawables) {
      if (item.kind === 'obstacle') this.drawObstacle(ctx, item.data);
      else if (item.kind === 'station') this.drawStation(ctx, item.data, now);
      else this.drawPlayer(ctx, item.data, now);
    }

    this.drawParticles(ctx, now);
    this.drawRoomEventOverlay(ctx, store.room, now);
    this.drawVignette(ctx);
  }

  _obstacles() {
    if (this.store.room && this.store.room.world) return this.store.room.world.obstacles || [];
    return [];
  }

  _stations() {
    if (this.store.room && this.store.room.world) return this.store.room.world.stations || [];
    return [];
  }

  drawBackdrop(ctx) {
    const g = ctx.createLinearGradient(0, 0, 0, this.cssHeight);
    g.addColorStop(0, '#0b0f1a');
    g.addColorStop(1, '#141a2b');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.cssWidth, this.cssHeight);
  }

  drawFloor(ctx, now) {
    const tl = this.worldToScreen(0, 0);
    const br = this.worldToScreen(WORLD.width, WORLD.depth);
    ctx.save();
    ctx.fillStyle = '#1d2233';
    ctx.fillRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);

    ctx.strokeStyle = 'rgba(255,255,255,0.045)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= WORLD.width; x += 1) {
      const a = this.worldToScreen(x, 0);
      const b = this.worldToScreen(x, WORLD.depth);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    for (let z = 0; z <= WORLD.depth; z += 1) {
      const a = this.worldToScreen(0, z);
      const b = this.worldToScreen(WORLD.width, z);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 2;
    ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);

    const sign = this.worldToScreen(WORLD.width / 2, 0.35);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.font = `700 ${Math.max(10, this.camera.scale * 0.32)}px "Segoe UI", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('BREW  BAR', sign.x, sign.y);
    ctx.restore();
    void now;
  }

  drawObstacle(ctx, box) {
    const a = this.worldToScreen(box.minX, box.minZ);
    const b = this.worldToScreen(box.maxX, box.maxZ);
    const w = b.x - a.x;
    const h = b.y - a.y;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    roundRect(ctx, a.x + 3, a.y + 5, w, h, 6);
    ctx.fill();
    if (box.kind === 'bar') {
      ctx.fillStyle = '#4a3222';
      roundRect(ctx, a.x, a.y, w, h, 6);
      ctx.fill();
      ctx.fillStyle = '#6b4a30';
      ctx.fillRect(a.x + 4, a.y + 4, w - 8, Math.max(3, h * 0.25));
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(a.x + 4, a.y + h - 8, w - 8, 4);
    } else {
      ctx.fillStyle = '#3a2f4a';
      roundRect(ctx, a.x, a.y, w, h, 8);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      roundRect(ctx, a.x + 3, a.y + 3, w - 6, h * 0.4, 6);
      ctx.fill();
    }
    ctx.restore();
  }

  drawStation(ctx, station, now) {
    const store = this.store;
    const machine = store.machines.get(station.id);
    const top = this.worldToScreen(station.x - STATION.machineWidth / 2, station.machineZ - STATION.machineDepth / 2);
    const bottom = this.worldToScreen(station.x + STATION.machineWidth / 2, station.machineZ + STATION.machineDepth / 2);
    const w = bottom.x - top.x;
    const h = bottom.y - top.y;
    const bodyH = Math.max(26, this.camera.scale * 1.5);

    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath();
    ctx.ellipse(top.x + w / 2, bottom.y + 4, w * 0.55, h * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();

    const grad = ctx.createLinearGradient(0, top.y - bodyH, 0, bottom.y);
    grad.addColorStop(0, '#2e3550');
    grad.addColorStop(1, '#1b2033');
    ctx.fillStyle = grad;
    roundRect(ctx, top.x, top.y - bodyH, w, h + bodyH, 8);
    ctx.fill();

    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1.5;
    roundRect(ctx, top.x, top.y - bodyH, w, h + bodyH, 8);
    ctx.stroke();

    const screenX = top.x + w * 0.1;
    const screenY = top.y - bodyH + h * 0.2;
    const screenW = w * 0.8;
    const screenH = h * 1.1;
    ctx.fillStyle = '#0a0d17';
    roundRect(ctx, screenX, screenY, screenW, screenH, 5);
    ctx.fill();

    this.drawReels(ctx, machine, screenX, screenY, screenW, screenH, now);

    const meterX = top.x + w * 0.12;
    const meterY = bottom.y + 6;
    const meterW = w * 0.76;
    const meterH = Math.max(6, this.camera.scale * 0.16);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    roundRect(ctx, meterX, meterY, meterW, meterH, meterH / 2);
    ctx.fill();
    const heat = machine ? machine.heat : 0;
    const heatColor = heat >= 90 ? '#ff4d3d' : heat >= 75 ? '#ff9d3d' : heat >= 50 ? '#ffd93d' : '#4fd07a';
    ctx.fillStyle = heatColor;
    roundRect(ctx, meterX, meterY, Math.max(2, (meterW * Math.min(100, heat)) / 100), meterH, meterH / 2);
    ctx.fill();

    if (machine && machine.ownerId) {
      const owner = store.players.get(machine.ownerId);
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.font = `600 ${Math.max(9, this.camera.scale * 0.24)}px "Segoe UI", system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(`#${station.id + 1}`, top.x + w / 2, top.y - bodyH - 6);
      if (owner && owner.name) {
        ctx.fillStyle = owner.color || '#fff';
        ctx.font = `500 ${Math.max(8, this.camera.scale * 0.2)}px "Segoe UI", system-ui, sans-serif`;
        ctx.fillText(owner.name.slice(0, 10), top.x + w / 2, meterY + meterH + 13);
      }
    }

    if (machine && machine.overbrewDeadline && machine.overbrewDeadline > now) {
      const remain = Math.max(0, (machine.overbrewDeadline - now) / 1000);
      ctx.fillStyle = '#ff5b45';
      ctx.font = `800 ${Math.max(11, this.camera.scale * 0.34)}px "Segoe UI", system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(remain.toFixed(1), top.x + w / 2, top.y - bodyH - 22);
    }
    ctx.restore();
  }

  drawReels(ctx, machine, x, y, w, h, now) {
    const count = 3;
    const cellW = w / count;
    for (let i = 0; i < count; i += 1) {
      const cx = x + cellW * (i + 0.5);
      const cy = y + h * 0.5;
      const r = Math.min(cellW * 0.34, h * 0.4);
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = '#11162a';
      ctx.fill();
      ctx.clip();

      const view = this.store.machineView(machine, now);
      const reel = view && view.reels ? view.reels[i] : null;
      const angle = reel ? ((reel.angle % 360) * Math.PI) / 180 : 0;
      ctx.strokeStyle = reel && reel.stopped ? qualityColor(reel.quality) : '#5f6b96';
      ctx.lineWidth = Math.max(3, r * 0.22);
      ctx.beginPath();
      ctx.moveTo(cx - Math.cos(angle) * r, cy - Math.sin(angle) * r);
      ctx.lineTo(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.5, cy);
      ctx.lineTo(cx + r * 0.5, cy);
      ctx.stroke();
      ctx.restore();

      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();

      if (view && view.holds && view.holds[i]) {
        ctx.fillStyle = 'rgba(80,180,255,0.9)';
        ctx.font = `700 ${Math.max(8, r * 0.55)}px "Segoe UI", system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText('H', cx, y - 4);
      }
    }
    void machine;
  }

  drawPlayer(ctx, player, now) {
    const pos = this.worldToScreen(player.x, player.z);
    const scale = this.camera.scale;
    const bodyW = Math.max(10, scale * PLAYER.radius * 1.5);
    const bodyH = Math.max(14, scale * 0.72);
    const mounted = player.stationId !== null && player.stationId !== undefined;
    const isSelf = this.store.self && player.id === this.store.self.id;

    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(pos.x, pos.y + 3, bodyW * 0.6, bodyW * 0.28, 0, 0, Math.PI * 2);
    ctx.fill();

    if (this.selection === player.id || this.hover === player.id) {
      ctx.strokeStyle = this.selection === player.id ? '#ffd76a' : 'rgba(255,255,255,0.6)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(pos.x, pos.y + 3, bodyW * 0.75, bodyW * 0.36, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    const walk = player.anim === 'WALK' ? Math.sin(now / 90 + player.x) * 2 : 0;
    const lean = mounted ? -3 : 0;
    const color = player.color || AVATAR_COLORS[0];
    const dim = player.online === false;

    ctx.globalAlpha = dim ? 0.55 : 1;
    ctx.fillStyle = shade(color, -0.25);
    roundRect(ctx, pos.x - bodyW / 2, pos.y - bodyH + walk, bodyW, bodyH, bodyW * 0.4);
    ctx.fill();

    ctx.fillStyle = color;
    roundRect(ctx, pos.x - bodyW / 2 + 1.5, pos.y - bodyH + walk + 1.5, bodyW - 3, bodyH * 0.62, bodyW * 0.35);
    ctx.fill();

    const headR = Math.max(5, scale * 0.26);
    ctx.fillStyle = '#f2d3b3';
    ctx.beginPath();
    ctx.arc(pos.x + lean, pos.y - bodyH - headR * 0.3 + walk, headR, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = shade(color, 0.15);
    ctx.beginPath();
    ctx.arc(pos.x + lean, pos.y - bodyH - headR * 0.75 + walk, headR * 0.95, Math.PI, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = 1;

    const tag = `${player.name || 'Player'}${player.ready ? ' *' : ''}${dim ? ' (off)' : ''}`;
    ctx.font = `600 ${Math.max(9, scale * 0.24)}px "Segoe UI", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    const tagY = pos.y - bodyH - headR * 2.1 + walk;
    const width = ctx.measureText(tag).width;
    ctx.fillStyle = 'rgba(8,10,18,0.72)';
    roundRect(ctx, pos.x - width / 2 - 5, tagY - 12, width + 10, 15, 7);
    ctx.fill();
    ctx.fillStyle = isSelf ? '#ffd76a' : '#eef1ff';
    ctx.fillText(tag, pos.x, tagY);

    if (player.emote) {
      const bubbleY = tagY - 22;
      ctx.fillStyle = 'rgba(255,255,255,0.94)';
      roundRect(ctx, pos.x - 34, bubbleY - 14, 68, 18, 9);
      ctx.fill();
      ctx.fillStyle = '#1b2033';
      ctx.font = `700 10px "Segoe UI", system-ui, sans-serif`;
      ctx.fillText(String(player.emote), pos.x, bubbleY - 1);
    }

    if (player.effects && player.effects.length) {
      let ex = pos.x + bodyW * 0.6;
      for (const kind of player.effects) {
        ctx.fillStyle = effectColor(kind);
        ctx.beginPath();
        ctx.arc(ex, pos.y - bodyH * 0.5, 4, 0, Math.PI * 2);
        ctx.fill();
        ex += 9;
      }
    }

    if (this.store.self && player.id === this.store.self.id && player.mischief !== undefined) {
      const barW = bodyW * 1.4;
      const barX = pos.x - barW / 2;
      const barY = pos.y + 9;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      roundRect(ctx, barX, barY, barW, 5, 3);
      ctx.fill();
      ctx.fillStyle = '#a55fe0';
      roundRect(ctx, barX, barY, (barW * Math.min(100, player.mischief)) / 100, 5, 3);
      ctx.fill();
    }
    ctx.restore();
  }

  drawAreaEffects(ctx, areas, now) {
    for (const area of areas || []) {
      if (area.until && area.until < now) continue;
      const pos = this.worldToScreen(area.x || WORLD.width / 2, area.z || WORLD.depth / 2);
      const radius = (area.radius || 3) * this.camera.scale;
      const g = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, radius);
      g.addColorStop(0, 'rgba(120,120,120,0.42)');
      g.addColorStop(1, 'rgba(120,120,120,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
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

  drawParticles(ctx, now) {
    this.particles = this.particles.filter((p) => now - p.born < p.life);
    for (const p of this.particles) {
      const age = (now - p.born) / p.life;
      const pos = this.worldToScreen(p.x + p.vx * age, p.z + p.vz * age);
      ctx.globalAlpha = 1 - age;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  drawRoomEventOverlay(ctx, room, now) {
    if (!room || !room.activeEvent) return;
    const remain = room.activeEvent.endsAt - now;
    if (remain <= 0) return;
    ctx.save();
    ctx.globalAlpha = 0.12 + 0.05 * Math.sin(now / 300);
    ctx.fillStyle = room.activeEvent.kind === 'HAPPY_HOUR' ? '#ffd93d' : '#4fd0ff';
    ctx.fillRect(0, 0, this.cssWidth, this.cssHeight);
    ctx.restore();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = '700 13px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`${room.activeEvent.kind} · ${Math.ceil(remain / 1000)}s`, 16, this.cssHeight - 16);
  }

  drawVignette(ctx) {
    const g = ctx.createRadialGradient(
      this.cssWidth / 2,
      this.cssHeight / 2,
      Math.min(this.cssWidth, this.cssHeight) * 0.35,
      this.cssWidth / 2,
      this.cssHeight / 2,
      Math.max(this.cssWidth, this.cssHeight) * 0.75,
    );
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.5)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.cssWidth, this.cssHeight);
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

function shade(hex, amount) {
  const value = hex.replace('#', '');
  if (value.length !== 6) return hex;
  const num = parseInt(value, 16);
  const r = clamp255(((num >> 16) & 255) * (1 + amount));
  const g = clamp255(((num >> 8) & 255) * (1 + amount));
  const b = clamp255((num & 255) * (1 + amount));
  return `rgb(${r},${g},${b})`;
}

function clamp255(v) {
  return Math.max(0, Math.min(255, Math.round(v)));
}
