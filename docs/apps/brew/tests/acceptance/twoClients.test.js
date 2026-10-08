import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../../server/config.js';
import { createApp } from '../../server/index.js';

let app = null;
let base = '';
let wsUrl = '';
let alice = null;
let bob = null;
let aliceAuth = null;
let bobAuth = null;
let aliceTokens = null;
let roomCode = '';
let bobStation = -1;

class Client {
  constructor(name) {
    this.name = name;
    this.queue = [];
    this.waiters = [];
    this.history = [];
    this.requestSeq = 0;
  }

  async connect(tokens) {
    this.ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', reject, { once: true });
    });
    this.ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      this.history.push(message);
      this.queue.push(message);
      for (let i = this.waiters.length - 1; i >= 0; i -= 1) {
        const waiter = this.waiters[i];
        const found = this.queue.find(waiter.match);
        if (found) {
          this.queue = this.queue.filter((m) => m !== found);
          this.waiters.splice(i, 1);
          waiter.resolve(found);
        }
      }
    });
    this.send({
      type: 'HELLO',
      requestId: `req-${this.name}-hello`,
      payload: { ...tokens, clientVersion: 'acceptance', protocol: 1 },
    });
    const established = await this.waitFor((m) => m.type === 'SESSION_ESTABLISHED', 5000, 'SESSION_ESTABLISHED');
    this.playerId = established.payload.playerId;
    this.tokens = {
      sessionToken: established.payload.sessionToken,
      reconnectToken: established.payload.reconnectToken,
    };
    return established;
  }

  send(object) {
    this.ws.send(JSON.stringify(object));
  }

  request(type, payload = {}) {
    const requestId = `req-${this.name}-${(this.requestSeq += 1)}`;
    this.send({ type, requestId, payload });
    return requestId;
  }

  waitFor(match, timeoutMs = 5000, label = 'message') {
    const existing = this.queue.find(match);
    if (existing) {
      this.queue = this.queue.filter((m) => m !== existing);
      return Promise.resolve(existing);
    }
    return new Promise((resolve, reject) => {
      const waiter = { match, resolve };
      this.waiters.push(waiter);
      setTimeout(() => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        const recent = this.history
          .filter((m) => m.type !== 'ROOM_STATE')
          .slice(-8)
          .map((m) => `${m.type}${m.event ? `:${m.event}` : ''}${m.code ? `:${m.code}` : ''}`);
        reject(new Error(`${this.name}: timeout waiting for ${label}; recent=${JSON.stringify(recent)}`));
      }, timeoutMs);
    });
  }

  queued(match) {
    return this.queue.some(match);
  }

  close() {
    this.ws.close();
  }
}

async function auth(username) {
  const response = await fetch(`${base}/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username }),
  });
  assert.equal(response.ok, true, `auth failed: ${response.status}`);
  return response.json();
}

before(async () => {
  const config = loadConfig({
    BREW_PORT: '0',
    BREW_HOST: '127.0.0.1',
    BREW_DB_ENABLED: 'false',
    BREW_LOG_LEVEL: 'error',
    BREW_SERVE_STATIC: 'false',
  });
  app = await createApp({ config });
  await app.start();
  const port = app.httpServer.address().port;
  base = `http://127.0.0.1:${port}`;
  wsUrl = `ws://127.0.0.1:${port}/ws`;
});

after(async () => {
  alice?.close();
  bob?.close();
  if (app) await app.stop();
});

test('both clients authenticate with distinct identities', async () => {
  aliceAuth = await auth('Ada Lovelace');
  bobAuth = await auth('Grace Hopper');
  assert.notEqual(aliceAuth.playerId, bobAuth.playerId);
  assert.equal(aliceAuth.profile.username, 'Ada Lovelace');
  assert.ok(aliceAuth.sessionToken && aliceAuth.reconnectToken);
});

test('first client establishes a session and creates a room', async () => {
  alice = new Client('alice');
  const established = await alice.connect({
    sessionToken: aliceAuth.sessionToken,
    reconnectToken: aliceAuth.reconnectToken,
  });
  assert.equal(established.payload.playerId, aliceAuth.playerId);
  assert.equal(established.payload.profile.username, 'Ada Lovelace');

  const createId = alice.request('CREATE_ROOM', { maxPlayers: 4, name: 'Acceptance' });
  const ack = await alice.waitFor((m) => m.type === 'ACK' && m.requestId === createId, 5000, 'CREATE_ROOM ack');
  assert.equal(ack.payload.ok, true);
  const snapshot = await alice.waitFor((m) => m.type === 'ROOM_SNAPSHOT', 5000, 'room snapshot');
  roomCode = snapshot.payload.room.code;
  assert.equal(snapshot.payload.self.host, true);
  assert.ok(snapshot.payload.players.some((p) => p.id === alice.playerId));
  assert.ok(snapshot.payload.room.world.stations.some((s) => s.assignedTo === alice.playerId));
  assert.equal(snapshot.payload.machines.length, snapshot.payload.room.world.stations.length);
});

