'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const inbox=require('../command-inbox.js');

test('every active system event family routes to its real application view and names its origin',()=>{
  const cases=[
    ['order.executed','ORDERS','multiplayer'],
    ['player.joined','PLAYERS','multiplayer'],
    ['world.paused.no_connected_players','WORLD','world'],
    ['campaign.victory','CAMPAIGN','world'],
    ['territory.conquered','TERRITORY','territory'],
    ['government.budget_changed','GOVERNMENT','government'],
    ['politics.vote_cast','GOVERNMENT','government'],
    ['law.proposed','GOVERNMENT','government'],
    ['administration.task_completed','ADMINISTRATION','administration'],
    ['research.technology_discovered','RESEARCH','technology'],
    ['technology.adopted','RESEARCH','technology'],
    ['finance.debt_default','ECONOMY','ledger'],
    ['economy.trade_completed','ECONOMY','ledger'],
    ['trade.route_accepted','ECONOMY','ledger'],
    ['construction.completed','CONSTRUCTION','city'],
    ['population.growth','SOCIETY','society'],
    ['society.internal_migration','SOCIETY','society'],
    ['services.capacity_changed','PUBLIC SERVICES','services'],
    ['industry.payroll_paid','INDUSTRY','industry'],
    ['resource.water_shortage','RESOURCES','resources'],
    ['justice.case_opened','JUSTICE','justice'],
    ['identity.community_program_funded','IDENTITY','identity'],
    ['media.article_published','MEDIA','media'],
    ['security.alert_issued','SECURITY','security'],
    ['world_event.triggered','WORLD EVENTS','events'],
    ['diplomacy.treaty_signed','DIPLOMACY','diplomacy'],
    ['military.unit_moved','MILITARY','military'],
    ['occupation.transferred','MILITARY','military']
  ];
  for(const [type,category,view] of cases) {
    const route=inbox.routeFor(type);
    assert.equal(route.category,category,type);
    assert.equal(route.view,view,type);
    assert.ok(route.origin.length>=3,type+' must identify its originating system');
  }
});

test('repeated events are grouped by type, State and date while retaining every ID and unread state',()=>{
  const records=inbox.buildRecords([
    {id:'event-1',sequence:1,type:'finance.debt_issued',stateId:'state-a',
      worldDate:'1500-01-02',description:'First debt issued.'},
    {id:'event-2',sequence:2,type:'finance.debt_issued',stateId:'state-a',
      worldDate:'1500-01-02',description:'Second debt issued.'},
    {id:'event-3',sequence:3,type:'finance.debt_issued',stateId:'state-b',
      worldDate:'1500-01-02',description:'Different State.'},
    {id:'event-4',sequence:4,type:'finance.debt_issued',stateId:'state-a',
      worldDate:'1500-01-03',description:'Different date.'}
  ],[],{readIds:new Set(['event-1']),worldDate:'1500-01-03'});
  assert.equal(records.length,3);
  const grouped=records.find(item=>item.stateId==='state-a'&&item.date==='1500-01-02');
  assert.ok(grouped);
  assert.equal(grouped.count,2);
  assert.deepEqual(grouped.eventIds,['event-2','event-1']);
  assert.equal(grouped.read,false,'one unread event keeps the group unread');
  assert.equal(grouped.description,'Second debt issued.','the newest event supplies the visible summary');
  assert.equal(grouped.origin,'TREASURY / FINANCE');
  assert.equal(grouped.category,'ECONOMY');
  assert.equal(grouped.action.view,'ledger');
  assert.equal(grouped.action.stateId,'state-a');
  assert.deepEqual(grouped.sequences,[2,1]);
});

test('opening and marking grouped events as read is stable across reloads',()=>{
  const events=[
    {id:'r-1',sequence:1,type:'media.article_published',stateId:'s1',
      worldDate:'1500-02-01',description:'News published.'},
    {id:'r-2',sequence:2,type:'media.article_published',stateId:'s1',
      worldDate:'1500-02-01',description:'Another report.'}
  ];
  const first=inbox.buildRecords(events,[],{readIds:[],worldDate:'1500-02-01'});
  assert.equal(first[0].read,false);
  const persisted=new Set(first[0].eventIds);
  const second=inbox.buildRecords(events,[],{readIds:persisted,worldDate:'1500-02-01'});
  assert.equal(second[0].read,true);
  assert.equal(second[0].count,2);
});

