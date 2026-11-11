(() => {
  'use strict';

  const PERMISSIONS = ['government-member','government-council','government-executive'];
  const UNIT_TYPES = [
    {id:'militia',name:'Militia',recruitmentCost:220,personnelPerRecruit:100,strength:1,commandPermissionSetIds:PERMISSIONS},
    {id:'infantry',name:'Professional infantry',recruitmentCost:420,personnelPerRecruit:100,strength:1.55,requiredTechnologyId:'military_drill',commandPermissionSetIds:PERMISSIONS},
    {id:'cavalry',name:'Cavalry',recruitmentCost:650,personnelPerRecruit:80,strength:2.1,requiredTechnologyId:'logistics',commandPermissionSetIds:PERMISSIONS}
  ];
  const POLICY_EFFECTS = Object.freeze({
    public_works:{name:'Public works programme',effectId:'construction_discount',value:0.05,minValue:0.01,maxValue:0.15},
    conscription:{name:'National service act',effectId:'recruitment_discount',value:0.08,minValue:0.01,maxValue:0.15},
    agricultural_program:{name:'Agricultural development act',effectId:'population_growth_bonus',value:0.10,minValue:0.01,maxValue:0.25}
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
    globalThis.NewWorldMilitaryLogistics?.ensure?.(game);

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
            legalBasis:'Government Organisation Act',institutionId:'executive'}
        ]
      },
      government:{program:'Frontier development',budget:400,legitimacy:60},
      institutions:[
        {id:'assembly',name:'State Assembly',branch:'legislative'},
        {id:'executive',name:'Executive Council',branch:'executive'}
      ],
      offices:[
        {id:'chief-executive',institutionId:'executive',name:'Chief Executive',holderPlayerId:null},
        {id:'treasurer',institutionId:'executive',name:'Treasurer',holderPlayerId:null}
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
        if (office.id==='chief-executive' || office.id==='treasurer')
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

  function completeDecision(game,system,decision,approved,createId) {
    decision.status=approved?'approved':'rejected';
    decision.resolvedOn=game.worldDate;
    if (approved && decision.competence==='proposeLaw') {
      const law={
        id:'law-'+decision.id,title:decision.title,text:decision.text,status:'enacted',
        legalBasis:decision.legalBasis,effectiveFrom:game.worldDate,
        proposedBy:decision.proposedBy,decisionId:decision.id
      };
      system.laws.push(law);
      globalThis.NewWorldBureaucracy?.onLawEnacted?.(game,system,law,decision,createId);
      const policy=POLICY_EFFECTS[decision.policyId];
      if (policy) {
        system.policies ||= [];
        system.policies.push({
          id:'policy-'+decision.id,policyId:decision.policyId,
          name:policy.name,effectId:policy.effectId,
          value:Number.isFinite(decision.policyValue) ? decision.policyValue : policy.value,
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
    if(order.type==='movePopulation') {
      if (membership.permissionSetId==='government-observer')
        return {ok:false,code:'INSUFFICIENT_PERMISSION',
          error:'Observer memberships cannot move population groups.'};
      const result=globalThis.NewWorldDemography?.movePopulation?.(
        game,order,player,membership,createId);
      return result || {ok:false,code:'DEMOGRAPHY_NOT_LOADED',
        error:'The demographic simulation module is unavailable.'};
    }
    const territory=territoryFor(game,stateId);
    const system=politicalFor(game,stateId);
    if (!territory) return {ok:false,code:'INVALID_STATE',error:'The selected government no longer exists.'};
    if (membership.permissionSetId==='government-observer')
      return {ok:false,code:'INSUFFICIENT_PERMISSION',error:'Observer memberships cannot issue government, military or research orders.'};

    if (order.type==='declareWar') {
      const targetStateId=String(order.targetStateId || '');
      const target=territoryFor(game,targetStateId);
      const relation=relationFor(game,stateId,targetStateId);
      if (!target || targetStateId===stateId || !relation)
        return {ok:false,code:'INVALID_DIPLOMATIC_TARGET',error:'Choose a valid foreign State.'};
      if (!target.ownerPlayerId || target.ownerPlayerId===player.id ||
          membershipFor(game,player.id,targetStateId))
        return {ok:false,code:'NOT_HOSTILE_STATE',error:'War can only be declared against another administered government.'};
      if (relation.status==='war')
        return {ok:false,code:'WAR_ALREADY_ACTIVE',error:'The two States are already at war.'};
      if (globalThis.NewWorldDiplomacy?.isWarProhibited?.(game,stateId,targetStateId))
        return {ok:false,code:'NON_AGGRESSION_TREATY_ACTIVE',error:'An active non-aggression treaty prevents a declaration of war.'};
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
      const logistics=globalThis.NewWorldMilitaryLogistics||
        globalThis.window?.NewWorldMilitaryLogistics;
      const strength=(candidate) => {
        const type=(game.militaryUnitTypes || []).find(item => item.id===candidate.unitTypeId);
        const doctrine=effectValue(game,candidate.stateId,'military_strength');
        const commander=(game.militaryCommanders || []).find(item => item.id===candidate.commanderId);
        const supplyMultiplier=logistics?.combatMultiplier?.(game,candidate)??1;
        return Math.max(0,Number(candidate.personnel)||0) *
          Number(type?.strength||1) * supplyMultiplier *
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
      const policy=POLICY_EFFECTS[policyId];
      if (!policy)
        return {ok:false,code:'INVALID_POLICY',error:'Choose a valid public policy for this bill.'};
      if ((system.policies || []).some(item => item.policyId===policyId))
        return {ok:false,code:'POLICY_ALREADY_ACTIVE',error:'This public policy is already active in the State.'};
      const policyValue=order.policyValue===undefined ? policy.value : Number(order.policyValue);
      if (!Number.isFinite(policyValue) || policyValue<policy.minValue || policyValue>policy.maxValue)
        return {ok:false,code:'INVALID_POLICY',error:'Policy strength must stay within its configured range.'};
      const decision={
        id:idFor(createId),competence:'proposeLaw',title,text,policyId,policyValue,
        status:rule.approvalRequired?'pendingApproval':'approved',
        votes:[],legalBasis:rule.legalBasis,proposedBy:player.id,
        proposedOn:game.worldDate,institutionId:rule.institutionId
      };
      system.decisions.push(decision);
      if (!rule.approvalRequired) completeDecision(game,system,decision,true,createId);
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
        completeDecision(game,system,decision,true,createId);
      else if (no/Math.max(1,eligible.length)>1-threshold ||
          decision.votes.length>=eligible.length && yes/Math.max(1,eligible.length)<threshold)
        completeDecision(game,system,decision,false,createId);
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
      const office=(system.offices || []).find(item =>
        item.id===order.officeId && item.institutionId===rule.institutionId);
      const appointee=game.players.find(item => item.id===order.appointeePlayerId);
      if (!office || !appointee || !membershipFor(game,appointee.id,stateId))
        return {ok:false,code:'INVALID_APPOINTMENT',error:'The office or appointee is not eligible in this State.'};
      const previousOfficeHolderIds=(system.offices || [])
        .map(item=>item.holderPlayerId).filter(Boolean);
      const previousHolderId=office.holderPlayerId;
      office.holderPlayerId=appointee.id;
      if (office.id==='chief-executive') {
        system.government.chiefExecutivePlayerId=appointee.id;
        if(previousHolderId && previousHolderId!==appointee.id)
          globalThis.NewWorldBureaucracy?.onGovernmentChange?.(
            game,stateId,previousOfficeHolderIds,createId);
      }
      record(game,'government.office_appointed',stateId,
        player.name+' appointed '+appointee.name+' as '+office.name+'.',player.id);
      return {ok:true};
    }

    return {ok:false,code:'UNSUPPORTED_ORDER',error:'This order is not supported by the strategy rules.'};
  }

  function advanceDay(game) {
    const logistics=globalThis.NewWorldMilitaryLogistics||
      globalThis.window?.NewWorldMilitaryLogistics;
    const logisticsResult=logistics?.advanceDay?.(game,()=>
      'military-supply-'+game.id+'-'+(++game.eventSequence));
    if(logisticsResult&&!logisticsResult.ok)
      throw new Error(logisticsResult.error||'Military logistics could not advance.');
    for (const unit of game.militaryUnits || []) {
      if (unit.personnel<=0) continue;
      const supplyConfigured=(game.supplyRules||[]).some(rule=>
        rule.stateId===unit.stateId&&rule.unitTypeId===unit.unitTypeId);
      const supplied=unit.supplyStatus!=='undersupplied';
      if(!supplyConfigured||supplied)
        unit.morale=Math.min(100,(Number(unit.morale)||0)+2);
      if (['recovering','occupying','garrison'].includes(unit.status)) {
        const maximum=Number(unit.maxPersonnel)||Number(unit.personnel);
        const baseRecovery=Math.max(1,Math.ceil(maximum*.025));
        const recovery=supplyConfigured&&!supplied
          ? Math.floor(baseRecovery*Math.max(0,Math.min(100,Number(unit.supplyCoveragePercent)||0))/100)
          : baseRecovery;
        unit.personnel=Math.min(maximum,unit.personnel+recovery);
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
        const previousOwner=territory.ownerPlayerId;
        if (previousOwner && previousOwner!==occupation.occupyingPlayerId) {
          for (const member of game.memberships || [])
            if (member.stateId===territory.stateId && member.status==='active') member.status='displaced';
        }
        territory.ownerPlayerId=occupation.occupyingPlayerId;
        const invadingMembers=(game.memberships || []).filter(item =>
          item.stateId===occupation.occupyingStateId && item.status==='active');
        for (const member of invadingMembers) {
          if (!membershipFor(game,member.playerId,territory.stateId))
            game.memberships.push({
              id:'membership-'+territory.stateId+'-'+member.playerId,
              gameId:game.id,playerId:member.playerId,stateId:territory.stateId,status:'active',
              permissionSetId:member.permissionSetId,joinedAtWorldDate:game.worldDate
            });
        }
        const previousSovereignStateId=province.sovereignStateId;
        province.sovereignStateId=occupation.occupyingStateId;
        onClaim(game,territory,occupation.occupyingPlayerId,idFor);
        game.territorialControls ||= [];
        game.sovereigntyHistory ||= [];
        game.territorialControls.push({
          id:'control-'+occupation.id,provinceId:province.id,stateId:occupation.occupyingStateId,
          type:'militaryOccupation',effectiveFrom:game.worldDate,cause:'Successful military campaign'
        });
        game.sovereigntyHistory.push({
          id:'sovereignty-'+occupation.id,provinceId:province.id,
          previousStateId:previousSovereignStateId,newStateId:occupation.occupyingStateId,
          effectiveOn:game.worldDate,legalMechanism:'Military conquest and completed occupation'
        });
        occupation.controlEffective=true;
        occupation.status='completed';
        for (const unit of game.militaryUnits || []) {
          if (unit.provinceId!==province.id) continue;
          if (membershipFor(game,unit.ownerPlayerId,occupation.occupyingStateId))
            unit.status='garrison';
          else {
            unit.personnel=0;
            unit.status='destroyed';
          }
        }
        record(game,'territory.conquered',territory.stateId,
          'Territory conquered and transferred to the occupying government: '+territory.name+'.',
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
