'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const Epidemiology=require('../epidemiology.js');

function makeGame(date='1500-01-01') {
  return {
    id:'epidemic-test',worldDate:date,worldVersion:12,eventSequence:0,
    territories:[{stateId:'state-a',name:'State A',population:1000,
      demographicDeathsLastDay:0}],
    populationGroups:[
      {id:'origin',stateId:'state-a',name:'Origin',locationId:'province-a',
        population:500,ageCohorts:[{ageYears:20,population:500}],
        healthMortalityReductionPercent:0},
      {id:'destination',stateId:'state-a',name:'Destination',locationId:'province-b',
        population:500,ageCohorts:[{ageYears:40,population:500}],
        healthMortalityReductionPercent:0}
    ],
    epidemicDefinitions:[],epidemicStarts:[],
    epidemicOutbreaks:[],epidemicGroupStates:[],epidemicHistory:[],
    events:[],activity:[]
  };
}

function scenario(game,options={}) {
  game.epidemicDefinitions=[{
    id:'disease-a',stateId:'state-a',name:'Configured respiratory illness',
    description:'A test-only disease profile with explicit transmission parameters.',
    incubationDays:1,infectiousDays:2,
    transmissionBasisPoints:1000,
    dailyMortalityPerThousand:options.mortality??0,
    contactLinks:[{
      originGroupId:'origin',destinationGroupId:'destination',
      dailyContactsPerThousand:10000
    }]
  }];
  game.epidemicStarts=[{
    id:'start-a',definitionId:'disease-a',sourceGroupId:'origin',
    startsOn:options.startsOn||game.worldDate,initialInfectious:10
  }];
  return game;
}

test('new worlds contain no fabricated diseases, outbreaks or epidemic history',()=>{
  const game=makeGame();
  const result=Epidemiology.advanceDay(game,()=> 'unused');
  assert.deepEqual(result,{ok:true,started:[],advanced:0});
  assert.deepEqual(game.epidemicDefinitions,[]);
  assert.deepEqual(game.epidemicStarts,[]);
  assert.deepEqual(game.epidemicOutbreaks,[]);
  assert.deepEqual(game.epidemicGroupStates,[]);
  assert.deepEqual(game.epidemicHistory,[]);
});

test('epidemic scenario validation requires real same-State groups, dated starts and explicit bounded parameters',()=>{
  const game=makeGame();
  scenario(game);
  assert.deepEqual(Epidemiology.validateConfiguration(game,game),{
    ok:true,error:null,errors:[]
  });
  const invalidLink=structuredClone(game);
  invalidLink.epidemicDefinitions[0].contactLinks[0].destinationGroupId='foreign-group';
  assert.match(Epidemiology.validateConfiguration(invalidLink,invalidLink).error,
    /EPIDEMIC_CONTACT_LINK_INVALID/);
  const invalidRate=structuredClone(game);
  invalidRate.epidemicDefinitions[0].transmissionBasisPoints=10001;
  assert.match(Epidemiology.validateConfiguration(invalidRate,invalidRate).error,
    /EPIDEMIC_DEFINITION_INVALID/);
  const invalidDate=structuredClone(game);
  invalidDate.epidemicStarts[0].startsOn='1500-02-30';
  assert.match(Epidemiology.validateConfiguration(invalidDate,invalidDate).error,
    /EPIDEMIC_START_INVALID/);
  const pastDate=structuredClone(game);
  pastDate.epidemicStarts[0].startsOn='1499-12-31';
  assert.match(Epidemiology.validateConfiguration(pastDate,pastDate).error,
    /EPIDEMIC_START_INVALID/);
});

