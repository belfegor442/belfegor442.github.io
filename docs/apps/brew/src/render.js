import { MAP, OBJECTS, SEATS, SEAT_BY_ID, OBJ_BY_ID } from './world.js';

const PALETTE = [
  { body: '#c2373f', trim: '#f0d0a0', hair: '#241a14' },
  { body: '#2f6fb0', trim: '#dff0ff', hair: '#3a2a18' },
  { body: '#2f8f5b', trim: '#e8ffe8', hair: '#12100e' },
  { body: '#8b5bd6', trim: '#f3e9ff', hair: '#2a1830' },
  { body: '#d98a1f', trim: '#fff2d0', hair: '#4a2c12' },
  { body: '#3ec6c6', trim: '#eaffff', hair: '#101a1a' }
];

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.vw = 0; this.vh = 0; this.dpr = 1;
    this.cam = { x: 0, y: 0 };
    this.lights = true;
    this.time = 0;
    this.floor = this.buildFloor();
    this.order = this.buildOrder();
    this.resize();
  }

  resize() {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.vw = window.innerWidth;
    this.vh = window.innerHeight;
    this.canvas.width = Math.floor(this.vw * this.dpr);
    this.canvas.height = Math.floor(this.vh * this.dpr);
    this.canvas.style.width = this.vw + 'px';
    this.canvas.style.height = this.vh + 'px';
  }

  buildOrder() {
    const items = OBJECTS.filter(o => o.type !== 'rug').map(o => ({ kind: 'obj', o, depth: o.y + o.h }));
    items.push(...SEATS.map(s => ({ kind: 'seat', s, depth: s.y + 14 })));
    items.push({ kind: 'players', depth: 0 });
    return items;
  }

  buildFloor() {
    const c = document.createElement('canvas');
    c.width = MAP.w; c.height = MAP.h;
    const g = c.getContext('2d');
    g.fillStyle = '#2c2018';
    g.fillRect(0, 0, MAP.w, MAP.h);
    for (let y = 0; y < MAP.h; y += 58) {
      g.fillStyle = (y / 58) % 2 ? 'rgba(255,255,255,.022)' : 'rgba(0,0,0,.10)';
      g.fillRect(0, y, MAP.w, 58);
      g.fillStyle = 'rgba(0,0,0,.28)';
      g.fillRect(0, y, MAP.w, 2);
      const off = (Math.floor(y / 58) % 2) * 180;
      for (let x = off; x < MAP.w; x += 360) {
        g.fillStyle = 'rgba(0,0,0,.25)';
        g.fillRect(x, y, 2, 58);
      }
    }
    for (const o of OBJECTS) {
      if (o.type === 'rug') {
        g.save();
        g.beginPath();
        const r = 26;
        g.moveTo(o.x + r, o.y);
        g.arcTo(o.x + o.w, o.y, o.x + o.w, o.y + o.h, r);
        g.arcTo(o.x + o.w, o.y + o.h, o.x, o.y + o.h, r);
        g.arcTo(o.x, o.y + o.h, o.x, o.y, r);
        g.arcTo(o.x, o.y, o.x + o.w, o.y, r);
        g.closePath();
        g.fillStyle = '#3a141a';
        g.fill();
        g.lineWidth = 6;
        g.strokeStyle = 'rgba(233,200,119,.55)';
        g.stroke();
        g.lineWidth = 2;
        g.strokeStyle = 'rgba(233,200,119,.25)';
        g.strokeRect(o.x + 22, o.y + 22, o.w - 44, o.h - 44);
        g.restore();
      }
      if (o.type === 'table') {
        g.save();
        g.translate(o.x + o.w / 2, o.y + o.h / 2);
        g.scale(1, 0.62);
        g.beginPath();
        g.arc(0, 0, o.w * 0.62, 0, Math.PI * 2);
        g.fillStyle = 'rgba(6,32,22,.55)';
        g.fill();
        g.lineWidth = 5;
        g.strokeStyle = 'rgba(233,200,119,.28)';
        g.stroke();
        g.restore();
      }
    }
    return c;
  }

  box(x, y, w, h, hgt, top, front, side) {
    const ctx = this.ctx;
    ctx.fillStyle = front;
    ctx.fillRect(x, y + h - hgt, w, hgt);
    ctx.fillStyle = top;
    ctx.fillRect(x, y - hgt, w, h);
    if (side) {
      ctx.fillStyle = side;
      ctx.fillRect(x + w - 7, y - hgt, 7, h + hgt - 7);
      ctx.fillStyle = 'rgba(0,0,0,.18)';
      ctx.fillRect(x, y - hgt, w, 3);
    }
  }

  roundRect(x, y, w, h, r) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  drawObject(o) {
    const ctx = this.ctx;
    switch (o.type) {
      case 'wall':
        this.box(o.x, o.y, o.w, o.h, o.hgt, '#4a3a2a', '#2a1f16', '#241a12');
        break;
      case 'table': {
        this.box(o.x, o.y, o.w, o.h, o.hgt, '#6b4526', '#3a2413', '#2c1a0e');
        ctx.fillStyle = 'rgba(233,200,119,.55)';
        ctx.fillRect(o.x + 6, o.y - o.hgt + 6, o.w - 12, 3);
        ctx.fillStyle = '#0e4a34';
        ctx.beginPath();
        ctx.ellipse(o.x + o.w / 2, o.y - o.hgt + o.h / 2, o.w / 2 - 18, o.h / 2 - 16, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(233,200,119,.4)';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = 'rgba(233,200,119,.16)';
        ctx.beginPath();
        ctx.ellipse(o.x + o.w / 2, o.y - o.hgt + o.h / 2, o.w / 2 - 44, o.h / 2 - 42, 0, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'bar':
        this.box(o.x, o.y, o.w, o.h, o.hgt, '#3d2a1c', '#241811', '#1d130d');
        ctx.fillStyle = '#c9a15c';
        ctx.fillRect(o.x, o.y - o.hgt, o.w, 7);
        ctx.fillStyle = 'rgba(233,200,119,.25)';
        ctx.fillRect(o.x + 10, o.y - o.hgt + 12, o.w - 20, 3);
        break;
      case 'shelf':
        this.box(o.x, o.y, o.w, o.h, o.hgt, '#241a12', '#1a120c', null);
        for (let i = 0; i < 12; i++) {
          const bx = o.x + 12 + i * 34;
          ctx.fillStyle = ['#c2373f', '#d98a1f', '#2f8f5b', '#8b5bd6'][i % 4];
          ctx.fillRect(bx, o.y - o.hgt + 6, 16, o.h + o.hgt - 10);
        }
        break;
      case 'column':
        this.box(o.x, o.y, o.w, o.h, o.hgt, '#3a3128', '#241d17', '#1c1712');
        break;
      case 'plant': {
        this.box(o.x + 8, o.y + 16, o.w - 16, o.h - 20, 26, '#6b4a2a', '#4a3018', null);
        const cx = o.x + o.w / 2, cy = o.y + o.h / 2 - 14;
        ctx.fillStyle = '#1f6b40';
        for (let i = 0; i < 7; i++) {
          const a = (i / 7) * Math.PI * 2;
          ctx.beginPath();
          ctx.ellipse(cx + Math.cos(a) * 16, cy + Math.sin(a) * 10, 17, 11, a, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = '#2f9a58';
        ctx.beginPath();
        ctx.ellipse(cx, cy - 6, 20, 14, 0, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'sign': {
        ctx.save();
        ctx.fillStyle = '#1a120c';
        ctx.fillRect(o.x - 6, o.y - 6, o.w + 12, o.h + 12);
        const glow = this.lights ? 'rgba(233,200,119,.9)' : 'rgba(255,120,180,.95)';
        ctx.font = '800 26px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = glow;
        ctx.shadowBlur = this.lights ? 14 : 26;
        ctx.fillStyle = glow;
        ctx.fillText(o.label, o.x + o.w / 2, o.y + o.h / 2 + 2);
        ctx.restore();
        break;
      }
      case 'switch': {
        ctx.fillStyle = '#d8d2c4';
        ctx.fillRect(o.x, o.y, o.w, o.h);
        ctx.fillStyle = this.lights ? '#f0d27a' : '#4a4a4a';
        ctx.fillRect(o.x + 5, o.y + o.h / 2 - 8, o.w - 10, 16);
        ctx.strokeStyle = '#1a120c';
        ctx.lineWidth = 2;
        ctx.strokeRect(o.x, o.y, o.w, o.h);
        break;
      }
      case 'decor':
        this.box(o.x, o.y, o.w, o.h, o.hgt, '#2a2118', '#191309', null);
        break;
    }
  }

  drawSeat(s, occupied) {
    const ctx = this.ctx;
    if (s.table) {
      this.box(s.x - 14, s.y - 14, 28, 28, 22, '#7a4a2a', '#4a2c17', null);
      const a = s.dir;
      ctx.save();
      ctx.translate(s.x - Math.cos(a) * 16, s.y - Math.sin(a) * 16);
      ctx.rotate(a + Math.PI / 2);
      ctx.fillStyle = '#5b3620';
      ctx.fillRect(-14, -4, 28, 8);
      ctx.fillStyle = 'rgba(233,200,119,.35)';
      ctx.fillRect(-14, -4, 28, 2);
      ctx.restore();
    } else {
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.fillStyle = '#8a8a8a';
      ctx.beginPath();
      ctx.ellipse(0, 0, 15, 11, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#5a5a5a';
      ctx.fillRect(-3, 4, 6, 16);
      ctx.restore();
    }
    if (!occupied) {
      ctx.save();
      ctx.globalAlpha = 0.5 + Math.sin(this.time * 3) * 0.2;
      ctx.strokeStyle = 'rgba(233,200,119,.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(s.x, s.y - 6, 17, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  drawPlayer(p, isMe) {
    const ctx = this.ctx;
    const pal = PALETTE[(p.seed || 0) % PALETTE.length];
    const seated = p.status === 'seated' || p.anim === 'sit';
    const walking = p.anim === 'walk' && !seated;
    const bob = walking ? Math.sin(this.time * 11 + (p.id.charCodeAt(0) || 0)) * 1.8 : 0;
    const x = p.rx != null ? p.rx : p.x;
    const y = p.ry != null ? p.ry : p.y;
    const h = seated ? 24 : 34;
    const w = seated ? 22 : 20;

    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,.38)';
    ctx.beginPath();
    ctx.ellipse(x, y + 3, seated ? 15 : 13, seated ? 7 : 6, 0, 0, Math.PI * 2);
    ctx.fill();

    if (walking) {
      const legPhase = Math.sin(this.time * 11 + (p.id.charCodeAt(0) || 0));
      ctx.fillStyle = '#1b1b22';
      ctx.fillRect(x - 7, y - 10 + legPhase * 3, 6, 11);
      ctx.fillRect(x + 1, y - 10 - legPhase * 3, 6, 11);
    } else if (seated) {
      ctx.fillStyle = '#1b1b22';
      ctx.fillRect(x - 8, y - 8, 16, 9);
    }

    const top = y - h + bob;
    ctx.fillStyle = pal.body;
    this.roundRect(x - w / 2, top + 6, w, h - 6, 8);
    ctx.fill();
    ctx.fillStyle = pal.trim;
    ctx.fillRect(x - w / 2, top + h - 12, w, 4);

    const hx = x, hy = top - 1;
    ctx.fillStyle = '#e8c39a';
    ctx.beginPath();
    ctx.arc(hx, hy, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = pal.hair;
    ctx.beginPath();
    ctx.arc(hx, hy - 2, 10, Math.PI, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1b1b22';
    const dx = Math.cos(p.dir || 0) * 3.4, dy = Math.sin(p.dir || 0) * 2;
    ctx.beginPath();
    ctx.arc(hx + dx - 3.2, hy + dy, 1.6, 0, Math.PI * 2);
    ctx.arc(hx + dx + 3.2, hy + dy, 1.6, 0, Math.PI * 2);
    ctx.fill();

    if (isMe) {
      ctx.strokeStyle = 'rgba(233,200,119,.95)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(x, y + 3, 16, 8, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    const tag = p.name + (p.pid ? '  ' + p.pid : '');
    ctx.font = '700 11px Arial';
    const tw = ctx.measureText(tag).width + 14;
    const ty = hy - 26;
    ctx.fillStyle = 'rgba(4,16,12,.82)';
    this.roundRect(x - tw / 2, ty, tw, 17, 8);
    ctx.fill();
    ctx.fillStyle = isMe ? '#e9c877' : '#e7e0cf';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(tag, x, ty + 9);

    if (p.status === 'activity') {
      ctx.fillStyle = '#e9c877';
      ctx.font = '800 9px Arial';
      ctx.fillText('PLAYING', x, ty - 9);
    }

    const now = performance.now();
    if (p.chat && now - p.chat.at < 6500) {
      this.bubble(x, ty - 18, p.chat.text, '#0b1f18', '#e7e0cf', 200);
    } else if (p.emote && p.emoteAt && Date.now() - p.emoteAt < 3600) {
      this.bubble(x, ty - 18, p.emote, '#e9c877', '#1a1206', 150);
    }
    ctx.restore();
  }

  bubble(cx, cy, text, bg, fg, maxW) {
    const ctx = this.ctx;
    ctx.save();
    ctx.font = '600 12px Arial';
    let t = String(text);
    if (ctx.measureText(t).width > maxW - 16) {
      while (t.length > 2 && ctx.measureText(t + '…').width > maxW - 16) t = t.slice(0, -1);
      t += '…';
    }
    const w = Math.min(maxW, ctx.measureText(t).width + 18);
    const h = 22;
    ctx.fillStyle = bg;
    this.roundRect(cx - w / 2, cy - h, w, h, 10);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx - 5, cy);
    ctx.lineTo(cx + 5, cy);
    ctx.lineTo(cx, cy + 7);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(t, cx, cy - h / 2 + 1);
    ctx.restore();
  }

  drawActivity(activity) {
    if (!activity) return;
    const table = OBJ_BY_ID.get(activity.table);
    if (!table) return;
    const ctx = this.ctx;
    const cx = table.x + table.w / 2;
    const cy = table.y - table.hgt - 44;
    const label = (activity.phase === 'result' ? 'RESULT: ' + (activity.result || '').toUpperCase() : 'COINFLIP');
    ctx.save();
    ctx.font = '800 12px Arial';
    const w = ctx.measureText(label).width + 26;
    ctx.fillStyle = 'rgba(4,16,12,.9)';
    this.roundRect(cx - w / 2, cy - 14, w, 24, 12);
    ctx.fill();
    ctx.strokeStyle = 'rgba(233,200,119,.8)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = '#e9c877';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, cx, cy - 1);
    ctx.restore();
  }

  playerDepth(p, py) {
    if (!(p.status === 'seated' || p.anim === 'sit')) return py;
    const s = p.seat ? SEAT_BY_ID.get(p.seat) : null;
    if (!s) return py + 20;
    let d = s.y + 16;
    const t = s.table ? OBJ_BY_ID.get(s.table) : null;
    if (t && s.y >= t.y + t.h / 2) d = Math.max(d, t.y + t.h + 1);
    return d;
  }

  draw(me, players, activity, dt) {
    const ctx = this.ctx;
    const targetX = (me ? me.rx != null ? me.rx : me.x : MAP.w / 2) - this.vw / 2;
    const targetY = (me ? me.ry != null ? me.ry : me.y : MAP.h / 2) - this.vh / 2;
    const k = Math.min(1, dt * 6);
    this.cam.x += (Math.max(0, Math.min(MAP.w - this.vw, targetX)) - this.cam.x) * k;
    this.cam.y += (Math.max(0, Math.min(MAP.h - this.vh, targetY)) - this.cam.y) * k;
    if (MAP.w < this.vw) this.cam.x = (MAP.w - this.vw) / 2;
    if (MAP.h < this.vh) this.cam.y = (MAP.h - this.vh) / 2;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.vw, this.vh);
    ctx.save();
    ctx.translate(-Math.round(this.cam.x), -Math.round(this.cam.y));

    ctx.drawImage(this.floor, 0, 0);

    const drawables = [];
    for (const it of this.order) {
      if (it.kind === 'players') continue;
      drawables.push(it);
    }
    for (const p of players) {
      const py = p.ry != null ? p.ry : p.y;
      drawables.push({ kind: 'player', p, depth: this.playerDepth(p, py) });
    }
    drawables.sort((a, b) => a.depth - b.depth);

    for (const d of drawables) {
      if (d.kind === 'obj') this.drawObject(d.o);
      else if (d.kind === 'seat') this.drawSeat(d.s, d.s.occupiedBy);
      else if (d.kind === 'player') this.drawPlayer(d.p, me && d.p.id === me.id);
    }

    this.drawActivity(activity);

    if (this.lights) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const o of OBJECTS) {
        if (o.type !== 'table' && o.type !== 'bar') continue;
        const cx = o.x + o.w / 2, cy = o.y + o.h / 2;
        const g = ctx.createRadialGradient(cx, cy - 30, 10, cx, cy, o.w * 0.85);
        g.addColorStop(0, 'rgba(255,214,140,.20)');
        g.addColorStop(1, 'rgba(255,214,140,0)');
        ctx.fillStyle = g;
        ctx.fillRect(cx - o.w, cy - o.h, o.w * 2, o.h * 2);
      }
      ctx.restore();
    } else {
      ctx.fillStyle = 'rgba(4,8,24,.66)';
      ctx.fillRect(this.cam.x - 4, this.cam.y - 4, this.vw + 8, this.vh + 8);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const p of players) {
        const x = p.rx != null ? p.rx : p.x, y = p.ry != null ? p.ry : p.y;
        const g = ctx.createRadialGradient(x, y, 4, x, y, 74);
        g.addColorStop(0, 'rgba(233,200,119,.24)');
        g.addColorStop(1, 'rgba(233,200,119,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, 74, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    const vg = ctx.createRadialGradient(
      this.cam.x + this.vw / 2, this.cam.y + this.vh / 2, Math.min(this.vw, this.vh) * 0.35,
      this.cam.x + this.vw / 2, this.cam.y + this.vh / 2, Math.max(this.vw, this.vh) * 0.75
    );
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,.62)');
    ctx.fillStyle = vg;
    ctx.fillRect(this.cam.x - 4, this.cam.y - 4, this.vw + 8, this.vh + 8);

    ctx.restore();
  }
}
