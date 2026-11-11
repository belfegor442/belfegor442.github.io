'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const simulation=require('../simulation.js');
const strategy=require('../strategy.js');
const justice=require('../justice.js');
const resources=require('../resources.js');
const bureaucracy=require('../bureaucracy.js');
const media=require('../media.js');
const security=require('../security.js');
const worldEvents=require('../world-events.js');

globalThis.NewWorldBureaucracy=bureaucracy;
globalThis.NewWorldResources=resources;
globalThis.NewWorldMedia=media;
globalThis.NewWorldSecurity=security;
globalThis.NewWorldWorldEvents=worldEvents;
global.window={
  NewWorldSimulation:simulation,NewWorldStrategy:strategy,
  NewWorldJustice:justice,NewWorldResources:resources,
  NewWorldBureaucracy:bureaucracy,NewWorldMedia:media,
  NewWorldSecurity:security,NewWorldWorldEvents:worldEvents
};
const multiplayer=require('../multiplayer.js');
let sequence=0;
function freshWorld(){return multiplayer.createInitialWorld('World Events Test').game;}
function configure(game,options={}) {
  const territory=game.territories[0];
  const system=game.politicalSystems.find(item=>item.stateId===territory.stateId);
  const office=system.offices.find(item=>item.holderPlayerId===game.players[0].id);
  const definition={
    id:'provincial-economic-event',stateId:territory.stateId,
    title:'Provincial recovery programme',
    category:'economic',
    description:'A verified economic disruption requires the government to select a response for the affected State.',
    startsOn:game.worldDate,endsOn:'1600-12-31',
    active:true,chancePerThousand:options.probability??1000,
    maxOccurrences:options.maxOccurrences??1,cooldownDays:options.cooldownDays??5,
    expiresInDays:options.expiresInDays??3,
    decisionOfficeIds:[office.id],
    options:[
      {id:'stabilize-reserves',label:'Stabilize public reserves',
        description:'Use the public treasury to stabilize essential economic operations.',
        effects:[{type:'treasury_delta',amount:-100}]},
      {id:'support-recovery',label:'Fund local recovery',
        description:'Allocate a limited treasury grant to the provincial recovery programme.',
        effects:[{type:'treasury_delta',amount:200}]}
    ]
  };
  if(options.effects) definition.options[1].effects=options.effects;
  if(options.conditions) definition.conditions=structuredClone(options.conditions);
  if(options.conditionMode) definition.conditionMode=options.conditionMode;
  const configuration={eventDefinitions:[definition]};
  const valid=worldEvents.validateConfiguration(game,configuration);
  assert.equal(valid.ok,true,valid.error);
  const saved=multiplayer.applyAdmin(game,'configure',{kind:'worldEvents',configuration});
  assert.equal(saved.ok,true,saved.error);
  return {territory,system,office,definition};
}
function start(game) {
  const result=multiplayer.applyAdmin(game,'start',{});
  assert.equal(result.ok,true,result.error);
}
function advance(game) {
  const result=worldEvents.advanceDay(game,()=> 'event-'+(++sequence));
  assert.equal(result.ok,true,result.error);
  return result;
}
function decide(game,player,eventId,optionId) {
  const membership=game.memberships.find(item=>
    item.playerId===player.id && item.stateId===game.worldEvents.find(x=>x.id===eventId)?.stateId);
  return multiplayer.applyOrder(game,player,{
    orderId:'world-event-order-'+(++sequence),gameId:game.id,playerId:player.id,
    expectedWorldVersion:game.worldVersion,stateId:membership.stateId,
    type:'worldEvents.chooseOption',eventId,optionId
  });
}

