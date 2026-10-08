import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PlayerStore, normalizeRecord } from '../../server/persistence/playerStore.js';

function tempFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brew-store-'));
  return path.join(dir, 'players.json');
}

test('disabled store never touches the disk', async () => {
  const filePath = tempFile();
  const store = new PlayerStore({ filePath, enabled: false });
  await store.init();
  const record = store.create({ playerId: 'p1', username: 'Ada' });
  assert.equal(record.id, 'p1');
  store.markDirty('p1');
  store.update('p1', (r) => {
    r.stats.gamesPlayed = 3;
  });
  await store.flush();
  await store.close();
  assert.equal(fs.existsSync(filePath), false);
});

test('create, update and flush round-trip through the file', async () => {
  const filePath = tempFile();
  const store = new PlayerStore({ filePath, enabled: true });
  await store.init();
  store.create({ playerId: 'p1', username: 'Ada' });
  store.create({ playerId: 'p2', username: 'Bob' });
  store.update('p1', (record) => {
    record.stats.scoreTotal = 4200;
    record.progression.xp = 55;
  });
  await store.flush();
  assert.equal(fs.existsSync(filePath), true);
  assert.equal(store.writes >= 1, true);

  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  assert.equal(raw.version, 1);
  assert.equal(raw.players.length, 2);
  const ada = raw.players.find((r) => r.id === 'p1');
  assert.equal(ada.stats.scoreTotal, 4200);
  assert.equal(ada.progression.xp, 55);

  const reloaded = new PlayerStore({ filePath, enabled: true });
  await reloaded.init();
  assert.equal(reloaded.get('p1').stats.scoreTotal, 4200);
  assert.equal(reloaded.get('p2').username, 'Bob');
  await reloaded.close();
  await store.close();
});

test('username lookup is case-insensitive and idempotent', async () => {
  const filePath = tempFile();
  const store = new PlayerStore({ filePath, enabled: false });
  await store.init();
  const first = store.create({ playerId: 'p1', username: 'Ada' });
  const again = store.create({ playerId: 'other', username: 'ADA' });
  assert.equal(again.id, first.id, 'duplicate usernames return the existing record');
  assert.equal(store.get('other'), null);
  assert.equal(store.findByUsername('aDa').id, 'p1');
  assert.equal(store.findByUsername('nobody'), null);
  assert.equal(store.getOrCreate({ playerId: 'p1', username: 'Ada' }).id, 'p1');
  await store.close();
});

test('update on an unknown id returns null and writes nothing', async () => {
  const store = new PlayerStore({ filePath: tempFile(), enabled: true });
  await store.init();
  assert.equal(store.update('ghost', (r) => {
    r.stats.gamesPlayed = 1;
  }), null);
  assert.equal(store.dirty.size, 0);
  await store.close();
});

test('corrupt files do not crash the store', async () => {
  const filePath = tempFile();
  fs.writeFileSync(filePath, '{ not json', 'utf8');
  const errors = [];
  const store = new PlayerStore({
    filePath,
    enabled: true,
    logger: { info() {}, error(_msg, meta) { errors.push(meta); } },
  });
  await store.init();
  assert.equal(store.all().length, 0);
  assert.equal(errors.length, 1);
  assert.equal(store.ioErrors, 1);
  await store.close();
});

test('normalizeRecord fills every profile field', () => {
  const record = normalizeRecord({ id: 'p9', username: 'Zed' });
  assert.equal(record.displayName, 'Zed');
  assert.equal(typeof record.createdAt, 'number');
  assert.ok(Array.isArray(record.achievements));
  assert.deepEqual(record.progression, { xp: 0, level: 1 });
  assert.equal(record.stats.bestScore, 0);
  assert.equal(record.stats.sabotageThrown, 0);
  assert.ok(record.preferences.sound === true);
  assert.ok(record.avatar.color);
  const custom = normalizeRecord({
    id: 'p10',
    username: 'Zed',
    stats: { bestScore: 999 },
    progression: { xp: 10, level: 4 },
    achievements: ['first_pour'],
  });
  assert.equal(custom.stats.bestScore, 999);
  assert.equal(custom.stats.gamesPlayed, 0, 'defaults survive partial overrides');
  assert.equal(custom.progression.level, 4);
  assert.deepEqual(custom.achievements, ['first_pour']);
});
