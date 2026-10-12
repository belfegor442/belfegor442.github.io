import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Registry } from '../../src/activities.js';

function makeHost(balances) {
  const players = new Map();
  for (const [id, b] of Object.entries(balances)) players.set(id, { id, balance: b, dirty: false });
  return { players };
}

function makeAct(kind, ids, stake) {
  return { kind, players: ids, stake, inputs: {}, data: {} };
}

// Math.random stub: dice calls it four times (2 per player) when the second
// player picks. Values map to 1 + floor(r * 6).
function withRandom(values, fn) {
  const orig = Math.random;
  let i = 0;
  Math.random = () => values[i++ % values.length];
  try { return fn(); } finally { Math.random = orig; }
}

test('dice is registered and sized for heads-up', () => {
  const d = Registry.dice;
  assert.ok(d, 'dice registered');
  assert.equal(d.minPlayers, 2);
  assert.equal(d.maxPlayers, 2);
  assert.equal(d.choices.length, 1);
  assert.equal(d.choices[0].v, 'roll');
  assert.ok(d.prompt);
});

test('dice validate checks players and balances', () => {
  const d = Registry.dice;
  assert.equal(d.validate(makeHost({ a: 100, b: 100 }), makeAct('dice', ['a', 'b'], 25)), null);
  assert.equal(d.validate(makeHost({ a: 100 }), makeAct('dice', ['a'], 25)), 'need-two-players');
  assert.equal(d.validate(makeHost({ a: 100, b: 0 }), makeAct('dice', ['a', 'b'], 25)), 'no-balance');
  assert.equal(d.validate(makeHost({ a: 100 }), makeAct('dice', ['a', 'ghost'], 25)), 'unknown-player');
});

test('dice waits for both players and rejects bad or repeated picks', () => {
  const host = makeHost({ a: 100, b: 100 });
  const act = makeAct('dice', ['a', 'b'], 25);
  const d = Registry.dice;
  assert.deepEqual(d.input(host, act, 'a', { side: 'nope' }), { error: 'bad-pick' });
  assert.deepEqual(d.input(host, act, 'a', { pick: 'roll' }), {});
  assert.deepEqual(d.input(host, act, 'a', { pick: 'roll' }), { error: 'already-picked' });
  assert.equal(act.data.totals, undefined, 'no rolls until both picked');
});

test('dice settles zero-sum: higher total wins the pot', () => {
  // a rolls 1+1 = 2, b rolls 6+6 = 12
  withRandom([0, 0, 0.99, 0.99], () => {
    const host = makeHost({ a: 100, b: 100 });
    const act = makeAct('dice', ['a', 'b'], 25);
    const d = Registry.dice;
    d.input(host, act, 'a', { pick: 'roll' });
    const res = d.input(host, act, 'b', { pick: 'roll' });
    assert.equal(res.done, true);
    assert.equal(res.update.result, '2 vs 12');
    assert.equal(host.players.get('a').balance, 75);
    assert.equal(host.players.get('b').balance, 125);
    const sum = [...host.players.values()].reduce((s, p) => s + p.balance, 0);
    assert.equal(sum, 200, 'chips are conserved');
  });
});

test('dice pushes on equal totals', () => {
  withRandom([0, 0, 0, 0], () => {
    const host = makeHost({ a: 100, b: 100 });
    const act = makeAct('dice', ['a', 'b'], 25);
    const d = Registry.dice;
    d.input(host, act, 'a', { pick: 'roll' });
    const res = d.input(host, act, 'b', { pick: 'roll' });
    assert.equal(res.done, true);
    assert.equal(res.update.result, '2 vs 2');
    assert.equal(host.players.get('a').balance, 100);
    assert.equal(host.players.get('b').balance, 100);
  });
});
