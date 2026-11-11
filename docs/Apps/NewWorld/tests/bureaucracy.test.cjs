'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const simulation=require('../simulation.js');
const strategy=require('../strategy.js');
const justice=require('../justice.js');
const resources=require('../resources.js');
const bureaucracy=require('../bureaucracy.js');

globalThis.NewWorldBureaucracy=bureaucracy;
globalThis.NewWorldResources=resources;
global.window={
  NewWorldSimulation:simulation,NewWorldStrategy:strategy,
  NewWorldJustice:justice,NewWorldResources:resources,
  NewWorldBureaucracy:bureaucracy
};
const multiplayer=require('../multiplayer.js');
let sequence=0;

function freshWorld() {
  return multiplayer.createInitialWorld('Administration Test').game;
}

function buildConfiguration(game,options={}) {
  const territory=game.territories[0];
  const stateId=territory.stateId;
  const province=game.provinces.find(item=>item.stateId===stateId);
  const political=game.politicalSystems.find(item=>item.stateId===stateId);
  let office=political.offices?.[0];
  if(!office) {
    office={id:'civil-supervisor',name:'Civil Supervisor',holderPlayerId:game.players[0].id};
    political.offices ||= [];
    political.offices.push(office);
  } else {
    office.holderPlayerId=game.players[0].id;
  }
  const configuration={
    administrativeAgencies:[{
      id:'public-works-agency',stateId,name:'Public Works Agency',
      competenceIds:['public_works'],supervisingOfficeIds:[office.id],
      infrastructureCapacityPercent:100,coordinationPercent:100,
      corruptionIndex:0,officeCapacity:20
    }],
    administrativeDepartments:[{
      id:'roads-department',stateId,agencyId:'public-works-agency',
      name:'Roads Department',competenceIds:['public_works'],
      provinceIds:[province.id]
    }],
    civilServants:options.staff===false?[]:[{
      id:'civil-service-team',stateId,agencyId:'public-works-agency',
      departmentId:'roads-department',name:'Public Works Civil Servants',
      appointmentBasis:'merit',status:'active',headcount:2,
      dailyWorkUnitsPerPerson:1,qualificationPercent:100,experiencePercent:100,
      meritScore:100,institutionalLoyaltyPercent:100,corruptionRiskPercent:0,
      salaryPerDay:0
    }],
    administrativeProcedures:[{
      id:'build-public-road',stateId,agencyId:'public-works-agency',
      departmentId:'roads-department',name:'Construct the approved public road',
      competenceId:'public_works',triggerPolicyIds:['public_works'],triggerLawIds:[],
      provinceIds:[province.id],priority:75,deadlineDays:10,
      steps:[{
        id:'survey-step',name:'Complete provincial engineering survey',
        workUnits:options.workUnits??4,cost:options.cost??40,
        requiredDocuments:options.documents===false?[]:['survey-plan'],
        milestoneId:'road-survey-milestone'
      }]
    }],
    administrativeJurisdictions:[{
      id:'public-works-jurisdiction',stateId,agencyId:'public-works-agency',
      level:'local',provinceIds:[province.id]
    }],
    administrativeBudgets:[{
      id:'public-works-budget',stateId,agencyId:'public-works-agency',
      currencyId:territory.currencyId,openingBalance:options.openingBalance??100,
      dailyAllocation:options.dailyAllocation??0,minimumReserve:0
    }],
    publicProjects:[{
      id:'north-road-project',stateId,agencyId:'public-works-agency',
      provinceId:province.id,name:'Northern public road',
      approvedBudget:500,spent:0,status:'planned',
      milestones:[{
        id:'road-survey-milestone',name:'Provincial survey',
        workUnits:options.workUnits??4,completedWorkUnits:0,status:'pending',
        inspectionOfficeIds:[office.id]
      }]
    }],
    procurementVendors:[{
      id:'road-builder-co',stateId,name:'Road Builder Company',
      competenceIds:['public_works'],integrityScore:90,
      capacityPercent:100,status:'active'
    }]
  };
  return {configuration,territory,province,political,office};
}

