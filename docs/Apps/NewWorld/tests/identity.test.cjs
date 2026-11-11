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
const worldEvents=require('../world-events.js');
const identity=require('../identity.js');

globalThis.NewWorldBureaucracy=bureaucracy;
globalThis.NewWorldResources=resources;
globalThis.NewWorldMedia=media;
globalThis.NewWorldSecurity=security;
globalThis.NewWorldWorldEvents=worldEvents;
globalThis.NewWorldIdentity=identity;
global.window={
  NewWorldSimulation:simulation,NewWorldStrategy:strategy,
  NewWorldJustice:justice,NewWorldResources:resources,
  NewWorldBureaucracy:bureaucracy,NewWorldMedia:media,
  NewWorldSecurity:security,NewWorldWorldEvents:worldEvents,
  NewWorldIdentity:identity
};
const multiplayer=require('../multiplayer.js');
let sequence=0;

function freshWorld(){return multiplayer.createInitialWorld('Identity Test').game;}

function configure(game,options={}) {
  const territory=game.territories[0];
  const stateId=territory.stateId;
  const province=game.provinces.find(item=>item.stateId===stateId);
  const political=game.politicalSystems.find(item=>item.stateId===stateId);
  const office=political.offices.find(item=>item.holderPlayerId===game.players[0].id);
  assert.ok(office,'The host must hold an existing government office for this fixture.');
  political.laws.push({
    id:'community-development-law',title:'Community Development Act',
    status:'enacted',effectiveFrom:game.worldDate
  });
  const configuration={
    identityGroups:[{
      id:'faith-community',stateId,name:'River Faith Community',
      category:'religion',
      description:'A recognized faith community with shared institutions and charitable associations.',
      nonExclusive:true,legalStatus:'recognized'
    },{
      id:'regional-language-group',stateId,name:'Regional Language Community',
      category:'language',
      description:'Residents using a regional language in public and cultural life.',
      nonExclusive:true,legalStatus:'recognized'
    }],
    identityProfiles:[{
      id:'faith-profile-north',stateId,groupId:'faith-community',
      provinceId:province.id,populationSharePercent:20,
      recognitionPercent:70,rightsProtectionPercent:75,
      serviceAccessPercent:65,integrationPercent:50,grievancePercent:40,
      institutionalTrustPercent:60,religiousFreedomPercent:80,updatedOn:game.worldDate
    },{
      id:'language-profile-north',stateId,groupId:'regional-language-group',
      provinceId:province.id,populationSharePercent:30,
      recognitionPercent:60,rightsProtectionPercent:70,
      serviceAccessPercent:75,integrationPercent:65,grievancePercent:25,
      institutionalTrustPercent:55,religiousFreedomPercent:90,updatedOn:game.worldDate
    }],
    identityOrganizations:[{
      id:'community-support-foundation',stateId,
      groupId:'faith-community',profileId:'faith-profile-north',
      provinceId:province.id,name:'River Community Foundation',
      type:'charity',status:'active',
      programOfficeIds:[office.id],
      authorizedPrograms:['civic_dialogue','equal_access','language_access',
        'cultural_preservation','faith_charity','community_reconciliation'],
      mandateLawId:'community-development-law',
      costPerStrength:100,dailyStrengthCapacity:options.dailyCapacity??5,
      effectivenessPercent:100,transparencyPercent:100
    }]
  };
  const valid=identity.validateConfiguration(game,configuration);
  assert.equal(valid.ok,true,valid.error);
  const saved=multiplayer.applyAdmin(game,'configure',{kind:'identity',configuration});
  assert.equal(saved.ok,true,saved.error);
  return {territory,province,political,office,configuration};
}

function start(game) {
  const result=multiplayer.applyAdmin(game,'start',{});
  assert.equal(result.ok,true,result.error);
}

function send(game,player,payload={}) {
  const stateId=payload.stateId||game.territories[0].stateId;
  return multiplayer.applyOrder(game,player,{
    orderId:'identity-test-'+(++sequence),
    gameId:game.id,playerId:player.id,
    expectedWorldVersion:game.worldVersion,stateId,
    type:'identity.fundCommunityProgram',...payload
  });
}

