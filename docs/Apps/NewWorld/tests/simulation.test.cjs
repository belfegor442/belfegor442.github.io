'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const simulation = require('../simulation.js');

function baseWorld(overrides = {}) {
  const territory = {
    stateId:'state-a',currencyId:'currency-a',index:0,name:'Test State',
    treasury:1200,dailyBalanceRemainder:0,population:50000,prosperity:60,
    infrastructure:1,ownerPlayerId:'player-a'
  };
  const game = {
    id:'game-a',day:1,worldDate:'1500-01-01',worldVersion:1,eventSequence:0,
    started:true,status:'running',paused:false,
    players:[{id:'player-a',name:'Host',countryIndex:0,buildings:{},connected:true}],
    memberships:[{id:'membership-a',playerId:'player-a',stateId:'state-a',status:'active'}],
    territories:[territory],activity:[],events:[],
    financialTransactions:[],companyFinancialTransactions:[],marketHistory:[],
    goods:[],productionRecipes:[],companies:[],markets:[],tradeRoutes:[],populationGroups:[],
    ...overrides
  };
  return game;
}

test('starter scenario seeds an economic network for every State', () => {
  const territories = [
    {stateId:'state-a',currencyId:'currency-a',index:0,name:'Test State',population:50000}
  ];
  const economy = simulation.createStarterEconomy(territories);
  assert.equal(economy.companies.length,6);
  assert.equal(economy.markets.length,6);
  assert.equal(economy.productionRecipes.length,6);
  assert.equal(economy.populationGroups.length,1);
  assert.equal(territories[0].demography.cohorts.length,101);
  assert.equal(territories[0].demography.cohorts.reduce((sum,cohort)=>sum+cohort.population,0),50000);
  assert.ok(economy.companies.every(company => company.facilities.length === 1));
});

test('a host day runs production, population demand and market settlement', () => {
  const game = baseWorld();
  game.territories[0].baseJobCapacity=200;
  Object.assign(game, simulation.createStarterEconomy(game.territories));

  const result = simulation.advanceDay(game);

  assert.equal(result.ok,true,result.error);
  assert.equal(result.day,2);
  assert.equal(game.worldDate,'1500-01-02');
  assert.equal(result.productionCount,5);
  assert.equal(result.marketSettlementCount,6);
  assert.equal(game.worldVersion,2);
  assert.equal(game.marketHistory.length,6);
  assert.ok(game.companyFinancialTransactions.length > 0);
  assert.ok(game.events.some(event => event.type === 'economy.production_completed'));
  assert.ok(game.events.some(event => event.type === 'economy.market_cleared'));
  assert.ok(game.activity.some(item => item.includes('market cleared')));
});

test('construction advances by world days and only finished buildings add capacity', () => {
  const game = baseWorld();
  const territory = game.territories[0];
  territory.population = 500;
  territory.baseHousingCapacity = 1000;
  territory.baseFoodCapacity = 1000;
  territory.baseWaterCapacity = 1000;
  territory.baseJobCapacity = 100;
  territory.buildings = {
    '524944': {
      id:'farm',name:'FARM',daysRemaining:2,foodCapacity:5000,
      jobSlots:1200,income:18,upkeep:3
    }
  };

  const before = simulation.getSettlementMetrics(territory);
  assert.equal(before.foodCapacity,1000);
  assert.equal(before.jobCapacity,100);

  assert.equal(simulation.advanceDay(game).ok,true);
  assert.equal(game.territories[0].buildings['524944'].daysRemaining,1);
  assert.equal(simulation.getSettlementMetrics(game.territories[0]).foodCapacity,1000);

  assert.equal(simulation.advanceDay(game).ok,true);
  assert.equal(game.territories[0].buildings['524944'].daysRemaining,0);
  assert.equal(simulation.getSettlementMetrics(game.territories[0]).foodCapacity,6000);
  assert.equal(simulation.getSettlementMetrics(game.territories[0]).jobCapacity,1300);
  assert.equal(game.territories[0].population,501);
  assert.equal(game.territories[0].populationGrowthLastDay,0);
  assert.ok(game.events.some(event => event.type === 'construction.completed'));
});

