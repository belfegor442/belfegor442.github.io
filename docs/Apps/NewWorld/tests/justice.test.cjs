'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const simulation=require('../simulation.js');
const strategy=require('../strategy.js');
const justice=require('../justice.js');

global.window={
  NewWorldSimulation:simulation,
  NewWorldStrategy:strategy,
  NewWorldJustice:justice
};

const multiplayer=require('../multiplayer.js');
let sequence=0;

function freshWorld() {
  const {game}=multiplayer.createInitialWorld('Justice Founder');
  return game;
}

function addMember(game,name,officeIds=[]) {
  const player={
    id:'justice-player-'+(++sequence),name,connected:true,
    token:'justice-token-'+sequence,countryIndex:0
  };
  game.players.push(player);
  game.memberships.push({
    id:'justice-membership-'+sequence,gameId:game.id,playerId:player.id,
    stateId:game.territories[0].stateId,status:'active',
    permissionSetId:'government-member'
  });
  const political=game.politicalSystems.find(item=>item.stateId===game.territories[0].stateId);
  for(const officeId of officeIds) {
    const office=political.offices.find(item=>item.id===officeId);
    if(office) office.holderPlayerId=player.id;
    else political.offices.push({
      id:officeId,name:officeId,holderPlayerId:player.id,
      institutionId:'justice-institution'
    });
  }
  return player;
}

function configureJustice(game) {
  const territory=game.territories[0];
  const stateId=territory.stateId;
  const province=game.provinces.find(item=>item.stateId===stateId);
  const political=game.politicalSystems.find(item=>item.stateId===stateId);
  political.laws.push({
    id:'theft-act',title:'Theft Act',text:'A configured statute for the justice test scenario.',
    status:'enacted',effectiveFrom:game.worldDate
  });
  for(const officeId of ['prosecutor-office','judge-office','sentencing-office','appeal-office']) {
    if(!political.offices.some(item=>item.id===officeId))
      political.offices.push({
        id:officeId,name:officeId,holderPlayerId:null,
        institutionId:'justice-institution'
      });
  }
  const configuration={
    justiceSystems:game.territories.map(item=>{
      const base={
        stateId:item.stateId,configurationVersion:1,configurationPending:true,
        crimeTypes:[],courts:[],policeAgencies:[],prisons:[],
        prosecutorOfficeIds:[],judicialOfficeIds:[],sentenceOfficeIds:[],appealOfficeIds:[]
      };
      if(item.stateId!==stateId) return base;
      return {
        ...base,
        configurationPending:true,
        crimeTypes:[{
          id:'theft',name:'Theft',lawId:'theft-act',
          minimumEvidenceCount:1,evidenceTypes:['testimony','documentary'],
          penalties:[{id:'fine-1',type:'fine',minAmount:10,maxAmount:100}]
        }],
        courts:[{
          id:'district-court',name:'District Court',
          jurisdictionProvinceIds:[province.id],crimeTypeIds:['theft'],
          authorizedOfficeIds:['judge-office'],
          capacity:2,staff:3,independencePercent:80,
          minimumEvidenceCountForConviction:1
        }],
        policeAgencies:[{
          id:'state-police',name:'State Police',
          jurisdictionProvinceIds:[province.id],crimeTypeIds:['theft'],
          authorizedOfficeIds:['chief-executive'],staff:12
        }],
        prisons:[{id:'central-prison',name:'Central Prison',capacity:2}],
        prosecutorOfficeIds:['prosecutor-office'],
        judicialOfficeIds:['judge-office'],
        sentenceOfficeIds:['sentencing-office'],
        appealOfficeIds:['appeal-office'],
        appealWindowDays:30
      };
    })
  };
  const validated=justice.validateConfiguration(game,configuration);
  assert.equal(validated.ok,true,validated.error);
  const configured=multiplayer.applyAdmin(game,'configure',{
    kind:'justice',configuration
  });
  assert.equal(configured.ok,true,configured.error);
  assert.equal(game.justiceSystems.find(item=>item.stateId===stateId).configurationPending,false,
    'the host derives readiness from all four configured legal system components');
  return {territory,province,stateId,political};
}

function submit(game,player,type,payload={}) {
  const stateId=payload.stateId || game.territories[0].stateId;
  const membership=game.memberships.find(item=>
    item.playerId===player.id && item.status==='active' && item.stateId===stateId);
  assert.ok(membership,'player must have an active membership in the requested State');
  return multiplayer.applyOrder(game,player,{
    orderId:'justice-order-'+(++sequence),
    gameId:game.id,playerId:player.id,
    expectedWorldVersion:game.worldVersion,
    stateId,type,...payload
  });
}

