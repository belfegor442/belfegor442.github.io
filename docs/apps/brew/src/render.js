import { MAP, OBJECTS, SEATS, OBJ_BY_ID, setNav } from './world.js';
import {
  C, mul, perspective, lookAt, trs,
  VS_MAIN, FS_MAIN, VS_TEX, FS_TEX, VS_GLB, FS_GLB,
  newMesh, newTMesh, pushBox, pushCyl, pushEllip, pushDisc,
  pushRing, pushQuadLit, pushT, buildFloor, dotTexture, signTexture
} from './renderGeo.js';
import { loadGLB, buildNav, stripCeiling, genNormals } from './glb.js';

const PALETTE = [
  { body: '#c2373f', trim: '#f0d0a0', hair: '#241a14' },
  { body: '#2f6fb0', trim: '#dff0ff', hair: '#3a2a18' },
  { body: '#2f8f5b', trim: '#e8ffe8', hair: '#12100e' },
  { body: '#8b5bd6', trim: '#f3e9ff', hair: '#2a1830' },
  { body: '#d98a1f', trim: '#fff2d0', hair: '#4a2c12' },
  { body: '#3ec6c6', trim: '#eaffff', hair: '#101a1a' },
  { body: '#e05a8a', trim: '#ffe4ef', hair: '#5a1030' },
  { body: '#7ad1c3', trim: '#f0fffc', hair: '#0f3a34' },
  { body: '#b8b8c8', trim: '#ffffff', hair: '#3a3a48' },
  { body: '#f0e6d2', trim: '#fffaf0', hair: '#8a6a3a' }
];

const BOTTLES = ['#c2373f', '#d98a1f', '#2f8f5b', '#8b5bd6'];

// The lobby ships baked, unlit textures that render darker than the play
// field expects: lift them without touching lit geometry or the player skin.
const GLB_EXPOSURE = 1.5;

