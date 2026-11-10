'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const civic = require('../civic-systems.js');

function world(overrides={}) {
  return {
    id:'civic-test',day:10,worldDate:'1500-01-10',worldVersion:4,
    eventSequence:0,territories:[{
      stateId:'state-a',name:'Test State',ownerPlayerId:'player-a',
      population:50000,prosperity:42,treasury:1200,
      jobCapacity:18000,workingAgePopulation:27500,
      housingCoverage:90,foodCoverage:70,waterCoverage:80,
      healthCoverage:65,educationCoverage:48
    }],players:[],events:[],activity:[],
    marketHistory:[{
      stateId:'state-a',worldDate:'1500-01-10',
      demand:100,unmetDemand:100,goodId:'grain'
    }],
    companyFinancialTransactions:[],companies:[],militaryUnits:[],
    diplomaticRelations:[],treaties:[],supplyRoutes:[],
    ...overrides
  };
}

test('initialization creates a complete civic profile for every territory',()=>{
  const game=world({territories:[
    {stateId:'state-a',name:'A',population:50000,prosperity:50},
    {stateId:'state-b',name:'B',population:0,prosperity:0}
  ]});
  civic.initialize(game);
  assert.equal(game.civicSystems.length,2);
  for(const state of game.civicSystems) {
    assert.ok(state.justice);
    assert.ok(state.publicServices);
    assert.ok(state.agriculture);
    assert.ok(state.labour);
    assert.ok(state.administration);
    assert.ok(state.media);
    assert.ok(state.intelligence);
    assert.ok(state.identity);
    assert.ok(state.crises);
  }
});

test('daily civic simulation calculates justice, public services, labour and state capacity',()=>{
  const game=world();
  civic.initialize(game);
  civic.advanceDay(game);
  const state=game.civicSystems[0];
  assert.ok(state.justice.reportedCases>=1);
  assert.ok(state.justice.pendingCases>=0);
  assert.ok(state.justice.publicOrder>=0 && state.justice.publicOrder<=100);
  assert.ok(state.publicServices.healthIndex>=0 && state.publicServices.healthIndex<=100);
  assert.equal(state.labour.workforce,27500);
  assert.equal(state.labour.employed,18000);
  assert.ok(state.administration.efficiency>=0 && state.administration.efficiency<=100);
  assert.equal(state.indicators.population,50000);
});

test('food shortage creates an active crisis and a traceable event',()=>{
  const game=world();
  civic.initialize(game);
  civic.advanceDay(game);
  const state=game.civicSystems[0];
  assert.ok(state.crises.some(item=>item.id==='food-shortage'&&item.status==='active'));
  assert.ok(game.events.some(item=>item.type==='crisis.started'));
  assert.ok(game.eventOccurrences.some(item=>item.category==='civic'&&item.title==='Civic crisis declared'));
});

test('daily civic simulation is idempotent for the same world day',()=>{
  const game=world();
  civic.initialize(game);
  civic.advanceDay(game);
  const state=game.civicSystems[0];
  const count=state.justice.reportedCases;
  const events=game.events.length;
  civic.advanceDay(game);
  assert.equal(state.justice.reportedCases,count);
  assert.equal(game.events.length,events);
});

test('media publishes sourced headlines and intelligence records crisis assessments',()=>{
  const game=world({
    events:[{
      id:'event-a',stateId:'state-a',worldDate:'1500-01-10',
      type:'economy.market_cleared',description:'Grain shortages continue.'
    }]
  });
  civic.initialize(game);
  civic.advanceDay(game);
  const state=game.civicSystems[0];
  assert.ok(state.media.published.some(item=>item.sourceEventId==='event-a'));
  assert.ok(state.intelligence.reports.some(item=>item.threat==='food-security threat'));
});

test('ideology, religion, culture and social shares remain normalized',()=>{
  const game=world();
  civic.initialize(game);
  civic.advanceDay(game);
  const state=game.civicSystems[0];
  for(const groups of [
    state.society.groups,state.identity.cultureGroups,
    state.identity.religionGroups,state.identity.ideologyGroups
  ]) {
    assert.equal(groups.reduce((total,item)=>total+item.shareBasisPoints,0),10000);
  }
});

test('international relations feed diplomatic reputation and military readiness',()=>{
  const game=world({
    diplomaticRelations:[{
      stateAId:'state-a',stateBId:'state-b',status:'war',relationScore:-70
    }],
    militaryUnits:[{
      stateId:'state-a',personnel:90,maxPersonnel:100,morale:80
    }]
  });
  civic.initialize(game);
  civic.advanceDay(game);
  const state=game.civicSystems[0];
  assert.equal(state.diplomacy.activeWars,1);
  assert.equal(state.intelligence.knownWars,1);
  assert.ok(state.military.readiness>0);
  assert.ok(state.diplomacy.reputation<50);
});


