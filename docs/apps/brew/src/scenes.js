// Pure scene data for the lobby game terminals and the 7 game rooms.
// No DOM and no geometry here (that lives in scenesGeom.js, browser only):
// the geometry builders read these same layout constants so collision rects,
// seats and spawns can never drift apart from what you see on screen.

export const ROOM_KINDS = ['slots', 'dice', 'roulette', 'poker', 'coinflip', 'highlow', 'rps'];

export const GAME_META = {
  slots: { label: 'SLOTS', vote: 'SLOT GAME', accent: [1.0, 0.24, 0.52], hex: '#ff3d85' },
  dice: { label: 'DICE', vote: 'DICE GAME', accent: [1.0, 0.78, 0.30], hex: '#ffc74d' },
  roulette: { label: 'ROULETTE', vote: 'ROULETTE', accent: [0.35, 0.85, 0.45], hex: '#59d973' },
  poker: { label: 'POKER', vote: 'POKER', accent: [0.30, 0.60, 1.0], hex: '#4d99ff' },
  coinflip: { label: 'COINFLIP', vote: 'COINFLIP', accent: [1.0, 0.42, 0.30], hex: '#ff6b4d' },
  highlow: { label: 'HIGH-LOW', vote: 'HIGH-LOW', accent: [0.70, 0.42, 1.0], hex: '#b36bff' },
  rps: { label: 'RPS', vote: 'RPS', accent: [0.30, 0.88, 0.82], hex: '#4de0d2' }
};

export const VOTE_MS = 25000;

// Six arcade-style vote terminals along the lobby's south wall, in final map
// coordinates (mapSpace: exempt from the KX/KZ pass). The five west-wall slot
// banks act as the 'slots' vote point, so every game has exactly one spot.
export const LOBBY_TERMINALS = (() => {
  const kinds = ['dice', 'roulette', 'poker', 'coinflip', 'highlow', 'rps'];
  return kinds.map((kind, i) => {
    const cx = 1150 + i * 100;
    return {
      id: 'term-' + kind, type: 'terminal', kind,
      x: cx - 35, y: 1150, w: 70, h: 48, solid: true, hgt: 62, mapSpace: true
    };
  });
})();

export const ROOM_SIZE = { w: 900, h: 700, wall: 36 };

function seatAt(id, table, x, y, cx, cy) {
  return { id, table, x, y, dir: Math.atan2(cy - y, cx - x), occupiedBy: null };
}

function ringSeats(prefix, tableId, cx, cy, spots) {
  return spots.map((sp, i) => seatAt(prefix + i, tableId, sp[0], sp[1], cx, cy));
}

// Data for one game room. Every room shares the same shell: four solid walls,
// a glowing EXIT portal centred on the south wall and a spawn cluster just
// north of it. Furniture depends on the game.
export function buildRoomData(kind) {
  const { w: W, h: H, wall: T } = ROOM_SIZE;
  const OBJECTS = [
    { id: 'w-n', type: 'wall', x: 0, y: 0, w: W, h: T, solid: true, hgt: 150, mapSpace: true },
    { id: 'w-s', type: 'wall', x: 0, y: H - T, w: W, h: T, solid: true, hgt: 150, mapSpace: true },
    { id: 'w-w', type: 'wall', x: 0, y: 0, w: T, h: H, solid: true, hgt: 150, mapSpace: true },
    { id: 'w-e', type: 'wall', x: W - T, y: 0, w: T, h: H, solid: true, hgt: 150, mapSpace: true },
    { id: 'exit', type: 'portal', x: W / 2 - 70, y: H - T - 26, w: 140, h: 26, solid: false, hgt: 96, mapSpace: true }
  ];
  const SEATS = [];
  const meta = GAME_META[kind] || GAME_META.slots;

  if (kind === 'slots') {
    // Six skill-stop cabinets along the north wall; players stand south of
    // each one (the face is at y = 70 + 44).
    const cxList = [130, 270, 410, 550, 690, 830];
    cxList.forEach((cx, i) => {
      OBJECTS.push({
        id: 'sm-' + i, type: 'machine', kind: 'slots',
        x: cx - 38, y: 70, w: 76, h: 44, solid: true, hgt: 66, mapSpace: true
      });
    });
  } else if (kind === 'poker') {
    for (const [i, x] of [240, 540].entries()) {
      const tid = 'poker:' + (i + 1);
      const t = { id: tid, type: 'table', kind: 'poker', x, y: 240, w: 121, h: 211, solid: true, hgt: 32, mapSpace: true };
      OBJECTS.push(t);
      const cx = x + t.w / 2, cy = t.y + t.h / 2;
      SEATS.push(...ringSeats(tid + '-', tid, cx, cy, [
        [x - 42, t.y + 60], [x + t.w + 42, t.y + 60],
        [x - 42, t.y + 160], [x + t.w + 42, t.y + 160],
        [cx, t.y + t.h + 55]
      ]));
    }
  } else if (kind === 'roulette') {
    const tid = 'roulette:1';
    const t = { id: tid, type: 'table', kind: 'roulette', x: 395, y: 250, w: 109, h: 226, solid: true, hgt: 36, mapSpace: true };
    OBJECTS.push(t);
    const cx = t.x + t.w / 2, cy = t.y + t.h / 2;
    SEATS.push(...ringSeats(tid + '-', tid, cx, cy, [
      [t.x - 40, t.y + 50], [t.x + t.w + 40, t.y + 50],
      [t.x - 40, cy], [t.x + t.w + 40, cy],
      [t.x - 40, t.y + 176], [t.x + t.w + 40, t.y + 176]
    ]));
  } else {
    // Round tables for the pick-style 2-player games.
    for (const [i, x] of [250, 520].entries()) {
      const tid = kind + ':' + (i + 1);
      const t = { id: tid, type: 'table', kind, x, y: 270, w: 130, h: 130, solid: true, hgt: 30, mapSpace: true };
      OBJECTS.push(t);
      const cx = x + t.w / 2, cy = t.y + t.h / 2;
      SEATS.push(...ringSeats(tid + '-', tid, cx, cy, [
        [cx - 95, cy], [cx + 95, cy], [cx, cy - 95], [cx, cy + 95]
      ]));
    }
  }

  const SPAWNS = [
    { x: W / 2, y: H - 130 }, { x: W / 2 - 70, y: H - 100 },
    { x: W / 2 + 70, y: H - 100 }, { x: W / 2, y: H - 180 }
  ];

  const acc = meta.accent;
  const LIGHTS = [
    { x: 300, y: 64, z: 300, r: 260, col: [1.0, 0.84, 0.6], int: 0.95 },
    { x: 600, y: 64, z: 300, r: 260, col: [1.0, 0.84, 0.6], int: 0.95 },
    { x: W / 2, y: 70, z: 80, r: 320, col: acc, int: 1.15 },
    { x: W / 2, y: 40, z: H - 70, r: 240, col: [0.6, 0.9, 1.0], int: 0.7 }
  ];

  return { id: kind, MAP: { w: W, h: H, wall: T }, OBJECTS, SEATS, SPAWNS, LIGHTS };
}

