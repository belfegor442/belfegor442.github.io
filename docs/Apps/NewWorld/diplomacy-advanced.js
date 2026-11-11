(() => {
  'use strict';

  const CONFIG_FIELDS=Object.freeze(['internationalOrganizations']);
  const DYNAMIC_FIELDS=Object.freeze([
    'diplomaticProposals','treaties','internationalSanctions',
    'organizationResolutions','diplomaticConferences','diplomacyHistory'
  ]);
  const CLAUSES=new Set([
    'non_aggression','peace','mutual_defence','trade_cooperation',
    'transit_access','recognition'
  ]);
  const ORG_COMPETENCIES=new Set(['sanctions','mediation','arbitration','peacekeeping']);
  const DATE=/^\d{4}-\d{2}-\d{2}$/;
  const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{1,99}$/;
  const safeInt=(v,min,max)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
  const clean=(v,min=2,max=180)=>typeof v==='string'&&v.trim().length>=min&&
    v.length<=max&&!/[<>\u0000-\u001f\u007f]/.test(v);
  const validDate=v=>typeof v==='string'&&DATE.test(v)&&
    !Number.isNaN(Date.parse(v+'T00:00:00Z'))&&
    new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
  const clone=v=>structuredClone(v);
  const stateFor=(game,id)=>(game.territories||[]).find(x=>x.stateId===id);
  const orgFor=(game,id)=>(game.internationalOrganizations||[]).find(x=>x.id===id);
  const relationFor=(game,a,b)=>(game.diplomaticRelations||[]).find(x=>
    x.stateAId===a&&x.stateBId===b||x.stateAId===b&&x.stateBId===a);
  const idFor=createId=>(createId||(()=> 'diplomacy-'+Date.now()+'-'+Math.random().toString(36).slice(2)))();

  function ensure(game) {
    if(!game||!Array.isArray(game.territories)) return game;
    for(const field of [...CONFIG_FIELDS,...DYNAMIC_FIELDS])
      if(!Array.isArray(game[field])) game[field]=[];
    if(!Object.prototype.hasOwnProperty.call(game,'diplomacyCycleDate')) game.diplomacyCycleDate=null;
    if(!Object.prototype.hasOwnProperty.call(game,'diplomacyCycleResult')) game.diplomacyCycleResult=null;
    return game;
  }

  function validateConfiguration(game,c) {
    if(!c||CONFIG_FIELDS.some(field=>!Array.isArray(c[field])))
      return {ok:false,error:'The diplomacy scenario requires an international-organizations array.'};
    const stateIds=new Set((game.territories||[]).map(x=>x.stateId));
    const seen=new Set();
    for(const org of c.internationalOrganizations) {
      if(!ID.test(String(org?.id||''))||seen.has(org.id)||!clean(org.name)||
         !clean(org.charter,20,4000)||!Array.isArray(org.memberStateIds)||
         org.memberStateIds.length<2||
         org.memberStateIds.some(id=>!stateIds.has(id))||
         new Set(org.memberStateIds).size!==org.memberStateIds.length||
         !Array.isArray(org.competenceIds)||!org.competenceIds.length||
         org.competenceIds.some(id=>!ORG_COMPETENCIES.has(id))||
         new Set(org.competenceIds).size!==org.competenceIds.length||
         !safeInt(org.votingThresholdPercent,1,100)||
         !safeInt(org.quorumStateCount,1,org.memberStateIds.length)||
         !['active','suspended'].includes(org.status))
        return {ok:false,error:'An international organization requires a stable ID, charter, at least two real member States, explicit competencies, voting threshold, quorum and status.'};
      seen.add(org.id);
    }
    return {ok:true,error:null};
  }

  function addDays(date,days) {
    const value=new Date(date+'T00:00:00Z');
    value.setUTCDate(value.getUTCDate()+days);
    return value.toISOString().slice(0,10);
  }

  function record(game,type,stateId,description,actorPlayerId,details,createId) {
    const entry={
      id:idFor(createId),type,stateId,description,actorPlayerId,
      worldDate:game.worldDate,details:clone(details||{})
    };
    game.diplomacyHistory.push(entry);
    if(game.diplomacyHistory.length>3000)
      game.diplomacyHistory.splice(0,game.diplomacyHistory.length-3000);
    game.events||=[];
    game.eventSequence=(Number(game.eventSequence)||0)+1;
    game.events.push({
      id:idFor(createId),gameId:game.id,orderId:null,actorPlayerId,stateId,
      type:'diplomacy.'+type,occurredAtUtc:new Date().toISOString(),
      worldDate:game.worldDate,worldVersion:(Number(game.worldVersion)||0)+1,
      description,sequence:game.eventSequence,details:clone(details||{})
    });
    if(game.events.length>1000) game.events.splice(0,game.events.length-1000);
    game.activity||=[];
    game.activity.unshift(description);
    if(game.activity.length>100) game.activity.length=100;
    return entry;
  }

  function validateClauses(clauses) {
    if(!Array.isArray(clauses)||clauses.length<1||clauses.length>12)
      return {ok:false,error:'A treaty needs between one and twelve structured clauses.'};
    const ids=new Set();
    for(const clause of clauses) {
      if(!clause||!CLAUSES.has(clause.type)||ids.has(clause.type))
        return {ok:false,error:'Treaty clauses must use supported, unique structured clause types.'};
      ids.add(clause.type);
    }
    return {ok:true};
  }

  function playerRepresentsState(game,stateId) {
    return (game.memberships||[]).some(m=>m.stateId===stateId&&m.status==='active'&&
      m.permissionSetId!=='government-observer'&&
      (game.players||[]).some(p=>p.id===m.playerId));
  }

  function applyOrder(game,player,membership,order,createId) {
    if(!String(order?.type||'').startsWith('diplomacy.')) return null;
    ensure(game);
    const sourceStateId=membership?.stateId;
    if(!sourceStateId||order.stateId!==sourceStateId||
       membership.status!=='active'||membership.permissionSetId==='government-observer')
      return {ok:false,code:'DIPLOMACY_MEMBERSHIP_INVALID',error:'An active non-observer government membership in the issuing State is required.'};

    if(order.type==='diplomacy.proposeTreaty') {
      const targetStateId=order.targetStateId;
      if(!stateFor(game,targetStateId)||targetStateId===sourceStateId||
         !relationFor(game,sourceStateId,targetStateId))
        return {ok:false,code:'DIPLOMACY_TARGET_INVALID',error:'Choose another State with a registered diplomatic relationship.'};
      if(!playerRepresentsState(game,targetStateId))
        return {ok:false,code:'DIPLOMACY_TARGET_UNREPRESENTED',error:'This State has no active human government membership. NPC States do not invent diplomatic responses.'};
      if(order.visibility!=='public')
        return {ok:false,code:'DIPLOMACY_PRIVATE_CHANNEL_UNAVAILABLE',error:'Private diplomacy is disabled until snapshots can safely filter confidential records per recipient.'};
      const clauses=validateClauses(order.clauses);
      if(!clauses.ok) return {ok:false,code:'DIPLOMACY_CLAUSES_INVALID',error:clauses.error};
      if(!safeInt(order.durationDays,1,36500)||!safeInt(order.validForDays,1,3650)||
         !safeInt(order.terminationNoticeDays,0,3650))
        return {ok:false,code:'DIPLOMACY_DATES_INVALID',error:'Treaty duration, proposal validity and termination notice must be explicit whole numbers of days.'};
      const freeText=order.negotiationText===undefined?'':String(order.negotiationText).trim().replace(/\s+/g,' ');
      if(freeText.length>2000||/[<>\u0000-\u001f\u007f]/.test(freeText))
        return {ok:false,code:'DIPLOMACY_TEXT_INVALID',error:'Negotiation text may contain at most 2,000 plain-text characters.'};
      const proposal={
        id:idFor(createId),sourceStateId,targetStateId,
        proposedByPlayerId:player.id,clauses:clone(order.clauses),
        durationDays:order.durationDays,terminationNoticeDays:order.terminationNoticeDays,
        validUntil:addDays(game.worldDate,order.validForDays),
        negotiationText:freeText,visibility:'public',status:'pending',
        proposedOn:game.worldDate,counterOfProposalId:null
      };
      game.diplomaticProposals.push(proposal);
      record(game,'treaty_proposed',sourceStateId,
        player.name+' proposed a structured treaty to '+stateFor(game,targetStateId).name+'.',
        player.id,{proposalId:proposal.id,targetStateId,clauses:proposal.clauses},createId);
      return {ok:true,proposalId:proposal.id};
    }

    if(order.type==='diplomacy.respondTreaty') {
      const proposal=game.diplomaticProposals.find(p=>
        p.id===order.proposalId&&p.targetStateId===sourceStateId&&p.status==='pending');
      if(!proposal||proposal.validUntil<game.worldDate)
        return {ok:false,code:'DIPLOMACY_PROPOSAL_EXPIRED',error:'The proposal is unavailable, expired or not addressed to this government.'};
      if(!['accept','reject','counter'].includes(order.response))
        return {ok:false,code:'DIPLOMACY_RESPONSE_INVALID',error:'Choose accept, reject or counteroffer.'};
      if(order.response==='reject') {
        proposal.status='rejected';proposal.resolvedOn=game.worldDate;
        record(game,'treaty_rejected',sourceStateId,
          player.name+' rejected a treaty proposal.',player.id,
          {proposalId:proposal.id,sourceStateId:proposal.sourceStateId},createId);
        return {ok:true};
      }
      if(order.response==='counter') {
        const validation=validateClauses(order.counterClauses);
        if(!validation.ok||!safeInt(order.counterDurationDays,1,36500))
          return {ok:false,code:'DIPLOMACY_COUNTER_INVALID',error:validation.error||'Counteroffer duration must be a positive whole number of days.'};
        proposal.status='countered';proposal.resolvedOn=game.worldDate;
        const counter={
          id:idFor(createId),sourceStateId,targetStateId:proposal.sourceStateId,
          proposedByPlayerId:player.id,clauses:clone(order.counterClauses),
          durationDays:order.counterDurationDays,terminationNoticeDays:proposal.terminationNoticeDays,
          validUntil:proposal.validUntil,
          negotiationText:String(order.negotiationText||'').trim().replace(/\s+/g,' ').slice(0,2000),
          visibility:'public',status:'pending',proposedOn:game.worldDate,
          counterOfProposalId:proposal.id
        };
        game.diplomaticProposals.push(counter);
        record(game,'treaty_countered',sourceStateId,
          player.name+' submitted a structured treaty counteroffer.',
          player.id,{proposalId:proposal.id,counterProposalId:counter.id},createId);
        return {ok:true,counterProposalId:counter.id};
      }
      if(!playerRepresentsState(game,proposal.sourceStateId))
        return {ok:false,code:'DIPLOMACY_TARGET_UNREPRESENTED',error:'The proposing State no longer has an active human government membership.'};
      const treaty={
        id:idFor(createId),stateAId:proposal.sourceStateId,stateBId:proposal.targetStateId,
        clauses:clone(proposal.clauses),durationDays:proposal.durationDays,
        signedByPlayerIds:[proposal.proposedByPlayerId,player.id],
        proposalId:proposal.id,signedOn:game.worldDate,
        effectiveOn:addDays(game.worldDate,1),
        expiresOn:addDays(game.worldDate,proposal.durationDays),
        terminationNoticeDays:proposal.terminationNoticeDays,
        status:'scheduled',endedOn:null,effectiveTerminationOn:null
      };
      game.treaties.push(treaty);
      proposal.status='accepted';proposal.resolvedOn=game.worldDate;
      proposal.treatyId=treaty.id;
      record(game,'treaty_signed',sourceStateId,
        player.name+' accepted a treaty with '+stateFor(game,proposal.sourceStateId).name+
          '; it enters into force on '+treaty.effectiveOn+'.',
        player.id,{proposalId:proposal.id,treatyId:treaty.id,effectiveOn:treaty.effectiveOn},createId);
      return {ok:true,treatyId:treaty.id};
    }

    if(order.type==='diplomacy.withdrawProposal') {
      const proposal=game.diplomaticProposals.find(p=>
        p.id===order.proposalId&&p.sourceStateId===sourceStateId&&
        p.proposedByPlayerId===player.id&&p.status==='pending');
      if(!proposal) return {ok:false,code:'DIPLOMACY_PROPOSAL_NOT_FOUND',error:'Only the original proposing player may withdraw a pending proposal.'};
      proposal.status='withdrawn';proposal.resolvedOn=game.worldDate;
      record(game,'treaty_withdrawn',sourceStateId,'A pending treaty proposal was withdrawn.',player.id,
        {proposalId:proposal.id},createId);
      return {ok:true};
    }

    if(order.type==='diplomacy.terminateTreaty') {
      const treaty=game.treaties.find(t=>t.id===order.treatyId&&
        [t.stateAId,t.stateBId].includes(sourceStateId)&&
        ['scheduled','active','termination_pending'].includes(t.status));
      const reason=String(order.reason||'').trim().replace(/\s+/g,' ');
      if(!treaty) return {ok:false,code:'DIPLOMACY_TREATY_NOT_FOUND',error:'The treaty is not active or scheduled for this State.'};
      if(reason.length<12||reason.length>280||/[<>\u0000-\u001f\u007f]/.test(reason))
        return {ok:false,code:'DIPLOMACY_TERMINATION_REASON_REQUIRED',error:'A plain-text legal or diplomatic reason of 12–280 characters is required.'};
      const notice=treaty.terminationNoticeDays||0;
      treaty.status=notice>0?'termination_pending':'terminated';
      treaty.terminationRequestedOn=game.worldDate;
      treaty.effectiveTerminationOn=notice>0?addDays(game.worldDate,notice):game.worldDate;
      treaty.terminationReason=reason;
      if(treaty.status==='terminated') treaty.endedOn=game.worldDate;
      record(game,'treaty_termination_requested',sourceStateId,
        'A treaty termination was recorded with '+(notice>0?'a '+notice+'-day notice.':'immediate effect.'),
        player.id,{treatyId:treaty.id,effectiveTerminationOn:treaty.effectiveTerminationOn,reason},createId);
      return {ok:true};
    }

    if(order.type==='diplomacy.proposeOrganizationResolution') {
      const organization=orgFor(game,order.organizationId);
      if(!organization||organization.status!=='active'||
         !organization.memberStateIds.includes(sourceStateId))
        return {ok:false,code:'DIPLOMACY_ORGANIZATION_MEMBERSHIP_REQUIRED',error:'Only a member State may submit a resolution to this active organization.'};
      if(order.resolutionType!=='trade_embargo'||
         !organization.competenceIds.includes('sanctions'))
        return {ok:false,code:'DIPLOMACY_ORGANIZATION_COMPETENCE_REQUIRED',error:'The organization charter does not authorize a trade embargo resolution.'};
      if(!stateFor(game,order.targetStateId)||!safeInt(order.durationDays,1,3650)||
         !Array.isArray(order.exemptGoodIds)||
         order.exemptGoodIds.some(id=>!(game.goods||[]).some(g=>g.id===id)))
        return {ok:false,code:'DIPLOMACY_RESOLUTION_INVALID',error:'A trade resolution needs a real target State, duration and valid good exemptions.'};
      const resolution={
        id:idFor(createId),organizationId:organization.id,proposedByStateId:sourceStateId,
        targetStateId:order.targetStateId,resolutionType:'trade_embargo',
        durationDays:order.durationDays,exemptGoodIds:[...new Set(order.exemptGoodIds)],
        proposedOn:game.worldDate,status:'pending',votes:[],sanctionId:null
      };
      game.organizationResolutions.push(resolution);
      record(game,'organization_resolution_proposed',sourceStateId,
        player.name+' proposed a trade-sanctions resolution in '+organization.name+'.',
        player.id,{resolutionId:resolution.id,targetStateId:resolution.targetStateId},createId);
      return {ok:true,resolutionId:resolution.id};
    }

    if(order.type==='diplomacy.voteOrganizationResolution') {
      const resolution=game.organizationResolutions.find(r=>
        r.id===order.resolutionId&&r.status==='pending');
      const organization=resolution&&orgFor(game,resolution.organizationId);
      if(!organization||!organization.memberStateIds.includes(sourceStateId))
        return {ok:false,code:'DIPLOMACY_ORGANIZATION_MEMBERSHIP_REQUIRED',error:'The issuing State is not a member of this resolution’s organization.'};
      if(!['approve','reject'].includes(order.vote))
        return {ok:false,code:'DIPLOMACY_VOTE_INVALID',error:'Choose approve or reject.'};
      if(resolution.votes.some(v=>v.stateId===sourceStateId))
        return {ok:false,code:'DIPLOMACY_DUPLICATE_STATE_VOTE',error:'Each member State has one vote, regardless of how many players share its government.'};
      resolution.votes.push({stateId:sourceStateId,playerId:player.id,vote:order.vote,worldDate:game.worldDate});
      const yes=resolution.votes.filter(v=>v.vote==='approve').length;
      const no=resolution.votes.filter(v=>v.vote==='reject').length;
      const voted=resolution.votes.length;
      const allVoted=voted===organization.memberStateIds.length;
      const threshold=organization.memberStateIds.length*organization.votingThresholdPercent/100;
      if(yes>=organization.quorumStateCount&&yes>=threshold) {
        const sanction={
          id:idFor(createId),organizationId:organization.id,targetStateId:resolution.targetStateId,
          type:'trade_embargo',exemptGoodIds:[...resolution.exemptGoodIds],
          adoptedOn:game.worldDate,effectiveOn:addDays(game.worldDate,1),
          expiresOn:addDays(game.worldDate,resolution.durationDays),
          status:'scheduled',resolutionId:resolution.id
        };
        game.internationalSanctions.push(sanction);
        resolution.status='adopted';resolution.resolvedOn=game.worldDate;
        resolution.sanctionId=sanction.id;
        record(game,'organization_sanction_adopted',sourceStateId,
          organization.name+' adopted a time-limited trade embargo.',player.id,
          {resolutionId:resolution.id,sanctionId:sanction.id,targetStateId:sanction.targetStateId},createId);
      } else if(allVoted||no>organization.memberStateIds.length-threshold) {
        resolution.status='rejected';resolution.resolvedOn=game.worldDate;
        record(game,'organization_resolution_rejected',sourceStateId,
          organization.name+' rejected a sanctions resolution.',player.id,
          {resolutionId:resolution.id,yes,no},createId);
      } else {
        record(game,'organization_vote_cast',sourceStateId,
          player.name+' voted '+order.vote+' in '+organization.name+'.',player.id,
          {resolutionId:resolution.id,yes,no},createId);
      }
      return {ok:true};
    }

    if(order.type==='diplomacy.openConference') {
      const participants=[...new Set(order.participantStateIds||[])];
      const agenda=String(order.agenda||'').trim().replace(/\s+/g,' ');
      if(participants.length<2||participants.length>20||
         !participants.includes(sourceStateId)||
         participants.some(id=>!stateFor(game,id)||!playerRepresentsState(game,id))||
         agenda.length<12||agenda.length>500||/[<>\u0000-\u001f\u007f]/.test(agenda))
        return {ok:false,code:'DIPLOMACY_CONFERENCE_INVALID',error:'A conference requires 2–20 represented States, including the proposer, and an explicit agenda.'};
      const conference={
        id:idFor(createId),hostStateId:sourceStateId,participantStateIds:participants,
        agenda,openedOn:game.worldDate,status:'open',resolutions:[]
      };
      game.diplomaticConferences.push(conference);
      record(game,'conference_opened',sourceStateId,
        'A diplomatic conference was opened with '+participants.length+' represented States.',
        player.id,{conferenceId:conference.id,participantStateIds:participants,agenda},createId);
      return {ok:true,conferenceId:conference.id};
    }

    return {ok:false,code:'DIPLOMACY_ORDER_UNSUPPORTED',error:'This advanced diplomatic order is not supported.'};
  }

  function isWarProhibited(game,stateAId,stateBId) {
    return (game.treaties||[]).some(t=>
      ['active','termination_pending'].includes(t.status)&&
      [t.stateAId,t.stateBId].includes(stateAId)&&
      [t.stateAId,t.stateBId].includes(stateBId)&&
      (t.clauses||[]).some(c=>c.type==='non_aggression')&&
      t.effectiveOn<=game.worldDate&&(!t.expiresOn||t.expiresOn>=game.worldDate)&&
      (!t.effectiveTerminationOn||t.effectiveTerminationOn>game.worldDate));
  }

  function tradeAllowed(game,fromStateId,toStateId,goodId) {
    return !(game.internationalSanctions||[]).some(s=>
      s.type==='trade_embargo'&&s.status==='active'&&
      s.effectiveOn<=game.worldDate&&s.expiresOn>=game.worldDate&&
      (s.targetStateId===fromStateId||s.targetStateId===toStateId)&&
      !(s.exemptGoodIds||[]).includes(goodId));
  }

  function advanceDay(game,createId) {
    ensure(game);
    if(game.diplomacyCycleDate===game.worldDate&&game.diplomacyCycleResult)
      return {ok:true,replayed:true,result:clone(game.diplomacyCycleResult)};
    const activated=[],expired=[];
    for(const treaty of game.treaties) {
      if(treaty.status==='scheduled'&&treaty.effectiveOn<=game.worldDate) {
        treaty.status='active';activated.push(treaty.id);
        const relation=relationFor(game,treaty.stateAId,treaty.stateBId);
        if(relation&&(treaty.clauses||[]).some(c=>c.type==='peace')&&relation.status==='war') {
          relation.status='peace';relation.peaceEstablishedOn=game.worldDate;
          relation.declaredOn=relation.declaredOn||null;
          relation.peaceTreatyId=treaty.id;
        }
        record(game,'treaty_entered_force',treaty.stateAId,
          'A signed treaty entered into force.',null,{treatyId:treaty.id},createId);
      }
      if(treaty.status==='termination_pending'&&treaty.effectiveTerminationOn<=game.worldDate) {
        treaty.status='terminated';treaty.endedOn=game.worldDate;expired.push(treaty.id);
        record(game,'treaty_terminated',treaty.stateAId,
          'A treaty reached its agreed termination date.',null,{treatyId:treaty.id},createId);
      } else if(treaty.status==='active'&&treaty.expiresOn<game.worldDate) {
        treaty.status='expired';treaty.endedOn=game.worldDate;expired.push(treaty.id);
        record(game,'treaty_expired',treaty.stateAId,
          'A treaty expired at the end of its configured term.',null,{treatyId:treaty.id},createId);
      }
    }
    const sanctionsActivated=[],sanctionsExpired=[];
    for(const sanction of game.internationalSanctions) {
      if(sanction.status==='scheduled'&&sanction.effectiveOn<=game.worldDate) {
        sanction.status='active';sanctionsActivated.push(sanction.id);
        record(game,'sanction_entered_force',null,
          'An international trade embargo entered into force.',null,
          {sanctionId:sanction.id,targetStateId:sanction.targetStateId},createId);
      }
      if(sanction.status==='active'&&sanction.expiresOn<game.worldDate) {
        sanction.status='expired';sanctionsExpired.push(sanction.id);
        record(game,'sanction_expired',null,
          'An international trade embargo expired.',null,
          {sanctionId:sanction.id,targetStateId:sanction.targetStateId},createId);
      }
    }
    const proposalsExpired=[];
    for(const proposal of game.diplomaticProposals) {
      if(proposal.status==='pending'&&proposal.validUntil<game.worldDate) {
        proposal.status='expired';proposal.resolvedOn=game.worldDate;
        proposalsExpired.push(proposal.id);
        record(game,'treaty_proposal_expired',proposal.sourceStateId,
          'A structured treaty proposal expired without acceptance.',
          null,{proposalId:proposal.id,targetStateId:proposal.targetStateId,
            validUntil:proposal.validUntil},createId);
      }
    }
    const result={activated,expired,sanctionsActivated,sanctionsExpired,proposalsExpired};
    game.diplomacyCycleDate=game.worldDate;
    game.diplomacyCycleResult=clone(result);
    return {ok:true,replayed:false,result};
  }

  const api=Object.freeze({
    ensure,validateConfiguration,applyOrder,advanceDay,isWarProhibited,tradeAllowed,
    configurationFields:CONFIG_FIELDS,dynamicFields:DYNAMIC_FIELDS
  });
  globalThis.NewWorldDiplomacy=api;
  if(typeof module!=='undefined'&&module.exports) module.exports=api;
})();