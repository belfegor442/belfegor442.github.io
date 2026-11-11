'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const simulation=require('../simulation.js');
const strategy=require('../strategy.js');
const justice=require('../justice.js');
const resources=require('../resources.js');
const bureaucracy=require('../bureaucracy.js');
const media=require('../media.js');

globalThis.NewWorldBureaucracy=bureaucracy;
globalThis.NewWorldResources=resources;
globalThis.NewWorldMedia=media;
global.window={
  NewWorldSimulation:simulation,NewWorldStrategy:strategy,
  NewWorldJustice:justice,NewWorldResources:resources,
  NewWorldBureaucracy:bureaucracy,NewWorldMedia:media
};
const multiplayer=require('../multiplayer.js');
let sequence=0;

function freshWorld() {
  return multiplayer.createInitialWorld('Media Test').game;
}

function configure(game,options={}) {
  const territory=game.territories[0];
  const stateId=territory.stateId;
  const province=game.provinces.find(item=>item.stateId===stateId);
  const political=game.politicalSystems.find(item=>item.stateId===stateId);
  const host=game.players[0];
  const topicId='public-works';
  if(options.censorship) {
    political.laws.push({
      id:'media-restriction-law',title:'Media Restriction Act',
      status:'enacted',effectiveFrom:game.worldDate,
      mediaRestrictionAuthorized:true
    });
  }
  const configuration={
    mediaOutlets:[{
      id:'city-observer',stateId,name:'City Observer',
      ownershipType:'independent',editorialLine:'independent',
      provinceIds:[province.id],editorPlayerIds:[host.id],
      reachPercent:80,credibilityPercent:90,independencePercent:100,
      dailyPublicationCapacity:options.dailyCapacity??5,
      topicIds:[topicId]
    }],
    publicOpinionProfiles:[{
      id:'opinion-public-works',stateId,topicId,
      issueTitle:'Public works programme',
      supportPercent:50,governmentTrustPercent:55,pressTrustPercent:60,
      importancePercent:100,populationEstimate:10000,updatedOn:game.worldDate
    }],
    mediaRules:game.territories.map(item=>({
      id:'media-rules-'+item.stateId,stateId:item.stateId,
      pressFreedomPercent:100,dailyPublicationCapacity:5,
      pollTransparencyPercent:90,
      censorshipOfficeIds:item.stateId===stateId && options.censorship
        ? ['chief-executive'] : [],
      censorshipLawIds:item.stateId===stateId && options.censorship
        ? ['media-restriction-law'] : []
    }))
  };
  const validation=media.validateConfiguration(game,configuration);
  assert.equal(validation.ok,true,validation.error);
  const saved=multiplayer.applyAdmin(game,'configure',{kind:'media',configuration});
  assert.equal(saved.ok,true,saved.error);
  return {territory,province,political,host,topicId};
}

function start(game) {
  const result=multiplayer.applyAdmin(game,'start',{});
  assert.equal(result.ok,true,result.error);
}

function send(game,player,type,payload={}) {
  const stateId=payload.stateId || game.territories[0].stateId;
  const membership=game.memberships.find(item=>
    item.playerId===player.id && item.stateId===stateId && item.status==='active');
  assert.ok(membership,'An active membership in the media State is required.');
  return multiplayer.applyOrder(game,player,{
    orderId:'media-test-'+(++sequence),gameId:game.id,playerId:player.id,
    expectedWorldVersion:game.worldVersion,stateId,type,...payload
  });
}

function publish(game,player,options={}) {
  return send(game,player,'media.publishArticle',{
    stateId:game.territories[0].stateId,outletId:'city-observer',
    topicId:'public-works',articleType:options.articleType||'news',
    title:options.title||'The provincial works programme is reviewed',
    body:options.body||'The shared world record contains a new development concerning the approved provincial works programme and its implementation.',
    stance:options.stance||'support',
    governmentPosition:options.governmentPosition||'neutral',
    sourceEventIds:options.sourceEventIds||[]
  });
}

