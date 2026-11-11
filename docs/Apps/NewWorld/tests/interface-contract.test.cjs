'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const game=fs.readFileSync(path.join(root,'game.js'),'utf8');
const css=fs.readFileSync(path.join(root,'game.css'),'utf8');
const inbox=fs.readFileSync(path.join(root,'command-inbox.js'),'utf8');

test('every strategic view has exactly one matching navigation tab and a valid ARIA target',()=>{
  const views=[...html.matchAll(/<section id="([^"]+)" class="view[^"]*"/g)]
    .map(match=>match[1]);
  const tabs=[...html.matchAll(/<button class="tab[^"]*"[^>]*data-view="([^"]+)"[^>]*>/g)];
  const viewNames=views.map(id=>id.replace(/-view$/,''));
  const tabNames=tabs.map(match=>match[1]);
  assert.equal(viewNames.length,19);
  assert.equal(tabNames.length,19);
  assert.deepEqual([...tabNames].sort(),[...viewNames].sort());
  for(const match of tabs) {
    const tag=match[0];
    const name=match[1];
    assert.match(tag,new RegExp('aria-controls="'+name+'-view"'));
    assert.match(tag,/aria-selected="(true|false)"/);
  }
  assert.match(game,/document\.querySelectorAll\('\.tab'\)\.forEach\(button => button\.addEventListener\('click'/);
  assert.match(game,/function activateView\(viewName\)/);
});

test('the command inbox is a labelled accessible region with live updates and keyboard dismissal',()=>{
  assert.match(html,/id="command-inbox"[^>]*role="region" aria-labelledby="command-inbox-title"/);
  assert.match(html,/id="command-inbox-title"/);
  assert.match(html,/id="command-inbox-summary" aria-live="polite"/);
  assert.match(html,/id="command-inbox-list" class="command-inbox-list" aria-live="polite"/);
  assert.match(html,/id="command-inbox-toggle"[^>]*aria-controls="command-inbox" aria-expanded="false"/);
  assert.match(game,/event\.key!=='Escape'/);
  assert.match(game,/command-inbox-toggle'\)\.focus\(\)/);
  assert.match(game,/markCommandInboxRead/);
  assert.match(game,/localStorage\.setItem\(inboxReadKey\(\)/);
});

test('command alerts carry stable identity, origin, priority, world date, text and a working navigation action',()=>{
  for(const field of ["id:'event:'+key", 'category:route.category','priority:priorityFor(type)',
    'origin:route.origin','date:worldDate','description:cleanText','action:actionFor']) {
    assert.ok(inbox.includes(field),field);
  }
  assert.match(inbox,/record\.eventIds\.push\(identity\)/);
  assert.match(inbox,/record\.count\+\+/);
  assert.match(inbox,/kind:pending\?'review-order':'navigate'/);
  assert.match(game,/const targetView=record\.action\?\.view\|\|record\.view/);
  assert.match(game,/activateView\(targetView\)/);
  assert.match(game,/focusInboxReference\(targetView,record\.action\?\.referenceId\|\|record\.referenceId\)/);
  assert.match(game,/candidate\.dataset\.recordId===reference/);
  assert.match(game,/candidate\.dataset\.id===reference \|\| candidate\.id===reference/);
  assert.match(game,/selectState\(territory\.index,false,false\)/);
});

test('every active system has an explicit command-inbox route rather than silently opening the world tab',()=>{
  const routes=[
    'order.','player.','diplomacy.','military.','occupation.','territory.',
    'government.','politics.','law.','administration.','technology.','research.',
    'finance.','economy.','trade.','construction.','population.','society.',
    'services.','industry.','resource.','justice.','identity.','media.',
    'security.','world_event.','world.','campaign.'
  ];
  for(const prefix of routes) assert.ok(inbox.includes("prefix:'"+prefix+"'"),prefix);
});

test('panels expose loading, empty, ready, stale, error and no-permission states',()=>{
  for(const state of ['loading','empty','ready','stale','error','no-permission'])
    assert.ok(game.includes("'"+state+"'"),state);
  assert.match(game,/function currentPanelState\(\)/);
  assert.match(game,/return 'empty'/);
  assert.match(game,/return 'stale'/);
  assert.match(game,/setPanelState\(stateName,currentPanelState\(\)\)/);
  assert.match(game,/setPanelState\(panel\.id\.replace/);
  assert.match(game,/,'error',/);
  assert.match(css,/\.view\[data-panel-state="stale"\]::before/);
  assert.match(css,/\.view\[data-panel-state="no-permission"\]::before/);
});

test('the main interface retains a skip link, visible focus, responsive layouts and reduced-motion support',()=>{
  assert.match(html,/class="skip-link" href="#map-viewport"/);
  assert.match(css,/\.command-inbox-toggle:focus-visible/);
  assert.match(css,/@media\(max-width:980px\)/);
  assert.match(css,/@media\(max-width:740px\)/);
  assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
  assert.match(css,/\.skip-link:focus/);
});


test('host backup import and export controls require encrypted files and preserve host-only access',()=>{
  const portable=fs.readFileSync(path.join(root,'portable-backup.js'),'utf8');
  const multiplayer=fs.readFileSync(path.join(root,'multiplayer.js'),'utf8');
  assert.match(html,/id="export-backup-btn"[^>]*hidden/);
  assert.match(html,/id="import-backup-btn"/);
  assert.match(html,/id="import-backup-file" type="file" accept="\.nwbackup,application\/json" hidden/);
  assert.ok(html.indexOf('portable-backup.js')<html.indexOf('multiplayer.js'));
  assert.match(portable,/name:'AES-GCM',length:256/);
  assert.match(portable,/iterations:PBKDF2_ITERATIONS,hash:'SHA-256'/);
  assert.match(portable,/additionalData/);
  assert.ok(multiplayer.includes('exportHostBackup'));
  assert.ok(multiplayer.includes('importHostBackup'));
  assert.ok(multiplayer.includes('session.playerToken!==host.token'));
  assert.ok(multiplayer.includes('Disconnect the current multiplayer session before importing'));
  assert.match(game,/portable\.encrypt\(JSON\.stringify\(hostBackup\),passphrase\)/);
  assert.match(game,/await portable\.decrypt\(encrypted,passphrase\)/);
  assert.match(game,/the original host browser must be fully closed/);
  assert.match(game,/await restoreSession\(\)/);
});

test('future-order controls expose a one-shot world date and author-only cancellation in the command inbox',()=>{
  assert.match(html,/id="order-date-control"[^>]*hidden/);
  assert.match(html,/id="order-target-date" type="date"/);
  assert.match(html,/id="order-date-clear"/);
  assert.match(html,/id="scheduled-order-list"/);
  assert.match(html,/id="scheduled-order-count"/);
  assert.match(game,/function renderOrderDateControl\(\)/);
  assert.match(game,/input\.min=current/);
  assert.match(game,/setUTCDate\(maxDate\.getUTCDate\(\)\+3650\)/);
  assert.match(game,/function renderScheduledOrders\(\)/);
  assert.match(game,/scheduledOrderId:order\.id/);
  assert.match(game,/order\.playerId===onlineSession\?\.playerId/);
  assert.match(game,/type:'cancelScheduledOrder'/);
  assert.match(game,/targetWorldDate/);
  assert.match(game,/input\.value=''/);
  assert.match(game,/type==='cancelScheduledOrder'/);
  assert.match(css,/\.order-date-control/);
  assert.match(css,/\.scheduled-order-card/);
});

test('treaty recipients can submit a complete structured counteroffer from the proposal view',()=>{
  assert.ok(game.includes("counterPanel.className='diplomacy-counter-panel'"));
  assert.ok(game.includes("response:'counter',counterClauses,counterDurationDays"));
  assert.ok(game.includes("checkbox.checked=(proposal.clauses||[]).some"));
  assert.ok(game.includes("submitCounter.disabled=!running||!count"));
  assert.ok(game.includes("The termination notice remains "));
  assert.ok(game.includes("type:'diplomacy.respondTreaty',stateId,proposalId:proposal.id"));
  const diplomacy=fs.readFileSync(path.join(root,'diplomacy-advanced.js'),'utf8');
  assert.ok(diplomacy.includes("!['accept','reject','counter'].includes(order.response)"));
  assert.ok(diplomacy.includes('validateClauses(order.counterClauses)'));
  assert.ok(diplomacy.includes('counterDurationDays'));
  assert.match(css,/\.diplomacy-counter-panel/);
});

test('public procurement exposes its complete staged workflow and does not imply unimplemented external e-tender services',()=>{
  const bureaucracy=fs.readFileSync(path.join(root,'bureaucracy.js'),'utf8');
  for(const id of [
    'procurement-tender-setup','procurement-agency','procurement-province',
    'procurement-competence','procurement-inspection-office','procurement-title',
    'procurement-scope','procurement-estimate','procurement-submission-days',
    'procurement-open-tender','procurement-form-status'
  ]) assert.ok(html.includes('id="'+id+'"'),id);
  for(const type of [
    'openTender','registerBid','awardTender','recordDelivery',
    'inspectDelivery','payContract','cancelTender'
  ]) {
    assert.ok(game.includes("administration.procurement."+type),
      'UI order '+type);
    assert.ok(bureaucracy.includes("administration.procurement."+type),
      'engine order '+type);
  }
  for(const field of [
    'reservedForProcurement','lowest_compliant_bid','inspectionOfficeId',
    'tender_bids_closed','tender_awarded','tender_delivery_inspected','tender_paid'
  ]) assert.ok(bureaucracy.includes(field),field);
  assert.ok(bureaucracy.includes('tender publisher or contract awarder cannot inspect'));
  assert.ok(bureaucracy.includes('releaseTenderReservation'));
  assert.ok(game.includes('REGISTER RECEIVED OFFER'));
  assert.ok(game.includes('AWARD LOWEST VALID OFFER'));
  assert.ok(game.includes('REGISTER DELIVERY'));
  assert.ok(game.includes('ACCEPT DELIVERY'));
  assert.ok(game.includes('AUTHORIZE CONTRACT PAYMENT'));
  assert.ok(html.includes('requires independent delivery inspection before payment'));
  assert.doesNotMatch(html,/Procurement awards, deliveries, inspections and contractor payments are not yet implemented/);
});

test('the Society view exposes epidemic surveillance without inventing default disease data',()=>{
  assert.ok(html.includes('PUBLIC HEALTH / EPIDEMIC SURVEILLANCE'));
  assert.ok(html.includes('id="epidemic-status-list"'));
  assert.ok(html.includes('No pathogen, outbreak or mortality rate is invented by default'));
  assert.ok(html.includes('explicit population-group contact links'));
  assert.ok(game.includes("const epidemicList=$('epidemic-status-list')"));
  assert.ok(game.includes('No configured outbreak in '));
  assert.ok(game.includes('No active world'));
});

test('epidemic configuration is loaded into the host setup and validated by the authoritative engine',()=>{
  assert.ok(html.includes('epidemiology.js?v='));
  assert.ok(game.includes("epidemicDefinitions:'epidemicDefinitions'"));
  assert.ok(game.includes("epidemicStarts:'epidemicStarts'"));
  assert.ok(game.includes("'epidemicDefinitions','epidemicStarts'"));
  const multiplayer=fs.readFileSync(path.join(root,'multiplayer.js'),'utf8');
  const simulation=fs.readFileSync(path.join(root,'simulation.js'),'utf8');
  const scenario=fs.readFileSync(path.join(root,'scenario.js'),'utf8');
  assert.ok(multiplayer.includes('NewWorldEpidemiology?.validateConfiguration'));
  assert.ok(multiplayer.includes('epidemicGroupStates:clone'));
  assert.ok(simulation.includes('NewWorldEpidemiology?.advanceDay'));
  assert.ok(scenario.includes('const epidemicDefinitions='));
  assert.ok(scenario.includes('const epidemicStarts='));
});
