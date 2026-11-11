(() => {
  'use strict';

  const CONFIG_FIELDS=Object.freeze(['epidemicDefinitions','epidemicStarts']);
  const DYNAMIC_FIELDS=Object.freeze(['epidemicOutbreaks','epidemicGroupStates','epidemicHistory']);
  const clone=value=>structuredClone(value);
  const validInt=(value,min=0,max=Number.MAX_SAFE_INTEGER)=>
    Number.isSafeInteger(value)&&value>=min&&value<=max;
  const validDate=value=>{
    if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date=new Date(value+'T00:00:00.000Z');
    return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;
  };
  const cleanText=(value,min,max)=>{
    if(typeof value!=='string') return false;
    const result=value.trim();
    return result.length>=min&&result.length<=max&&!/[\u0000-\u001f\u007f<>]/.test(result);
  };
  const groupKey=(outbreakId,groupId)=>outbreakId+'|'+groupId;
  const linkKey=link=>link.originGroupId+'>'+link.destinationGroupId;

  function ensure(game) {
    for(const field of CONFIG_FIELDS) game[field] ||= [];
    for(const field of DYNAMIC_FIELDS) game[field] ||= [];
  }

  function connectedGroups(definition,sourceGroupId) {
    const seen=new Set([sourceGroupId]);
    const queue=[sourceGroupId];
    const links=definition.contactLinks.slice().sort((a,b)=>
      (a.originGroupId+'>'+a.destinationGroupId).localeCompare(
        b.originGroupId+'>'+b.destinationGroupId));
    while(queue.length) {
      const current=queue.shift();
      for(const link of links) {
        if(link.originGroupId!==current||seen.has(link.destinationGroupId)) continue;
        seen.add(link.destinationGroupId);
        queue.push(link.destinationGroupId);
      }
    }
    return seen;
  }

  function validateConfiguration(game,configuration) {
    const errors=[];
    if(!configuration||!Array.isArray(configuration.epidemicDefinitions)||
       !Array.isArray(configuration.epidemicStarts))
      return {ok:false,error:'Epidemic definitions and explicit outbreak starts must be arrays.'};
    const states=new Set((game?.territories||[]).map(item=>item.stateId));
    const groups=new Map((game?.populationGroups||[]).map(item=>[item.id,item]));
    const definitions=new Map();
    for(const definition of configuration.epidemicDefinitions) {
      if(!definition||!cleanText(definition.id,1,120)||definitions.has(definition.id)||
         !states.has(definition.stateId)||!cleanText(definition.name,2,120)||
         !cleanText(definition.description||'',0,600)||
         !validInt(definition.incubationDays,1,365)||
         !validInt(definition.infectiousDays,1,365)||
         !validInt(definition.transmissionBasisPoints,0,10000)||
         !validInt(definition.dailyMortalityPerThousand,0,1000)||
         !Array.isArray(definition.contactLinks)||definition.contactLinks.length<1||
         definition.contactLinks.length>5000) {
        errors.push('EPIDEMIC_DEFINITION_INVALID:'+String(definition?.id||'unknown'));
        continue;
      }
      const used=new Set();
      const outgoing=new Map();
      for(const link of definition.contactLinks) {
        const origin=groups.get(link?.originGroupId);
        const destination=groups.get(link?.destinationGroupId);
        const key=linkKey(link||{});
        if(!origin||!destination||origin.stateId!==definition.stateId||
           destination.stateId!==definition.stateId||
           !validInt(link.dailyContactsPerThousand,0,100000)||
           used.has(key)) {
          errors.push('EPIDEMIC_CONTACT_LINK_INVALID:'+definition.id);
          continue;
        }
        used.add(key);
        outgoing.set(origin.id,(outgoing.get(origin.id)||0)+link.dailyContactsPerThousand);
      }
      if([...outgoing.values()].some(total=>total>100000))
        errors.push('EPIDEMIC_CONTACT_BUDGET_EXCEEDED:'+definition.id);
      definitions.set(definition.id,definition);
    }
    const startIds=new Set();
    const startsBySource=new Set();
    const alreadyStarted=new Set((game?.epidemicOutbreaks||[]).map(item=>item.scenarioStartId));
    for(const start of configuration.epidemicStarts) {
      const definition=definitions.get(start?.definitionId);
      const source=groups.get(start?.sourceGroupId);
      if(!start||!cleanText(start.id,1,120)||startIds.has(start.id)||
         !definition||!source||source.stateId!==definition.stateId||
         !validInt(source.population,0)||
         !validDate(start.startsOn)||!validDate(game.worldDate)||
         (start.startsOn<game.worldDate&&!alreadyStarted.has(start.id))||
         !validInt(start.initialInfectious,1,Number.MAX_SAFE_INTEGER)||
         start.initialInfectious>source.population) {
        errors.push('EPIDEMIC_START_INVALID:'+String(start?.id||'unknown'));
        continue;
      }
      const reachable=connectedGroups(definition,source.id);
      if(!reachable.size||!reachable.has(source.id))
        errors.push('EPIDEMIC_NETWORK_INVALID:'+start.id);
      const occupied=[...reachable].some(groupId=>startsBySource.has(groupId));
      if(occupied) errors.push('EPIDEMIC_SCENARIO_GROUP_OVERLAP:'+start.id);
      for(const groupId of reachable) startsBySource.add(groupId);
      startIds.add(start.id);
    }
    if(errors.length) return {ok:false,error:[...new Set(errors)].join(', '),errors:[...new Set(errors)]};
    return {ok:true,error:null,errors:[]};
  }

  function record(game,type,stateId,description,details={}) {
    game.eventSequence=(Number(game.eventSequence)||0)+1;
    const entry={
      id:'epidemiology-event-'+game.eventSequence,gameId:game.id,orderId:null,
      actorPlayerId:null,stateId,type:'society.epidemic_'+type,
      resultCode:null,occurredAtUtc:new Date().toISOString(),
      worldDate:game.worldDate,worldVersion:Number(game.worldVersion||0)+1,
      description,sequence:game.eventSequence,details:clone(details)
    };
    game.events.push(entry);
    if(game.events.length>1000) game.events.splice(0,game.events.length-1000);
    game.activity.unshift(description);
    game.activity=game.activity.slice(0,100);
    game.epidemicHistory.push({
      id:entry.id,type,stateId,worldDate:game.worldDate,description,...clone(details)
    });
    if(game.epidemicHistory.length>5000)
      game.epidemicHistory.splice(0,game.epidemicHistory.length-5000);
    return entry;
  }

  function allocateCounts(total,rows) {
    const denominator=rows.reduce((sum,row)=>sum+BigInt(row.weight),0n);
    if(total===0||denominator===0n) return new Map(rows.map(row=>[row.key,0]));
    const allocated=rows.map(row=>{
      const numerator=BigInt(total)*BigInt(row.weight);
      return {key:row.key,base:Number(numerator/denominator),
        remainder:numerator%denominator,capacity:row.capacity};
    });
    let remaining=total-allocated.reduce((sum,row)=>sum+row.base,0);
    allocated.sort((a,b)=>a.remainder===b.remainder
      ? String(a.key).localeCompare(String(b.key))
      : a.remainder>b.remainder?-1:1);
    for(const row of allocated) {
      if(remaining<=0) break;
      if(row.base<row.capacity) {row.base++;remaining--;}
    }
    if(remaining!==0) throw new Error('Epidemic population allocation did not conserve its total.');
    return new Map(allocated.map(row=>[row.key,row.base]));
  }

  function applyPopulationDeaths(group,deaths) {
    if(!deaths) return;
    if(!Array.isArray(group.ageCohorts)||!group.ageCohorts.length)
      throw new Error('Epidemic deaths require configured age cohorts for '+group.id+'.');
    const rows=group.ageCohorts.map(cohort=>({
      key:cohort.ageYears,weight:cohort.population,capacity:cohort.population
    }));
    const losses=allocateCounts(deaths,rows);
    group.ageCohorts=group.ageCohorts.map(cohort=>({
      ageYears:cohort.ageYears,population:cohort.population-(losses.get(cohort.ageYears)||0)
    })).filter(cohort=>cohort.population>0);
    group.population=group.ageCohorts.reduce((sum,cohort)=>sum+cohort.population,0);
  }

  function stateTotals(state) {
    const exposed=state.exposedCohorts.reduce((sum,item)=>sum+item.count,0);
    const infectious=state.infectiousCohorts.reduce((sum,item)=>sum+item.count,0);
    return {susceptible:state.susceptible,exposed,infectious,recovered:state.recovered,
      active:exposed+infectious};
  }

  function reconcilePopulation(state,group) {
    const totals=stateTotals(state);
    const accounted=totals.susceptible+totals.exposed+totals.infectious+totals.recovered;
    const difference=group.population-accounted;
    if(difference>0) state.susceptible+=difference;
    if(difference<0) {
      let remove=-difference;
      const fromSusceptible=Math.min(state.susceptible,remove);
      state.susceptible-=fromSusceptible;remove-=fromSusceptible;
      const fromRecovered=Math.min(state.recovered,remove);
      state.recovered-=fromRecovered;remove-=fromRecovered;
      for(const collection of [state.exposedCohorts,state.infectiousCohorts]) {
        for(let index=collection.length-1;index>=0&&remove>0;index--) {
          const cut=Math.min(collection[index].count,remove);
          collection[index].count-=cut;remove-=cut;
          if(collection[index].count===0) collection.splice(index,1);
        }
      }
      if(remove) throw new Error('Epidemic compartments exceeded the real population total.');
    }
  }

  function collectOutbreakGroups(definition,sourceGroupId) {
    const ids=connectedGroups(definition,sourceGroupId);
    return [...ids].sort();
  }

  function startDueOutbreaks(game,createId) {
    const created=[];
    const byDefinition=new Map(game.epidemicDefinitions.map(item=>[item.id,item]));
    for(const start of game.epidemicStarts) {
      if(start.startsOn>game.worldDate||
         game.epidemicOutbreaks.some(item=>item.scenarioStartId===start.id)) continue;
      const definition=byDefinition.get(start.definitionId);
      const source=game.populationGroups.find(item=>item.id===start.sourceGroupId);
      if(!definition||!source) continue;
      const groupIds=collectOutbreakGroups(definition,source.id);
      const occupied=game.epidemicGroupStates.some(item=>
        groupIds.includes(item.groupId)&&item.status==='active');
      if(occupied) continue;
      const outbreakId=typeof createId==='function'?createId():
        'outbreak-'+game.epidemicOutbreaks.length+'-'+game.worldDate;
      const outbreak={
        id:outbreakId,scenarioStartId:start.id,definitionId:definition.id,
        stateId:definition.stateId,sourceGroupId:source.id,startedOn:game.worldDate,
        status:'active',initialInfectious:start.initialInfectious,
        totalExposures:0,totalInfections:start.initialInfectious,
        totalRecoveries:0,totalDeaths:0,endedOn:null,transmissionRemainders:{}
      };
      for(const groupId of groupIds) {
        const group=game.populationGroups.find(item=>item.id===groupId);
        const initial=group.id===source.id?start.initialInfectious:0;
        if(!group||!Array.isArray(group.ageCohorts)||
           !validInt(group.population,0)||
           group.ageCohorts.reduce((sum,item)=>sum+item.population,0)!==group.population||
           group.ageCohorts.some(item=>!validInt(item.ageYears,0,120)||!validInt(item.population,0)))
          throw new Error('Epidemic contact groups need valid age cohorts: '+groupId+'.');
        game.epidemicGroupStates.push({
          outbreakId,groupId,stateId:group.stateId,locationId:group.locationId,
          susceptible:group.population-initial,
          exposedCohorts:[],
          infectiousCohorts:initial?[{daysRemaining:definition.infectiousDays,count:initial}]:[],
          recovered:0,mortalityRemainder:0,exposuresTotal:0,
          infectionsTotal:initial,recoveriesTotal:0,deathsTotal:0,status:'active'
        });
      }
      game.epidemicOutbreaks.push(outbreak);
      record(game,'outbreak_started',outbreak.stateId,
        'An explicitly configured outbreak of '+definition.name+' began in '+source.name+'.',
        {outbreakId,definitionId:definition.id,sourceGroupId:source.id,
          sourceLocationId:source.locationId,initialInfectious:start.initialInfectious});
      created.push(outbreakId);
    }
    return created;
  }

  function advanceOutbreak(game,outbreak,definition) {
    const states=game.epidemicGroupStates.filter(item=>item.outbreakId===outbreak.id);
    const groups=new Map(game.populationGroups.map(item=>[item.id,item]));
    const stateByGroup=new Map(states.map(item=>[item.groupId,item]));
    for(const state of states) {
      const group=groups.get(state.groupId);
      if(!group) throw new Error('Epidemic population group disappeared: '+state.groupId+'.');
      const cohortTotal=(group.ageCohorts||[]).reduce((sum,item)=>sum+Number(item.population),0);
      if(!Array.isArray(group.ageCohorts)||!Number.isSafeInteger(cohortTotal)||
         cohortTotal!==group.population||group.ageCohorts.some(item=>
           !validInt(item.ageYears,0,120)||!validInt(item.population,0)))
        throw new Error('Epidemic population age cohorts do not match the real group population for '+group.id+'.');
      reconcilePopulation(state,group);
      const nextExposed=[];
      let matured=0;
      for(const cohort of state.exposedCohorts) {
        if(cohort.daysRemaining<=1) matured+=cohort.count;
        else nextExposed.push({daysRemaining:cohort.daysRemaining-1,count:cohort.count});
      }
      state.exposedCohorts=nextExposed;
      if(matured>0) {
        state.infectiousCohorts.push({daysRemaining:definition.infectiousDays,count:matured});
        state.infectionsTotal+=matured;
        outbreak.totalInfections+=matured;
        record(game,'infections',group.stateId,
          matured+' new infections of '+definition.name+' were confirmed in '+group.name+'.',
          {outbreakId:outbreak.id,groupId:group.id,quantity:matured});
      }
      const infectiousBefore=state.infectiousCohorts.reduce((sum,item)=>sum+item.count,0);
      const healthReductionBasisPoints=BigInt(Math.max(0,Math.min(10000,
        Math.round(Number(group.healthMortalityReductionPercent||0)*100))));
      const effectiveMortality=BigInt(definition.dailyMortalityPerThousand)*
        (10000n-healthReductionBasisPoints);
      const mortalityNumerator=BigInt(infectiousBefore)*effectiveMortality+
        BigInt(state.mortalityRemainder||0);
      let deaths=Number(mortalityNumerator/10000000n);
      state.mortalityRemainder=Number(mortalityNumerator%10000000n);
      deaths=Math.min(infectiousBefore,deaths);
      if(deaths>0) {
        const losses=allocateCounts(deaths,state.infectiousCohorts.map((item,index)=>({
          key:index,weight:item.count,capacity:item.count
        })));
        state.infectiousCohorts=state.infectiousCohorts.map((item,index)=>({
          ...item,count:item.count-(losses.get(index)||0)
        })).filter(item=>item.count>0);
        applyPopulationDeaths(group,deaths);
        group.demographicDeathsLastDay=(Number(group.demographicDeathsLastDay)||0)+deaths;
        group.populationChangeLastDay=(Number(group.populationChangeLastDay)||0)-deaths;
        state.deathsTotal+=deaths;
        outbreak.totalDeaths+=deaths;
        const territory=game.territories.find(item=>item.stateId===group.stateId);
        if(territory) territory.demographicDeathsLastDay=
          (Number(territory.demographicDeathsLastDay)||0)+deaths;
        record(game,'deaths',group.stateId,
          deaths+' residents died from '+definition.name+' in '+group.name+'.',
          {outbreakId:outbreak.id,groupId:group.id,quantity:deaths});
      }
      let recoveredToday=0;
      const remainingInfectious=[];
      for(const cohort of state.infectiousCohorts) {
        if(cohort.daysRemaining<=1) recoveredToday+=cohort.count;
        else remainingInfectious.push({daysRemaining:cohort.daysRemaining-1,count:cohort.count});
      }
      state.infectiousCohorts=remainingInfectious;
      if(recoveredToday>0) {
        state.recovered+=recoveredToday;
        state.recoveriesTotal+=recoveredToday;
        outbreak.totalRecoveries+=recoveredToday;
        record(game,'recoveries',group.stateId,
          recoveredToday+' residents recovered from '+definition.name+'.',
          {outbreakId:outbreak.id,groupId:group.id,quantity:recoveredToday});
      }
      state.status='active';
    }

    const exposureByDestination=new Map();
    for(const link of definition.contactLinks.slice().sort((a,b)=>linkKey(a).localeCompare(linkKey(b)))) {
      const sourceState=stateByGroup.get(link.originGroupId);
      const destinationState=stateByGroup.get(link.destinationGroupId);
      if(!sourceState||!destinationState||sourceState.susceptible+sourceState.recovered<0) continue;
      const infectious=sourceState.infectiousCohorts.reduce((sum,item)=>sum+item.count,0);
      if(!infectious||!destinationState.susceptible) continue;
      const key=linkKey(link);
      const previous=outbreak.transmissionRemainders[key]||{contacts:0,transmission:0};
      const contactsNumerator=BigInt(infectious)*BigInt(link.dailyContactsPerThousand)+
        BigInt(previous.contacts||0);
      const contacts=contactsNumerator/1000n;
      const contactsRemainder=Number(contactsNumerator%1000n);
      const transmissionNumerator=contacts*BigInt(definition.transmissionBasisPoints)+
        BigInt(previous.transmission||0);
      const desired=Number(transmissionNumerator/10000n);
      const transmissionRemainder=Number(transmissionNumerator%10000n);
      const remainingSusceptible=Math.max(0,destinationState.susceptible-
        (exposureByDestination.get(link.destinationGroupId)||0));
      const allocated=Math.min(remainingSusceptible,desired);
      if(allocated<desired) {
        outbreak.transmissionRemainders[key]={contacts:0,transmission:0};
      } else {
        outbreak.transmissionRemainders[key]={
          contacts:contactsRemainder,transmission:transmissionRemainder
        };
      }
      if(allocated>0)
        exposureByDestination.set(link.destinationGroupId,
          (exposureByDestination.get(link.destinationGroupId)||0)+allocated);
    }
    for(const [groupId,requested] of exposureByDestination) {
      const state=stateByGroup.get(groupId);
      const group=groups.get(groupId);
      const count=Math.min(requested,state.susceptible);
      if(!count) continue;
      state.susceptible-=count;
      state.exposedCohorts.push({
        daysRemaining:definition.incubationDays,count
      });
      state.exposuresTotal+=count;
      outbreak.totalExposures+=count;
      record(game,'epidemic_spread',group.stateId,
        count+' residents were exposed to '+definition.name+' in '+group.name+'.',
        {outbreakId:outbreak.id,groupId,quantity:count});
    }

    for(const state of states) {
      const totals=stateTotals(state);
      state.status=totals.active>0?'active':'completed';
    }
    const active=states.some(state=>state.status==='active');
    if(!active) {
      outbreak.status='completed';
      outbreak.endedOn=game.worldDate;
      record(game,'outbreak_completed',outbreak.stateId,
        'The configured '+definition.name+' outbreak has no remaining exposed or infectious residents.',
        {outbreakId:outbreak.id,totalExposures:outbreak.totalExposures,
          totalInfections:outbreak.totalInfections,totalRecoveries:outbreak.totalRecoveries,
          totalDeaths:outbreak.totalDeaths});
    }
    for(const territory of game.territories.filter(item=>item.stateId===outbreak.stateId)) {
      territory.population=game.populationGroups.filter(item=>item.stateId===territory.stateId)
        .reduce((sum,item)=>sum+item.population,0);
      territory.demographicDeathsLastDay=(Number(territory.demographicDeathsLastDay)||0);
    }
    game.epidemicHistory.push({
      id:'epidemic-day-'+outbreak.id+'-'+game.worldDate,outbreakId:outbreak.id,
      stateId:outbreak.stateId,worldDate:game.worldDate,status:outbreak.status,
      exposed:states.reduce((sum,item)=>sum+stateTotals(item).exposed,0),
      infectious:states.reduce((sum,item)=>sum+stateTotals(item).infectious,0),
      recovered:states.reduce((sum,item)=>sum+item.recovered,0),
      deaths:outbreak.totalDeaths
    });
    if(game.epidemicHistory.length>5000)
      game.epidemicHistory.splice(0,game.epidemicHistory.length-5000);
    return {outbreakId:outbreak.id,status:outbreak.status};
  }

  function advanceDay(game,createId) {
    if(!game) return {ok:false,error:'The demographic world state is missing.'};
    const draft=clone(game);
    ensure(draft);
    if(!draft.epidemicDefinitions.length&&!draft.epidemicStarts.length)
      return {ok:true,started:[],advanced:0};
    const validation=validateConfiguration(draft,{
      epidemicDefinitions:draft.epidemicDefinitions,epidemicStarts:draft.epidemicStarts
    });
    if(!validation.ok) return {ok:false,error:validation.error};
    try {
      const started=startDueOutbreaks(draft,createId);
      const definitions=new Map(draft.epidemicDefinitions.map(item=>[item.id,item]));
      let advanced=0;
      for(const outbreak of draft.epidemicOutbreaks.filter(item=>item.status==='active')) {
        if(outbreak.startedOn===draft.worldDate) continue;
        const definition=definitions.get(outbreak.definitionId);
        if(!definition) throw new Error('The active outbreak lost its disease definition.');
        advanceOutbreak(draft,outbreak,definition);
        advanced++;
      }
      for(const key of Object.keys(game)) delete game[key];
      Object.assign(game,draft);
      return {ok:true,started,advanced};
    } catch(error) {
      return {ok:false,error:error?.message||'The epidemic simulation failed.'};
    }
  }

  const api=Object.freeze({
    ensure,validateConfiguration,advanceDay,
    configurationFields:Object.freeze([...CONFIG_FIELDS]),
    dynamicFields:Object.freeze([...DYNAMIC_FIELDS])
  });
  globalThis.NewWorldEpidemiology=api;
  if(typeof module!=='undefined'&&module.exports) module.exports=api;
})();