test('new worlds contain no fabricated communities, identity profiles, organizations or programs',()=>{
  const game=freshWorld();
  for(const field of [...identity.configurationFields,...identity.dynamicFields])
    assert.deepEqual(game[field],[],field+' must be empty until scenario setup');
});

test('identity configuration rejects unknown provinces, missing laws, offices and invalid social indicators',()=>{
  const game=freshWorld();
  const {territory}=configure(game);
  const configuration=Object.fromEntries(identity.configurationFields.map(field=>
    [field,structuredClone(game[field])]));
  const wrongProvince=structuredClone(configuration);
  wrongProvince.identityProfiles[0].provinceId='unknown-province';
  assert.match(identity.validateConfiguration(game,wrongProvince).error,/real group and province/i);

  const missingLaw=structuredClone(configuration);
  missingLaw.identityOrganizations[0].mandateLawId='unknown-law';
  assert.match(identity.validateConfiguration(game,missingLaw).error,/active legal mandate/i);

  const wrongOffice=structuredClone(configuration);
  wrongOffice.identityOrganizations[0].programOfficeIds=['unknown-office'];
  assert.match(identity.validateConfiguration(game,wrongOffice).error,/active legal mandate/i);

  const invalidIndicator=structuredClone(configuration);
  invalidIndicator.identityProfiles[0].grievancePercent=120;
  assert.match(identity.validateConfiguration(game,invalidIndicator).error,/bounded demographic, rights and social indicators/i);
  assert.ok(territory.stateId);
});

test('non-exclusive groups can overlap but exclusive identity shares cannot exceed the provincial population',()=>{
  const game=freshWorld();
  const {configuration}=configure(game);
  assert.equal(identity.validateConfiguration(game,configuration).ok,true);
  const exclusive=structuredClone(configuration);
  exclusive.identityGroups.forEach(item=>item.nonExclusive=false);
  exclusive.identityGroups[1].category='religion';
  exclusive.identityProfiles[0].populationSharePercent=70;
  exclusive.identityProfiles[1].populationSharePercent=60;
  const result=identity.validateConfiguration(game,exclusive);
  assert.equal(result.ok,false);
  assert.match(result.error,/exclusive groups/i);
});

test('social cohesion is a weighted State indicator built only from configured aggregated profiles',()=>{
  const game=freshWorld();
  const {territory}=configure(game);
  const result=identity.calculateCohesion(game,territory.stateId);
  assert.equal(result.groupCount,2);
  assert.equal(result.coveredPopulationSharePercent,50);
  assert.equal(result.averageRightsProtectionPercent,72);
  assert.equal(result.averageServiceAccessPercent,71);
  assert.equal(result.averageIntegrationPercent,59);
  assert.equal(result.averageGrievancePercent,31);
  assert.equal(result.averageInstitutionalTrustPercent,57);
  assert.equal(result.serviceInequalityPercent,10);
  assert.equal(result.cohesionIndex,66.6);
  assert.equal(result.polarizationIndex,23.65);
  assert.equal(identity.calculateCohesion(game,'nonexistent-state'),null);
});

test('only an authorized office can fund a community programme under the active legal mandate',()=>{
  const game=freshWorld();
  const {territory,province}=configure(game);
  start(game);
  const observer={id:'identity-observer',name:'Observer',connected:true,token:'identity-observer-token'};
  game.players.push(observer);
  game.memberships.push({
    id:'identity-observer-membership',gameId:game.id,
    playerId:observer.id,stateId:territory.stateId,
    status:'active',permissionSetId:'government-member'
  });
  const denied=send(game,observer,{
    stateId:territory.stateId,organizationId:'community-support-foundation',
    profileId:'faith-profile-north',program:'civic_dialogue',strength:2
  });
  assert.equal(denied.accepted,false);
  assert.equal(denied.code,'IDENTITY_PROGRAM_AUTHORITY_REQUIRED');
  assert.equal(game.communityPrograms.length,0);
  assert.ok(province.id);
});

