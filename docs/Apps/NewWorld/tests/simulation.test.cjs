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
  assert.equal(economy.companies.length,4);
  assert.equal(economy.markets.length,3);
  assert.equal(economy.productionRecipes.length,4);
  assert.equal(economy.populationGroups.length,1);
  assert.ok(economy.companies.every(company => company.facilities.length === 1));
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
