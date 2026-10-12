import { MAP, OBJECTS, SEATS } from './world.js';
import { Builder } from './mapGeom.js';
import { material, slotFace, loadImageBitmap } from './mapTex.js';

const OBJ = id => OBJECTS.find(o => o.id === id);
const tableRects = OBJECTS.filter(o => o.type === 'table');

const MAT_ORDER = [
  'carpet', 'tile', 'woodFloor', 'woodDark', 'woodWarm', 'beam', 'brick',
  'plaster', 'brass', 'leather', 'felt', 'rug', 'steel', 'glass', 'neon',
  'wheel', 'slotFace', 'sign'
];

function stadium(b, name, cx, cz, w, d, y0, h, opts) {
  const r = w / 2, half = d / 2 - r;
  b.box(name, cx, y0 + h / 2, cz, w, h, half * 2, opts);
  b.cyl(name, cx, y0, cz + half, r, r, h, 18, opts);
  b.cyl(name, cx, y0, cz - half, r, r, h, 18, opts);
}

function pokerTable(b, t) {
  const cx = t.x + t.w / 2, cz = t.y + t.h / 2;
  const w = t.w, d = t.h;
  stadium(b, 'woodDark', cx, cz, w, d, 0, 26, { tile: 40, localUV: true });
  b.cyl('woodWarm', cx, 0, cz, 20, 16, 8, 16, { tile: 24 });
  stadium(b, 'woodWarm', cx, cz, w + 6, d + 6, 26, 4, { tile: 30, localUV: true });
  stadium(b, 'felt', cx, cz, w - 10, d - 14, 30, 2.4, { tile: 22, localUV: true });
  for (const s of SEATS) {
    if (s.table !== t.id) continue;
    stool(b, s.x, s.y, s.dir);
  }
}

function stool(b, x, z, dir) {
  void dir;
  b.cyl('steel', x, 0, z, 12, 10, 2, 12, { tile: 10 });
  b.cyl('steel', x, 2, z, 3.2, 3.2, 18, 8, { tile: 8 });
  b.cyl('leather', x, 20, z, 11, 10.5, 5, 14, { tile: 12 });
}

function rouletteTable(b, t, wheelTex) {
  const cx = t.x + t.w / 2, cz = t.y + t.h / 2;
  const w = t.w, d = t.h;
  stadium(b, 'woodDark', cx, cz, w, d, 0, 30, { tile: 40, localUV: true });
  stadium(b, 'woodWarm', cx, cz, w + 6, d + 6, 30, 4, { tile: 30, localUV: true });
  stadium(b, 'felt', cx, cz, w - 12, d - 16, 34, 2, { tile: 20, localUV: true });
  b.cyl('woodDark', cx, 36, cz, 30, 32, 4, 24, { tile: 16 });
  b.cyl('brass', cx, 40, cz, 26, 28, 3.5, 26, { tile: 12 });
  b.disc(wheelTex, cx, 43.6, cz, 25, 25, 26, { tile: 50 });
  b.cyl('brass', cx, 43.6, cz, 3, 2.2, 8, 10, { tile: 8 });
  for (const s of SEATS) {
    if (s.table !== t.id) continue;
    stool(b, s.x, s.y, s.dir);
  }
}

function slotBank(b, z0) {
  for (let i = 0; i < 3; i++) {
    const z = z0 + i * 52;
    b.box('steel', 68, 26, z, 44, 52, 46, { tile: 26, localUV: true });
    b.box('steel', 68, 56, z, 40, 14, 42, { tile: 20, localUV: true });
    b.box('brass', 90, 34, z, 3, 26, 34, { tile: 14, localUV: true });
    b.quad('slotFace', [
      [92, 20, z + 17], [92, 20, z - 17], [92, 48, z - 17], [92, 48, z + 17]
    ], [[0, 1], [1, 1], [1, 0], [0, 0]]);
    b.box('steel', 74, 2, z, 50, 4, 50, { tile: 20, localUV: true });
  }
}