test('new worlds start without invented event definitions, active events or counters',()=>{
  const game=freshWorld();
  for(const field of [...worldEvents.configurationFields,...worldEvents.dynamicFields])
    assert.deepEqual(game[field],[],field+' must be empty until configured');
});
test('event definitions require real offices, bounded probabilities, options and supported effects',()=>{
  const game=freshWorld();
  const {territory}=configure(game);
  const definition=structuredClone(game.eventDefinitions[0]);
  const invalid={eventDefinitions:[{...definition,decisionOfficeIds:['unknown-office']}]};
  assert.match(worldEvents.validateConfiguration(game,invalid).error,/decision offices/i);
  const probability={eventDefinitions:[{...definition,chancePerThousand:1001}]};
  assert.match(worldEvents.validateConfiguration(game,probability).error,/bounded probability/i);
  assert.equal(territory.stateId,definition.stateId);
});
test('event triggers are deterministic from the world, date and definition and obey occurrence limits',()=>{
  const game=freshWorld();
  configure(game,{maxOccurrences:1});
  const first=advance(game);
  assert.equal(first.generatedEventIds.length,1);
  assert.equal(game.worldEvents.length,1);
  assert.equal(game.worldEvents[0].status,'open');
  const second=advance(game);
  assert.equal(second.generatedEventIds.length,0);
  assert.equal(game.worldEventCounters[0].occurrences,1);
});
test('only a configured political decision office may select an event option and the chosen effects apply once',()=>{
  const game=freshWorld();
  configure(game);
  start(game);
  advance(game);
  const event=game.worldEvents[0];
  const before=game.territories[0].treasury;
  const observer={id:'event-observer',name:'Observer',connected:true,token:'event-observer-token'};
  game.players.push(observer);
  game.memberships.push({
    id:'event-observer-membership',gameId:game.id,playerId:observer.id,
    stateId:event.stateId,status:'active',permissionSetId:'government-member'
  });
  const denied=decide(game,observer,event.id,'support-recovery');
  assert.equal(denied.accepted,false);
  assert.equal(denied.code,'WORLD_EVENT_AUTHORITY_REQUIRED');
  const chosen=decide(game,game.players[0],event.id,'support-recovery');
  assert.equal(chosen.accepted,true,chosen.error);
  assert.equal(event.status,'resolved');
  assert.equal(event.chosenOptionId,'support-recovery');
  assert.equal(game.territories[0].treasury,before+200);
  const duplicate=decide(game,game.players[0],event.id,'support-recovery');
  assert.equal(duplicate.accepted,false);
  assert.equal(duplicate.code,'WORLD_EVENT_UNAVAILABLE');
  assert.equal(game.territories[0].treasury,before+200);
});
test('event effects are prevalidated atomically before treasury or inventory can change',()=>{
  const game=freshWorld();
  const invalidEffects=[
    {type:'treasury_delta',amount:200},
    {type:'treasury_delta',amount:-1000000000}
  ];
  configure(game,{effects:invalidEffects});
  start(game);
  advance(game);
  const event=game.worldEvents[0];
  const before=game.territories[0].treasury;
  const result=decide(game,game.players[0],event.id,'support-recovery');
  assert.equal(result.accepted,false);
  assert.equal(result.code,'WORLD_EVENT_EFFECT_UNAFFORDABLE');
  assert.equal(game.territories[0].treasury,before);
  assert.equal(game.worldEvents[0].status,'open');
});
test('events expire without silently choosing an option on behalf of the player',()=>{
  const game=freshWorld();
  configure(game,{expiresInDays:1});
  advance(game);
  assert.equal(game.worldEvents[0].status,'open');
  game.worldDate='1500-01-03';
  advance(game);
  assert.equal(game.worldEvents[0].status,'expired');
  assert.equal(game.worldEvents[0].chosenOptionId,null);
  assert.ok(game.worldEventHistory.some(item=>item.type==='expired'));
});
test('cooldown prevents immediate repeated triggers after a decision has been resolved',()=>{
  const game=freshWorld();
  configure(game,{maxOccurrences:3,cooldownDays:5});
  start(game);
  advance(game);
  const event=game.worldEvents[0];
  const result=decide(game,game.players[0],event.id,'support-recovery');
  assert.equal(result.accepted,true,result.error);
  game.worldDate='1500-01-03';
  const blocked=advance(game);
  assert.equal(blocked.generatedEventIds.length,0);
  assert.equal(game.worldEventCounters[0].occurrences,1);
});

test('event conditions validate against an explicit observed-metric allowlist',()=>{
  const game=freshWorld();
  const {definition}=configure(game);
  const invalidMetric={eventDefinitions:[{
    ...structuredClone(definition),
    conditions:[{metric:'population_is_unhappy',operator:'gte',threshold:1}]
  }]};
  assert.match(worldEvents.validateConfiguration(game,invalidMetric).error,/supported observed metrics/i);
  const invalidOperator={eventDefinitions:[{
    ...structuredClone(definition),
    conditions:[{metric:'market_unmet_demand_total',operator:'approx',threshold:1}]
  }]};
  assert.match(worldEvents.validateConfiguration(game,invalidOperator).error,/supported observed metrics/i);
  const invalidThreshold={eventDefinitions:[{
    ...structuredClone(definition),
    conditions:[{metric:'market_unmet_demand_total',operator:'gte',threshold:-1}]
  }]};
  assert.match(worldEvents.validateConfiguration(game,invalidThreshold).error,/supported observed metrics/i);
  const invalidMode={eventDefinitions:[{
    ...structuredClone(definition),conditionMode:'some'
  }]};
  assert.match(worldEvents.validateConfiguration(game,invalidMode).error,/condition mode/i);
});