test('new worlds have empty media and opinion arrays and no fabricated outlets or polls',()=>{
  const game=freshWorld();
  for(const field of [...media.configurationFields,...media.dynamicFields])
    assert.deepEqual(game[field],[],field+' must start empty');
  assert.equal(game.territories.length,16);
});

test('configuration rejects invalid territorial coverage, editor membership and censorship authority',()=>{
  const game=freshWorld();
  const territory=game.territories[0];
  const province=game.provinces.find(item=>item.stateId===territory.stateId);
  const political=game.politicalSystems.find(item=>item.stateId===territory.stateId);
  const host=game.players[0];
  const configuration={
    mediaOutlets:[{
      id:'invalid-outlet',stateId:territory.stateId,name:'Invalid Outlet',
      ownershipType:'private',editorialLine:'independent',
      ownerCompanyId:'unknown-company',provinceIds:[province.id],
      editorPlayerIds:[host.id],reachPercent:50,credibilityPercent:50,
      independencePercent:50,dailyPublicationCapacity:1,topicIds:['topic']
    }],
    publicOpinionProfiles:[{
      id:'profile',stateId:territory.stateId,topicId:'topic',issueTitle:'A public issue',
      supportPercent:50,governmentTrustPercent:50,pressTrustPercent:50,
      importancePercent:50,populationEstimate:1000,updatedOn:game.worldDate
    }],
    mediaRules:game.territories.map(item=>({
      id:'rule-'+item.stateId,stateId:item.stateId,pressFreedomPercent:100,
      dailyPublicationCapacity:5,pollTransparencyPercent:90,
      censorshipOfficeIds:[],censorshipLawIds:[]
    }))
  };
  const invalidPrivate=media.validateConfiguration(game,configuration);
  assert.equal(invalidPrivate.ok,false);
  assert.match(invalidPrivate.error,/private media outlet must reference a real company/i);

  const badProvince=structuredClone(configuration);
  badProvince.mediaOutlets[0].ownershipType='independent';
  delete badProvince.mediaOutlets[0].ownerCompanyId;
  badProvince.mediaOutlets[0].provinceIds=['unknown-province'];
  assert.match(media.validateConfiguration(game,badProvince).error,/real coverage/i);

  const badEditor=structuredClone(configuration);
  badEditor.mediaOutlets[0].ownershipType='independent';
  badEditor.mediaOutlets[0].provinceIds=[province.id];
  badEditor.mediaOutlets[0].editorPlayerIds=['not-a-player'];
  assert.match(media.validateConfiguration(game,badEditor).error,/real coverage/i);

  const missingLaw=structuredClone(configuration);
  missingLaw.mediaOutlets[0].ownershipType='independent';
  missingLaw.mediaOutlets[0].ownerCompanyId=undefined;
  missingLaw.mediaOutlets[0].provinceIds=[province.id];
  missingLaw.mediaOutlets[0].editorPlayerIds=[host.id];
  missingLaw.mediaRules[0].censorshipOfficeIds=['chief-executive'];
  missingLaw.mediaRules[0].censorshipLawIds=['unapproved-law'];
  assert.match(media.validateConfiguration(game,missingLaw).error,/existing law that explicitly authorizes/i);
  assert.ok(political);
});

