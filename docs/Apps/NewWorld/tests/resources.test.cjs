'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');

const simulation=require('../simulation.js');
const strategy=require('../strategy.js');
const justice=require('../justice.js');
const resources=require('../resources.js');

global.window={
  NewWorldSimulation:simulation,
  NewWorldStrategy:strategy,
  NewWorldJustice:justice,
  NewWorldResources:resources
};
globalThis.NewWorldResources=resources;

const multiplayer=require('../multiplayer.js');
let sequence=0;

function freshWorld() {
  return multiplayer.createInitialWorld('Resource Test Founder').game;
}

function baseConfiguration() {
  return {
    resourceCatalog:[],resourceDeposits:[],agriculturalLand:[],
    cropDefinitions:[],farms:[],climateZones:[],environmentalStates:[],
    disasters:[],energySources:[],foodReserves:[],waterSources:[],waterDemands:[],
    livestockSites:[],fishingGrounds:[],forestAreas:[]
  };
}

function addEnvironmentalState(provinceId,values={}) {
  return {
    provinceId,soilFertilityPercent:100,waterAvailabilityPercent:100,
    forestCoverPercent:100,biodiversityPercent:100,pollutionIndex:0,
    updatedOn:'1500-01-01',...values
  };
}

function configureWorld(game,options={}) {
  const territory=game.territories[0];
  const stateId=territory.stateId;
  const province=game.provinces.find(item=>item.stateId===stateId);
  const political=game.politicalSystems.find(item=>item.stateId===stateId);
  const facilityCompany=game.companies.find(item=>item.stateId===stateId);
  const facility=facilityCompany.facilities[0];
  facility.workers=options.workers ?? 20;

  const configuration=baseConfiguration();
  configuration.resourceCatalog.push({
    id:'iron-ore',name:'Iron ore',unit:'tonnes',category:'mineral',
    renewable:false,regenerationPerDay:0,goodId:'tools'
  });
  configuration.resourceCatalog.push({
    id:'timber-resource',name:'Timber',unit:'tonnes',category:'forest',
    renewable:true,regenerationPerDay:1,goodId:'timber'
  });
  configuration.resourceDeposits.push({
    id:'iron-deposit',stateId,provinceId:province.id,resourceId:'iron-ore',
    reserves:10,quality:85,accessible:true,maximumExtractionPerDay:6,
    sustainableExtractionPerDay:6,facilityId:facility.id,requiredWorkers:5,
    energyPerUnit:1,costPerUnit:0,extractionLawId:'founding-charter',
    extractionOfficeIds:['chief-executive'],qualityDepletionPerUnit:0.1
  });
  configuration.resourceDeposits.push({
    id:'timber-deposit',stateId,provinceId:province.id,resourceId:'timber-resource',
    reserves:5,reserveCapacity:7,quality:90,accessible:true,
    maximumExtractionPerDay:2,facilityId:facility.id,requiredWorkers:5,
    energyPerUnit:0,costPerUnit:0,extractionLawId:'founding-charter',
    extractionOfficeIds:['chief-executive']
  });
  configuration.energySources.push({
    id:'state-power',stateId,provinceId:province.id,
    capacityPerDay:100,productionPercent:100,consumptionPerDay:10,lossPercent:10
  });
  configuration.foodReserves.push({
    id:'grain-reserve',stateId,goodId:'grain',
    quantity:150,protectedQuantity:100,quality:95
  });
  if(options.agriculture) {
    game.goods.push({
      id:'maize',name:'Maize',unit:'tonnes',category:'Resource',
      storageCapacity:10000
    });
    configuration.cropDefinitions.push({
      id:'maize-crop',name:'Maize',outputGoodId:'maize',
      harvestMonths:[1],harvestDayOfMonth:2,yieldPerHectare:10,
      seedUsePerHectare:1,seedGoodId:'grain',workersPerHectare:1,
      soilDepletionPercentPerHarvest:1,minimumWaterPercent:50
    });
    configuration.agriculturalLand.push({
      id:'north-fields',stateId,provinceId:province.id,
      areaHectares:10,soilFertilityPercent:100,use:'arable'
    });
    configuration.farms.push({
      id:'north-farm',stateId,provinceId:province.id,landId:'north-fields',
      cropId:'maize-crop',areaHectares:10,workers:10,seedStock:20,
      toolsEfficiencyPercent:100,infrastructureEfficiencyPercent:100
    });
    configuration.climateZones.push({
      id:'temperate-north',name:'Configured seasonal cycle',
      provinceIds:[province.id],droughtExposurePercent:0,
      seasons:[
        {name:'First half',months:[1,2,3,4,5,6],yieldFactor:1,waterFactor:1},
        {name:'Second half',months:[7,8,9,10,11,12],yieldFactor:0.5,waterFactor:1}
      ]
    });
    configuration.environmentalStates.push(addEnvironmentalState(province.id));
  }
  if(options.disaster) {
    const otherProvince=game.provinces.find(item=>item.stateId!==stateId);
    const otherState=otherProvince.stateId;
    configuration.environmentalStates.push(
      addEnvironmentalState(province.id),
      addEnvironmentalState(otherProvince.id)
    );
    const seasons=[
      {name:'First half',months:[1,2,3,4,5,6],yieldFactor:1,waterFactor:1},
      {name:'Second half',months:[7,8,9,10,11,12],yieldFactor:1,waterFactor:1}
    ];
    configuration.climateZones.push({
      id:'drought-exposure-zone',name:'Partially exposed zone',
      provinceIds:[province.id],droughtExposurePercent:50,seasons
    });
    configuration.climateZones.push({
      id:'unexposed-zone',name:'Unexposed comparison zone',
      provinceIds:[otherProvince.id],droughtExposurePercent:0,seasons
    });
    configuration.disasters.push({
      id:'local-drought',type:'drought',provinceIds:[province.id],
      startDate:'1500-01-02',durationDays:3,intensityPercent:50,
      cropLossPercent:0,waterLossPercentPerDay:20,
      soilLossPercentPerDay:10,forestLossPercentPerDay:5,
      pollutionIncreasePerDay:0
    });
    assert.ok(otherState);
  }

  const configurationResult=resources.validateConfiguration(game,configuration);
  assert.equal(configurationResult.ok,true,configurationResult.error);
  const saved=multiplayer.applyAdmin(game,'configure',{
    kind:'resources',configuration
  });
  assert.equal(saved.ok,true,saved.error);
  return {territory,province,political,facility,configuration};
}

