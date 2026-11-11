'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const Services=require('../services.js');

function makeGame() {
  return {
    id:'services-test',worldDate:'1500-01-02',worldVersion:4,eventSequence:0,
    territories:[{stateId:'state-a',currencyId:'currency-a',treasury:500,population:1000}],
    provinces:[{id:'province-a',stateId:'state-a'}],
    populationGroups:[{
      id:'households-a',stateId:'state-a',provinceId:'province-a',
      name:'Households',population:1000
    }],
    companies:[{
      id:'operator-a',stateId:'state-a',currencyId:'currency-a',
      cashBalances:{'currency-a':200},facilities:[]
    }],
    serviceTypes:[{
      id:'basic-health',name:'Basic health visits',category:'health',
      unit:'visits',demandPerThousandResidentsPerDay:100,
      healthMortalityReductionPercentAtFullAccess:20,
      educationProgressPerDayAtFullAccess:0
    }],
    publicServiceFacilities:[],publicServiceCoverage:[],publicServiceHistory:[],
    financialTransactions:[],companyFinancialTransactions:[],events:[],activity:[]
  };
}

function facility(id,overrides={}) {
  return {
    id,name:id,serviceTypeId:'basic-health',stateId:'state-a',provinceId:'province-a',
    providerType:'public',capacityPerDay:40,staff:10,staffRequired:10,
    qualityPercent:100,dailyOperatingCost:40,publicFundingPercent:100,
    maximumTravelDistanceKm:10,maximumTravelTimeMinutes:30,
    populationGroupIds:['households-a'],
    accessProfiles:[{
      populationGroupId:'households-a',distanceKm:1,travelTimeMinutes:10,
      transportCoveragePercent:100,eligibilityPercent:100,affordabilityPercent:100
    }],...overrides
  };
}

test('public service validation requires real local groups and correct funding ownership',()=>{
  const game=makeGame();
  const configuration={
    serviceTypes:game.serviceTypes,
    publicServiceFacilities:[facility('clinic')]
  };
  assert.deepEqual(Services.validateConfiguration(game,configuration),{ok:true,error:null});
  const wrongProvince=structuredClone(configuration);
  wrongProvince.publicServiceFacilities[0].provinceId='unknown-province';
  assert.equal(Services.validateConfiguration(game,wrongProvince).ok,false);
  const wrongFunding=structuredClone(configuration);
  wrongFunding.publicServiceFacilities[0].publicFundingPercent=50;
  assert.match(Services.validateConfiguration(game,wrongFunding).error,/100% public funding/i);
  const duplicateGroups=structuredClone(configuration);
  duplicateGroups.publicServiceFacilities[0].populationGroupIds=['households-a','households-a'];
  assert.equal(Services.validateConfiguration(game,duplicateGroups).ok,false);
});

test('several facilities share one demand pool and cannot double-count the same residents',()=>{
  const game=makeGame();
  game.publicServiceFacilities=[
    facility('clinic-a',{capacityPerDay:40,dailyOperatingCost:0}),
    facility('clinic-b',{capacityPerDay:80,dailyOperatingCost:0})
  ];
  const result=Services.advanceDay(game);
  assert.equal(result.demand,100);
  assert.equal(result.served,100);
  assert.equal(game.publicServiceCoverage[0].served+
    game.publicServiceCoverage[1].served,100);
  assert.equal(game.populationGroups[0].serviceAccess['basic-health'].demand,100);
  assert.equal(game.populationGroups[0].serviceAccess['basic-health'].served,100);
  assert.equal(game.populationGroups[0].healthMortalityReductionPercent,20);
});

test('two facilities with the same access profile cannot double-count reachable residents',()=>{
  const game=makeGame();
  game.publicServiceFacilities=[
    facility('clinic-a',{capacityPerDay:100,dailyOperatingCost:0,
      accessProfiles:[{
        populationGroupId:'households-a',distanceKm:20,travelTimeMinutes:45,
        transportCoveragePercent:100,eligibilityPercent:100,affordabilityPercent:100
      }]}),
    facility('clinic-b',{capacityPerDay:100,dailyOperatingCost:0,
      accessProfiles:[{
        populationGroupId:'households-a',distanceKm:20,travelTimeMinutes:45,
        transportCoveragePercent:100,eligibilityPercent:100,affordabilityPercent:100
      }]})
  ];
  const result=Services.advanceDay(game);
  assert.equal(result.demand,100);
  assert.equal(result.accessibleDemand,50);
  assert.equal(result.served,50);
  assert.equal(game.publicServiceCoverage[0].served+game.publicServiceCoverage[1].served,50);
  assert.equal(game.populationGroups[0].serviceAccess['basic-health'].reachPercent,50);
});

test('staff, quality, public treasury and private operator cash constrain delivery and are accounted separately',()=>{
  const game=makeGame();
  game.publicServiceFacilities=[
    facility('clinic-public',{
      capacityPerDay:40,staff:5,staffRequired:10,
      dailyOperatingCost:40,publicFundingPercent:100
    }),
    facility('clinic-private',{
      providerType:'private',operatorCompanyId:'operator-a',
      capacityPerDay:60,staff:10,staffRequired:10,qualityPercent:50,
      dailyOperatingCost:80,publicFundingPercent:0
    })
  ];
  const configuration={
    serviceTypes:game.serviceTypes,
    publicServiceFacilities:game.publicServiceFacilities
  };
  const validation=Services.validateConfiguration(game,configuration);
  assert.equal(validation.ok,true,validation.error);
  const result=Services.advanceDay(game);
  assert.equal(result.demand,100);
  assert.equal(result.served,80,
    'the private provider serves 60 first; the funded and staffed public clinic serves 20 remaining visits');
  assert.equal(game.territories[0].treasury,460);
  assert.equal(game.companies[0].cashBalances['currency-a'],120);
  assert.equal(game.financialTransactions.length,1);
  assert.equal(game.companyFinancialTransactions.length,1);
  assert.equal(game.publicServiceCoverage[0].privateCost,80);
  assert.equal(game.publicServiceCoverage[1].publicCost,40);
  assert.equal(game.populationGroups[0].healthServiceAccessPercent,80);
  assert.equal(game.populationGroups[0].healthMortalityReductionPercent,10);
});

