'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const simulation=require('../simulation.js');
const strategy=require('../strategy.js');
const justice=require('../justice.js');
const resources=require('../resources.js');
const bureaucracy=require('../bureaucracy.js');
const media=require('../media.js');
const security=require('../security.js');

globalThis.NewWorldBureaucracy=bureaucracy;
globalThis.NewWorldResources=resources;
globalThis.NewWorldMedia=media;
globalThis.NewWorldSecurity=security;
global.window={
  NewWorldSimulation:simulation,NewWorldStrategy:strategy,
  NewWorldJustice:justice,NewWorldResources:resources,
  NewWorldBureaucracy:bureaucracy,NewWorldMedia:media,
  NewWorldSecurity:security
};
const multiplayer=require('../multiplayer.js');
let sequence=0;

function freshWorld() {
  return multiplayer.createInitialWorld('Security Test').game;
}

test('public snapshots withhold classified security records and player-scoped snapshots honor active State memberships',()=>{
  const game=freshWorld();
  const {territory}=configure(game);
  const player=game.players[0];
  const otherStateId=game.territories.find(item=>item.stateId!==territory.stateId).stateId;
  game.securityIncidents.push(
    {id:'own-private-incident',stateId:territory.stateId},
    {id:'other-private-incident',stateId:otherStateId}
  );
  game.securityCases.push(
    {id:'own-private-case',stateId:territory.stateId},
    {id:'other-private-case',stateId:otherStateId}
  );
  game.securityReports.push(
    {id:'own-classified-report',stateId:territory.stateId,classification:'secret'},
    {id:'public-report',stateId:otherStateId,classification:'public'},
    {id:'other-classified-report',stateId:otherStateId,classification:'confidential'}
  );
  game.securityWarrants.push(
    {id:'own-warrant',stateId:territory.stateId},
    {id:'other-warrant',stateId:otherStateId}
  );
  game.orders.push(
    {id:'own-secret-order',type:'security.approveWarrant',stateId:territory.stateId,payload:{reason:'classified reason'}},
    {id:'other-secret-order',type:'security.openCase',stateId:otherStateId,payload:{incidentId:'foreign private case'}},
    {id:'public-order',type:'government.approveBudget',stateId:territory.stateId,payload:{}}
  );
  game.events.push(
    {id:'own-secret-event',type:'security.warrant_decided',stateId:territory.stateId,details:{reason:'classified reason'}},
    {id:'other-secret-event',type:'security.case_opened',stateId:otherStateId,details:{caseId:'private'}},
    {id:'public-event',type:'media.article_published',stateId:territory.stateId,details:{}}
  );
  const publicView=multiplayer.publicSnapshot(game);
  assert.equal(publicView.securityAgencies.length,0);
  assert.equal(publicView.securityAuthorizations.length,0);
  assert.equal(publicView.securityIncidents.length,0);
  assert.equal(publicView.securityCases.length,0);
  assert.equal(publicView.securityWarrants.length,0);
  assert.deepEqual(publicView.securityReports.map(item=>item.id),['public-report']);
  const scoped=multiplayer.snapshotForPlayer(game,player.id);
  assert.deepEqual(scoped.securityAgencies.map(item=>item.id),['national-security-agency']);
  assert.deepEqual(scoped.securityIncidents.map(item=>item.id),['own-private-incident']);
  assert.deepEqual(scoped.securityCases.map(item=>item.id),['own-private-case']);
  assert.deepEqual(scoped.securityReports.map(item=>item.id),['own-classified-report']);
  assert.deepEqual(scoped.securityWarrants.map(item=>item.id),['own-warrant']);
  assert.equal(publicView.orders.some(item=>item.id==='own-secret-order'||item.id==='other-secret-order'),false);
  assert.ok(publicView.orders.some(item=>item.id==='public-order'));
  assert.equal(publicView.events.some(item=>item.id==='own-secret-event'||item.id==='other-secret-event'),false);
  assert.ok(publicView.events.some(item=>item.id==='public-event'));
  assert.ok(scoped.orders.some(item=>item.id==='own-secret-order'));
  assert.equal(scoped.orders.some(item=>item.id==='other-secret-order'),false);
  assert.ok(scoped.events.some(item=>item.id==='own-secret-event'));
  assert.equal(scoped.events.some(item=>item.id==='other-secret-event'),false);
});

