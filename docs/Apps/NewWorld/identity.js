(() => {
  'use strict';

  const CONFIG_FIELDS=Object.freeze([
    'identityGroups','identityProfiles','identityOrganizations'
  ]);
  const DYNAMIC_FIELDS=Object.freeze([
    'communityPrograms','identityHistory','socialCohesionHistory'
  ]);
  const FUTURE_FIELDS=Object.freeze([
    'religions','religiousInstitutions','religiousOffices','religiousCommunities',
    'ideologies','politicalMovements','culturalIdentities','nationalIdentities',
    'minorityStatuses','conversionRecords','identityConflicts'
  ]);
  const categories=new Set([
    'religion','ideology','language','culture','national_identity',
    'civic','historical','regional'
  ]);
  const programTypes=new Set([
    'civic_dialogue','equal_access','language_access',
    'cultural_preservation','faith_charity','community_reconciliation'
  ]);
  const isText=(value,min=1,max=180)=>typeof value==='string' &&
    value.trim().length>=min && value.length<=max &&
    !/[<>\u0000-\u001f\u007f]/.test(value);
  const validDate=value=>{
    if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date=new Date(value+'T00:00:00Z');
    return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;
  };
  const bounded=value=>Number.isFinite(Number(value))&&Number(value)>=0&&Number(value)<=100;
  const round=value=>Math.round((Number(value)+Number.EPSILON)*100)/100;
  const reject=(code,error)=>({ok:false,code,error});
  const idFor=createId=>typeof createId==='function'?createId():
    'identity-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8);
  const territoriesFor=(game,stateId)=>game.territories.filter(item=>item.stateId===stateId);
  const provinceFor=(game,provinceId,stateId)=>(game.provinces||[]).find(item=>
    item.id===provinceId&&item.stateId===stateId);
  const officeIdsFor=(game,stateId,playerId)=>new Set(
    ((game.politicalSystems||[]).find(item=>item.stateId===stateId)?.offices||[])
      .filter(item=>item.holderPlayerId===playerId).map(item=>item.id)
  );

  function ensure(game) {
    if(!game||!Array.isArray(game.territories)) return game;
    for(const field of [...CONFIG_FIELDS,...DYNAMIC_FIELDS,...FUTURE_FIELDS])
      if(!Array.isArray(game[field])) game[field]=[];
    return game;
  }

  function lawIsActive(game,stateId,lawId,date=game?.worldDate) {
    const law=(game?.politicalSystems||[]).find(item=>item.stateId===stateId)
      ?.laws?.find(item=>item.id===lawId);
    if(!law||!['enacted','active'].includes(String(law.status||'').toLowerCase())||
       !validDate(law.effectiveFrom)||!validDate(date)||law.effectiveFrom>date)
      return false;
    if(law.repealedOn&&(!validDate(law.repealedOn)||law.repealedOn<=date)) return false;
    return true;
  }

  function validateConfiguration(game,configuration) {
    if(!game||!Array.isArray(game.territories)||!configuration||
       CONFIG_FIELDS.some(field=>!Array.isArray(configuration[field])))
      return {ok:false,error:'Identity configuration requires identityGroups, identityProfiles and identityOrganizations arrays.'};
    const states=new Set(game.territories.map(item=>item.stateId));
    const provinces=new Map();
    for(const province of game.provinces||[]) {
      if(!provinces.has(province.stateId)) provinces.set(province.stateId,new Set());
      provinces.get(province.stateId).add(province.id);
    }
    const ids=new Set();
    const addId=item=>{
      if(!isText(item?.id,1,120)||ids.has(item.id)) return false;
      ids.add(item.id);return true;
    };
    const groups=configuration.identityGroups;
    for(const group of groups) {
      if(!addId(group)||!states.has(group.stateId)||!categories.has(group.category)||
         !isText(group.name,2,120)||!isText(group.description||'',0,600)||
         typeof group.nonExclusive!=='boolean'||
         !['recognized','unrecognized','restricted','protected','unconfigured'].includes(group.legalStatus))
        return {ok:false,error:'Every identity group needs a unique ID, valid State, category, name, description, overlap rule and legal status.'};
    }
    const groupById=new Map(groups.map(item=>[item.id,item]));
    const profiles=configuration.identityProfiles;
    for(const profile of profiles) {
      const group=groupById.get(profile.groupId);
      if(!addId(profile)||!group||group.stateId!==profile.stateId||
         !provinceFor(game,profile.provinceId,profile.stateId))
        return {ok:false,error:'Every identity profile must reference a real group and province in the same State.'};
      const indicators=[
        'populationSharePercent','recognitionPercent','rightsProtectionPercent',
        'serviceAccessPercent','integrationPercent','grievancePercent',
        'institutionalTrustPercent','religiousFreedomPercent'
      ];
      if(indicators.some(key=>!bounded(profile[key]))||
         !validDate(profile.updatedOn))
        return {ok:false,error:'Identity profiles require bounded demographic, rights and social indicators from 0 to 100 and a valid update date.'};
    }
    const exclusiveTotals=new Map();
    for(const profile of profiles) {
      const group=groupById.get(profile.groupId);
      if(group.nonExclusive) continue;
      const key=[profile.stateId,profile.provinceId,group.category].join('|');
      exclusiveTotals.set(key,(exclusiveTotals.get(key)||0)+Number(profile.populationSharePercent));
    }
    if([...exclusiveTotals.values()].some(total=>total>100.000001))
      return {ok:false,error:'The combined population share of exclusive groups cannot exceed 100% in a province and identity category.'};

    const officesByState=new Map((game.politicalSystems||[]).map(system=>[
      system.stateId,new Set((system.offices||[]).map(office=>office.id))
    ]));
    for(const organization of configuration.identityOrganizations) {
      const group=groupById.get(organization.groupId);
      const profile=profiles.find(item=>item.id===organization.profileId);
      if(!addId(organization)||!states.has(organization.stateId)||
         !group||group.stateId!==organization.stateId||
         !profile||profile.stateId!==organization.stateId||
         profile.groupId!==organization.groupId||
         profile.provinceId!==organization.provinceId||
         !provinceFor(game,organization.provinceId,organization.stateId)||
         !isText(organization.name,2,120)||
         !isText(organization.type,2,60)||
         !['active','inactive','suspended'].includes(organization.status)||
         !Array.isArray(organization.programOfficeIds)||
         !Array.isArray(organization.authorizedPrograms)||
         organization.authorizedPrograms.some(item=>!programTypes.has(item))||
         !organization.authorizedPrograms.length||
         !organization.programOfficeIds.length||
         organization.programOfficeIds.some(id=>!officesByState.get(organization.stateId)?.has(id))||
         !isText(organization.mandateLawId,1,120)||
         !Number.isFinite(Number(organization.costPerStrength))||Number(organization.costPerStrength)<=0||
         !Number.isFinite(Number(organization.dailyStrengthCapacity))||Number(organization.dailyStrengthCapacity)<=0||
         !bounded(organization.effectivenessPercent)||!bounded(organization.transparencyPercent)||
         !lawIsActive(game,organization.stateId,organization.mandateLawId))
        return {ok:false,error:'Every organization needs a real group and province, an active legal mandate, valid offices, permitted programmes and bounded operating values.'};
    }
    return {ok:true};
  }

  function calculateCohesion(game,stateId) {
    if(!game||!stateId) return null;
    const groups=new Map((game.identityGroups||[]).filter(item=>item.stateId===stateId)
      .map(item=>[item.id,item]));
    const profiles=(game.identityProfiles||[]).filter(item=>
      item.stateId===stateId&&groups.has(item.groupId)&&
      bounded(item.populationSharePercent)&&Number(item.populationSharePercent)>0);
    if(!profiles.length) return null;
    const total=profiles.reduce((sum,item)=>sum+Number(item.populationSharePercent),0);
    if(total<=0) return null;
    const average=key=>round(profiles.reduce((sum,item)=>
      sum+Number(item[key])*Number(item.populationSharePercent),0)/total);
    const averageRightsProtectionPercent=average('rightsProtectionPercent');
    const averageServiceAccessPercent=average('serviceAccessPercent');
    const averageIntegrationPercent=average('integrationPercent');
    const averageGrievancePercent=average('grievancePercent');
    const averageInstitutionalTrustPercent=average('institutionalTrustPercent');
    const accessValues=profiles.map(item=>Number(item.serviceAccessPercent));
    const serviceInequalityPercent=round(Math.max(...accessValues)-Math.min(...accessValues));
    const coveredPopulationSharePercent=round(Math.min(100,total));
    const cohesionBase=(averageRightsProtectionPercent+averageServiceAccessPercent+
      averageIntegrationPercent+(100-averageGrievancePercent)+
      averageInstitutionalTrustPercent)/5;
    return {
      stateId,groupCount:profiles.length,coveredPopulationSharePercent,
      averageRightsProtectionPercent,averageServiceAccessPercent,
      averageIntegrationPercent,averageGrievancePercent,
      averageInstitutionalTrustPercent,serviceInequalityPercent,
      cohesionIndex:round(Math.max(0,Math.min(100,cohesionBase+serviceInequalityPercent*0.1))),
      polarizationIndex:round(Math.max(0,Math.min(100,
        averageGrievancePercent*0.65+serviceInequalityPercent*0.35)))
    };
  }

  function recordHistory(game,entry,createId) {
    const row={id:idFor(createId),gameId:game.id||null,...entry};
    game.identityHistory.push(row);
    if(game.identityHistory.length>3000)
      game.identityHistory.splice(0,game.identityHistory.length-3000);
    game.events ||= [];
    game.events.push({
      id:idFor(createId),gameId:game.id||null,orderId:entry.orderId||null,
      type:'identity.'+entry.type,resultCode:null,occurredAtUtc:new Date().toISOString(),
      stateId:entry.stateId||null,worldDate:entry.worldDate||game.worldDate,
      description:entry.description
    });
    if(game.events.length>1000) game.events.splice(0,game.events.length-1000);
    game.activity ||= [];
    game.activity.unshift(entry.description);
    game.activity=game.activity.slice(0,100);
    return row;
  }

  function programmeEffects(program,strength,effectiveness,transparency) {
    const factor=strength*effectiveness/100*transparency/100;
    const perStrength={
      civic_dialogue:{grievancePercent:-1.5,integrationPercent:1},
      equal_access:{rightsProtectionPercent:1,serviceAccessPercent:1},
      language_access:{recognitionPercent:1,serviceAccessPercent:1},
      cultural_preservation:{recognitionPercent:1,integrationPercent:0.5},
      faith_charity:{serviceAccessPercent:1,institutionalTrustPercent:0.5},
      community_reconciliation:{grievancePercent:-1,institutionalTrustPercent:1}
    }[program]||{};
    return Object.fromEntries(Object.entries(perStrength).map(([key,value])=>[key,round(value*factor)]));
  }

  function applyOrder(game,player,membership,order,createId) {
    if(!String(order?.type||'').startsWith('identity.')) return null;
    ensure(game);
    if(order.type!=='identity.fundCommunityProgram')
      return reject('IDENTITY_ORDER_UNKNOWN','This identity order is not implemented.');
    const stateId=membership?.stateId;
    const territory=territoriesFor(game,stateId)[0];
    if(!membership||membership.status!=='active'||!territory||
       !player||!player.id)
      return reject('IDENTITY_PROGRAM_TARGET_INVALID','The selected State or active government membership is unavailable.');
    const organization=game.identityOrganizations.find(item=>
      item.id===order.organizationId&&item.stateId===stateId&&item.status==='active');
    const profile=game.identityProfiles.find(item=>
      item.id===order.profileId&&item.stateId===stateId);
    const group=profile&&game.identityGroups.find(item=>
      item.id===profile.groupId&&item.stateId===stateId);
    if(!organization||!profile||!group||
       organization.profileId!==profile.id||organization.groupId!==group.id||
       organization.provinceId!==profile.provinceId||
       !provinceFor(game,profile.provinceId,stateId))
      return reject('IDENTITY_PROGRAM_TARGET_INVALID','The community organization or provincial group profile is not available.');
    const held=officeIdsFor(game,stateId,player.id);
    if(!organization.programOfficeIds.some(id=>held.has(id)))
      return reject('IDENTITY_PROGRAM_AUTHORITY_REQUIRED','Your political office is not authorized to fund this community programme.');
    if(!lawIsActive(game,stateId,organization.mandateLawId))
      return reject('IDENTITY_PROGRAM_LEGAL_BASIS_INVALID','The community programme mandate is no longer in force.');
    const strength=Number(order.strength);
    if(!programTypes.has(order.program)||!organization.authorizedPrograms.includes(order.program)||
       !Number.isInteger(strength)||strength<1||strength>5)
      return reject('IDENTITY_PROGRAM_INVALID','Choose a programme permitted by the organization and a strength from 1 to 5.');
    const used=game.communityPrograms.filter(item=>
      item.organizationId===organization.id&&item.worldDate===game.worldDate)
      .reduce((sum,item)=>sum+Number(item.strength||0),0);
    if(used+strength>Number(organization.dailyStrengthCapacity))
      return reject('IDENTITY_PROGRAM_DAILY_CAPACITY','The organization has reached its daily programme capacity.');
    const cost=round(Number(organization.costPerStrength)*strength);
    const treasury=Number(territory.treasury);
    if(!Number.isFinite(treasury)||treasury<cost)
      return reject('IDENTITY_PROGRAM_BUDGET_INSUFFICIENT','The State treasury cannot fund the full community programme.');
    const changes=programmeEffects(order.program,strength,
      Number(organization.effectivenessPercent),Number(organization.transparencyPercent));
    const updated={...profile};
    for(const [key,delta] of Object.entries(changes))
      updated[key]=round(Math.max(0,Math.min(100,Number(updated[key])+delta)));
    const before=territory.treasury;
    territory.treasury=round(before-cost);
    Object.assign(profile,updated);
    const program={
      id:idFor(createId),stateId,organizationId:organization.id,
      groupId:group.id,profileId:profile.id,provinceId:profile.provinceId,
      program:order.program,strength,cost,worldDate:game.worldDate,
      fundedByPlayerId:player.id,mandateLawId:organization.mandateLawId,
      changes,treasuryBefore:before,treasuryAfter:territory.treasury,
      orderId:order.orderId||null
    };
    game.communityPrograms.push(program);
    if(game.communityPrograms.length>1000)
      game.communityPrograms.splice(0,game.communityPrograms.length-1000);
    game.financialTransactions ||= [];
    game.financialTransactions.push({
      id:idFor(createId),stateId,currencyId:territory.currencyId||null,
      type:'community_program',amount:-cost,balanceBefore:before,
      balanceAfter:territory.treasury,
      description:'Funded '+order.program.replaceAll('_',' ')+' for '+group.name+'.',
      worldDate:game.worldDate,recordedAtUtc:new Date().toISOString(),
      orderId:order.orderId||null
    });
    recordHistory(game,{
      stateId,type:'community_program_funded',
      description:'A legally authorized '+order.program.replaceAll('_',' ')+
        ' programme was funded for '+group.name+'.',
      worldDate:game.worldDate,orderId:order.orderId||null,
      programId:program.id,profileId:profile.id,organizationId:organization.id,
      changes,cost
    },createId);
    return {ok:true,programId:program.id,cost,changes};
  }

  function advanceDay(game,createId) {
    ensure(game);
    const created=[];
    const stateIds=[...new Set(game.territories.map(item=>item.stateId))];
    for(const stateId of stateIds) {
      const cohesion=calculateCohesion(game,stateId);
      if(!cohesion) continue;
      const exists=game.socialCohesionHistory.some(item=>
        item.stateId===stateId&&item.worldDate===game.worldDate);
      if(exists) continue;
      const snapshot={
        id:idFor(createId),stateId,worldDate:game.worldDate,
        ...cohesion
      };
      game.socialCohesionHistory.push(snapshot);
      created.push(snapshot);
    }
    if(game.socialCohesionHistory.length>3000)
      game.socialCohesionHistory.splice(0,game.socialCohesionHistory.length-3000);
    return {ok:true,snapshotsCreated:created.length};
  }

  const api=Object.freeze({
    ensure,validateConfiguration,applyOrder,advanceDay,lawIsActive,calculateCohesion,
    configurationFields:CONFIG_FIELDS,dynamicFields:DYNAMIC_FIELDS,
    categories:Object.freeze([...categories]),programTypes:Object.freeze([...programTypes])
  });
  globalThis.NewWorldIdentity=api;
  if(typeof window!=='undefined') window.NewWorldIdentity=api;
  if(typeof module!=='undefined'&&module.exports) module.exports=api;
})();
