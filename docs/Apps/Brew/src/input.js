export class Input {
  constructor() {
    this.keys = new Set();
    this.handlers = {};
    this.locked = false;
    this.enabled = false;
    window.addEventListener('keydown', e => this.down(e));
    window.addEventListener('keyup', e => this.up(e));
    window.addEventListener('blur', () => this.keys.clear());
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
    if (/^Digit[1-5]$/.test(c)) { this.emit('emote', ['wave', 'laugh', 'clap', 'dance', 'think'][+c.slice(5) - 1]); return; }
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(c)) e.preventDefault();
    this.keys.add(c);
  }

  up(e) { this.keys.delete(e.code); }

  axis() {
    let x = 0, y = 0;
    const k = this.keys;
    if (k.has('KeyW') || k.has('ArrowUp')) y -= 1;
    if (k.has('KeyS') || k.has('ArrowDown')) y += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) x += 1;
    if (x && y) { const inv = Math.SQRT1_2; x *= inv; y *= inv; }
    return { x, y, sprint: k.has('ShiftLeft') || k.has('ShiftRight') };
  }
}
