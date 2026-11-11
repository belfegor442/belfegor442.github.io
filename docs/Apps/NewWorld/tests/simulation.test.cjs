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

test('starter economy creates an independent economic network for every requested State', () => {
  const territories = Array.from({length:16},(_,index)=>({
    stateId:'state-'+index,currencyId:'currency-'+index,index,
    name:'Test State '+index,population:index===0?50000:0
  }));
  const economy = simulation.createStarterEconomy(territories);
  assert.equal(economy.companies.length,64);
  assert.equal(economy.markets.length,48);
  assert.equal(economy.productionRecipes.length,4);
  assert.equal(economy.populationGroups.length,16);
  assert.deepEqual(new Set(economy.companies.map(item=>item.stateId)),
    new Set(territories.map(item=>item.stateId)));
  assert.ok(economy.companies.every(company => company.facilities.length === 1));
});

test('the world calendar follows Gregorian month and leap-year boundaries and rejects invalid dates atomically', () => {
  const {nextGregorianDate,advanceDay}=simulation;
  assert.equal(nextGregorianDate('1500-02-28'),'1500-03-01');
  assert.equal(nextGregorianDate('1500-12-31'),'1501-01-01');
  assert.equal(nextGregorianDate('1600-02-28'),'1600-02-29');
  assert.equal(nextGregorianDate('1600-02-29'),'1600-03-01');
  assert.equal(nextGregorianDate('1900-02-28'),'1900-03-01');
  assert.equal(nextGregorianDate('2000-02-28'),'2000-02-29');
  assert.equal(nextGregorianDate('2100-02-28'),'2100-03-01');
  assert.equal(nextGregorianDate('1500-02-30'),null);
  assert.equal(nextGregorianDate('1500-13-01'),null);
  assert.equal(nextGregorianDate('1500-2-01'),null);
  assert.equal(nextGregorianDate('9999-12-31'),null);

  const game=baseWorld({worldDate:'1500-02-30'});
  const before=structuredClone(game);
  const result=advanceDay(game);
  assert.equal(result.ok,false);
  assert.match(result.error,/Gregorian range/);
  assert.deepEqual(game,before,'invalid dates must not partially advance or mutate the world');
});

test('a host day runs production, population demand and market settlement', () => {
  const game = baseWorld();
  Object.assign(game, simulation.createStarterEconomy(game.territories));

  const result = simulation.advanceDay(game);

  assert.equal(result.ok,true,result.error);
  assert.equal(result.day,2);
  assert.equal(game.worldDate,'1500-01-02');
  assert.equal(result.productionCount,4);
  assert.equal(result.marketSettlementCount,3);
  assert.equal(game.worldVersion,2);
  assert.equal(game.marketHistory.length,3);
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
  assert.equal(game.territories[0].population,502);
  assert.equal(game.territories[0].populationGrowthLastDay,1);
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
  assert.equal(settlement.priceAfter,50);
  assert.equal(game.companies[0].inventory.grain,0);
  assert.equal(game.companies[0].cashBalances['currency-a'],100);
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


test('the authoritative daily cycle starts and advances only the configured epidemic timeline',()=>{
  const epidemiology=require('../epidemiology.js');
  const previous=globalThis.NewWorldEpidemiology;
  globalThis.NewWorldEpidemiology=epidemiology;
  try {
    const game=baseWorld({
      territories:[{
        stateId:'state-a',currencyId:'currency-a',index:0,name:'Test State',
        treasury:1200,dailyBalanceRemainder:0,population:1000,prosperity:60,
        infrastructure:1,ownerPlayerId:'player-a'
      }],
      populationGroups:[
        {id:'origin',stateId:'state-a',name:'Origin',locationId:'province-a',
          population:500,ageCohorts:[{ageYears:20,population:500}]},
        {id:'destination',stateId:'state-a',name:'Destination',locationId:'province-b',
          population:500,ageCohorts:[{ageYears:30,population:500}]}
      ],
      epidemicDefinitions:[{
        id:'configured-disease',stateId:'state-a',name:'Configured disease',
        description:'Scenario-specified transmission profile.',
        incubationDays:1,infectiousDays:2,transmissionBasisPoints:1000,
        dailyMortalityPerThousand:0,
        contactLinks:[{
          originGroupId:'origin',destinationGroupId:'destination',
          dailyContactsPerThousand:10000
        }]
      }],
      epidemicStarts:[{
        id:'scenario-outbreak',definitionId:'configured-disease',
        sourceGroupId:'origin',startsOn:'1500-01-02',initialInfectious:10
      }],
      epidemicOutbreaks:[],epidemicGroupStates:[],epidemicHistory:[]
    });

    const first=simulation.advanceDay(game);
    assert.equal(first.ok,true,first.error);
    assert.equal(game.worldDate,'1500-01-02');
    assert.equal(game.epidemicOutbreaks.length,1);
    assert.equal(game.epidemicOutbreaks[0].status,'active');
    assert.equal(game.epidemicOutbreaks[0].totalInfections,10,
      'the configured outbreak begins on the authoritative world date but does not consume a simulation day immediately');

    const second=simulation.advanceDay(game);
    assert.equal(second.ok,true,second.error);
    assert.equal(game.worldDate,'1500-01-03');
    assert.equal(game.epidemicOutbreaks[0].totalExposures,10);
    assert.equal(game.epidemicGroupStates.find(item=>item.groupId==='destination')
      .exposedCohorts.reduce((sum,item)=>sum+item.count,0),10);
    assert.equal(game.worldVersion,3);
  } finally {
    if(previous===undefined) delete globalThis.NewWorldEpidemiology;
    else globalThis.NewWorldEpidemiology=previous;
  }
});