function startWorld(game) {
  const result=multiplayer.applyAdmin(game,'start',{});
  assert.equal(result.ok,true,result.error);
}

function reportIncident(game,player,province,description='A resident reported a suspected theft near the public market.',incidentDate) {
  const result=submit(game,player,'justice.reportIncident',{
    stateId:game.territories[0].stateId,provinceId:province.id,description,
    ...(incidentDate?{incidentDate}:{})
  });
  assert.equal(result.accepted,true,result.error);
  return game.justiceReports.at(-1);
}

function openInvestigation(game,player,report) {
  const result=submit(game,player,'justice.openInvestigation',{
    stateId:report.stateId,reportId:report.id,crimeTypeId:'theft',
    agencyId:'state-police',courtId:'district-court'
  });
  return result;
}

test('new worlds receive an empty justice framework for all sixteen States without invented offences or institutions',()=>{
  const game=freshWorld();
  assert.equal(game.justiceSystems.length,16);
  assert.equal(game.justiceSystems.every(system=>
    system.configurationPending===true &&
    system.crimeTypes.length===0 && system.courts.length===0 &&
    system.policeAgencies.length===0 && system.prisons.length===0),true);
  assert.deepEqual(game.justiceReports,[]);
  assert.deepEqual(game.justiceCases,[]);
  assert.deepEqual(game.justiceHistory,[]);
});

test('justice configuration requires all States and rejects invalid laws, provinces and office references',()=>{
  const game=freshWorld();
  const {province}=configureJustice(game);
  const configuration={justiceSystems:structuredClone(game.justiceSystems)};
  assert.equal(justice.validateConfiguration(game,{
    justiceSystems:configuration.justiceSystems.slice(1)
  }).ok,false);

  const badLaw=structuredClone(configuration);
  badLaw.justiceSystems[0].crimeTypes[0].lawId='invented-law';
  assert.match(justice.validateConfiguration(game,badLaw).error,/existing State law/i);

  const badProvince=structuredClone(configuration);
  badProvince.justiceSystems[0].courts[0].jurisdictionProvinceIds=['not-a-province'];
  assert.match(justice.validateConfiguration(game,badProvince).error,/court has invalid jurisdiction/i);

  const badOffice=structuredClone(configuration);
  badOffice.justiceSystems[0].policeAgencies[0].authorizedOfficeIds=['unknown-office'];
  assert.match(justice.validateConfiguration(game,badOffice).error,/police agency has invalid/i);
  assert.ok(province.id);
});

test('incident reports remain unclassified and do not create a criminal case or presume guilt',()=>{
  const game=freshWorld();
  const host=game.players[0];
  const {province}=configureJustice(game);
  startWorld(game);
  const report=reportIncident(game,host,province);
  assert.equal(report.status,'unclassified');
  assert.equal(report.caseId,null);
  assert.equal(game.justiceCases.length,0);
  assert.ok(game.justiceHistory.some(item=>item.type==='report_received'));

  const invalid=submit(game,host,'justice.reportIncident',{
    stateId:game.territories[0].stateId,provinceId:province.id,
    description:'<script>alert(1)</script>'
  });
  assert.equal(invalid.accepted,false);
  assert.equal(invalid.code,'JUSTICE_REPORT_INVALID');
  assert.equal(game.justiceReports.length,1);
});

test('an incident cannot be prosecuted under a law that entered into force after the reported date',()=>{
  const game=freshWorld();
  const host=game.players[0];
  const {province}=configureJustice(game);
  startWorld(game);
  const report=reportIncident(game,host,province,
    'A suspected theft was reported before the new statute existed.','1499-12-31');
  const result=openInvestigation(game,host,report);
  assert.equal(result.accepted,false);
  assert.match(result.error,/active enacted law/i);
  assert.equal(report.status,'unclassified');
  assert.equal(game.justiceCases.length,0);
});

test('a law enacted after the reported incident cannot be applied retroactively',()=>{
  const game=freshWorld();
  const host=game.players[0];
  const {province}=configureJustice(game);
  const law=game.politicalSystems[0].laws.find(item=>item.id==='theft-act');
  law.effectiveFrom='1500-01-02';
  startWorld(game);
  const report=reportIncident(game,host,province,
    'A suspected theft occurred before the law took effect.','1500-01-01');
  const result=openInvestigation(game,host,report);
  assert.equal(result.accepted,false);
  assert.equal(report.status,'unclassified');
  assert.equal(game.justiceCases.length,0);
});

