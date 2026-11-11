(() => {
  'use strict';

  const configurationFields=Object.freeze([
    'industryOccupations','labourPools','industryWorkplaces','labourUnions'
  ]);
  const runtimeFields=Object.freeze([
    'industryEmploymentContracts','industryLabourBalances','industryHistory'
  ]);
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

  function ensure(game) {
    if(!game || !Array.isArray(game.territories)) return game;
    for(const field of [...configurationFields,...runtimeFields])
      if(!Array.isArray(game[field])) game[field]=[];
    if(!Object.prototype.hasOwnProperty.call(game,'industryPayrollDate'))
      game.industryPayrollDate=null;
    return game;
  }

  function validateConfiguration(game,configuration) {
    if(!configuration || configurationFields.some(field=>!Array.isArray(configuration[field])))
      return {ok:false,error:'Industry configuration requires occupations, labour pools, workplaces and unions arrays.'};
    for(const field of configurationFields)
      if(!uniqueIds(configuration[field]))
        return {ok:false,error:'Identifiers in '+field+' must be unique and stable.'};
    const states=new Map((game?.territories || []).map(item=>[item.stateId,item]));
    const provinces=new Map((game?.provinces || []).map(item=>[item.id,item.stateId]));
    const groups=new Map((game?.populationGroups || []).map(item=>[item.id,item]));
    const companies=new Map((game?.companies || []).map(item=>[item.id,item]));
    const occupations=new Map(configuration.industryOccupations.map(item=>[item.id,item]));
    for(const occupation of configuration.industryOccupations)
      if(!validText(occupation.name) ||
         !integer(occupation.minimumQualificationLevel ?? 0,0,100))
        return {ok:false,error:'An occupation requires a name and a qualification level from 0 to 100.'};

    const supplyByGroup=new Map();
    for(const pool of configuration.labourPools) {
      const group=groups.get(pool.populationGroupId);
      if(!states.has(pool.stateId) || provinces.get(pool.provinceId)!==pool.stateId ||
         !group || group.stateId!==pool.stateId ||
         (group.provinceId && group.provinceId!==pool.provinceId) ||
         !occupations.has(pool.occupationId) ||
         !integer(pool.workforce,0,Number.MAX_SAFE_INTEGER) ||
         !integer(pool.qualificationLevel,0,100))
        return {ok:false,error:'A labour pool has an invalid State, province, population group, occupation or workforce.'};
      const total=(supplyByGroup.get(group.id)||0)+pool.workforce;
      if(!Number.isSafeInteger(total) || total>Number(group.population))
        return {ok:false,error:'The sum of labour pools cannot exceed the population of their referenced group.'};
      supplyByGroup.set(group.id,total);
    }

    for(const workplace of configuration.industryWorkplaces) {
      const company=companies.get(workplace.companyId);
      const facility=company?.facilities?.find(item=>item.id===workplace.facilityId);
      const territory=states.get(workplace.stateId);
      if(!company || company.stateId!==workplace.stateId ||
         !facility || provinces.get(workplace.provinceId)!==workplace.stateId ||
         !territory || company.currencyId!==territory.currencyId ||
         !occupations.has(workplace.occupationId) ||
         !integer(workplace.positions,1,Number.MAX_SAFE_INTEGER) ||
         !integer(workplace.wagePerWorkerPerDay,1,Number.MAX_SAFE_INTEGER) ||
         !integer(workplace.minimumQualificationLevel ?? 0,0,100) ||
         !integer(workplace.shiftHoursPerDay,1,24) ||
         !bounded(workplace.safetyRatingPercent,0,100) ||
         !bounded(workplace.hazardExposurePercent,0,100) ||
         typeof workplace.operational!=='boolean')
        return {ok:false,error:'A workplace needs a real company installation, State currency, province, occupation, paid positions, working hours and safety measurements.'};
      if(workplace.farmId &&
         !(game.farms || []).some(item=>item.id===workplace.farmId &&
           item.stateId===workplace.stateId && item.provinceId===workplace.provinceId))
        return {ok:false,error:'A workplace farm reference must identify an existing farm in the same province.'};
      if(workplace.waterDemandId)
        return {ok:false,error:'Industrial water-demand integration is not enabled yet; do not assign an unprocessed water demand to a workplace.'};
    }

    for(const union of configuration.labourUnions) {
      if(!states.has(union.stateId) || provinces.get(union.provinceId)!==union.stateId ||
         !occupations.has(union.occupationId) || !validText(union.name) ||
         typeof union.recognized!=='boolean' ||
         !bounded(union.membershipPercent,0,100) ||
         (union.negotiatedWagePerWorkerPerDay!==undefined &&
          !integer(union.negotiatedWagePerWorkerPerDay,1,Number.MAX_SAFE_INTEGER)))
        return {ok:false,error:'A labour union has invalid jurisdiction, occupation, recognition, membership or negotiated wage data.'};
    }
    for(const workplace of configuration.industryWorkplaces) {
      if(workplace.unionId && !configuration.labourUnions.some(item=>
        item.id===workplace.unionId && item.stateId===workplace.stateId &&
        item.provinceId===workplace.provinceId && item.occupationId===workplace.occupationId))
        return {ok:false,error:'A workplace can only reference a union in the same State, province and occupation.'};
    }
    return {ok:true,error:null};
  }

  function appendHistory(game,type,description,details={}) {
    game.industryHistory.push({
      id:'industry-'+game.worldDate+'-'+game.industryHistory.length+'-'+type,
      type,description,details:clone(details),worldDate:game.worldDate
    });
    if(game.industryHistory.length>3000)
      game.industryHistory.splice(0,game.industryHistory.length-3000);
    game.events ||= [];
    game.eventSequence=(Number(game.eventSequence)||0)+1;
    game.events.push({
      id:'industry-event-'+game.eventSequence,gameId:game.id,orderId:null,
      actorPlayerId:null,stateId:details.stateId||null,type:'industry.'+type,
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
    if(game.industryPayrollDate===game.worldDate) {
      const byCurrency={};
      for(const contract of game.industryEmploymentContracts || []) {
        const company=(game.companies || []).find(item=>item.id===contract.companyId);
        const currency=company?.currencyId || 'unknown';
        byCurrency[currency]=(byCurrency[currency]||0)+Number(contract.payroll||0);
      }
      return {ok:true,workplaces:(game.industryWorkplaces || []).length,
        employedWorkers:(game.industryEmploymentContracts || []).reduce((sum,item)=>sum+Number(item.workers||0),0),
        payrollByCurrency:byCurrency,replayed:true};
    }
    const companies=new Map((game.companies || []).map(item=>[item.id,item]));
    game.companyFinancialTransactions ||= [];
    const poolCapacity=new Map();
    const labourPoolsByGroup=new Map();
    for(const pool of game.labourPools) {
      if(!labourPoolsByGroup.has(pool.populationGroupId))
        labourPoolsByGroup.set(pool.populationGroupId,[]);
      labourPoolsByGroup.get(pool.populationGroupId).push(pool);
    }
    const groups=new Map((game.populationGroups || []).map(item=>[item.id,item]));
    for(const [groupId,pools] of labourPoolsByGroup) {
      const currentPopulation=Math.max(0,Number(groups.get(groupId)?.population)||0);
      const configuredSupply=pools.reduce((sum,item)=>sum+Number(item.workforce||0),0);
      const effectiveSupply=Math.min(currentPopulation,configuredSupply);
      const weights=pools.map(item=>({id:item.id,weight:Number(item.workforce)||0}));
      const allocationTotal=effectiveSupply;
      const weightSum=weights.reduce((sum,item)=>sum+item.weight,0);
      const rows=weights.map((item,index)=>{
        const exact=weightSum>0?allocationTotal*item.weight/weightSum:0;
        return {id:item.id,index,base:Math.floor(exact),remainder:exact-Math.floor(exact)};
      });
      let unassigned=allocationTotal-rows.reduce((sum,item)=>sum+item.base,0);
      rows.slice().sort((a,b)=>b.remainder-a.remainder || a.id.localeCompare(b.id))
        .forEach(row=>{if(unassigned>0){rows[row.index].base++;unassigned--;}});
      for(const row of rows) poolCapacity.set(row.id,row.base);
    }
    const remaining=new Map(game.labourPools.map(item=>[
      item.id,Math.min(Number(item.workforce)||0,poolCapacity.get(item.id)||0)
    ]));
    const unions=new Map(game.labourUnions.map(item=>[item.id,item]));
    const contracts=[];
    const workplaceRows=[];
    const facilities=new Map();
    const companyPayroll=new Map();
    const ordered=game.industryWorkplaces.slice().sort((a,b)=>
      a.stateId.localeCompare(b.stateId) ||
      a.provinceId.localeCompare(b.provinceId) ||
      a.occupationId.localeCompare(b.occupationId) ||
      (Number(b.wagePerWorkerPerDay)||0)-(Number(a.wagePerWorkerPerDay)||0) ||
      a.id.localeCompare(b.id));
    for(const workplace of ordered) {
      const company=companies.get(workplace.companyId);
      if(!company) throw new Error('Workplace '+workplace.id+' references a missing company.');
      company.cashBalances ||= {};
      const currencyId=company.currencyId;
      const cash=Number(company.cashBalances[currencyId]||0);
      if(!integer(cash,0))
        throw new Error('Company '+company.id+' has an invalid cash balance for payroll.');
      const union=workplace.unionId?unions.get(workplace.unionId):null;
      const baseWage=Number(workplace.wagePerWorkerPerDay);
      const unionMembershipPercent=union?.recognized
        ? Number(union.membershipPercent||0) : 0;
      const negotiated=unionMembershipPercent>0
        ? Number(union.negotiatedWagePerWorkerPerDay||0) : 0;
      const wage=Math.ceil(baseWage+
        Math.max(0,negotiated-baseWage)*unionMembershipPercent/100);
      if(!integer(wage,1))
        throw new Error('Workplace '+workplace.id+' has an invalid negotiated wage.');
      let vacancy=workplace.operational?Number(workplace.positions):0;
      const allocations=[];
      const pools=game.labourPools.filter(pool=>
        pool.stateId===workplace.stateId &&
        pool.provinceId===workplace.provinceId &&
        pool.occupationId===workplace.occupationId &&
        pool.qualificationLevel>=Number(workplace.minimumQualificationLevel||0))
        .sort((a,b)=>b.qualificationLevel-a.qualificationLevel || a.id.localeCompare(b.id));
      let cashRemaining=cash;
      for(const pool of pools) {
        if(vacancy<=0 || cashRemaining<wage) break;
        const available=remaining.get(pool.id)||0;
        const affordable=Math.floor(cashRemaining/wage);
        const hired=Math.min(vacancy,available,affordable);
        if(hired<=0) continue;
        remaining.set(pool.id,available-hired);
        vacancy-=hired;
        cashRemaining-=hired*wage;
        allocations.push({labourPoolId:pool.id,populationGroupId:pool.populationGroupId,
          workers:hired,qualificationLevel:pool.qualificationLevel});
      }
      const workers=allocations.reduce((sum,item)=>sum+item.workers,0);
      const payroll=workers*wage;
      if(!Number.isSafeInteger(payroll))
        throw new Error('Workplace '+workplace.id+' payroll exceeds the safe integer range.');
      const balanceBefore=cash;
      if(payroll>0) {
        company.cashBalances[currencyId]=cash-payroll;
        companyPayroll.set(company.id,(companyPayroll.get(company.id)||0)+payroll);
        game.companyFinancialTransactions ||= [];
        game.companyFinancialTransactions.push({
          id:'payroll-'+game.worldDate+'-'+workplace.id,
          companyId:company.id,stateId:company.stateId,currencyId,
          type:'Payroll',amount:-payroll,balanceBefore,balanceAfter:company.cashBalances[currencyId],
          worldDate:game.worldDate,recordedAtUtc:new Date().toISOString(),
          goodId:null,quantity:workers,unitPrice:wage,description:'Daily wages for '+workplace.name+'.'
        });
      }
      const contract={
        id:'employment-'+game.worldDate+'-'+workplace.id,
        workplaceId:workplace.id,companyId:company.id,stateId:workplace.stateId,
        provinceId:workplace.provinceId,facilityId:workplace.facilityId,
        occupationId:workplace.occupationId,workers,wagePerWorkerPerDay:wage,
        baseWagePerWorkerPerDay:baseWage,
        unionId:union?.recognized && unionMembershipPercent>0?union.id:null,
        unionMembershipPercent,negotiatedWagePerWorkerPerDay:negotiated,
        payroll,allocations,
        safetyRatingPercent:Number(workplace.safetyRatingPercent),
        hazardExposurePercent:Number(workplace.hazardExposurePercent),
        effectiveSafetyPercent:Math.round(
          Number(workplace.safetyRatingPercent)*(100-Number(workplace.hazardExposurePercent))
        )/100,
        shiftHoursPerDay:Number(workplace.shiftHoursPerDay),worldDate:game.worldDate
      };
      workplace.workersEmployed=workers;
      workplace.wagePaidLastDay=wage;
      workplace.payrollLastDay=payroll;
      workplace.lastPayrollOn=game.worldDate;
      const facilityKey=JSON.stringify([company.id,workplace.facilityId]);
      facilities.set(facilityKey,(facilities.get(facilityKey)||0)+workers);
      if(workplace.farmId) {
        const farm=(game.farms || []).find(item=>item.id===workplace.farmId);
        if(farm) farm.workers=workers;
      }
      const water=workplace.waterDemandId
        ? (game.waterAllocations || []).find(item=>
            item.demandId===workplace.waterDemandId && item.worldDate===game.worldDate)
        : null;
      contract.waterCoveragePercent=water?Number(water.coveragePercent):null;
      contracts.push(contract);
      workplaceRows.push({workplace,workers,positions:workplace.positions,wage,payroll,union,allocations});
    }
    for(const [key,workers] of facilities) {
      const [companyId,facilityId]=JSON.parse(key);
      const facility=companies.get(companyId)?.facilities?.find(item=>item.id===facilityId);
      if(facility) facility.workers=workers;
    }

    const balances=[];
    const groupsByState=new Map();
    for(const pool of game.labourPools) {
      if(!groupsByState.has(pool.stateId)) groupsByState.set(pool.stateId,[]);
      groupsByState.get(pool.stateId).push(pool);
    }
    for(const [stateId,pools] of groupsByState) {
      const supply=pools.reduce((sum,item)=>sum+(poolCapacity.get(item.id)||0),0);
      const employed=workplaceRows.filter(item=>item.workplace.stateId===stateId)
        .reduce((sum,item)=>sum+item.workers,0);
      const territory=game.territories.find(item=>item.stateId===stateId);
      balances.push({
        stateId,currencyId:territory?.currencyId||null,
        workforce:supply,employed,unemployed:Math.max(0,supply-employed),
        employmentRatePercent:supply?Math.round(employed/supply*10000)/100:0,
        dailyPayroll:companyPayroll.size
          ? [...companyPayroll].reduce((sum,[companyId,value])=>
              sum+(companies.get(companyId)?.stateId===stateId?value:0),0)
          : 0,worldDate:game.worldDate
      });
    }
    game.industryEmploymentContracts=contracts;
    game.industryLabourBalances=balances;
    const employed=contracts.reduce((sum,item)=>sum+item.workers,0);
    const payrollByCurrency={};
    for(const contract of contracts) {
      const currency=companies.get(contract.companyId)?.currencyId || 'unknown';
      payrollByCurrency[currency]=(payrollByCurrency[currency]||0)+contract.payroll;
    }
    for(const row of workplaceRows) {
      if(row.workers<row.positions ||
         (row.union && row.wage>row.workplace.wagePerWorkerPerDay))
        appendHistory(game,'workplace_result',
          row.workplace.name+': '+row.workers+' of '+row.positions+' positions filled at '+row.wage+
          ' per worker/day.',
          {stateId:row.workplace.stateId,workplaceId:row.workplace.id,
           workers:row.workers,positions:row.positions,wage:row.wage,payroll:row.payroll,
           unionId:row.union?.id||null});
    }
    if(game.companyFinancialTransactions.length>3000)
      game.companyFinancialTransactions.splice(0,game.companyFinancialTransactions.length-3000);
    game.industryPayrollDate=game.worldDate;
    return {ok:true,workplaces:workplaceRows.length,employedWorkers:employed,payrollByCurrency};
  }

  const api=Object.freeze({
    ensure,validateConfiguration,advanceDay,
    configurationFields:Object.freeze([...configurationFields]),
    runtimeFields:Object.freeze([...runtimeFields])
  });
  globalThis.NewWorldIndustry=api;
  if(typeof module!=='undefined' && module.exports) module.exports=api;
})();