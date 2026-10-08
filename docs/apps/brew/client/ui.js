import { EMOTES, SABOTAGE } from '../shared/constants.js';

const SABOTAGE_LABELS = {
  THROW_BEER: 'Beer',
  PEANUT: 'Peanut',
  BELL: 'Bell',
  SMOKE: 'Smoke',
  COIN: 'Coin',
  COOLER: 'Cooler',
  CLEAN: 'Clean',
};

export class UI {
  constructor({ handlers = {} }) {
    this.handlers = handlers;
    this.el = {};
    this.selectedTarget = null;
    this.rosterOpen = false;
    this.helpOpen = false;
    this.pending = [];
    this.selfId = null;
    this._cache();
    this._wire();
    this._buildBars();
  }

  _cache() {
    const ids = [
      'game-canvas',
      'screen-auth',
      'screen-lobby',
      'auth-name',
      'auth-play',
      'auth-error',
      'lobby-profile',
      'btn-signout',
      'tab-rooms',
      'tab-create',
      'tab-join',
      'pane-rooms',
      'pane-create',
      'pane-join',
      'room-list',
      'room-count',
      'btn-refresh',
      'btn-quick',
      'room-size',
      'room-name',
      'btn-create',
      'join-code',
      'btn-join',
      'lobby-error',
      'hud',
      'room-code',
      'room-phase',
      'room-event',
      'net-status',
      'net-detail',
      'net-ping',
      'btn-roster',
      'btn-help',
      'roster',
      'toasts',
      'pending-panel',
      'pending-body',
      'btn-accept',
      'btn-decline',
      'target-panel',
      'target-name',
      'target-actions',
      'machine-panel',
      'm-score',
      'm-combo',
      'm-heat',
      'm-mischief',
      'm-heat-bar',
      'm-status',
      'm-hint',
      'lobby-bar',
      'btn-ready',
      'btn-start',
      'btn-leave',
      'chat-log',
      'chat-input',
      'btn-chat-send',
      'emote-bar',
      'sabotage-bar',
      'connection-banner',
      'help',
      'btn-help-close',
    ];
    for (const id of ids) this.el[id] = document.getElementById(id);
  }

  _on(id, event, handler) {
    const node = this.el[id];
    if (node) node.addEventListener(event, handler);
  }

