'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const Scenario=require('../scenario.js');

function makeScenario() {
  const territories=Scenario.officialStates.map((item,index)=>({
    scenarioStateKey:item.key,index,stateId:'state-'+String(index+1).padStart(2,'0'),
    name:item.name,currencyId:'currency-'+String(index+1).padStart(2,'0'),
    population:1000,prosperity:50,infrastructure:1
  }));
  return {
    id:'game-test',scenarioId:'beleland-frontier',scenarioVersion:'2.1',
    worldDate:'1500-01-01',worldVersion:0,
    territories,
    currencies:territories.map((item,index)=>({
      id:item.currencyId,stateId:item.stateId,name:'Currency '+(index+1),
      code:'T'+String(index+1).padStart(2,'0'),minorUnitScale:100
    })),
    goods:[{id:'grain',name:'Grain'}],
    productionRecipes:[{id:'grain-production',inputs:{},outputs:{grain:10}}],
    companies:territories.map((item,index)=>({id:'company-'+index,stateId:item.stateId})),
    technologies:[{id:'basic-agriculture',prerequisiteTechnologyIds:[]}],
    politicalSystems:territories.map(item=>({stateId:item.stateId,configurationPending:false})),
    resourceDeposits:[],
    provinces:[],
    territoryGeometry:{}
  };
}

test('scenario registry preserves sixteen stable official State identities',()=>{
  assert.equal(Scenario.officialStates.length,16);
  assert.equal(new Set(Scenario.officialStates.map(item=>item.key)).size,16);
  assert.equal(Scenario.officialStates[0].key,'coimbrila');
  assert.equal(Scenario.officialStates[15].key,'kueopia');
});

test('State seed tokens are deterministic for the same seed and version',()=>{
  const one=Scenario.deterministicStateSeed('campaign-001','2.1','coimbrila');
  assert.equal(one,Scenario.deterministicStateSeed('campaign-001','2.1','coimbrila'));
  assert.notEqual(one,Scenario.deterministicStateSeed('campaign-002','2.1','coimbrila'));
  assert.notEqual(one,Scenario.deterministicStateSeed('campaign-001','2.2','coimbrila'));
  assert.notEqual(one,Scenario.deterministicStateSeed('campaign-001','2.1','gania'));
});

test('scenario structural audit detects a missing State and invalid recipe reference',()=>{
  const game=makeScenario();
  game.territories.pop();
  game.productionRecipes[0].outputs.missingGood=4;
  const audit=Scenario.validate(game);
  assert.equal(audit.valid,false);
  assert.ok(audit.errors.includes('STATE_COUNT_MISMATCH'));
  assert.ok(audit.errors.some(item=>item.startsWith('STATE_MISSING:')));
  assert.ok(audit.errors.includes('RECIPE_GOOD_MISSING:grain-production:missingGood'));
});

test('scenario audit reports undefined geographic and seed-generation work as warnings',()=>{
  const audit=Scenario.validate(makeScenario());
  assert.equal(audit.valid,true);
  assert.ok(audit.warnings.includes('PROVINCE_BOUNDARIES_NOT_CONFIGURED'));
  assert.ok(audit.warnings.includes('SEED_NOT_APPLIED_TO_WORLD_GENERATION'));
  assert.ok(audit.warnings.includes('DEMOGRAPHIC_ECONOMIC_BALANCE_NOT_VERIFIED'));
});

test('version record remains valid as the running world date advances',()=>{
  const game=makeScenario();
  const record=Scenario.createRecord(game,'fixed-campaign-seed');
  assert.equal(Scenario.validateRecord(game,record).valid,true);
  game.worldDate='1500-01-02';
  game.worldVersion=1;
  assert.equal(Scenario.validateRecord(game,record).valid,true);
});

test('version record rejects a changed stable State identity',()=>{
  const game=makeScenario();
  const record=Scenario.createRecord(game,'fixed-campaign-seed');
  game.territories[0].stateId='state-replaced';
  const validation=Scenario.validateRecord(game,record);
  assert.equal(validation.valid,false);
  assert.ok(validation.errors.includes('SCENARIO_FINGERPRINT_MISMATCH'));
});

test('technology dependency cycle is rejected rather than silently ignored',()=>{
  const game=makeScenario();
  game.technologies=[
    {id:'a',prerequisiteTechnologyIds:['b']},
    {id:'b',prerequisiteTechnologyIds:['a']}
  ];
  const audit=Scenario.validate(game);
  assert.equal(audit.valid,false);
  assert.ok(audit.errors.includes('TECHNOLOGY_PREREQUISITE_CYCLE'));
});