function configure(game,options={}) {
  const values=buildConfiguration(game,options);
  const validation=bureaucracy.validateConfiguration(game,values.configuration);
  assert.equal(validation.ok,true,validation.error);
  const saved=multiplayer.applyAdmin(game,'configure',{
    kind:'bureaucracy',configuration:values.configuration
  });
  assert.equal(saved.ok,true,saved.error);
  return values;
}

function enactMappedPolicy(game,values) {
  const political=values.political;
  const law={
    id:'public-works-act',title:'Public Works Act',
    text:'The public authority approves the proposed road programme.',
    status:'enacted',effectiveFrom:game.worldDate
  };
  political.laws.push(law);
  const decision={
    id:'public-works-decision',policyId:'public_works',
    proposedBy:game.players[0].id,title:law.title
  };
  const result=bureaucracy.onLawEnacted(game,political,law,decision,()=>{
    return 'admin-generated-'+(++sequence);
  });
  return result;
}

function start(game) {
  const result=multiplayer.applyAdmin(game,'start',{});
  assert.equal(result.ok,true,result.error);
}

function advance(game) {
  const result=simulation.advanceDay(game);
  assert.equal(result.ok,true,result.error);
  return result;
}

function submit(game,player,type,payload={}) {
  const membership=game.memberships.find(item=>
    item.playerId===player.id && item.status==='active' && item.stateId===payload.stateId);
  assert.ok(membership,'player needs an active government membership');
  return multiplayer.applyOrder(game,player,{
    orderId:'bureaucracy-order-'+(++sequence),gameId:game.id,playerId:player.id,
    expectedWorldVersion:game.worldVersion,stateId:membership.stateId,type,...payload
  });
}

test('new worlds have empty administrative registers; no agencies or staff are fabricated',()=>{
  const game=freshWorld();
  for(const field of bureaucracy.configurationFields)
    assert.deepEqual(game[field],[],field+' must start empty');
  for(const field of bureaucracy.dynamicFields)
    assert.deepEqual(game[field],[],field+' must start empty');
  assert.equal(game.territories.length,16);
});

test('configuration rejects invalid provincial jurisdiction, missing agency budgets and unauthorized departments',()=>{
  const game=freshWorld();
  const {configuration}=buildConfiguration(game);
  const invalidJurisdiction=structuredClone(configuration);
  invalidJurisdiction.administrativeJurisdictions[0].provinceIds=['nonexistent-province'];
  assert.match(bureaucracy.validateConfiguration(game,invalidJurisdiction).error,/real provinces/i);

  const missingBudget=structuredClone(configuration);
  missingBudget.administrativeBudgets=[];
  assert.match(bureaucracy.validateConfiguration(game,missingBudget).error,/requires its own budget/i);

  const invalidDepartment=structuredClone(configuration);
  invalidDepartment.administrativeDepartments[0].competenceIds=['military_command'];
  assert.match(bureaucracy.validateConfiguration(game,invalidDepartment).error,/parent agency competencies/i);

  const invalidSupervisor=structuredClone(configuration);
  invalidSupervisor.administrativeAgencies[0].supervisingOfficeIds=['unknown-political-office'];
  assert.match(bureaucracy.validateConfiguration(game,invalidSupervisor).error,/supervisory offices/i);
});

test('a law creates a queued task only when an authorized procedure is explicitly mapped to its policy',()=>{
  const game=freshWorld();
  const values=configure(game);
  const created=enactMappedPolicy(game,values);
  assert.equal(created.created,1);
  assert.equal(game.administrativeTasks.length,1);
  const task=game.administrativeTasks[0];
  assert.equal(task.status,'queued');
  assert.equal(task.progressPercent,0);
  assert.equal(task.lawId,'public-works-act');
  assert.equal(task.provinceId,values.province.id);
  assert.equal(task.steps[0].completedWorkUnits,0);
  assert.equal(task.completedOn,null);
  assert.equal(game.publicProjects[0].milestones[0].status,'pending');

  const duplicate=enactMappedPolicy(game,values);
  assert.equal(duplicate.created,0);
  assert.equal(game.administrativeTasks.length,1);
});

