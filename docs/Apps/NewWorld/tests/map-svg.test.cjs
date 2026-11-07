'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const svg = fs.readFileSync(path.join(__dirname, '..', 'map.svg'), 'utf8');

function statesFromSvg(source) {
  const states = [];
  const expression = /<path id="state(\d+)"[^>]*d="([^"]+)"[^>]*><title>([^<]+)<\/title><\/path>/g;
  for (const match of source.matchAll(expression)) {
    states.push({ index: Number(match[1]), path: match[2], name: match[3] });
  }
  return states;
}

test('Beleland atlas retains all sixteen selectable State identities', () => {
  const states = statesFromSvg(svg);
  assert.equal(states.length, 16);
  assert.deepEqual(states.map(state => state.index), Array.from({ length: 16 }, (_, i) => i + 1));
  assert.equal(new Set(states.map(state => state.name)).size, 16);
  assert.deepEqual(states.map(state => state.name),[
    "FOUNDERS' REACH",'NORTH COAST','EASTERN COAST','UPPER MARCH',
    'WESTERN VALE','HIGHLAND BASIN','ORREN FOOTHILLS','EASTERN UPLANDS',
    'WESTERN LOWLANDS','CENTRAL FOREST','SOUTHERN PLAIN','EASTERN MARCHES',
    'SOUTH COAST','GREAT RIVERLAND','SOUTHERN REACH','FAR COAST'
  ]);
  assert.equal(/Kingdom of |Empire|Theocracy|Despotate|Duchy of /i.test(svg),false);
  for (const state of states) {
    assert.ok(state.path.startsWith('M '), state.name + ' has no valid move command');
    assert.ok(state.path.endsWith('Z'), state.name + ' is not a closed polygon');
    assert.ok(state.path.length > 120, state.name + ' has insufficient boundary detail');
  }
});

test('political boundaries use curved cartographic geometry instead of a rectangular grid', () => {
  const states = statesFromSvg(svg);
  const curvedStates = states.filter(state => / Q /.test(state.path));
  assert.ok(curvedStates.length >= 14);
  assert.ok(!svg.includes('M20.0 20.0 L406.6 20.0'));
});

test('physical atlas includes independent coastal, hydrological, relief and vegetation layers', () => {
  for (const feature of [
    'land-clip', 'river-system', 'river-main', 'tributary', 'lakes',
    'mountain-rock', 'mountain-snow', 'tree', 'islands', 'terrain-contours',
    'state-label'
  ]) {
    assert.ok(svg.includes('class="' + feature + '"') || svg.includes('id="' + feature + '"'),
      'missing physical atlas layer: ' + feature);
  }
  assert.ok((svg.match(/class="mountain"/g) || []).length >= 20);
  assert.ok((svg.match(/class="tree"/g) || []).length >= 100);
  const settlements = svg.match(/<g class="settlement (?:capital|city)"[\s\S]*?<\/g>/g) || [];
  assert.equal(settlements.length,1,'only the single founding hamlet may exist at world creation');
  assert.ok(settlements[0].includes("Founders' Reach"));
});
