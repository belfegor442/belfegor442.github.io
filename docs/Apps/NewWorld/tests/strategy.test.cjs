'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const simulation=require('../simulation.js');
const strategy=require('../strategy.js');
global.window={NewWorldSimulation:simulation,NewWorldStrategy:strategy};
const multiplayer=require('../multiplayer.js');

let sequence=0;
function freshWorld() {
  const {game}=multiplayer.createInitialWorld('Test Founder');
  assert.equal(multiplayer.applyAdmin(game,'start',{}).ok,true);
  return game;
}
function submit(game,player,type,payload={}) {
  const membership=game.memberships.find(item =>
    item.playerId===player.id && item.status==='active' && item.stateId===payload.stateId) ||
    game.memberships.find(item => item.playerId===player.id && item.status==='active');
  assert.ok(membership,'player needs an active government membership');
  return multiplayer.applyOrder(game,player,{
    orderId:'strategy-order-'+(++sequence),gameId:game.id,playerId:player.id,
    expectedWorldVersion:game.worldVersion,stateId:membership.stateId,type,...payload
  });
}

test('new campaigns load playable political, military and research systems without technical JSON setup',()=>{
  const {game}=multiplayer.createInitialWorld('Founder');
  assert.equal(game.provinces.length,16);
  assert.equal(game.militaryRoutes.length,32);
  assert.equal(game.diplomaticRelations.length,120);
  assert.equal(game.militaryUnits.length,1);
  assert.equal(game.militaryUnitTypes.length,3);
  assert.equal(game.politicalSystems.every(system =>
    system.constitution && system.government && system.institutions.length===2),true);
  assert.equal(game.technologies.length,4);
  assert.equal(game.researchProjects.length,64);
  assert.equal(game.researchProjects.filter(project =>
    project.stateId===game.territories[0].stateId && project.status==='proposed').length,4);
  const hostMembership=game.memberships.find(item => item.playerId===game.hostPlayerId);
  assert.equal(hostMembership.permissionSetId,'government-executive');
});

test('legacy saved campaigns gain strategy systems without losing buildings or economic data',()=>{
  const {game}=multiplayer.createInitialWorld('Legacy Founder');
  const home=game.territories[0];
  const originalTreasury=home.treasury;
  const originalCompanies=structuredClone(game.companies);
  home.buildings['778899']={id:'farm',name:'Legacy Farm',daysRemaining:0};
  game.strategyVersion=0;
  for(const field of [
    'provinces','provinceConnections','diplomaticRelations',
    'militaryRoutes','militaryUnitTypes','militaryCommanders','militaryUnits',
    'militaryOrders','militaryBattles',
    'occupations','supplyRoutes','technologies','researchInstitutions',
    'researchProjects','technologyUnlocks','technologyAdoptions'
  ]) game[field]=[];
  game.politicalSystems=game.territories.map(territory=>({
    stateId:territory.stateId,configurationPending:true,regime:null,
    constitution:null,government:null,institutions:[],offices:[],parties:[],laws:[],decisions:[]
  }));
  const versionBefore=game.worldVersion;
  assert.equal(multiplayer.migrateStrategyScenario(game),true);
  assert.equal(game.strategyVersion,1);
  assert.equal(game.worldVersion,versionBefore+1);
  assert.equal(game.provinces.length,16);
  assert.equal(game.diplomaticRelations.length,120);
  assert.equal(game.militaryUnits.length,1);
  assert.equal(game.researchProjects.length,64);
  assert.equal(game.territories[0].buildings['778899'].name,'Legacy Farm');
  assert.equal(game.territories[0].treasury,originalTreasury);
  assert.deepEqual(game.companies,originalCompanies);
  assert.equal(game.politicalSystems[0].offices.find(item =>
    item.id==='chief-executive').holderPlayerId,game.hostPlayerId);
  assert.equal(multiplayer.migrateStrategyScenario(game),false);
  assert.equal(game.militaryUnits.length,1);
});