function configure(game,options={}) {
  const territory=game.territories[0];
  const stateId=territory.stateId;
  const province=game.provinces.find(item=>item.stateId===stateId);
  const political=game.politicalSystems.find(item=>item.stateId===stateId);
  const investigator={id:'security-investigator-office',name:'Security Investigator',
    holderPlayerId:game.players[0].id};
  const oversightPlayer={
    id:'security-oversight-player',name:'Independent Security Inspector',
    connected:true,token:'security-oversight-player-token'
  };
  game.players.push(oversightPlayer);
  game.memberships.push({
    id:'security-oversight-membership',gameId:game.id,
    playerId:oversightPlayer.id,stateId,status:'active',
    permissionSetId:'government-member'
  });
  const oversight={id:'security-oversight-office',name:'Security Oversight',
    holderPlayerId:oversightPlayer.id};
  const judicialPlayer={id:'security-judicial-player',name:'Independent Judge',
    connected:true,token:'security-judicial-player-token'};
  game.players.push(judicialPlayer);
  game.memberships.push({
    id:'security-judicial-membership',gameId:game.id,playerId:judicialPlayer.id,
    stateId,status:'active',permissionSetId:'government-member'
  });
  const judicialOffice={id:'security-judicial-office',name:'Judicial Warrant Judge',
    holderPlayerId:judicialPlayer.id};
  political.offices ||= [];
  political.offices.push(investigator,oversight,judicialOffice);
  political.laws.push({
    id:'security-authority-act',title:'Security Authority Act',
    status:'enacted',effectiveFrom:game.worldDate
  });
  const configuration={
    securityAgencies:[{
      id:'national-security-agency',stateId,name:'National Security Agency',
      scope:'counterintelligence',
      competenceIds:['cyber_incident','espionage'],
      investigationOfficeIds:[investigator.id],
      oversightOfficeIds:[oversight.id],
      provinceIds:[province.id],personnel:10,capacityPercent:100,
      reliabilityPercent:90,corruptionRiskPercent:5,dailyCaseCapacity:3
    }],
    securityAuthorizations:[{
      id:'counterintelligence-mandate',stateId,
      agencyId:'national-security-agency',
      lawId:'security-authority-act',
      competenceIds:['cyber_incident','espionage'],
      provinceIds:[province.id],prohibitedActivities:['unlawful_mass_surveillance'],
      validityDays:365,reviewIntervalDays:5,warrantRequired:Boolean(options.warrantRequired),
      warrantApprovalOfficeIds:options.warrantRequired?['security-judicial-office']:[]
    }]
  };
  const valid=security.validateConfiguration(game,configuration);
  assert.equal(valid.ok,true,valid.error);
  const saved=multiplayer.applyAdmin(game,'configure',{kind:'security',configuration});
  assert.equal(saved.ok,true,saved.error);
  return {territory,province,political,oversightPlayer,investigator,oversight,judicialPlayer};
}
function start(game) {
  const result=multiplayer.applyAdmin(game,'start',{});
  assert.equal(result.ok,true,result.error);
}
function send(game,player,type,payload={}) {
  const stateId=payload.stateId||game.territories[0].stateId;
  return multiplayer.applyOrder(game,player,{
    orderId:'security-test-'+(++sequence),gameId:game.id,playerId:player.id,
    expectedWorldVersion:game.worldVersion,stateId,type,...payload
  });
}
function report(game,player,provinceId) {
  return send(game,player,'security.reportIncident',{
    stateId:game.territories[0].stateId,provinceId,
    incidentType:'cyber_incident',
    description:'A coordinated outage was reported in the provincial transport control system.'
  });
}
function openCase(game,player,incidentId) {
  return send(game,player,'security.openCase',{
    stateId:game.territories[0].stateId,incidentId,
    agencyId:'national-security-agency',authorizationId:'counterintelligence-mandate'
  });
}

