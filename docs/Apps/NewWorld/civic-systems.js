(() => {
  'use strict';

  const clamp = (value,min=0,max=100) => Math.max(min,Math.min(max,Number(value)||0));
  const integer = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
  const sum = values => values.reduce((total,value)=>total+(Number(value)||0),0);

  function event(game,stateId,type,description) {
    game.events ||= [];
    game.activity ||= [];
    game.eventSequence = (Number(game.eventSequence)||0)+1;
    const item = {
      id:'civic-'+String(stateId)+'-'+game.eventSequence,
      gameId:game.id,stateId,orderId:null,actorPlayerId:null,type,
      occurredAtUtc:new Date().toISOString(),worldDate:game.worldDate,
      worldVersion:game.worldVersion||0,description,sequence:game.eventSequence
    };
    game.events.push(item);
    game.eventOccurrences ||= [];
    const eventTitle=String(type||'civic.event').split(/[._]/)
      .filter(Boolean).map(part=>part.charAt(0).toUpperCase()+part.slice(1)).join(' ');
    const isCrisis=String(type||'').startsWith('crisis.');
    game.eventOccurrences.push({
      id:item.id,definitionId:type,gameId:game.id,stateId,
      category:isCrisis?'civic':String(type||'civic.event').split('.')[0]||'civic',
      severity:type==='crisis.started'?'major':'information',
      title:type==='crisis.started'?'Civic crisis declared':
        type==='crisis.resolved'?'Civic crisis resolved':eventTitle,description,
      cause:'Recorded by the State civic simulation or an authorised government decision.',
      worldDate:game.worldDate,day:game.day,status:'recorded'
    });
    game.activity.unshift(description);
    if (game.events.length>1000) game.events.splice(0,game.events.length-1000);
    if (game.eventOccurrences.length>1000)
      game.eventOccurrences.splice(0,game.eventOccurrences.length-1000);
    if (game.activity.length>100) game.activity.length=100;
    return item;
  }

  function ensureState(game,territory) {
    game.civicSystems ||= [];
    let system=game.civicSystems.find(item=>item.stateId===territory.stateId);
    const population=integer(territory.population);
    if (system) {
      system.policy ||= {};
      Object.assign(system.policy,{
        healthInvestment:50,educationInvestment:50,
        environmentalRegulation:40,welfareInvestment:20,
        ...system.policy
      });
      system.justice ||= {};
      Object.assign(system.justice,{
        policePerThousand:2.2,publicOrder:55,crimeRatePerThousandYear:24,
        courtCases:[],caseRemainder:0,prisonCapacity:Math.max(10,Math.ceil(population*.012)),
        prisonPopulation:0,prisoners:[],releasesLastDay:0,convictionsLastDay:0,
        resolvedLastDay:0,pendingCases:0,reportedCases:0,caseSequence:0,
        casesAdjudicatedToday:0,courtCapacityPerDay:Math.max(1,Math.floor(population/12000)),
        ...system.justice
      });
      system.justice.courtCases ||= [];
      system.justice.prisoners ||= [];
      system.justice.prisonPopulation=system.justice.prisoners.length ||
        Math.max(0,Number(system.justice.prisonPopulation)||0);
      system.justice.prisonOvercrowding=Math.max(0,
        system.justice.prisonPopulation-system.justice.prisonCapacity);
      system.publicServices ||= {};
      Object.assign(system.publicServices,{
        healthIndex:52,educationIndex:38,literacyRate:38,vaccinationCoverage:25,
        welfareCoverage:0,healthOutcomesLastDay:0,educationOutcomesLastDay:0,
        ...system.publicServices
      });
      system.agriculture ||= {};
      Object.assign(system.agriculture,{
        soilFertility:72,forestCover:48,forestStock:Math.max(1000,Math.floor(population*1.8)),
        waterStress:20,foodSecurity:65,pollution:4,harvestIndex:65,
        resourceReserves:{},...system.agriculture
      });
      system.agriculture.resourceReserves ||= {};
      system.agriculture.resourceReserves.timber ??= system.agriculture.forestStock;
      system.agriculture.resourceReserves.ore ??= Math.max(500,Math.floor(population*.9));
      system.agriculture.resourceReserves.stone ??= Math.max(1000,Math.floor(population*2.2));
      system.labour ||= {};
      Object.assign(system.labour,{
        unemploymentRate:35,averageWageIndex:100,labourTension:15,
        workforce:Math.floor(population*.55),employed:0,productivityIndex:50,
        ...system.labour
      });
      system.administration ||= {};
      Object.assign(system.administration,{
        civilServants:Math.max(2,Math.ceil(population/350)),
        requiredStaff:Math.max(2,Math.ceil(population/300)),efficiency:55,
        serviceBacklog:0,corruptionRisk:18,taxRatePermille:55,
        taxBaseEstimate:0,taxRevenueEstimate:0,...system.administration
      });
      system.publicBudget ||= {};
      Object.assign(system.publicBudget,{
        dailyAllocations:{health:0,education:0,justice:0,policing:0,welfare:0,environment:0,administration:0},
        spentByCategory:{},spentLastDay:0,unfundedLastDay:0,fundedPercent:100,lastExecutedDay:0,
        ...system.publicBudget
      });
      system.publicBudget.dailyAllocations ||= {};
      Object.assign(system.publicBudget.dailyAllocations,{
        health:0,education:0,justice:0,policing:0,welfare:0,environment:0,administration:0,
        ...system.publicBudget.dailyAllocations
      });
      system.publicBudget.spentByCategory ||= {};
      system.finance ||= {};
      Object.assign(system.finance,{
        publicDebt:0,creditRating:65,monthlyBalance:0,
        estimatedTaxRevenue:0,actualTaxCollectedToday:0,publicExpenditureToday:0,
        tradeBalance:0,imports:0,exports:0,...system.finance
      });
      system.media ||= {};
      Object.assign(system.media,{
        pressFreedom:55,publicConfidence:48,disinformationPressure:12,
        outlets:[],published:[],publishedToday:0,...system.media
      });
      system.media.outlets ||= [];
      if (!system.media.outlets.length) system.media.outlets=[
        {id:'public-bulletin',name:'State Gazette',type:'public',
          circulation:Math.max(100,Math.floor(population*.35)),credibility:62},
        {id:'independent-press',name:'Independent Journal',type:'independent',
          circulation:Math.max(50,Math.floor(population*.18)),credibility:70}
      ];
      system.media.published ||= [];
      system.intelligence ||= {};
      Object.assign(system.intelligence,{
        agencyName:'State Intelligence Office',capacity:35,counterintelligence:30,
        reports:[],threatLevel:10,knownWars:0,unresolvedReports:0,...system.intelligence
      });
      system.intelligence.reports ||= [];
      system.diplomacy ||= {};
      Object.assign(system.diplomacy,{
        reputation:50,relations:[],activeTreaties:0,activeWars:0,
        internationalIncidents:0,embassies:0,...system.diplomacy
      });
      system.society ||= {};
      Object.assign(system.society,{
        socialMobility:38,inequalityIndex:42,cohesion:55,groups:[],
        petitions:[],lastPetitionDay:0,resolvedPetitions:0,...system.society
      });
      system.society.petitions ||= [];
      system.society.resolvedPetitions=Math.max(0,Number(system.society.resolvedPetitions)||0);
      if(!system.society.groups.length) system.society.groups=[
        {id:'workers',name:'Workers and households',shareBasisPoints:6200,influence:45},
        {id:'professionals',name:'Professionals and traders',shareBasisPoints:2600,influence:35},
        {id:'landholders',name:'Landholders and owners',shareBasisPoints:1200,influence:20}
      ];
      system.identity ||= {};
      Object.assign(system.identity,{
        cultureGroups:[],religionGroups:[],ideologyGroups:[],
        rightsProtection:55,identityTension:12,...system.identity
      });
      if(!system.identity.cultureGroups.length) system.identity.cultureGroups=[
        {id:'regional-majority',name:'Regional majority',shareBasisPoints:7800},
        {id:'regional-minorities',name:'Regional minorities',shareBasisPoints:1500},
        {id:'cosmopolitan',name:'Cosmopolitan communities',shareBasisPoints:700}
      ];
      if(!system.identity.religionGroups.length) system.identity.religionGroups=[
        {id:'major-faith',name:'Major faith communities',shareBasisPoints:5800},
        {id:'minor-faiths',name:'Other faith communities',shareBasisPoints:1500},
        {id:'secular',name:'Secular and unaffiliated',shareBasisPoints:2700}
      ];
      if(!system.identity.ideologyGroups.length) system.identity.ideologyGroups=[
        {id:'social',name:'Social reform',shareBasisPoints:3400},
        {id:'liberal',name:'Liberal institutions',shareBasisPoints:3300},
        {id:'traditional',name:'Traditionalist',shareBasisPoints:2300},
        {id:'regional',name:'Regionalist',shareBasisPoints:1000}
      ];
      system.military ||= {};
      Object.assign(system.military,{
        readiness:35,logisticsCoverage:45,defencePosture:'frontier',
        supplyShortfall:0,personnel:0,...system.military
      });
      system.research ||= {};
      Object.assign(system.research,{
        humanCapital:38,innovationIndex:12,researchCapacity:0,...system.research
      });
      system.landUse ||= {};
      Object.assign(system.landUse,{
        urbanShare:Math.min(100,Math.max(2,Math.round(population/1500))),
        farmlandShare:24,forestShare:48,wildernessShare:28,
        protectedLandShare:12,territorialPressure:15,...system.landUse
      });
      system.crises ||= [];
      system.indicators ||= {};
      return system;
    }
    system={
      stateId:territory.stateId,version:1,lastAdvancedDay:Math.max(0,(game.day||1)-1),
      policy:{healthInvestment:50,educationInvestment:50,environmentalRegulation:40,welfareInvestment:20},
      legitimacy:55,publicTrust:50,stability:55,
      justice:{
        policePerThousand:2.2,courtCases:[],caseRemainder:0,
        publicOrder:55,crimeRatePerThousandYear:24,
        courtCapacityPerDay:Math.max(1,Math.floor(population/12000)),
        prisonCapacity:Math.max(10,Math.ceil(population*0.012)),
        prisonPopulation:0,prisoners:[],releasesLastDay:0,
        convictionsLastDay:0,resolvedLastDay:0,
        pendingCases:0,reportedCases:0,caseSequence:0
      },
      publicServices:{
        healthIndex:52,educationIndex:38,literacyRate:38,
        vaccinationCoverage:25,welfareCoverage:0,
        healthOutcomesLastDay:0,educationOutcomesLastDay:0
      },
      agriculture:{
        soilFertility:72,forestCover:48,forestStock:Math.max(1000,Math.floor(population*1.8)),
        waterStress:20,foodSecurity:65,resourceReserves:{
          timber:Math.max(1000,Math.floor(population*1.8)),
          ore:Math.max(500,Math.floor(population*.9)),
          stone:Math.max(1000,Math.floor(population*2.2))
        },pollution:4,harvestIndex:65
      },
      labour:{
        unemploymentRate:Math.max(0,Math.min(100,100-(Number(territory.jobCapacity||0)/Math.max(1,population*.55))*100)),
        averageWageIndex:100,labourTension:15,workforce:Math.floor(population*.55),
        employed:Math.min(Math.floor(population*.55),integer(territory.jobCapacity)),
        productivityIndex:50
      },
      administration:{
        civilServants:Math.max(2,Math.ceil(population/350)),
        requiredStaff:Math.max(2,Math.ceil(population/300)),
        efficiency:55,serviceBacklog:0,corruptionRisk:18,
        taxRatePermille:55,taxBaseEstimate:0,taxRevenueEstimate:0
      },
      finance:{
        publicDebt:0,creditRating:65,monthlyBalance:0,
        estimatedTaxRevenue:0,tradeBalance:0,imports:0,exports:0,
        publicExpenditureToday:0
      },
      publicBudget:{
        dailyAllocations:{health:0,education:0,justice:0,policing:0,welfare:0,environment:0,administration:0},
        spentByCategory:{},spentLastDay:0,unfundedLastDay:0,fundedPercent:100,lastExecutedDay:0
      },
      media:{
        pressFreedom:55,publicConfidence:48,disinformationPressure:12,
        outlets:[
          {id:'public-bulletin',name:'State Gazette',type:'public',circulation:Math.max(100,Math.floor(population*.35)),credibility:62},
          {id:'independent-press',name:'Independent Journal',type:'independent',circulation:Math.max(50,Math.floor(population*.18)),credibility:70}
        ],published:[],publishedToday:0
      },
      intelligence:{
        agencyName:'State Intelligence Office',capacity:35,counterintelligence:30,
        reports:[],threatLevel:10,knownWars:0,unresolvedReports:0
      },
      diplomacy:{
        reputation:50,relations:[],activeTreaties:0,activeWars:0,
        internationalIncidents:0,embassies:0
      },
      society:{
        socialMobility:38,inequalityIndex:42,cohesion:55,
        petitions:[],lastPetitionDay:0,resolvedPetitions:0,
        groups:[
          {id:'workers',name:'Workers and households',shareBasisPoints:6200,influence:45},
          {id:'professionals',name:'Professionals and traders',shareBasisPoints:2600,influence:35},
          {id:'landholders',name:'Landholders and owners',shareBasisPoints:1200,influence:20}
        ]
      },
      identity:{
        cultureGroups:[
          {id:'regional-majority',name:'Regional majority',shareBasisPoints:7800},
          {id:'regional-minorities',name:'Regional minorities',shareBasisPoints:1500},
          {id:'cosmopolitan',name:'Cosmopolitan communities',shareBasisPoints:700}
        ],
        religionGroups:[
          {id:'major-faith',name:'Major faith communities',shareBasisPoints:5800},
          {id:'minor-faiths',name:'Other faith communities',shareBasisPoints:1500},
          {id:'secular',name:'Secular and unaffiliated',shareBasisPoints:2700}
        ],
        ideologyGroups:[
          {id:'social',name:'Social reform',shareBasisPoints:3400},
          {id:'liberal',name:'Liberal institutions',shareBasisPoints:3300},
          {id:'traditional',name:'Traditionalist',shareBasisPoints:2300},
          {id:'regional',name:'Regionalist',shareBasisPoints:1000}
        ],
        rightsProtection:55,identityTension:12
      },
      military:{
        readiness:35,logisticsCoverage:45,defencePosture:'frontier',
        supplyShortfall:0,personnel:0
      },
      research:{
        humanCapital:38,innovationIndex:12,researchCapacity:0
      },
      landUse:{
        urbanShare:Math.min(100,Math.max(2,Math.round(population/1500))),
        farmlandShare:24,forestShare:48,wildernessShare:28,
        protectedLandShare:12,territorialPressure:15
      },
      crises:[],indicators:{},lastReportDay:0
    };
    game.civicSystems.push(system);
    return system;
  }

  function initialize(game) {
    if (!game || !Array.isArray(game.territories))
      throw new Error('Civic systems require a valid territory collection.');
    for (const territory of game.territories) ensureState(game,territory);
    game.civicSystemsVersion=1;
    game.internationalIncidents ||= [];
    game.embassyMissions ||= [];
    return game.civicSystems;
  }

  function marketPressure(game,stateId) {
    const entries=(game.marketHistory||[]).filter(item=>
      item.stateId===stateId && item.worldDate===game.worldDate);
    const demand=sum(entries.map(item=>item.demand));
    const unmet=sum(entries.map(item=>item.unmetDemand));
    return demand>0?clamp(unmet/demand*100):0;
  }

  function updateJustice(game,territory,system,population,unemployment,shortage) {
    const justice=system.justice;
    const risk=clamp(12+unemployment*.45+shortage*.18+(55-justice.publicOrder)*.16,5,95);
    justice.crimeRatePerThousandYear=Math.round(risk*10)/10;
    const numerator=population*risk+(Number(justice.caseRemainder)||0);
    const newCases=Math.floor(numerator/365000);
    justice.caseRemainder=numerator-newCases*365000;
    const budgetSpend=system.publicBudget?.spentByCategory||{};
    const caseCapacity=Math.max(1,Math.floor(population/10000)+1+
      Math.floor((Number(budgetSpend.justice)||0)/5000));
    const availableSlots=Math.max(0,500-justice.courtCases.length);
    const acceptedCases=Math.min(newCases,availableSlots);
    for(let index=0;index<acceptedCases;index++) {
      justice.caseSequence++;
      const severity=((justice.caseSequence+game.day)%11===0)?'serious':'minor';
      justice.courtCases.push({
        id:'case-'+territory.stateId+'-'+justice.caseSequence,
        reportedDay:game.day,offence:severity==='serious'?'violent offence':'property offence',
        severity,status:'reported',evidenceScore:0,
        defaultSentenceDays:severity==='serious'?18:5,
        investigationAttempts:0
      });
    }
    justice.reportedCases+=acceptedCases;
    justice.resolvedLastDay=0;
    justice.convictionsLastDay=0;
    justice.casesAdjudicatedToday=0;
    justice.courtCapacityPerDay=caseCapacity;
    justice.courtCases=justice.courtCases.filter(item=>
      ['reported','investigated','awaitingTrial','appealPending'].includes(item.status) ||
      (Number.isFinite(item.resolvedDay) && game.day-item.resolvedDay<=30));
    justice.pendingCases=justice.courtCases.filter(item=>
      ['reported','investigated','awaitingTrial','appealPending'].includes(item.status)).length;
    justice.awaitingTrial=justice.courtCases.filter(item=>item.status==='awaitingTrial').length;
    justice.prisonCapacity=Math.max(10,Math.ceil(population*.012));
    justice.prisoners ||= [];
    const detainedBefore=justice.prisoners.length;
    justice.prisoners=justice.prisoners.filter(item=>Number(item.releaseOnDay)>game.day);
    justice.releasesLastDay=detainedBefore-justice.prisoners.length;
    justice.prisonPopulation=justice.prisoners.length;
    if(justice.releasesLastDay>0)
      event(game,territory.stateId,'justice.prisoners_released',
        justice.releasesLastDay+' prisoner(s) completed their custodial sentences in '+territory.name+'.');
    justice.prisonOvercrowding=Math.max(0,justice.prisonPopulation-justice.prisonCapacity);
    const policeCoverage=clamp(justice.policePerThousand*25);
    const policingSpend=Number(budgetSpend.policing)||0;
    const justiceSpend=Number(budgetSpend.justice)||0;
    justice.publicOrder=clamp(justice.publicOrder+
      (policeCoverage-55)*.006+(territory.prosperity-50)*.003-
      unemployment*.009-shortage*.006+(justice.pendingCases>justice.courtCapacityPerDay*8?-.08:0)+
      Math.min(.12,policingSpend/250000)+Math.min(.06,justiceSpend/500000));
  }

  function updateServices(territory,system,population,workingAge,shortage) {
    const services=system.publicServices;
    const health=clamp(territory.healthCoverage);
    const education=clamp(territory.educationCoverage);
    const water=clamp(territory.waterCoverage);
    const food=clamp(territory.foodCoverage);
    const policy=system.policy||{};
    const budgetSpend=system.publicBudget?.spentByCategory||{};
    const healthDelta=(health-55)*.003+(water-60)*.002+(food-60)*.0015+
      ((Number(policy.healthInvestment??50)-50)*.00012)+
      Math.min(.08,(Number(budgetSpend.health)||0)/250000);
    const educationDelta=(education-48)*.002+(territory.prosperity-50)*.0008+
      ((Number(policy.educationInvestment??50)-50)*.0001)+
      Math.min(.08,(Number(budgetSpend.education)||0)/250000);
    services.healthOutcomesLastDay=Math.round(healthDelta*1000)/1000;
    services.educationOutcomesLastDay=Math.round(educationDelta*1000)/1000;
    services.healthIndex=clamp(services.healthIndex+healthDelta);
    services.educationIndex=clamp(services.educationIndex+educationDelta);
    services.literacyRate=clamp(services.literacyRate+Math.max(0,educationDelta*.3));
    services.vaccinationCoverage=clamp(services.vaccinationCoverage+
      (health>70?.015:health<25?-.01:0));
    const unemployed=Math.max(0,workingAge-integer(territory.jobCapacity));
    const welfareIntensity=clamp((policy.welfareInvestment??20)+
      (Number(budgetSpend.welfare)||0)/500);
    services.welfareCoverage=workingAge>0
      ? clamp(Math.min(unemployed/workingAge*100,welfareIntensity)):0;
    return {health,education,water,food,population,workingAge,shortage};
  }

  function updateAgriculture(game,territory,system,population,shortage,services) {
    const land=system.landUse;
    const agriculture=system.agriculture;
    const foodCompanies=(game.companies||[]).filter(item=>item.stateId===territory.stateId &&
      /agric|farm|food/i.test(String(item.sector||item.name||'')));
    const timberCompanies=(game.companies||[]).filter(item=>item.stateId===territory.stateId &&
      /forest|timber|sawmill/i.test(String(item.sector||item.name||'')));
    const production=(game.productionHistory||[]).filter(item=>
      item.stateId===territory.stateId && item.worldDate===game.worldDate);
    const foodOutput=sum(production.map(item=>Number(item.outputsProduced?.grain)||0));
    const timberOutput=sum(production.map(item=>Number(item.outputsProduced?.timber)||0));
    const oreOutput=sum(production.map(item=>Number(item.outputsProduced?.ore)||0));
    const stoneOutput=sum(production.map(item=>Number(item.outputsProduced?.stone)||0));
    agriculture.harvestIndex=clamp(45+foodOutput/Math.max(1,population)*1000);
    agriculture.foodSecurity=clamp(100-shortage*.8);
    agriculture.waterStress=clamp(100-(Number(territory.waterCoverage)||0));
    agriculture.soilFertility=clamp(agriculture.soilFertility+
      (land.farmlandShare>38?-.012:.004)-(shortage>55?.006:0));
    agriculture.forestStock=Math.max(0,agriculture.forestStock-timberOutput+
      Math.max(1,Math.floor(agriculture.forestStock*.00004)));
    agriculture.resourceReserves.timber=agriculture.forestStock;
    agriculture.resourceReserves.ore=Math.max(0,agriculture.resourceReserves.ore-oreOutput);
    agriculture.resourceReserves.stone=Math.max(0,agriculture.resourceReserves.stone-stoneOutput);
    agriculture.forestCover=clamp(agriculture.forestStock/Math.max(1,population*1.8)*48);
    const regulation=clamp(system.policy?.environmentalRegulation??40);
    const environmentSpend=Number(system.publicBudget?.spentByCategory?.environment)||0;
    agriculture.pollution=clamp(agriculture.pollution+
      Math.max(0,(game.companies||[]).filter(item=>item.stateId===territory.stateId).length-2)*.006-
      (agriculture.forestCover>35?.004:0)-(regulation-40)*.0002-
      Math.min(.08,environmentSpend/250000));
    agriculture.soilFertility=clamp(agriculture.soilFertility+
      Math.min(.025,environmentSpend/800000));
    land.territorialPressure=clamp(land.urbanShare+land.farmlandShare-35);
    return {foodOutput,timberOutput,soilFertility:agriculture.soilFertility};
  }

  function updateLabourFinance(game,territory,system,population,workingAge) {
    const labour=system.labour;
    const workforce=workingAge;
    const jobs=Math.min(workforce,integer(territory.jobCapacity));
    labour.workforce=workforce;
    labour.employed=jobs;
    labour.privateEmployees=Math.min(jobs,integer(territory.companyEmployees));
    labour.otherEmployed=Math.max(0,jobs-labour.privateEmployees);
    labour.companyPositions=integer(territory.companyWorkersRequired);
    labour.companyVacancies=integer(territory.companyVacancies);
    labour.averageDailyCashWage=integer(territory.companyEmployees)>0
      ?Math.round(integer(territory.dailyPayrollDue)/integer(territory.companyEmployees)):0;
    labour.dailyPayrollDue=integer(territory.dailyPayrollDue);
    labour.dailyPayrollPaid=integer(territory.dailyPayrollPaid);
    labour.wageArrears=integer(territory.wageArrears);
    labour.householdWageIncome=integer(territory.householdWageIncomeToday);
    labour.householdCashReserves=sum((game.populationGroups||[])
      .filter(group=>group.stateId===territory.stateId)
      .map(group=>Math.max(0,Number(group.cashBalances?.[territory.currencyId])||0)));
    labour.householdSpendingToday=sum((game.populationFinancialTransactions||[])
      .filter(item=>item.stateId===territory.stateId && item.worldDate===game.worldDate &&
        item.type==='Consumption')
      .map(item=>Math.max(0,-Number(item.amount)||0)));
    labour.unemploymentRate=workforce>0?clamp((workforce-jobs)/workforce*100):0;
    labour.averageWageIndex=clamp(labour.averageWageIndex+
      (jobs/Math.max(1,workforce)-.72)*.035);
    labour.productivityIndex=clamp(45+territory.prosperity*.35+
      system.publicServices.educationIndex*.2);
    labour.labourTension=clamp(labour.unemploymentRate*.52+
      system.agriculture.pollution*.3+(50-territory.prosperity)*.2);
    const finance=system.finance;
    const revenue=integer(territory.treasury);
    const monthlyBalance=Number(territory.monthlyBalance||0);
    finance.monthlyBalance=monthlyBalance;
    finance.publicDebt=Math.max(0,finance.publicDebt+
      (monthlyBalance<0?Math.ceil(Math.abs(monthlyBalance)/30):-
        Math.min(finance.publicDebt,Math.floor(Math.max(0,monthlyBalance)/100))));
    finance.creditRating=clamp(75-finance.publicDebt/5000+territory.prosperity*.2);
    const sales=(game.companyFinancialTransactions||[]).filter(item=>
      item.stateId===territory.stateId && item.worldDate===game.worldDate &&
      (item.type==='TradeSale'||item.type==='TradePurchase'));
    const exports=sum(sales.filter(item=>item.type==='TradeSale').map(item=>Math.max(0,Number(item.amount)||0)));
    const imports=sum(sales.filter(item=>item.type==='TradePurchase').map(item=>Math.max(0,Number(item.amount)||0)));
    finance.exports=exports;
    finance.imports=imports;
    finance.tradeBalance=exports-imports;
    const collectedTax=sum((game.financialTransactions||[]).filter(item=>
      item.stateId===territory.stateId && item.worldDate===game.worldDate &&
      item.type==='marketSalesTax').map(item=>Math.max(0,Number(item.amount)||0)));
    finance.actualTaxCollectedToday=collectedTax;
    finance.estimatedTaxRevenue=collectedTax;
    finance.treasuryObserved=revenue;
    system.administration.taxBaseEstimate=exports+imports;
    system.administration.taxRevenueEstimate=collectedTax;
  }

  function updateAdministration(system,population,unemployment,justice) {
    const admin=system.administration;
    admin.requiredStaff=Math.max(2,Math.ceil(population/300)+Math.ceil(justice.pendingCases/10));
    admin.civilServants=Math.max(0,Math.min(100000,admin.civilServants));
    const staffing=clamp(admin.civilServants/Math.max(1,admin.requiredStaff)*100);
    const administrationSpend=Number(system.publicBudget?.spentByCategory?.administration)||0;
    admin.efficiency=clamp(45+staffing*.35-unemployment*.12-admin.corruptionRisk*.16+
      Math.min(.8,administrationSpend/30000));
    admin.serviceBacklog=Math.max(0,admin.serviceBacklog+
      Math.max(0,admin.requiredStaff-admin.civilServants)*.08-
      Math.max(0,staffing-75)*.04-1);
    admin.corruptionRisk=clamp(admin.corruptionRisk+
      (staffing<45?.01:-.006)+(system.media.pressFreedom<25?.012:0));
  }

  function updateEmbassyMissions(game) {
    game.embassyMissions ||= [];
    game.financialTransactions ||= [];
    const territories=game.territories||[];
    const territoryFor=id=>territories.find(item=>item.stateId===id);
    const relationFor=(a,b)=>(game.diplomaticRelations||[]).find(item=>
      (item.stateAId===a && item.stateBId===b)||(item.stateAId===b && item.stateBId===a));
    const refundDeposit=mission=>{
      const payer=territoryFor(mission.proposingStateId);
      if(!payer || !integer(mission.deposit)) return;
      const before=integer(payer.treasury);
      const amount=Math.min(mission.deposit,2147483647-before);
      payer.treasury=before+amount;
      game.financialTransactions.push({
        id:'embassy-refund-'+mission.id,stateId:payer.stateId,currencyId:payer.currencyId,
        type:'embassyProposalRefund',amount,balanceBefore:before,balanceAfter:payer.treasury,
        description:'Refund for an expired or rejected diplomatic mission proposal.',
        worldDate:game.worldDate,recordedAtUtc:new Date().toISOString(),orderId:null,membershipId:null
      });
    };
    for(const mission of game.embassyMissions) {
      if(mission.status==='pending' && Number(mission.expiresDay)<=game.day) {
        mission.status='expired';
        mission.resolvedDay=game.day;
        refundDeposit(mission);
        event(game,mission.proposingStateId,'diplomacy.embassy_proposal_expired',
          'A diplomatic mission proposal expired without a response.');
        continue;
      }
      if(!['active','suspended'].includes(mission.status)) continue;
      const relation=relationFor(mission.proposingStateId,mission.targetStateId);
      if(relation?.status==='war') {
        if(mission.status!=='suspended') {
          mission.status='suspended';
          mission.suspendedReason='war';
          event(game,mission.proposingStateId,'diplomacy.embassy_suspended',
            'A diplomatic mission was suspended because the two States entered a war.');
        }
        continue;
      }
      if(mission.status==='suspended' && mission.suspendedReason==='war') {
        mission.status='active';
        mission.suspendedReason=null;
        event(game,mission.proposingStateId,'diplomacy.embassy_reopened',
          'A diplomatic mission resumed after hostilities ended.');
      }
      if(mission.lastMaintenanceDay>=game.day) continue;
      const source=territoryFor(mission.proposingStateId);
      const target=territoryFor(mission.targetStateId);
      const upkeep=Math.max(1,integer(mission.dailyUpkeep)||2);
      if(!source || !target || integer(source.treasury)<upkeep || integer(target.treasury)<upkeep) {
        mission.status='closed';
        mission.closedDay=game.day;
        mission.closedReason='insufficient_funds';
        event(game,mission.proposingStateId,'diplomacy.embassy_closed',
          'A diplomatic mission closed because one of the governments could not meet its daily maintenance cost.');
        continue;
      }
      for(const participant of [source,target]) {
        const before=integer(participant.treasury);
        participant.treasury=before-upkeep;
        game.financialTransactions.push({
          id:'embassy-upkeep-'+mission.id+'-'+participant.stateId+'-'+game.day,
          stateId:participant.stateId,currencyId:participant.currencyId,
          type:'embassyMaintenance',amount:-upkeep,balanceBefore:before,
          balanceAfter:participant.treasury,
          description:'Daily diplomatic mission maintenance.',worldDate:game.worldDate,
          recordedAtUtc:new Date().toISOString(),orderId:null,membershipId:null
        });
      }
      mission.lastMaintenanceDay=game.day;
      if(relation && relation.status!=='war')
        relation.relationScore=Math.min(100,(Number(relation.relationScore)||0)+.1);
    }
  }

  function updateDiplomacy(game,territory,system) {
    updateEmbassyMissions(game);
    const relations=(game.diplomaticRelations||[]).filter(item=>
      item.stateAId===territory.stateId||item.stateBId===territory.stateId);
    const treaties=(game.treaties||[]).filter(item=>item.status==='active' &&
      (item.stateAId===territory.stateId||item.stateBId===territory.stateId));
    const wars=relations.filter(item=>item.status==='war');
    system.diplomacy.relations=relations.map(item=>({
      stateId:item.stateAId===territory.stateId?item.stateBId:item.stateAId,
      status:item.status,relationScore:Number(item.relationScore)||0
    }));
    system.diplomacy.activeTreaties=treaties.length;
    system.diplomacy.activeWars=wars.length;
    system.diplomacy.embassies=(game.embassyMissions||[]).filter(item=>
      item.status==='active' &&
      (item.proposingStateId===territory.stateId || item.targetStateId===territory.stateId)).length;
    system.diplomacy.reputation=clamp(50+sum(relations.map(item=>Number(item.relationScore)||0))/
      Math.max(1,relations.length)*.45+treaties.length*2-wars.length*12);
    system.military.readiness=clamp(sum((game.militaryUnits||[])
      .filter(item=>item.stateId===territory.stateId)
      .map(item=>(Number(item.morale)||0)*Math.min(1,(Number(item.personnel)||0)/
        Math.max(1,Number(item.maxPersonnel)||1))))/
      Math.max(1,(game.militaryUnits||[]).filter(item=>item.stateId===territory.stateId).length));
    system.military.personnel=sum((game.militaryUnits||[])
      .filter(item=>item.stateId===territory.stateId).map(item=>integer(item.personnel)));
    system.military.supplyShortfall=(game.supplyRoutes||[]).filter(item=>
      item.stateId===territory.stateId && item.status==='blocked').length;
    system.military.logisticsCoverage=clamp(100-system.military.supplyShortfall*15);
    system.military.readiness=clamp(system.military.readiness-system.military.supplyShortfall*8);
    system.intelligence.knownWars=wars.length;
    system.intelligence.threatLevel=clamp(wars.length*38+
      Math.max(0,55-system.justice.publicOrder)*.45+relations.filter(item=>item.status==='hostile').length*15);
  }

  function updateMediaAndIntelligence(game,territory,system) {
    const media=system.media;
    const newEvents=(game.events||[]).filter(item=>item.stateId===territory.stateId &&
      item.worldDate===game.worldDate && item.type!=='media.published');
    media.publishedToday=0;
    for(const item of newEvents.slice(0,3)) {
      const publication={
        id:'news-'+territory.stateId+'-'+game.day+'-'+(media.published.length+1),
        day:game.day,worldDate:game.worldDate,headline:item.description,
        source:media.outlets[media.published.length%media.outlets.length]?.name||'State Gazette',
        sourceEventId:item.id,verified:true
      };
      media.published.unshift(publication);
      media.publishedToday++;
    }
    if(!media.publishedToday && game.day%7===0) {
      media.published.unshift({
        id:'news-'+territory.stateId+'-'+game.day+'-weekly',
        day:game.day,worldDate:game.worldDate,
        headline:'Weekly public report: prosperity '+Math.round(territory.prosperity)+
          '/100; public order '+Math.round(system.justice.publicOrder)+'/100.',
        source:media.outlets[1]?.name||'Independent Journal',verified:true
      });
    }
    if(media.published.length>100) media.published.length=100;
    media.publicConfidence=clamp(media.publicConfidence+
      (system.justice.publicOrder-50)*.002+(media.pressFreedom-50)*.001-
      media.disinformationPressure*.001);
    const intelligence=system.intelligence;
    intelligence.unresolvedReports=intelligence.reports.filter(item=>item.status==='pending').length;
    intelligence.reports=intelligence.reports.filter(item=>game.day-item.createdDay<=60);
    if(system.diplomacy.activeWars>0 || system.justice.publicOrder<28 ||
      system.agriculture.foodSecurity<25) {
      const threat=system.diplomacy.activeWars>0?'foreign military threat':
        system.justice.publicOrder<28?'domestic instability':'food-security threat';
      if(!intelligence.reports.some(item=>item.threat===threat && item.status==='pending')) {
        intelligence.reports.unshift({
          id:'intel-'+territory.stateId+'-'+game.day,threat,
          createdDay:game.day,confidence:clamp(intelligence.capacity+
            intelligence.counterintelligence*.2),status:'pending',
          assessment:'Assessment generated from observable world conditions.'
        });
      }
    }
  }

  function rebalanceShares(groups,metric) {
    if(!Array.isArray(groups)||!groups.length) return;
    const total=sum(groups.map(item=>integer(item.shareBasisPoints)));
    if(total<=0) {
      const each=Math.floor(10000/groups.length);
      groups.forEach((item,index)=>item.shareBasisPoints=index===groups.length-1?10000-each*(groups.length-1):each);
      return;
    }
    let allocated=0;
    groups.forEach((item,index)=>{
      item.shareBasisPoints=index===groups.length-1?10000-allocated:
        Math.round(integer(item.shareBasisPoints)*10000/total);
      allocated+=item.shareBasisPoints;
    });
  }

  function updateIdentityAndSociety(system,territory,unemployment,shortage) {
    const society=system.society;
    society.cohesion=clamp(society.cohesion+
      (territory.prosperity-50)*.002+(system.justice.publicOrder-50)*.002-
      unemployment*.004-shortage*.002);
    society.inequalityIndex=clamp(society.inequalityIndex+
      (unemployment>20?.018:-.006)+(territory.prosperity>70?.004:0));
    society.socialMobility=clamp(society.socialMobility+
      (system.publicServices.educationIndex-45)*.002-
      (society.inequalityIndex-45)*.001);
    const identity=system.identity;
    identity.rightsProtection=clamp(identity.rightsProtection+
      (system.media.pressFreedom-50)*.001+(system.justice.publicOrder-50)*.001);
    identity.identityTension=clamp(identity.identityTension+
      (50-identity.rightsProtection)*.001+
      (50-society.cohesion)*.0015);
    for(const collection of [society.groups,identity.cultureGroups,
      identity.religionGroups,identity.ideologyGroups]) rebalanceShares(collection);
    for(const group of society.groups)
      group.influence=clamp(10000/group.shareBasisPoints*20,5,80);
  }

  function updatePublicPetitions(game,territory,system,unemployment,shortage) {
    const society=system.society;
    society.petitions ||= [];
    const active=society.petitions.filter(item=>item.status==='pending');
    for(const petition of active) {
      if(Number(petition.expiresDay)<=game.day) {
        petition.status='expired';
        petition.resolvedDay=game.day;
        petition.response='No executive response was recorded before expiry.';
        society.resolvedPetitions=(Number(society.resolvedPetitions)||0)+1;
        event(game,territory.stateId,'society.petition_expired',
          'A public petition expired without an executive decision in '+territory.name+'.');
      }
    }
    if(active.length>=4 || game.day-(Number(society.lastPetitionDay)||0)<5) return;
    const groups=society.groups||[];
    const source=(id)=>groups.find(item=>item.id===id)||groups[0]||{
      id:'residents',name:'Residents',shareBasisPoints:10000
    };
    const candidates=[
      {id:'employment',condition:unemployment>=24,severity:clamp((unemployment-18)*1.8,0,100),
        title:'Employment and household security',group:'workers',policyId:'welfareInvestment',
        increment:18,rationale:'Unemployment has remained high and household income security is under pressure.'},
      {id:'food-security',condition:shortage>=35,severity:clamp(shortage,0,100),
        title:'Affordable food and essential supplies',group:'workers',policyId:'welfareInvestment',
        increment:14,rationale:'A substantial share of essential market demand is not being met.'},
      {id:'education',condition:system.publicServices.educationIndex<38,severity:clamp(48-system.publicServices.educationIndex,0,100),
        title:'Expanded education and training',group:'professionals',policyId:'educationInvestment',
        increment:20,rationale:'Education outcomes are below the minimum development threshold.'},
      {id:'equal-rights',condition:system.identity.rightsProtection<38 || system.identity.identityTension>38,
        severity:clamp(Math.max(42-system.identity.rightsProtection,system.identity.identityTension-25),0,100),
        title:'Equal rights and civic protections',group:'professionals',policyId:'pressFreedom',
        increment:16,rationale:'Rights protection and social tension indicate a need for stronger civic safeguards.'},
      {id:'environment',condition:system.agriculture.pollution>=42 || system.agriculture.soilFertility<34,
        severity:clamp(Math.max(system.agriculture.pollution-30,42-system.agriculture.soilFertility),0,100),
        title:'Environmental protection and conservation',group:'landholders',policyId:'environmentalRegulation',
        increment:20,rationale:'Pollution or declining soil fertility is creating long-term pressure on the territory.'},
      {id:'cost-of-living',condition:society.inequalityIndex>=62,
        severity:clamp(society.inequalityIndex-45,0,100),title:'Cost of living and social protection',
        group:'workers',policyId:'welfareInvestment',increment:22,
        rationale:'The measured inequality index indicates sustained distributional pressure.'}
    ].filter(item=>item.condition && !active.some(petition=>petition.issueId===item.id))
      .sort((a,b)=>b.severity-a.severity);
    const issue=candidates[0];
    if(!issue) return;
    const constituency=source(issue.group);
    const share=clamp(Number(constituency.shareBasisPoints)||0,0,10000);
    const supportBasisPoints=Math.round(clamp(share*.55+issue.severity*28,350,8500));
    const currentValue=issue.policyId==='pressFreedom'?Number(system.media.pressFreedom)||0:
      Number(system.policy[issue.policyId])||0;
    const requestedValue=Math.min(100,currentValue+issue.increment);
    const petition={
      id:'petition-'+territory.stateId+'-'+game.day+'-'+issue.id,
      issueId:issue.id,title:issue.title,sourceGroupId:constituency.id,
      sourceGroupName:constituency.name,supportBasisPoints,
      estimatedSupport:Math.floor(integer(territory.population)*supportBasisPoints/10000),
      submittedDay:game.day,expiresDay:game.day+30,status:'pending',
      policyId:issue.policyId,previousValue:currentValue,requestedValue,
      severity:Math.round(issue.severity*10)/10,rationale:issue.rationale,
      response:null,resolvedDay:null
    };
    society.petitions.unshift(petition);
    society.lastPetitionDay=game.day;
    if(society.petitions.length>60) society.petitions.length=60;
    event(game,territory.stateId,'society.petition_submitted',
      'Residents submitted a petition on '+issue.title.toLowerCase()+' in '+territory.name+
      ', representing an estimated '+(supportBasisPoints/100).toFixed(1)+'% public support.');
  }

  function updateCrises(game,territory,system,shortage) {
    const conditions=[
      {id:'food-shortage',title:'Food supply crisis',active:shortage>=65,
        severity:shortage>=85?'critical':'major',description:'Market demand for essential goods is not being met.'},
      {id:'public-order',title:'Public order emergency',active:system.justice.publicOrder<25,
        severity:'critical',description:'Public order has fallen below the stability threshold.'},
      {id:'administrative',title:'Administrative breakdown',active:system.administration.efficiency<20,
        severity:'major',description:'State administrative capacity is insufficient for current workload.'},
      {id:'environmental',title:'Environmental stress',active:system.agriculture.pollution>78 ||
        system.agriculture.soilFertility<20,severity:'major',
        description:'Environmental indicators have crossed a critical threshold.'}
    ];
    system.crises ||= [];
    for(const condition of conditions) {
      let crisis=system.crises.find(item=>item.id===condition.id && item.status==='active');
      if(condition.active && !crisis) {
        crisis={id:condition.id,title:condition.title,severity:condition.severity,
          description:condition.description,status:'active',startedDay:game.day,
          lastUpdatedDay:game.day};
        system.crises.push(crisis);
        event(game,territory.stateId,'crisis.started',territory.name+': '+condition.title+'. '+condition.description);
      } else if(condition.active && crisis) {
        crisis.lastUpdatedDay=game.day;
        crisis.severity=condition.severity;
      } else if(!condition.active && crisis) {
        crisis.status='resolved';
        crisis.resolvedDay=game.day;
        event(game,territory.stateId,'crisis.resolved',territory.name+': '+condition.title+' has been resolved.');
      }
    }
    if(system.crises.length>100) system.crises=system.crises.slice(-100);
  }

  function executePublicBudget(game,territory,system) {
    const budget=system.publicBudget;
    if(!budget || budget.lastExecutedDay>=game.day) return 0;
    const categories=['health','education','justice','policing','welfare','environment','administration'];
    const requested=categories.map(category=>({
      category,amount:Math.max(0,Math.floor(Number(budget.dailyAllocations?.[category])||0))
    }));
    const total=requested.reduce((sum,item)=>sum+item.amount,0);
    if(!Number.isSafeInteger(total)) throw new Error('Public daily budget exceeds the supported financial limit.');
    const treasury=integer(territory.treasury||0);
    const spent=Math.min(total,treasury);
    let allocated=0;
    const distributions=requested.map(item=>{
      const exact=total>0?spent*item.amount/total:0;
      const amount=Math.floor(exact);
      allocated+=amount;
      return {...item,spent:amount,fraction:exact-amount};
    });
    let remaining=spent-allocated;
    distributions.sort((a,b)=>b.fraction-a.fraction);
    for(const item of distributions) {
      if(remaining<=0) break;
      if(item.spent<item.amount) {
        item.spent++;
        remaining--;
      }
    }
    territory.treasury=treasury-spent;
    game.financialTransactions ||= [];
    budget.spentByCategory={};
    let ledgerBalance=treasury;
    for(const item of distributions) {
      budget.spentByCategory[item.category]=item.spent;
      if(item.spent<=0) continue;
      const balanceBefore=ledgerBalance;
      ledgerBalance-=item.spent;
      game.financialTransactions.push({
        id:'public-budget-'+territory.stateId+'-'+game.day+'-'+item.category,
        stateId:territory.stateId,currencyId:territory.currencyId,
        type:'publicServiceExpenditure',category:item.category,amount:-item.spent,
        balanceBefore,balanceAfter:ledgerBalance,
        description:'Daily public expenditure: '+item.category+'.',
        worldDate:game.worldDate,recordedAtUtc:new Date().toISOString(),
        orderId:null,membershipId:null
      });
    }
    budget.spentLastDay=spent;
    budget.unfundedLastDay=total-spent;
    budget.fundedPercent=total>0?Math.round(spent/total*1000)/10:100;
    budget.lastExecutedDay=game.day;
    system.finance.publicExpenditureToday=spent;
    if(total>0) {
      event(game,territory.stateId,'finance.public_budget_executed',
        territory.name+' spent '+spent+' of '+total+' in its daily public-service budget.'+
        (total>spent?' '+(total-spent)+' remained unfunded.':''));
    }
    return spent;
  }

  function advanceDay(game) {
    if(!game || !Array.isArray(game.territories))
      throw new Error('Civic simulation received an invalid world.');
    initialize(game);
    for(const territory of game.territories) {
      const system=ensureState(game,territory);
      if(system.lastAdvancedDay>=game.day) continue;
      const population=integer(territory.population);
      const workingAge=integer(territory.demographicIndicators?.workingAge ??
        territory.workingAgePopulation ?? Math.floor(population*.55));
      const shortage=marketPressure(game,territory.stateId);
      executePublicBudget(game,territory,system);
      const jobs=Math.min(workingAge,integer(territory.jobCapacity));
      const unemployment=workingAge>0?clamp((workingAge-jobs)/workingAge*100):0;
      updateJustice(game,territory,system,population,unemployment,shortage);
      const serviceMetrics=updateServices(territory,system,population,workingAge,shortage);
      updateAgriculture(game,territory,system,population,shortage,serviceMetrics);
      updateLabourFinance(game,territory,system,population,workingAge);
      updateAdministration(system,population,unemployment,system.justice);
      updateDiplomacy(game,territory,system);
      updateMediaAndIntelligence(game,territory,system);
      updateIdentityAndSociety(system,territory,unemployment,shortage);
      updatePublicPetitions(game,territory,system,unemployment,shortage);
      system.legitimacy=clamp(territory.prosperity*.34+system.justice.publicOrder*.26+
        system.media.publicConfidence*.2+system.society.cohesion*.2);
      system.publicTrust=clamp(system.media.publicConfidence*.45+
        system.justice.publicOrder*.3+system.publicServices.healthIndex*.15+
        system.publicServices.educationIndex*.1);
      system.stability=clamp(system.justice.publicOrder*.35+
        system.society.cohesion*.35+system.legitimacy*.3);
      system.research.humanCapital=clamp(system.publicServices.educationIndex*.6+
        system.publicServices.literacyRate*.4);
      system.research.researchCapacity=Math.floor(system.research.humanCapital*
        Math.max(1,system.administration.civilServants/100));
      system.research.innovationIndex=clamp(system.research.innovationIndex+
        (system.research.humanCapital-45)*.001);
      system.indicators={
        population,workingAge,unemploymentRate:Math.round(unemployment*10)/10,
        marketShortage:Math.round(shortage*10)/10,
        foodSecurity:system.agriculture.foodSecurity,
        publicOrder:system.justice.publicOrder,
        health:system.publicServices.healthIndex,
        education:system.publicServices.educationIndex,
        stateCapacity:system.administration.efficiency,
        prosperity:territory.prosperity,
        legitimacy:system.legitimacy,
        publicTrust:system.publicTrust
      };
      updateCrises(game,territory,system,shortage);
      system.lastAdvancedDay=game.day;
    }
    game.civicSystemsVersion=1;
    return game.civicSystems;
  }

  const api=Object.freeze({initialize,advanceDay,marketPressure,executePublicBudget});
  globalThis.NewWorldCivicSystems=api;
  if(typeof module!=='undefined' && module.exports) module.exports=api;
})();
