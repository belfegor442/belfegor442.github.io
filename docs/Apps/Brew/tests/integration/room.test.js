import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../../server/config.js';
import { RoomManager } from '../../server/rooms/roomManager.js';
import {
  handleMove,
  handleMount,
  handleDismount,
  handleMachineInput,
  handleSabotage,
  handleChat,
  handleReady,
  handleStartMatch,
  handleStateSync,
} from '../../server/rooms/roomActions.js';
import { S2C, ERROR_CODES } from '../../shared/protocol.js';

function makeConnection(id) {
  return {
    id,
    state: 'OPEN',
    messages: [],
    send(message) {
      this.messages.push(message);
      return true;
    },
    sendLowPriority(message) {
      this.messages.push(message);
      return true;
    },
    close() {
      this.state = 'CLOSED';
    },
    events() {
      return this.messages.filter((m) => m.type === S2C.ROOM_EVENT);
    },
  };
}

function setup({ maxPlayers = 4 } = {}) {
  const config = loadConfig({ BREW_DB_ENABLED: 'false', BREW_LOG_LEVEL: 'error' });
  const manager = new RoomManager({ config, logger: null, metrics: null, store: null });
  const created = manager.create({ maxPlayers, name: 'Integration' });
  assert.equal(created.ok, true);
  const room = created.room;

  const conn1 = makeConnection('conn_1');
  const conn2 = makeConnection('conn_2');
  const profile1 = { id: 'p1', username: 'ada', displayName: 'Ada' };
  const profile2 = { id: 'p2', username: 'bob', displayName: 'Bob' };
  const join1 = manager.join(profile1, { roomId: room.id }, conn1);
  assert.equal(join1.ok, true);
  const join2 = manager.join(profile2, { roomId: room.id }, conn2);
  assert.equal(join2.ok, true);

  return {
    config,
    manager,
    room,
    conn1,
    conn2,
    profile1,
    profile2,
    p1: room.getPlayer('p1'),
    p2: room.getPlayer('p2'),
  };
}

test('two players join the same room and see each other', () => {
  const { room, conn1, conn2, p1, p2 } = setup();
  assert.equal(room.players.size, 2);
  assert.equal(room.hostId, 'p1');
  assert.equal(p1.host, true);
  assert.equal(p2.host, false);
  assert.notEqual(p1.stationIndex, p2.stationIndex, 'each player is assigned their own station');

  const joined = conn1.events().find((e) => e.event === 'PLAYER_JOINED');
  assert.ok(joined, 'the first player is told about the guest');
  assert.equal(joined.payload.player.id, 'p2');

  const snapshot = room.snapshot('p1');
  assert.equal(snapshot.players.length, 2);
  assert.deepEqual(snapshot.players.map((p) => p.id).sort(), ['p1', 'p2']);
  assert.equal(snapshot.machines.length, room.world.stations.length);
  assert.equal(snapshot.self.id, 'p1');
  assert.equal(snapshot.self.host, true);

  assert.equal(
    conn2.messages.some((m) => m.type === S2C.ROOM_SNAPSHOT || m.type === S2C.ROOM_STATE),
    false,
    'the guest has not pulled a snapshot yet',
  );
});

test('ready toggles drive the phase and the host starts the match', () => {
  const { room, conn1, conn2, p1, p2 } = setup();
  assert.equal(room.phase, 'ROOM_JOINED');

  assert.equal(handleReady(room, p1, { ready: true }).ok, true);
  assert.equal(room.phase, 'ROOM_JOINED', 'one ready player is not enough');

  assert.equal(handleReady(room, p2, { ready: true }).ok, true);
  assert.equal(room.phase, 'READY', 'everyone ready enters the ready window');

  const guestStart = handleStartMatch(room, p2);
  assert.equal(guestStart.ok, false);
  assert.equal(guestStart.code, ERROR_CODES.NOT_AUTHORIZED, 'only the host starts the match');

  assert.equal(handleStartMatch(room, p1).ok, true);
  assert.equal(room.phase, 'PLAYING');
  assert.equal(room.matchStarted, true);

  const readyEvents = conn2.events().filter((e) => e.event === 'PLAYER_READY');
  assert.equal(readyEvents.length, 2, 'both ready toggles were broadcast');
  assert.ok(conn1.events().some((e) => e.event === 'ROOM_PHASE'));
});