test('production respects configured multi-day cycle duration', () => {
  const game = baseWorld({
    goods:[{id:'grain',name:'Grain',unit:'tonnes',storageCapacity:null}],
    productionRecipes:[{
      id:'mill-grain',name:'Grain milling',daysPerBatch:2,
      inputs:{},outputs:{grain:2}
    }],
    companies:[{
      id:'company-a',stateId:'state-a',currencyId:'currency-a',
      inventory:{grain:0},cashBalances:{},facilities:[{
        id:'facility-a',recipeId:'mill-grain',batchesPerCycle:1,progressDays:0
      }]
    }]
  });

  game.territories[0].baseJobCapacity=10;

  const first = simulation.advanceDay(game);
  assert.equal(first.ok,true,first.error);
  assert.equal(game.companies[0].inventory.grain,0);
  assert.equal(game.companies[0].facilities[0].progressDays,1);

  const second = simulation.advanceDay(game);
  assert.equal(second.ok,true,second.error);
  assert.equal(game.companies[0].inventory.grain,2);
  assert.equal(game.companies[0].facilities[0].progressDays,0);
});

test('shortage raises prices and records unmet population demand', () => {
  const game = baseWorld({
    goods:[{id:'grain',name:'Grain',unit:'tonnes',storageCapacity:100}],
    companies:[{
      id:'company-a',stateId:'state-a',currencyId:'currency-a',
      inventory:{grain:2},cashBalances:{'currency-a':0},facilities:[]
    }],
    markets:[{
      stateId:'state-a',goodId:'grain',dailyDemand:0,dailyConsumerBudget:1000,
      basePrice:10,currentPrice:10,minimumPrice:1,maximumPrice:50,priceSmoothingPercent:100
    }],
    populationGroups:[{
      id:'households-a',stateId:'state-a',name:'Households',population:1000,
      needs:[{goodId:'grain',dailyQuantityPerThousandPeople:10}],
      dailyDemandRemainders:{}
    }]
  });

  const result = simulation.advanceDay(game);
  const settlement = game.marketHistory[0];

  assert.equal(result.ok,true,result.error);
  assert.equal(settlement.demand,10);
  assert.equal(settlement.quantitySold,2);
  assert.equal(settlement.unmetDemand,8);
  assert.equal(settlement.populationUnmetDemand,8);
  assert.deepEqual(game.populationGroups[0].dailyNeedsStatus.grain,{
    worldDate:'1500-01-02',requested:10,fulfilled:2,unmet:8,satisfactionPercent:20
  });
  assert.deepEqual(game.populationGroups[0].dailyNeedsOutcome,{
    worldDate:'1500-01-02',requested:10,fulfilled:2,unmet:8,satisfactionPercent:20
  });
  assert.equal(settlement.priceAfter,50);
  assert.equal(game.companies[0].inventory.grain,0);
  assert.equal(game.companies[0].cashBalances['currency-a'],100);
});

test('population fulfilment is allocated without exceeding market sales across multiple groups', () => {
  const game = baseWorld({
    goods:[{id:'grain',name:'Grain',unit:'tonnes',storageCapacity:100}],
    companies:[{
      id:'company-a',stateId:'state-a',currencyId:'currency-a',
      inventory:{grain:1},cashBalances:{'currency-a':0},facilities:[]
    }],
    markets:[{
      stateId:'state-a',goodId:'grain',dailyDemand:0,dailyConsumerBudget:1000,
      basePrice:10,currentPrice:10,minimumPrice:1,maximumPrice:50,priceSmoothingPercent:100
    }],
    populationGroups:[
      {id:'group-a',stateId:'state-a',name:'Group A',population:1000,
        needs:[{goodId:'grain',dailyQuantityPerThousandPeople:1}],dailyDemandRemainders:{}},
      {id:'group-b',stateId:'state-a',name:'Group B',population:1000,
        needs:[{goodId:'grain',dailyQuantityPerThousandPeople:1}],dailyDemandRemainders:{}}
    ]
  });

  const result=simulation.advanceDay(game);

  assert.equal(result.ok,true,result.error);
  assert.equal(game.marketHistory[0].populationDemand,2);
  assert.equal(game.marketHistory[0].populationQuantitySold,1);
  const totalFulfilled=game.populationGroups.reduce((sum,group)=>
    sum+group.dailyNeedsOutcome.fulfilled,0);
  const totalUnmet=game.populationGroups.reduce((sum,group)=>
    sum+group.dailyNeedsOutcome.unmet,0);
  assert.equal(totalFulfilled,1);
  assert.equal(totalUnmet,1);
  assert.equal(game.populationGroups.reduce((sum,group)=>
    sum+group.dailyNeedsOutcome.requested,0),2);
});

