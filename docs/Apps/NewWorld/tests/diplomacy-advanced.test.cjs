const test=require('node:test');
const assert=require('node:assert/strict');
const simulation=require('../simulation.js');
const strategy=require('../strategy.js');
const diplomacy=require('../diplomacy-advanced.js');
globalThis.NewWorldSimulation=simulation;
globalThis.NewWorldStrategy=strategy;
globalThis.NewWorldDiplomacy=diplomacy;
global.window={
  NewWorldSimulation:simulation,NewWorldStrategy:strategy,
  NewWorldDiplomacy:diplomacy
};
const multiplayer=require('../multiplayer.js');
let sequence=0;
function setup() {
  const {game}=multiplayer.createInitialWorld('Diplomacy Test');
  const host=game.players[0];
  const first=game.territories[0];
  const second=game.territories[1];
  const third=game.territories[2];
  const hostMembership=game.memberships.find(item=>item.playerId===host.id&&item.status==='active');
  const foreign={
    id:'foreign-state-player',name:'Foreign Government',isHost:false,
    countryIndex:1,treasury:0,dailyBalanceRemainder:0,buildings:{},
    connected:true,token:'foreign-test-token'
  };
  game.players.push(foreign);
  game.memberships.push({
    ...structuredClone(hostMembership),id:'foreign-state-membership',
    playerId:foreign.id,stateId:second.stateId,permissionSetId:'government-member'
  });
  second.ownerPlayerId=foreign.id;
  return {game,host,foreign,first,second,third};
}
function submit(game,player,type,payload={}) {
  const member=game.memberships.find(item=>
    item.playerId===player.id&&item.status==='active'&&item.stateId===payload.stateId) ||
    game.memberships.find(item=>item.playerId===player.id&&item.status==='active');
  assert.ok(member,'an active government membership is required');
  return multiplayer.applyOrder(game,player,{
    orderId:'diplomacy-test-'+(++sequence),gameId:game.id,playerId:player.id,
    expectedWorldVersion:game.worldVersion,stateId:member.stateId,type,...payload
  });
}
function configureOrg(game,first,second) {
  const config={internationalOrganizations:[{
    id:'regional-cooperation',name:'Regional Cooperation Council',
    charter:'A test organization with a limited trade-sanctions competence.',
    memberStateIds:[first.stateId,second.stateId],
    competenceIds:['sanctions'],votingThresholdPercent:50,
    quorumStateCount:2,status:'active'
  }]};
  const result=multiplayer.applyAdmin(game,'configure',{kind:'diplomacy',configuration:config});
  assert.equal(result.ok,true,result.error);
}

test('diplomatic state is included in authoritative multiplayer snapshots',()=>{
  const {game,first,second}=setup();
  configureOrg(game,first,second);
  game.diplomaticProposals.push({
    id:'snapshot-proposal',sourceStateId:first.stateId,targetStateId:second.stateId,
    clauses:[{type:'peace'}],status:'pending'
  });
  const snapshot=multiplayer.snapshot(game);
  for(const field of ['internationalOrganizations','diplomaticProposals','treaties',
    'internationalSanctions','organizationResolutions','diplomaticConferences',
    'diplomacyHistory','diplomacyCycleDate','diplomacyCycleResult'])
    assert.ok(Object.hasOwn(snapshot,field),'snapshot is missing '+field);
  assert.deepEqual(snapshot.internationalOrganizations,game.internationalOrganizations);
  assert.deepEqual(snapshot.diplomaticProposals,game.diplomaticProposals);
});

test('new worlds extend the existing diplomatic relation store without creating a second relation graph',()=>{
  const {game}=setup();
  assert.equal(game.diplomaticRelations.length,120);
  for(const field of diplomacy.configurationFields) assert.deepEqual(game[field],[]);
  for(const field of diplomacy.dynamicFields) assert.deepEqual(game[field],[]);
});

test('structured treaty proposal is non-binding until the counterpart accepts and the next daily cycle activates it',()=>{
  const {game,host,foreign,first,second}=setup();
  assert.equal(multiplayer.applyAdmin(game,'start',{}).ok,true);
  const proposed=submit(game,host,'diplomacy.proposeTreaty',{
    stateId:first.stateId,targetStateId:second.stateId,
    clauses:[{type:'non_aggression'},{type:'trade_cooperation'}],
    durationDays:30,validForDays:10,terminationNoticeDays:5,
    negotiationText:'Both governments will keep their border peaceful.',
    visibility:'public'
  });
  assert.equal(proposed.accepted,true,proposed.error);
  assert.equal(game.treaties.length,0);
  const proposal=game.diplomaticProposals[0];
  const accepted=submit(game,foreign,'diplomacy.respondTreaty',{
    stateId:second.stateId,proposalId:proposal.id,response:'accept'
  });
  assert.equal(accepted.accepted,true,accepted.error);
  assert.equal(game.treaties.length,1);
  assert.equal(game.treaties[0].status,'scheduled');
  game.worldDate='1500-01-02';
  const cycle=diplomacy.advanceDay(game,()=> 'diplomacy-cycle-'+(++sequence));
  assert.equal(cycle.ok,true);
  assert.equal(game.treaties[0].status,'active');
  assert.equal(diplomacy.isWarProhibited(game,first.stateId,second.stateId),true);
  const war=submit(game,host,'declareWar',{
    stateId:first.stateId,targetStateId:second.stateId
  });
  assert.equal(war.accepted,false);
  assert.equal(war.code,'NON_AGGRESSION_TREATY_ACTIVE');
  assert.equal(game.diplomaticRelations.find(item=>
    item.stateAId===first.stateId&&item.stateBId===second.stateId).status,'peace');
});

