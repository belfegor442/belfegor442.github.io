(() => {
  'use strict';

  const configurationFields=Object.freeze(['serviceTypes','publicServiceFacilities']);
  const runtimeFields=Object.freeze(['publicServiceCoverage','publicServiceHistory']);
  const categories=new Set(['education','health','social','culture']);
  const providers=new Set(['public','private','religious','community','mixed']);
  const clone=value=>structuredClone(value);
  const integer=(value,min=0,max=Number.MAX_SAFE_INTEGER)=>
    Number.isSafeInteger(value) && value>=min && value<=max;
  const bounded=(value,min,max)=>Number.isFinite(Number(value)) &&
    Number(value)>=min && Number(value)<=max;
  const validText=(value,min=2,max=120)=>
    typeof value==='string' && value.trim().length>=min && value.length<=max &&
    !/[<>\u0000-\u001f\u007f]/.test(value);
  const uniqueIds=items=>Array.isArray(items) &&
    items.every(item=>validText(item?.id,2,100)) &&
    new Set(items.map(item=>item.id)).size===items.length;
  const groupKey=(stateId,typeId,groupId)=>JSON.stringify([stateId,typeId,groupId]);

  function ensure(game) {
    if(!game || !Array.isArray(game.territories)) return game;
    for(const field of [...configurationFields,...runtimeFields])
      if(!Array.isArray(game[field])) game[field]=[];
    if(!Object.prototype.hasOwnProperty.call(game,'publicServiceCycleDate'))
      game.publicServiceCycleDate=null;
    if(!Object.prototype.hasOwnProperty.call(game,'publicServiceCycleResult'))
      game.publicServiceCycleResult=null;
    return game;
  }

  function validateConfiguration(game,configuration) {
    if(!configuration || configurationFields.some(field=>!Array.isArray(configuration[field])))
      return {ok:false,error:'Public service configuration requires serviceTypes and publicServiceFacilities arrays.'};
    const states=new Set((game?.territories || []).map(item=>item.stateId));
    const provinces=new Map((game?.provinces || []).map(item=>[item.id,item.stateId]));
    const groups=new Map((game?.populationGroups || []).map(item=>[item.id,item]));
    const companies=new Map((game?.companies || []).map(item=>[item.id,item]));
    if(!uniqueIds(configuration.serviceTypes) || !uniqueIds(configuration.publicServiceFacilities))
      return {ok:false,error:'Public service identifiers must be unique and stable.'};
    const types=new Map(configuration.serviceTypes.map(item=>[item.id,item]));
    for(const type of configuration.serviceTypes) {
      if(!validText(type.name) || !categories.has(type.category) ||
         !validText(type.unit,1,32) ||
         (type.educationProgressPerDayAtFullAccess>0 &&
          type.category==='education' &&
          !integer(type.educationProgressDelayDays,1,3650)) ||
         !bounded(type.demandPerThousandResidentsPerDay,0,1000000) ||
         !bounded(type.healthMortalityReductionPercentAtFullAccess ?? 0,0,100) ||
         !bounded(type.educationProgressPerDayAtFullAccess ?? 0,0,100) ||
         (type.category!=='health' && Number(type.healthMortalityReductionPercentAtFullAccess||0)!==0) ||
         (type.category!=='education' && Number(type.educationProgressPerDayAtFullAccess||0)!==0))
        return {ok:false,error:'A service type has an invalid category, unit, demand rate or configured social outcome.'};
    }
    for(const facility of configuration.publicServiceFacilities) {
      const type=types.get(facility.serviceTypeId);
      const provinceState=provinces.get(facility.provinceId);
      if(!states.has(facility.stateId) || provinceState!==facility.stateId || !type ||
         !validText(facility.name) || !providers.has(facility.providerType) ||
         !integer(facility.capacityPerDay,1) ||
         !integer(facility.staff,0) || !integer(facility.staffRequired,1) ||
         !bounded(facility.qualityPercent,0,100) ||
         !integer(facility.dailyOperatingCost,0) ||
         !integer(facility.publicFundingPercent,0,100) ||
         !bounded(facility.maximumTravelDistanceKm,0.1,5000) ||
         !integer(facility.maximumTravelTimeMinutes,1,1440) ||
         !Array.isArray(facility.populationGroupIds) || !facility.populationGroupIds.length ||
         new Set(facility.populationGroupIds).size!==facility.populationGroupIds.length ||
         !Array.isArray(facility.accessProfiles) ||
         facility.accessProfiles.length!==facility.populationGroupIds.length ||
         new Set(facility.accessProfiles.map(item=>item.populationGroupId)).size!==facility.populationGroupIds.length ||
         facility.populationGroupIds.some(id=>{
           const group=groups.get(id);
           return !group || group.stateId!==facility.stateId || group.provinceId!==facility.provinceId;
         }) ||
         facility.accessProfiles.some(profile=>
           !facility.populationGroupIds.includes(profile.populationGroupId) ||
           !bounded(profile.distanceKm,0,10000) ||
           !bounded(profile.travelTimeMinutes,0,10000) ||
           !bounded(profile.transportCoveragePercent,0,100) ||
           !bounded(profile.eligibilityPercent,0,100) ||
           !bounded(profile.affordabilityPercent,0,100)
         ))
        return {ok:false,error:'A public service must reference a real State, province, service type and population groups, with valid capacity, staff, quality and operating costs.'};
      if(facility.providerType==='public' && facility.publicFundingPercent!==100)
        return {ok:false,error:'A public provider must declare 100% public funding.'};
      if(facility.providerType==='private' && facility.publicFundingPercent!==0)
        return {ok:false,error:'A private provider cannot draw public operating funds unless its provider type is changed to mixed.'};
      if(facility.providerType==='public' && facility.operatorCompanyId)
        return {ok:false,error:'A public facility is operated by the State, not a private company.'};
      if(facility.providerType!=='public') {
        const operator=companies.get(facility.operatorCompanyId);
        if(!operator || operator.stateId!==facility.stateId ||
           operator.currencyId!==game.territories.find(item=>item.stateId===facility.stateId)?.currencyId)
          return {ok:false,error:'Private, religious, community and mixed providers require a registered local NPC operator with the State currency.'};
      }
      if(facility.waterDemandId &&
         !(game.waterDemands || []).some(item=>item.id===facility.waterDemandId &&
           item.stateId===facility.stateId && item.provinceId===facility.provinceId &&
           item.targetType==='public_service' && item.targetId===facility.id))
        return {ok:false,error:'A public service water demand must reference this exact service facility in the same province.'};
    }
    return {ok:true,error:null};
  }

  function distribute(total,weights) {
    if(!integer(total,0)) throw new Error('Public service allocation total is invalid.');
    const sum=weights.reduce((value,item)=>value+Math.max(0,Number(item.weight)||0),0);
    if(total===0 || sum===0) return weights.map(()=>0);
    if(!Number.isFinite(sum)) throw new Error('Public service demand weights are invalid.');
    const rows=weights.map((item,index)=>{
      const raw=total*Math.max(0,Number(item.weight)||0)/sum;
      const base=Math.floor(raw);
      return {index,base,remainder:raw-base};
    });
    let left=total-rows.reduce((value,item)=>value+item.base,0);
    rows.slice().sort((a,b)=>b.remainder-a.remainder || a.index-b.index)
      .forEach(item=>{if(left>0){rows[item.index].base++;left--;}});
    return rows.map(item=>item.base);
  }

  function appendHistory(game,facility,type,description,details) {
    const entry={
      id:'service-'+game.worldDate+'-'+facility.id+'-'+type,
      serviceId:facility.id,stateId:facility.stateId,provinceId:facility.provinceId,
      type,description,details:clone(details),worldDate:game.worldDate
    };
    game.publicServiceHistory.push(entry);
    if(game.publicServiceHistory.length>3000)
      game.publicServiceHistory.splice(0,game.publicServiceHistory.length-3000);
    game.events ||= [];
    game.eventSequence=(Number(game.eventSequence)||0)+1;
    game.events.push({
      id:'service-event-'+game.eventSequence,gameId:game.id,orderId:null,
      actorPlayerId:null,stateId:facility.stateId,type:'services.'+type,
      resultCode:null,occurredAtUtc:new Date().toISOString(),worldDate:game.worldDate,
      worldVersion:Number(game.worldVersion||0)+1,description,sequence:game.eventSequence
    });
    if(game.events.length>1000) game.events.splice(0,game.events.length-1000);
    game.activity ||= [];
    game.activity.unshift(description);
    game.activity=game.activity.slice(0,100);
  }

  function advanceDay(game) {
    ensure(game);
    if(game.publicServiceCycleDate===game.worldDate && game.publicServiceCycleResult)
      return {...clone(game.publicServiceCycleResult),replayed:true};
    const groups=new Map((game.populationGroups || []).map(item=>[item.id,item]));
    for(const group of game.populationGroups || []) {
      group.serviceAccess={};
      group.healthServiceAccessPercent=0;
      group.healthServiceQualityPercent=0;
      group.healthMortalityReductionPercent=0;
      group.educationServiceAccessPercent=0;
      group.educationServiceQualityPercent=0;
      group.educationProgressPerDay=0;
      group.educationProgressDelayDays=0;
      group.educationProgressLastDay=0;
      group.educationProgressQueue ||= [];
      const due=group.educationProgressQueue.filter(item=>item.dueDate<=game.worldDate);
      const matured=due.reduce((sum,item)=>sum+Number(item.progressPercent||0),0);
      if(matured>0) {
        const before=Number(group.educationIndexPercent)||0;
        group.educationIndexPercent=Math.min(100,before+matured);
        group.educationProgressLastDay=group.educationIndexPercent-before;
        for(const pool of game.labourPools || [])
          if(pool.populationGroupId===group.id)
            pool.qualificationLevel=Math.min(100,
              Number(pool.qualificationLevel||0)+group.educationProgressLastDay);
      }
      group.educationProgressQueue=group.educationProgressQueue.filter(item=>item.dueDate>game.worldDate);
      group.socialServiceAccessPercent=0;
      group.culturalServiceAccessPercent=0;
    }

    const facilities=(game.publicServiceFacilities || []).slice();
    const types=new Map((game.serviceTypes || []).map(item=>[item.id,item]));
    const groupsForDemand=new Map();
    for(const facility of facilities) {
      const type=types.get(facility.serviceTypeId);
      if(!type) throw new Error('Public service '+facility.id+' references a missing service type.');
      const key=JSON.stringify([facility.stateId,type.id]);
      if(!groupsForDemand.has(key)) groupsForDemand.set(key,new Set());
      for(const id of facility.populationGroupIds) groupsForDemand.get(key).add(id);
    }

    const remainingDemand=new Map();
    const originalDemand=new Map();
    for(const [key,ids] of groupsForDemand) {
      const [stateId,typeId]=JSON.parse(key);
      const type=types.get(typeId);
      const residents=[...ids].map(id=>groups.get(id));
      if(residents.some(item=>!item || item.stateId!==stateId))
        throw new Error('Public service '+typeId+' references a missing or foreign population group.');
      const totalWeight=residents.reduce((sum,item)=>
        sum+Math.max(0,Number(item.population)||0),0);
      const totalDemand=Math.floor(totalWeight*
        Number(type.demandPerThousandResidentsPerDay)/1000);
      const allocated=distribute(totalDemand,residents.map(item=>({
        weight:Math.max(0,Number(item.population)||0)
      })));
      residents.forEach((group,index)=>{
        const demand=allocated[index]||0;
        const id=groupKey(stateId,typeId,group.id);
        remainingDemand.set(id,demand);
        originalDemand.set(id,demand);
      });
    }

    const coverage=[];
    const financialTransactions=game.financialTransactions ||= [];
    const companyTransactions=game.companyFinancialTransactions ||= [];
    const serviceStats=new Map();
    const ordered=facilities.sort((a,b)=>
      a.stateId.localeCompare(b.stateId) || a.serviceTypeId.localeCompare(b.serviceTypeId) ||
      a.id.localeCompare(b.id));

    for(const facility of ordered) {
      const type=types.get(facility.serviceTypeId);
      const residents=facility.populationGroupIds.map(id=>groups.get(id));
      if(residents.some(item=>!item))
        throw new Error('Public service '+facility.id+' references a missing population group.');

      const accessByGroup=new Map((facility.accessProfiles || []).map(profile=>{
        const distancePercent=profile.distanceKm<=facility.maximumTravelDistanceKm
          ? 100 : facility.maximumTravelDistanceKm/Math.max(0.000001,profile.distanceKm)*100;
        const timePercent=profile.travelTimeMinutes<=facility.maximumTravelTimeMinutes
          ? 100 : facility.maximumTravelTimeMinutes/Math.max(0.000001,profile.travelTimeMinutes)*100;
        return [profile.populationGroupId,Math.max(0,Math.min(100,
          distancePercent,timePercent,Number(profile.transportCoveragePercent),
          Number(profile.eligibilityPercent),Number(profile.affordabilityPercent)))];
      }));
      const remainingByGroup=residents.map(group=>{
        const id=groupKey(facility.stateId,type.id,group.id);
        const remaining=remainingDemand.get(id)||0;
        const fullNeed=originalDemand.get(id)||0;
        const accessPercent=accessByGroup.get(group.id)||0;
        const potentiallyReachable=Math.floor(fullNeed*accessPercent/100);
        const alreadyServed=serviceStats.get(id)?.served||0;
        return {
          group,remaining,accessPercent,potentiallyReachable,
          weight:Math.min(remaining,Math.max(0,potentiallyReachable-alreadyServed))
        };
      });
      const demand=remainingByGroup.reduce((sum,item)=>sum+item.weight,0);
      const fullDemand=remainingByGroup.reduce((sum,item)=>sum+item.remaining,0);
      const totalUnderlyingDemand=remainingByGroup.reduce((sum,item)=>
        sum+(originalDemand.get(groupKey(facility.stateId,type.id,item.group.id))||0),0);
      const staffingRatio=Math.min(1,Number(facility.staff)/Number(facility.staffRequired));
      const staffedCapacity=Math.floor(Number(facility.capacityPerDay)*staffingRatio);
      const publicCost=Math.ceil(Number(facility.dailyOperatingCost)*
        Number(facility.publicFundingPercent)/100);
      const privateCost=Number(facility.dailyOperatingCost)-publicCost;
      const territory=(game.territories || []).find(item=>item.stateId===facility.stateId);
      if(!territory) throw new Error('Public service '+facility.id+' has no State treasury.');
      const balanceBefore=Number(territory.treasury)||0;
      if(!integer(balanceBefore,0))
        throw new Error('The State treasury for public services is invalid.');
      const actualPublicCost=Math.min(balanceBefore,publicCost);
      const company=facility.providerType==='public'?null:
        (game.companies || []).find(item=>item.id===facility.operatorCompanyId);
      if(company) company.cashBalances ||= {};
      const privateCash=company?Number(company.cashBalances[company.currencyId]||0):0;
      if(company && !integer(privateCash,0))
        throw new Error('The public service operator has an invalid cash balance.');
      const actualPrivateCost=company?Math.min(privateCash,privateCost):0;
      const publicFundingRatio=publicCost===0?1:actualPublicCost/publicCost;
      const privateFundingRatio=privateCost===0?1:actualPrivateCost/privateCost;
      const fundingRatio=Math.min(publicFundingRatio,privateFundingRatio);
      const fundedCapacity=Math.floor(staffedCapacity*fundingRatio);
      const served=Math.min(demand,fundedCapacity);
      const allocated=distribute(served,remainingByGroup.map(item=>({weight:item.weight})));

      const waterAllocation=facility.waterDemandId
        ? (game.waterAllocations || []).find(item=>
            item.demandId===facility.waterDemandId && item.worldDate===game.worldDate)
        : null;
      const waterCoverage=facility.waterDemandId
        ? Number(waterAllocation?.coveragePercent||0) : 100;
      const finalServed=Math.floor(served*Math.max(0,Math.min(1,waterCoverage/100)));
      const finalAllocated=distribute(finalServed,allocated.map(weight=>({weight})));

      if(actualPublicCost>0) {
        territory.treasury-=actualPublicCost;
        financialTransactions.push({
          id:'service-payment-'+game.worldDate+'-'+facility.id,
          stateId:facility.stateId,currencyId:territory.currencyId,
          type:'PublicServiceOperatingCost',amount:-actualPublicCost,
          balanceBefore,balanceAfter:territory.treasury,
          description:'Public funding share for '+facility.name+'.',
          worldDate:game.worldDate,recordedAtUtc:new Date().toISOString(),
          orderId:null,membershipId:null
        });
      }
      if(actualPrivateCost>0 && company) {
        company.cashBalances[company.currencyId]=privateCash-actualPrivateCost;
        companyTransactions.push({
          id:'service-operator-payment-'+game.worldDate+'-'+facility.id,
          companyId:company.id,stateId:company.stateId,currencyId:company.currencyId,
          type:'PublicServiceOperatingCost',amount:-actualPrivateCost,
          balanceBefore:privateCash,balanceAfter:company.cashBalances[company.currencyId],
          goodId:null,quantity:1,unitPrice:actualPrivateCost,
          description:'Operating contribution for '+facility.name+'.',
          worldDate:game.worldDate,recordedAtUtc:new Date().toISOString()
        });
      }

      const groupCoverage=[];
      residents.forEach((group,index)=>{
        const remaining=remainingByGroup[index].weight;
        const groupServed=finalAllocated[index]||0;
        const id=groupKey(facility.stateId,type.id,group.id);
        const demandTotal=originalDemand.get(id)||0;
        const servedTotal=(serviceStats.get(id)?.served||0)+groupServed;
        const accessibleTotal=Math.max(serviceStats.get(id)?.accessible||0,
          remainingByGroup[index].potentiallyReachable,servedTotal);
        const qualityTotal=(serviceStats.get(id)?.qualityWeighted||0)+
          groupServed*Number(facility.qualityPercent);
        serviceStats.set(id,{served:servedTotal,accessible:accessibleTotal,
          qualityWeighted:qualityTotal});
        remainingDemand.set(id,Math.max(0,(originalDemand.get(id)||0)-servedTotal));
        const groupAccess=demandTotal>0?Math.round(servedTotal/demandTotal*10000)/100:0;
        const averageQuality=servedTotal>0?qualityTotal/servedTotal:0;
        group.serviceAccess[type.id]={
          category:type.category,demand:demandTotal,served:servedTotal,
          accessPercent:groupAccess,
          reachableDemand:serviceStats.get(id)?.accessible||0,
          reachPercent:demandTotal>0
            ? Math.round((serviceStats.get(id)?.accessible||0)/demandTotal*10000)/100 : 100,
          qualityPercent:averageQuality,worldDate:game.worldDate
        };
        groupCoverage.push({
          populationGroupId:group.id,fullNeedRemaining:remaining,
          accessibleDemand:remainingByGroup[index].weight,
          reachablePopulation:remainingByGroup[index].potentiallyReachable,
          served:groupServed,accessPercent:remainingByGroup[index].accessPercent
        });
        if(type.category==='health') {
          const reduction=groupAccess*averageQuality*
            Number(type.healthMortalityReductionPercentAtFullAccess||0)/10000;
          const existingAccess=group.healthServiceAccessPercent*
            group.healthServiceQualityPercent/100;
          if(groupAccess*averageQuality/100>existingAccess) {
            group.healthServiceAccessPercent=groupAccess;
            group.healthServiceQualityPercent=averageQuality;
            group.healthMortalityReductionPercent=reduction;
          }
        } else if(type.category==='education') {
          const progress=Number(type.educationProgressPerDayAtFullAccess||0)*
            groupAccess*averageQuality/10000;
          const existingAccess=group.educationServiceAccessPercent*
            group.educationServiceQualityPercent/100;
          if(groupAccess*averageQuality/100>existingAccess) {
            group.educationServiceAccessPercent=groupAccess;
            group.educationServiceQualityPercent=averageQuality;
            group.educationProgressPerDay=progress;
            group.educationProgressDelayDays=Number(type.educationProgressDelayDays||0);
          }
        } else if(type.category==='social') {
          group.socialServiceAccessPercent=Math.max(group.socialServiceAccessPercent,groupAccess);
        } else if(type.category==='culture') {
          group.culturalServiceAccessPercent=Math.max(group.culturalServiceAccessPercent,groupAccess);
        }
      });

      const row={
        id:'service-coverage-'+game.worldDate+'-'+facility.id,
        serviceId:facility.id,serviceTypeId:type.id,stateId:facility.stateId,
        provinceId:facility.provinceId,providerType:facility.providerType,
        operatorCompanyId:company?.id||null,unit:type.unit,demand,fullDemand,
        reachablePopulationDemand:demand,served:finalServed,
        remainingDemandBeforeFacility:fullDemand,capacity:fundedCapacity,
        staffedCapacity,staffingPercent:Math.round(staffingRatio*100),
        accessPercent:demand>0?Math.round(finalServed/demand*10000)/100:100,
        populationAccessPercent:totalUnderlyingDemand>0
          ? Math.round(finalServed/totalUnderlyingDemand*10000)/100 : 100,
        qualityPercent:Number(facility.qualityPercent),
        publicFundingPercent:Number(facility.publicFundingPercent),
        publicCost:actualPublicCost,privateCost:actualPrivateCost,
        unfundedPublicCost:publicCost-actualPublicCost,
        unfundedPrivateCost:privateCost-actualPrivateCost,
        waterCoveragePercent:waterCoverage,groupCoverage,worldDate:game.worldDate
      };
      coverage.push(row);
      if(row.unfundedPublicCost>0 || row.unfundedPrivateCost>0 ||
         finalServed<demand || demand<fullDemand ||
         staffedCapacity<Number(facility.capacityPerDay) ||
         (facility.waterDemandId && waterCoverage<100)) {
        appendHistory(game,facility,'service_constraint',
          facility.name+' delivered '+finalServed+' of '+demand+' reachable '+type.unit+
            ' demanded; '+(fullDemand-demand)+' additional units are outside the access profile.',
          {demand,fullDemand,unreachableDemand:fullDemand-demand,
           served:finalServed,capacity:fundedCapacity,
           staffingPercent:row.staffingPercent,publicCost:actualPublicCost,
           privateCost:actualPrivateCost,unfundedPublicCost:row.unfundedPublicCost,
           unfundedPrivateCost:row.unfundedPrivateCost,waterCoveragePercent:waterCoverage});
      }
    }

    for(const group of game.populationGroups || []) {
      const progress=Number(group.educationProgressPerDay)||0;
      if(progress>0) {
        const dueDate=new Date(Date.parse(game.worldDate+'T00:00:00Z')+
          Number(group.educationProgressDelayDays||0)*86400000).toISOString().slice(0,10);
        group.educationProgressQueue ||= [];
        group.educationProgressQueue.push({
          dueDate,progressPercent:progress,worldDate:game.worldDate
        });
      }
    }
    game.publicServiceCoverage=coverage;
    if(companyTransactions.length>3000)
      companyTransactions.splice(0,companyTransactions.length-3000);
    const totalDemand=[...originalDemand.values()].reduce((sum,item)=>sum+item,0);
    const totalAccessible=[...serviceStats.values()].reduce((sum,item)=>sum+item.accessible,0);
    const totalServed=[...serviceStats.values()].reduce((sum,item)=>sum+item.served,0);
    const result={ok:true,facilities:coverage.length,demand:totalDemand,
      accessibleDemand:totalAccessible,served:totalServed};
    game.publicServiceCycleDate=game.worldDate;
    game.publicServiceCycleResult=clone(result);
    return result;
  }

  const api=Object.freeze({
    ensure,validateConfiguration,advanceDay,
    configurationFields:Object.freeze([...configurationFields]),
    categories:Object.freeze([...categories]),providers:Object.freeze([...providers])
  });
  globalThis.NewWorldServices=api;
  if(typeof module!=='undefined' && module.exports) module.exports=api;
})();