'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const simulation=require('../simulation.js');
const strategy=require('../strategy.js');
const civic=require('../civic-systems.js');
global.window={NewWorldSimulation:simulation,NewWorldStrategy:strategy,NewWorldCivicSystems:civic};
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
    system.constitution && system.government && system.institutions.length===3 &&
    system.offices.some(office=>office.id==='chief-justice') &&
    system.offices.some(office=>office.id==='appeal-judge')),true);
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

test('military occupation establishes effective control without annexing territory after three days',()=>{
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
  assert.equal(game.territories[1].ownerPlayerId,null);
  assert.equal(game.occupations[0].status,'completed');
  assert.equal(game.occupations[0].controlEffective,true);
  const occupiedProvince=game.provinces.find(item => item.stateId===target.stateId);
  assert.equal(occupiedProvince.sovereignStateId,target.stateId);
  assert.equal(occupiedProvince.controllerStateId,origin.stateId);
  assert.equal(occupiedProvince.occupationId,game.occupations[0].id);
  assert.equal(game.memberships.some(item =>
    item.playerId===host.id && item.stateId===target.stateId && item.status==='active'),false);
  assert.equal(game.memberships.some(item =>
    item.playerId===ally.id && item.stateId===target.stateId && item.status==='active'),false);
  assert.equal(game.sovereigntyHistory.length,0);
  assert.equal(game.territorialControls.at(-1).stateId,origin.stateId);
  assert.equal(game.politicalSystems.find(item => item.stateId===target.stateId)
    .offices.find(item => item.id==='chief-executive').holderPlayerId,null);
  assert.ok(game.events.some(item=>item.type==='territory.occupation_established'));
});

test('non-aggression treaties require bilateral acceptance and block war until terminated',()=>{
  const game=freshWorld();
  const host=game.players[0];
  const home=game.territories[0];
  const foreign=game.territories[1];
  const recipient={id:'treaty-recipient',name:'Foreign Government',connected:true,token:'treaty-token'};
  game.players.push(recipient);
  foreign.ownerPlayerId=recipient.id;
  game.memberships.push({
    id:'treaty-recipient-membership',gameId:game.id,playerId:recipient.id,
    stateId:foreign.stateId,status:'active',permissionSetId:'government-executive'
  });

  const proposal=submit(game,host,'proposeTreaty',{
    stateId:home.stateId,targetStateId:foreign.stateId,
    treatyType:'nonAggression',durationDays:30,proposalExpiryDays:5
  });
  assert.equal(proposal.accepted,true,proposal.error);
  assert.equal(game.diplomaticProposals.length,1);
  const pending=game.diplomaticProposals[0];
  assert.equal(pending.status,'pending');
  assert.equal(pending.expiresOnDay,game.day+5);

  const accepted=submit(game,recipient,'respondTreaty',{
    stateId:foreign.stateId,proposalId:pending.id,accept:true
  });
  assert.equal(accepted.accepted,true,accepted.error);
  assert.equal(pending.status,'accepted');
  assert.equal(game.treaties.length,1);
  assert.equal(game.treaties[0].status,'active');
  assert.equal(game.treaties[0].expiresOnDay,game.day+30);
  assert.equal(game.treaties[0].signatories.length,2);
  const sharedSnapshot=multiplayer.snapshot(game);
  assert.equal(sharedSnapshot.treaties[0].id,game.treaties[0].id);
  assert.equal(sharedSnapshot.diplomaticProposals[0].status,'accepted');

  const reverseProposal=submit(game,recipient,'proposeTreaty',{
    stateId:foreign.stateId,targetStateId:home.stateId,
    treatyType:'nonAggression',durationDays:10,proposalExpiryDays:2
  });
  assert.equal(reverseProposal.accepted,false);
  assert.equal(reverseProposal.code,'TREATY_ALREADY_EXISTS');

  const blockedWar=submit(game,host,'declareWar',{
    stateId:home.stateId,targetStateId:foreign.stateId
  });
  assert.equal(blockedWar.accepted,false);
  assert.equal(blockedWar.code,'NON_AGGRESSION_ACTIVE');

  const terminated=submit(game,recipient,'terminateTreaty',{
    stateId:foreign.stateId,treatyId:game.treaties[0].id
  });
  assert.equal(terminated.accepted,true,terminated.error);
  assert.equal(game.treaties[0].status,'terminated');

  const declaration=submit(game,host,'declareWar',{
    stateId:home.stateId,targetStateId:foreign.stateId
  });
  assert.equal(declaration.accepted,true,declaration.error);
});

