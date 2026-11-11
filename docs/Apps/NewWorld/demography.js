(() => {
  'use strict';

  const clone=value=>structuredClone(value);
  const safeInteger=(value,min=0,max=Number.MAX_SAFE_INTEGER)=>
    Number.isSafeInteger(value) && value>=min && value<=max;
  const leapYear=year=>year%4===0 && (year%100!==0 || year%400===0);
  const daysInYear=year=>leapYear(year)?366:365;
  const makeId=createId=>typeof createId==='function'
    ? createId()
    : 'migration-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,9);

  function validateConfiguration(game,profiles,groups) {
    const errors=[];
    if(!Array.isArray(profiles) || !Array.isArray(groups))
      return {valid:false,errors:['DEMOGRAPHY_ARRAYS_REQUIRED']};
    const stateIds=new Set((game?.territories || []).map(item=>item.stateId));
    const profileStates=new Set();
    for(const profile of profiles) {
      if(!profile || !stateIds.has(profile.stateId)) errors.push('DEMOGRAPHY_STATE_UNKNOWN');
      if(profileStates.has(profile?.stateId)) errors.push('DEMOGRAPHY_DUPLICATE_STATE_PROFILE');
      profileStates.add(profile?.stateId);
      if(!safeInteger(profile?.annualBirthsPerThousand,0,1000))
        errors.push('DEMOGRAPHY_BIRTH_RATE_INVALID:'+profile?.stateId);
      const bands=Array.isArray(profile?.ageBands)?profile.ageBands:[];
      const ordered=bands.slice().sort((a,b)=>Number(a.minAge)-Number(b.minAge));
      let nextAge=0;
      const bandIds=new Set();
      for(const band of ordered) {
        if(!band || typeof band.id!=='string' || !band.id.trim() ||
           bandIds.has(band.id) || !safeInteger(band.minAge,0,120) ||
           !safeInteger(band.maxAge,0,120) || band.maxAge<band.minAge ||
           band.minAge!==nextAge ||
           !safeInteger(band.annualDeathsPerThousand,0,1000)) {
          errors.push('DEMOGRAPHY_AGE_BANDS_INVALID:'+profile?.stateId);
          break;
        }
        bandIds.add(band.id);
        nextAge=band.maxAge+1;
      }
      if(nextAge!==121) errors.push('DEMOGRAPHY_AGE_BANDS_MUST_COVER_0_TO_120:'+profile?.stateId);
      if(profile?.migrationPermissionSetIds!==undefined &&
         (!Array.isArray(profile.migrationPermissionSetIds) ||
          profile.migrationPermissionSetIds.some(item=>typeof item!=='string' || !item)))
        errors.push('DEMOGRAPHY_MIGRATION_PERMISSIONS_INVALID:'+profile?.stateId);
    }
    const territoryByState=new Map((game?.territories || []).map(item=>[item.stateId,item]));
    const groupIds=groups.map(item=>item?.id);
    if(groupIds.some(id=>typeof id!=='string' || !id.trim()) ||
       new Set(groupIds).size!==groupIds.length)
      errors.push('DEMOGRAPHY_GROUP_IDS_INVALID');
    for(const stateId of profileStates) {
      const stateGroups=groups.filter(group=>group?.stateId===stateId);
      if(!stateGroups.length) errors.push('DEMOGRAPHY_GROUPS_MISSING:'+stateId);
      let sum=0;
      for(const group of stateGroups) {
        if(!Array.isArray(group.ageCohorts) || typeof group.locationId!=='string' || !group.locationId.trim()) {
          errors.push('DEMOGRAPHY_COHORTS_OR_LOCATION_MISSING:'+group?.id);
          continue;
        }
        const ages=new Set();
        let groupSum=0;
        for(const cohort of group.ageCohorts) {
          if(!safeInteger(cohort?.ageYears,0,120) ||
             !safeInteger(cohort?.population,0) || ages.has(cohort?.ageYears)) {
            errors.push('DEMOGRAPHY_COHORT_INVALID:'+group.id);
            continue;
          }
          ages.add(cohort.ageYears);
          groupSum+=cohort.population;
          if(!Number.isSafeInteger(groupSum)) errors.push('DEMOGRAPHY_COHORT_SUM_OVERFLOW:'+group.id);
        }
        if(groupSum!==group.population) errors.push('DEMOGRAPHY_GROUP_TOTAL_MISMATCH:'+group.id);
        if(!safeInteger(group.population,0)) errors.push('DEMOGRAPHY_GROUP_POPULATION_INVALID:'+group.id);
        sum+=groupSum;
      }
      const territory=territoryByState.get(stateId);
      if(!Number.isSafeInteger(sum) || sum!==Number(territory?.population))
        errors.push('DEMOGRAPHY_STATE_TOTAL_MISMATCH:'+stateId);
    }
    for(const group of groups) {
      if(!group || typeof group.id!=='string' || !group.id || !stateIds.has(group.stateId))
        errors.push('DEMOGRAPHY_GROUP_ID_OR_STATE_INVALID');
    }
    return {valid:errors.length===0,errors:[...new Set(errors)]};
  }

  function record(game,type,stateId,groupId,quantity,description,details={}) {
    game.demographicEvents ||= [];
    game.eventSequence=(Number(game.eventSequence)||0)+1;
    game.demographicEvents.push({
      id:'demography-'+game.eventSequence,type,stateId,groupId,quantity,
      worldDate:game.worldDate,description,...details
    });
    if(game.demographicEvents.length>5000)
      game.demographicEvents.splice(0,game.demographicEvents.length-5000);
    game.events ||= [];
    game.events.push({
      id:'demography-event-'+game.eventSequence,gameId:game.id,orderId:null,
      actorPlayerId:null,stateId,type:'society.demography_'+type,
      resultCode:null,occurredAtUtc:new Date().toISOString(),worldDate:game.worldDate,
      worldVersion:Number(game.worldVersion||0)+1,description,sequence:game.eventSequence
    });
    if(game.events.length>1000) game.events.splice(0,game.events.length-1000);
    game.activity ||= [];
    game.activity.unshift(description);
    game.activity=game.activity.slice(0,100);
  }

  function advanceDay(game) {
    const profiles=game?.demographicProfiles || [];
    if(!profiles.length) return {ok:true,statesProcessed:0};
    const validation=validateConfiguration(game,profiles,game.populationGroups || []);
    if(!validation.valid) throw new Error('Demographic configuration invalid: '+validation.errors.join(', '));
    const date=String(game.worldDate || '');
    const year=Number(date.slice(0,4));
    const divisor=BigInt(1000*daysInYear(year));
    const yearChanged=date.endsWith('-01-01');
    let birthsTotal=0;
    let deathsTotal=0;
    for(const profile of profiles) {
      const territory=game.territories.find(item=>item.stateId===profile.stateId);
      const groups=game.populationGroups.filter(item=>item.stateId===profile.stateId);
      const bands=profile.ageBands.slice().sort((a,b)=>a.minAge-b.minAge);
      let stateBirths=0;
      let stateDeaths=0;
      for(const group of groups) {
        const populationBefore=group.population;
        if(yearChanged) {
          const aged=new Map();
          for(const cohort of group.ageCohorts) {
            const nextAge=Math.min(120,cohort.ageYears+1);
            aged.set(nextAge,(aged.get(nextAge)||0)+cohort.population);
          }
          group.ageCohorts=[...aged].map(([ageYears,population])=>({ageYears,population}))
            .sort((a,b)=>a.ageYears-b.ageYears);
        }
        group.demographicRemainders ||= {births:0,deathsByAge:{}};
        const birthNumerator=BigInt(group.population)*BigInt(profile.annualBirthsPerThousand)+
          BigInt(group.demographicRemainders.births||0);
        const births=Number(birthNumerator/divisor);
        group.demographicRemainders.births=Number(birthNumerator%divisor);
        const updated=[];
        let deaths=0;
        for(const cohort of group.ageCohorts) {
          const band=bands.find(item=>cohort.ageYears>=item.minAge && cohort.ageYears<=item.maxAge);
          if(!band) throw new Error('No configured mortality band covers age '+cohort.ageYears+'.');
          const remainderKey=String(cohort.ageYears);
          const previousScale=Number(group.demographicRemainders.deathRemainderScale||1);
          if(![1,10000].includes(previousScale))
            throw new Error('Demographic mortality remainder scale is unsupported.');
          const previous=BigInt(group.demographicRemainders.deathsByAge[remainderKey]||0n)*
            BigInt(10000/previousScale);
          const healthReductionBasisPoints=BigInt(Math.max(0,Math.min(10000,
            Math.round(Number(group.healthMortalityReductionPercent||0)*100))));
          const mortalityNumerator=BigInt(cohort.population)*
            BigInt(band.annualDeathsPerThousand)*(10000n-healthReductionBasisPoints);
          const scaledDivisor=divisor*10000n;
          const numerator=mortalityNumerator+previous;
          const lost=Math.min(cohort.population,Number(numerator/scaledDivisor));
          group.demographicRemainders.deathsByAge[remainderKey]=Number(numerator%scaledDivisor);
          group.demographicRemainders.deathRemainderScale=10000;
          deaths+=lost;
          if(cohort.population-lost>0)
            updated.push({ageYears:cohort.ageYears,population:cohort.population-lost});
        }
        if(births>0) {
          const newborn=updated.find(item=>item.ageYears===0);
          if(newborn) newborn.population+=births;
          else updated.push({ageYears:0,population:births});
        }
        updated.sort((a,b)=>a.ageYears-b.ageYears);
        group.ageCohorts=updated;
        group.population=updated.reduce((sum,item)=>sum+item.population,0);
        if(!Number.isSafeInteger(group.population))
          throw new Error('Demographic group population exceeded the safe integer range.');
        group.demographicBirthsLastDay=births;
        group.demographicDeathsLastDay=deaths;
        group.populationChangeLastDay=group.population-populationBefore;
        stateBirths+=births;
        stateDeaths+=deaths;
        birthsTotal+=births;
        deathsTotal+=deaths;
        if(births>0) record(game,'births',profile.stateId,group.id,births,
          births+' births recorded in '+group.name+'.',{cause:'Configured annual birth rate'});
        if(deaths>0) record(game,'deaths',profile.stateId,group.id,deaths,
          deaths+' deaths recorded in '+group.name+'.',{cause:'Configured age-band mortality'});
      }
      const total=groups.reduce((sum,item)=>sum+item.population,0);
      if(!Number.isSafeInteger(total)) throw new Error('State population exceeds the safe integer range.');
      territory.population=total;
      territory.populationGrowthLastDay=stateBirths-stateDeaths;
      territory.demographicBirthsLastDay=stateBirths;
      territory.demographicDeathsLastDay=stateDeaths;
    }
    return {ok:true,statesProcessed:profiles.length,births:birthsTotal,deaths:deathsTotal};
  }

  function allocateTransfer(cohorts,quantity,total) {
    const rows=cohorts.map(cohort=>{
      const numerator=BigInt(quantity)*BigInt(cohort.population);
      return {ageYears:cohort.ageYears,base:Number(numerator/BigInt(total)),
        remainder:numerator%BigInt(total),available:cohort.population};
    });
    let remaining=quantity-rows.reduce((sum,item)=>sum+item.base,0);
    const order=rows.slice().sort((a,b)=>
      a.remainder===b.remainder ? a.ageYears-b.ageYears :
      a.remainder>b.remainder ? -1 : 1);
    for(const row of order) {
      if(remaining<=0) break;
      if(row.base<row.available) {row.base++;remaining--;}
    }
    if(remaining!==0) throw new Error('Population transfer allocation failed.');
    return new Map(rows.map(item=>[item.ageYears,item.base]));
  }

  function movePopulation(game,order,player,membership,createId) {
    if(membership?.permissionSetId==='government-observer')
      return {ok:false,code:'INSUFFICIENT_PERMISSION',error:'Observers cannot move population groups.'};
    const profile=(game.demographicProfiles || []).find(item=>item.stateId===membership?.stateId);
    if(!profile) return {ok:false,code:'DEMOGRAPHY_NOT_CONFIGURED',error:'Configure this State’s demographic profile before moving residents.'};
    if(!Array.isArray(profile.migrationPermissionSetIds) ||
       !profile.migrationPermissionSetIds.includes(membership.permissionSetId))
      return {ok:false,code:'MIGRATION_PERMISSION_DENIED',error:'This government membership is not authorised to move population groups.'};
    const origin=(game.populationGroups || []).find(item=>item.id===order.originGroupId);
    const destination=(game.populationGroups || []).find(item=>item.id===order.destinationGroupId);
    const quantity=Number(order.quantity);
    if(!origin || !destination || origin===destination ||
       origin.stateId!==membership.stateId || destination.stateId!==membership.stateId ||
       !origin.locationId || !destination.locationId || origin.locationId===destination.locationId)
      return {ok:false,code:'MIGRATION_DESTINATION_INVALID',error:'Choose two different configured locations inside this State.'};
    const cohortTotal=group=>{
      if(!Array.isArray(group.ageCohorts)) return null;
      const seen=new Set();
      let total=0;
      for(const cohort of group.ageCohorts) {
        if(!safeInteger(cohort?.ageYears,0,120) || !safeInteger(cohort?.population,0) ||
           seen.has(cohort.ageYears)) return null;
        seen.add(cohort.ageYears);
        total+=cohort.population;
        if(!Number.isSafeInteger(total)) return null;
      }
      return total;
    };
    const originCohortTotal=cohortTotal(origin);
    const destinationCohortTotal=cohortTotal(destination);
    if(!safeInteger(quantity,1) || !safeInteger(origin.population,1) ||
       !safeInteger(destination.population,0) || quantity>origin.population ||
       originCohortTotal!==origin.population || destinationCohortTotal!==destination.population ||
       !Number.isSafeInteger(destination.population+quantity))
      return {ok:false,code:'MIGRATION_QUANTITY_INVALID',error:'The requested transfer, population totals or age cohorts are invalid.'};

    let allocations;
    try {
      allocations=allocateTransfer(origin.ageCohorts,quantity,origin.population);
    } catch {
      return {ok:false,code:'MIGRATION_ALLOCATION_FAILED',error:'The age-cohort transfer could not be allocated safely.'};
    }
    const source=origin.ageCohorts.map(item=>({...item}));
    const target=new Map(destination.ageCohorts.map(item=>[item.ageYears,item.population]));
    for(const cohort of source) {
      const moved=allocations.get(cohort.ageYears)||0;
      cohort.population-=moved;
      if(moved) {
        const next=(target.get(cohort.ageYears)||0)+moved;
        if(!Number.isSafeInteger(next))
          return {ok:false,code:'MIGRATION_COHORT_OVERFLOW',error:'The destination age cohort would exceed the safe integer range.'};
        target.set(cohort.ageYears,next);
      }
    }
    const nextOrigin=source.filter(item=>item.population>0);
    const nextDestination=[...target].map(([ageYears,population])=>({ageYears,population}))
      .sort((a,b)=>a.ageYears-b.ageYears);
    const nextOriginTotal=nextOrigin.reduce((sum,item)=>sum+item.population,0);
    const nextDestinationTotal=nextDestination.reduce((sum,item)=>sum+item.population,0);
    if(nextOriginTotal!==origin.population-quantity ||
       nextDestinationTotal!==destination.population+quantity ||
       nextOriginTotal+nextDestinationTotal!==origin.population+destination.population)
      return {ok:false,code:'MIGRATION_CONSERVATION_FAILED',error:'The transfer would not conserve the combined population and has been rejected.'};

    let migrationId;
    try { migrationId=makeId(createId); }
    catch { return {ok:false,code:'MIGRATION_ID_UNAVAILABLE',error:'A unique migration record could not be created.'}; }
    const nextSequence=(Number(game.eventSequence)||0)+1;
    const description=quantity.toLocaleString('en-US')+' residents moved from '+origin.name+' to '+destination.name+'.';
    const migrationRecord={
      id:migrationId,type:'internal',stateId:membership.stateId,
      originGroupId:origin.id,destinationGroupId:destination.id,
      originLocationId:origin.locationId,destinationLocationId:destination.locationId,
      quantity,ageDistribution:[...allocations].map(([ageYears,population])=>({ageYears,population})),
      playerId:player?.id||null,worldDate:game.worldDate
    };
    const event={
      id:'migration-'+nextSequence,gameId:game.id,orderId:order.orderId||null,
      actorPlayerId:player?.id||null,stateId:membership.stateId,type:'society.internal_migration',
      resultCode:null,occurredAtUtc:new Date().toISOString(),worldDate:game.worldDate,
      worldVersion:Number(game.worldVersion||0)+1,description,sequence:nextSequence
    };

    origin.ageCohorts=nextOrigin;
    destination.ageCohorts=nextDestination;
    origin.population=nextOriginTotal;
    destination.population=nextDestinationTotal;
    game.migrationRecords ||= [];
    game.migrationRecords.push(migrationRecord);
    game.eventSequence=nextSequence;
    game.events ||= [];
    game.events.push(event);
    if(game.events.length>1000) game.events.splice(0,game.events.length-1000);
    game.activity ||= [];
    game.activity.unshift(description);
    game.activity=game.activity.slice(0,100);
    return {ok:true,quantity};
  }

  const api=Object.freeze({validateConfiguration,advanceDay,movePopulation});
  globalThis.NewWorldDemography=api;
  if(typeof module!=='undefined' && module.exports) module.exports=api;
})();