test('a configured outbreak begins only on its date and never appears in an unconfigured world',()=>{
  const game=makeGame();
  scenario(game,{startsOn:'1500-01-03'});
  let result=Epidemiology.advanceDay(game,()=> 'outbreak-1');
  assert.deepEqual(result,{ok:true,started:[],advanced:0});
  assert.equal(game.epidemicOutbreaks.length,0);
  game.worldDate='1500-01-03';
  result=Epidemiology.advanceDay(game,()=> 'outbreak-1');
  assert.deepEqual(result,{ok:true,started:['outbreak-1'],advanced:0});
  assert.equal(game.epidemicOutbreaks[0].status,'active');
  assert.equal(game.epidemicOutbreaks[0].totalInfections,10);
  assert.equal(game.epidemicGroupStates.find(item=>item.groupId==='origin').susceptible,490);
  assert.equal(game.epidemicGroupStates.find(item=>item.groupId==='destination').susceptible,500);
  assert.ok(game.events.some(item=>item.type==='society.epidemic_outbreak_started'));
});

test('configured contact links propagate exposure, incubation, infection and recovery without duplicate cases',()=>{
  const game=makeGame();
  scenario(game);
  const created=Epidemiology.advanceDay(game,()=> 'outbreak-1');
  assert.equal(created.started.length,1);
  game.worldDate='1500-01-02';
  const dayTwo=Epidemiology.advanceDay(game,()=> 'unused');
  assert.deepEqual(dayTwo,{ok:true,started:[],advanced:1});
  let destination=game.epidemicGroupStates.find(item=>item.groupId==='destination');
  assert.equal(destination.susceptible,490);
  assert.deepEqual(destination.exposedCohorts,[{daysRemaining:1,count:10}]);
  assert.equal(game.epidemicOutbreaks[0].totalExposures,10);
  assert.equal(game.epidemicOutbreaks[0].totalInfections,10);

  game.worldDate='1500-01-03';
  Epidemiology.advanceDay(game,()=> 'unused');
  destination=game.epidemicGroupStates.find(item=>item.groupId==='destination');
  assert.equal(destination.exposedCohorts.length,0);
  assert.equal(destination.infectiousCohorts.reduce((sum,item)=>sum+item.count,0),10);
  assert.equal(destination.infectionsTotal,10);
  assert.equal(game.epidemicOutbreaks[0].totalInfections,20);
  assert.equal(game.epidemicOutbreaks[0].totalRecoveries,10);
  assert.equal(game.epidemicGroupStates.find(item=>item.groupId==='origin').recovered,10);
  assert.equal(game.populationGroups.reduce((sum,item)=>sum+item.population,0),
    game.territories[0].population);
  assert.equal(game.events.filter(item=>item.type==='society.epidemic_infections').length,1);
});

test('configured epidemic mortality reduces real age cohorts and health coverage protects proportionally',()=>{
  const game=makeGame();
  game.populationGroups[0].healthMortalityReductionPercent=50;
  scenario(game,{mortality:500});
  Epidemiology.advanceDay(game,()=> 'outbreak-1');
  game.worldDate='1500-01-02';
  Epidemiology.advanceDay(game,()=> 'unused');
  const origin=game.populationGroups[0];
  const state=game.epidemicGroupStates.find(item=>item.groupId==='origin');
  assert.equal(state.deathsTotal,2);
  assert.equal(origin.population,498);
  assert.equal(origin.ageCohorts.reduce((sum,item)=>sum+item.population,0),498);
  assert.equal(game.territories[0].population,998);
  assert.equal(game.territories[0].demographicDeathsLastDay,2);
  assert.equal(game.epidemicOutbreaks[0].totalDeaths,2);
  assert.ok(game.events.some(item=>item.type==='society.epidemic_deaths'));
});

test('epidemic progression is atomic if the population age structure becomes invalid',()=>{
  const game=makeGame();
  scenario(game);
  Epidemiology.advanceDay(game,()=> 'outbreak-1');
  game.worldDate='1500-01-02';
  game.populationGroups[1].ageCohorts[0].population--;
  const before=structuredClone(game);
  const result=Epidemiology.advanceDay(game,()=> 'unused');
  assert.equal(result.ok,false);
  assert.match(result.error,/population|cohort/i);
  assert.deepEqual(game,before);
});