test('confidential diplomacy is rejected rather than broadcast in a shared world snapshot',()=>{
  const {game,host,first,second}=setup();
  assert.equal(multiplayer.applyAdmin(game,'start',{}).ok,true);
  const result=submit(game,host,'diplomacy.proposeTreaty',{
    stateId:first.stateId,targetStateId:second.stateId,
    clauses:[{type:'peace'}],durationDays:30,validForDays:5,
    terminationNoticeDays:0,visibility:'secret'
  });
  assert.equal(result.accepted,false);
  assert.equal(result.code,'DIPLOMACY_PRIVATE_CHANNEL_UNAVAILABLE');
  assert.equal(game.diplomaticProposals.length,0);
});

test('international sanctions require member-State votes and block matching trade after scheduled entry into force',()=>{
  const {game,host,foreign,first,second,third}=setup();
  configureOrg(game,first,second);
  assert.equal(multiplayer.applyAdmin(game,'start',{}).ok,true);
  const proposed=submit(game,host,'diplomacy.proposeOrganizationResolution',{
    stateId:first.stateId,organizationId:'regional-cooperation',
    resolutionType:'trade_embargo',targetStateId:third.stateId,
    durationDays:10,exemptGoodIds:[game.goods[0].id]
  });
  assert.equal(proposed.accepted,true,proposed.error);
  const resolution=game.organizationResolutions[0];
  const firstVote=submit(game,host,'diplomacy.voteOrganizationResolution',{
    stateId:first.stateId,resolutionId:resolution.id,vote:'approve'
  });
  assert.equal(firstVote.accepted,true,firstVote.error);
  assert.equal(resolution.status,'pending');
  const secondVote=submit(game,foreign,'diplomacy.voteOrganizationResolution',{
    stateId:second.stateId,resolutionId:resolution.id,vote:'approve'
  });
  assert.equal(secondVote.accepted,true,secondVote.error);
  assert.equal(resolution.status,'adopted');
  assert.equal(game.internationalSanctions[0].status,'scheduled');
  game.worldDate='1500-01-02';
  const cycle=diplomacy.advanceDay(game,()=> 'diplomacy-cycle-'+(++sequence));
  assert.equal(cycle.ok,true);
  assert.equal(game.internationalSanctions[0].status,'active');
  assert.equal(diplomacy.tradeAllowed(game,third.stateId,first.stateId,game.goods[0].id),true);
  assert.equal(diplomacy.tradeAllowed(game,third.stateId,first.stateId,'unlisted-good'),false);
  assert.equal(diplomacy.tradeAllowed(game,first.stateId,second.stateId,'grain'),true);
  const replay=diplomacy.advanceDay(game,()=> 'diplomacy-replay-'+(++sequence));
  assert.equal(replay.replayed,true);
  assert.equal(game.internationalSanctions[0].status,'active');
});

test('pending treaty proposals expire on the day after their validity date',()=>{
  const {game,host,first,second}=setup();
  assert.equal(multiplayer.applyAdmin(game,'start',{}).ok,true);
  const proposed=submit(game,host,'diplomacy.proposeTreaty',{
    stateId:first.stateId,targetStateId:second.stateId,
    clauses:[{type:'peace'}],durationDays:30,validForDays:1,
    terminationNoticeDays:0,negotiationText:'A short-lived formal proposal.',visibility:'public'
  });
  assert.equal(proposed.accepted,true,proposed.error);
  game.worldDate='1500-01-03';
  const cycle=diplomacy.advanceDay(game,()=> 'diplomacy-expiry-'+(++sequence));
  assert.equal(cycle.ok,true);
  assert.equal(game.diplomaticProposals[0].status,'expired');
  assert.equal(game.diplomaticProposals[0].resolvedOn,'1500-01-03');
});

test('a conference requires at least two represented States and records an explicit agenda',()=>{
  const {game,host,first,second}=setup();
  assert.equal(multiplayer.applyAdmin(game,'start',{}).ok,true);
  const result=submit(game,host,'diplomacy.openConference',{
    stateId:first.stateId,participantStateIds:[first.stateId,second.stateId],
    agenda:'Discuss the border and establish a peace process.'
  });
  assert.equal(result.accepted,true,result.error);
  assert.equal(game.diplomaticConferences.length,1);
  assert.equal(game.diplomaticConferences[0].status,'open');
  const invalid=submit(game,host,'diplomacy.openConference',{
    stateId:first.stateId,participantStateIds:[first.stateId],
    agenda:'Single-party meeting'
  });
  assert.equal(invalid.accepted,false);
});