test('host simulation records production, private employment and payroll in civic indicators',()=>{
  const simulation=require('../simulation.js');
  const game=world();
  game.territories[0].baseJobCapacity=100;
  game.territories[0].currencyId='currency-a';
  Object.assign(game,simulation.createStarterEconomy(game.territories));
  civic.initialize(game);
  const result=simulation.advanceDay(game);
  assert.equal(result.ok,true,result.error);
  assert.equal(game.productionHistory.length,5);
  assert.ok(game.productionHistory.every(item=>item.worldDate===game.worldDate));
  const state=game.civicSystems[0];
  assert.ok(state.agriculture.harvestIndex>=45);
  assert.ok(Number.isFinite(game.territories[0].monthlyBalance));
  const employees=game.companies.reduce((total,company)=>total+
    company.facilities.reduce((sum,facility)=>sum+facility.employees,0),0);
  assert.equal(game.territories[0].companyEmployees,employees);
  assert.equal(state.labour.privateEmployees,employees);
  assert.equal(state.labour.dailyPayrollPaid,game.territories[0].dailyPayrollPaid);
  assert.equal(state.labour.householdWageIncome,game.territories[0].householdWageIncomeToday);
  assert.equal(game.populationFinancialTransactions
    .filter(item=>item.stateId===game.territories[0].stateId &&
      item.worldDate===game.worldDate && item.type==='WageIncome')
    .reduce((sum,item)=>sum+item.amount,0),state.labour.householdWageIncome);
});
test('daily public budget is paid from the State treasury with proportional underfunding',()=>{
  const game=world();
  const territory=game.territories[0];
  territory.treasury=500;
  civic.initialize(game);
  const system=game.civicSystems[0];
  system.publicBudget.dailyAllocations.health=400;
  system.publicBudget.dailyAllocations.education=400;
  const spent=civic.executePublicBudget(game,territory,system);
  assert.equal(spent,500);
  assert.equal(territory.treasury,0);
  assert.equal(system.publicBudget.unfundedLastDay,300);
  assert.equal(system.publicBudget.fundedPercent,62.5);
  assert.equal(system.publicBudget.spentByCategory.health+
    system.publicBudget.spentByCategory.education,500);
  const ledger=game.financialTransactions.filter(item=>item.type==='publicServiceExpenditure');
  assert.equal(ledger.reduce((total,item)=>total-item.amount,0),500);
  assert.equal(ledger[ledger.length-1].balanceAfter,0);
  assert.ok(game.events.some(item=>item.type==='finance.public_budget_executed'));
});

test('health and education allocations improve the corresponding daily public service indexes',()=>{
  const game=world();
  const territory=game.territories[0];
  territory.treasury=1000000;
  civic.initialize(game);
  const system=game.civicSystems[0];
  const healthBefore=system.publicServices.healthIndex;
  const educationBefore=system.publicServices.educationIndex;
  system.publicBudget.dailyAllocations.health=250000;
  system.publicBudget.dailyAllocations.education=250000;
  civic.advanceDay(game);
  const updated=game.civicSystems[0];
  assert.ok(updated.publicServices.healthIndex>healthBefore);
  assert.ok(updated.publicServices.educationIndex>educationBefore);
  assert.equal(updated.finance.publicExpenditureToday,500000);
});


test('legacy civic profiles receive missing public budgets and social identity groups without losing saved values',()=>{
  const game=world({
    civicSystems:[{
      stateId:'state-a',version:1,lastAdvancedDay:9,legitimacy:72,
      justice:{publicOrder:61,courtCases:[]},
      society:{cohesion:66,groups:[]},
      identity:{rightsProtection:74}
    }]
  });
  civic.initialize(game);
  const state=game.civicSystems[0];
  assert.equal(state.legitimacy,72);
  assert.equal(state.justice.publicOrder,61);
  assert.equal(state.society.cohesion,66);
  assert.equal(state.identity.rightsProtection,74);
  assert.ok(state.publicBudget.dailyAllocations.health===0);
  assert.ok(state.justice.prisoners);
  for(const groups of [
    state.society.groups,state.identity.cultureGroups,
    state.identity.religionGroups,state.identity.ideologyGroups
  ]) assert.ok(groups.length>0);
  assert.equal(state.society.groups.reduce((total,item)=>total+item.shareBasisPoints,0),10000);
});

test('measured social conditions generate bounded public petitions with estimated constituency support',()=>{
  const game=world();
  civic.initialize(game);
  civic.advanceDay(game);
  const society=game.civicSystems[0].society;
  assert.ok(society.petitions.length>=1);
  const petition=society.petitions[0];
  assert.equal(petition.issueId,'food-security');
  assert.equal(petition.status,'pending');
  assert.ok(petition.supportBasisPoints>=350 && petition.supportBasisPoints<=8500);
  assert.equal(petition.estimatedSupport,
    Math.floor(game.territories[0].population*petition.supportBasisPoints/10000));
  assert.equal(petition.expiresDay,game.day+30);
  const event=game.events.find(item=>item.type==='society.petition_submitted');
  assert.ok(event);
  assert.ok(game.eventOccurrences.some(item=>item.definitionId==='society.petition_submitted'&&item.category==='society'));
  const count=society.petitions.length;
  civic.advanceDay(game);
  assert.equal(society.petitions.length,count);
});

test('public petitions expire after thirty world days without an executive response',()=>{
  const game=world();
  civic.initialize(game);
  civic.advanceDay(game);
  const society=game.civicSystems[0].society;
  const petition=society.petitions[0];
  game.day=petition.expiresDay;
  game.worldDate='1500-02-09';
  civic.advanceDay(game);
  assert.equal(petition.status,'expired');
  assert.equal(petition.resolvedDay,game.day);
  assert.equal(society.resolvedPetitions,1);
  assert.ok(game.events.some(item=>item.type==='society.petition_expired'));
});
