(() => {
  'use strict';

  const configurationFields=Object.freeze([
    'resourceCatalog','resourceDeposits','agriculturalLand','cropDefinitions',
    'farms','climateZones','environmentalStates','disasters','energySources','foodReserves',
    'waterSources','waterDemands','livestockSites','fishingGrounds','forestAreas'
  ]);
  const arrayFields=Object.freeze([
    ...configurationFields,'resourceStocks','energyBalances','harvestCycles','resourceHistory',
    'waterBalances','waterAllocations','waterHistory','primaryProductionCycles'
  ]);
  const disasterTypes=new Set([
    'drought','flood','storm','wildfire','earthquake','pest','disease','other'
  ]);
  const clone=value=>structuredClone(value);
  const validDate=value=>{
    if(typeof value!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date=new Date(value+'T00:00:00Z');
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10)===value;
  };
  const validText=(value,min=2,max=100)=>
    typeof value==='string' && value.trim().length>=min &&
    value.length<=max && !/[<>\u0000-\u001f\u007f]/.test(value);
  const bounded=(value,min,max)=>Number.isFinite(Number(value)) &&
    Number(value)>=min && Number(value)<=max;
  const integer=(value,min=0,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(value) && value>=min && value<=max;
  const uniqueIds=items=>Array.isArray(items) &&
    items.every(item=>validText(item?.id,2,100)) &&
    new Set(items.map(item=>item.id)).size===items.length;
  const systemFor=(game,stateId)=>game.justiceSystems?.find(item=>item.stateId===stateId);

  function ensure(game) {
    if(!game || !Array.isArray(game.territories)) return game;
    for(const key of arrayFields)
      if(!Array.isArray(game[key])) game[key]=[];
    if(!Object.prototype.hasOwnProperty.call(game,'resourceCycleDate'))
      game.resourceCycleDate=null;
    if(!Object.prototype.hasOwnProperty.call(game,'resourceCycleResult'))
      game.resourceCycleResult=null;
    for(const site of game.livestockSites)
      if(!Number.isSafeInteger(site.initialAnimals)) site.initialAnimals=Number(site.animals)||0;
    for(const ground of game.fishingGrounds)
      if(!Number.isSafeInteger(ground.initialStock)) ground.initialStock=Number(ground.stock)||0;
    for(const forest of game.forestAreas)
      if(!Number.isSafeInteger(forest.initialStandingTimber))
        forest.initialStandingTimber=Number(forest.standingTimber)||0;
    for(const deposit of game.resourceDeposits)
      if(!Number.isSafeInteger(deposit.initialReserves))
        deposit.initialReserves=Number(deposit.reserves)||0;
    for(const source of game.waterSources)
      if(!Number.isSafeInteger(source.initialStock))
        source.initialStock=Number(source.stock)||0;
    for(const land of game.agriculturalLand)
      if(!Number.isSafeInteger(land.initialSoilFertilityPercent))
        land.initialSoilFertilityPercent=Number(land.soilFertilityPercent)||0;
    for(const farm of game.farms)
      if(!Number.isSafeInteger(farm.initialSeedStock))
        farm.initialSeedStock=Number(farm.seedStock)||0;
    for(const environment of game.environmentalStates) {
      for(const key of ['forestCoverPercent','pollutionIndex','biodiversityPercent',
        'soilErosionPercent','soilFertilityPercent','groundwaterLevelPercent']) {
        const initialKey='initial'+key[0].toUpperCase()+key.slice(1);
        if(!Object.prototype.hasOwnProperty.call(environment,initialKey))
          environment[initialKey]=Number(environment[key])||0;
      }
    }
    return game;
  }

  function lawIsActive(game,stateId,lawId) {
    const law=(game.politicalSystems || []).find(item=>item.stateId===stateId)
      ?.laws?.find(item=>item.id===lawId);
    if(!law || !['enacted','active'].includes(String(law.status || '').toLowerCase()) ||
       !validDate(law.effectiveFrom) || !validDate(game.worldDate) ||
       law.effectiveFrom>game.worldDate) return false;
    return !law.repealedOn || (validDate(law.repealedOn) && law.repealedOn>game.worldDate);
  }

  function validateConfiguration(game,configuration) {
    if(!configuration || configurationFields.some(key=>!Array.isArray(configuration[key])))
      return {ok:false,error:'The environmental scenario requires every resource and climate data array.'};
    const provinces=new Map((game.provinces || []).map(item=>[item.id,item.stateId]));
    const goods=new Set((game.goods || []).map(item=>item.id));
    const states=new Set((game.territories || []).map(item=>item.stateId));
    const political=new Map((game.politicalSystems || []).map(item=>[item.stateId,item]));
    for(const key of configurationFields) {
      if(key==='environmentalStates') continue;
      if(!uniqueIds(configuration[key]))
        return {ok:false,error:'IDs in '+key+' must be unique and stable.'};
    }

    const resources=new Map(configuration.resourceCatalog.map(item=>[item.id,item]));
    const companies=new Map((game.companies || []).map(item=>[item.id,item]));
    const installations=new Map();
    for(const company of game.companies || [])
      for(const facility of company.facilities || [])
        installations.set(JSON.stringify([company.id,facility.id]),{company,facility});
    for(const resource of configuration.resourceCatalog) {
      if(!validText(resource.name) || !validText(resource.unit,1,30) ||
         !['agriculture','livestock','fishery','forest','mineral','water','fuel','other'].includes(resource.category) ||
         typeof resource.renewable!=='boolean' ||
         !bounded(resource.regenerationPerDay ?? 0,0,1000000000) ||
         !goods.has(resource.goodId))
        return {ok:false,error:'A resource definition has an invalid name, unit, category, regeneration or market good.'};
      if(!resource.renewable && Number(resource.regenerationPerDay||0)!==0)
        return {ok:false,error:'A non-renewable resource cannot regenerate.'};
    }

    for(const deposit of configuration.resourceDeposits) {
      const politicalState=political.get(deposit.stateId);
      const offices=new Set((politicalState?.offices || []).map(item=>item.id));
      const catalog=resources.get(deposit.resourceId);
      if(!states.has(deposit.stateId) || provinces.get(deposit.provinceId)!==deposit.stateId ||
         !catalog || !integer(deposit.reserves,0,Number.MAX_SAFE_INTEGER) ||
         !integer(deposit.maximumExtractionPerDay,1,Number.MAX_SAFE_INTEGER) ||
         !bounded(deposit.quality,0,100) || typeof deposit.accessible!=='boolean' ||
         !validText(deposit.facilityId,2,100) ||
         !integer(deposit.requiredWorkers,1,1000000) ||
         !bounded(deposit.energyPerUnit ?? 0,0,1000000) ||
         !validText(deposit.extractionLawId,2,100) ||
         !Array.isArray(deposit.extractionOfficeIds) || !deposit.extractionOfficeIds.length ||
         deposit.extractionOfficeIds.some(id=>!offices.has(id)))
        return {ok:false,error:'A resource deposit lacks valid reserves, province, installation, workers, energy, extraction law or permit authority.'};
      const installationExists=(game.companies || []).some(company=>
        company.stateId===deposit.stateId &&
        (company.facilities || []).some(facility=>facility.id===deposit.facilityId));
      if(!installationExists)
        return {ok:false,error:'A resource deposit must reference a real installation in the same State.'};
      if(!lawIsActive(game,deposit.stateId,deposit.extractionLawId))
        return {ok:false,error:'A resource deposit must reference a valid extraction law currently in force in the same State.'};
      if(deposit.reserveCapacity!==undefined &&
         !integer(deposit.reserveCapacity,deposit.reserves,Number.MAX_SAFE_INTEGER))
        return {ok:false,error:'A renewable deposit reserveCapacity must be at least its starting reserves.'};
      if(deposit.sustainableExtractionPerDay!==undefined &&
         !integer(deposit.sustainableExtractionPerDay,0,deposit.maximumExtractionPerDay))
        return {ok:false,error:'A sustainable extraction limit must be between zero and daily capacity.'};
      if(deposit.costPerUnit!==undefined && !bounded(deposit.costPerUnit,0,Number.MAX_SAFE_INTEGER))
        return {ok:false,error:'Resource extraction cost must be non-negative.'};
      if(deposit.qualityDepletionPerUnit!==undefined && !bounded(deposit.qualityDepletionPerUnit,0,100))
        return {ok:false,error:'Quality depletion per unit must be between zero and 100.'};
    }

    for(const land of configuration.agriculturalLand) {
      if(!states.has(land.stateId) || provinces.get(land.provinceId)!==land.stateId ||
         !integer(land.areaHectares,1,Number.MAX_SAFE_INTEGER) ||
         !bounded(land.soilFertilityPercent,0,100) ||
         !['arable','pasture','forest','wetland','water','urban','other'].includes(land.use))
        return {ok:false,error:'Agricultural land has an invalid State, province, area, soil or use.'};
    }

    const crops=new Map(configuration.cropDefinitions.map(item=>[item.id,item]));
    for(const crop of configuration.cropDefinitions) {
      if(!validText(crop.name) || !goods.has(crop.outputGoodId) ||
         !Array.isArray(crop.harvestMonths) || !crop.harvestMonths.length ||
         crop.harvestMonths.some(month=>!integer(month,1,12)) ||
         new Set(crop.harvestMonths).size!==crop.harvestMonths.length ||
         !integer(crop.harvestDayOfMonth,1,28) ||
         !bounded(crop.yieldPerHectare,0.001,1000000000) ||
         !bounded(crop.seedUsePerHectare,0,1000000000) ||
         !bounded(crop.workersPerHectare,0.001,1000000) ||
         !bounded(crop.soilDepletionPercentPerHarvest ?? 0,0,100) ||
         !bounded(crop.minimumWaterPercent ?? 0,0,100))
        return {ok:false,error:'A crop needs a market output, harvest calendar, yield, seed, labour and soil parameters.'};
      if(crop.seedGoodId && !goods.has(crop.seedGoodId))
        return {ok:false,error:'A crop references an unknown seed good.'};
    }

    const landById=new Map(configuration.agriculturalLand.map(item=>[item.id,item]));
    const occupied=new Map();
    for(const farm of configuration.farms) {
      const land=landById.get(farm.landId);
      const crop=crops.get(farm.cropId);
      if(!land || !crop || farm.stateId!==land.stateId ||
         provinces.get(farm.provinceId)!==farm.stateId || farm.provinceId!==land.provinceId ||
         land.use!=='arable' || !integer(farm.areaHectares,1,land.areaHectares) ||
         !integer(farm.workers,0,100000000) ||
         !integer(farm.seedStock,0,Number.MAX_SAFE_INTEGER) ||
         !bounded(farm.toolsEfficiencyPercent,0,200) ||
         !bounded(farm.infrastructureEfficiencyPercent,0,200))
        return {ok:false,error:'A farm references invalid land, crop, workers, seed stock or operating efficiency.'};
      occupied.set(land.id,(occupied.get(land.id)||0)+farm.areaHectares);
    }
    for(const [landId,area] of occupied)
      if(area>landById.get(landId).areaHectares)
        return {ok:false,error:'Farmed area cannot exceed the available arable land parcel.'};

    const climateProvinceIds=new Set();
    for(const zone of configuration.climateZones) {
      if(!validText(zone.name) || !Array.isArray(zone.provinceIds) ||
         !zone.provinceIds.length || zone.provinceIds.some(id=>!provinces.has(id)) ||
         zone.provinceIds.some(id=>climateProvinceIds.has(id)) ||
         !Array.isArray(zone.seasons) || !zone.seasons.length ||
         !bounded(zone.droughtExposurePercent,0,100))
        return {ok:false,error:'A climate zone has an invalid name, province coverage or season definition.'};
      const months=new Set();
      for(const season of zone.seasons) {
        if(!validText(season.name) || !Array.isArray(season.months) ||
           !season.months.length || season.months.some(month=>!integer(month,1,12)) ||
           season.months.some(month=>months.has(month)) ||
           !bounded(season.yieldFactor,0,3) || !bounded(season.waterFactor,0,3))
          return {ok:false,error:'Climate seasons need unique months and configured yield/water factors.'};
        for(const month of season.months) months.add(month);
      }
      if(months.size!==12)
        return {ok:false,error:'Climate zones must define exactly one season for every month.'};
      zone.provinceIds.forEach(id=>climateProvinceIds.add(id));
    }

    const environmentProvinceIds=new Set();
    for(const environment of configuration.environmentalStates) {
      if(!provinces.has(environment.provinceId) ||
         environmentProvinceIds.has(environment.provinceId) ||
         !['soilFertilityPercent','waterAvailabilityPercent','forestCoverPercent',
           'biodiversityPercent','pollutionIndex'].every(key=>bounded(environment[key],0,100)))
        return {ok:false,error:'Environmental state needs unique province coverage and separate values for soil, water, forest, biodiversity and pollution.'};
      environmentProvinceIds.add(environment.provinceId);
    }
    for(const farm of configuration.farms) {
      if(!climateProvinceIds.has(farm.provinceId) || !environmentProvinceIds.has(farm.provinceId))
        return {ok:false,error:'Every farm requires a configured climate zone and environmental measurements for its province.'};
    }
    for(const disaster of configuration.disasters) {
      const affectedStates=new Set((disaster.provinceIds || []).map(id=>provinces.get(id)));
      if(!disasterTypes.has(disaster.type) || !Array.isArray(disaster.provinceIds) ||
         !disaster.provinceIds.length || disaster.provinceIds.some(id=>!provinces.has(id)) ||
         affectedStates.size!==1 ||
         disaster.provinceIds.some(id=>!environmentProvinceIds.has(id)) ||
         (disaster.type==='drought' && disaster.provinceIds.some(id=>!climateProvinceIds.has(id))) ||
         !validDate(disaster.startDate) || !integer(disaster.durationDays,1,3650) ||
         !bounded(disaster.intensityPercent,0,100) ||
         !bounded(disaster.cropLossPercent ?? 0,0,100) ||
         !bounded(disaster.waterLossPercentPerDay ?? 0,0,100) ||
         !bounded(disaster.soilLossPercentPerDay ?? 0,0,100) ||
         !bounded(disaster.forestLossPercentPerDay ?? 0,0,100) ||
         !bounded(disaster.forestStockLossPercentPerDay ?? 0,0,100) ||
         !bounded(disaster.livestockLossPercentPerDay ?? 0,0,100) ||
         !bounded(disaster.pollutionIncreasePerDay ?? 0,0,100))
        return {ok:false,error:'A disaster needs a supported type, affected provinces, duration and bounded impacts.'};
    }
    for(const source of configuration.energySources) {
      if(!states.has(source.stateId) || !provinces.has(source.provinceId) ||
         provinces.get(source.provinceId)!==source.stateId ||
         !bounded(source.capacityPerDay,0,Number.MAX_SAFE_INTEGER) ||
         !bounded(source.productionPercent,0,100) ||
         !bounded(source.consumptionPerDay,0,Number.MAX_SAFE_INTEGER) ||
         !bounded(source.lossPercent,0,100))
        return {ok:false,error:'An energy source has invalid location, capacity, output, consumption or loss.'};
    }
    for(const reserve of configuration.foodReserves) {
      if(!states.has(reserve.stateId) || !goods.has(reserve.goodId) ||
         !integer(reserve.quantity,0,Number.MAX_SAFE_INTEGER) ||
         !integer(reserve.protectedQuantity,0,reserve.quantity) ||
         !bounded(reserve.quality,0,100))
        return {ok:false,error:'A food or strategic reserve has invalid goods, quantities or quality.'};
    }
    const validateInstallation=(site,label)=>{
      const company=companies.get(site.companyId);
      const linked=installations.get(JSON.stringify([site.companyId,site.facilityId]));
      if(!company || company.stateId!==site.stateId ||
         !linked || linked.facility.operational===false ||
         company.currencyId!==game.territories.find(item=>item.stateId===site.stateId)?.currencyId)
        return {ok:false,error:'A '+label+' must link to an operational NPC company installation with the same State currency.'};
      return {ok:true,company,facility:linked.facility};
    };
    for(const site of configuration.livestockSites) {
      const land=landById.get(site.pastureLandId);
      const installation=validateInstallation(site,'livestock site');
      if(!states.has(site.stateId) || provinces.get(site.provinceId)!==site.stateId ||
         !land || land.stateId!==site.stateId || land.provinceId!==site.provinceId ||
         land.use!=='pasture' || !installation.ok || !validText(site.name) ||
         !integer(site.pastureAreaHectares,1,land.areaHectares) ||
         !bounded(site.animalsPerHectare,0.001,1000000) ||
         !integer(site.animals,0) || !integer(site.breedingStockMinimum,0,site.animals) ||
         !integer(site.maximumHerd,site.animals) ||
         site.animals>site.pastureAreaHectares*site.animalsPerHectare ||
         !integer(site.workersRequired,1) ||
         !validText(site.feedGoodId,2,100) || !goods.has(site.feedGoodId) ||
         !bounded(site.feedPerAnimalPerDay,0,1000000) ||
         !validText(site.dailyProductGoodId,2,100) || !goods.has(site.dailyProductGoodId) ||
         !resources.has([...resources.values()].find(item=>item.goodId===site.dailyProductGoodId &&
           item.category==='livestock')?.id) ||
         !bounded(site.dailyProductPerFedAnimal,0,1000000) ||
         !integer(site.annualBirthsPerThousand,0,1000) ||
         !integer(site.annualMortalityPerThousand,0,1000) ||
         !integer(site.dailySlaughterLimit,0,1000000) ||
         !validText(site.meatGoodId,2,100) || !goods.has(site.meatGoodId) ||
         (site.dailySlaughterLimit>0 && ![...resources.values()].some(item=>
           item.goodId===site.meatGoodId && item.category==='livestock')) ||
         !bounded(site.meatPerAnimal,0,1000000) ||
         !bounded(site.diseaseSensitivityPercent ?? 0,0,100))
        return {ok:false,error:'A livestock site needs pasture, an NPC installation, a viable herd, breeding reserve, feed, products, workers and annual reproduction/mortality rates.'};
      occupied.set(land.id,(occupied.get(land.id)||0)+site.pastureAreaHectares);
    }
    for(const ground of configuration.fishingGrounds) {
      const installation=validateInstallation(ground,'fishing ground');
      if(!states.has(ground.stateId) || provinces.get(ground.provinceId)!==ground.stateId ||
         !installation.ok || !validText(ground.name) ||
         !validText(ground.outputGoodId,2,100) || !goods.has(ground.outputGoodId) ||
         ![...resources.values()].some(item=>item.goodId===ground.outputGoodId && item.category==='fishery') ||
         !integer(ground.stock,0) || !integer(ground.stockCapacity,ground.stock) ||
         !integer(ground.ecologicalReserve,0,ground.stock) ||
         !integer(ground.dailyRegeneration,0) ||
         !integer(ground.maximumCatchPerDay,0) ||
         !integer(ground.sustainableCatchPerDay,0,ground.maximumCatchPerDay) ||
         !integer(ground.workersRequired,1) ||
         !integer(ground.catchPerWorkerPerDay,0) ||
         !Array.isArray(ground.openMonths) || !ground.openMonths.length ||
         ground.openMonths.some(month=>!integer(month,1,12)) ||
         new Set(ground.openMonths).size!==ground.openMonths.length ||
         !bounded(ground.biodiversityLossPercentAtFullDepletion ?? 0,0,100))
        return {ok:false,error:'A fishing ground needs a local NPC installation, finite stock, ecological reserve, regeneration, sustainable catch, labour, output and a seasonal calendar.'};
    }
    for(const forest of configuration.forestAreas) {
      const land=landById.get(forest.landId);
      const installation=validateInstallation(forest,'forest area');
      if(!states.has(forest.stateId) || provinces.get(forest.provinceId)!==forest.stateId ||
         !land || land.stateId!==forest.stateId || land.provinceId!==forest.provinceId ||
         land.use!=='forest' || !installation.ok || !validText(forest.name) ||
         !integer(forest.areaHectares,1,land.areaHectares) ||
         !validText(forest.outputGoodId,2,100) || !goods.has(forest.outputGoodId) ||
         ![...resources.values()].some(item=>item.goodId===forest.outputGoodId && item.category==='forest') ||
         !integer(forest.standingTimber,0) || !integer(forest.maximumTimber,forest.standingTimber) ||
         !integer(forest.ecologicalReserve,0,forest.standingTimber) ||
         !integer(forest.regenerationPerDay,0) ||
         !integer(forest.maximumHarvestPerDay,0) ||
         !integer(forest.sustainableHarvestPerDay,0,forest.maximumHarvestPerDay) ||
         !integer(forest.workersRequired,1) ||
         !integer(forest.unitsPerWorkerPerDay,0) ||
         !bounded(forest.conservationPercent,0,100) ||
         !bounded(forest.forestCoverImpactPercentAtFullDepletion ?? 0,0,100))
        return {ok:false,error:'A forest area needs a mapped forest parcel, NPC installation, standing timber, ecological reserve, regeneration, sustainable harvest, labour and conservation settings.'};
      occupied.set(land.id,(occupied.get(land.id)||0)+forest.areaHectares);
    }
    for(const [landId,area] of occupied)
      if(area>landById.get(landId).areaHectares)
        return {ok:false,error:'Farm, pasture and forest site allocations cannot exceed the physical land parcel area.'};
    const waterSources=new Map(configuration.waterSources.map(item=>[item.id,item]));
    for(const source of configuration.waterSources) {
      if(!states.has(source.stateId) || provinces.get(source.provinceId)!==source.stateId ||
         !['river','lake','aquifer','reservoir'].includes(source.type) ||
         !validText(source.unit,1,24) ||
         !integer(source.stock,0) || !integer(source.capacity,source.stock) ||
         !integer(source.renewableInflowPerDay,0) ||
         !integer(source.maximumWithdrawalPerDay,0) ||
         !integer(source.environmentalReserve,0,source.stock) ||
         !bounded(source.qualityPercent,0,100))
        return {ok:false,error:'A water source requires a province, physical unit, finite stock, replenishment, withdrawal limit, ecological reserve and water quality.'};
    }
    for(const demand of configuration.waterDemands) {
      const localSources=configuration.waterSources.filter(item=>
        item.stateId===demand.stateId && item.provinceId===demand.provinceId);
      if(!states.has(demand.stateId) || provinces.get(demand.provinceId)!==demand.stateId ||
         !['residential','agriculture','public_service','industrial','other'].includes(demand.targetType) ||
         !integer(demand.dailyDemand,0) || !integer(demand.priority,1,100) ||
         !validText(demand.unit,1,24) ||
         !localSources.some(item=>item.unit===demand.unit) ||
         (demand.targetType==='agriculture' &&
          !(configuration.farms || []).some(item=>item.id===demand.targetId &&
            item.stateId===demand.stateId && item.provinceId===demand.provinceId)) ||
         (demand.targetType!=='residential' && !validText(demand.targetId,2,100)) ||
         (demand.sourceIds!==undefined &&
          (!Array.isArray(demand.sourceIds) || !demand.sourceIds.length ||
           demand.sourceIds.some(id=>!waterSources.has(id) ||
             waterSources.get(id).stateId!==demand.stateId ||
             waterSources.get(id).provinceId!==demand.provinceId ||
             waterSources.get(id).unit!==demand.unit))) ||
         !bounded(demand.minimumQualityPercent ?? 0,0,100))
        return {ok:false,error:'A water demand must reference a compatible local source, target, unit, daily quantity and priority.'};
    }
    return {ok:true,error:null};
  }

  function history(game,stateId,type,description,details={},createId) {
    const sequence=(Number(game.eventSequence)||0)+1;
    game.resourceHistory.push({
      id:(typeof createId==='function'?createId(): 'resource-'+game.id+'-'+sequence),
      stateId,type,description,details:clone(details),worldDate:game.worldDate,
      sequence
    });
    if(game.resourceHistory.length>3000)
      game.resourceHistory.splice(0,game.resourceHistory.length-3000);
    game.events ||= [];
    game.eventSequence=sequence;
    game.events.push({
      id:'resource-event-'+game.eventSequence,gameId:game.id,orderId:null,
      stateId,type:'resource.'+type,actorPlayerId:details.actorPlayerId || null,
      resultCode:null,worldDate:game.worldDate,worldVersion:Number(game.worldVersion||0)+1,
      occurredAtUtc:new Date().toISOString(),description,sequence:game.eventSequence
    });
    if(game.events.length>1000) game.events.splice(0,game.events.length-1000);
    game.activity ||= [];
    game.activity.unshift(description);
    game.activity=game.activity.slice(0,100);
  }

  function addStock(game,stateId,goodId,quantity,createId,preferredCompanyId=null) {
    if(quantity<=0) return 0;
    const good=game.goods.find(item=>item.id===goodId);
    if(!good) throw new Error('The produced resource has no configured market good.');
    const stock=game.resourceStocks.find(item=>item.stateId===stateId && item.goodId===goodId);
    const entry=stock || {id:createId(),stateId,goodId,quantity:0,updatedOn:game.worldDate};
    if(!stock) game.resourceStocks.push(entry);
    const existingCompanies=(game.companies || []).filter(company=>company.stateId===stateId);
    const currentInventory=existingCompanies.reduce((sum,company)=>
      sum+Math.max(0,Number(company.inventory?.[goodId])||0),0);
    const configuredCapacity=Number(good.storageCapacity);
    const capacity=Number.isFinite(configuredCapacity)?Math.max(0,configuredCapacity):Number.MAX_SAFE_INTEGER;
    const accepted=Math.max(0,Math.min(quantity,capacity-currentInventory));
    entry.quantity+=accepted;
    entry.updatedOn=game.worldDate;
    if(accepted>0) {
      const preferred=preferredCompanyId
        ? existingCompanies.find(item=>item.id===preferredCompanyId) : null;
      const company=preferred || existingCompanies.find(item=>
        /agriculture|forestry|mining|fishing|water|energy|resource/i.test(String(item.sector||''))) ||
        existingCompanies[0];
      if(company) {
        company.inventory ||= {};
        company.inventory[goodId]=(Number(company.inventory[goodId])||0)+accepted;
      }
    }
    return accepted;
  }

  function yearDays(year) {
    return year%4===0 && (year%100!==0 || year%400===0)?366:365;
  }

  function companyFacility(game,companyId,facilityId,stateId) {
    const company=(game.companies || []).find(item=>
      item.id===companyId && item.stateId===stateId);
    const facility=company?.facilities?.find(item=>item.id===facilityId);
    return company && facility?{company,facility}:null;
  }

  function recordPrimaryCycle(game,site,type,quantity,details,cycles) {
    const row={
      id:'primary-'+type+'-'+site.id+'-'+game.worldDate,
      siteId:site.id,siteType:type,stateId:site.stateId,provinceId:site.provinceId,
      quantity,outputGoodId:details.outputGoodId||null,
      workers:details.workers||0,worldDate:game.worldDate,...details
    };
    cycles.push(row);
    history(game,site.stateId,type+'_production',
      site.name+' produced '+quantity+' '+(details.outputGoodId||'units')+'.',
      {siteId:site.id,provinceId:site.provinceId,quantity,...details});
    return row;
  }

  function seasonFor(game,provinceId,date) {
    const month=Number(date.slice(5,7));
    const zone=(game.climateZones || []).find(item=>item.provinceIds.includes(provinceId));
    const season=zone?.seasons.find(item=>item.months.includes(month));
    return {zone,season,month};
  }

  function activeDisasters(game,provinceId,date) {
    const epoch=Date.parse(date+'T00:00:00Z');
    return (game.disasters || []).filter(disaster=>{
      if(!disaster.provinceIds.includes(provinceId)) return false;
      const start=Date.parse(disaster.startDate+'T00:00:00Z');
      return epoch>=start && epoch<start+disaster.durationDays*86400000;
    });
  }

  function consumeEnergy(game,stateId,quantity) {
    let remaining=quantity;
    for(const balance of game.energyBalances.filter(item=>item.stateId===stateId)) {
      const taken=Math.min(remaining,Math.max(0,Number(balance.available)||0));
      balance.available-=taken;
      balance.used=(Number(balance.used)||0)+taken;
      remaining-=taken;
      if(remaining<=1e-9) return true;
    }
    return remaining<=1e-9;
  }

  function applyOrder(game,player,membership,order,createId) {
    if(!String(order?.type || '').startsWith('resource.')) return null;
    ensure(game);
    if(order.type!=='resource.extract')
      return {ok:false,code:'RESOURCE_ORDER_UNSUPPORTED',error:'This resource action is not supported.'};
    const stateId=membership?.stateId;
    const deposit=game.resourceDeposits.find(item=>
      item.id===order.depositId && item.stateId===stateId);
    if(!deposit || !deposit.accessible)
      return {ok:false,code:'RESOURCE_DEPOSIT_UNAVAILABLE',error:'The selected deposit is not accessible in this State.'};
    if(!lawIsActive(game,stateId,deposit.extractionLawId))
      return {ok:false,code:'RESOURCE_PERMIT_REQUIRED',error:'Extraction requires a law currently in force in this State.'};
    const held=new Set(((game.politicalSystems || []).find(item=>item.stateId===stateId)?.offices || [])
      .filter(item=>item.holderPlayerId===player.id).map(item=>item.id));
    if(!deposit.extractionOfficeIds.some(id=>held.has(id)))
      return {ok:false,code:'RESOURCE_PERMIT_REQUIRED',error:'The player does not hold a configured office authorized for extraction.'};
    const facility=game.companies.flatMap(company=>(company.facilities || [])
      .map(item=>({...item,companyId:company.id,companyStateId:company.stateId,currencyId:company.currencyId})))
      .find(item=>item.id===deposit.facilityId && item.companyStateId===stateId);
    if(!facility || facility.operational===false ||
       Number(facility.workers ?? deposit.workers ?? 0)<deposit.requiredWorkers)
      return {ok:false,code:'RESOURCE_INSTALLATION_REQUIRED',error:'An operational installation with the required workforce is needed.'};
    if(deposit.requiredTechnologyId &&
       !(game.technologyUnlocks || []).some(item=>
         item.stateId===stateId && item.technologyId===deposit.requiredTechnologyId))
      return {ok:false,code:'RESOURCE_TECHNOLOGY_REQUIRED',error:'The required extraction technology has not been unlocked.'};
    const extractedToday=deposit.lastExtractionOn===game.worldDate
      ? Number(deposit.extractedToday)||0 : 0;
    const remainingDaily=Math.max(0,deposit.maximumExtractionPerDay-extractedToday);
    const dailyLimit=deposit.sustainableExtractionPerDay===undefined
      ? remainingDaily : Math.min(remainingDaily,deposit.sustainableExtractionPerDay-extractedToday);
    const quantity=order.quantity;
    if(!integer(quantity,1,Number.MAX_SAFE_INTEGER) ||
       quantity>dailyLimit || quantity>deposit.reserves)
      return {ok:false,code:'RESOURCE_EXTRACTION_LIMIT',error:'The extraction quantity exceeds the remaining daily or geological reserve limit.'};
    const energy=quantity*Number(deposit.energyPerUnit||0);
    const energyAvailable=game.energyBalances.filter(item=>item.stateId===stateId)
      .reduce((sum,item)=>sum+Math.max(0,Number(item.available)||0),0);
    if(energy>energyAvailable)
      return {ok:false,code:'RESOURCE_ENERGY_UNAVAILABLE',error:'The State does not have enough available energy for this extraction.'};
    const cost=quantity*Number(deposit.costPerUnit||0);
    const company=game.companies.find(item=>item.id===facility.companyId);
    const currencyId=company?.currencyId;
    if(cost>0 && (!company || Number(company.cashBalances?.[currencyId]||0)<cost))
      return {ok:false,code:'RESOURCE_FUNDS_UNAVAILABLE',error:'The installation cannot cover the configured extraction cost.'};
    const energySnapshot=game.energyBalances.filter(item=>item.stateId===stateId)
      .map(item=>({id:item.id,available:item.available,used:item.used}));
    if(energy>0 && !consumeEnergy(game,stateId,energy))
      return {ok:false,code:'RESOURCE_ENERGY_UNAVAILABLE',error:'The State does not have enough available energy for this extraction.'};
    if(cost>0) company.cashBalances[currencyId]-=cost;
    const resource=game.resourceCatalog.find(item=>item.id===deposit.resourceId);
    const goodId=resource.goodId;
    const stockSnapshot=clone(game.resourceStocks);
    const inventorySnapshot=new Map(game.companies.filter(item=>item.stateId===stateId)
      .map(item=>[item.id,clone(item.inventory || {})]));
    const accepted=addStock(game,stateId,goodId,quantity,createId);
    if(accepted!==quantity) {
      game.resourceStocks=stockSnapshot;
      for(const item of game.companies.filter(entry=>entry.stateId===stateId)) {
        if(inventorySnapshot.has(item.id)) item.inventory=inventorySnapshot.get(item.id);
      }
      for(const saved of energySnapshot) {
        const balance=game.energyBalances.find(item=>item.id===saved.id);
        if(balance) {balance.available=saved.available;balance.used=saved.used;}
      }
      if(cost>0) company.cashBalances[currencyId]+=cost;
      return {ok:false,code:'RESOURCE_STORAGE_FULL',error:'Configured storage cannot hold the requested extraction.'};
    }
    deposit.reserves-=quantity;
    deposit.extractedToday=extractedToday+quantity;
    deposit.lastExtractionOn=game.worldDate;
    deposit.quality=Math.max(0,deposit.quality-quantity*Number(deposit.qualityDepletionPerUnit||0));
    const environment=game.environmentalStates.find(item=>item.provinceId===deposit.provinceId);
    if(environment) {
      environment.pollutionIndex=Math.min(100,environment.pollutionIndex+
        quantity*Number(deposit.pollutionIncreasePerUnit||0));
      environment.biodiversityPercent=Math.max(0,environment.biodiversityPercent-
        quantity*Number(deposit.biodiversityLossPerUnit||0));
      environment.updatedOn=game.worldDate;
    }
    history(game,stateId,'extraction_completed',
      quantity+' '+resource.unit+' '+resource.name+' extracted at '+deposit.provinceId+'.',
      {depositId:deposit.id,resourceId:resource.id,quantity,goodId,actorPlayerId:player.id},createId);
    return {ok:true,quantity,goodId};
  }

  function allocateWater(game,date=game.worldDate) {
    if(game.waterAllocationDate===date) {
      const existing=game.waterAllocations || [];
      return {ok:true,sourceCount:(game.waterBalances || []).filter(item=>item.worldDate===date).length,
        demandCount:existing.length,totalDemand:existing.reduce((sum,item)=>sum+Number(item.demand||0),0),
        totalAllocated:existing.reduce((sum,item)=>sum+Number(item.allocated||0),0),replayed:true};
    }
    const sourceState=new Map();
    for(const source of (game.waterSources || []).slice().sort((a,b)=>a.id.localeCompare(b.id))) {
      const openingStock=Number(source.stock)||0;
      const replenished=Math.min(Number(source.capacity),openingStock+Number(source.renewableInflowPerDay||0));
      source.stock=replenished;
      sourceState.set(source.id,{
        source,openingStock,replenished,remaining:Math.min(
          Number(source.maximumWithdrawalPerDay),
          Math.max(0,replenished-Number(source.environmentalReserve))
        ),withdrawn:0
      });
    }
    const allocations=[];
    const demands=(game.waterDemands || []).slice().sort((a,b)=>
      b.priority-a.priority || a.id.localeCompare(b.id));
    for(const demand of demands) {
      let remaining=Number(demand.dailyDemand);
      let allocated=0;
      const sourceRows=[];
      const eligible=(demand.sourceIds?.length
        ? demand.sourceIds.map(id=>sourceState.get(id)).filter(Boolean)
        : [...sourceState.values()].filter(item=>
            item.source.stateId===demand.stateId &&
            item.source.provinceId===demand.provinceId &&
            item.source.unit===demand.unit))
        .filter(item=>Number(item.source.qualityPercent)>=Number(demand.minimumQualityPercent||0))
        .sort((a,b)=>a.source.id.localeCompare(b.source.id));
      for(const row of eligible) {
        if(remaining<=0) break;
        const supplied=Math.min(remaining,row.remaining);
        if(supplied<=0) continue;
        row.remaining-=supplied;
        row.withdrawn+=supplied;
        remaining-=supplied;
        allocated+=supplied;
        sourceRows.push({sourceId:row.source.id,quantity:supplied});
      }
      const record={
        id:'water-allocation-'+date+'-'+demand.id,demandId:demand.id,
        stateId:demand.stateId,provinceId:demand.provinceId,targetType:demand.targetType,
        targetId:demand.targetId||null,unit:demand.unit,demand:Number(demand.dailyDemand),
        allocated,shortage:remaining,
        coveragePercent:demand.dailyDemand>0
          ? Math.round(allocated/Number(demand.dailyDemand)*10000)/100 : 100,
        sourceAllocations:sourceRows,priority:demand.priority,worldDate:date
      };
      allocations.push(record);
      if(remaining>0) {
        history(game,demand.stateId,'water_shortage',
          'Water demand '+demand.id+' received '+allocated+' of '+demand.dailyDemand+' '+demand.unit+'.',
          {demandId:demand.id,provinceId:demand.provinceId,targetType:demand.targetType,
           targetId:demand.targetId||null,demand:demand.dailyDemand,allocated,shortage:remaining,
           priority:demand.priority});
      }
    }
    const balances=[];
    for(const row of sourceState.values()) {
      row.source.stock-=row.withdrawn;
      balances.push({
        id:'water-balance-'+date+'-'+row.source.id,
        sourceId:row.source.id,stateId:row.source.stateId,provinceId:row.source.provinceId,
        unit:row.source.unit,openingStock:row.openingStock,replenished:row.replenished-row.openingStock,
        environmentalReserve:row.source.environmentalReserve,withdrawn:row.withdrawn,
        closingStock:row.source.stock,qualityPercent:row.source.qualityPercent,worldDate:date
      });
    }
    game.waterAllocations=allocations;
    game.waterBalances=balances;
    game.waterAllocationDate=date;
    game.waterHistory ||= [];
    for(const allocation of allocations.filter(item=>item.shortage>0)) {
      game.waterHistory.push({...clone(allocation),id:'water-history-'+date+'-'+allocation.demandId});
    }
    if(game.waterHistory.length>3000)
      game.waterHistory.splice(0,game.waterHistory.length-3000);
    return {ok:true,sourceCount:balances.length,demandCount:allocations.length,
      totalDemand:allocations.reduce((sum,item)=>sum+item.demand,0),
      totalAllocated:allocations.reduce((sum,item)=>sum+item.allocated,0)};
  }

  function refreshEnergy(game,stateId) {
    game.energyBalances=game.energyBalances.filter(item=>item.stateId!==stateId);
    const sources=game.energySources.filter(item=>item.stateId===stateId);
    const generated=sources.reduce((sum,item)=>
      sum+Number(item.capacityPerDay)*Number(item.productionPercent)/100,0);
    const losses=sources.reduce((sum,item)=>
      sum+Number(item.capacityPerDay)*Number(item.productionPercent)/100*
      Number(item.lossPercent)/100,0);
    const consumption=sources.reduce((sum,item)=>sum+Number(item.consumptionPerDay),0);
    game.energyBalances.push({
      id:'energy-'+stateId,stateId,worldDate:game.worldDate,
      generated,losses,consumption,
      available:Math.max(0,generated-losses-consumption),used:0
    });
  }

  function advancePrimaryProduction(game,date) {
    const cycles=[];
    for(const site of (game.livestockSites || []).slice().sort((a,b)=>a.id.localeCompare(b.id))) {
      const linked=companyFacility(game,site.companyId,site.facilityId,site.stateId);
      if(!linked) throw new Error('Livestock site '+site.id+' lost its NPC company installation.');
      const {company,facility}=linked;
      const workers=Math.max(0,Number(facility.workers)||0);
      const staffingRatio=Math.min(1,workers/Number(site.workersRequired));
      const year=Number(date.slice(0,4));
      const divisor=BigInt(1000*yearDays(year));
      const animalsBefore=Number(site.animals)||0;
      const birthNumerator=BigInt(animalsBefore)*BigInt(site.annualBirthsPerThousand)+BigInt(site.birthRemainder||0);
      const naturalBirths=Number(birthNumerator/divisor);
      site.birthRemainder=Number(birthNumerator%divisor);
      const deathNumerator=BigInt(animalsBefore)*BigInt(site.annualMortalityPerThousand)+BigInt(site.mortalityRemainder||0);
      const naturalDeaths=Math.min(animalsBefore,Number(deathNumerator/divisor));
      site.mortalityRemainder=Number(deathNumerator%divisor);
      let herd=animalsBefore-naturalDeaths;
      const carryingCapacity=Math.min(Number(site.maximumHerd),
        Math.floor(Number(site.pastureAreaHectares)*Number(site.animalsPerHectare)));
      const births=Math.min(naturalBirths,Math.max(0,carryingCapacity-herd));
      herd+=births;
      const diseaseRisk=activeDisasters(game,site.provinceId,date)
        .filter(item=>item.type==='disease')
        .reduce((sum,item)=>sum+Number(item.livestockLossPercentPerDay||0)*
          Number(item.intensityPercent)/100*
          Number(site.diseaseSensitivityPercent||0)/100,0);
      const diseaseDeaths=diseaseRisk>0
        ? Math.min(herd,Math.floor(herd*Math.min(1,diseaseRisk/100))) : 0;
      herd-=diseaseDeaths;
      site.animals=herd;

      company.inventory ||= {};
      const feedAvailable=Math.max(0,Number(company.inventory[site.feedGoodId])||0);
      const feedPerAnimal=Number(site.feedPerAnimalPerDay);
      const affordableAnimals=feedPerAnimal>0?Math.floor(feedAvailable/feedPerAnimal):herd;
      const fedAnimals=Math.min(herd,affordableAnimals);
      const workingAnimals=Math.floor(fedAnimals*staffingRatio);
      const feedConsumed=workingAnimals*feedPerAnimal;
      if(feedConsumed>feedAvailable+1e-9)
        throw new Error('Livestock feed accounting exceeded the available inventory.');
      company.inventory[site.feedGoodId]=Math.max(0,feedAvailable-feedConsumed);
      const productQuantity=Math.floor(workingAnimals*Number(site.dailyProductPerFedAnimal));
      const acceptedProduct=addStock(game,site.stateId,site.dailyProductGoodId,productQuantity,
        ()=> 'livestock-product-'+date+'-'+site.id,company.id);
      const slaughtered=site.dailySlaughterLimit>0 && staffingRatio>0
        ? Math.min(Number(site.dailySlaughterLimit),
            Math.floor(Number(site.dailySlaughterLimit)*staffingRatio),
            Math.max(0,herd-Number(site.breedingStockMinimum)))
        : 0;
      site.animals-=slaughtered;
      const meatQuantity=Math.floor(slaughtered*Number(site.meatPerAnimal));
      const acceptedMeat=meatQuantity>0
        ? addStock(game,site.stateId,site.meatGoodId,meatQuantity,
            ()=> 'livestock-meat-'+date+'-'+site.id,company.id)
        : 0;
      site.workers=workers;
      site.lastProcessedOn=date;
      if(births || naturalDeaths || diseaseDeaths || productQuantity || slaughtered)
        recordPrimaryCycle(game,site,'livestock',acceptedProduct,{
          outputGoodId:site.dailyProductGoodId,workers,animalsBefore,births,
          naturalDeaths,diseaseDeaths,animalsAfter:site.animals,
          fedAnimals:workingAnimals,feedGoodId:site.feedGoodId,feedConsumed,
          feedShortageAnimals:Math.max(0,herd-workingAnimals),
          productQuantity:acceptedProduct,productOverflow:productQuantity-acceptedProduct,
          slaughteredAnimals:slaughtered,meatGoodId:site.meatGoodId,
          meatQuantity:acceptedMeat,meatOverflow:meatQuantity-acceptedMeat,
          staffRequired:site.workersRequired,staffingPercent:Math.round(staffingRatio*100)
        },cycles);
    }

    for(const ground of (game.fishingGrounds || []).slice().sort((a,b)=>a.id.localeCompare(b.id))) {
      const linked=companyFacility(game,ground.companyId,ground.facilityId,ground.stateId);
      if(!linked) throw new Error('Fishing ground '+ground.id+' lost its NPC company installation.');
      const {company,facility}=linked;
      const workers=Math.max(0,Number(facility.workers)||0);
      const stockBefore=Number(ground.stock);
      const regenerated=Math.min(Number(ground.stockCapacity)-stockBefore,
        Number(ground.dailyRegeneration));
      ground.stock+=Math.max(0,regenerated);
      const month=Number(date.slice(5,7));
      const isOpen=ground.openMonths.includes(month);
      const staffingRatio=Math.min(1,workers/Number(ground.workersRequired));
      const effort=isOpen?Math.floor(workers*Number(ground.catchPerWorkerPerDay)*staffingRatio):0;
      const available=Math.max(0,Number(ground.stock)-Number(ground.ecologicalReserve));
      const catchQuantity=Math.min(available,Number(ground.maximumCatchPerDay),
        Number(ground.sustainableCatchPerDay),effort);
      const stockBeforeCatch=Number(ground.stock);
      ground.stock-=catchQuantity;
      const accepted=catchQuantity>0
        ? addStock(game,ground.stateId,ground.outputGoodId,catchQuantity,
            ()=> 'fish-catch-'+date+'-'+ground.id,company.id)
        : 0;
      const environment=(game.environmentalStates || []).find(item=>
        item.provinceId===ground.provinceId);
      const biodiversityLoss=Number(ground.stockCapacity)>0
        ? (catchQuantity/Number(ground.stockCapacity))*
          Number(ground.biodiversityLossPercentAtFullDepletion||0)
        : 0;
      if(environment && biodiversityLoss>0) {
        environment.biodiversityPercent=Math.max(0,
          environment.biodiversityPercent-biodiversityLoss);
        environment.updatedOn=date;
      }
      ground.workers=workers;
      ground.lastProcessedOn=date;
      if(catchQuantity>0 || regenerated>0 || !isOpen)
        recordPrimaryCycle(game,ground,'fishery',accepted,{
          outputGoodId:ground.outputGoodId,workers,isOpen,
          stockBefore,regenerated,stockBeforeCatch,stockAfter:ground.stock,
          ecologicalReserve:ground.ecologicalReserve,biodiversityLossPercent:biodiversityLoss,
          catchQuantity:accepted,catchOverflow:catchQuantity-accepted,
          staffingPercent:Math.round(staffingRatio*100)
        },cycles);
    }

    for(const forest of (game.forestAreas || []).slice().sort((a,b)=>a.id.localeCompare(b.id))) {
      const linked=companyFacility(game,forest.companyId,forest.facilityId,forest.stateId);
      if(!linked) throw new Error('Forest area '+forest.id+' lost its NPC company installation.');
      const {company,facility}=linked;
      const workers=Math.max(0,Number(facility.workers)||0);
      const stockBefore=Number(forest.standingTimber);
      const regenerated=Math.min(Number(forest.maximumTimber)-stockBefore,
        Number(forest.regenerationPerDay));
      forest.standingTimber+=Math.max(0,regenerated);
      const staffingRatio=Math.min(1,workers/Number(forest.workersRequired));
      const conservationFactor=1-Number(forest.conservationPercent)/100;
      const labourHarvest=Math.floor(workers*Number(forest.unitsPerWorkerPerDay)*
        staffingRatio*conservationFactor);
      const available=Math.max(0,Number(forest.standingTimber)-Number(forest.ecologicalReserve));
      const harvested=Math.min(available,Number(forest.maximumHarvestPerDay),
        Number(forest.sustainableHarvestPerDay),labourHarvest);
      const timberBeforeHarvest=Number(forest.standingTimber);
      forest.standingTimber-=harvested;
      const accepted=harvested>0
        ? addStock(game,forest.stateId,forest.outputGoodId,harvested,
            ()=> 'forest-timber-'+date+'-'+forest.id,company.id)
        : 0;
      const environment=(game.environmentalStates || []).find(item=>
        item.provinceId===forest.provinceId);
      if(environment && Number(forest.maximumTimber)>0) {
        const netChange=regenerated-harvested;
        const coverChange=netChange/Number(forest.maximumTimber)*
          Number(forest.forestCoverImpactPercentAtFullDepletion||0);
        environment.forestCoverPercent=Math.max(0,Math.min(100,
          environment.forestCoverPercent+coverChange));
        environment.updatedOn=date;
      }
      forest.workers=workers;
      forest.lastProcessedOn=date;
      if(harvested>0 || regenerated>0)
        recordPrimaryCycle(game,forest,'forestry',accepted,{
          outputGoodId:forest.outputGoodId,workers,standingTimberBefore:stockBefore,
          regenerated,standingTimberAfter:forest.standingTimber,
          ecologicalReserve:forest.ecologicalReserve,timberBeforeHarvest,
          harvested:accepted,harvestOverflow:harvested-accepted,
          conservationPercent:forest.conservationPercent,
          staffingPercent:Math.round(staffingRatio*100)
        },cycles);
    }

    game.primaryProductionCycles.push(...cycles);
    if(game.primaryProductionCycles.length>5000)
      game.primaryProductionCycles.splice(0,game.primaryProductionCycles.length-5000);
    return cycles;
  }

  function advanceDay(game) {
    ensure(game);
    const date=game.worldDate;
    if(game.resourceCycleDate===date && game.resourceCycleResult)
      return {...clone(game.resourceCycleResult),replayed:true};
    const appliedDisasters=[];
    const harvests=[];
    for(const state of game.territories) refreshEnergy(game,state.stateId);
    for(const deposit of game.resourceDeposits) {
      const resource=game.resourceCatalog.find(item=>item.id===deposit.resourceId);
      if(resource?.renewable) {
        const capacity=Number(deposit.reserveCapacity ?? Number.MAX_SAFE_INTEGER);
        deposit.reserves=Math.min(capacity,deposit.reserves+Number(resource.regenerationPerDay||0));
      }
    }
    const waterCycle=allocateWater(game,date);
    for(const disaster of game.disasters) {
      if(disaster.lastAppliedOn===date) continue;
      const active=activeDisasters(game,disaster.provinceIds[0],date).includes(disaster);
      if(!active) continue;
      for(const provinceId of disaster.provinceIds) {
        const environment=game.environmentalStates.find(item=>item.provinceId===provinceId);
        if(!environment) continue;
        const climateZone=(game.climateZones || []).find(item=>item.provinceIds.includes(provinceId));
        const droughtExposure=disaster.type==='drought'
          ? Number(climateZone?.droughtExposurePercent)/100 : 1;
        const intensity=Number(disaster.intensityPercent)/100*droughtExposure;
        environment.waterAvailabilityPercent=Math.max(0,environment.waterAvailabilityPercent-
          Number(disaster.waterLossPercentPerDay||0)*intensity);
        environment.soilFertilityPercent=Math.max(0,environment.soilFertilityPercent-
          Number(disaster.soilLossPercentPerDay||0)*intensity);
        environment.forestCoverPercent=Math.max(0,environment.forestCoverPercent-
          Number(disaster.forestLossPercentPerDay||0)*intensity);
        if(Number(disaster.forestStockLossPercentPerDay||0)>0) {
          for(const forest of game.forestAreas.filter(item=>item.provinceId===provinceId)) {
            const lost=Math.floor(Number(forest.standingTimber)*
              Number(disaster.forestStockLossPercentPerDay)*intensity/10000);
            forest.standingTimber=Math.max(0,forest.standingTimber-lost);
            if(lost>0) history(game,forest.stateId,'forest_disaster_damage',
              'A disaster damaged '+lost+' units of standing timber in '+forest.name+'.',
              {disasterId:disaster.id,forestAreaId:forest.id,loss:lost});
          }
        }
        environment.pollutionIndex=Math.min(100,environment.pollutionIndex+
          Number(disaster.pollutionIncreasePerDay||0)*intensity);
        environment.updatedOn=date;
      }
      disaster.lastAppliedOn=date;
      appliedDisasters.push(disaster.id);
      const disasterStateId=game.provinces.find(item=>
        item.id===disaster.provinceIds[0])?.stateId || null;
      history(game,disasterStateId,'disaster_impact',
        disaster.type+' affected '+disaster.provinceIds.length+' province(s).',
        {disasterId:disaster.id,intensityPercent:disaster.intensityPercent,provinceIds:disaster.provinceIds});
    }
    for(const farm of game.farms) {
      if(farm.lastHarvestOn===date) continue;
      const crop=game.cropDefinitions.find(item=>item.id===farm.cropId);
      const land=game.agriculturalLand.find(item=>item.id===farm.landId);
      if(!crop || !land || land.use!=='arable') continue;
      const year=Number(date.slice(0,4));
      const month=Number(date.slice(5,7));
      const day=Number(date.slice(8,10));
      if(!crop.harvestMonths.includes(month) || day!==crop.harvestDayOfMonth) continue;
      if(farm.lastHarvestYear===year) continue;
      const {zone,season}=seasonFor(game,farm.provinceId,date);
      if(!zone || !season) continue;
      const environment=game.environmentalStates.find(item=>item.provinceId===farm.provinceId);
      if(!environment) continue;
      const soil=Math.min(land.soilFertilityPercent,environment.soilFertilityPercent)/100;
      const water=Math.min(environment.waterAvailabilityPercent,100)/100;
      const seasonal=Number(season.yieldFactor);
      const waterClimate=Number(season.waterFactor);
      const irrigation=(game.waterAllocations || []).find(item=>
        item.targetType==='agriculture' && item.targetId===farm.id && item.worldDate===date);
      const allocatedWaterFactor=irrigation?Number(irrigation.coveragePercent)/100:1;
      const waterFactor=Math.min(1,water*waterClimate*allocatedWaterFactor);
      const labourArea=farm.workers/crop.workersPerHectare;
      const seedArea=crop.seedUsePerHectare>0?farm.seedStock/crop.seedUsePerHectare:farm.areaHectares;
      const actualArea=Math.max(0,Math.min(farm.areaHectares,labourArea,seedArea));
      const disasterLoss=activeDisasters(game,farm.provinceId,date)
        .reduce((remaining,item)=>remaining*(1-Number(item.cropLossPercent||0)*
          Number(item.intensityPercent)/10000),1);
      const minimumWater=Number(crop.minimumWaterPercent||0)/100;
      const waterPenalty=minimumWater>0?Math.min(1,water/ minimumWater):1;
      const rawYield=actualArea*crop.yieldPerHectare*soil*seasonal*waterFactor*waterPenalty*
        Number(farm.toolsEfficiencyPercent)/100*
        Number(farm.infrastructureEfficiencyPercent)/100*disasterLoss;
      const quantity=Math.max(0,Math.floor(rawYield));
      farm.seedStock=Math.max(0,farm.seedStock-actualArea*crop.seedUsePerHectare);
      farm.lastHarvestOn=date;
      farm.lastHarvestYear=year;
      const accepted=addStock(game,farm.stateId,crop.outputGoodId,quantity,()=> 'harvest-'+date+'-'+farm.id);
      if(accepted<quantity) {
        farm.harvestOverflow=(Number(farm.harvestOverflow)||0)+(quantity-accepted);
      }
      const depletion=Number(crop.soilDepletionPercentPerHarvest||0);
      land.soilFertilityPercent=Math.max(0,land.soilFertilityPercent-depletion);
      environment.soilFertilityPercent=Math.max(0,environment.soilFertilityPercent-depletion);
      environment.updatedOn=date;
      const record={
        id:'harvest-'+farm.id+'-'+date,farmId:farm.id,stateId:farm.stateId,
        provinceId:farm.provinceId,cropId:crop.id,year,month,harvestedOn:date,
        areaHectares:actualArea,quantity:accepted,lossQuantity:quantity-accepted,
        soilFertilityPercent:Math.round(soil*100),
        waterAvailabilityPercent:Math.round(water*100),
        seasonalYieldFactor:seasonal,disasterLossFactor:disasterLoss
      };
      game.harvestCycles.push(record);
      if(game.harvestCycles.length>5000) game.harvestCycles.splice(0,game.harvestCycles.length-5000);
      harvests.push(record);
      history(game,farm.stateId,'harvest_completed',
        quantity+' '+crop.outputGoodId+' harvested from '+actualArea+' hectare(s).',
        {farmId:farm.id,provinceId:farm.provinceId,cropId:crop.id,quantity,areaHectares:actualArea});
    }
    const primaryProduction=advancePrimaryProduction(game,date);
    const result={ok:true,appliedDisasters,harvestCount:harvests.length,harvests,
      waterCycle,primaryProduction};
    game.resourceCycleDate=date;
    game.resourceCycleResult=clone(result);
    return result;
  }

  const api=Object.freeze({
    ensure,validateConfiguration,applyOrder,advanceDay,lawIsActive,refreshEnergy,
    allocateWater,advancePrimaryProduction,seasonFor,activeDisasters,arrayFields:Object.freeze([...arrayFields]),
    configurationFields:Object.freeze([...configurationFields]),
    disasterTypes:Object.freeze([...disasterTypes])
  });
  globalThis.NewWorldResources=api;
  if(typeof module!=='undefined' && module.exports) module.exports=api;
})();