test('military recruitment and battles create an occupation that transfers territory after three days',()=>{
  const game=freshWorld();
  const host=game.players[0];
  const origin=game.territories[0];
  const target=game.territories[1];
  const targetProvince=game.provinces.find(item => item.stateId===target.stateId);
  const unit=game.militaryUnits[0];
  const ally={id:'allied-founder',name:'Allied founder',connected:true,token:'allied-token'};
  game.players.push(ally);
  game.memberships.push({
    id:'allied-home',gameId:game.id,playerId:ally.id,
    stateId:origin.stateId,status:'active',permissionSetId:'government-member'
  });
  const route=game.militaryRoutes.find(item =>
    item.originProvinceId===unit.provinceId && item.destinationProvinceId===targetProvince.id);

  const recruited=submit(game,host,'recruitUnit',{stateId:origin.stateId,unitTypeId:'militia'});
  assert.equal(recruited.accepted,true,recruited.error);
  assert.equal(game.militaryUnits.length,2);
  assert.equal(origin.treasury,980);

  const attack=submit(game,host,'mobilizeUnit',{
    stateId:origin.stateId,militaryUnitId:unit.id,
    militaryOrderType:'attack',destinationProvinceId:targetProvince.id,militaryRouteId:route.id
  });
  assert.equal(attack.accepted,true,attack.error);
  assert.equal(game.militaryBattles.length,1);
  assert.equal(game.militaryBattles[0].result,'Attacker victory');
  assert.equal(game.occupations[0].status,'active');
  assert.equal(unit.provinceId,targetProvince.id);
  assert.equal(target.ownerPlayerId,null);
  const treasuryDuringOccupation=game.territories[0].treasury;
  const competingClaim=submit(game,host,'claim',{
    stateId:origin.stateId,territoryIndex:target.index
  });
  assert.equal(competingClaim.accepted,false);
  assert.equal(competingClaim.code,'TARGET_OCCUPIED');
  assert.equal(game.territories[0].treasury,treasuryDuringOccupation);

  for(let day=0;day<3;day++) assert.equal(simulation.advanceDay(game).ok,true);
  assert.equal(game.territories[1].ownerPlayerId,host.id);
  assert.equal(game.occupations[0].status,'completed');
  assert.equal(game.occupations[0].controlEffective,true);
  assert.equal(game.provinces.find(item => item.stateId===game.territories[1].stateId).sovereignStateId,origin.stateId);
  assert.equal(game.memberships.some(item =>
    item.playerId===host.id && item.stateId===target.stateId && item.status==='active'),true);
  assert.equal(game.memberships.some(item =>
    item.playerId===ally.id && item.stateId===target.stateId && item.status==='active'),true);
  assert.equal(game.sovereigntyHistory.at(-1).newStateId,origin.stateId);
  assert.equal(game.politicalSystems.find(item => item.stateId===target.stateId)
    .offices.find(item => item.id==='chief-executive').holderPlayerId,host.id);
});

