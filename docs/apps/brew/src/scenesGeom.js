// Browser-only geometry for the 7 game rooms and the lobby vote terminals.
// The collision data (rects, seats, spawns) lives in scenes.js; this module
// turns those same records into Builder batches so what you see and what you
// bump into can never drift apart. Each room packs its own material set and
// is uploaded as its own GLB (render.ensureScene / useScene); the lobby
// terminals pack one shared set and are concatenated onto the lobby GLB.

import { Builder } from './mapGeom.js';
import { material } from './mapTex.js';
import { buildRoomData, GAME_META, LOBBY_TERMINALS } from './scenes.js';

function cv(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h || w;
  return c;
}

function labelTex(text, hex, sub) {
  const c = cv(256, 64);
  const g = c.getContext('2d');
  g.clearRect(0, 0, 256, 64);
  g.fillStyle = 'rgba(5,6,9,0.92)';
  g.fillRect(0, 0, 256, 64);
  g.strokeStyle = hex;
  g.lineWidth = 4;
  g.strokeRect(4, 4, 248, 56);
  g.font = 'bold 30px monospace';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = hex;
  g.shadowBlur = 16;
  g.fillStyle = hex;
  g.fillText(text, 128, sub ? 24 : 33);
  if (sub) {
    g.shadowBlur = 6;
    g.font = 'bold 13px monospace';
    g.fillStyle = '#e8e4da';
    g.fillText(sub, 128, 48);
  }
  return c;
}

function exitTex(hex) {
  const c = cv(128, 64);
  const g = c.getContext('2d');
  g.fillStyle = '#06080c';
  g.fillRect(0, 0, 128, 64);
  g.strokeStyle = hex;
  g.lineWidth = 3;
  g.strokeRect(3, 3, 122, 58);
  g.font = 'bold 22px monospace';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = hex;
  g.shadowBlur = 12;
  g.fillStyle = hex;
  g.fillText('< EXIT >', 64, 32);
  return c;
}

