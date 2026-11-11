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
  assert.equal(firstState.scenarioStateKey,'coimbrila');
  assert.equal(firstState.name,'Kingdom of Coimbrila');
  assert.deepEqual(game.territories.map(item=>item.scenarioStateKey),[
    'coimbrila','gania','chungia','calcilacia','pician-empire','meityeun-theocracy',
    'swabing','alba','knosian-despotate','kalestos','gorkirch','shonewesia',
    'shahtehaq','kvinian-empire','shi','kueopia'
  ]);
  assert.equal(membership.stateId, firstState.stateId);
  assert.equal(membership.status, 'active');
  assert.equal(multiplayer.canStartWorld(game), true);
});

test('a founding government supports twenty human members and declares its capacity in the world snapshot', () => {
  const { game } = multiplayer.createInitialWorld('Host');
  const home = game.territories[0];
  assert.equal(game.maxHumanPlayers, 20);
  assert.equal(multiplayer.maxPlayers, 20);
  assert.equal(multiplayer.snapshot({...game,maxHumanPlayers:100}).maxHumanPlayers,20,
    'legacy saves cannot advertise a lobby capacity above the current hard limit');
  assert.equal(game.territories.filter(item => item.ownerPlayerId).length, 1);
  assert.equal(game.territories.filter(item => item.ownerPlayerId === game.hostPlayerId).length, 1);
  assert.equal(game.companies.length, 4);
  assert.equal(game.markets.length, 3);
  assert.equal(game.territories.slice(1).every(item => item.ownerPlayerId === null && item.population === 0), true);

  for (let index = 0; index < 19; index++) {
    const player = guest('guest-' + index, 'Friend ' + index);
    game.players.push(player);
    const assigned = multiplayer.assignLobbyPlayer(game, player);
    assert.equal(assigned.ok, true, assigned.error);
    assert.equal(player.countryIndex, 0);
  }

  assert.equal(game.players.length, 20);
  assert.equal(game.memberships.filter(item =>
    item.stateId === home.stateId && item.status === 'active').length, 20);
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
  assert.equal(game.companies.filter(item => item.stateId === target.stateId).length,4);
  assert.equal(game.markets.filter(item => item.stateId === target.stateId).length,3);
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


test('legacy Beleland State labels migrate to official stable catalog keys without changing territory identity or assets',()=>{
  const {game}=multiplayer.createInitialWorld('Legacy Host');
  const legacyNames=[
    "Founders' Reach",'North Coast','Eastern Coast','Upper March',
    'Western Vale','Highland Basin','Orren Foothills','Eastern Uplands',
    'Western Lowlands','Central Forest','Southern Plain','Eastern Marches',
    'South Coast','Great Riverland','Southern Reach','Far Coast'
  ];
  const original=game.territories.map(item=>({
    stateId:item.stateId,ownerPlayerId:item.ownerPlayerId,treasury:item.treasury,
    buildings:structuredClone(item.buildings)
  }));
  game.scenarioVersion='2.0';
  game.worldVersion=12;
  game.territories.forEach((item,index)=>{
    item.name=legacyNames[index];
    delete item.scenarioStateKey;
  });

  assert.equal(multiplayer.migrateScenarioIdentity(game),true);
  assert.equal(game.scenarioVersion,'2.1');
  assert.equal(game.worldVersion,13);
  assert.deepEqual(game.territories.map(item=>item.name),[
    'Kingdom of Coimbrila','United Provinces of Gania','Chungia','Calcilacia',
    'Pician Empire','Meityeun Theocracy','Swabing','Alba',
    'Knosian Despotate','Kalestos','Gorkirch','Duchy of Shonewesia',
    'Shahtehaq','Kvinian Empire','Shi','Kueopia'
  ]);
  game.territories.forEach((item,index)=>{
    assert.equal(item.scenarioStateKey,[
      'coimbrila','gania','chungia','calcilacia','pician-empire','meityeun-theocracy',
      'swabing','alba','knosian-despotate','kalestos','gorkirch','shonewesia',
      'shahtehaq','kvinian-empire','shi','kueopia'
    ][index]);
    assert.equal(item.stateId,original[index].stateId);
    assert.equal(item.ownerPlayerId,original[index].ownerPlayerId);
    assert.equal(item.treasury,original[index].treasury);
    assert.deepEqual(item.buildings,original[index].buildings);
  });
  assert.equal(multiplayer.migrateScenarioIdentity(game),false,
    'scenario identity migration must be idempotent');
});


test('rejected orders become durable auditable history and same-ID retries replay without side effects',()=>{
  const {game}=multiplayer.createInitialWorld('Audit Host');
  const host=game.players[0];
  const membership=game.memberships.find(item =>
    item.playerId===host.id && item.status==='active');
  membership.permissionSetId='government-observer';
  assert.equal(multiplayer.applyAdmin(game,'start',{}).ok,true);

  const target=game.territories[1];
  const worldVersion=game.worldVersion;
  const treasury=game.territories[0].treasury;
  const order={
    orderId:'audit-rejected-build-001',gameId:game.id,playerId:host.id,
    expectedWorldVersion:worldVersion,stateId:membership.stateId,
    type:'build',plotIndex:144+512*1024+512,buildingId:'farm'
  };
  const first=multiplayer.applyOrder(game,host,order);
  assert.equal(first.accepted,false);
  assert.equal(first.code,'INSUFFICIENT_PERMISSION');
  assert.equal(game.territories[0].treasury,treasury);
  assert.equal(game.territories[1].ownerPlayerId,null);
  assert.equal(game.orders.length,1);
  assert.equal(game.orders[0].status,'rejected');
  assert.equal(game.orders[0].playerId,host.id);
  assert.equal(game.orders[0].stateId,membership.stateId);
  assert.equal(game.orders[0].resultCode,'INSUFFICIENT_PERMISSION');
  assert.equal(game.orders[0].worldDate,game.worldDate);
  assert.equal(game.events.at(-1).type,'order.rejected');
  assert.equal(game.events.at(-1).orderId,order.orderId);

  const savedSnapshot=multiplayer.snapshot(game);
  assert.equal(savedSnapshot.orders.length,1);
  assert.equal(savedSnapshot.orders[0].status,'rejected');
  assert.equal(savedSnapshot.orders[0].resultCode,'INSUFFICIENT_PERMISSION');

  const second=multiplayer.applyOrder(game,host,order);
  assert.equal(second.accepted,false);
  assert.equal(second.code,'INSUFFICIENT_PERMISSION');
  assert.equal(second.replayed,true);
  assert.equal(game.orders.length,1);
  assert.equal(game.events.filter(item=>item.orderId===order.orderId).length,1);
  assert.equal(game.worldVersion,worldVersion);
  assert.equal(game.territories[0].treasury,treasury);
  assert.ok(target);
});


test('orders are bound to the authenticated player and exact world before execution',()=>{
  const {game}=multiplayer.createInitialWorld('Order Security Host');
  const host=game.players[0];
  assert.equal(multiplayer.applyAdmin(game,'start',{}).ok,true);
  const state=game.territories[0];
  const initialTreasury=state.treasury;
  const expectedWorldVersion=game.worldVersion;
  const base={
    orderId:'bound-order-wrong-world',gameId:game.id+'-other',playerId:host.id,
    expectedWorldVersion,stateId:state.stateId,type:'claim',territoryIndex:1
  };
  const wrongWorld=multiplayer.applyOrder(game,host,base);
  assert.equal(wrongWorld.accepted,false);
  assert.equal(wrongWorld.code,'WRONG_GAME');
  assert.equal(state.treasury,initialTreasury);

  const wrongActor=multiplayer.applyOrder(game,host,{
    ...base,orderId:'bound-order-wrong-actor',gameId:game.id,playerId:'another-player'
  });
  assert.equal(wrongActor.accepted,false);
  assert.equal(wrongActor.code,'WRONG_ACTOR');
  assert.equal(state.treasury,initialTreasury);
  assert.equal(game.territories[1].ownerPlayerId,null);
  assert.equal(game.orders.length,2);
  assert.equal(game.orders.every(item=>item.status==='rejected'),true);
  assert.equal(game.events.filter(item=>item.type==='order.rejected').length,2);
});


test('host save envelopes preserve game and clock state and detect accidental corruption',()=>{
  const {createHostSaveEnvelope,validateHostSaveEnvelope}=multiplayer;
  const {game,session}=multiplayer.createInitialWorld('Save Integrity Host');
  const envelope=createHostSaveEnvelope(game,session,'ROOM1234',7,123456,'2026-11-08T12:00:00.000Z');
  const checked=validateHostSaveEnvelope(envelope,{
    room:'ROOM1234',gameId:game.id,hostPlayerId:game.hostPlayerId
  });
  assert.equal(checked.valid,true,checked.reason);
  assert.equal(checked.payload.clockAccumulatorMs,123456);
  assert.equal(checked.generation,7);

  const corrupted=structuredClone(envelope);
  corrupted.payload.game.territories[0].treasury+=1;
  assert.deepEqual(validateHostSaveEnvelope(corrupted,{room:'ROOM1234'}),{
    valid:false,reason:'SAVE_CHECKSUM_MISMATCH'
  });
});

test('host save validation rejects invalid dates, duplicate identities and mismatched sessions',()=>{
  const {createHostSaveEnvelope,validateHostSaveEnvelope}=multiplayer;
  const {game,session}=multiplayer.createInitialWorld('Invalid Save Host');

  const invalidDate=structuredClone(game);
  invalidDate.worldDate='1500-02-30';
  const invalidDateSave=createHostSaveEnvelope(invalidDate,session,'ROOM1234',1,0);
  assert.equal(validateHostSaveEnvelope(invalidDateSave).reason,'SAVE_WORLD_INVALID');

  const duplicatePlayer=structuredClone(game);
  duplicatePlayer.players.push({...duplicatePlayer.players[0]});
  const duplicatePlayerSave=createHostSaveEnvelope(duplicatePlayer,session,'ROOM1234',1,0);
  assert.equal(validateHostSaveEnvelope(duplicatePlayerSave).reason,'SAVE_WORLD_INVALID');

  const mismatchedSession=createHostSaveEnvelope(game,{
    ...session,playerId:'different-host'
  },'ROOM1234',1,0);
  assert.equal(validateHostSaveEnvelope(mismatchedSession).reason,'SAVE_SESSION_MISMATCH');
});

test('world clock uses exact five-minute days and retains delayed cycles without skipping',()=>{
  const {
    clockElapsedMs,accumulateClockMs,takeDueClockDays,
    dayLengthMs,maxClockDaysPerPulse
  }=multiplayer;
  assert.equal(dayLengthMs,300000);
  assert.equal(clockElapsedMs(0,299000),299000,'299 real seconds must not complete a world day');
  assert.equal(clockElapsedMs(0,300000),300000,'300 real seconds must complete exactly one world day');
  assert.equal(clockElapsedMs(0,301000),301000,'301 real seconds must retain the extra second');
  assert.equal(clockElapsedMs(1000,1299),299);
  assert.equal(clockElapsedMs(1000,1301),301);
  assert.equal(clockElapsedMs(1301,1000),0);
  assert.deepEqual(takeDueClockDays(299),{days:0,remainingMs:299,pendingDays:0});
  assert.deepEqual(takeDueClockDays(299000),{days:0,remainingMs:299000,pendingDays:0});
  assert.deepEqual(takeDueClockDays(300000),{days:1,remainingMs:0,pendingDays:0});
  assert.deepEqual(takeDueClockDays(301000),{days:1,remainingMs:1000,pendingDays:0});

  const delayed=accumulateClockMs(2500,dayLengthMs*26+9000);
  assert.deepEqual(takeDueClockDays(delayed),{
    days:maxClockDaysPerPulse,remainingMs:dayLengthMs*2+11500,pendingDays:2
  });
  const nextPulse=takeDueClockDays(dayLengthMs*2+11500);
  assert.deepEqual(nextPulse,{days:2,remainingMs:11500,pendingDays:0});
});

test('world clock never converts disconnected or invalid elapsed time into progress',()=>{
  const {clockElapsedMs,accumulateClockMs,takeDueClockDays}=multiplayer;
  assert.equal(clockElapsedMs(NaN,10000),0);
  assert.equal(clockElapsedMs(10000,NaN),0);
  assert.equal(accumulateClockMs(5000,-300000),5000);
  assert.equal(accumulateClockMs(-1,NaN),0);
  assert.equal(takeDueClockDays(300000,0).days,0);
});


test('pause decisions count one connected-player vote each, treat ties as no decision and give the host no extra vote',()=>{
  const {game}=multiplayer.createInitialWorld('Pause Vote Test');
  const host=game.players[0];
  const hostMembership=game.memberships.find(item=>
    item.playerId===host.id&&item.status==='active');
  const players=[host];
  for(let index=1;index<4;index++) {
    const player={
      id:'pause-player-'+index,name:'Pause Player '+index,isHost:false,
      countryIndex:0,treasury:0,dailyBalanceRemainder:0,
      buildings:{},connected:true,token:'pause-token-'+index
    };
    players.push(player);
    game.players.push(player);
    game.memberships.push({
      ...structuredClone(hostMembership),
      id:'pause-membership-'+index,playerId:player.id,
      stateId:hostMembership.stateId,status:'active'
    });
  }

  const started=multiplayer.applyAdmin(game,'start',{});
  assert.equal(started.ok,true,started.error);
  let orderSequence=0;
  const vote=(player,type='pause')=>multiplayer.applyOrder(game,player,{
    orderId:'pause-vote-'+(++orderSequence),gameId:game.id,
    playerId:player.id,expectedWorldVersion:game.worldVersion,
    stateId:hostMembership.stateId,type
  });

  const first=vote(host);
  assert.equal(first.accepted,true,first.error);
  assert.equal(game.status,'running','the host has only one ordinary vote');
  const second=vote(players[1]);
  assert.equal(second.accepted,true,second.error);
  assert.equal(game.status,'running','two of four votes is a tie, not a majority');
  assert.equal(game.pauseVotePlayerIds.length,2);
  const third=vote(players[2]);
  assert.equal(third.accepted,true,third.error);
  assert.equal(game.status,'paused');
  assert.equal(game.paused,true);
  assert.deepEqual(game.pauseVotePlayerIds,[]);

  const resume1=vote(host,'resume');
  assert.equal(resume1.accepted,true,resume1.error);
  assert.equal(game.status,'paused');
  const resume2=vote(players[1],'resume');
  assert.equal(resume2.accepted,true,resume2.error);
  assert.equal(game.status,'paused','a resume tie must remain paused');
  const resume3=vote(players[3],'resume');
  assert.equal(resume3.accepted,true,resume3.error);
  assert.equal(game.status,'running');
  assert.equal(game.paused,false);
  assert.deepEqual(game.pauseVotePlayerIds,[]);
});

test('versioned snapshot deltas patch nested objects and arrays without changing their base snapshot',()=>{
  const {createVersionedSnapshotDelta,applyVersionedSnapshotDelta}=multiplayer;
  const {game}=multiplayer.createInitialWorld('Delta Test Host');
  const previous=multiplayer.snapshot(game);
  const next=structuredClone(previous);
  next.worldVersion+=2;
  next.day++;
  next.worldDate='1500-01-02';
  next.activity.push('A new activity record.');
  next.players[0].connected=false;
  next.territories[0].treasury-=15;
  next.events.push({
    id:'delta-event-1',gameId:game.id,orderId:null,actorPlayerId:null,
    stateId:game.territories[0].stateId,type:'test.delta',
    resultCode:null,occurredAtUtc:'1500-01-02T00:00:00.000Z',
    worldDate:'1500-01-02',worldVersion:next.worldVersion,
    description:'Test delta event.',sequence:(next.eventSequence || 0)+1
  });
  const delta=createVersionedSnapshotDelta(previous,next);
  assert.ok(delta);
  assert.equal(delta.gameId,game.id);
  assert.equal(delta.baseWorldVersion,previous.worldVersion);
  assert.equal(delta.worldVersion,next.worldVersion);
  assert.ok(delta.operations.length>0);
  const applied=applyVersionedSnapshotDelta(previous,delta);
  assert.deepEqual(applied,next);
  assert.equal(previous.day,1,'applying a delta must not mutate its source snapshot');
});

test('versioned snapshot deltas reject stale bases and unsafe paths',()=>{
  const {createVersionedSnapshotDelta,applyVersionedSnapshotDelta}=multiplayer;
  const {game}=multiplayer.createInitialWorld('Delta Security Host');
  const previous=multiplayer.snapshot(game);
  const next=structuredClone(previous);
  next.worldVersion++;
  next.day++;
  const delta=createVersionedSnapshotDelta(previous,next);
  assert.equal(applyVersionedSnapshotDelta(previous,{
    ...delta,baseWorldVersion:delta.baseWorldVersion+1
  }),null);
  assert.equal(applyVersionedSnapshotDelta(previous,{
    ...delta,operations:[{op:'set',path:['__proto__','polluted'],value:true}]
  }),null);
  assert.equal(applyVersionedSnapshotDelta(previous,{
    ...delta,operations:[{op:'remove',path:['missing']}]
  }),null);
});


test('technical maintenance messages are explicit, bounded, versioned and isolated from world identity',()=>{
  const {createTechnicalMaintenanceMessage,validateTechnicalMaintenanceMessage}=multiplayer;
  const gameId='world-maintenance-test';
  const changedAt='2026-11-09T12:00:00.000Z';
  const active=createTechnicalMaintenanceMessage(
    gameId,true,'  Database   index rebuild <script>\nrecovery check  ',2,changedAt
  );
  assert.ok(active);
  assert.equal(active.t,'maintenance');
  assert.equal(active.protocolVersion,1);
  assert.equal(active.active,true);
  assert.equal(active.reason,'Database index rebuild script recovery check');
  assert.deepEqual(validateTechnicalMaintenanceMessage(active,gameId),{
    active:true,reason:active.reason,revision:2,changedAt
  });
  assert.equal(validateTechnicalMaintenanceMessage(active,'another-world'),null);
  assert.equal(validateTechnicalMaintenanceMessage({...active,revision:0},gameId),null);
  assert.equal(validateTechnicalMaintenanceMessage({...active,changedAt:'2026-02-30T12:00:00.000Z'},gameId),null);
  assert.equal(validateTechnicalMaintenanceMessage({...active,protocolVersion:2},gameId),null);
  assert.equal(validateTechnicalMaintenanceMessage({...active,reason:'x'.repeat(241)},gameId),null);
  assert.equal(createTechnicalMaintenanceMessage(gameId,true,'',3,changedAt),null);
  assert.equal(createTechnicalMaintenanceMessage(gameId,true,'short',0,changedAt),null);
  assert.equal(createTechnicalMaintenanceMessage(gameId,true,'valid reason',3,'not-a-date'),null);

  const cleared=createTechnicalMaintenanceMessage(gameId,false,'ignored reason',3,changedAt);
  assert.ok(cleared);
  assert.equal(cleared.active,false);
  assert.equal(cleared.reason,'');
  assert.deepEqual(validateTechnicalMaintenanceMessage(cleared,gameId),{
    active:false,reason:'',revision:3,changedAt
  });
  assert.equal(validateTechnicalMaintenanceMessage({...cleared,reason:'not empty'},gameId),null);
});


test('host technical maintenance is communicated independently and freezes only the operational clock',async()=>{
  const {EventEmitter}=require('node:events');
  const previousMqtt=global.mqtt;
  const previousLocalStorage=global.localStorage;
  const storage=new Map();
  const clients=[];
  class FakeMqttClient extends EventEmitter {
    constructor(){super();this.connected=false;this.publications=[];this.subscriptions=[];}
    subscribe(topics,options,callback){
      this.subscriptions.push(topics);
      callback?.(null);
    }
    publish(topic,payload,options){
      this.publications.push({topic,message:JSON.parse(String(payload)),options});
    }
    end(){
      this.connected=false;
      this.emit('close');
    }
  }
  global.localStorage={
    getItem:key=>storage.has(key)?storage.get(key):null,
    setItem:(key,value)=>storage.set(key,String(value)),
    removeItem:key=>storage.delete(key)
  };
  global.mqtt={
    connect:()=>{
      const client=new FakeMqttClient();
      clients.push(client);
      setImmediate(()=>{
        client.connected=true;
        client.emit('connect');
      });
      return client;
    }
  };

  try {
    const notices=[];
    const snapshots=[];
    const created=await window.NewWorldMultiplayer.createWorld('Maintenance Host',{
      onMaintenance:status=>notices.push({...status}),
      onSnapshot:game=>snapshots.push(game)
    });
    assert.equal(window.NewWorldMultiplayer.isHost(),true);
    assert.equal(created.game.status,'lobby');
    const started=await window.NewWorldMultiplayer.admin('start');
    assert.equal(started.status,'running');

    const clockBefore=window.NewWorldMultiplayer.clockPresentation();
    assert.equal(clockBefore.running,true);
    const active=window.NewWorldMultiplayer.setTechnicalMaintenance(
      true,'Rebuilding database indexes and verifying backups'
    );
    assert.equal(active.ok,true,active.error);
    assert.equal(active.published,true);
    assert.equal(active.status.active,true);
    assert.equal(window.NewWorldMultiplayer.clockPresentation().running,false);
    assert.equal(window.NewWorldMultiplayer.clockStatus().status,'running',
      'technical maintenance must not rewrite the political running/paused state');
    assert.equal(window.NewWorldMultiplayer.clockStatus().technicalMaintenance.active,true);

    const messages=clients.flatMap(client=>client.publications)
      .filter(item=>item.message.t==='maintenance');
    assert.ok(messages.some(item=>
      item.message.gameId===created.game.id&&item.message.active===true&&
      item.message.reason==='Rebuilding database indexes and verifying backups'));
    assert.ok(notices.some(item=>item.active===true));

    const cleared=window.NewWorldMultiplayer.setTechnicalMaintenance(false,'');
    assert.equal(cleared.ok,true,cleared.error);
    assert.equal(cleared.published,true);
    assert.equal(window.NewWorldMultiplayer.clockPresentation().running,true);
    assert.equal(window.NewWorldMultiplayer.clockStatus().status,'running');
    assert.equal(window.NewWorldMultiplayer.clockStatus().technicalMaintenance.active,false);
    assert.ok(notices.some(item=>item.active===false));
    const latest=clients.flatMap(client=>client.publications)
      .filter(item=>item.message.t==='maintenance').at(-1);
    assert.equal(latest.message.active,false);
    assert.equal(latest.message.reason,'');
  } finally {
    window.NewWorldMultiplayer.disconnect();
    if(previousMqtt===undefined) delete global.mqtt;
    else global.mqtt=previousMqtt;
    if(previousLocalStorage===undefined) delete global.localStorage;
    else global.localStorage=previousLocalStorage;
  }
});


test('technical maintenance reaches an independently connected guest on the host WebSocket relay',async()=>{
  const vm=require('node:vm');
  const fs=require('node:fs');
  const path=require('node:path');
  const webcrypto=require('node:crypto').webcrypto;
  const source=fs.readFileSync(path.join(__dirname,'..','multiplayer.js'),'utf8');
  const retained=new Map();
  const clients=[];
  const matches=(pattern,topic)=>{
    const left=pattern.split('/');
    const right=topic.split('/');
    return left.length===right.length&&left.every((part,index)=>part==='+'||part===right[index]);
  };
  class SharedFakeMqttClient extends require('node:events').EventEmitter {
    constructor(){super();this.connected=false;this.subscriptions=[];this.publications=[];}
    subscribe(topics,options,callback){
      const items=Array.isArray(topics)?topics:[topics];
      this.subscriptions.push(...items);
      callback?.(null);
      for(const [topic,payload] of retained) {
        if(items.some(pattern=>matches(pattern,topic)))
          queueMicrotask(()=>this.emit('message',topic,Buffer.from(payload)));
      }
    }
    publish(topic,payload,options={}){
      const text=String(payload);
      this.publications.push({topic,message:JSON.parse(text),options});
      if(options.retain) {
        if(text==='') retained.delete(topic);
        else retained.set(topic,text);
      }
      for(const client of clients) {
        if(client.connected&&client.subscriptions.some(pattern=>matches(pattern,topic)))
          queueMicrotask(()=>client.emit('message',topic,Buffer.from(text)));
      }
    }
    end(){
      this.connected=false;
      this.emit('close');
    }
  }
  const mqtt={connect:()=>{
    const client=new SharedFakeMqttClient();
    clients.push(client);
    setImmediate(()=>{client.connected=true;client.emit('connect');});
    return client;
  }};
  function browserContext(){
    const context={
      window:{NewWorldSimulation:simulation,NewWorldStrategy:strategy},
      module:{exports:{}},crypto:webcrypto,mqtt,structuredClone,
      localStorage:{
        data:new Map(),
        getItem(key){return this.data.has(key)?this.data.get(key):null;},
        setItem(key,value){this.data.set(key,String(value));},
        removeItem(key){this.data.delete(key);}
      },
      setInterval:()=>({unref(){}}),clearInterval:()=>{},
      setTimeout,clearTimeout,Date,Math,JSON,Map,Set,Promise,console
    };
    vm.createContext(context);
    vm.runInContext(source,context,{filename:'multiplayer.js'});
    return context.window.NewWorldMultiplayer;
  }
  const host=browserContext();
  const guest=browserContext();
  const hostNotices=[];
  const guestNotices=[];
  const hostSnapshots=[];
  try {
    const created=await host.createWorld('WebSocket Host',{
      onMaintenance:status=>hostNotices.push({...status}),
      onSnapshot:game=>hostSnapshots.push(game)
    });
    const joined=await guest.joinWorld(created.session.inviteCode,'Remote Guest',{
      onMaintenance:status=>guestNotices.push({...status})
    });
    assert.equal(joined.gameId,created.game.id);
    assert.equal(guest.isHost(),false);
    await host.admin('start');
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(guest.clockPresentation().running,true,
      'a guest should interpolate the authoritative host clock after receiving the start snapshot');

    const active=host.setTechnicalMaintenance(true,'Applying a database migration');
    assert.equal(active.ok,true,active.error);
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(guest.technicalMaintenanceStatus().active,true);
    assert.equal(guest.technicalMaintenanceStatus().reason,'Applying a database migration');
    assert.equal(guest.clockPresentation().running,false);
    assert.ok(guestNotices.some(status=>status.active===true));
    assert.ok(hostNotices.some(status=>status.active===true));

    const cleared=host.setTechnicalMaintenance(false,'');
    assert.equal(cleared.ok,true,cleared.error);
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(guest.technicalMaintenanceStatus().active,false);
    assert.equal(guest.clockPresentation().running,true);
    assert.ok(guestNotices.some(status=>status.active===false));

    const hostClient=clients[0];
    hostClient.connected=false;
    hostClient.emit('offline');
    assert.equal(host.clockStatus().status,'paused');
    const relayLossSnapshot=hostSnapshots.at(-1);
    assert.equal(relayLossSnapshot.players.find(player=>player.id===joined.playerId).connected,true,
      'a guest remains connected even though loss of the authoritative host pauses the world');
    assert.equal(relayLossSnapshot.events.at(-1).resultCode,'HostRelayLost');
    assert.equal(relayLossSnapshot.events.at(-1).type,'world.paused.host_relay_lost');
  } finally {
    guest.disconnect();
    host.disconnect();
  }
});


test('epidemic configuration and live compartment state survive authoritative and public snapshots',()=>{
  const {game}=multiplayer.createInitialWorld('Epidemic Snapshot');
  game.epidemicDefinitions=[{
    id:'disease-a',stateId:game.territories[0].stateId,name:'Configured disease',
    description:'Explicit scenario disease profile.',incubationDays:2,
    infectiousDays:5,transmissionBasisPoints:750,dailyMortalityPerThousand:4,
    contactLinks:[{
      originGroupId:'group-a',destinationGroupId:'group-b',
      dailyContactsPerThousand:1000
    }]
  }];
  game.epidemicStarts=[{
    id:'start-a',definitionId:'disease-a',sourceGroupId:'group-a',
    startsOn:game.worldDate,initialInfectious:3
  }];
  game.epidemicOutbreaks=[{
    id:'outbreak-a',scenarioStartId:'start-a',definitionId:'disease-a',
    stateId:game.territories[0].stateId,startedOn:game.worldDate,
    status:'active',totalExposures:4,totalInfections:7,totalDeaths:1
  }];
  game.epidemicGroupStates=[{
    outbreakId:'outbreak-a',groupId:'group-a',stateId:game.territories[0].stateId,
    susceptible:90,exposedCohorts:[{daysRemaining:1,count:2}],
    infectiousCohorts:[{daysRemaining:3,count:3}],recovered:5
  }];
  game.epidemicHistory=[{
    id:'epidemic-day-a',outbreakId:'outbreak-a',
    stateId:game.territories[0].stateId,worldDate:game.worldDate,
    status:'active',exposed:2,infectious:3,recovered:5,deaths:1
  }];

  for(const snapshot of [
    multiplayer.snapshot(game),
    multiplayer.publicSnapshot(game),
    multiplayer.snapshotForPlayer(game,game.players[0].id)
  ]) {
    assert.deepEqual(snapshot.epidemicDefinitions,game.epidemicDefinitions);
    assert.deepEqual(snapshot.epidemicStarts,game.epidemicStarts);
    assert.deepEqual(snapshot.epidemicOutbreaks,game.epidemicOutbreaks);
    assert.deepEqual(snapshot.epidemicGroupStates,game.epidemicGroupStates);
    assert.deepEqual(snapshot.epidemicHistory,game.epidemicHistory);
  }
});


test('GameOrder target dates are strict and rejection reasons are structured and durable',()=>{
  const {game}=multiplayer.createInitialWorld('Target Date Validation');
  const player=game.players[0];
  const membership=game.memberships.find(item=>
    item.playerId===player.id&&item.status==='active');
  membership.permissionSetId='government-observer';
  assert.equal(multiplayer.applyAdmin(game,'start',{}).ok,true);
  const worldVersion=game.worldVersion;
  const treasury=game.territories[0].treasury;
  const orderBase={
    gameId:game.id,playerId:player.id,expectedWorldVersion:worldVersion,
    stateId:membership.stateId,type:'build',
    plotIndex:144+512*1024+512,buildingId:'farm'
  };
  const cases=[
    ['1500-02-30','INVALID_TARGET_DATE'],
    ['1499-12-31','TARGET_DATE_IN_PAST'],
    ['1500-01-02','INSUFFICIENT_PERMISSION']
  ];
  for(const [targetWorldDate,expectedCode] of cases) {
    const orderId='target-date-'+expectedCode;
    const result=multiplayer.applyOrder(game,player,{
      ...orderBase,orderId,targetWorldDate
    });
    assert.equal(result.accepted,false);
    assert.equal(result.code,expectedCode);
    const record=game.orders.find(item=>item.id===orderId);
    assert.ok(record);
    assert.equal(record.status,'rejected');
    assert.equal(record.targetWorldDate,targetWorldDate);
    assert.deepEqual(record.rejectionReason,{
      code:expectedCode,message:result.error,recordedOnWorldDate:game.worldDate
    });
    assert.equal(game.events.at(-1).resultCode,expectedCode);
    assert.equal(game.events.at(-1).orderId,orderId);
    assert.equal(game.worldVersion,worldVersion);
    assert.equal(game.territories[0].treasury,treasury);
    assert.equal(game.territories[0].buildings[orderBase.plotIndex],undefined);
  }

  const current=multiplayer.applyOrder(game,player,{
    ...orderBase,orderId:'target-date-current',targetWorldDate:game.worldDate
  });
  assert.equal(current.code,'INSUFFICIENT_PERMISSION',
    'an explicit date equal to the current world date must pass date validation and reach permission checks');
  const currentRecord=game.orders.find(item=>item.id==='target-date-current');
  assert.deepEqual(currentRecord.rejectionReason,{
    code:'INSUFFICIENT_PERMISSION',message:current.error,recordedOnWorldDate:game.worldDate
  });
});


test('future-dated orders are persisted, replay-safe and executed exactly once when the host calendar reaches their date',()=>{
  const {game}=multiplayer.createInitialWorld('Scheduled Orders');
  const player=game.players[0];
  assert.equal(multiplayer.applyAdmin(game,'start',{}).ok,true);
  const state=game.territories[0];
  const plotIndex=144+512*1024+512;
  const order={
    orderId:'future-build-once',gameId:game.id,playerId:player.id,
    expectedWorldVersion:game.worldVersion,stateId:state.stateId,
    type:'build',plotIndex,buildingId:'farm',targetWorldDate:'1500-01-02'
  };
  const scheduled=multiplayer.applyOrder(game,player,order);
  assert.equal(scheduled.accepted,true,scheduled.error);
  assert.equal(scheduled.code,'ORDER_SCHEDULED');
  assert.equal(game.scheduledOrders.length,1);
  assert.equal(game.scheduledOrders[0].status,'scheduled');
  assert.equal(game.scheduledOrders[0].targetWorldDate,'1500-01-02');
  assert.equal(game.orders.find(item=>item.id===order.orderId).status,'scheduled');
  assert.equal(game.territories[0].buildings[plotIndex],undefined);
  assert.equal(multiplayer.publicSnapshot(game).scheduledOrders.length,1);

  const replay=multiplayer.applyOrder(game,player,order);
  assert.equal(replay.accepted,true);
  assert.equal(replay.replayed,true);
  assert.equal(game.scheduledOrders.length,1);
  assert.equal(game.orders.filter(item=>item.id===order.orderId).length,1);

  const changedPayload=multiplayer.applyOrder(game,player,{
    ...order,buildingId:'waterworks'
  });
  assert.equal(changedPayload.accepted,false);
  assert.equal(changedPayload.code,'ORDER_ID_REUSED');

  const advanced=simulation.advanceDay(game);
  assert.equal(advanced.ok,true,advanced.error);
  assert.equal(game.worldDate,'1500-01-02');
  assert.equal(game.scheduledOrders[0].status,'executed');
  assert.equal(game.scheduledOrders[0].completedOnWorldDate,'1500-01-02');
  assert.equal(game.orders.find(item=>item.id===order.orderId).status,'executed');
  assert.ok(game.territories[0].buildings[plotIndex]);
  assert.equal(game.territories[0].buildings[plotIndex].daysRemaining,2);
  const executions=game.orders.filter(item=>item.id===game.scheduledOrders[0].executionOrderId);
  assert.equal(executions.length,1);
  assert.equal(executions[0].status,'executed');

  assert.equal(simulation.advanceDay(game).ok,true);
  assert.equal(game.orders.filter(item=>item.id===game.scheduledOrders[0].executionOrderId).length,1);
  assert.equal(game.scheduledOrders[0].status,'executed');
});

test('scheduled orders are revalidated on execution and fail safely when the author loses permission',()=>{
  const {game}=multiplayer.createInitialWorld('Scheduled Permission Recheck');
  const player=game.players[0];
  const membership=game.memberships.find(item=>item.playerId===player.id&&item.status==='active');
  assert.equal(multiplayer.applyAdmin(game,'start',{}).ok,true);
  const plotIndex=144+512*1024+700;
  const order={
    orderId:'future-build-permission-revoked',gameId:game.id,playerId:player.id,
    expectedWorldVersion:game.worldVersion,stateId:membership.stateId,
    type:'build',plotIndex,buildingId:'farm',targetWorldDate:'1500-01-02'
  };
  const scheduled=multiplayer.applyOrder(game,player,order);
  assert.equal(scheduled.accepted,true,scheduled.error);
  membership.permissionSetId='government-observer';
  const advanced=simulation.advanceDay(game);
  assert.equal(advanced.ok,true,advanced.error);
  assert.equal(game.scheduledOrders[0].status,'rejected');
  assert.equal(game.scheduledOrders[0].resultCode,'INSUFFICIENT_PERMISSION');
  assert.equal(game.orders.find(item=>item.id===order.orderId).status,'rejected');
  assert.equal(game.territories[0].buildings[plotIndex],undefined);
  assert.ok(game.events.some(item=>
    item.type==='order.schedule_resolved'&&item.orderId===order.orderId&&
    item.resultCode==='INSUFFICIENT_PERMISSION'));
});

test('scheduled orders can be cancelled by their author but not by another government member',()=>{
  const {game}=multiplayer.createInitialWorld('Scheduled Cancellation');
  const host=game.players[0];
 const state=game.territories[0];
  const guestPlayer=guest('schedule-cancel-guest','Schedule Guest');
  game.players.push(guestPlayer);
  const assigned=multiplayer.applyAdmin(game,'assign',{
    playerId:guestPlayer.id,countryIndex:0
  });
  assert.equal(assigned.ok,true,assigned.error);
  assert.equal(multiplayer.applyAdmin(game,'start',{}).ok,true);
  const order={
    orderId:'future-build-cancelled',gameId:game.id,playerId:host.id,
    expectedWorldVersion:game.worldVersion,stateId:state.stateId,
    type:'build',plotIndex:144+512*1024+701,buildingId:'farm',
    targetWorldDate:'1500-01-02'
  };
  const scheduled=multiplayer.applyOrder(game,host,order);
  assert.equal(scheduled.accepted,true,scheduled.error);
  const record=game.scheduledOrders[0];

  const unauthorized=multiplayer.applyOrder(game,guestPlayer,{
    orderId:'cancel-someone-elses-order',gameId:game.id,playerId:guestPlayer.id,
    expectedWorldVersion:game.worldVersion,stateId:state.stateId,
    type:'cancelScheduledOrder',scheduledOrderId:record.id
  });
  assert.equal(unauthorized.accepted,false);
  assert.equal(unauthorized.code,'SCHEDULED_ORDER_NOT_OWNED');
  assert.equal(record.status,'scheduled');

  const cancelled=multiplayer.applyOrder(game,host,{
    orderId:'cancel-own-scheduled-order',gameId:game.id,playerId:host.id,
    expectedWorldVersion:game.worldVersion,stateId:state.stateId,
    type:'cancelScheduledOrder',scheduledOrderId:record.id
  });
  assert.equal(cancelled.accepted,true,cancelled.error);
  assert.equal(record.status,'cancelled');
  assert.equal(game.orders.find(item=>item.id===record.id).status,'cancelled');
  assert.equal(simulation.advanceDay(game).ok,true);
  assert.equal(record.status,'cancelled');
  assert.equal(game.territories[0].buildings[order.plotIndex],undefined);
});

test('scheduled orders reject pause votes and dates beyond the documented horizon',()=>{
  const {game}=multiplayer.createInitialWorld('Scheduled Limits');
  const player=game.players[0];
  assert.equal(multiplayer.applyAdmin(game,'start',{}).ok,true);
  const base={
    gameId:game.id,playerId:player.id,stateId:game.territories[0].stateId,
    expectedWorldVersion:game.worldVersion
  };
  const pause=multiplayer.applyOrder(game,player,{
    ...base,orderId:'scheduled-pause-vote',type:'pause',targetWorldDate:'1500-01-02'
  });
  assert.equal(pause.accepted,false);
  assert.equal(pause.code,'ORDER_TYPE_NOT_SCHEDULABLE');
  const tooFar=multiplayer.applyOrder(game,player,{
    ...base,orderId:'scheduled-too-far',type:'build',
    plotIndex:144+512*1024+702,buildingId:'farm',targetWorldDate:'1510-01-01'
  });
  assert.equal(tooFar.accepted,false);
  assert.equal(tooFar.code,'SCHEDULE_HORIZON_EXCEEDED');
  assert.equal(game.scheduledOrders.length,0);
});


test('confidential security and justice actions cannot enter the public scheduled-order queue',()=>{
  const {game}=multiplayer.createInitialWorld('Confidential Scheduling');
  const player=game.players[0];
  assert.equal(multiplayer.applyAdmin(game,'start',{}).ok,true);
  const base={
    gameId:game.id,playerId:player.id,stateId:game.territories[0].stateId,
    expectedWorldVersion:game.worldVersion
  };
  for(const [type,extra] of [
    ['security.addReport',{caseId:'case-secret',description:'Confidential source report.'}],
    ['security.openCase',{incidentId:'incident-secret',title:'Sensitive investigation'}],
    ['justice.addEvidence',{caseId:'case-justice',description:'Restricted evidence record.'}]
  ]) {
    const result=multiplayer.applyOrder(game,player,{
      ...base,orderId:'scheduled-private-'+type,targetWorldDate:'1500-01-02',
      type,...extra
    });
    assert.equal(result.accepted,false);
    assert.equal(result.code,'ORDER_TYPE_NOT_SCHEDULABLE');
  }
  assert.equal(game.scheduledOrders.length,0);
});