test('diplomacy requires a declaration before war and only permits peace after occupation ends',()=>{
  const game=freshWorld();
  const host=game.players[0];
  const home=game.territories[0];
  const enemyState=game.territories[1];
  const enemy={id:'enemy-player',name:'Foreign Government',connected:true,token:'enemy-token'};
  game.players.push(enemy);
  enemyState.ownerPlayerId=enemy.id;
  game.memberships.push({
    id:'enemy-government',gameId:game.id,playerId:enemy.id,
    stateId:enemyState.stateId,status:'active',permissionSetId:'government-executive'
  });
  const province=game.provinces.find(item=>item.stateId===enemyState.stateId);
  province.defenceRating=0;
  const route=game.militaryRoutes.find(item =>
    item.originProvinceId===game.militaryUnits[0].provinceId &&
    item.destinationProvinceId===province.id);

  const attackBeforeWar=submit(game,host,'mobilizeUnit',{
    stateId:home.stateId,militaryUnitId:game.militaryUnits[0].id,
    militaryOrderType:'attack',destinationProvinceId:province.id,militaryRouteId:route.id
  });
  assert.equal(attackBeforeWar.accepted,false);
  assert.equal(attackBeforeWar.code,'WAR_NOT_DECLARED');
  assert.equal(game.militaryBattles.length,0);

  const declaration=submit(game,host,'declareWar',{
    stateId:home.stateId,targetStateId:enemyState.stateId
  });
  assert.equal(declaration.accepted,true,declaration.error);
  const relation=game.diplomaticRelations.find(item =>
    item.stateAId===home.stateId && item.stateBId===enemyState.stateId ||
    item.stateBId===home.stateId && item.stateAId===enemyState.stateId);
  assert.equal(relation.status,'war');

  const duplicate=submit(game,host,'declareWar',{
    stateId:home.stateId,targetStateId:enemyState.stateId
  });
  assert.equal(duplicate.accepted,false);
  assert.equal(duplicate.code,'WAR_ALREADY_ACTIVE');

  const attack=submit(game,host,'mobilizeUnit',{
    stateId:home.stateId,militaryUnitId:game.militaryUnits[0].id,
    militaryOrderType:'attack',destinationProvinceId:province.id,militaryRouteId:route.id
  });
  assert.equal(attack.accepted,true,attack.error);
  assert.equal(game.occupations[0].status,'active');
  const earlyPeace=submit(game,host,'makePeace',{
    stateId:home.stateId,targetStateId:enemyState.stateId
  });
  assert.equal(earlyPeace.accepted,false);
  assert.equal(earlyPeace.code,'OCCUPATION_ACTIVE');

  for(let day=0;day<4;day++) assert.equal(simulation.advanceDay(game).ok,true);
  assert.equal(game.territories[1].ownerPlayerId,host.id);
  const peace=submit(game,host,'makePeace',{
    stateId:home.stateId,targetStateId:enemyState.stateId
  });
  assert.equal(peace.accepted,true,peace.error);
  assert.equal(game.diplomaticRelations.find(item =>
    item.stateAId===home.stateId && item.stateBId===enemyState.stateId ||
    item.stateBId===home.stateId && item.stateAId===enemyState.stateId).status,'peace');
  assert.ok(game.events.some(item=>item.type==='diplomacy.war_declared'));
  assert.ok(game.events.some(item=>item.type==='diplomacy.peace_signed'));
});

test('legacy military units initialise recovery capacity before sustaining battle losses',()=>{
  const game=freshWorld();
  const host=game.players[0];
  const unit=game.militaryUnits[0];
  delete unit.maxPersonnel;
  const target=game.territories[1];
  const province=game.provinces.find(item=>item.stateId===target.stateId);
  const route=game.militaryRoutes.find(item =>
    item.originProvinceId===unit.provinceId && item.destinationProvinceId===province.id);
  const result=submit(game,host,'mobilizeUnit',{
    stateId:game.territories[0].stateId,militaryUnitId:unit.id,
    militaryOrderType:'attack',destinationProvinceId:province.id,militaryRouteId:route.id
  });
  assert.equal(result.accepted,true,result.error);
  assert.equal(unit.maxPersonnel,120);
  assert.ok(unit.personnel<unit.maxPersonnel);
  for(let day=0;day<20 && unit.personnel<unit.maxPersonnel;day++)
    assert.equal(simulation.advanceDay(game).ok,true);
  assert.equal(game.militaryUnits[0].personnel,120);
});