function startWorld(game) {
  const result=multiplayer.applyAdmin(game,'start',{});
  assert.equal(result.ok,true,result.error);
}

function send(game,player,type,payload={}) {
  const stateId=payload.stateId || game.territories[0].stateId;
  const membership=game.memberships.find(item=>
    item.playerId===player.id && item.stateId===stateId && item.status==='active');
  assert.ok(membership,'An active membership in the resource State is required.');
  return multiplayer.applyOrder(game,player,{
    orderId:'resource-test-'+(++sequence),
    gameId:game.id,playerId:player.id,
    expectedWorldVersion:game.worldVersion,stateId,type,...payload
  });
}

test('new worlds contain empty resource registers and do not invent climate, deposits or agricultural output',()=>{
  const game=freshWorld();
  for(const field of resources.arrayFields)
    assert.deepEqual(game[field],[],field+' must start empty');
  assert.equal(game.resourceCatalog.length,0);
  assert.equal(game.resourceDeposits.length,0);
  assert.equal(game.agriculturalLand.length,0);
  assert.equal(game.climateZones.length,0);
  assert.equal(game.environmentalStates.length,0);
  assert.equal(game.energySources.length,0);
});

test('configuration rejects invented references, invalid farmland area and invalid extraction authority',()=>{
  const game=freshWorld();
  const {configuration,facility}=configureWorld(game,{agriculture:true});
  const badLaw=structuredClone(configuration);
  badLaw.resourceDeposits[0].extractionLawId='nonexistent-law';
  assert.match(resources.validateConfiguration(game,badLaw).error,/valid extraction law/i);

  const badOffice=structuredClone(configuration);
  badOffice.resourceDeposits[0].extractionOfficeIds=['invented-office'];
  assert.match(resources.validateConfiguration(game,badOffice).error,/permit authority/i);

  const badProvince=structuredClone(configuration);
  badProvince.agriculturalLand[0].provinceId='unknown-province';
  assert.match(resources.validateConfiguration(game,badProvince).error,/invalid State, province/i);

  const oversizedFarm=structuredClone(configuration);
  oversizedFarm.farms[0].areaHectares=11;
  assert.match(resources.validateConfiguration(game,oversizedFarm).error,/invalid land, crop/i);
  assert.ok(facility.id);
});

