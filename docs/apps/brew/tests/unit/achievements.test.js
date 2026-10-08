import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACHIEVEMENTS,
  evaluateAchievements,
  xpForLevel,
  applyProgression,
} from '../../server/game/achievements.js';

const EMPTY = {
  rounds: 0,
  perfects: 0,
  maxCombo: 0,
  overbrewSuccess: 0,
  overbrewFail: 0,
  bestScore: 0,
  sabotageHit: 0,
  challengesWon: 0,
  gamesPlayed: 0,
  distanceWalked: 0,
};

test('no stats unlock nothing', () => {
  const result = evaluateAchievements({ ...EMPTY });
  assert.equal(result.gained.length, 0);
  assert.deepEqual(result.unlocked, []);
});

test('thresholds unlock exactly the matching achievements', () => {
  const stats = {
    ...EMPTY,
    rounds: 1,
    perfects: 25,
    maxCombo: 4,
    overbrewSuccess: 1,
    bestScore: 5000,
    sabotageHit: 20,
    challengesWon: 5,
    gamesPlayed: 25,
    distanceWalked: 5000,
  };
  const result = evaluateAchievements(stats);
  const gainedIds = result.gained.map((a) => a.id).sort();
  assert.deepEqual(gainedIds, [
    'combo_x4',
    'duelist',
    'first_pour',
    'high_score_5k',
    'night_owl',
    'pub_brawler',
    'regular',
    'sharp_stopper',
    'overbrewer',
  ].sort());
  assert.equal(result.unlocked.length, result.gained.length);
});

test('already unlocked achievements are not re-awarded', () => {
  const stats = { ...EMPTY, rounds: 3 };
  const first = evaluateAchievements(stats);
  assert.equal(first.gained.length, 1);
  const second = evaluateAchievements(stats, first.unlocked);
  assert.equal(second.gained.length, 0);
  assert.deepEqual(second.unlocked, first.unlocked);
});

test('partial progress stays locked until the exact threshold', () => {
  assert.equal(evaluateAchievements({ ...EMPTY, perfects: 24 }).gained.length, 0);
  assert.equal(
    evaluateAchievements({ ...EMPTY, perfects: 25 }).gained.some((a) => a.id === 'sharp_stopper'),
    true,
  );
  const near = evaluateAchievements({ ...EMPTY, bestScore: 19999 });
  assert.equal(near.gained.some((a) => a.id === 'high_score_5k'), true, 'lower tier still unlocks');
  assert.equal(near.gained.some((a) => a.id === 'high_score_20k'), false, 'top tier still locked');
  assert.equal(
    evaluateAchievements({ ...EMPTY, bestScore: 20000 }).gained.some((a) => a.id === 'high_score_20k'),
    true,
  );
});

test('achievement catalogue stays unique and well formed', () => {
  const ids = ACHIEVEMENTS.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length, 'no duplicate ids');
  for (const achievement of ACHIEVEMENTS) {
    assert.equal(typeof achievement.name, 'string');
    assert.ok(achievement.name.length > 0);
    assert.equal(typeof achievement.description, 'string');
    assert.equal(typeof achievement.test, 'function');
  }
  assert.equal(ACHIEVEMENTS.length >= 12, true);
});

test('xpForLevel grows monotonically', () => {
  let previous = 0;
  for (let level = 1; level <= 30; level += 1) {
    const needed = xpForLevel(level);
    assert.ok(needed >= previous, `level ${level} never asks for less`);
    previous = needed;
  }
  assert.equal(xpForLevel(1), 120);
});

test('applyProgression banks xp and crosses levels', () => {
  const start = { xp: 0, level: 1 };
  const barely = applyProgression(start, 119);
  assert.deepEqual(barely, { xp: 119, level: 1 });

  const levelled = applyProgression(barely, 1);
  assert.equal(levelled.level, 2);
  assert.equal(levelled.xp, 0, 'spent the level-1 threshold');

  const multi = applyProgression({ xp: 0, level: 1 }, 10_000);
  assert.ok(multi.level > 2, 'huge grants can skip several levels');
  assert.ok(multi.xp < xpForLevel(multi.level), 'remainder always fits the next level');

  const untouched = applyProgression({ xp: 5, level: 7 }, 0);
  assert.deepEqual(untouched, { xp: 5, level: 7 });
  assert.equal(start.xp, 0, 'inputs are never mutated');
});
