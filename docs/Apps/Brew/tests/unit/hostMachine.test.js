import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Host } from '../../src/state.js';

function join(host, id, name, x, y) {
  const p = host.addPlayer({ id, name, pid: 'PC-' + id, seed: 1, skin: 'classic', x, y, dir: 0, balance: 1000 });
  assert.ok(p, 'player joined');
  return p;
}

// Slot-bank rects: x[46,99] y[375,525] for slot-2 (map.js slotBank layout).
// Standing at x=130 is 31 from the cabinet face, inside PROX.interact + 10.
test('slots start standing at a slot machine', () => {
  const host = new Host('T1');
  join(host, 'a', 'A', 130, 450);
  const res = host.startActivity('slots', 'a', { stake: 25 });
  assert.equal(res.error, undefined);
  assert.ok(res.ok);
  assert.equal(host.activity.kind, 'slots');
  assert.equal(host.activity.table, 'slot-2');
  assert.deepEqual(host.activity.players, ['a']);
  assert.equal(host.activity.stake, 25);
  assert.equal(host.players.get('a').status, 'activity');
  assert.deepEqual(host.startActivity('slots', 'a', {}), { error: 'activity-running' });
  host.endActivity('done');
  assert.equal(host.activity, null);
  assert.equal(host.players.get('a').status, 'standing');
});

test('slots start away from every slot bank is too-far', () => {
  const host = new Host('T1');
  join(host, 'a', 'A', 700, 650);
  assert.deepEqual(host.startActivity('slots', 'a', { stake: 25 }), { error: 'too-far' });
});

test('slots start while seated is busy', () => {
  const host = new Host('T1');
  const p = join(host, 'a', 'A', 130, 450);
  p.status = 'seated';
  assert.deepEqual(host.startActivity('slots', 'a', {}), { error: 'busy' });
});

test('table games still require a seat', () => {
  const host = new Host('T1');
  join(host, 'a', 'A', 130, 450);
  assert.deepEqual(host.startActivity('dice', 'a', {}), { error: 'must-sit' });
});
