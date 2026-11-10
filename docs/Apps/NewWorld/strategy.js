(() => {
  'use strict';

  const PERMISSIONS = ['government-member','government-council','government-executive'];
  const UNIT_TYPES = [
    {id:'militia',name:'Militia',recruitmentCost:220,personnelPerRecruit:100,strength:1,commandPermissionSetIds:PERMISSIONS},
    {id:'infantry',name:'Professional infantry',recruitmentCost:420,personnelPerRecruit:100,strength:1.55,requiredTechnologyId:'military_drill',commandPermissionSetIds:PERMISSIONS},
    {id:'cavalry',name:'Cavalry',recruitmentCost:650,personnelPerRecruit:80,strength:2.1,requiredTechnologyId:'logistics',commandPermissionSetIds:PERMISSIONS}
  ];
  const POLICY_EFFECTS = Object.freeze({
    public_works:{name:'Public works programme',effectId:'construction_discount',value:0.05},
    conscription:{name:'National service act',effectId:'recruitment_discount',value:0.08},
    agricultural_program:{name:'Agricultural development act',effectId:'population_growth_bonus',value:0.10}
  });
  const TECHNOLOGIES = [
    {id:'masonry',name:'Masonry and public works',domain:'Infrastructure',requiredProgress:5,dailyProgress:1,dailyFunding:24,budget:120,prerequisiteTechnologyIds:[],requiredKnowledge:{},requiredMaterials:{},effects:[{effectId:'construction_discount',value:0.10}]},
    {id:'logistics',name:'Military logistics',domain:'Military',requiredProgress:7,dailyProgress:1,dailyFunding:35,budget:245,prerequisiteTechnologyIds:['masonry'],requiredKnowledge:{},requiredMaterials:{},effects:[{effectId:'recruitment_discount',value:0.12},{effectId:'military_strength',value:0.10}]},
    {id:'agronomy',name:'Crop rotation',domain:'Agriculture',requiredProgress:6,dailyProgress:1,dailyFunding:28,budget:168,prerequisiteTechnologyIds:['masonry'],requiredKnowledge:{},requiredMaterials:{},effects:[{effectId:'population_growth_bonus',value:0.25}]},
    {id:'military_drill',name:'Professional drill',domain:'Military',requiredProgress:9,dailyProgress:1,dailyFunding:42,budget:378,prerequisiteTechnologyIds:['logistics'],requiredKnowledge:{},requiredMaterials:{},effects:[{effectId:'military_strength',value:0.25}]}
  ];

  const idFor = createId => createId();
  const membershipFor = (game,playerId,stateId) =>
    (game.memberships || []).find(item => item.playerId === playerId &&
      item.stateId === stateId && item.status === 'active');
  const territoryFor = (game,stateId) =>
    (game.territories || []).find(item => item.stateId === stateId);
  const provinceForState = (game,stateId) =>
    (game.provinces || []).find(item => item.stateId === stateId);
  const politicalFor = (game,stateId) =>
    (game.politicalSystems || []).find(item => item.stateId === stateId);
  const relationFor = (game,stateAId,stateBId) =>
    (game.diplomaticRelations || []).find(item =>
      item.stateAId===stateAId && item.stateBId===stateBId ||
      item.stateAId===stateBId && item.stateBId===stateAId);

  function record(game,type,stateId,description,actorPlayerId = null) {
    game.activity ||= [];
    game.events ||= [];
    game.eventSequence = (Number(game.eventSequence) || 0) + 1;
    game.activity.unshift(description);
    game.activity = game.activity.slice(0,100);
    game.events.push({
      id:'strategy-' + game.eventSequence,gameId:game.id,orderId:null,actorPlayerId,stateId,
      type,occurredAtUtc:new Date().toISOString(),worldDate:game.worldDate,
      worldVersion:game.worldVersion,description,sequence:game.eventSequence
    });
    if (game.events.length > 1000) game.events.splice(0,game.events.length-1000);
  }

  function createStarterScenario(game,createId) {
    const provinces = game.territories.map((territory,index) => ({
      id:idFor(createId),stateId:territory.stateId,sovereignStateId:territory.stateId,
      name:territory.name + ' Province',svgElementId:null,defenceRating:index === 0 ? 0 : 55
    }));
    const militaryRoutes = [];
    game.diplomaticRelations=[];
    for (let a=0; a<game.territories.length; a++) {
      for (let b=a+1; b<game.territories.length; b++) {
        game.diplomaticRelations.push({
          id:idFor(createId),stateAId:game.territories[a].stateId,
          stateBId:game.territories[b].stateId,status:'peace',
          relationScore:0,declaredOn:null,declaredBy:null,
          peaceEstablishedOn:game.worldDate
        });
      }
    }
    for (let index=0; index<provinces.length; index++) {
      const next=(index+1)%provinces.length;
      militaryRoutes.push(
        {id:idFor(createId),originProvinceId:provinces[index].id,destinationProvinceId:provinces[next].id,travelDays:1,enabled:true},
        {id:idFor(createId),originProvinceId:provinces[next].id,destinationProvinceId:provinces[index].id,travelDays:1,enabled:true}
      );
    }

    game.provinces=provinces;
    game.provinceConnections=militaryRoutes.map(route => ({
      id:route.id,fromProvinceId:route.originProvinceId,toProvinceId:route.destinationProvinceId,
      mode:'land',enabled:true
    }));
    game.militaryRoutes=militaryRoutes;
    game.militaryUnitTypes=UNIT_TYPES.map(item => ({...item,commandPermissionSetIds:[...item.commandPermissionSetIds]}));
    game.militaryCommanders=[];
    game.militaryUnits=[];
    game.militaryOrders=[];
    game.militaryBattles=[];
    game.occupations=[];
    game.supplyRoutes=[];

    const home=game.territories[0];
    const commanderId=idFor(createId);
    game.militaryCommanders.push({
      id:commanderId,stateId:home.stateId,name:'Founding Commander',
      experience:15,loyalty:85
    });
    game.militaryUnits.push({
      id:idFor(createId),stateId:home.stateId,provinceId:provinces[0].id,
      ownerPlayerId:game.hostPlayerId,unitTypeId:'militia',commanderId,
      personnel:120,maxPersonnel:120,training:20,morale:82,experience:12,status:'ready'
    });

    game.technologies=TECHNOLOGIES.map(item => ({
      ...item,prerequisiteTechnologyIds:[...item.prerequisiteTechnologyIds],
      requiredKnowledge:{...item.requiredKnowledge},requiredMaterials:{...item.requiredMaterials},
      effects:item.effects.map(effect => ({...effect}))
    }));
    game.researchInstitutions=[];
    game.researchProjects=[];
    game.technologyUnlocks=[];
    game.technologyAdoptions=[];
    for (const territory of game.territories) {
      const institutionId=idFor(createId);
      game.researchInstitutions.push({
        id:institutionId,stateId:territory.stateId,name:'State Academy',
        type:'public',staff:8,funding:0,specializations:['Infrastructure','Military','Agriculture']
      });
      for (const technology of game.technologies) {
        game.researchProjects.push({
          id:idFor(createId),stateId:territory.stateId,technologyId:technology.id,
          institutionId,status:'proposed',progress:0,requiredProgress:technology.requiredProgress,
          dailyProgress:technology.dailyProgress,dailyFunding:technology.dailyFunding,
          budget:technology.budget,fundingRemaining:0,staff:2,materialsReserved:{},
          startedOn:null,completedOn:null,fundedFrom:null
        });
      }
    }

    game.politicalSystems=game.territories.map(territory => ({
      stateId:territory.stateId,configurationPending:false,
      regime:{id:'founding-council',name:'Founding Council',type:'council'},
      constitution:{
        version:1,effectiveFrom:game.worldDate,
        competenceRules:[
          {competence:'proposeLaw',proposerPermissionSetIds:PERMISSIONS,voterPermissionSetIds:PERMISSIONS,
            approvalRequired:true,minimumVotes:1,approvalThresholdPercent:50,
            approvalThresholdBasis:'eligibleVoters',legalBasis:'Founding Constitution',institutionId:'assembly'},
          {competence:'approveBudget',proposerPermissionSetIds:PERMISSIONS,approvalRequired:false,
            legalBasis:'Public Finance Act',institutionId:'executive'},
          {competence:'appointOffice',proposerPermissionSetIds:PERMISSIONS,approvalRequired:false,
            legalBasis:'Government Organisation Act',institutionId:'executive',
            institutionIds:['executive','judiciary']},
          {competence:'setCivicPolicy',proposerPermissionSetIds:PERMISSIONS,approvalRequired:false,
            legalBasis:'State Administration Act',institutionId:'executive'},
          {competence:'managePublicBudget',proposerPermissionSetIds:PERMISSIONS,approvalRequired:false,
            legalBasis:'Public Finance Act',institutionId:'executive'},
          {competence:'respondPublicPetitions',proposerPermissionSetIds:PERMISSIONS,approvalRequired:false,
            legalBasis:'Public Participation Act',institutionId:'executive'},
          {competence:'establishDiplomaticMission',proposerPermissionSetIds:PERMISSIONS,approvalRequired:false,
            legalBasis:'Diplomatic Service Act',institutionId:'executive'}
        ]
      },
      government:{program:'Frontier development',budget:400,legitimacy:60},
      institutions:[
        {id:'assembly',name:'State Assembly',branch:'legislative'},
        {id:'executive',name:'Executive Council',branch:'executive'},
        {id:'judiciary',name:'State Courts',branch:'judicial'}
      ],
      offices:[
        {id:'chief-executive',institutionId:'executive',name:'Chief Executive',holderPlayerId:null},
        {id:'treasurer',institutionId:'executive',name:'Treasurer',holderPlayerId:null},
        {id:'justice-minister',institutionId:'executive',name:'Minister of Justice',holderPlayerId:null},
        {id:'public-prosecutor',institutionId:'judiciary',name:'Public Prosecutor',holderPlayerId:null},
        {id:'chief-justice',institutionId:'judiciary',name:'Chief Justice',holderPlayerId:null},
        {id:'appeal-judge',institutionId:'judiciary',name:'Court of Appeal Judge',holderPlayerId:null},
        {id:'press-secretary',institutionId:'executive',name:'Press Secretary',holderPlayerId:null},
        {id:'intelligence-director',institutionId:'executive',name:'Intelligence Director',holderPlayerId:null}
      ],
      parties:[{id:'founders',name:'Founding Coalition',seats:1,program:'Settlement, trade and public works'}],
      laws:[{id:'founding-charter',title:'Founding Charter',text:'Establishes the first public institutions and the rule of law.',status:'enacted',legalBasis:'Founding Constitution',effectiveFrom:game.worldDate}],
      decisions:[],policies:[],stability:60
    }));
    game.strategyVersion=1;

    return game;
  }

  function onClaim(game,territory,ownerPlayerId,createId) {
    const province=provinceForState(game,territory.stateId);
    if (!province) return;
    province.defenceRating=0;
    const system=politicalFor(game,territory.stateId);
    if (system) {
      for (const office of system.offices || [])
        if (['chief-executive','treasurer','justice-minister','public-prosecutor','chief-justice','appeal-judge','press-secretary','intelligence-director'].includes(office.id))
          office.holderPlayerId=ownerPlayerId;
      if (system.government) system.government.chiefExecutivePlayerId=ownerPlayerId;
    }
    if ((game.militaryUnits || []).some(unit => unit.provinceId===province.id && unit.personnel>0)) return;
    game.militaryUnits.push({
      id:idFor(createId),stateId:territory.stateId,provinceId:province.id,
      ownerPlayerId,unitTypeId:'militia',commanderId:null,
      personnel:60,maxPersonnel:60,training:10,morale:75,experience:0,status:'garrison'
    });
  }

  function permission(rule,field,membership) {
    return Boolean(membership && rule && (rule[field] || []).includes(membership.permissionSetId));
  }
  function holdsOffice(system,playerId,officeIds) {
    return (system?.offices || []).some(office =>
      officeIds.includes(office.id) && office.holderPlayerId===playerId);
  }

  function effectValue(game,stateId,effectId) {
    let value=0;
    const adopted=(game.technologyAdoptions || []).filter(item => item.stateId===stateId);
    for (const adoption of adopted) {
      const technology=(game.technologies || []).find(item => item.id===adoption.technologyId);
      for (const effect of technology?.effects || [])
        if (effect.effectId===effectId) value+=Number(effect.value)||0;
    }
    for (const policy of politicalFor(game,stateId)?.policies || [])
      if (policy.effectId===effectId) value+=Number(policy.value)||0;
    return value;
  }

  function availableKnowledge(game,stateId) {
    return new Set((game.technologyUnlocks || [])
      .filter(item => item.stateId===stateId).map(item => item.technologyId));
  }

  function completeDecision(game,system,decision,approved) {
    decision.status=approved?'approved':'rejected';
    decision.resolvedOn=game.worldDate;
    if (approved && decision.competence==='proposeLaw') {
      const law={
        id:'law-'+decision.id,title:decision.title,text:decision.text,status:'enacted',
        legalBasis:decision.legalBasis,effectiveFrom:game.worldDate,
        proposedBy:decision.proposedBy,decisionId:decision.id
      };
      system.laws.push(law);
      const policy=POLICY_EFFECTS[decision.policyId];
      if (policy) {
        system.policies ||= [];
        system.policies.push({
          id:'policy-'+decision.id,policyId:decision.policyId,
          name:policy.name,effectId:policy.effectId,value:policy.value,
          enactedOn:game.worldDate,lawId:law.id
        });
      }
      decision.status='enacted';
    }
    record(game,approved?'government.decision_approved':'government.decision_rejected',
      system.stateId,(approved?'Decision approved: ':'Decision rejected: ')+decision.title+'.',
      decision.proposedBy);
  }

  function applyOrder(game,player,membership,order,createId) {
    const stateId=membership.stateId;
    const territory=territoryFor(game,stateId);
    const system=politicalFor(game,stateId);
    if (!territory) return {ok:false,code:'INVALID_STATE',error:'The selected government no longer exists.'};
    if (membership.permissionSetId==='government-observer')
      return {ok:false,code:'INSUFFICIENT_PERMISSION',error:'Observer memberships cannot issue government, military or research orders.'};

    if (order.type==='setCivicPolicy') {
      const policyRule=system.constitution?.competenceRules?.find(item=>item.competence==='setCivicPolicy');
      if(!permission(policyRule,'proposerPermissionSetIds',membership) ||
        !holdsOffice(system,player.id,['chief-executive','treasurer']))
        return {ok:false,code:'INSUFFICIENT_PERMISSION',error:'Only the Chief Executive or Treasurer may change executive State policy.'};
      const civic=(game.civicSystems||[]).find(item=>item.stateId===stateId);
      if(!civic) return {ok:false,code:'CIVIC_SYSTEM_UNAVAILABLE',error:'The State civic systems have not been initialised.'};
      const field=String(order.policyId||'');
      const value=Number(order.value);
      const ranges={
        policePerThousand:{min:0,max:10,integer:false},
        civilServants:{min:0,max:100000,integer:true},
        pressFreedom:{min:0,max:100,integer:true},
        counterintelligence:{min:0,max:100,integer:true},
        healthInvestment:{min:0,max:100,integer:true},
        educationInvestment:{min:0,max:100,integer:true},
        environmentalRegulation:{min:0,max:100,integer:true},
        welfareInvestment:{min:0,max:100,integer:true},
        taxRatePermille:{min:0,max:300,integer:true}
      };
      const rule=ranges[field];
      if(!rule || !Number.isFinite(value) || value<rule.min || value>rule.max ||
        (rule.integer && !Number.isSafeInteger(value)) ||
        (field==='policePerThousand' && Math.round(value*10)!==value*10))
        return {ok:false,code:'INVALID_CIVIC_POLICY',error:'The selected State policy value is outside its permitted range.'};
      civic.policy ||= {healthInvestment:50,educationInvestment:50,environmentalRegulation:40,welfareInvestment:20};
      if(field==='policePerThousand') civic.justice.policePerThousand=value;
      else if(field==='civilServants') civic.administration.civilServants=value;
      else if(field==='pressFreedom') civic.media.pressFreedom=value;
      else if(field==='counterintelligence') civic.intelligence.counterintelligence=value;
      else if(field==='taxRatePermille') civic.administration.taxRatePermille=value;
      else civic.policy[field]=value;
      record(game,'government.civic_policy_changed',stateId,
        player.name+' changed '+field+' to '+value+'.',player.id);
      return {ok:true};
    }

    if(order.type==='setPublicBudget') {
      const rule=system.constitution?.competenceRules?.find(item=>item.competence==='managePublicBudget');
      if(!permission(rule,'proposerPermissionSetIds',membership) ||
        !holdsOffice(system,player.id,['treasurer','chief-executive']))
        return {ok:false,code:'PUBLIC_BUDGET_AUTHORITY_REQUIRED',error:'Only the Treasurer or Chief Executive can allocate daily public expenditure.'};
      const civic=(game.civicSystems||[]).find(item=>item.stateId===stateId);
      if(!civic?.publicBudget)
        return {ok:false,code:'CIVIC_SYSTEM_UNAVAILABLE',error:'The public budget is not initialised.'};
      const category=String(order.category||'');
      const amount=Number(order.dailyAmount);
      const categories=['health','education','justice','policing','welfare','environment','administration'];
      if(!categories.includes(category) || !Number.isSafeInteger(amount) || amount<0 || amount>100000)
        return {ok:false,code:'INVALID_PUBLIC_BUDGET',error:'Choose a supported department and a daily allocation from 0 to 100,000.'};
      const allocations=civic.publicBudget.dailyAllocations||{};
      const newTotal=categories.reduce((sum,key)=>sum+(key===category?amount:Number(allocations[key])||0),0);
      if(newTotal>300000)
        return {ok:false,code:'PUBLIC_BUDGET_LIMIT',error:'Combined daily public allocations cannot exceed 300,000.'};
      civic.publicBudget.dailyAllocations[category]=amount;
      record(game,'finance.public_budget_allocation_changed',stateId,
        player.name+' set the daily '+category+' allocation to '+amount+'.',player.id);
      return {ok:true};
    }

    if(order.type==='respondCivicPetition') {
      const rule=system.constitution?.competenceRules?.find(item=>item.competence==='respondPublicPetitions');
      if(!permission(rule,'proposerPermissionSetIds',membership) ||
        !holdsOffice(system,player.id,['chief-executive']))
        return {ok:false,code:'PETITION_RESPONSE_AUTHORITY_REQUIRED',error:'Only the Chief Executive can issue an official response to a public petition.'};
      const civic=(game.civicSystems||[]).find(item=>item.stateId===stateId);
      const petition=civic?.society?.petitions?.find(item=>item.id===order.petitionId);
      const response=String(order.response||'');
      if(!petition || petition.status!=='pending' || Number(petition.expiresDay)<game.day)
        return {ok:false,code:'PETITION_UNAVAILABLE',error:'This petition is no longer awaiting an executive response.'};
      if(!['approve','reject'].includes(response))
        return {ok:false,code:'INVALID_PETITION_RESPONSE',error:'Choose approve or reject.'};
      const supportedPolicies=['welfareInvestment','educationInvestment','environmentalRegulation','pressFreedom'];
      if(response==='approve') {
        if(!supportedPolicies.includes(petition.policyId) ||
          !Number.isFinite(Number(petition.requestedValue)) ||
          Number(petition.requestedValue)<0 || Number(petition.requestedValue)>100)
          return {ok:false,code:'INVALID_PETITION_POLICY',error:'The petition contains an unsupported policy recommendation.'};
        const current=petition.policyId==='pressFreedom'
          ?Number(civic.media.pressFreedom)||0:Number(civic.policy?.[petition.policyId])||0;
        if(Number(petition.requestedValue)<current || Number(petition.requestedValue)>current+30)
          return {ok:false,code:'INVALID_PETITION_POLICY',error:'The requested policy change is outside the permitted executive response range.'};
        if(petition.policyId==='pressFreedom') civic.media.pressFreedom=Number(petition.requestedValue);
        else civic.policy[petition.policyId]=Number(petition.requestedValue);
        petition.status='accepted';
        petition.appliedValue=Number(petition.requestedValue);
        petition.response='Accepted and implemented by the executive government.';
        const support=Number(petition.supportBasisPoints)||0;
        civic.media.publicConfidence=Math.min(100,(Number(civic.media.publicConfidence)||0)+
          Math.min(3,support/2500));
        civic.society.cohesion=Math.min(100,(Number(civic.society.cohesion)||0)+
          Math.min(2,support/3500));
      } else {
        petition.status='rejected';
        petition.response='Rejected by the executive government.';
        const support=Number(petition.supportBasisPoints)||0;
        civic.media.publicConfidence=Math.max(0,(Number(civic.media.publicConfidence)||0)-
          Math.min(3,support/2500));
        civic.society.cohesion=Math.max(0,(Number(civic.society.cohesion)||0)-
          Math.min(2,support/3500));
      }
      petition.resolvedDay=game.day;
      petition.respondedBy=player.id;
      civic.society.resolvedPetitions=(Number(civic.society.resolvedPetitions)||0)+1;
      record(game,'society.petition_'+(response==='approve'?'accepted':'rejected'),stateId,
        player.name+' '+(response==='approve'?'accepted':'rejected')+' the public petition: '+petition.title+'.',player.id);
      return {ok:true};
    }

    if(order.type==='publishPublicStatement') {
      if(!holdsOffice(system,player.id,['press-secretary']))
        return {ok:false,code:'PRESS_AUTHORITY_REQUIRED',error:'Only the appointed Press Secretary can publish official State statements.'};
      const headline=String(order.headline||'').trim().replace(/\\s+/g,' ').slice(0,90);
      const body=String(order.body||'').trim().replace(/\\s+/g,' ').slice(0,600);
      if(headline.length<5 || body.length<20 || /[<>]/.test(headline+body))
        return {ok:false,code:'INVALID_PUBLIC_STATEMENT',error:'Provide a headline of at least 5 characters and a statement of at least 20 characters.'};
      const civic=(game.civicSystems||[]).find(item=>item.stateId===stateId);
      if(!civic?.media) return {ok:false,code:'CIVIC_SYSTEM_UNAVAILABLE',error:'The State press office is not initialised.'};
      civic.media.published ||= [];
      const publication={
        id:'official-statement-'+stateId+'-'+game.day+'-'+(civic.media.published.length+1),
        day:game.day,worldDate:game.worldDate,headline,body,
        source:'State Press Office',sourcePlayerId:player.id,
        verified:true,official:true,approvedBy:player.id
      };
      civic.media.published.unshift(publication);
      civic.media.publishedToday=(Number(civic.media.publishedToday)||0)+1;
      if(civic.media.published.length>100) civic.media.published.length=100;
      record(game,'media.official_statement_published',stateId,
        'State Press Office published: '+headline+'.',player.id);
      return {ok:true};
    }

    if(order.type==='commissionIntelAssessment') {
      if(!holdsOffice(system,player.id,['intelligence-director']))
        return {ok:false,code:'INTELLIGENCE_AUTHORITY_REQUIRED',error:'Only the Intelligence Director can commission strategic assessments.'};
      const targetStateId=String(order.targetStateId||'');
      const target=territoryFor(game,targetStateId);
      const sourceCivic=(game.civicSystems||[]).find(item=>item.stateId===stateId);
      const targetCivic=(game.civicSystems||[]).find(item=>item.stateId===targetStateId);
      const type=String(order.assessmentType||'');
      if(!target || targetStateId===stateId || !targetCivic?.intelligence ||
        !targetCivic.military || !targetCivic.diplomacy || !targetCivic.finance ||
        !targetCivic.labour || !targetCivic.agriculture || !targetCivic.justice)
        return {ok:false,code:'INVALID_INTELLIGENCE_TARGET',error:'Choose an existing foreign State with complete civic data.'};
      if(!sourceCivic?.intelligence)
        return {ok:false,code:'CIVIC_SYSTEM_UNAVAILABLE',error:'The commissioning State intelligence service is not initialised.'};
      if(!['military','economic','political'].includes(type))
        return {ok:false,code:'INVALID_INTELLIGENCE_TYPE',error:'Choose a military, economic or political assessment.'};
      game.intelligenceAssessments ||= [];
      if(game.intelligenceAssessments.filter(item=>item.stateId===stateId && item.status==='pending').length>=8)
        return {ok:false,code:'INTELLIGENCE_QUEUE_FULL',error:'The State has reached its limit of eight unresolved assessments.'};
      const assessment={
        id:idFor(createId),stateId,targetStateId,assessmentType:type,
        commissionedBy:player.id,commissionedOn:game.worldDate,
        commissionedDay:game.day,status:'pending',confidence:Math.max(5,Math.min(95,
          Math.round(35+Number(sourceCivic.intelligence.capacity)*.35-
            Number(targetCivic.intelligence.counterintelligence)*.18))),
        evidenceSnapshot:type==='military'?{
          personnel:Number(targetCivic.military.personnel)||0,
          readiness:Number(targetCivic.military.readiness)||0,
          wars:Number(targetCivic.diplomacy.activeWars)||0,
          logisticsCoverage:Number(targetCivic.military.logisticsCoverage)||0
        }:type==='economic'?{
          treasury:Number(target.treasury)||0,
          exports:Number(targetCivic.finance.exports)||0,
          imports:Number(targetCivic.finance.imports)||0,
          unemploymentRate:Number(targetCivic.labour.unemploymentRate)||0,
          foodSecurity:Number(targetCivic.agriculture.foodSecurity)||0
        }:{
          legitimacy:Number(targetCivic.legitimacy)||0,
          publicTrust:Number(targetCivic.publicTrust)||0,
          stability:Number(targetCivic.stability)||0,
          publicOrder:Number(targetCivic.justice.publicOrder)||0
        },
        summary:'Preliminary assessment based on the latest observable world-state snapshot; not a verified covert source.'
      };
      game.intelligenceAssessments.push(assessment);
      sourceCivic.intelligence.reports ||= [];
      sourceCivic.intelligence.reports.unshift({
        id:assessment.id,threat:type+' assessment: '+target.name,
        createdDay:game.day,confidence:assessment.confidence,
        status:'pending',assessment:assessment.summary,targetStateId,
        assessmentType:type
      });
      record(game,'intelligence.assessment_commissioned',stateId,
        player.name+' commissioned a '+type+' assessment of '+target.name+'.',player.id);
      return {ok:true};
    }

    if(order.type==='reviewIntelAssessment') {
      if(!holdsOffice(system,player.id,['intelligence-director']))
        return {ok:false,code:'INTELLIGENCE_AUTHORITY_REQUIRED',error:'Only the Intelligence Director can review strategic assessments.'};
      const civic=(game.civicSystems||[]).find(item=>item.stateId===stateId);
      const assessment=(game.intelligenceAssessments||[]).find(item=>
        item.id===order.assessmentId && item.stateId===stateId && item.status==='pending');
      if(!assessment)
        return {ok:false,code:'INTELLIGENCE_REPORT_UNAVAILABLE',error:'This pending strategic assessment is unavailable.'};
      if(game.day<=assessment.commissionedDay)
        return {ok:false,code:'INTELLIGENCE_REPORT_NOT_READY',error:'The assessment requires at least one world day to complete.'};
      assessment.status='reviewed';
      assessment.reviewedOn=game.worldDate;
      assessment.reviewedDay=game.day;
      assessment.reviewedBy=player.id;
      assessment.summary='Reviewed '+assessment.assessmentType+' assessment. Confidence '+assessment.confidence+
        '%. Evidence was captured on day '+assessment.commissionedDay+'.';
      const report=civic?.intelligence?.reports.find(item=>item.id===assessment.id);
      if(report) {
        report.status='reviewed';
        report.assessment=assessment.summary;
      }
      record(game,'intelligence.assessment_reviewed',stateId,
        player.name+' reviewed the '+assessment.assessmentType+' assessment of '+
        territoryFor(game,assessment.targetStateId).name+'.',player.id);
      return {ok:true};
    }

    if(order.type==='investigateCourtCase') {
      if(!holdsOffice(system,player.id,['justice-minister']))
        return {ok:false,code:'JUSTICE_AUTHORITY_REQUIRED',error:'The Minister of Justice must authorise investigations.'};
      const civic=(game.civicSystems||[]).find(item=>item.stateId===stateId);
      const justice=civic?.justice;
      const caseFile=justice?.courtCases.find(item=>item.id===order.caseId);
      if(!caseFile || caseFile.status!=='reported')
        return {ok:false,code:'COURT_CASE_UNAVAILABLE',error:'Only a newly reported case can enter investigation.'};
      caseFile.status='investigated';
      caseFile.investigatedDay=game.day;
      caseFile.investigatedBy=player.id;
      caseFile.investigationAttempts=(Number(caseFile.investigationAttempts)||0)+1;
      caseFile.evidenceScore=Math.max(0,Math.min(100,Math.round(
        28+justice.policePerThousand*3.2+justice.publicOrder*.2+
        (caseFile.severity==='serious'?8:0)-(caseFile.investigationAttempts-1)*10)));
      record(game,'justice.case_investigated',stateId,
        player.name+' completed an investigation in case '+caseFile.id+'. Evidence score: '+caseFile.evidenceScore+'.',player.id);
      return {ok:true};
    }

    if(order.type==='fileCourtCharges') {
      if(!holdsOffice(system,player.id,['public-prosecutor']))
        return {ok:false,code:'PROSECUTOR_AUTHORITY_REQUIRED',error:'Only the Public Prosecutor can file charges.'};
      const justice=(game.civicSystems||[]).find(item=>item.stateId===stateId)?.justice;
      const caseFile=justice?.courtCases.find(item=>item.id===order.caseId);
      if(!caseFile || caseFile.status!=='investigated' || caseFile.evidenceScore<40)
        return {ok:false,code:'INSUFFICIENT_EVIDENCE',error:'The case has not met the minimum evidence threshold for prosecution.'};
      caseFile.status='awaitingTrial';
      caseFile.chargedDay=game.day;
      caseFile.chargedBy=player.id;
      caseFile.chargeTitle=caseFile.offence;
      justice.awaitingTrial=justice.courtCases.filter(item=>item.status==='awaitingTrial').length;
      record(game,'justice.charges_filed',stateId,
        player.name+' filed charges in case '+caseFile.id+'. A hearing is scheduled for a later world day.',player.id);
      return {ok:true};
    }

    if(order.type==='adjudicateCourtCase') {
      if(!holdsOffice(system,player.id,['chief-justice']))
        return {ok:false,code:'JUDICIAL_AUTHORITY_REQUIRED',error:'Only the Chief Justice can adjudicate a trial.'};
      const civic=(game.civicSystems||[]).find(item=>item.stateId===stateId);
      const justice=civic?.justice;
      const caseFile=justice?.courtCases.find(item=>item.id===order.caseId);
      if(!caseFile || caseFile.status!=='awaitingTrial' || game.day<=caseFile.chargedDay)
        return {ok:false,code:'TRIAL_NOT_READY',error:'The case is not ready for a hearing on this world day.'};
      if((Number(justice.casesAdjudicatedToday)||0)>=justice.courtCapacityPerDay)
        return {ok:false,code:'COURT_CAPACITY_REACHED',error:'The court has reached its daily hearing capacity.'};
      if(!['convict','acquit'].includes(order.verdict))
        return {ok:false,code:'INVALID_VERDICT',error:'Choose a conviction or acquittal.'};
      const sentenceDays=Number(order.sentenceDays ?? caseFile.defaultSentenceDays ?? 5);
      if(order.verdict==='convict' && (!Number.isSafeInteger(sentenceDays)||sentenceDays<1||sentenceDays>3650))
        return {ok:false,code:'INVALID_SENTENCE',error:'A custodial sentence must be 1–3,650 whole world days.'};
      caseFile.status='resolved';
      caseFile.verdict=order.verdict;
      caseFile.outcome=order.verdict==='convict'?'conviction':'acquittal';
      caseFile.sentenceDays=order.verdict==='convict'?sentenceDays:0;
      caseFile.resolvedDay=game.day;
      caseFile.adjudicatedBy=player.id;
      justice.casesAdjudicatedToday=(Number(justice.casesAdjudicatedToday)||0)+1;
      justice.resolvedLastDay=(Number(justice.resolvedLastDay)||0)+1;
      if(order.verdict==='convict') {
        justice.convictionsLastDay=(Number(justice.convictionsLastDay)||0)+1;
        justice.prisoners ||= [];
        caseFile.prisonerId='prisoner-'+caseFile.id;
        justice.prisoners.push({
          id:caseFile.prisonerId,caseId:caseFile.id,
          admittedDay:game.day,releaseOnDay:game.day+sentenceDays,
          sentenceDays,status:'incarcerated'
        });
        justice.prisonPopulation=justice.prisoners.length;
        justice.prisonOvercrowding=Math.max(0,justice.prisonPopulation-justice.prisonCapacity);
      }
      justice.pendingCases=justice.courtCases.filter(item=>
        ['reported','investigated','awaitingTrial','appealPending'].includes(item.status)).length;
      justice.awaitingTrial=justice.courtCases.filter(item=>item.status==='awaitingTrial').length;
      record(game,'justice.case_adjudicated',stateId,
        'Case '+caseFile.id+' concluded with '+caseFile.outcome+
        (order.verdict==='convict'?' and a '+sentenceDays+'-day sentence.':'.'),player.id);
      return {ok:true};
    }

    if(order.type==='appealCourtCase') {
      const justice=(game.civicSystems||[]).find(item=>item.stateId===stateId)?.justice;
      const caseFile=justice?.courtCases.find(item=>item.id===order.caseId);
      const grounds=String(order.grounds||'').trim().replace(/\\s+/g,' ').slice(0,300);
      if(!caseFile || caseFile.status!=='resolved' ||
        !Number.isSafeInteger(caseFile.resolvedDay) || game.day>caseFile.resolvedDay+5)
        return {ok:false,code:'APPEAL_WINDOW_CLOSED',error:'Appeals must be filed within five world days of the judgment.'};
      if(grounds.length<12)
        return {ok:false,code:'INVALID_APPEAL_GROUNDS',error:'Provide at least 12 characters explaining the grounds of appeal.'};
      caseFile.status='appealPending';
      caseFile.appealGrounds=grounds;
      caseFile.appealFiledDay=game.day;
      caseFile.appealedBy=player.id;
      record(game,'justice.appeal_filed',stateId,
        player.name+' filed an appeal in case '+caseFile.id+'.',player.id);
      return {ok:true};
    }

    if(order.type==='resolveCourtAppeal') {
      if(!holdsOffice(system,player.id,['appeal-judge']))
        return {ok:false,code:'APPEAL_AUTHORITY_REQUIRED',error:'Only the Court of Appeal Judge can resolve an appeal.'};
      const justice=(game.civicSystems||[]).find(item=>item.stateId===stateId)?.justice;
      const caseFile=justice?.courtCases.find(item=>item.id===order.caseId);
      if(!caseFile || caseFile.status!=='appealPending' || game.day<=caseFile.appealFiledDay)
        return {ok:false,code:'APPEAL_NOT_READY',error:'The appeal requires a later-world-day review.'};
      if(!['uphold','overturn'].includes(order.appealVerdict))
        return {ok:false,code:'INVALID_APPEAL_VERDICT',error:'Choose to uphold or overturn the original judgment.'};
      const originalVerdict=caseFile.verdict;
      if(order.appealVerdict==='overturn' && originalVerdict==='convict') {
        justice.prisoners ||= [];
        justice.prisoners=justice.prisoners.filter(item=>item.caseId!==caseFile.id);
        justice.prisonPopulation=justice.prisoners.length;
        caseFile.finalVerdict='acquittal';
      } else if(order.appealVerdict==='overturn' && originalVerdict==='acquit') {
        caseFile.finalVerdict='new-trial-required';
        caseFile.status='awaitingTrial';
        caseFile.chargedDay=game.day;
        caseFile.defaultSentenceDays=5;
        caseFile.retrialOrderedDay=game.day;
        caseFile.appealStatus='overturn';
        caseFile.appealResolvedDay=game.day;
        caseFile.appealResolvedBy=player.id;
        caseFile.resolvedDay=null;
        justice.awaitingTrial=justice.courtCases.filter(item=>item.status==='awaitingTrial').length;
        justice.pendingCases=justice.courtCases.filter(item=>
          ['reported','investigated','awaitingTrial','appealPending'].includes(item.status)).length;
        record(game,'justice.retrial_ordered',stateId,
          'The Court of Appeal ordered a new trial in case '+caseFile.id+'.',player.id);
        return {ok:true};
      } else {
        caseFile.finalVerdict=originalVerdict;
      }
      caseFile.status='resolved';
      caseFile.appealStatus=order.appealVerdict;
      caseFile.appealResolvedDay=game.day;
      caseFile.appealResolvedBy=player.id;
      caseFile.resolvedDay=game.day;
      justice.prisonOvercrowding=Math.max(0,justice.prisonPopulation-justice.prisonCapacity);
      justice.pendingCases=justice.courtCases.filter(item=>
        ['reported','investigated','awaitingTrial','appealPending'].includes(item.status)).length;
      record(game,'justice.appeal_resolved',stateId,
        'Appeal in case '+caseFile.id+' was '+order.appealVerdict+'d by the Court of Appeal.',player.id);
      return {ok:true};
    }

    if (order.type==='proposeTreaty') {

      const targetStateId=String(order.targetStateId || '');
      const target=territoryFor(game,targetStateId);
      if(!target || targetStateId===stateId)
        return {ok:false,code:'INVALID_DIPLOMATIC_TARGET',error:'Choose a valid foreign State.'};
      if(order.treatyType!=='nonAggression')
        return {ok:false,code:'UNSUPPORTED_TREATY_TYPE',error:'Only non-aggression treaties are currently enabled.'};
      if(target.ownerPlayerId===player.id || membershipFor(game,player.id,targetStateId))
        return {ok:false,code:'SAME_GOVERNMENT',error:'A treaty requires two separate governments.'};
      const recipientMembers=(game.memberships || []).filter(item =>
        item.stateId===targetStateId && item.status==='active');
      if(!target.ownerPlayerId || recipientMembers.length===0)
        return {ok:false,code:'NO_RECIPIENT_GOVERNMENT',error:'This State has no human government authorised to accept the proposal.'};
      const durationDays=Number(order.durationDays);
      const proposalExpiryDays=Number(order.proposalExpiryDays);
      if(!Number.isSafeInteger(durationDays) || durationDays<1 || durationDays>3650)
        return {ok:false,code:'INVALID_TREATY_TERM',error:'The treaty term must be 1–3,650 whole world days.'};
      if(!Number.isSafeInteger(proposalExpiryDays) || proposalExpiryDays<1 || proposalExpiryDays>3650)
        return {ok:false,code:'INVALID_PROPOSAL_EXPIRY',error:'The proposal expiry must be 1–3,650 whole world days.'};
      const relation=relationFor(game,stateId,targetStateId);
      if(relation?.status==='war')
        return {ok:false,code:'WAR_ALREADY_ACTIVE',error:'A non-aggression treaty cannot be proposed during an active war.'};
      game.diplomaticProposals ||= [];
      game.treaties ||= [];
      const activeTreaty=game.treaties.some(item =>
        item.type==='nonAggression' && item.status==='active' &&
        ((item.stateAId===stateId && item.stateBId===targetStateId) ||
         (item.stateAId===targetStateId && item.stateBId===stateId)));
      const pendingProposal=game.diplomaticProposals.some(item =>
        item.type==='nonAggression' && item.status==='pending' &&
        ((item.fromStateId===stateId && item.toStateId===targetStateId) ||
         (item.fromStateId===targetStateId && item.toStateId===stateId)));
      if(activeTreaty || pendingProposal)
        return {ok:false,code:'TREATY_ALREADY_EXISTS',error:'An active treaty or pending proposal already exists for these governments.'};
      const proposal={
        id:idFor(createId),type:'nonAggression',fromStateId:stateId,toStateId:targetStateId,
        proposedByPlayerId:player.id,proposedOnWorldDate:game.worldDate,
        proposedOnDay:game.day,durationDays,proposalExpiryDays,
        expiresOnDay:game.day+proposalExpiryDays,status:'pending',
        terms:{type:'nonAggression',expiresAfterDays:durationDays}
      };
      game.diplomaticProposals.push(proposal);
      record(game,'diplomacy.treaty_proposed',stateId,
        player.name+' proposed a '+durationDays+'-day non-aggression treaty to '+target.name+'.',player.id);
      return {ok:true};
    }

    if (order.type==='respondTreaty') {
      game.diplomaticProposals ||= [];
      game.treaties ||= [];
      const proposal=(game.diplomaticProposals || []).find(item =>
        item.id===order.proposalId && item.status==='pending');
      if(!proposal || proposal.toStateId!==stateId)
        return {ok:false,code:'TREATY_PROPOSAL_UNAVAILABLE',error:'This proposal is not pending for your government.'};
      if(Number.isSafeInteger(proposal.expiresOnDay) && game.day>=proposal.expiresOnDay) {
        proposal.status='expired';
        proposal.respondedOnWorldDate=game.worldDate;
        return {ok:false,code:'TREATY_PROPOSAL_EXPIRED',error:'This diplomatic proposal has expired.'};
      }
      if(!membershipFor(game,proposal.proposedByPlayerId,proposal.fromStateId))
        return {ok:false,code:'PROPOSER_MEMBERSHIP_ENDED',error:'The proposing government no longer has an authorised signatory.'};
      if(order.accept!==true) {
        proposal.status='rejected';
        proposal.respondedOnWorldDate=game.worldDate;
        proposal.respondedByPlayerId=player.id;
        record(game,'diplomacy.treaty_rejected',stateId,
          player.name+' rejected a non-aggression treaty proposal.',player.id);
        return {ok:true};
      }
      const relation=relationFor(game,proposal.fromStateId,proposal.toStateId);
      const alreadyActive=game.treaties.some(item =>
        item.type===proposal.type && item.status==='active' &&
        ((item.stateAId===proposal.fromStateId && item.stateBId===proposal.toStateId) ||
         (item.stateAId===proposal.toStateId && item.stateBId===proposal.fromStateId)));
      if(relation?.status==='war' || alreadyActive)
        return {ok:false,code:'TREATY_NO_LONGER_AVAILABLE',error:'The governments are at war or already have an active treaty.'};
      const treaty={
        id:idFor(createId),type:proposal.type,stateAId:proposal.fromStateId,
        stateBId:proposal.toStateId,createdOnWorldDate:game.worldDate,
        createdOnDay:game.day,expiresOnDay:game.day+proposal.durationDays,
        status:'active',proposalId:proposal.id,
        signatories:[proposal.proposedByPlayerId,player.id]
      };
      game.treaties.push(treaty);
      proposal.status='accepted';
      proposal.respondedOnWorldDate=game.worldDate;
      proposal.respondedByPlayerId=player.id;
      proposal.treatyId=treaty.id;
      record(game,'diplomacy.treaty_signed',stateId,
        player.name+' accepted a non-aggression treaty. It expires on world day '+treaty.expiresOnDay+'.',
        player.id);
      return {ok:true};
    }

    if(order.type==='proposeEmbassy') {
      const rule=system.constitution?.competenceRules?.find(item=>item.competence==='establishDiplomaticMission');
      if(!permission(rule,'proposerPermissionSetIds',membership) ||
        !holdsOffice(system,player.id,['chief-executive']))
        return {ok:false,code:'EMBASSY_AUTHORITY_REQUIRED',error:'Only the Chief Executive can establish a diplomatic mission.'};
      const targetStateId=String(order.targetStateId||'');
      const target=territoryFor(game,targetStateId);
      const relation=relationFor(game,stateId,targetStateId);
      if(!target || targetStateId===stateId || !relation || !target.ownerPlayerId ||
        target.ownerPlayerId===player.id || membershipFor(game,player.id,targetStateId))
        return {ok:false,code:'INVALID_DIPLOMATIC_TARGET',error:'Choose a separately administered foreign State.'};
      if(!((game.memberships||[]).some(item=>item.stateId===targetStateId&&item.status==='active')))
        return {ok:false,code:'NO_RECIPIENT_GOVERNMENT',error:'The receiving State needs an active government membership to accept a mission.'};
      if(relation.status==='war')
        return {ok:false,code:'WAR_ALREADY_ACTIVE',error:'A diplomatic mission cannot be opened during an active war.'};
      game.embassyMissions ||= [];
      if(game.embassyMissions.some(item=>
        [item.proposingStateId,item.targetStateId].includes(stateId) &&
        [item.proposingStateId,item.targetStateId].includes(targetStateId) &&
        ['pending','active','suspended'].includes(item.status)))
        return {ok:false,code:'EMBASSY_ALREADY_EXISTS',error:'A pending or active diplomatic mission already exists between these States.'};
      if(territory.treasury<100)
        return {ok:false,code:'INSUFFICIENT_FUNDS',error:'The State treasury needs 100 currency units for the diplomatic mission proposal.'};
      const before=territory.treasury;
      territory.treasury-=100;
      const mission={
        id:idFor(createId),proposingStateId:stateId,targetStateId,
        proposedByPlayerId:player.id,proposedOnDay:game.day,proposedOnWorldDate:game.worldDate,
        expiresDay:game.day+14,status:'pending',deposit:100,dailyUpkeep:2,
        acceptedByPlayerId:null,acceptedDay:null,lastMaintenanceDay:game.day
      };
      game.embassyMissions.push(mission);
      game.financialTransactions ||= [];
      game.financialTransactions.push({
        id:'embassy-deposit-'+mission.id,stateId,currencyId:territory.currencyId,
        type:'embassyProposalDeposit',amount:-100,balanceBefore:before,
        balanceAfter:territory.treasury,description:'Deposit for a proposed diplomatic mission.',
        worldDate:game.worldDate,recordedAtUtc:new Date().toISOString(),
        orderId:order.orderId,membershipId:membership.id
      });
      record(game,'diplomacy.embassy_proposed',stateId,
        player.name+' proposed a diplomatic mission to '+target.name+'.',player.id);
      return {ok:true};
    }

    if(order.type==='respondEmbassyProposal') {
      const rule=system.constitution?.competenceRules?.find(item=>item.competence==='establishDiplomaticMission');
      if(!permission(rule,'proposerPermissionSetIds',membership) ||
        !holdsOffice(system,player.id,['chief-executive']))
        return {ok:false,code:'EMBASSY_AUTHORITY_REQUIRED',error:'Only the receiving Chief Executive can respond to a diplomatic mission proposal.'};
      game.embassyMissions ||= [];
      const mission=game.embassyMissions.find(item=>
        item.id===order.missionId && item.targetStateId===stateId && item.status==='pending');
      if(!mission)
        return {ok:false,code:'EMBASSY_PROPOSAL_UNAVAILABLE',error:'No pending diplomatic mission proposal was found for this State.'};
      if(game.day>=Number(mission.expiresDay)) {
        mission.status='expired';
        mission.resolvedDay=game.day;
        const proposer=territoryFor(game,mission.proposingStateId);
        if(proposer) {
          const before=proposer.treasury;
          proposer.treasury=Math.min(2147483647,before+mission.deposit);
          game.financialTransactions.push({
            id:'embassy-refund-'+mission.id,stateId:proposer.stateId,currencyId:proposer.currencyId,
            type:'embassyProposalRefund',amount:proposer.treasury-before,
            balanceBefore:before,balanceAfter:proposer.treasury,
            description:'Refund for an expired diplomatic mission proposal.',worldDate:game.worldDate,
            recordedAtUtc:new Date().toISOString(),orderId:order.orderId,membershipId:null
          });
        }
        return {ok:false,code:'EMBASSY_PROPOSAL_EXPIRED',error:'The diplomatic proposal has expired and its deposit has been refunded.'};
      }
      const relation=relationFor(game,mission.proposingStateId,mission.targetStateId);
      if(relation?.status==='war')
        return {ok:false,code:'WAR_ALREADY_ACTIVE',error:'The proposal cannot be accepted while the governments are at war.'};
      if(order.response==='accept') {
        mission.status='active';
        mission.acceptedByPlayerId=player.id;
        mission.acceptedDay=game.day;
        mission.lastMaintenanceDay=game.day;
        record(game,'diplomacy.embassy_opened',stateId,
          player.name+' accepted a diplomatic mission. The mission is now active.',player.id);
        return {ok:true};
      }
      if(order.response!=='reject')
        return {ok:false,code:'INVALID_EMBASSY_RESPONSE',error:'Choose accept or reject.'};
      mission.status='rejected';
      mission.resolvedDay=game.day;
      const proposer=territoryFor(game,mission.proposingStateId);
      if(proposer) {
        const before=proposer.treasury;
        proposer.treasury=Math.min(2147483647,before+mission.deposit);
        game.financialTransactions.push({
          id:'embassy-refund-'+mission.id,stateId:proposer.stateId,currencyId:proposer.currencyId,
          type:'embassyProposalRefund',amount:proposer.treasury-before,
          balanceBefore:before,balanceAfter:proposer.treasury,
          description:'Refund for a rejected diplomatic mission proposal.',worldDate:game.worldDate,
          recordedAtUtc:new Date().toISOString(),orderId:order.orderId,membershipId:null
        });
      }
      record(game,'diplomacy.embassy_rejected',stateId,
        player.name+' rejected a diplomatic mission proposal.',player.id);
      return {ok:true};
    }

    if (order.type==='terminateTreaty') {
      const treaty=(game.treaties || []).find(item =>
        item.id===order.treatyId && item.status==='active' &&
        (item.stateAId===stateId || item.stateBId===stateId));
      if(!treaty)
        return {ok:false,code:'TREATY_UNAVAILABLE',error:'No active treaty for this government was found.'};
      treaty.status='terminated';
      treaty.endedOnWorldDate=game.worldDate;
      treaty.endedOnDay=game.day;
      treaty.terminatedByPlayerId=player.id;
      record(game,'diplomacy.treaty_terminated',stateId,
        player.name+' terminated a non-aggression treaty.',player.id);
      return {ok:true};
    }

    if (order.type==='declareWar') {
      const targetStateId=String(order.targetStateId || '');
      const target=territoryFor(game,targetStateId);
      const relation=relationFor(game,stateId,targetStateId);
      if (!target || targetStateId===stateId || !relation)
        return {ok:false,code:'INVALID_DIPLOMATIC_TARGET',error:'Choose a valid foreign State.'};
      if (!target.ownerPlayerId || target.ownerPlayerId===player.id ||
          membershipFor(game,player.id,targetStateId))
        return {ok:false,code:'NOT_HOSTILE_STATE',error:'War can only be declared against another administered government.'};
      const nonAggression=(game.treaties || []).find(item =>
        item.type==='nonAggression' && item.status==='active' &&
        Number(item.expiresOnDay)>game.day &&
        ((item.stateAId===stateId && item.stateBId===targetStateId) ||
         (item.stateAId===targetStateId && item.stateBId===stateId)));
      if(nonAggression)
        return {ok:false,code:'NON_AGGRESSION_ACTIVE',
          error:'An active non-aggression treaty prevents a declaration of war until it expires or is terminated.'};
      if (relation.status==='war')
        return {ok:false,code:'WAR_ALREADY_ACTIVE',error:'The two States are already at war.'};
      relation.status='war';
      relation.declaredOn=game.worldDate;
      relation.declaredBy=player.id;
      relation.declaredByStateId=stateId;
      relation.peaceEstablishedOn=null;
      relation.relationScore=Math.min(-100,Number(relation.relationScore)||0);
      record(game,'diplomacy.war_declared',stateId,
        player.name+' declared war on '+target.name+'.',player.id);
      return {ok:true};
    }

    if (order.type==='makePeace') {
      const targetStateId=String(order.targetStateId || '');
      const target=territoryFor(game,targetStateId);
      const relation=relationFor(game,stateId,targetStateId);
      if (!target || targetStateId===stateId || !relation || relation.status!=='war')
        return {ok:false,code:'PEACE_UNAVAILABLE',error:'There is no active war between these governments.'};
      const pairProvinceIds=new Set((game.provinces || [])
        .filter(item => [stateId,targetStateId].includes(item.stateId))
        .map(item => item.id));
      const activeOccupation=(game.occupations || []).some(item =>
        item.status==='active' && pairProvinceIds.has(item.provinceId) &&
        [stateId,targetStateId].includes(item.occupyingStateId));
      if (activeOccupation)
        return {ok:false,code:'OCCUPATION_ACTIVE',error:'A peace agreement cannot be signed while territory is under active occupation.'};
      relation.status='peace';
      relation.peaceEstablishedOn=game.worldDate;
      relation.peaceAgreedBy=player.id;
      relation.relationScore=Math.max(-25,Number(relation.relationScore)||0);
      record(game,'diplomacy.peace_signed',stateId,
        player.name+' signed a peace agreement with '+target.name+'.',player.id);
      return {ok:true};
    }

    if (order.type==='recruitUnit') {
      const unitType=(game.militaryUnitTypes || []).find(item => item.id===order.unitTypeId);
      if (!unitType || !(unitType.commandPermissionSetIds || []).includes(membership.permissionSetId))
        return {ok:false,code:'INVALID_UNIT',error:'This government cannot recruit that unit type.'};
      if (unitType.requiredTechnologyId &&
          !availableKnowledge(game,stateId).has(unitType.requiredTechnologyId))
        return {ok:false,code:'TECHNOLOGY_REQUIRED',error:'The required military technology has not been discovered.'};
      const activeUnits=(game.militaryUnits || []).filter(item => item.stateId===stateId && item.personnel>0);
      if (activeUnits.length>=12)
        return {ok:false,code:'UNIT_LIMIT',error:'This State has reached its limit of 12 active units.'};
      const discount=Math.min(.5,effectValue(game,stateId,'recruitment_discount'));
      const cost=Math.ceil(Number(unitType.recruitmentCost)*(1-discount));
      if (territory.treasury<cost)
        return {ok:false,code:'INSUFFICIENT_FUNDS',error:'The State treasury cannot cover recruitment.'};
      const province=provinceForState(game,stateId);
      if (!province) return {ok:false,code:'NO_PROVINCE',error:'No recruitment province is configured.'};
      territory.treasury-=cost;
      game.militaryUnits.push({
        id:idFor(createId),stateId,provinceId:province.id,ownerPlayerId:player.id,
        unitTypeId:unitType.id,commanderId:null,personnel:unitType.personnelPerRecruit,
        maxPersonnel:unitType.personnelPerRecruit,training:10,morale:75,experience:0,status:'ready'
      });
      record(game,'military.unit_recruited',stateId,
        player.name+' recruited '+unitType.name+'.',player.id);
      return {ok:true};
    }

    if (order.type==='mobilizeUnit') {
      const unit=(game.militaryUnits || []).find(item => item.id===order.militaryUnitId);
      const unitMembership=unit && membershipFor(game,player.id,unit.stateId);
      if (!unit || !unitMembership || unit.personnel<=0)
        return {ok:false,code:'UNIT_NOT_CONTROLLED',error:'You do not command this active unit.'};
      const route=(game.militaryRoutes || []).find(item =>
        item.id===order.militaryRouteId && item.enabled &&
        item.originProvinceId===unit.provinceId &&
        item.destinationProvinceId===order.destinationProvinceId);
      const destination=(game.provinces || []).find(item => item.id===order.destinationProvinceId);
      if (!route || !destination)
        return {ok:false,code:'ROUTE_UNAVAILABLE',error:'No active route connects this unit to that destination.'};
      const target=territoryFor(game,destination.stateId);
      if (!target) return {ok:false,code:'INVALID_TARGET',error:'The destination province has no territory record.'};
      const origin=(game.provinces || []).find(item => item.id===unit.provinceId);
      const targetMembership=membershipFor(game,player.id,destination.stateId);
      const targetOwner=target.ownerPlayerId;
      const targetControlled=targetOwner===player.id || Boolean(targetMembership);
      if (order.militaryOrderType==='move') {
        if (!targetControlled)
          return {ok:false,code:'HOSTILE_TERRITORY',error:'Use an attack order to enter territory outside your administration.'};
        unit.provinceId=destination.id;
        unit.status='on the move';
        game.militaryOrders.push({
          id:idFor(createId),stateId,unitId:unit.id,type:'move',status:'completed',
          submittedOnWorldDate:game.worldDate,travelDaysRemaining:0,originProvinceId:origin?.id,
          destinationProvinceId:destination.id,rejectionReason:null
        });
        record(game,'military.unit_moved',stateId,player.name+' moved a unit to '+destination.name+'.',player.id);
        return {ok:true};
      }
      if (order.militaryOrderType!=='attack')
        return {ok:false,code:'INVALID_MILITARY_ORDER',error:'Choose a valid movement or attack order.'};
      if (targetControlled)
        return {ok:false,code:'ALREADY_CONTROLLED',error:'You already administer this territory.'};
      if (targetOwner && targetOwner!==player.id &&
          relationFor(game,stateId,destination.stateId)?.status!=='war')
        return {ok:false,code:'WAR_NOT_DECLARED',error:'Declare war in the Diplomacy panel before attacking another administered State.'};
      const defenders=(game.militaryUnits || []).filter(item =>
        item.provinceId===destination.id && item.personnel>0 &&
        item.stateId!==unit.stateId && item.ownerPlayerId!==player.id);
      const strength=(candidate) => {
        const type=(game.militaryUnitTypes || []).find(item => item.id===candidate.unitTypeId);
        const doctrine=effectValue(game,candidate.stateId,'military_strength');
        const commander=(game.militaryCommanders || []).find(item => item.id===candidate.commanderId);
        return Math.max(0,Number(candidate.personnel)||0) *
          Number(type?.strength||1) *
          (0.70+Math.max(0,Number(candidate.morale)||0)/250) *
          (1+Math.max(0,Number(candidate.training)||0)/250) *
          (1+doctrine+(Number(commander?.experience)||0)/1000);
      };
      unit.maxPersonnel=Math.max(Number(unit.maxPersonnel)||0,Number(unit.personnel)||0);
      const attackPower=strength(unit);
      const neutralDefence=targetOwner ? 0 : Math.max(0,Number(destination.defenceRating)||0);
      const defencePower=defenders.reduce((sum,item)=>sum+strength(item),neutralDefence);
      if (attackPower<20)
        return {ok:false,code:'ARMY_TOO_WEAK',error:'The attacking unit is too weak to conduct an operation.'};

      const won=attackPower>defencePower*1.05;
      const attackerLoss=Math.min(unit.personnel-1,Math.ceil(unit.personnel*(won
        ? .08+Math.min(.22,defencePower/Math.max(attackPower,1)*.18)
        : .25+Math.min(.35,defencePower/Math.max(attackPower,1)*.20))));
      unit.personnel-=attackerLoss;
      unit.morale=Math.max(15,Math.min(100,unit.morale+(won?8:-22)));
      unit.experience=Math.min(100,unit.experience+(won?8:4));
      const defenderLosses={};
      for (const defender of defenders) {
        const loss=Math.min(defender.personnel,Math.ceil(defender.personnel*(won?.82:.08)));
        defender.personnel-=loss;
        defenderLosses[defender.id]={personnel:loss};
        if (!defender.personnel) defender.status='destroyed';
      }
      const battle={
        id:idFor(createId),provinceId:destination.id,worldDate:game.worldDate,
        participantUnitIds:[unit.id,...defenders.map(item=>item.id)],
        casualtiesByUnit:{[unit.id]:{personnel:attackerLoss},...defenderLosses},
        result:won?'Attacker victory':'Defender victory'
      };
      game.militaryBattles.push(battle);
      game.militaryOrders.push({
        id:idFor(createId),stateId,unitId:unit.id,type:'attack',
        status:won?'victorious':'repelled',submittedOnWorldDate:game.worldDate,
        travelDaysRemaining:0,originProvinceId:origin?.id,
        destinationProvinceId:destination.id,rejectionReason:null
      });
      if (won) {
        unit.provinceId=destination.id;
        unit.status='occupying';
        const existing=(game.occupations || []).find(item =>
          item.provinceId===destination.id && item.status==='active');
        if (existing) {
          existing.occupyingPlayerId=player.id;
          existing.occupyingStateId=stateId;
          existing.durationDays=0;
          existing.resistance=Math.max(20,Number(existing.resistance)||0);
        } else {
          game.occupations.push({
            id:idFor(createId),provinceId:destination.id,occupyingStateId:stateId,
            occupyingPlayerId:player.id,startedOn:game.worldDate,durationDays:0,
            requiredControlDays:3,resistance:targetOwner?60:30,
            occupyingForce:unit.personnel,controlEffective:false,status:'active'
          });
        }
      } else {
        unit.status='recovering';
      }
      record(game,won?'military.battle_won':'military.battle_lost',stateId,
        player.name+(won?' defeated the defenders at ':' was repelled at ')+destination.name+
        '. Losses: '+attackerLoss+' attackers.',player.id);
      return {ok:true};
    }

    if (order.type==='establishTradeRoute') {
      const destinationStateId=String(order.destinationStateId || '');
      const destination=territoryFor(game,destinationStateId);
      const good=(game.goods || []).find(item => item.id===order.goodId);
      const exporter=(game.companies || []).some(item => item.stateId===stateId);
      const destinationMarket=(game.markets || []).some(item =>
        item.stateId===destinationStateId && item.goodId===order.goodId);
      const capacity=Number(order.dailyCapacity);
      if (!destination || destinationStateId===stateId)
        return {ok:false,code:'TRADE_DESTINATION_UNAVAILABLE',error:'Choose a different State with an active destination market.'};
      if (!good || !exporter || !destinationMarket)
        return {ok:false,code:'TRADE_GOOD_UNAVAILABLE',error:'The selected good must have a domestic exporter and a destination market.'};
      if (!Number.isSafeInteger(capacity) || capacity<1 || capacity>500)
        return {ok:false,code:'INVALID_ROUTE_CAPACITY',error:'Daily route capacity must be a whole number from 1 to 500.'};
      if ((game.tradeRoutes || []).some(route => route.exportStateId===stateId &&
          route.importStateId===destinationStateId && route.goodId===good.id &&
          (route.status==='pending' || route.status==='active' ||
            (route.status==null && route.enabled!==false))))
        return {ok:false,code:'TRADE_ROUTE_EXISTS',error:'An active or pending route for this good and destination already exists.'};
      if ((game.tradeRoutes || []).length>=128)
        return {ok:false,code:'TRADE_ROUTE_LIMIT',error:'The world has reached its limit of 128 public trade routes.'};
      if (territory.treasury<150)
        return {ok:false,code:'INSUFFICIENT_FUNDS',error:'The exporting State needs ¤150 to establish a trade route.'};
      const before=territory.treasury;
      territory.treasury-=150;
      const destinationHasOtherGovernment=Boolean(destination.ownerPlayerId &&
        destination.ownerPlayerId!==player.id &&
        !membershipFor(game,player.id,destinationStateId));
      const route={
        id:idFor(createId),exportStateId:stateId,importStateId:destinationStateId,
        goodId:good.id,dailyCapacity:capacity,
        status:destinationHasOtherGovernment?'pending':'active',
        enabled:!destinationHasOtherGovernment,
        establishedOn:game.worldDate,createdByPlayerId:player.id,
        approvalRequired:destinationHasOtherGovernment,
        acceptedByPlayerId:null,acceptedOn:null
      };
      game.tradeRoutes.push(route);
      game.financialTransactions.push({
        id:idFor(createId),stateId,currencyId:territory.currencyId,
        type:destinationHasOtherGovernment?'tradeRouteProposal':'tradeRouteEstablishment',
        amount:-150,balanceBefore:before,
        balanceAfter:territory.treasury,
        description:(destinationHasOtherGovernment?'Proposed a public trade route to ':'Established a public trade route to ')+destination.name+' for '+good.name+'.',
        worldDate:game.worldDate,recordedAtUtc:new Date().toISOString(),
        orderId:order.orderId,membershipId:membership.id
      });
      record(game,destinationHasOtherGovernment?'economy.trade_route_proposed':'economy.trade_route_established',
        stateId,player.name+(destinationHasOtherGovernment?' proposed a ':' established a ')+
        good.name+' route to '+destination.name+'.',player.id);
      return {ok:true};
    }

    if (order.type==='respondTradeRoute') {
      const route=(game.tradeRoutes || []).find(item =>
        item.id===order.tradeRouteId && item.importStateId===stateId);
      if (!route || route.status!=='pending')
        return {ok:false,code:'TRADE_ROUTE_PENDING_NOT_FOUND',error:'No pending trade route is awaiting approval in this State.'};
      if (route.createdByPlayerId===player.id)
        return {ok:false,code:'TRADE_ROUTE_SELF_APPROVAL',error:'The exporting player cannot approve their own trade proposal.'};
      if (order.accept===true) {
        route.status='active';
        route.enabled=true;
        route.acceptedByPlayerId=player.id;
        route.acceptedOn=game.worldDate;
        record(game,'economy.trade_route_accepted',stateId,
          player.name+' accepted a public trade route for '+route.goodId+'.',player.id);
        return {ok:true};
      }
      route.status='rejected';
      route.enabled=false;
      route.rejectedByPlayerId=player.id;
      route.rejectedOn=game.worldDate;
      const exporterTerritory=territoryFor(game,route.exportStateId);
      if (exporterTerritory) {
        const before=exporterTerritory.treasury;
        exporterTerritory.treasury=Math.min(2147483647,before+150);
        game.financialTransactions.push({
          id:idFor(createId),stateId:exporterTerritory.stateId,
          currencyId:exporterTerritory.currencyId,type:'tradeRouteRefund',
          amount:exporterTerritory.treasury-before,balanceBefore:before,
          balanceAfter:exporterTerritory.treasury,
          description:'Refund for rejected public trade route proposal.',
          worldDate:game.worldDate,recordedAtUtc:new Date().toISOString(),
          orderId:order.orderId,membershipId:null
        });
      }
      record(game,'economy.trade_route_rejected',stateId,
        player.name+' rejected a public trade route proposal.',player.id);
      return {ok:true};
    }

    if (order.type==='cancelTradeRoute') {
      const route=(game.tradeRoutes || []).find(item =>
        item.id===order.tradeRouteId &&
        (item.exportStateId===stateId || item.importStateId===stateId));
      if (!route || route.status==='cancelled' || route.status==='rejected')
        return {ok:false,code:'TRADE_ROUTE_UNAVAILABLE',error:'This State does not participate in an active or pending route with that ID.'};
      if (route.status==='pending') {
        const exporter=territoryFor(game,route.exportStateId);
        if (exporter) {
          const before=exporter.treasury;
          exporter.treasury=Math.min(2147483647,before+150);
          game.financialTransactions.push({
            id:idFor(createId),stateId:exporter.stateId,
            currencyId:exporter.currencyId,type:'tradeRouteRefund',
            amount:exporter.treasury-before,balanceBefore:before,
            balanceAfter:exporter.treasury,
            description:'Refund for cancelled public trade route proposal.',
            worldDate:game.worldDate,recordedAtUtc:new Date().toISOString(),
            orderId:order.orderId,membershipId:null
          });
        }
      }
      route.enabled=false;
      route.status='cancelled';
      route.cancelledOn=game.worldDate;
      record(game,'economy.trade_route_cancelled',stateId,
        player.name+' cancelled a public trade route for '+route.goodId+'.',player.id);
      return {ok:true};
    }

    if (!system) return {ok:false,code:'NO_GOVERNMENT',error:'No constitutional government is configured for this State.'};

    if (order.type==='startProject') {
      const project=(game.researchProjects || []).find(item =>
        item.id===order.researchProjectId && item.stateId===stateId);
      if (!project || !['proposed','suspended'].includes(String(project.status).toLowerCase()))
        return {ok:false,code:'PROJECT_UNAVAILABLE',error:'This research project cannot be started.'};
      const technology=(game.technologies || []).find(item => item.id===project.technologyId);
      const institution=(game.researchInstitutions || []).find(item => item.id===project.institutionId);
      if (!technology || !institution)
        return {ok:false,code:'INVALID_PROJECT',error:'The project has no valid technology or research institution.'};
      const unlocked=availableKnowledge(game,stateId);
      if (!(technology.prerequisiteTechnologyIds || []).every(required => unlocked.has(required)) ||
          !Object.keys(technology.requiredKnowledge || {}).every(required => unlocked.has(required)))
        return {ok:false,code:'PREREQUISITES_MISSING',error:'The required technologies have not been discovered.'};
      const allocatedStaff=(game.researchProjects || []).filter(item =>
        item.id!==project.id && item.institutionId===institution.id && item.status==='active')
        .reduce((sum,item)=>sum+Math.max(0,Number(item.staff)||0),0);
      if (project.staff<=0 || allocatedStaff+project.staff>institution.staff ||
          project.dailyProgress<=0 || project.dailyFunding<=0 ||
          Object.entries(technology.requiredMaterials || {})
            .some(([goodId,quantity]) => Number(project.materialsReserved?.[goodId]||0)<Number(quantity)))
        return {ok:false,code:'PROJECT_RESOURCES_MISSING',error:'The project lacks qualified staff, progress funding or reserved materials.'};
      const remainingDays=Math.ceil(Math.max(0,project.requiredProgress-project.progress)/project.dailyProgress);
      const remainingFunding=remainingDays*project.dailyFunding;
      if (project.status==='suspended') {
        if (Number(project.fundingRemaining)<remainingFunding)
          return {ok:false,code:'INSUFFICIENT_FUNDS',error:'The reserved research funding cannot finish this project.'};
      } else {
        if (Number(project.budget)<remainingFunding)
          return {ok:false,code:'INSUFFICIENT_FUNDS',error:'The project budget is too small for its remaining work.'};
        if (String(institution.type).toLowerCase()==='private') {
          if (institution.funding<project.budget)
            return {ok:false,code:'INSUFFICIENT_FUNDS',error:'The research institution has insufficient funding.'};
          institution.funding-=project.budget;
          project.fundedFrom='institution';
        } else {
          if (territory.treasury<project.budget)
            return {ok:false,code:'INSUFFICIENT_FUNDS',error:'The State treasury cannot fund this project.'};
          territory.treasury-=project.budget;
          project.fundedFrom='treasury';
        }
        project.fundingRemaining=project.budget;
      }
      project.status='active';
      project.startedOn ||= game.worldDate;
      record(game,'research.project_started',stateId,
        'Research started: '+technology.name+'.',player.id);
      return {ok:true};
    }

    if (order.type==='cancelProject') {
      const project=(game.researchProjects || []).find(item =>
        item.id===order.researchProjectId && item.stateId===stateId);
      if (!project || ['completed','cancelled'].includes(String(project.status).toLowerCase()))
        return {ok:false,code:'PROJECT_UNAVAILABLE',error:'This research project cannot be cancelled.'};
      if (project.status==='active' && project.fundingRemaining>0) {
        if (project.fundedFrom==='institution') {
          const institution=(game.researchInstitutions || []).find(item => item.id===project.institutionId);
          if (institution) institution.funding+=project.fundingRemaining;
        } else territory.treasury=Math.min(2147483647,territory.treasury+project.fundingRemaining);
      }
      project.fundingRemaining=0;
      project.status='cancelled';
      record(game,'research.project_cancelled',stateId,
        'Research cancelled: '+project.technologyId+'. Unspent funding returned.',player.id);
      return {ok:true};
    }

    if (order.type==='adoptTechnology') {
      const technology=(game.technologies || []).find(item => item.id===order.technologyId);
      if (!technology || !availableKnowledge(game,stateId).has(order.technologyId))
        return {ok:false,code:'TECHNOLOGY_NOT_DISCOVERED',error:'This technology has not been discovered.'};
      if ((game.technologyAdoptions || []).some(item =>
          item.stateId===stateId && item.technologyId===order.technologyId && !item.provinceId && !item.sector))
        return {ok:false,code:'ALREADY_ADOPTED',error:'This technology is already adopted by the State.'};
      game.technologyAdoptions.push({
        id:idFor(createId),stateId,technologyId:technology.id,
        adoptedOn:game.worldDate,cause:'Adopted by the State government.'
      });
      record(game,'research.technology_adopted',stateId,
        'The State adopted '+technology.name+'.',player.id);
      return {ok:true};
    }

    if (order.type==='approveBudget') {
      const rule=system.constitution?.competenceRules?.find(item => item.competence==='approveBudget');
      if (!permission(rule,'proposerPermissionSetIds',membership) ||
          !holdsOffice(system,player.id,['treasurer','chief-executive']))
        return {ok:false,code:'INSUFFICIENT_PERMISSION',error:'Only the State Treasurer or Chief Executive may approve the public budget.'};
      const budget=Number(order.proposedBudget);
      if (!Number.isSafeInteger(budget) || budget<0 || budget>2147483647)
        return {ok:false,code:'INVALID_BUDGET',error:'Enter a valid whole-number budget.'};
      const previous=Number(system.government?.budget)||0;
      system.government.budget=budget;
      record(game,'government.budget_changed',stateId,
        player.name+' changed the public budget from '+previous+' to '+budget+'.',player.id);
      return {ok:true};
    }

    if (order.type==='proposeLaw') {
      const rule=system.constitution?.competenceRules?.find(item => item.competence==='proposeLaw');
      if (!permission(rule,'proposerPermissionSetIds',membership))
        return {ok:false,code:'INSUFFICIENT_PERMISSION',error:'The Constitution does not grant this membership the right to propose laws.'};
      const title=String(order.decisionTitle||'').trim().replace(/\s+/g,' ').slice(0,80);
      const text=String(order.decisionText||'').trim().replace(/\s+/g,' ').slice(0,1000);
      if (title.length<4 || text.length<12 || /[<>]/.test(title+text))
        return {ok:false,code:'INVALID_LAW',error:'A law requires a title of at least 4 characters and a text of at least 12 characters.'};
      const policyId=String(order.policyId || '');
      if (!POLICY_EFFECTS[policyId])
        return {ok:false,code:'INVALID_POLICY',error:'Choose a valid public policy for this bill.'};
      if ((system.policies || []).some(item => item.policyId===policyId))
        return {ok:false,code:'POLICY_ALREADY_ACTIVE',error:'This public policy is already active in the State.'};
      const decision={
        id:idFor(createId),competence:'proposeLaw',title,text,policyId,
        status:rule.approvalRequired?'pendingApproval':'approved',
        votes:[],legalBasis:rule.legalBasis,proposedBy:player.id,
        proposedOn:game.worldDate,institutionId:rule.institutionId
      };
      system.decisions.push(decision);
      if (!rule.approvalRequired) completeDecision(game,system,decision,true);
      record(game,'government.law_proposed',stateId,
        player.name+' proposed: '+title+'.',player.id);
      return {ok:true};
    }

    if (order.type==='voteDecision') {
      const decision=system.decisions.find(item => item.id===order.decisionId);
      const rule=system.constitution?.competenceRules?.find(item =>
        item.competence===decision?.competence);
      if (!decision || decision.status!=='pendingApproval' ||
          !permission(rule,'voterPermissionSetIds',membership))
        return {ok:false,code:'VOTE_UNAVAILABLE',error:'This decision is closed or your membership cannot vote.'};
      if (!['approve','reject'].includes(order.voteChoice))
        return {ok:false,code:'INVALID_VOTE',error:'Choose approve or reject.'};
      if (decision.votes.some(vote => vote.playerId===player.id))
        return {ok:false,code:'DUPLICATE_VOTE',error:'Each government member may vote once.'};
      decision.votes.push({playerId:player.id,choice:order.voteChoice,votedOn:game.worldDate});
      const eligible=(game.memberships || []).filter(item =>
        item.stateId===stateId && item.status==='active' &&
        permission(rule,'voterPermissionSetIds',item));
      const yes=decision.votes.filter(vote => vote.choice==='approve').length;
      const no=decision.votes.filter(vote => vote.choice==='reject').length;
      const threshold=Math.max(1,Number(rule.approvalThresholdPercent)||50)/100;
      if (decision.votes.length>=(Number(rule.minimumVotes)||1) && yes/Math.max(1,eligible.length)>=threshold)
        completeDecision(game,system,decision,true);
      else if (no/Math.max(1,eligible.length)>1-threshold ||
          decision.votes.length>=eligible.length && yes/Math.max(1,eligible.length)<threshold)
        completeDecision(game,system,decision,false);
      else
        record(game,'government.vote_cast',stateId,
          player.name+' voted '+order.voteChoice+' on '+decision.title+'.',player.id);
      return {ok:true};
    }

    if (order.type==='appointOffice') {
      const rule=system.constitution?.competenceRules?.find(item => item.competence==='appointOffice');
      if (!permission(rule,'proposerPermissionSetIds',membership) ||
          !holdsOffice(system,player.id,['chief-executive']))
        return {ok:false,code:'INSUFFICIENT_PERMISSION',error:'Only the Chief Executive may appoint or replace government office holders.'};
      const allowedInstitutions=Array.isArray(rule.institutionIds)
        ? rule.institutionIds : [rule.institutionId];
      const office=(system.offices || []).find(item =>
        item.id===order.officeId && allowedInstitutions.includes(item.institutionId));
      const appointee=game.players.find(item => item.id===order.appointeePlayerId);
      if (!office || !appointee || !membershipFor(game,appointee.id,stateId))
        return {ok:false,code:'INVALID_APPOINTMENT',error:'The office or appointee is not eligible in this State.'};
      office.holderPlayerId=appointee.id;
      if (office.id==='chief-executive') system.government.chiefExecutivePlayerId=appointee.id;
      record(game,'government.office_appointed',stateId,
        player.name+' appointed '+appointee.name+' as '+office.name+'.',player.id);
      return {ok:true};
    }

    return {ok:false,code:'UNSUPPORTED_ORDER',error:'This order is not supported by the strategy rules.'};
  }

  function advanceDay(game) {
    for (const proposal of game.diplomaticProposals || []) {
      if(proposal.status==='pending' && Number.isSafeInteger(proposal.expiresOnDay) &&
          game.day>=proposal.expiresOnDay) {
        proposal.status='expired';
        proposal.respondedOnWorldDate=game.worldDate;
        record(game,'diplomacy.treaty_proposal_expired',proposal.toStateId,
          'A non-aggression treaty proposal expired without a response.');
      }
    }
    for (const treaty of game.treaties || []) {
      if(treaty.status==='active' && Number.isSafeInteger(treaty.expiresOnDay) &&
          game.day>=treaty.expiresOnDay) {
        treaty.status='expired';
        treaty.endedOnWorldDate=game.worldDate;
        treaty.endedOnDay=game.day;
        record(game,'diplomacy.treaty_expired',treaty.stateAId,
          'A non-aggression treaty reached its agreed end date.');
      }
    }
    for (const unit of game.militaryUnits || []) {
      if (unit.personnel<=0) continue;
      unit.morale=Math.min(100,(Number(unit.morale)||0)+2);
      if (['recovering','occupying','garrison'].includes(unit.status)) {
        const maximum=Number(unit.maxPersonnel)||Number(unit.personnel);
        unit.personnel=Math.min(maximum,unit.personnel+Math.max(1,Math.ceil(maximum*.025)));
        if (unit.personnel>=maximum && unit.status==='recovering') unit.status='ready';
      }
    }
    for (const project of game.researchProjects || []) {
      if (project.status!=='active') continue;
      if (project.fundingRemaining<project.dailyFunding) {
        project.status='suspended';
        record(game,'research.project_suspended',project.stateId,
          'Research suspended: insufficient reserved funding.');
        continue;
      }
      project.progress=Math.min(project.requiredProgress,project.progress+project.dailyProgress);
      project.fundingRemaining-=project.dailyFunding;
      if (project.progress>=project.requiredProgress) {
        project.status='completed';
        project.completedOn=game.worldDate;
        if (!(game.technologyUnlocks || []).some(item =>
            item.stateId===project.stateId && item.technologyId===project.technologyId)) {
          game.technologyUnlocks.push({
            id:'unlock-'+project.id,stateId:project.stateId,
            technologyId:project.technologyId,discoveredOn:game.worldDate,
            cause:'Research project completed.'
          });
        }
        const technology=(game.technologies || []).find(item => item.id===project.technologyId);
        record(game,'research.technology_discovered',project.stateId,
          'Technology discovered: '+(technology?.name||project.technologyId)+'.');
        if (project.fundingRemaining>0) {
          const territory=territoryFor(game,project.stateId);
          if (project.fundedFrom==='institution') {
            const institution=(game.researchInstitutions || []).find(item => item.id===project.institutionId);
            if (institution) institution.funding+=project.fundingRemaining;
          } else if (territory) territory.treasury=Math.min(2147483647,territory.treasury+project.fundingRemaining);
          project.fundingRemaining=0;
        }
      }
    }

    for (const occupation of game.occupations || []) {
      if (occupation.status!=='active') continue;
      const province=(game.provinces || []).find(item => item.id===occupation.provinceId);
      const territory=province && territoryFor(game,province.stateId);
      if (!province || !territory) {
        occupation.status='invalid';
        continue;
      }
      occupation.durationDays++;
      occupation.resistance=Math.max(0,Number(occupation.resistance||0)-15);
      occupation.occupyingForce=(game.militaryUnits || [])
        .filter(unit => unit.provinceId===province.id &&
          membershipFor(game,unit.ownerPlayerId,occupation.occupyingStateId))
        .reduce((sum,unit)=>sum+unit.personnel,0);
      if (occupation.occupyingForce<=0) {
        occupation.status='repelled';
        record(game,'military.occupation_failed',territory.stateId,
          'Occupation failed after the attacking force withdrew.');
        continue;
      }
      if (occupation.durationDays>=occupation.requiredControlDays && occupation.resistance===0 &&
          occupation.occupyingForce>0) {
        // Effective military control is not a transfer of sovereignty or civil administration.
        province.controllerStateId=occupation.occupyingStateId;
        province.occupationId=occupation.id;
        game.territorialControls ||= [];
        if (!game.territorialControls.some(item => item.id==='control-'+occupation.id)) {
          game.territorialControls.push({
            id:'control-'+occupation.id,provinceId:province.id,stateId:occupation.occupyingStateId,
            type:'militaryOccupation',effectiveFrom:game.worldDate,
            cause:'Military occupation established; sovereignty and civil administration unchanged'
          });
        }
        occupation.controlEffective=true;
        occupation.status='completed';
        for (const unit of game.militaryUnits || []) {
          if (unit.provinceId===province.id &&
              membershipFor(game,unit.ownerPlayerId,occupation.occupyingStateId))
            unit.status='garrison';
        }
        record(game,'territory.occupation_established',territory.stateId,
          'Effective military control established in '+territory.name+
          '. Sovereignty and civil administration remain unchanged.',
          occupation.occupyingPlayerId);
      }
    }
    checkVictory(game);
  }

  function coalitionMembers(game,playerId) {
    const active=(game.memberships || []).filter(item =>
      item.status==='active' && game.players.some(player=>player.id===item.playerId));
    const adjacency=new Map((game.players || []).map(player=>[player.id,new Set()]));
    const byState=new Map();
    for(const membership of active) {
      if(!byState.has(membership.stateId)) byState.set(membership.stateId,[]);
      byState.get(membership.stateId).push(membership.playerId);
    }
    for(const members of byState.values()) {
      for(const playerIdA of members) for(const playerIdB of members)
        if(playerIdA!==playerIdB) adjacency.get(playerIdA)?.add(playerIdB);
    }
    const visited=new Set();
    const stack=[playerId];
    while(stack.length) {
      const current=stack.pop();
      if(visited.has(current)) continue;
      visited.add(current);
      for(const neighbour of adjacency.get(current) || [])
        if(!visited.has(neighbour)) stack.push(neighbour);
    }
    return visited;
  }

  function coalitionStates(game,playerId) {
    const members=coalitionMembers(game,playerId);
    return new Set((game.memberships || [])
      .filter(item=>item.status==='active' && members.has(item.playerId))
      .map(item=>item.stateId));
  }

  function checkVictory(game) {
    if (!game || game.status!=='running' || !game.territories?.length) return [];
    const stateIds=game.territories.map(item => item.stateId);
    const winners=[];
    const processed=new Set();
    for(const player of game.players || []) {
      if(processed.has(player.id)) continue;
      const coalition=coalitionMembers(game,player.id);
      for(const memberId of coalition) processed.add(memberId);
      const controlled=coalitionStates(game,player.id);
      if(stateIds.every(stateId=>controlled.has(stateId)))
        winners.push(...(game.players || []).filter(candidate=>coalition.has(candidate.id)));
    }
    if (!winners.length) return [];
    const uniqueWinners=[...new Map(winners.map(player=>[player.id,player])).values()];
    game.status='completed';
    game.paused=true;
    game.completedOn=game.worldDate;
    game.winnerPlayerIds=uniqueWinners.map(player=>player.id);
    record(game,'campaign.victory',null,
      'Campaign victory: '+uniqueWinners.map(player => player.name).join(', ')+
      ' established cooperative administration across all '+stateIds.length+' territories.',
      uniqueWinners[0].id);
    return uniqueWinners;
  }

  function objectivesFor(game,playerId) {
    const controlledStates=coalitionStates(game,playerId);
    const controlled=(game.territories || []).filter(item =>
      item.ownerPlayerId===playerId || controlledStates.has(item.stateId));
    const owned=controlled.length;
    const buildings=controlled.reduce((sum,item) =>
      sum+Object.values(item.buildings || {}).filter(building => Number(building.daysRemaining||0)<=0).length,0);
    const completedResearch=(game.researchProjects || []).filter(item => item.status==='completed' &&
      controlledStates.has(item.stateId)).length;
    const adopted=(game.technologyAdoptions || []).filter(item =>
      controlledStates.has(item.stateId) && !item.provinceId && !item.sector).length;
    const activePolicies=(game.politicalSystems || [])
      .filter(item => controlledStates.has(item.stateId))
      .reduce((sum,item)=>sum+(item.policies || []).length,0);
    const friendlyUnitIds=new Set((game.militaryUnits || [])
      .filter(item => controlledStates.has(item.stateId) && item.personnel>0)
      .map(item => item.id));
    const wonBattles=(game.militaryBattles || []).filter(item =>
      item.result==='Attacker victory' &&
      (item.participantUnitIds || []).some(unitId => friendlyUnitIds.has(unitId))).length;
    return [
      {id:'settlement',name:'Build a functioning settlement',description:'Complete 5 buildings in your administered territories.',progress:buildings,target:5},
      {id:'regional-power',name:'Become a regional power',description:'Administer 4 territories.',progress:owned,target:4},
      {id:'knowledge',name:'Invest in knowledge',description:'Complete 2 research projects in your governments.',progress:completedResearch,target:2},
      {id:'modernisation',name:'Modernise your government',description:'Adopt 2 discovered technologies.',progress:adopted,target:2},
      {id:'military',name:'Prove your military strength',description:'Win 3 recorded battles.',progress:wonBattles,target:3},
      {id:'reform',name:'Enact public reform',description:'Approve 2 public policy laws.',progress:activePolicies,target:2},
      {id:'unification',name:'Unify Beleland',description:'Administer all 16 territories.',progress:owned,target:16}
    ].map(objective => ({...objective,completed:objective.progress>=objective.target}));
  }

  const api=Object.freeze({
    createStarterScenario,onClaim,applyOrder,advanceDay,effectValue,objectivesFor,checkVictory
  });
  globalThis.NewWorldStrategy=api;
  if (typeof module!=='undefined' && module.exports) module.exports=api;
})();
