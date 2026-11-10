'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const simulation = require('../simulation.js');
const strategy = require('../strategy.js');
global.window = {NewWorldSimulation:simulation,NewWorldStrategy:strategy};

const multiplayer = require('../multiplayer.js');

function guest(id, name) {
  return {
    id,
    name,
    isHost:false,
    countryIndex:null,
    treasury:0,
    dailyBalanceRemainder:0,
    buildings:{},
    connected:true,
    token:'token-' + id
  };
}

test('a new world assigns its host to the first State and transfers the starting treasury', () => {
  const { game, session } = multiplayer.createInitialWorld('Host');
  const host = game.players[0];
  const firstState = game.territories[0];
  const membership = game.memberships.find(item => item.playerId === host.id);

  assert.equal(session.playerId, host.id);
  assert.equal(host.countryIndex, 0);
  assert.equal(host.treasury, 0);
  assert.equal(firstState.ownerPlayerId, host.id);
  assert.equal(firstState.treasury, 1200);
  assert.equal(membership.stateId, firstState.stateId);
  assert.equal(membership.status, 'active');
  assert.equal(multiplayer.canStartWorld(game), true);
});

test('event definitions can be configured by the host before the world starts', () => {
  const {game}=multiplayer.createInitialWorld('Host');
  const definitions=[{
    id:'low-reserves',title:'Low reserves',description:'The public treasury is below its reserve.',
    category:'economy',severity:'warning',
    trigger:{type:'treasuryBelow',stateId:game.territories[0].stateId,threshold:100}
  }];

  const configured=multiplayer.applyAdmin(game,'configure',{
    kind:'events',configuration:{definitions}
  });

  assert.equal(configured.ok,true,configured.error);
  assert.deepEqual(game.eventDefinitions,definitions);
  assert.deepEqual(multiplayer.snapshot(game).eventDefinitions,definitions);
  assert.equal(multiplayer.applyAdmin(game,'start',{}).ok,true);
  const locked=multiplayer.applyAdmin(game,'configure',{
    kind:'events',configuration:{definitions:[]}
  });
  assert.equal(locked.ok,false);
  assert.deepEqual(game.eventDefinitions,definitions);
});

test('67 players can join one founding settlement and start the same world', () => {
  const { game } = multiplayer.createInitialWorld('Host');
  const home = game.territories[0];
  assert.equal(game.territories.filter(item => item.ownerPlayerId).length, 1);
  assert.equal(game.territories.filter(item => item.ownerPlayerId === game.hostPlayerId).length, 1);
  assert.equal(game.companies.length, 6);
  assert.equal(game.markets.length, 6);
  assert.equal(game.territories.slice(1).every(item => item.ownerPlayerId === null && item.population === 0), true);

  for (let index = 0; index < 66; index++) {
    const player = guest('guest-' + index, 'Friend ' + index);
    game.players.push(player);
    const assigned = multiplayer.assignLobbyPlayer(game, player);
    assert.equal(assigned.ok, true, assigned.error);
    assert.equal(player.countryIndex, 0);
  }

  assert.equal(game.players.length, 67);
  assert.equal(multiplayer.maxPlayers, 100);
  assert.equal(game.memberships.filter(item =>
    item.stateId === home.stateId && item.status === 'active').length, 67);
  assert.equal(multiplayer.canStartWorld(game), true);

  const started = multiplayer.applyAdmin(game, 'start', {});
  assert.equal(started.ok, true, started.error);
  assert.equal(game.started, true);
  assert.equal(game.status, 'running');
});

