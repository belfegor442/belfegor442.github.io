(() => {
  'use strict';

  const CONFIG_FIELDS=Object.freeze(['mediaOutlets','publicOpinionProfiles','mediaRules']);
  const DYNAMIC_FIELDS=Object.freeze([
    'mediaArticles','opinionPolls','censorshipOrders','mediaHistory','mediaBroadcasts',
    'publicOpinionHistory'
  ]);
  const ownershipTypes=new Set(['public','private','independent','party','community']);
  const editorialLines=new Set(['independent','government','opposition','commercial','party','community']);
  const articleTypes=new Set(['news','editorial','analysis','notice']);
  const stances=new Set(['support','oppose','neutral']);
  const cleanText=(value,min=2,max=1800)=>typeof value==='string' &&
    value.trim().length>=min && value.length<=max && !/[<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
  const numberIn=(value,min,max)=>Number.isFinite(value) && value>=min && value<=max;
  const intIn=(value,min,max)=>Number.isSafeInteger(value) && value>=min && value<=max;
  const roundPercent=value=>Math.round((value+Number.EPSILON)*100)/100;
  const idOk=value=>typeof value==='string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{1,99}$/.test(value);
  const unique=items=>Array.isArray(items) && items.every(item=>idOk(item?.id)) &&
    new Set(items.map(item=>item.id)).size===items.length;
  const clone=value=>structuredClone(value);

  function ensure(game) {
    if(!game || !Array.isArray(game.territories)) return game;
    for(const key of [...CONFIG_FIELDS,...DYNAMIC_FIELDS])
      if(!Array.isArray(game[key])) game[key]=[];
    return game;
  }

  function validateConfiguration(game,configuration) {
    if(!configuration || CONFIG_FIELDS.some(key=>!Array.isArray(configuration[key])))
      return {ok:false,error:'Media setup requires outlet, opinion profile and media rule arrays.'};
    for(const key of CONFIG_FIELDS)
      if(!unique(configuration[key]))
        return {ok:false,error:'IDs in '+key+' must be unique and stable.'};
    const states=new Map((game.territories||[]).map(item=>[item.stateId,item]));
    const provinces=new Map((game.provinces||[]).map(item=>[item.id,item.stateId]));
    const companies=new Set((game.companies||[]).map(item=>item.id));
    const players=new Map((game.players||[]).map(item=>[item.id,item]));
    const political=new Map((game.politicalSystems||[]).map(item=>[item.stateId,item]));
    const profileKey=(stateId,topicId)=>stateId+'::'+topicId;
    const profiles=new Map(configuration.publicOpinionProfiles.map(item=>[profileKey(item.stateId,item.topicId),item]));
    const outlets=new Map(configuration.mediaOutlets.map(item=>[item.id,item]));

    const seenProfileKeys=new Set();
    for(const profile of configuration.publicOpinionProfiles) {
      const key=profile.stateId+'::'+profile.topicId;
      if(seenProfileKeys.has(key))
        return {ok:false,error:'A State cannot define the same public-opinion topic more than once.'};
      seenProfileKeys.add(key);
      if(!states.has(profile.stateId) || !idOk(profile.topicId) ||
         !cleanText(profile.issueTitle,3,160) ||
         !numberIn(profile.supportPercent,0,100) ||
         !numberIn(profile.governmentTrustPercent,0,100) ||
         !numberIn(profile.pressTrustPercent,0,100) ||
         !numberIn(profile.importancePercent,0,100) ||
         !intIn(profile.populationEstimate,1,Number.MAX_SAFE_INTEGER) ||
         !validDate(profile.updatedOn))
        return {ok:false,error:'An opinion profile needs a real State, topic, baseline percentages, population estimate and date.'};
    }

    const rulesByState=new Map();
    for(const rule of configuration.mediaRules) {
      const offices=new Set((political.get(rule.stateId)?.offices||[]).map(item=>item.id));
      if(!states.has(rule.stateId) || rulesByState.has(rule.stateId) ||
         !numberIn(rule.pressFreedomPercent,0,100) ||
         !intIn(rule.dailyPublicationCapacity,1,10000) ||
         !numberIn(rule.pollTransparencyPercent,0,100) ||
         !Array.isArray(rule.censorshipOfficeIds) ||
         rule.censorshipOfficeIds.some(id=>!offices.has(id)) ||
         !Array.isArray(rule.censorshipLawIds))
        return {ok:false,error:'Media rules need a valid State, press freedom, publication capacity, poll transparency and existing censorship offices.'};
      for(const lawId of rule.censorshipLawIds) {
        const law=political.get(rule.stateId)?.laws?.find(item=>item.id===lawId);
        if(!law || law.mediaRestrictionAuthorized!==true)
          return {ok:false,error:'A censorship rule must reference an existing law that explicitly authorizes media restrictions.'};
      }
      rulesByState.set(rule.stateId,rule);
    }
    for(const stateId of states.keys())
      if(!rulesByState.has(stateId))
        return {ok:false,error:'Provide one explicit media and press-freedom rule for every configured State.'};

    for(const outlet of configuration.mediaOutlets) {
      const rules=rulesByState.get(outlet.stateId);
      if(!states.has(outlet.stateId) || !cleanText(outlet.name,2,120) ||
         !ownershipTypes.has(outlet.ownershipType) ||
         !editorialLines.has(outlet.editorialLine) ||
         !Array.isArray(outlet.provinceIds) || !outlet.provinceIds.length ||
         outlet.provinceIds.some(id=>provinces.get(id)!==outlet.stateId) ||
         !Array.isArray(outlet.editorPlayerIds) || !outlet.editorPlayerIds.length ||
         outlet.editorPlayerIds.some(id=>!players.has(id)) ||
         !numberIn(outlet.reachPercent,0,100) ||
         !numberIn(outlet.credibilityPercent,0,100) ||
         !numberIn(outlet.independencePercent,0,100) ||
         !intIn(outlet.dailyPublicationCapacity,1,10000) ||
         !Array.isArray(outlet.topicIds) || !outlet.topicIds.length ||
         new Set(outlet.topicIds).size!==outlet.topicIds.length ||
         outlet.topicIds.some(id=>!profiles.has(profileKey(outlet.stateId,id))))
        return {ok:false,error:'A media outlet needs real coverage, editors, ownership, editorial line, topic access, reach, credibility and independence values.'};
      for(const playerId of outlet.editorPlayerIds)
        if(!(game.memberships||[]).some(item=>
          item.playerId===playerId && item.stateId===outlet.stateId && item.status==='active'))
          return {ok:false,error:'Every registered editor must be an active member of the outlet State.'};
      if(outlet.ownershipType==='private' &&
         (!outlet.ownerCompanyId || !companies.has(outlet.ownerCompanyId) ||
          !game.companies.some(item=>item.id===outlet.ownerCompanyId && item.stateId===outlet.stateId)))
        return {ok:false,error:'A private media outlet must reference a real company in the same State.'};
      if(outlet.ownershipType==='party' &&
         !political.get(outlet.stateId)?.parties?.some(item=>item.id===outlet.ownerPartyId))
        return {ok:false,error:'A party-owned outlet must reference an existing political party.'};
    }
    for(const rule of configuration.mediaRules)
      if(rule.censorshipLawIds.length && !rule.censorshipOfficeIds.length)
        return {ok:false,error:'A State with censorship laws must configure explicit offices authorized to issue restrictions.'};
    return {ok:true,error:null};
  }

  function record(game,type,stateId,description,details={},createId) {
    const sequence=(Number(game.eventSequence)||0)+1;
    game.eventSequence=sequence;
    const entry={
      id:createId(),type,stateId,description,details:clone(details),
      worldDate:game.worldDate,worldVersion:(Number(game.worldVersion)||0)+1,sequence
    };
    game.mediaHistory.push(entry);
    if(game.mediaHistory.length>3000)
      game.mediaHistory.splice(0,game.mediaHistory.length-3000);
    game.events ||= [];
    game.events.push({
      ...entry,id:createId(),gameId:game.id,orderId:null,
      type:'media.'+type,resultCode:null,occurredAtUtc:new Date().toISOString()
    });
    if(game.events.length>1000) game.events.splice(0,game.events.length-1000);
    game.activity ||= [];
    game.activity.unshift(description);
    game.activity=game.activity.slice(0,100);
    return entry;
  }

  function getRule(game,stateId) {
    return game.mediaRules.find(item=>item.stateId===stateId);
  }

  function updateOpinion(game,profile,article,venue) {
    if(!profile || article.stance==='neutral') return null;
    const reach=Number(venue.reachPercent)/100;
    const credibility=Number(venue.credibilityPercent)/100;
    const independence=Number(venue.independencePercent)/100;
    const importance=Number(profile.importancePercent)/100;
    const pressFreedom=Number(getRule(game,venue.stateId)?.pressFreedomPercent||0)/100;
    const impact=Math.min(3,3*reach*credibility*independence*importance*pressFreedom);
    const direction=article.stance==='support'?1:-1;
    profile.supportPercent=roundPercent(Math.max(0,Math.min(100,profile.supportPercent+direction*impact)));
    if(article.governmentPosition==='support')
      profile.governmentTrustPercent=roundPercent(Math.max(0,Math.min(100,
        profile.governmentTrustPercent+impact*.25)));
    else if(article.governmentPosition==='critical')
      profile.governmentTrustPercent=roundPercent(Math.max(0,Math.min(100,
        profile.governmentTrustPercent-impact*.25)));
    profile.pressTrustPercent=roundPercent(Math.max(0,Math.min(100,
      profile.pressTrustPercent+(article.sourceEventIds.length?0.12:-0.08)*credibility)));
    profile.updatedOn=game.worldDate;
    return impact;
  }

  function applyOrder(game,player,membership,order,createId) {
    if(!String(order?.type||'').startsWith('media.')) return null;
    ensure(game);
    const stateId=membership?.stateId;
    const rule=getRule(game,stateId);
    if(!rule)
      return {ok:false,code:'MEDIA_SYSTEM_NOT_CONFIGURED',error:'This State has no configured media and public-opinion system.'};

    if(order.type==='media.publishArticle') {
      const outlet=game.mediaOutlets.find(item=>item.id===order.outletId && item.stateId===stateId);
      if(!outlet || !outlet.editorPlayerIds.includes(player.id))
        return {ok:false,code:'MEDIA_EDITOR_AUTHORITY_REQUIRED',error:'The player is not a registered editor for this outlet.'};
      const type=order.articleType;
      if(!articleTypes.has(type))
        return {ok:false,code:'MEDIA_ARTICLE_TYPE_INVALID',error:'Choose a supported, clearly labelled article type.'};
      const title=String(order.title||'').trim();
      const body=String(order.body||'').trim();
      if(!cleanText(title,4,160) || !cleanText(body,40,1800))
        return {ok:false,code:'MEDIA_ARTICLE_INVALID',error:'An article needs a title of 4–160 characters and body of 40–1,800 characters.'};
      const topicId=order.topicId;
      if(!outlet.topicIds.includes(topicId) ||
         !game.publicOpinionProfiles.some(item=>item.stateId===stateId && item.topicId===topicId))
        return {ok:false,code:'MEDIA_TOPIC_UNAVAILABLE',error:'The outlet is not configured to cover this topic.'};
      if(!stances.has(order.stance) ||
         !['support','critical','neutral'].includes(order.governmentPosition))
        return {ok:false,code:'MEDIA_POSITION_INVALID',error:'Choose a valid position for the topic and government.'};
      const sources=Array.isArray(order.sourceEventIds)?[...new Set(order.sourceEventIds)]:[];
      if(type==='news' && sources.length===0)
        return {ok:false,code:'MEDIA_SOURCE_REQUIRED',error:'A news report must reference at least one event from the shared world record.'};
      const validSources=sources.filter(id=>game.events.some(event=>
        event.id===id && event.stateId===stateId));
      if(validSources.length!==sources.length)
        return {ok:false,code:'MEDIA_SOURCE_INVALID',error:'Every cited source must exist in this State event record.'};
      const publishedToday=game.mediaArticles.filter(item=>
        item.outletId===outlet.id && item.publishedOn===game.worldDate).length;
      if(publishedToday>=Math.min(outlet.dailyPublicationCapacity,rule.dailyPublicationCapacity))
        return {ok:false,code:'MEDIA_DAILY_CAPACITY',error:'This outlet has reached its configured daily publication capacity.'};
      const article={
        id:createId(),stateId,outletId:outlet.id,title,body,articleType:type,
        topicId,stance:order.stance,governmentPosition:order.governmentPosition,
        sourceEventIds:sources,authorPlayerId:player.id,publishedOn:game.worldDate,
        status:'published',censored:false,reachPercent:outlet.reachPercent,
        credibilityPercent:outlet.credibilityPercent,independencePercent:outlet.independencePercent
      };
      game.mediaArticles.push(article);
      if(game.mediaArticles.length>1000) game.mediaArticles.splice(0,game.mediaArticles.length-1000);
      const opinion=game.publicOpinionProfiles.find(item=>
        item.stateId===stateId && item.topicId===topicId);
      const impact=updateOpinion(game,opinion,article,outlet);
      record(game,'article_published',stateId,
        outlet.name+' published '+type+': '+title,
        {articleId:article.id,outletId:outlet.id,topicId,sourceEventIds:sources,
          impactPoints:impact},createId);
      return {ok:true,articleId:article.id};
    }

    if(order.type==='media.submitPoll') {
      const outlet=game.mediaOutlets.find(item=>item.id===order.outletId && item.stateId===stateId);
      if(!outlet || !outlet.editorPlayerIds.includes(player.id))
        return {ok:false,code:'MEDIA_POLL_AUTHORITY_REQUIRED',error:'Only a registered editor or polling desk can submit survey results.'};
      const profile=game.publicOpinionProfiles.find(item=>
        item.stateId===stateId && item.topicId===order.topicId);
      const pollsToday=game.opinionPolls.filter(item=>
        item.outletId===outlet.id && item.fieldworkOn===game.worldDate).length;
      if(pollsToday>=1)
        return {ok:false,code:'MEDIA_DAILY_POLL_CAPACITY',error:'This outlet has already submitted a poll for this topic cycle today.'};
      const yes=order.supportResponses;
      const no=order.opposeResponses;
      const undecided=order.undecidedResponses;
      const size=yes+no+undecided;
      if(!profile || !outlet.topicIds.includes(order.topicId) ||
         ![yes,no,undecided].every(value=>intIn(value,0,profile.populationEstimate)) ||
         !intIn(size,30,profile.populationEstimate-1))
        return {ok:false,code:'MEDIA_POLL_INVALID',error:'A poll needs a configured topic and at least 30 valid responses within its estimated population.'};
      const supportPercent=100*yes/size;
      const previousSupportPercent=profile.supportPercent;
      const confidenceMargin=Math.min(100,98/Math.sqrt(size));
      const poll={
        id:createId(),stateId,outletId:outlet.id,topicId:order.topicId,
        sampleSize:size,supportResponses:yes,opposeResponses:no,
        undecidedResponses:undecided,supportPercent,
        confidenceMarginPercent:confidenceMargin,
        pollTransparencyPercent:rule.pollTransparencyPercent,
        method:'reported aggregate responses; no synthetic respondents',
        fieldworkOn:game.worldDate,submittedByPlayerId:player.id
      };
      game.opinionPolls.push(poll);
      const weight=Math.min(.25,size/profile.populationEstimate);
      profile.supportPercent=roundPercent(profile.supportPercent*(1-weight)+supportPercent*weight);
      profile.updatedOn=game.worldDate;
      game.publicOpinionHistory.push({
        id:createId(),stateId,topicId:profile.topicId,source:'poll',
        pollId:poll.id,previousSupportPercent,
        reportedSupportPercent:supportPercent,updatedOn:game.worldDate
      });
      record(game,'poll_submitted',stateId,
        outlet.name+' submitted an opinion poll with '+size+' reported responses.',
        {pollId:poll.id,topicId:profile.topicId,sampleSize:size,supportPercent,
          confidenceMarginPercent:confidenceMargin},createId);
      return {ok:true,pollId:poll.id};
    }

    if(order.type==='media.restrictArticle') {
      const article=game.mediaArticles.find(item=>
        item.id===order.articleId && item.stateId===stateId);
      const law=(game.politicalSystems.find(item=>item.stateId===stateId)?.laws||[])
        .find(item=>item.id===order.lawId);
      const offices=new Set((game.politicalSystems.find(item=>item.stateId===stateId)?.offices||[])
        .filter(item=>item.holderPlayerId===player.id).map(item=>item.id));
      const reason=String(order.reason||'').trim();
      if(!article || article.status!=='published')
        return {ok:false,code:'MEDIA_ARTICLE_UNAVAILABLE',error:'The publication is unavailable or already restricted.'};
      if(!rule.censorshipLawIds.includes(order.lawId) ||
         !law || law.mediaRestrictionAuthorized!==true ||
         !lawIsActive(game,stateId,law.id) ||
         !(rule.censorshipOfficeIds||[]).some(id=>offices.has(id)))
        return {ok:false,code:'MEDIA_CENSORSHIP_UNAUTHORISED',error:'A valid law currently in force and an explicitly authorized public office are required.'};
      if(!cleanText(reason,12,280) || !intIn(order.severityPercent,1,100))
        return {ok:false,code:'MEDIA_RESTRICTION_INVALID',error:'A restriction needs a written legal reason and bounded severity.'};
      const restriction={
        id:createId(),stateId,articleId:article.id,lawId:law.id,
        reason,severityPercent:order.severityPercent,orderedByPlayerId:player.id,
        orderedOn:game.worldDate,status:'active'
      };
      article.status='restricted';article.censored=true;
      article.restrictionId=restriction.id;
      game.censorshipOrders.push(restriction);
      rule.pressFreedomPercent=Math.max(0,rule.pressFreedomPercent-order.severityPercent*.1);
      record(game,'article_restricted',stateId,
        'A media restriction was issued for '+article.title+' under '+law.title+'.',
        {restrictionId:restriction.id,articleId:article.id,lawId:law.id,
          severityPercent:order.severityPercent,reason},createId);
      return {ok:true,restrictionId:restriction.id};
    }

    return {ok:false,code:'MEDIA_ORDER_UNSUPPORTED',error:'This media action is not supported.'};
  }

  function advanceDay(game) {
    ensure(game);
    const expired=[];
    for(const article of game.mediaArticles) {
      const published=Date.parse(article.publishedOn+'T00:00:00Z');
      const current=Date.parse(game.worldDate+'T00:00:00Z');
      if(article.status==='published' && current-published>14*86400000) {
        article.status='archived';
        expired.push(article.id);
      }
    }
    return {ok:true,archivedArticleIds:expired};
  }

  function lawIsActive(game,stateId,lawId) {
    const law=(game.politicalSystems||[]).find(item=>item.stateId===stateId)
      ?.laws?.find(item=>item.id===lawId);
    if(!law || !['enacted','active'].includes(String(law.status||'').toLowerCase()) ||
       typeof law.effectiveFrom!=='string' || law.effectiveFrom>game.worldDate) return false;
    return !law.repealedOn || law.repealedOn>game.worldDate;
  }
  function validDate(value) {
    if(typeof value!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date=new Date(value+'T00:00:00Z');
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10)===value;
  }

  const api=Object.freeze({
    ensure,validateConfiguration,applyOrder,advanceDay,lawIsActive,
    configurationFields:Object.freeze([...CONFIG_FIELDS]),
    dynamicFields:Object.freeze([...DYNAMIC_FIELDS]),
    articleTypes:Object.freeze([...articleTypes]),
    ownershipTypes:Object.freeze([...ownershipTypes])
  });
  globalThis.NewWorldMedia=api;
  if(typeof module!=='undefined' && module.exports) module.exports=api;
})();