function shelfUnit(b, x0, x1, z) {
  const w = x1 - x0, cx = (x0 + x1) / 2;
  b.box('woodDark', cx, 37, z, w, 74, 14, { tile: 30, localUV: true });
  for (let lvl = 0; lvl < 3; lvl++) {
    const y = 14 + lvl * 22;
    b.box('woodWarm', cx, y, z + 10, w - 6, 3, 16, { tile: 20, localUV: true });
  }
  for (let lvl = 0; lvl < 3; lvl++) {
    const y = 17 + lvl * 22;
    const n = Math.floor((w - 20) / 16);
    for (let i = 0; i < n; i++) {
      const bx = x0 + 12 + i * 16 + (lvl % 2) * 6;
      if (bx > x1 - 10) break;
      b.cyl('glass', bx, y, z + 10, 3.4, 3.0, 12, 7, { tile: 8 });
      b.cyl('glass', bx, y + 12, z + 10, 1.2, 1.0, 4, 6, { tile: 4 });
    }
  }
}

function barCounter(b) {
  const o = OBJ('bar');
  const cx = o.x + o.w / 2, cz = o.y + o.h / 2;
  b.box('woodDark', cx, 22, cz - 6, o.w, 44, o.h - 20, { tile: 30, localUV: true });
  b.box('woodWarm', cx, 44, cz - 6, o.w + 10, 6, o.h - 12, { tile: 24, localUV: true });
  b.box('brass', cx, 10, cz + o.h / 2 - 12, o.w + 12, 3, 3, { tile: 12, localUV: true });
  for (let i = 0; i < 5; i++) {
    stool(b, o.x + 16 + i * 35, o.y + o.h + 26, 0);
  }
  const sh = OBJ('shelf');
  shelfUnit(b, sh.x, sh.x + sh.w, sh.y + sh.h / 2);
  b.box('steel', cx + 40, 50, cz + 24, 46, 6, 26, { tile: 16, localUV: true });
}

function armchair(b, x, z, rot) {
  b.box('leather', x, 9, z, 40, 18, 40, { tile: 22, rot, localUV: true });
  const c = Math.cos(rot), s = Math.sin(rot);
  b.box('leather', x - s * 16, 18, z - c * 16, 40, 22, 8, { tile: 20, rot, localUV: true });
  for (const [ox, oz] of [[-17, -17], [17, -17], [-17, 17], [17, 17]]) {
    b.box('woodDark', x + ox * c + oz * s, 4.5, z - ox * s + oz * c, 5, 9, 5, { tile: 8, localUV: true });
  }
}

function sofa(b, x, z, rot, len) {
  b.box('leather', x, 10, z, len, 20, 38, { tile: 24, rot, localUV: true });
  const c = Math.cos(rot), s = Math.sin(rot);
  b.box('leather', x - s * 15, 20, z - c * 15, len, 24, 9, { tile: 22, rot, localUV: true });
  b.box('woodDark', x, 4, z, len - 6, 8, 32, { tile: 16, rot, localUV: true });
}

function plant(b, x, z, scale) {
  const s = scale || 1;
  b.cyl('woodDark', x, 0, z, 14 * s, 12 * s, 16 * s, 10, { tile: 14 });
  b.ellipsoid('felt', x, 30 * s, z, 18 * s, 16 * s, 18 * s, 4, 8);
  b.ellipsoid('felt', x, 44 * s, z, 12 * s, 12 * s, 12 * s, 4, 8);
  b.ellipsoid('felt', x + 8 * s, 36 * s, z + 4 * s, 9 * s, 8 * s, 9 * s, 3, 7);
}

function column(b, x, z) {
  b.box('brick', x, 75, z, 54, 150, 54, { tile: 54, localUV: true });
  b.box('woodWarm', x, 6, z, 62, 12, 62, { tile: 24, localUV: true });
  b.box('woodWarm', x, 144, z, 62, 12, 62, { tile: 24, localUV: true });
}