test('investigations and evidence require the law, territorial competence and the authorized police office',()=>{
  const game=freshWorld();
  const host=game.players[0];
  const {province}=configureJustice(game);
  const unauthorized=addMember(game,'Unauthorized Member');
  startWorld(game);
  const report=reportIncident(game,host,province);

  const denied=openInvestigation(game,unauthorized,report);
  assert.equal(denied.accepted,false);
  assert.equal(denied.code,'JUSTICE_INVESTIGATION_UNAUTHORISED');
  assert.equal(game.justiceCases.length,0);

  const opened=openInvestigation(game,host,report);
  assert.equal(opened.accepted,true,opened.error);
  const caseRecord=game.justiceCases[0];
  assert.equal(caseRecord.status,'investigating');
  assert.equal(report.status,'investigating');
  assert.equal(caseRecord.legalBasisId,'theft-act');

  const deniedEvidence=submit(game,unauthorized,'justice.addEvidence',{
    stateId:caseRecord.stateId,caseId:caseRecord.id,
    evidenceType:'testimony',description:'A witness statement is recorded for review.'
  });
  assert.equal(deniedEvidence.accepted,false);
  assert.equal(deniedEvidence.code,'JUSTICE_EVIDENCE_UNAUTHORISED');

  const evidence=submit(game,host,'justice.addEvidence',{
    stateId:caseRecord.stateId,caseId:caseRecord.id,
    evidenceType:'testimony',description:'A witness statement is recorded for review.'
  });
  assert.equal(evidence.accepted,true,evidence.error);
  assert.equal(caseRecord.evidence.length,1);
  assert.equal(caseRecord.evidence[0].verified,false);
  assert.equal(caseRecord.verdict,null);
  assert.equal(caseRecord.sentence,null);
});

test('prosecution requires evidence and a separate prosecutor; judicial decisions reject conflicts of interest',()=>{
  const game=freshWorld();
  const investigator=game.players[0];
  const {province}=configureJustice(game);
  const prosecutor=addMember(game,'Prosecutor',['prosecutor-office']);
  const judge=addMember(game,'Judge',['judge-office']);
  startWorld(game);
  const report=reportIncident(game,investigator,province);
  assert.equal(openInvestigation(game,investigator,report).accepted,true);
  const caseRecord=game.justiceCases[0];

  const noEvidence=submit(game,prosecutor,'justice.fileCharges',{
    stateId:caseRecord.stateId,caseId:caseRecord.id
  });
  assert.equal(noEvidence.accepted,false);
  assert.equal(noEvidence.code,'JUSTICE_CHARGES_NOT_AUTHORISED');

  const evidence=submit(game,investigator,'justice.addEvidence',{
    stateId:caseRecord.stateId,caseId:caseRecord.id,
    evidenceType:'testimony',description:'A witness statement is recorded for review.'
  });
  assert.equal(evidence.accepted,true,evidence.error);

  const filed=submit(game,prosecutor,'justice.fileCharges',{
    stateId:caseRecord.stateId,caseId:caseRecord.id
  });
  assert.equal(filed.accepted,true,filed.error);
  assert.equal(caseRecord.status,'charged');

  const conflict=submit(game,investigator,'justice.decideCase',{
    stateId:caseRecord.stateId,caseId:caseRecord.id,verdict:'guilty'
  });
  assert.equal(conflict.accepted,false);
  assert.equal(conflict.code,'JUSTICE_TRIAL_UNAUTHORISED');

  const judged=submit(game,judge,'justice.decideCase',{
    stateId:caseRecord.stateId,caseId:caseRecord.id,verdict:'guilty'
  });
  assert.equal(judged.accepted,true,judged.error);
  assert.equal(caseRecord.status,'convicted');
  assert.equal(caseRecord.verdict.outcome,'guilty');
});