test('funding a programme deducts its real treasury cost and changes only the selected aggregate profile',()=>{
  const game=freshWorld();
  const {territory}=configure(game);
  start(game);
  const beforeTreasury=territory.treasury;
  const beforeFaith=structuredClone(game.identityProfiles[0]);
  const beforeLanguage=structuredClone(game.identityProfiles[1]);
  const result=send(game,game.players[0],{
    stateId:territory.stateId,organizationId:'community-support-foundation',
    profileId:'faith-profile-north',program:'civic_dialogue',strength:2
  });
  assert.equal(result.accepted,true,result.error);
  assert.equal(territory.treasury,beforeTreasury-200);
  const updatedFaith=game.identityProfiles.find(item=>item.id==='faith-profile-north');
  const unchangedLanguage=game.identityProfiles.find(item=>item.id==='language-profile-north');
  assert.equal(updatedFaith.grievancePercent,beforeFaith.grievancePercent-3);
  assert.equal(updatedFaith.integrationPercent,beforeFaith.integrationPercent+2);
  assert.equal(updatedFaith.institutionalTrustPercent,beforeFaith.institutionalTrustPercent);
  assert.deepEqual(unchangedLanguage,beforeLanguage);
  assert.equal(game.communityPrograms.length,1);
  assert.ok(game.identityHistory.some(item=>item.type==='community_program_funded'));
});

test('daily programme strength capacity is enforced without spending twice',()=>{
  const game=freshWorld();
  const {territory}=configure(game,{dailyCapacity:2});
  start(game);
  const payload={
    stateId:territory.stateId,organizationId:'community-support-foundation',
    profileId:'faith-profile-north',program:'equal_access',strength:2
  };
  const first=send(game,game.players[0],payload);
  assert.equal(first.accepted,true,first.error);
  const treasury=territory.treasury;
  const second=send(game,game.players[0],{...payload,strength:1});
  assert.equal(second.accepted,false);
  assert.equal(second.code,'IDENTITY_PROGRAM_DAILY_CAPACITY');
  assert.equal(territory.treasury,treasury);
  assert.equal(game.communityPrograms.length,1);
});

test('an unsupported programme, repealed mandate or insufficient treasury cannot partially update the profile',()=>{
  const game=freshWorld();
  const {territory,political}=configure(game);
  start(game);
  const before=structuredClone(game.identityProfiles[0]);
  const unsupported=send(game,game.players[0],{
    stateId:territory.stateId,organizationId:'community-support-foundation',
    profileId:'faith-profile-north',program:'unlawful-surveillance',strength:2
  });
  assert.equal(unsupported.accepted,false);
  assert.equal(unsupported.code,'IDENTITY_PROGRAM_INVALID');
  assert.deepEqual(game.identityProfiles[0],before);

  political.laws.find(item=>item.id==='community-development-law').status='repealed';
  const repealed=send(game,game.players[0],{
    stateId:territory.stateId,organizationId:'community-support-foundation',
    profileId:'faith-profile-north',program:'civic_dialogue',strength:1
  });
  assert.equal(repealed.accepted,false);
  assert.equal(repealed.code,'IDENTITY_PROGRAM_LEGAL_BASIS_INVALID');
  assert.deepEqual(game.identityProfiles[0],before);
  political.laws.find(item=>item.id==='community-development-law').status='enacted';

  territory.treasury=0;
  const noFunds=send(game,game.players[0],{
    stateId:territory.stateId,organizationId:'community-support-foundation',
    profileId:'faith-profile-north',program:'civic_dialogue',strength:1
  });
  assert.equal(noFunds.accepted,false);
  assert.equal(noFunds.code,'IDENTITY_PROGRAM_BUDGET_INSUFFICIENT');
  assert.deepEqual(game.identityProfiles[0],before);
  assert.equal(game.communityPrograms.length,0);
});

test('daily social-cohesion snapshots are stored once per State and world date and included in multiplayer snapshots',()=>{
  const game=freshWorld();
  const {territory}=configure(game);
  const id=()=> 'cohesion-snapshot-'+(++sequence);
  const first=identity.advanceDay(game,id);
  assert.equal(first.ok,true);
  assert.equal(game.socialCohesionHistory.length,1);
  const second=identity.advanceDay(game,id);
  assert.equal(second.ok,true);
  assert.equal(game.socialCohesionHistory.length,1);
  const snapshot=multiplayer.snapshot(game);
  assert.equal(snapshot.socialCohesionHistory.length,1);
  assert.equal(snapshot.identityGroups.length,2);
  assert.equal(snapshot.identityProfiles.length,2);
  assert.equal(snapshot.identityOrganizations.length,1);
  assert.ok(territory.stateId);
});