function hangingLamp(b, x, z, drop) {
  const top = 136;
  b.cyl('steel', x, top - drop, z, 1.2, 1.2, drop, 6, { tile: 6 });
  b.cyl('steel', x, top - drop - 16, z, 16, 7, 16, 14, { tile: 12 });
  b.cyl('neon', x, top - drop - 17.5, z, 6.5, 6.5, 1.5, 12, { tile: 6 });
}

function windowFrame(b, x0, x1, y0, y1, zFace, dir) {
  const w = x1 - x0, h = y1 - y0, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  b.box('woodDark', cx, cy, zFace + dir * 3, w + 14, h + 14, 6, { tile: 20, localUV: true });
  b.quad('glass', [
    [x0, y0, zFace + dir * 7], [x1, y0, zFace + dir * 7],
    [x1, y1, zFace + dir * 7], [x0, y1, zFace + dir * 7]
  ], [[0, 0], [1.4, 0], [1.4, 0.9], [0, 0.9]], dir < 0);
  b.box('woodDark', cx, cy, zFace + dir * 8, 5, h, 6, { tile: 12, localUV: true });
  b.box('woodDark', cx, cy, zFace + dir * 8, w, 5, 6, { tile: 12, localUV: true });
}

function doorFrame(b, x0, x1, zFace) {
  const w = x1 - x0, cx = (x0 + x1) / 2;
  b.box('woodWarm', x0 - 7, 46, zFace - 8, 14, 92, 18, { tile: 18, localUV: true });
  b.box('woodWarm', x1 + 7, 46, zFace - 8, 14, 92, 18, { tile: 18, localUV: true });
  b.box('woodWarm', cx, 92, zFace - 8, w + 28, 14, 18, { tile: 18, localUV: true });
  b.box('woodDark', cx, 44, zFace - 2, w - 16, 88, 6, { tile: 22, localUV: true });
  b.box('brass', x1 - 18, 44, zFace - 6, 4, 4, 4, { tile: 4 });
}

function signFrame(b) {
  const o = OBJ('neon');
  const x0 = o.x, x1 = o.x + o.w, y0 = 10, y1 = 10 + o.h + 18;
  const zf = MAP.wall + 4;
  b.box('woodDark', (x0 + x1) / 2, (y0 + y1) / 2, zf, x1 - x0 + 30, y1 - y0 + 20, 10, { tile: 26, localUV: true });
  b.box('brass', (x0 + x1) / 2, y0 - 6, zf + 4, x1 - x0 + 40, 5, 8, { tile: 14, localUV: true });
  b.box('brass', (x0 + x1) / 2, y1 + 6, zf + 4, x1 - x0 + 40, 5, 8, { tile: 14, localUV: true });
  b.quad('neon', [
    [x0, y0, zf + 5.5], [x1, y0, zf + 5.5], [x1, y1, zf + 5.5], [x0, y1, zf + 5.5]
  ], [[0, 0], [1, 0], [1, 1], [0, 1]]);
}

function buildSignTexture() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#05030a';
  g.fillRect(0, 0, 512, 64);
  g.font = '900 46px Arial';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = '#ff2f7a';
  g.shadowBlur = 18;
  g.fillStyle = '#ffd9e8';
  for (let i = 0; i < 3; i++) g.fillText('BREW', 256, 32);
  g.shadowBlur = 0;
  g.fillStyle = '#ffffff';
  g.fillText('BREW', 256, 32);
  return c;
}

function buildWheelTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#0d3a28';
  g.fillRect(0, 0, 256, 256);
  const cx = 128, cy = 128;
  for (let i = 0; i < 36; i++) {
    const a0 = (i / 36) * Math.PI * 2 - Math.PI / 2;
    const a1 = ((i + 1) / 36) * Math.PI * 2 - Math.PI / 2;
    g.beginPath();
    g.moveTo(cx, cy);
    g.arc(cx, cy, 122, a0, a1);
    g.closePath();
    const red = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36].indexOf(i + 1) >= 0;
    g.fillStyle = i === 0 ? '#0a6b3a' : (red ? '#8d1f28' : '#14161c');
    g.fill();
    g.strokeStyle = 'rgba(233,200,119,.65)';
    g.lineWidth = 1.5;
    g.stroke();
  }
  g.beginPath();
  g.arc(cx, cy, 44, 0, Math.PI * 2);
  g.fillStyle = '#1a1c22';
  g.fill();
  g.strokeStyle = '#c9a45c';
  g.lineWidth = 5;
  g.stroke();
  g.beginPath();
  g.arc(cx, cy, 122, 0, Math.PI * 2);
  g.strokeStyle = '#c9a45c';
  g.lineWidth = 8;
  g.stroke();
  return c;
}

function buildShell(b) {
  const W = MAP.w, H = MAP.h, T = MAP.wall, WH = 150;
  // One huge floor triangle dies under near-plane clipping at the south spawn
  // (SwiftShader + some drivers rasterize a black wedge). Tile it instead.
  {
    const x0 = T, z0 = T, x1 = W - T, z1 = H - T;
    const step = 320;
    const uMax = W / 128, vMax = H / 128;
    const nx = Math.ceil((x1 - x0) / step);
    const nz = Math.ceil((z1 - z0) / step);
    for (let iz = 0; iz < nz; iz++) {
      for (let ix = 0; ix < nx; ix++) {
        const ax = x0 + (ix * (x1 - x0)) / nx;
        const bx = x0 + ((ix + 1) * (x1 - x0)) / nx;
        const az = z0 + (iz * (z1 - z0)) / nz;
        const bz = z0 + ((iz + 1) * (z1 - z0)) / nz;
        const u0 = (ax / W) * uMax, u1 = (bx / W) * uMax;
        const v0 = (az / H) * vMax, v1 = (bz / H) * vMax;
        b.quad('carpet', [
          [ax, 0.05, az], [ax, 0.05, bz], [bx, 0.05, bz], [bx, 0.05, az]
        ], [[u0, v0], [u0, v1], [u1, v1], [u1, v0]]);
      }
    }
  }
  b.box('woodFloor', W / 2, 0.02, 120, 420, 0.08, 160, { tile: 48 });
  b.box('tile', 400, 0.06, 1200, 240, 0.12, 130, { tile: 64 });
  b.box('rug', 1236, 0.1, 650, 1437, 0.16, 573, { tile: 288, localUV: true, uvOff: [0.5, 0.5] });

  b.box('brick', W / 2, WH / 2, T / 2, W, WH, T, { tile: 64 });
  b.box('brick', W / 2, WH / 2, H - T / 2, W, WH, T, { tile: 64 });
  b.box('brick', T / 2, WH / 2, H / 2, T, WH, H, { tile: 64 });
  b.box('brick', W - T / 2, WH / 2, H / 2, T, WH, H, { tile: 64 });

  b.box('woodWarm', W / 2, 17, T + 1, W, 34, 3, { tile: 26, localUV: true });
  b.box('woodWarm', W / 2, 17, H - T - 1, W, 34, 3, { tile: 26, localUV: true });
  b.box('woodWarm', T + 1, 17, H / 2, 3, 34, H, { tile: 26, localUV: true });
  b.box('woodWarm', W - T - 1, 17, H / 2, 3, 34, H, { tile: 26, localUV: true });
  b.box('plaster', W / 2, 54, T + 1.5, W, 40, 2, { tile: 90, localUV: true });
  b.box('plaster', W / 2, 54, H - T - 1.5, W, 40, 2, { tile: 90, localUV: true });

  b.box('woodWarm', W / 2, 128, T + 2, W, 10, 6, { tile: 30, localUV: true });
  b.box('woodWarm', W / 2, 128, H - T - 2, W, 10, 6, { tile: 30, localUV: true });

  for (const z of [170, 430, 730, 1030]) {
    b.box('beam', W / 2, 136, z, W - T * 2, 22, 26, { tile: 60, localUV: true });
  }
  for (const x of [600, 1500]) {
    b.box('beam', x, 140, H / 2, 20, 16, H - T * 2, { tile: 60, localUV: true });
  }

  windowFrame(b, 430, 700, 52, 116, T, 1);
  windowFrame(b, 2140, 2360, 52, 116, T, 1);
  windowFrame(b, 430, 700, 52, 116, H - T, -1);
  doorFrame(b, 300, 500, H - T);
  signFrame(b);

  const sw = OBJECTS.find(o => o.type === 'switch');
  b.box('plaster', sw.x + 6, 36, sw.y + sw.h / 2, 8, 46, 26, { tile: 12, localUV: true });

  const coat = OBJ('coat');
  b.box('woodDark', coat.x + coat.w / 2, 36, coat.y + coat.h / 2, coat.w, 72, 20, { tile: 24, localUV: true });
  for (let i = 0; i < 4; i++) {
    b.cyl('brass', coat.x + 22 + i * 34, 52, coat.y + coat.h / 2 + 12, 2, 2, 8, 6, { tile: 6 });
  }
}

