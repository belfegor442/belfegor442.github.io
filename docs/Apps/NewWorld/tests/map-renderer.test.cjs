'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

global.window = {
  devicePixelRatio: 1,
  addEventListener() {}
};
global.document = {
  baseURI: 'https://example.test/Apps/NewWorld/',
  getElementById() { return null; },
  querySelector() { return null; }
};

require('../map-renderer.js');

const Renderer = global.window.NewWorldMapRenderer;
const LEGACY_PLOT_OFFSET = 144;

function createRenderer() {
  const viewport = {
    clientWidth: 1200,
    clientHeight: 700,
    classList: { toggle() {} },
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 1200, height: 700 };
    }
  };
  const canvas = {
    style: {},
    dataset: {},
    getContext() { return null; },
    addEventListener() {},
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 1200, height: 700 };
    }
  };
  return new Renderer({ canvas, viewport });
}

test('open territory contains 1,048,576 procedurally generated land cells', () => {
  const renderer = createRenderer();
  assert.equal(renderer.worldSize, 1024);
  assert.equal(renderer.worldSize * renderer.worldSize, 1048576);
});

test('terrain generation is deterministic for a selected state', () => {
  const renderer = createRenderer();
  const first = renderer.terrainAt(123, 456);
  const second = renderer.terrainAt(123, 456);
  assert.deepEqual(first, second);
  assert.ok(['grass', 'dry', 'water'].includes(first.type));
});

test('terrain has no prebuilt roads, parks or structures', () => {
  const renderer = createRenderer();
  for (let row = 100; row < 130; row++) {
    for (let col = 200; col < 230; col++) {
      const tile = renderer.terrainAt(row, col);
      assert.ok(tile);
      assert.equal('road' in tile, false);
      assert.equal('building' in tile, false);
      assert.equal('park' in tile, false);
    }
  }
  assert.equal(renderer.buildingData.size, 0);
  assert.equal(renderer.buildingSprites.size, 0);
});

test('world coordinates map to unique construction plot identifiers', () => {
  const renderer = createRenderer();
  assert.equal(renderer.getPlotIndexForCell(0, 0), LEGACY_PLOT_OFFSET);
  assert.equal(renderer.getPlotIndexForCell(512, 512), LEGACY_PLOT_OFFSET + 512 * 1024 + 512);
  assert.equal(renderer.getPlotIndexForCell(1023, 1023),
    LEGACY_PLOT_OFFSET + 1023 * 1024 + 1023);
  assert.deepEqual(renderer.getPlotCell(LEGACY_PLOT_OFFSET + 512 * 1024 + 512),
    { row: 512, col: 512 });
  assert.equal(renderer.getPlotIndexForCell(-1, 0), null);
  assert.equal(renderer.getPlotIndexForCell(1024, 1024), null);
});

test('the 144-plot construction panel follows the selected world coordinate', () => {
  const renderer = createRenderer();
  const center = LEGACY_PLOT_OFFSET + 512 * 1024 + 512;
  assert.equal(renderer.getAdjacentPlotIndex(center, 78), center);
  assert.equal(renderer.getAdjacentPlotIndex(center, 0),
    LEGACY_PLOT_OFFSET + 506 * 1024 + 506);
  assert.equal(renderer.getAdjacentPlotIndex(center, 143),
    LEGACY_PLOT_OFFSET + 517 * 1024 + 517);
  assert.equal(renderer.getAdjacentPlotIndex(center, 144), null);
});

test('construction panel excludes water and world-boundary cells', () => {
  const renderer = createRenderer();
  const center = LEGACY_PLOT_OFFSET + 512 * 1024 + 512;
  let foundWater = false;
  let foundLand = false;
  for (let index = 0; index < 144; index++) {
    const plotIndex = renderer.getAdjacentPlotIndex(center, index);
    if (plotIndex === null) {
      const row = 512 + Math.floor(index / 12) - 6;
      const col = 512 + (index % 12) - 6;
      if (renderer.terrainAt(row, col)?.type === 'water') foundWater = true;
    } else {
      foundLand = true;
      const cell = renderer.getPlotCell(plotIndex);
      assert.notEqual(renderer.terrainAt(cell.row, cell.col).type, 'water');
    }
  }
  assert.equal(foundLand, true);
  assert.equal(foundWater, true);
});

test('legacy construction identifiers migrate to the original central plots', () => {
  const renderer = createRenderer();
  assert.deepEqual(renderer.getLegacyPlotCell(0), { row: 506, col: 506 });
  assert.deepEqual(renderer.getLegacyPlotCell(143), { row: 517, col: 517 });
  assert.equal(renderer.getLegacyPlotCell(144), null);
});

test('screen coordinates at the world center resolve to the central plot', () => {
  const renderer = createRenderer();
  assert.equal(renderer.plotIndexAtScreen(600, 350),
    LEGACY_PLOT_OFFSET + 512 * 1024 + 512);
});

test('terrain outside the world bounds is not generated', () => {
  const renderer = createRenderer();
  assert.equal(renderer.terrainAt(-1, 0), null);
  assert.equal(renderer.terrainAt(0, 1024), null);
  assert.equal(renderer.terrainAt(1024, 1024), null);
});

test('city map opens at the normal camera scale without requiring strategic zoom', () => {
  const renderer = createRenderer();
  const viewStates = [];
  renderer.failed = true;
  renderer.viewport.classList.toggle = (name, active) => viewStates.push(active);

  renderer.setCamera(1, true);

  assert.equal(renderer.active, true);
  assert.equal(renderer.zoom, 1);
  assert.equal(renderer.tileWidth(), 54 * 0.88);
  assert.deepEqual(viewStates, [true]);

  renderer.setCamera(1);
  assert.equal(renderer.active, false);
  assert.deepEqual(viewStates, [true, false]);
});