test('news reports require existing local event references and editor authorization',()=>{
  const game=freshWorld();
  const {host,territory}=configure(game);
  start(game);
  const noSource=publish(game,host);
  assert.equal(noSource.accepted,false);
  assert.equal(noSource.code,'MEDIA_SOURCE_REQUIRED');

  const event={
    id:'verified-local-event',stateId:territory.stateId,gameId:game.id,
    type:'construction.completed',worldDate:game.worldDate,
    description:'A construction milestone was recorded in the shared world log.'
  };
  game.events.push(event);
  const accepted=publish(game,host,{sourceEventIds:[event.id]});
  assert.equal(accepted.accepted,true,accepted.error);
  assert.equal(game.mediaArticles.length,1);
  assert.deepEqual(game.mediaArticles[0].sourceEventIds,[event.id]);

  const observer={id:'media-observer',name:'Observer',connected:true,token:'media-observer-token'};
  game.players.push(observer);
  game.memberships.push({
    id:'media-observer-membership',gameId:game.id,playerId:observer.id,
    stateId:territory.stateId,status:'active',permissionSetId:'government-member'
  });
  const unauthorized=publish(game,observer,{articleType:'editorial'});
  assert.equal(unauthorized.accepted,false);
  assert.equal(unauthorized.code,'MEDIA_EDITOR_AUTHORITY_REQUIRED');
});

test('editorials are labelled as opinion and cannot be represented as sourced news',()=>{
  const game=freshWorld();
  const {host}=configure(game);
  start(game);
  const editorial=publish(game,host,{articleType:'editorial'});
  assert.equal(editorial.accepted,true,editorial.error);
  assert.equal(game.mediaArticles[0].articleType,'editorial');
  assert.deepEqual(game.mediaArticles[0].sourceEventIds,[]);
  assert.equal(game.mediaArticles[0].status,'published');
});

test('publication capacity is enforced per outlet and world date',()=>{
  const game=freshWorld();
  const {host,territory}=configure(game,{dailyCapacity:1});
  start(game);
  const event={id:'daily-event',stateId:territory.stateId,description:'Daily event'};
  game.events.push(event);
  const first=publish(game,host,{sourceEventIds:[event.id]});
  assert.equal(first.accepted,true,first.error);
  const second=publish(game,host,{sourceEventIds:[event.id]});
  assert.equal(second.accepted,false);
  assert.equal(second.code,'MEDIA_DAILY_CAPACITY');
  assert.equal(game.mediaArticles.length,1);
});

test('polls preserve sample counts, expose an approximate margin of error and update a topic baseline transparently',()=>{
  const game=freshWorld();
  const {host,territory}=configure(game);
  start(game);
  const poll=send(game,host,'media.submitPoll',{
    stateId:territory.stateId,outletId:'city-observer',topicId:'public-works',
    supportResponses:81,opposeResponses:9,undecidedResponses:10
  });
  assert.equal(poll.accepted,true,poll.error);
  assert.equal(game.opinionPolls.length,1);
  assert.equal(game.opinionPolls[0].sampleSize,100);
  assert.equal(game.opinionPolls[0].supportPercent,81);
  assert.equal(game.opinionPolls[0].confidenceMarginPercent,9.8);
  assert.equal(game.publicOpinionProfiles[0].supportPercent,50.31);
  assert.equal(game.publicOpinionHistory[0].previousSupportPercent,50);
  assert.equal(game.publicOpinionHistory[0].reportedSupportPercent,81);
});

test('poll samples must be valid, non-empty and bounded by the configured population estimate',()=>{
  const game=freshWorld();
  const {host,territory}=configure(game);
  start(game);
  const tooSmall=send(game,host,'media.submitPoll',{
    stateId:territory.stateId,outletId:'city-observer',topicId:'public-works',
    supportResponses:10,opposeResponses:10,undecidedResponses:5
  });
  assert.equal(tooSmall.accepted,false);
  assert.equal(tooSmall.code,'MEDIA_POLL_INVALID');
  const tooLarge=send(game,host,'media.submitPoll',{
    stateId:territory.stateId,outletId:'city-observer',topicId:'public-works',
    supportResponses:6000,opposeResponses:3000,undecidedResponses:1000
  });
  assert.equal(tooLarge.accepted,false);
  assert.equal(tooLarge.code,'MEDIA_POLL_INVALID');
});

