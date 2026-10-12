const CACHE = new Map();

function cv(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h || w;
  return c;
}

function hash2(x, y, seed) {
  let h = (x | 0) * 374761393 + (y | 0) * 668265263 + (seed | 0) * 1442695040;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function smooth(t) { return t * t * (3 - 2 * t); }

function vnoise(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const u = smooth(x - xi), v = smooth(y - yi);
  const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
  const ab = a + (b - a) * u;
  const cd = c + (d - c) * u;
  return ab + (cd - ab) * v;
}

function fbm(x, y, seed, oct = 4, gain = 0.5, lac = 2) {
  let amp = 1, f = 1, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += amp * vnoise(x * f, y * f, seed + i * 37);
    norm += amp;
    amp *= gain;
    f *= lac;
  }
  return sum / norm;
}

function grain(g, size, amount, seed) {
  const img = g.getImageData(0, 0, size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const n = (hash2(x, y, seed) - 0.5) * amount;
      d[i] = Math.max(0, Math.min(255, d[i] + n * 255));
      d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n * 255));
      d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n * 255));
    }
  }
  g.putImageData(img, 0, 0);
}

function shade(g, size, fn) {
  const img = g.createImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const c = fn(x / size, y / size, x, y);
      d[i] = Math.max(0, Math.min(255, c[0] * 255));
      d[i + 1] = Math.max(0, Math.min(255, c[1] * 255));
      d[i + 2] = Math.max(0, Math.min(255, c[2] * 255));
      d[i + 3] = c.length > 3 ? Math.max(0, Math.min(255, c[3] * 255)) : 255;
    }
  }
  g.putImageData(img, 0, 0);
}

function gray(size, fn) {
  const c = cv(size);
  const g = c.getContext('2d');
  shade(g, size, (u, v, x, y) => {
    const h = fn(u, v, x, y);
    return [h, h, h];
  });
  return c;
}

function heightToNormal(hc, strength) {
  const size = hc.width;
  const src = hc.getContext('2d').getImageData(0, 0, size, size).data;
  const out = cv(size);
  const g = out.getContext('2d');
  const img = g.createImageData(size, size);
  const d = img.data;
  const H = (x, y) => src[((((y % size) + size) % size) * size + (((x % size) + size) % size)) * 4] / 255;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * strength;
      const dy = (H(x, y + 1) - H(x, y - 1)) * strength;
      const nx = -dx, ny = -dy, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      const i = (y * size + x) * 4;
      d[i] = (nx / l * 0.5 + 0.5) * 255;
      d[i + 1] = (ny / l * 0.5 + 0.5) * 255;
      d[i + 2] = (nz / l * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return out;
}

function packRough(nc, rough) {
  const size = nc.width;
  const g = nc.getContext('2d');
  const img = g.getImageData(0, 0, size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const r = typeof rough === 'function' ? rough(x / size, y / size) : rough;
      d[i + 3] = Math.max(0, Math.min(255, r * 255));
    }
  }
  g.putImageData(img, 0, 0);
  return nc;
}

function packMetal(ac, metal) {
  if (!metal) return ac;
  const size = ac.width;
  const g = ac.getContext('2d');
  const img = g.getImageData(0, 0, size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const m = typeof metal === 'function' ? metal(x / size, y / size) : metal;
      d[i + 3] = Math.max(0, Math.min(255, m * 255));
    }
  }
  g.putImageData(img, 0, 0);
  return ac;
}

