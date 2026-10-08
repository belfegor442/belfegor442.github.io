export const MAP = { w: 1720, h: 1180, wall: 36 };

export const OBJECTS = [
  { id: 'w-n', type: 'wall', x: 0, y: 0, w: MAP.w, h: MAP.wall, solid: true, hgt: 54 },
  { id: 'w-s', type: 'wall', x: 0, y: MAP.h - MAP.wall, w: MAP.w, h: MAP.wall, solid: true, hgt: 54 },
  { id: 'w-w', type: 'wall', x: 0, y: 0, w: MAP.wall, h: MAP.h, solid: true, hgt: 54 },
  { id: 'w-e', type: 'wall', x: MAP.w - MAP.wall, y: 0, w: MAP.wall, h: MAP.h, solid: true, hgt: 54 },

  { id: 'rug', type: 'rug', x: 420, y: 400, w: 780, h: 470, solid: false, hgt: 0 },
  { id: 'neon', type: 'sign', x: 640, y: 6, w: 430, h: 34, solid: false, hgt: 64, label: 'BREW' },

  { id: 'bar', type: 'bar', x: 1190, y: 74, w: 460, h: 112, solid: true, hgt: 48 },
  { id: 'shelf', type: 'shelf', x: 1210, y: 40, w: 420, h: 30, solid: false, hgt: 74 },

  { id: 't1', type: 'table', kind: 'poker', x: 236, y: 292, w: 204, h: 142, solid: true, hgt: 40 },
  { id: 't2', type: 'table', kind: 'poker', x: 636, y: 246, w: 204, h: 142, solid: true, hgt: 40 },
  { id: 't3', type: 'table', kind: 'poker', x: 236, y: 706, w: 204, h: 142, solid: true, hgt: 40 },
  { id: 't4', type: 'table', kind: 'poker', x: 636, y: 754, w: 204, h: 142, solid: true, hgt: 40 },
  { id: 't5', type: 'table', kind: 'poker', x: 1112, y: 560, w: 250, h: 170, solid: true, hgt: 42 },

  { id: 'plant-1', type: 'plant', x: 74, y: 96, w: 74, h: 74, solid: true, hgt: 62 },
  { id: 'plant-2', type: 'plant', x: 1560, y: 1010, w: 74, h: 74, solid: true, hgt: 62 },
  { id: 'plant-3', type: 'plant', x: 78, y: 1016, w: 74, h: 74, solid: true, hgt: 62 },
  { id: 'column', type: 'column', x: 1012, y: 300, w: 54, h: 54, solid: true, hgt: 150 },
  { id: 'column-2', type: 'column', x: 1012, y: 900, w: 54, h: 54, solid: true, hgt: 150 },

  { id: 'lights', type: 'switch', x: 46, y: 548, w: 22, h: 56, solid: false, hgt: 44 },
  { id: 'coat', type: 'decor', x: 140, y: 40, w: 110, h: 26, solid: false, hgt: 60, label: 'WARDROBE' }
];

const TABLES = OBJECTS.filter(o => o.type === 'table');
const BAR_STOOLS = 5;

function facing(from, to) { return Math.atan2(to.y - from.y, to.x - from.x); }

function seat(id, table, x, y, dir) {
  return { id, table, x, y, dir, occupiedBy: null };
}

export const SEATS = (() => {
  const list = [];
  for (const t of TABLES) {
    const cx = t.x + t.w / 2, cy = t.y + t.h / 2;
    list.push(seat(t.id + '-n', t.id, cx, t.y - 30, facing({ x: cx, y: t.y - 30 }, { x: cx, y: cy })));
    list.push(seat(t.id + '-s', t.id, cx, t.y + t.h + 30, facing({ x: cx, y: t.y + t.h + 30 }, { x: cx, y: cy })));
    list.push(seat(t.id + '-w', t.id, t.x - 30, cy, facing({ x: t.x - 30, y: cy }, { x: cx, y: cy })));
    list.push(seat(t.id + '-e', t.id, t.x + t.w + 30, cy, facing({ x: t.x + t.w + 30, y: cy }, { x: cx, y: cy })));
  }
  const bar = OBJECTS.find(o => o.id === 'bar');
  for (let i = 0; i < BAR_STOOLS; i++) {
    const x = bar.x + 62 + i * 84;
    const y = bar.y + bar.h + 34;
    list.push(seat('bar-' + i, null, x, y, facing({ x, y }, { x, y: bar.y + bar.h })));
  }
  return list;
})();

export const SPAWNS = [
  { x: 700, y: 1080 }, { x: 800, y: 1080 }, { x: 900, y: 1080 },
  { x: 600, y: 1076 }, { x: 1000, y: 1076 }, { x: 750, y: 1010 },
  { x: 850, y: 1010 }, { x: 1150, y: 1080 }, { x: 460, y: 1076 },
  { x: 1300, y: 1060 }, { x: 520, y: 980 }, { x: 1220, y: 980 }
];

const SOLIDS = OBJECTS.filter(o => o.solid);
export const SEAT_BY_ID = new Map(SEATS.map(s => [s.id, s]));
export const OBJ_BY_ID = new Map(OBJECTS.map(o => [o.id, o]));

export function seatFree(id) {
  const s = SEAT_BY_ID.get(id);
  return !!s && !s.occupiedBy;
}
export function tableOf(seatId) {
  const s = SEAT_BY_ID.get(seatId);
  return s && s.table ? OBJ_BY_ID.get(s.table) : null;
}
export function seatsAt(tableId) {
  return SEATS.filter(s => s.table === tableId);
}

function circleHitsRect(x, y, r, rect) {
  const nx = Math.max(rect.x, Math.min(x, rect.x + rect.w));
  const ny = Math.max(rect.y, Math.min(y, rect.y + rect.h));
  const dx = x - nx, dy = y - ny;
  return dx * dx + dy * dy < r * r;
}
export function blocked(x, y, r = 14) {
  for (const s of SOLIDS) if (circleHitsRect(x, y, r, s)) return true;
  return false;
}
export function move(x, y, nx, ny, r = 14) {
  let px = x;
  if (!blocked(nx, y, r)) px = nx;
  let py = y;
  if (!blocked(px, ny, r)) py = ny;
  return { x: px, y: py };
}
export function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
export function nearestSeat(x, y, maxDist) {
  let best = null, bd = maxDist;
  for (const s of SEATS) {
    const d = Math.hypot(s.x - x, s.y - y);
    if (d < bd) { bd = d; best = s; }
  }
  return best;
}
export function insideInteract(x, y, range) {
  for (const o of OBJECTS) {
    if (o.type === 'switch') {
      const d = Math.hypot(o.x + o.w / 2 - x, o.y + o.h / 2 - y);
      if (d < range) return o;
    }
  }
  return null;
}