test('second client discovers and joins the same room', async () => {
  bob = new Client('bob');
  await bob.connect({
    sessionToken: bobAuth.sessionToken,
    reconnectToken: bobAuth.reconnectToken,
  });

  const listId = bob.request('ROOM_LIST');
  const list = await bob.waitFor((m) => m.type === 'ROOM_LIST_RESULT' && m.requestId === listId, 5000, 'room list');
  assert.ok(list.payload.rooms.some((r) => r.code === roomCode));

  const joinId = bob.request('JOIN_ROOM', { roomCode });
  const ack = await bob.waitFor((m) => m.type === 'ACK' && m.requestId === joinId, 5000, 'JOIN_ROOM ack');
  assert.equal(ack.payload.ok, true);
  assert.equal(ack.payload.code, roomCode);
  bobStation = ack.payload.stationIndex;

  const snapshot = await bob.waitFor((m) => m.type === 'ROOM_SNAPSHOT', 5000, 'bob snapshot');
  assert.ok(snapshot.payload.players.some((p) => p.id === alice.playerId));
  assert.equal(snapshot.payload.self.host, false);
  assert.equal(snapshot.payload.self.stationId, null, 'not mounted on join');
  assert.ok(
    snapshot.payload.room.world.stations.some((s) => s.assignedTo === bob.playerId),
    'guest gets a station assignment',
  );

  const joined = await alice.waitFor(
    (m) => m.type === 'ROOM_EVENT' && m.event === 'PLAYER_JOINED' && m.payload.player.id === bob.playerId,
    5000,
    'PLAYER_JOINED',
  );
  assert.ok(joined.roomSequence > 0, 'join event is sequenced');
});

test('movement is authoritative and visible to the other client', async () => {
  bob.request('MOVE', { dx: 1, dz: 0 });
  await new Promise((resolve) => setTimeout(resolve, 400));
  bob.request('MOVE', { dx: 0, dz: 0 });

  const bobSawWalk = await bob
    .waitFor(
      (m) => m.type === 'ROOM_STATE' && m.payload.players.some((p) => p.id === bob.playerId && p.anim === 'WALK'),
      5000,
      'bob walking state',
    )
    .catch(() => null);
  assert.ok(bobSawWalk, 'the mover receives its own walk state');

  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.ok(
    alice.queued((m) => m.type === 'ROOM_STATE' && m.payload.players.some((p) => p.id === bob.playerId)),
    'the other client receives the position delta',
  );
});

test('guest mounts a station and plays a machine round', async () => {
  const invalid = bob.request('MOUNT_STATION', { stationId: 99 });
  const error = await bob.waitFor((m) => m.type === 'ERROR' && m.requestId === invalid, 5000, 'invalid mount');
  assert.ok(['INVALID_PAYLOAD', 'INVALID_TARGET', 'OUT_OF_RANGE'].includes(error.code), error.code);

  const mountId = bob.request('MOUNT_STATION', { stationId: bobStation });
  const ack = await bob.waitFor((m) => m.type === 'ACK' && m.requestId === mountId, 5000, 'mount ack');
  assert.equal(ack.payload.ok, true);
  const mounted = await alice.waitFor(
    (m) => m.type === 'ROOM_EVENT' && m.event === 'STATION_MOUNTED' && m.payload.playerId === bob.playerId,
    5000,
    'STATION_MOUNTED',
  );
  assert.equal(mounted.payload.machine.controllerId, bob.playerId);

  const spinId = bob.request('MACHINE_INPUT', { action: 'SPIN', clientTime: Date.now() });
  const spinAck = await bob.waitFor((m) => m.type === 'ACK' && m.requestId === spinId, 5000, 'spin ack');
  assert.equal(spinAck.payload.ok, true);
  const spinEvent = await alice.waitFor(
    (m) => m.type === 'ROOM_EVENT' && m.event === 'MACHINE_SPIN',
    5000,
    'MACHINE_SPIN broadcast to the room',
  );
  assert.equal(spinEvent.payload.stationId, bobStation);
  const sync = await bob.waitFor(
    (m) => m.type === 'ROOM_EVENT' && m.event === 'MACHINE_SYNC' && m.payload.phase === 'SPINNING',
    5000,
    'MACHINE_SYNC spinning',
  );
  assert.ok(sync.payload.reels.some((reel) => !reel.stopped));

  await new Promise((resolve) => setTimeout(resolve, 200));
  const stopId = bob.request('MACHINE_INPUT', { action: 'STOP', clientTime: Date.now() });
  const stopAck = await bob.waitFor((m) => m.type === 'ACK' && m.requestId === stopId, 5000, 'stop ack');
  assert.equal(stopAck.payload.ok, true);
  const stopped = await alice.waitFor(
    (m) => m.type === 'ROOM_EVENT' && m.event === 'MACHINE_STOP',
    5000,
    'MACHINE_STOP broadcast',
  );
  assert.ok(['PERFECT', 'GOOD', 'OK', 'MISS'].includes(stopped.payload.quality), stopped.payload.quality);
});