test('an outbreak is not started when another active outbreak already owns its contact network',()=>{
  const game=makeGame();
  scenario(game);
  game.epidemicStarts.push({
    id:'start-b',definitionId:'disease-a',sourceGroupId:'destination',
    startsOn:'1500-01-01',initialInfectious:5
  });
  assert.match(Epidemiology.validateConfiguration(game,game).error,
    /EPIDEMIC_SCENARIO_GROUP_OVERLAP/);
});

test('outbreaks finish after all exposed and infectious cohorts recover or die',()=>{
  const game=makeGame();
  scenario(game);
  Epidemiology.advanceDay(game,()=> 'outbreak-1');
  for(const date of ['1500-01-02','1500-01-03','1500-01-04','1500-01-05']) {
    game.worldDate=date;
    Epidemiology.advanceDay(game,()=> 'unused');
  }
  assert.equal(game.epidemicOutbreaks[0].status,'completed');
  assert.equal(game.epidemicOutbreaks[0].endedOn,'1500-01-04');
  assert.ok(game.epidemicHistory.some(item=>item.type==='outbreak_completed'));
  assert.ok(game.events.some(item=>item.type==='society.epidemic_outbreak_completed'));
  assert.equal(game.populationGroups.reduce((sum,item)=>sum+item.population,0),
    game.territories[0].population);
});


test('health-service access and quality automatically protect population groups from epidemic mortality',()=>{
  const Services=require('../services.js');
  const game=makeGame();
  game.populationGroups[0].provinceId='province-a';
  game.populationGroups[1].provinceId='province-b';
  game.provinces=[
    {id:'province-a',stateId:'state-a'},
    {id:'province-b',stateId:'state-a'}
  ];
  game.companies=[{
    id:'health-operator',stateId:'state-a',currencyId:'currency-a',
    cashBalances:{'currency-a':10000},facilities:[]
  }];
  game.serviceTypes=[{
    id:'basic-health',name:'Basic health visits',category:'health',
    unit:'visits',demandPerThousandResidentsPerDay:100,
    healthMortalityReductionPercentAtFullAccess:20,
    educationProgressPerDayAtFullAccess:0
  }];
  game.publicServiceFacilities=[{
    id:'clinic-a',name:'Clinic A',serviceTypeId:'basic-health',
    stateId:'state-a',provinceId:'province-a',providerType:'public',
    capacityPerDay:100,staff:10,staffRequired:10,qualityPercent:100,
    dailyOperatingCost:0,publicFundingPercent:100,
    maximumTravelDistanceKm:10,maximumTravelTimeMinutes:30,
    populationGroupIds:['origin'],
    accessProfiles:[{
      populationGroupId:'origin',distanceKm:1,travelTimeMinutes:10,
      transportCoveragePercent:100,eligibilityPercent:100,affordabilityPercent:100
    }]
  }];
  game.publicServiceCoverage=[];
  game.publicServiceHistory=[];
  game.financialTransactions=[];
  game.companyFinancialTransactions=[];
  const services=Services.advanceDay(game);
  assert.equal(services.ok,true,services.error);
  assert.equal(game.populationGroups[0].healthMortalityReductionPercent,20);
  assert.equal(game.populationGroups[1].healthMortalityReductionPercent,0);

  scenario(game,{mortality:500});
  Epidemiology.advanceDay(game,()=> 'health-protected-outbreak');
  game.worldDate='1500-01-02';
  let result=Epidemiology.advanceDay(game,()=> 'unused');
  assert.equal(result.ok,true,result.error);
  game.worldDate='1500-01-03';
  result=Epidemiology.advanceDay(game,()=> 'unused');
  assert.equal(result.ok,true,result.error);
  const protectedState=game.epidemicGroupStates.find(item=>item.groupId==='origin');
  const unprotectedState=game.epidemicGroupStates.find(item=>item.groupId==='destination');
  assert.equal(protectedState.deathsTotal,6);
  assert.equal(unprotectedState.deathsTotal,3);
  assert.equal(game.populationGroups[0].population,494);
  assert.equal(game.populationGroups[1].population,497);
});