test('an approved law without a configured administrative procedure does not auto-complete the policy',()=>{
  const game=freshWorld();
  const values=configure(game);
  game.administrativeProcedures=[];
  const created=enactMappedPolicy(game,values);
  assert.equal(created.created,0);
  assert.equal(game.administrativeTasks.length,0);
});

test('missing staff and money block execution instead of completing administrative work',()=>{
  const game=freshWorld();
  const values=configure(game,{staff:false,openingBalance:0,dailyAllocation:0});
  enactMappedPolicy(game,values);
  start(game);
  advance(game);
  const task=game.administrativeTasks[0];
  assert.equal(task.progressPercent,0);
  assert.equal(task.status,'blocked_staff');

  const staff=game.civilServants;
  staff.push({
    id:'late-appointed-clerk',stateId:values.territory.stateId,
    agencyId:'public-works-agency',name:'Late appointed clerk',
    appointmentBasis:'merit',status:'active',headcount:1,
    dailyWorkUnitsPerPerson:1,qualificationPercent:100,experiencePercent:100,
    meritScore:100,institutionalLoyaltyPercent:100,corruptionRiskPercent:0,
    salaryPerDay:0
  });
  advance(game);
  const refreshedTask=game.administrativeTasks[0];
  assert.equal(refreshedTask.progressPercent,0);
  assert.equal(refreshedTask.status,'blocked_budget');
  assert.equal(refreshedTask.completedOn,null);
});

test('procedural documents must be received by an authorized supervisor before the task can progress',()=>{
  const game=freshWorld();
  const values=configure(game);
  enactMappedPolicy(game,values);
  start(game);
  advance(game);
  const task=game.administrativeTasks[0];
  assert.equal(task.status,'awaiting_documents');
  assert.equal(task.progressPercent,0);

  const player=game.players[0];
  const denied={...player,id:'admin-observer',name:'Observer'};
  game.players.push(denied);
  game.memberships.push({
    id:'admin-observer-membership',gameId:game.id,playerId:denied.id,
    stateId:values.territory.stateId,status:'active',permissionSetId:'government-member'
  });
  const unauthorized=multiplayer.applyOrder(game,denied,{
    orderId:'admin-doc-denied',gameId:game.id,playerId:denied.id,
    expectedWorldVersion:game.worldVersion,stateId:values.territory.stateId,
    type:'administration.submitDocument',taskId:task.id,documentId:'survey-plan'
  });
  assert.equal(unauthorized.accepted,false);
  assert.equal(unauthorized.code,'ADMIN_AUTHORITY_REQUIRED');

  const accepted=multiplayer.applyOrder(game,player,{
    orderId:'admin-doc-accepted',gameId:game.id,playerId:player.id,
    expectedWorldVersion:game.worldVersion,stateId:values.territory.stateId,
    type:'administration.submitDocument',taskId:task.id,documentId:'survey-plan'
  });
  assert.equal(accepted.accepted,true,accepted.error);
  assert.equal(task.steps[0].documentsSubmitted[0].documentId,'survey-plan');
  const duplicate=multiplayer.applyOrder(game,player,{
    orderId:'admin-doc-duplicate',gameId:game.id,playerId:player.id,
    expectedWorldVersion:game.worldVersion,stateId:values.territory.stateId,
    type:'administration.submitDocument',taskId:task.id,documentId:'survey-plan'
  });
  assert.equal(duplicate.accepted,false);
  assert.equal(duplicate.code,'ADMIN_DOCUMENT_DUPLICATE');
});