function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function mix(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function carpet(size) {
  const a = cv(size);
  const g = a.getContext('2d');
  const base = rgb('#3d1018');
  shade(g, size, (u, v) => {
    const w = fbm(u * 6, v * 6, 11, 4);
    let c = mix(base, rgb('#521a24'), w * 0.55);
    const dm = Math.sin(u * Math.PI * 4) * Math.sin(v * Math.PI * 4);
    const damask = Math.pow(Math.abs(dm), 3) * (0.5 + 0.5 * fbm(u * 14, v * 14, 5, 3));
    c = mix(c, rgb('#6b2430'), damask * 0.55);
    const ring = Math.abs(Math.sin((Math.hypot(u - 0.5, v - 0.5)) * Math.PI * 9));
    c = mix(c, rgb('#7a2a2c'), Math.pow(1 - ring, 14) * 0.5);
    const wear = fbm(u * 3 + 11, v * 3, 23, 3);
    c = mix(c, rgb('#2a0b10'), Math.max(0, wear - 0.55) * 1.1);
    return c;
  });
  grain(g, size, 0.1, 7);
  const h = gray(size, (u, v) => {
    const weave = (Math.sin(u * Math.PI * 96) * Math.sin(v * Math.PI * 96)) * 0.5 + 0.5;
    return 0.35 + weave * 0.12 + fbm(u * 24, v * 24, 3, 3) * 0.2;
  });
  return {
    albedo: packMetal(a, 0),
    normal: packRough(heightToNormal(h, 2.2), (u, v) => 0.86 + fbm(u * 8, v * 8, 9, 2) * 0.12)
  };
}

function tile(size) {
  const a = cv(size);
  const g = a.getContext('2d');
  const n = 4;
  shade(g, size, (u, v) => {
    const tx = Math.floor(u * n), ty = Math.floor(v * n);
    const lx = u * n - tx, ly = v * n - ty;
    const dark = (tx + ty) % 2 === 0;
    const tint = 0.9 + hash2(tx, ty, 3) * 0.2;
    const base = dark ? [0.11, 0.23, 0.19] : [0.79, 0.74, 0.64];
    const edge = Math.min(lx, 1 - lx, ly, 1 - ly);
    const grime = fbm(u * 9, v * 9, 17 + tx * 3 + ty * 7, 3);
    let c = [base[0] * tint, base[1] * tint, base[2] * tint];
    c = mix(c, [c[0] * 0.7, c[1] * 0.7, c[2] * 0.7], Math.max(0, grime - 0.5) * 1.4);
    if (edge < 0.02) c = mix(c, [0.1, 0.1, 0.09], 1 - edge / 0.02);
    const chip = hash2(tx * 31 + Math.floor(lx * 9), ty * 17 + Math.floor(ly * 9), 5);
    if (chip > 0.94) c = mix(c, [0.55, 0.5, 0.44], 0.7);
    return c;
  });
  const h = gray(size, (u, v) => {
    const gx = (u * n) % 1, gy = (v * n) % 1;
    const edge = Math.min(gx, 1 - gx, gy, 1 - gy);
    const bevel = Math.min(1, edge / 0.05);
    return 0.45 + bevel * 0.45 + fbm(u * 30, v * 30, 8, 2) * 0.08;
  });
  return {
    albedo: packMetal(a, 0),
    normal: packRough(heightToNormal(h, 3.0), (u, v) => {
      const gx = (u * n) % 1, gy = (v * n) % 1;
      const edge = Math.min(gx, 1 - gx, gy, 1 - gy);
      return edge < 0.04 ? 0.9 : 0.26;
    })
  };
}

function planks(size, seed, pal, rough) {
  const a = cv(size);
  const g = a.getContext('2d');
  const rows = 5;
  shade(g, size, (u, v) => {
    const row = Math.floor(v * rows);
    const off = hash2(row, 3, seed) * 0.7;
    const px = (u + off) % 1;
    const seam = Math.abs(((v * rows) % 1) - 0.5);
    const joint = Math.abs((px * 3) % 1 - 0.5);
    const grainN = fbm(px * 40, v * rows * 2 + row * 9, seed + row, 4, 0.55);
    const knots = Math.pow(Math.max(0, 1 - Math.hypot(((px * 3) % 1) - 0.5, ((v * rows) % 1) - 0.5) * 7), 2);
    let c = mix(pal[0], pal[1], grainN);
    c = mix(c, pal[2], knots * 0.8);
    if (seam > 0.47) c = mix(c, pal[3], (seam - 0.47) / 0.03);
    if (joint > 0.48) c = mix(c, pal[3], (joint - 0.48) / 0.02 * 0.9);
    const per = 0.88 + hash2(Math.floor(px * 3), row, seed + 5) * 0.24;
    return [c[0] * per, c[1] * per, c[2] * per];
  });
  grain(g, size, 0.07, seed + 41);
  const h = gray(size, (u, v) => {
    const row = Math.floor(v * rows);
    const off = hash2(row, 3, seed) * 0.7;
    const px = (u + off) % 1;
    const seam = Math.abs(((v * rows) % 1) - 0.5);
    const joint = Math.abs((px * 3) % 1 - 0.5);
    const gr = fbm(px * 46, v * rows * 2 + row * 9, seed + row, 4);
    let hh = 0.5 + gr * 0.3;
    if (seam > 0.46) hh = 0.15;
    if (joint > 0.47) hh = Math.min(hh, 0.2);
    return hh;
  });
  return {
    albedo: packMetal(a, 0),
    normal: packRough(heightToNormal(h, 2.6), rough || 0.55)
  };
}

function brick(size) {
  const a = cv(size);
  const g = a.getContext('2d');
  const rows = 8, cols = 4;
  g.fillStyle = '#9a9084';
  g.fillRect(0, 0, size, size);
  shade(g, size, (u, v) => {
    const rw = v * rows;
    const row = Math.floor(rw);
    const inRow = (u + (row % 2) * 0.5) * cols;
    const bi = Math.floor(inRow);
    const fx = inRow - bi, fy = rw - row;
    const mortar = 0.075;
    if (fx < mortar || fy < mortar * 1.6 || fx > 1 - mortar * 0.2 || fy > 1 - mortar * 1.2) {
      const n = fbm(u * 40, v * 40, 61, 3);
      return mix([0.62, 0.59, 0.55], [0.5, 0.48, 0.45], n);
    }
    const t = hash2(bi, row, 13);
    let c = mix(rgb('#7d3a2b'), rgb('#9b4d36'), t);
    c = mix(c, rgb('#5f2c22'), Math.max(0, fbm(u * 18, v * 18, 71, 3) - 0.5) * 1.6);
    const soot = fbm(u * 5, v * 5, 29, 3);
    c = mix(c, [0.16, 0.13, 0.12], Math.max(0, soot - 0.62) * 1.5);
    return c;
  });
  grain(g, size, 0.09, 91);
  const h = gray(size, (u, v) => {
    const rw = v * rows;
    const row = Math.floor(rw);
    const inRow = (u + (row % 2) * 0.5) * cols;
    const bi = Math.floor(inRow);
    const fx = inRow - bi, fy = rw - row;
    const mortar = 0.075;
    if (fx < mortar || fy < mortar * 1.6 || fx > 1 - mortar * 0.2 || fy > 1 - mortar * 1.2) {
      return 0.3 + fbm(u * 40, v * 40, 61, 3) * 0.1;
    }
    return 0.72 + hash2(bi, row, 13) * 0.2;
  });
  return {
    albedo: packMetal(a, 0),
    normal: packRough(heightToNormal(h, 3.4), 0.88)
  };
}

function plaster(size) {
  const a = cv(size);
  const g = a.getContext('2d');
  shade(g, size, (u, v) => {
    const base = fbm(u * 4, v * 4, 5, 4);
    let c = mix(rgb('#c4b79c'), rgb('#a89a80'), base);
    const damp = fbm(u * 2.5 + 7, v * 3, 33, 4);
    c = mix(c, rgb('#7d6f57'), Math.max(0, damp - 0.55) * 1.5);
    const crack = Math.abs(fbm(u * 6, v * 6, 77, 5) - 0.5);
    if (crack < 0.006) c = mix(c, [0.28, 0.25, 0.22], 0.75);
    return c;
  });
  grain(g, size, 0.06, 55);
  const h = gray(size, (u, v) => 0.5 + (fbm(u * 6, v * 6, 77, 5) - 0.5) * 0.6 + fbm(u * 20, v * 20, 12, 3) * 0.2);
  return {
    albedo: packMetal(a, 0),
    normal: packRough(heightToNormal(h, 1.6), 0.92)
  };
}

function brass(size) {
  const a = cv(size);
  const g = a.getContext('2d');
  shade(g, size, (u, v) => {
    const brush = fbm(u * 2, v * 90, 3, 3);
    let c = mix(rgb('#8a6a2c'), rgb('#d3ae5c'), brush);
    const tarnish = fbm(u * 3, v * 3, 41, 4);
    c = mix(c, rgb('#4a3a1c'), Math.max(0, tarnish - 0.5) * 1.7);
    const green = fbm(u * 7 + 3, v * 7, 53, 3);
    c = mix(c, rgb('#3d5a42'), Math.max(0, green - 0.72) * 2.2);
    return c;
  });
  const h = gray(size, (u, v) => 0.5 + fbm(u * 2, v * 120, 3, 3) * 0.5);
  return {
    albedo: a,
    normal: packRough(heightToNormal(h, 1.1), (u, v) => 0.22 + fbm(u * 6, v * 6, 41, 3) * 0.35),
    metal: 1
  };
}

function leather(size) {
  const a = cv(size);
  const g = a.getContext('2d');
  shade(g, size, (u, v) => {
    const cellX = (u * 2) % 1, cellY = (v * 2) % 1;
    const d = Math.hypot(cellX - 0.5, cellY - 0.5);
    const tuft = Math.max(0, 1 - d * 2.6);
    const pore = fbm(u * 60, v * 60, 7, 3);
    let c = mix(rgb('#4a141c'), rgb('#6d2028'), tuft);
    c = mix(c, rgb('#2c0c12'), Math.max(0, 0.5 - d) * 1.2);
    c = mix(c, [c[0] * 0.8, c[1] * 0.8, c[2] * 0.8], pore * 0.5);
    const crease = Math.abs(fbm(u * 8, v * 8, 19, 4) - 0.5);
    if (crease < 0.01) c = mix(c, [0.14, 0.05, 0.07], 0.7);
    return c;
  });
  const h = gray(size, (u, v) => {
    const cellX = (u * 2) % 1, cellY = (v * 2) % 1;
    const d = Math.hypot(cellX - 0.5, cellY - 0.5);
    return 0.3 + Math.max(0, 1 - d * 2.2) * 0.55 + fbm(u * 40, v * 40, 7, 3) * 0.12;
  });
  return {
    albedo: packMetal(a, 0),
    normal: packRough(heightToNormal(h, 2.4), 0.48)
  };
}

function felt(size) {
  const a = cv(size);
  const g = a.getContext('2d');
  shade(g, size, (u, v) => {
    const fib = fbm(u * 70, v * 70, 23, 3);
    const nap = fbm(u * 9, v * 9, 29, 3);
    let c = mix(rgb('#0f4430'), rgb('#1a5c40'), fib);
    c = mix(c, rgb('#0a2e20'), Math.max(0, nap - 0.55));
    return c;
  });
  grain(g, size, 0.05, 31);
  const h = gray(size, (u, v) => 0.5 + fbm(u * 70, v * 70, 23, 3) * 0.5);
  return {
    albedo: packMetal(a, 0),
    normal: packRough(heightToNormal(h, 1.4), 0.95)
  };
}

function rug(size) {
  const a = cv(size);
  const g = a.getContext('2d');
  shade(g, size, (u, v) => {
    const b = Math.min(u, v, 1 - u, 1 - v);
    let c = rgb('#2a0e14');
    if (b < 0.06) c = rgb('#7a2a26');
    else if (b < 0.085) c = rgb('#c9a45c');
    else if (b < 0.11) c = rgb('#3d1420');
    const cx = Math.abs(u - 0.5) * 2, cz = Math.abs(v - 0.5) * 2;
    const dia = Math.abs(cx + cz - 0.75);
    if (b > 0.12 && dia < 0.045) c = rgb('#c9a45c');
    const motif = Math.sin(u * Math.PI * 8) * Math.sin(v * Math.PI * 8);
    c = mix(c, rgb('#4a1820'), Math.pow(Math.abs(motif), 2) * 0.5);
    const w = fbm(u * 12, v * 12, 45, 3);
    c = mix(c, [c[0] * 0.75, c[1] * 0.75, c[2] * 0.78], Math.max(0, w - 0.5));
    return c;
  });
  grain(g, size, 0.08, 47);
  const h = gray(size, (u, v) => 0.5 + fbm(u * 60, v * 60, 23, 3) * 0.5);
  return {
    albedo: packMetal(a, 0),
    normal: packRough(heightToNormal(h, 1.5), 0.9)
  };
}

function steel(size) {
  const a = cv(size);
  const g = a.getContext('2d');
  shade(g, size, (u, v) => {
    const brush = fbm(u * 1.5, v * 120, 9, 3);
    let c = mix(rgb('#2c3038'), rgb('#565d68'), brush);
    const rust = fbm(u * 4, v * 4, 67, 4);
    c = mix(c, rgb('#6a3a22'), Math.max(0, rust - 0.66) * 2);
    const scratch = Math.abs(fbm(u * 3, v * 80, 73, 3) - 0.5);
    if (scratch < 0.004) c = mix(c, [0.75, 0.77, 0.8], 0.5);
    return c;
  });
  const h = gray(size, (u, v) => 0.5 + fbm(u * 1.5, v * 140, 9, 3) * 0.4);
  return {
    albedo: a,
    normal: packRough(heightToNormal(h, 1.0), (u, v) => 0.38 + fbm(u * 8, v * 8, 67, 3) * 0.25),
    metal: 0.65
  };
}

function glass(size) {
  const a = cv(size);
  const g = a.getContext('2d');
  shade(g, size, (u, v) => {
    const streak = fbm(u * 22, v * 2, 83, 3);
    const grime = fbm(u * 5, v * 5, 89, 4);
    let c = mix(rgb('#9fc4c8'), rgb('#6a8f96'), grime);
    const dirt = Math.max(0, streak - 0.6) * 1.6;
    c = mix(c, rgb('#4a4436'), dirt);
    return [c[0], c[1], c[2], 0.32 + grime * 0.3 + dirt * 0.25];
  });
  const h = gray(size, (u, v) => 0.5 + fbm(u * 22, v * 2, 83, 3) * 0.3);
  return {
    albedo: a,
    normal: packRough(heightToNormal(h, 0.8), 0.14),
    blend: true
  };
}

function neon(size) {
  const a = cv(size);
  const g = a.getContext('2d');
  g.fillStyle = '#000000';
  g.fillRect(0, 0, size, size);
  shade(g, size, (u, v) => {
    const d = Math.hypot(u - 0.5, v - 0.5);
    const glow = Math.max(0, 1 - d * 2.1);
    return mix(rgb('#120406'), rgb('#ff3c6e'), Math.pow(glow, 0.7));
  });
  return {
    albedo: a,
    normal: packRough(cv(size), 0.5),
    unlit: true,
    emissive: [2.4, 0.55, 0.95]
  };
}

function dance(size) {
  const a = cv(size);
  const g = a.getContext('2d');
  const n = 4;
  shade(g, size, (u, v) => {
    const tx = Math.floor(u * n), ty = Math.floor(v * n);
    const lx = u * n - tx, ly = v * n - ty;
    const gold = (tx + ty) % 2 === 0;
    const tint = 0.92 + hash2(tx, ty, 9) * 0.16;
    let c = gold ? rgb('#9a7434') : rgb('#1a6a68');
    c = [c[0] * tint, c[1] * tint, c[2] * tint];
    const edge = Math.min(lx, 1 - lx, ly, 1 - ly);
    if (edge < 0.06) c = mix(c, [0.05, 0.05, 0.06], 0.8 * (1 - edge / 0.06));
    const spec = fbm(u * 20, v * 20, 15, 2);
    c = mix(c, [c[0] * 1.25, c[1] * 1.25, c[2] * 1.2], spec * 0.25);
    return c;
  });
  grain(g, size, 0.05, 19);
  const h = gray(size, (u, v) => {
    const gx = (u * n) % 1, gy = (v * n) % 1;
    const edge = Math.min(gx, 1 - gx, gy, 1 - gy);
    return edge < 0.07 ? 0.3 : 0.62;
  });
  return {
    albedo: packMetal(a, 0),
    normal: packRough(heightToNormal(h, 2.2), 0.35),
    emissive: [0.22, 0.2, 0.12]
  };
}

function bulb(size) {
  const a = cv(size);
  const g = a.getContext('2d');
  g.fillStyle = '#000000';
  g.fillRect(0, 0, size, size);
  shade(g, size, (u, v) => {
    const d = Math.hypot(u - 0.5, v - 0.5);
    const glow = Math.pow(Math.max(0, 1 - d * 2.4), 0.55);
    return mix(rgb('#241406'), rgb('#ffd98a'), glow);
  });
  return {
    albedo: a,
    normal: packRough(cv(size), 0.5),
    unlit: true,
    emissive: [2.1, 1.55, 0.75]
  };
}

// Volumetric beam haze for the blend batch. Canvas y=0 (top) maps to cone
// bottom (uv v=0) so the alpha ramps up toward the lamp.
function spotCone(size, hexCol, peak, emissive) {
  const a = cv(size);
  const g = a.getContext('2d');
  const c = rgb(hexCol);
  shade(g, size, (u, v) => {
    const edge = Math.min(u, 1 - u);
    const soft = edge < 0.08 ? edge / 0.08 : 1;
    const alpha = Math.pow(v, 1.7) * peak * soft;
    return [c[0], c[1], c[2], alpha];
  });
  return {
    albedo: a,
    normal: packRough(cv(size), 0.5),
    blend: true,
    emissive
  };
}

function chip(size, hexCol) {
  const a = cv(size);
  const g = a.getContext('2d');
  const col = rgb(hexCol);
  g.fillStyle = '#0c0c10';
  g.fillRect(0, 0, size, size);
  const cx = size / 2, cy = size / 2, r = size * 0.46;
  g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2);
  g.fillStyle = `rgb(${(col[0] * 255) | 0},${(col[1] * 255) | 0},${(col[2] * 255) | 0})`;
  g.fill();
  for (let i = 0; i < 8; i++) {
    const t0 = (i / 8) * Math.PI * 2 + 0.12, t1 = ((i + 1) / 8) * Math.PI * 2 - 0.12;
    g.beginPath();
    g.arc(cx, cy, r * 0.9, t0, t1);
    g.arc(cx, cy, r * 0.62, t1, t0, true);
    g.closePath();
    g.fillStyle = '#efe6d2';
    g.fill();
  }
  g.beginPath(); g.arc(cx, cy, r * 0.5, 0, Math.PI * 2);
  g.fillStyle = `rgb(${(col[0] * 210) | 0},${(col[1] * 210) | 0},${(col[2] * 210) | 0})`;
  g.fill();
  g.strokeStyle = 'rgba(0,0,0,.5)';
  g.lineWidth = 2;
  g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
  return {
    albedo: packMetal(a, 0),
    normal: packRough(cv(size), 0.55)
  };
}