test('configured world events are triggered by measured state conditions and respect repeat intervals', () => {
  const game=baseWorld({
    territories:[{
      stateId:'state-a',currencyId:'currency-a',index:0,name:'Test State',
      treasury:100,dailyBalanceRemainder:0,population:50000,prosperity:60,
      infrastructure:1,ownerPlayerId:'player-a'
    }],
    eventDefinitions:[{
      id:'fiscal-stress',enabled:true,category:'economy',severity:'high',
      title:'Fiscal stress',description:'The State treasury is below its configured reserve.',
      repeatIntervalDays:2,
      trigger:{type:'treasuryBelow',stateId:'state-a',threshold:150}
    }]
  });

  assert.equal(simulation.advanceDay(game).ok,true);
  assert.equal(game.eventOccurrences.length,1);
  assert.equal(game.eventOccurrences[0].definitionId,'fiscal-stress');
  assert.equal(game.eventOccurrences[0].worldDate,'1500-01-02');
  assert.match(game.eventOccurrences[0].cause,/treasury fell to 103/);
  assert.ok(game.events.some(event=>event.type==='world_event.occurred'));

  assert.equal(simulation.advanceDay(game).ok,true);
  assert.equal(game.eventOccurrences.length,1);
  assert.equal(simulation.advanceDay(game).ok,true);
  assert.equal(game.eventOccurrences.length,2);
  assert.equal(game.eventOccurrences[1].worldDate,'1500-01-04');
});

test('invalid configured world-event triggers fail the day atomically', () => {
  const game=baseWorld({
    eventDefinitions:[{
      id:'invalid-event',title:'Invalid event',description:'Must not partially run.',
      trigger:{type:'randomWithoutAConfiguredRule'}
    }]
  });
  const before=structuredClone(game);

  const result=simulation.advanceDay(game);

  assert.equal(result.ok,false);
  assert.match(result.error,/unsupported trigger type/i);
  assert.deepEqual(game,before);
});

test('fractional population needs carry their remainder between days', () => {
  const game = baseWorld({
    goods:[{id:'grain',name:'Grain',unit:'tonnes',storageCapacity:null}],
    companies:[{
      id:'company-a',stateId:'state-a',currencyId:'currency-a',
      inventory:{grain:20},cashBalances:{'currency-a':0},facilities:[]
    }],
    markets:[{
      stateId:'state-a',goodId:'grain',dailyDemand:0,dailyConsumerBudget:1000,
      basePrice:10,currentPrice:10,minimumPrice:1,maximumPrice:50,priceSmoothingPercent:100
    }],
    populationGroups:[{
      id:'households-a',stateId:'state-a',name:'Households',population:500,
      needs:[{goodId:'grain',dailyQuantityPerThousandPeople:3}],
      dailyDemandRemainders:{}
    }]
  });

  assert.equal(simulation.advanceDay(game).ok,true);
  assert.equal(game.marketHistory[0].populationDemand,1);
  assert.equal(game.populationGroups[0].dailyDemandRemainders.grain,500);
  assert.equal(simulation.advanceDay(game).ok,true);
  assert.equal(game.marketHistory[1].populationDemand,2);
  assert.equal(game.populationGroups[0].dailyDemandRemainders.grain,0);
});

