import { MAX_PLAYERS, SPEED, RADIUS, PROX, TICK, LIMITS, token, roomCode, topics } from './src/protocol.js?v=10';
import { MAP, OBJECTS, SEATS, SEAT_BY_ID, OBJ_BY_ID, SPAWNS, move as collide, nearestSeat, seatsAt, insideInteract, tableOf } from './src/world.js?v=10';
import { Host } from './src/state.js?v=10';
import { Net } from './src/net.js?v=10';
import { Renderer } from './src/render.js?v=10';
import { Input } from './src/input.js?v=10';
import { UI } from './src/ui.js?v=10';
import { Registry, kinds as activityKinds } from './src/activities.js?v=10';

const BROKERS = (() => {
  try {
    const q = new URLSearchParams(location.search).get('brokers');
    if (q) {
      const l = q.split(',').map(s => s.trim()).filter(s => /^wss?:\/\//.test(s));
      if (l.length) return l;
    }
  } catch (e) {}
  return ['wss://broker.emqx.io:8084/mqtt', 'wss://test.mosquitto.org:8081/mqtt', 'wss://broker.hivemq.com:8884/mqtt'];
})();

const MAX_HELLO = 7;
const SND = {
  coin: './Assets/sound/coin.mp3',
  join: './Assets/sound/join.mp3',
  win: './Assets/sound/win.mp3',
  lose: './Assets/sound/lose.mp3'
};

const ui = new UI();
const input = new Input();
const canvas = document.getElementById('world');
const renderer = new Renderer(canvas);

const players = new Map();
const pending = new Map();
let me = null;
let myUid = token(8);
let myName = 'PLAYER';
let myPid = '----';
let mySeed = 0;
let balance = 1000;
let isHost = false;
let hosting = false;
let room = '';
let net = null;
let authority = null;
let activity = null;
let myHand = null;
let objects = { lights: true };
let hostSeen = false;
let welcomed = false;
let welcomeN = 0;
let gTries = 0;
let gRots = 0;
let gTimer = null;
let nextStake = 25;
let sndOn = true;
const motion = { x: 0, y: 0 };
let savedName = '';
const settledActivityResults = new Set();
const sndCache = {};

try {
  const n = localStorage.getItem('brew.name');
  if (n) { myName = n; savedName = n; }
  const p = localStorage.getItem('brew.pid');
  if (!p) { myPid = token(4).toUpperCase(); localStorage.setItem('brew.pid', myPid); }
  else myPid = p.toUpperCase();
  const s = localStorage.getItem('brew.seed');
  if (s != null) mySeed = Number(s) % 6;
  else { mySeed = Math.floor(Math.random() * 6); localStorage.setItem('brew.seed', String(mySeed)); }
  const b = localStorage.getItem('brew.balance');
  if (b != null) balance = Math.max(0, Number(b));
  sndOn = localStorage.getItem('brew.sound') !== '0';
} catch (e) {}

function sfx(k) {
  if (!sndOn) return;
  try {
    let a = sndCache[k];
    if (!a) { a = new Audio(SND[k]); a.preload = 'auto'; a.volume = 0.55; sndCache[k] = a; }
    a.currentTime = 0;
    const pr = a.play();
    if (pr && pr.catch) pr.catch(() => {});
  } catch (e) {}
}
function preloadSnd() {
  if (!sndOn) return;
  for (const k in SND) if (!sndCache[k]) { try { const a = new Audio(SND[k]); a.preload = 'auto'; a.volume = 0.55; sndCache[k] = a; } catch (e) {} }
}
function setSound(on) {
  sndOn = on;
  try { localStorage.setItem('brew.sound', on ? '1' : '0'); } catch (e) {}
  ui.setSound(on);
  if (!on) for (const k in sndCache) { try { sndCache[k].pause(); } catch (e) {} }
}

function T() { return topics(room); }

function serialize(p) {
  return {
    id: p.id, name: p.name, pid: p.pid, seed: p.seed, x: p.x, y: p.y, dir: p.dir,
    anim: p.anim, status: p.status, seat: p.seat, emote: p.emote, emoteAt: p.emoteAt, balance: p.balance
  };
}
function entity(data) {
  const existing = players.get(data.id);
  const p = existing || { rx: data.x, ry: data.y, chat: null };
  Object.assign(p, data);
  players.set(data.id, p);
  return p;
}
function sendHost(msg, critical) {
  if (!net || !T()) return;
  if (isHost) { handleHost(Object.assign({ from: myUid }, msg)); return; }
  if (critical !== false) {
    const mid = token(6);
    msg.mid = mid;
    pending.set(mid, { msg, at: Date.now(), tries: 1 });
  }
  net.publish(T().c, Object.assign({ from: myUid }, msg), { qos: critical !== false ? 1 : 0 });
}
function sendTo(uid, msg) {
  if (isHost && uid === myUid) { handleClient(Object.assign({}, msg, { to: null })); return; }
  net.publish(T().s, Object.assign({ to: uid }, msg), { qos: 1 });
}
function broadcast(msg) { net.publish(T().s, msg); }

function publishPresence(on) {
  if (!net || !T()) return;
  net.publish(T().p(myUid), { t: 'presence', on: on ? 1 : 0, name: myName, pid: myPid, seed: mySeed }, { retain: true, qos: 0 });
}
function presenceWill() {
  return { topic: T().p(myUid), payload: '{"t":"presence","on":0}', retain: true, qos: 0 };
}

function rejoin() {
  if (isHost || !welcomed) return false;
  publishPresence(true);
  sendHost({ t: 'hello', name: myName, pid: myPid, seed: mySeed, balance });
  return true;
}

function enter({ name, code }) {
  if (net) return;
  myName = (name || '').trim().replace(/\s+/g, ' ').slice(0, LIMITS.name) || 'PLAYER';
  try { localStorage.setItem('brew.name', myName); } catch (e) {}
  const wanted = (code || '').trim().toUpperCase();
  if (wanted.length === 6) startGuest(wanted);
  else startHost();
}

function startHost() {
  isHost = true;
  hosting = true;
  room = roomCode();
  authority = new Host(room);
  ui.entryStatus('Opening a new world…');
  net = new Net(BROKERS);
  wireNet();
  const will = { topic: T().host, payload: '{"t":"presence","on":0}', retain: true, qos: 0 };
  net.onStatus = t => { if (t === 'ready') onHostReady(); else if (t) ui.entryStatus(t); };
  net.host(room, will);
}

function setTouchControls(on) { const el = document.getElementById('touchControls'); if (el) { el.classList.toggle('visible', !!on); el.setAttribute('aria-hidden', on ? 'false' : 'true'); } }

function onHostReady() {
  const spawn = SPAWNS[0];
  me = entity({
    id: myUid, name: myName, pid: myPid, seed: mySeed, x: spawn.x, y: spawn.y,
    dir: -Math.PI / 2, anim: 'idle', status: 'standing', seat: null,
    emote: null, emoteAt: 0, balance
  });
  me.rx = me.x; me.ry = me.y;
  authority.addPlayer(me);
  publishPresence(true);
  ui.world(room, players.size, MAX_PLAYERS);
  ui.hideEntry();
  ui.system('World #' + room + ' is open. Share the code to invite people.');
  input.enabled = true;
  setTouchControls(true);
}

function startGuest(code) {
  isHost = false;
  hosting = false;
  room = code;
  ui.entryStatus('Looking for world ' + room + '…');
  net = new Net(BROKERS);
  wireNet();
  net.onStatus = t => {
    if (t === 'connected') { gTries = 0; guestHelloLoop(); }
    else if (t) ui.entryStatus(t);
  };
  net.guest(room, presenceWill());
}

function guestHelloLoop() {
  clearTimeout(gTimer);
  if (welcomed || isHost) return;
  if (net.up) sendHost({ t: 'hello', name: myName, pid: myPid, seed: mySeed, balance });
  gTries++;
  if (welcomed) return;
  if (gTries > MAX_HELLO) {
    if (gRots < BROKERS.length * 2 && net.rotate) {
      gRots++;
      gTries = 0;
      ui.entryStatus('Looking in another network…');
      net.rotate();
      return;
    }
    if (net) { try { net.close(); } catch (e) {} net = null; }
    hostSeen = false;
    ui.entryStatus('World ' + room + ' not found. Ask the host for the code, then try again.');
    return;
  }
  ui.entryStatus(hostSeen
    ? 'Joining world ' + room + '…'
    : 'Looking for world ' + room + '… (' + gTries + '/' + MAX_HELLO + ')');
  gTimer = setTimeout(guestHelloLoop, 1300);
}

function wireNet() {
  net.onMessage = onMessage;
  net.onFirstUp = () => { if (!isHost) publishPresence(true); };
  net.onReconnect = () => { rejoin(); };
}

function onMessage(topic, msg) {
  if (msg.to && msg.to !== myUid) return;
  if (isHost) {
    if (topic === T().host) return;
    if (topic.startsWith(T().pAll.replace('+', ''))) {
      const uid = topic.slice(topic.lastIndexOf('/') + 1);
      if (uid === myUid) return;
      if (msg.on === 0) removePlayer(uid, 'left the world');
      return;
    }
    if (topic !== T().c) return;
    handleHost(msg);
  } else {
    if (topic === T().host) {
      hostSeen = msg.on === 1;
      if (!hostSeen && welcomed) {
        welcomed = false;
        ui.showEntry('The host closed this world.');
        ui.system('The world was closed by its host.');
      }
      return;
    }
    handleClient(msg);
  }
}

function handleHost(msg) {
  const uid = msg.from;
  if (!uid) return;
  const now = Date.now();
  if (msg.mid) sendTo(uid, { t: 'ack', mid: msg.mid });
  switch (msg.t) {
    case 'hello': joinPlayer(msg, uid); break;
    case 'mv': authority.applyMove(uid, msg, now); break;
    case 'sit': reply(uid, authority.sit(uid, msg.seat)); break;
    case 'stand': reply(uid, authority.stand(uid)); break;
    case 'emote': reply(uid, authority.emote(uid, msg.key)); break;
    case 'chat': reply(uid, authority.chat(uid, msg.text)); break;
    case 'obj': reply(uid, authority.objectState(uid, msg.id, msg.val)); break;
    case 'activity.start': reply(uid, authority.startActivity(msg.kind, uid, { stake: msg.stake })); break;
    case 'activity.input': reply(uid, authority.inputActivity(uid, { side: msg.side, pick: msg.pick, id: msg.id })); break;
    case 'bye': removePlayer(uid, 'left the world'); break;
  }
}
function reply(uid, res) {
  if (!res) return;
  if (res.error) { sendTo(uid, { t: 'err', code: res.error }); return; }
  if (res.ok) {
    broadcast(res.ok); handleClient(res.ok);
    if (res.dms) for (const d of res.dms) sendTo(d.uid, d.msg);
  }
}

function joinPlayer(msg, uid) {
  if (authority.players.has(uid)) {
    sendTo(uid, welcomeFor(uid));
    return;
  }
  if (authority.count() >= MAX_PLAYERS) { sendTo(uid, { t: 'err', code: 'world-full' }); return; }
  const spawn = SPAWNS[authority.count() % SPAWNS.length];
  const p = authority.addPlayer({
    id: uid, name: msg.name, pid: msg.pid, seed: msg.seed,
    x: spawn.x, y: spawn.y, dir: -Math.PI / 2, balance: msg.balance
  });
  if (!p) { sendTo(uid, { t: 'err', code: 'name-taken' }); return; }
  entity(serialize(p));
  sendTo(uid, welcomeFor(uid));
  broadcast({ t: 'join', player: serialize(p) });
  ui.system(p.name + ' walked in.');
  sfx('join');
}

function welcomeFor(uid) {
  const p = authority.players.get(uid);
  return {
    t: 'welcome', uid, x: p.x, y: p.y, dir: p.dir, balance: p.balance,
    room, max: MAX_PLAYERS, obj: Object.assign({}, authority.objects),
    activity: authority.serialize(authority.activity),
    snapshot: authority.snapshot()
  };
}

function removePlayer(uid, reason) {
  const p = players.get(uid);
  if (!p) return;
  players.delete(uid);
  const seat = p.seat ? SEAT_BY_ID.get(p.seat) : null;
  if (seat && seat.occupiedBy === uid) seat.occupiedBy = null;
  if (isHost && authority) {
    for (const m of authority.removePlayer(uid)) {
      broadcast(m);
      if (m.t !== 'leave') handleClient(m);
    }
  }
  if (uid !== myUid) ui.system(p.name + ' ' + (reason || 'left') + '.');
  else rejoin();
}

function handleClient(msg) {
  switch (msg.t) {
    case 'welcome': applyWelcome(msg); break;
    case 'err': ui.toast(errText(msg.code)); if (msg.code === 'name-taken') { gTries = MAX_HELLO; } break;
    case 'ack': pending.delete(msg.mid); break;
    case 'join':
      if (msg.player && msg.player.id !== myUid) { entity(msg.player); refreshHud(); }
      break;
    case 'leave': removePlayer(msg.uid, 'left the world'); break;
    case 'snapshot': applySnapshot(msg); break;
    case 'snap': applySnap(msg); break;
    case 'sit': applySit(msg); break;
    case 'stand': applyStand(msg); break;
    case 'emote': applyEmote(msg); break;
    case 'chat': applyChat(msg); break;
    case 'obj': objects[msg.id] = msg.val; renderer.lights = objects.lights; break;
    case 'activity.start': applyActivityStart(msg); break;
    case 'activity.update': applyActivityUpdate(msg); break;
    case 'activity.end': applyActivityEnd(msg); break;
    case 'activity.hand':
      if (activity && activity.id === msg.id) { myHand = msg.cards || null; renderActivityPanel(); }
      break;
  }
}

function applyWelcome(msg) {
  welcomed = true;
  welcomeN++;
  clearTimeout(gTimer);
  room = msg.room || room;
  myUid = msg.uid;
  objects = msg.obj || { lights: true };
  renderer.lights = objects.lights;
  balance = msg.balance;
  players.clear();
  for (const sp of (msg.snapshot && msg.snapshot.players) || []) entity(sp);
  applySeats((msg.snapshot && msg.snapshot.seats) || []);
  const mine = players.get(myUid);
  if (mine) { mine.rx = mine.x; mine.ry = mine.y; me = mine; }
  activity = msg.activity || null;
  ui.world(room, players.size, msg.max || MAX_PLAYERS);
  ui.hideEntry();
  ui.system('You walked into world #' + room + '.');
  input.enabled = true;
  setTouchControls(true);
  refreshHud();
  renderActivityPanel();
}

function applySnapshot(msg) {
  const snap = msg.snapshot || msg;
  if (!snap.players) return;
  const seen = new Set();
  for (const sp of snap.players) {
    if (sp.id === myUid) continue;
    seen.add(sp.id);
    const p = entity(sp);
    if (p.rx == null) { p.rx = p.x; p.ry = p.y; }
  }
  for (const id of [...players.keys()]) if (id !== myUid && !seen.has(id)) players.delete(id);
  applySeats(snap.seats || []);
  if (snap.obj) { objects = snap.obj; renderer.lights = objects.lights; }
  if (snap.activity !== undefined && (!activity || (snap.activity && activity && snap.activity.id !== activity.id))) {
    activity = snap.activity;
    renderActivityPanel();
  }
  refreshHud();
}

function applySnap(msg) {
  if (msg.full) { applySnapshot(msg.full); return; }
  for (const s of msg.p || []) {
    if (s.id === myUid) {
      if (me && Math.hypot(s.x - me.x, s.y - me.y) > 90) { me.x = s.x; me.y = s.y; }
      continue;
    }
    const p = players.get(s.id);
    if (!p) continue;
    p.x = s.x; p.y = s.y; p.dir = s.dir; p.anim = s.anim;
    if (s.status) p.status = s.status;
    if (s.seat !== undefined) p.seat = s.seat;
    if (s.name) p.name = s.name;
    if (s.balance != null) p.balance = s.balance;
    if (s.emote) { p.emote = s.emote; p.emoteAt = s.emoteAt; }
  }
}

function applySeats(list) {
  for (const s of SEATS) s.occupiedBy = null;
  for (const entry of list) {
    const seat = SEAT_BY_ID.get(entry[0]);
    if (seat) seat.occupiedBy = entry[1];
  }
}

function applySit(msg) {
  const p = players.get(msg.uid);
  if (!p) return;
  const seat = SEAT_BY_ID.get(msg.seat);
  if (seat) seat.occupiedBy = msg.uid;
  p.x = msg.x; p.y = msg.y; p.rx = msg.x; p.ry = msg.y; p.dir = msg.dir;
  p.status = 'seated'; p.seat = msg.seat; p.anim = 'sit';
  if (msg.uid === myUid) { p.rx = p.x; p.ry = p.y; me = p; }
  refreshHud();
  renderPrompt();
}

function applyStand(msg) {
  const p = players.get(msg.uid);
  if (!p) return;
  const seat = p.seat ? SEAT_BY_ID.get(p.seat) : null;
  if (seat && seat.occupiedBy === msg.uid) seat.occupiedBy = null;
  p.status = 'standing'; p.seat = null; p.anim = 'idle';
  refreshHud();
  renderPrompt();
}

function applyEmote(msg) {
  const p = players.get(msg.uid);
  if (!p) return;
  p.emote = msg.key;
  p.emoteAt = msg.at || Date.now();
}

function applyChat(msg) {
  if (msg.to && !msg.to.includes(myUid)) return;
  const p = players.get(msg.uid);
  if (!p) return;
  p.chat = { text: msg.text, at: Date.now() };
  ui.line(p.id === myUid ? 'me' : 'other', msg.text, p.name);
}

function applyActivityStart(msg) {
  activity = msg.activity;
  myHand = null;
  if (activity && activity.players && activity.players.includes(myUid)) sfx('coin');
  renderActivityPanel();
  renderPrompt();
  if (activity) ui.system(Registry[activity.kind] ? Registry[activity.kind].label + ' started at ' + activity.table : 'Activity started.');
}

function settleActivityResult(act) {
  if (!act || !act.id || !act.balances || !me) return;
  if (settledActivityResults.has(act.id)) return;
  settledActivityResults.add(act.id);
  const d = Number(act.balances[myUid] || 0);
  if (!Number.isFinite(d) || d === 0) return;
  me.balance = Math.max(0, (me.balance || 0) + d);
  balance = me.balance;
  try { localStorage.setItem('brew.balance', String(balance)); } catch (e) {}
  sfx(d > 0 ? 'win' : 'lose');
  ui.toast(d > 0 ? 'YOU WON +' + d : 'YOU LOST ' + d);
}

function applyActivityUpdate(msg) {
  if (!activity || activity.id !== msg.id) activity = msg.activity || activity;
  else if (msg.activity) Object.assign(activity, msg.activity);
  else { activity.phase = msg.phase || activity.phase; if (msg.waiting) activity.waiting = msg.waiting; }
  if (activity && msg.activity && msg.activity.balances) activity.balances = msg.activity.balances;
  if (activity && msg.activity && msg.activity.result) activity.result = msg.activity.result;
  if (activity && activity.phase === 'result') settleActivityResult(activity);
  renderActivityPanel();
  renderPrompt();
}

function applyActivityEnd(msg) {
  if (msg.activity && msg.activity.id === msg.id) settleActivityResult(msg.activity);
  if (activity && activity.id === msg.id) {
    activity = null;
    myHand = null;
  }
  renderActivityPanel();
  renderPrompt();
}

function errText(code) {
  const map = {
    'world-full': 'That world is full (20 players).',
    'name-taken': 'That name is already in this world.',
    'taken': 'That seat is taken.',
    'too-far': 'Too far away.',
    'busy': 'You are busy right now.',
    'must-sit': 'Sit at a table first.',
    'need-two-players': 'Two players need to be seated at the table.',
    'activity-running': 'A game is already running at that table.',
    'no-table': 'Sit at a table to play.',
    'no-balance': 'You are out of chips.',
    'unknown-activity': 'That activity does not exist.',
    'already-picked': 'You already made your pick.',
    'bad-pick': 'Pick one of the offered options.',
    'need-one-player': 'This game is played solo — the others must stand up.',
    'in-activity': 'You are in a game right now.'
  };
  return map[code] || 'That action is not available.';
}

function renderActivityPanel() {
  ui.renderActivity(activity, myUid, {
    hand: myHand,
    activityInput: payload => {
      if (!activity) return;
      sendHost({ t: 'activity.input', id: activity.id, pick: payload.pick, side: payload.pick });
    },
    stake: v => { nextStake = v; ui.toast('Stake set to ' + v); }
  });
}

function computePrompt() {
  if (!me) return null;
  if (activity && activity.players && activity.players.includes(myUid) && activity.phase === 'picking') {
    const def = Registry[activity.kind];
    return (def && def.prompt) || 'MAKE YOUR PICK BELOW';
  }
  if (me.status === 'seated') {
    if (!activity) return 'E  STAND UP · F  START GAME';
    return 'E  STAND UP';
  }
  const sw = insideInteract(me.x, me.y, PROX.interact);
  if (sw) return objects.lights ? 'E  LIGHTS OFF' : 'E  LIGHTS ON';
  const seat = nearestSeat(me.x, me.y, PROX.interact);
  if (seat && !seat.occupiedBy) return 'E  SIT DOWN';
  for (const t of OBJECTS) {
    if (t.type !== 'table') continue;
    const seated = seatsAt(t.id).filter(s => s.occupiedBy).length;
    if (seated >= 2) return 'A GAME IS RUNNING AT ' + t.id.toUpperCase();
  }
  return null;
}

function renderPrompt() {
  ui.setPrompt(computePrompt());
  ui.stakeBar(!!me && me.status === 'seated' && !activity);
}

function interact() {
  if (!me) return;
  if (me.status === 'seated') { sendHost({ t: 'stand' }); return; }
  const sw = insideInteract(me.x, me.y, PROX.interact);
  if (sw) { sendHost({ t: 'obj', id: sw.id, val: !objects.lights }); return; }
  const seat = nearestSeat(me.x, me.y, PROX.interact);
  if (seat && !seat.occupiedBy) { sendHost({ t: 'sit', seat: seat.id }); return; }
  ui.toast('Nothing to interact with here.');
}

function startActivity(kind) {
  if (!me || me.status !== 'seated') { ui.toast('Sit at a table first.'); return; }
  if (activity) { ui.toast('A game is already running at this table.'); return; }
  if (!kind || !Registry[kind]) { openGamePicker(); return; }
  sendHost({ t: 'activity.start', kind, stake: nextStake });
}

function openGamePicker() {
  const seat = SEAT_BY_ID.get(me.seat);
  const table = seat && seat.table;
  const seatedN = table ? seatsAt(table).filter(s => s.occupiedBy).length : 1;
  const opts = activityKinds()
    .filter(k => {
      const d = Registry[k];
      return seatedN >= (d.minPlayers || 2) && seatedN <= (d.maxPlayers || 99);
    })
    .map(k => ({ kind: k, label: Registry[k].label }));
  if (!opts.length) { ui.toast('No game fits this table.'); return; }
  ui.renderPicker(opts, k => startActivity(k));
}

function say(text) {
  if (!me) return;
  sendHost({ t: 'chat', text });
}

function refreshHud() {
  ui.world(room, players.size, MAX_PLAYERS);
  ui.roster(players.values(), myUid);
}

function leaveWorld() {
  try {
    if (net && T()) {
      publishPresence(false);
      if (!isHost) sendHost({ t: 'bye' }, false);
      net.close();
    }
  } catch (e) {}
  net = null;
  setTouchControls(false);
  location.reload();
}

input.on('chat', () => ui.focusChat());
input.on('interact', interact);
input.on('activity', startActivity);
input.on('emote', key => { if (me) sendHost({ t: 'emote', key: key.toUpperCase() }); });
input.on('camtoggle', () => {
  const on = renderer.toggleFreeCam();
  ui.toast(on ? 'FREE CAM — drag: orbit · wheel: zoom · arrows: pan · C: follow' : 'FOLLOW CAM');
});

ui.bind({
  enter,
  leave: leaveWorld,
  sound: setSound,
  share: async () => {
    try { await navigator.clipboard.writeText(room); ui.toast('World code ' + room + ' copied'); }
    catch (e) { ui.toast('World code: ' + room); }
  },
  emote: key => { if (me) sendHost({ t: 'emote', key: key.toUpperCase() }); },
  stake: v => { nextStake = v; ui.stake(v); },
  say
});

let last = performance.now();
let moveAcc = 0, hudAcc = 0, lastFull = 0;

function hostPulse() {
  if (!isHost || !authority || !net || !net.up) return;
  const dirty = authority.dirtyPlayers();
  if (dirty.length) { broadcast({ t: 'snap', p: dirty }); handleClient({ t: 'snap', p: dirty }); }
  for (const m of authority.tick(Date.now())) { broadcast(m); handleClient(m); }
  const now = Date.now();
  if (now - lastFull >= TICK.full) {
    lastFull = now;
    const snapshot = authority.snapshot();
    broadcast({ t: 'snapshot', snapshot });
    applySnapshot(snapshot);
  }
}
setInterval(hostPulse, TICK.snap);

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  renderer.time = now / 1000;

  if (renderer.freeCam) {
    const ar = input.arrows();
    if (ar.x || ar.y) renderer.panCam(ar.x, ar.y, dt);
  }
  if (me && input.enabled && me.status === 'standing' && !input.typing()) {
    const a = input.axis(renderer.freeCam);
    // Movement is camera-relative: W/joystick-up always means "towards the camera target".
    const yaw = renderer.orbit.yaw;
    const sy = Math.sin(yaw), cy = Math.cos(yaw);
    const wx = cy * a.x + sy * a.y;
    const wy = -sy * a.x + cy * a.y;
    const moving = Math.hypot(wx, wy) > 0.02;
    const targetSpeed = SPEED * (a.sprint ? 1.45 : 1);
    const accel = moving ? 1250 : 1650;
    const targetX = moving ? wx * targetSpeed : 0;
    const targetY = moving ? wy * targetSpeed : 0;
    const blend = Math.min(1, accel * dt / Math.max(targetSpeed, 1));
    motion.x += (targetX - motion.x) * blend;
    motion.y += (targetY - motion.y) * blend;
    if (Math.abs(motion.x) < 2) motion.x = 0;
    if (Math.abs(motion.y) < 2) motion.y = 0;
    const r = collide(me.x, me.y, me.x + motion.x * dt, me.y + motion.y * dt, RADIUS);
    if (r.x === me.x) motion.x = 0;
    if (r.y === me.y) motion.y = 0;
    me.x = r.x; me.y = r.y;
    if (moving && (motion.x || motion.y)) {
      me.dir = Math.atan2(motion.y, motion.x);
      me.anim = 'walk';
    } else {
      me.anim = 'idle';
    }
    if (isHost && authority) authority.applyMove(me.id, { x: me.x, y: me.y, dir: me.dir, anim: me.anim }, Date.now());
  } else {
    motion.x = motion.y = 0;
  }

  for (const p of players.values()) {
    if (p === me) { p.rx = p.x; p.ry = p.y; continue; }
    const k = Math.min(1, dt * 12);
    p.rx = p.rx == null ? p.x : p.rx + (p.x - p.rx) * k;
    p.ry = p.ry == null ? p.y : p.ry + (p.y - p.ry) * k;
  }

  moveAcc += dt * 1000;
  if (!isHost && me && net && net.up && moveAcc >= TICK.move) {
    moveAcc = 0;
    if (me.status === 'standing') sendHost({ t: 'mv', x: me.x, y: me.y, dir: me.dir, anim: me.anim }, false);
  }

  const nowMs = Date.now();
  for (const [mid, e] of [...pending]) {
    if (nowMs - e.at > TICK.retry) {
      if (e.tries >= TICK.retries) pending.delete(mid);
      else {
        e.tries++;
        e.at = nowMs;
        net.publish(T().c, Object.assign({ from: myUid }, e.msg));
      }
    }
  }

  hudAcc += dt * 1000;
  if (hudAcc >= 700) {
    hudAcc = 0;
    if (me) {
      refreshHud();
      renderPrompt();
      const el = document.getElementById('youBalance');
      if (el) el.textContent = me.balance;
    }
  }

  renderer.draw(me, players.values(), activity, dt);
}

