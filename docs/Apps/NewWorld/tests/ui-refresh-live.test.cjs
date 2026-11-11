'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const css=fs.readFileSync(path.join(root,'game.css'),'utf8');

test('all ten original views remain once and are grouped into four navigation sections',()=>{
  const groups=[...html.matchAll(/<div class="nav-group">/g)];
  const labels=[...html.matchAll(/class="nav-section-label">([^<]+)</g)].map(m=>m[1]);
  const tabs=[...html.matchAll(/<button class="tab[^"]*"[^>]*data-view="([^"]+)"/g)].map(m=>m[1]);
  assert.equal(groups.length,4);
  assert.deepEqual(labels,['OVERVIEW','GOVERNMENT','PUBLIC SYSTEMS','WORLD SYSTEMS']);
  assert.equal(tabs.length,10);
  assert.equal(new Set(tabs).size,10);
  assert.deepEqual([...tabs].sort(),['civic','city','diplomacy','government','ledger','military','multiplayer','technology','territory','world'].sort());
  assert.ok(html.includes('<span>CITY</span>'));
});

test('desktop layout uses a permanent left rail and retains a substantial inspector',()=>{
  assert.ok(css.includes('grid-template-columns:204px minmax(0,1fr)'));
  assert.ok(css.includes('grid-template-columns:minmax(0,1fr) minmax(320px,365px)'));
  assert.ok(css.includes('.nav-section-label'));
  assert.ok(css.includes('game-footer{grid-column:1/-1;grid-row:2}'));
});

test('responsive navigation remains horizontal on smaller screens and respects reduced motion',()=>{
  assert.ok(css.includes('@media(max-width:980px)'));
  assert.ok(css.includes('@media(max-width:740px)'));
  assert.ok(css.includes('prefers-reduced-motion:reduce'));
  assert.ok(html.includes('game.css?v=20261111-solo-campaign-v1'));
});
test('campaign screen offers a real local solo start alongside multiplayer',()=>{
  const game=fs.readFileSync(path.join(root,'game.js'),'utf8');
  const multiplayer=fs.readFileSync(path.join(root,'multiplayer.js'),'utf8');
  assert.ok(html.includes('id="play-solo" class="action-btn solo-action" type="button">PLAY SOLO</button>'));
  assert.ok(html.includes('id="network-service"'));
  assert.ok(html.includes('saved automatically in this browser'));
  assert.ok(game.includes("$('play-solo').addEventListener('click', createSoloWorld)"));
  assert.ok(multiplayer.includes('function createSoloWorld('));
  assert.ok(multiplayer.includes('function setSoloRuntime('));
  assert.ok(css.includes('#network-service[hidden]'));
  assert.ok(html.includes('solo-campaign-v1'));
});

test('mobile metrics fit two columns and military navigation uses an existing asset',()=>{
  assert.ok(css.includes('grid-template-columns:repeat(2,minmax(0,1fr))'));
  assert.ok(html.includes('military-unit.png'));
  assert.ok(!html.includes('medievalUnit_01.png'));
});