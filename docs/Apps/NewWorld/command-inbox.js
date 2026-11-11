(() => {
  'use strict';

  const IGNORED_EVENTS=new Set([
    'world.day_advanced','economy.market_cleared',
    'economy.production_completed','population.growth'
  ]);

  const ROUTES=Object.freeze([
    {prefix:'order.',category:'ORDERS',view:'multiplayer',origin:'ORDER PROCESSOR'},
    {prefix:'player.',category:'PLAYERS',view:'multiplayer',origin:'MULTIPLAYER'},
    {prefix:'diplomacy.',category:'DIPLOMACY',view:'diplomacy',origin:'DIPLOMATIC SERVICE'},
    {prefix:'military.',category:'MILITARY',view:'military',origin:'ARMED FORCES'},
    {prefix:'occupation.',category:'MILITARY',view:'military',origin:'TERRITORIAL COMMAND'},
    {prefix:'territory.',category:'TERRITORY',view:'territory',origin:'TERRITORIAL REGISTER'},
    {prefix:'government.',category:'GOVERNMENT',view:'government',origin:'GOVERNMENT'},
    {prefix:'politics.',category:'GOVERNMENT',view:'government',origin:'POLITICAL SYSTEM'},
    {prefix:'law.',category:'GOVERNMENT',view:'government',origin:'LEGISLATIVE REGISTER'},
    {prefix:'administration.',category:'ADMINISTRATION',view:'administration',origin:'CIVIL SERVICE'},
    {prefix:'technology.',category:'RESEARCH',view:'technology',origin:'TECHNOLOGY OFFICE'},
    {prefix:'research.',category:'RESEARCH',view:'technology',origin:'RESEARCH SYSTEM'},
    {prefix:'finance.',category:'ECONOMY',view:'ledger',origin:'TREASURY / FINANCE'},
    {prefix:'economy.',category:'ECONOMY',view:'ledger',origin:'ECONOMIC SIMULATION'},
    {prefix:'trade.',category:'ECONOMY',view:'ledger',origin:'TRADE SYSTEM'},
    {prefix:'construction.',category:'CONSTRUCTION',view:'city',origin:'CONSTRUCTION'},
    {prefix:'population.',category:'SOCIETY',view:'society',origin:'POPULATION REGISTER'},
    {prefix:'society.',category:'SOCIETY',view:'society',origin:'SOCIAL SYSTEM'},
    {prefix:'services.',category:'PUBLIC SERVICES',view:'services',origin:'PUBLIC SERVICES'},
    {prefix:'industry.',category:'INDUSTRY',view:'industry',origin:'INDUSTRY / LABOUR'},
    {prefix:'resource.',category:'RESOURCES',view:'resources',origin:'NATURAL RESOURCES'},
    {prefix:'justice.',category:'JUSTICE',view:'justice',origin:'JUSTICE SYSTEM'},
    {prefix:'identity.',category:'IDENTITY',view:'identity',origin:'COMMUNITY / IDENTITY'},
    {prefix:'media.',category:'MEDIA',view:'media',origin:'PRESS / PUBLIC OPINION'},
    {prefix:'security.',category:'SECURITY',view:'security',origin:'PUBLIC SECURITY'},
    {prefix:'world_event.',category:'WORLD EVENTS',view:'events',origin:'WORLD EVENT SYSTEM'},
    {prefix:'world.',category:'WORLD',view:'world',origin:'WORLD CLOCK / SESSION'},
    {prefix:'campaign.',category:'CAMPAIGN',view:'world',origin:'CAMPAIGN SYSTEM'}
  ]);

  const TITLES=Object.freeze({
    'world.created':'World created',
    'world.started':'World started',
    'world.paused':'World paused',
    'world.resumed':'World resumed',
    'world.paused.no_players':'Host disconnected',
    'world.paused.no_connected_players':'No players connected',
    'world.paused.host_relay_lost':'Host relay disconnected',
    'world.paused.simulation_error':'Simulation paused after an error',
    'world.pause_votes_reset':'Pause vote reset',
    'player.joined':'Player joined',
    'player.presence_changed':'Player connection changed',
    'order.executed':'Order confirmed',
    'order.rejected':'Order rejected',
    'diplomacy.war_declared':'War declared',
    'diplomacy.peace_signed':'Peace agreement signed',
    'economy.trade_completed':'Trade completed',
    'construction.completed':'Construction completed',
    'world_event.triggered':'World event triggered',
    'world_event.resolved':'World event resolved',
    'world_event.expired':'World event expired',
    'security.alert_issued':'Public security alert issued',
    'security.incident_reported':'Security incident reported',
    'justice.case_opened':'Judicial case opened',
    'finance.debt_default':'Public debt default'
  });

  const HIGH_PRIORITY=new Set([
    'order.rejected','world.paused.no_players',
    'world.paused.no_connected_players','world.paused.host_relay_lost',
    'world.paused.simulation_error','security.incident_reported',
    'security.alert_issued','justice.case_opened',
    'diplomacy.war_declared','finance.debt_default'
  ]);
  const MEDIUM_PREFIXES=[
    'diplomacy.','military.','occupation.','territory.','government.','politics.',
    'law.','security.','justice.','administration.','finance.','industry.',
    'services.','resource.','identity.','world_event.'
  ];
  const REFERENCE_KEYS=[
    'articleId','caseId','proposalId','projectId','incidentId','issueId',
    'treatyId','eventId','taskId','facilityId','unitId','alertId'
  ];

  function cleanText(value,maximum=400) {
    return String(value??'').replace(/[\u0000-\u001f\u007f]/g,' ')
      .replace(/\s+/g,' ').trim().slice(0,maximum);
  }

  function routeFor(type) {
    return ROUTES.find(route=>type.startsWith(route.prefix))||
      {category:'WORLD',view:'world',origin:'WORLD EVENT'};
  }

  function titleFor(type) {
    if(TITLES[type]) return TITLES[type];
    return type.split('.').map(part=>
      part.charAt(0).toUpperCase()+part.slice(1).replace(/_/g,' ')
    ).join(' / ');
  }

  function priorityFor(type) {
    if(HIGH_PRIORITY.has(type)||type.includes('.error')||type.endsWith('.rejected')||
       type.includes('default'))
      return 'high';
    if(MEDIUM_PREFIXES.some(prefix=>type.startsWith(prefix))) return 'medium';
    return 'normal';
  }

  function actionFor(route,stateId,referenceId,pending=false) {
    return Object.freeze({
      kind:pending?'review-order':'navigate',
      view:route.view,stateId:stateId||null,
      referenceId:referenceId||null,
      label:pending?'OPEN ORDERS':'VIEW '+route.view.replace(/-/g,' ').toUpperCase()
    });
  }

  function referenceFor(event) {
    const details=event?.details;
    if(!details||typeof details!=='object') return null;
    for(const key of REFERENCE_KEYS) {
      const value=details[key];
      if(typeof value==='string'&&value.length>0&&value.length<=160) return value;
    }
    return null;
  }

  function buildRecords(events,pendingOrders=[],options={}) {
    const readIds=options.readIds instanceof Set
      ? options.readIds:new Set(Array.isArray(options.readIds)?options.readIds:[]);
    const fallbackDate=cleanText(options.worldDate,10);
    const grouped=new Map();
    const source=Array.isArray(events)?events:[];
    const sorted=source.filter(event=>event&&typeof event==='object')
      .slice(-1000).sort((left,right)=>
        (Number(right.sequence)||0)-(Number(left.sequence)||0));

    for(const event of sorted) {
      const type=cleanText(event.type,100)||'world.event';
      if(IGNORED_EVENTS.has(type)) continue;
      const identity=cleanText(event.id||event.sequence,160);
      if(!identity) continue;
      const stateId=cleanText(event.stateId,160);
      const worldDate=/^\d{4}-\d{2}-\d{2}$/.test(event.worldDate)
        ? event.worldDate:fallbackDate;
      const key=[type,stateId,worldDate].join('|');
      const route=routeFor(type);
      let record=grouped.get(key);
      if(!record) {
        record={
          id:'event:'+key,category:route.category,title:titleFor(type),
          description:cleanText(event.description||type),date:worldDate,
          stateId:stateId||null,view:route.view,priority:priorityFor(type),
          eventIds:[],sequences:[],read:true,count:0,origin:route.origin,
          eventType:type,referenceId:referenceFor(event),action:null,pending:false
        };
        grouped.set(key,record);
      }
      record.eventIds.push(identity);
      record.sequences.push(Number(event.sequence)||0);
      record.count++;
      if(!readIds.has(identity)) record.read=false;
      if(!record.referenceId) record.referenceId=referenceFor(event);
    }

    const records=[...grouped.values()];
    for(const order of Array.isArray(pendingOrders)?pendingOrders:[]) {
      if(!order||typeof order.orderId!=='string'||!order.orderId) continue;
      const description=order.sentOnce
        ? 'Sent to the host. Waiting for authoritative confirmation.'
        : 'Queued locally. This order has not yet been sent.';
      const route=routeFor('order.pending');
      records.push({
        id:'order:'+order.orderId,category:'PENDING ORDER',
        title:cleanText(options.describeOrder?.(order)||'Pending order'),
        description,date:fallbackDate,stateId:order.stateId||null,
        view:route.view,priority:'medium',eventIds:[],sequences:[],
        read:false,count:1,origin:order.sentOnce?'HOST CONFIRMATION':'LOCAL QUEUE',
        referenceId:order.orderId,pending:true,
        action:actionFor(route,order.stateId,order.orderId,true)
      });
    }

    for(const record of records) {
      if(!record.action) {
        const route=routeFor(record.eventType||'world.event');
        record.action=actionFor(route,record.stateId,record.referenceId,false);
      }
      record.sequences.sort((left,right)=>right-left);
    }

    return records.sort((left,right)=>{
      if(left.pending!==right.pending) return left.pending?-1:1;
      return Math.max(...right.sequences,0)-Math.max(...left.sequences,0);
    }).slice(0,60);
  }

  const api=Object.freeze({buildRecords,routeFor,titleFor,priorityFor});
  globalThis.NewWorldCommandInbox=api;
  if(typeof module!=='undefined'&&module.exports) module.exports=api;
})();