test('move intents are integrated by the room tick and broadcast as state', () => {
  const { room, conn2, p2 } = setup();
  const before = p2.x;
  const quiet = handleMove(room, p2, { dx: 1, dz: 0 });
  assert.equal(quiet.ok, true);
  assert.equal(quiet.quiet, true, 'moves never produce per-action acks');
  assert.equal(p2.intent.dx, 1);

  room.tickLoop(Date.now());
  assert.ok(p2.x > before, 'the authoritative position advanced');
  assert.equal(p2.anim, 'WALK');

  const moved = p2.x;
  handleMove(room, p2, { dx: 0, dz: 0 });
  room.tickLoop(Date.now());
  assert.equal(p2.x, moved, 'zero intent stops the walk');
  assert.equal(p2.anim, 'IDLE');

  room.tickLoop(Date.now());
  assert.ok(conn2.messages.some((m) => m.type === S2C.ROOM_STATE), 'state snapshots reach the guest');
  const state = conn2.messages.filter((m) => m.type === S2C.ROOM_STATE).at(-1);
  assert.ok(state.payload.players.some((p) => p.id === 'p2'));
});

test('mounting a station drives the machine through a full round', () => {
  const { room, conn1, conn2, p1 } = setup();
  const mount = handleMount(room, p1, { stationId: 0 });
  assert.equal(mount.ok, true);
  assert.equal(p1.stationId, 0);
  const station = room.stationById(0);
  assert.equal(station.occupiedBy, 'p1');

  const mountedEvent = conn2.events().find((e) => e.event === 'STATION_MOUNTED');
  assert.ok(mountedEvent, 'the guest sees the mount');
  assert.equal(mountedEvent.payload.stationId, 0);
  assert.equal(mountedEvent.payload.machine.controllerId, 'p1');

  const doubleMount = handleMount(room, p1, { stationId: 1 });
  assert.equal(doubleMount.ok, false, 'cannot mount twice');

  const spin = handleMachineInput(room, p1, { action: 'SPIN' }, 0);
  assert.equal(spin.ok, true);
  assert.equal(station.machine.phase, 'SPINNING');
  assert.ok(conn1.events().some((e) => e.event === 'MACHINE_SPIN'));

  const stop = handleMachineInput(room, p1, { action: 'STOP' }, 16);
  assert.equal(stop.ok, true);
  assert.ok(['PERFECT', 'GOOD', 'OK', 'MISS'].includes(stop.result.quality));
  assert.equal(station.machine.stats.stops, 1);
  assert.ok(conn2.events().some((e) => e.event === 'MACHINE_STOP'));
  assert.ok(conn1.events().some((e) => e.event === 'MACHINE_SYNC'), 'controller receives the machine snapshot');

  const stopTooFast = handleMachineInput(room, p1, { action: 'STOP' }, 16);
  assert.equal(stopTooFast.ok, false, 'spamming stop is rate gated');

  const dismount = handleDismount(room, p1);
  assert.equal(dismount.ok, true);
  assert.equal(p1.stationId, null);
  assert.equal(station.occupiedBy, null);
  assert.ok(conn2.events().some((e) => e.event === 'STATION_DISMOUNTED'));
});