test('unanswered treaty proposals expire and cannot be accepted',()=>{
  const game=freshWorld();
  const host=game.players[0];
  const home=game.territories[0];
  const foreign=game.territories[1];
  const recipient={id:'expiry-recipient',name:'Expiry Government',connected:true,token:'expiry-token'};
  game.players.push(recipient);
  foreign.ownerPlayerId=recipient.id;
  game.memberships.push({
    id:'expiry-membership',gameId:game.id,playerId:recipient.id,
    stateId:foreign.stateId,status:'active',permissionSetId:'government-executive'
  });

  const sent=submit(game,host,'proposeTreaty',{
    stateId:home.stateId,targetStateId:foreign.stateId,
    treatyType:'nonAggression',durationDays:30,proposalExpiryDays:1
  });
  assert.equal(sent.accepted,true,sent.error);
  const proposal=game.diplomaticProposals[0];
  assert.equal(simulation.advanceDay(game).ok,true);
  assert.equal(game.diplomaticProposals[0].status,'expired');
  const lateResponse=submit(game,recipient,'respondTreaty',{
    stateId:foreign.stateId,proposalId:proposal.id,accept:true
  });
  assert.equal(lateResponse.accepted,false);
  assert.equal(lateResponse.code,'TREATY_PROPOSAL_UNAVAILABLE');
  assert.equal(game.treaties.length,0);
});

