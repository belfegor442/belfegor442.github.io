'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const Industry=require('../industry.js');

function makeGame() {
  const company={
    id:'mill-company',stateId:'state-a',currencyId:'currency-a',
    name:'Flour Mill',sector:'Food processing',
    cashBalances:{'currency-a':5000},inventory:{grain:100},facilities:[
      {id:'mill-facility',recipeId:'mill-flour',workers:0}
    ]
  };
  return {
    id:'industry-test',worldDate:'1500-01-02',worldVersion:3,eventSequence:0,
    territories:[{stateId:'state-a',currencyId:'currency-a',population:500}],
    provinces:[{id:'province-a',stateId:'state-a'}],
    populationGroups:[{
      id:'households-a',stateId:'state-a',provinceId:'province-a',
      population:500,name:'Local households'
    }],
    companies:[company],companyFinancialTransactions:[],events:[],activity:[],
    industryOccupations:[{
      id:'miller',name:'Mill worker',minimumQualificationLevel:20
    }],
    labourPools:[{
      id:'labour-a',stateId:'state-a',provinceId:'province-a',
      populationGroupId:'households-a',occupationId:'miller',
      workforce:400,qualificationLevel:60
    }],
    industryWorkplaces:[{
      id:'mill-workplace',companyId:'mill-company',facilityId:'mill-facility',
      stateId:'state-a',provinceId:'province-a',occupationId:'miller',
      positions:300,wagePerWorkerPerDay:5,minimumQualificationLevel:40,
      shiftHoursPerDay:8,safetyRatingPercent:85,hazardExposurePercent:20,
      operational:true,unionId:'mill-union'
    }],
    labourUnions:[{
      id:'mill-union',stateId:'state-a',provinceId:'province-a',
      occupationId:'miller',name:'Mill workers union',recognized:true,
      membershipPercent:50,negotiatedWagePerWorkerPerDay:9
    }],
    farms:[]
  };
}

test('industry validation rejects labour supply above the referenced population group',()=>{
  const game=makeGame();
  const configuration={
    industryOccupations:game.industryOccupations,
    labourPools:game.labourPools.map(item=>({...item,workforce:501})),
    industryWorkplaces:game.industryWorkplaces,labourUnions:game.labourUnions
  };
  const result=Industry.validateConfiguration(game,configuration);
  assert.equal(result.ok,false);
  assert.match(result.error,/cannot exceed the population/i);
});

test('companies employ qualified local workers and pay wages through their own currency ledger',()=>{
  const game=makeGame();
  const configuration={
    industryOccupations:game.industryOccupations,
    labourPools:game.labourPools,
    industryWorkplaces:game.industryWorkplaces,
    labourUnions:game.labourUnions
  };
  const validation=Industry.validateConfiguration(game,configuration);
  assert.equal(validation.ok,true,validation.error);
  const result=Industry.advanceDay(game);
  assert.equal(result.workplaces,1);
  assert.equal(result.employedWorkers,300);
  assert.equal(result.payrollByCurrency['currency-a'],2100);
  assert.equal(game.companies[0].cashBalances['currency-a'],2900);
  assert.equal(game.companies[0].facilities[0].workers,300);
  assert.equal(game.industryEmploymentContracts[0].wagePerWorkerPerDay,7,
    'the 50% union membership share applies the negotiated 9-unit wage above the 5-unit base');
  assert.equal(game.industryEmploymentContracts[0].unionMembershipPercent,50);
  assert.equal(game.industryEmploymentContracts[0].effectiveSafetyPercent,68);
  assert.equal(game.industryLabourBalances[0].workforce,400);
  assert.equal(game.industryLabourBalances[0].employed,300);
  assert.equal(game.industryLabourBalances[0].unemployed,100);
  assert.equal(game.industryLabourBalances[0].employmentRatePercent,75);
  assert.equal(game.companyFinancialTransactions[0].type,'Payroll');
  assert.equal(game.companyFinancialTransactions[0].amount,-2100);
});

test('a company cannot employ more workers than its real cash balance can pay',()=>{
  const game=makeGame();
  game.companies[0].cashBalances['currency-a']=250;
  game.industryWorkplaces[0].unionId=null;
  game.industryWorkplaces[0].positions=100;
  game.industryWorkplaces[0].wagePerWorkerPerDay=10;
  const result=Industry.advanceDay(game);
  assert.equal(result.employedWorkers,25);
  assert.equal(result.payrollByCurrency['currency-a'],250);
  assert.equal(game.industryEmploymentContracts[0].workers,25);
  assert.equal(game.companies[0].cashBalances['currency-a'],0);
  assert.equal(game.industryLabourBalances[0].unemployed,375);
});

test('unions do not negotiate for an unrecognized organization or zero membership',()=>{
  const game=makeGame();
  game.labourUnions[0].recognized=false;
  const result=Industry.advanceDay(game);
  assert.equal(game.industryEmploymentContracts[0].wagePerWorkerPerDay,5);
  assert.equal(result.payrollByCurrency['currency-a'],1500);
});

test('workers are not fabricated when no labour market is configured; supplied workers remain unemployed',()=>{
  const game=makeGame();
  game.industryWorkplaces=[];
  const result=Industry.advanceDay(game);
  assert.equal(result.employedWorkers,0);
  assert.equal(game.industryLabourBalances[0].workforce,400);
  assert.equal(game.industryLabourBalances[0].unemployed,400);
});


test('labour supply contracts with population and payroll is idempotent for a world date',()=>{
  const game=makeGame();
  game.populationGroups[0].population=100;
  const first=Industry.advanceDay(game);
  assert.equal(first.employedWorkers,100);
  assert.equal(game.industryLabourBalances[0].workforce,100);
  assert.equal(game.industryLabourBalances[0].unemployed,0);
  const cash=game.companies[0].cashBalances['currency-a'];
  const transactionCount=game.companyFinancialTransactions.length;
  const second=Industry.advanceDay(game);
  assert.equal(second.replayed,true);
  assert.equal(second.employedWorkers,100);
  assert.equal(game.companies[0].cashBalances['currency-a'],cash);
  assert.equal(game.companyFinancialTransactions.length,transactionCount);
});