function poster(size, kind) {
  const a = cv(size);
  const g = a.getContext('2d');
  if (kind === 'card') {
    g.fillStyle = '#4a1018';
    g.fillRect(0, 0, size, size);
    g.strokeStyle = '#c9a45c';
    g.lineWidth = 4;
    g.strokeRect(7, 7, size - 14, size - 14);
    g.lineWidth = 1.5;
    g.strokeRect(13, 13, size - 26, size - 26);
    const drawSuit = (x, y, s, color) => {
      g.fillStyle = color;
      g.beginPath();
      if (s === 'S') {
        g.moveTo(x, y - 22); g.bezierCurveTo(x + 20, y - 6, x + 14, y + 10, x, y + 2);
        g.bezierCurveTo(x - 14, y + 10, x - 20, y - 6, x, y - 22);
        g.moveTo(x, y + 2); g.lineTo(x - 8, y + 16); g.lineTo(x + 8, y + 16);
      } else {
        g.moveTo(x, y + 18); g.bezierCurveTo(x - 26, y - 4, x - 14, y - 22, x, y - 8);
        g.bezierCurveTo(x + 14, y - 22, x + 26, y - 4, x, y + 18);
      }
      g.fill();
    };
    drawSuit(44, 50, 'S', '#1a1016');
    drawSuit(84, 50, 'H', '#c03038');
    g.fillStyle = '#e8d8b0';
    g.font = '900 15px Arial';
    g.textAlign = 'center';
    g.fillText('CARD NIGHT', size / 2, 96);
    g.font = '8px Arial';
    g.fillStyle = '#c9a45c';
    g.fillText('EVERY NIGHT · 21:00', size / 2, 110);
  } else {
    g.fillStyle = '#12202a';
    g.fillRect(0, 0, size, size);
    g.strokeStyle = '#c9a45c';
    g.lineWidth = 3;
    g.strokeRect(8, 8, size - 16, size - 16);
    for (let i = 0; i < 5; i++) {
      g.fillStyle = i % 2 ? '#1a3040' : '#0e1c26';
      g.fillRect(16, 18 + i * 18, size - 32, 14);
    }
    g.fillStyle = '#ffd98a';
    g.font = '900 26px Arial';
    g.textAlign = 'center';
    g.shadowColor = '#ff2f7a';
    g.shadowBlur = 8;
    g.fillText('BREW', size / 2, 56);
    g.shadowBlur = 0;
    g.font = '800 9px Arial';
    g.fillStyle = '#e8d8b0';
    g.fillText('HOUSE OF ODDS', size / 2, 86);
    g.fillStyle = '#c9a45c';
    g.fillText('EST. 2026', size / 2, 104);
  }
  grain(g, size, 0.05, 63);
  return {
    albedo: packMetal(a, 0),
    normal: packRough(cv(size), 0.85),
    emissive: [0.38, 0.36, 0.3]
  };
}