function circleHitsRect(x, y, r, rect) {
  const nx = Math.max(rect.x, Math.min(x, rect.x + rect.w));
  const ny = Math.max(rect.y, Math.min(y, rect.y + rect.h));
  const dx = x - nx, dy = y - ny;
  return dx * dx + dy * dy < r * r;
}

// Wraps one scene's raw data with the derived indexes and the collision /
// proximity helpers the authority and the client both need. `nav` starts null
// (rect-only collision) and is filled in by the renderer once the geometry's
// nav grid is rasterised.
export function makeSceneWorld(data) {
  const w = {
    id: data.id,
    MAP: data.MAP,
    OBJECTS: data.OBJECTS,
    SEATS: data.SEATS,
    SPAWNS: data.SPAWNS,
    LIGHTS: data.LIGHTS || [],
    nav: null
  };
  w.SEAT_BY_ID = new Map(w.SEATS.map(s => [s.id, s]));
  w.OBJ_BY_ID = new Map(w.OBJECTS.map(o => [o.id, o]));
  w.SOLIDS = w.OBJECTS.filter(o => o.solid);

  w.seatFree = function seatFree(id) {
    const s = w.SEAT_BY_ID.get(id);
    return !!s && !s.occupiedBy;
  };

  w.tableOf = function tableOf(seatId) {
    const s = w.SEAT_BY_ID.get(seatId);
    return s && s.table ? w.OBJ_BY_ID.get(s.table) : null;
  };

  w.dist = function dist(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  function navBlockedAt(x, y, r) {
    const nav = w.nav;
    if (!nav) return false;
    const c = nav.cell;
    const x0 = Math.max(0, Math.floor((x - r) / c));
    const x1 = Math.min(nav.cols - 1, Math.floor((x + r) / c));
    const z0 = Math.max(0, Math.floor((y - r) / c));
    const z1 = Math.min(nav.rows - 1, Math.floor((y + r) / c));
    if (x1 < x0 || z1 < z0) return true;
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) if (nav.block[cz * nav.cols + cx]) return true;
    }
    return false;
  }

  w.blocked = function blocked(x, y, r = 14) {
    if (navBlockedAt(x, y, r)) return true;
    if (!w.nav) {
      for (const s of w.SOLIDS) if (circleHitsRect(x, y, r, s)) return true;
    }
    return false;
  };

  w.move = function move(x, y, nx, ny, r = 14) {
    const M = w.MAP;
    const minX = M.wall + r, maxX = M.w - M.wall - r;
    const minY = M.wall + r, maxY = M.h - M.wall - r;
    nx = Math.max(minX, Math.min(maxX, Number(nx) || x));
    ny = Math.max(minY, Math.min(maxY, Number(ny) || y));
    const tight = Math.max(4, r - 6);
    const stuck = w.blocked(x, y, r);
    let px = x;
    if (!w.blocked(nx, y, r)) px = nx;
    let py = y;
    if (!w.blocked(px, ny, r)) py = ny;
    if (stuck && px === x && py === y && !w.blocked(nx, ny, r)) { px = nx; py = ny; }
    if (px === x && !w.blocked(nx, y, tight)) px = nx;
    if (py === y && !w.blocked(px, ny, tight)) py = ny;
    if (px === x && py === y && (nx !== x || ny !== y)) {
      const dx = nx - x, dy = ny - y;
      const len = Math.hypot(dx, dy) || 1;
      const tx = -dy / len, ty = dx / len;
      for (const off of [6, 12, 20, 30]) {
        if (!w.blocked(x + tx * off + dx, y + ty * off + dy, tight)) {
          px = x + tx * off + dx; py = y + ty * off + dy; break;
        }
        if (!w.blocked(x - tx * off + dx, y - ty * off + dy, tight)) {
          px = x - tx * off + dx; py = y - ty * off + dy; break;
        }
      }
    }
    return { x: px, y: py };
  };

  w.eject = function eject(x, y, r = 14) {
    if (!w.blocked(x, y, r)) return { x, y };
    const c = w.nav ? w.nav.cell : 16;
    const M = w.MAP;
    const minX = M.wall + r, maxX = M.w - M.wall - r;
    const minY = M.wall + r, maxY = M.h - M.wall - r;
    let first = null;
    for (let ring = 1; ring <= 14; ring++) {
      const rad = ring * c;
      for (let a = 0; a < 24; a++) {
        const th = a * Math.PI / 12;
        const px = x + Math.cos(th) * rad, py = y + Math.sin(th) * rad;
        if (px < minX || px > maxX || py < minY || py > maxY) continue;
        if (w.blocked(px, py, r)) continue;
        if (!first) first = { x: px, y: py };
        if (!w.blocked(px + 24, py, r) || !w.blocked(px - 24, py, r) ||
            !w.blocked(px, py + 24, r) || !w.blocked(px, py - 24, r)) return { x: px, y: py };
      }
    }
    return first || { x, y };
  };

  w.nearestSeat = function nearestSeat(x, y, maxDist) {
    let best = null, bd = maxDist;
    for (const s of w.SEATS) {
      const d = Math.hypot(s.x - x, s.y - y);
      if (d <= bd) { bd = d; best = s; }
    }
    return best;
  };

  w.seatsAt = function seatsAt(tableId) {
    return w.SEATS.filter(s => s.table === tableId);
  };

  w.insideInteract = function insideInteract(x, y, range) {
    for (const o of w.OBJECTS) {
      if (o.type === 'switch') {
        const d = Math.hypot(o.x + o.w / 2 - x, o.y + o.h / 2 - y);
        if (d < range) return o;
      }
    }
    return null;
  };

  // Nearest interactive machine cabinet: lobby slot banks (type 'slots') and
  // in-room skill cabinets (type 'machine'). Returns the rect when within
  // maxDist of its face.
  w.nearestMachine = function nearestMachine(x, y, maxDist) {
    let best = null, bd = maxDist;
    for (const o of w.OBJECTS) {
      if (o.type !== 'slots' && o.type !== 'machine') continue;
      const nx = Math.max(o.x, Math.min(x, o.x + o.w));
      const ny = Math.max(o.y, Math.min(y, o.y + o.h));
      const d = Math.hypot(x - nx, y - ny);
      if (d <= bd) { bd = d; best = o; }
    }
    return best;
  };

  // Nearest EXIT portal, within maxDist of its rect.
  w.nearestPortal = function nearestPortal(x, y, maxDist) {
    let best = null, bd = maxDist;
    for (const o of w.OBJECTS) {
      if (o.type !== 'portal') continue;
      const nx = Math.max(o.x, Math.min(x, o.x + o.w));
      const ny = Math.max(o.y, Math.min(y, o.y + o.h));
      const d = Math.hypot(x - nx, y - ny);
      if (d <= bd) { bd = d; best = o; }
    }
    return best;
  };

  // Nearest lobby vote point for any game: the six south-wall terminals plus
  // the west-wall slot banks (kind 'slots'). Rooms have none.
  w.nearestVotePoint = function nearestVotePoint(x, y, maxDist) {
    let best = null, bd = maxDist;
    for (const o of w.OBJECTS) {
      let gk = null;
      if (o.type === 'terminal') gk = o.kind;
      else if (o.type === 'slots') gk = 'slots';
      if (!gk) continue;
      const nx = Math.max(o.x, Math.min(x, o.x + o.w));
      const ny = Math.max(o.y, Math.min(y, o.y + o.h));
      const d = Math.hypot(x - nx, y - ny);
      if (d <= bd) { bd = d; best = { kind: gk, id: o.id, x: nx, y: ny }; }
    }
    return best;
  };

  return w;
}
