(() => {
  'use strict';

  const CONFIG_FIELDS=Object.freeze(['eventDefinitions']);
  const DYNAMIC_FIELDS=Object.freeze(['worldEvents','worldEventHistory','worldEventCounters']);
  const categories=new Set(['political','economic','social','diplomatic','military','technological','environmental','public_health','security','infrastructure']);
  const effectTypes=new Set(['treasury_delta','opinion_delta','press_freedom_delta','resource_quantity_delta']);
  const triggerMetrics=new Set([
    'market_unmet_demand_total','water_shortage_total','public_debt_defaults',
    'military_defeats','public_security_alerts','epidemic_exposures',
    'epidemic_infections','epidemic_deaths','active_epidemic_cases',
    'active_epidemic_outbreaks'
  ]);
  const comparisonOperators=new Set(['gt','gte','lt','lte','eq']);
  const cleanText=(value,min=2,max=500)=>typeof value==='string' &&
    value.trim().length>=min && value.length<=max &&
    !/[<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
  const num=(value,min,max)=>Number.isFinite(value)&&value>=min&&value<=max;
  const int=(value,min,max)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
  const id=value=>typeof value==='string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{1,99}$/.test(value);
  const unique=items=>Array.isArray(items)&&items.every(item=>id(item?.id))&&
    new Set(items.map(item=>item.id)).size===items.length;
  const dateValid=value=>{
    if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed=new Date(value+'T00:00:00Z');
    return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===value;
  };
  const clone=value=>structuredClone(value);

  function ensure(game) {
    if(!game||!Array.isArray(game.territories)) return game;
    for(const field of [...CONFIG_FIELDS,...DYNAMIC_FIELDS])
      if(!Array.isArray(game[field])) game[field]=[];
    return game;
  }

  function validateConfiguration(game,c) {
    if(!c||!Array.isArray(c.eventDefinitions))
      return {ok:false,error:'The event scenario requires an eventDefinitions array.'};
    if(!unique(c.eventDefinitions))
      return {ok:false,error:'Event definition IDs must be unique and stable.'};
    const territories=new Map((game.territories||[]).map(item=>[item.stateId,item]));
    const offices=new Map((game.politicalSystems||[]).map(system=>
      [system.stateId,new Set((system.offices||[]).map(item=>item.id))]));
    for(const def of c.eventDefinitions) {
      if(!territories.has(def.stateId)||!cleanText(def.title,4,120)||
         !categories.has(def.category)||!cleanText(def.description,20,800)||
         !dateValid(def.startsOn)||!dateValid(def.endsOn)||def.endsOn<def.startsOn||
         typeof def.active!=='boolean' || !int(def.chancePerThousand,0,1000)||
         !int(def.maxOccurrences,1,1000)||
         !int(def.cooldownDays,0,36500)||
         !int(def.expiresInDays,1,90)||
         !Array.isArray(def.decisionOfficeIds)||!def.decisionOfficeIds.length||
         def.decisionOfficeIds.some(id=>!offices.get(def.stateId)?.has(id))||
         !Array.isArray(def.options)||def.options.length<2||def.options.length>8||
         new Set(def.options.map(item=>item.id)).size!==def.options.length)
        return {ok:false,error:'An event needs a valid State, category, date window, bounded probability, occurrence limit, decision offices and 2–8 options.'};
      if(def.conditions!==undefined &&
         (!Array.isArray(def.conditions)||def.conditions.length>8||
          def.conditions.some(condition=>!condition||
            !triggerMetrics.has(condition.metric)||
            !comparisonOperators.has(condition.operator)||
            !num(condition.threshold,0,Number.MAX_SAFE_INTEGER))))
        return {ok:false,error:'Trigger conditions must use supported observed metrics, explicit comparison operators and finite non-negative thresholds.'};
      if(def.conditionMode!==undefined && !['all','any'].includes(def.conditionMode))
        return {ok:false,error:'Trigger condition mode must be all or any.'};
      for(const option of def.options) {
        if(!id(option.id)||!cleanText(option.label,2,80)||
           !cleanText(option.description,10,400)||
           !Array.isArray(option.effects)||!option.effects.length)
          return {ok:false,error:'Every event option needs a unique ID, label, description and at least one effect.'};
        for(const effect of option.effects) {
          if(!effectTypes.has(effect.type)||
             (effect.type==='treasury_delta' &&
               (!num(effect.amount,-1000000000,1000000000)))||
             (effect.type==='opinion_delta' &&
               (!id(effect.topicId)||!num(effect.amount,-25,25)))||
             (effect.type==='press_freedom_delta' &&
               !num(effect.amount,-25,25))||
             (effect.type==='resource_quantity_delta' &&
               (!id(effect.goodId)||!num(effect.amount,-1000000000,1000000000))))
            return {ok:false,error:'An event option contains an unsupported effect or an out-of-range adjustment.'};
          if(effect.type==='opinion_delta' &&
             !(game.publicOpinionProfiles||[]).some(item=>
               item.stateId===def.stateId&&item.topicId===effect.topicId))
            return {ok:false,error:'An opinion effect must reference an existing public-opinion profile in the same State.'};
          if(effect.type==='press_freedom_delta' &&
             !(game.mediaRules||[]).some(item=>item.stateId===def.stateId))
            return {ok:false,error:'A press-freedom effect requires configured media rules in the same State.'};
          if(effect.type==='resource_quantity_delta' &&
             !(game.resourceCatalog||[]).some(item=>
               item.stateId===def.stateId&&item.goodId===effect.goodId))
            return {ok:false,error:'A resource effect must reference a resource catalog entry in the same State.'};
        }
      }
    }
    return {ok:true,error:null};
  }

  function record(game,type,stateId,description,details,createId) {
    const sequence=(Number(game.eventSequence)||0)+1;
    game.eventSequence=sequence;
    const entry={id:createId(),type,stateId,description,details:clone(details||{}),
      worldDate:game.worldDate,worldVersion:(Number(game.worldVersion)||0)+1,sequence};
    game.worldEventHistory.push(entry);
    if(game.worldEventHistory.length>3000)
      game.worldEventHistory.splice(0,game.worldEventHistory.length-3000);
    game.events ||= [];
    game.events.push({...entry,id:createId(),gameId:game.id,orderId:null,
      type:'world_event.'+type,resultCode:null,occurredAtUtc:new Date().toISOString()});
    if(game.events.length>1000) game.events.splice(0,game.events.length-1000);
    game.activity ||= [];
    game.activity.unshift(description);
    game.activity=game.activity.slice(0,100);
    return entry;
  }

  function roll(game,def,counter) {
    const seed=game.id+'|'+game.worldDate+'|'+def.id+'|'+counter.occurrences;
    let hash=2166136261;
    for(let i=0;i<seed.length;i++) {
      hash^=seed.charCodeAt(i);
      hash=Math.imul(hash,16777619);
    }
    return (hash>>>0)%1000;
  }

  function observedTriggerMetrics(game,stateId,worldDate) {
    const sameDay=(item,dateField='worldDate')=>item?.stateId===stateId&&item?.[dateField]===worldDate;
    return {
      market_unmet_demand_total:(game.marketHistory||[]).filter(item=>sameDay(item))
        .reduce((sum,item)=>sum+Math.max(0,Number(item.unmetDemand)||0),0),
      water_shortage_total:(game.waterAllocations||[]).filter(item=>sameDay(item))
        .reduce((sum,item)=>sum+Math.max(0,Number(item.shortage)||0),0),
      public_debt_defaults:(game.publicDebtIssues||[]).filter(item=>
        item?.stateId===stateId&&item.defaultedOn===worldDate).length,
      military_defeats:(game.militaryOrders||[]).filter(item=>
        item?.stateId===stateId&&item.status==='repelled'&&item.submittedOnWorldDate===worldDate).length,
      public_security_alerts:(game.securityAlerts||[]).filter(item=>sameDay(item,'issuedOn')&&item.status==='active').length,
      epidemic_exposures:(game.events||[]).filter(item=>
        sameDay(item)&&item.type==='society.epidemic_spread')
        .reduce((sum,item)=>sum+Math.max(0,Number(item.details?.quantity)||0),0),
      epidemic_infections:(game.events||[]).filter(item=>
        sameDay(item)&&item.type==='society.epidemic_infections')
        .reduce((sum,item)=>sum+Math.max(0,Number(item.details?.quantity)||0),0),
      epidemic_deaths:(game.events||[]).filter(item=>
        sameDay(item)&&item.type==='society.epidemic_deaths')
        .reduce((sum,item)=>sum+Math.max(0,Number(item.details?.quantity)||0),0),
      active_epidemic_cases:(game.epidemicGroupStates||[]).filter(item=>item.stateId===stateId)
        .reduce((sum,item)=>sum+
          (item.exposedCohorts||[]).reduce((inner,cohort)=>inner+Math.max(0,Number(cohort.count)||0),0)+
          (item.infectiousCohorts||[]).reduce((inner,cohort)=>inner+Math.max(0,Number(cohort.count)||0),0),0),
      active_epidemic_outbreaks:(game.epidemicOutbreaks||[]).filter(item=>
        item.stateId===stateId&&item.status==='active').length
    };
  }

  function evaluateConditions(game,definition) {
    const conditions=Array.isArray(definition.conditions)?definition.conditions:[];
    if(!conditions.length) return {passed:true,evidence:[],mode:'all'};
    const metrics=observedTriggerMetrics(game,definition.stateId,game.worldDate);
    const evidence=conditions.map(condition=>{
      const actual=metrics[condition.metric];
      const threshold=condition.threshold;
      let passed=false;
      if(condition.operator==='gt') passed=actual>threshold;
      else if(condition.operator==='gte') passed=actual>=threshold;
      else if(condition.operator==='lt') passed=actual<threshold;
      else if(condition.operator==='lte') passed=actual<=threshold;
      else if(condition.operator==='eq') passed=actual===threshold;
      return {metric:condition.metric,actual,operator:condition.operator,threshold,passed};
    });
    const mode=definition.conditionMode||'all';
    return {passed:mode==='any'?evidence.some(item=>item.passed):evidence.every(item=>item.passed),evidence,mode};
  }

  function evaluateDefinition(game,definition) {
    const counter=(game.worldEventCounters||[]).find(item=>item.definitionId===definition.id)||
      {definitionId:definition.id,occurrences:0,lastTriggeredOn:null};
    const open=(game.worldEvents||[]).some(item=>
      item.definitionId===definition.id&&item.status==='open');
    const conditions=evaluateConditions(game,definition);
    const rollValue=roll(game,definition,counter);
    let reason=null;
    if(!definition.active) reason='inactive';
    else if(game.worldDate<definition.startsOn||game.worldDate>definition.endsOn) reason='outside_date_window';
    else if(open) reason='existing_open_event';
    else if(counter.occurrences>=definition.maxOccurrences) reason='occurrence_limit';
    else if(counter.lastTriggeredOn&&daysBetween(counter.lastTriggeredOn,game.worldDate)<definition.cooldownDays) reason='cooldown';
    else if(!conditions.passed) reason='conditions_not_met';
    else if(rollValue>=definition.chancePerThousand) reason='probability_roll_failed';
    return {eligible:reason===null,reason,conditions,roll:rollValue};
  }

  function validateEffects(game,stateId,effects) {
    const territory=game.territories.find(item=>item.stateId===stateId);
    const staged=[];
    for(const effect of effects) {
      if(effect.type==='treasury_delta') {
        const before=Number(territory?.treasury);
        if(!Number.isFinite(before)) return {ok:false,code:'WORLD_EVENT_EFFECT_TARGET_MISSING',error:'The State treasury is unavailable.'};
        const after=before+effect.amount;
        if(after<0||after>Number.MAX_SAFE_INTEGER)
          return {ok:false,code:'WORLD_EVENT_EFFECT_UNAFFORDABLE',error:'The treasury cannot support the full event effect.'};
        staged.push({type:effect.type,before,after});
      } else if(effect.type==='opinion_delta') {
        const profile=game.publicOpinionProfiles.find(item=>
          item.stateId===stateId&&item.topicId===effect.topicId);
        if(!profile) return {ok:false,code:'WORLD_EVENT_EFFECT_TARGET_MISSING',error:'The public-opinion topic is not available.'};
        staged.push({type:effect.type,topicId:effect.topicId,before:profile.supportPercent,
          after:Math.max(0,Math.min(100,profile.supportPercent+effect.amount))});
      } else if(effect.type==='press_freedom_delta') {
        const rule=game.mediaRules.find(item=>item.stateId===stateId);
        if(!rule) return {ok:false,code:'WORLD_EVENT_EFFECT_TARGET_MISSING',error:'Media rules are not available.'};
        staged.push({type:effect.type,before:rule.pressFreedomPercent,
          after:Math.max(0,Math.min(100,rule.pressFreedomPercent+effect.amount))});
      } else if(effect.type==='resource_quantity_delta') {
        const stocks=game.resourceStocks.filter(item=>
          item.stateId===stateId&&item.goodId===effect.goodId);
        const current=stocks.reduce((sum,item)=>sum+item.quantity,0);
        const after=current+effect.amount;
        if(after<0) return {ok:false,code:'WORLD_EVENT_EFFECT_UNAFFORDABLE',error:'Existing stock is insufficient for this resource adjustment.'};
        const catalog=game.resourceCatalog.find(item=>
          item.stateId===stateId&&item.goodId===effect.goodId);
        const good=game.goods.find(item=>item.id===effect.goodId);
        const capacity=good?.storageCapacity;
        if(Number.isFinite(capacity)&&after>capacity)
          return {ok:false,code:'WORLD_EVENT_EFFECT_STORAGE_FULL',error:'The configured storage capacity cannot hold the full resource effect.'};
        staged.push({type:effect.type,goodId:effect.goodId,before:current,after});
      } else return {ok:false,code:'WORLD_EVENT_EFFECT_UNSUPPORTED',error:'The event effect is not supported.'};
    }
    return {ok:true,staged};
  }

  function applyEffects(game,stateId,effects) {
    const staged=validateEffects(game,stateId,effects);
    if(!staged.ok) return staged;
    for(const change of staged.staged) {
      if(change.type==='treasury_delta') {
        game.territories.find(item=>item.stateId===stateId).treasury=change.after;
      } else if(change.type==='opinion_delta') {
        game.publicOpinionProfiles.find(item=>
          item.stateId===stateId&&item.topicId===change.topicId).supportPercent=change.after;
      } else if(change.type==='press_freedom_delta') {
        game.mediaRules.find(item=>item.stateId===stateId).pressFreedomPercent=change.after;
      } else if(change.type==='resource_quantity_delta') {
        const stocks=game.resourceStocks.filter(item=>
          item.stateId===stateId&&item.goodId===change.goodId);
        const difference=change.after-change.before;
        if(stocks.length) stocks[0].quantity+=difference;
        else if(difference>0) game.resourceStocks.push({
          id:'world-event-stock-'+game.id+'-'+stateId+'-'+change.goodId+'-'+game.worldDate,
          stateId,goodId:change.goodId,quantity:difference,
          updatedOn:game.worldDate,source:'world_event'
        });
        if(stocks.length) stocks[0].updatedOn=game.worldDate;
      }
    }
    return {ok:true,changes:staged.staged};
  }

  function advanceDay(game,createId) {
    ensure(game);
    const generated=[];
    for(const event of game.worldEvents) {
      if(event.status==='open'&&event.expiresOn<game.worldDate) {
        event.status='expired';
        record(game,'expired',event.stateId,'A world event expired without an authorized decision.',
          {eventId:event.id,definitionId:event.definitionId},createId);
      }
    }
    for(const def of game.eventDefinitions) {
      const evaluation=evaluateDefinition(game,def);
      if(!evaluation.eligible) continue;
      let counter=game.worldEventCounters.find(item=>item.definitionId===def.id);
      if(!counter) {
        counter={definitionId:def.id,occurrences:0,lastTriggeredOn:null};
        game.worldEventCounters.push(counter);
      }
      const event={
        id:createId(),definitionId:def.id,stateId:def.stateId,title:def.title,
        category:def.category,description:def.description,options:clone(def.options),
        decisionOfficeIds:[...def.decisionOfficeIds],createdOn:game.worldDate,
        expiresOn:addDays(game.worldDate,def.expiresInDays),
        status:'open',chosenOptionId:null,chosenByPlayerId:null,resolvedOn:null,
        triggerEvidence:clone(evaluation.conditions.evidence),
        triggerConditionMode:evaluation.conditions.mode,triggerRoll:evaluation.roll
      };
      game.worldEvents.push(event);
      counter.occurrences++;
      counter.lastTriggeredOn=game.worldDate;
      generated.push(event.id);
      record(game,'triggered',def.stateId,'World event triggered: '+def.title+'.',
        {eventId:event.id,definitionId:def.id,category:def.category,
         triggerEvidence:event.triggerEvidence,conditionMode:event.triggerConditionMode,
         probabilityRoll:event.triggerRoll},createId);
    }
    return {ok:true,generatedEventIds:generated};
  }

  function explainEvaluation(game,definitionId) {
    ensure(game);
    const definition=game.eventDefinitions.find(item=>item.id===definitionId);
    if(!definition) return {known:false,eligible:false,reason:'definition_not_found',conditions:[]};
    const evaluation=evaluateDefinition(game,definition);
    return {
      known:true,definitionId,eligible:evaluation.eligible,reason:evaluation.reason,
      worldDate:game.worldDate,roll:evaluation.roll,
      chancePerThousand:definition.chancePerThousand,
      conditionMode:evaluation.conditions.mode,
      conditions:clone(evaluation.conditions.evidence)
    };
  }

  function applyOrder(game,player,membership,order,createId) {
    if(order?.type!=='worldEvents.chooseOption') return null;
    ensure(game);
    const event=game.worldEvents.find(item=>
      item.id===order.eventId&&item.stateId===membership?.stateId);
    if(!event||event.status!=='open')
      return {ok:false,code:'WORLD_EVENT_UNAVAILABLE',error:'The event is no longer open for a decision.'};
    const offices=new Set((game.politicalSystems.find(item=>item.stateId===event.stateId)?.offices||[])
      .filter(item=>item.holderPlayerId===player.id).map(item=>item.id));
    if(!event.decisionOfficeIds.some(id=>offices.has(id)))
      return {ok:false,code:'WORLD_EVENT_AUTHORITY_REQUIRED',error:'The player does not hold an office authorized to choose this event option.'};
    const option=event.options.find(item=>item.id===order.optionId);
    if(!option)
      return {ok:false,code:'WORLD_EVENT_OPTION_INVALID',error:'The selected event option is not available.'};
    const applied=applyEffects(game,event.stateId,option.effects);
    if(!applied.ok)
      return {ok:false,code:applied.code,error:applied.error};
    event.status='resolved';event.chosenOptionId=option.id;
    event.chosenByPlayerId=player.id;event.resolvedOn=game.worldDate;
    event.effectSummary=applied.changes.map(item=>item.type).join(', ');
    record(game,'resolved',event.stateId,
      'World event resolved: '+event.title+' — '+option.label+'.',
      {eventId:event.id,optionId:option.id,changes:applied.changes},createId);
    return {ok:true};
  }

  function addDays(date,days) {
    const value=new Date(date+'T00:00:00Z');
    value.setUTCDate(value.getUTCDate()+days);
    return value.toISOString().slice(0,10);
  }
  function daysBetween(a,b) {
    return Math.floor((Date.parse(b+'T00:00:00Z')-Date.parse(a+'T00:00:00Z'))/86400000);
  }

  const api=Object.freeze({
    ensure,validateConfiguration,advanceDay,explainEvaluation,applyOrder,
    configurationFields:Object.freeze([...CONFIG_FIELDS]),
    dynamicFields:Object.freeze([...DYNAMIC_FIELDS])
  });
  globalThis.NewWorldWorldEvents=api;
  if(typeof module!=='undefined'&&module.exports) module.exports=api;
})();