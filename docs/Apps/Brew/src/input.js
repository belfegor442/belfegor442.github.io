export class Input {
  constructor() {
    this.keys = new Set();
    this.handlers = {};
    this.locked = false;
    this.enabled = false;
    window.addEventListener('keydown', e => this.down(e));
    window.addEventListener('keyup', e => this.up(e));
    window.addEventListener('blur', () => this.keys.clear());
    this.touchAxis = { x: 0, y: 0, active: false };
    this.bindTouch();
  }

  bindTouch() {
    const root = document.getElementById('joystick');
    const knob = root && root.querySelector('span');
    if (!root || !knob) return;
    const radius = 42;
    const update = e => {
      const r = root.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      const d = Math.hypot(dx, dy) || 1;
      const k = Math.min(1, radius / d);
      const x = dx * k, y = dy * k;
      knob.style.transform = 'translate(' + x + 'px,' + y + 'px)';
      this.touchAxis.x = x / radius;
      this.touchAxis.y = y / radius;
      this.touchAxis.active = true;
    };
    const stop = e => {
      try { root.releasePointerCapture(e.pointerId); } catch (_) {}
      knob.style.transform = '';
      this.touchAxis.x = this.touchAxis.y = 0;
      this.touchAxis.active = false;
    };
    root.addEventListener('pointerdown', e => { root.setPointerCapture(e.pointerId); update(e); });
    root.addEventListener('pointermove', e => { if (this.touchAxis.active) update(e); });
    root.addEventListener('pointerup', stop);
    root.addEventListener('pointercancel', stop);
    document.getElementById('touchInteract')?.addEventListener('click', () => this.emit('interact'));
    document.getElementById('touchGame')?.addEventListener('click', () => this.emit('activity'));
  }

  on(type, fn) { this.handlers[type] = fn; return this; }
  emit(type, payload) { if (this.handlers[type]) this.handlers[type](payload); }

  typing() {
    const el = document.activeElement;
    return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
  }

  down(e) {
    if (e.key === 'Enter' && !this.typing()) { e.preventDefault(); this.emit('chat'); return; }
    if (e.key === 'Escape') {
      const el = document.activeElement;
      if (el && el.blur) el.blur();
      this.emit('escape');
      return;
    }
    if (this.typing() || !this.enabled) return;
    const c = e.code;
    if (c === 'KeyE' || c === 'KeyQ') { e.preventDefault(); this.emit('interact'); return; }
    if (c === 'KeyF') { e.preventDefault(); this.emit('activity'); return; }
    if (c === 'KeyC') { e.preventDefault(); this.emit('camtoggle'); return; }
    if (/^Digit[1-5]$/.test(c)) { this.emit('emote', ['wave', 'laugh', 'clap', 'dance', 'think'][+c.slice(5) - 1]); return; }
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(c)) e.preventDefault();
    this.keys.add(c);
  }

  up(e) { this.keys.delete(e.code); }

  axis(noArrows) {
    let x = 0, y = 0;
    const k = this.keys;
    if (!noArrows) {
      if (k.has('ArrowUp')) y -= 1;
      if (k.has('ArrowDown')) y += 1;
      if (k.has('ArrowLeft')) x -= 1;
      if (k.has('ArrowRight')) x += 1;
    }
    if (k.has('KeyW')) y -= 1;
    if (k.has('KeyS')) y += 1;
    if (k.has('KeyA')) x -= 1;
    if (k.has('KeyD')) x += 1;
    x = Math.max(-1, Math.min(1, x));
    y = Math.max(-1, Math.min(1, y));
    if (x && y) { const inv = Math.SQRT1_2; x *= inv; y *= inv; }
    if (this.touchAxis.active) { x = this.touchAxis.x; y = this.touchAxis.y; }
    return { x, y, sprint: k.has('ShiftLeft') || k.has('ShiftRight') };
  }

  arrows() {
    let x = 0, y = 0;
    const k = this.keys;
    if (k.has('ArrowUp')) y -= 1;
    if (k.has('ArrowDown')) y += 1;
    if (k.has('ArrowLeft')) x -= 1;
    if (k.has('ArrowRight')) x += 1;
    if (x && y) { const inv = Math.SQRT1_2; x *= inv; y *= inv; }
    return { x, y };
  }
}