test('water shortage reduces the delivered public service quantity',()=>{
  const game=makeGame();
  game.publicServiceFacilities=[facility('clinic',{
    capacityPerDay:100,waterDemandId:'water-clinic',dailyOperatingCost:0
  })];
  game.waterDemands=[{
    id:'water-clinic',stateId:'state-a',provinceId:'province-a',
    targetType:'public_service',targetId:'clinic',dailyDemand:100,
    priority:80,unit:'m3'
  }];
  game.waterAllocations=[{
    demandId:'water-clinic',worldDate:'1500-01-02',coveragePercent:35
  }];
  const result=Services.advanceDay(game);
  assert.equal(result.demand,100);
  assert.equal(result.served,35);
  assert.equal(game.publicServiceCoverage[0].waterCoveragePercent,35);
  assert.equal(game.populationGroups[0].healthMortalityReductionPercent,7);
});

test('distance, travel time, transport, eligibility and affordability reduce real population access',()=>{
  const game=makeGame();
  game.publicServiceFacilities=[facility('remote-clinic',{
    capacityPerDay:100,dailyOperatingCost:0,
    maximumTravelDistanceKm:10,maximumTravelTimeMinutes:30,
    accessProfiles:[{
      populationGroupId:'households-a',distanceKm:20,travelTimeMinutes:45,
      transportCoveragePercent:80,eligibilityPercent:90,affordabilityPercent:75
    }]
  })];
  const result=Services.advanceDay(game);
  assert.equal(result.demand,100,'full underlying need remains visible');
  assert.equal(result.accessibleDemand,50,'distance and time set the accessible share to 50%');
  assert.equal(result.served,50);
  assert.equal(game.publicServiceCoverage[0].fullDemand,100);
  assert.equal(game.publicServiceCoverage[0].reachablePopulationDemand,50);
  assert.equal(game.publicServiceCoverage[0].populationAccessPercent,50);
  assert.equal(game.populationGroups[0].serviceAccess['basic-health'].reachPercent,50);
});

test('private, religious, community and mixed services cannot operate without a local NPC operator',()=>{
  const game=makeGame();
  const configuration={
    serviceTypes:game.serviceTypes,
    publicServiceFacilities:[facility('community-clinic',{
      providerType:'community',publicFundingPercent:25,operatorCompanyId:'missing-company'
    })]
  };
  const result=Services.validateConfiguration(game,configuration);
  assert.equal(result.ok,false);
  assert.match(result.error,/registered local NPC operator/i);
});


test('public service operating costs and education or health progress cannot execute twice on the same world date',()=>{
  const game=makeGame();
  game.publicServiceFacilities=[facility('clinic',{dailyOperatingCost:100})];
  const first=Services.advanceDay(game);
  const treasury=game.territories[0].treasury;
  const history=game.publicServiceHistory.length;
  const transactions=game.financialTransactions.length;
  const second=Services.advanceDay(game);
  assert.equal(first.served,second.served);
  assert.equal(second.replayed,true);
  assert.equal(game.territories[0].treasury,treasury);
  assert.equal(game.publicServiceHistory.length,history);
  assert.equal(game.financialTransactions.length,transactions);
});


test('education improves qualifications only after its configured delay',()=>{
  const game=makeGame();
  game.serviceTypes=[{
    id:'primary-school',name:'Primary schooling',category:'education',unit:'student-days',
    demandPerThousandResidentsPerDay:100,
    healthMortalityReductionPercentAtFullAccess:0,
    educationProgressPerDayAtFullAccess:10,
    educationProgressDelayDays:2
  }];
  game.publicServiceFacilities=[facility('school',{
    serviceTypeId:'primary-school',capacityPerDay:100,dailyOperatingCost:0,
    accessProfiles:[{
      populationGroupId:'households-a',distanceKm:1,travelTimeMinutes:10,
      transportCoveragePercent:100,eligibilityPercent:100,affordabilityPercent:100
    }]
  })];
  game.labourPools=[{
    id:'local-workers',stateId:'state-a',provinceId:'province-a',
    populationGroupId:'households-a',occupationId:'general',workforce:10,
    qualificationLevel:20
  }];
  Services.advanceDay(game);
  assert.equal(game.populationGroups[0].educationIndexPercent||0,0);
  assert.equal(game.populationGroups[0].educationProgressQueue.length,1);
  assert.equal(game.populationGroups[0].educationProgressQueue[0].dueDate,'1500-01-04');
  Services.advanceDay(game);
  assert.equal(game.populationGroups[0].educationProgressQueue.length,1,
    'same-date replay must not queue another education gain');
  game.worldDate='1500-01-03';
  Services.advanceDay(game);
  assert.equal(game.populationGroups[0].educationIndexPercent||0,0);
  game.worldDate='1500-01-04';
  Services.advanceDay(game);
  assert.equal(game.populationGroups[0].educationIndexPercent,10);
  assert.equal(game.labourPools[0].qualificationLevel,30);
  assert.equal(game.populationGroups[0].educationProgressQueue.length,2,
    'the delayed day-three and day-four education gains remain queued separately');
  assert.deepEqual(game.populationGroups[0].educationProgressQueue.map(item=>item.dueDate),
    ['1500-01-05','1500-01-06']);
});
