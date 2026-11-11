'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const city=require('../city-builder.js');

const CENTER=144+520*1024+490;

function world(overrides={}) {
  const territory={
    index:0,stateId:'state-city',name:'New Town',treasury:25000,
    population:850,prosperity:55,infrastructure:1,ownerPlayerId:'player-city',
    baseHousingCapacity:1200,baseFoodCapacity:1200,baseWaterCapacity:1200,
    baseHealthCapacity:170,baseEducationCapacity:140,baseJobSlots:300,
    housingCapacity:1200,foodCapacity:1200,waterCapacity:1200,
    buildings:{},...overrides
  };
  return {
    id:'city-test',started:true,status:'running',paused:false,day:1,
    worldDate:'1500-01-01',worldVersion:1,hostPlayerId:'player-city',
    players:[{id:'player-city',name:'City Founder'}],
    territories:[territory],activity:[],events:[],eventSequence:0
  };
}

test('starter city has a connected street grid, RCI zoning and utility networks',()=>{
  const game=world();
  game.territories[0].city=city.createStarterCity(CENTER);
  const setup=city.ensureCity(game);
  const zonePlots=Object.keys(setup.city.zones).map(Number);
  assert.equal(zonePlots.length,8);
  assert.equal(setup.city.centerPlot,CENTER);
  assert.equal(Object.keys(setup.city.roads).length,29);
  assert.ok(Object.values(setup.city.facilities).some(item=>item.type==='powerPlant'));
  assert.ok(Object.values(setup.city.facilities).some(item=>item.type==='waterPump'));
  assert.ok(zonePlots.every(plot=>city.neighbours(plot).some(index=>setup.city.roads[index])));
  assert.equal(setup.city.metrics.roadConnectedZones,8);
  assert.equal(setup.city.metrics.poweredZones,8);
  assert.equal(setup.city.metrics.wateredZones,8);
});

test('roads and zones consume the city treasury and reject invalid tiles',()=>{
  const game=world();
  game.territories[0].city=city.createStarterCity(CENTER);
  const plot=city.plotForCell(520,512);
  const road=city.applyAction(game,'player-city',{type:'paint',tool:'road',plotIndex:plot},{isLand:()=>true});
  assert.equal(road.ok,true,road.error);
  assert.equal(game.territories[0].treasury,24968);
  assert.equal(road.city.roads[plot],true);
  const zonePlot=city.plotForCell(520,513);
  const zone=city.applyAction(game,'player-city',{
    type:'paint',tool:'residential',plotIndex:zonePlot
  },{isLand:()=>true});
  assert.equal(zone.ok,true,zone.error);
  assert.equal(zone.city.zones[zonePlot],'residential');
  assert.equal(game.territories[0].treasury,24960);
  const wet=city.applyAction(game,'player-city',{
    type:'paint',tool:'commercial',plotIndex:city.plotForCell(520,514)
  },{isLand:()=>false});
  assert.equal(wet.ok,false);
  assert.match(wet.error,/dry land/i);
});

test('zone growth requires streets, electricity, water and demand',()=>{
  const game=world();
  game.territories[0].city=city.createStarterCity(CENTER);
  city.ensureCity(game);
  const startingBuildings=Object.keys(game.territories[0].buildings).length;
  const result=city.advanceDay(game);
  assert.equal(result.ok,true,result.error);
  assert.equal(result.grown,2);
  assert.equal(Object.keys(game.territories[0].buildings).length,startingBuildings+2);
  assert.ok(game.territories[0].city.createdBuildings>=2);

  const disconnected=world();
  disconnected.territories[0].city=city.createStarterCity(CENTER);
  disconnected.territories[0].city.powerLines={};
  const blocked=city.advanceDay(disconnected);
  assert.equal(blocked.ok,true,blocked.error);
  assert.equal(blocked.grown,0);
  assert.equal(Object.keys(disconnected.territories[0].buildings).length,0);
});

test('electricity and water supply shortages are reflected in city metrics',()=>{
  const game=world();
  game.territories[0].city=city.createStarterCity(CENTER);
  const setup=city.ensureCity(game);
  setup.city.facilities={};
  city.advanceDay(game);
  const metrics=city.getMetrics(game,'state-city');
  assert.equal(metrics.metrics.powerSupply,0);
  assert.equal(metrics.metrics.waterSupply,0);
});

test('tax rates, pause state and simulation speed are validated and persisted',()=>{
  const game=world();
  game.territories[0].city=city.createStarterCity(CENTER);
  const highTax=city.applyAction(game,'player-city',{type:'tax',sector:'residential',value:18});
  assert.equal(highTax.ok,true,highTax.error);
  assert.equal(highTax.city.taxRates.residential,18);
  assert.equal(city.applyAction(game,'player-city',{type:'tax',sector:'residential',value:25}).ok,false);
  assert.equal(city.applyAction(game,'player-city',{type:'speed',value:4}).ok,true);
  assert.equal(game.territories[0].city.speed,4);
  assert.equal(city.applyAction(game,'player-city',{type:'speed',value:3}).ok,false);
  assert.equal(city.applyAction(game,'player-city',{type:'pause'}).ok,true);
  assert.equal(game.status,'paused');
  assert.equal(city.applyAction(game,'player-city',{type:'pause'}).ok,true);
  assert.equal(game.status,'running');
});

test('higher city tax rates generate a higher daily city revenue',()=>{
  const low=world();
  const high=world();
  low.territories[0].city=city.createStarterCity(CENTER);
  high.territories[0].city=city.createStarterCity(CENTER);
  for(const sector of ['residential','commercial','industrial']) {
    low.territories[0].city.taxRates[sector]=4;
    high.territories[0].city.taxRates[sector]=20;
  }
  const lowResult=city.advanceDay(low);
  const highResult=city.advanceDay(high);
  assert.equal(lowResult.ok,true,lowResult.error);
  assert.equal(highResult.ok,true,highResult.error);
  assert.ok(highResult.metrics.taxRevenueLastDay>lowResult.metrics.taxRevenueLastDay);
});