test('a failed economic cycle is atomic and does not advance the world date', () => {
  const game = baseWorld({
    goods:[{id:'grain',name:'Grain',unit:'tonnes',storageCapacity:null}],
    productionRecipes:[{
      id:'overflow',name:'Overflow',daysPerBatch:1,inputs:{},outputs:{grain:1}
    }],
    companies:[{
      id:'company-a',stateId:'state-a',currencyId:'currency-a',
      inventory:{grain:Number.MAX_SAFE_INTEGER},cashBalances:{},facilities:[{
        id:'facility-a',recipeId:'overflow',batchesPerCycle:1,progressDays:0
      }]
    }]
  });
  game.territories[0].baseJobCapacity=10;
  const before = structuredClone(game);

  const result = simulation.advanceDay(game);

  assert.equal(result.ok,false);
  assert.match(result.error,/browser simulation limit/);
  assert.deepEqual(game,before);
});

test('public trade routes import stock into destination markets', () => {
  const game = baseWorld();
  game.territories.push({
    stateId:'state-b',currencyId:'currency-b',index:1,name:'Import State',
    treasury:0,dailyBalanceRemainder:0,population:30000,prosperity:50,infrastructure:1,ownerPlayerId:null
  });
  game.goods = [{id:'grain',name:'Grain',unit:'tonnes',storageCapacity:100}];
  game.companies = [{
    id:'exporter',stateId:'state-a',currencyId:'currency-a',
    inventory:{grain:5},cashBalances:{'currency-b':0},facilities:[]
  }];
  game.markets = [{
    stateId:'state-b',goodId:'grain',dailyDemand:3,dailyConsumerBudget:100,
    basePrice:10,currentPrice:10,minimumPrice:1,maximumPrice:50,priceSmoothingPercent:100
  }];
  game.tradeRoutes = [{
    id:'route-a',exportStateId:'state-a',importStateId:'state-b',goodId:'grain',
    dailyCapacity:2,enabled:true
  }];

  const result = simulation.advanceDay(game);

  assert.equal(result.ok,true,result.error);
  assert.equal(game.marketHistory.length,1);
  const settlement = game.marketHistory[0];
  assert.equal(settlement.importedSupply,2);
  assert.equal(settlement.quantitySold,2);
  assert.equal(game.companies[0].inventory.grain,3);
  assert.equal(game.companies[0].cashBalances['currency-b'],30);
  assert.ok(game.companyFinancialTransactions.some(item => item.type === 'TradeSale'));
});

test('bilateral trade contracts respect buyer funds and destination storage', () => {
  const game = baseWorld();
  game.territories.push({
    stateId:'state-b',currencyId:'currency-b',index:1,name:'Import State',
    treasury:0,dailyBalanceRemainder:0,population:30000,prosperity:50,infrastructure:1,ownerPlayerId:null
  });
  game.goods = [{id:'grain',name:'Grain',unit:'tonnes',storageCapacity:3}];
  game.companies = [
    {
      id:'exporter',stateId:'state-a',currencyId:'currency-a',
      inventory:{grain:5},cashBalances:{'currency-b':0},facilities:[]
    },
    {
      id:'importer',stateId:'state-b',currencyId:'currency-b',
      inventory:{grain:0},cashBalances:{'currency-b':8},facilities:[]
    }
  ];
  game.tradeRoutes = [{
    id:'contract-a',exportStateId:'state-a',importStateId:'state-b',goodId:'grain',
    dailyCapacity:5,dailyQuantity:5,unitPrice:4,
    exporterCompanyId:'exporter',importerCompanyId:'importer',enabled:true
  }];

  const result = simulation.advanceDay(game);

  assert.equal(result.ok,true,result.error);
  assert.equal(game.companies[0].inventory.grain,3);
  assert.equal(game.companies[1].inventory.grain,2);
  assert.equal(game.companies[1].cashBalances['currency-b'],0);
  assert.equal(game.companies[0].cashBalances['currency-b'],8);
  assert.ok(game.companyFinancialTransactions.some(item => item.type === 'TradePurchase'));
});


test('demography initialization preserves population and creates 101 age cohorts', () => {
  const territory = {population:50000};
  const profile = simulation.initializeDemography(territory);
  assert.equal(profile.cohorts.length,101);
  assert.equal(profile.cohorts.reduce((sum,cohort)=>sum+cohort.population,0),50000);
  assert.equal(territory.demographicIndicators,undefined);
});

