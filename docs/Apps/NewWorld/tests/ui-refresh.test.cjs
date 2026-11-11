'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const css=fs.readFileSync(path.join(root,'game.css'),'utf8');
const game=fs.readFileSync(path.join(root,'game.js'),'utf8');

test('navigation is grouped into four sections without losing any strategic panel',()=>{
  const groups=[...html.matchAll(/<div class="nav-group">/g)];
  const labels=[...html.matchAll(/class="nav-section-label">([^<]+)</g)].map(match=>match[1]);
  const tabs=[...html.matchAll(/<button class="tab[^"]*"[^>]*data-view="([^"]+)"/g)].map(match=>match[1]);
  assert.deepEqual(labels,['OVERVIEW','GOVERNMENT','INSTITUTIONS','WORLD SYSTEMS']);
  assert.equal(groups.length,4);
  assert.equal(tabs.length,19);
  assert.equal(new Set(tabs).size,19);
  assert.ok(html.includes('nav-rail-foot">NORTH ASSEMBLY <span>NEW WORLD / 001</span>'));
  assert.ok(html.includes('BELELAND / WORLD SIMULATION'));
});

test('desktop uses a persistent navigation rail and a readable map inspector',()=>{
  assert.ok(css.includes('grid-template-columns:204px minmax(0,1fr)'));
  assert.ok(css.includes('minmax(330px,390px)'));
  assert.ok(css.includes('.nav-section-label'));
  assert.ok(css.includes('grid-column:2;grid-row:1'));
  assert.ok(css.includes('game-footer{grid-column:1/-1;grid-row:2}'));
});

test('mobile map controls stay visible above the scrollable map modes',()=>{
  assert.ok(css.includes('.map-tools .map-controls{\n    position:absolute!important'));
  assert.ok(css.includes('.map-tools .map-modes{\n    position:absolute!important'));
  assert.ok(css.includes('content:"↺"'));
  assert.ok(css.includes('@media(max-width:740px)'));
  assert.ok(game.includes('preserveAspectRatio'));
  assert.ok(html.includes('north-assembly-ui-refresh-v15'));
});