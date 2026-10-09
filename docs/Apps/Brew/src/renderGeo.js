import { MAP, OBJECTS } from './world.js';

export function C(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/* ---------------------------------------------------------- mat4 (column-major) */

export function mul(out, a, b) {
  for (let c = 0; c < 4; c++) {
    const b0 = b[c * 4], b1 = b[c * 4 + 1], b2 = b[c * 4 + 2], b3 = b[c * 4 + 3];
    out[c * 4] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
    out[c * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
    out[c * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
    out[c * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
  }
  return out;
}

export function perspective(out, fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  out.fill(0);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) * nf;
  out[11] = -1;
  out[14] = 2 * far * near * nf;
  return out;
}

export function lookAt(out, ex, ey, ez, cx, cy, cz) {
  let zx = ex - cx, zy = ey - cy, zz = ez - cz;
  let l = Math.hypot(zx, zy, zz) || 1;
  zx /= l; zy /= l; zz /= l;
  let xx = zz, xy = 0, xz = -zx;
  l = Math.hypot(xx, xy, xz) || 1;
  xx /= l; xy /= l; xz /= l;
  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;
  out[0] = xx; out[1] = yx; out[2] = zx; out[3] = 0;
  out[4] = xy; out[5] = yy; out[6] = zy; out[7] = 0;
  out[8] = xz; out[9] = yz; out[10] = zz; out[11] = 0;
  out[12] = -(xx * ex + xy * ey + xz * ez);
  out[13] = -(yx * ex + yy * ey + yz * ez);
  out[14] = -(zx * ex + zy * ey + zz * ez);
  out[15] = 1;
  return out;
}

export function trs(out, x, y, z, ry, sx, sy, sz) {
  const c = Math.cos(ry), s = Math.sin(ry);
  out.fill(0);
  out[0] = c * sx; out[1] = 0; out[2] = -s * sx;
  out[4] = 0; out[5] = sy; out[6] = 0;
  out[8] = s * sz; out[9] = 0; out[10] = c * sz;
  out[12] = x; out[13] = y; out[14] = z; out[15] = 1;
  return out;
}

/* -------------------------------------------------------------------- shaders */

export const VS_MAIN = `
attribute vec3 aPos;
attribute vec3 aNrm;
attribute vec3 aCol;
uniform mat4 uVP;
uniform mat4 uM;
uniform vec3 uCam;
varying vec3 vN;
varying vec3 vC;
varying float vD;
void main() {
  vec4 w = uM * vec4(aPos, 1.0);
  vN = mat3(uM[0].xyz, uM[1].xyz, uM[2].xyz) * aNrm;
  vC = aCol;
  vD = length(w.xyz - uCam);
  gl_Position = uVP * w;
}`;

export const FS_MAIN = `
precision mediump float;
varying vec3 vN;
varying vec3 vC;
varying float vD;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uAmbient;
uniform vec3 uFogColor;
uniform vec2 uFogRange;
uniform vec3 uTint;
void main() {
  vec3 n = normalize(vN);
  float nd = max(dot(n, -uSunDir), 0.0);
  float hemi = n.y * 0.5 + 0.5;
  vec3 sky = mix(vec3(0.72, 0.68, 0.66), vec3(1.0, 0.98, 0.92), hemi);
  vec3 lit = vC * uTint * (uAmbient * sky + uSunColor * nd);
  float fog = smoothstep(uFogRange.x, uFogRange.y, vD);
  gl_FragColor = vec4(mix(lit, uFogColor, fog), 1.0);
}`;

export const VS_TEX = `
attribute vec3 aPos;
attribute vec2 aUV;
uniform mat4 uVP;
uniform mat4 uM;
varying vec2 vUV;
void main() {
  vUV = aUV;
  gl_Position = uVP * uM * vec4(aPos, 1.0);
}`;

export const FS_TEX = `
precision mediump float;
varying vec2 vUV;
uniform sampler2D uTex;
uniform vec4 uTint;
void main() {
  gl_FragColor = texture2D(uTex, vUV) * uTint;
}`;

export const VS_GLB = `
attribute vec3 aPos;
attribute vec3 aNrm;
attribute vec2 aUV;
uniform mat4 uVP;
uniform mat4 uM;
uniform mat3 uN;
uniform vec3 uCam;
varying vec3 vN;
varying vec2 vUV;
varying float vD;
void main() {
  vec4 w = uM * vec4(aPos, 1.0);
  vN = uN * aNrm;
  vUV = aUV;
  vD = length(w.xyz - uCam);
  gl_Position = uVP * w;
}`;

export const FS_GLB = `
precision mediump float;
varying vec3 vN;
varying vec2 vUV;
varying float vD;
uniform sampler2D uTex;
uniform vec4 uTint;
uniform float uUnlit;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uAmbient;
uniform vec3 uFogColor;
uniform vec2 uFogRange;
void main() {
  vec4 c = texture2D(uTex, vUV) * uTint;
  vec3 n = normalize(vN + vec3(0.0, 1e-4, 0.0));
  float nd = max(dot(n, -uSunDir), 0.0);
  float hemi = n.y * 0.5 + 0.5;
  vec3 sky = mix(vec3(0.72, 0.68, 0.66), vec3(1.0, 0.98, 0.92), hemi);
  if (uUnlit < 0.5) {
    c.rgb *= (uAmbient * sky + uSunColor * nd);
  } else {
    float up = clamp(n.y, 0.0, 1.0);
    float shape = 0.30 + 0.30 * hemi + 0.50 * nd;
    // Split-grade by surface: up-facing floors push to oxblood casino
    // carpet, the vertical shell falls cool and dark so the pools pop.
    vec3 floorGrade = vec3(1.20, 0.78, 0.72);
    vec3 wallGrade  = vec3(0.82, 0.80, 0.86);
    c.rgb *= mix(wallGrade, floorGrade, smoothstep(0.55, 0.95, up));
    c.rgb *= shape * mix(vec3(1.0), vec3(1.10, 1.0, 0.84), nd * 0.85);
    c.rgb = pow(clamp(c.rgb, 0.0, 1.0), vec3(1.28));
    float lum = dot(c.rgb, vec3(0.299, 0.587, 0.114));
    c.rgb = clamp(mix(vec3(lum), c.rgb, 1.15), 0.0, 1.0);
  }
  float fog = smoothstep(uFogRange.x, uFogRange.y, vD);
  gl_FragColor = vec4(mix(c.rgb, uFogColor, fog), c.a);
}`;

/* ------------------------------------------------------------- mesh builders */

export function newMesh() {
  return { pos: [], nrm: [], col: [], idx: [] };
}

export function newTMesh() {
  return { pos: [], uv: [], idx: [] };
}

export function pushBox(M, x, y, z, w, h, d, col, c = 1, s = 0) {
  const hw = w / 2, hd = d / 2;
  const faces = [
    { v: [[hw, 0, hd], [hw, 0, -hd], [hw, h, -hd], [hw, h, hd]], n: [1, 0, 0] },
    { v: [[-hw, 0, -hd], [-hw, 0, hd], [-hw, h, hd], [-hw, h, -hd]], n: [-1, 0, 0] },
    { v: [[-hw, 0, hd], [hw, 0, hd], [hw, h, hd], [-hw, h, hd]], n: [0, 0, 1] },
    { v: [[hw, 0, -hd], [-hw, 0, -hd], [-hw, h, -hd], [hw, h, -hd]], n: [0, 0, -1] },
    { v: [[-hw, h, hd], [hw, h, hd], [hw, h, -hd], [-hw, h, -hd]], n: [0, 1, 0] },
    { v: [[-hw, 0, -hd], [hw, 0, -hd], [hw, 0, hd], [-hw, 0, hd]], n: [0, -1, 0] }
  ];
  for (const f of faces) {
    const n = [f.n[0] * c + f.n[2] * s, f.n[1], -f.n[0] * s + f.n[2] * c];
    const base = M.pos.length / 3;
    for (const p of f.v) {
      M.pos.push(x + p[0] * c + p[2] * s, y + p[1], z - p[0] * s + p[2] * c);
      M.nrm.push(n[0], n[1], n[2]);
      M.col.push(col[0], col[1], col[2]);
    }
    M.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}

export function pushCyl(M, x, y, z, r, h, col, seg = 12) {
  let base = M.pos.length / 3;
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
    M.pos.push(x + ca * r, y, z + sa * r); M.nrm.push(ca, 0, sa); M.col.push(col[0], col[1], col[2]);
    M.pos.push(x + ca * r, y + h, z + sa * r); M.nrm.push(ca, 0, sa); M.col.push(col[0], col[1], col[2]);
  }
  for (let i = 0; i < seg; i++) {
    const b = base + i * 2;
    M.idx.push(b, b + 2, b + 3, b, b + 3, b + 1);
  }
  base = M.pos.length / 3;
  M.pos.push(x, y + h, z); M.nrm.push(0, 1, 0); M.col.push(col[0], col[1], col[2]);
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
    M.pos.push(x + ca * r, y + h, z + sa * r); M.nrm.push(0, 1, 0); M.col.push(col[0], col[1], col[2]);
  }
  for (let i = 0; i < seg; i++) M.idx.push(base, base + 1 + i, base + 2 + i);
}

export function pushEllip(M, x, y, z, rx, ry, rz, col, lat = 4, lon = 8, c = 1, s = 0) {
  const start = M.pos.length / 3;
  for (let i = 0; i <= lat; i++) {
    const ph = (i / lat) * Math.PI;
    const sp = Math.sin(ph), cp = Math.cos(ph);
    for (let j = 0; j <= lon; j++) {
      const th = (j / lon) * Math.PI * 2;
      const lx = rx * sp * Math.cos(th), ly = ry * cp, lz = rz * sp * Math.sin(th);
      let nx = lx / (rx * rx), ny = ly / (ry * ry), nz = lz / (rz * rz);
      const nl = Math.hypot(nx, ny, nz) || 1;
      nx /= nl; ny /= nl; nz /= nl;
      M.pos.push(x + lx * c + lz * s, y + ly, z - lx * s + lz * c);
      M.nrm.push(nx * c + nz * s, ny, -nx * s + nz * c);
      M.col.push(col[0], col[1], col[2]);
    }
  }
  for (let i = 0; i < lat; i++) {
    for (let j = 0; j < lon; j++) {
      const a = start + i * (lon + 1) + j;
      const b = a + lon + 1;
      M.idx.push(a, b, b + 1, a, b + 1, a + 1);
    }
  }
}

export function pushDisc(M, x, y, z, rx, rz, col, seg = 20) {
  const base = M.pos.length / 3;
  M.pos.push(x, y, z); M.nrm.push(0, 1, 0); M.col.push(col[0], col[1], col[2]);
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    M.pos.push(x + Math.cos(a) * rx, y, z + Math.sin(a) * rz);
    M.nrm.push(0, 1, 0);
    M.col.push(col[0], col[1], col[2]);
  }
  for (let i = 0; i < seg; i++) M.idx.push(base, base + 1 + i, base + 2 + i);
}

export function pushRing(M, x, y, z, r0, r1, col, seg = 24) {
  const base = M.pos.length / 3;
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
    M.pos.push(x + ca * r0, y, z + sa * r0); M.nrm.push(0, 1, 0); M.col.push(col[0], col[1], col[2]);
    M.pos.push(x + ca * r1, y, z + sa * r1); M.nrm.push(0, 1, 0); M.col.push(col[0], col[1], col[2]);
  }
  for (let i = 0; i < seg; i++) {
    const b = base + i * 2;
    M.idx.push(b, b + 1, b + 3, b, b + 3, b + 2);
  }
}