test('demographic simulation ages cohorts and records mortality', () => {
  const territory = {
    population:365000,
    demography:{
      version:1,
      cohorts:Array.from({length:101},(_,age)=>({
        age,population:age===30?365000:0,agingRemainder:0,deathRemainder:0
      })),
      birthRatePerThousandYear:0,
      migrationNetPerThousandYear:0,
      birthRemainder:0,migrationRemainder:0,totalBirths:0,totalDeaths:0,netMigration:0
    }
  };
  const result = simulation.advanceDemography(territory);
  assert.equal(result.births,0);
  assert.equal(result.deaths,2);
  assert.equal(territory.demography.cohorts[31].population,999);
  assert.equal(territory.population,364998);
  assert.equal(territory.demographicIndicators.workingAge,364998);
});

test('demographic configuration rejects invalid age-cohort data', () => {
  const territory = {
    population:100,
    demography:{cohorts:[{age:0,population:100}]}
  };
  assert.throws(()=>simulation.advanceDemography(territory),/101 age cohorts/);
});

test('world day uses demographic change instead of synthetic population growth', () => {
  const game = baseWorld();
  const territory = game.territories[0];
  territory.demography = {
    version:1,
    cohorts:Array.from({length:101},(_,age)=>({
      age,population:age===30?365000:0,agingRemainder:0,deathRemainder:0
    })),
    birthRatePerThousandYear:0,migrationNetPerThousandYear:0,
    birthRemainder:0,migrationRemainder:0,totalBirths:0,totalDeaths:0,netMigration:0
  };
  const result = simulation.advanceDay(game);
  assert.equal(result.ok,true,result.error);
  assert.equal(game.territories[0].population,364998);
  assert.equal(game.territories[0].demographicIndicators.workingAge,364998);
  assert.ok(game.events.some(event=>event.type==='population.demographic_update'));
});


test('demography applies configured net migration to the working-age cohort', () => {
  const territory = {
    population:365000,
    demography:{
      version:1,
      cohorts:Array.from({length:101},(_,age)=>({
        age,population:age===30?365000:0,agingRemainder:0,deathRemainder:0
      })),
      birthRatePerThousandYear:0,
      migrationNetPerThousandYear:365,
      birthRemainder:0,migrationRemainder:0,totalBirths:0,totalDeaths:0,netMigration:0
    }
  };
  const result = simulation.advanceDemography(territory);
  assert.equal(result.migration,365);
  assert.equal(territory.demography.netMigration,365);
  assert.equal(territory.demographicIndicators.netMigrationLastDay,365);
  assert.equal(territory.population,365363);
});


test('market sales tax is withheld from companies and credited to the State treasury',()=>{
  const civic=require('../civic-systems.js');
  const previous=globalThis.NewWorldCivicSystems;
  globalThis.NewWorldCivicSystems=civic;
  try {
    const game=baseWorld();
    Object.assign(game,simulation.createStarterEconomy(game.territories));
    civic.initialize(game);
    const result=simulation.advanceDay(game);
    assert.equal(result.ok,true,result.error);
    const taxEntries=game.financialTransactions.filter(item=>item.type==='marketSalesTax');
    const companyTaxEntries=game.companyFinancialTransactions.filter(item=>item.type==='SalesTax');
    assert.ok(taxEntries.length>0);
    assert.equal(taxEntries.length,companyTaxEntries.length);
    const totalTax=taxEntries.reduce((sum,item)=>sum+item.amount,0);
    const companyTax=companyTaxEntries.reduce((sum,item)=>sum-item.amount,0);
    assert.ok(totalTax>0);
    assert.equal(totalTax,companyTax);
    assert.ok(game.events.some(item=>item.type==='finance.sales_tax_collected'));
    assert.equal(game.civicSystems[0].finance.actualTaxCollectedToday,totalTax);
  } finally {
    if(previous===undefined) delete globalThis.NewWorldCivicSystems;
    else globalThis.NewWorldCivicSystems=previous;
  }
});


