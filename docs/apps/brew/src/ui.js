import { Registry } from './activities.js';
import { SKINS } from './skins.js';

const $ = s => document.querySelector(s);
const SUITS = ['♠', '♥', '♦', '♣'];
const cardStr = i => (i == null ? '?' : '23456789TJQKA'[i % 13] + SUITS[Math.floor(i / 13)]);

// Client-side suspense: the server resolves the round instantly, but a casino
// game that dumps the answer on arrival feels dead. Each kind rolls for a
// beat (cycling symbols/numbers) then lands on the real result.
const REVEAL_MS = { rps: 950, highlow: 1150, dice: 1500, coinflip: 1650, slots: 1950, roulette: 2300, poker: 1750 };
const GAME_ICON = {
  coinflip: '🪙', slots: '🎰', highlow: '🃏', dice: '🎲',
  rps: '✊', roulette: '🎡', poker: '🂡'
};
const SLOT_SYMS = ['7', 'BAR', 'BELL', 'CHERRY', 'LEMON', 'GRAPE', 'PLUM'];
const RPS_CYCLE = ['ROCK', 'PAPER', 'SCISSORS'];

function revealFrame(kind, result, elapsed, ms) {
  const t = Math.min(1, elapsed / ms);
  if (kind === 'slots') {
    const parts = String(result || '').split(' · ');
    const reels = [];
    for (let i = 0; i < 3; i++) {
      const land = 0.48 + i * 0.17;
      if (t >= land) reels.push(parts[i] || SLOT_SYMS[0]);
      else reels.push(SLOT_SYMS[(Math.floor(elapsed / (26 + i * 10)) + i * 2) % SLOT_SYMS.length]);
    }
    return reels.join(' · ');
  }
  if (kind === 'roulette') {
    if (t < 0.84) return String(Math.floor(elapsed / (16 + (1 - t * t) * 110)) % 37);
    return String(result || '');
  }
  if (kind === 'dice') {
    if (t >= 0.78) return String(result || '');
    return (1 + (Math.floor(elapsed / 65) % 6)) + ' · ' + (1 + (Math.floor(elapsed / 88) % 6));
  }
  if (kind === 'coinflip') {
    if (t >= 0.82) return String(result || '').toUpperCase();
    return (Math.floor(elapsed / 85) % 2) ? 'HEADS' : 'TAILS';
  }
  if (kind === 'highlow') {
    if (t >= 0.72) return String(result || '');
    return 'A → ' + (2 + (Math.floor(elapsed / 78) % 13));
  }
  if (kind === 'rps') {
    if (t >= 0.76) return String(result || '').toUpperCase();
    return RPS_CYCLE[Math.floor(elapsed / 95) % 3];
  }
  if (kind === 'poker') {
    if (t >= 0.68) return String(result || '').toUpperCase();
    const dots = '·····';
    return dots.slice(0, 1 + Math.floor(t * 5)) + '·····'.slice(1 + Math.floor(t * 5));
  }
  return t < 0.7 ? '·····' : String(result || '');
}

export class UI {
  constructor() {
    this.h = {};
    this.entry = $('#entry');
    this.hud = $('#hud');
    this.chatLog = $('#chatLog');
    this.chatInput = $('#chatInput');
    this.prompt = $('#prompt');
    this.rosterEl = $('#roster');
    this.activityPanel = $('#activityPanel');
    this.toastEl = $('#toast');
    this.soundOn = true;
    this.lastToast = 0;
  }