test('finite extraction obeys law, office, energy, daily capacity and geological reserves',()=>{
  const game=freshWorld();
  const {territory,facility}=configureWorld(game);
  const host=game.players[0];
  startWorld(game);
  const deposit=game.resourceDeposits.find(item=>item.id==='iron-deposit');
  const energy=game.energyBalances.find(item=>item.stateId===territory.stateId);
  assert.equal(energy.generated,100);
  assert.equal(energy.losses,10);
  assert.equal(energy.consumption,10);
  assert.equal(energy.available,80);

  const first=send(game,host,'resource.extract',{
    stateId:territory.stateId,depositId:deposit.id,quantity:4
  });
  assert.equal(first.accepted,true,first.error);
  assert.equal(deposit.reserves,6);
  assert.equal(deposit.extractedToday,4);
  assert.equal(facility.workers,20);
  assert.equal(energy.available,76);
  assert.equal(game.resourceStocks.find(item=>item.goodId==='tools').quantity,4);

  const dailyLimit=send(game,host,'resource.extract',{
    stateId:territory.stateId,depositId:deposit.id,quantity:3
  });
  assert.equal(dailyLimit.accepted,false);
  assert.equal(dailyLimit.code,'RESOURCE_EXTRACTION_LIMIT');
  assert.equal(deposit.reserves,6);
  assert.equal(game.resourceStocks.find(item=>item.goodId==='tools').quantity,4);

  const nextDay=simulation.advanceDay(game);
  assert.equal(nextDay.ok,true,nextDay.error);
  assert.equal(game.worldDate,'1500-01-02');
  const currentDeposit=game.resourceDeposits.find(item=>item.id==='iron-deposit');
  const secondDay=send(game,host,'resource.extract',{
    stateId:territory.stateId,depositId:currentDeposit.id,quantity:6
  });
  assert.equal(secondDay.accepted,true,secondDay.error);
  assert.equal(game.resourceDeposits.find(item=>item.id==='iron-deposit').reserves,0);

  const exhausted=send(game,host,'resource.extract',{
    stateId:territory.stateId,depositId:currentDeposit.id,quantity:1
  });
  assert.equal(exhausted.accepted,false);
  assert.equal(exhausted.code,'RESOURCE_EXTRACTION_LIMIT');
  assert.equal(game.resourceDeposits.find(item=>item.id==='iron-deposit').reserves,0);
  assert.equal(game.resourceStocks.find(item=>item.goodId==='tools').quantity,10);
});

test('renewable deposits regenerate only to their configured reserve ceiling; minerals do not regenerate',()=>{
  const game=freshWorld();
  const {territory}=configureWorld(game);
  const renewable=game.resourceDeposits.find(item=>item.id==='timber-deposit');
  const mineral=game.resourceDeposits.find(item=>item.id==='iron-deposit');
  renewable.reserves=5;
  mineral.reserves=2;
  simulation.advanceDay(game);
  assert.equal(game.resourceDeposits.find(item=>item.id==='timber-deposit').reserves,6);
  assert.equal(game.resourceDeposits.find(item=>item.id==='iron-deposit').reserves,2);
  simulation.advanceDay(game);
  assert.equal(game.resourceDeposits.find(item=>item.id==='timber-deposit').reserves,7);
  assert.equal(game.resourceDeposits.find(item=>item.id==='iron-deposit').reserves,2);
  simulation.advanceDay(game);
  assert.equal(game.resourceDeposits.find(item=>item.id==='timber-deposit').reserves,7);
  assert.equal(game.resourceDeposits.find(item=>item.id==='iron-deposit').reserves,2);
  assert.ok(territory.stateId);
});

test('harvest respects the configured season, land area, soil, water, labour and seed stock',()=>{
  const game=freshWorld();
  configureWorld(game,{agriculture:true});
  startWorld(game);
  const day=simulation.advanceDay(game);
  assert.equal(day.ok,true,day.error);
  assert.equal(game.worldDate,'1500-01-02');
  assert.equal(game.harvestCycles.length,1);
  const harvest=game.harvestCycles[0];
  assert.equal(harvest.areaHectares,10);
  assert.equal(harvest.quantity,100);
  assert.equal(game.farms[0].seedStock,10);
  assert.equal(game.agriculturalLand[0].soilFertilityPercent,99);
  assert.equal(game.environmentalStates[0].soilFertilityPercent,99);
  assert.equal(game.resourceStocks.find(item=>item.goodId==='maize').quantity,100);

  simulation.advanceDay(game);
  assert.equal(game.harvestCycles.length,1,'a farm must not harvest a second time outside its calendar');
});