test('a group can finance the next conquest from a previously claimed region', () => {
  const { game } = multiplayer.createInitialWorld('Host');
  const host = game.players[0];
  assert.equal(multiplayer.applyAdmin(game,'start',{}).ok,true);
  const home = game.territories[0];
  const first = game.territories[1];
  const second = game.territories[2];

  const firstClaim = multiplayer.applyOrder(game,host,{
    orderId:'claim-chain-first',gameId:game.id,playerId:host.id,
    expectedWorldVersion:game.worldVersion,stateId:home.stateId,
    type:'claim',territoryIndex:1
  });
  assert.equal(firstClaim.accepted,true,firstClaim.error);
  assert.equal(first.treasury,600);

  const secondClaim = multiplayer.applyOrder(game,host,{
    orderId:'claim-chain-second',gameId:game.id,playerId:host.id,
    expectedWorldVersion:game.worldVersion,stateId:first.stateId,
    type:'claim',territoryIndex:2
  });
  assert.equal(secondClaim.accepted,true,secondClaim.error);
  assert.equal(second.ownerPlayerId,host.id);
  assert.equal(second.treasury,150);
  assert.equal(first.treasury,0);
});

test('a cooperative founding member gains membership in a newly conquered region', () => {
  const { game } = multiplayer.createInitialWorld('Host');
  const firstGuest = guest('guest-a', 'Friend A');
  game.players.push(firstGuest);
  assert.equal(multiplayer.assignLobbyPlayer(game, firstGuest).ok, true);
  assert.equal(multiplayer.applyAdmin(game, 'start', {}).ok, true);

  const home = game.territories[0];
  const target = game.territories[1];
  const host = game.players[0];
  const result = multiplayer.applyOrder(game,host,{
    orderId:'claim-frontier-1',gameId:game.id,playerId:host.id,
    expectedWorldVersion:game.worldVersion,stateId:home.stateId,
    type:'claim',territoryIndex:1
  });
  assert.equal(result.accepted,true,result.error);
  assert.equal(target.ownerPlayerId,host.id);
  assert.equal(target.treasury,600);
  assert.equal(target.population,0);
  assert.equal(game.companies.filter(item => item.stateId === target.stateId).length,6);
  assert.equal(game.markets.filter(item => item.stateId === target.stateId).length,6);
  assert.equal(game.populationGroups.filter(item => item.stateId === target.stateId).length,1);
  assert.equal(game.memberships.some(item => item.playerId === firstGuest.id &&
    item.stateId === target.stateId && item.status === 'active'),true);
});

test('a claimed empty region can fund its first farm, housing and waterworks from its founding grant', () => {
  const { game } = multiplayer.createInitialWorld('Host');
  const host = game.players[0];
  assert.equal(multiplayer.applyAdmin(game,'start',{}).ok,true);
  const home = game.territories[0];
  const territory = game.territories[1];
  const claim = multiplayer.applyOrder(game,host,{
    orderId:'claim-first-settlement',gameId:game.id,playerId:host.id,
    expectedWorldVersion:game.worldVersion,stateId:home.stateId,
    type:'claim',territoryIndex:1
  });
  assert.equal(claim.accepted,true,claim.error);
  assert.equal(territory.treasury,600);
  assert.equal(territory.population,0);

  const plotBase=144+512*1024+512;
  for (const [index,buildingId] of ['farm','housing','waterworks'].entries()) {
    const result=multiplayer.applyOrder(game,host,{
      orderId:'founding-build-'+buildingId,gameId:game.id,playerId:host.id,
      expectedWorldVersion:game.worldVersion,stateId:territory.stateId,
      type:'build',plotIndex:plotBase+index,buildingId
    });
    assert.equal(result.accepted,true,result.error);
  }
  assert.equal(game.territories[1].treasury,0);
  assert.equal(game.territories[1].buildings[plotBase].daysRemaining,2);
  assert.equal(game.territories[1].buildings[plotBase+1].daysRemaining,2);
  assert.equal(game.territories[1].buildings[plotBase+2].daysRemaining,4);

  for(let day=0;day<3;day++) assert.equal(simulation.advanceDay(game).ok,true);
  let metrics=simulation.getSettlementMetrics(game.territories[1]);
  assert.equal(metrics.housingCapacity,1000);
  assert.equal(metrics.foodCapacity,5000);
  assert.equal(metrics.waterCapacity,0);
  assert.equal(game.territories[1].population,0);

  assert.equal(simulation.advanceDay(game).ok,true);
  metrics=simulation.getSettlementMetrics(game.territories[1]);
  assert.equal(metrics.housingCapacity,1000);
  assert.equal(metrics.foodCapacity,5000);
  assert.equal(metrics.waterCapacity,5000);
  assert.equal(game.territories[1].population,1);
});