  _wire() {
    this._on('auth-play', 'click', () => this.emit('auth', (this.el['auth-name'].value || '').trim()));
    this._on('auth-name', 'keydown', (ev) => {
      if (ev.key === 'Enter') this.emit('auth', (this.el['auth-name'].value || '').trim());
    });
    this._on('btn-signout', 'click', () => this.emit('signOut'));
    this._on('btn-refresh', 'click', () => this.emit('refreshRooms'));
    this._on('btn-quick', 'click', () => this.emit('quickPlay'));
    this._on('btn-create', 'click', () =>
      this.emit('createRoom', {
        maxPlayers: Number(this.el['room-size'].value) || 4,
        name: (this.el['room-name'].value || '').trim(),
      }),
    );
    this._on('btn-join', 'click', () => this.emit('joinRoom', (this.el['join-code'].value || '').trim().toUpperCase()));
    this._on('tab-rooms', 'click', () => this._tab('rooms'));
    this._on('tab-create', 'click', () => this._tab('create'));
    this._on('tab-join', 'click', () => this._tab('join'));
    this._on('btn-roster', 'click', () => this.toggleRoster());
    this._on('btn-help', 'click', () => this.toggleHelp());
    this._on('btn-help-close', 'click', () => this.toggleHelp(false));
    this._on('btn-ready', 'click', () => this.emit('readyToggle'));
    this._on('btn-start', 'click', () => this.emit('startMatch'));
    this._on('btn-leave', 'click', () => this.emit('leaveRoom'));
    this._on('btn-chat-send', 'click', () => this._sendChat());
    this._on('chat-input', 'keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        this._sendChat();
      } else if (ev.key === 'Escape') {
        this.el['chat-input'].blur();
      }
      ev.stopPropagation();
    });
    this._on('btn-accept', 'click', () => this.respondPending(true));
    this._on('btn-decline', 'click', () => this.respondPending(false));
  }

  _buildBars() {
    const emoteBar = this.el['emote-bar'];
    emoteBar.innerHTML = '';
    for (const emote of EMOTES) {
      const btn = document.createElement('button');
      btn.className = 'chip';
      btn.type = 'button';
      btn.textContent = emote;
      btn.addEventListener('click', () => this.emit('emote', emote));
      emoteBar.appendChild(btn);
    }
    const sabotageBar = this.el['sabotage-bar'];
    sabotageBar.innerHTML = '';
    for (const [action, def] of Object.entries(SABOTAGE)) {
      const btn = document.createElement('button');
      btn.className = 'chip action';
      btn.type = 'button';
      btn.dataset.action = action;
      btn.textContent = `${SABOTAGE_LABELS[action] || action} (${def.cost})`;
      btn.title = `${action}: ${def.cost} mischief, cooldown ${Math.round(def.cooldownMs / 1000)}s`;
      btn.addEventListener('click', () => this.emit('sabotage', action));
      sabotageBar.appendChild(btn);
    }
  }

  emit(name, payload) {
    const handler = this.handlers[name];
    if (handler) handler(payload);
  }

  _tab(name) {
    for (const tab of ['rooms', 'create', 'join']) {
      this.el[`tab-${tab}`].classList.toggle('active', tab === name);
      this.el[`pane-${tab}`].classList.toggle('hidden', tab !== name);
    }
  }

  _sendChat() {
    const input = this.el['chat-input'];
    const text = (input.value || '').trim();
    if (!text) {
      input.blur();
      return;
    }
    this.emit('chat', text);
    input.value = '';
    input.blur();
  }

  showScreen(name) {
    this.el['screen-auth'].classList.toggle('hidden', name !== 'auth');
    this.el['screen-lobby'].classList.toggle('hidden', name !== 'lobby');
    this.el.hud.classList.toggle('hidden', name !== 'game');
  }

  setAuthError(text) {
    this.el['auth-error'].textContent = text || '';
  }

  setLobbyError(text) {
    this.el['lobby-error'].textContent = text || '';
  }

  focusName(suggest = '') {
    const input = this.el['auth-name'];
    if (suggest) input.value = suggest;
    input.focus();
  }

  setProfile(profile) {
    this.el['lobby-profile'].textContent = profile
      ? `${profile.displayName || profile.username} · level ${profile.progression ? profile.progression.level : 1}`
      : '';
  }

  renderRoomList(rooms) {
    const list = this.el['room-list'];
    this.el['room-count'].textContent = `${rooms.length} room${rooms.length === 1 ? '' : 's'}`;
    list.innerHTML = '';
    if (!rooms.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'No open rooms. Create one or use quick play.';
      list.appendChild(empty);
      return;
    }
    for (const room of rooms) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'room-row';
      row.innerHTML = `<span class="room-name">${escapeHtml(room.name)}</span>
        <span class="room-meta">${room.players}/${room.maxPlayers} · ${escapeHtml(room.phase)}</span>
        <span class="room-code-tag">${escapeHtml(room.code)}</span>`;
      row.addEventListener('click', () => this.emit('joinRoom', room.code));
      list.appendChild(row);
    }
  }

  setConnection(status, detail = {}) {
    const dot = this.el['net-status'];
    const text = this.el['net-detail'];
    const banner = this.el['connection-banner'];
    const map = {
      CONNECTED: ['ok', 'connected'],
      CONNECTING: ['warn', 'connecting'],
      RECONNECTING: ['warn', `reconnecting #${(detail.attempt || 0) + 1}`],
      DISCONNECTED: ['bad', 'disconnected'],
      CLOSED: ['bad', 'offline'],
      IDLE: ['bad', 'offline'],
    };
    const [tone, label] = map[status] || ['bad', status.toLowerCase()];
    dot.className = `status-dot ${tone}`;
    text.textContent = label;
    const showBanner = status === 'RECONNECTING' || status === 'DISCONNECTED' || status === 'CONNECTING';
    banner.classList.toggle('hidden', !showBanner);
    banner.textContent =
      status === 'DISCONNECTED' ? 'Connection lost - retrying...' : status === 'CONNECTING' ? 'Connecting...' : 'Reconnecting...';
  }

  setPing(ms) {
    this.el['net-ping'].textContent = `${ms || '--'} ms`;
  }

  setRoom(summary, players, self) {
    this.selfId = self ? self.id : null;
    if (!summary) {
      this.el['room-code'].textContent = '----';
      this.el['room-phase'].textContent = 'NO ROOM';
      this.el['lobby-bar'].classList.add('hidden');
      this.el['machine-panel'].classList.add('hidden');
      this.el['target-panel'].classList.add('hidden');
      this.el['roster'].classList.add('hidden');
      this.rosterOpen = false;
      return;
    }
    this.el['room-code'].textContent = summary.code;
    this.el['room-phase'].textContent = summary.phase;
    const badge = this.el['room-event'];
    if (summary.activeEvent) {
      badge.classList.remove('hidden');
      badge.textContent = summary.activeEvent.kind;
    } else {
      badge.classList.add('hidden');
    }

    const inLobby = summary.phase !== 'PLAYING' && summary.phase !== 'ACTIVE_SOCIAL_STATE';
    this.el['lobby-bar'].classList.toggle('hidden', !inLobby);
    if (inLobby) {
      const ready = Boolean(self && self.ready);
      this.el['btn-ready'].textContent = ready ? 'Not ready' : 'Ready up';
      this.el['btn-ready'].classList.toggle('primary', !ready);
      this.el['btn-start'].classList.toggle('hidden', !(self && self.host));
    }
    this._renderRoster(players, summary);
  }

  _renderRoster(players, summary) {
    const roster = this.el['roster'];
    if (!this.rosterOpen) return;
    roster.innerHTML = `<div class="roster-title">${players.length}/${summary.maxPlayers} players</div>`;
    for (const player of players) {
      const row = document.createElement('div');
      row.className = 'roster-row';
      const me = player.id === this.selfId;
      row.innerHTML = `<span class="swatch" style="background:${player.color || '#888'}"></span>
        <span class="roster-name">${escapeHtml(player.name || '')}${me ? ' (you)' : ''}</span>
        <span class="roster-flags">${player.host ? 'host' : ''} ${player.ready ? 'ready' : ''} ${
          player.online === false ? 'offline' : ''
        } <b>${player.score || 0}</b></span>`;
      roster.appendChild(row);
    }
  }

  toggleRoster(force) {
    this.rosterOpen = typeof force === 'boolean' ? force : !this.rosterOpen;
    this.el.roster.classList.toggle('hidden', !this.rosterOpen);
    this.el['btn-roster'].classList.toggle('active', this.rosterOpen);
    this.emit('rosterToggled', this.rosterOpen);
  }

  toggleHelp(force) {
    this.helpOpen = typeof force === 'boolean' ? force : !this.helpOpen;
    this.el.help.classList.toggle('hidden', !this.helpOpen);
  }

  setMachine(view, self, mounted) {
    const panel = this.el['machine-panel'];
    if (!mounted || !view) {
      panel.classList.add('hidden');
      return;
    }
    panel.classList.remove('hidden');
    this.el['m-score'].textContent = String(view.score || 0);
    const combo = 1 + (view.combo || 0) * 0.25;
    this.el['m-combo'].textContent = `x${combo.toFixed(2)}`;
    this.el['m-heat'].textContent = `${Math.round(view.heat || 0)}`;
    this.el['m-mischief'].textContent = `${self ? Math.floor(self.mischief || 0) : 0}`;
    const bar = this.el['m-heat-bar'];
    bar.style.width = `${Math.min(100, view.heat || 0)}%`;
    bar.style.background =
      view.heat >= 90 ? '#ff4d3d' : view.heat >= 75 ? '#ff9d3d' : view.heat >= 50 ? '#ffd93d' : '#4fd07a';

    let status = 'Ready';
    if (view.phase === 'SPINNING') {
      const reel = view.activeReel;
      status = reel >= 0 ? `Stop reel ${reel + 1}` : 'Spinning';
    } else if (view.phase === 'OVERBREW') status = 'Release the overbrew (F)!';
    else if (view.phase === 'STUNNED') status = 'Jammed - wait';
    else if (view.stunUntil && view.stunUntil > Date.now()) status = 'Jammed - wait';
    if (view.practice) status += ' · practice';
    if (view.challenge) status += ' · challenge';
    this.el['m-status'].textContent = status;
    this.el['m-hint'].textContent =
      view.phase === 'OVERBREW'
        ? 'Press F now to cash out x2 or risk losing everything'
        : 'Space: spin / stop · 1-3: hold · F: overbrew';
    panel.classList.toggle('overbrew', view.phase === 'OVERBREW');
  }

  setTarget(player) {
    this.selectedTarget = player;
    const panel = this.el['target-panel'];
    if (!player) {
      panel.classList.add('hidden');
      this.emit('targetChanged', null);
      return;
    }
    panel.classList.remove('hidden');
    this.el['target-name'].textContent = `${player.name || 'Player'} · ${player.score || 0} pts`;
    const actions = this.el['target-actions'];
    actions.innerHTML = '';
    const buttons = [
      ['Spectate', 'SPECTATE'],
      ['Teach', 'TEACH_REQUEST'],
      ['Practice', 'PRACTICE_REQUEST'],
      ['Challenge', 'CHALLENGE_REQUEST'],
      ['Hijack', 'TAKEOVER_REQUEST'],
      ['Close', null],
    ];
    for (const [label, kind] of buttons) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `btn small${kind ? '' : ' ghost'}`;
      btn.textContent = label;
      btn.addEventListener('click', () => {
        if (!kind) this.setTarget(null);
        else this.emit('interaction', { kind, targetPlayerId: player.id });
      });
      actions.appendChild(btn);
    }
    this.emit('targetChanged', player);
  }

  setPending(pending) {
    this.pending = pending || [];
    const panel = this.el['pending-panel'];
    const incoming = this.pending.find((p) => p.incoming);
    if (!incoming) {
      panel.classList.add('hidden');
      return;
    }
    panel.classList.remove('hidden');
    this.el['pending-body'].innerHTML = `<b>${escapeHtml(incoming.fromName || 'Someone')}</b> wants to ${prettyKind(
      incoming.kind,
    )}`;
    panel.dataset.pendingId = incoming.pendingId;
  }

  respondPending(accept) {
    const panel = this.el['pending-panel'];
    const pendingId = panel.dataset.pendingId;
    if (!pendingId) return;
    this.emit('respond', { pendingId, accept });
    panel.classList.add('hidden');
    delete panel.dataset.pendingId;
  }

  pushChat(entries) {
    const log = this.el['chat-log'];
    const recent = entries.slice(-40);
    log.innerHTML = '';
    for (const entry of recent) {
      const line = document.createElement('div');
      line.className = 'chat-line';
      const mine = entry.playerId === this.selfId;
      line.innerHTML = `<span class="chat-name${mine ? ' mine' : ''}">${escapeHtml(entry.name)}:</span> ${escapeHtml(
        entry.text,
      )}`;
      log.appendChild(line);
    }
    log.scrollTop = log.scrollHeight;
  }

  toast(item) {
    const host = this.el.toasts;
    const node = document.createElement('div');
    node.className = `toast ${item.kind || 'info'}`;
    node.textContent = item.text;
    host.appendChild(node);
    setTimeout(() => {
      node.classList.add('out');
      setTimeout(() => node.remove(), 400);
    }, 3400);
    while (host.children.length > 5) host.firstChild.remove();
  }

  setActionState({ sabotageReady = {}, spectating = false }) {
    for (const btn of this.el['sabotage-bar'].querySelectorAll('.chip.action')) {
      const action = btn.dataset.action;
      const ready = sabotageReady[action];
      btn.classList.toggle('disabled', ready === false);
      btn.title = ready === false ? 'Unavailable (cost, cooldown or range)' : btn.title;
    }
    for (const btn of this.el['emote-bar'].querySelectorAll('.chip')) {
      btn.classList.toggle('active', spectating);
    }
  }

  focusChat() {
    this.el['chat-input'].focus();
  }

  blurChat() {
    this.el['chat-input'].blur();
  }

  isChatFocused() {
    return document.activeElement === this.el['chat-input'];
  }
}

function prettyKind(kind) {
  return String(kind || '')
    .replace('_REQUEST', '')
    .toLowerCase()
    .replace(/^\w/, (c) => c.toUpperCase());
}

function escapeHtml(text) {
  return String(text == null ? '' : text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
