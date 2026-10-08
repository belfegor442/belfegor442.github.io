import { C2S, S2C } from '../shared/protocol.js';
import { SABOTAGE, MACHINE, WORLD } from '../shared/constants.js';
import { BrewNet } from './net.js';
import { BrewStore } from './store.js';
import { Renderer } from './render.js';
import { Input } from './input.js';
import { UI } from './ui.js';
import { GameAudio } from './audio.js';

const LAST_NAME_KEY = 'brew.username';

class BrewApp {
  constructor() {
    this.store = new BrewStore();
    this.audio = new GameAudio();
    this.ui = new UI({ handlers: this._handlers() });
    this.canvas = document.getElementById('game-canvas');
    this.renderer = new Renderer(this.canvas, this.store);
    this.input = new Input({
      canvas: this.canvas,
      getCamera: () => this.renderer.camera,
      handlers: this._inputHandlers(),
      isCaptured: () => this.ui.isChatFocused(),
    });
    this.net = new BrewNet({
      onEvent: (msg) => this._onNetEvent(msg),
      onStatus: (status, detail) => this._onStatus(status, detail),
      onError: (err) => this._onNetError(err),
    });
    this.inRoom = false;
    this.lastFrame = performance.now();
    this.lastUiAt = 0;
    this.lastMoveSentAt = 0;
    this.screen = 'auth';
  }

