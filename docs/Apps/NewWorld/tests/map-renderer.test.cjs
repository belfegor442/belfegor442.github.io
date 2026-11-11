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

test('starter city streets, zones and utilities are placed on buildable land',()=>{
  const renderer=createRenderer();
  renderer.setRegion(0,'Founders Reach');
  const center=144+520*1024+490;
  const city=require('../city-builder.js').createStarterCity(center);
  const plots=[
    ...Object.keys(city.roads).map(Number),
    ...Object.keys(city.zones).map(Number),
    ...Object.keys(city.facilities).map(Number)
  ];
  for(const plot of plots) {
    const cell=renderer.getPlotCell(plot);
    assert.ok(cell,'plot '+plot+' must resolve to a map cell');
    const terrain=renderer.terrainAt(cell.row,cell.col);
    assert.ok(terrain && !['water','shore','wetland','mountain'].includes(terrain.type),
      'starter plot '+plot+' must have buildable land; found '+terrain?.type);
  }
});

test('city renderer retains detailed mode at city scale and accepts a zoning overlay',()=>{
  const renderer=createRenderer();
  renderer.failed=true;
  renderer.setCityData({
    zones:{'144': 'residential'},
    roads:{'145':true},
    powerLines:{'145':true},
    waterPipes:{'145':true},
    facilities:{}
  });
  assert.equal(renderer.active,true);
  assert.equal(renderer.cityData.zones[144],'residential');
  renderer.setCamera(.85);
  assert.equal(renderer.active,true);
  renderer.setCityData(null);
  assert.equal(renderer.active,false);
});

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

test('physical terrain has distinct coast, riverside, plains, forests, hills, mountains and wetlands', () => {
  const renderer = createRenderer();
  const counts = new Map();
  let treeCells = 0;
  let rockCells = 0;
  for (let row = 0; row < renderer.worldSize; row += 12) {
    for (let col = 0; col < renderer.worldSize; col += 12) {
      const tile = renderer.terrainAt(row, col);
      counts.set(tile.type, (counts.get(tile.type) || 0) + 1);
      if (tile.tree) treeCells++;
      if (tile.rock) rockCells++;
    }
  }
  for (const type of ['water', 'shore', 'grass', 'forest', 'hills', 'mountain', 'dry', 'wetland']) {
    assert.ok(counts.get(type) > 0, 'missing terrain biome: ' + type);
  }
  assert.ok(counts.get('grass') > counts.get('mountain'));
  assert.ok(treeCells > 100, 'woodland should contain clustered vegetation');
  assert.ok(rockCells > 20, 'mountain and hill regions should contain rock outcrops');
});

test('different States receive distinct but deterministic terrain seeds', () => {
  const renderer = createRenderer();
  renderer.setRegion(0, 'Coimbrila');
  const first = [];
  for (let row = 120; row <= 900; row += 52) {
    for (let col = 120; col <= 900; col += 52) {
      const tile = renderer.terrainAt(row, col);
      first.push([tile.type, tile.variation, tile.elevation, tile.moisture, tile.tree]);
    }
  }
  renderer.setRegion(1, 'Gania');
  const second = [];
  for (let row = 120; row <= 900; row += 52) {
    for (let col = 120; col <= 900; col += 52) {
      const tile = renderer.terrainAt(row, col);
      second.push([tile.type, tile.variation, tile.elevation, tile.moisture, tile.tree]);
    }
  }
  assert.notDeepEqual(first, second);
  renderer.setRegion(0, 'Coimbrila');
  const repeated = [];
  for (let row = 120; row <= 900; row += 52) {
    for (let col = 120; col <= 900; col += 52) {
      const tile = renderer.terrainAt(row, col);
      repeated.push([tile.type, tile.variation, tile.elevation, tile.moisture, tile.tree]);
    }
  }
  assert.deepEqual(first, repeated);
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

test('city map opens in a full-territory overview with coarse terrain rendering', () => {
  const renderer = createRenderer();
  const viewStates = [];
  renderer.failed = true;
  renderer.viewport.classList.toggle = (name, active) => viewStates.push(active);

  renderer.setCamera(0.05, true);

  assert.equal(renderer.active, true);
  assert.equal(renderer.zoom, 0.05);
  assert.equal(renderer.tileWidth(), 54 * 0.05);
  assert.equal(renderer.renderStep(), 8);
  assert.deepEqual(viewStates, [true]);

  renderer.setZoomAt(0.04, 600, 350);
  assert.equal(renderer.zoom, 0.04);
  assert.equal(renderer.tileWidth(), 54 * 0.04);

  renderer.setCamera(0.08, true);
  assert.equal(renderer.renderStep(), 4);
  renderer.setCamera(0.18, true);
  assert.equal(renderer.renderStep(), 2);
  renderer.setCamera(0.35, true);
  assert.equal(renderer.renderStep(), 1);

  renderer.setCamera(1);
  assert.equal(renderer.active, false);
  assert.equal(renderer.zoom, 1);
  assert.deepEqual(viewStates, [true, true, true, true, false]);
});