export function pushQuadLit(M, p, col) {
  const base = M.pos.length / 3;
  for (const q of p) {
    M.pos.push(q[0], q[1], q[2]);
    M.nrm.push(0, 1, 0);
    M.col.push(col[0], col[1], col[2]);
  }
  M.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

export function pushT(M, p, uv) {
  const base = M.pos.length / 3;
  for (let i = 0; i < 4; i++) {
    M.pos.push(p[i][0], p[i][1], p[i][2]);
    M.uv.push(uv[i][0], uv[i][1]);
  }
  M.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

/* ------------------------------------------------------------------- textures */

export function buildFloor(decal = true) {
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
  // The rug/table decals describe THIS room's floor plan. The apron ground
  // reuses the wood texture outside the walls, where those decals would
  // ghost onto the void as floating furniture shadows.
  if (!decal) return c;
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

export function dotTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.45, 'rgba(255,255,255,.6)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return c;
}

export function signTexture(label) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 64;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 512, 64);
  g.font = '900 46px Arial';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = 'rgba(255,255,255,.95)';
  g.shadowBlur = 16;
  g.fillStyle = '#ffffff';
  g.fillText(label, 256, 34);
  g.fillText(label, 256, 34);
  g.shadowBlur = 0;
  g.fillText(label, 256, 34);
  return c;
}
