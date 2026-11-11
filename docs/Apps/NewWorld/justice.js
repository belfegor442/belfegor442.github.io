(() => {
  'use strict';

  const evidenceTypes=Object.freeze([
    'documentary','physical','testimony','digital','expert','other'
  ]);
  const clone=value=>structuredClone(value);
  const isText=(value,min=1,max=280)=>
    typeof value==='string' && value.trim().length>=min && value.length<=max &&
    !/[<>\u0000-\u001f\u007f]/.test(value);
  const validDate=value=>{
    if(typeof value!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date=new Date(value+'T00:00:00Z');
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10)===value;
  };
  const idFor=createId=>typeof createId==='function'?createId():
    'justice-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8);
  const reject=(code,error)=>({ok:false,code,error});
  const systemFor=(game,stateId)=>(game.justiceSystems || []).find(item=>item.stateId===stateId);
  const officeIdsFor=(game,stateId,playerId)=>new Set(
    ((game.politicalSystems || []).find(item=>item.stateId===stateId)?.offices || [])
      .filter(office=>office.holderPlayerId===playerId).map(office=>office.id)
  );
  const hasOffice=(held,allowed)=>Array.isArray(allowed) && allowed.some(id=>held.has(id));
  const provinceFor=(game,provinceId,stateId)=>(game.provinces || []).find(item=>
    item.id===provinceId && item.stateId===stateId);

  function ensure(game) {
    if(!game || !Array.isArray(game.territories)) return game;
    if(!Array.isArray(game.justiceSystems)) game.justiceSystems=[];
    const known=new Set(game.justiceSystems.map(item=>item?.stateId));
    for(const territory of game.territories) {
      if(known.has(territory.stateId)) continue;
      game.justiceSystems.push({
        stateId:territory.stateId,configurationVersion:1,configurationPending:true,
        crimeTypes:[],courts:[],policeAgencies:[],prisons:[],
        prosecutorOfficeIds:[],judicialOfficeIds:[],sentenceOfficeIds:[],appealOfficeIds:[]
      });
    }
    game.justiceSystems=game.justiceSystems.filter(item=>
      game.territories.some(territory=>territory.stateId===item?.stateId));
    for(const system of game.justiceSystems) {
      for(const key of ['crimeTypes','courts','policeAgencies','prisons',
        'prosecutorOfficeIds','judicialOfficeIds','sentenceOfficeIds','appealOfficeIds'])
        if(!Array.isArray(system[key])) system[key]=[];
      system.configurationVersion ||= 1;
      system.configurationPending=!(system.crimeTypes.length &&
        system.courts.length && system.policeAgencies.length && system.prisons.length);
    }
    if(!Array.isArray(game.justiceReports)) game.justiceReports=[];
    if(!Array.isArray(game.justiceCases)) game.justiceCases=[];
    if(!Array.isArray(game.justiceHistory)) game.justiceHistory=[];
    return game;
  }

  function lawIsActive(game,stateId,lawId,date=game?.worldDate) {
    const law=(game?.politicalSystems || []).find(item=>item.stateId===stateId)
      ?.laws?.find(item=>item.id===lawId);
    if(!law || !['enacted','active'].includes(String(law.status||'').toLowerCase()) ||
       !validDate(law.effectiveFrom) || !validDate(date) || law.effectiveFrom>date)
      return false;
    if(law.repealedOn && (!validDate(law.repealedOn) || law.repealedOn<=date)) return false;
    return true;
  }

  function validateConfiguration(game,configuration) {
    const systems=configuration?.justiceSystems;
    if(!Array.isArray(systems))
      return {ok:false,error:'Justice configuration requires a justiceSystems array.'};
    const states=new Set((game?.territories || []).map(item=>item.stateId));
    const stateIds=systems.map(item=>item?.stateId);
    if(stateIds.length!==states.size || stateIds.some(id=>!states.has(id)) ||
       new Set(stateIds).size!==stateIds.length)
      return {ok:false,error:'Provide exactly one justice system for every existing State.'};
    const provinceMap=new Map();
    for(const province of game?.provinces || []) {
      if(!provinceMap.has(province.stateId)) provinceMap.set(province.stateId,new Set());
      provinceMap.get(province.stateId).add(province.id);
    }
    const officesByState=new Map((game?.politicalSystems || []).map(item=>[
      item.stateId,new Set((item.offices || []).map(office=>office.id))
    ]));
    for(const system of systems) {
      const arrays=['crimeTypes','courts','policeAgencies','prisons'];
      if(arrays.some(key=>!Array.isArray(system[key])))
        return {ok:false,error:'Every State requires crimeTypes, courts, policeAgencies and prisons arrays.'};
      const configuredArrays=arrays.filter(key=>system[key].length>0);
      if(configuredArrays.length===0) continue;
      if(configuredArrays.length!==arrays.length)
        return {ok:false,error:'A configured justice system requires offences, courts, police agencies and prisons together; partially configured institutions cannot be activated.'};
      const crimeIds=system.crimeTypes.map(item=>item?.id);
      const courtIds=system.courts.map(item=>item?.id);
      const agencyIds=system.policeAgencies.map(item=>item?.id);
      const prisonIds=system.prisons.map(item=>item?.id);
      for(const [label,ids] of [['offence',crimeIds],['court',courtIds],['agency',agencyIds],['prison',prisonIds]]) {
        if(ids.some(id=>typeof id!=='string' || !id.trim()) || new Set(ids).size!==ids.length)
          return {ok:false,error:'Justice '+label+' identifiers must be unique non-empty strings.'};
      }
      const enactedOrProposed=new Set(((game.politicalSystems || [])
        .find(item=>item.stateId===system.stateId)?.laws || []).map(item=>item.id));
      for(const crime of system.crimeTypes) {
        if(!isText(crime.name,2,80) || !enactedOrProposed.has(crime.lawId))
          return {ok:false,error:'Every offence category must link to an existing State law.'};
        if(crime.minimumEvidenceCount!==undefined &&
           (!Number.isSafeInteger(crime.minimumEvidenceCount) || crime.minimumEvidenceCount<1 || crime.minimumEvidenceCount>100))
          return {ok:false,error:'An offence minimumEvidenceCount must be a whole number from 1 to 100.'};
        if(crime.evidenceTypes!==undefined &&
           (!Array.isArray(crime.evidenceTypes) || crime.evidenceTypes.some(type=>!evidenceTypes.includes(type))))
          return {ok:false,error:'An offence contains an unsupported evidence type.'};
        if(crime.penalties!==undefined && !Array.isArray(crime.penalties))
          return {ok:false,error:'Offence penalties must be an array.'};
        for(const penalty of crime.penalties || []) {
          if(!penalty || typeof penalty.id!=='string' ||
             !['fine','reparation','imprisonment','disqualification'].includes(penalty.type))
            return {ok:false,error:'Every configured penalty requires an identifier and supported type.'};
          if(['fine','reparation'].includes(penalty.type) &&
             (!Number.isSafeInteger(penalty.minAmount) || !Number.isSafeInteger(penalty.maxAmount) ||
              penalty.minAmount<0 || penalty.maxAmount<penalty.minAmount))
            return {ok:false,error:'Fine and reparation ranges must have valid non-negative bounds.'};
          if(penalty.type==='imprisonment' &&
             (!Number.isSafeInteger(penalty.minDays) || !Number.isSafeInteger(penalty.maxDays) ||
              penalty.minDays<1 || penalty.maxDays<penalty.minDays || !prisonIds.includes(penalty.prisonId)))
            return {ok:false,error:'Imprisonment penalties must reference a prison and valid duration limits.'};
        }
      }
      const validProvinces=provinceMap.get(system.stateId) || new Set();
      const validOffices=officesByState.get(system.stateId) || new Set();
      const validateJurisdiction=(item,key)=>
        Array.isArray(item[key]) && item[key].length>0 &&
        item[key].every(id=>validProvinces.has(id));
      for(const agency of system.policeAgencies) {
        if(!isText(agency.name,2,80) || !validateJurisdiction(agency,'jurisdictionProvinceIds') ||
           !Array.isArray(agency.crimeTypeIds) || !agency.crimeTypeIds.length ||
           agency.crimeTypeIds.some(id=>!crimeIds.includes(id)) ||
           !Array.isArray(agency.authorizedOfficeIds) || !agency.authorizedOfficeIds.length ||
           agency.authorizedOfficeIds.some(id=>!validOffices.has(id)) ||
           !Number.isSafeInteger(agency.staff) || agency.staff<1)
          return {ok:false,error:'A police agency has invalid jurisdiction, offence scope, office authority or staff.'};
      }
      for(const court of system.courts) {
        if(!isText(court.name,2,80) || !validateJurisdiction(court,'jurisdictionProvinceIds') ||
           !Array.isArray(court.crimeTypeIds) || !court.crimeTypeIds.length ||
           court.crimeTypeIds.some(id=>!crimeIds.includes(id)) ||
           !Number.isSafeInteger(court.capacity) || court.capacity<1 ||
           !Number.isSafeInteger(court.staff) || court.staff<1)
          return {ok:false,error:'A court has invalid jurisdiction, offence scope, capacity or staff.'};
        if(court.authorizedOfficeIds!==undefined &&
           (!Array.isArray(court.authorizedOfficeIds) || court.authorizedOfficeIds.some(id=>!validOffices.has(id))))
          return {ok:false,error:'A court references an unknown judicial office.'};
        if(court.independencePercent!==undefined &&
           (!Number.isSafeInteger(court.independencePercent) || court.independencePercent<0 || court.independencePercent>100))
          return {ok:false,error:'Court independence must be a whole percentage from 0 to 100.'};
      }
      for(const prison of system.prisons) {
        if(!isText(prison.name,2,80) || !Number.isSafeInteger(prison.capacity) ||
           prison.capacity<0)
          return {ok:false,error:'A prison requires a name and non-negative whole-number capacity.'};
      }
      for(const key of ['prosecutorOfficeIds','judicialOfficeIds','sentenceOfficeIds']) {
        if(system[key]!==undefined &&
           (!Array.isArray(system[key]) || system[key].some(id=>!validOffices.has(id))))
          return {ok:false,error:'Justice procedure references an unknown office in '+key+'.'};
      }
      if(system.appealWindowDays!==undefined &&
         (!Number.isSafeInteger(system.appealWindowDays) || system.appealWindowDays<0 || system.appealWindowDays>3650))
        return {ok:false,error:'Appeal window must be a whole number of days from 0 to 3650.'};
    }
    return {ok:true,error:null};
  }

  function appendHistory(game,stateId,type,description,caseId=null,playerId=null) {
    game.justiceHistory.push({
      id:idFor(),stateId,caseId,type,description,playerId,worldDate:game.worldDate
    });
    if(game.justiceHistory.length>5000)
      game.justiceHistory.splice(0,game.justiceHistory.length-5000);
    game.events ||= [];
    game.eventSequence=(Number(game.eventSequence)||0)+1;
    game.events.push({
      id:'justice-event-'+game.eventSequence,gameId:game.id,orderId:null,
      actorPlayerId:playerId,stateId,type:'justice.'+type,resultCode:null,
      occurredAtUtc:new Date().toISOString(),worldDate:game.worldDate,
      worldVersion:Number(game.worldVersion||0)+1,description,sequence:game.eventSequence
    });
    if(game.events.length>1000) game.events.splice(0,game.events.length-1000);
    game.activity ||= [];
    game.activity.unshift(description);
    game.activity=game.activity.slice(0,100);
  }

  function applyOrder(game,player,membership,order,createId) {
    ensure(game);
    const stateId=membership.stateId;
    const justice=systemFor(game,stateId);
    const id=()=>idFor(createId);
    const held=officeIdsFor(game,stateId,player.id);
    if(!justice) return reject('JUSTICE_NOT_CONFIGURED','Justice is not configured for this State.');

    if(order.type==='justice.reportIncident') {
      const province=provinceFor(game,order.provinceId,stateId);
      const description=String(order.description||'').trim();
      const incidentDate=order.incidentDate===undefined?game.worldDate:String(order.incidentDate);
      if(!province || !isText(description,8,280) ||
         !validDate(incidentDate) || incidentDate>game.worldDate)
        return reject('JUSTICE_REPORT_INVALID','Choose a province, describe the incident (8–280 characters) and provide a valid incident date that is not in the future.');
      const report={
        id:id(),stateId,provinceId:province.id,description,incidentDate,
        reportedByPlayerId:player.id,reportedOn:game.worldDate,
        status:'unclassified',caseId:null
      };
      game.justiceReports.push(report);
      appendHistory(game,stateId,'report_received',
        'An unclassified incident report was received for '+province.name+'.',null,player.id);
      return {ok:true,reportId:report.id};
    }

    if(order.type==='justice.openInvestigation') {
      const report=(game.justiceReports || []).find(item=>
        item.id===order.reportId && item.stateId===stateId);
      const crime=(justice.crimeTypes || []).find(item=>item.id===order.crimeTypeId);
      const agency=(justice.policeAgencies || []).find(item=>
        item.id===order.agencyId && item.crimeTypeIds?.includes(crime?.id) &&
        item.jurisdictionProvinceIds?.includes(report?.provinceId) &&
        Number(item.staff)>0 && hasOffice(held,item.authorizedOfficeIds));
      const court=(justice.courts || []).find(item=>
        item.id===order.courtId && item.crimeTypeIds?.includes(crime?.id) &&
        item.jurisdictionProvinceIds?.includes(report?.provinceId));
      if(!report || report.status!=='unclassified' || !crime ||
         !lawIsActive(game,stateId,crime.lawId,report.incidentDate) || !agency || !court)
        return reject('JUSTICE_INVESTIGATION_UNAUTHORISED','A report can only become an investigation under an active enacted law, a competent court and a police agency whose authorized office the player holds.');
      const workload=(game.justiceCases || []).filter(item=>
        item.courtId===court.id && ['investigating','charged','trial','appeal'].includes(item.status)).length;
      if(workload>=court.capacity)
        return reject('JUSTICE_COURT_AT_CAPACITY','The selected court has reached its configured case capacity.');
      const caseRecord={
        id:id(),stateId,provinceId:report.provinceId,reportId:report.id,
        incidentDate:report.incidentDate,
        crimeTypeId:crime.id,legalBasisId:crime.lawId,
        openedOn:game.worldDate,status:'investigating',
        policeAgencyId:agency.id,courtId:court.id,
        reporterPlayerId:report.reportedByPlayerId,
        investigatorPlayerId:player.id,evidence:[],prosecutorPlayerId:null,
        verdict:null,sentence:null
      };
      game.justiceCases.push(caseRecord);
      report.status='investigating';
      report.caseId=caseRecord.id;
      appendHistory(game,stateId,'investigation_opened',
        'An investigation was opened under legal basis '+crime.lawId+'.',caseRecord.id,player.id);
      return {ok:true,caseId:caseRecord.id};
    }

    const item=(game.justiceCases || []).find(entry=>
      entry.id===order.caseId && entry.stateId===stateId);
    if(!item) return reject('JUSTICE_CASE_NOT_FOUND','The investigation does not exist in this State.');
    const crime=(justice.crimeTypes || []).find(entry=>entry.id===item.crimeTypeId);
    if(!crime || !lawIsActive(game,stateId,item.legalBasisId,item.incidentDate || item.openedOn))
      return reject('JUSTICE_LAW_NOT_ACTIVE','The legal basis was not in force on the reported incident date.');

    if(order.type==='justice.addEvidence') {
      const agency=(justice.policeAgencies || []).find(entry=>entry.id===item.policeAgencyId);
      if(item.status!=='investigating' || item.investigatorPlayerId!==player.id ||
         !agency || !hasOffice(held,agency.authorizedOfficeIds) ||
         !agency.jurisdictionProvinceIds?.includes(item.provinceId))
        return reject('JUSTICE_EVIDENCE_UNAUTHORISED','Only the assigned investigator acting under the authorized police office may register evidence.');
      const type=String(order.evidenceType||'');
      const description=String(order.description||'').trim();
      const permitted=Array.isArray(crime.evidenceTypes) && crime.evidenceTypes.length
        ? crime.evidenceTypes : evidenceTypes;
      if(!permitted.includes(type) || !isText(description,8,280))
        return reject('JUSTICE_EVIDENCE_INVALID','Choose an allowed evidence type and enter a description of 8–280 characters.');
      item.evidence ||= [];
      item.evidence.push({
        id:id(),type,description,recordedByPlayerId:player.id,
        recordedOn:game.worldDate,verified:false
      });
      appendHistory(game,stateId,'evidence_registered',
        'Unverified '+type+' evidence was registered in case '+item.id+'.',item.id,player.id);
      return {ok:true};
    }

    if(order.type==='justice.fileCharges') {
      const prosecutor=hasOffice(held,justice.prosecutorOfficeIds);
      const minimum=Number(crime.minimumEvidenceCount);
      if(item.status!=='investigating' || !Number.isSafeInteger(minimum) ||
         minimum<1 || item.evidence.length<minimum || !prosecutor ||
         item.investigatorPlayerId===player.id)
        return reject('JUSTICE_CHARGES_NOT_AUTHORISED','Charges require the configured minimum evidence count, a separate prosecutor and an authorized prosecution office.');
      item.status='charged';
      item.prosecutorPlayerId=player.id;
      item.chargedOn=game.worldDate;
      appendHistory(game,stateId,'charges_filed',
        'Prosecution formally filed charges in case '+item.id+'.',item.id,player.id);
      return {ok:true};
    }

    if(order.type==='justice.decideCase') {
      const court=(justice.courts || []).find(entry=>entry.id===item.courtId);
      const authorisedJudge=hasOffice(held,court?.authorizedOfficeIds) ||
        hasOffice(held,justice.judicialOfficeIds);
      const minimum=Number(court?.minimumEvidenceCountForConviction);
      if(item.status!=='charged' || !court || !authorisedJudge ||
         [item.reporterPlayerId,item.investigatorPlayerId,item.prosecutorPlayerId].includes(player.id) ||
         !['guilty','acquitted'].includes(order.verdict))
        return reject('JUSTICE_TRIAL_UNAUTHORISED','Only an authorized, non-conflicted judicial office may decide a charged case.');
      if(order.verdict==='guilty' &&
         (!Number.isSafeInteger(minimum) || minimum<1 || item.evidence.length<minimum))
        return reject('JUSTICE_VERDICT_EVIDENCE_INSUFFICIENT','A guilty verdict requires a configured evidence-count standard that the case meets.');
      item.status=order.verdict==='guilty'?'convicted':'acquitted';
      item.verdict={outcome:order.verdict,judgePlayerId:player.id,decidedOn:game.worldDate,
        evidenceCount:item.evidence.length,requiredEvidenceCount:order.verdict==='guilty'?minimum:null,
        courtIndependencePercent:Number.isSafeInteger(court.independencePercent)?court.independencePercent:null};
      appendHistory(game,stateId,'verdict_recorded',
        'A court recorded a '+order.verdict+' verdict for case '+item.id+'.',item.id,player.id);
      return {ok:true};
    }

    if(order.type==='justice.imposeSentence') {
      if(item.status!=='convicted' || item.verdict?.outcome!=='guilty' ||
         !hasOffice(held,justice.sentenceOfficeIds))
        return reject('JUSTICE_SENTENCE_UNAUTHORISED','A sentence requires a conviction and an explicitly authorized sentencing office.');
      const penalty=(crime.penalties || []).find(entry=>entry.id===order.penaltyId);
      if(!penalty) return reject('JUSTICE_PENALTY_NOT_LAWFUL','The requested penalty is not defined by the applicable offence.');
      const sentence={penaltyId:penalty.id,type:penalty.type,imposedOn:game.worldDate,imposedByPlayerId:player.id};
      if(['fine','reparation'].includes(penalty.type)) {
        const amount=Number(order.amount);
        if(!Number.isSafeInteger(amount) || amount<penalty.minAmount || amount>penalty.maxAmount)
          return reject('JUSTICE_SENTENCE_AMOUNT_INVALID','The sentence amount is outside the range enacted for this offence.');
        sentence.amount=amount;
      } else if(penalty.type==='imprisonment') {
        const prison=(justice.prisons || []).find(entry=>entry.id===penalty.prisonId);
        const days=Number(order.days);
        if(!prison || !Number.isSafeInteger(days) || days<penalty.minDays ||
           days>penalty.maxDays)
          return reject('JUSTICE_PRISON_UNAVAILABLE','The selected prison or sentence duration is not available under the configured law.');
        prison.inmates ||= [];
        if(prison.inmates.length>=prison.capacity)
          return reject('JUSTICE_PRISON_AT_CAPACITY','The configured prison has no available capacity.');
        prison.inmates.push({caseId:item.id,prisonerNpcId:item.prisonerNpcId || null,
          admittedOn:game.worldDate,sentenceDays:days,detentionType:'sentenced'});
        sentence.days=days;
        sentence.prisonId=prison.id;
      }
      item.sentence=sentence;
      item.status='sentenced';
      appendHistory(game,stateId,'sentence_imposed',
        'A penalty defined by the applicable law was imposed in case '+item.id+'.',item.id,player.id);
      return {ok:true};
    }

    if(order.type==='justice.fileAppeal') {
      const windowDays=Number(justice.appealWindowDays);
      if(!['convicted','acquitted','sentenced'].includes(item.status) ||
         !Number.isSafeInteger(windowDays) || windowDays<1 ||
         !hasOffice(held,justice.appealOfficeIds))
        return reject('JUSTICE_APPEAL_UNAVAILABLE','Appeals require an explicit appeal window and an authorized appeal office.');
      const elapsed=(Date.parse(game.worldDate+'T00:00:00Z')-
        Date.parse((item.verdict?.decidedOn || item.sentence?.imposedOn || game.worldDate)+'T00:00:00Z'))/86400000;
      if(!Number.isFinite(elapsed) || elapsed<0 || elapsed>windowDays)
        return reject('JUSTICE_APPEAL_EXPIRED','The configured appeal deadline has passed.');
      item.status='appealed';
      item.appealedOn=game.worldDate;
      appendHistory(game,stateId,'appeal_filed','An appeal was filed in case '+item.id+'.',item.id,player.id);
      return {ok:true};
    }
    return reject('JUSTICE_ORDER_UNSUPPORTED','This justice operation is not part of the configured procedure.');
  }

  const api=Object.freeze({ensure,evidenceTypes,lawIsActive,validateConfiguration,applyOrder});
  globalThis.NewWorldJustice=api;
  if(typeof module!=='undefined' && module.exports) module.exports=api;
})();