test('starter mining and quarry firms consume natural reserves through production cycles',()=>{
  const civic=require('../civic-systems.js');
  const previous=globalThis.NewWorldCivicSystems;
  globalThis.NewWorldCivicSystems=civic;
  try {
    const game=baseWorld();
    game.territories[0].baseJobCapacity=200;
    Object.assign(game,simulation.createStarterEconomy(game.territories));
    civic.initialize(game);
    const system=game.civicSystems[0];
    const before={
      timber:system.agriculture.resourceReserves.timber,
      ore:system.agriculture.resourceReserves.ore,
      stone:system.agriculture.resourceReserves.stone
    };
    assert.ok(game.companies.some(item=>item.sector==='Mining' && item.name.includes('Ore Mine')));
    assert.ok(game.companies.some(item=>item.sector==='Mining' && item.name.includes('Stone Quarry')));
    assert.equal(simulation.advanceDay(game).ok,true);
    assert.equal(game.productionHistory.some(item=>item.outputsProduced.ore),false);
    assert.equal(simulation.advanceDay(game).ok,true);
    const liveSystem=game.civicSystems.find(item=>item.stateId===game.territories[0].stateId);
    const output=game.productionHistory
      .reduce((total,item)=>({
        timber:total.timber+(Number(item.outputsProduced.timber)||0),
        ore:total.ore+(Number(item.outputsProduced.ore)||0),
        stone:total.stone+(Number(item.outputsProduced.stone)||0)
      }),{timber:0,ore:0,stone:0});
    assert.equal(output.ore,25);
    assert.equal(output.stone,160);
    assert.equal(output.timber,100);
    assert.equal(liveSystem.agriculture.resourceReserves.ore,before.ore-25);
    assert.equal(liveSystem.agriculture.resourceReserves.stone,before.stone-160);
    assert.ok(liveSystem.agriculture.resourceReserves.timber<before.timber);
  } finally {
    if(previous===undefined) delete globalThis.NewWorldCivicSystems;
    else globalThis.NewWorldCivicSystems=previous;
  }
});


test('starter companies hire real workers and settle daily payroll from company cash',()=>{
  const game=baseWorld();
  game.territories[0].baseJobCapacity=200;
  Object.assign(game,simulation.createStarterEconomy(game.territories));

  const result=simulation.advanceDay(game);

  assert.equal(result.ok,true,result.error);
  const companies=game.companies;
  const required=companies.reduce((sum,company)=>sum+
    company.facilities.reduce((total,facility)=>total+facility.workersRequired,0),0);
  const employees=companies.reduce((sum,company)=>sum+
    company.facilities.reduce((total,facility)=>total+facility.employees,0),0);
  const due=companies.reduce((sum,company)=>sum+
    company.facilities.reduce((total,facility)=>total+
      facility.employees*facility.dailyWage,0),0);
  assert.equal(required,33);
  assert.equal(employees,33);
  assert.equal(game.territories[0].companyEmployees,employees);
  assert.equal(game.territories[0].dailyPayrollDue,due);
  assert.equal(result.payrollPaid,due);
  assert.equal(result.wageArrears,0);
  assert.equal(game.populationGroups.reduce((sum,group)=>sum+group.dailyWageIncomeToday,0),due);
  assert.equal(game.populationFinancialTransactions.filter(item=>item.type==='WageIncome')
    .reduce((sum,item)=>sum+item.amount,0),due);
  for(const company of companies) {
    const payroll=game.companyFinancialTransactions.filter(item=>
      item.companyId===company.id && item.type==='Payroll');
    const companyDue=company.workforce.dailyPayrollDue;
    assert.equal(company.workforce.employees,
      company.facilities.reduce((sum,facility)=>sum+facility.employees,0));
    assert.equal(company.workforce.wageArrears,0);
    if(companyDue>0) {
      assert.equal(payroll.length,1);
      assert.equal(payroll[0].amount,-companyDue);
      assert.equal(payroll[0].balanceAfter,payroll[0].balanceBefore-companyDue);
    }
  }
});