test('public trade routes require importer approval and can be cancelled by either government',()=>{
  const {game}=multiplayer.createInitialWorld('Founder');
  const host=game.players[0];
  const origin=game.territories[0];
  const destination=game.territories[1];
  const importer={id:'importer-player',name:'Importer',connected:true,token:'importer-token',treasury:0,dailyBalanceRemainder:0,buildings:{}};
  game.players.push(importer);
  const assigned=multiplayer.applyAdmin(game,'assign',{
    playerId:importer.id,countryIndex:destination.index
  });
  assert.equal(assigned.ok,true,assigned.error);
  assert.equal(destination.population,850);
  assert.equal(game.markets.some(item=>item.stateId===destination.stateId),true);
  assert.equal(game.militaryUnits.some(item=>item.stateId===destination.stateId),true);
  assert.equal(multiplayer.applyAdmin(game,'start',{}).ok,true);
  const market=game.markets.find(item =>
    item.stateId===destination.stateId && item.goodId==='grain');
  market.dailyDemand=20;
  const treasuryBefore=origin.treasury;
  const routeOrder=submit(game,host,'establishTradeRoute',{
    stateId:origin.stateId,destinationStateId:destination.stateId,
    goodId:'grain',dailyCapacity:50
  });
  assert.equal(routeOrder.accepted,true,routeOrder.error);
  const route=game.tradeRoutes[0];
  assert.equal(route.status,'pending');
  assert.equal(route.enabled,false);
  assert.equal(origin.treasury,treasuryBefore-150);
  assert.equal(game.financialTransactions.at(-1).amount,-150);
  const duplicate=submit(game,host,'establishTradeRoute',{
    stateId:origin.stateId,destinationStateId:destination.stateId,
    goodId:'grain',dailyCapacity:20
  });
  assert.equal(duplicate.accepted,false);
  assert.equal(duplicate.code,'TRADE_ROUTE_EXISTS');
  assert.equal(game.tradeRoutes.length,1);

  assert.equal(simulation.advanceDay(game).ok,true);
  let settlement=game.marketHistory.find(item =>
    item.stateId===destination.stateId && item.goodId==='grain');
  assert.equal(settlement.importedSupply,0);

  const accepted=submit(game,importer,'respondTradeRoute',{
    stateId:destination.stateId,tradeRouteId:route.id,accept:true
  });
  assert.equal(accepted.accepted,true,accepted.error);
  assert.equal(game.tradeRoutes[0].status,'active');
  assert.equal(game.tradeRoutes[0].enabled,true);
  assert.equal(simulation.advanceDay(game).ok,true);
  settlement=game.marketHistory.filter(item =>
    item.stateId===destination.stateId && item.goodId==='grain').at(-1);
  assert.equal(settlement.importedSupply,50);
  assert.equal(game.companyFinancialTransactions.some(item =>
    item.tradeRouteId===route.id && item.type==='TradeSale'),true);

  const cancelled=submit(game,importer,'cancelTradeRoute',{
    stateId:destination.stateId,tradeRouteId:route.id
  });
  assert.equal(cancelled.accepted,true,cancelled.error);
  assert.equal(game.tradeRoutes[0].status,'cancelled');
  assert.equal(game.tradeRoutes[0].enabled,false);
  assert.equal(simulation.advanceDay(game).ok,true);
  assert.equal(game.marketHistory.filter(item =>
    item.stateId===destination.stateId && item.goodId==='grain').at(-1).importedSupply,0);
});

test('rejected trade proposals refund the exporting State and cannot import goods',()=>{
  const {game}=multiplayer.createInitialWorld('Founder');
  const host=game.players[0];
  const origin=game.territories[0];
  const destination=game.territories[1];
  const importer={id:'rejecting-importer',name:'Rejecting importer',connected:true,token:'reject-token',treasury:0,dailyBalanceRemainder:0,buildings:{}};
  game.players.push(importer);
  const assigned=multiplayer.applyAdmin(game,'assign',{
    playerId:importer.id,countryIndex:destination.index
  });
  assert.equal(assigned.ok,true,assigned.error);
  assert.equal(destination.population,850);
  assert.equal(game.markets.some(item=>item.stateId===destination.stateId),true);
  assert.equal(game.militaryUnits.some(item=>item.stateId===destination.stateId),true);
  assert.equal(multiplayer.applyAdmin(game,'start',{}).ok,true);
  const treasuryBefore=origin.treasury;
  const proposed=submit(game,host,'establishTradeRoute',{
    stateId:origin.stateId,destinationStateId:destination.stateId,
    goodId:'grain',dailyCapacity:25
  });
  assert.equal(proposed.accepted,true,proposed.error);
  const route=game.tradeRoutes[0];
  const rejected=submit(game,importer,'respondTradeRoute',{
    stateId:destination.stateId,tradeRouteId:route.id,accept:false
  });
  assert.equal(rejected.accepted,true,rejected.error);
  assert.equal(route.status,'rejected');
  assert.equal(route.enabled,false);
  assert.equal(origin.treasury,treasuryBefore);
  assert.equal(game.financialTransactions.at(-1).type,'tradeRouteRefund');
  assert.equal(simulation.advanceDay(game).ok,true);
  const settlement=game.marketHistory.find(item =>
    item.stateId===destination.stateId && item.goodId==='grain');
  assert.equal(settlement.importedSupply,0);
});