function nightSky(size) {
  const a = cv(size);
  const g = a.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, size);
  grad.addColorStop(0, '#060a14');
  grad.addColorStop(0.55, '#101c30');
  grad.addColorStop(1, '#1e3048');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < 7; i++) {
    const bw = 18 + hash2(i, 3, 5) * 26;
    const bh = 40 + hash2(i, 9, 7) * 90;
    const bx = hash2(i, 1, 3) * (size - bw);
    g.fillStyle = 'rgba(4,6,12,.9)';
    g.fillRect(bx, size - bh, bw, bh);
    for (let wy = size - bh + 6; wy < size - 6; wy += 9) {
      for (let wx = bx + 4; wx < bx + bw - 4; wx += 8) {
        if (hash2(wx | 0, wy | 0, 11) > 0.55) {
          g.fillStyle = hash2(wx | 0, wy | 0, 13) > 0.7 ? '#ffd98a' : '#8aa8c8';
          g.fillRect(wx, wy, 3, 4);
        }
      }
    }
  }
  for (let i = 0; i < 40; i++) {
    const x = hash2(i, 7, 21) * size, y = hash2(i, 11, 23) * size * 0.5;
    g.fillStyle = `rgba(255,255,255,${0.3 + hash2(i, 1, 29) * 0.5})`;
    g.fillRect(x, y, 1.2, 1.2);
  }
  return {
    albedo: a,
    normal: packRough(cv(size), 0.5),
    unlit: true,
    emissive: [0.85, 0.9, 1.05]
  };
}