test('new worlds create no security agencies, incidents, investigations or alerts by default',()=>{
  const game=freshWorld();
  for(const field of [...security.configurationFields,...security.dynamicFields])
    assert.deepEqual(game[field],[],field+' must be empty in a new world');
});
test('security configuration rejects invalid offices, inactive legal mandates and out-of-State provinces',()=>{
  const game=freshWorld();
  const values=configure(game);
  const configuration={
    securityAgencies:game.securityAgencies,
    securityAuthorizations:game.securityAuthorizations
  };
  const wrongOffice=structuredClone(configuration);
  wrongOffice.securityAgencies[0].oversightOfficeIds=['investigator-office'];
  assert.match(security.validateConfiguration(game,wrongOffice).error,/separate investigation and oversight/i);
  const wrongProvince=structuredClone(configuration);
  wrongProvince.securityAuthorizations[0].provinceIds=['foreign-province'];
  assert.match(security.validateConfiguration(game,wrongProvince).error,/active State law/i);
  const inactiveLaw=structuredClone(configuration);
  game.politicalSystems.find(item=>item.stateId===values.territory.stateId)
    .laws.find(item=>item.id==='security-authority-act').status='repealed';
  assert.match(security.validateConfiguration(game,inactiveLaw).error,/active State law/i);
});
test('incident reports require a valid in-State province, category and description',()=>{
  const game=freshWorld();
  const {territory,province}=configure(game);
  start(game);
  const invalid=send(game,game.players[0],'security.reportIncident',{
    stateId:territory.stateId,provinceId:'not-a-province',
    incidentType:'cyber_incident',description:'This should not be accepted as a valid local incident.'
  });
  assert.equal(invalid.accepted,false);
  assert.equal(invalid.code,'SECURITY_INCIDENT_INVALID');
  const valid=report(game,game.players[0],province.id);
  assert.equal(valid.accepted,true,valid.error);
  assert.equal(game.securityIncidents.length,1);
  assert.equal(game.securityIncidents[0].status,'untriaged');
});
test('investigations require a law, competence, province and a separately authorized investigative office',()=>{
  const game=freshWorld();
  const {territory,province}=configure(game);
  start(game);
  const incident=report(game,game.players[0],province.id);
  const invalid=send(game,game.players[0],'security.openCase',{
    stateId:territory.stateId,incidentId:game.securityIncidents[0].id,
    agencyId:'national-security-agency',authorizationId:'invalid-mandate'
  });
  assert.equal(invalid.accepted,false);
  assert.equal(invalid.code,'SECURITY_CASE_SCOPE_INVALID');
  const observer={id:'security-observer',name:'Security Observer',connected:true,token:'security-observer-token'};
  game.players.push(observer);
  game.memberships.push({
    id:'security-observer-membership',gameId:game.id,playerId:observer.id,
    stateId:territory.stateId,status:'active',permissionSetId:'government-member'
  });
  const denied=openCase(game,observer,game.securityIncidents[0].id);
  assert.equal(denied.accepted,false);
  assert.equal(denied.code,'SECURITY_INVESTIGATION_AUTHORITY_REQUIRED');
  const accepted=openCase(game,game.players[0],game.securityIncidents[0].id);
  assert.equal(accepted.accepted,true,accepted.error);
  assert.equal(game.securityCases.length,1);
  assert.equal(game.securityIncidents[0].status,'under_review');
  assert.ok(incident.accepted);
});
test('an intelligence assessment must reference an existing local event and cannot exceed confidence bounds',()=>{
  const game=freshWorld();
  const {territory,province}=configure(game);
  start(game);
  report(game,game.players[0],province.id);
  openCase(game,game.players[0],game.securityIncidents[0].id);
  const caseId=game.securityCases[0].id;
  const missing=send(game,game.players[0],'security.addReport',{
    stateId:territory.stateId,caseId,summary:'The event has been attributed to a suspicious system outage.',
    confidencePercent:90,classification:'confidential',sourceEventIds:['missing-event']
  });
  assert.equal(missing.accepted,false);
  assert.equal(missing.code,'SECURITY_SOURCE_INVALID');
  const source={id:'security-source-event',stateId:territory.stateId,
    type:'infrastructure.outage',description:'Transport infrastructure outage recorded by system telemetry.'};
  game.events.push(source);
  const accepted=send(game,game.players[0],'security.addReport',{
    stateId:territory.stateId,caseId,
    summary:'System logs indicate an attempted unauthorized access to the control network.',
    confidencePercent:75,classification:'confidential',sourceEventIds:[source.id]
  });
  assert.equal(accepted.accepted,true,accepted.error);
  assert.equal(game.securityReports.length,1);
  assert.equal(game.securityCases[0].confidencePercent,75);
  assert.equal(game.securityCases[0].classification,'confidential');
});
test('case closure requires an independent oversight office and written reasons',()=>{
  const game=freshWorld();
  const {territory,province,oversightPlayer}=configure(game);
  start(game);
  report(game,game.players[0],province.id);
  openCase(game,game.players[0],game.securityIncidents[0].id);
  const caseId=game.securityCases[0].id;
  const conflict=send(game,game.players[0],'security.closeCase',{
    stateId:territory.stateId,caseId,outcome:'no_action',
    reason:'Independent review concludes the allegation is not supported by evidence.'
  });
  assert.equal(conflict.accepted,false);
  assert.equal(conflict.code,'SECURITY_OVERSIGHT_REQUIRED');
  const closure=send(game,oversightPlayer,'security.closeCase',{
    stateId:territory.stateId,caseId,outcome:'unsubstantiated',
    reason:'Independent oversight found no reliable corroboration for the original allegation.'
  });
  assert.equal(closure.accepted,true,closure.error);
  assert.equal(game.securityCases[0].status,'closed');
  assert.equal(game.securityCases[0].outcome,'unsubstantiated');
  assert.equal(game.securityIncidents[0].status,'closed');
});
test('a referral to justice must cite an existing judicial case in the same State',()=>{
  const game=freshWorld();
  const {territory,province,oversightPlayer}=configure(game);
  start(game);
  report(game,game.players[0],province.id);
  openCase(game,game.players[0],game.securityIncidents[0].id);
  const denied=send(game,oversightPlayer,'security.closeCase',{
    stateId:territory.stateId,caseId:game.securityCases[0].id,
    outcome:'referred_to_justice',justiceCaseId:'invented-case',
    reason:'The oversight review recommends an ordinary judicial process based on corroborated evidence.'
  });
  assert.equal(denied.accepted,false);
  assert.equal(denied.code,'SECURITY_JUSTICE_REFERENCE_REQUIRED');
});
test('public security alerts are tied to an open case and automatically expire',()=>{
  const game=freshWorld();
  const {territory,province,oversightPlayer}=configure(game);
  start(game);
  report(game,game.players[0],province.id);
  openCase(game,game.players[0],game.securityIncidents[0].id);
  const result=send(game,oversightPlayer,'security.issueAlert',{
    stateId:territory.stateId,caseId:game.securityCases[0].id,
    severity:3,message:'Authorities are investigating an interruption affecting provincial transport services.',
    durationDays:2
  });
  assert.equal(result.accepted,true,result.error);
  assert.equal(game.securityAlerts.length,1);
  assert.equal(game.securityAlerts[0].status,'active');
  game.worldDate='1500-01-04';
  security.advanceDay(game);
  assert.equal(game.securityAlerts[0].status,'expired');
});
test('investigation mandates cannot be used after their law is repealed',()=>{
  const game=freshWorld();
  const {territory,province,political}=configure(game);
  start(game);
  report(game,game.players[0],province.id);
  political.laws.find(item=>item.id==='security-authority-act').status='repealed';
  const result=openCase(game,game.players[0],game.securityIncidents[0].id);
  assert.equal(result.accepted,false);
  assert.equal(result.code,'SECURITY_LEGAL_BASIS_INVALID');
});


