import { Registry } from './activities.js';

const $ = s => document.querySelector(s);
const SUITS = ['♠', '♥', '♦', '♣'];
const cardStr = i => (i == null ? '?' : '23456789TJQKA'[i % 13] + SUITS[Math.floor(i / 13)]);

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
    this.chatInput.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); this.sendChat(); }
      if (e.key === 'Escape') { e.preventDefault(); this.chatInput.blur(); }
    });
    $('#sndBtn').onclick = () => handlers.sound(!this.soundOn);
    $('#leaveBtn').onclick = () => handlers.leave();
    $('#shareBtn').onclick = () => handlers.share();
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
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => this.toastEl.classList.add('hidden'), 2600);
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
    if (!act) { this.activityPanel.classList.add('hidden'); this.activityPanel.innerHTML = ''; return; }
    this.activityPanel.classList.remove('hidden');
    const def = Registry[act.kind] || {};
    const mine = act.players.includes(meId);
    const picked = act.inputs && act.inputs[meId];
    const waiting = (act.players || []).filter(id => !act.inputs || !act.inputs[id]);
    const html = [];

    html.push('<div class="act-head"><span class="act-k">ACTIVITY</span><b>' + (act.kind || '').toUpperCase() + '</b><span class="act-table">' + act.table + '</span><span class="act-stake">STAKE ' + (act.stake || 0) + '</span></div>');

    if (act.phase === 'result') {
      const label = def.resultLabel ? def.resultLabel(act) : String(act.result || '').toUpperCase();
      html.push('<div class="act-result">' + label + '</div>');
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
      const parts = act.players.map(id => {
        const d = deltas[id] || 0;
        return (d > 0 ? '+' : '') + d;
      });
      html.push('<div class="act-sub">BALANCE DELTA ' + parts.join('  ·  ') + '</div>');
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
        html.push('<div class="act-sub">You picked <b>' + String(picked).toUpperCase() + '</b>. Waiting for ' + waiting.length + ' ' + waitingLabel + '…</div>');
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