// Reel face for the slot cabinets: three lit windows with simple symbols.
function reelTex() {
  const c = cv(128, 128);
  const g = c.getContext('2d');
  g.fillStyle = '#0b0d10';
  g.fillRect(0, 0, 128, 128);
  const cols = ['#e04b4b', '#4b7de0', '#e0b53f', '#4fbf6a', '#c06ae0'];
  for (let i = 0; i < 3; i++) {
    const x = 10 + i * 37;
    g.fillStyle = '#f2ead8';
    g.fillRect(x, 18, 32, 92);
    g.fillStyle = cols[(i * 2 + 1) % cols.length];
    g.beginPath();
    g.arc(x + 16, 64, 11, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#0b0d10';
    g.font = 'bold 12px monospace';
    g.textAlign = 'center';
    g.fillText('7', x + 16, 100);
    g.strokeStyle = '#0a0c0f';
    g.lineWidth = 2;
    g.strokeRect(x, 18, 32, 92);
  }
  g.fillStyle = '#e9c877';
  g.fillRect(0, 118, 128, 10);
  return c;
}

// Glowing screen for the lobby vote terminals: dark glass, accent border,
// big label so each cabinet reads its game from across the lobby.
function terminalScreenTex(label, hex) {
  const c = cv(128, 128);
  const g = c.getContext('2d');
  g.fillStyle = '#07090d';
  g.fillRect(0, 0, 128, 128);
  const grad = g.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0, 'rgba(255,255,255,0.10)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.02)');
  grad.addColorStop(1, 'rgba(0,0,0,0.35)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = hex;
  g.lineWidth = 5;
  g.strokeRect(6, 6, 116, 116);
  g.font = 'bold 20px monospace';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = hex;
  g.shadowBlur = 14;
  g.fillStyle = hex;
  g.fillText(label, 64, 50);
  g.shadowBlur = 4;
  g.font = 'bold 13px monospace';
  g.fillStyle = '#e8e4da';
  g.fillText('VOTE', 64, 82);
  return c;
}

function boundsOf(draws) {
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
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}

const SMP = { wrapS: 10497, wrapT: 10497, minFilter: 9987, magFilter: 9729 };

function packMaterials(entries) {
  const mats = [], samplers = [], imagesList = [], index = {};
  for (const e of entries) {
    const rec = {
      base: [1, 1, 1, 1],
      tex: imagesList.length,
      nrm: -1,
      nrmSmp: 0,
      smp: samplers.length,
      unlit: !!(e.opts && e.opts.unlit),
      blend: !!(e.opts && e.opts.blend),
      edgeSoft: !!(e.opts && e.opts.edgeSoft)
    };
    imagesList.push(e.albedo);
    samplers.push(SMP);
    if (e.normal) {
      rec.nrm = imagesList.length;
      rec.nrmSmp = samplers.length;
      imagesList.push(e.normal);
      samplers.push(SMP);
    }
    if (e.opts && e.opts.emissive) rec.emissive = e.opts.emissive;
    index[e.name] = mats.length;
    mats.push(rec);
  }
  return { mats, index, samplers, imagesList };
}

function stdEntries(names) {
  return names.map(name => {
    const m = material(name);
    return { name, albedo: m.albedo, normal: m.normal, opts: { blend: m.blend, unlit: m.unlit, emissive: m.emissive, edgeSoft: m.edgeSoft } };
  });
}

function stadium(b, name, cx, cz, w, d, y0, h, opts) {
  const r = w / 2, half = d / 2 - r;
  b.box(name, cx, y0 + h / 2, cz, w, h, half * 2, opts);
  b.cyl(name, cx, y0, cz + half, r, r, h, 18, opts);
  b.cyl(name, cx, y0, cz - half, r, r, h, 18, opts);
}

function blob(b, cx, cz, rx, rz) {
  b.quad('rug', [
    [cx - rx, 0.42, cz - rz], [cx - rx, 0.42, cz + rz],
    [cx + rx, 0.42, cz + rz], [cx + rx, 0.42, cz - rz]
  ], [[0, 0], [0, 1], [1, 1], [1, 0]]);
}

function stool(b, x, z) {
  blob(b, x, z, 15, 15);
  b.cyl('steel', x, 0, z, 12, 10, 2, 12, { tile: 10 });
  b.cyl('steel', x, 2, z, 3.2, 3.2, 18, 8, { tile: 8 });
  b.cyl('leather', x, 20, z, 11, 10.5, 5, 14, { tile: 12 });
}

function chipStack(b, mat, x, z, n, y0) {
  const y = y0 == null ? 32.4 : y0;
  for (let i = 0; i < n; i++) b.cyl(mat, x, y + i * 1.6, z, 4.6, 4.6, 1.6, 10, { tile: 8 });
}

function cardDeck(b, x, z, rot) {
  b.box('plaster', x, 31.8, z, 7, 1.6, 10, { tile: 6, rot, localUV: true });
  b.box('plaster', x + 0.6, 33.4, z + 0.4, 7, 1.6, 10, { tile: 6, rot, localUV: true });
}

// Vertical quad spanning [x0..x1] x [y0..y1] on a constant-z plane.
// facingSouth=true → normal +z (south), false → normal -z (north).
function wallQuadZ(b, mat, x0, x1, y0, y1, z, facingSouth, uvs) {
  const uv = uvs || [[0, 0], [1, 0], [1, 1], [0, 1]];
  if (facingSouth) {
    b.quad(mat, [[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]], uv);
  } else {
    b.quad(mat, [[x1, y0, z], [x0, y0, z], [x0, y1, z], [x1, y1, z]], uv);
  }
}

function roomEntries(kind) {
  const acc = GAME_META[kind].accent;
  const boost = v => Math.min(3, v * 2.3);
  const entries = stdEntries(['carpet', 'rug', 'plaster', 'woodWarm', 'woodDark', 'felt', 'leather', 'brass', 'steel', 'neon']);
  entries.push({ name: 'label', albedo: labelTex(GAME_META[kind].label, GAME_META[kind].hex, 'GAME ROOM'), opts: { unlit: true, emissive: [boost(acc[0]), boost(acc[1]), boost(acc[2])] } });
  entries.push({ name: 'exit', albedo: exitTex(GAME_META[kind].hex), opts: { unlit: true, emissive: [1.2, 1.2, 1.2] } });
  if (kind === 'slots') {
    entries.push({ name: 'screen', albedo: reelTex(), opts: { unlit: true, emissive: [1.35, 1.25, 1.05] } });
  }
  return entries;
}

function buildRoomShell(b, data) {
  const W = data.MAP.w, H = data.MAP.h, T = data.MAP.wall;
  // Floor + soft centre rug.
  b.quad('carpet', [
    [T, 0.4, T], [W - T, 0.4, T], [W - T, 0.4, H - T], [T, 0.4, H - T]
  ], [[0, 0], [W / 40, 0], [W / 40, H / 40], [0, H / 40]]);
  blob(b, W / 2, H / 2 - 40, 260, 200);
  // Four plaster walls with a wood wainscot band on the room side.
  for (const o of data.OBJECTS) {
    if (o.type !== 'wall') continue;
    b.box('plaster', o.x + o.w / 2, 75, o.y + o.h / 2, o.w, 150, o.h, { tile: 26, localUV: true });
  }
  b.box('woodWarm', W / 2, 15, T + 2, W - 2 * T, 30, 4, { tile: 20, localUV: true });
  b.box('woodWarm', W / 2, 15, H - T - 2, W - 2 * T, 30, 4, { tile: 20, localUV: true });
  b.box('woodWarm', T + 2, 15, H / 2, 4, 30, H - 2 * T, { tile: 20, localUV: true });
  b.box('woodWarm', W - T - 2, 15, H / 2, 4, 30, H - 2 * T, { tile: 20, localUV: true });
  // Crown trim under the (open) ceiling line.
  b.box('woodDark', W / 2, 146, T + 3, W - 2 * T, 8, 6, { tile: 22, localUV: true });
  b.box('woodDark', W / 2, 146, H - T - 3, W - 2 * T, 8, 6, { tile: 22, localUV: true });
  b.box('woodDark', T + 3, 146, H / 2, 6, 8, H - 2 * T, { tile: 22, localUV: true });
  b.box('woodDark', W - T - 3, 146, H / 2, 6, 8, H - 2 * T, { tile: 22, localUV: true });
  // Room name sign above the exit portal, on the south wall's room face.
  const label = data.OBJECTS.find(o => o.type === 'portal');
  if (label) {
    const cx = label.x + label.w / 2;
    b.box('woodDark', cx, 122, H - T - 4, label.w + 40, 44, 6, { tile: 18, localUV: true });
    wallQuadZ(b, 'label', cx - label.w / 2 - 12, cx + label.w / 2 + 12, 104, 140, H - T - 7.5, false);
  }
  // The portal itself: dark frame, glowing panel, floor spill.
  if (label) {
    const p = label;
    const cx = p.x + p.w / 2;
    b.box('woodDark', cx, 52, p.y + p.h / 2, p.w + 16, 104, p.h, { tile: 18, localUV: true });
    b.box('steel', cx, 52, p.y + 1.5, p.w + 4, 96, 3, { tile: 12, localUV: true });
    wallQuadZ(b, 'exit', p.x + 2, p.x + p.w - 2, 8, 96, p.y + 3.5, false, [[0, 1], [1, 1], [1, 0], [0, 0]]);
    b.quad('neon', [
      [cx - p.w / 2, 0.5, p.y], [cx + p.w / 2, 0.5, p.y],
      [cx + p.w / 2, 0.5, p.y + 70], [cx - p.w / 2, 0.5, p.y + 70]
    ], [[0, 0], [1, 0], [1, 1], [0, 1]]);
  }
}

function buildRoomFurniture(b, kind, data) {
  if (kind === 'slots') {
    for (const o of data.OBJECTS) {
      if (o.type !== 'machine') continue;
      const cx = o.x + o.w / 2, cz = o.y + o.h / 2;
      blob(b, cx, cz, o.w / 2 + 10, o.h / 2 + 10);
      b.box('woodDark', cx, 33, cz, o.w, 66, o.h, { tile: 22, localUV: true });
      b.box('steel', cx, 33, o.y + 1.5, o.w - 6, 58, 3, { tile: 12, localUV: true });
      // Reel screen faces south (+z), toward where the player stands.
      wallQuadZ(b, 'screen', o.x + 8, o.x + o.w - 8, 20, 56, o.y + o.h + 0.5, true);
      // Marquee cap.
      b.box('woodDark', cx, 70, cz, o.w + 8, 12, o.h + 8, { tile: 16, localUV: true });
      wallQuadZ(b, 'neon', o.x + 4, o.x + o.w - 4, 66, 76, o.y + o.h + 4.5, true);
    }
    return;
  }
  for (const o of data.OBJECTS) {
    if (o.type !== 'table') continue;
    const cx = o.x + o.w / 2, cz = o.y + o.h / 2;
    if (o.kind === 'poker') {
      blob(b, cx, cz, o.w / 2 + 48, o.h / 2 + 48);
      stadium(b, 'woodDark', cx, cz, o.w, o.h, 0, 26, { tile: 40, localUV: true });
      b.cyl('woodWarm', cx, 0, cz, 20, 16, 8, 16, { tile: 24 });
      stadium(b, 'woodWarm', cx, cz, o.w + 6, o.h + 6, 26, 4, { tile: 30, localUV: true });
      stadium(b, 'felt', cx, cz, o.w - 10, o.h - 14, 30, 2.4, { tile: 22, localUV: true });
      chipStack(b, 'brass', cx - 20, cz - 26, 4);
      chipStack(b, 'steel', cx + 22, cz - 22, 3);
      chipStack(b, 'brass', cx + 16, cz + 30, 5);
      cardDeck(b, cx - 6, cz + 4, 0.4);
      cardDeck(b, cx + 8, cz - 8, -0.3);
    } else if (o.kind === 'roulette') {
      blob(b, cx, cz, o.w / 2 + 34, o.h / 2 + 34);
      stadium(b, 'woodDark', cx, cz, o.w, o.h, 0, 30, { tile: 40, localUV: true });
      stadium(b, 'woodWarm', cx, cz, o.w + 6, o.h + 6, 30, 4, { tile: 30, localUV: true });
      stadium(b, 'felt', cx, cz, o.w - 12, o.h - 16, 34, 2, { tile: 20, localUV: true });
      b.cyl('brass', cx, 36, cz, 26, 24, 5, 22, { tile: 10 });
      b.cyl('woodDark', cx, 41, cz, 20, 6, 10, 16, { tile: 8 });
      b.disc('brass', cx, 46, cz, 5, 5, 12, { tile: 6 });
    } else {
      blob(b, cx, cz, o.w / 2 + 26, o.h / 2 + 26);
      b.cyl('woodDark', cx, 0, cz, o.w / 2 - 4, o.w / 2 - 8, 22, 20, { tile: 26 });
      b.cyl('woodWarm', cx, 20, cz, o.w / 2, o.w / 2, 5, 22, { tile: 20 });
      b.disc('felt', cx, 25.2, cz, o.w / 2 - 10, o.h / 2 - 10, 22, { tile: 16 });
      chipStack(b, 'brass', cx - 14, cz - 8, 3, 25.6);
      chipStack(b, 'steel', cx + 12, cz + 10, 2, 25.6);
    }
  }
  for (const s of data.SEATS) stool(b, s.x, s.y);
}

// Self-contained GLB payload for one game room, aligned 1:1 with the room's
// collision data from buildRoomData(kind).
export function buildRoomGeometry(kind) {
  const data = buildRoomData(kind);
  const { mats, index, samplers, imagesList } = packMaterials(roomEntries(kind));
  const b = new Builder();
  buildRoomShell(b, data);
  buildRoomFurniture(b, kind, data);
  const draws = b.finish(index);
  return { draws, materials: mats, images: imagesList, samplers, bounds: boundsOf(draws) };
}

// The six lobby vote cabinets, in final lobby map coordinates. Uploaded as
// their own GLB and concatenated onto the lobby world in loadGLBAssets; their
// nav cells are OR-merged into the lobby grid there too.
export function buildLobbyTerminalsGeometry() {
  const entries = stdEntries(['steel', 'woodDark', 'brass', 'neon', 'rug']);
  const accOf = kind => GAME_META[kind].accent;
  for (const t of LOBBY_TERMINALS) {
    const acc = accOf(t.kind);
    const boost = v => Math.min(3, v * 2.4);
    entries.push({
      name: 'screen-' + t.kind,
      albedo: terminalScreenTex(GAME_META[t.kind].label, GAME_META[t.kind].hex),
      opts: { unlit: true, emissive: [boost(acc[0]), boost(acc[1]), boost(acc[2])] }
    });
    entries.push({
      name: 'label-' + t.kind,
      albedo: labelTex(GAME_META[t.kind].label, GAME_META[t.kind].hex),
      opts: { unlit: true, emissive: [boost(acc[0]), boost(acc[1]), boost(acc[2])] }
    });
  }
  const { mats, index, samplers, imagesList } = packMaterials(entries);
  const b = new Builder();
  for (const t of LOBBY_TERMINALS) {
    const cx = t.x + t.w / 2, cz = t.y + t.h / 2;
    blob(b, cx, cz, t.w / 2 + 12, t.h / 2 + 12);
    // Body + plinth; the screen and marquee face north (-z), toward the
    // lobby's centre.
    b.box('steel', cx, 31, cz, t.w, 62, t.h, { tile: 20, localUV: true });
    b.box('woodDark', cx, 3, cz, t.w + 8, 6, t.h + 8, { tile: 16, localUV: true });
    wallQuadZ(b, 'screen-' + t.kind, t.x + 6, t.x + t.w - 6, 20, 52, t.y + 0.5, false);
    b.box('woodDark', cx, 57, cz, t.w + 6, 10, t.h + 6, { tile: 14, localUV: true });
    wallQuadZ(b, 'label-' + t.kind, t.x + 2, t.x + t.w - 2, 52, 62, t.y + 0.5, false);
    // Brass foot rail detail.
    b.box('brass', cx, 8, t.y + t.h + 1, t.w - 8, 2, 2, { tile: 8 });
  }
  const draws = b.finish(index);
  return { draws, materials: mats, images: imagesList, samplers, bounds: boundsOf(draws) };
}
