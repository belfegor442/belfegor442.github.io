import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Host } from '../../src/state.js';
import { getScene } from '../../src/world.js';

function join(host, id, name, x, y, scene) {
  const p = host.addPlayer({ id, name, pid: 'PC-' + id, seed: 1, skin: 'classic', x, y, dir: 0, balance: 1000 });
  assert.ok(p, 'player joined');
  if (scene) {
    p.scene = scene;
    const W = getScene(scene);
    const e = W.eject(x, y);
    p.x = e.x; p.y = e.y;
  }
  return p;
}

// Slots room cabinets: sm-0 at x[92,168] y[70,114]. Standing at (130, 140)
// is ~26 from the face, inside PROX.interact + 10.
function inSlotsRoom(host, id, name) {
  return join(host, id, name, 130, 140, 'slots');
}

test('machine start opens a session standing at a cabinet', () => {
  const host = new Host('T1');
  inSlotsRoom(host, 'a', 'A');
  const res = host.machineStart('a', 'slots', 25);
  assert.equal(res.error, undefined);
  assert.equal(res.ok.t, 'machine.open');
  assert.equal(host.machines.size, 1);
  assert.equal(host.players.get('a').status, 'machine');
  assert.equal(host.machines.get('a').stake, 25);
  assert.deepEqual(host.machineStart('a', 'slots', 25), { error: 'busy' });
});

test('machine start in the lobby or away from cabinets fails', () => {
  const host = new Host('T1');
  join(host, 'a', 'A', 700, 650, 'lobby');
  assert.deepEqual(host.machineStart('a', 'slots', 25), { error: 'wrong-scene' });
  const host2 = new Host('T2');
  inSlotsRoom(host2, 'b', 'B');
  host2.players.get('b').x = 450;
  host2.players.get('b').y = 400;
  assert.deepEqual(host2.machineStart('b', 'slots', 25), { error: 'too-far' });
});

test('spin deducts the stake, stops pay by quality, round pays out', () => {
  const host = new Host('T1');
  const p = inSlotsRoom(host, 'a', 'A');
  host.machineStart('a', 'slots', 25);
  const spinRes = host.machineSpin('a', 25);
  assert.equal(spinRes.ok.t, 'machine.spin');
  assert.equal(p.balance, 975);
  // Stop each reel with zero latency. The base angle is random, so quality
  // varies; the invariants are: no error, reels lock one by one, and a full
  // round either pays winnings or leaves the stake lost (never both).
  const before = p.balance;
  let last = null;
  for (let reel = 0; reel < 3; reel++) {
    const res = host.machineStop('a', reel, 0);
    assert.ok(res.msgs || res.error, 'stop answered');
    if (res.error) {
      // minStopIntervalMs may reject a same-tick stop; wait it out.
      assert.equal(res.error, 'busy');
      const t = host.machines.get('a');
      t.lastStopAt = 0;
      const retry = host.machineStop('a', reel, 0);
      assert.ok(retry.msgs, 'retry succeeded');
      last = retry.msgs[0];
    } else {
      last = res.msgs[0];
    }
  }
  assert.equal(last.t, 'machine.update');
  assert.equal(host.machines.get('a').phase, 'idle');
  assert.ok(p.balance >= before - 25 && p.balance <= before - 25 + 500, 'payout in range');
  assert.equal(host.players.get('a').status, 'machine');
  // Close returns the player to standing.
  const msgs = host.closeMachine('a', true);
  assert.equal(msgs[0].t, 'machine.close');
  assert.equal(host.players.get('a').status, 'standing');
  assert.equal(host.machines.size, 0);
});

test('spin without a session, or while seated, fails', () => {
  const host = new Host('T1');
  const p = inSlotsRoom(host, 'a', 'A');
  assert.deepEqual(host.machineSpin('a', 25), { error: 'no-machine' });
  p.status = 'seated';
  host.machineStart('a', 'slots', 25); // busy (seated) — no session
  assert.equal(host.machines.size, 0);
});

test('wrong reel order is bad-pick', () => {
  const host = new Host('T1');
  inSlotsRoom(host, 'a', 'A');
  host.machineStart('a', 'slots', 25);
  host.machineSpin('a', 25);
  const res = host.machineStop('a', 2, 0);
  assert.equal(res.error, 'bad-pick');
});

test('table games in a room still require a seat in that room', () => {
  const host = new Host('T1');
  join(host, 'a', 'A', 250, 400, 'dice');
  assert.deepEqual(host.startActivity('dice', 'a', {}), { error: 'must-sit' });
  // Seated in the lobby cannot start a room game either.
  const b = join(host, 'b', 'B', 1527, 216, 'lobby');
  b.status = 'seated'; b.seat = 't1-0';
  assert.deepEqual(host.startActivity('dice', 'b', {}), { error: 'wrong-scene' });
});