test('capacity and funds produce partial work, expenses and a project milestone awaiting inspection',()=>{
  const game=freshWorld();
  const values=configure(game,{workUnits:4,cost:40,openingBalance:10,dailyAllocation:10,documents:false});
  values.territory.treasury=100;
  enactMappedPolicy(game,values);
  start(game);
  const initialBalance=game.administrativeBudgets[0].balance;
  advance(game);
  const task=game.administrativeTasks[0];
  assert.equal(task.progressPercent,50);
  assert.equal(task.steps[0].completedWorkUnits,2);
  assert.equal(task.spent,20);
  assert.equal(game.administrativeBudgets[0].balance,0);
  assert.equal(task.status,'in_progress');
  assert.equal(game.publicProjects[0].milestones[0].status,'in_progress');
  assert.equal(initialBalance,10);

  advance(game);
  const nextTask=game.administrativeTasks[0];
  assert.equal(nextTask.progressPercent,75);
  assert.equal(nextTask.completedOn,null);
  assert.equal(nextTask.status,'in_progress');
});

test('changing political leadership does not delete or rewrite civil-service posts',()=>{
  const game=freshWorld();
  const values=configure(game);
  const before=structuredClone(game.civilServants);
  const previousHolders=values.political.offices.map(item=>item.holderPlayerId).filter(Boolean);
  const retained=bureaucracy.onGovernmentChange(game,values.territory.stateId,
    previousHolders,()=> 'transition-'+(++sequence));
  assert.equal(retained,1);
  assert.deepEqual(game.civilServants,before);
  assert.ok(game.administrativeHistory.some(item=>item.type==='government_transition'));
});

test('agency capacity is reduced by corruption and coordination and respects office capacity',()=>{
  const game=freshWorld();
  const values=configure(game);
  const agency=game.administrativeAgencies[0];
  const base=bureaucracy.calculateAgencyCapacity(game,agency);
  assert.equal(base.effectiveDailyWorkUnits,2);
  agency.corruptionIndex=50;
  agency.coordinationPercent=50;
  agency.officeCapacity=0.5;
  const reduced=bureaucracy.calculateAgencyCapacity(game,agency);
  assert.equal(reduced.effectiveDailyWorkUnits,0.125);
  assert.equal(reduced.activeHeadcount,2);
});

test('an agency cannot work outside the competence or province scope of its procedure',()=>{
  const game=freshWorld();
  const values=configure(game);
  const foreignProvince=game.provinces.find(item=>item.stateId!==values.territory.stateId);
  game.administrativeProcedures[0].provinceIds=[foreignProvince.id];
  const checked=bureaucracy.validateConfiguration(game,{
    administrativeAgencies:game.administrativeAgencies,
    administrativeDepartments:game.administrativeDepartments,
    civilServants:game.civilServants,
    administrativeProcedures:game.administrativeProcedures,
    administrativeJurisdictions:game.administrativeJurisdictions,
    administrativeBudgets:game.administrativeBudgets,
    publicProjects:game.publicProjects,
    procurementVendors:game.procurementVendors
  });
  assert.equal(checked.ok,false);
  assert.match(checked.error,/procedure needs an authorized agency/i);
});


test('a final procedural step completes the task in the same day but leaves the public project awaiting inspection',()=>{
  const game=freshWorld();
  const values=configure(game,{workUnits:2,cost:0,openingBalance:100,dailyAllocation:0,documents:false});
  enactMappedPolicy(game,values);
  start(game);
  const result=advance(game);
  const task=game.administrativeTasks[0];
  const project=game.publicProjects[0];
  assert.equal(task.progressPercent,100);
  assert.equal(task.status,'completed');
  assert.equal(task.completedOn,game.worldDate);
  assert.ok(result);
  assert.equal(project.milestones[0].status,'awaiting_inspection');
  assert.equal(project.status,'awaiting_inspection');
  assert.equal(project.spent,0);
  assert.equal(game.administrativeHistory.some(item=>
    item.type==='task_completed' && item.details.taskId===task.id),true);
});