test('events trigger only from same-State current-day evidence across economy, water, debt, military and security',()=>{
  const game=freshWorld();
  const {territory,definition}=configure(game);
  const metrics=[
    ['market_unmet_demand_total',7],
    ['water_shortage_total',4],
    ['public_debt_defaults',1],
    ['military_defeats',1],
    ['public_security_alerts',2]
  ];
  const definitions=metrics.map(([metric],index)=>({
    ...structuredClone(definition),
    id:'observed-trigger-'+index,
    title:'Observed event '+index,
    conditions:[{metric,operator:'gte',threshold:1}]
  }));
  const configuration={eventDefinitions:definitions};
  const valid=worldEvents.validateConfiguration(game,configuration);
  assert.equal(valid.ok,true,valid.error);
  const saved=multiplayer.applyAdmin(game,'configure',{kind:'worldEvents',configuration});
  assert.equal(saved.ok,true,saved.error);

  const stateId=territory.stateId;
  const otherStateId=game.territories.find(item=>item.stateId!==stateId).stateId;
  game.marketHistory.push(
    {stateId,worldDate:game.worldDate,unmetDemand:7},
    {stateId:otherStateId,worldDate:game.worldDate,unmetDemand:500}
  );
  game.waterAllocations.push(
    {stateId,worldDate:game.worldDate,shortage:4},
    {stateId:otherStateId,worldDate:game.worldDate,shortage:800}
  );
  game.publicDebtIssues.push({
    id:'due-default',stateId,defaultedOn:game.worldDate,status:'defaulted'
  });
  game.militaryOrders.push({
    id:'repelled-order',stateId,status:'repelled',submittedOnWorldDate:game.worldDate
  });
  game.securityAlerts.push(
    {id:'public-alert-a',stateId,issuedOn:game.worldDate,status:'active'},
    {id:'public-alert-b',stateId,issuedOn:game.worldDate,status:'active'}
  );

  const result=advance(game);
  assert.equal(result.generatedEventIds.length,5);
  assert.equal(game.worldEvents.length,5);
  for(const [metric,expected] of metrics) {
    const event=game.worldEvents.find(item=>
      item.triggerEvidence.some(entry=>entry.metric===metric));
    assert.ok(event,'missing event for observed metric '+metric);
    assert.equal(event.triggerEvidence[0].actual,expected);
    assert.equal(event.triggerEvidence[0].passed,true);
    const history=game.worldEventHistory.find(item=>
      item.type==='triggered'&&item.details.definitionId===event.definitionId);
    assert.ok(history.details.triggerEvidence.some(entry=>entry.metric===metric));
  }
});

test('the event diagnostic explains missing causes and rejects evidence from another State or day',()=>{
  const game=freshWorld();
  const {territory,definition}=configure(game,{
    conditions:[{metric:'market_unmet_demand_total',operator:'gte',threshold:20}]
  });
  game.marketHistory.push({
    stateId:game.territories.find(item=>item.stateId!==territory.stateId).stateId,
    worldDate:game.worldDate,unmetDemand:1000
  });
  game.marketHistory.push({
    stateId:territory.stateId,worldDate:'1499-12-31',unmetDemand:1000
  });
  const explanation=worldEvents.explainEvaluation(game,definition.id);
  assert.equal(explanation.eligible,false);
  assert.equal(explanation.reason,'conditions_not_met');
  assert.deepEqual(explanation.conditions,[{
    metric:'market_unmet_demand_total',actual:0,operator:'gte',threshold:20,passed:false
  }]);
  assert.equal(advance(game).generatedEventIds.length,0);
  assert.equal(game.worldEvents.length,0);
});

