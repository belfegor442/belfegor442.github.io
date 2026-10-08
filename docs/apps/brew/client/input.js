const KEY_MAP = {
  KeyW: 'up',
  ArrowUp: 'up',
  KeyS: 'down',
  ArrowDown: 'down',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
};

export class Input {
  constructor({ canvas, getCamera, handlers = {}, isCaptured = () => false }) {
    this.canvas = canvas;
    this.getCamera = getCamera;
    this.handlers = handlers;
    this.isCaptured = isCaptured;
    this.keys = new Set();
    this.intent = { dx: 0, dz: 0 };
    this.lastSent = { dx: 0, dz: 0, at: 0 };
    this.pointer = { x: 0, y: 0, worldX: 0, worldZ: 0, down: false };
    this.enabled = true;
    this._bind();
  }

  on(name, handler) {
    this.handlers[name] = handler;
  }

  emit(name, payload) {
    const handler = this.handlers[name];
    if (handler) handler(payload);
  }

  _bind() {
    window.addEventListener('keydown', (ev) => {
      if (this.isCaptured() || !this.enabled) return;
      if (ev.target && ['INPUT', 'TEXTAREA'].includes(ev.target.tagName)) return;
      if (KEY_MAP[ev.code]) {
        this.keys.add(KEY_MAP[ev.code]);
        ev.preventDefault();
        return;
      }
      switch (ev.code) {
        case 'Space':
          ev.preventDefault();
          this.emit('primary', {});
          break;
        case 'Escape':
          this.emit('escape', {});
          break;
        case 'Enter':
          this.emit('enter', {});
          break;
        case 'Digit1':
          this.emit('hold', { reel: 0 });
          break;
        case 'Digit2':
          this.emit('hold', { reel: 1 });
          break;
        case 'Digit3':
          this.emit('hold', { reel: 2 });
          break;
        case 'KeyF':
          this.emit('overbrew', {});
          break;
        case 'KeyC':
          this.emit('challenge', {});
          break;
        case 'KeyV':
          this.emit('spectate', {});
          break;
        case 'KeyT':
          this.emit('teach', {});
          break;
        case 'KeyP':
          this.emit('practice', {});
          break;
        case 'KeyH':
          this.emit('takeover', {});
          break;
        case 'Tab':
          ev.preventDefault();
          this.emit('roster', {});
          break;
        case 'KeyM':
          this.emit('mute', {});
          break;
        default:
          break;
      }
    });
    window.addEventListener('keyup', (ev) => {
      if (KEY_MAP[ev.code]) this.keys.delete(KEY_MAP[ev.code]);
    });
    window.addEventListener('blur', () => this.keys.clear());

    this.canvas.addEventListener('pointermove', (ev) => {
      const rect = this.canvas.getBoundingClientRect();
      this.pointer.x = ((ev.clientX - rect.left) / rect.width) * this.canvas.width;
      this.pointer.y = ((ev.clientY - rect.top) / rect.height) * this.canvas.height;
      this._updatePointerWorld();
    });
    this.canvas.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0) return;
      this.pointer.down = true;
      this._updatePointerWorld();
      this.emit('click', { ...this.pointer, shift: ev.shiftKey });
    });
    window.addEventListener('pointerup', () => {
      this.pointer.down = false;
    });
  }

  _updatePointerWorld() {
    const camera = this.getCamera ? this.getCamera() : null;
    if (!camera) return;
    const world = camera.screenToWorld(this.pointer.x, this.pointer.y);
    this.pointer.worldX = world.x;
    this.pointer.worldZ = world.z;
  }

  update() {
    let dx = 0;
    let dz = 0;
    if (this.keys.has('left')) dx -= 1;
    if (this.keys.has('right')) dx += 1;
    if (this.keys.has('up')) dz -= 1;
    if (this.keys.has('down')) dz += 1;
    const mag = Math.hypot(dx, dz);
    if (mag > 0) {
      dx /= mag;
      dz /= mag;
    }
    this.intent.dx = dx;
    this.intent.dz = dz;
    return this.intent;
  }

  shouldSendIntent(now = Date.now()) {
    const changed =
      Math.abs(this.intent.dx - this.lastSent.dx) > 0.01 ||
      Math.abs(this.intent.dz - this.lastSent.dz) > 0.01;
    if (!changed) return false;
    if (now - this.lastSent.at < 45) return false;
    this.lastSent = { dx: this.intent.dx, dz: this.intent.dz, at: now };
    return true;
  }

  reset() {
    this.keys.clear();
    this.intent.dx = 0;
    this.intent.dz = 0;
    this.lastSent = { dx: 0, dz: 0, at: 0 };
  }
}