test('non-aggression treaties expire on their configured world day',()=>{
  const game=freshWorld();
  const host=game.players[0];
  const home=game.territories[0];
  const foreign=game.territories[1];
  const recipient={id:'term-recipient',name:'Term Government',connected:true,token:'term-token'};
  game.players.push(recipient);
  foreign.ownerPlayerId=recipient.id;
  game.memberships.push({
    id:'term-membership',gameId:game.id,playerId:recipient.id,
    stateId:foreign.stateId,status:'active',permissionSetId:'government-executive'
  });
  const sent=submit(game,host,'proposeTreaty',{
    stateId:home.stateId,targetStateId:foreign.stateId,
    treatyType:'nonAggression',durationDays:1,proposalExpiryDays:3
  });
  assert.equal(sent.accepted,true,sent.error);
  const proposal=game.diplomaticProposals[0];
  const response=submit(game,recipient,'respondTreaty',{
    stateId:foreign.stateId,proposalId:proposal.id,accept:true
  });
  assert.equal(response.accepted,true,response.error);
  assert.equal(game.treaties[0].expiresOnDay,2);

  assert.equal(simulation.advanceDay(game).ok,true);
  assert.equal(game.treaties[0].status,'expired');
  const declaration=submit(game,host,'declareWar',{
    stateId:home.stateId,targetStateId:foreign.stateId
  });
  assert.equal(declaration.accepted,true,declaration.error);
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
  assert.equal(enemyState.ownerPlayerId,enemy.id);
  assert.equal(game.memberships.some(item =>
    item.playerId===enemy.id && item.stateId===enemyState.stateId && item.status==='active'),true);
  const occupiedProvince=game.provinces.find(item=>item.stateId===enemyState.stateId);
  assert.equal(occupiedProvince.sovereignStateId,enemyState.stateId);
  assert.equal(occupiedProvince.controllerStateId,home.stateId);
  assert.equal(game.occupations[0].status,'completed');
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


test('governments can submit validated public-safety, welfare, environmental and institutional policies',()=>{
  const game=freshWorld();
  const host=game.players[0];
  const state=game.territories[0].stateId;
  assert.ok(game.civicSystems.some(item=>item.stateId===state));
  const updates=[
    ['policePerThousand',3.5],
    ['pressFreedom',82],
    ['counterintelligence',65],
    ['healthInvestment',75],
    ['educationInvestment',80],
    ['environmentalRegulation',90],
    ['welfareInvestment',55],
    ['taxRatePermille',85],
    ['civilServants',45]
  ];
  for(const [policyId,value] of updates) {
    const result=submit(game,host,'setCivicPolicy',{stateId:state,policyId,value});
    assert.equal(result.accepted,true,result.error);
  }
  const civicState=game.civicSystems.find(item=>item.stateId===state);
  assert.equal(civicState.justice.policePerThousand,3.5);
  assert.equal(civicState.media.pressFreedom,82);
  assert.equal(civicState.intelligence.counterintelligence,65);
  assert.equal(civicState.policy.healthInvestment,75);
  assert.equal(civicState.policy.educationInvestment,80);
  assert.equal(civicState.policy.environmentalRegulation,90);
  assert.equal(civicState.policy.welfareInvestment,55);
  assert.equal(civicState.administration.taxRatePermille,85);
  assert.equal(civicState.administration.civilServants,45);
  assert.ok(game.events.some(item=>item.type==='government.civic_policy_changed'));
});

test('invalid civic policy values are rejected without mutating the State',()=>{
  const game=freshWorld();
  const host=game.players[0];
  const state=game.territories[0].stateId;
  const civicState=game.civicSystems.find(item=>item.stateId===state);
  const before=civicState.media.pressFreedom;
  const result=submit(game,host,'setCivicPolicy',{
    stateId:state,policyId:'pressFreedom',value:101
  });
  assert.equal(result.accepted,false);
  assert.equal(result.code,'INVALID_CIVIC_POLICY');
  assert.equal(civicState.media.pressFreedom,before);
});


test('ordinary government members cannot bypass executive authority when changing State policies',()=>{
  const game=freshWorld();
  const founder=game.players[0];
  const member={id:'ordinary-citizen',name:'Ordinary member',connected:true,token:'member-token'};
  game.players.push(member);
  const stateId=game.territories[0].stateId;
  game.memberships.push({
    id:'ordinary-member-seat',gameId:game.id,playerId:member.id,
    stateId,status:'active',permissionSetId:'government-member'
  });
  const civicState=game.civicSystems.find(item=>item.stateId===stateId);
  const original=civicState.media.pressFreedom;
  const result=submit(game,member,'setCivicPolicy',{
    stateId,policyId:'pressFreedom',value:10
  });
  assert.equal(result.accepted,false);
  assert.equal(result.code,'INSUFFICIENT_PERMISSION');
  assert.equal(civicState.media.pressFreedom,original);
  assert.ok(game.memberships.some(item=>item.playerId===founder.id&&
    item.permissionSetId==='government-executive'));
});


test('court cases follow investigation, prosecution, trial and appeal through distinct offices',()=>{
  const game=freshWorld();
  const host=game.players[0];
  const territory=game.territories[0];
  const civicState=game.civicSystems.find(item=>item.stateId===territory.stateId);
  const caseFile={
    id:'case-lifecycle-1',reportedDay:game.day,offence:'property offence',
    severity:'minor',status:'reported',evidenceScore:0,defaultSentenceDays:5
  };
  civicState.justice.courtCases.push(caseFile);
  civicState.justice.pendingCases++;
  const investigate=submit(game,host,'investigateCourtCase',{
    stateId:territory.stateId,caseId:caseFile.id
  });
  assert.equal(investigate.accepted,true,investigate.error);
  assert.equal(caseFile.status,'investigated');
  assert.ok(caseFile.evidenceScore>=40);

  const charges=submit(game,host,'fileCourtCharges',{
    stateId:territory.stateId,caseId:caseFile.id
  });
  assert.equal(charges.accepted,true,charges.error);
  assert.equal(caseFile.status,'awaitingTrial');
  const earlyHearing=submit(game,host,'adjudicateCourtCase',{
    stateId:territory.stateId,caseId:caseFile.id,verdict:'convict',sentenceDays:5
  });
  assert.equal(earlyHearing.accepted,false);
  assert.equal(earlyHearing.code,'TRIAL_NOT_READY');

  const nextDay=simulation.advanceDay(game);
  assert.equal(nextDay.ok,true,nextDay.error);
  const liveCivicState=game.civicSystems.find(item=>item.stateId===territory.stateId); const liveCase=liveCivicState.justice.courtCases.find(item=>item.id===caseFile.id); const judgment=submit(game,host,'adjudicateCourtCase',{
    stateId:territory.stateId,caseId:caseFile.id,verdict:'convict',sentenceDays:5
  });
  assert.equal(judgment.accepted,true,judgment.error);
  assert.equal(liveCase.verdict,'convict');
  assert.equal(liveCivicState.justice.prisonPopulation,1);

  const appeal=submit(game,host,'appealCourtCase',{
    stateId:territory.stateId,caseId:caseFile.id,
    grounds:'The evidence chain was not properly documented.'
  });
  assert.equal(appeal.accepted,true,appeal.error);
  assert.equal(liveCase.status,'appealPending');
  const earlyAppeal=submit(game,host,'resolveCourtAppeal',{
    stateId:territory.stateId,caseId:caseFile.id,appealVerdict:'overturn'
  });
  assert.equal(earlyAppeal.accepted,false);
  assert.equal(earlyAppeal.code,'APPEAL_NOT_READY');

  const appealDay=simulation.advanceDay(game);
  assert.equal(appealDay.ok,true,appealDay.error);
  const finalCivicState=game.civicSystems.find(item=>item.stateId===territory.stateId);
  const finalCase=finalCivicState.justice.courtCases.find(item=>item.id===caseFile.id);
  const review=submit(game,host,'resolveCourtAppeal',{
    stateId:territory.stateId,caseId:caseFile.id,appealVerdict:'overturn'
  });
  assert.equal(review.accepted,true,review.error);
  assert.equal(finalCase.finalVerdict,'acquittal');
  assert.equal(finalCase.appealStatus,'overturn');
  assert.equal(finalCivicState.justice.prisonPopulation,0);
  assert.ok(game.events.some(item=>item.type==='justice.appeal_resolved'));
});

test('court officials cannot perform procedures assigned to a different judicial office',()=>{
  const game=freshWorld();
  const host=game.players[0];
  const territory=game.territories[0];
  const system=game.politicalSystems.find(item=>item.stateId===territory.stateId);
  const civicState=game.civicSystems.find(item=>item.stateId===territory.stateId);
  const caseFile={id:'case-authority-1',reportedDay:game.day,offence:'property offence',
    severity:'minor',status:'reported',evidenceScore:0,defaultSentenceDays:5};
  civicState.justice.courtCases.push(caseFile);
  const originalJusticeMinister=system.offices.find(item=>item.id==='justice-minister').holderPlayerId;
  system.offices.find(item=>item.id==='justice-minister').holderPlayerId='different-player';
  const result=submit(game,host,'investigateCourtCase',{
    stateId:territory.stateId,caseId:caseFile.id
  });
  assert.equal(result.accepted,false);
  assert.equal(result.code,'JUSTICE_AUTHORITY_REQUIRED');
  assert.equal(caseFile.status,'reported');
  system.offices.find(item=>item.id==='justice-minister').holderPlayerId=originalJusticeMinister;
});


test('custodial sentences release prisoners on their configured world day',()=>{
  const game=freshWorld();
  const host=game.players[0];
  const territory=game.territories[0];
  const civicState=game.civicSystems.find(item=>item.stateId===territory.stateId);
  const caseFile={
    id:'case-release-1',reportedDay:game.day-2,chargedDay:game.day-1,
    offence:'property offence',severity:'minor',status:'awaitingTrial',
    evidenceScore:65,defaultSentenceDays:1
  };
  civicState.justice.courtCases.push(caseFile);
  const judgment=submit(game,host,'adjudicateCourtCase',{
    stateId:territory.stateId,caseId:caseFile.id,verdict:'convict',sentenceDays:1
  });
  assert.equal(judgment.accepted,true,judgment.error);
  let current=game.civicSystems.find(item=>item.stateId===territory.stateId).justice;
  assert.equal(current.prisonPopulation,1);
  assert.equal(current.prisoners[0].releaseOnDay,game.day+1);
  const next=simulation.advanceDay(game);
  assert.equal(next.ok,true,next.error);
  current=game.civicSystems.find(item=>item.stateId===territory.stateId).justice;
  assert.equal(current.prisonPopulation,0);
  assert.equal(current.releasesLastDay,1);
  assert.ok(game.events.some(item=>item.type==='justice.prisoners_released'));
});


test('press office publishes official statements and preserves their public record',()=>{
  const game=freshWorld();
  const host=game.players[0];
  const stateId=game.territories[0].stateId;
  const system=game.civicSystems.find(item=>item.stateId===stateId);
  const result=submit(game,host,'publishPublicStatement',{
    stateId,headline:'Emergency food supply update',
    body:'The government has opened reserve warehouses and is coordinating deliveries to affected settlements.'
  });
  assert.equal(result.accepted,true,result.error);
  const statement=system.media.published[0];
  assert.equal(statement.official,true);
  assert.equal(statement.source,'State Press Office');
  assert.equal(statement.sourcePlayerId,host.id);
  assert.ok(game.events.some(item=>item.type==='media.official_statement_published'));
});

test('only the appointed Press Secretary can publish official State statements',()=>{
  const game=freshWorld();
  const host=game.players[0];
  const member={id:'unappointed-press-member',name:'Citizen',connected:true,token:'press-member-token'};
  game.players.push(member);
  const stateId=game.territories[0].stateId;
  game.memberships.push({
    id:'press-member-seat',gameId:game.id,playerId:member.id,
    stateId,status:'active',permissionSetId:'government-member'
  });
  const system=game.politicalSystems.find(item=>item.stateId===stateId);
  system.offices.find(item=>item.id==='press-secretary').holderPlayerId=host.id;
  const before=game.civicSystems.find(item=>item.stateId===stateId).media.published.length;
  const result=submit(game,member,'publishPublicStatement',{
    stateId,headline:'Public notice',body:'This member cannot publish an official State statement.'
  });
  assert.equal(result.accepted,false);
  assert.equal(result.code,'PRESS_AUTHORITY_REQUIRED');
  assert.equal(game.civicSystems.find(item=>item.stateId===stateId).media.published.length,before);
});

test('intelligence director commissions a snapshot assessment and reviews it after one world day',()=>{
  const game=freshWorld();
  const host=game.players[0];
  const stateId=game.territories[0].stateId;
  const target=game.territories[1];
  const result=submit(game,host,'commissionIntelAssessment',{
    stateId,targetStateId:target.stateId,assessmentType:'military'
  });
  assert.equal(result.accepted,true,result.error);
  const assessment=game.intelligenceAssessments[0];
  assert.equal(assessment.status,'pending');
  assert.equal(assessment.evidenceSnapshot.personnel,0);
  assert.equal(assessment.evidenceSnapshot.readiness,35);
  assert.match(assessment.summary,/observable world-state snapshot/);
  const early=submit(game,host,'reviewIntelAssessment',{
    stateId,assessmentId:assessment.id
  });
  assert.equal(early.accepted,false);
  assert.equal(early.code,'INTELLIGENCE_REPORT_NOT_READY');
  const next=simulation.advanceDay(game);
  assert.equal(next.ok,true,next.error);
  const review=submit(game,host,'reviewIntelAssessment',{
    stateId,assessmentId:assessment.id
  });
  assert.equal(review.accepted,true,review.error);
  const liveAssessment=game.intelligenceAssessments.find(item=>item.id===assessment.id); assert.equal(liveAssessment.status,'reviewed');
  assert.equal(liveAssessment.reviewedBy,host.id);
  assert.equal(game.civicSystems.find(item=>item.stateId===stateId)
    .intelligence.reports.find(item=>item.id===assessment.id).status,'reviewed');
});

test('intelligence assessments require an appointed director and reject invalid targets',()=>{
  const game=freshWorld();
  const host=game.players[0];
  const stateId=game.territories[0].stateId;
  const system=game.politicalSystems.find(item=>item.stateId===stateId);
  system.offices.find(item=>item.id==='intelligence-director').holderPlayerId='another-player';
  const noAuthority=submit(game,host,'commissionIntelAssessment',{
    stateId,targetStateId:game.territories[1].stateId,assessmentType:'military'
  });
  assert.equal(noAuthority.accepted,false);
  assert.equal(noAuthority.code,'INTELLIGENCE_AUTHORITY_REQUIRED');
  system.offices.find(item=>item.id==='intelligence-director').holderPlayerId=host.id;
  const invalid=submit(game,host,'commissionIntelAssessment',{
    stateId,targetStateId:stateId,assessmentType:'military'
  });
  assert.equal(invalid.accepted,false);
  assert.equal(invalid.code,'INVALID_INTELLIGENCE_TARGET');
});


test('Treasurer and Chief Executive can set validated daily public-service allocations',()=>{
  const game=freshWorld();
  const host=game.players[0];
  const stateId=game.territories[0].stateId;
  const allocations=[
    ['health',25000],['education',30000],['justice',12000],
    ['policing',18000],['welfare',15000],['environment',9000],
    ['administration',11000]
  ];
  for(const [category,dailyAmount] of allocations) {
    const result=submit(game,host,'setPublicBudget',{stateId,category,dailyAmount});
    assert.equal(result.accepted,true,result.error);
  }
  const civicState=game.civicSystems.find(item=>item.stateId===stateId);
  assert.equal(civicState.publicBudget.dailyAllocations.health,25000);
  assert.equal(civicState.publicBudget.dailyAllocations.education,30000);
  assert.equal(civicState.publicBudget.dailyAllocations.justice,12000);
  assert.equal(civicState.publicBudget.dailyAllocations.policing,18000);
  assert.equal(civicState.publicBudget.dailyAllocations.welfare,15000);
  assert.equal(civicState.publicBudget.dailyAllocations.environment,9000);
  assert.equal(civicState.publicBudget.dailyAllocations.administration,11000);
});

test('daily public budgets reject unapproved officials, invalid amounts and excessive totals',()=>{
  const game=freshWorld();
  const host=game.players[0];
  const stateId=game.territories[0].stateId;
  const member={id:'budget-observer',name:'Budget observer',connected:true,token:'budget-token'};
  game.players.push(member);
  game.memberships.push({
    id:'budget-observer-seat',gameId:game.id,playerId:member.id,
    stateId,status:'active',permissionSetId:'government-member'
  });
  const unauthorized=submit(game,member,'setPublicBudget',{
    stateId,category:'health',dailyAmount:100
  });
  assert.equal(unauthorized.accepted,false);
  assert.equal(unauthorized.code,'PUBLIC_BUDGET_AUTHORITY_REQUIRED');
  const invalid=submit(game,host,'setPublicBudget',{
    stateId,category:'health',dailyAmount:100001
  });
  assert.equal(invalid.accepted,false);
  assert.equal(invalid.code,'INVALID_PUBLIC_BUDGET');
  const tooLarge=submit(game,host,'setPublicBudget',{
    stateId,category:'health',dailyAmount:100000
  });
  assert.equal(tooLarge.accepted,true,tooLarge.error);
  const totalLimit=submit(game,host,'setPublicBudget',{
    stateId,category:'education',dailyAmount:100000
  });
  assert.equal(totalLimit.accepted,true,totalLimit.error);
  const third=submit(game,host,'setPublicBudget',{
    stateId,category:'justice',dailyAmount:100000
  });
  assert.equal(third.accepted,true,third.error);
  const fourth=submit(game,host,'setPublicBudget',{
    stateId,category:'policing',dailyAmount:100000
  });
  assert.equal(fourth.accepted,false);
  assert.equal(fourth.code,'PUBLIC_BUDGET_LIMIT');
});

test('Chief Executive can accept a public petition and implement its bounded policy recommendation',()=>{
  const game=freshWorld();
  const host=game.players[0];
  const stateId=game.territories[0].stateId;
  const civicState=game.civicSystems.find(item=>item.stateId===stateId);
  const petition={
    id:'petition-test-education',issueId:'education',title:'Expanded education and training',
    sourceGroupId:'professionals',sourceGroupName:'Professionals and traders',
    supportBasisPoints:6000,estimatedSupport:6000,submittedDay:game.day,
    expiresDay:game.day+30,status:'pending',policyId:'educationInvestment',
    previousValue:50,requestedValue:70,severity:60,rationale:'Education outcomes need support.'
  };
  civicState.society.petitions.unshift(petition);
  const confidenceBefore=civicState.media.publicConfidence;
  const cohesionBefore=civicState.society.cohesion;
  const result=submit(game,host,'respondCivicPetition',{
    stateId,petitionId:petition.id,response:'approve'
  });
  assert.equal(result.accepted,true,result.error);
  assert.equal(civicState.policy.educationInvestment,70);
  assert.equal(petition.status,'accepted');
  assert.equal(petition.appliedValue,70);
  assert.equal(petition.respondedBy,host.id);
  assert.equal(petition.resolvedDay,game.day);
  assert.ok(civicState.media.publicConfidence>confidenceBefore);
  assert.ok(civicState.society.cohesion>cohesionBefore);
  assert.ok(game.events.some(item=>item.type==='society.petition_accepted'));
});

test('petition rejection changes public confidence and a decision cannot be repeated',()=>{
  const game=freshWorld();
  const host=game.players[0];
  const stateId=game.territories[0].stateId;
  const civicState=game.civicSystems.find(item=>item.stateId===stateId);
  const petition={
    id:'petition-test-environment',issueId:'environment',title:'Environmental protection',
    sourceGroupId:'landholders',sourceGroupName:'Landholders and owners',
    supportBasisPoints:7000,estimatedSupport:7000,submittedDay:game.day,
    expiresDay:game.day+30,status:'pending',policyId:'environmentalRegulation',
    previousValue:40,requestedValue:60,severity:70,rationale:'Environmental pressure is high.'
  };
  civicState.society.petitions.unshift(petition);
  const confidenceBefore=civicState.media.publicConfidence;
  const result=submit(game,host,'respondCivicPetition',{
    stateId,petitionId:petition.id,response:'reject'
  });
  assert.equal(result.accepted,true,result.error);
  assert.equal(petition.status,'rejected');
  assert.ok(civicState.media.publicConfidence<confidenceBefore);
  const repeat=submit(game,host,'respondCivicPetition',{
    stateId,petitionId:petition.id,response:'approve'
  });
  assert.equal(repeat.accepted,false);
  assert.equal(repeat.code,'PETITION_UNAVAILABLE');
});

test('only the Chief Executive may respond to petitions and invalid recommendations cannot alter policy',()=>{
  const game=freshWorld();
  const host=game.players[0];
  const member={id:'petition-member',name:'Member',connected:true,token:'petition-member-token'};
  const stateId=game.territories[0].stateId;
  game.players.push(member);
  game.memberships.push({
    id:'petition-member-seat',gameId:game.id,playerId:member.id,
    stateId,status:'active',permissionSetId:'government-member'
  });
  const civicState=game.civicSystems.find(item=>item.stateId===stateId);
  const petition={
    id:'petition-test-invalid',title:'Unsafe policy',submittedDay:game.day,
    expiresDay:game.day+30,status:'pending',policyId:'taxRatePermille',
    previousValue:55,requestedValue:300,supportBasisPoints:5000
  };
  civicState.society.petitions.unshift(petition);
  const unauthorised=submit(game,member,'respondCivicPetition',{
    stateId,petitionId:petition.id,response:'approve'
  });
  assert.equal(unauthorised.accepted,false);
  assert.equal(unauthorised.code,'PETITION_RESPONSE_AUTHORITY_REQUIRED');
  const invalid=submit(game,host,'respondCivicPetition',{
    stateId,petitionId:petition.id,response:'approve'
  });
  assert.equal(invalid.accepted,false);
  assert.equal(invalid.code,'INVALID_PETITION_POLICY');
  assert.equal(petition.status,'pending');
  assert.equal(civicState.administration.taxRatePermille,55);
});

function createSecondGovernment(game) {
  const target=game.territories[1];
  const member={id:'foreign-executive',name:'Foreign Executive',connected:true,token:'foreign-token'};
  game.players.push(member);
  game.memberships.push({
    id:'foreign-government-seat',gameId:game.id,playerId:member.id,
    stateId:target.stateId,status:'active',permissionSetId:'government-executive'
  });
  target.ownerPlayerId=member.id;
  const political=game.politicalSystems.find(item=>item.stateId===target.stateId);
  political.offices.find(item=>item.id==='chief-executive').holderPlayerId=member.id;
  return {target,member};
}

test('diplomatic missions require bilateral approval, escrow a deposit and improve relations through maintenance',()=>{
  const game=freshWorld();
  const host=game.players[0];
  const source=game.territories[0];
  const {target,member}=createSecondGovernment(game);
  const relation=game.diplomaticRelations.find(item=>
    (item.stateAId===source.stateId&&item.stateBId===target.stateId)||
    (item.stateBId===source.stateId&&item.stateAId===target.stateId));
  const sourceBefore=source.treasury;
  const proposal=submit(game,host,'proposeEmbassy',{
    stateId:source.stateId,targetStateId:target.stateId
  });
  assert.equal(proposal.accepted,true,proposal.error);
  const mission=game.embassyMissions[0];
  assert.equal(mission.status,'pending');
  assert.equal(source.treasury,sourceBefore-100);
  assert.equal(mission.deposit,100);
  const sourceAfterProposal=source.treasury;
  const acceptance=submit(game,member,'respondEmbassyProposal',{
    stateId:target.stateId,missionId:mission.id,response:'accept'
  });
  assert.equal(acceptance.accepted,true,acceptance.error);
  assert.equal(mission.status,'active');
  const scoreBefore=relation.relationScore;
  const sourceBeforeMaintenance=source.treasury;
  const targetBeforeMaintenance=target.treasury;
  game.day++;
  game.worldDate='1500-01-02';
  assert.equal(simulation.advanceDay(game).ok,true);
  const liveRelation=game.diplomaticRelations.find(item=>
    (item.stateAId===source.stateId&&item.stateBId===target.stateId)||
    (item.stateBId===source.stateId&&item.stateAId===target.stateId));
  const liveMission=game.embassyMissions.find(item=>item.id===mission.id);
  const maintenance=game.financialTransactions.filter(item=>
    item.type==='embassyMaintenance'&&[source.stateId,target.stateId].includes(item.stateId));
  assert.equal(maintenance.length,2);
  assert.ok(maintenance.every(item=>item.amount===-2 && item.balanceAfter===item.balanceBefore-2));
  assert.equal(liveRelation.relationScore,scoreBefore+0.1);
  assert.equal(liveMission.lastMaintenanceDay,game.day);
  assert.ok(game.civicSystems.find(item=>item.stateId===source.stateId).diplomacy.embassies>=1);
  assert.ok(game.territories.find(item=>item.stateId===source.stateId).treasury<=sourceBeforeMaintenance);
  assert.ok(game.territories.find(item=>item.stateId===target.stateId).treasury<=targetBeforeMaintenance);
  assert.equal(sourceAfterProposal,sourceBefore-100);
});

test('diplomatic missions are suspended during war and resume after peace',()=>{
  const game=freshWorld();
  const host=game.players[0];
  const source=game.territories[0];
  const {target,member}=createSecondGovernment(game);
  const proposal=submit(game,host,'proposeEmbassy',{
    stateId:source.stateId,targetStateId:target.stateId
  });
  assert.equal(proposal.accepted,true,proposal.error);
  const mission=game.embassyMissions[0];
  assert.equal(submit(game,member,'respondEmbassyProposal',{
    stateId:target.stateId,missionId:mission.id,response:'accept'
  }).accepted,true);
  const relation=game.diplomaticRelations.find(item=>
    item.stateAId===source.stateId&&item.stateBId===target.stateId);
  relation.status='war';
  game.day++;
  game.worldDate='1500-01-02';
  simulation.advanceDay(game);
  assert.equal(game.embassyMissions.find(item=>item.id===mission.id).status,'suspended');
  const balanceDuringWar=game.territories.find(item=>item.stateId===source.stateId).treasury;
  const liveRelation=game.diplomaticRelations.find(item=>
    (item.stateAId===source.stateId&&item.stateBId===target.stateId)||
    (item.stateBId===source.stateId&&item.stateAId===target.stateId));
  liveRelation.status='peace';
  game.day++;
  game.worldDate='1500-01-03';
  simulation.advanceDay(game);
  assert.equal(game.embassyMissions.find(item=>item.id===mission.id).status,'active');
  const reopenedMaintenance=game.financialTransactions.filter(item=>
    item.type==='embassyMaintenance'&&item.worldDate===game.worldDate);
  assert.equal(reopenedMaintenance.length,2);
  assert.ok(reopenedMaintenance.every(item=>item.amount===-2));
});

test('rejected diplomatic missions refund their deposit and cannot be accepted later',()=>{
  const game=freshWorld();
  const host=game.players[0];
  const source=game.territories[0];
  const {target,member}=createSecondGovernment(game);
  const before=source.treasury;
  const proposal=submit(game,host,'proposeEmbassy',{
    stateId:source.stateId,targetStateId:target.stateId
  });
  assert.equal(proposal.accepted,true,proposal.error);
  const mission=game.embassyMissions[0];
  const rejected=submit(game,member,'respondEmbassyProposal',{
    stateId:target.stateId,missionId:mission.id,response:'reject'
  });
  assert.equal(rejected.accepted,true,rejected.error);
  assert.equal(mission.status,'rejected');
  assert.equal(source.treasury,before);
  const repeated=submit(game,member,'respondEmbassyProposal',{
    stateId:target.stateId,missionId:mission.id,response:'accept'
  });
  assert.equal(repeated.accepted,false);
  assert.equal(repeated.code,'EMBASSY_PROPOSAL_UNAVAILABLE');
});

test('only a Chief Executive may propose or accept a diplomatic mission',()=>{
  const game=freshWorld();
  const host=game.players[0];
  const source=game.territories[0];
  const {target,member}=createSecondGovernment(game);
  const observer={id:'foreign-observer',name:'Observer',connected:true,token:'observer-token'};
  game.players.push(observer);
  game.memberships.push({
    id:'foreign-observer-seat',gameId:game.id,playerId:observer.id,
    stateId:target.stateId,status:'active',permissionSetId:'government-member'
  });
  const political=game.politicalSystems.find(item=>item.stateId===target.stateId);
  political.offices.find(item=>item.id==='chief-executive').holderPlayerId=member.id;
  const proposal=submit(game,host,'proposeEmbassy',{
    stateId:source.stateId,targetStateId:target.stateId
  });
  assert.equal(proposal.accepted,true,proposal.error);
  const mission=game.embassyMissions[0];
  const unauthorized=submit(game,observer,'respondEmbassyProposal',{
    stateId:target.stateId,missionId:mission.id,response:'accept'
  });
  assert.equal(unauthorized.accepted,false);
  assert.equal(unauthorized.code,'EMBASSY_AUTHORITY_REQUIRED');
  assert.equal(mission.status,'pending');
});

test('embassy proposals expire and return their deposit automatically',()=>{
  const game=freshWorld();
  const host=game.players[0];
  const source=game.territories[0];
  const {target}=createSecondGovernment(game);
  const before=source.treasury;
  const proposal=submit(game,host,'proposeEmbassy',{
    stateId:source.stateId,targetStateId:target.stateId
  });
  assert.equal(proposal.accepted,true,proposal.error);
  const mission=game.embassyMissions[0];
  game.day=mission.expiresDay;
  game.worldDate='1500-01-16';
  assert.equal(simulation.advanceDay(game).ok,true);
  assert.equal(game.embassyMissions.find(item=>item.id===mission.id).status,'expired');
  assert.ok(game.territories.find(item=>item.stateId===source.stateId).treasury>=before);
  assert.ok(game.financialTransactions.some(item=>
    item.type==='embassyProposalRefund'&&item.stateId===source.stateId));
});