test('payroll arrears are retained and cleared only after current and outstanding salaries are both paid',()=>{
  const game=freshWorld();
  const values=configure(game,{openingBalance:0,dailyAllocation:0,documents:false});
  game.civilServants[0].salaryPerDay=5;
  enactMappedPolicy(game,values);
  start(game);
  advance(game);
  assert.equal(game.administrativeBudgets[0].payrollArrears,10);
  assert.equal(game.administrativeTasks[0].status,'blocked_budget');
  game.administrativeBudgets[0].balance=20;
  advance(game);
  assert.equal(game.administrativeBudgets[0].payrollArrears,0);
  assert.equal(game.administrativeBudgets[0].balance,0);
  assert.ok(game.administrativeHistory.some(item=>
    item.type==='payroll_paid' && item.details.arrearsCleared===10));
});


test('project inspection requires a configured inspector, written evidence and an explicit outcome',()=>{
  const game=freshWorld();
  const values=configure(game,{workUnits:2,cost:0,openingBalance:100,dailyAllocation:0,documents:false});
  enactMappedPolicy(game,values);
  start(game);
  advance(game);
  const project=game.publicProjects[0];
  const milestone=project.milestones[0];
  assert.equal(milestone.status,'awaiting_inspection');
  assert.equal(project.status,'awaiting_inspection');

  const observer={id:'admin-project-observer',name:'Project Observer',
    connected:true,token:'admin-project-observer-token'};
  game.players.push(observer);
  game.memberships.push({
    id:'admin-project-observer-membership',gameId:game.id,
    playerId:observer.id,stateId:values.territory.stateId,
    status:'active',permissionSetId:'government-member'
  });
  const denied=submit(game,observer,'administration.inspectProjectMilestone',{
    stateId:values.territory.stateId,projectId:project.id,milestoneId:milestone.id,
    outcome:'accepted',evidence:'The completed work was inspected and verified.'
  });
  assert.equal(denied.accepted,false);
  assert.equal(denied.code,'ADMIN_INSPECTOR_AUTHORITY_REQUIRED');

  const noEvidence=submit(game,game.players[0],'administration.inspectProjectMilestone',{
    stateId:values.territory.stateId,projectId:project.id,milestoneId:milestone.id,
    outcome:'accepted',evidence:'short'
  });
  assert.equal(noEvidence.accepted,false);
  assert.equal(noEvidence.code,'ADMIN_INSPECTION_EVIDENCE_REQUIRED');
  assert.equal(milestone.status,'awaiting_inspection');

  const accepted=submit(game,game.players[0],'administration.inspectProjectMilestone',{
    stateId:values.territory.stateId,projectId:project.id,milestoneId:milestone.id,
    outcome:'accepted',evidence:'The completed work was inspected and verified against the approved project requirements.'
  });
  assert.equal(accepted.accepted,true,accepted.error);
  const updated=game.publicProjects[0];
  assert.equal(updated.milestones[0].status,'accepted');
  assert.equal(updated.status,'completed');
  assert.ok(updated.milestones[0].inspectionEvidence);
  assert.equal(game.publicProjectAudits.length,1);
  assert.equal(game.administrativeHistory.at(-1).type,'project_milestone_inspected');
});

test('a rejected project inspection records rectification instead of marking the project completed',()=>{
  const game=freshWorld();
  const values=configure(game,{workUnits:2,cost:0,openingBalance:100,dailyAllocation:0,documents:false});
  enactMappedPolicy(game,values);
  start(game);
  advance(game);
  const project=game.publicProjects[0];
  const milestone=project.milestones[0];
  const rejected=submit(game,game.players[0],'administration.inspectProjectMilestone',{
    stateId:values.territory.stateId,projectId:project.id,milestoneId:milestone.id,
    outcome:'rejected',evidence:'The survey failed the required technical tolerance and must be rectified.'
  });
  assert.equal(rejected.accepted,true,rejected.error);
  assert.equal(game.publicProjects[0].status,'rectification_required');
  assert.equal(game.publicProjects[0].milestones[0].status,'rejected');
  assert.equal(game.publicProjects[0].completedOn,undefined);
});