test('sabotage and chat travel between the clients', async () => {
  const throwId = alice.request('SABOTAGE', { action: 'THROW_BEER', targetPlayerId: bob.playerId });
  const ack = await alice.waitFor((m) => m.type === 'ACK' && m.requestId === throwId, 5000, 'sabotage ack');
  assert.equal(ack.payload.ok, true);
  const hit = await bob.waitFor(
    (m) => m.type === 'ROOM_EVENT' && m.event === 'BEER_THROW' && m.payload.targetId === bob.playerId,
    5000,
    'BEER_THROW',
  );
  assert.equal(hit.payload.senderId, alice.playerId);
  assert.equal(hit.payload.effect, 'SPLASH');
  const spent = await alice.waitFor(
    (m) => m.type === 'ROOM_EVENT' && m.event === 'MISCHIEF_CHANGED' && m.payload.playerId === alice.playerId,
    5000,
    'MISCHIEF_CHANGED',
  );
  assert.ok(spent.payload.mischief <= 70, `mischief spent: ${spent.payload.mischief}`);

  bob.request('CHAT', { text: 'cheers everyone' });
  const chat = await alice.waitFor(
    (m) => m.type === 'ROOM_EVENT' && m.event === 'CHAT' && m.payload.playerId === bob.playerId,
    5000,
    'CHAT event',
  );
  assert.equal(chat.payload.text, 'cheers everyone');
  assert.ok(
    bob.queued((m) => m.type === 'ROOM_EVENT' && m.event === 'CHAT') || chat.roomSequence > 0,
    'chat was sequenced into the room stream',
  );
});

test('disconnect and reconnect restore authoritative state', async () => {
  aliceTokens = { ...alice.tokens };
  alice.close();
  await new Promise((resolve) => setTimeout(resolve, 500));

  const disconnected = await bob.waitFor(
    (m) => m.type === 'ROOM_EVENT' && m.event === 'PLAYER_DISCONNECTED' && m.payload.playerId === alice.playerId,
    5000,
    'PLAYER_DISCONNECTED',
  );
  assert.ok(disconnected.payload.graceMs > 0, 'a reconnect grace window is announced');

  const reconnected = new Client('alice-re');
  const established = await reconnected.connect(aliceTokens);
  assert.equal(established.payload.playerId, aliceAuth.playerId);
  assert.equal(established.payload.rejoined, true);

  const snapshot = await reconnected.waitFor((m) => m.type === 'ROOM_SNAPSHOT', 5000, 'resume snapshot');
  assert.equal(snapshot.payload.room.code, roomCode, 'same room after reconnect');
  assert.ok(snapshot.payload.players.some((p) => p.id === bob.playerId), 'peer still present');
  const guest = snapshot.payload.players.find((p) => p.id === bob.playerId);
  assert.equal(guest.status, 'ONLINE');
  assert.equal(guest.stationId, bobStation, 'guest station assignment survived');
  assert.ok(
    snapshot.payload.machines.some((m) => m.controllerId === bob.playerId),
    'machine session survived the reconnect',
  );

  await bob.waitFor(
    (m) => m.type === 'ROOM_EVENT' && m.event === 'PLAYER_RECONNECTED' && m.payload.playerId === alice.playerId,
    5000,
    'PLAYER_RECONNECTED',
  );

  alice = reconnected;
});

test('ready flow starts the match for both players', async () => {
  const readyId = alice.request('SET_READY', { ready: true });
  const ack = await alice.waitFor((m) => m.type === 'ACK' && m.requestId === readyId, 5000, 'ready ack');
  assert.equal(ack.payload.ok, true);
  const readyEvent = await bob.waitFor(
    (m) => m.type === 'ROOM_EVENT' && m.event === 'PLAYER_READY' && m.payload.playerId === alice.playerId,
    5000,
    'PLAYER_READY',
  );
  assert.equal(readyEvent.payload.ready, true);

  const bobReadyId = bob.request('SET_READY', { ready: true });
  await bob.waitFor((m) => m.type === 'ACK' && m.requestId === bobReadyId, 5000, 'bob ready ack');

  const startId = alice.request('START_MATCH');
  const startAck = await alice.waitFor((m) => m.type === 'ACK' && m.requestId === startId, 5000, 'start ack');
  assert.equal(startAck.payload.ok, true);
  const phase = await alice.waitFor(
    (m) => m.type === 'ROOM_EVENT' && m.event === 'ROOM_PHASE' && m.payload.phase === 'PLAYING',
    5000,
    'ROOM_PHASE PLAYING',
  );
  assert.equal(phase.payload.previous, 'READY', 'match follows the ready window');
});

test('guest leaves and the host is notified', async () => {
  const leaveId = bob.request('LEAVE_ROOM');
  const ack = await bob.waitFor((m) => m.type === 'ACK' && m.requestId === leaveId, 5000, 'leave ack');
  assert.equal(ack.payload.left, true);
  const left = await alice.waitFor(
    (m) => m.type === 'ROOM_EVENT' && m.event === 'PLAYER_LEFT' && m.payload.playerId === bob.playerId,
    5000,
    'PLAYER_LEFT',
  );
  assert.equal(left.payload.playerId, bob.playerId);
  bob.close();

  const health = await fetch(`${base}/healthz`).then((r) => r.json());
  assert.equal(health.ok, true);
  assert.ok(health.rooms >= 0);
});
