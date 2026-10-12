const IDENT = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

function newBatch() {
  return { pos: [], nrm: [], uv: [], idx: [] };
}

function pushVert(b, x, y, z, nx, ny, nz, u, v) {
  b.pos.push(x, y, z);
  b.nrm.push(nx, ny, nz);
  b.uv.push(u, v);
  return b.pos.length / 3 - 1;
}

function faceUV(x, y, z, nx, ny, nz, tile) {
  const t = tile || 1;
  if (Math.abs(ny) > 0.5) return [x / t, z / t];
  if (Math.abs(nx) > 0.5) return [z / t, y / t];
  return [x / t, y / t];
}

function localUV(a, b, tile) {
  const t = tile || 1;
  return [a / t, b / t];
}

export class Builder {
  constructor() {
    this.batches = new Map();
  }

  batch(name) {
    let b = this.batches.get(name);
    if (!b) {
      b = newBatch();
      this.batches.set(name, b);
    }
    return b;
  }

  quad(name, p, uvs, flip) {
    const b = this.batch(name);
    const [p0, p1, p2, p3] = p;
    const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
    const vx = p3[0] - p0[0], vy = p3[1] - p0[1], vz = p3[2] - p0[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    if (flip) { nx = -nx; ny = -ny; nz = -nz; }
    const base = b.pos.length / 3;
    for (let i = 0; i < 4; i++) {
      pushVert(b, p[i][0], p[i][1], p[i][2], nx, ny, nz, uvs[i][0], uvs[i][1]);
    }
    if (flip) b.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
    else b.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  box(name, cx, cy, cz, w, h, d, opts = {}) {
    const b = this.batch(name);
    const hw = w / 2, hh = h / 2, hd = d / 2;
    const tile = opts.tile;
    const rot = opts.rot || 0;
    const c = Math.cos(rot), s = Math.sin(rot);
    const rotP = (x, y, z) => [cx + x * c + z * s, cy + y, cz - x * s + z * c];
    const faces = [
      { n: [1, 0, 0], v: [[hw, -hh, hd], [hw, -hh, -hd], [hw, hh, -hd], [hw, hh, hd]], a: [hd, -hh], ab: [-hd, -hh], aa: [-hd, hh], ac: [hd, hh] },
      { n: [-1, 0, 0], v: [[-hw, -hh, -hd], [-hw, -hh, hd], [-hw, hh, hd], [-hw, hh, -hd]], a: [-hd, -hh], ab: [hd, -hh], aa: [hd, hh], ac: [-hd, hh] },
      { n: [0, 0, 1], v: [[-hw, -hh, hd], [hw, -hh, hd], [hw, hh, hd], [-hw, hh, hd]], a: [-hw, -hh], ab: [hw, -hh], aa: [hw, hh], ac: [-hw, hh] },
      { n: [0, 0, -1], v: [[hw, -hh, -hd], [-hw, -hh, -hd], [-hw, hh, -hd], [hw, hh, -hd]], a: [hw, -hh], ab: [-hw, -hh], aa: [-hw, hh], ac: [hw, hh] },
      { n: [0, 1, 0], v: [[-hw, hh, hd], [hw, hh, hd], [hw, hh, -hd], [-hw, hh, -hd]], a: [-hw, hd], ab: [hw, hd], aa: [hw, -hd], ac: [-hw, -hd] },
      { n: [0, -1, 0], v: [[-hw, -hh, -hd], [hw, -hh, -hd], [hw, -hh, hd], [-hw, -hh, hd]], a: [-hw, -hd], ab: [hw, -hd], aa: [hw, hd], ac: [-hw, hd] }
    ];
    const skip = opts.skip || '';
    for (const f of faces) {
      if (skip.indexOf(f.n.join('')) >= 0) continue;
      if (opts.noTop && f.n[1] > 0) continue;
      if (opts.noBottom && f.n[1] < 0) continue;
      const wn = [f.n[0] * c + f.n[2] * s, f.n[1], -f.n[0] * s + f.n[2] * c];
      const base = b.pos.length / 3;
      const corners = [f.a, f.ab, f.aa, f.ac];
      for (let i = 0; i < 4; i++) {
        const p = rotP(f.v[i][0], f.v[i][1], f.v[i][2]);
        let u, v;
        if (opts.localUV || rot) {
          u = corners[i][0] / (tile || 1);
          v = corners[i][1] / (tile || 1);
        } else {
          const fu = faceUV(p[0], p[1], p[2], wn[0], wn[1], wn[2], tile);
          u = fu[0] + (opts.uvOff ? opts.uvOff[0] : 0);
          v = fu[1] + (opts.uvOff ? opts.uvOff[1] : 0);
        }
        pushVert(b, p[0], p[1], p[2], wn[0], wn[1], wn[2], u, v);
      }
      b.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }

  cyl(name, x, y, z, rBot, rTop, h, seg = 14, opts = {}) {
    const b = this.batch(name);
    const tile = opts.tile;
    const base = b.pos.length / 3;
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      const u = (i / seg) * (tile ? 1 : 1);
      pushVert(b, x + ca * rBot, y, z + sa * rBot, ca, 0, sa, u * (opts.uScale || 1), 0);
      pushVert(b, x + ca * rTop, y + h, z + sa * rTop, ca, 0, sa, u * (opts.uScale || 1), h / (tile || 1));
    }
    for (let i = 0; i < seg; i++) {
      const t = base + i * 2;
      b.idx.push(t, t + 2, t + 3, t, t + 3, t + 1);
    }
    if (opts.top !== false && rTop > 0.01) {
      const cb = b.pos.length / 3;
      pushVert(b, x, y + h, z, 0, 1, 0, 0.5, 0.5);
      for (let i = 0; i <= seg; i++) {
        const a = (i / seg) * Math.PI * 2;
        pushVert(b, x + Math.cos(a) * rTop, y + h, z + Math.sin(a) * rTop, 0, 1, 0,
          0.5 + Math.cos(a) * 0.5, 0.5 + Math.sin(a) * 0.5);
      }
      for (let i = 0; i < seg; i++) b.idx.push(cb, cb + 1 + i, cb + 2 + i);
    }
    if (opts.bottom && rBot > 0.01) {
      const cb = b.pos.length / 3;
      pushVert(b, x, y, z, 0, -1, 0, 0.5, 0.5);
      for (let i = 0; i <= seg; i++) {
        const a = (i / seg) * Math.PI * 2;
        pushVert(b, x + Math.cos(a) * rBot, y, z + Math.sin(a) * rBot, 0, -1, 0,
          0.5 + Math.cos(a) * 0.5, 0.5 + Math.sin(a) * 0.5);
      }
      for (let i = 0; i < seg; i++) b.idx.push(cb, cb + 2 + i, cb + 1 + i);
    }
  }

  disc(name, x, y, z, rx, rz, seg = 24, opts = {}) {
    const b = this.batch(name);
    const cb = b.pos.length / 3;
    pushVert(b, x, y, z, 0, 1, 0, 0.5, 0.5);
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      pushVert(b, x + Math.cos(a) * rx, y, z + Math.sin(a) * rz, 0, 1, 0,
        0.5 + Math.cos(a) * rx / (opts.tile || 64), 0.5 + Math.sin(a) * rz / (opts.tile || 64));
    }
    for (let i = 0; i < seg; i++) b.idx.push(cb, cb + 1 + i, cb + 2 + i);
  }

  ellipsoid(name, x, y, z, rx, ry, rz, lat = 5, lon = 10, opts = {}) {
    const b = this.batch(name);
    const start = b.pos.length / 3;
    for (let i = 0; i <= lat; i++) {
      const ph = (i / lat) * Math.PI;
      const sp = Math.sin(ph), cp = Math.cos(ph);
      for (let j = 0; j <= lon; j++) {
        const th = (j / lon) * Math.PI * 2;
        const lx = rx * sp * Math.cos(th), ly = ry * cp, lz = rz * sp * Math.sin(th);
        let nx = lx / (rx * rx), ny = ly / (ry * ry), nz = lz / (rz * rz);
        const nl = Math.hypot(nx, ny, nz) || 1;
        nx /= nl; ny /= nl; nz /= nl;
        pushVert(b, x + lx, y + ly, z + lz, nx, ny, nz, j / lon, i / lat);
      }
    }
    for (let i = 0; i < lat; i++) {
      for (let j = 0; j < lon; j++) {
        const a = start + i * (lon + 1) + j;
        const t = a + lon + 1;
        b.idx.push(a, t, t + 1, a, t + 1, a + 1);
      }
    }
    void opts;
  }

  arcWall(name, cx, cz, rIn, rOut, a0, a1, h, seg = 24, opts = {}) {
    const b = this.batch(name);
    const tile = opts.tile;
    const base = b.pos.length / 3;
    for (let i = 0; i <= seg; i++) {
      const t = i / seg;
      const a = a0 + (a1 - a0) * t;
      const ca = Math.cos(a), sa = Math.sin(a);
      pushVert(b, cx + ca * rOut, 0, cz + sa * rOut, ca, 0, sa, t * (rOut - rIn) / (tile || 1), 0);
      pushVert(b, cx + ca * rOut, h, cz + sa * rOut, ca, 0, sa, t * (rOut - rIn) / (tile || 1), h / (tile || 1));
      pushVert(b, cx + ca * rIn, 0, cz + sa * rIn, -ca, 0, -sa, t * (rOut - rIn) / (tile || 1), 0);
      pushVert(b, cx + ca * rIn, h, cz + sa * rIn, -ca, 0, -sa, t * (rOut - rIn) / (tile || 1), h / (tile || 1));
    }
    for (let i = 0; i < seg; i++) {
      const t = base + i * 4;
      b.idx.push(t, t + 4, t + 5, t, t + 5, t + 1);
      b.idx.push(t + 2, t + 3, t + 7, t + 2, t + 7, t + 6);
    }
    const cap = b.pos.length / 3;
    for (let i = 0; i <= seg; i++) {
      const t = i / seg;
      const a = a0 + (a1 - a0) * t;
      const ca = Math.cos(a), sa = Math.sin(a);
      pushVert(b, cx + ca * rIn, h, cz + sa * rIn, 0, 1, 0, t * (rOut - rIn) / (tile || 1), 0);
      pushVert(b, cx + ca * rOut, h, cz + sa * rOut, 0, 1, 0, t * (rOut - rIn) / (tile || 1), (rOut - rIn) / (tile || 1));
    }
    for (let i = 0; i < seg; i++) {
      const t = cap + i * 2;
      b.idx.push(t, t + 1, t + 3, t, t + 3, t + 2);
    }
  }

  finish(materials) {
    const draws = [];
    for (const [name, b] of this.batches) {
      if (!b.idx.length) continue;
      finalizeTangents(b);
      const mat = materials[name];
      if (mat == null) throw new Error('no material for batch ' + name);
      draws.push({
        pos: new Float32Array(b.pos),
        nrm: new Float32Array(b.nrm),
        uv: new Float32Array(b.uv),
        tan: new Float32Array(b.tan),
        idx: b.idx.length > 65535 ? new Uint32Array(b.idx) : new Uint16Array(b.idx),
        mat,
        matrix: IDENT
      });
    }
    return draws;
  }
}

function finalizeTangents(b) {
  const n = b.pos.length / 3;
  const tan = new Float32Array(n * 3);
  const idx = b.idx;
  const pos = b.pos, uv = b.uv;
  for (let t = 0; t + 2 < idx.length; t += 3) {
    const i0 = idx[t] * 3, i1 = idx[t + 1] * 3, i2 = idx[t + 2] * 3;
    const u0 = idx[t] * 2, u1 = idx[t + 1] * 2, u2 = idx[t + 2] * 2;
    const e1x = pos[i1] - pos[i0], e1y = pos[i1 + 1] - pos[i0 + 1], e1z = pos[i1 + 2] - pos[i0 + 2];
    const e2x = pos[i2] - pos[i0], e2y = pos[i2 + 1] - pos[i0 + 1], e2z = pos[i2 + 2] - pos[i0 + 2];
    const du1 = uv[u1] - uv[u0], dv1 = uv[u1 + 1] - uv[u0 + 1];
    const du2 = uv[u2] - uv[u0], dv2 = uv[u2 + 1] - uv[u0 + 1];
    const r = du1 * dv2 - du2 * dv1;
    if (Math.abs(r) < 1e-12) continue;
    const f = 1 / r;
    const tx = f * (e1x * dv2 - e2x * dv1);
    const ty = f * (e1y * dv2 - e2y * dv1);
    const tz = f * (e1z * dv2 - e2z * dv1);
    for (const i of [i0, i1, i2]) {
      tan[i] += tx; tan[i + 1] += ty; tan[i + 2] += tz;
    }
  }
  for (let v = 0; v < n; v++) {
    const i = v * 3;
    const nx = b.nrm[i], ny = b.nrm[i + 1], nz = b.nrm[i + 2];
    let tx = tan[i], ty = tan[i + 1], tz = tan[i + 2];
    const d = nx * tx + ny * ty + nz * tz;
    tx -= nx * d; ty -= ny * d; tz -= nz * d;
    const l = Math.hypot(tx, ty, tz);
    if (l > 1e-6) { tan[i] = tx / l; tan[i + 1] = ty / l; tan[i + 2] = tz / l; }
    else {
      const ax = Math.abs(ny) < 0.9 ? 0 : 1, ay = Math.abs(ny) < 0.9 ? 1 : 0, az = 0;
      let cx = ny * az - nz * ay, cy = nz * ax - nx * az, cz = nx * ay - ny * ax;
      const cl = Math.hypot(cx, cy, cz) || 1;
      tan[i] = cx / cl; tan[i + 1] = cy / cl; tan[i + 2] = cz / cl;
    }
  }
  b.tan = tan;
}