test('a drought affects only its configured province, records its damage once per world date and keeps environment dimensions separate',()=>{
  const game=freshWorld();
  const {province}=configureWorld(game,{disaster:true});
  startWorld(game);
  const otherProvince=game.provinces.find(item=>item.stateId!==game.territories[0].stateId);
  assert.equal(game.environmentalStates.find(item=>item.provinceId===province.id).waterAvailabilityPercent,100);
  assert.equal(game.environmentalStates.find(item=>item.provinceId===otherProvince.id).waterAvailabilityPercent,100);

  simulation.advanceDay(game);
  assert.equal(game.worldDate,'1500-01-02');
  const local=game.environmentalStates.find(item=>item.provinceId===province.id);
  const remote=game.environmentalStates.find(item=>item.provinceId===otherProvince.id);
  assert.equal(local.waterAvailabilityPercent,95);
  assert.equal(local.soilFertilityPercent,97.5);
  assert.equal(local.forestCoverPercent,98.75);
  assert.equal(remote.waterAvailabilityPercent,100);
  assert.equal(remote.soilFertilityPercent,100);
  assert.equal(game.resourceHistory.filter(item=>item.type==='disaster_impact').length,1);

  const repeated=resources.advanceDay(game);
  assert.equal(repeated.ok,true);
  assert.equal(game.environmentalStates.find(item=>item.provinceId===province.id).waterAvailabilityPercent,95);
  assert.equal(game.resourceHistory.filter(item=>item.type==='disaster_impact').length,1);
});

test('strategic food reserves are shown as protected data and are not automatically sold by the market',()=>{
  const game=freshWorld();
  configureWorld(game);
  const reserve=game.foodReserves[0];
  simulation.advanceDay(game);
  const after=game.foodReserves.find(item=>item.id===reserve.id);
  assert.equal(after.quantity,150);
  assert.equal(after.protectedQuantity,100);
  assert.equal(after.quality,95);
  assert.equal(game.resourceHistory.some(item=>item.type==='reserve_sale'),false);
});


test('failed extraction due to full storage rolls back energy, cash, stock, reserves and quality atomically',()=>{
  const game=freshWorld();
  const {territory,facility}=configureWorld(game);
  const host=game.players[0];
  startWorld(game);
  const deposit=game.resourceDeposits.find(item=>item.id==='iron-deposit');
  const good=game.goods.find(item=>item.id==='tools');
  const company=game.companies.find(item=>item.id===facility.companyId) ||
    game.companies.find(item=>item.stateId===territory.stateId);
  const balance=game.energyBalances.find(item=>item.stateId===territory.stateId);
  const cashBefore=company.cashBalances[company.currencyId];
  const energyBefore=balance.available;
  const reserveBefore=deposit.reserves;
  const qualityBefore=deposit.quality;
  good.storageCapacity=0;
  deposit.costPerUnit=10;

  const rejected=send(game,host,'resource.extract',{
    stateId:territory.stateId,depositId:deposit.id,quantity:2
  });
  assert.equal(rejected.accepted,false);
  assert.equal(rejected.code,'RESOURCE_STORAGE_FULL');
  assert.equal(game.resourceDeposits.find(item=>item.id===deposit.id).reserves,reserveBefore);
  assert.equal(game.resourceDeposits.find(item=>item.id===deposit.id).quality,qualityBefore);
  assert.equal(game.resourceStocks.length,0);
  assert.equal(game.energyBalances.find(item=>item.stateId===territory.stateId).available,energyBefore);
  assert.equal(company.cashBalances[company.currencyId],cashBefore);
  assert.equal(game.companies.find(item=>item.id===company.id).inventory.tools,0);
});


test('seasonal yield factors and available labour cap harvestable hectares before production is recorded',()=>{
  const game=freshWorld();
  configureWorld(game,{agriculture:true});
  game.worldDate='1500-07-01';
  game.cropDefinitions[0].harvestMonths=[7];
  game.farms[0].workers=5;
  game.farms[0].seedStock=100;
  startWorld(game);
  const result=simulation.advanceDay(game);
  assert.equal(result.ok,true,result.error);
  assert.equal(game.worldDate,'1500-07-02');
  assert.equal(game.harvestCycles.length,1);
  assert.equal(game.harvestCycles[0].areaHectares,5);
  assert.equal(game.harvestCycles[0].seasonalYieldFactor,0.5);
  assert.equal(game.harvestCycles[0].quantity,25);
  assert.equal(game.farms[0].seedStock,95);
});