export const LIGHTS = (() => {
  const list = [];
  for (const t of tableRects) {
    const cx = t.x + t.w / 2, cz = t.y + t.h / 2;
    if (t.kind === 'roulette') {
      list.push({ x: cx, y: 84, z: cz, r: 300, col: [1.0, 0.86, 0.6], int: 1.15 });
    } else {
      list.push({ x: cx, y: 86, z: cz, r: 250, col: [1.0, 0.82, 0.55], int: 1.0 });
    }
  }
  const bar = OBJ('bar');
  list.push({ x: bar.x + bar.w / 2, y: 70, z: bar.y + bar.h / 2, r: 260, col: [1.0, 0.78, 0.5], int: 1.0 });
  const sh = OBJ('shelf');
  list.push({ x: sh.x + sh.w / 2, y: 78, z: sh.y + sh.h / 2, r: 300, col: [1.0, 0.72, 0.42], int: 0.8 });
  list.push({ x: 1228, y: 40, z: 40, r: 340, col: [1.0, 0.30, 0.55], int: 1.25 });
  list.push({ x: 86, y: 46, z: 320, r: 300, col: [0.45, 0.95, 0.85], int: 0.9 });
  list.push({ x: 86, y: 46, z: 640, r: 300, col: [0.45, 0.95, 0.85], int: 0.9 });
  list.push({ x: 86, y: 46, z: 960, r: 300, col: [0.45, 0.95, 0.85], int: 0.9 });
  list.push({ x: 400, y: 70, z: 1210, r: 320, col: [0.72, 0.82, 1.0], int: 0.9 });
  list.push({ x: 760, y: 90, z: 640, r: 340, col: [1.0, 0.80, 0.58], int: 0.55 });
  list.push({ x: 1796, y: 110, z: 200, r: 280, col: [1.0, 0.84, 0.6], int: 0.7 });
  list.push({ x: 2200, y: 90, z: 660, r: 320, col: [1.0, 0.80, 0.55], int: 0.5 });
  list.push({ x: 130, y: 80, z: 120, r: 260, col: [1.0, 0.78, 0.5], int: 0.5 });
  return list;
})();