test('conditional event definitions can use any-mode while retaining the exact evidence for every condition',()=>{
  const game=freshWorld();
  const {territory,definition}=configure(game,{
    conditions:[
      {metric:'market_unmet_demand_total',operator:'gte',threshold:1},
      {metric:'water_shortage_total',operator:'gte',threshold:1}
    ],
    conditionMode:'any'
  });
  game.waterAllocations.push({
    stateId:territory.stateId,worldDate:game.worldDate,shortage:3
  });
  const explanation=worldEvents.explainEvaluation(game,definition.id);
  assert.equal(explanation.eligible,true);
  assert.equal(explanation.conditions[0].passed,false);
  assert.equal(explanation.conditions[1].passed,true);
  const result=advance(game);
  assert.equal(result.generatedEventIds.length,1);
  assert.equal(game.worldEvents[0].triggerConditionMode,'any');
  assert.equal(game.worldEvents[0].triggerEvidence.length,2);
  assert.equal(game.worldEvents[0].triggerEvidence[1].actual,3);
});


test('public-health event conditions accept epidemic exposure, infection, mortality and active-case metrics',()=>{
  const game=freshWorld();
  const {definition}=configure(game,{
    category:'public_health',
    conditions:[
      {metric:'epidemic_exposures',operator:'gte',threshold:10},
      {metric:'epidemic_infections',operator:'gte',threshold:5},
      {metric:'epidemic_deaths',operator:'gte',threshold:1},
      {metric:'active_epidemic_cases',operator:'gte',threshold:1},
      {metric:'active_epidemic_outbreaks',operator:'gte',threshold:1}
    ]
  });
  assert.equal(worldEvents.validateConfiguration(game,{eventDefinitions:[definition]}).ok,true);
});

test('epidemic event triggers use only same-State and same-day public epidemiological aggregates',()=>{
  const game=freshWorld();
  const {territory,definition}=configure(game,{
    category:'public_health',
    conditions:[
      {metric:'epidemic_exposures',operator:'gte',threshold:10},
      {metric:'epidemic_infections',operator:'gte',threshold:5},
      {metric:'epidemic_deaths',operator:'gte',threshold:2},
      {metric:'active_epidemic_cases',operator:'gte',threshold:8},
      {metric:'active_epidemic_outbreaks',operator:'gte',threshold:1}
    ],
    conditionMode:'all'
  });
  const otherState=game.territories.find(item=>item.stateId!==territory.stateId).stateId;
  game.events.push(
    {id:'exposure-current',sequence:1,type:'society.epidemic_spread',
      stateId:territory.stateId,worldDate:game.worldDate,details:{quantity:10}},
    {id:'infection-current',sequence:2,type:'society.epidemic_infections',
      stateId:territory.stateId,worldDate:game.worldDate,details:{quantity:5}},
    {id:'death-current',sequence:3,type:'society.epidemic_deaths',
      stateId:territory.stateId,worldDate:game.worldDate,details:{quantity:2}},
    {id:'infection-other-state',sequence:4,type:'society.epidemic_infections',
      stateId:otherState,worldDate:game.worldDate,details:{quantity:500}},
    {id:'infection-previous-day',sequence:5,type:'society.epidemic_infections',
      stateId:territory.stateId,worldDate:'1499-12-31',details:{quantity:500}}
  );
  game.epidemicGroupStates.push({
    outbreakId:'outbreak-current',stateId:territory.stateId,groupId:'group-a',
    exposedCohorts:[{daysRemaining:1,count:3}],
    infectiousCohorts:[{daysRemaining:2,count:5}]
  },{
    outbreakId:'other-state-outbreak',stateId:otherState,groupId:'group-b',
    exposedCohorts:[{daysRemaining:1,count:1000}],infectiousCohorts:[]
  });
  game.epidemicOutbreaks.push(
    {id:'outbreak-current',stateId:territory.stateId,status:'active'},
    {id:'outbreak-completed',stateId:territory.stateId,status:'completed'},
    {id:'other-state-outbreak',stateId:otherState,status:'active'}
  );
  const explanation=worldEvents.explainEvaluation(game,definition.id);
  assert.equal(explanation.eligible,true);
  assert.deepEqual(explanation.conditions.map(item=>item.actual),[10,5,2,8,1]);
  assert.ok(explanation.conditions.every(item=>item.passed));
  const result=advance(game);
  assert.equal(result.generatedEventIds.length,1);
  assert.equal(game.worldEvents[0].triggerEvidence.length,5);
  assert.equal(game.worldEvents[0].triggerConditionMode,'all');
});