  start() {
    this.store.on('chat', (entries) => this.ui.pushChat(entries));
    this.store.on('toast', (item) => this.ui.toast(item));
    this.ui.showScreen('auth');
    this.ui.focusName(localStorage.getItem(LAST_NAME_KEY) || '');
    const loop = (now) => {
      const dt = Math.min(64, now - this.lastFrame);
      this.lastFrame = now;
      this._frame(dt, now);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        this.lastFrame = performance.now();
        return;
      }
      this.input.reset();
      if (this.inRoom && this._mountedStationId() === null) {
        this.net.send(C2S.MOVE, { dx: 0, dz: 0, seq: Math.floor(Date.now() / 50) });
      }
    });
    this._restoreSession();
  }

  async _restoreSession() {
    if (!this.net.session || !this.net.session.sessionToken) return;
    this.ui.setAuthError('');
    try {
      await this.net.connect();
      this._onConnected();
    } catch {
      this.ui.setAuthError('Your session expired. Please sign in again.');
      this.net.signOut();
    }
  }

  _handlers() {
    return {
      auth: (name) => this._auth(name),
      signOut: () => this._signOut(),
      refreshRooms: () => this._refreshRooms(),
      quickPlay: () => this._createRoom({ maxPlayers: 4 }),
      createRoom: (opts) => this._createRoom(opts),
      joinRoom: (code) => this._joinRoom(code),
      readyToggle: () => this._readyToggle(),
      startMatch: () => this._startMatch(),
      leaveRoom: () => this._leaveRoom(),
      chat: (text) => this._chat(text),
      emote: (emote) => this._emote(emote),
      sabotage: (action) => this._sabotage(action),
      interaction: (payload) => this._interaction(payload),
      respond: (payload) => this._respond(payload),
      targetChanged: () => {},
      rosterToggled: () => {},
    };
  }

  _inputHandlers() {
    return {
      primary: () => this._primaryAction(),
      escape: () => {
        this.ui.setTarget(null);
        this.ui.toggleHelp(false);
        if (this.store.self && this.store.self.stationId !== null) this._dismount();
      },
      enter: () => this.ui.focusChat(),
      hold: ({ reel }) => this._hold(reel),
      overbrew: () => this._overbrew(),
      challenge: () => this._targeted('CHALLENGE_REQUEST'),
      spectate: () => this._targeted('SPECTATE'),
      teach: () => this._targeted('TEACH_REQUEST'),
      practice: () => this._targeted('PRACTICE_REQUEST'),
      takeover: () => this._targeted('TAKEOVER_REQUEST'),
      mute: () => {
        this.audio.unlock();
        this.audio.setMuted(!this.audio.muted);
        this.store.toast(this.audio.muted ? 'Sound muted' : 'Sound on');
      },
      click: ({ worldX, worldZ }) => {
        const players = [...this.store.players.values()].filter(
          (p) => !(this.store.self && p.id === this.store.self.id),
        );
        const picked = this.renderer.pickPlayer(worldX, worldZ, players);
        this.renderer.selection = picked ? picked.id : null;
        this.ui.setTarget(picked || null);
        this.audio.play('click');
      },
    };
  }

  async _auth(name) {
    if (!name || name.length < 3) {
      this.ui.setAuthError('Name must be at least 3 characters.');
      return;
    }
    this.ui.setAuthError('');
    this.audio.unlock();
    try {
      await this.net.signIn(name);
      localStorage.setItem(LAST_NAME_KEY, name);
      await this.net.connect();
      this._onConnected();
    } catch (err) {
      this.ui.setAuthError(err.code === 'RATE_LIMITED' ? 'Too many attempts. Wait a moment.' : 'Could not sign in.');
    }
  }

  async _restoreAfterAuth() {
    this._onConnected();
  }

  _onConnected() {
    this.ui.setProfile(this.net.profile);
    this._showLobby();
    this._refreshRooms();
    this.store.toast(`Welcome, ${this.net.profile ? this.net.profile.displayName : ''}`, 'good');
    this.audio.play('join');
  }

  _signOut() {
    this.net.signOut();
    this.inRoom = false;
    this.store.reset();
    this.ui.showScreen('auth');
    this.ui.focusName(localStorage.getItem(LAST_NAME_KEY) || '');
  }

  _showLobby() {
    this.screen = 'lobby';
    this.inRoom = false;
    this.ui.showScreen('lobby');
    this.ui.setRoom(null);
    this.ui.setLobbyError('');
  }

  _showGame() {
    if (this.screen === 'game') return;
    this.screen = 'game';
    this.inRoom = true;
    this.ui.showScreen('game');
  }

  async _refreshRooms() {
    try {
      const result = await this.net.request(C2S.ROOM_LIST, {});
      this.ui.renderRoomList(result.rooms || []);
      this.ui.setLobbyError('');
    } catch {
      this.ui.setLobbyError('Could not reach the server.');
    }
  }

  async _createRoom(opts) {
    this.audio.unlock();
    try {
      await this.net.request(C2S.CREATE_ROOM, { maxPlayers: opts.maxPlayers || 4, name: opts.name || '' });
    } catch (err) {
      this.ui.setLobbyError(prettyError(err));
    }
  }

  async _joinRoom(code) {
    if (!code) {
      this.ui.setLobbyError('Enter a room code.');
      return;
    }
    try {
      await this.net.request(C2S.JOIN_ROOM, { roomCode: code });
    } catch (err) {
      this.ui.setLobbyError(prettyError(err));
    }
  }

  async _readyToggle() {
    const me = this._selfView();
    if (!me) return;
    try {
      await this.net.request(C2S.SET_READY, { ready: !me.ready });
      this.audio.play('ready');
    } catch (err) {
      this.store.toast(prettyError(err), 'warn');
    }
  }

  async _startMatch() {
    try {
      await this.net.request(C2S.START_MATCH, {});
    } catch (err) {
      this.store.toast(prettyError(err), 'warn');
    }
  }

  async _leaveRoom() {
    try {
      await this.net.request(C2S.LEAVE_ROOM, {});
    } catch {
      /* connection may already be gone */
    }
    this.store.reset();
    this._showLobby();
    this._refreshRooms();
    this.audio.play('leave');
  }

  _chat(text) {
    this.net.send(C2S.CHAT, { text });
    this.audio.play('chat');
  }

  _emote(emote) {
    this.net.send(C2S.REACTION, { emote });
  }

  _sabotage(action) {
    const def = SABOTAGE[action];
    if (!def) return;
    let targetPlayerId;
    if (def.target === 'PLAYER') {
      const target = this._nearestOpponent();
      if (!target) {
        this.store.toast('No target in range', 'warn');
        return;
      }
      targetPlayerId = target.id;
    }
    this.net.send(C2S.SABOTAGE, { action, targetPlayerId });
    this.audio.play('sabotage');
  }

  _nearestOpponent() {
    const me = this._selfView();
    if (!me) return null;
    let best = null;
    let bestDist = Infinity;
    for (const player of this.store.players.values()) {
      if (player.id === (this.store.self && this.store.self.id)) continue;
      if (player.online === false) continue;
      const dx = player.x - me.x;
      const dz = player.z - me.z;
      const d = dx * dx + dz * dz;
      if (d < bestDist) {
        bestDist = d;
        best = player;
      }
    }
    if (!best) return null;
    const maxRange = Math.max(...Object.values(SABOTAGE).map((s) => s.range));
    return bestDist <= maxRange * maxRange ? best : null;
  }

  _targeted(kind) {
    const target = this.renderer.selection
      ? this.store.players.get(this.renderer.selection)
      : null;
    if (!target) {
      this.store.toast('Select a player first (click them)', 'warn');
      return;
    }
    this._interaction({ kind, targetPlayerId: target.id });
  }

  async _interaction(payload) {
    try {
      await this.net.request(C2S.INTERACTION, payload);
      if (payload.kind !== 'SPECTATE') this.audio.play('request');
    } catch (err) {
      this.store.toast(prettyError(err), 'warn');
    }
  }

  async _respond({ pendingId, accept }) {
    try {
      await this.net.request(C2S.INTERACTION, { kind: 'RESPONSE', pendingId, accept });
      this.audio.play(accept ? 'ready' : 'click');
    } catch (err) {
      this.store.toast(prettyError(err), 'warn');
    }
  }

  _mountedStationId() {
    const self = this.store.self;
    if (!self || self.stationId === null || self.stationId === undefined) return null;
    return self.stationId;
  }

  _primaryAction() {
    this.audio.unlock();
    const stationId = this._mountedStationId();
    if (stationId === null) {
      this.net.send(C2S.MOUNT_STATION, {});
      return;
    }
    const machine = this.store.machines.get(stationId);
    if (!machine) return;
    if (machine.phase === 'OVERBREW') {
      this._overbrew();
      return;
    }
    const action = machine.phase === 'SPINNING' ? 'STOP' : 'SPIN';
    this.net.send(C2S.MACHINE_INPUT, { action, clientTime: Date.now() });
  }

  _dismount() {
    this.net.send(C2S.DISMOUNT, {});
  }

  _hold(reel) {
    const stationId = this._mountedStationId();
    if (stationId === null) return;
    const machine = this.store.machines.get(stationId);
    if (!machine) return;
    const current = Boolean(machine.holds && machine.holds[reel]);
    this.net.send(C2S.MACHINE_INPUT, { action: 'HOLD', reel, hold: !current });
    this.audio.play('click');
  }

  _overbrew() {
    const stationId = this._mountedStationId();
    if (stationId === null) return;
    this.net.send(C2S.MACHINE_INPUT, { action: 'RELEASE', clientTime: Date.now() });
  }

  _selfView() {
    const self = this.store.self;
    if (!self) return null;
    const me = this.store.players.get(self.id);
    return me ? { ...self, x: me.x, z: me.z, ready: me.ready, host: me.host, mischief: me.mischief } : self;
  }

  _onStatus(status, detail) {
    this.ui.setConnection(status, detail);
    if (status === 'CONNECTED' && detail && detail.rejoined) {
      this.store.toast('Session restored', 'good');
      this.audio.play('reconnect');
    }
  }

  _onNetError(err) {
    if (err.code === 'AUTH_EXPIRED' || err.code === 'AUTH_INVALID') {
      this.net.signOut();
      this._showLobbySignin();
    } else if (err && err.message !== 'CONNECTION_LOST') {
      this.store.toast(prettyError(err), 'warn');
      this.audio.play('error');
    }
  }

  _showLobbySignin() {
    this.inRoom = false;
    this.store.reset();
    this.ui.showScreen('auth');
    this.ui.setAuthError('Session expired. Sign in again.');
    this.ui.focusName(localStorage.getItem(LAST_NAME_KEY) || '');
  }

  _onNetEvent(msg) {
    switch (msg.type) {
      case S2C.ROOM_SNAPSHOT:
        this.store.applySnapshot(msg);
        this._showGame();
        break;
      case S2C.ROOM_STATE:
        this.store.applyState(msg);
        break;
      case S2C.ROOM_EVENT:
        this.store.applyEvent(msg);
        this._afterEvent(msg.event, msg.payload || {});
        break;
      case S2C.ROOM_LIST_RESULT:
        if (this.screen === 'lobby') this.ui.renderRoomList(msg.payload.rooms || []);
        break;
      case S2C.SESSION_ESTABLISHED:
        break;
      case 'CLIENT_RECONNECTED':
        this.store.toast('Reconnected', 'good');
        break;
      default:
        break;
    }
  }

  _afterEvent(event, payload) {
    switch (event) {
      case 'PLAYER_JOINED':
        this.audio.play('join');
        break;
      case 'PLAYER_LEFT':
        this.audio.play('leave');
        break;
      case 'MACHINE_SPIN':
        this.audio.play('spin');
        break;
      case 'MACHINE_STOP': {
        const quality = payload.quality || payload.result;
        this.audio.play(
          quality === 'PERFECT' ? 'stopPerfect' : quality === 'GOOD' ? 'stopGood' : quality === 'OK' ? 'stopOk' : 'stopMiss',
        );
        break;
      }
      case 'MACHINE_OVERBREW_START':
        this.audio.play('overbrew');
        break;
      case 'MACHINE_OVERBREW_SUCCESS':
        this.audio.play('overbrew');
        break;
      case 'MACHINE_OVERBREW_FAIL':
      case 'MACHINE_STUN':
        this.audio.play('fail');
        break;
      case 'MACHINE_COMBO_BREAK':
        this.audio.play('error');
        break;
      case 'BEER_THROW':
      case 'PEANUT_THROW':
      case 'BELL_RING':
      case 'SMOKE_DEPLOYED':
      case 'COIN_TOSS':
      case 'COOLER_HIT':
      case 'CLEANSED':
        this.audio.play('sabotage');
        if (payload.to) this.renderer.addBurst(payload.to.x, payload.to.z, '#ffd76a', 12);
        break;
      case 'CHALLENGE_STARTED':
        this.audio.play('challenge');
        break;
      case 'INTERACTION_REQUEST':
        if (payload.toId === (this.store.self && this.store.self.id)) this.audio.play('request');
        break;
      case 'CHAT':
        if (payload.playerId !== (this.store.self && this.store.self.id)) this.audio.play('chat');
        break;
      case 'ROUND_COMPLETE':
        break;
      default:
        break;
    }
    if (event.startsWith('MACHINE_') && payload.stationId !== undefined) {
      const station = this._stationById(payload.stationId);
      if (station) this.renderer.addBurst(station.x, station.machineZ, '#ffb64d', 6);
    }
  }

  _stationById(id) {
    if (!this.store.room || !this.store.room.world) return null;
    return this.store.room.world.stations.find((s) => s.id === id) || null;
  }

  _frame(dt, now) {
    const intent = this.input.update();
    const self = this.store.self;
    const mounted = this._mountedStationId() !== null;
    const usable = this.inRoom && self && !mounted;
    this.store.setIntent(usable ? intent.dx : 0, usable ? intent.dz : 0);
    this.store.tick(dt, now);

    if (usable && this.input.shouldSendIntent(now)) {
      this.net.send(C2S.MOVE, { dx: intent.dx, dz: intent.dz, seq: Math.floor(now / 50) });
      this.lastMoveSentAt = now;
    } else if (usable && intent.dx === 0 && intent.dz === 0 && now - this.lastMoveSentAt > 1000) {
      this.net.send(C2S.MOVE, { dx: 0, dz: 0, seq: Math.floor(now / 50) });
      this.lastMoveSentAt = now;
    }

    this.renderer.draw(now);

    if (now - this.lastUiAt > 120) {
      this.lastUiAt = now;
      this._syncUi(now);
    }
  }

  _syncUi(now) {
    this.ui.setPing(this.net.rttMs);
    if (!this.inRoom) return;
    const summary = this.store.roomSummary();
    const self = this._selfView();
    const players = [...this.store.players.values()];
    this.ui.setRoom(summary, players, self);

    const stationId = this._mountedStationId();
    const machine = stationId !== null ? this.store.machines.get(stationId) : null;
    this.ui.setMachine(machine ? this.store.machineView(machine, now) : null, self, stationId !== null);
    this.ui.setPending(this.store.pending, this.store.self ? this.store.self.id : null);

    const sabotageReady = {};
    const cooldowns = (self && self.cooldowns) || {};
    const mischief = self ? self.mischief || 0 : 0;
    const me = self;
    for (const [action, def] of Object.entries(SABOTAGE)) {
      const onCooldown = Boolean(cooldowns[action]) && cooldowns[action] > now;
      let inRange = true;
      if (def.target === 'PLAYER') {
        const target = this._nearestOpponent();
        inRange = Boolean(target);
      }
      sabotageReady[action] = !onCooldown && mischief >= def.cost && inRange;
    }
    this.ui.setActionState({
      sabotageReady,
      spectating: Boolean(this.store.self && this.store.self.spectating),
    });
    void me;
    void MACHINE;
    void WORLD;
  }
}

function prettyError(err) {
  if (!err) return 'Something went wrong.';
  const map = {
    RATE_LIMITED: 'Slow down a moment.',
    NOT_ENOUGH_MISCHIEF: 'Not enough Mischief.',
    COOLDOWN: 'That is on cooldown.',
    OUT_OF_RANGE: 'Too far away.',
    INVALID_TARGET: 'Pick a target first.',
    ROOM_NOT_FOUND: 'That room is gone.',
    ROOM_FULL: 'That room is full.',
    ALREADY_IN_ROOM: 'You are already in a room.',
    NOT_IN_ROOM: 'You are not in a room.',
    STATION_OCCUPIED: 'Someone is at that machine.',
    REQUEST_TIMEOUT: 'No response from the server.',
    SERVER_UNAVAILABLE: 'Connection lost.',
    NOT_AUTHORIZED: 'You cannot do that.',
    INVALID_ACTION: 'Not available right now.',
    STATE_MISMATCH: 'Machine state resyncing...',
  };
  return map[err.code] || err.message || 'Something went wrong.';
}

const app = new BrewApp();
window.__brew = app;
app.start();