function buildContent(b) {
  buildShell(b);
  for (const t of tableRects) {
    if (t.kind === 'roulette') rouletteTable(b, t, 'wheel');
    else pokerTable(b, t);
  }
  barCounter(b);
  for (let i = 0; i < 5; i++) slotBank(b, 210 + i * 190);
  plant(b, 106, 106, 1.2);
  plant(b, 2242, 1113, 1.1);
  plant(b, 112, 1119, 1.0);
  column(b, 2084, 330);
  column(b, 2176, 1014);
  for (const t of tableRects) {
    const cx = t.x + t.w / 2, cz = t.y + t.h / 2;
    hangingLamp(b, cx, cz, t.kind === 'roulette' ? 52 : 46);
  }
  hangingLamp(b, 1796, 130, 58);
  hangingLamp(b, 760, 560, 62);
  hangingLamp(b, 760, 720, 62);
  sofa(b, 900, 400, Math.PI, 150);
  sofa(b, 900, 900, 0, 150);
  armchair(b, 660, 480, Math.PI / 2);
  armchair(b, 660, 820, Math.PI / 2);
  armchair(b, 1560, 430, -Math.PI / 2);
  armchair(b, 1560, 870, -Math.PI / 2);
  b.box('woodDark', 2280, 20, 120, 120, 40, 44, { tile: 26, localUV: true });
  b.box('woodWarm', 2280, 40, 120, 128, 5, 50, { tile: 20, localUV: true });
  b.box('woodDark', 200, 20, 1230, 90, 40, 40, { tile: 22, localUV: true });
}

const EXPLICIT = { wheel: 1, slotFace: 1, sign: 1 };

function buildMaterials(images) {
  const mats = [];
  const samplers = [];
  const imagesList = [];
  const index = {};
  const SMP = { wrapS: 10497, wrapT: 10497, minFilter: 9987, magFilter: 9729 };
  const addMat = (name, albedo, normal, opts) => {
    const rec = {
      base: [1, 1, 1, 1],
      tex: imagesList.length,
      nrm: -1,
      nrmSmp: 0,
      smp: samplers.length,
      unlit: !!(opts && opts.unlit),
      blend: !!(opts && opts.blend)
    };
    imagesList.push(albedo);
    samplers.push(SMP);
    if (normal) {
      rec.nrm = imagesList.length;
      rec.nrmSmp = samplers.length;
      imagesList.push(normal);
      samplers.push(SMP);
    }
    if (opts && opts.emissive) rec.emissive = opts.emissive;
    index[name] = mats.length;
    mats.push(rec);
  };
  for (const name of MAT_ORDER) {
    if (EXPLICIT[name]) continue;
    const m = material(name);
    addMat(name, m.albedo, m.normal, { blend: m.blend, unlit: m.unlit, emissive: m.emissive });
  }
  addMat('wheel', images.wheel, null);
  addMat('slotFace', images.slotFace, null, { unlit: true, emissive: [1.35, 1.25, 1.05] });
  addMat('sign', images.sign, null, { unlit: true, emissive: [2.6, 0.7, 1.3] });
  return { mats, index, samplers, imagesList };
}

export async function buildBrewMap() {
  let slotSymbols = [];
  try {
    slotSymbols = await Promise.all([
      loadImageBitmap('./Assets/slot/7.png'),
      loadImageBitmap('./Assets/slot/cherry.png'),
      loadImageBitmap('./Assets/slot/blueberry.png'),
      loadImageBitmap('./Assets/slot/clover.png'),
      loadImageBitmap('./Assets/slot/diamond.png')
    ]);
  } catch (e) {
    console.warn('[map] slot symbols unavailable:', e && e.message);
  }
  const images = {
    wheel: buildWheelTexture(),
    slotFace: slotFace(slotSymbols.length ? slotSymbols : [null, null, null], 256),
    sign: buildSignTexture()
  };
  const { mats, index, samplers, imagesList } = buildMaterials(images);
  const b = new Builder();
  buildContent(b);
  const draws = b.finish(index);
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const d of draws) {
    for (let i = 0; i < d.pos.length; i += 3) {
      if (d.pos[i] < minX) minX = d.pos[i];
      if (d.pos[i] > maxX) maxX = d.pos[i];
      if (d.pos[i + 1] < minY) minY = d.pos[i + 1];
      if (d.pos[i + 1] > maxY) maxY = d.pos[i + 1];
      if (d.pos[i + 2] < minZ) minZ = d.pos[i + 2];
      if (d.pos[i + 2] > maxZ) maxZ = d.pos[i + 2];
    }
  }
  return {
    draws,
    materials: mats,
    images: imagesList,
    samplers,
    bounds: { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] }
  };
}
