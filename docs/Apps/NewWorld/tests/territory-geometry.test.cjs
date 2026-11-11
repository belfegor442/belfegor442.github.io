'use strict';

const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const geometry=require('../territory-geometry.js');

const svg=fs.readFileSync(path.join(__dirname,'..','map.svg'),'utf8');
const svgHash=crypto.createHash('sha256').update(svg).digest('hex').toUpperCase();
const svgIds=[...svg.matchAll(/<(?:path|g|polygon|rect)\b[^>]*\bid="([^"]+)"/g)].map(match=>match[1]);

test('versioned geography catalog binds all sixteen official States to existing SVG State geometries',()=>{
  assert.equal(geometry.version,1);
  assert.equal(geometry.svgSha256,svgHash);
  assert.equal(geometry.states.length,16);
  assert.deepEqual(geometry.validateCatalog(svgIds),{valid:true,errors:[]});
  assert.equal(new Set(geometry.states.map(item=>item.stateKey)).size,16);
  assert.equal(new Set(geometry.states.map(item=>item.svgElementId)).size,16);
  assert.deepEqual(geometry.states.map(item=>item.stateName),[
    'Kingdom of Coimbrila','United Provinces of Gania','Chungia','Calcilacia',
    'Pician Empire','Meityeun Theocracy','Swabing','Alba','Knosian Despotate',
    'Kalestos','Gorkirch','Duchy of Shonewesia','Shahtehaq','Kvinian Empire','Shi','Kueopia'
  ]);
});

test('geometry lookup uses stable keys and explicit SVG identifiers, not display-name matching',()=>{
  assert.equal(geometry.byIndex(0).stateKey,'coimbrila');
  assert.equal(geometry.byStateKey('kueopia').svgElementId,'state16');
  assert.equal(geometry.bySvgElementId('state7').stateKey,'swabing');
  assert.equal(geometry.byIndex(16),null);
  assert.equal(geometry.byStateKey('unknown'),null);
  assert.equal(geometry.bySvgElementId('state17'),null);
});

test('State geometry is never silently treated as a Province boundary',()=>{
  assert.equal(geometry.geometryScope,'state-boundaries-only');
  assert.match(geometry.provinceGeometryPolicy,/No province boundary is inferred/);
  assert.ok(geometry.states.every(item=>item.geometryScope==='state'));
  assert.equal(geometry.validateCatalog(svgIds.filter(id=>id!=='state4')).valid,false);
});