test('chat broadcasts to the room but floods are rejected', () => {
  const { room, conn1, conn2, p1 } = setup();
  for (let i = 0; i < 5; i += 1) {
    const result = handleChat(room, p1, { text: `hello ${i}` });
    assert.equal(result.ok, true, `message ${i} accepted`);
  }
  const flood = handleChat(room, p1, { text: 'one too many' });
  assert.equal(flood.ok, false);
  assert.equal(flood.code, ERROR_CODES.RATE_LIMITED);

  const chats = conn2.events().filter((e) => e.event === 'CHAT');
  assert.equal(chats.length, 5);
  assert.equal(chats[0].payload.playerId, 'p1');
  assert.equal(chats.at(-1).payload.text, 'hello 4');
  assert.ok(conn1.events().some((e) => e.event === 'CHAT'), 'the sender sees their own chat');

  const empty = handleChat(room, p1, { text: '   ' });
  assert.equal(empty.ok, false);
  assert.equal(empty.code, ERROR_CODES.INVALID_PAYLOAD);
});

test('sabotage resolves between nearby players and spends mischief', () => {
  const { room, conn2, p1, p2 } = setup();
  const before = p1.mischief;
  const result = handleSabotage(room, p1, { action: 'THROW_BEER', targetPlayerId: 'p2' });
  assert.equal(result.ok, true);
  assert.equal(p1.mischief, before - 30);
  assert.equal(p1.stats.sabotageThrown, 1);
  assert.ok(p2.effects.some((e) => e.kind === 'SPLASH'));

  const thrown = conn2.events().find((e) => e.event === 'BEER_THROW');
  assert.ok(thrown, 'the guest sees the projectile');
  assert.equal(thrown.payload.targetId, 'p2');

  const cooldown = handleSabotage(room, p1, { action: 'THROW_BEER', targetPlayerId: 'p2' });
  assert.equal(cooldown.ok, false);
  assert.equal(cooldown.code, ERROR_CODES.COOLDOWN);

  room.tickLoop(Date.now());
  assert.ok(p1.stats.distanceWalked >= 0);
});

test('state sync hands back the authoritative snapshot', () => {
  const { room, conn1, p1 } = setup();
  handleStateSync(room, p1);
  const snapshot = conn1.messages.filter((m) => m.type === S2C.ROOM_SNAPSHOT).at(-1);
  assert.ok(snapshot, 'snapshot sent on request');
  assert.equal(snapshot.payload.self.id, 'p1');
  assert.equal(snapshot.payload.players.length, 2);
  assert.equal(snapshot.payload.machines.length, room.world.stations.length);
  assert.equal(snapshot.payload.room.code, room.code);
  assert.equal(typeof snapshot.roomSequence, 'number');
});

test('a player can leave and rejoin the same room', () => {
  const { manager, room, conn1, profile2 } = setup();
  const left = manager.leave(room, 'p2');
  assert.equal(left.id, 'p2');
  assert.equal(room.players.size, 1);
  assert.equal(room.hostId, 'p1', 'host is unchanged when the guest leaves');
  assert.ok(conn1.events().some((e) => e.event === 'PLAYER_LEFT'));

  const conn3 = makeConnection('conn_3');
  const rejoin = manager.join(profile2, { roomId: room.id }, conn3);
  assert.equal(rejoin.ok, true);
  assert.equal(room.players.size, 2);
  assert.equal(room.hostId, 'p1');
  assert.equal(room.getPlayer('p2').status, 'ONLINE');
  assert.equal(conn1.events().filter((e) => e.event === 'PLAYER_JOINED').length, 2);

  const duplicate = manager.join(profile2, { roomId: room.id }, conn3);
  assert.equal(duplicate.ok, false, 'a player cannot join twice');
  assert.equal(duplicate.code, ERROR_CODES.ALREADY_IN_ROOM);
});

test('room capacity is enforced', () => {
  const { manager, room } = setup({ maxPlayers: 2 });
  const extra = { id: 'p3', username: 'cat', displayName: 'Cat' };
  const conn3 = makeConnection('conn_3');
  const result = manager.join(extra, { roomId: room.id }, conn3);
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR_CODES.ROOM_FULL);

  const stranger = { id: 'p9', username: 'zoe', displayName: 'Zoe' };
  const fresh = manager.join(stranger, { roomId: 'NOPE' }, makeConnection('conn_9'));
  assert.equal(fresh.ok, true, 'joining with a bad code creates a room');
  assert.notEqual(fresh.room.id, room.id);
  manager.shutdown();
});