test('public procurement reserves the budget, awards the lowest valid offer, requires independent inspection and pays only after acceptance',()=>{
  const game=freshWorld();
  const {territory,political,province}=configure(game);
  const host=game.players[0];
  const inspector={
    id:'independent-inspector-player',name:'Independent Inspector',isHost:false,
    countryIndex:null,treasury:0,dailyBalanceRemainder:0,buildings:{},
    connected:true,token:'independent-inspector-token'
  };
  game.players.push(inspector);
  const hostMembership=game.memberships.find(item=>item.playerId===host.id&&
    item.stateId===territory.stateId&&item.status==='active');
  game.memberships.push({...hostMembership,id:'independent-inspector-membership',
    playerId:inspector.id,permissionSetId:hostMembership.permissionSetId});
  political.offices.push({
    id:'independent-procurement-inspector-office',
    name:'Independent Procurement Inspector',holderPlayerId:inspector.id
  });
  start(game);

  const opened=submit(game,host,'administration.procurement.openTender',{
    stateId:territory.stateId,agencyId:'public-works-agency',
    provinceId:province.id,competenceId:'public_works',
    inspectionOfficeId:'independent-procurement-inspector-office',
    title:'Northern road resurfacing contract',
    scope:'Resurface the approved road segment and document materials, work completion and handover.',
    estimatedAmount:50,submissionDays:1
  });
  assert.equal(opened.accepted,true,opened.error);
  const tender=game.procurements.find(item=>item.title==='Northern road resurfacing contract');
  const budget=game.administrativeBudgets.find(item=>item.agencyId==='public-works-agency');
  assert.equal(tender.status,'open');
  assert.equal(budget.balance,100);
  assert.equal(budget.reservedForProcurement,50);

  game.procurementVendors.push({
    id:'road-builder-cheap',stateId:territory.stateId,name:'Lower Cost Road Builder',
    competenceIds:['public_works'],integrityScore:85,capacityPercent:100,status:'active'
  });
  const highBid=submit(game,host,'administration.procurement.registerBid',{
    stateId:territory.stateId,tenderId:tender.id,vendorId:'road-builder-co',
    amount:40,deliveryDays:12,offerReference:'Offer RB-2026-001, signed and received.'
  });
  const lowBid=submit(game,host,'administration.procurement.registerBid',{
    stateId:territory.stateId,tenderId:tender.id,vendorId:'road-builder-cheap',
    amount:35,deliveryDays:15,offerReference:'Offer LCRB-2026-002, signed and received.'
  });
  assert.equal(highBid.accepted,true,highBid.error);
  assert.equal(lowBid.accepted,true,lowBid.error);
  assert.equal(submit(game,host,'administration.procurement.registerBid',{
    stateId:territory.stateId,tenderId:tender.id,vendorId:'road-builder-cheap',
    amount:34,deliveryDays:15,offerReference:'Duplicate offer must be rejected.'
  }).code,'ADMIN_TENDER_DUPLICATE_BID');

  game.worldDate='1500-01-03';
  bureaucracy.advanceDay(game,()=> 'procurement-cycle-'+(++sequence));
  assert.equal(tender.status,'bids_closed');
  const awarded=submit(game,host,'administration.procurement.awardTender',{
    stateId:territory.stateId,tenderId:tender.id
  });
  assert.equal(awarded.accepted,true,awarded.error);
  assert.equal(tender.award.vendorId,'road-builder-cheap');
  assert.equal(tender.award.amount,35);
  assert.equal(budget.reservedForProcurement,35);

  const delivered=submit(game,host,'administration.procurement.recordDelivery',{
    stateId:territory.stateId,tenderId:tender.id,
    evidence:'Delivery manifest received with materials and completion documents.'
  });
  assert.equal(delivered.accepted,true,delivered.error);
  assert.equal(tender.status,'awaiting_inspection');
  assert.equal(submit(game,host,'administration.procurement.inspectDelivery',{
    stateId:territory.stateId,tenderId:tender.id,outcome:'accepted',
    evidence:'Same officer cannot approve their own tender and award.'
  }).code,'ADMIN_TENDER_INSPECTOR_AUTHORITY_REQUIRED');

  political.offices.find(item=>item.id==='independent-procurement-inspector-office')
    .holderPlayerId=host.id;
  assert.equal(submit(game,host,'administration.procurement.inspectDelivery',{
    stateId:territory.stateId,tenderId:tender.id,outcome:'accepted',
    evidence:'Conflict of interest must block this inspection.'
  }).code,'ADMIN_TENDER_INSPECTOR_CONFLICT');
  political.offices.find(item=>item.id==='independent-procurement-inspector-office')
    .holderPlayerId=inspector.id;
  const inspected=submit(game,inspector,'administration.procurement.inspectDelivery',{
    stateId:territory.stateId,tenderId:tender.id,outcome:'accepted',
    evidence:'Independent inspection confirms the contracted delivery.'
  });
  assert.equal(inspected.accepted,true,inspected.error);
  assert.equal(tender.status,'accepted');

  const paid=submit(game,host,'administration.procurement.payContract',{
    stateId:territory.stateId,tenderId:tender.id
  });
  assert.equal(paid.accepted,true,paid.error);
  assert.equal(tender.status,'paid');
  assert.equal(tender.payment.amount,35);
  assert.equal(budget.balance,65);
  assert.equal(budget.reservedForProcurement,0);
  assert.ok(game.administrativeHistory.some(item=>item.type==='tender_paid'));
});