test('research consumes a reserved State budget, unlocks a technology, and adoption applies its effect',()=>{
  const game=freshWorld();
  const host=game.players[0];
  const territory=game.territories[0];
  const project=game.researchProjects.find(item =>
    item.stateId===territory.stateId && item.technologyId==='masonry');

  const started=submit(game,host,'startProject',{
    stateId:territory.stateId,researchProjectId:project.id
  });
  assert.equal(started.accepted,true,started.error);
  assert.equal(territory.treasury,1080);
  assert.equal(project.status,'active');
  for(let day=0;day<5;day++) assert.equal(simulation.advanceDay(game).ok,true);

  assert.equal(game.researchProjects.find(item => item.id===project.id).status,'completed');
  assert.equal(game.technologyUnlocks.some(item =>
    item.stateId===territory.stateId && item.technologyId==='masonry'),true);
  const adopted=submit(game,host,'adoptTechnology',{
    stateId:territory.stateId,technologyId:'masonry'
  });
  assert.equal(adopted.accepted,true,adopted.error);
  assert.equal(strategy.effectValue(game,territory.stateId,'construction_discount'),0.1);

  const built=submit(game,host,'build',{
    stateId:territory.stateId,plotIndex:144+512*1024+512,
    buildingId:'farm'
  });
  assert.equal(built.accepted,true,built.error);
  assert.equal(game.financialTransactions.at(-1).amount,-108);
  assert.equal(game.territories[0].treasury,986);
});

test('constitutional budget, law, vote and office appointment orders change government state',()=>{
  const game=freshWorld();
  const host=game.players[0];
  const territory=game.territories[0];
  const system=game.politicalSystems.find(item => item.stateId===territory.stateId);
  const member={id:'council-member',name:'Council Member',connected:true,token:'council-token'};
  game.players.push(member);
  game.memberships.push({
    id:'council-membership',gameId:game.id,playerId:member.id,
    stateId:territory.stateId,status:'active',permissionSetId:'government-member'
  });
  const unauthorisedBudget=submit(game,member,'approveBudget',{
    stateId:territory.stateId,proposedBudget:900
  });
  assert.equal(unauthorisedBudget.accepted,false);
  assert.equal(unauthorisedBudget.code,'INSUFFICIENT_PERMISSION');
  const unauthorisedAppointment=submit(game,member,'appointOffice',{
    stateId:territory.stateId,officeId:'treasurer',appointeePlayerId:member.id
  });
  assert.equal(unauthorisedAppointment.accepted,false);
  assert.equal(unauthorisedAppointment.code,'INSUFFICIENT_PERMISSION');

  const proposed=submit(game,host,'proposeLaw',{
    stateId:territory.stateId,decisionTitle:'Public Works Act',
    decisionText:'Sets a funded programme for roads, housing and public infrastructure.',
    policyId:'public_works'
  });
  assert.equal(proposed.accepted,true,proposed.error);
  const decision=system.decisions.at(-1);
  assert.equal(decision.status,'pendingApproval');

  const vote=submit(game,host,'voteDecision',{
    stateId:territory.stateId,decisionId:decision.id,voteChoice:'approve'
  });
  assert.equal(vote.accepted,true,vote.error);
  assert.equal(decision.status,'enacted');
  assert.equal(system.laws.some(law => law.decisionId===decision.id),true);
  assert.equal(system.policies.some(policy => policy.policyId==='public_works'),true);
  assert.equal(strategy.effectValue(game,territory.stateId,'construction_discount'),0.05);
  const duplicatePolicy=submit(game,host,'proposeLaw',{
    stateId:territory.stateId,decisionTitle:'Second Works Act',
    decisionText:'Attempts to activate the same policy for a second time.',
    policyId:'public_works'
  });
  assert.equal(duplicatePolicy.accepted,false);
  assert.equal(duplicatePolicy.code,'POLICY_ALREADY_ACTIVE');

  const budget=submit(game,host,'approveBudget',{
    stateId:territory.stateId,proposedBudget:850
  });
  assert.equal(budget.accepted,true,budget.error);
  assert.equal(system.government.budget,850);

  const appointee=submit(game,host,'appointOffice',{
    stateId:territory.stateId,officeId:'treasurer',appointeePlayerId:member.id
  });
  assert.equal(appointee.accepted,true,appointee.error);
  assert.equal(system.offices.find(office => office.id==='treasurer').holderPlayerId,member.id);
  const newTreasurerBudget=submit(game,member,'approveBudget',{
    stateId:territory.stateId,proposedBudget:950
  });
  assert.equal(newTreasurerBudget.accepted,true,newTreasurerBudget.error);
  assert.equal(system.government.budget,950);
});