test('warrant-required investigations need an independent judicial approval before a case can open',()=>{
  const game=freshWorld();
  const {territory,province,judicialPlayer}=configure(game,{warrantRequired:true});
  start(game);
  report(game,game.players[0],province.id);
  const incidentId=game.securityIncidents[0].id;
  const request=send(game,game.players[0],'security.requestWarrant',{
    stateId:territory.stateId,incidentId,
    agencyId:'national-security-agency',authorizationId:'counterintelligence-mandate',
    reason:'A time-limited judicial authorization is necessary to examine evidence in this specific cyber incident.'
  });
  assert.equal(request.accepted,true,request.error);
  const requestId=game.securityWarrantRequests[0].id;
  assert.equal(game.securityWarrantRequests[0].status,'pending');

  const selfApproval=send(game,game.players[0],'security.approveWarrant',{
    stateId:territory.stateId,requestId,decision:'approved',
    reason:'The investigative office cannot approve its own warrant request.'
  });
  assert.equal(selfApproval.accepted,false);
  assert.equal(selfApproval.code,'SECURITY_WARRANT_JUDICIAL_AUTHORITY_REQUIRED');

  const decision=send(game,judicialPlayer,'security.approveWarrant',{
    stateId:territory.stateId,requestId,decision:'approved',
    reason:'The application is necessary, sufficiently narrow and proportionate to the reported incident.'
  });
  assert.equal(decision.accepted,true,decision.error);
  const warrant=game.securityWarrants[0];
  assert.equal(warrant.status,'approved');
  assert.equal(warrant.issuedByPlayerId,judicialPlayer.id);

  const opened=send(game,game.players[0],'security.openCase',{
    stateId:territory.stateId,incidentId,agencyId:'national-security-agency',
    authorizationId:'counterintelligence-mandate',warrantId:warrant.id
  });
  assert.equal(opened.accepted,true,opened.error);
  assert.equal(warrant.status,'used');
  assert.equal(game.securityCases[0].warrantId,warrant.id);
});