test('scenario version fingerprint stays stable as finite stocks and environmental conditions evolve',()=>{
  const game=makeScenario();
  game.resourceCatalog=[{
    id:'timber-resource',name:'Timber',unit:'m3',category:'forest',
    goodId:'timber',renewable:true,regenerationPerDay:2
  }];
  game.resourceDeposits=[{
    id:'mineral-deposit',stateId:game.territories[0].stateId,
    provinceId:'province-a',resourceId:'ore',reserves:500,initialReserves:500,
    reserveCapacity:1000,dailyExtractionLimit:20,extractionLawId:'mining-law',
    extractionOfficeIds:['mining-office'],accessible:true,depth:10
  }];
  game.agriculturalLand=[{
    id:'forest-land',stateId:game.territories[0].stateId,
    provinceId:'province-a',use:'forest',areaHectares:100,
    soilFertilityPercent:70,initialSoilFertilityPercent:70
  }];
  game.cropDefinitions=[];
  game.farms=[];
  game.climateZones=[];
  game.energySources=[];
  game.foodReserves=[];
  game.disasters=[];
  game.environmentalStates=[{
    provinceId:'province-a',forestCoverPercent:80,initialForestCoverPercent:80,
    pollutionIndex:10,initialPollutionIndex:10,biodiversityPercent:90,
    initialBiodiversityPercent:90
  }];
  game.livestockSites=[{
    id:'herd-a',stateId:game.territories[0].stateId,
    provinceId:'province-a',initialAnimals:100,animals:100,
    annualBirthsPerThousand:30
  }];
  game.fishingGrounds=[{
    id:'fish-a',stateId:game.territories[0].stateId,
    provinceId:'province-a',initialStock:200,stock:200,
    sustainableCatchPerDay:10
  }];
  game.forestAreas=[{
    id:'forest-a',stateId:game.territories[0].stateId,
    provinceId:'province-a',initialStandingTimber:100,standingTimber:100,
    regenerationPerDay:2
  }];
  game.waterSources=[{
    id:'river-a',stateId:game.territories[0].stateId,
    provinceId:'province-a',type:'river',unit:'m3',
    initialStock:1000,stock:1000,capacity:1200,renewableInflowPerDay:5,
    maximumWithdrawalPerDay:50,environmentalReserve:200,qualityPercent:90
  }];
  game.waterDemands=[];
  game.serviceTypes=[];
  game.publicServiceFacilities=[];
  game.industryOccupations=[];
  game.labourPools=[];
  game.industryWorkplaces=[];
  game.labourUnions=[];
  const record=Scenario.createRecord(game,'environment-seed');
  assert.equal(Scenario.validateRecord(game,record).valid,true);

  game.resourceDeposits[0].reserves=300;
  game.livestockSites[0].animals=85;
  game.fishingGrounds[0].stock=140;
  game.forestAreas[0].standingTimber=80;
  game.waterSources[0].stock=700;
  game.environmentalStates[0].forestCoverPercent=75;
  game.environmentalStates[0].pollutionIndex=15;
  assert.equal(Scenario.validateRecord(game,record).valid,true,
    'runtime depletion and environmental change must not invalidate the initial scenario record');

  game.fishingGrounds[0].sustainableCatchPerDay=5;
  assert.equal(Scenario.validateRecord(game,record).valid,false,
    'a change to the original fisheries rule must invalidate the initial scenario record');
});


test('scenario fingerprint includes epidemic rules and dated seeds but excludes live disease counts',()=>{
  const game=makeScenario();
  const stateId=game.territories[0].stateId;
  game.demographicProfiles=[{
    stateId,annualBirthsPerThousand:18,
    ageBands:[{minAge:0,maxAge:120,annualDeathsPerThousand:7}],
    migrationPermissionSetIds:['migration-office']
  }];
  game.populationGroups=[{
    id:'urban-population',stateId,name:'Urban population',locationId:'province-a',
    population:100,ageCohorts:[{ageYears:25,population:100}]
  }];
  game.epidemicDefinitions=[{
    id:'disease-a',stateId,name:'Configured disease',
    description:'Explicit epidemic scenario definition.',
    incubationDays:2,infectiousDays:5,transmissionBasisPoints:800,
    dailyMortalityPerThousand:12,
    contactLinks:[{
      originGroupId:'urban-population',destinationGroupId:'urban-population',
      dailyContactsPerThousand:2500
    }]
  }];
  game.epidemicStarts=[{
    id:'outbreak-a',definitionId:'disease-a',sourceGroupId:'urban-population',
    startsOn:'1500-03-01',initialInfectious:2
  }];
  const record=Scenario.createRecord(game,'epidemic-scenario-seed');
  assert.equal(Scenario.validateRecord(game,record).valid,true);

  game.populationGroups[0].population=98;
  game.populationGroups[0].ageCohorts=[{ageYears:25,population:98}];
  game.epidemicOutbreaks=[{
    id:'runtime-outbreak',scenarioStartId:'outbreak-a',definitionId:'disease-a',
    stateId,startedOn:'1500-03-01',status:'active',totalDeaths:2
  }];
  game.epidemicGroupStates=[{
    outbreakId:'runtime-outbreak',groupId:'urban-population',
    susceptible:80,exposedCohorts:[],infectiousCohorts:[{daysRemaining:2,count:1}],
    recovered:17
  }];
  assert.equal(Scenario.validateRecord(game,record).valid,true,
    'daily mortality, compartments and outbreak progress must not rewrite the scenario fingerprint');

  game.epidemicDefinitions[0].transmissionBasisPoints=801;
  assert.equal(Scenario.validateRecord(game,record).valid,false,
    'changing the configured disease rule must invalidate the initial scenario fingerprint');

  game.epidemicDefinitions[0].transmissionBasisPoints=800;
  game.epidemicStarts[0].initialInfectious=3;
  assert.equal(Scenario.validateRecord(game,record).valid,false,
    'changing the scenario outbreak seed must invalidate the initial scenario fingerprint');
});