test('water allocation respects ecological reserves, source quality, priority and same-day idempotency',()=>{
  const game=freshWorld();
  const territory=game.territories[0];
  const province=game.provinces.find(item=>item.stateId===territory.stateId);
  const configuration=baseConfiguration();
  configuration.waterSources.push({
    id:'river-a',stateId:territory.stateId,provinceId:province.id,
    type:'river',unit:'m3',stock:100,capacity:120,
    renewableInflowPerDay:5,maximumWithdrawalPerDay:100,
    environmentalReserve:30,qualityPercent:90
  });
  configuration.waterDemands.push(
    {id:'homes',stateId:territory.stateId,provinceId:province.id,
      targetType:'residential',unit:'m3',dailyDemand:60,priority:100,
      minimumQualityPercent:50},
    {id:'industry',stateId:territory.stateId,provinceId:province.id,
      targetType:'industrial',targetId:'factory-a',unit:'m3',
      dailyDemand:40,priority:50,minimumQualityPercent:50}
  );
  const validated=resources.validateConfiguration(game,configuration);
  assert.equal(validated.ok,true,validated.error);
  const saved=multiplayer.applyAdmin(game,'configure',{kind:'resources',configuration});
  assert.equal(saved.ok,true,saved.error);

  const first=resources.allocateWater(game,'1500-01-02');
  assert.equal(first.totalDemand,100);
  assert.equal(first.totalAllocated,75);
  assert.equal(game.waterAllocations.find(item=>item.demandId==='homes').allocated,60);
  assert.equal(game.waterAllocations.find(item=>item.demandId==='industry').allocated,15);
  assert.equal(game.waterSources[0].stock,30);
  assert.equal(game.waterBalances[0].withdrawn,75);
  assert.ok(game.waterHistory.some(item=>item.demandId==='industry' && item.shortage===25));

  const historyCount=game.waterHistory.length;
  const repeated=resources.allocateWater(game,'1500-01-02');
  assert.equal(repeated.replayed,true);
  assert.equal(game.waterSources[0].stock,30);
  assert.equal(game.waterHistory.length,historyCount);
});

test('water validation rejects an ecological reserve above physical stock and incompatible demand locations',()=>{
  const game=freshWorld();
  const territory=game.territories[0];
  const province=game.provinces.find(item=>item.stateId===territory.stateId);
  const configuration=baseConfiguration();
  configuration.waterSources.push({
    id:'lake-a',stateId:territory.stateId,provinceId:province.id,
    type:'lake',unit:'m3',stock:20,capacity:30,renewableInflowPerDay:0,
    maximumWithdrawalPerDay:10,environmentalReserve:25,qualityPercent:90
  });
  configuration.waterDemands.push({
    id:'residents-a',stateId:territory.stateId,provinceId:province.id,
    targetType:'residential',unit:'m3',dailyDemand:10,priority:50
  });
  const invalid=resources.validateConfiguration(game,configuration);
  assert.equal(invalid.ok,false);
  assert.match(invalid.error,/water source requires/i);
});