test('warrant requests cannot be approved by their requester or by an office outside judicial oversight',()=>{
  const game=freshWorld();
  const {territory,province,oversightPlayer}=configure(game,{warrantRequired:true});
  start(game);
  report(game,game.players[0],province.id);
  const request=send(game,game.players[0],'security.requestWarrant',{
    stateId:territory.stateId,incidentId:game.securityIncidents[0].id,
    agencyId:'national-security-agency',authorizationId:'counterintelligence-mandate',
    reason:'The legal application seeks a narrow authorization to investigate the documented incident.'
  });
  assert.equal(request.accepted,true,request.error);
  const denied=send(game,oversightPlayer,'security.approveWarrant',{
    stateId:territory.stateId,requestId:game.securityWarrantRequests[0].id,
    decision:'approved',reason:'This office is for administrative oversight but not judicial warrants.'
  });
  assert.equal(denied.accepted,false);
  assert.equal(denied.code,'SECURITY_WARRANT_JUDICIAL_AUTHORITY_REQUIRED');
  assert.equal(game.securityWarrantRequests[0].status,'pending');
});

test('a security investigation cannot use an expired, denied or mismatched warrant',()=>{
  const game=freshWorld();
  const {territory,province,judicialPlayer}=configure(game,{warrantRequired:true});
  start(game);
  report(game,game.players[0],province.id);
  const incidentId=game.securityIncidents[0].id;
  const request=send(game,game.players[0],'security.requestWarrant',{
    stateId:territory.stateId,incidentId,
    agencyId:'national-security-agency',authorizationId:'counterintelligence-mandate',
    reason:'The investigator requests a time-limited warrant based on a documented threat report.'
  });
  assert.equal(request.accepted,true,request.error);
  const decision=send(game,judicialPlayer,'security.approveWarrant',{
    stateId:territory.stateId,requestId:game.securityWarrantRequests[0].id,
    decision:'approved',reason:'The evidence threshold is met and the request is proportionate.'
  });
  assert.equal(decision.accepted,true,decision.error);
  const warrant=game.securityWarrants[0];
  warrant.expiresOn='1500-01-01';
  const opened=send(game,game.players[0],'security.openCase',{
    stateId:territory.stateId,incidentId,agencyId:'national-security-agency',
    authorizationId:'counterintelligence-mandate',warrantId:warrant.id
  });
  assert.equal(opened.accepted,false);
  assert.equal(opened.code,'SECURITY_WARRANT_REQUIRED');
  assert.equal(game.securityCases.length,0);
});
