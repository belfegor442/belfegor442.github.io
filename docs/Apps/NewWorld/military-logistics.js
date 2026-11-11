(() => {
  'use strict';

  const CONFIG_FIELDS=['supplyRoutes','supplyRules','supplyStocks'];
  const DYNAMIC_FIELDS=['supplyShipments','supplyHistory'];
  const idPattern=/^[A-Za-z0-9][A-Za-z0-9._:-]{1,99}$/;
  const finite=(value,min,max)=>Number.isFinite(value)&&value>=min&&value<=max;
  const integer=(value,min,max)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
  const cleanId=value=>typeof value==='string'&&idPattern.test(value);
  const round=value=>Math.round((Number(value)||0)*1000000)/1000000;
  const clone=value=>structuredClone(value);

  function ensure(game) {
    if(!game) return game;
    for(const field of [...CONFIG_FIELDS,...DYNAMIC_FIELDS])
      if(!Array.isArray(game[field])) game[field]=[];
    return game;
  }

  function validUnique(items) {
    return Array.isArray(items)&&items.every(item=>cleanId(item?.id))&&
      new Set(items.map(item=>item.id)).size===items.length;
  }

  function validateConfiguration(game,configuration) {
    if(!configuration||CONFIG_FIELDS.some(field=>!Array.isArray(configuration[field])))
      return {ok:false,error:'Military logistics requires supplyRoutes, supplyRules and supplyStocks arrays.'};
    const states=new Set((game.territories||[]).map(item=>item.stateId));
    const provinces=new Map((game.provinces||[]).map(item=>[item.id,item.stateId]));
    const goods=new Set((game.goods||[]).map(item=>item.id));
    const companies=new Map((game.companies||[]).map(item=>[item.id,item]));
    const types=new Set((configuration.unitTypes||configuration.militaryUnitTypes||
      game.militaryUnitTypes||[]).map(item=>item.id));
    for(const field of CONFIG_FIELDS)
      if(!validUnique(configuration[field]))
        return {ok:false,error:'IDs in '+field+' must be unique, stable and valid.'};

    for(const stock of configuration.supplyStocks) {
      if(!states.has(stock.stateId)||provinces.get(stock.provinceId)!==stock.stateId||
         !goods.has(stock.goodId)||!finite(stock.capacity,0.000001,Number.MAX_SAFE_INTEGER)||
         !finite(stock.quantity,0,stock.capacity))
        return {ok:false,error:'A military supply store needs a valid State, same-State province, good, finite capacity and stock within capacity.'};
    }
    const stockKeys=new Set(configuration.supplyStocks.map(item=>
      [item.stateId,item.provinceId,item.goodId].join('|')));
    for(const rule of configuration.supplyRules) {
      if(!states.has(rule.stateId)||!types.has(rule.unitTypeId)||
         !rule.consumptionPer100PersonnelPerDay||
         typeof rule.consumptionPer100PersonnelPerDay!=='object'||
         Array.isArray(rule.consumptionPer100PersonnelPerDay)||
         !Object.keys(rule.consumptionPer100PersonnelPerDay).length||
         !integer(rule.undersupplyStrengthPenaltyPercent,0,100)||
         !finite(rule.unsuppliedMoraleLossPerDay??0,0,100))
        return {ok:false,error:'A military supply rule needs a State, an existing unit type, at least one consumption good and a bounded undersupply penalty.'};
      for(const [goodId,quantity] of Object.entries(rule.consumptionPer100PersonnelPerDay))
        if(!goods.has(goodId)||!finite(quantity,0.000001,1000000))
          return {ok:false,error:'Military supply consumption must reference existing goods and positive daily quantities per 100 personnel.'};
      if(new Set(configuration.supplyRules.map(item=>item.stateId+'|'+item.unitTypeId)).size!==configuration.supplyRules.length)
        return {ok:false,error:'Only one military supply profile may be declared for each State and unit type.'};
    }
    for(const route of configuration.supplyRoutes) {
      const company=companies.get(route.originCompanyId);
      if(!states.has(route.stateId)||!company||company.stateId!==route.stateId||
         provinces.get(route.destinationProvinceId)!==route.stateId||
         !goods.has(route.goodId)||
         !stockKeys.has([route.stateId,route.destinationProvinceId,route.goodId].join('|'))||
         !integer(route.dailyCapacity,1,1000000000)||
         !integer(route.travelDays,1,3650)||
         typeof route.enabled!=='boolean')
        return {ok:false,error:'A military supply route needs an existing same-State supplier, destination store, good, positive daily capacity, travel time and explicit enabled state.'};
    }
    const routeKeys=configuration.supplyRoutes.map(item=>
      [item.stateId,item.originCompanyId,item.destinationProvinceId,item.goodId].join('|'));
    if(new Set(routeKeys).size!==routeKeys.length)
      return {ok:false,error:'Duplicate military supply routes are not permitted.'};
    return {ok:true,error:null};
  }

  function dateAfter(date,days) {
    const value=new Date(date+'T00:00:00.000Z');
    value.setUTCDate(value.getUTCDate()+days);
    return value.toISOString().slice(0,10);
  }

  function history(game,createId,type,route,description,details) {
    const entry={
      id:createId(),type,stateId:route.stateId,routeId:route.id,
      worldDate:game.worldDate,description,details:clone(details||{})
    };
    game.supplyHistory.push(entry);
    if(game.supplyHistory.length>2000)
      game.supplyHistory.splice(0,game.supplyHistory.length-2000);
    game.events ||= [];
    game.eventSequence=(Number(game.eventSequence)||0)+1;
    game.events.push({
      id:createId(),gameId:game.id,orderId:null,actorPlayerId:null,
      stateId:route.stateId,type:'military.supply.'+type,
      occurredAtUtc:new Date().toISOString(),worldDate:game.worldDate,
      worldVersion:game.worldVersion,description,sequence:game.eventSequence
    });
    if(game.events.length>1000) game.events.splice(0,game.events.length-1000);
    game.activity ||= [];
    game.activity.unshift(description);
    if(game.activity.length>100) game.activity.length=100;
    return entry;
  }

  function advanceDay(game,createId) {
    if(!game||!Array.isArray(game.territories))
      return {ok:false,error:'The military logistics world is unavailable.'};
    ensure(game);
    if(game.militarySupplyCycleDate===game.worldDate)
      return {ok:true,skipped:true,delivered:0,dispatched:0,consumed:0};
    createId ||= (()=>'military-supply-'+game.id+'-'+(++game.eventSequence));
    let delivered=0,dispatched=0,consumed=0;

    for(const shipment of game.supplyShipments) {
      if(!['in_transit','awaiting_storage'].includes(shipment.status)||
         shipment.arrivalOn>game.worldDate) continue;
      const stock=game.supplyStocks.find(item=>
        item.stateId===shipment.stateId&&item.provinceId===shipment.destinationProvinceId&&
        item.goodId===shipment.goodId);
      if(!stock) {
        shipment.status='awaiting_storage';
        continue;
      }
      const space=Math.max(0,Number(stock.capacity)-Number(stock.quantity));
      const amount=Math.min(space,Number(shipment.quantity)||0);
      if(amount>0) {
        stock.quantity=round(Number(stock.quantity)+amount);
        shipment.quantity=round(Number(shipment.quantity)-amount);
        delivered=round(delivered+amount);
      }
      if(shipment.quantity<=0.000001) {
        shipment.quantity=0;
        shipment.status='delivered';
        shipment.deliveredOn=game.worldDate;
        history(game,createId,'delivered',game.supplyRoutes.find(item=>item.id===shipment.routeId)||{
          id:shipment.routeId,stateId:shipment.stateId
        },'Military supplies delivered to '+(game.provinces.find(item=>item.id===shipment.destinationProvinceId)?.name||shipment.destinationProvinceId)+'.',{
          shipmentId:shipment.id,goodId:shipment.goodId,quantity:amount
        });
      } else {
        shipment.status='awaiting_storage';
      }
    }

    for(const route of game.supplyRoutes) {
      if(route.enabled!==true||route.lastDispatchedOn===game.worldDate) continue;
      const company=game.companies.find(item=>item.id===route.originCompanyId&&
        item.stateId===route.stateId);
      if(!company) continue;
      company.inventory ||= {};
      const available=Math.max(0,Number(company.inventory[route.goodId])||0);
      const amount=round(Math.min(Number(route.dailyCapacity)||0,available));
      route.lastDispatchedOn=game.worldDate;
      if(amount<=0) continue;
      company.inventory[route.goodId]=round(available-amount);
      const shipment={
        id:createId(),stateId:route.stateId,routeId:route.id,
        originCompanyId:company.id,destinationProvinceId:route.destinationProvinceId,
        goodId:route.goodId,quantity:amount,dispatchedOn:game.worldDate,
        arrivalOn:dateAfter(game.worldDate,route.travelDays),status:'in_transit'
      };
      game.supplyShipments.push(shipment);
      dispatched=round(dispatched+amount);
      history(game,createId,'dispatched',route,
        'Military supply convoy dispatched from '+company.name+'.',{
          shipmentId:shipment.id,goodId:route.goodId,quantity:amount,
          arrivalOn:shipment.arrivalOn
        });
    }

    for(const unit of game.militaryUnits||[]) {
      if(Number(unit.personnel)<=0||['destroyed','disbanded'].includes(unit.status)) continue;
      const rule=game.supplyRules.find(item=>
        item.stateId===unit.stateId&&item.unitTypeId===unit.unitTypeId);
      if(!rule) {
        delete unit.supplyStatus;
        delete unit.supplyCoveragePercent;
        delete unit.supplyDelivered;
        delete unit.supplyRequired;
        continue;
      }
      const needs=rule.consumptionPer100PersonnelPerDay||{};
      let totalRequired=0,totalDelivered=0,minimumCoverage=100;
      for(const [goodId,rate] of Object.entries(needs)) {
        const required=round(Number(unit.personnel)/100*Number(rate));
        const stores=game.supplyStocks.filter(item=>
          item.stateId===unit.stateId&&item.provinceId===unit.provinceId&&
          item.goodId===goodId);
        let remaining=required;
        for(const stock of stores) {
          const amount=Math.min(remaining,Math.max(0,Number(stock.quantity)||0));
          stock.quantity=round(Number(stock.quantity)-amount);
          remaining=round(remaining-amount);
          totalDelivered=round(totalDelivered+amount);
          if(remaining<=0.000001) break;
        }
        totalRequired=round(totalRequired+required);
        minimumCoverage=Math.min(minimumCoverage,required>0
          ? 100*Math.max(0,required-remaining)/required:100);
      }
      const coverage=totalRequired>0?Math.round(minimumCoverage*100)/100:100;
      unit.supplyStatus=coverage>=99.999?'supplied':'undersupplied';
      unit.supplyCoveragePercent=coverage;
      unit.supplyRequired=totalRequired;
      unit.supplyDelivered=totalDelivered;
      unit.supplyLastCheckedOn=game.worldDate;
      consumed=round(consumed+totalDelivered);
      if(unit.supplyStatus==='undersupplied') {
        unit.morale=Math.max(0,Number(unit.morale||0)-
          Math.max(0,Number(rule.unsuppliedMoraleLossPerDay)||0));
      }
    }

    for(const shipment of game.supplyShipments) {
      if(shipment.status==='in_transit'&&shipment.arrivalOn<=game.worldDate)
        shipment.status='awaiting_storage';
    }
    game.militarySupplyCycleDate=game.worldDate;
    game.militarySupplyCycleResult={delivered,dispatched,consumed};
    return {ok:true,delivered,dispatched,consumed};
  }

  function combatMultiplier(game,unit) {
    const rule=(game.supplyRules||[]).find(item=>
      item.stateId===unit?.stateId&&item.unitTypeId===unit?.unitTypeId);
    if(!rule||unit?.supplyLastCheckedOn!==game.worldDate||
       !Number.isFinite(Number(unit.supplyCoveragePercent))) return 1;
    const coverage=Math.max(0,Math.min(100,Number(unit.supplyCoveragePercent)));
    const penalty=Math.max(0,Math.min(100,Number(rule.undersupplyStrengthPenaltyPercent)||0));
    return Math.max(0,1-penalty/100*(1-coverage/100));
  }

  const api=Object.freeze({
    ensure,validateConfiguration,advanceDay,combatMultiplier,
    configurationFields:Object.freeze([...CONFIG_FIELDS]),
    dynamicFields:Object.freeze([...DYNAMIC_FIELDS])
  });
  globalThis.NewWorldMilitaryLogistics=api;
  if(typeof window!=='undefined') window.NewWorldMilitaryLogistics=api;
  if(typeof module!=='undefined'&&module.exports) module.exports=api;
})();
