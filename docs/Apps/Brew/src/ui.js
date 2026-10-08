const $ = s => document.querySelector(s);

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

  renderActivity(act, meId, handlers) {
    if (!act) { this.activityPanel.classList.add('hidden'); this.activityPanel.innerHTML = ''; return; }
    this.activityPanel.classList.remove('hidden');
    const mine = act.players.includes(meId);
    const picked = act.inputs && act.inputs[meId];
    const waiting = (act.players || []).filter(id => !act.inputs || !act.inputs[id]);
    const html = [];

    html.push('<div class="act-head"><span class="act-k">ACTIVITY</span><b>' + (act.kind || '').toUpperCase() + '</b><span class="act-table">' + act.table + '</span><span class="act-stake">STAKE ' + (act.stake || 0) + '</span></div>');

    if (act.phase === 'result') {
      html.push('<div class="act-result">' + (act.result === 'heads' ? 'HEADS' : 'TAILS') + '</div>');
      const deltas = act.balances || {};
      const parts = act.players.map(id => {
        const d = deltas[id] || 0;
        return (d > 0 ? '+' : '') + d;
      });
      html.push('<div class="act-sub">BALANCE DELTA ' + parts.join('  ·  ') + '</div>');
    } else if (!mine) {
      html.push('<div class="act-sub">Two players are dueling at this table.</div>');
    } else if (!picked) {
      html.push('<div class="act-sub">Pick a side. The host settles the round.</div>');
      html.push('<div class="act-choices"><button data-side="heads" class="chip red">HEADS</button><button data-side="tails" class="chip dark">TAILS</button></div>');
    } else {
      html.push('<div class="act-sub">You picked <b>' + picked.toUpperCase() + '</b>. Waiting for ' + waiting.length + ' player…</div>');
    }
    this.activityPanel.innerHTML = html.join('');
    this.activityPanel.querySelectorAll('[data-side]').forEach(b => {
      b.onclick = () => handlers.activityInput({ side: b.dataset.side });
    });
    this.activityPanel.querySelectorAll('[data-stake]').forEach(b => {
      b.onclick = () => handlers.stake && handlers.stake(Number(b.dataset.stake));
    });
  }
}