test('livestock, seasonal fisheries and forestry produce finite market goods through their NPC installations',()=>{
  const game=freshWorld();
  const territory=game.territories[0];
  const stateId=territory.stateId;
  const province=game.provinces.find(item=>item.stateId===stateId);
  const company=game.companies.find(item=>item.stateId===stateId);
  const facility=company.facilities[0];
  facility.workers=10;
  company.inventory ||= {};
  company.inventory.grain=1000;
  for(const [id,name] of [
    ['milk','Milk'],['meat','Meat'],['fish','Fish'],['timber','Timber']
  ]) game.goods.push({
    id,name,unit:'tonnes',category:'Resource',storageCapacity:10000
  });

  const configuration=baseConfiguration();
  configuration.resourceCatalog.push(
    {id:'milk-resource',name:'Milk',unit:'tonnes',category:'livestock',
      renewable:true,regenerationPerDay:0,goodId:'milk'},
    {id:'meat-resource',name:'Meat',unit:'tonnes',category:'livestock',
      renewable:true,regenerationPerDay:0,goodId:'meat'},
    {id:'fish-resource',name:'Fish',unit:'tonnes',category:'fishery',
      renewable:true,regenerationPerDay:0,goodId:'fish'},
    {id:'timber-resource',name:'Timber',unit:'m3',category:'forest',
      renewable:true,regenerationPerDay:0,goodId:'timber'}
  );
  configuration.agriculturalLand.push(
    {id:'pasture-a',stateId,provinceId:province.id,areaHectares:10,
      soilFertilityPercent:70,use:'pasture'},
    {id:'forest-a',stateId,provinceId:province.id,areaHectares:20,
      soilFertilityPercent:60,use:'forest'}
  );
  configuration.livestockSites.push({
    id:'dairy-farm-a',name:'North Dairy Cooperative',stateId,provinceId:province.id,
    companyId:company.id,facilityId:facility.id,pastureLandId:'pasture-a',
    pastureAreaHectares:10,animals:100,breedingStockMinimum:50,maximumHerd:120,
    animalsPerHectare:12,workersRequired:10,feedGoodId:'grain',
    feedPerAnimalPerDay:1,dailyProductGoodId:'milk',
    dailyProductPerFedAnimal:2,annualBirthsPerThousand:0,
    annualMortalityPerThousand:0,dailySlaughterLimit:10,
    meatGoodId:'meat',meatPerAnimal:3,diseaseSensitivityPercent:50
  });
  configuration.fishingGrounds.push({
    id:'north-fishing-ground',name:'North Coastal Fishing Ground',
    stateId,provinceId:province.id,companyId:company.id,facilityId:facility.id,
    outputGoodId:'fish',stock:95,stockCapacity:100,ecologicalReserve:20,
    dailyRegeneration:5,maximumCatchPerDay:40,sustainableCatchPerDay:20,
    workersRequired:5,catchPerWorkerPerDay:3,openMonths:[1,2,3],
    biodiversityLossPercentAtFullDepletion:10
  });
  configuration.forestAreas.push({
    id:'north-managed-forest',name:'North Managed Forest',
    stateId,provinceId:province.id,companyId:company.id,facilityId:facility.id,
    landId:'forest-a',areaHectares:20,outputGoodId:'timber',
    standingTimber:100,maximumTimber:120,ecologicalReserve:50,
    regenerationPerDay:5,maximumHarvestPerDay:30,sustainableHarvestPerDay:25,
    workersRequired:5,unitsPerWorkerPerDay:3,conservationPercent:10,
    forestCoverImpactPercentAtFullDepletion:20
  });
  configuration.environmentalStates.push(addEnvironmentalState(province.id));
  const validation=resources.validateConfiguration(game,configuration);
  assert.equal(validation.ok,true,validation.error);

  Object.assign(game,structuredClone(configuration));
  resources.ensure(game);
  game.worldDate='1500-01-02';
  const result=resources.advanceDay(game);
  assert.equal(result.ok,true,result.error);
  assert.equal(result.primaryProduction.length,3);

  const dairy=game.livestockSites[0];
  assert.equal(dairy.animals,90,'slaughtering must preserve the configured breeding stock minimum');
  assert.equal(dairy.workers,10);
  assert.equal(company.inventory.milk,200);
  assert.equal(company.inventory.meat,30);
  assert.equal(company.inventory.grain,900);

  const fishery=game.fishingGrounds[0];
  assert.equal(fishery.stock,80,'95 initial stock + 5 regeneration - 20 sustainable catch leaves 80 above the ecological reserve: '+JSON.stringify({
    stock:fishery.stock,record:game.primaryProductionCycles.find(item=>item.siteType==='fishery'),
    workers:facility.workers,ground:fishery
  }));
  assert.equal(company.inventory.fish,20);
  assert.equal(game.environmentalStates[0].biodiversityPercent,98);

  const forest=game.forestAreas[0];
  assert.equal(forest.standingTimber,80,'regeneration is followed by sustainable harvest above the ecological reserve');
  assert.equal(company.inventory.timber,25);
  assert.ok(Math.abs(game.environmentalStates[0].forestCoverPercent-96.66666666666667)<1e-9);
  assert.equal(new Set(game.primaryProductionCycles.map(item=>item.siteType)).size,3);
  assert.equal(game.primaryProductionCycles.find(item=>item.siteType==='livestock').quantity,200,
    'primary cycle quantity represents milk output only; meat is separately itemized');

  const inventory=structuredClone(company.inventory);
  const livestock=dairy.animals;
  const second=resources.advanceDay(game);
  assert.equal(second.replayed,true);
  assert.deepEqual(company.inventory,inventory);
  assert.equal(dairy.animals,livestock);
  assert.equal(game.primaryProductionCycles.length,3);
});
