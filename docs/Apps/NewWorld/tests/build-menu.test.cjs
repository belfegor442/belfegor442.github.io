'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const manifest = require('../assets/sprite-manifest.json');
const {createCatalog,resolveBuildingType,CATEGORY_ORDER} = require('../build-menu.js');

const buildingTypes = [
  {id:'farm',name:'FARM',cost:120,income:18,icon:'F',desc:'Food production.',foodCapacity:5000,jobSlots:1200,upkeep:3,days:2},
  {id:'market',name:'MARKET',cost:220,income:34,icon:'M',desc:'Commercial exchange.',jobSlots:800,upkeep:3,days:3},
  {id:'workshop',name:'WORKSHOP',cost:360,income:52,icon:'W',desc:'Industrial production.',jobSlots:1800,upkeep:5,days:4},
  {id:'housing',name:'HOUSING',cost:180,income:8,icon:'H',desc:'Homes for residents.',housingCapacity:1000,upkeep:2,days:2},
  {id:'waterworks',name:'WATERWORKS',cost:300,income:6,icon:'U',desc:'Water supply.',waterCapacity:5000,jobSlots:250,upkeep:5,days:4},
  {id:'clinic',name:'CLINIC',cost:420,income:4,icon:'C',desc:'Healthcare.',healthCapacity:5000,jobSlots:300,upkeep:7,days:5},
  {id:'school',name:'SCHOOL',cost:360,income:5,icon:'S',desc:'Education.',educationCapacity:5000,jobSlots:350,upkeep:6,days:5},
  {id:'road',name:'ROAD',cost:65,income:0,icon:'R',desc:'Local transport.',jobSlots:40,upkeep:1,days:1}
];

const sprites = Object.values(manifest.sprites)
  .filter(sprite => sprite.orientation === 0)
  .map(sprite => ({
    key:String(sprite.key).replace('/orientation-0',''),
    category:sprite.category,
    sourceSheet:sprite.sourceSheet,
    width:sprite.width,
    height:sprite.height
  }));

const catalogue = createCatalog(sprites,buildingTypes);

test('TheoTown catalogue exposes more than 140 actual atlas assets plus road',() => {
  assert.equal(catalogue.length,145);
  assert.ok(catalogue.length > 140);
  assert.ok(catalogue.some(item => item.buildingId === 'road' && item.id === 'base:road'));
});

test('catalogue separates assets into usable building categories',() => {
  const categories = new Set(catalogue.map(item => item.category));
  for (const category of ['residential','commercial','industrial','agriculture','services','utilities','transport'])
    assert.ok(categories.has(category), 'Missing category: ' + category);
  assert.ok(CATEGORY_ORDER.length >= 8);
});

test('every sprite item has a backend-supported building type',() => {
  const spriteItems = catalogue.filter(item => item.spriteKey);
  assert.ok(spriteItems.length > 130);
  for (const item of spriteItems)
    assert.equal(resolveBuildingType({key:item.spriteKey}),item.buildingId,item.spriteKey);
});

test('sprite variants inherit the economic rules of their building type',() => {
  const house = catalogue.find(item => item.spriteKey === 'houses/1x1_house1');
  const shop = catalogue.find(item => item.spriteKey === 'restaurants/1x1_commercial_10_chocolate');
  const tower = catalogue.find(item => item.buildingId === 'waterworks');
  assert.ok(house);
  assert.equal(house.cost,180);
  assert.equal(house.housingCapacity,1000);
  assert.ok(shop);
  assert.equal(shop.cost,220);
  assert.equal(shop.jobSlots,800);
  assert.ok(tower);
  assert.equal(tower.waterCapacity,5000);
});

test('unapproved atlas objects cannot enter the multiplayer catalogue',() => {
  assert.equal(resolveBuildingType({key:'village/1x1_random_decoration'}),null);
  assert.equal(resolveBuildingType({key:'unknown/1x1_house99'}),null);
});
