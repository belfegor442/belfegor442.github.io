(() => {
  'use strict';

  const CONFIG_FIELDS=Object.freeze(['securityAgencies','securityAuthorizations']);
  const DYNAMIC_FIELDS=Object.freeze([
    'securityIncidents','securityCases','securityReports','securityAlerts','securityHistory',
    'securityWarrantRequests','securityWarrants'
  ]);
  const scopes=new Set(['domestic','foreign','counterintelligence','cybersecurity','critical_infrastructure','disaster_response']);
  const classifications=new Set(['public','restricted','confidential','secret']);
  const incidentTypes=new Set(['public_order','sabotage','espionage','foreign_interference','cyber_incident','infrastructure_threat','terrorism_threat','disinformation','disaster_risk','other']);
  const outcomes=new Set(['unsubstantiated','no_action','referred_to_justice','disrupted','resolved']);
  const cleanText=(value,min=2,max=280)=>typeof value==='string' &&
    value.trim().length>=min && value.length<=max &&
    !/[<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
  const num=(value,min,max)=>Number.isFinite(value)&&value>=min&&value<=max;
  const int=(value,min,max)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
  const id=value=>typeof value==='string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{1,99}$/.test(value);
  const unique=items=>Array.isArray(items)&&items.every(item=>id(item?.id))&&
    new Set(items.map(item=>item.id)).size===items.length;

  function ensure(game) {
    if(!game || !Array.isArray(game.territories)) return game;
    for(const field of [...CONFIG_FIELDS,...DYNAMIC_FIELDS])
      if(!Array.isArray(game[field])) game[field]=[];
    return game;
  }

  function lawIsActive(game,stateId,lawId) {
    const law=game.politicalSystems?.find(item=>item.stateId===stateId)
      ?.laws?.find(item=>item.id===lawId);
    if(!law || !['enacted','active'].includes(String(law.status||'').toLowerCase()) ||
       typeof law.effectiveFrom!=='string' || law.effectiveFrom>game.worldDate) return false;
    return !law.repealedOn || law.repealedOn>game.worldDate;
  }

  function validateConfiguration(game,c) {
    if(!c || CONFIG_FIELDS.some(field=>!Array.isArray(c[field])))
      return {ok:false,error:'Security setup requires agency and legal authorization arrays.'};
    for(const field of CONFIG_FIELDS)
      if(!unique(c[field])) return {ok:false,error:'IDs in '+field+' must be unique and stable.'};
    const states=new Set((game.territories||[]).map(item=>item.stateId));
    const provinces=new Map((game.provinces||[]).map(item=>[item.id,item.stateId]));
    const political=new Map((game.politicalSystems||[]).map(item=>[item.stateId,item]));
    const agencies=new Map(c.securityAgencies.map(item=>[item.id,item]));
    const authByAgency=new Map();
    for(const agency of c.securityAgencies) {
      const offices=new Set((political.get(agency.stateId)?.offices||[]).map(item=>item.id));
      if(!states.has(agency.stateId) || !cleanText(agency.name,2,120) ||
         !scopes.has(agency.scope) ||
         !Array.isArray(agency.competenceIds) || !agency.competenceIds.length ||
         agency.competenceIds.some(item=>!id(item)) ||
         !Array.isArray(agency.investigationOfficeIds) || !agency.investigationOfficeIds.length ||
         agency.investigationOfficeIds.some(item=>!offices.has(item)) ||
         !Array.isArray(agency.oversightOfficeIds) || !agency.oversightOfficeIds.length ||
         agency.oversightOfficeIds.some(item=>!offices.has(item)) ||
         agency.investigationOfficeIds.some(item=>agency.oversightOfficeIds.includes(item)) ||
         !Array.isArray(agency.provinceIds) || !agency.provinceIds.length ||
         agency.provinceIds.some(item=>provinces.get(item)!==agency.stateId) ||
         !int(agency.personnel,1,1000000) ||
         !num(agency.capacityPercent,0,200) ||
         !num(agency.reliabilityPercent,0,100) ||
         !num(agency.corruptionRiskPercent,0,100) ||
         !int(agency.dailyCaseCapacity,1,10000))
        return {ok:false,error:'An agency needs a real State, scope, competencies, separate investigation and oversight offices, provincial jurisdiction, personnel and capacity indicators.'};
    }
    for(const authorization of c.securityAuthorizations) {
      const agency=agencies.get(authorization.agencyId);
      const law=political.get(authorization.stateId)?.laws?.find(item=>item.id===authorization.lawId);
      if(!agency || authorization.stateId!==agency.stateId ||
         !law || !lawIsActive(game,authorization.stateId,authorization.lawId) ||
         !Array.isArray(authorization.competenceIds) || !authorization.competenceIds.length ||
         authorization.competenceIds.some(item=>!agency.competenceIds.includes(item)) ||
         !Array.isArray(authorization.provinceIds) || !authorization.provinceIds.length ||
         authorization.provinceIds.some(item=>!agency.provinceIds.includes(item)) ||
         !Array.isArray(authorization.prohibitedActivities) ||
         !Array.isArray(authorization.warrantApprovalOfficeIds) ||
         authorization.warrantApprovalOfficeIds.some(id=>!new Set((political.get(agency.stateId)?.offices||[]).map(item=>item.id)).has(id)) ||
         (authorization.warrantRequired && (!authorization.warrantApprovalOfficeIds.length ||
           authorization.warrantApprovalOfficeIds.some(id=>agency.investigationOfficeIds.includes(id) || agency.oversightOfficeIds.includes(id)))) ||
         !int(authorization.validityDays,1,3650) ||
         !int(authorization.reviewIntervalDays,1,3650) ||
         typeof authorization.warrantRequired!=='boolean')
        return {ok:false,error:'A security authorization must link an active State law, agency competence, province, review interval, duration and explicit warrant rule.'};
      const list=authByAgency.get(agency.id)||[];
      list.push(authorization);
      authByAgency.set(agency.id,list);
    }
    for(const agency of c.securityAgencies)
      if(!(authByAgency.get(agency.id)||[]).length)
        return {ok:false,error:'Every security agency requires at least one current legal authorization.'};
    return {ok:true,error:null};
  }

  function record(game,type,stateId,description,details,createId) {
    const sequence=(Number(game.eventSequence)||0)+1;
    game.eventSequence=sequence;
    const entry={id:createId(),type,stateId,description,details:structuredClone(details||{}),
      worldDate:game.worldDate,worldVersion:(Number(game.worldVersion)||0)+1,sequence};
    game.securityHistory.push(entry);
    if(game.securityHistory.length>3000) game.securityHistory.splice(0,game.securityHistory.length-3000);
    game.events ||= [];
    game.events.push({...entry,id:createId(),gameId:game.id,orderId:null,
      type:'security.'+type,resultCode:null,occurredAtUtc:new Date().toISOString()});
    if(game.events.length>1000) game.events.splice(0,game.events.length-1000);
    game.activity ||= [];
    game.activity.unshift(description);
    game.activity=game.activity.slice(0,100);
    return entry;
  }

  function applyOrder(game,player,membership,order,createId) {
    if(!String(order?.type||'').startsWith('security.')) return null;
    ensure(game);
    const stateId=membership?.stateId;
    const playerOffices=new Set((game.politicalSystems?.find(item=>item.stateId===stateId)?.offices||[])
      .filter(item=>item.holderPlayerId===player.id).map(item=>item.id));

    if(order.type==='security.reportIncident') {
      const province=game.provinces?.find(item=>item.id===order.provinceId);
      if(!province || province.stateId!==stateId ||
         !incidentTypes.has(order.incidentType) ||
         !cleanText(order.description,20,500))
        return {ok:false,code:'SECURITY_INCIDENT_INVALID',error:'An incident needs a valid local province, category and factual description.'};
      const incident={
        id:createId(),stateId,provinceId:province.id,incidentType:order.incidentType,
        description:order.description.trim(),reportedByPlayerId:player.id,
        reportedOn:game.worldDate,status:'untriaged'
      };
      game.securityIncidents.push(incident);
      record(game,'incident_reported',stateId,
        'Security incident reported in '+province.name+'.',
        {incidentId:incident.id,provinceId:province.id,incidentType:incident.incidentType,
          reportedByPlayerId:player.id},createId);
      return {ok:true,incidentId:incident.id};
    }

    if(order.type==='security.requestWarrant') {
      const incident=game.securityIncidents.find(item=>item.id===order.incidentId && item.stateId===stateId);
      const agency=game.securityAgencies.find(item=>item.id===order.agencyId && item.stateId===stateId);
      const authorization=game.securityAuthorizations.find(item=>item.id===order.authorizationId && item.agencyId===agency?.id);
      if(!incident || !agency || !authorization || !authorization.warrantRequired)
        return {ok:false,code:'SECURITY_WARRANT_NOT_REQUIRED',error:'This incident does not have a configured warrant-required legal mandate.'};
      if(!agency.investigationOfficeIds.some(id=>playerOffices.has(id)))
        return {ok:false,code:'SECURITY_INVESTIGATION_AUTHORITY_REQUIRED',error:'Only the configured investigative office may request a warrant.'};
      if(!authorization.provinceIds.includes(incident.provinceId) ||
         !authorization.competenceIds.includes(incident.incidentType) ||
         !lawIsActive(game,stateId,authorization.lawId))
        return {ok:false,code:'SECURITY_LEGAL_BASIS_INVALID',error:'The warrant request is outside the current legal mandate.'};
      if(!cleanText(order.reason,20,500))
        return {ok:false,code:'SECURITY_WARRANT_REASON_REQUIRED',error:'A warrant request requires a 20–500 character necessity and proportionality statement.'};
      if(game.securityWarrantRequests.some(item=>item.incidentId===incident.id && item.status==='pending'))
        return {ok:false,code:'SECURITY_WARRANT_REQUEST_DUPLICATE',error:'A pending warrant request already exists for this incident.'};
      const request={id:createId(),stateId,incidentId:incident.id,agencyId:agency.id,
        authorizationId:authorization.id,lawId:authorization.lawId,
        requestedByPlayerId:player.id,requestedOn:game.worldDate,
        reason:order.reason.trim(),status:'pending',reviewedByPlayerId:null,
        reviewedOn:null,decisionReason:null,warrantId:null};
      game.securityWarrantRequests.push(request);
      record(game,'warrant_requested',stateId,'A judicial warrant was requested for a security investigation.',
        {requestId:request.id,incidentId:incident.id,agencyId:agency.id,lawId:authorization.lawId},createId);
      return {ok:true,requestId:request.id};
    }

    if(order.type==='security.approveWarrant') {
      const request=game.securityWarrantRequests.find(item=>item.id===order.requestId && item.stateId===stateId);
      const agency=request && game.securityAgencies.find(item=>item.id===request.agencyId);
      const authorization=request && game.securityAuthorizations.find(item=>item.id===request.authorizationId);
      if(!request || request.status!=='pending' || !agency || !authorization)
        return {ok:false,code:'SECURITY_WARRANT_REQUEST_UNAVAILABLE',error:'The warrant request is no longer pending.'};
      if(!lawIsActive(game,stateId,authorization.lawId))
        return {ok:false,code:'SECURITY_LEGAL_BASIS_INVALID',error:'The law authorizing this warrant request is no longer in force.'};
      if(!(authorization.warrantApprovalOfficeIds||[]).some(id=>playerOffices.has(id)))
        return {ok:false,code:'SECURITY_WARRANT_JUDICIAL_AUTHORITY_REQUIRED',error:'Only a configured judicial office may decide this warrant request.'};
      if(request.requestedByPlayerId===player.id)
        return {ok:false,code:'SECURITY_WARRANT_CONFLICT_OF_INTEREST',error:'The requesting investigator cannot approve their own warrant.'};
      if(!['approved','denied'].includes(order.decision) || !cleanText(order.reason,20,500))
        return {ok:false,code:'SECURITY_WARRANT_DECISION_INVALID',error:'The warrant decision requires approval or denial and written reasons.'};
      request.status=order.decision;request.reviewedByPlayerId=player.id;
      request.reviewedOn=game.worldDate;request.decisionReason=order.reason.trim();
      if(order.decision==='approved') {
        const warrant={id:createId(),stateId,requestId:request.id,incidentId:request.incidentId,
          agencyId:request.agencyId,authorizationId:request.authorizationId,lawId:request.lawId,
          issuedByPlayerId:player.id,issuedOn:game.worldDate,
          expiresOn:addDays(game.worldDate,authorization.validityDays),status:'approved',usedOn:null};
        game.securityWarrants.push(warrant);request.warrantId=warrant.id;
      }
      record(game,'warrant_decided',stateId,'A judicial warrant request was '+order.decision+'.',
        {requestId:request.id,decision:order.decision,reviewedByPlayerId:player.id,reason:request.decisionReason},createId);
      return {ok:true,warrantId:request.warrantId};
    }

    if(order.type==='security.openCase') {
      const incident=game.securityIncidents.find(item=>
        item.id===order.incidentId && item.stateId===stateId);
      const agency=game.securityAgencies.find(item=>
        item.id===order.agencyId && item.stateId===stateId);
      const authorization=game.securityAuthorizations.find(item=>
        item.id===order.authorizationId && item.agencyId===agency?.id);
      if(!incident || !agency || !authorization)
        return {ok:false,code:'SECURITY_CASE_SCOPE_INVALID',error:'The incident, agency or authorization is not valid in this State.'};
      if(!agency.investigationOfficeIds.some(id=>playerOffices.has(id)))
        return {ok:false,code:'SECURITY_INVESTIGATION_AUTHORITY_REQUIRED',error:'The player does not hold an office authorized to investigate security incidents.'};
      if(!authorization.competenceIds.includes(incident.incidentType) ||
         !authorization.competenceIds.some(id=>agency.competenceIds.includes(id)) ||
         !authorization.provinceIds.includes(incident.provinceId) ||
         !agency.provinceIds.includes(incident.provinceId) ||
         !lawIsActive(game,stateId,authorization.lawId))
        return {ok:false,code:'SECURITY_LEGAL_BASIS_INVALID',error:'The active legal mandate does not cover this incident, competence or province.'};
      const open=game.securityCases.filter(item=>
        item.agencyId===agency.id && !['closed','referred_to_justice'].includes(item.status));
      const daily=game.securityCases.filter(item=>
        item.agencyId===agency.id && item.openedOn===game.worldDate).length;
      if(daily>=agency.dailyCaseCapacity)
        return {ok:false,code:'SECURITY_DAILY_CAPACITY',error:'The agency has reached its configured daily case capacity.'};
      if(open.length>=agency.personnel*agency.capacityPercent/100)
        return {ok:false,code:'SECURITY_CASE_CAPACITY',error:'The agency has no available investigative capacity.'};
      if(game.securityCases.some(item=>item.incidentId===incident.id))
        return {ok:false,code:'SECURITY_DUPLICATE_CASE',error:'This incident already has a security case.'};
      let warrant=null;
      if(authorization.warrantRequired) {
        warrant=game.securityWarrants.find(item=>item.id===order.warrantId &&
          item.incidentId===incident.id && item.agencyId===agency.id &&
          item.authorizationId===authorization.id && item.status==='approved' &&
          item.expiresOn>game.worldDate);
        if(!warrant)
          return {ok:false,code:'SECURITY_WARRANT_REQUIRED',error:'An unexpired warrant approved by a separate judicial office is required.'};
      }
      const securityCase={
        id:createId(),stateId,incidentId:incident.id,agencyId:agency.id,
        authorizationId:authorization.id,lawId:authorization.lawId,
        provinceId:incident.provinceId,scope:agency.scope,
        openedByPlayerId:player.id,openedOn:game.worldDate,
        reviewDueOn:addDays(game.worldDate,authorization.reviewIntervalDays),
        status:'investigating',reports:[],confidencePercent:0,
        classification:'restricted',outcome:null,closedOn:null,warrantId:warrant?.id||null
      };
      if(warrant) {warrant.status='used';warrant.usedOn=game.worldDate;}
      game.securityCases.push(securityCase);
      incident.status='under_review';incident.caseId=securityCase.id;
      record(game,'case_opened',stateId,
        'Authorized security investigation opened under '+authorization.lawId+'.',
        {caseId:securityCase.id,incidentId:incident.id,agencyId:agency.id,
          authorizationId:authorization.id,lawId:authorization.lawId},createId);
      return {ok:true,caseId:securityCase.id};
    }

    if(order.type==='security.addReport') {
      const securityCase=game.securityCases.find(item=>
        item.id===order.caseId && item.stateId===stateId);
      const agency=securityCase && game.securityAgencies.find(item=>item.id===securityCase.agencyId);
      const authorization=securityCase && game.securityAuthorizations.find(item=>item.id===securityCase.authorizationId);
      if(!securityCase || securityCase.status!=='investigating' || !agency || !authorization)
        return {ok:false,code:'SECURITY_CASE_UNAVAILABLE',error:'The investigation is not available for new reports.'};
      if(!agency.investigationOfficeIds.some(id=>playerOffices.has(id)))
        return {ok:false,code:'SECURITY_INVESTIGATION_AUTHORITY_REQUIRED',error:'The player does not hold an authorized investigative office.'};
      if(!cleanText(order.summary,20,700) || !num(order.confidencePercent,0,100) ||
         !classifications.has(order.classification))
        return {ok:false,code:'SECURITY_REPORT_INVALID',error:'An intelligence assessment needs a clear summary, bounded confidence and a valid classification.'};
      const sources=Array.isArray(order.sourceEventIds)?[...new Set(order.sourceEventIds)]:[];
      if(sources.some(id=>!game.events.some(event=>event.id===id && event.stateId===stateId)))
        return {ok:false,code:'SECURITY_SOURCE_INVALID',error:'An intelligence report may only cite events in this State shared record.'};
      if(order.classification==='public' && sources.length===0)
        return {ok:false,code:'SECURITY_PUBLIC_SOURCE_REQUIRED',error:'Public security information must identify at least one verifiable shared source.'};
      const report={
        id:createId(),stateId,caseId:securityCase.id,agencyId:agency.id,
        summary:order.summary.trim(),confidencePercent:order.confidencePercent,
        classification:order.classification,sourceEventIds:sources,
        authoredByPlayerId:player.id,recordedOn:game.worldDate
      };
      game.securityReports.push(report);
      securityCase.reports.push(report.id);
      const weighted=securityCase.reports.map(id=>
        game.securityReports.find(item=>item.id===id)).filter(Boolean);
      securityCase.confidencePercent=weighted.length
        ? weighted.reduce((sum,item)=>sum+item.confidencePercent,0)/weighted.length : 0;
      const rank={public:0,restricted:1,confidential:2,secret:3};
      securityCase.classification=weighted.reduce((highest,item)=>
        rank[item.classification]>rank[highest]?item.classification:highest,'public');
      record(game,'intelligence_report_added',stateId,
        'An intelligence assessment was added to case '+securityCase.id+'.',
        {caseId:securityCase.id,reportId:report.id,confidencePercent:report.confidencePercent,
          classification:report.classification,sourceEventIds:sources},createId);
      return {ok:true,reportId:report.id};
    }

    if(order.type==='security.closeCase') {
      const securityCase=game.securityCases.find(item=>
        item.id===order.caseId && item.stateId===stateId);
      const agency=securityCase && game.securityAgencies.find(item=>item.id===securityCase.agencyId);
      if(!securityCase || !agency || securityCase.status!=='investigating')
        return {ok:false,code:'SECURITY_CASE_UNAVAILABLE',error:'The security case cannot be closed in its current status.'};
      if(!agency.oversightOfficeIds.some(id=>playerOffices.has(id)))
        return {ok:false,code:'SECURITY_OVERSIGHT_REQUIRED',error:'Case closure requires a separately authorized oversight office.'};
      if(securityCase.openedByPlayerId===player.id)
        return {ok:false,code:'SECURITY_CONFLICT_OF_INTEREST',error:'The investigator who opened the case cannot provide its independent oversight decision.'};
      if(!outcomes.has(order.outcome) || !cleanText(order.reason,20,500))
        return {ok:false,code:'SECURITY_CLOSURE_INVALID',error:'Choose a valid case outcome and provide written reasons.'};
      if(order.outcome==='referred_to_justice' &&
         !game.justiceCases.some(item=>item.id===order.justiceCaseId && item.stateId===stateId))
        return {ok:false,code:'SECURITY_JUSTICE_REFERENCE_REQUIRED',error:'A referral must reference an existing justice case in this State.'};
      securityCase.status=order.outcome==='referred_to_justice'?'referred_to_justice':'closed';
      securityCase.outcome=order.outcome;
      securityCase.closureReason=order.reason.trim();
      securityCase.closedOn=game.worldDate;
      securityCase.reviewedByPlayerId=player.id;
      if(order.outcome==='referred_to_justice')
        securityCase.justiceCaseId=order.justiceCaseId;
      const incident=game.securityIncidents.find(item=>item.id===securityCase.incidentId);
      if(incident) incident.status=securityCase.status;
      record(game,'case_closed',stateId,
        'Security case '+securityCase.id+' closed with outcome '+order.outcome+'.',
        {caseId:securityCase.id,outcome:order.outcome,justiceCaseId:securityCase.justiceCaseId||null},createId);
      return {ok:true};
    }

    if(order.type==='security.issueAlert') {
      const securityCase=game.securityCases.find(item=>
        item.id===order.caseId && item.stateId===stateId);
      const agency=securityCase && game.securityAgencies.find(item=>item.id===securityCase.agencyId);
      if(!securityCase || !agency || !(securityCase.status==='investigating' ||
         ['resolved','disrupted'].includes(securityCase.outcome)))
        return {ok:false,code:'SECURITY_CASE_UNAVAILABLE',error:'A public alert requires an active investigation or a verified resolved/disrupted threat.'};
      if(!agency.oversightOfficeIds.some(id=>playerOffices.has(id)))
        return {ok:false,code:'SECURITY_OVERSIGHT_REQUIRED',error:'Only the configured oversight office may issue a public security alert.'};
      if(!int(order.severity,1,5) || !cleanText(order.message,20,240) ||
         !int(order.durationDays,1,30))
        return {ok:false,code:'SECURITY_ALERT_INVALID',error:'An alert requires a severity, public message and expiry of 1–30 days.'};
      const alert={
        id:createId(),stateId,provinceId:securityCase.provinceId,caseId:securityCase.id,
        severity:order.severity,message:order.message.trim(),
        issuedByPlayerId:player.id,issuedOn:game.worldDate,
        expiresOn:addDays(game.worldDate,order.durationDays),status:'active'
      };
      game.securityAlerts.push(alert);
      record(game,'alert_issued',stateId,
        'Public security alert issued for '+alert.provinceId+'.',
        {alertId:alert.id,caseId:alert.caseId,severity:alert.severity,expiresOn:alert.expiresOn},createId);
      return {ok:true,alertId:alert.id};
    }

    return {ok:false,code:'SECURITY_ORDER_UNSUPPORTED',error:'This security action is not supported.'};
  }

  function addDays(date,days) {
    const parsed=new Date(date+'T00:00:00Z');
    parsed.setUTCDate(parsed.getUTCDate()+days);
    return parsed.toISOString().slice(0,10);
  }

  function advanceDay(game) {
    ensure(game);
    const expired=[];
    const expiredWarrants=[];
    for(const warrant of game.securityWarrants) {
      if(warrant.status==='approved' && warrant.expiresOn<game.worldDate) {
        warrant.status='expired';
        expiredWarrants.push(warrant.id);
      }
    }
    for(const alert of game.securityAlerts) {
      if(alert.status==='active' && alert.expiresOn<game.worldDate) {
        alert.status='expired';
        expired.push(alert.id);
        let generated=0;
        record(game,'alert_expired',alert.stateId,
          'Public security alert expired for '+alert.provinceId+'.',
          {alertId:alert.id},()=> 'alert-expiry-'+game.id+'-'+alert.id+'-'+game.worldDate+'-'+(++generated));
      }
    }
    for(const securityCase of game.securityCases) {
      if(securityCase.status==='investigating' && securityCase.reviewDueOn<game.worldDate)
        securityCase.reviewStatus='overdue';
    }
    return {ok:true,expiredAlerts:expired,expiredWarrants};
  }

  const api=Object.freeze({
    ensure,validateConfiguration,applyOrder,advanceDay,lawIsActive,
    configurationFields:Object.freeze([...CONFIG_FIELDS]),
    dynamicFields:Object.freeze([...DYNAMIC_FIELDS])
  });
  globalThis.NewWorldSecurity=api;
  if(typeof module!=='undefined' && module.exports) module.exports=api;
})();