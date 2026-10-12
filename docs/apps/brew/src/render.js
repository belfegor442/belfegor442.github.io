import { MAP, OBJECTS, SEATS, OBJ_BY_ID, setNav } from './world.js';
import {
  C, mul, perspective, lookAt, trs, ortho,
  VS_MAIN, FS_MAIN, VS_TEX, FS_TEX, VS_GLB, FS_GLB, FS_GLB_SIMPLE, VS_SHADOW, FS_SHADOW,
  newMesh, newTMesh, pushBox, pushEllip,
  pushRing, pushQuadLit, pushT, buildFloor, dotTexture
} from './renderGeo.js';
import { loadGLB, buildNav } from './glb.js';
import { buildBrewMap, LIGHTS } from './map.js';
import { SKINS, SKIN_BY_ID, DEFAULT_SKIN, normalizeSkin, TARGET_H } from './skins.js';

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

// Keep the emissive/unlit boost neutral; the generated map authors its own albedo.
const GLB_EXPOSURE = 1.0;

// Inverse-transpose of the upper-left 3x3 of a column-major mat4, into a
// 9-float column-major mat3. Correct normals under non-uniform (anisotropic)
// world scale, which a plain mat3(uM) would skew.
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

// Fit a loaded player skin into world units: reorient (rotX/yaw), scale so the
// height matches classic steve (32), center on X/Z and plant the feet on y=0.
// Applied once at upload time as a single matrix on every draw node.
function fitPlayerMatrix(b, def) {
  const yaw = def.yaw || 0, rx = def.rotX || 0;
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const cx = Math.cos(rx), sx = Math.sin(rx);
  // R = Ry(yaw) * Rx(rx), column-major.
  const R = new Float32Array(16);
  R[0] = cy; R[1] = 0; R[2] = -sy;
  R[4] = sy * sx; R[5] = cx; R[6] = cy * sx;
  R[8] = sy * cx; R[9] = -sx; R[10] = cy * cx;
  R[15] = 1;
  // Rotated bounds from the 8 corners.
  let mnx = Infinity, mny = Infinity, mnz = Infinity;
  let mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
  for (let i = 0; i < 8; i++) {
    const x = (i & 1) ? b.max[0] : b.min[0];
    const y = (i & 2) ? b.max[1] : b.min[1];
    const z = (i & 4) ? b.max[2] : b.min[2];
    const px = R[0] * x + R[4] * y + R[8] * z;
    const py = R[1] * x + R[5] * y + R[9] * z;
    const pz = R[2] * x + R[6] * y + R[10] * z;
    if (px < mnx) mnx = px; if (px > mxx) mxx = px;
    if (py < mny) mny = py; if (py > mxy) mxy = py;
    if (pz < mnz) mnz = pz; if (pz > mxz) mxz = pz;
  }
  const h = mxy - mny || 1;
  let s = (def.height || TARGET_H) / h;
  if (def.scale) s *= def.scale;
  const M = new Float32Array(16);
  M[0] = s * R[0]; M[1] = s * R[1]; M[2] = s * R[2];
  M[4] = s * R[4]; M[5] = s * R[5]; M[6] = s * R[6];
  M[8] = s * R[8]; M[9] = s * R[9]; M[10] = s * R[10];
  M[12] = -s * (mnx + mxx) / 2;
  M[13] = -s * mny;
  M[14] = -s * (mnz + mxz) / 2;
  M[15] = 1;
  return M;
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
    this.lights = false;
    this.time = 0;
    this.vw = 0; this.vh = 0; this.dpr = 1;
    this.cam = { x: MAP.w / 2, z: MAP.h / 2 };
    this.camOrbit = null;
    this.eye = { x: MAP.w / 2, y: 730, z: MAP.h / 2 + 650 };
    this.orbit = { yaw: 0, pitch: Math.atan2(730, 650), dist: Math.hypot(730, 650) };
    this.freeCam = false;
    this.fp = false;
    this.fpPitch = 0;
    this.sprint = false;
    this._sk = 0;
    this._ray = null;
    this._drag = null;
    this._dragEndAt = 0;
    this.pathMark = null;
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
    this.playerSkins = new Map();
    this.skinPromises = new Map();
    this.skinFailed = new Set();
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
      this._dragEndAt = performance.now();
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

  // Ease the orbit yaw so the camera trails behind the avatar while it
  // travels: full follow for pathing, forward-ish only for manual input so
  // strafing and backpedaling never wrestle the camera around. User drags
  // win: follow stays paused while rotating and for 1.5s after.
  autoFollow(wx, wy, moving, manual, dt) {
    if (!moving || this.freeCam || this.fp || this._drag) return;
    if (performance.now() - this._dragEndAt < 1500) return;
    const sy = Math.sin(this.orbit.yaw), cy = Math.cos(this.orbit.yaw);
    const fwd = -(wx * sy + wy * cy);
    if (manual && fwd < 0.35) return;
    const want = Math.atan2(-wx, -wy);
    const d = Math.atan2(Math.sin(want - this.orbit.yaw), Math.cos(want - this.orbit.yaw));
    this.orbit.yaw += d * Math.min(1, dt * 2.5);
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
    this.pGLB = this.makeProgram(VS_GLB, FS_GLB, ['aPos', 'aNrm', 'aTan', 'aUV'],
      ['uVP', 'uM', 'uN', 'uCam', 'uTex', 'uNrmTex', 'uShadowTex', 'uShadowMat', 'uTint',
        'uUnlit', 'uHasNrm', 'uShadowOn', 'uShadowTexel', 'uSunDir', 'uSunColor', 'uAmbient',
        'uFogColor', 'uFogRange', 'uEmissive', 'uLightPos', 'uLightCol', 'uLightCount', 'uExposure']);
    if (!this.pGLB.ok) {
      console.warn('[gl] advanced GLB shader failed, using simple lighting');
      this.pGLB = this.makeProgram(VS_GLB, FS_GLB_SIMPLE, ['aPos', 'aNrm', 'aTan', 'aUV'],
        ['uVP', 'uM', 'uN', 'uCam', 'uTex', 'uTint', 'uUnlit', 'uSunDir', 'uSunColor',
          'uAmbient', 'uFogColor', 'uFogRange']);
    }
    gl.useProgram(this.pGLB.prog);
    gl.uniform1i(this.pGLB.u.uTex, 0);
    if (this.pGLB.u.uNrmTex) gl.uniform1i(this.pGLB.u.uNrmTex, 1);
    if (this.pGLB.u.uShadowTex) gl.uniform1i(this.pGLB.u.uShadowTex, 2);
    this.pShadow = this.makeProgram(VS_SHADOW, FS_SHADOW, ['aPos'], ['uM', 'uLightVP']);
    this.isGL2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
    this.uintIdx = this.isGL2 || !!gl.getExtension('OES_element_index_uint');
    this.glbWorld = null;
    this.glbPlayer = null;
    this.mapReady = false;
    this.useImportedWorld = true;
    this.glbReady = false;
    this.glbWorldAlpha = null;
    this.mScratch2 = new Float32Array(16);
    this.mN3 = new Float32Array(9);
    this.lightPosArr = new Float32Array(32);
    this.lightColArr = new Float32Array(24);
    this.mLightVP = new Float32Array(16);
    this.mLightView = new Float32Array(16);
    this.mLightProj = new Float32Array(16);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.CULL_FACE);

    this.texApron = this.uploadTexture(buildFloor(false));
    this.texDot = this.uploadTexture(dotTexture());
    const wc = document.createElement('canvas');
    wc.width = wc.height = 1;
    const wg = wc.getContext('2d');
    wg.fillStyle = '#ffffff';
    wg.fillRect(0, 0, 1, 1);
    this.texWhite = this.uploadTexture(wc);

    const back = newMesh(), sw = newMesh(), lever = newMesh(), ring = newMesh();
    const apronT = newTMesh();
    pushQuadLit(back, [
      [-2200, -1.5, -2200], [MAP.w + 2200, -1.5, -2200],
      [MAP.w + 2200, -1.5, MAP.h + 2200], [-2200, -1.5, MAP.h + 2200]
    ], [0.05, 0.042, 0.034]);
    const switchObj = OBJECTS.find(o => o.type === 'switch');
    if (switchObj) {
      pushBox(sw, switchObj.x + 6, 36, switchObj.y + switchObj.h / 2, 10, 44, 22, C('#d8d2c4'));
      pushBox(lever, switchObj.x + 10, 50, switchObj.y + switchObj.h / 2, 5, 10, 8, [0.92, 0.92, 0.86]);
    }
    pushRing(ring, 0, 0, 0, 11.5, 15, C('#e9c877'), 24);
    // Dark apron around the building so the orbit camera never stares into
    // raw clear color past the walls. Plain wood (no room decals), matching
    // the extent of the lit back quad so the two share one silhouette.
    pushT(apronT, [
      [-2200, 0, -2200], [MAP.w + 2200, 0, -2200],
      [MAP.w + 2200, 0, MAP.h + 2200], [-2200, 0, MAP.h + 2200]
    ], [[0, 0], [4, 0], [4, 4], [0, 4]]);

    this.gpuBack = this.uploadMesh(back, gl.STATIC_DRAW);
    this.gpuSw = this.uploadMesh(sw, gl.STATIC_DRAW);
    this.gpuLever = this.uploadMesh(lever, gl.STATIC_DRAW);
    this.gpuRing = this.uploadMesh(ring, gl.STATIC_DRAW);
    this.gpuApron = this.uploadTexMesh(apronT, gl.STATIC_DRAW);

    this.meshPlayers = newMesh();
    this.meshShadows = newTMesh();
    this.meshGlows = newTMesh();
    this.gpuPlayers = this.uploadMesh(this.meshPlayers, gl.DYNAMIC_DRAW);
    this.gpuShadows = this.uploadTexMesh(this.meshShadows, gl.DYNAMIC_DRAW);
    this.gpuGlows = this.uploadTexMesh(this.meshGlows, gl.DYNAMIC_DRAW);

    const n = Math.hypot(0.45, 1, 0.35);
    this.litDef = {
      amb: [0.34, 0.33, 0.38], sun: [0.86, 0.80, 0.70],
      sunDir: [-0.45 / n, -1 / n, -0.35 / n],
      fog: [0.055, 0.043, 0.035], fogRange: [1150, 3300]
    };
    // Night reads as a warm, well-kept casino — brighter amber-neutral
    // ambient and a light warm haze instead of a dark blue-violet gloom.
    this.nightDef = {
      amb: [0.175, 0.155, 0.175], sun: [0.14, 0.135, 0.20],
      sunDir: [-0.45 / n, -1 / n, -0.35 / n],
      fog: [0.040, 0.034, 0.038], fogRange: [1150, 3300]
    };
    this.initShadowMap();
    if (this.useImportedWorld) this.loadGLBAssets();
  }

  initShadowMap() {
    const gl = this.gl;
    this.shadowSize = 2048;
    let ok = false;
    if (this.isGL2) {
      try {
        this.shadowTex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.shadowTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, this.shadowSize, this.shadowSize, 0,
          gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        this.shadowFbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.shadowTex, 0);
        if (typeof gl.drawBuffers === 'function') gl.drawBuffers([gl.NONE]);
        gl.readBuffer && gl.readBuffer(gl.NONE);
        ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      } catch (e) { ok = false; }
    } else {
      const ext = gl.getExtension('WEBGL_depth_texture');
      if (ext) {
        try {
          this.shadowTex = gl.createTexture();
          gl.bindTexture(gl.TEXTURE_2D, this.shadowTex);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT, this.shadowSize, this.shadowSize, 0,
            gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          this.shadowFbo = gl.createFramebuffer();
          gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFbo);
          gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.shadowTex, 0);
          ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
        } catch (e) { ok = false; }
      }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.shadowOk = ok;
    if (!ok) {
      this.shadowFbo = null;
      this.shadowTex = null;
      console.warn('[gl] shadow map unavailable on this device');
    }
  }

  renderShadowPass() {
    if (!this.shadowOk || !this.glbWorld) return;
    const gl = this.gl;
    const def = this.lights ? this.litDef : this.nightDef;
    const dir = def.sunDir;
    const cx = MAP.w / 2, cz = MAP.h / 2;
    const dist = 1700;
    const ex = cx - dir[0] * dist, ey = -dir[1] * dist, ez = cz - dir[2] * dist;
    lookAt(this.mLightView, ex, ey, ez, cx, 40, cz);
    ortho(this.mLightProj, -1650, 1650, -1150, 1450, 200, dist + 2400);
    mul(this.mLightVP, this.mLightProj, this.mLightView);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFbo);
    gl.viewport(0, 0, this.shadowSize, this.shadowSize);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(2.0, 4.0);
    const P = this.pShadow;
    gl.useProgram(P.prog);
    gl.uniformMatrix4fv(P.u.uLightVP, false, this.mLightVP);
    for (const g of this.glbWorld.opaque) {
      gl.uniformMatrix4fv(P.u.uM, false, g.matrix);
      this.bindAttrs(set => {
        set(P.a.aPos, g.pos, 3);
      });
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, g.idx);
      gl.drawElements(gl.TRIANGLES, g.count, g.type, 0);
    }
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  uploadLights(def) {
    const P = this.pGLB;
    if (!P.u.uLightPos) return;
    const gl = this.gl;
    const night = this.lights ? 1 : 1.95;
    const list = LIGHTS.map(l => {
      const dx = l.x - this.eye.x, dy = l.y - this.eye.y, dz = l.z - this.eye.z;
      return { l, d: dx * dx + dy * dy + dz * dz };
    }).sort((a, b) => a.d - b.d).slice(0, 8);
    for (let i = 0; i < 8; i++) {
      const rec = list[i];
      if (rec) {
        const l = rec.l;
        this.lightPosArr[i * 4] = l.x;
        this.lightPosArr[i * 4 + 1] = l.y;
        this.lightPosArr[i * 4 + 2] = l.z;
        this.lightPosArr[i * 4 + 3] = l.r;
        this.lightColArr[i * 3] = l.col[0] * l.int * night;
        this.lightColArr[i * 3 + 1] = l.col[1] * l.int * night;
        this.lightColArr[i * 3 + 2] = l.col[2] * l.int * night;
      } else {
        this.lightPosArr[i * 4 + 3] = 0;
        this.lightColArr[i * 3] = this.lightColArr[i * 3 + 1] = this.lightColArr[i * 3 + 2] = 0;
      }
    }
    gl.uniform4fv(P.u.uLightPos, this.lightPosArr);
    gl.uniform3fv(P.u.uLightCol, this.lightColArr);
    gl.uniform1f(P.u.uLightCount, list.length);
    gl.uniform1f(P.u.uExposure, 1.22);
    gl.uniform3f(P.u.uEmissive, 0, 0, 0);
    if (P.u.uShadowOn) {
      if (this.shadowOk && this.shadowTex) {
        gl.uniform1f(P.u.uShadowOn, 1);
        gl.uniform2f(P.u.uShadowTexel, 1 / this.shadowSize, 1 / this.shadowSize);
        gl.uniformMatrix4fv(P.u.uShadowMat, false, this.mLightVP);
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, this.shadowTex);
        gl.activeTexture(gl.TEXTURE0);
      } else {
        gl.uniform1f(P.u.uShadowOn, 0);
      }
    }
    void def;
  }

  async loadGLBAssets() {
    try {
      const world = await buildBrewMap();
      const nav = buildNav(world.draws.filter(d => !world.materials[d.mat].blend),
        MAP.w, MAP.h);
      setNav(nav);
      this.nav = nav;
      this.glbWorld = this.uploadGLB(world);
      this.mapReady = true;
      this.glbReady = true;
      const b = world.bounds;
      console.log('[map] brew ready: ' + this.glbWorld.opaque.length + ' opaque, ' +
        this.glbWorld.blend.length + ' blend, box=' +
        b.min.map(v => Math.round(v)).join(',') + '..' +
        b.max.map(v => Math.round(v)).join(',') +
        ', nav ' + nav.open + '/' + nav.total + ' open cells, ' +
        LIGHTS.length + ' lights');
    } catch (e) {
      this.glbReady = false;
      this.mapReady = false;
      console.warn('[map] map build failed, procedural fallback:', e && e.message);
      if (e && e.stack) console.warn(e.stack);
    }
    await this.ensureSkin(DEFAULT_SKIN);
  }

  // Lazy-load + upload one skin from the catalogue. Resolves with the uploaded
  // model (or null on failure); concurrent callers share one in-flight load.
  ensureSkin(id) {
    id = normalizeSkin(id);
    const cached = this.playerSkins.get(id);
    if (cached) return Promise.resolve(cached);
    if (this.skinPromises.has(id)) return this.skinPromises.get(id);
    if (this.skinFailed.has(id)) return Promise.resolve(null);
    const def = SKIN_BY_ID.get(id);
    if (!def) return Promise.resolve(null);
    const pr = loadGLB(def.url).then(glb => {
      const fit = fitPlayerMatrix(glb.bounds, def);
      for (const g of glb.draws) g.matrix = mul(new Float32Array(16), fit, g.matrix);
      const up = this.uploadGLB(glb);
      this.playerSkins.set(id, up);
      this.skinPromises.delete(id);
      if (id === DEFAULT_SKIN) this.glbPlayer = up;
      console.log('[glb] skin ' + id + ' ready: draws=' + (up.opaque.length + up.blend.length));
      return up;
    }).catch(e => {
      this.skinPromises.delete(id);
      this.skinFailed.add(id);
      console.warn('[glb] skin ' + id + ' load failed:', e && e.message);
      return null;
    });
    this.skinPromises.set(id, pr);
    return pr;
  }

  uploadGLB(glb) {
    const gl = this.gl;
    const out = { opaque: [], blend: [] };
    const texCache = new Map();
    for (const d of glb.draws) {
      if (!d.idx || !d.idx.length) continue;
      const m = d.mat >= 0 ? glb.materials[d.mat] : null;
      const gpu = {
        pos: this.gbuf(d.pos), nrm: this.gbuf(d.nrm), tan: this.gbuf(d.tan), uv: this.gbuf(d.uv),
        idx: gl.createBuffer(), count: d.idx.length,
        type: d.idx instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT,
        matrix: d.matrix, mat: m, tex: null, nrmTex: null
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
      if (m && m.nrm != null && m.nrm >= 0 && glb.images[m.nrm]) {
        const key = 'n' + m.nrm;
        if (!texCache.has(key)) {
          texCache.set(key, this.uploadGLBTexture(glb.images[m.nrm], glb.samplers[m.nrmSmp] || {}));
        }
        gpu.nrmTex = texCache.get(key);
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
    // WebGL1 makes NPOT textures incomplete under REPEAT/MIPMAP: clamp them.
    const isPot = pot(bitmap.width) && pot(bitmap.height);
    const ws = isPot ? wrap(smp.wrapS) : gl.CLAMP_TO_EDGE;
    const wt = isPot ? wrap(smp.wrapT) : gl.CLAMP_TO_EDGE;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, ws);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wt);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, smp.magFilter === 9728 ? gl.NEAREST : gl.LINEAR);
    if (isPot) {
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
    const ok = !!gl.getProgramParameter(prog, gl.LINK_STATUS);
    if (!ok) {
      console.error('program link failed:', gl.getProgramInfoLog(prog));
    }
    const u = {}, a = {};
    for (const nm of uniforms) u[nm] = gl.getUniformLocation(prog, nm);
    for (const nm of attribs) a[nm] = gl.getAttribLocation(prog, nm);
    return { prog, u, a, ok };
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

  // Store the camera basis for this frame so clicks can be unprojected to the
  // floor (click/tap-to-move).
  setRay(ox, oy, oz, txx, tyy, tzz, fovy, aspect) {
    let fx = txx - ox, fy = tyy - oy, fz = tzz - oz;
    let l = Math.hypot(fx, fy, fz) || 1;
    fx /= l; fy /= l; fz /= l;
    // right = fwd x up(0,1,0)
    let rx = -fz, ry = 0, rz = fx;
    l = Math.hypot(rx, ry, rz) || 1;
    rx /= l; ry /= l; rz /= l;
    // up = right x fwd
    const ux = ry * fz - rz * fy, uy = rz * fx - rx * fz, uz = rx * fy - ry * fx;
    this._ray = { ox, oy, oz, fx, fy, fz, rx, ry, rz, ux, uy, uz, tan: Math.tan(fovy / 2), aspect };
  }

  // Intersect the view ray through (x, y) with the floor plane y=0.
  screenToGround(x, y) {
    const r = this._ray;
    if (!r) return null;
    const ndcX = (x / Math.max(1, this.vw)) * 2 - 1;
    const ndcY = 1 - (y / Math.max(1, this.vh)) * 2;
    const tx = ndcX * r.tan * r.aspect, ty = ndcY * r.tan;
    let dx = r.fx + r.rx * tx + r.ux * ty;
    let dy = r.fy + r.ry * tx + r.uy * ty;
    let dz = r.fz + r.rz * tx + r.uz * ty;
    const l = Math.hypot(dx, dy, dz) || 1;
    dx /= l; dy /= l; dz /= l;
    if (dy > -0.02) return null;
    const t = -r.oy / dy;
    if (t <= 0 || t > 7000) return null;
    return { x: r.ox + dx * t, z: r.oz + dz * t };
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
    // Sprint opens the view slightly (eased in/out) for a sense of speed.
    this._sk += ((this.sprint ? 1 : 0) - this._sk) * Math.min(1, (dt || 0.016) * 7);
    // Keep the horizontal view wide on portrait/narrow screens so the whole
    // room fits instead of a thin slice; desktop keeps the classic 45° vFOV.
    const BASE_FOV = Math.PI / 4, HREF = 1.6;
    const baseFov = aspect < HREF
      ? Math.min(1.4, 2 * Math.atan(Math.tan(BASE_FOV / 2) * HREF / Math.max(0.4, aspect)))
      : BASE_FOV;
    const fovy = baseFov * (1 + 0.03 * this._sk);
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
      const ex = px, ey = 32 + bob, ez = pz;
      const cp = Math.cos(this.fpPitch), sp = Math.sin(this.fpPitch);
      this.eye.x = ex; this.eye.y = ey; this.eye.z = ez;
      const lx = ex - Math.sin(o.yaw) * cp * 100, ly = ey + sp * 100, lz = ez - Math.cos(o.yaw) * cp * 100;
      lookAt(this.mView, ex, ey, ez, lx, ly, lz);
      this.setRay(ex, ey, ez, lx, ly, lz, fovy, aspect);
    } else {
      const o = this.orbit;
      const cp = Math.cos(o.pitch), sp = Math.sin(o.pitch);
      let ex = this.cam.x + Math.sin(o.yaw) * cp * o.dist;
      let ey = Math.max(14, sp * o.dist);
      let ez = this.cam.z + Math.cos(o.yaw) * cp * o.dist;
      // A low eye inside a wall, furniture or the roof-beam band pulls in
      // toward the target (converging on the free spot the player stands
      // in). High eyes are above everything and may sit outside the walls —
      // that is the intended over-the-top overview. The eye is tested as a
      // point: the nav grid is cell-quantised and would over-reject the
      // open strip beside any wall, and an eye parked inside a beam renders
      // its top edge-on as a giant brown wall.
      if (ey < 150) {
        const eyeBlocked = (x, z) => {
          if (x < MAP.wall + 3 || x > MAP.w - MAP.wall - 3 ||
            z < MAP.wall + 3 || z > MAP.h - MAP.wall - 3) return true;
          if (ey >= 123 && ey <= 149) {
            for (const bz of [170, 430, 730, 1030]) if (Math.abs(z - bz) <= 13) return true;
            if (Math.abs(x - 600) <= 10 || Math.abs(x - 1500) <= 10) return true;
            if (z < 46 || z > MAP.h - 46) return true;
          }
          for (const ob of OBJECTS) {
            if (ob.solid && x > ob.x && x < ob.x + ob.w && z > ob.y && z < ob.y + ob.h) return true;
          }
          return false;
        };
        let f = 1;
        while (f >= 0.05 && eyeBlocked(ex, ez)) {
          f *= 0.92;
          ex = this.cam.x + Math.sin(o.yaw) * cp * o.dist * f;
          // never drop to floor level while pulling in: a camera parked at
          // ankle height inside a corner reads as a horror tunnel. 44 keeps
          // a normal third-person look even in the worst squeeze.
          ey = Math.max(44, sp * o.dist * f);
          ez = this.cam.z + Math.cos(o.yaw) * cp * o.dist * f;
        }
      }
      this.eye.x = ex; this.eye.y = ey; this.eye.z = ez;
      lookAt(this.mView, ex, ey, ez, this.cam.x, 0, this.cam.z);
      this.setRay(ex, ey, ez, this.cam.x, 0, this.cam.z, fovy, aspect);
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

    // Shadow map first (own FBO), then the generated map geometry.
    this.renderShadowPass();

    // The generated map is the world. Only the light switch rides along as
    // separate lit geometry.
    if (this.glbReady && this.glbWorld && this.glbWorld.opaque.length) {
      // Backdrop only: no depth write, so the huge quads can't z-lose to the
      // near carpet (spawn FP was a black wedge of apron).
      this.useTex();
      this.setTexM(this.mIdent);
      this.setTexTint(0.24, 0.20, 0.16, 1);
      gl.depthMask(false);
      this.bindTex(this.gpuApron, this.texApron);
      gl.drawElements(gl.TRIANGLES, this.gpuApron.count, gl.UNSIGNED_SHORT, 0);
      this.stats.draws++;

      this.useGLB(def);
      this.uploadLights(def);
      gl.depthMask(true);
      for (const g of this.glbWorld.opaque) this.drawGLBD(g);
      this.glErr('mapOpaque');

      this.useLit();
      this.setLitM(this.mIdent);
      this.setLitTint(1, 1, 1);
      this.setLitLighting(def);
      gl.depthMask(false);
      this.bindLit(this.gpuBack);
      gl.drawElements(gl.TRIANGLES, this.gpuBack.count, gl.UNSIGNED_SHORT, 0);
      this.stats.draws++;
      gl.depthMask(true);
      this.bindLit(this.gpuSw);
      gl.drawElements(gl.TRIANGLES, this.gpuSw.count, gl.UNSIGNED_SHORT, 0);
      this.stats.draws++;
      this.setLitTint(this.lights ? 1.0 : 0.34, this.lights ? 0.86 : 0.34, this.lights ? 0.42 : 0.38);
      this.bindLit(this.gpuLever);
      gl.drawElements(gl.TRIANGLES, this.gpuLever.count, gl.UNSIGNED_SHORT, 0);
      this.stats.draws++;
      this.glErr('mapProps');
    } else {
      // Emergency fallback while the generated map is being built.
      this.useTex();
      this.setTexM(this.mIdent);
      this.setTexTint(0.24, 0.20, 0.16, 1);
      this.bindTex(this.gpuApron, this.texApron);
      gl.drawElements(gl.TRIANGLES, this.gpuApron.count, gl.UNSIGNED_SHORT, 0);
      this.stats.draws++;

      this.useLit();
      this.setLitM(this.mIdent);
      this.setLitTint(1, 1, 1);
      this.setLitLighting(def);
      this.bindLit(this.gpuBack);
      gl.drawElements(gl.TRIANGLES, this.gpuBack.count, gl.UNSIGNED_SHORT, 0);
      this.stats.draws++;
      this.bindLit(this.gpuSw);
      gl.drawElements(gl.TRIANGLES, this.gpuSw.count, gl.UNSIGNED_SHORT, 0);
      this.stats.draws++;

      this.setLitTint(this.lights ? 1.0 : 0.34, this.lights ? 0.86 : 0.34, this.lights ? 0.42 : 0.38);
      this.bindLit(this.gpuLever);
      gl.drawElements(gl.TRIANGLES, this.gpuLever.count, gl.UNSIGNED_SHORT, 0);
      this.stats.draws++;
      this.glErr('procWorld');
    }

    const procPlayers = [];
    if (this.glbReady && (this.glbPlayer || this.playerSkins.size)) {
      this.useGLB(def);
      for (const p of list) {
        if (this.fp && me && p.id === me.id) continue;
        const sid = normalizeSkin(p.skin);
        let mdl = this.playerSkins.get(sid);
        if (!mdl) {
          this.ensureSkin(sid);
          mdl = this.glbPlayer;
        }
        if (!mdl || !mdl.opaque.length) { procPlayers.push(p); continue; }
        const px = p.rx != null ? p.rx : p.x;
        const pz = p.ry != null ? p.ry : p.y;
        const seated = p.status === 'seated' || p.anim === 'sit';
        const walking = p.anim === 'walk' && !seated;
        const ry = Math.PI / 2 - (p.dir || 0);
        const phase = this.time * 11 + (p.id.charCodeAt(0) || 0);
        const bob = walking ? Math.abs(Math.sin(phase)) * 1.2 : 0;
        trs(this.mScratch, px, bob, pz, ry, 1, 1, 1);
        for (const g of mdl.opaque) {
          mul(this.mScratch2, this.mScratch, g.matrix);
          this.drawGLBD(g, this.mScratch2);
        }
      }
    } else {
      for (const p of list) {
        if (this.fp && me && p.id === me.id) continue;
        procPlayers.push(p);
      }
    }
    const M = this.meshPlayers;
    M.pos.length = 0; M.nrm.length = 0; M.col.length = 0; M.idx.length = 0;
    for (const p of procPlayers) this.pushPlayer(M, p);
    if (M.idx.length) {
      this.fillMesh(this.gpuPlayers, M, gl.DYNAMIC_DRAW);
      this.useLit();
      this.setLitM(this.mIdent);
      this.setLitTint(1, 1, 1);
      this.bindLit(this.gpuPlayers);
      gl.drawElements(gl.TRIANGLES, this.gpuPlayers.count, gl.UNSIGNED_SHORT, 0);
      this.stats.draws++;
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
    for (const o of OBJECTS) {
      // Tables only: the glow marks the felts (drawn by the model now).
      // The procedural bar isn't visible in GLB mode, so no stray pool.
      if (o.type !== 'table') continue;
      const cx = o.x + o.w / 2, cz = o.y + o.h / 2, rx = o.w * 0.85, rz = o.h * 0.85;
      pushT(GLM, [
        [cx - rx, 3, cz - rz], [cx + rx, 3, cz - rz], [cx + rx, 3, cz + rz], [cx - rx, 3, cz + rz]
      ], [[0, 0], [1, 0], [1, 1], [0, 1]]);
    }

    gl.enable(gl.BLEND);
    gl.depthMask(false);
    if (this.glbReady && this.glbWorld && this.glbWorld.blend.length) {
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      this.useGLB(def);
      for (const g of this.glbWorld.blend) this.drawGLBD(g);
      this.glErr('mapBlend');
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

    if (GLM.idx.length) {
      this.fillTexMesh(this.gpuGlows, GLM, gl.DYNAMIC_DRAW);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      if (this.lights) this.setTexTint(1.0, 0.84, 0.55, 0.62);
      else this.setTexTint(1.0, 0.76, 0.40, 0.55);
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
    if (P.u.uEmissive) {
      const e = mat && mat.emissive;
      gl.uniform3f(P.u.uEmissive, e ? e[0] : 0, e ? e[1] : 0, e ? e[2] : 0);
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, g.tex || this.texWhite);
    if (P.u.uHasNrm) {
      if (g.nrmTex) {
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, g.nrmTex);
        gl.activeTexture(gl.TEXTURE0);
        gl.uniform1f(P.u.uHasNrm, 1);
      } else {
        gl.uniform1f(P.u.uHasNrm, 0);
      }
    }
    this.bindAttrs(set => {
      set(P.a.aPos, g.pos, 3);
      set(P.a.aNrm, g.nrm, 3);
      set(P.a.aTan, g.tan, 3);
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

      // Same affordance ring over the light switch when it is in reach.
      const sw = OBJ_BY_ID.get('lights');
      if (sw && me.status !== 'seated') {
        const sx0 = sw.x + sw.w / 2, sz0 = sw.y + sw.h / 2;
        const sd = Math.hypot(sx0 - meX, sz0 - meZ);
        if (sd <= 58) {
          const c1 = this.sp(sx0, 40, sz0);
          const e1 = this.sp(sx0 + 17, 40, sz0);
          if (c1 && e1) {
            const r = Math.hypot(e1.x - c1.x, e1.y - c1.y);
            if (r >= 2 && r <= 300) {
              o.globalAlpha = 0.18 + (1 - sd / 58) * 0.4 + Math.sin(this.time * 3) * 0.05;
              o.strokeStyle = 'rgba(233,200,119,.9)';
              o.lineWidth = 1.5;
              o.beginPath();
              o.arc(c1.x, c1.y, r, 0, Math.PI * 2);
              o.stroke();
              o.globalAlpha = 1;
            }
          }
        }
      }
    }

    // Destination ping for click-to-move so walk orders read clearly.
    const pm = this.pathMark;
    if (pm && now - pm.at < 1600) {
      const age = (now - pm.at) / 1600;
      const c1 = this.sp(pm.x, 2, pm.y);
      const e1 = this.sp(pm.x + 12, 2, pm.y);
      if (c1 && e1) {
        const r = Math.hypot(e1.x - c1.x, e1.y - c1.y);
        if (r >= 2 && r <= 300) {
          o.globalAlpha = (1 - age) * 0.9;
          o.strokeStyle = '#e9c877';
          o.lineWidth = 2;
          o.beginPath();
          o.arc(c1.x, c1.y, r * (0.6 + age * 1.6), 0, Math.PI * 2);
          o.stroke();
          o.globalAlpha = 1;
        }
      }
    }

    for (const p of list) {
      const seated = p.status === 'seated' || p.anim === 'sit';
      const isMe = !!me && p.id === me.id;
      if (isMe && this.fp) continue;
      const topH = this.glbPlayer ? (seated ? 62 : 54) : (seated ? 72 : 64);
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