test('construction accepts world-map plot IDs and stores buildings on the controlled territory', () => {
  const { game } = multiplayer.createInitialWorld('Host');
  const host = game.players[0];
  assert.equal(multiplayer.applyAdmin(game,'start',{}).ok,true);
  const territory = game.territories[0];
  const plotIndex = 144 + 512 * 1024 + 512;
  const result = multiplayer.applyOrder(game,host,{
    orderId:'build-world-plot-1',gameId:game.id,playerId:host.id,
    expectedWorldVersion:game.worldVersion,stateId:territory.stateId,
    type:'build',plotIndex,buildingId:'farm'
  });
  assert.equal(result.accepted,true,result.error);
  assert.equal(territory.buildings[plotIndex].daysRemaining,2);
  assert.equal(host.buildings[plotIndex],undefined);
});


test('sprite construction preserves the exact catalogue name, asset and rotation', () => {
  const {game} = multiplayer.createInitialWorld('Host');
  const host = game.players[0];
  assert.equal(multiplayer.applyAdmin(game,'start',{}).ok,true);
  const territory = game.territories[0];
  const plotIndex = 144 + 512 * 1024 + 512;
  const result = multiplayer.applyOrder(game,host,{
    orderId:'build-catalogue-variant-1',gameId:game.id,playerId:host.id,
    expectedWorldVersion:game.worldVersion,stateId:territory.stateId,
    type:'build',plotIndex,buildingId:'farm',
    spriteKey:'village/1x1_fisherman_hut',
    rotation:1,
    variantName:"Fisherman's hut",
    catalogItemId:'village/1x1_fisherman_hut'
  });
  assert.equal(result.accepted,true,result.error);
  assert.equal(territory.buildings[plotIndex].name,"Fisherman's hut");
  assert.equal(territory.buildings[plotIndex].spriteKey,'village/1x1_fisherman_hut');
  assert.equal(territory.buildings[plotIndex].rotation,1);
  assert.equal(territory.buildings[plotIndex].catalogItemId,'village/1x1_fisherman_hut');
});

test('construction rejects a catalogue sprite incompatible with its building type', () => {
  const {game} = multiplayer.createInitialWorld('Host');
  const host = game.players[0];
  assert.equal(multiplayer.applyAdmin(game,'start',{}).ok,true);
  const territory = game.territories[0];
  const treasury = territory.treasury;
  const result = multiplayer.applyOrder(game,host,{
    orderId:'build-invalid-catalogue-variant',gameId:game.id,playerId:host.id,
    expectedWorldVersion:game.worldVersion,stateId:territory.stateId,
    type:'build',plotIndex:144+512*1024+512,buildingId:'farm',
    spriteKey:'houses/1x1_house1',rotation:0,variantName:'House 1'
  });
  assert.equal(result.accepted,false);
  assert.equal(result.code,'INVALID_PAYLOAD');
  assert.equal(territory.treasury,treasury);
});


test('multiplayer snapshots replicate civic labour data and household wage receipts',()=>{
  const {game}=multiplayer.createInitialWorld('Host');
  game.civicSystems=[{
    stateId:game.territories[0].stateId,
    labour:{privateEmployees:6,dailyPayrollPaid:12,wageArrears:4}
  }];
  game.populationFinancialTransactions=[{
    id:'wage-receipt-1',stateId:game.territories[0].stateId,
    populationGroupId:'households-a',currencyId:game.territories[0].currencyId,
    type:'WageIncome',amount:12,worldDate:game.worldDate,day:game.day
  }];

  const replicated=multiplayer.snapshot(game);

  assert.deepEqual(replicated.civicSystems,game.civicSystems);
  assert.deepEqual(replicated.populationFinancialTransactions,
    game.populationFinancialTransactions);
  assert.notEqual(replicated.civicSystems[0],game.civicSystems[0]);
  assert.notEqual(replicated.populationFinancialTransactions[0],
    game.populationFinancialTransactions[0]);
});
