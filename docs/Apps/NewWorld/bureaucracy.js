(() => {
  'use strict';
  const CONFIG_FIELDS=['administrativeAgencies','administrativeDepartments','civilServants',
    'administrativeProcedures','administrativeJurisdictions','administrativeBudgets',
    'publicProjects','procurementVendors'];
  const DYNAMIC_FIELDS=['administrativeTasks','administrativeRecords','administrativeHistory',
    'procurements','publicProjectAudits','publicRecords'];
  const clone=value=>structuredClone(value);
  const idPattern=/^[A-Za-z0-9][A-Za-z0-9._:-]{1,99}$/;
  const cleanText=(value,min=2,max=180)=>typeof value==='string' &&
    value.trim().length>=min && value.length<=max && !/[<>\u0000-\u001f\u007f]/.test(value);
  const numberIn=(value,min,max)=>Number.isFinite(value) && value>=min && value<=max;
  const intIn=(value,min,max)=>Number.isSafeInteger(value) && value>=min && value<=max;
  const uniqueIds=items=>Array.isArray(items) &&
    items.every(item=>idPattern.test(String(item?.id || ''))) &&
    new Set(items.map(item=>item.id)).size===items.length;
  const agencyFor=(game,id)=>(game.administrativeAgencies||[]).find(item=>item.id===id);
  const budgetFor=(game,id)=>(game.administrativeBudgets||[]).find(item=>item.agencyId===id);
  const procedureFor=(game,id)=>(game.administrativeProcedures||[]).find(item=>item.id===id);

  function ensure(game) {
    if(!game || !Array.isArray(game.territories)) return game;
    for(const field of [...CONFIG_FIELDS,...DYNAMIC_FIELDS])
      if(!Array.isArray(game[field])) game[field]=[];
    for(const budget of game.administrativeBudgets)
      if(!Number.isFinite(budget.reservedForProcurement)) budget.reservedForProcurement=0;
    return game;
  }

  function validateConfiguration(game,c) {
    if(!c || CONFIG_FIELDS.some(field=>!Array.isArray(c[field])))
      return {ok:false,error:'The administrative scenario requires all eight configuration arrays.'};
    for(const field of CONFIG_FIELDS)
      if(!uniqueIds(c[field]))
        return {ok:false,error:'IDs in '+field+' must be unique, stable and valid.'};
    const states=new Map((game.territories||[]).map(x=>[x.stateId,x]));
    const provinces=new Map((game.provinces||[]).map(x=>[x.id,x.stateId]));
    const political=new Map((game.politicalSystems||[]).map(x=>[x.stateId,x]));
    const currencies=new Set((game.currencies||[]).map(x=>x.id));
    const agencies=new Map(c.administrativeAgencies.map(x=>[x.id,x]));
    const departments=new Map(c.administrativeDepartments.map(x=>[x.id,x]));
    const jurisdictions=new Map();
    const budgets=new Map(c.administrativeBudgets.map(x=>[x.agencyId,x]));

    for(const agency of c.administrativeAgencies) {
      const offices=new Set((political.get(agency.stateId)?.offices||[]).map(x=>x.id));
      if(!states.has(agency.stateId) || !cleanText(agency.name) ||
         !Array.isArray(agency.competenceIds) || !agency.competenceIds.length ||
         agency.competenceIds.some(id=>!idPattern.test(id)) ||
         new Set(agency.competenceIds).size!==agency.competenceIds.length ||
         !Array.isArray(agency.supervisingOfficeIds) || !agency.supervisingOfficeIds.length ||
         agency.supervisingOfficeIds.some(id=>!offices.has(id)) ||
         !intIn(agency.infrastructureCapacityPercent,0,200) ||
         !intIn(agency.coordinationPercent,0,200) ||
         !intIn(agency.corruptionIndex,0,100) ||
         !intIn(agency.officeCapacity,0,1000000))
        return {ok:false,error:'An agency needs an existing State, name, competencies, supervisory offices, infrastructure, coordination, corruption and office capacity.'};
    }
    for(const item of c.administrativeJurisdictions) {
      const agency=agencies.get(item.agencyId);
      if(!agency || item.stateId!==agency.stateId ||
         !Array.isArray(item.provinceIds) || !item.provinceIds.length ||
         item.provinceIds.some(id=>provinces.get(id)!==agency.stateId) ||
         !['national','regional','local','occupied'].includes(item.level))
        return {ok:false,error:'An administrative jurisdiction must reference real provinces in its agency State and a valid level.'};
      const list=jurisdictions.get(agency.id)||[];
      list.push(...item.provinceIds);
      jurisdictions.set(agency.id,list);
    }
    for(const agency of c.administrativeAgencies) {
      const list=jurisdictions.get(agency.id)||[];
      if(!list.length || new Set(list).size!==list.length)
        return {ok:false,error:'Every agency needs explicit, non-duplicated provincial jurisdiction.'};
    }
    for(const dept of c.administrativeDepartments) {
      const agency=agencies.get(dept.agencyId);
      if(!agency || dept.stateId!==agency.stateId || !cleanText(dept.name) ||
         !Array.isArray(dept.competenceIds) || !dept.competenceIds.length ||
         dept.competenceIds.some(id=>!agency.competenceIds.includes(id)) ||
         !Array.isArray(dept.provinceIds) || !dept.provinceIds.length ||
         dept.provinceIds.some(id=>!(jurisdictions.get(agency.id)||[]).includes(id)))
        return {ok:false,error:'A department must remain within its parent agency competencies and jurisdiction.'};
    }
    for(const servant of c.civilServants) {
      const agency=agencies.get(servant.agencyId);
      const dept=servant.departmentId?departments.get(servant.departmentId):null;
      if(!agency || servant.stateId!==agency.stateId ||
         (servant.departmentId && (!dept || dept.agencyId!==agency.id)) ||
         !cleanText(servant.name) || !['merit','patronage'].includes(servant.appointmentBasis) ||
         !['active','leave','suspended','retired'].includes(servant.status) ||
         !intIn(servant.headcount,1,1000000) ||
         !numberIn(servant.dailyWorkUnitsPerPerson,0,10000) ||
         !intIn(servant.qualificationPercent,0,200) ||
         !intIn(servant.experiencePercent,0,200) ||
         !intIn(servant.meritScore,0,100) ||
         !intIn(servant.institutionalLoyaltyPercent,0,100) ||
         !intIn(servant.corruptionRiskPercent,0,100) ||
         !numberIn(servant.salaryPerDay,0,Number.MAX_SAFE_INTEGER))
        return {ok:false,error:'A civil-service post has invalid agency, department, appointment, status, headcount, qualification, experience, merit, loyalty, corruption or salary.'};
    }
    for(const budget of c.administrativeBudgets) {
      const agency=agencies.get(budget.agencyId);
      if(!agency || budget.stateId!==agency.stateId || !currencies.has(budget.currencyId) ||
         game.territories.find(x=>x.stateId===budget.stateId)?.currencyId!==budget.currencyId ||
         !numberIn(budget.openingBalance,0,Number.MAX_SAFE_INTEGER) ||
         !numberIn(budget.dailyAllocation,0,Number.MAX_SAFE_INTEGER) ||
         !numberIn(budget.minimumReserve??0,0,budget.openingBalance))
        return {ok:false,error:'Each administrative budget requires its agency, State currency, opening funds, daily allocation and reserve.'};
    }
    for(const agency of c.administrativeAgencies)
      if(!budgets.has(agency.id))
        return {ok:false,error:'Every configured agency requires its own budget account.'};

    for(const p of c.administrativeProcedures) {
      const agency=agencies.get(p.agencyId);
      const dept=p.departmentId?departments.get(p.departmentId):null;
      const coverage=jurisdictions.get(agency?.id)||[];
      if(!agency || p.stateId!==agency.stateId ||
         (p.departmentId && (!dept || dept.agencyId!==agency.id)) ||
         !cleanText(p.name) || !cleanText(p.competenceId,2,100) ||
         !agency.competenceIds.includes(p.competenceId) ||
         (dept && !dept.competenceIds.includes(p.competenceId)) ||
         !Array.isArray(p.triggerPolicyIds) || !Array.isArray(p.triggerLawIds) ||
         (!p.triggerPolicyIds.length && !p.triggerLawIds.length) ||
         !Array.isArray(p.provinceIds) || !p.provinceIds.length ||
         p.provinceIds.some(id=>!coverage.includes(id)) ||
         !Array.isArray(p.steps) || !p.steps.length ||
         !intIn(p.priority,1,100) || !intIn(p.deadlineDays,1,36500))
        return {ok:false,error:'A procedure needs an authorized agency, competence, trigger, jurisdiction, deadline, priority and steps.'};
      if(p.triggerLawIds.some(id=>!political.get(p.stateId)?.laws?.some(law=>law.id===id)))
        return {ok:false,error:'A procedure references a law that does not exist in its State.'};
      for(const step of p.steps)
        if(!idPattern.test(String(step.id||'')) || !cleanText(step.name) ||
           !intIn(step.workUnits,1,1000000000) ||
           !numberIn(step.cost,0,Number.MAX_SAFE_INTEGER) ||
           !Array.isArray(step.requiredDocuments||[]))
          return {ok:false,error:'Every administrative step needs an ID, name, positive work units, cost and document requirements.'};
    }
    const milestoneIds=new Set();
    for(const project of c.publicProjects) {
      const agency=agencies.get(project.agencyId);
      const offices=new Set((political.get(project.stateId)?.offices||[]).map(item=>item.id));
      if(!agency || project.stateId!==agency.stateId ||
         !(jurisdictions.get(agency.id)||[]).includes(project.provinceId) ||
         !cleanText(project.name) ||
         !numberIn(project.approvedBudget,0,Number.MAX_SAFE_INTEGER) ||
         !Array.isArray(project.milestones) || !project.milestones.length)
        return {ok:false,error:'A public project needs an authorized agency, province, budget and measurable milestones.'};
      for(const milestone of project.milestones) {
        if(!idPattern.test(String(milestone.id||'')) || milestoneIds.has(milestone.id) ||
           !cleanText(milestone.name) || !intIn(milestone.workUnits,1,1000000000) ||
           !Array.isArray(milestone.inspectionOfficeIds) ||
           !milestone.inspectionOfficeIds.length ||
           milestone.inspectionOfficeIds.some(id=>!offices.has(id)))
          return {ok:false,error:'Every project milestone needs unique identification, measurable work and an existing authorized inspection office.'};
        milestoneIds.add(milestone.id);
      }
    }
    for(const procedure of c.administrativeProcedures)
      for(const step of procedure.steps)
        if(step.milestoneId && !milestoneIds.has(step.milestoneId))
          return {ok:false,error:'A procedural step references a public-project milestone that does not exist.'};
    for(const vendor of c.procurementVendors)
      if(!states.has(vendor.stateId) || !cleanText(vendor.name) ||
         !Array.isArray(vendor.competenceIds) || !vendor.competenceIds.length ||
         !intIn(vendor.integrityScore,0,100) || !intIn(vendor.capacityPercent,0,200) ||
         !['active','suspended'].includes(vendor.status))
        return {ok:false,error:'A procurement vendor has invalid State, competence, integrity, capacity or status.'};
    return {ok:true,error:null};
  }

  function record(game,type,stateId,description,actorPlayerId,details,createId) {
    const sequence=(Number(game.eventSequence)||0)+1;
    game.eventSequence=sequence;
    const entry={id:createId(),type,stateId,description,actorPlayerId,
      worldDate:game.worldDate,worldVersion:(Number(game.worldVersion)||0)+1,
      details:clone(details||{}),sequence};
    game.administrativeRecords.push(entry);
    if(game.administrativeRecords.length>2000)
      game.administrativeRecords.splice(0,game.administrativeRecords.length-2000);
    game.administrativeHistory.push(clone(entry));
    if(game.administrativeHistory.length>3000)
      game.administrativeHistory.splice(0,game.administrativeHistory.length-3000);
    game.events.push({...entry,id:createId(),gameId:game.id,orderId:null,
      type:'administration.'+type,resultCode:null,
      occurredAtUtc:new Date().toISOString()});
    if(game.events.length>1000) game.events.splice(0,game.events.length-1000);
    game.activity.unshift(description);
    if(game.activity.length>100) game.activity.length=100;
    return entry;
  }

  function dateAfter(date,days) {
    const value=new Date(date+'T00:00:00Z');
    value.setUTCDate(value.getUTCDate()+days);
    return value.toISOString().slice(0,10);
  }

  function onLawEnacted(game,system,law,decision,createId) {
    ensure(game);
    if(!law || !decision) return {created:0};
    const matches=game.administrativeProcedures.filter(p=>
      p.stateId===system.stateId &&
      ((p.triggerLawIds||[]).includes(law.id) ||
       (p.triggerPolicyIds||[]).includes(decision.policyId)));
    let created=0;
    for(const p of matches) {
      const agency=agencyFor(game,p.agencyId);
      if(!agency || !budgetFor(game,agency.id)) continue;
      for(const provinceId of p.provinceIds) {
        if(game.administrativeTasks.some(t=>
          t.procedureId===p.id && t.lawId===law.id && t.provinceId===provinceId)) continue;
        const steps=p.steps.map(s=>({id:s.id,name:s.name,workUnits:s.workUnits,cost:s.cost,
          requiredDocuments:[...(s.requiredDocuments||[])],completedWorkUnits:0,
          spent:0,status:'pending',milestoneId:s.milestoneId||null}));
        const task={
          id:createId(),stateId:system.stateId,agencyId:agency.id,
          departmentId:p.departmentId||null,procedureId:p.id,lawId:law.id,
          decisionId:decision.id,provinceId,
          title:p.name+' · '+(game.provinces.find(x=>x.id===provinceId)?.name||provinceId),
          priority:p.priority,createdOn:game.worldDate,dueOn:dateAfter(game.worldDate,p.deadlineDays),
          status:'queued',currentStepIndex:0,progressPercent:0,steps,
          totalWorkUnits:steps.reduce((sum,x)=>sum+x.workUnits,0),
          spent:0,lastWorkedOn:null,completedOn:null,responsibleCivilServantIds:[],
          generatedByDecisionId:decision.id
        };
        game.administrativeTasks.push(task);
        created++;
        record(game,'task_created',system.stateId,
          'Administrative task created from enacted law: '+task.title+'.',
          decision.proposedBy,{taskId:task.id,lawId:law.id,procedureId:p.id},createId);
      }
    }
    return {created};
  }

  function calculateAgencyCapacity(game,agency) {
    const staff=game.civilServants.filter(x=>x.agencyId===agency.id && x.status==='active');
    let raw=0,weightedRisk=0,headcount=0;
    for(const servant of staff) {
      const units=servant.headcount*servant.dailyWorkUnitsPerPerson*
        servant.qualificationPercent/100*(.5+servant.experiencePercent/200)*
        (.5+servant.meritScore/200)*(.5+servant.institutionalLoyaltyPercent/200);
      raw+=units;weightedRisk+=units*servant.corruptionRiskPercent;headcount+=servant.headcount;
    }
    const staffIntegrity=raw>0?1-weightedRisk/raw/100:0;
    const factors={
      infrastructure:agency.infrastructureCapacityPercent/100,
      coordination:agency.coordinationPercent/100,
      agencyIntegrity:1-agency.corruptionIndex/100,
      staffIntegrity
    };
    const effective=Math.min(raw,Number(agency.officeCapacity))*factors.infrastructure*
      factors.coordination*factors.agencyIntegrity*factors.staffIntegrity;
    const pending=game.administrativeTasks.filter(t=>
      t.agencyId===agency.id && !['completed','cancelled'].includes(t.status));
    const workload=pending.reduce((sum,t)=>sum+
      Math.max(0,t.totalWorkUnits-t.steps.reduce((s,x)=>s+x.completedWorkUnits,0)),0);
    return {activeHeadcount:headcount,staffBaseWorkUnits:raw,factors,
      effectiveDailyWorkUnits:effective,workloadUnits:workload,
      workloadDays:effective>0?workload/effective:null,activeTaskCount:pending.length};
  }

  function allocateAndPay(game,agency,budget,createId) {
    const territory=game.territories.find(x=>x.stateId===agency.stateId);
    if(!territory) return {available:0,allocation:0,payroll:0};
    const allocation=Math.min(budget.dailyAllocation,Math.max(0,Number(territory.treasury)||0));
    if(allocation>0) {
      territory.treasury-=allocation;budget.balance+=allocation;
      record(game,'budget_allocated',agency.stateId,
        'Funds transferred from the State treasury to '+agency.name+'.',
        null,{agencyId:agency.id,amount:allocation},createId);
    }
    const staff=game.civilServants.filter(x=>x.agencyId===agency.id && x.status==='active');
    const currentPayroll=staff.reduce((sum,x)=>sum+x.headcount*x.salaryPerDay,0);
    const arrearsBefore=Number(budget.payrollArrears)||0;
    const totalDue=currentPayroll+arrearsBefore;
    const protectedFunds=(Number(budget.minimumReserve)||0)+
      (Number(budget.reservedForProcurement)||0);
    if(totalDue>0) {
      const paid=Math.min(Math.max(0,(Number(budget.balance)||0)-protectedFunds),totalDue);
      budget.balance-=paid;
      budget.payrollArrears=Math.max(0,totalDue-paid);
      budget.lastPayrollOn=game.worldDate;
      if(budget.payrollArrears>0) {
        record(game,'payroll_unpaid',agency.stateId,
          'Civil-service payroll remains in arrears for '+agency.name+'.',
          null,{agencyId:agency.id,currentPayroll,arrearsBefore,paid,
            arrears:budget.payrollArrears},createId);
        return {available:0,allocation,payroll:currentPayroll,arrears:budget.payrollArrears};
      }
      record(game,'payroll_paid',agency.stateId,
        'Civil-service payroll and outstanding arrears paid for '+agency.name+'.',
        null,{agencyId:agency.id,amount:totalDue,arrearsCleared:arrearsBefore},createId);
    }
    return {available:Math.max(0,budget.balance-(Number(budget.minimumReserve)||0)-
      (Number(budget.reservedForProcurement)||0)),
      allocation,payroll:currentPayroll,arrears:budget.payrollArrears||0};
  }

  function advanceDay(game,createId) {
    createId ||= (()=>'bureaucracy-'+game.id+'-'+(++game.eventSequence));
    ensure(game);
    const results=[];
    for(const tender of game.procurements) {
      if(tender.kind!=='public_tender'||tender.status!=='open'||
         typeof tender.closingOn!=='string'||tender.closingOn>=game.worldDate) continue;
      const eligible=(tender.bids||[]).some(bid=>
        game.procurementVendors.some(vendor=>vendor.id===bid.vendorId&&
          vendor.stateId===tender.stateId&&vendor.status==='active'&&
          vendor.competenceIds.includes(tender.competenceId)));
      if(eligible) {
        tender.status='bids_closed';
        record(game,'tender_bids_closed',tender.stateId,
          'The supplier submission period ended for '+tender.title+'.',null,
          {tenderId:tender.id,bidCount:tender.bids.length},createId);
      } else {
        const released=releaseTenderReservation(game,tender);
        tender.status='cancelled_no_valid_bids';
        record(game,'tender_cancelled',tender.stateId,
          'The tender closed without a valid active supplier offer: '+tender.title+'.',null,
          {tenderId:tender.id,releasedReservation:released},createId);
      }
    }
    for(const agency of game.administrativeAgencies) {
      const budget=budgetFor(game,agency.id);
      if(!budget) continue;
      const capacity=calculateAgencyCapacity(game,agency);
      const financial=allocateAndPay(game,agency,budget,createId);
      let workRemaining=capacity.effectiveDailyWorkUnits;
      const hasStaff=capacity.activeHeadcount>0;
      if(financial.available<=0) workRemaining=0;
      const tasks=game.administrativeTasks.filter(t=>
        t.agencyId===agency.id && !['completed','cancelled'].includes(t.status))
        .sort((a,b)=>b.priority-a.priority || a.createdOn.localeCompare(b.createdOn) || a.id.localeCompare(b.id));
      for(const task of tasks) {
        const procedure=procedureFor(game,task.procedureId);
        if(!procedure || !agency.competenceIds.includes(procedure.competenceId) ||
           !procedure.provinceIds.includes(task.provinceId)) {
          task.status='blocked_competence';continue;
        }
        if(!hasStaff) {task.status='blocked_staff';continue;}
        if(workRemaining<=0) {
          task.status=financial.available<=0?'blocked_budget':'delayed_capacity';continue;
        }
        let step=task.steps[task.currentStepIndex];
        while(step && step.completedWorkUnits>=step.workUnits) {
          step.status='completed';task.currentStepIndex++;step=task.steps[task.currentStepIndex];
        }
        if(!step) {
          task.status='completed';task.progressPercent=100;task.completedOn=game.worldDate;
          record(game,'task_completed',task.stateId,'Administrative procedure completed: '+task.title+'.',
            null,{taskId:task.id,lawId:task.lawId,totalSpent:task.spent},createId);
          results.push({taskId:task.id,status:'completed'});continue;
        }
        step.documentsSubmitted ||= [];
        const missingDocuments=step.requiredDocuments.filter(id=>
          !step.documentsSubmitted.some(item=>item.documentId===id));
        if(missingDocuments.length) {
          task.status='awaiting_documents';
          continue;
        }
        const remaining=Math.max(0,step.workUnits-step.completedWorkUnits);
        const rate=step.cost/step.workUnits;
        const affordable=rate>0?financial.available/rate:remaining;
        const linkedProject=step.milestoneId
          ? game.publicProjects.find(project=>project.milestones?.some(m=>m.id===step.milestoneId))
          : null;
        const projectBudgetRemaining=linkedProject
          ? Math.max(0,Number(linkedProject.approvedBudget)-Number(linkedProject.spent||0))
          : Number.MAX_SAFE_INTEGER;
        const projectAffordable=rate>0?projectBudgetRemaining/rate:remaining;
        const work=Math.min(remaining,workRemaining,affordable,projectAffordable);
        if(work<=0) {
          task.status=linkedProject && projectBudgetRemaining<=0
            ? 'blocked_project_budget' : 'blocked_budget';
          continue;
        }
        const expense=work*rate;
        budget.balance-=expense;financial.available-=expense;
        if(linkedProject) linkedProject.spent=(Number(linkedProject.spent)||0)+expense;
        const linkedMilestone=linkedProject?.milestones?.find(m=>m.id===step.milestoneId);
        if(linkedMilestone) {
          linkedMilestone.completedWorkUnits=Math.min(linkedMilestone.workUnits,
            Number(linkedMilestone.completedWorkUnits||0)+work);
          linkedMilestone.status='in_progress';
        }
        step.completedWorkUnits+=work;step.spent+=expense;
        step.status=step.completedWorkUnits>=step.workUnits?'completed':'in_progress';
        task.spent+=expense;task.lastWorkedOn=game.worldDate;task.status='in_progress';
        task.progressPercent=Math.min(99.99,
          100*task.steps.reduce((sum,x)=>sum+x.completedWorkUnits,0)/task.totalWorkUnits);
        workRemaining-=work;
        task.responsibleCivilServantIds=game.civilServants.filter(x=>
          x.agencyId===agency.id && x.status==='active').map(x=>x.id);
        record(game,'task_progress',task.stateId,'Administrative task progressed: '+task.title+'.',
          null,{taskId:task.id,stepId:step.id,workUnits:work,expense},createId);
        if(step.completedWorkUnits>=step.workUnits) {
          const completed=record(game,'procedure_step_completed',task.stateId,
            'Administrative step completed: '+step.name+'.',null,
            {taskId:task.id,stepId:step.id,requiredDocuments:step.requiredDocuments},createId);
          if(linkedMilestone) {
            linkedMilestone.completedWorkUnits=linkedMilestone.workUnits;
            linkedMilestone.status='awaiting_inspection';
            linkedMilestone.lastRecordId=completed.id;
          }
          task.currentStepIndex++;
          if(task.currentStepIndex>=task.steps.length) {
            task.status='completed';task.progressPercent=100;task.completedOn=game.worldDate;
            record(game,'task_completed',task.stateId,
              'Administrative procedure completed: '+task.title+'.',
              null,{taskId:task.id,lawId:task.lawId,totalSpent:task.spent},createId);
            if(linkedProject) linkedProject.status='awaiting_inspection';
            results.push({taskId:task.id,status:'completed'});
          }
        }
      }
      results.push({agencyId:agency.id,remainingWorkUnits:workRemaining,
        capacity,availableBudget:budget.balance});
    }
    return {ok:true,results};
  }

  function releaseTenderReservation(game,tender) {
    const budget=budgetFor(game,tender.agencyId);
    const released=Math.max(0,Number(tender.reservedAmount)||0);
    if(budget) budget.reservedForProcurement=Math.max(0,
      Math.round(((Number(budget.reservedForProcurement)||0)-released)*100)/100);
    tender.reservedAmount=0;
    return released;
  }

  function applyProcurementOrder(game,player,membership,order,createId) {
    if(!membership||membership.status!=='active'||
       membership.permissionSetId==='government-observer'||
       membership.stateId!==order.stateId)
      return {ok:false,code:'ADMIN_PROCUREMENT_MEMBERSHIP_INVALID',
        error:'An active, non-observer government membership in this State is required.'};
    const stateId=membership.stateId;
    const political=game.politicalSystems.find(item=>item.stateId===stateId);
    const heldOfficeIds=new Set((political?.offices||[])
      .filter(item=>item.holderPlayerId===player.id).map(item=>item.id));
    const tender=game.procurements.find(item=>
      item.id===order.tenderId&&item.stateId===stateId&&item.kind==='public_tender');
    const agencyForTender=tender&&agencyFor(game,tender.agencyId);
    const budgetForTender=tender&&budgetFor(game,tender.agencyId);
    const hasAgencyAuthority=agency=>(agency?.supervisingOfficeIds||[])
      .some(id=>heldOfficeIds.has(id));
    const evidence=value=>cleanText(value,12,280);
    const money=value=>Math.round(value*100)/100;

    if(order.type==='administration.procurement.openTender') {
      const agency=agencyFor(game,order.agencyId);
      const budget=agency&&budgetFor(game,agency.id);
      const territory=game.territories.find(item=>item.stateId===stateId);
      const jurisdiction=(game.administrativeJurisdictions||[]).some(item=>
        item.agencyId===agency?.id&&item.stateId===stateId&&
        item.provinceIds.includes(order.provinceId));
      const inspectionOffice=political?.offices?.find(item=>
        item.id===order.inspectionOfficeId);
      if(!agency||agency.stateId!==stateId||!budget||!jurisdiction||
         !agency.competenceIds.includes(order.competenceId))
        return {ok:false,code:'ADMIN_TENDER_SCOPE_INVALID',
          error:'The tender must reference an agency, competence, province and budget already configured in this State.'};
      if(!hasAgencyAuthority(agency))
        return {ok:false,code:'ADMIN_TENDER_AUTHORITY_REQUIRED',
          error:'Only a holder of the agency supervisory office may publish a public tender.'};
      if(!inspectionOffice||agency.supervisingOfficeIds.includes(inspectionOffice.id)||
         inspectionOffice.holderPlayerId===player.id)
        return {ok:false,code:'ADMIN_TENDER_INSPECTOR_INVALID',
          error:'The tender needs an existing inspection office outside the agency supervisory chain and not held by the publishing player.'};
      if(!cleanText(order.title,4,120)||!cleanText(order.scope,20,2000)||
         !numberIn(order.estimatedAmount,0.01,Number.MAX_SAFE_INTEGER)||
         money(order.estimatedAmount)!==order.estimatedAmount||
         !intIn(order.submissionDays,1,365))
        return {ok:false,code:'ADMIN_TENDER_TERMS_INVALID',
          error:'A tender requires a title, detailed scope, amount in two-decimal currency units and a 1–365 day submission period.'};
      const reserve=Number(budget.minimumReserve)||0;
      const committed=Number(budget.reservedForProcurement)||0;
      const available=(Number(budget.balance)||0)-reserve-committed;
      if(available<order.estimatedAmount)
        return {ok:false,code:'ADMIN_TENDER_BUDGET_UNAVAILABLE',
          error:'The agency budget cannot reserve the estimated contract value while preserving its minimum reserve and existing commitments.'};
      const entry={
        id:createId(),kind:'public_tender',stateId,agencyId:agency.id,
        provinceId:order.provinceId,competenceId:order.competenceId,
        title:order.title.trim(),scope:order.scope.trim(),
        estimatedAmount:order.estimatedAmount,currencyId:budget.currencyId,
        openedOn:game.worldDate,closingOn:dateAfter(game.worldDate,order.submissionDays),
        submissionDays:order.submissionDays,awardCriteria:'lowest_compliant_bid',
        inspectionOfficeId:inspectionOffice.id,createdByPlayerId:player.id,
        status:'open',bids:[],award:null,deliveries:[],payment:null,
        reservedAmount:order.estimatedAmount
      };
      budget.reservedForProcurement=money(committed+entry.reservedAmount);
      game.procurements.push(entry);
      const audit=record(game,'tender_opened',stateId,
        'Public tender published: '+entry.title+'.',player.id,
        {tenderId:entry.id,agencyId:agency.id,provinceId:entry.provinceId,
          competenceId:entry.competenceId,estimatedAmount:entry.estimatedAmount,
          currencyId:entry.currencyId,closingOn:entry.closingOn,
          inspectionOfficeId:entry.inspectionOfficeId},createId);
      entry.openingRecordId=audit.id;
      return {ok:true,tenderId:entry.id};
    }

    if(!tender||!agencyForTender||!budgetForTender)
      return {ok:false,code:'ADMIN_TENDER_NOT_FOUND',
        error:'The public tender or its agency budget is unavailable in this State.'};

    if(order.type==='administration.procurement.registerBid') {
      if(!hasAgencyAuthority(agencyForTender))
        return {ok:false,code:'ADMIN_TENDER_AUTHORITY_REQUIRED',
          error:'Only the agency supervisory office may register a received supplier offer.'};
      if(tender.status!=='open'||game.worldDate>tender.closingOn)
        return {ok:false,code:'ADMIN_TENDER_CLOSED',
          error:'Supplier offers can only be registered while the publication period is open.'};
      const vendor=(game.procurementVendors||[]).find(item=>
        item.id===order.vendorId&&item.stateId===stateId);
      if(!vendor||vendor.status!=='active'||
         !vendor.competenceIds.includes(tender.competenceId))
        return {ok:false,code:'ADMIN_TENDER_VENDOR_INELIGIBLE',
          error:'The supplier must be active in this State and registered for the tender competence.'};
      if(tender.bids.some(item=>item.vendorId===vendor.id))
        return {ok:false,code:'ADMIN_TENDER_DUPLICATE_BID',
          error:'A supplier can submit only one recorded offer for this tender.'};
      if(!numberIn(order.amount,0.01,tender.estimatedAmount)||
         money(order.amount)!==order.amount||!intIn(order.deliveryDays,1,36500)||
         !evidence(order.offerReference))
        return {ok:false,code:'ADMIN_TENDER_BID_INVALID',
          error:'A received offer must include a two-decimal price within the estimate, delivery days and a 12–280 character source/reference record.'};
      const bid={
        id:createId(),vendorId:vendor.id,amount:order.amount,
        deliveryDays:order.deliveryDays,offerReference:order.offerReference.trim(),
        submittedOn:game.worldDate,registeredByPlayerId:player.id,status:'valid'
      };
      tender.bids.push(bid);
      const audit=record(game,'tender_bid_registered',stateId,
        'A supplier offer was registered for '+tender.title+'.',player.id,
        {tenderId:tender.id,bidId:bid.id,vendorId:vendor.id,
          amount:bid.amount,deliveryDays:bid.deliveryDays,
          offerReference:bid.offerReference},createId);
      bid.recordId=audit.id;
      return {ok:true,bidId:bid.id};
    }

    if(order.type==='administration.procurement.awardTender') {
      if(!hasAgencyAuthority(agencyForTender))
        return {ok:false,code:'ADMIN_TENDER_AUTHORITY_REQUIRED',
          error:'Only the agency supervisory office may close and award this tender.'};
      if(tender.status!=='bids_closed'||game.worldDate<=tender.closingOn)
        return {ok:false,code:'ADMIN_TENDER_NOT_CLOSED',
          error:'The publication period must end before a contract can be awarded.'};
      const eligible=tender.bids.filter(bid=>
        game.procurementVendors.some(vendor=>vendor.id===bid.vendorId&&
          vendor.stateId===stateId&&vendor.status==='active'&&
          vendor.competenceIds.includes(tender.competenceId)));
      eligible.sort((left,right)=>left.amount-right.amount||
        left.vendorId.localeCompare(right.vendorId));
      const winning=eligible[0];
      if(!winning) {
        releaseTenderReservation(game,tender);
        tender.status='cancelled_no_valid_bids';
        record(game,'tender_cancelled',stateId,
          'The public tender was cancelled because no active qualified supplier remained.',player.id,
          {tenderId:tender.id},createId);
        return {ok:false,code:'ADMIN_TENDER_NO_VALID_BIDS',
          error:'No active qualified supplier remains. The reserved budget has been released.'};
      }
      const released=money(tender.estimatedAmount-winning.amount);
      budgetForTender.reservedForProcurement=Math.max(0,money(
        (Number(budgetForTender.reservedForProcurement)||0)-released));
      tender.reservedAmount=winning.amount;
      tender.award={
        bidId:winning.id,vendorId:winning.vendorId,amount:winning.amount,
        currencyId:tender.currencyId,deliveryDays:winning.deliveryDays,
        awardCriteria:'lowest_compliant_bid',awardedOn:game.worldDate,
        awardedByPlayerId:player.id
      };
      tender.status='awarded';
      const audit=record(game,'tender_awarded',stateId,
        'Public contract awarded to the lowest compliant supplier for '+tender.title+'.',player.id,
        {tenderId:tender.id,bidId:winning.id,vendorId:winning.vendorId,
          amount:winning.amount,currencyId:tender.currencyId,
          awardCriteria:'lowest_compliant_bid',releasedReservation:released},createId);
      tender.award.recordId=audit.id;
      return {ok:true,vendorId:winning.vendorId,bidId:winning.id,amount:winning.amount};
    }

    if(order.type==='administration.procurement.recordDelivery') {
      if(!hasAgencyAuthority(agencyForTender))
        return {ok:false,code:'ADMIN_TENDER_AUTHORITY_REQUIRED',
          error:'Only the agency supervisory office may register a supplier delivery.'};
      if(!['awarded','rectification_required'].includes(tender.status))
        return {ok:false,code:'ADMIN_TENDER_DELIVERY_NOT_DUE',
          error:'A delivery can only be recorded for an awarded contract awaiting delivery or rectification.'};
      if(!evidence(order.evidence))
        return {ok:false,code:'ADMIN_TENDER_DELIVERY_EVIDENCE_REQUIRED',
          error:'A 12–280 character delivery receipt and evidence record is required.'};
      const delivery={
        id:createId(),receivedOn:game.worldDate,evidence:order.evidence.trim(),
        recordedByPlayerId:player.id,status:'awaiting_inspection',
        attempt:(tender.deliveries||[]).length+1
      };
      tender.deliveries.push(delivery);
      tender.status='awaiting_inspection';
      const audit=record(game,'tender_delivery_received',stateId,
        'A delivery was recorded for public contract '+tender.title+'.',player.id,
        {tenderId:tender.id,deliveryId:delivery.id,attempt:delivery.attempt},createId);
      delivery.recordId=audit.id;
      return {ok:true,deliveryId:delivery.id};
    }

    if(order.type==='administration.procurement.inspectDelivery') {
      if(tender.status!=='awaiting_inspection')
        return {ok:false,code:'ADMIN_TENDER_INSPECTION_NOT_READY',
          error:'There is no delivery awaiting inspection for this tender.'};
      if(!heldOfficeIds.has(tender.inspectionOfficeId))
        return {ok:false,code:'ADMIN_TENDER_INSPECTOR_AUTHORITY_REQUIRED',
          error:'The player must hold the independent inspection office specified when the tender was published.'};
      if(player.id===tender.createdByPlayerId||
         player.id===tender.award?.awardedByPlayerId)
        return {ok:false,code:'ADMIN_TENDER_INSPECTOR_CONFLICT',
          error:'The tender publisher or contract awarder cannot inspect the supplier delivery.'};
      if(!['accepted','rejected'].includes(order.outcome)||!evidence(order.evidence))
        return {ok:false,code:'ADMIN_TENDER_INSPECTION_INVALID',
          error:'Choose accepted or rejected and provide 12–280 characters of inspection evidence.'};
      const delivery=tender.deliveries[tender.deliveries.length-1];
      if(!delivery||delivery.status!=='awaiting_inspection')
        return {ok:false,code:'ADMIN_TENDER_DELIVERY_NOT_FOUND',
          error:'The pending delivery record is unavailable.'};
      delivery.status=order.outcome;
      delivery.inspectedOn=game.worldDate;
      delivery.inspectedByPlayerId=player.id;
      delivery.inspectionEvidence=order.evidence.trim();
      tender.status=order.outcome==='accepted'?'accepted':'rectification_required';
      const audit=record(game,'tender_delivery_inspected',stateId,
        'The delivery for '+tender.title+' was '+order.outcome+' after independent inspection.',player.id,
        {tenderId:tender.id,deliveryId:delivery.id,outcome:order.outcome,
          inspectionOfficeId:tender.inspectionOfficeId,evidence:delivery.inspectionEvidence},createId);
      delivery.inspectionRecordId=audit.id;
      return {ok:true};
    }

    if(order.type==='administration.procurement.payContract') {
      if(!hasAgencyAuthority(agencyForTender))
        return {ok:false,code:'ADMIN_TENDER_AUTHORITY_REQUIRED',
          error:'Only the agency supervisory office may authorize payment of the public contract.'};
      if(tender.status!=='accepted'||!tender.award||tender.payment)
        return {ok:false,code:'ADMIN_TENDER_PAYMENT_NOT_READY',
          error:'Payment is available only once the delivery has passed independent inspection.'};
      const amount=Number(tender.award.amount)||0;
      const reserved=Number(tender.reservedAmount)||0;
      if(reserved<amount||Number(budgetForTender.balance)<amount)
        return {ok:false,code:'ADMIN_TENDER_PAYMENT_UNFUNDED',
          error:'The agency account no longer holds the full reserved contract amount.'};
      budgetForTender.balance=money(Number(budgetForTender.balance)-amount);
      budgetForTender.reservedForProcurement=Math.max(0,money(
        (Number(budgetForTender.reservedForProcurement)||0)-reserved));
      tender.reservedAmount=0;
      tender.status='paid';
      tender.payment={
        amount,currencyId:tender.currencyId,paidOn:game.worldDate,
        paidByPlayerId:player.id,agencyBudgetId:budgetForTender.id,
        vendorId:tender.award.vendorId
      };
      const audit=record(game,'tender_paid',stateId,
        'The inspected public contract was paid in full to its registered supplier.',player.id,
        {tenderId:tender.id,amount,currencyId:tender.currencyId,
          agencyBudgetId:budgetForTender.id,vendorId:tender.award.vendorId},createId);
      tender.payment.recordId=audit.id;
      return {ok:true,amount,currencyId:tender.currencyId};
    }

    if(order.type==='administration.procurement.cancelTender') {
      if(!hasAgencyAuthority(agencyForTender))
        return {ok:false,code:'ADMIN_TENDER_AUTHORITY_REQUIRED',
          error:'Only the agency supervisory office may cancel an unawarded tender.'};
      if(!['open','bids_closed'].includes(tender.status)||!evidence(order.evidence))
        return {ok:false,code:'ADMIN_TENDER_CANNOT_CANCEL',
          error:'Only an unawarded tender can be cancelled, with a 12–280 character public reason.'};
      const released=releaseTenderReservation(game,tender);
      tender.status='cancelled';
      tender.cancelledOn=game.worldDate;
      tender.cancellationReason=order.evidence.trim();
      record(game,'tender_cancelled',stateId,
        'Public tender cancelled: '+tender.title+'.',player.id,
        {tenderId:tender.id,releasedReservation:released,
          reason:tender.cancellationReason},createId);
      return {ok:true,releasedReservation:released};
    }

    return null;
  }

  function applyOrder(game,player,membership,order,createId) {
    if(String(order?.type||'').startsWith('administration.procurement.')) {
      ensure(game);
      return applyProcurementOrder(game,player,membership,order,createId);
    }
    if(!['administration.submitDocument','administration.inspectProjectMilestone'].includes(order?.type))
      return null;
    ensure(game);
    if(order.type==='administration.inspectProjectMilestone') {
      const project=game.publicProjects.find(item=>
        item.id===order.projectId && item.stateId===membership?.stateId);
      const milestone=project?.milestones?.find(item=>item.id===order.milestoneId);
      const offices=new Set((game.politicalSystems.find(item=>item.stateId===membership?.stateId)?.offices||[])
        .filter(item=>item.holderPlayerId===player.id).map(item=>item.id));
      if(!project || !milestone)
        return {ok:false,code:'ADMIN_PROJECT_NOT_FOUND',error:'The public project or milestone is unavailable in this State.'};
      if(milestone.status!=='awaiting_inspection')
        return {ok:false,code:'ADMIN_INSPECTION_NOT_READY',error:'The project milestone is not ready for independent inspection.'};
      if(!(milestone.inspectionOfficeIds||[]).some(id=>offices.has(id)))
        return {ok:false,code:'ADMIN_INSPECTOR_AUTHORITY_REQUIRED',error:'The player does not hold an office authorized to inspect this milestone.'};
      const evidence=String(order.evidence||'').trim().replace(/\s+/g,' ');
      if(evidence.length<12 || evidence.length>280 || /[<>\u0000-\u001f\u007f]/.test(evidence))
        return {ok:false,code:'ADMIN_INSPECTION_EVIDENCE_REQUIRED',error:'An inspection record of 12–280 plain-text characters is required.'};
      const passed=order.outcome==='accepted';
      if(!passed && order.outcome!=='rejected')
        return {ok:false,code:'ADMIN_INSPECTION_OUTCOME_INVALID',error:'Choose an explicit accepted or rejected inspection outcome.'};
      const priorStatus=project.status;
      milestone.status=passed?'accepted':'rejected';
      milestone.inspectedByPlayerId=player.id;
      milestone.inspectedOn=game.worldDate;
      milestone.inspectionEvidence=evidence;
      const audit=record(game,'project_milestone_inspected',project.stateId,
        'Public project milestone '+milestone.name+' was '+(passed?'accepted':'rejected')+' after inspection.',
        player.id,{projectId:project.id,milestoneId:milestone.id,outcome:order.outcome,evidence},createId);
      milestone.lastInspectionRecordId=audit.id;
      game.publicProjectAudits.push(audit);
      if(!passed) project.status='rectification_required';
      else if(project.milestones.every(item=>item.status==='accepted')) {
        project.status='completed';
        project.completedOn=game.worldDate;
      } else project.status='in_progress';
      project.previousInspectionStatus=priorStatus;
      return {ok:true};
    }
    const task=game.administrativeTasks.find(item=>
      item.id===order.taskId && item.stateId===membership?.stateId);
    const agency=task && agencyFor(game,task.agencyId);
    const procedure=task && procedureFor(game,task.procedureId);
    if(!task || !agency || !procedure || !procedure.provinceIds.includes(task.provinceId))
      return {ok:false,code:'ADMIN_TASK_NOT_FOUND',error:'The administrative task is unavailable in this State.'};
    const offices=new Set((game.politicalSystems.find(item=>item.stateId===task.stateId)?.offices||[])
      .filter(item=>item.holderPlayerId===player.id).map(item=>item.id));
    if(!agency.supervisingOfficeIds.some(id=>offices.has(id)))
      return {ok:false,code:'ADMIN_AUTHORITY_REQUIRED',error:'Only a player holding a supervisory office for this agency may register an official document.'};
    if(['completed','cancelled'].includes(task.status))
      return {ok:false,code:'ADMIN_TASK_CLOSED',error:'This administrative task is already closed.'};
    const step=task.steps[task.currentStepIndex];
    if(!step || !step.requiredDocuments.includes(order.documentId))
      return {ok:false,code:'ADMIN_DOCUMENT_NOT_REQUIRED',error:'This document is not required by the current procedural step.'};
    step.documentsSubmitted ||= [];
    if(step.documentsSubmitted.some(item=>item.documentId===order.documentId))
      return {ok:false,code:'ADMIN_DOCUMENT_DUPLICATE',error:'This required document has already been registered.'};
    const entry={id:createId(),taskId:task.id,stepId:step.id,documentId:order.documentId,
      submittedByPlayerId:player.id,submittedOn:game.worldDate,status:'received'};
    step.documentsSubmitted.push(entry);
    game.publicRecords.push(entry);
    record(game,'document_received',task.stateId,
      'Required public document registered for '+task.title+'.',player.id,
      {taskId:task.id,stepId:step.id,documentId:order.documentId},createId);
    return {ok:true};
  }

  function onGovernmentChange(game,stateId,previousOfficeHolderIds,createId) {
    ensure(game);
    const previous=new Set(previousOfficeHolderIds||[]);
    const retained=game.civilServants.filter(x=>x.stateId===stateId &&
      !['retired','terminated'].includes(x.status));
    record(game,'government_transition',stateId,
      'Government leadership changed; '+retained.length+
      ' civil-service post(s) retained under institutional continuity.',
      null,{previousPoliticalOfficeHolders:[...previous],
        retainedCivilServantIds:retained.map(x=>x.id)},createId);
    return retained.length;
  }

  const api=Object.freeze({ensure,validateConfiguration,calculateAgencyCapacity,
    onLawEnacted,advanceDay,applyOrder,onGovernmentChange,
    configurationFields:Object.freeze([...CONFIG_FIELDS]),
    dynamicFields:Object.freeze([...DYNAMIC_FIELDS])});
  globalThis.NewWorldBureaucracy=api;
  if(typeof module!=='undefined' && module.exports) module.exports=api;
})();