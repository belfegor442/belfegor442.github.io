const RECIPES = {
  click: [{ f: 660, t: 0.05, type: 'square', g: 0.05 }],
  join: [
    { f: 440, t: 0.08, type: 'sine', g: 0.06 },
    { f: 660, t: 0.1, type: 'sine', g: 0.06, delay: 0.08 },
  ],
  leave: [
    { f: 520, t: 0.08, type: 'sine', g: 0.05 },
    { f: 320, t: 0.12, type: 'sine', g: 0.05, delay: 0.07 },
  ],
  spin: [{ f: 180, t: 0.22, type: 'sawtooth', g: 0.05, sweep: 420 }],
  stopPerfect: [
    { f: 880, t: 0.09, type: 'triangle', g: 0.08 },
    { f: 1320, t: 0.16, type: 'triangle', g: 0.07, delay: 0.09 },
  ],
  stopGood: [
    { f: 660, t: 0.09, type: 'triangle', g: 0.07 },
    { f: 880, t: 0.12, type: 'triangle', g: 0.06, delay: 0.08 },
  ],
  stopOk: [{ f: 520, t: 0.1, type: 'triangle', g: 0.06 }],
  stopMiss: [{ f: 180, t: 0.18, type: 'square', g: 0.06, sweep: 90 }],
  overbrew: [
    { f: 240, t: 0.3, type: 'sawtooth', g: 0.07, sweep: 720 },
    { f: 960, t: 0.2, type: 'triangle', g: 0.05, delay: 0.3 },
  ],
  fail: [{ f: 320, t: 0.4, type: 'sawtooth', g: 0.07, sweep: 70 }],
  sabotage: [{ f: 420, t: 0.2, type: 'square', g: 0.06, sweep: 160 }],
  chat: [{ f: 740, t: 0.06, type: 'sine', g: 0.05 }],
  error: [{ f: 220, t: 0.16, type: 'square', g: 0.05, sweep: 150 }],
  ready: [
    { f: 520, t: 0.07, type: 'triangle', g: 0.06 },
    { f: 780, t: 0.1, type: 'triangle', g: 0.06, delay: 0.07 },
  ],
  request: [{ f: 600, t: 0.1, type: 'sine', g: 0.06 }, { f: 900, t: 0.1, type: 'sine', g: 0.05, delay: 0.1 }],
  reconnect: [
    { f: 392, t: 0.1, type: 'sine', g: 0.06 },
    { f: 523, t: 0.1, type: 'sine', g: 0.06, delay: 0.1 },
    { f: 659, t: 0.16, type: 'sine', g: 0.06, delay: 0.2 },
  ],
  challenge: [
    { f: 349, t: 0.12, type: 'square', g: 0.05 },
    { f: 466, t: 0.12, type: 'square', g: 0.05, delay: 0.12 },
    { f: 587, t: 0.2, type: 'square', g: 0.05, delay: 0.24 },
  ],
};

export class GameAudio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.volume = 0.7;
    this.master = null;
  }

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    try {
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;
      this.master.connect(this.ctx.destination);
    } catch {
      this.ctx = null;
      this.master = null;
    }
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : this.volume;
  }

  setVolume(volume) {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.master && !this.muted) this.master.gain.value = this.volume;
  }

  play(name) {
    if (this.muted || !this.ctx || !this.master) return;
    const recipe = RECIPES[name];
    if (!recipe) return;
    const now = this.ctx.currentTime;
    for (const note of recipe) {
      const start = now + (note.delay || 0);
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = note.type || 'sine';
      osc.frequency.setValueAtTime(note.f, start);
      if (note.sweep) osc.frequency.exponentialRampToValueAtTime(Math.max(30, note.sweep), start + note.t);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(note.g, start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + note.t);
      osc.connect(gain);
      gain.connect(this.master);
      osc.start(start);
      osc.stop(start + note.t + 0.03);
    }
  }
}
