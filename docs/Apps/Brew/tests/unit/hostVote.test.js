import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Host } from '../../src/state.js';
import { getScene } from '../../src/world.js';

function join(host, id, name, x, y) {
  const p = host.addPlayer({ id, name, pid: 'PC-' + id, seed: 1, skin: 'classic', x, y, dir: 0, balance: 1000 });
  assert.ok(p, 'player joined');
  return p;
}

// Lobby slot banks: slot-2 at x[46,99] y[375,525]. (130, 450) is ~31 from
// the face, inside PROX.interact + 10.
test('vote starts standing at a lobby vote point and teleports the lobby', () => {
  const host = new Host('T1');
  join(host, 'a', 'A', 130, 450);
  join(host, 'b', 'B', 900, 700);
  const res = host.startVote('a', 'slots');
  assert.equal(res.error, undefined);
  assert.equal(res.ok.t, 'vote.open');
  assert.equal(host.vote.kind, 'slots');
  // Second vote while one is running is refused.
  assert.deepEqual(host.startVote('b', 'dice'), { error: 'vote-running' });
  // No auto-accept: the starter must click too. 1/2 is not a majority yet.
  assert.deepEqual(host.castVote('a', true).msgs.length, 1);
  assert.equal(host.vote.accepted.size, 1);
  // b accepts → 2/2 → teleport everyone in the lobby.
  const msgs = host.castVote('b', true).msgs;
  const close = msgs.find(m => m.t === 'vote.close');
  const tp = msgs.find(m => m.t === 'scene.teleport');
  assert.ok(close && close.passed);
  assert.ok(tp && tp.scene === 'slots');
  assert.equal(tp.players.length, 2);
  assert.equal(host.vote, null);
  assert.equal(host.players.get('a').scene, 'slots');
  assert.equal(host.players.get('b').scene, 'slots');
  // Spawn points live inside the room bounds.
  const room = getScene('slots');
  for (const rec of tp.players) {
    assert.ok(rec.x > room.MAP.wall && rec.x < room.MAP.w - room.MAP.wall);
    assert.ok(rec.y > room.MAP.wall && rec.y < room.MAP.h - room.MAP.wall);
  }
});

test('solo starter passes by accepting alone (1 > 50%)', () => {
  const host = new Host('T1');
  join(host, 'a', 'A', 130, 450);
  host.startVote('a', 'slots');
  const msgs = host.castVote('a', true).msgs;
  const tp = msgs.find(m => m.t === 'scene.teleport');
  assert.ok(tp, 'teleport emitted');
  assert.equal(host.players.get('a').scene, 'slots');
});

test('declining keeps the vote open; timeout closes it failed', () => {
  const host = new Host('T1');
  join(host, 'a', 'A', 130, 450);
  join(host, 'b', 'B', 900, 700);
  host.startVote('a', 'slots');
  const msgs = host.castVote('b', false).msgs;
  assert.ok(msgs.find(m => m.t === 'vote.update'));
  assert.equal(host.vote.declined.size, 1);
  // a accepts alone: 1 yes of 2 is not a majority.
  host.castVote('a', true);
  assert.ok(host.vote, 'vote still open');
  const closed = host.tick(host.vote.deadline + 1);
  const c = closed.find(m => m.t === 'vote.close');
  assert.ok(c && c.passed === false);
  assert.equal(host.vote, null);
  assert.equal(host.players.get('a').scene, 'lobby');
});

test('vote away from every vote point is too-far; from a room is wrong-scene', () => {
  const host = new Host('T1');
  join(host, 'a', 'A', 1300, 700);
  assert.deepEqual(host.startVote('a', 'slots'), { error: 'too-far' });
  // Wrong kind at a valid point (standing at the slots banks, asking dice).
  host.players.get('a').x = 130;
  host.players.get('a').y = 450;
  assert.deepEqual(host.startVote('a', 'dice'), { error: 'too-far' });
  host.players.get('a').scene = 'dice';
  assert.deepEqual(host.startVote('a', 'dice'), { error: 'wrong-scene' });
});

test('double-vote is refused and seated players cannot start votes', () => {
  const host = new Host('T1');
  join(host, 'a', 'A', 130, 450);
  join(host, 'b', 'B', 1527, 216);
  host.sit('b', 't1-0');
  assert.deepEqual(host.startVote('b', 'slots'), { error: 'busy' });
  host.startVote('a', 'slots');
  host.castVote('a', true);
  assert.deepEqual(host.castVote('a', true), { error: 'already-voted' });
  assert.deepEqual(host.castVote('zzz', true), { error: 'wrong-scene' });
});

test('seated players are released when the vote passes', () => {
  const host = new Host('T1');
  join(host, 'a', 'A', 130, 450);
  const b = join(host, 'b', 'B', 1527, 216);
  host.sit('b', 't1-0');
  host.startVote('a', 'slots');
  host.castVote('a', true); // 1 yes of 2 lobby... b is still lobby-scene while seated
  // b is seated in the lobby but counts toward the lobby census; with b not
  // voting, 1/2 is not a majority. Seat him out of the way then accept both.
  host.stand('b');
  host.players.get('b').x = 130;
  host.players.get('b').y = 450;
  // vote already open; b accepts.
  const msgs = host.castVote('b', true).msgs;
  const tp = msgs.find(m => m.t === 'scene.teleport');
  assert.ok(tp);
  assert.equal(host.players.get('b').seat, null);
  assert.equal(host.players.get('b').status, 'standing');
  const lobbySeat = getScene('lobby').SEAT_BY_ID.get('t1-0');
  assert.equal(lobbySeat.occupiedBy, null);
});

test('exit portal returns a room player to the lobby', () => {
  const host = new Host('T1');
  const p = join(host, 'a', 'A', 450, 640);
  p.scene = 'dice';
  const e = getScene('dice').eject(450, 640);
  p.x = e.x; p.y = e.y;
  const res = host.exitRoom('a');
  assert.equal(res.error, undefined);
  const tp = res.msgs.find(m => m.t === 'scene.teleport');
  assert.equal(tp.scene, 'lobby');
  assert.equal(host.players.get('a').scene, 'lobby');
  // Already in the lobby → wrong-scene.
  assert.deepEqual(host.exitRoom('a'), { error: 'wrong-scene' });
});
