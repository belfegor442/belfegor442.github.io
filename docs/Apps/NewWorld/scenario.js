(() => {
  'use strict';

  const SCHEMA_VERSION=1;
  const OFFICIAL_STATES=Object.freeze([
    ['coimbrila','Kingdom of Coimbrila'],
    ['gania','United Provinces of Gania'],
    ['chungia','Chungia'],
    ['calcilacia','Calcilacia'],
    ['pician-empire','Pician Empire'],
    ['meityeun-theocracy','Meityeun Theocracy'],
    ['swabing','Swabing'],
    ['alba','Alba'],
    ['knosian-despotate','Knosian Despotate'],
    ['kalestos','Kalestos'],
    ['gorkirch','Gorkirch'],
    ['shonewesia','Duchy of Shonewesia'],
    ['shahtehaq','Shahtehaq'],
    ['kvinian-empire','Kvinian Empire'],
    ['shi','Shi'],
    ['kueopia','Kueopia']
  ].map(([key,name],index)=>Object.freeze({key,name,index})));

  function hashText(value) {
    let hash=2166136261;
    for(const char of String(value)) {
      hash^=char.charCodeAt(0);
      hash=Math.imul(hash,16777619);
    }
    return (hash>>>0).toString(16).padStart(8,'0');
  }

  function deterministicStateSeed(seed,version,stateKey) {
    return hashText([String(seed),String(version),String(stateKey)].join('|'));
  }

  function canonicalFingerprint(game,seed,scenarioStartDate=game?.worldDate) {
    const manifest=(game?.territories || []).map(item=>({
      key:String(item.scenarioStateKey || ''),
      index:Number(item.index),
      stateId:String(item.stateId || ''),
      currencyId:String(item.currencyId || ''),
      deterministicSeed:deterministicStateSeed(seed,game?.scenarioVersion || '',item.scenarioStateKey || '')
    })).sort((a,b)=>a.index-b.index);
    const currencies=(game?.currencies || []).map(item=>({
      id:String(item.id || ''),stateId:String(item.stateId || ''),
      code:String(item.code || ''),minorUnitScale:Number(item.minorUnitScale)||0
    })).sort((a,b)=>a.id.localeCompare(b.id));
    const provinces=(game?.provinces || []).map(item=>({
      id:String(item.id || ''),stateId:String(item.stateId || ''),
      geometryId:String(item.svgElementId || '')
    })).sort((a,b)=>a.id.localeCompare(b.id));
    const goods=(game?.goods || []).map(item=>({
      id:String(item.id || ''),unit:String(item.unit || ''),
      category:String(item.category || '')
    })).sort((a,b)=>a.id.localeCompare(b.id));
    const recipes=(game?.productionRecipes || []).map(item=>({
      id:String(item.id || ''),inputs:item.inputs || {},outputs:item.outputs || {}
    })).sort((a,b)=>a.id.localeCompare(b.id));
    const technologies=(game?.technologies || []).map(item=>({
      id:String(item.id || ''),
      prerequisites:[...(item.prerequisiteTechnologyIds || [])].sort()
    })).sort((a,b)=>a.id.localeCompare(b.id));
    const resourceCatalog=(game?.resourceCatalog || []).map(item=>({
      id:String(item.id||''),name:String(item.name||''),unit:String(item.unit||''),
      category:String(item.category||''),goodId:String(item.goodId||''),
      renewable:item.renewable===true,regenerationPerDay:Number(item.regenerationPerDay)||0,
      extractionEnergyPerUnit:Number(item.extractionEnergyPerUnit)||0,
      extractionCostPerUnit:Number(item.extractionCostPerUnit)||0,
      environmentalImpactPercentPerUnit:Number(item.environmentalImpactPercentPerUnit)||0
    })).sort((a,b)=>a.id.localeCompare(b.id));
    const deposits=(game?.resourceDeposits || []).map(item=>({
      id:String(item.id || ''),stateId:String(item.stateId || ''),
      provinceId:String(item.provinceId || ''),resourceId:String(item.resourceId || item.goodId || ''),
      initialReserves:Number(item.initialReserves??item.reserves)||0,
      reserveCapacity:Number(item.reserveCapacity)||0,
      dailyExtractionLimit:Number(item.dailyExtractionLimit)||0,
      extractionLawId:String(item.extractionLawId||''),
      extractionOfficeIds:[...(item.extractionOfficeIds||[])].sort(),
      accessible:item.accessible===true,
      depth:Number(item.depth)||0
    })).sort((a,b)=>a.id.localeCompare(b.id));
    const livestockSites=(game?.livestockSites || []).map(item=>({
      id:String(item.id||''),stateId:String(item.stateId||''),provinceId:String(item.provinceId||''),
      pastureLandId:String(item.pastureLandId||''),companyId:String(item.companyId||''),
      facilityId:String(item.facilityId||''),pastureAreaHectares:Number(item.pastureAreaHectares)||0,
      animals:Number(item.initialAnimals??item.animals)||0,
      breedingStockMinimum:Number(item.breedingStockMinimum)||0,
      maximumHerd:Number(item.maximumHerd)||0,animalsPerHectare:Number(item.animalsPerHectare)||0,
      feedGoodId:String(item.feedGoodId||''),feedPerAnimalPerDay:Number(item.feedPerAnimalPerDay)||0,
      dailyProductGoodId:String(item.dailyProductGoodId||''),
      dailyProductPerFedAnimal:Number(item.dailyProductPerFedAnimal)||0,
      annualBirthsPerThousand:Number(item.annualBirthsPerThousand)||0,
      annualMortalityPerThousand:Number(item.annualMortalityPerThousand)||0,
      dailySlaughterLimit:Number(item.dailySlaughterLimit)||0,meatGoodId:String(item.meatGoodId||''),
      meatPerAnimal:Number(item.meatPerAnimal)||0,diseaseSensitivityPercent:Number(item.diseaseSensitivityPercent)||0,
      workersRequired:Number(item.workersRequired)||0
    })).sort((a,b)=>a.id.localeCompare(b.id));
    const fishingGrounds=(game?.fishingGrounds || []).map(item=>({
      id:String(item.id||''),stateId:String(item.stateId||''),provinceId:String(item.provinceId||''),
      companyId:String(item.companyId||''),facilityId:String(item.facilityId||''),
      outputGoodId:String(item.outputGoodId||''),stock:Number(item.initialStock??item.stock)||0,
      stockCapacity:Number(item.stockCapacity)||0,ecologicalReserve:Number(item.ecologicalReserve)||0,
      dailyRegeneration:Number(item.dailyRegeneration)||0,maximumCatchPerDay:Number(item.maximumCatchPerDay)||0,
      sustainableCatchPerDay:Number(item.sustainableCatchPerDay)||0,
      workersRequired:Number(item.workersRequired)||0,
      catchPerWorkerPerDay:Number(item.catchPerWorkerPerDay)||0,
      openMonths:[...(item.openMonths||[])].sort((a,b)=>a-b),
      biodiversityLossPercentAtFullDepletion:Number(item.biodiversityLossPercentAtFullDepletion)||0
    })).sort((a,b)=>a.id.localeCompare(b.id));
    const forestAreas=(game?.forestAreas || []).map(item=>({
      id:String(item.id||''),stateId:String(item.stateId||''),provinceId:String(item.provinceId||''),
      landId:String(item.landId||''),companyId:String(item.companyId||''),
      facilityId:String(item.facilityId||''),areaHectares:Number(item.areaHectares)||0,
      outputGoodId:String(item.outputGoodId||''),
      standingTimber:Number(item.initialStandingTimber??item.standingTimber)||0,
      maximumTimber:Number(item.maximumTimber)||0,ecologicalReserve:Number(item.ecologicalReserve)||0,
      regenerationPerDay:Number(item.regenerationPerDay)||0,maximumHarvestPerDay:Number(item.maximumHarvestPerDay)||0,
      sustainableHarvestPerDay:Number(item.sustainableHarvestPerDay)||0,
      workersRequired:Number(item.workersRequired)||0,unitsPerWorkerPerDay:Number(item.unitsPerWorkerPerDay)||0,
      conservationPercent:Number(item.conservationPercent)||0,
      forestCoverImpactPercentAtFullDepletion:Number(item.forestCoverImpactPercentAtFullDepletion)||0
    })).sort((a,b)=>a.id.localeCompare(b.id));
    const waterSources=(game?.waterSources || []).map(item=>({
      id:String(item.id || ''),stateId:String(item.stateId || ''),
      provinceId:String(item.provinceId || ''),type:String(item.type || ''),
      unit:String(item.unit || ''),initialStock:Number(item.initialStock??item.stock)||0,
      capacity:Number(item.capacity)||0,
      renewableInflowPerDay:Number(item.renewableInflowPerDay)||0,
      maximumWithdrawalPerDay:Number(item.maximumWithdrawalPerDay)||0,
      environmentalReserve:Number(item.environmentalReserve)||0,
      qualityPercent:Number(item.qualityPercent)||0
    })).sort((a,b)=>a.id.localeCompare(b.id));
    const waterDemands=(game?.waterDemands || []).map(item=>({
      id:String(item.id || ''),stateId:String(item.stateId || ''),
      provinceId:String(item.provinceId || ''),targetType:String(item.targetType || ''),
      targetId:String(item.targetId || ''),unit:String(item.unit || ''),
      dailyDemand:Number(item.dailyDemand)||0,priority:Number(item.priority)||0,
      minimumQualityPercent:Number(item.minimumQualityPercent)||0,
      sourceIds:[...(item.sourceIds || [])].sort()
    })).sort((a,b)=>a.id.localeCompare(b.id));
    const agriculturalLand=(game?.agriculturalLand || []).map(item=>({
      id:String(item.id||''),stateId:String(item.stateId||''),
      provinceId:String(item.provinceId||''),use:String(item.use||''),
      areaHectares:Number(item.areaHectares)||0,
      initialSoilFertilityPercent:Number(item.initialSoilFertilityPercent??item.soilFertilityPercent)||0
    })).sort((a,b)=>a.id.localeCompare(b.id));
    const cropDefinitions=(game?.cropDefinitions || []).map(item=>({
      id:String(item.id||''),goodId:String(item.goodId||''),
      daysToMaturity:Number(item.daysToMaturity)||0,
      workersPerHectare:Number(item.workersPerHectare)||0,
      seedPerHectare:Number(item.seedPerHectare)||0,
      yieldPerHectare:Number(item.yieldPerHectare)||0
    })).sort((a,b)=>a.id.localeCompare(b.id));
    const farms=(game?.farms || []).map(item=>({
      id:String(item.id||''),stateId:String(item.stateId||''),
      provinceId:String(item.provinceId||''),landId:String(item.landId||''),
      cropId:String(item.cropId||''),areaHectares:Number(item.areaHectares)||0,
      initialSeedStock:Number(item.initialSeedStock??item.seedStock)||0
    })).sort((a,b)=>a.id.localeCompare(b.id));
    const climateZones=(game?.climateZones || []).map(item=>({
      id:String(item.id||''),name:String(item.name||''),
      provinceIds:[...(item.provinceIds||[])].sort(),
      droughtExposurePercent:Number(item.droughtExposurePercent)||0,
      seasons:(item.seasons||[]).map(season=>({
        name:String(season.name||''),months:[...(season.months||[])].sort((a,b)=>a-b),
        yieldFactor:Number(season.yieldFactor)||0,waterFactor:Number(season.waterFactor)||0
      }))
    })).sort((a,b)=>a.id.localeCompare(b.id));
    const energySources=(game?.energySources || []).map(item=>({
      id:String(item.id||''),stateId:String(item.stateId||''),
      type:String(item.type||''),capacityPerDay:Number(item.capacityPerDay)||0,
      reserveCapacity:Number(item.reserveCapacity)||0,
      costPerUnit:Number(item.costPerUnit)||0
    })).sort((a,b)=>a.id.localeCompare(b.id));
    const foodReserves=(game?.foodReserves || []).map(item=>({
      id:String(item.id||''),stateId:String(item.stateId||''),
      goodId:String(item.goodId||''),quantity:Number(item.quantity)||0,
      protectedQuantity:Number(item.protectedQuantity)||0,
      quality:Number(item.quality)||0
    })).sort((a,b)=>a.id.localeCompare(b.id));
    const disasters=(game?.disasters || []).map(item=>({
      id:String(item.id||''),type:String(item.type||''),
      provinceIds:[...(item.provinceIds||[])].sort(),
      startDate:String(item.startDate||''),durationDays:Number(item.durationDays)||0,
      intensityPercent:Number(item.intensityPercent)||0
    })).sort((a,b)=>a.id.localeCompare(b.id));
    const environmentalBaseline=(game?.environmentalStates || []).map(item=>({
      provinceId:String(item.provinceId||''),
      forestCoverPercent:Number(item.initialForestCoverPercent??item.forestCoverPercent)||0,
      pollutionIndex:Number(item.initialPollutionIndex??item.pollutionIndex)||0,
      biodiversityPercent:Number(item.initialBiodiversityPercent??item.biodiversityPercent)||0,
      soilErosionPercent:Number(item.initialSoilErosionPercent??item.soilErosionPercent)||0,
      soilFertilityPercent:Number(item.initialSoilFertilityPercent??item.soilFertilityPercent)||0,
      groundwaterLevelPercent:Number(item.initialGroundwaterLevelPercent??item.groundwaterLevelPercent)||0
    })).sort((a,b)=>a.provinceId.localeCompare(b.provinceId));
    const serviceTypes=(game?.serviceTypes || []).map(item=>({
      id:String(item.id || ''),category:String(item.category || ''),
      unit:String(item.unit || ''),
      demandPerThousandResidentsPerDay:Number(item.demandPerThousandResidentsPerDay)||0,
      healthMortalityReductionPercentAtFullAccess:Number(item.healthMortalityReductionPercentAtFullAccess)||0,
      educationProgressPerDayAtFullAccess:Number(item.educationProgressPerDayAtFullAccess)||0,
      educationProgressDelayDays:Number(item.educationProgressDelayDays)||0
    })).sort((a,b)=>a.id.localeCompare(b.id));
    const serviceFacilities=(game?.publicServiceFacilities || []).map(item=>({
      id:String(item.id || ''),stateId:String(item.stateId || ''),
      provinceId:String(item.provinceId || ''),serviceTypeId:String(item.serviceTypeId || ''),
      providerType:String(item.providerType || ''),operatorCompanyId:String(item.operatorCompanyId || ''),
      capacityPerDay:Number(item.capacityPerDay)||0,staff:Number(item.staff)||0,
      staffRequired:Number(item.staffRequired)||0,qualityPercent:Number(item.qualityPercent)||0,
      dailyOperatingCost:Number(item.dailyOperatingCost)||0,
      publicFundingPercent:Number(item.publicFundingPercent)||0,
      maximumTravelDistanceKm:Number(item.maximumTravelDistanceKm)||0,
      maximumTravelTimeMinutes:Number(item.maximumTravelTimeMinutes)||0,
      populationGroupIds:[...(item.populationGroupIds || [])].sort(),
      accessProfiles:(item.accessProfiles||[]).map(profile=>({
        populationGroupId:String(profile.populationGroupId||''),
        distanceKm:Number(profile.distanceKm)||0,
        travelTimeMinutes:Number(profile.travelTimeMinutes)||0,
        transportCoveragePercent:Number(profile.transportCoveragePercent)||0,
        eligibilityPercent:Number(profile.eligibilityPercent)||0,
        affordabilityPercent:Number(profile.affordabilityPercent)||0
      })).sort((a,b)=>a.populationGroupId.localeCompare(b.populationGroupId)),
      waterDemandId:String(item.waterDemandId || '')
    })).sort((a,b)=>a.id.localeCompare(b.id));
    const industryOccupations=(game?.industryOccupations || []).map(item=>({
      id:String(item.id || ''),name:String(item.name || ''),
      minimumQualificationLevel:Number(item.minimumQualificationLevel)||0
    })).sort((a,b)=>a.id.localeCompare(b.id));
    const labourPools=(game?.labourPools || []).map(item=>({
      id:String(item.id || ''),stateId:String(item.stateId || ''),
      provinceId:String(item.provinceId || ''),populationGroupId:String(item.populationGroupId || ''),
      occupationId:String(item.occupationId || ''),workforce:Number(item.workforce)||0,
      qualificationLevel:Number(item.qualificationLevel)||0
    })).sort((a,b)=>a.id.localeCompare(b.id));
    const industryWorkplaces=(game?.industryWorkplaces || []).map(item=>({
      id:String(item.id || ''),companyId:String(item.companyId || ''),
      facilityId:String(item.facilityId || ''),stateId:String(item.stateId || ''),
      provinceId:String(item.provinceId || ''),occupationId:String(item.occupationId || ''),
      positions:Number(item.positions)||0,wagePerWorkerPerDay:Number(item.wagePerWorkerPerDay)||0,
      minimumQualificationLevel:Number(item.minimumQualificationLevel)||0,
      shiftHoursPerDay:Number(item.shiftHoursPerDay)||0,
      safetyRatingPercent:Number(item.safetyRatingPercent)||0,
      hazardExposurePercent:Number(item.hazardExposurePercent)||0,
      operational:item.operational===true,unionId:String(item.unionId || ''),
      farmId:String(item.farmId || '')
    })).sort((a,b)=>a.id.localeCompare(b.id));
    const labourUnions=(game?.labourUnions || []).map(item=>({
      id:String(item.id || ''),stateId:String(item.stateId || ''),
      provinceId:String(item.provinceId || ''),occupationId:String(item.occupationId || ''),
      recognized:item.recognized===true,membershipPercent:Number(item.membershipPercent)||0,
      negotiatedWagePerWorkerPerDay:Number(item.negotiatedWagePerWorkerPerDay)||0
    })).sort((a,b)=>a.id.localeCompare(b.id));
    const financeSchema={
      currencies:(game?.currencies||[]).map(item=>({id:item.id,stateId:item.stateId,
        name:item.name,code:item.code,minorUnitScale:item.minorUnitScale})).sort((a,b)=>a.id.localeCompare(b.id)),
      exchangeRates:(game?.exchangeRates||[]).map(item=>({...item})).sort((a,b)=>a.id.localeCompare(b.id)),
      financialBanks:(game?.financialBanks||[]).map(item=>({id:item.id,stateId:item.stateId,
        currencyId:item.currencyId,name:item.name,initialCashBalance:Number(item.initialCashBalance??item.cashBalance),
        initialCapital:Number(item.initialCapital??item.capital),minimumReserve:item.minimumReserve,
        loanLimit:item.loanLimit,riskAppetitePercent:item.riskAppetitePercent,status:item.status
      })).sort((a,b)=>a.id.localeCompare(b.id)),
      taxRules:(game?.taxRules||[]).map(item=>({...item})).sort((a,b)=>a.id.localeCompare(b.id)),
      priceIndexConfigs:(game?.priceIndexConfigs||[]).map(item=>({...item,
        items:(item.items||[]).map(entry=>({...entry})).sort((a,b)=>a.goodId.localeCompare(b.goodId))
      })).sort((a,b)=>a.id.localeCompare(b.id))
    };
    const diplomacySchema={
      internationalOrganizations:(game?.internationalOrganizations||[]).map(item=>({...item,
        memberStateIds:[...(item.memberStateIds||[])].sort(),
        competenceIds:[...(item.competenceIds||[])].sort()
      })).sort((a,b)=>a.id.localeCompare(b.id))
    };
    const epidemicDefinitions=(game?.epidemicDefinitions||[]).map(item=>({
      id:String(item.id||''),stateId:String(item.stateId||''),
      name:String(item.name||''),description:String(item.description||''),
      incubationDays:Number(item.incubationDays)||0,
      infectiousDays:Number(item.infectiousDays)||0,
      transmissionBasisPoints:Number(item.transmissionBasisPoints)||0,
      dailyMortalityPerThousand:Number(item.dailyMortalityPerThousand)||0,
      contactLinks:(item.contactLinks||[]).map(link=>({
        originGroupId:String(link.originGroupId||''),
        destinationGroupId:String(link.destinationGroupId||''),
        dailyContactsPerThousand:Number(link.dailyContactsPerThousand)||0
      })).sort((a,b)=>(a.originGroupId+'>'+a.destinationGroupId)
        .localeCompare(b.originGroupId+'>'+b.destinationGroupId))
    })).sort((a,b)=>a.id.localeCompare(b.id));
    const epidemicStarts=(game?.epidemicStarts||[]).map(item=>({
      id:String(item.id||''),definitionId:String(item.definitionId||''),
      sourceGroupId:String(item.sourceGroupId||''),startsOn:String(item.startsOn||''),
      initialInfectious:Number(item.initialInfectious)||0
    })).sort((a,b)=>a.id.localeCompare(b.id));
    const demographicProfiles=(game?.demographicProfiles||[]).map(item=>({
      stateId:String(item.stateId||''),
      annualBirthsPerThousand:Number(item.annualBirthsPerThousand)||0,
      ageBands:(item.ageBands||[]).map(band=>({
        minAge:Number(band.minAge),maxAge:Number(band.maxAge),
        annualDeathsPerThousand:Number(band.annualDeathsPerThousand)||0
      })).sort((a,b)=>a.minAge-b.minAge),
      migrationPermissionSetIds:[...(item.migrationPermissionSetIds||[])].sort()
    })).sort((a,b)=>a.stateId.localeCompare(b.stateId));
    const populationGroupStructure=(game?.populationGroups||[]).map(item=>({
      id:String(item.id||''),stateId:String(item.stateId||''),
      name:String(item.name||''),locationId:String(item.locationId||'')
    })).sort((a,b)=>a.id.localeCompare(b.id));
    const militarySupplyRoutes=(game?.supplyRoutes||[]).map(item=>({
      id:String(item.id||''),stateId:String(item.stateId||''),
      originCompanyId:String(item.originCompanyId||''),
      destinationProvinceId:String(item.destinationProvinceId||''),
      goodId:String(item.goodId||''),dailyCapacity:Number(item.dailyCapacity)||0,
      travelDays:Number(item.travelDays)||0,enabled:item.enabled===true
    })).sort((a,b)=>a.id.localeCompare(b.id));
    const militarySupplyRules=(game?.supplyRules||[]).map(item=>({
      id:String(item.id||''),stateId:String(item.stateId||''),
      unitTypeId:String(item.unitTypeId||''),
      consumptionPer100PersonnelPerDay:Object.fromEntries(
        Object.entries(item.consumptionPer100PersonnelPerDay||{}).sort(([a],[b])=>a.localeCompare(b))),
      undersupplyStrengthPenaltyPercent:Number(item.undersupplyStrengthPenaltyPercent)||0,
      unsuppliedMoraleLossPerDay:Number(item.unsuppliedMoraleLossPerDay)||0
    })).sort((a,b)=>a.id.localeCompare(b.id));
    const militarySupplyStocks=(game?.supplyStocks||[]).map(item=>({
      id:String(item.id||''),stateId:String(item.stateId||''),
      provinceId:String(item.provinceId||''),goodId:String(item.goodId||''),
      initialQuantity:Number(item.initialQuantity??item.quantity)||0,
      capacity:Number(item.capacity)||0
    })).sort((a,b)=>a.id.localeCompare(b.id));
    return hashText(JSON.stringify({
      scenarioId:String(game?.scenarioId || ''),
      scenarioVersion:String(game?.scenarioVersion || ''),
      worldDate:String(scenarioStartDate || ''),
      manifest,currencies,provinces,goods,recipes,technologies,resourceCatalog,deposits,
      agriculturalLand,cropDefinitions,farms,climateZones,energySources,foodReserves,
      disasters,environmentalBaseline,
      livestockSites,fishingGrounds,forestAreas,
      waterSources,waterDemands,serviceTypes,serviceFacilities,
      industryOccupations,labourPools,industryWorkplaces,labourUnions,
      financeSchema,diplomacySchema,
      militarySupplyRoutes,militarySupplyRules,militarySupplyStocks,
      demographicProfiles,populationGroupStructure,epidemicDefinitions,epidemicStarts
    }));
  }

  function validate(game) {
    const errors=[];
    const warnings=[];
    const territories=Array.isArray(game?.territories)?game.territories:[];
    const keys=territories.map(item=>item.scenarioStateKey);
    const stateIds=territories.map(item=>item.stateId);
    const currencyIds=territories.map(item=>item.currencyId);
    if(territories.length!==OFFICIAL_STATES.length) errors.push('STATE_COUNT_MISMATCH');
    if(new Set(keys).size!==keys.length) errors.push('DUPLICATE_STATE_KEY');
    if(new Set(stateIds).size!==stateIds.length) errors.push('DUPLICATE_STATE_ID');
    if(new Set(currencyIds).size!==currencyIds.length) errors.push('DUPLICATE_CURRENCY_ID');
    for(const expected of OFFICIAL_STATES) {
      const item=territories.find(territory=>territory.scenarioStateKey===expected.key);
      if(!item) errors.push('STATE_MISSING:'+expected.key);
      else {
        if(item.index!==expected.index) errors.push('STATE_INDEX_MISMATCH:'+expected.key);
        if(item.name!==expected.name) errors.push('STATE_NAME_MISMATCH:'+expected.key);
        if(!Number.isSafeInteger(item.population) || item.population<0)
          errors.push('INVALID_POPULATION:'+expected.key);
        if(!item.currencyId || !(game.currencies || []).some(currency=>
          currency.id===item.currencyId && currency.stateId===item.stateId))
          errors.push('CURRENCY_MISSING:'+expected.key);
      }
    }
    const goods=new Set((game.goods || []).map(item=>item.id));
    for(const recipe of game.productionRecipes || []) {
      for(const goodId of Object.keys(recipe.inputs || {}).concat(Object.keys(recipe.outputs || {})))
        if(!goods.has(goodId)) errors.push('RECIPE_GOOD_MISSING:'+recipe.id+':'+goodId);
    }
    const technologyIds=new Set((game.technologies || []).map(item=>item.id));
    const graph=new Map((game.technologies || []).map(item=>[
      item.id,(item.prerequisiteTechnologyIds || []).filter(id=>technologyIds.has(id))
    ]));
    const visiting=new Set();
    const visited=new Set();
    function visit(id) {
      if(visiting.has(id)) return false;
      if(visited.has(id)) return true;
      visiting.add(id);
      for(const prerequisite of graph.get(id) || [])
        if(!visit(prerequisite)) return false;
      visiting.delete(id);
      visited.add(id);
      return true;
    }
    for(const technologyId of graph.keys())
      if(!visit(technologyId)) {
        errors.push('TECHNOLOGY_PREREQUISITE_CYCLE');
        break;
      }
    for(const item of game.provinces || []) {
      if(!territories.some(territory=>territory.stateId===item.stateId))
        errors.push('PROVINCE_STATE_MISSING:'+item.id);
      if(item.svgElementId)
        warnings.push('PROVINCE_GEOMETRY_REQUIRES_APPROVED_SOURCE:'+item.id);
    }
    const totalPopulation=territories.reduce((sum,item)=>sum+(Number(item.population)||0),0);
    const populatedStates=territories.filter(item=>Number(item.population)>0).length;
    if(populatedStates<territories.length)
      warnings.push('INITIAL_POPULATION_DISTRIBUTION_INCOMPLETE');
    if((game.goods || []).length===0) warnings.push('NO_GOODS_CATALOG');
    if((game.companies || []).length<territories.length)
      warnings.push('ECONOMY_NOT_SEEDED_FOR_EVERY_STATE');
    if(!(game.resourceDeposits || []).length)
      warnings.push('GEOGRAPHIC_RESOURCE_DEPOSITS_NOT_CONFIGURED');
    if(!(game.waterSources || []).length)
      warnings.push('WATER_SOURCES_NOT_CONFIGURED');
    if(!(game.livestockSites || []).length)
      warnings.push('LIVESTOCK_NOT_CONFIGURED');
    if(!(game.fishingGrounds || []).length)
      warnings.push('FISHERIES_NOT_CONFIGURED');
    if(!(game.forestAreas || []).length)
      warnings.push('FORESTRY_NOT_CONFIGURED');
    if(!(game.publicServiceFacilities || []).length)
      warnings.push('PUBLIC_SERVICE_NETWORK_NOT_CONFIGURED');
    if(!(game.industryWorkplaces || []).length)
      warnings.push('WORKPLACE_AND_LABOUR_MODEL_NOT_CONFIGURED');
    if((game.currencies || []).some(item=>!item.name || !item.code || !Number.isInteger(item.minorUnitScale)))
      warnings.push('CURRENCY_METADATA_INCOMPLETE');
    if((game.politicalSystems || []).some(item=>item.configurationPending))
      warnings.push('POLITICAL_PROFILES_INCOMPLETE');
    if(!(game.territoryGeometry?.provinceBoundarySource))
      warnings.push('PROVINCE_BOUNDARIES_NOT_CONFIGURED');
    warnings.push('SEED_NOT_APPLIED_TO_WORLD_GENERATION');
    warnings.push('DEMOGRAPHIC_ECONOMIC_BALANCE_NOT_VERIFIED');
    if(!Number.isSafeInteger(totalPopulation)) errors.push('TOTAL_POPULATION_INVALID');
    return {
      valid:errors.length===0,errors:[...new Set(errors)],warnings:[...new Set(warnings)],
      stateCount:territories.length,totalPopulation,populatedStateCount:populatedStates,
      geometryScope:'state-boundaries-only'
    };
  }

  function createRecord(game,seed) {
    const normalizedSeed=String(seed || 'unassigned').slice(0,128);
    const stateManifest=OFFICIAL_STATES.map(expected=>{
      const territory=(game.territories || []).find(item=>item.scenarioStateKey===expected.key);
      return {
        stateKey:expected.key,index:expected.index,
        stateId:territory?.stateId || null,
        currencyId:territory?.currencyId || null,
        deterministicSeed:deterministicStateSeed(normalizedSeed,game.scenarioVersion,expected.key)
      };
    });
    const record={
      schemaVersion:SCHEMA_VERSION,
      fingerprintAlgorithm:'fnv1a32-noncryptographic',
      scenarioId:String(game.scenarioId || 'beleland-frontier'),
      scenarioVersion:String(game.scenarioVersion || 'unversioned'),
      seed:normalizedSeed,
      worldDate:String(game.worldDate || ''),
      createdAtWorldVersion:Number(game.worldVersion)||0,
      geometry:{registryVersion:1,scope:'state-boundaries-only',
        svgPath:'./map.svg',svgSha256:'ED01509FE3C4BA9933755287E8256617505780851FBF6379B087FA5463C669EB'},
      stateManifest,
      fingerprint:canonicalFingerprint(game,normalizedSeed)
    };
    const audit=validate(game);
    record.initialValidation={
      valid:audit.valid,errors:audit.errors,warnings:audit.warnings,
      stateCount:audit.stateCount,totalPopulation:audit.totalPopulation,
      populatedStateCount:audit.populatedStateCount
    };
    return record;
  }

  function validateRecord(game,record) {
    if(!record || record.schemaVersion!==SCHEMA_VERSION)
      return {valid:false,errors:['SCENARIO_SCHEMA_UNSUPPORTED']};
    if(record.scenarioId!==game?.scenarioId || record.scenarioVersion!==game?.scenarioVersion)
      return {valid:false,errors:['SCENARIO_IDENTITY_MISMATCH']};
    if(record.fingerprintAlgorithm!=='fnv1a32-noncryptographic')
      return {valid:false,errors:['SCENARIO_FINGERPRINT_ALGORITHM_UNSUPPORTED']};
    const expected=canonicalFingerprint(game,record.seed,record.worldDate);
    if(expected!==record.fingerprint)
      return {valid:false,errors:['SCENARIO_FINGERPRINT_MISMATCH']};
    const expectedManifest=OFFICIAL_STATES.map(item=>item.key);
    const manifest=record.stateManifest || [];
    const actual=manifest.map(item=>item.stateKey);
    if(JSON.stringify(actual)!==JSON.stringify(expectedManifest))
      return {valid:false,errors:['SCENARIO_MANIFEST_MISMATCH']};
    for(const entry of manifest) {
      const territory=(game.territories || []).find(item=>
        item.scenarioStateKey===entry.stateKey);
      if(!territory || territory.stateId!==entry.stateId ||
         territory.currencyId!==entry.currencyId)
        return {valid:false,errors:['SCENARIO_STATE_IDENTITY_CHANGED:'+entry.stateKey]};
      if(entry.deterministicSeed!==deterministicStateSeed(
        record.seed,record.scenarioVersion,entry.stateKey))
        return {valid:false,errors:['SCENARIO_STATE_SEED_MISMATCH:'+entry.stateKey]};
    }
    return {valid:true,errors:[]};
  }

  const api=Object.freeze({
    schemaVersion:SCHEMA_VERSION,officialStates:OFFICIAL_STATES,
    hashText,deterministicStateSeed,createRecord,validate,validateRecord
  });
  globalThis.NewWorldScenario=api;
  if(typeof module!=='undefined' && module.exports) module.exports=api;
})();