test('sentencing requires a conviction and follows the penalty bounds defined by the applicable law',()=>{
  const game=freshWorld();
  const investigator=game.players[0];
  const {province}=configureJustice(game);
  const prosecutor=addMember(game,'Prosecutor',['prosecutor-office']);
  const judge=addMember(game,'Judge',['judge-office']);
  const sentencer=addMember(game,'Sentencer',['sentencing-office']);
  startWorld(game);
  const report=reportIncident(game,investigator,province);
  assert.equal(openInvestigation(game,investigator,report).accepted,true);
  const caseRecord=game.justiceCases[0];
  assert.equal(submit(game,investigator,'justice.addEvidence',{
    stateId:caseRecord.stateId,caseId:caseRecord.id,evidenceType:'testimony',
    description:'A witness statement is recorded for review.'
  }).accepted,true);
  assert.equal(submit(game,prosecutor,'justice.fileCharges',{
    stateId:caseRecord.stateId,caseId:caseRecord.id
  }).accepted,true);
  assert.equal(submit(game,judge,'justice.decideCase',{
    stateId:caseRecord.stateId,caseId:caseRecord.id,verdict:'guilty'
  }).accepted,true);

  const invalid=submit(game,sentencer,'justice.imposeSentence',{
    stateId:caseRecord.stateId,caseId:caseRecord.id,penaltyId:'fine-1',amount:1000
  });
  assert.equal(invalid.accepted,false);
  assert.equal(invalid.code,'JUSTICE_SENTENCE_AMOUNT_INVALID');

  const imposed=submit(game,sentencer,'justice.imposeSentence',{
    stateId:caseRecord.stateId,caseId:caseRecord.id,penaltyId:'fine-1',amount:50
  });
  assert.equal(imposed.accepted,true,imposed.error);
  assert.equal(caseRecord.status,'sentenced');
  assert.equal(caseRecord.sentence.amount,50);

  const duplicate=submit(game,sentencer,'justice.imposeSentence',{
    stateId:caseRecord.stateId,caseId:caseRecord.id,penaltyId:'fine-1',amount:50
  });
  assert.equal(duplicate.accepted,false);
  assert.equal(caseRecord.sentence.amount,50);
  assert.equal(game.justiceHistory.filter(item=>item.type==='sentence_imposed').length,1);
});

test('appeals require an explicit appeal office and configured deadline; records retain a full procedural history',()=>{
  const game=freshWorld();
  const investigator=game.players[0];
  const {province}=configureJustice(game);
  const prosecutor=addMember(game,'Prosecutor',['prosecutor-office']);
  const judge=addMember(game,'Judge',['judge-office']);
  const sentencer=addMember(game,'Sentencer',['sentencing-office']);
  const appellant=addMember(game,'Appeal Officer',['appeal-office']);
  startWorld(game);
  const report=reportIncident(game,investigator,province);
  assert.equal(openInvestigation(game,investigator,report).accepted,true);
  const caseRecord=game.justiceCases[0];
  assert.equal(submit(game,investigator,'justice.addEvidence',{
    stateId:caseRecord.stateId,caseId:caseRecord.id,evidenceType:'testimony',
    description:'A witness statement is recorded for review.'
  }).accepted,true);
  assert.equal(submit(game,prosecutor,'justice.fileCharges',{
    stateId:caseRecord.stateId,caseId:caseRecord.id
  }).accepted,true);
  assert.equal(submit(game,judge,'justice.decideCase',{
    stateId:caseRecord.stateId,caseId:caseRecord.id,verdict:'guilty'
  }).accepted,true);
  assert.equal(submit(game,sentencer,'justice.imposeSentence',{
    stateId:caseRecord.stateId,caseId:caseRecord.id,penaltyId:'fine-1',amount:40
  }).accepted,true);

  const appealed=submit(game,appellant,'justice.fileAppeal',{
    stateId:caseRecord.stateId,caseId:caseRecord.id
  });
  assert.equal(appealed.accepted,true,appealed.error);
  assert.equal(caseRecord.status,'appealed');
  assert.ok(game.justiceHistory.some(item=>item.type==='appeal_filed'));
  assert.ok(game.justiceCases[0]);
  assert.equal(caseRecord.evidence.length,1);
  assert.equal(caseRecord.verdict.outcome,'guilty');
  assert.equal(caseRecord.sentence.amount,40);
});

test('court capacity blocks a second investigation without modifying the first case or report',()=>{
  const game=freshWorld();
  const investigator=game.players[0];
  const {province}=configureJustice(game);
  const secondCourt=game.justiceSystems[0].courts[0];
  secondCourt.capacity=1;
  startWorld(game);

  const first=reportIncident(game,investigator,province,
    'A reported incident is awaiting legal review in the district.');
  assert.equal(openInvestigation(game,investigator,first).accepted,true);
  const originalCase=game.justiceCases[0];

  const second=reportIncident(game,investigator,province,
    'A second reported incident is awaiting legal review in town.');
  const blocked=openInvestigation(game,investigator,second);
  assert.equal(blocked.accepted,false);
  assert.equal(blocked.code,'JUSTICE_COURT_AT_CAPACITY');
  assert.equal(game.justiceCases.length,1);
  assert.equal(game.justiceCases[0].id,originalCase.id);
  assert.equal(second.status,'unclassified');
});
