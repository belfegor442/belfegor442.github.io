import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findPath, gridBlocked } from '../../src/path.js';

function makeNav(cols, rows, walls = [], cell = 16) {
  const block = new Uint8Array(cols * rows);
  for (const [x0, y0, x1, y1] of walls) {
    for (let cz = 0; cz < rows; cz++) {
      for (let cx = 0; cx < cols; cx++) {
        const x = cx * cell + cell / 2, y = cz * cell + cell / 2;
        if (x >= x0 && x <= x1 && y >= y0 && y <= y1) block[cz * cols + cx] = 1;
      }
    }
  }
  return { cell, cols, rows, block };
}

test('findPath walks around a wall', () => {
  // 20x10 cells (320x160), vertical wall through the middle with a gap at top
  const nav = makeNav(20, 10, [[150, -10, 170, 130]]);
  const path = findPath(nav, 40, 80, 280, 80, 8);
  assert.ok(path && path.length >= 2, 'expected a route');
  for (const p of path) {
    assert.equal(gridBlocked(nav, p.x, p.y, 8), false, 'waypoint must be walkable');
  }
  const last = path[path.length - 1];
  assert.ok(Math.hypot(last.x - 280, last.y - 80) < 17, 'ends at the target');
});

test('findPath goes straight in open space', () => {
  const nav = makeNav(20, 10);
  const path = findPath(nav, 30, 30, 290, 140, 8);
  assert.ok(path && path.length >= 1);
  assert.ok(path.length <= 3, 'smoothing keeps open routes short: ' + path.length);
  const last = path[path.length - 1];
  assert.ok(Math.hypot(last.x - 290, last.y - 140) < 17);
});

test('findPath returns null when sealed off', () => {
  const nav = makeNav(20, 10, [[100, -10, 120, 170]]);
  // wall spans the full height: left room cannot reach right room
  const path = findPath(nav, 30, 80, 280, 80, 8);
  assert.equal(path, null);
});

test('findPath lands on a walkable cell when the click is inside furniture', () => {
  const nav = makeNav(20, 10, [[140, 60, 200, 100]]);
  const path = findPath(nav, 30, 30, 170, 80, 8);
  assert.ok(path, 'route to nearest open cell');
  const last = path[path.length - 1];
  assert.equal(gridBlocked(nav, last.x, last.y, 8), false);
});

test('findPath handles start == goal', () => {
  const nav = makeNav(20, 10);
  const path = findPath(nav, 40, 40, 41, 42, 8);
  assert.ok(path && path.length === 1);
  assert.ok(Math.hypot(path[0].x - 41, path[0].y - 42) < 0.001);
});

test('findPath null nav is a graceful no-op', () => {
  assert.equal(findPath(null, 0, 0, 10, 10), null);
});