function wood(size, seed, dark) {
  return planks(size, seed, dark
    ? [rgb('#2a1a10'), rgb('#4a2e18'), rgb('#160d07'), rgb('#0d0805')]
    : [rgb('#5a3a1e'), rgb('#8a5a2e'), rgb('#3a2410'), rgb('#1e1408')], dark ? 0.42 : 0.5);
}

const BUILD = {
  carpet: () => carpet(256),
  tile: () => tile(256),
  woodFloor: () => planks(256, 3, [rgb('#4a2e16'), rgb('#7a4e24'), rgb('#2e1c0c'), rgb('#180f06')], 0.5),
  woodDark: () => wood(256, 13, true),
  woodWarm: () => wood(256, 27, false),
  beam: () => planks(256, 41, [rgb('#3a2412'), rgb('#5c3a1c'), rgb('#241408'), rgb('#120a04')], 0.72),
  brick: () => brick(256),
  plaster: () => plaster(256),
  brass: () => brass(128),
  leather: () => leather(128),
  felt: () => felt(128),
  rug: () => rug(256),
  steel: () => steel(128),
  glass: () => glass(128),
  neon: () => neon(64),
  dance: () => dance(128),
  bulb: () => bulb(32),
  chipR: () => chip(64, '#a02830'),
  chipB: () => chip(64, '#2848a0'),
  posterA: () => poster(128, 'card'),
  posterB: () => poster(128, 'ad'),
  nightSky: () => nightSky(256),
  spot: () => spotCone(64, '#ffe8b4', 0.52, [0.58, 0.48, 0.32]),
  spotTeal: () => spotCone(64, '#66ffe0', 0.28, [0.26, 0.48, 0.44])
};