window.addEventListener('resize', () => renderer.resize());

ui.setSound(sndOn);
ui.setName(savedName);
ui.setPid(myPid);
ui.stake(nextStake);
preloadSnd();
if (!sndOn) ui.setSound(false);
ui.showEntry('Ready.');

window.Brew = {
  version: 10,
  get me() { return me; },
  get authority() { return isHost ? authority : null; },
  get welcomes() { return welcomeN; },
  rejoin,
  get room() { return room; },
  get isHost() { return isHost; },
  get activity() { return activity; },
  get players() { return players; },
  get net() { return net; },
  get objects() { return objects; },
  get welcomed() { return welcomed; },
  enter, interact, startActivity, say,
  warp(x, y, uid) {
    if (uid && uid !== myUid) {
      if (!isHost || !authority) return false;
      const p = authority.players.get(uid);
      if (!p) return false;
      p.x = x; p.y = y; p.lastT = Date.now(); p.dirty = true;
      return true;
    }
    if (!me) return false;
    me.x = x; me.y = y; me.rx = x; me.ry = y; motion.x = motion.y = 0;
    if (isHost && authority) {
      const p = authority.players.get(myUid);
      if (p) { p.x = x; p.y = y; p.lastT = Date.now(); p.dirty = true; }
    }
    return true;
  },
  seatAt: id => SEAT_BY_ID.get(id),
  MAP, OBJECTS, SEATS
};

requestAnimationFrame(frame);