test('company staffing never exceeds the available working-age population or job capacity',()=>{
  const game=baseWorld();
  game.territories[0].baseJobCapacity=7;
  Object.assign(game,simulation.createStarterEconomy(game.territories));

  const result=simulation.advanceDay(game);

  assert.equal(result.ok,true,result.error);
  const employees=game.companies.reduce((sum,company)=>sum+
    company.facilities.reduce((total,facility)=>total+facility.employees,0),0);
  assert.equal(employees,7);
  assert.equal(game.territories[0].companyEmployees,7);
  assert.ok(game.companies.every(company=>company.facilities.every(facility=>
    Number.isSafeInteger(facility.employees) &&
    facility.employees>=0 && facility.employees<=facility.workersRequired)));
});

test('unfunded company wages accumulate as arrears and are retried on the next day',()=>{
  const game=baseWorld();
  game.territories[0].baseJobCapacity=100;
  Object.assign(game,simulation.createStarterEconomy(game.territories));
  game.markets=[];
  const initialFarm=game.companies.find(company=>company.name.startsWith('Agricultural Cooperative'));
  const farmId=initialFarm.id;
  initialFarm.cashBalances['currency-a']=0;
  initialFarm.facilities[0].dailyWage=10000;

  const first=simulation.advanceDay(game);

  assert.equal(first.ok,true,first.error);
  const farmAfterFirst=game.companies.find(company=>company.id===farmId);
  const firstDue=farmAfterFirst.facilities[0].employees*10000;
  assert.equal(farmAfterFirst.workforce.dailyPayrollDue,firstDue);
  assert.equal(farmAfterFirst.workforce.dailyPayrollPaid,0);
  assert.equal(farmAfterFirst.wageArrears,firstDue);
  assert.equal(farmAfterFirst.cashBalances['currency-a'],0);
  assert.equal(game.companyFinancialTransactions.some(item=>
    item.companyId===farmId && item.type==='Payroll'),false);

  const second=simulation.advanceDay(game);

  assert.equal(second.ok,true,second.error);
  const farmAfterSecond=game.companies.find(company=>company.id===farmId);
  assert.equal(farmAfterSecond.wageArrears,firstDue*2);
  assert.equal(farmAfterSecond.workforce.wageArrears,firstDue*2);
  assert.equal(game.territories[0].wageArrears,firstDue*2);

  const farmBeforeRecovery=game.companies.find(company=>company.id===farmId);
  farmBeforeRecovery.cashBalances['currency-a']=firstDue*3;
  const third=simulation.advanceDay(game);
  assert.equal(third.ok,true,third.error);
  const farmAfterRecovery=game.companies.find(company=>company.id===farmId);
  assert.equal(farmAfterRecovery.wageArrears,0);
  assert.equal(farmAfterRecovery.cashBalances['currency-a'],0);
  assert.equal(game.territories[0].wageArrears,0);
  assert.ok(game.events.some(item=>item.type==='economy.wage_arrears_cleared'));
});
test('legacy company facilities receive default staffing and wages without losing saved balances',()=>{
  const game=baseWorld();
  game.territories[0].baseJobCapacity=100;
  Object.assign(game,simulation.createStarterEconomy(game.territories));
  const companyId=game.companies[0].id;
  delete game.companies[0].facilities[0].workersRequired;
  delete game.companies[0].facilities[0].dailyWage;


  const result=simulation.advanceDay(game);

  assert.equal(result.ok,true,result.error);
  const company=game.companies.find(item=>item.id===companyId);
  assert.equal(company.facilities[0].workersRequired,6);
  assert.equal(company.facilities[0].dailyWage,2);
  assert.equal(company.workforce.employees,6);
  const payroll=game.companyFinancialTransactions.find(item=>
    item.companyId===companyId && item.type==='Payroll');
  assert.ok(payroll);
  assert.equal(payroll.amount,-12);
  assert.equal(payroll.balanceAfter,payroll.balanceBefore-12);
  assert.equal(company.wageArrears,0);
});