test('priority escalates urgent operational and legal events without making every event critical',()=>{
  assert.equal(inbox.priorityFor('order.rejected'),'high');
  assert.equal(inbox.priorityFor('world.paused.host_relay_lost'),'high');
  assert.equal(inbox.priorityFor('security.alert_issued'),'high');
  assert.equal(inbox.priorityFor('justice.case_opened'),'high');
  assert.equal(inbox.priorityFor('diplomacy.treaty_signed'),'medium');
  assert.equal(inbox.priorityFor('administration.task_completed'),'medium');
  assert.equal(inbox.priorityFor('finance.exchange_rate_updated'),'medium');
  assert.equal(inbox.priorityFor('finance.public_debt_defaulted'),'high');
});

test('pending orders appear first with an explicit action and local/host delivery state',()=>{
  const records=inbox.buildRecords([
    {id:'older-event',sequence:20,type:'world.started',worldDate:'1500-01-01',
      description:'The world started.'}
  ],[
    {orderId:'queued-1',stateId:'s1',sentOnce:false},
    {orderId:'sent-2',stateId:'s2',sentOnce:true}
  ],{
    worldDate:'1500-01-02',
    describeOrder:order=>order.orderId==='queued-1'?'Build a farm':'Propose a law'
  });
  assert.equal(records.length,3);
  assert.deepEqual(records.slice(0,2).map(item=>item.id),['order:queued-1','order:sent-2']);
  assert.equal(records[0].description,'Queued locally. This order has not yet been sent.');
  assert.equal(records[0].origin,'LOCAL QUEUE');
  assert.equal(records[0].action.kind,'review-order');
  assert.equal(records[0].action.view,'multiplayer');
  assert.equal(records[1].description,'Sent to the host. Waiting for authoritative confirmation.');
  assert.equal(records[1].origin,'HOST CONFIRMATION');
  assert.equal(records[2].id,'event:world.started||1500-01-01');
});

test('frequent background ticks are omitted and malformed content is bounded and rendered as text',()=>{
  const records=inbox.buildRecords([
    {id:'tick',sequence:1,type:'world.day_advanced',worldDate:'1500-01-01'},
    {id:'market',sequence:2,type:'economy.market_cleared',worldDate:'1500-01-01'},
    {id:'bad',sequence:3,type:'security.alert_issued',stateId:'s1',
      worldDate:'1500-01-01',description:'<img src=x>\u0000 '+('x'.repeat(600)),
      details:{alertId:'alert-123'}}
  ],[],{worldDate:'1500-01-01'});
  assert.equal(records.length,1);
  assert.equal(records[0].description.length,400);
  assert.equal(records[0].description.includes('\u0000'),false);
  assert.equal(records[0].referenceId,'alert-123');
  assert.equal(records[0].action.referenceId,'alert-123');
  assert.equal(records[0].priority,'high');
});

test('records are capped, consistently ordered and use the real world date only as a fallback',()=>{
  const events=Array.from({length:90},(_,index)=>({
    id:'event-'+index,sequence:index+1,type:'media.article_published',
    worldDate:'invalid',description:'Article '+index
  }));
  const records=inbox.buildRecords(events,[],{
    worldDate:'1500-03-05',readIds:events.map(item=>item.id)
  });
  assert.equal(records.length,1,'same type, State and date should be grouped after fallback');
  assert.equal(records[0].date,'1500-03-05');
  assert.equal(records[0].count,90);
  assert.equal(records[0].read,true);
  assert.equal(records[0].sequences[0],90);
  assert.equal(records[0].sequences.at(-1),1);
});

test('unknown event families use a safe world route and do not create executable actions',()=>{
  const records=inbox.buildRecords([{
    id:'future-event',sequence:1,type:'unregistered.system_event',
    stateId:null,worldDate:'1500-01-01',description:'A future event.'
  }],[],{worldDate:'1500-01-01'});
  assert.equal(records[0].category,'WORLD');
  assert.equal(records[0].view,'world');
  assert.equal(records[0].action.kind,'navigate');
  assert.equal(records[0].action.stateId,null);
});
