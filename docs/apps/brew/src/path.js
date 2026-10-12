// A* over the nav grid for click/tap-to-move. Pure module: takes the nav
// object explicitly so it runs in node tests without touching world state.

function cellOpen(nav, cx, cz) {
  if (cx < 0 || cz < 0 || cx >= nav.cols || cz >= nav.rows) return false;
  return !nav.block[cz * nav.cols + cx];
}

export function gridBlocked(nav, x, y, r = 14) {
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

// Nearest open cell to (cx, cz), spiralling outward. Null when nothing free
// within `maxRing` cells (blocked island bigger than the search).
function nearestOpen(nav, cx, cz, maxRing = 8) {
  if (cellOpen(nav, cx, cz)) return { cx, cz };
  for (let ring = 1; ring <= maxRing; ring++) {
    let best = null, bd = Infinity;
    for (let dz = -ring; dz <= ring; dz++) {
      for (let dx = -ring; dx <= ring; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
        const nx = cx + dx, nz = cz + dz;
        if (!cellOpen(nav, nx, nz)) continue;
        const d = dx * dx + dz * dz;
        if (d < bd) { bd = d; best = { cx: nx, cz: nz }; }
      }
    }
    if (best) return best;
  }
  return null;
}

class Heap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(node) {
    const a = this.a;
    a.push(node);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f <= a[i].f) break;
      const t = a[p]; a[p] = a[i]; a[i] = t;
      i = p;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let s = i;
        if (l < a.length && a[l].f < a[s].f) s = l;
        if (r < a.length && a[r].f < a[s].f) s = r;
        if (s === i) break;
        const t = a[s]; a[s] = a[i]; a[i] = t;
        i = s;
      }
    }
    return top;
  }
}

function lineClear(nav, x0, y0, x1, y1, r) {
  const dx = x1 - x0, dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(len / 6));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    if (gridBlocked(nav, x0 + dx * t, y0 + dy * t, r)) return false;
  }
  return true;
}

// String-pull: skip waypoints when the straight segment is walkable.
function smooth(nav, pts, r) {
  if (pts.length < 3) return pts;
  const out = [pts[0]];
  let i = 0;
  while (i < pts.length - 1) {
    let far = i + 1;
    for (let j = pts.length - 1; j > i + 1; j--) {
      if (lineClear(nav, pts[i].x, pts[i].y, pts[j].x, pts[j].y, r)) { far = j; break; }
    }
    out.push(pts[far]);
    i = far;
  }
  return out;
}

// Returns [{x, y}...] of world-space waypoints (start excluded), or null when
// no route exists. `nav` is the buildNav result: {cell, cols, rows, block}.
export function findPath(nav, sx, sy, tx, ty, radius = 14) {
  if (!nav) return null;
  const c = nav.cell;
  const start = nearestOpen(nav, Math.floor(sx / c), Math.floor(sy / c));
  const goal = nearestOpen(nav, Math.floor(tx / c), Math.floor(ty / c));
  if (!start || !goal) return null;
  if (start.cx === goal.cx && start.cz === goal.cz) {
    return [{ x: tx, y: ty }];
  }
  const cols = nav.cols, rows = nav.rows;
  const N = cols * rows;
  const g = new Float32Array(N).fill(Infinity);
  const from = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const gi = goal.cz * cols + goal.cx;
  const h = (cx, cz) => {
    const dx = Math.abs(cx - goal.cx), dz = Math.abs(cz - goal.cz);
    return (dx + dz) + (Math.SQRT2 - 2) * Math.min(dx, dz);
  };
  const open = new Heap();
  const si = start.cz * cols + start.cx;
  g[si] = 0;
  open.push({ i: si, f: h(start.cx, start.cz) });
  const DIRS = [
    [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
    [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]
  ];
  let found = false;
  let iter = 0;
  const cap = N * 2;
  while (open.size && iter++ < cap) {
    const cur = open.pop();
    if (closed[cur.i]) continue;
    closed[cur.i] = 1;
    if (cur.i === gi) { found = true; break; }
    const cx = cur.i % cols, cz = (cur.i / cols) | 0;
    for (const [dx, dz, cost] of DIRS) {
      const nx = cx + dx, nz = cz + dz;
      if (!cellOpen(nav, nx, nz)) continue;
      if (dx && dz && (!cellOpen(nav, cx + dx, cz) || !cellOpen(nav, cx, cz + dz))) continue;
      const ni = nz * cols + nx;
      if (closed[ni]) continue;
      const ng = g[cur.i] + cost;
      if (ng < g[ni]) {
        g[ni] = ng;
        from[ni] = cur.i;
        open.push({ i: ni, f: ng + h(nx, nz) });
      }
    }
  }
  if (!found) return null;
  const cells = [];
  for (let i = gi; i !== -1; i = from[i]) {
    cells.push({ x: (i % cols) * c + c / 2, y: (((i / cols) | 0)) * c + c / 2 });
    if (i === si) break;
  }
  cells.reverse();
  // Walk right onto the exact click point when it is standable; otherwise stop
  // at the centre of the nearest open cell (goal was spiralled above).
  if (!gridBlocked(nav, tx, ty, radius)) cells[cells.length - 1] = { x: tx, y: ty };
  return smooth(nav, cells, radius);
}