export function material(name) {
  if (CACHE.has(name)) return CACHE.get(name);
  const build = BUILD[name];
  if (!build) throw new Error('unknown material ' + name);
  const m = build();
  m.name = name;
  if (!m.blend && !m.unlit) packMetal(m.albedo, m.metal || 0);
  if (m.unlit) packMetal(m.albedo, 0);
  CACHE.set(name, m);
  return m;
}

export function materialNames() {
  return Object.keys(BUILD);
}

export function loadImageBitmap(url) {
  return fetch(url).then(r => {
    if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
    return r.blob();
  }).then(b => {
    if (typeof createImageBitmap === 'function') return createImageBitmap(b);
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => rej(new Error('decode ' + url));
      img.src = URL.createObjectURL(b);
    });
  });
}

export function slotFace(symbols, size) {
  const w = size || 256, h = Math.round((size || 256) * 0.625);
  const c = cv(w, h);
  const g = c.getContext('2d');
  g.fillStyle = '#0b0d10';
  g.fillRect(0, 0, w, h);
  const bez = g.createLinearGradient(0, 0, 0, h);
  bez.addColorStop(0, '#3a4048');
  bez.addColorStop(0.5, '#1a1e24');
  bez.addColorStop(1, '#2a3038');
  g.fillStyle = bez;
  g.fillRect(0, 0, w, h * 0.1);
  g.fillRect(0, h * 0.9, w, h * 0.1);
  const rw = w * 0.27, rh = h * 0.56;
  const y0 = (h - rh) / 2;
  for (let i = 0; i < 3; i++) {
    const x0 = w * 0.055 + i * (rw + w * 0.045);
    g.fillStyle = '#f2ead8';
    g.fillRect(x0, y0, rw, rh);
    g.save();
    g.beginPath();
    g.rect(x0, y0, rw, rh);
    g.clip();
    const sym = symbols[i % symbols.length];
    if (sym) {
      const s = Math.min(rw, rh) * 0.94;
      g.drawImage(sym, x0 + (rw - s) / 2, y0 + (rh - s) / 2, s, s);
    }
    const shadeG = g.createLinearGradient(0, y0, 0, y0 + rh);
    shadeG.addColorStop(0, 'rgba(0,0,0,.45)');
    shadeG.addColorStop(0.28, 'rgba(0,0,0,0)');
    shadeG.addColorStop(0.72, 'rgba(0,0,0,0)');
    shadeG.addColorStop(1, 'rgba(0,0,0,.5)');
    g.fillStyle = shadeG;
    g.fillRect(x0, y0, rw, rh);
    g.restore();
    g.strokeStyle = '#0a0c0f';
    g.lineWidth = 3;
    g.strokeRect(x0, y0, rw, rh);
  }
  const glow = g.createLinearGradient(0, h * 0.9, 0, h);
  glow.addColorStop(0, '#e9c877');
  glow.addColorStop(1, '#8a6a2e');
  g.fillStyle = glow;
  g.fillRect(0, h * 0.9, w, h * 0.1);
  return c;
}
