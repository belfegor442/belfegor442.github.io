const test=require('node:test');
const assert=require('node:assert/strict');
const simulation=require('../simulation.js');
const strategy=require('../strategy.js');
const finance=require('../finance.js');
const scenario=require('../scenario.js');
globalThis.NewWorldSimulation=simulation;
globalThis.NewWorldStrategy=strategy;
globalThis.NewWorldFinance=finance;
globalThis.NewWorldScenario=scenario;
global.window={
  NewWorldSimulation:simulation,NewWorldStrategy:strategy,
  NewWorldFinance:finance,NewWorldScenario:scenario
};
const multiplayer=require('../multiplayer.js');
let sequence=0;
function world() {
  const {game}=multiplayer.createInitialWorld('Finance Test');
  return game;
}
function configure(game) {
  const currencies=game.currencies.map((item,index)=>({
    ...item,name:'Test Currency '+index,code:'TW'+String(index).padStart(2,'0'),minorUnitScale:2
  }));
  const first=game.territories[0];
  const second=game.territories[1];
  const market=game.markets.find(item=>item.stateId===first.stateId);
  const config={
    currencies,
    exchangeRates:[{
      id:'fx-home-foreign',baseCurrencyId:first.currencyId,quoteCurrencyId:second.currencyId,
      effectiveOn:game.worldDate,expiresOn:'1500-06-01',rate:2,method:'scenario test quote',source:'explicit test source'
    }],
    financialBanks:[{
      id:'npc-test-bank',stateId:first.stateId,currencyId:first.currencyId,
      name:'Test State Bank',cashBalance:100000,capital:150000,
      minimumReserve:1000,loanLimit:100000,riskAppetitePercent:25,status:'active'
    }],
    taxRules:[{
      id:'company-turnover-tax',stateId:first.stateId,currencyId:first.currencyId,
      name:'Company turnover tax',scope:'companies',basis:'turnover',rateBasisPoints:500,
      assessmentPeriod:'daily',effectiveOn:game.worldDate,expiresOn:null
    }],
    priceIndexConfigs:[{
      id:'test-consumer-basket',stateId:first.stateId,currencyId:first.currencyId,
      name:'Configured consumer price index',baseDate:game.worldDate,
      items:[{goodId:market.goodId,basePrice:market.currentPrice,weightBasisPoints:10000}]
    }]
  };
  const saved=multiplayer.applyAdmin(game,'configure',{kind:'finance',configuration:config});
  assert.equal(saved.ok,true,saved.error);
  return {first,second,market,config};
}
function submit(game,player,type,payload={}) {
  const membership=game.memberships.find(item=>
    item.playerId===player.id&&item.status==='active'&&item.stateId===payload.stateId) ||
    game.memberships.find(item=>item.playerId===player.id&&item.status==='active');
  assert.ok(membership,'active government membership required');
  return multiplayer.applyOrder(game,player,{
    orderId:'finance-test-'+(++sequence),gameId:game.id,playerId:player.id,
    expectedWorldVersion:game.worldVersion,stateId:membership.stateId,type,...payload
  });
}

test('financial configuration preserves currency IDs and rejects incomplete currency metadata',()=>{
  const game=world();
  const {config}=configure(game);
  assert.deepEqual(game.currencies,config.currencies);
  const invalid=structuredClone(config);
  invalid.currencies[0].minorUnitScale=null;
  assert.match(finance.validateConfiguration(game,invalid).error,/currency/i);
  const duplicate=structuredClone(config);
  duplicate.currencies[1].code=duplicate.currencies[0].code;
  assert.match(finance.validateConfiguration(game,duplicate).error,/codes must be unique/i);
});

test('FX conversion requires a dated explicit quote and does not invent reverse rates',()=>{
  const game=world();
  const {first,second}=configure(game);
  const converted=finance.convertCurrency(game,125,first.currencyId,second.currencyId,game.worldDate);
  assert.equal(converted.ok,true);
  assert.equal(converted.amount,250);
  const reverse=finance.convertCurrency(game,125,second.currencyId,first.currencyId,game.worldDate);
  assert.equal(reverse.ok,false);
  const expired=finance.convertCurrency(game,125,first.currencyId,second.currencyId,'1600-01-01');
  assert.equal(expired.ok,false);
});