  bind(handlers) {
    this.h = handlers;
    $('#enterBtn').onclick = () => handlers.enter(this.readEntry());
    ['#nameInput', '#codeInput'].forEach(sel => {
      $(sel).addEventListener('keydown', e => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); handlers.enter(this.readEntry()); }
      });
    });
    $('#chatSend').onclick = () => this.sendChat();
    const chatCollapse = $('#chatCollapse');
    if (chatCollapse) chatCollapse.onclick = () => {
      const box = this.chatLog.closest('.chatbox');
      const collapsed = box.classList.toggle('collapsed');
      chatCollapse.textContent = collapsed ? '▴' : '▾';
      chatCollapse.title = collapsed ? 'Expand chat' : 'Collapse chat';
    };
    this.chatInput.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); this.sendChat(); }
      if (e.key === 'Escape') { e.preventDefault(); this.chatInput.blur(); }
    });
    $('#sndBtn').onclick = () => handlers.sound(!this.soundOn);
    $('#leaveBtn').onclick = () => handlers.leave();
    $('#shareBtn').onclick = () => handlers.share();
    this.buildSkinPick($('#skinPick'), id => handlers.skin(id));
    this.buildSkinPick($('#skinPickGame'), id => handlers.skin(id));
    const skinBtn = $('#skinBtn');
    if (skinBtn) skinBtn.onclick = () => this.skinPanel(!this._skinOpen);
    document.querySelectorAll('#emotes [data-emote]').forEach(b => {
      b.onclick = () => handlers.emote(b.dataset.emote);
    });
    document.querySelectorAll('#stakeBar [data-stake]').forEach(b => {
      b.onclick = () => handlers.stake && handlers.stake(Number(b.dataset.stake));
    });
    return this;
  }

  stake(v) {
    document.querySelectorAll('#stakeBar [data-stake]').forEach(b => {
      b.classList.toggle('on', Number(b.dataset.stake) === v);
    });
    const label = $('#stakeVal');
    if (label) label.textContent = v;
  }

  buildSkinPick(el, cb) {
    if (!el) return;
    el.innerHTML = SKINS.map(s =>
      '<button type="button" data-skin="' + s.id + '">' + s.name + '</button>').join('');
    el.querySelectorAll('[data-skin]').forEach(b => {
      b.onclick = () => cb(b.dataset.skin);
    });
  }

  skin(id) {
    document.querySelectorAll('[data-skin]').forEach(b => {
      b.classList.toggle('on', b.dataset.skin === id);
    });
  }

  skinPanel(show) {
    this._skinOpen = !!show;
    const el = $('#skinPanel');
    if (el) el.classList.toggle('hidden', !show);
  }

  stakeBar(show) {
    const el = $('#stakeBar');
    if (el) el.classList.toggle('hidden', !show);
  }

  readEntry() {
    return {
      name: $('#nameInput').value.trim(),
      code: $('#codeInput').value.trim().toUpperCase()
    };
  }

  showEntry(status) {
    this.entry.classList.remove('hidden');
    this.hud.classList.add('hidden');
    if (status) this.entryStatus(status);
  }
  entryStatus(t) { $('#entryStatus').textContent = t; }
  hideEntry() {
    this.entry.classList.add('hidden');
    this.hud.classList.remove('hidden');
  }
  setPid(pid) { $('#myPid').textContent = pid; }
  setName(n) { $('#nameInput').value = n; }
  setCode(c) { $('#codeInput').value = c; }

  setSound(on) {
    this.soundOn = on;
    $('#sndBtn').textContent = on ? 'SOUND ON' : 'SOUND OFF';
  }

  world(code, count, max) {
    $('#worldCode').textContent = '#' + code;
    $('#playerCount').textContent = count;
    $('#worldMax').textContent = max;
  }

  setPrompt(text) {
    if (!text) { this.prompt.classList.add('hidden'); return; }
    this.prompt.classList.remove('hidden');
    this.prompt.innerHTML = '';
    text.split('·').forEach((raw, i) => {
      const part = raw.trim();
      if (!part) return;
      if (i) {
        const sep = document.createElement('span');
        sep.className = 'sep';
        sep.textContent = '·';
        this.prompt.appendChild(sep);
      }
      const m = part.match(/^([EFQ1-5])\s+(.+)$/);
      if (m) {
        const b = document.createElement('span');
        b.className = 'key';
        b.textContent = m[1];
        this.prompt.appendChild(b);
        const s = document.createElement('span');
        s.textContent = m[2];
        this.prompt.appendChild(s);
      } else {
        const s = document.createElement('span');
        s.textContent = part;
        this.prompt.appendChild(s);
      }
    });
  }

  system(text) { this.line('system', text); }

  line(kind, text, who) {
    const row = document.createElement('div');
    row.className = 'line ' + kind;
    if (who) {
      const w = document.createElement('strong');
      w.textContent = who + ' ';
      row.appendChild(w);
    }
    row.appendChild(document.createTextNode(text));
    this.chatLog.appendChild(row);
    while (this.chatLog.children.length > 40) this.chatLog.removeChild(this.chatLog.firstChild);
    if (kind === 'other') {
      const box = this.chatLog.closest('.chatbox');
      if (box && box.classList.contains('collapsed')) {
        box.classList.remove('collapsed');
        const btn = $('#chatCollapse');
        if (btn) { btn.textContent = '▾'; btn.title = 'Collapse chat'; }
      }
    }
    this.chatLog.scrollTop = this.chatLog.scrollHeight;
  }

  sendChat() {
    const v = this.chatInput.value;
    this.chatInput.value = '';
    this.chatInput.blur();
    if (v.trim() && this.h.say) this.h.say(v);
  }

  focusChat() { this.chatInput.focus(); }

  roster(players, meId) {
    const frag = document.createDocumentFragment();
    const sorted = [...players].sort((a, b) => (a.id === meId ? -1 : b.id === meId ? 1 : a.name.localeCompare(b.name)));
    for (const p of sorted) {
      const row = document.createElement('div');
      row.className = 'who' + (p.id === meId ? ' me' : '');
      const dot = document.createElement('span');
      dot.className = 'dot ' + (p.status === 'standing' ? 'ok' : p.status === 'seated' ? 'sit' : 'play');
      const nm = document.createElement('span');
      nm.className = 'nm';
      nm.textContent = p.name;
      const st = document.createElement('span');
      st.className = 'st';
      st.textContent = p.id === meId ? 'YOU' : (p.status === 'activity' ? 'PLAYING' : p.status === 'seated' ? 'SEATED' : 'STANDING');
      row.append(dot, nm, st);
      frag.appendChild(row);
    }
    this.rosterEl.innerHTML = '';
    this.rosterEl.appendChild(frag);
  }

  toast(text) {
    this.toastEl.textContent = text;
    this.toastEl.classList.remove('hidden');
    requestAnimationFrame(() => this.toastEl.classList.add('show'));
    clearTimeout(this._toastT);
    clearTimeout(this._toastT2);
    this._toastT = setTimeout(() => {
      this.toastEl.classList.remove('show');
      this._toastT2 = setTimeout(() => this.toastEl.classList.add('hidden'), 300);
    }, 2600);
  }

  // --- casino reveal: roll, then land on the server result -----------------
  ensureReveal(act, mine) {
    const ms = REVEAL_MS[act.kind];
    if (!ms || !mine || this._reveal && this._reveal.actId === act.id) return this._reveal;
    this.clearReveal();
    const rev = { actId: act.id, t0: performance.now(), ms, landed: false };
    this._reveal = rev;
    rev.timer = setTimeout(() => {
      if (this._reveal !== rev) return;
      rev.landed = true;
      rev.raf = 0;
      const last = this._lastAct;
      if (last && last.act && last.act.id === rev.actId) {
        this.renderActivity(last.act, last.meId, last.handlers);
      }
      if (last && last.handlers && last.handlers.revealed) last.handlers.revealed(last.act);
    }, ms);
    return rev;
  }

  clearReveal() {
    if (!this._reveal) return;
    clearTimeout(this._reveal.timer);
    if (this._reveal.raf) cancelAnimationFrame(this._reveal.raf);
    this._reveal = null;
  }

  tickReveal(act, rev) {
    if (!rev || rev.landed) return;
    const el = this.activityPanel.querySelector('.act-reveal');
    if (!el) return;
    el.textContent = revealFrame(act.kind, act.result, performance.now() - rev.t0, rev.ms);
    rev.raf = requestAnimationFrame(() => this.tickReveal(act, rev));
  }

  burstConfetti() {
    const panel = this.activityPanel;
    if (!panel || !panel.classList.contains('hidden')) {
      // panel visible check: still fine to overlay even if positioned
    }
    const rect = panel.getBoundingClientRect();
    if (rect.width < 40) return;
    const cv = document.createElement('canvas');
    cv.className = 'act-confetti';
    cv.width = Math.floor(rect.width);
    cv.height = Math.floor(rect.height);
    Object.assign(cv.style, { left: '0', top: '0' });
    panel.appendChild(cv);
    const g = cv.getContext('2d');
    const colors = ['#e9c877', '#5fd68a', '#c2373f', '#dff0ff', '#d98a1f', '#3ec6c6'];
    const parts = [];
    for (let i = 0; i < 80; i++) {
      parts.push({
        x: cv.width / 2 + (Math.random() - 0.5) * 60,
        y: cv.height * 0.32,
        vx: (Math.random() - 0.5) * 8,
        vy: -Math.random() * 8 - 2,
        w: 4 + Math.random() * 6,
        h: 3 + Math.random() * 5,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.35,
        c: colors[i % colors.length]
      });
    }
    const t0 = performance.now();
    const step = now => {
      const e = now - t0;
      g.clearRect(0, 0, cv.width, cv.height);
      for (const p of parts) {
        p.x += p.vx; p.y += p.vy; p.vy += 0.28; p.rot += p.vr;
        g.save(); g.translate(p.x, p.y); g.rotate(p.rot);
        g.fillStyle = p.c; g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        g.restore();
      }
      if (e < 2400) requestAnimationFrame(step);
      else cv.remove();
    };
    requestAnimationFrame(step);
  }

  renderPicker(list, cb) {
    this.activityPanel.classList.remove('hidden');
    const html = ['<div class="act-head"><span class="act-k">TABLE</span><b>CHOOSE A GAME</b></div>'];
    html.push('<div class="act-choices wrap">' +
      list.map(o => '<button data-game="' + o.kind + '" class="chip dark">' + o.label + '</button>').join('') + '</div>');
    html.push('<div class="act-sub">The stake you picked applies to every game.</div>');
    this.activityPanel.innerHTML = html.join('');
    this.activityPanel.querySelectorAll('[data-game]').forEach(b => {
      b.onclick = () => cb(b.dataset.game);
    });
  }

  renderActivity(act, meId, handlers) {
    this._lastAct = act ? { act, meId, handlers } : null;
    if (!act) { this.clearReveal(); this.activityPanel.classList.add('hidden'); this.activityPanel.innerHTML = ''; return; }
    this.activityPanel.classList.remove('hidden');
    const def = Registry[act.kind] || {};
    const mine = act.players.includes(meId);
    const picked = act.inputs && act.inputs[meId];
    const waiting = (act.players || []).filter(id => !act.inputs || !act.inputs[id]);
    const icon = GAME_ICON[act.kind] || '🎲';
    const html = [];

    html.push('<div class="act-head"><span class="act-k">ACTIVITY</span><b>' + icon + ' ' + (act.kind || '').toUpperCase() + '</b><span class="act-table">' + act.table + '</span><span class="act-stake">STAKE ' + (act.stake || 0) + '</span></div>');

    if (act.phase === 'result') {
      const rev = this.ensureReveal(act, mine);
      if (rev && !rev.landed) {
        html.push('<div class="act-reveal">·····</div>');
        html.push('<div class="act-sub">' + (mine ? 'The ' + (def.label || act.kind || '').toUpperCase() + ' is settling…' : 'The table is settling…') + '</div>');
        this.activityPanel.innerHTML = html.join('');
        this.tickReveal(act, rev);
        return;
      }
      // Landed: colour the result by my outcome.
      const myD = meId ? Number((act.balances || {})[meId] || 0) : 0;
      const outcome = myD > 0 ? 'win' : (myD < 0 ? 'lose' : 'push');
      const label = def.resultLabel ? def.resultLabel(act) : String(act.result || '').toUpperCase();
      html.push('<div class="act-result ' + outcome + '">' + label + '</div>');
      if (outcome === 'win') html.push('<div class="act-outcome win">YOU WIN ' + (myD > 0 ? '+' + myD : '') + '</div>');
      else if (outcome === 'lose') html.push('<div class="act-outcome lose">YOU LOST ' + myD + '</div>');
      else html.push('<div class="act-outcome push">PUSH</div>');
      if (def.subLabel) {
        const sub = def.subLabel(act);
        if (sub) html.push('<div class="act-sub">' + sub + '</div>');
      }
      if (act.kind === 'poker' && act.data && act.data.hands) {
        const board = (act.data.board || []).map(cardStr).join(' ');
        const rows = act.players.map(id => '<div class="act-cards">' +
          (id === meId ? 'YOU' : 'RIVAL') + ' &nbsp;' +
          (act.data.hands[id] || []).map(cardStr).join(' ') + '</div>');
        html.push('<div class="act-cards board">BOARD &nbsp;' + board + '</div>' + rows.join(''));
      }
      const deltas = act.balances || {};
      const names = handlers.players;
      const parts = act.players.map(id => {
        const d = deltas[id] || 0;
        const nm = id === meId ? 'YOU' : (names && names.get && names.get(id) ? names.get(id).name : 'RIVAL');
        const cls = d > 0 ? 'pos' : (d < 0 ? 'neg' : 'zero');
        return '<span class="' + cls + '">' + nm + ' ' + (d > 0 ? '+' : '') + d + '</span>';
      });
      html.push('<div class="act-deltas act-sub">' + parts.join(' &nbsp;·&nbsp; ') + '</div>');
      this.activityPanel.innerHTML = html.join('');
      if (outcome === 'win' && mine) this.burstConfetti();
      return;
    } else if (!mine) {
      html.push('<div class="act-sub">The table is playing ' + (def.label || act.kind || '').toUpperCase() + '.</div>');
    } else {
      if (act.kind === 'poker') {
        const hand = (handlers.hand || []).map(cardStr).join(' ');
        html.push('<div class="act-cards">YOUR HAND &nbsp;' + (hand || '·····') + '</div>');
        html.push('<div class="act-sub">BOARD WAITING ON THE CALL</div>');
      }
      if (def.pickInfo) html.push('<div class="act-sub">' + def.pickInfo(act) + '</div>');
      if (!picked) {
        const choices = def.choices || [{ v: 'heads', label: 'HEADS', cls: 'red' }, { v: 'tails', label: 'TAILS', cls: 'dark' }];
        html.push('<div class="act-choices' + (choices.length > 2 ? ' wrap' : '') + '">' +
          choices.map(c => '<button data-pick="' + c.v + '" class="chip ' + (c.cls || '') + '">' + c.label + '</button>').join('') +
          '</div>');
      } else {
        const waitingLabel = waiting.length === 1 ? 'player' : 'players';
        html.push('<div class="act-wait">You picked <b>' + String(picked).toUpperCase() + '</b><span class="dots"><i>.</i><i>.</i><i>.</i></span> waiting on ' + waiting.length + ' ' + waitingLabel + '</div>');
      }
    }
    this.activityPanel.innerHTML = html.join('');
    this.activityPanel.querySelectorAll('[data-pick]').forEach(b => {
      b.onclick = () => handlers.activityInput({ pick: b.dataset.pick });
    });
    this.activityPanel.querySelectorAll('[data-stake]').forEach(b => {
      b.onclick = () => handlers.stake && handlers.stake(Number(b.dataset.stake));
    });
  }
}