// Inverse-transpose of the upper-left 3x3 of a column-major mat4, into a
// 9-float column-major mat3. Correct normals under the lobby's non-uniform
// (anisotropic) world scale, which a plain mat3(uM) would skew.
function nrmMat3(m, out) {
  const a = m[0], b = m[4], c = m[8];
  const d = m[1], e = m[5], f = m[9];
  const g = m[2], h = m[6], i = m[10];
  const A = e * i - f * h, B = f * g - d * i, Cc = d * h - e * g;
  const det = a * A + b * B + c * Cc;
  const id = det ? 1 / det : 0;
  out[0] = A * id; out[1] = (c * h - b * i) * id; out[2] = (b * f - c * e) * id;
  out[3] = B * id; out[4] = (a * i - c * g) * id; out[5] = (c * d - a * f) * id;
  out[6] = Cc * id; out[7] = (b * g - a * h) * id; out[8] = (a * e - b * d) * id;
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const opts = { antialias: true, alpha: false, depth: true, powerPreference: 'high-performance' };
    this.gl = canvas.getContext('webgl2', opts) || canvas.getContext('webgl', opts) ||
      canvas.getContext('experimental-webgl', opts);
    this.anisoExt = this.gl && (this.gl.getExtension('EXT_texture_filter_anisotropic') ||
      this.gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic') ||
      this.gl.getExtension('MOZ_EXT_texture_filter_anisotropic'));
    this.fctx = null;
    if (!this.gl) {
      console.error('WebGL unavailable');
      this.fctx = canvas.getContext('2d');
    }
    this.lights = true;
    this.time = 0;
    this.vw = 0; this.vh = 0; this.dpr = 1;
    this.cam = { x: MAP.w / 2, z: MAP.h / 2 };
    this.camOrbit = null;
    this.eye = { x: MAP.w / 2, y: 730, z: MAP.h / 2 + 650 };
    this.orbit = { yaw: 0, pitch: Math.atan2(730, 650), dist: Math.hypot(730, 650) };
    this.freeCam = false;
    this.fp = false;
    this.fpPitch = 0;
    this._drag = null;
    this._pts = new Map();
    this._pinch = 0;
    this.fogNow = [1150, 3300];
    this.glErrs = {};
    try { this.glDbg = /[?&]gldebug/.test(location.search); } catch (e) { this.glDbg = false; }
    this.stats = { frames: 0, draws: 0, gl: !!this.gl };
    this.mProj = new Float32Array(16);
    this.mView = new Float32Array(16);
    this.mVP = new Float32Array(16);
    this.mIdent = new Float32Array(16);
    this.mIdent[0] = this.mIdent[5] = this.mIdent[10] = this.mIdent[15] = 1;
    this.mScratch = new Float32Array(16);
    this.enabledAttrs = new Set();
    this.buildOverlay();
    this.bindCamera();
    if (this.gl) this.initGL();
    this.loadPixelFont();
    this.resize();
    // Narrow (portrait) screens start pulled back so the full map width fits.
    try {
      const a = this.canvas.width / Math.max(1, this.canvas.height);
      if (a < 1.3) this.orbit.dist = Math.min(1600, 977 * 1.3 / Math.max(0.6, a));
    } catch (e) { /* noop */ }
    try { window.__renderer = this; } catch (e) { /* noop */ }
  }

  bindCamera() {
    const c = this.canvas;
    if (!c) return;
    c.addEventListener('contextmenu', e => e.preventDefault());
    c.addEventListener('pointerdown', e => {
      if (e.button !== 0 && e.button !== 2) return;
      this._pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this._drag = { x: e.clientX, y: e.clientY };
      try { c.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
    });
    c.addEventListener('pointermove', e => {
      if (!this._pts.has(e.pointerId)) return;
      this._pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this._pts.size >= 2) {
        const v = [...this._pts.values()];
        const d = Math.hypot(v[0].x - v[1].x, v[0].y - v[1].y);
        if (this._pinch > 0) {
          const k = d / this._pinch;
          if (k > 0 && isFinite(k)) {
            this.orbit.dist = Math.max(350, Math.min(4800, this.orbit.dist / k));
          }
        }
        this._pinch = d;
        this._drag = null;
        return;
      }
      const d = this._drag;
      if (!d) return;
      this.orbit.yaw -= (e.clientX - d.x) * 0.006;
      if (this.fp) {
        this.fpPitch = Math.max(-1.1, Math.min(0.75, this.fpPitch - (e.clientY - d.y) * 0.005));
      } else {
        this.orbit.pitch = Math.max(0.2, Math.min(1.35, this.orbit.pitch + (e.clientY - d.y) * 0.006));
      }
      d.x = e.clientX; d.y = e.clientY;
    });
    const stop = e => {
      this._pts.delete(e.pointerId);
      if (this._pts.size < 2) this._pinch = 0;
      if (!this._pts.size) this._drag = null;
      try { c.releasePointerCapture(e.pointerId); } catch (err) { /* noop */ }
    };
    c.addEventListener('pointerup', stop);
    c.addEventListener('pointercancel', stop);
    c.addEventListener('wheel', e => {
      e.preventDefault();
      this.orbit.dist = Math.max(350, Math.min(4800, this.orbit.dist * Math.exp(e.deltaY * 0.0012)));
    }, { passive: false });
  }

  toggleFreeCam() {
    if (this.fp) this.fp = false;
    this.freeCam = !this.freeCam;
    if (!this.freeCam) { this.cam.x = MAP.w / 2; this.cam.z = MAP.h / 2; }
    return this.freeCam;
  }

  toggleFP() {
    this.fp = !this.fp;
    if (this.fp) {
      this.freeCam = false;
      this._prevPitch = this.orbit.pitch;
      this.fpPitch = Math.max(-1.1, Math.min(0.75, 1.0 - this.orbit.pitch));
    } else {
      this.orbit.pitch = Math.max(0.55, Math.min(1.35, this._prevPitch || 0.85));
    }
    return this.fp;
  }

  panCam(ax, az, dt) {
    const o = this.orbit;
    const fx = -Math.sin(o.yaw), fz = -Math.cos(o.yaw);
    const rx = -fz, rz = fx;
    const sp = 620 * (o.dist / 977) * Math.min(0.1, dt || 0.016);
    this.cam.x = Math.max(0, Math.min(MAP.w, this.cam.x + (rx * ax + fx * -az) * sp));
    this.cam.z = Math.max(0, Math.min(MAP.h, this.cam.z + (rz * ax + fz * -az) * sp));
  }

  loadPixelFont() {
    try {
      const ff = new FontFace('BrewPixel', "url('./Assets/vhs-gothic.ttf')");
      ff.load().then(f => document.fonts.add(f)).catch(() => {});
    } catch (e) { /* noop */ }
  }

  buildOverlay() {
    const ov = document.createElement('canvas');
    ov.id = 'worldOverlay';
    ov.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:1';
    this.canvas.insertAdjacentElement('afterend', ov);
    this.overlay = ov;
    this.octx = ov.getContext('2d');
  }

  initGL() {
    const gl = this.gl;
    this.pLit = this.makeProgram(VS_MAIN, FS_MAIN, ['aPos', 'aNrm', 'aCol'],
      ['uVP', 'uM', 'uCam', 'uSunDir', 'uSunColor', 'uAmbient', 'uFogColor', 'uFogRange', 'uTint']);
    this.pTex = this.makeProgram(VS_TEX, FS_TEX, ['aPos', 'aUV'], ['uVP', 'uM', 'uTex', 'uTint']);
    gl.useProgram(this.pTex.prog);
    gl.uniform1i(this.pTex.u.uTex, 0);
    this.pGLB = this.makeProgram(VS_GLB, FS_GLB, ['aPos', 'aNrm', 'aUV'],
      ['uVP', 'uM', 'uN', 'uCam', 'uTex', 'uTint', 'uUnlit', 'uSunDir', 'uSunColor', 'uAmbient', 'uFogColor', 'uFogRange']);
    gl.useProgram(this.pGLB.prog);
    gl.uniform1i(this.pGLB.u.uTex, 0);
    this.isGL2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
    this.uintIdx = this.isGL2 || !!gl.getExtension('OES_element_index_uint');
    this.glbWorld = null;
    this.glbPlayer = null;
    // lobby.glb is the authoritative Brew world. The procedural scene is fallback-only.
    this.useImportedWorld = true;
    this.glbReady = false;
    this.glbWorldAlpha = null;
    this.mScratch2 = new Float32Array(16);
    this.mN3 = new Float32Array(9);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.CULL_FACE);

    this.texFloor = this.uploadTexture(buildFloor());
    this.texApron = this.uploadTexture(buildFloor(false));
    this.texDot = this.uploadTexture(dotTexture());
    this.texSign = this.uploadTexture(signTexture('BREW'));
    const wc = document.createElement('canvas');
    wc.width = wc.height = 1;
    const wg = wc.getContext('2d');
    wg.fillStyle = '#ffffff';
    wg.fillRect(0, 0, 1, 1);
    this.texWhite = this.uploadTexture(wc);

    const back = newMesh(), shell = newMesh(), props = newMesh(), lever = newMesh(), ring = newMesh();
    const floorT = newTMesh(), signT = newTMesh(), apronT = newTMesh();
    this.buildWorld(back, shell, props, lever, floorT, signT);
    pushRing(ring, 0, 0, 0, 11.5, 15, C('#e9c877'), 24);
    // Dark apron around the building so the orbit camera never stares into
    // raw clear color past the walls. Plain wood (no room decals), matching
    // the extent of the lit back quad so the two share one silhouette.
    pushT(apronT, [
      [-2200, 0, -2200], [MAP.w + 2200, 0, -2200],
      [MAP.w + 2200, 0, MAP.h + 2200], [-2200, 0, MAP.h + 2200]
    ], [[0, 0], [4, 0], [4, 4], [0, 4]]);

    this.gpuBack = this.uploadMesh(back, gl.STATIC_DRAW);
    this.gpuShell = this.uploadMesh(shell, gl.STATIC_DRAW);
    this.gpuWorld = this.uploadMesh(props, gl.STATIC_DRAW);
    this.gpuLever = this.uploadMesh(lever, gl.STATIC_DRAW);
    this.gpuRing = this.uploadMesh(ring, gl.STATIC_DRAW);
    this.gpuFloor = this.uploadTexMesh(floorT, gl.STATIC_DRAW);
    this.gpuSign = this.uploadTexMesh(signT, gl.STATIC_DRAW);
    this.gpuApron = this.uploadTexMesh(apronT, gl.STATIC_DRAW);

    this.meshPlayers = newMesh();
    this.meshShadows = newTMesh();
    this.meshGlows = newTMesh();
    this.gpuPlayers = this.uploadMesh(this.meshPlayers, gl.DYNAMIC_DRAW);
    this.gpuShadows = this.uploadTexMesh(this.meshShadows, gl.DYNAMIC_DRAW);
    this.gpuGlows = this.uploadTexMesh(this.meshGlows, gl.DYNAMIC_DRAW);

    const n = Math.hypot(0.45, 1, 0.35);
    this.litDef = {
      amb: [0.44, 0.42, 0.46], sun: [0.92, 0.86, 0.74],
      sunDir: [-0.45 / n, -1 / n, -0.35 / n],
      fog: [0.055, 0.043, 0.035], fogRange: [1150, 3300]
    };
    this.nightDef = {
      amb: [0.15, 0.17, 0.30], sun: [0.20, 0.22, 0.38],
      sunDir: [-0.45 / n, -1 / n, -0.35 / n],
      fog: [0.016, 0.024, 0.055], fogRange: [850, 2900]
    };
    if (this.useImportedWorld) this.loadGLBAssets();
  }

  async loadGLBAssets() {
    try {
      const world = await loadGLB('./Assets/gbl/world/lobby.glb');
      const b = world.bounds;
      // The lobby IS the map: rotate so its long axis follows MAP.w, scale it
      // to fill the play field (heights stay native so furniture keeps its
      // size relative to the 32-unit player) and rest the floor on y = 0.
      const dx = b.max[0] - b.min[0], dz = b.max[2] - b.min[2];
      const sx = MAP.w / dz, sz = MAP.h / dx;
      const place = new Float32Array(16);
      place[0] = 0; place[1] = 0; place[2] = -sz;   // raw +X -> world -Z
      place[4] = 0; place[5] = 1; place[6] = 0;
      place[8] = sx; place[9] = 0; place[10] = 0;   // raw +Z -> world +X
      place[15] = 1;
      let mnx = 1e9, mny = 1e9, mnz = 1e9, mxx = -1e9, mxy = -1e9, mxz = -1e9;
      for (const px of [b.min[0], b.max[0]]) {
        for (const py of [b.min[1], b.max[1]]) {
          for (const pz of [b.min[2], b.max[2]]) {
            const X = sx * pz, Y = py, Z = -sz * px;
            if (X < mnx) mnx = X; if (X > mxx) mxx = X;
            if (Y < mny) mny = Y; if (Y > mxy) mxy = Y;
            if (Z < mnz) mnz = Z; if (Z > mxz) mxz = Z;
          }
        }
      }
      place[12] = MAP.w / 2 - (mnx + mxx) / 2;
      place[13] = -mny;
      place[14] = MAP.h / 2 - (mnz + mxz) / 2;
      for (const d of world.draws) d.matrix = mul(new Float32Array(16), place, d.matrix);
      world.bounds = {
        min: [mnx + place[12], mny + place[13], mnz + place[14]],
        max: [mxx + place[12], mxy + place[13], mxz + place[14]]
      };
      const noRoof = stripCeiling(world.draws);
      this.glbReady = true;
      // Nav is derived from the full geometry (collision stays identical to
      // the reference floor plan) before the render-only cleanup below.
      const nav = buildNav(world.draws, MAP.w, MAP.h);
      setNav(nav);
      this.nav = nav;
      genNormals(world.draws);
      // The export also ships a huge untextured pure-black shell that only
      // peeks through as black patches over the floor. It carries no visible
      // furniture (couches and walls live in the textured draws), so drop it
      // from the render list.
      world.draws = world.draws.filter(d => {
        const m = d.mat >= 0 ? world.materials[d.mat] : null;
        return !(m && m.tex < 0 && m.unlit && (m.base[0] + m.base[1] + m.base[2]) < 0.06);
      });
      this.glbWorld = this.uploadGLB(world);
      console.log('[glb] world ready: ' + this.glbWorld.opaque.length + ' opaque, ' +
        this.glbWorld.blend.length + ' blend, box=' +
        world.bounds.min.map(v => Math.round(v)).join(',') + '..' +
        world.bounds.max.map(v => Math.round(v)).join(',') +
        ', nav ' + nav.open + '/' + nav.total + ' open cells, roof tris ' + noRoof);
    } catch (e) {
      this.glbReady = false;
      console.warn('[glb] world load failed, procedural fallback:', e && e.message);
    }
    try {
      const player = await loadGLB('./Assets/gbl/Player/steve.skin.glb');
      const pb = player.bounds;
      const shift = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0,
        -(pb.min[0] + pb.max[0]) / 2, -pb.min[1], -(pb.min[2] + pb.max[2]) / 2, 1]);
      this.glbPlayer = this.uploadGLB(player);
      for (const g of this.glbPlayer.opaque) g.matrix = mul(new Float32Array(16), shift, g.matrix);
      for (const g of this.glbPlayer.blend) g.matrix = mul(new Float32Array(16), shift, g.matrix);
      console.log('[glb] player ready: height=' + (pb.max[1] - pb.min[1]).toFixed(1) +
        ' draws=' + (this.glbPlayer.opaque.length + this.glbPlayer.blend.length));
    } catch (e) {
      console.warn('[glb] player load failed, procedural fallback:', e && e.message);
    }
  }

  uploadGLB(glb) {
    const gl = this.gl;
    const out = { opaque: [], blend: [] };
    const texCache = new Map();
    for (const d of glb.draws) {
      if (!d.idx || !d.idx.length) continue;
      const m = d.mat >= 0 ? glb.materials[d.mat] : null;
      const gpu = {
        pos: this.gbuf(d.pos), nrm: this.gbuf(d.nrm), uv: this.gbuf(d.uv),
        idx: gl.createBuffer(), count: d.idx.length,
        type: d.idx instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT,
        matrix: d.matrix, mat: m, tex: null
      };
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gpu.idx);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, d.idx, gl.STATIC_DRAW);
      if (gpu.type === gl.UNSIGNED_INT && !this.uintIdx) continue;
      if (m && m.tex >= 0 && glb.images[m.tex]) {
        if (!texCache.has(m.tex)) {
          texCache.set(m.tex, this.uploadGLBTexture(glb.images[m.tex], glb.samplers[m.smp] || {}));
        }
        gpu.tex = texCache.get(m.tex);
      }
      if (m && m.blend) out.blend.push(gpu);
      else out.opaque.push(gpu);
    }
    return out;
  }

  gbuf(arr) {
    const gl = this.gl;
    if (!arr) return null;
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, arr, gl.STATIC_DRAW);
    return b;
  }

  setAniso(t) {
    const gl = this.gl;
    if (!this.anisoExt) return;
    const max = gl.getParameter(this.anisoExt.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
    gl.texParameterf(gl.TEXTURE_2D, this.anisoExt.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(16, max));
  }

  uploadGLBTexture(bitmap, smp) {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
    const pot = v => v > 0 && (v & (v - 1)) === 0;
    const wrap = w => (w === 33071 ? gl.CLAMP_TO_EDGE : w === 33648 ? gl.MIRRORED_REPEAT : gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap(smp.wrapS));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap(smp.wrapT));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, smp.magFilter === 9728 ? gl.NEAREST : gl.LINEAR);
    if (pot(bitmap.width) && pot(bitmap.height)) {
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, smp.minFilter === 9984 || smp.minFilter === 9985 ? gl.NEAREST : gl.LINEAR_MIPMAP_LINEAR);
    } else {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    }
    this.setAniso(t);
    return t;
  }

  makeProgram(vsSrc, fsSrc, attribs, uniforms) {
    const gl = this.gl;
    const compile = (type, src) => {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        console.error('shader compile failed:', gl.getShaderInfoLog(sh));
      }
      return sh;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, vsSrc));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fsSrc));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error('program link failed:', gl.getProgramInfoLog(prog));
    }
    const u = {}, a = {};
    for (const nm of uniforms) u[nm] = gl.getUniformLocation(prog, nm);
    for (const nm of attribs) a[nm] = gl.getAttribLocation(prog, nm);
    return { prog, u, a };
  }

  uploadTexture(source) {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    this.setAniso(t);
    return t;
  }

  uploadMesh(mesh, usage) {
    const gl = this.gl;
    const gpu = { pos: gl.createBuffer(), nrm: gl.createBuffer(), col: gl.createBuffer(), idx: gl.createBuffer(), count: mesh.idx.length };
    this.fillMesh(gpu, mesh, usage);
    return gpu;
  }

  fillMesh(gpu, mesh, usage) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, gpu.pos);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(mesh.pos), usage);
    gl.bindBuffer(gl.ARRAY_BUFFER, gpu.nrm);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(mesh.nrm), usage);
    gl.bindBuffer(gl.ARRAY_BUFFER, gpu.col);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(mesh.col), usage);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gpu.idx);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(mesh.idx), usage);
    gpu.count = mesh.idx.length;
  }

  uploadTexMesh(mesh, usage) {
    const gl = this.gl;
    const gpu = { pos: gl.createBuffer(), uv: gl.createBuffer(), idx: gl.createBuffer(), count: mesh.idx.length };
    this.fillTexMesh(gpu, mesh, usage);
    return gpu;
  }

  fillTexMesh(gpu, mesh, usage) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, gpu.pos);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(mesh.pos), usage);
    gl.bindBuffer(gl.ARRAY_BUFFER, gpu.uv);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(mesh.uv), usage);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gpu.idx);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(mesh.idx), usage);
    gpu.count = mesh.idx.length;
  }

  // back   - dark backdrop plane, drawn under the imported lobby too
  // shell  - procedural rug + perimeter walls, fallback scene only
  // M      - gameplay props (tables, bar, seats, ...), drawn in both scenes
  buildWorld(back, shell, M, lever, floorT, signT) {
    const wallC = C('#453424');
    pushQuadLit(back, [
      [-2200, -1.5, -2200], [MAP.w + 2200, -1.5, -2200],
      [MAP.w + 2200, -1.5, MAP.h + 2200], [-2200, -1.5, MAP.h + 2200]
    ], [0.05, 0.042, 0.034]);

    for (const o of OBJECTS) {
      const cx = o.x + o.w / 2, cz = o.y + o.h / 2;
      switch (o.type) {
        case 'rug':
          // The central social area must exist visually as well as in the world data.
          pushBox(shell, cx, 0.4, cz, o.w, 0.8, o.h, C('#173f32'));
          pushBox(shell, cx, 0.85, cz, o.w - 18, 0.18, o.h - 18, C('#245b47'));
          break;
        case 'wall':
          pushBox(shell, cx, 0, cz, o.w, o.hgt, o.h, wallC);
          break;
        case 'table':
          pushBox(M, cx, 0, cz, o.w, o.hgt, o.h, C('#6b4526'));
          pushDisc(M, cx, o.hgt + 0.6, cz, o.w / 2 - 18, o.h / 2 - 16, C('#0e4a34'));
          break;
        case 'bar':
          pushBox(M, cx, 0, cz, o.w, o.hgt, o.h, C('#3d2a1c'));
          pushBox(M, cx, o.hgt, cz, o.w, 6, o.h, C('#c9a15c'));
          break;
        case 'shelf': {
          pushBox(M, cx, 0, cz, o.w, o.hgt, o.h, C('#241a12'));
          for (let i = 0; i < 12; i++) {
            const bx = o.x + 12 + i * 34 + 8;
            pushBox(M, bx, 8, o.y + o.h - 2, 14, o.hgt - 16, 6, C(BOTTLES[i % 4]));
          }
          break;
        }
        case 'column':
          pushBox(M, cx, 0, cz, o.w, o.hgt, o.h, C('#3a3128'));
          break;
        case 'plant':
          pushBox(M, cx, 0, cz, o.w - 16, 26, o.h - 20, C('#6b4a2a'));
          pushEllip(M, cx, 44, cz, 26, 15, 26, C('#1f6b40'), 4, 9);
          pushEllip(M, cx, 58, cz, 17, 13, 17, C('#2f9a58'), 4, 9);
          break;
        case 'sign':
          pushBox(M, cx, 6, o.y + o.h / 2, o.w, 46, o.h, C('#1a120c'));
          pushT(signT, [
            [o.x, 6, o.y + o.h + 1], [o.x + o.w, 6, o.y + o.h + 1],
            [o.x + o.w, 52, o.y + o.h + 1], [o.x, 52, o.y + o.h + 1]
          ], [[0, 0], [1, 0], [1, 1], [0, 1]]);
          break;
        case 'switch':
          pushBox(M, 47, 36, cz, 22, 44, o.h, C('#d8d2c4'));
          pushBox(lever, 59, 50, cz, 6, 10, o.h - 10, [0.92, 0.92, 0.86]);
          break;
        case 'decor':
          pushBox(M, cx, 0, cz, o.w, o.hgt, o.h, C('#2a2118'));
          break;
      }
    }

    for (const sd of SEATS) {
      const ry = Math.PI / 2 - sd.dir;
      const c = Math.cos(ry), s = Math.sin(ry);
      if (sd.table) {
        pushBox(M, sd.x, 0, sd.y, 24, 14, 24, C('#5b3620'), c, s);
        pushBox(M, sd.x, 14, sd.y, 26, 6, 26, C('#7a4a2a'), c, s);
        pushBox(M, sd.x - s * 12, 20, sd.y - c * 12, 26, 16, 4, C('#5b3620'), c, s);
      } else {
        pushCyl(M, sd.x, 0, sd.y, 4, 15, C('#5a5a5a'), 8);
        pushCyl(M, sd.x, 15, sd.y, 15, 5, C('#8a8a8a'), 12);
      }
    }

    pushT(floorT, [
      [0, 0, 0], [MAP.w, 0, 0], [MAP.w, 0, MAP.h], [0, 0, MAP.h]
    ], [[0, 0], [1, 0], [1, 1], [0, 1]]);
  }

  pushPlayer(M, p) {
    const pal = PALETTE[(p.seed || 0) % PALETTE.length];
    const seated = p.status === 'seated' || p.anim === 'sit';
    const walking = p.anim === 'walk' && !seated;
    const x = p.rx != null ? p.rx : p.x;
    const z = p.ry != null ? p.ry : p.y;
    const ry = Math.PI / 2 - (p.dir || 0);
    const c = Math.cos(ry), s = Math.sin(ry);
    const phase = this.time * 11 + (p.id.charCodeAt(0) || 0);
    const body = C(pal.body), trim = C(pal.trim), hair = C(pal.hair);
    const skin = C('#e8c39a'), dark = C('#1b1b22');
    const at = (ox, oz) => [x + ox * c + oz * s, z - ox * s + oz * c];

    if (walking) {
      const sw = Math.sin(phase) * 4;
      let q = at(4.5, sw);
      pushBox(M, q[0], 0, q[1], 5, 9, 5, dark, c, s);
      q = at(-4.5, -sw);
      pushBox(M, q[0], 0, q[1], 5, 9, 5, dark, c, s);
    } else if (seated) {
      const q = at(0, -5);
      pushBox(M, q[0], 17, q[1], 12, 5, 16, dark, c, s);
    } else {
      let q = at(4.5, 0);
      pushBox(M, q[0], 0, q[1], 5, 9, 5, dark, c, s);
      q = at(-4.5, 0);
      pushBox(M, q[0], 0, q[1], 5, 9, 5, dark, c, s);
    }

    const mid = at(0, seated ? -7 : 0);
    const by = seated ? 21 : 9;
    const bh = seated ? 13 : 17;
    pushBox(M, mid[0], by, mid[1], 16, bh, 10, body, c, s);
    pushBox(M, mid[0], by + 2, mid[1], 16.4, 2.5, 10.4, trim, c, s);

    const hy = by + bh + 7;
    pushEllip(M, mid[0], hy, mid[1], 7.2, 7.2, 7.2, skin, 4, 8, c, s);
    pushEllip(M, mid[0], hy + 1.9, mid[1], 7.6, 5.6, 7.6, hair, 3, 8, c, s);
    for (const ex of [-3.4, 3.4]) {
      const q = at(ex, 6.3);
      pushBox(M, q[0], hy - 1.6, q[1], 2.2, 2.6, 1.6, dark, c, s);
    }
  }

  resize() {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.vw = window.innerWidth;
    this.vh = window.innerHeight;
    this.canvas.width = Math.floor(this.vw * this.dpr);
    this.canvas.height = Math.floor(this.vh * this.dpr);
    this.canvas.style.width = this.vw + 'px';
    this.canvas.style.height = this.vh + 'px';
    this.overlay.width = this.canvas.width;
    this.overlay.height = this.canvas.height;
    this.overlay.style.width = this.vw + 'px';
    this.overlay.style.height = this.vh + 'px';
    if (this.gl) this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  sp(x, y, z) {
    const m = this.mVP;
    const cx = m[0] * x + m[4] * y + m[8] * z + m[12];
    const cy = m[1] * x + m[5] * y + m[9] * z + m[13];
    const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (cw <= 0.05) return null;
    const sx = (cx / cw * 0.5 + 0.5) * this.vw;
    const sy = (1 - (cy / cw * 0.5 + 0.5)) * this.vh;
    if (sx < -400 || sx > this.vw + 400 || sy < -400 || sy > this.vh + 400) return null;
    return { x: sx, y: sy };
  }

  draw(me, players, activity, dt) {
    this.stats.frames++;
    const list = Array.isArray(players) ? players.slice() : [...players];
    if (me) {
      let found = false;
      for (const p of list) if (p.id === me.id) { found = true; break; }
      if (!found) list.push(me);
    }
    const k = Math.min(1, (dt || 0.016) * 6);
    const tx = me ? (me.rx != null ? me.rx : me.x) : MAP.w / 2;
    const tz = me ? (me.ry != null ? me.ry : me.y) : MAP.h / 2;
    if (!this.freeCam) {
      this.cam.x += (tx - this.cam.x) * k;
      this.cam.z += (tz - this.cam.z) * k;
      // Keep the camera target inside the playable room; never expose the void beyond the walls.
      const margin = 180;
      this.cam.x = Math.max(margin, Math.min(MAP.w - margin, this.cam.x));
      this.cam.z = Math.max(margin, Math.min(MAP.h - margin, this.cam.z));
    }

    if (!this.gl) { this.drawFallback(); return; }

    const gl = this.gl;
    const def = this.lights ? this.litDef : this.nightDef;
    const aspect = this.canvas.width / Math.max(1, this.canvas.height);
    // Keep the horizontal view wide on portrait/narrow screens so the whole
    // room fits instead of a thin slice; desktop keeps the classic 45° vFOV.
    const BASE_FOV = Math.PI / 4, HREF = 1.6;
    const fovy = aspect < HREF
      ? Math.min(1.4, 2 * Math.atan(Math.tan(BASE_FOV / 2) * HREF / Math.max(0.4, aspect)))
      : BASE_FOV;
    perspective(this.mProj, fovy, aspect, 5, 9000);
    const orb = this.camOrbit;
    // Fog scales with zoom: fixed range drowned distant views in haze, so
    // you could never pull far enough back to read the whole map.
    const camDist = orb ? 977 : (this.fp && me ? 520 : this.orbit.dist);
    this.fogNow = [camDist * 1.02, Math.max(3000, camDist * 2.8)];
    if (orb) {
      this.eye.x = orb.ex; this.eye.y = orb.ey; this.eye.z = orb.ez;
      lookAt(this.mView, orb.ex, orb.ey, orb.ez, orb.tx, orb.ty, orb.tz);
    } else if (this.fp && me) {
      // First person: eye sits at the avatar's head; yaw stays shared with
      // orbit so WASD/joystick movement is already view-relative.
      const o = this.orbit;
      const px = me.rx != null ? me.rx : me.x;
      const pz = me.ry != null ? me.ry : me.y;
      const bob = me.anim === 'walk' ? Math.sin(this.time * 11) * 0.7 : 0;
      const ex = px, ey = 24.5 + bob, ez = pz;
      const cp = Math.cos(this.fpPitch), sp = Math.sin(this.fpPitch);
      this.eye.x = ex; this.eye.y = ey; this.eye.z = ez;
      lookAt(this.mView, ex, ey, ez,
        ex - Math.sin(o.yaw) * cp * 100, ey + sp * 100, ez - Math.cos(o.yaw) * cp * 100);
    } else {
      const o = this.orbit;
      const cp = Math.cos(o.pitch), sp = Math.sin(o.pitch);
      const ex = this.cam.x + Math.sin(o.yaw) * cp * o.dist;
      const ey = sp * o.dist;
      const ez = this.cam.z + Math.cos(o.yaw) * cp * o.dist;
      this.eye.x = ex; this.eye.y = ey; this.eye.z = ez;
      lookAt(this.mView, ex, ey, ez, this.cam.x, 0, this.cam.z);
    }
    mul(this.mVP, this.mProj, this.mView);

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(def.fog[0], def.fog[1], def.fog[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.CULL_FACE);
    gl.depthMask(true);
    gl.disable(gl.BLEND);

    // The imported lobby is the actual map. The procedural shell (rug, outer
    // walls) only exists as a fallback; gameplay props are drawn on both.
    if (this.glbReady && this.glbWorld && this.glbWorld.opaque.length) {
      this.useTex();
      this.setTexM(this.mIdent);
      this.setTexTint(0.24, 0.20, 0.16, 1);
      this.bindTex(this.gpuApron, this.texApron);
      gl.drawElements(gl.TRIANGLES, this.gpuApron.count, gl.UNSIGNED_SHORT, 0);
      this.stats.draws++;

      this.useGLB(def);
      for (const g of this.glbWorld.opaque) this.drawGLBD(g);
      this.glErr('lobbyOpaque');

      this.useLit();
      this.setLitM(this.mIdent);
      this.setLitTint(1, 1, 1);
      this.setLitLighting(def);
      this.bindLit(this.gpuBack);
      gl.drawElements(gl.TRIANGLES, this.gpuBack.count, gl.UNSIGNED_SHORT, 0);
      this.stats.draws++;
      this.bindLit(this.gpuWorld);
      gl.drawElements(gl.TRIANGLES, this.gpuWorld.count, gl.UNSIGNED_SHORT, 0);
      this.stats.draws++;
      this.setLitTint(this.lights ? 1.0 : 0.34, this.lights ? 0.86 : 0.34, this.lights ? 0.42 : 0.38);
      this.bindLit(this.gpuLever);
      gl.drawElements(gl.TRIANGLES, this.gpuLever.count, gl.UNSIGNED_SHORT, 0);
      this.stats.draws++;
      this.glErr('glbProps');
    } else {
      // Emergency fallback only while lobby.glb cannot be loaded.
      this.useTex();
      this.setTexM(this.mIdent);
      this.setTexTint(1, 1, 1, 1);
      this.bindTex(this.gpuFloor, this.texFloor);
      gl.drawElements(gl.TRIANGLES, this.gpuFloor.count, gl.UNSIGNED_SHORT, 0);
      this.stats.draws++;

      this.useLit();
      this.setLitM(this.mIdent);
      this.setLitTint(1, 1, 1);
      this.setLitLighting(def);
      this.bindLit(this.gpuBack);
      gl.drawElements(gl.TRIANGLES, this.gpuBack.count, gl.UNSIGNED_SHORT, 0);
      this.stats.draws++;
      this.bindLit(this.gpuShell);
      gl.drawElements(gl.TRIANGLES, this.gpuShell.count, gl.UNSIGNED_SHORT, 0);
      this.stats.draws++;
      this.bindLit(this.gpuWorld);
      gl.drawElements(gl.TRIANGLES, this.gpuWorld.count, gl.UNSIGNED_SHORT, 0);
      this.stats.draws++;

      this.setLitTint(this.lights ? 1.0 : 0.34, this.lights ? 0.86 : 0.34, this.lights ? 0.42 : 0.38);
      this.bindLit(this.gpuLever);
      gl.drawElements(gl.TRIANGLES, this.gpuLever.count, gl.UNSIGNED_SHORT, 0);
      this.stats.draws++;
      this.glErr('procWorld');
    }

    if (this.glbReady && this.glbPlayer && this.glbPlayer.opaque.length) {
      this.useGLB(def);
      for (const p of list) {
        if (this.fp && me && p.id === me.id) continue;
        const px = p.rx != null ? p.rx : p.x;
        const pz = p.ry != null ? p.ry : p.y;
        const seated = p.status === 'seated' || p.anim === 'sit';
        const walking = p.anim === 'walk' && !seated;
        const ry = Math.PI / 2 - (p.dir || 0);
        const phase = this.time * 11 + (p.id.charCodeAt(0) || 0);
        const bob = walking ? Math.abs(Math.sin(phase)) * 1.2 : 0;
        trs(this.mScratch, px, bob, pz, ry, 1, 1, 1);
        for (const g of this.glbPlayer.opaque) {
          mul(this.mScratch2, this.mScratch, g.matrix);
          this.drawGLBD(g, this.mScratch2);
        }
      }
    } else {

    const M = this.meshPlayers;
    M.pos.length = 0; M.nrm.length = 0; M.col.length = 0; M.idx.length = 0;
    for (const p of list) {
      if (this.fp && me && p.id === me.id) continue;
      this.pushPlayer(M, p);
    }
    if (M.idx.length) {
      this.fillMesh(this.gpuPlayers, M, gl.DYNAMIC_DRAW);
      this.useLit();
      this.setLitM(this.mIdent);
      this.setLitTint(1, 1, 1);
      this.bindLit(this.gpuPlayers);
      gl.drawElements(gl.TRIANGLES, this.gpuPlayers.count, gl.UNSIGNED_SHORT, 0);
      this.stats.draws++;
    }

    }

    this.glErr('players');

    if (me && !this.fp) {
      trs(this.mScratch, me.rx != null ? me.rx : me.x, 1.4, me.ry != null ? me.ry : me.y, 0, 1, 1, 1);
      this.useLit();
      this.setLitM(this.mScratch);
      this.setLitTint(1, 1, 1);
      this.bindLit(this.gpuRing);
      gl.drawElements(gl.TRIANGLES, this.gpuRing.count, gl.UNSIGNED_SHORT, 0);
      this.stats.draws++;
      this.glErr('ring');
    }

    const SH = this.meshShadows;
    SH.pos.length = 0; SH.uv.length = 0; SH.idx.length = 0;
    const GLM = this.meshGlows;
    GLM.pos.length = 0; GLM.uv.length = 0; GLM.idx.length = 0;
    for (const p of list) {
      if (this.fp && me && p.id === me.id) continue;
      const x = p.rx != null ? p.rx : p.x;
      const z = p.ry != null ? p.ry : p.y;
      const seated = p.status === 'seated' || p.anim === 'sit';
      const rx = seated ? 15 : 13, rz = seated ? 8 : 7;
      pushT(SH, [
        [x - rx, 2, z - rz], [x + rx, 2, z - rz], [x + rx, 2, z + rz], [x - rx, 2, z + rz]
      ], [[0, 0], [1, 0], [1, 1], [0, 1]]);
      if (!this.lights) {
        pushT(GLM, [
          [x - 74, 3, z - 74], [x + 74, 3, z - 74], [x + 74, 3, z + 74], [x - 74, 3, z + 74]
        ], [[0, 0], [1, 0], [1, 1], [0, 1]]);
      }
    }
    if (this.lights) {
      for (const o of OBJECTS) {
        if (o.type !== 'table' && o.type !== 'bar') continue;
        const cx = o.x + o.w / 2, cz = o.y + o.h / 2, r = o.w * 0.85;
        pushT(GLM, [
          [cx - r, 3, cz - r], [cx + r, 3, cz - r], [cx + r, 3, cz + r], [cx - r, 3, cz + r]
        ], [[0, 0], [1, 0], [1, 1], [0, 1]]);
      }
    }

    gl.enable(gl.BLEND);
    gl.depthMask(false);
    if (this.glbReady && this.glbWorld && this.glbWorld.blend.length) {
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      this.useGLB(def);
      for (const g of this.glbWorld.blend) this.drawGLBD(g);
      this.glErr('lobbyBlend');
    }
    this.useTex();
    this.setTexM(this.mIdent);

    if (SH.idx.length) {
      this.fillTexMesh(this.gpuShadows, SH, gl.DYNAMIC_DRAW);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      this.setTexTint(0, 0, 0, 0.45);
      this.bindTex(this.gpuShadows, this.texDot);
      gl.drawElements(gl.TRIANGLES, this.gpuShadows.count, gl.UNSIGNED_SHORT, 0);
      this.stats.draws++;
      this.glErr('shadows');
    }

    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    if (this.lights) this.setTexTint(1.0, 0.86, 0.5, 1);
    else this.setTexTint(1.0, 0.47, 0.7, 1);
    this.bindTex(this.gpuSign, this.texSign);
    gl.drawElements(gl.TRIANGLES, this.gpuSign.count, gl.UNSIGNED_SHORT, 0);
    this.stats.draws++;

    if (GLM.idx.length) {
      this.fillTexMesh(this.gpuGlows, GLM, gl.DYNAMIC_DRAW);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      if (this.lights) this.setTexTint(1.0, 0.84, 0.55, 0.62);
      else this.setTexTint(1.0, 0.8, 0.4, 0.45);
      this.bindTex(this.gpuGlows, this.texDot);
      gl.drawElements(gl.TRIANGLES, this.gpuGlows.count, gl.UNSIGNED_SHORT, 0);
      this.stats.draws++;
      this.glErr('glows');
    }

    gl.depthMask(true);
    gl.disable(gl.BLEND);
    this.glErr('blend');
    this.drawOverlay(list, me, activity);
  }

  useLit() {
    const gl = this.gl, P = this.pLit;
    gl.useProgram(P.prog);
    gl.uniformMatrix4fv(P.u.uVP, false, this.mVP);
    gl.uniform3f(P.u.uCam, this.eye.x, this.eye.y, this.eye.z);
  }

  setLitM(m) { this.gl.uniformMatrix4fv(this.pLit.u.uM, false, m); }

  setLitTint(r, g, b) { this.gl.uniform3f(this.pLit.u.uTint, r, g, b); }

  setLitLighting(def) {
    const gl = this.gl, u = this.pLit.u;
    gl.uniform3f(u.uSunDir, def.sunDir[0], def.sunDir[1], def.sunDir[2]);
    gl.uniform3f(u.uSunColor, def.sun[0], def.sun[1], def.sun[2]);
    gl.uniform3f(u.uAmbient, def.amb[0], def.amb[1], def.amb[2]);
    gl.uniform3f(u.uFogColor, def.fog[0], def.fog[1], def.fog[2]);
    gl.uniform2f(u.uFogRange, this.fogNow[0], this.fogNow[1]);
  }

  useGLB(def) {
    const gl = this.gl, P = this.pGLB;
    gl.useProgram(P.prog);
    gl.uniformMatrix4fv(P.u.uVP, false, this.mVP);
    gl.uniform3f(P.u.uCam, this.eye.x, this.eye.y, this.eye.z);
    gl.uniform3f(P.u.uSunDir, def.sunDir[0], def.sunDir[1], def.sunDir[2]);
    gl.uniform3f(P.u.uSunColor, def.sun[0], def.sun[1], def.sun[2]);
    gl.uniform3f(P.u.uAmbient, def.amb[0], def.amb[1], def.amb[2]);
    gl.uniform3f(P.u.uFogColor, def.fog[0], def.fog[1], def.fog[2]);
    gl.uniform2f(P.u.uFogRange, this.fogNow[0], this.fogNow[1]);
  }

  drawGLBD(g, m) {
    const gl = this.gl, P = this.pGLB;
    const wm = m || g.matrix;
    gl.uniformMatrix4fv(P.u.uM, false, wm);
    nrmMat3(wm, this.mN3);
    gl.uniformMatrix3fv(P.u.uN, false, this.mN3);
    const mat = g.mat;
    if (mat) {
      const k = mat.unlit ? GLB_EXPOSURE : 1;
      gl.uniform4f(P.u.uTint, mat.base[0] * k, mat.base[1] * k, mat.base[2] * k, mat.base[3]);
    } else gl.uniform4f(P.u.uTint, 1, 1, 1, 1);
    gl.uniform1f(P.u.uUnlit, mat && mat.unlit ? 1 : 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, g.tex || this.texWhite);
    this.bindAttrs(set => {
      set(P.a.aPos, g.pos, 3);
      set(P.a.aNrm, g.nrm, 3);
      set(P.a.aUV, g.uv, 2);
    });
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, g.idx);
    gl.drawElements(gl.TRIANGLES, g.count, g.type, 0);
    this.stats.draws++;
  }

  glErr(phase) {
    if (!this.glDbg) return;
    const e = this.gl.getError();
    if (e && !this.glErrs[phase]) {
      this.glErrs[phase] = e;
      console.warn('[glERR] ' + e + ' after ' + phase);
    }
  }

  useTex() {
    const gl = this.gl, P = this.pTex;
    gl.useProgram(P.prog);
    gl.uniformMatrix4fv(P.u.uVP, false, this.mVP);
  }

  setTexM(m) { this.gl.uniformMatrix4fv(this.pTex.u.uM, false, m); }

  setTexTint(r, g, b, a) { this.gl.uniform4f(this.pTex.u.uTint, r, g, b, a); }

  bindAttrs(setup) {
    const gl = this.gl;
    for (const i of this.enabledAttrs) gl.disableVertexAttribArray(i);
    this.enabledAttrs.clear();
    setup((loc, buf, size) => {
      if (loc == null || loc < 0 || !buf) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
      this.enabledAttrs.add(loc);
    });
  }

  bindLit(gpu) {
    const P = this.pLit;
    this.bindAttrs(set => {
      set(P.a.aPos, gpu.pos, 3);
      set(P.a.aNrm, gpu.nrm, 3);
      set(P.a.aCol, gpu.col, 3);
    });
    this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, gpu.idx);
  }

  bindTex(gpu, tex) {
    const gl = this.gl, P = this.pTex;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    this.bindAttrs(set => {
      set(P.a.aPos, gpu.pos, 3);
      set(P.a.aUV, gpu.uv, 2);
    });
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gpu.idx);
  }

  rr(o, x, y, w, h, r) {
    o.beginPath();
    o.moveTo(x + r, y);
    o.arcTo(x + w, y, x + w, y + h, r);
    o.arcTo(x + w, y + h, x, y + h, r);
    o.arcTo(x, y + h, x, y, r);
    o.arcTo(x, y, x + w, y, r);
    o.closePath();
  }

  bubble(o, cx, cy, text, bg, fg, maxW) {
    o.save();
    o.font = '600 12px Arial';
    let t = String(text);
    if (o.measureText(t).width > maxW - 16) {
      while (t.length > 2 && o.measureText(t + '…').width > maxW - 16) t = t.slice(0, -1);
      t += '…';
    }
    const w = Math.min(maxW, o.measureText(t).width + 18);
    const h = 22;
    o.fillStyle = bg;
    this.rr(o, cx - w / 2, cy - h, w, h, 10);
    o.fill();
    o.beginPath();
    o.moveTo(cx - 5, cy);
    o.lineTo(cx + 5, cy);
    o.lineTo(cx, cy + 7);
    o.closePath();
    o.fill();
    o.fillStyle = fg;
    o.textAlign = 'center';
    o.textBaseline = 'middle';
    o.fillText(t, cx, cy - h / 2 + 1);
    o.restore();
  }

  drawOverlay(list, me, activity) {
    const o = this.octx;
    o.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    o.clearRect(0, 0, this.vw, this.vh);
    const now = Date.now();

    if (me) {
      const meX = me.rx != null ? me.rx : me.x;
      const meZ = me.ry != null ? me.ry : me.y;
      for (const sd of SEATS) {
        if (sd.occupiedBy) continue;
        const dist = Math.hypot(sd.x - meX, sd.y - meZ);
        if (dist > 54) continue;
        const c1 = this.sp(sd.x, 12, sd.y);
        if (!c1) continue;
        const e = this.sp(sd.x + 17, 12, sd.y);
        if (!e) continue;
        const r = Math.hypot(e.x - c1.x, e.y - c1.y);
        if (r < 2 || r > 300) continue;
        const near = 1 - dist / 54;
        o.globalAlpha = 0.18 + near * 0.4 + Math.sin(this.time * 3) * 0.05;
        o.strokeStyle = 'rgba(233,200,119,.9)';
        o.lineWidth = 1.5;
        o.beginPath();
        o.arc(c1.x, c1.y, r, 0, Math.PI * 2);
        o.stroke();
      }
      o.globalAlpha = 1;
    }

    for (const p of list) {
      const seated = p.status === 'seated' || p.anim === 'sit';
      const isMe = !!me && p.id === me.id;
      if (isMe && this.fp) continue;
      const topH = this.glbPlayer ? (seated ? 52 : 44) : (seated ? 72 : 64);
      const anchor = this.sp(p.rx != null ? p.rx : p.x, topH, p.ry != null ? p.ry : p.y);
      if (!anchor) continue;
      const x = anchor.x, ty = anchor.y;
      o.font = '13px BrewPixel, Arial, sans-serif';
      o.textAlign = 'center';
      o.textBaseline = 'middle';
      o.fillStyle = 'rgba(0,0,0,.85)';
      o.fillText(p.name, x + 1, ty + 1);
      o.fillStyle = isMe ? '#ffe98a' : '#f4f4f4';
      o.fillText(p.name, x, ty);

      if (p.status === 'activity') {
        o.font = '10px BrewPixel, Arial, sans-serif';
        o.fillStyle = 'rgba(0,0,0,.85)';
        o.fillText('PLAYING', x + 1, ty - 16);
        o.fillStyle = '#e9c877';
        o.fillText('PLAYING', x, ty - 17);
      }

      if (p.chat && now - p.chat.at < 6500) {
        this.bubble(o, x, ty - 26, p.chat.text, '#0b1f18', '#e7e0cf', 200);
      } else if (p.emote && p.emoteAt && now - p.emoteAt < 3600) {
        this.bubble(o, x, ty - 26, p.emote, '#e9c877', '#1a1206', 150);
      }
    }

    if (activity) {
      const table = OBJ_BY_ID.get(activity.table);
      if (table) {
        const anchor = this.sp(table.x + table.w / 2, table.hgt + 46, table.y + table.h / 2);
        if (anchor) {
          const label = (activity.phase === 'result'
            ? 'RESULT: ' + (activity.result || '').toUpperCase()
            : String(activity.kind || 'coinflip').toUpperCase());
          o.font = '800 12px Arial';
          const w = o.measureText(label).width + 26;
          o.fillStyle = 'rgba(4,16,12,.9)';
          this.rr(o, anchor.x - w / 2, anchor.y - 12, w, 24, 12);
          o.fill();
          o.strokeStyle = 'rgba(233,200,119,.8)';
          o.lineWidth = 1.5;
          o.stroke();
          o.fillStyle = '#e9c877';
          o.textAlign = 'center';
          o.textBaseline = 'middle';
          o.fillText(label, anchor.x, anchor.y);
        }
      }
    }

    const cx = this.vw / 2, cy = this.vh / 2;
    const vg = o.createRadialGradient(
      cx, cy, Math.min(this.vw, this.vh) * 0.35,
      cx, cy, Math.max(this.vw, this.vh) * 0.75
    );
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,.55)');
    o.fillStyle = vg;
    o.fillRect(0, 0, this.vw, this.vh);
  }

  drawFallback() {
    const g = this.fctx;
    if (!g) return;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.fillStyle = '#14100c';
    g.fillRect(0, 0, this.vw, this.vh);
    g.fillStyle = '#e9c877';
    g.font = '700 16px Arial';
    g.textAlign = 'center';
    g.fillText('WebGL is required to render Brew.', this.vw / 2, this.vh / 2);
  }
}