test('public debt is issued only within bank liquidity and lending limit, accrues interest and can be repaid',()=>{
  const game=world();
  const {first}=configure(game);
  assert.equal(multiplayer.applyAdmin(game,'start',{}).ok,true);
  const player=game.players[0];
  const bank=game.financialBanks[0];
  const before=first.treasury;
  const issued=submit(game,player,'finance.issuePublicDebt',{
    stateId:first.stateId,bankId:bank.id,amount:36500,
    annualInterestBasisPoints:10000,termDays:1
  });
  assert.equal(issued.accepted,true,issued.error);
  assert.equal(first.treasury,before+36500);
  assert.equal(bank.cashBalance,63500);
  const membership=game.memberships.find(item=>item.playerId===player.id&&item.status==='active');
  const tooLarge=finance.applyOrder(game,player,membership,{
    type:'finance.issuePublicDebt',stateId:first.stateId,bankId:bank.id,
    amount:70000,annualInterestBasisPoints:100,termDays:30
  },()=> 'finance-direct-'+(++sequence));
  assert.equal(tooLarge.ok,false);
  assert.equal(tooLarge.code,'FINANCE_BANK_LENDING_LIMIT');
  game.worldDate='1500-01-02';
  const cycle=finance.advanceDay(game,()=> 'finance-cycle-'+(++sequence));
  assert.equal(cycle.ok,true);
  const issue=game.publicDebtIssues[0];
  assert.equal(issue.status,'defaulted');
  assert.equal(issue.interestAccrued,100);
  assert.equal(bank.nonPerformingPrincipal,36500);
  const due=issue.principalOutstanding+issue.interestAccrued;
  const repaid=submit(game,player,'finance.repayPublicDebt',{
    stateId:first.stateId,issueId:issue.id,amount:due
  });
  assert.equal(repaid.accepted,true,repaid.error);
  assert.equal(issue.status,'repaid');
  assert.equal(issue.principalOutstanding,0);
  assert.equal(issue.interestAccrued,0);
  assert.equal(bank.nonPerformingPrincipal,0);
  assert.equal(bank.cashBalance,100100);
});

test('finance state is included in authoritative multiplayer snapshots',()=>{
  const game=world();
  const {config}=configure(game);
  const snapshot=multiplayer.snapshot(game);
  for(const field of ['currencies','exchangeRates','financialBanks','taxRules',
    'priceIndexConfigs','publicDebtIssues','bankTransactions','taxAssessments',
    'priceIndexHistory','financeHistory','financeCycleDate','financeCycleResult'])
    assert.ok(Object.hasOwn(snapshot,field),'snapshot is missing '+field);
  assert.deepEqual(snapshot.currencies,config.currencies);
  assert.deepEqual(snapshot.financialBanks,game.financialBanks);
});

test('simulation advances finance after incrementing the world date',()=>{
  const game=world();
  configure(game);
  const priorDate=game.worldDate;
  const result=simulation.advanceDay(game);
  assert.equal(result.ok,true,result.error);
  assert.notEqual(game.worldDate,priorDate);
  assert.equal(game.financeCycleDate,game.worldDate);
  assert.equal(game.priceIndexHistory.length,1);
});

test('daily turnover tax records partial collection and arrears; price index is a weighted configured basket and idempotent',()=>{
  const game=world();
  const {first,market}=configure(game);
  const company=game.companies.find(item=>item.stateId===first.stateId);
  company.cashBalances ||= {};
  company.cashBalances[first.currencyId]=25;
  game.companyFinancialTransactions.push({
    id:'test-market-sale',companyId:company.id,stateId:first.stateId,
    currencyId:first.currencyId,type:'MarketSale',amount:1000,worldDate:game.worldDate,
    quantity:10,unitPrice:100
  });
  const basePrice=game.priceIndexConfigs[0].items[0].basePrice;
  market.currentPrice=Math.max(1,Math.round(basePrice*1.1));
  const expectedIndex=Number((100*market.currentPrice/basePrice).toFixed(4));
  const treasury=first.treasury;
  const result=finance.advanceDay(game,()=> 'finance-tax-'+(++sequence));
  assert.equal(result.ok,true);
  const assessment=game.taxAssessments[0];
  assert.equal(assessment.amountDue,50);
  assert.equal(assessment.amountPaid,25);
  assert.equal(assessment.arrearsAfter,25);
  assert.equal(company.cashBalances[first.currencyId],0);
  assert.equal(first.treasury,treasury+25);
  const index=game.priceIndexHistory[0];
  assert.equal(index.indexValue,expectedIndex);
  assert.ok(index.indexValue>100);
  const stateAfter=first.treasury;
  const replay=finance.advanceDay(game,()=> 'finance-replay-'+(++sequence));
  assert.equal(replay.replayed,true);
  assert.equal(first.treasury,stateAfter);
  assert.equal(game.taxAssessments.length,1);
});