test('production pauses without staff and partial staffing accumulates real work before output',()=>{
  const game=baseWorld({
    goods:[{id:'grain',name:'Grain',unit:'tonnes',storageCapacity:null}],
    productionRecipes:[{
      id:'harvest',name:'Harvest',daysPerBatch:1,inputs:{},outputs:{grain:1}
    }],
    companies:[{
      id:'company-labour',stateId:'state-a',currencyId:'currency-a',
      inventory:{grain:0},cashBalances:{'currency-a':50},sector:'Agriculture',
      facilities:[{
        id:'facility-labour',recipeId:'harvest',batchesPerCycle:1,
        progressDays:0,workersRequired:4,dailyWage:1
      }]
    }],
    markets:[]
  });
  game.territories[0].baseJobCapacity=0;

  const unstaffed=simulation.advanceDay(game);
  assert.equal(unstaffed.ok,true,unstaffed.error);
  assert.equal(game.companies[0].facilities[0].employees,0);
  assert.equal(game.companies[0].facilities[0].progressDays,0);
  assert.equal(game.companies[0].facilities[0].laborProgress,0);
  assert.equal(game.companies[0].inventory.grain,0);

  game.territories[0].baseJobCapacity=2;
  const partialFirst=simulation.advanceDay(game);
  assert.equal(partialFirst.ok,true,partialFirst.error);
  assert.equal(game.companies[0].facilities[0].employees,2);
  assert.equal(game.companies[0].facilities[0].laborProgress,500);
  assert.equal(game.companies[0].inventory.grain,0);

  const partialSecond=simulation.advanceDay(game);
  assert.equal(partialSecond.ok,true,partialSecond.error);
  assert.equal(game.companies[0].inventory.grain,1);
  assert.equal(game.companies[0].facilities[0].laborProgress,0);
});


test('households retain wage income and use cash balances for subsequent market purchases',()=>{
  const game=baseWorld({
    goods:[{id:'grain',name:'Grain',unit:'tonnes',storageCapacity:null}],
    productionRecipes:[{
      id:'harvest',name:'Harvest',daysPerBatch:1,inputs:{},outputs:{grain:1}
    }],
    companies:[{
      id:'farm-cashflow',stateId:'state-a',currencyId:'currency-a',
      inventory:{grain:50},cashBalances:{'currency-a':1000},sector:'Agriculture',
      facilities:[{
        id:'farm-cashflow-facility',recipeId:'harvest',batchesPerCycle:1,
        progressDays:0,workersRequired:1,dailyWage:20
      }]
    }],
    markets:[{
      stateId:'state-a',goodId:'grain',dailyDemand:0,dailyConsumerBudget:0,
      basePrice:10,currentPrice:10,minimumPrice:10,maximumPrice:10,
      priceSmoothingPercent:100
    }],
    populationGroups:[{
      id:'households-a',stateId:'state-a',name:'Households',population:1000,
      needs:[{goodId:'grain',dailyQuantityPerThousandPeople:2}],
      dailyDemandRemainders:{}
    }]
  });
  game.territories[0].baseJobCapacity=1;

  const first=simulation.advanceDay(game);
  assert.equal(first.ok,true,first.error);
  let households=game.populationGroups[0];
  assert.equal(households.cashBalances['currency-a'],100);
  assert.equal(households.dailyWageIncomeToday,20);
  assert.equal(households.dailyConsumptionSpendingToday,20);
  assert.equal(households.dailyNeedsOutcome.satisfactionPercent,100);
  assert.equal(game.populationFinancialTransactions
    .filter(item=>item.populationGroupId==='households-a' && item.type==='Consumption')
    .reduce((sum,item)=>sum-item.amount,0),20);
  assert.equal(game.populationFinancialTransactions
    .filter(item=>item.populationGroupId==='households-a' && item.type==='WageIncome')
    .reduce((sum,item)=>sum+item.amount,0),20);

  const second=simulation.advanceDay(game);
  assert.equal(second.ok,true,second.error);
  households=game.populationGroups[0];
  assert.equal(households.cashBalances['currency-a'],100);
  assert.equal(households.dailyWageIncomeToday,20);
  assert.equal(households.dailyConsumptionSpendingToday,20);
  assert.equal(game.companies[0].cashBalances['currency-a'],999);
});