test('a player or cooperative group wins the campaign after administering all sixteen territories',()=>{
  const game=freshWorld();
  const host=game.players[0];
  assert.deepEqual(strategy.checkVictory(game),[]);
  for(const territory of game.territories.slice(1)) {
    game.memberships.push({
      id:'victory-'+territory.stateId,gameId:game.id,playerId:host.id,
      stateId:territory.stateId,status:'active',permissionSetId:'government-executive'
    });
  }
  const winners=strategy.checkVictory(game);
  assert.equal(winners.length,1);
  assert.equal(winners[0].id,host.id);
  assert.equal(game.status,'completed');
  assert.equal(game.paused,true);
  assert.equal(game.winnerPlayerIds[0],host.id);
});

test('cooperative victory recognises a shared government coalition controlling different regions',()=>{
  const game=freshWorld();
  const host=game.players[0];
  const ally={id:'coalition-member',name:'Coalition Member',connected:true,token:'coalition-token'};
  game.players.push(ally);
  game.memberships.push({
    id:'coalition-home',gameId:game.id,playerId:ally.id,
    stateId:game.territories[0].stateId,status:'active',permissionSetId:'government-member'
  });
  for(const territory of game.territories.slice(1,8))
    game.memberships.push({
      id:'host-'+territory.stateId,gameId:game.id,playerId:host.id,
      stateId:territory.stateId,status:'active',permissionSetId:'government-executive'
    });
  for(const territory of game.territories.slice(8))
    game.memberships.push({
      id:'ally-'+territory.stateId,gameId:game.id,playerId:ally.id,
      stateId:territory.stateId,status:'active',permissionSetId:'government-member'
    });
  const winners=strategy.checkVictory(game);
  assert.equal(winners.length,2);
  assert.deepEqual(new Set(game.winnerPlayerIds),new Set([host.id,ally.id]));
  assert.equal(game.status,'completed');
  const objectives=strategy.objectivesFor(game,ally.id);
  assert.equal(objectives.find(item=>item.id==='unification').progress,16);
});

test('settlement prosperity responds to food, water, health, education and employment services',()=>{
  const underprovided=freshWorld();
  const developed=freshWorld();
  underprovided.territories[0].prosperity=50;
  developed.territories[0].prosperity=50;
  developed.territories[0].buildings['service-package']={
    id:'service-package',name:'Public services',daysRemaining:0,
    healthCapacity:5000,educationCapacity:5000,jobSlots:4000
  };
  assert.equal(simulation.advanceDay(underprovided).ok,true);
  assert.equal(simulation.advanceDay(developed).ok,true);
  assert.ok(developed.territories[0].prosperityChangeLastDay >
    underprovided.territories[0].prosperityChangeLastDay);
  assert.equal(developed.territories[0].healthCoverage,100);
  assert.equal(developed.territories[0].educationCoverage,100);
  assert.equal(developed.territories[0].employmentCoverage,100);
});

test('campaign objectives use the player government memberships rather than only the territory owner field',()=>{
  const game=freshWorld();
  const host=game.players[0];
  const member={id:'cofounder',name:'Co-founder',isHost:false,connected:true,token:'cofounder-token'};
  game.players.push(member);
  game.memberships.push({
    id:'cofounder-home',gameId:game.id,playerId:member.id,
    stateId:game.territories[0].stateId,status:'active',permissionSetId:'government-member'
  });
  const objectives=strategy.objectivesFor(game,member.id);
  assert.equal(objectives.find(item => item.id==='regional-power').progress,1);
  assert.equal(objectives.find(item => item.id==='unification').progress,1);
});
