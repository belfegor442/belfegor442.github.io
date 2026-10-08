import { mul } from './renderGeo.js';

const COMP = {
  5120: { arr: Int8Array, size: 1 },
  5121: { arr: Uint8Array, size: 1 },
  5122: { arr: Int16Array, size: 2 },
  5123: { arr: Uint16Array, size: 2 },
  5125: { arr: Uint32Array, size: 4 },
  5126: { arr: Float32Array, size: 4 }
};
const NCOMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

function parseGLB(buf) {
  const dv = new DataView(buf);
  if (buf.byteLength < 20 || dv.getUint32(0, true) !== 0x46546c67) throw new Error('not a GLB file');
  const total = dv.getUint32(8, true);
  let json = null, bin = null, off = 12;
  while (off + 8 <= Math.min(total, buf.byteLength)) {
    const len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, off + 8, len)));
    else if (type === 0x004e4942) bin = new Uint8Array(buf, off + 8, Math.min(len, buf.byteLength - off - 8));
    off += 8 + len;
    if (len === 0) break;
  }
  if (!json || !bin) throw new Error('GLB missing JSON or BIN chunk');
  return { json, bin };
}

function accArray(json, bin, ai) {
  const a = json.accessors[ai];
  if (a.bufferView == null) return null;
  const bv = json.bufferViews[a.bufferView];
  const ci = COMP[a.componentType];
  const n = NCOMP[a.type];
  if (!ci || !n) throw new Error('unsupported accessor ' + ai);
  const base = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const stride = bv.byteStride || ci.size * n;
  const total = a.count * n;
  const aligned = (bin.byteOffset + base) % ci.size === 0;
  if (stride === ci.size * n) {
    if (aligned) return new ci.arr(bin.buffer, bin.byteOffset + base, total);
    const out = new ci.arr(total);
    out.set(new ci.arr(bin.buffer.slice(bin.byteOffset + base, bin.byteOffset + base + total * ci.size)));
    return out;
  }
  const out = new ci.arr(total);
  const step = stride / ci.size;
  for (let i = 0; i < a.count; i++) {
    const src = new ci.arr(bin.buffer, bin.byteOffset + base + i * stride, n);
    for (let j = 0; j < n; j++) out[i * n + j] = src[j];
  }
  return out;
}

function nodeMatrix(n) {
  if (n.matrix) return new Float32Array(n.matrix);
  const t = n.translation || [0, 0, 0];
  const r = n.rotation || [0, 0, 0, 1];
  const s = n.scale || [1, 1, 1];
  const x = r[0], y = r[1], z = r[2], w = r[3];
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  const m = new Float32Array(16);
  m[0] = (1 - (yy + zz)) * s[0]; m[1] = (xy + wz) * s[0]; m[2] = (xz - wy) * s[0];
  m[4] = (xy - wz) * s[1]; m[5] = (1 - (xx + zz)) * s[1]; m[6] = (yz + wx) * s[1];
  m[8] = (xz + wy) * s[2]; m[9] = (yz - wx) * s[2]; m[10] = (1 - (xx + yy)) * s[2];
  m[12] = t[0]; m[13] = t[1]; m[14] = t[2]; m[15] = 1;
  return m;
}

function transformBounds(min, max, m) {
  const outMin = [Infinity, Infinity, Infinity];
  const outMax = [-Infinity, -Infinity, -Infinity];
  for (let c = 0; c < 8; c++) {
    const p = [
      c & 1 ? max[0] : min[0],
      c & 2 ? max[1] : min[1],
      c & 4 ? max[2] : min[2]
    ];
    const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
    const y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
    const z = m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14];
    if (x < outMin[0]) outMin[0] = x;
    if (y < outMin[1]) outMin[1] = y;
    if (z < outMin[2]) outMin[2] = z;
    if (x > outMax[0]) outMax[0] = x;
    if (y > outMax[1]) outMax[1] = y;
    if (z > outMax[2]) outMax[2] = z;
  }
  return { min: outMin, max: outMax };
}

async function decodeImages(json, bin) {
  const images = [];
  for (const im of json.images || []) {
    if (im.bufferView == null || !bin) { images.push(null); continue; }
    const bv = json.bufferViews[im.bufferView];
    const bytes = bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength);
    try {
      images.push(await createImageBitmap(new Blob([bytes], { type: im.mimeType || 'image/png' })));
    } catch (e) {
      console.warn('[glb] image decode failed', e && e.message);
      images.push(null);
    }
  }
  return images;
}

export async function loadGLB(url, opts = {}) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + url);
  const buf = await res.arrayBuffer();
  const { json, bin } = parseGLB(buf);

  const materials = (json.materials || []).map(m => {
    const p = m.pbrMetallicRoughness || {};
    const texIdx = p.baseColorTexture ? p.baseColorTexture.index : -1;
    const texRec = texIdx >= 0 && json.textures && json.textures[texIdx] ? json.textures[texIdx] : null;
    const tex = texRec && texRec.source != null ? texRec.source : -1;
    return {
      base: p.baseColorFactor || [1, 1, 1, 1],
      tex,
      smp: texRec && texRec.sampler != null ? texRec.sampler : -1,
      unlit: !!(m.extensions && m.extensions.KHR_materials_unlit),
      blend: (m.alphaMode || 'OPAQUE') === 'BLEND'
    };
  });
  const images = await decodeImages(json, bin);

  const draws = [];
  let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  const nodes = json.nodes || [];
  const scenes = json.scenes || [];
  const scene = scenes[json.scene || 0] || scenes[0] || { nodes: [] };
  const ident = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

  const visit = (idx, parent) => {
    const n = nodes[idx];
    if (!n) return;
    const wm = mul(new Float32Array(16), parent, nodeMatrix(n));
    if (n.mesh != null && json.meshes && json.meshes[n.mesh]) {
      for (const p of json.meshes[n.mesh].primitives || []) {
        const mode = p.mode != null ? p.mode : 4;
        if (mode !== 4) continue;
        const posA = p.attributes.POSITION;
        if (posA == null) continue;
        const pos = accArray(json, bin, posA);
        if (!pos) continue;
        const pa = json.accessors[posA];
        if (pa.min && pa.max) {
          const tb = transformBounds(pa.min, pa.max, wm);
          for (let i = 0; i < 3; i++) {
            if (tb.min[i] < min[i]) min[i] = tb.min[i];
            if (tb.max[i] > max[i]) max[i] = tb.max[i];
          }
        }
        const idxArr = p.indices != null ? accArray(json, bin, p.indices) : null;
        draws.push({
          mode,
          pos,
          nrm: p.attributes.NORMAL != null ? accArray(json, bin, p.attributes.NORMAL) : null,
          uv: p.attributes.TEXCOORD_0 != null ? accArray(json, bin, p.attributes.TEXCOORD_0) : null,
          idx: idxArr,
          mat: p.material != null && materials[p.material] ? p.material : -1,
          matrix: wm
        });
      }
    }
    for (const c of n.children || []) visit(c, wm);
  };
  for (const r of scene.nodes || []) visit(r, ident);

  if (!draws.length) throw new Error('GLB has no triangle draws: ' + url);
  return {
    url,
    draws,
    materials,
    images,
    samplers: json.samplers || [],
    bounds: { min, max }
  };
}