test('publication influence is bounded by reach, credibility, independence, topic importance and press freedom',()=>{
  const game=freshWorld();
  const {host,territory}=configure(game);
  start(game);
  const event={id:'opinion-event',stateId:territory.stateId,description:'Verified public event'};
  game.events.push(event);
  const result=publish(game,host,{sourceEventIds:[event.id],stance:'support',governmentPosition:'support'});
  assert.equal(result.accepted,true,result.error);
  const profile=game.publicOpinionProfiles[0];
  assert.equal(profile.supportPercent,52.16);
  assert.equal(profile.governmentTrustPercent,55.54);
  assert.ok(profile.pressTrustPercent>60);
});

test('media restrictions require an active authorizing law and a configured public office and preserve the censored article record',()=>{
  const game=freshWorld();
  const {host,territory,political}=configure(game,{censorship:true});
  start(game);
  const event={id:'reportable-event',stateId:territory.stateId,description:'Verified event for the report'};
  game.events.push(event);
  const article=publish(game,host,{sourceEventIds:[event.id]});
  assert.equal(article.accepted,true,article.error);
  const result=send(game,host,'media.restrictArticle',{
    stateId:territory.stateId,articleId:game.mediaArticles[0].id,
    lawId:'media-restriction-law',
    reason:'The publication violates the expressly configured statutory restriction.',
    severityPercent:20
  });
  assert.equal(result.accepted,true,result.error);
  assert.equal(game.mediaArticles[0].status,'restricted');
  assert.equal(game.mediaArticles[0].censored,true);
  assert.equal(game.mediaRules[0].pressFreedomPercent,98);
  assert.equal(game.censorshipOrders.length,1);
  assert.ok(game.mediaHistory.some(item=>item.type==='article_restricted'));
  assert.ok(political.laws.some(item=>item.mediaRestrictionAuthorized===true));
});

test('media restrictions cannot be issued solely because a player holds a government office',()=>{
  const game=freshWorld();
  const {host,territory}=configure(game,{censorship:false});
  start(game);
  const event={id:'another-reportable-event',stateId:territory.stateId,description:'Another verified event'};
  game.events.push(event);
  const article=publish(game,host,{sourceEventIds:[event.id]});
  assert.equal(article.accepted,true,article.error);
  const result=send(game,host,'media.restrictArticle',{
    stateId:territory.stateId,articleId:game.mediaArticles[0].id,
    lawId:'any-law',reason:'A written reason that is not legally authorized.',severityPercent:30
  });
  assert.equal(result.accepted,false);
  assert.equal(result.code,'MEDIA_CENSORSHIP_UNAUTHORISED');
  assert.equal(game.mediaArticles[0].status,'published');
  assert.equal(game.censorshipOrders.length,0);
});

test('old news articles are archived after the configured fourteen-day active period',()=>{
  const game=freshWorld();
  const {host,territory}=configure(game);
  start(game);
  const event={id:'archive-event',stateId:territory.stateId,description:'An event that was published'};
  game.events.push(event);
  const article=publish(game,host,{sourceEventIds:[event.id]});
  assert.equal(article.accepted,true,article.error);
  game.worldDate='1500-01-16';
  const result=media.advanceDay(game);
  assert.equal(result.ok,true);
  assert.equal(game.mediaArticles[0].status,'archived');
});


test('an outlet cannot register more than one poll in the same world day',()=>{
  const game=freshWorld();
  const {host,territory}=configure(game);
  start(game);
  const payload={
    stateId:territory.stateId,outletId:'city-observer',topicId:'public-works',
    supportResponses:50,opposeResponses:40,undecidedResponses:10
  };
  const first=send(game,host,'media.submitPoll',payload);
  assert.equal(first.accepted,true,first.error);
  const second=send(game,host,'media.submitPoll',payload);
  assert.equal(second.accepted,false);
  assert.equal(second.code,'MEDIA_DAILY_POLL_CAPACITY');
  assert.equal(game.opinionPolls.length,1);
  assert.equal(game.publicOpinionHistory.length,1);
});