test('public tenders cannot overcommit agency funds and closed tenders release reservations without valid offers',()=>{
  const game=freshWorld();
  const {territory,political,province}=configure(game);
  const host=game.players[0];
  political.offices.push({id:'independent-inspection-office',name:'Independent Inspector',holderPlayerId:null});
  start(game);
  const base={
    stateId:territory.stateId,agencyId:'public-works-agency',
    provinceId:province.id,competenceId:'public_works',
    inspectionOfficeId:'independent-inspection-office',
    title:'Local road maintenance tender',
    scope:'Maintain the specified local road section and provide a signed delivery report.',
    submissionDays:1
  };
  const opened=submit(game,host,'administration.procurement.openTender',{
    ...base,estimatedAmount:80
  });
  assert.equal(opened.accepted,true,opened.error);
  assert.equal(submit(game,host,'administration.procurement.openTender',{
    ...base,title:'Second road tender',estimatedAmount:30
  }).code,'ADMIN_TENDER_BUDGET_UNAVAILABLE');
  const tender=game.procurements.find(item=>item.title==='Local road maintenance tender');
  assert.equal(game.administrativeBudgets[0].reservedForProcurement,80);
  game.worldDate='1500-01-03';
  bureaucracy.advanceDay(game,()=> 'procurement-close-'+(++sequence));
  assert.equal(tender.status,'cancelled_no_valid_bids');
  assert.equal(tender.reservedAmount,0);
  assert.equal(game.administrativeBudgets[0].reservedForProcurement,0);
});


test('reserved procurement funds are protected from later administrative payroll and procedure spending',()=>{
  const game=freshWorld();
  const {territory,political,province}=configure(game);
  const host=game.players[0];
  const inspection={
    id:'funds-inspector-office',name:'Independent Inspector',holderPlayerId:null
  };
  political.offices.push(inspection);
  start(game);
  const opened=submit(game,host,'administration.procurement.openTender',{
    stateId:territory.stateId,agencyId:'public-works-agency',
    provinceId:province.id,competenceId:'public_works',
    inspectionOfficeId:inspection.id,title:'Reserved public works contract',
    scope:'Maintain the public road and document the full delivery and inspection process.',
    estimatedAmount:60,submissionDays:10
  });
  assert.equal(opened.accepted,true,opened.error);
  const budget=game.administrativeBudgets[0];
  const reserved=budget.reservedForProcurement;
  budget.balance=100;
  for(const servant of game.civilServants)
    servant.salaryPerDay=40;
  game.worldDate='1500-01-02';
  bureaucracy.advanceDay(game,()=> 'procurement-payroll-'+(++sequence));
  assert.equal(budget.reservedForProcurement,reserved);
  assert.equal(budget.balance,60);
  assert.equal(budget.payrollArrears,40);
  assert.ok(game.administrativeHistory.some(item=>item.type==='payroll_unpaid'));
});
