(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const WORLD_MAP_SIZE = 1024;
  const WORLD_MAP_CENTER = WORLD_MAP_SIZE / 2;
  const LEGACY_PLOT_OFFSET = 144;
  const INITIAL_MAP_PLOT = LEGACY_PLOT_OFFSET +
    WORLD_MAP_CENTER * WORLD_MAP_SIZE + WORLD_MAP_CENTER;
  const names = [
    'Kingdom of Coimbrila', 'United Provinces of Gania', 'Chungia', 'Calcilacia',
    'Pician Empire', 'Meityeun Theocracy', 'Swabing', 'Alba',
    'Knosian Despotate', 'Kalestos', 'Gorkirch', 'Duchy of Shonewesia',
    'Shahtehaq', 'Kvinian Empire', 'Shi', 'Kueopia'
  ];
  const initial = {
    year: 1,
    month: 0,
    treasury: 1200,
    governmentFinance: null,
    selected: 0,
    owned: [],
    states: names.map((name, i) => ({
      name,
      pop: Math.round(26000 + ((i * 7919 + 1337) % 56000)),
      prosperity: 42 + (i * 13 % 48),
      infra: 1 + (i % 4),
      owner: 'Unassigned'
    })),
    buildings: {},
    activity: ['Local preview. Create or join a world to play online.']
  };
  const buildingTypes = [
    {id:'farm',name:'FARM',cost:120,income:18,icon:'F',desc:'Adds food capacity for 5,000 residents and supports 1,200 agricultural jobs.',foodCapacity:5000,jobSlots:1200,upkeep:3,days:2},
    {id:'market',name:'MARKET',cost:220,income:34,icon:'M',desc:'Creates 800 commercial jobs and local exchange.',jobSlots:800,upkeep:3,days:3},
    {id:'workshop',name:'WORKSHOP',cost:360,income:52,icon:'W',desc:'Creates 1,800 industrial jobs.',jobSlots:1800,upkeep:5,days:4},
    {id:'housing',name:'HOUSING',cost:180,income:8,icon:'H',desc:'Adds housing for 1,000 new residents.',housingCapacity:1000,upkeep:2,days:2},
    {id:'waterworks',name:'WATERWORKS',cost:300,income:6,icon:'U',desc:'Provides water capacity for 5,000 residents.',waterCapacity:5000,jobSlots:250,upkeep:5,days:4},
    {id:'clinic',name:'CLINIC',cost:420,income:4,icon:'C',desc:'Provides healthcare for 5,000 residents.',healthCapacity:5000,jobSlots:300,upkeep:7,days:5},
    {id:'school',name:'SCHOOL',cost:360,income:5,icon:'S',desc:'Provides education for 5,000 residents.',educationCapacity:5000,jobSlots:350,upkeep:6,days:5},
    {id:'road',name:'ROAD',cost:65,income:0,icon:'R',desc:'Improves local access and creates 40 maintenance jobs.',jobSlots:40,upkeep:1,days:1}
  ];
  const LAW_POLICIES = Object.freeze({
    public_works:{
      title:'Public Works Act',name:'PUBLIC WORKS',min:1,max:15,default:5,
      effectText:value=>'Construction costs will be reduced by '+value+'% in this State.'
    },
    conscription:{
      title:'National Service Act',name:'NATIONAL SERVICE',min:1,max:15,default:8,
      effectText:value=>'Recruitment costs will be reduced by '+value+'% in this State.'
    },
    agricultural_program:{
      title:'Agricultural Development Act',name:'AGRICULTURE',min:1,max:25,default:10,
      effectText:value=>'Population growth will increase by '+value+'% in this State.'
    }
  });
  let selectedLawPolicyId = 'public_works';
  const lawPolicyStrengths = {public_works:5,conscription:8,agricultural_program:10};
  const SESSION_KEY = 'new-world-session-v1';
  const NAME_KEY = 'new-world-player-name-v1';
  const PENDING_ORDERS_KEY = 'new-world-pending-orders-v1';

  function readJson(key) {
    try {
      const value = localStorage.getItem(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      console.error('[new-world] Could not read browser storage:', error);
      return null;
    }
  }

  function getPendingOrders() {
    const orders = readJson(PENDING_ORDERS_KEY);
    return Array.isArray(orders) ? orders : [];
  }

  function savePendingOrders(orders) {
    try {
      localStorage.setItem(PENDING_ORDERS_KEY, JSON.stringify(orders));
      return true;
    } catch (error) {
      console.error('[new-world] Could not persist pending orders:', error);
      showMessage('Cannot safely queue this order in browser storage.', true);
      return false;
    }
  }

  function ordersForCurrentSession() {
    return getPendingOrders().filter(order =>
      order.gameId === onlineSession?.gameId && order.playerId === onlineSession?.playerId);
  }

  function discardPendingOrdersForCurrentSession() {
    const remaining = getPendingOrders().filter(order =>
      order.gameId !== onlineSession?.gameId || order.playerId !== onlineSession?.playerId);
    if (!savePendingOrders(remaining)) return false;
    sentOrderIds.clear();
    renderMultiplayer();
    return true;
  }

  function removePendingOrder(orderId) {
    const remaining = getPendingOrders().filter(order => order.orderId !== orderId);
    if (savePendingOrders(remaining)) {
      sentOrderIds.delete(orderId);
      renderMultiplayer();
    }
  }

  function replayPendingOrders() {
    if (!window.NewWorldMultiplayer?.isConnected() || sentOrderIds.size > 0 ||
        recoveryOrdersNeedCleanup || !onlineGame?.worldVersion) return;
    const queue=getPendingOrders();
    const order=queue.find(item =>
      item.gameId===onlineSession?.gameId && item.playerId===onlineSession?.playerId);
    if(!order || sentOrderIds.has(order.orderId)) return;

    if(!order.sentOnce) {
      order.expectedWorldVersion=Number(onlineGame.worldVersion);
      order.sentOnce=true;
      if(!savePendingOrders(queue)) return;
    }

    sentOrderIds.add(order.orderId);
    const sent=window.NewWorldMultiplayer.sendOrder(order);
    const stillPending=ordersForCurrentSession().some(item=>item.orderId===order.orderId);
    if(sent && stillPending) {
      showMessage('Sent to host: '+describeOrder(order)+'. Waiting for confirmation.');
      renderMultiplayer();
    } else if(!sent) {
      sentOrderIds.delete(order.orderId);
      if(stillPending) {
        const latest=getPendingOrders();
        const pending=latest.find(item=>item.orderId===order.orderId);
        if(pending) pending.sentOnce=false;
        savePendingOrders(latest);
        renderMultiplayer();
      }
    }
  }

  function describeOrder(order) {
    const territoryName=onlineGame?.territories.find(item=>
      item.stateId===order.stateId)?.name || 'selected State';
    if(order.type==='claim')
      return 'Claim '+(onlineGame?.territories[Number(order.territoryIndex)]?.name || 'frontier');
    if(order.type==='build')
      return 'Build '+(order.variantName || order.buildingId)+' in '+territoryName;
    if(order.type==='recruitUnit')
      return 'Recruit '+(onlineGame?.militaryUnitTypes.find(item=>
        item.id===order.unitTypeId)?.name || 'unit')+' in '+territoryName;
    if(order.type==='mobilizeUnit')
      return (order.militaryOrderType==='attack'?'Attack ':'Move to ')+
        (onlineGame?.provinces.find(item=>item.id===order.destinationProvinceId)?.name || 'destination');
    if(order.type==='startProject' || order.type==='cancelProject')
      return (order.type==='startProject'?'Start ':'Cancel research ')+
        (onlineGame?.researchProjects.find(item=>item.id===order.researchProjectId)?.technologyId || '');
    if(order.type==='adoptTechnology')
      return 'Adopt '+(onlineGame?.technologies.find(item=>item.id===order.technologyId)?.name || 'technology');
    if(order.type==='declareWar' || order.type==='makePeace')
      return (order.type==='declareWar'?'Declare war on ':'Make peace with ')+
        (onlineGame?.territories.find(item=>item.stateId===order.targetStateId)?.name || 'State');
    if(order.type==='establishTradeRoute')
      return 'Propose trade route to '+
        (onlineGame?.territories.find(item=>item.stateId===order.destinationStateId)?.name || 'State');
    if(order.type==='respondTradeRoute') return order.accept?'Accept trade route':'Reject trade route';
    if(order.type==='cancelTradeRoute') return 'Cancel trade route';
    if(order.type==='approveBudget') return 'Set government budget to '+money(order.proposedBudget);
    if(order.type==='proposeLaw') return 'Propose law: '+order.decisionTitle;
    if(order.type==='voteDecision') return 'Vote '+order.voteChoice+' on a law';
    if(order.type==='appointOffice') return 'Appoint a government office';
    if(order.type==='justice.reportIncident') return 'Submit an unclassified incident report';
    if(order.type==='justice.openInvestigation') return 'Open a legally authorized investigation';
    if(order.type==='justice.addEvidence') return 'Record evidence in a justice case';
    if(order.type==='movePopulation') return 'Move '+Number(order.quantity||0).toLocaleString('en-US')+' residents between local groups';
    if(order.type==='justice.fileCharges') return 'File charges under the configured law';
    if(order.type==='justice.decideCase') return 'Record a judicial verdict';
    if(order.type==='justice.imposeSentence') return 'Impose a sentence defined by law';
    if(order.type==='justice.fileAppeal') return 'File a judicial appeal';
    if(order.type==='resource.extract') return 'Extract a finite resource deposit';
    if(order.type==='administration.submitDocument') return 'Register a required public document';
    if(order.type==='administration.inspectProjectMilestone') return 'Inspect a public-project milestone';
    if(order.type==='media.publishArticle') return 'Publish a media article';
    if(order.type==='media.submitPoll') return 'Register an opinion poll';
    if(order.type==='media.restrictArticle') return 'Issue a legally authorized media restriction';
    if(order.type==='security.reportIncident') return 'Register a security incident';
    if(order.type==='security.openCase') return 'Open a legally authorized security investigation';
    if(order.type==='security.addReport') return 'Record an intelligence assessment';
    if(order.type==='security.closeCase') return 'Complete independent security oversight';
    if(order.type==='security.issueAlert') return 'Issue a public security alert';
    if(order.type==='security.requestWarrant') return 'Request an independent judicial warrant';
    if(order.type==='security.approveWarrant') return 'Approve or deny a security warrant request';
    if(order.type==='worldEvents.chooseOption') return 'Resolve a world event';
    if(order.type==='identity.fundCommunityProgram') return 'Fund an authorized community programme';
    if(order.type==='pause' || order.type==='resume') return 'Vote to '+order.type+' the world';
    return order.type;
  }

  let state = structuredClone(initial);
  const savedSession = readJson(SESSION_KEY);
  let onlineSession = savedSession?.gameId && savedSession?.playerId && savedSession?.playerToken
    ? savedSession
    : null;
  let onlineGame = null;
  let offlineBackup = null;
  let socket = null;
  let sentOrderIds = new Set();
  let recoveryOrdersNeedCleanup = false;
  let startRequestPending = false;
  let createWorldPending = false;
  let joinWorldPending = false;
  let relayTestPending = false;
  let restorePending = false;
  let selectedPlot = INITIAL_MAP_PLOT;
  let zoom = 1;
  let mapDetailRenderer = null;
  let buildMenu = null;
  let pan = {x: 0, y: 0};
  let drag = null;
  let hoveredState = null;
  let selectedProvinceId = null;
  let activeMapMode = 'political';

  function toast(message) {
    const element = $('toast');
    element.textContent = message;
    element.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => element.classList.remove('show'), 2200);
  }

  function showMessage(message, isError = false) {
    const element = $('multiplayer-message');
    element.textContent = message;
    element.classList.toggle('error', isError);
    $('server-status').classList.toggle('error', isError);
  }

  function money(amount) {
    return '¤ ' + Math.round(amount).toLocaleString('en-US');
  }

  function normalizeBuildings(buildings) {
    const normalized = {};
    for (const [key, building] of Object.entries(buildings || {})) {
      let plotIndex = Number(key);
      if (!Number.isInteger(plotIndex) || plotIndex < 0) continue;
      if (plotIndex < 144) {
        const row = WORLD_MAP_CENTER - 6 + Math.floor(plotIndex / 12);
        const col = WORLD_MAP_CENTER - 6 + (plotIndex % 12);
        plotIndex = LEGACY_PLOT_OFFSET + row * WORLD_MAP_SIZE + col;
      }
      if (plotIndex >= LEGACY_PLOT_OFFSET &&
          plotIndex < LEGACY_PLOT_OFFSET + WORLD_MAP_SIZE * WORLD_MAP_SIZE)
        normalized[plotIndex] = building;
    }
    return normalized;
  }

  function cityIncome() {
    if (onlineGame) return state.governmentFinance?.cityIncome || 0;
    return Object.values(state.buildings).reduce((sum, building) => sum + building.income, 85);
  }

  function ownedIncome() {
    if (onlineGame) return state.governmentFinance?.territoryIncome || 0;
    return state.owned.reduce((sum, index) => {
      const territory = state.states[index];
      return sum + Math.round(territory.pop / 1500 * (territory.prosperity / 100));
    }, 0);
  }

  function balance() {
    if (onlineGame) return state.governmentFinance?.monthlyBalance || 0;
    return cityIncome() + ownedIncome() - Object.keys(state.buildings).length * 2;
  }

  function totalPopulation() {
    return state.owned.reduce((sum, index) => sum + state.states[index].pop, 0);
  }

  function currentPlayer() {
    return onlineGame?.players.find(player => player.id === onlineSession?.playerId) || null;
  }

  function membershipsFor(player) {
    return player?.memberships?.filter(membership => membership.status === 'active') || [];
  }

  function claimFundingSource(player = currentPlayer()) {
    if (!onlineGame || !player) return null;
    return membershipsFor(player).map(membership => ({
      membership,
      territory:onlineGame.territories.find(item => item.stateId === membership.stateId)
    })).filter(item => item.territory && Number(item.territory.treasury) >= 450)
      .sort((a,b) => Number(b.territory.treasury) - Number(a.territory.treasury))[0] || null;
  }

  function governmentMembersFor(territory) {
    if (!onlineGame || !territory) return [];
    return onlineGame.players.filter(player =>
      membershipsFor(player).some(membership => membership.stateId === territory.stateId));
  }

  function formatWorldDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
    if (!match) return 'DATE UNAVAILABLE';
    const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    return Number(match[3]) + ' ' + months[Number(match[2]) - 1] + ' ' + match[1];
  }

  function isOnline() {
    return onlineSession !== null;
  }

  function renderFinancialSummary() {
    $('treasury').textContent = onlineGame ? money(state.treasury) : '—';
    $('population').textContent = onlineGame ? totalPopulation().toLocaleString('en-US') : '—';
    $('balance').textContent = onlineGame
      ? (balance() >= 0 ? '+' : '−') + money(Math.abs(balance()))
      : '—';
    $('city-income').textContent = onlineGame ? money(cityIncome()) : '—';
    $('ledger-treasury').textContent = onlineGame ? money(state.treasury) : '—';
    $('ledger-territory').textContent = onlineGame ? money(ownedIncome()) : '—';
    $('ledger-city').textContent = onlineGame ? money(cityIncome()) : '—';
    $('ledger-cost').textContent = onlineGame ? '−' + money(state.governmentFinance?.upkeep || 0) : '—';
    $('ledger-balance').textContent = onlineGame
      ? (balance() >= 0 ? '+' : '−') + money(Math.abs(balance()))
      : '—';
    renderFinancialLedger();
    renderFinance();
  }

  const PANEL_STATES=new Set(['loading','empty','ready','stale','error','no-permission']);

  function setPanelState(viewName,panelState,message='') {
    const panel=$(viewName+'-view');
    if(!panel || !PANEL_STATES.has(panelState)) return false;
    panel.dataset.panelState=panelState;
    const status=panel.querySelector('[role="status"]');
    if(status) {
      status.dataset.panelState=panelState;
      status.setAttribute('aria-live','polite');
      status.setAttribute('aria-label',viewName+' panel: '+panelState.replace('-',' '));
      if(message) status.textContent=message;
      status.classList.toggle('error',panelState==='error');
    }
    return true;
  }

  function currentPanelState() {
    if(restorePending || (onlineSession && !onlineGame)) return 'loading';
    if(!onlineGame) return 'empty';
    if(!window.NewWorldMultiplayer?.isConnected()) return 'stale';
    return 'ready';
  }

  function renderPanelSafely(label,renderer,statusId) {
    const status=$(statusId);
    const panel=status?.closest('.view');
    try {
      renderer();
      if(panel) {
        const stateName=panel.id.replace(/-view$/,'');
        if(panel.dataset.panelState!=='no-permission') setPanelState(stateName,currentPanelState());
      }
      return true;
    } catch (error) {
      console.error('[new-world] '+label+' panel failed to render:',error);
      if(panel) setPanelState(panel.id.replace(/-view$/,''),'error',
        label+' could not be refreshed. Other controls remain available; reconnect or refresh after checking the connection.');
      else if(status) {
        status.textContent=label+' could not be refreshed. Other game controls remain available; reconnect or refresh after checking the connection.';
        status.classList.add('error');
      }
      return false;
    }
  }

  function renderOrderDateControl() {
    const wrapper=$('order-date-control');
    const input=$('order-target-date');
    if(!wrapper||!input) return;
    const active=Boolean(onlineGame&&isOnline()&&onlineGame.started&&
      onlineGame.status==='running');
    wrapper.hidden=!active;
    if(!active) {
      input.value='';
      return;
    }
    const current=String(onlineGame.worldDate||'');
    input.min=current;
    const maxDate=new Date(current+'T00:00:00.000Z');
    if(Number.isFinite(maxDate.getTime())) {
      maxDate.setUTCDate(maxDate.getUTCDate()+3650);
      input.max=maxDate.toISOString().slice(0,10);
    } else input.removeAttribute('max');
    if(input.value&&input.value<current) input.value='';
  }

  function update() {
    if (state.selected !== null) selectState(state.selected, false, false);
    $('first-steps').hidden=Boolean(onlineGame?.started);
    renderPanelSafely('Financial overview',renderFinancialSummary,'state-currency');
    renderPanelSafely('Campaign objectives',renderObjectives,'state-description');
    $('date-label').textContent = isOnline()
      ? formatWorldDate(onlineGame?.worldDate) + ' / DAY ' + String(onlineGame?.day || 1).padStart(3, '0')
      : 'MULTIPLAYER REQUIRED';
    renderOrderDateControl();
    $('activity').innerHTML = state.activity.slice(0, 8)
      .map(item => '<div class="activity-item"><small>WORLD RECORD</small>' + escapeHtml(item) + '</div>').join('');
    $('world-mode').textContent = onlineGame?.status === 'completed'
      ? 'CAMPAIGN COMPLETED · VICTORY'
      : isOnline() ? 'PRIVATE MULTIPLAYER' : 'MULTIPLAYER REQUIRED';
    $('legend-owned').textContent = onlineGame ? 'YOUR GOVERNMENT' : 'GOVERNMENT MEMBERSHIP';
    $('legend-other').textContent = onlineGame ? 'OTHER STATES' : 'WORLD DATA UNAVAILABLE';
    $('current-state-label').textContent = onlineGame
      ? String(state.states[state.selected]?.name || 'NOT SELECTED').toUpperCase()
      : '—';
    const relayConnected=Boolean(window.NewWorldMultiplayer?.isConnected());
    $('connection-state-label').textContent = !isOnline()
      ? 'OFFLINE'
      : relayConnected ? 'CONNECTED' : 'RECONNECTING';
    $('connection-state-label').classList.toggle('connection-warning',isOnline() && !relayConnected);
    const hostCanSave=isOnline() && Boolean(window.NewWorldMultiplayer?.isHost());
    $('save-btn').hidden=!hostCanSave;
    $('export-backup-btn').hidden=!hostCanSave;
    $('import-backup-btn').hidden=isOnline();
    const saveStatus=hostCanSave ? window.NewWorldMultiplayer.saveStatus?.() : null;
    $('save-btn').textContent=saveStatus?.error?'SAVE ISSUE':'SAVE';
    $('save-btn').title=saveStatus?.error
      ? 'Last save failed: '+saveStatus.error
      : saveStatus?.savedAt
        ? 'Last verified local save: '+saveStatus.savedAt+
          (saveStatus.backupAvailable?' · previous verified copy retained':'')
        : 'Save the world locally and verify its previous copy.';
    $('save-btn').classList.toggle('save-warning',Boolean(saveStatus?.error));
    renderPlayerProfile();
    $('next-month').hidden = true;
    $('world-time').hidden = !isOnline();
    $('world-time').textContent = isOnline()
      ? onlineGame?.status === 'completed'
        ? 'VICTORY · ' + formatWorldDate(onlineGame.completedOn || onlineGame.worldDate)
        : onlineGame?.started
          ? onlineGame.paused ? 'PAUSED · HOST CLOCK' : '1 DAY / 5 MIN · HOST CLOCK'
          : 'LOBBY · CLOCK PAUSED'
      : '';
    renderWorldClock();
    renderPanelSafely('Settlement',renderCity,'settlement-status');
    renderPanelSafely('Build controls',renderOptions,'settlement-status');
    renderPanelSafely('Multiplayer',renderMultiplayer,'multiplayer-message');
    renderPanelSafely('Economy',renderEconomy,'trade-route-status');
    renderPanelSafely('Government',renderGovernment,'government-status');
    renderPanelSafely('Territories',renderTerritory,'territory-status');
    renderPanelSafely('Military',renderMilitary,'military-status');
    renderPanelSafely('Research',renderTechnology,'technology-status');
    renderPanelSafely('Diplomacy',renderDiplomacy,'diplomacy-status');
    renderPanelSafely('Justice',renderJustice,'justice-status');
    renderPanelSafely('Resources',renderResources,'resources-status');
    renderPanelSafely('Services',renderServices,'services-status');
    renderPanelSafely('Industry',renderIndustry,'industry-status');
    renderPanelSafely('Administration',renderAdministration,'administration-status');
    renderPanelSafely('Media',renderMedia,'media-status');
    renderPanelSafely('Security',renderSecurity,'security-status');
    renderPanelSafely('World events',renderWorldEvents,'world-events-status');
    renderPanelSafely('Identity',renderIdentity,'identity-status');
    renderPanelSafely('Society',renderDemography,'demography-status');
    renderPanelSafely('Scenario validation',renderScenarioAudit,'scenario-status');
    renderPanelSafely('Map',()=>highlightMap(state.selected),'state-description');
    renderCommandInbox();
  }

  const INBOX_READ_PREFIX = 'new-world-inbox-read-v1:';

  function inboxReadKey() {
    return INBOX_READ_PREFIX + (onlineSession?.gameId || 'offline') + ':' +
      (onlineSession?.playerId || 'local');
  }

  function readInboxIds() {
    try {
      const value=JSON.parse(localStorage.getItem(inboxReadKey()) || '[]');
      return new Set(Array.isArray(value) ? value.filter(id=>typeof id==='string').slice(-500) : []);
    } catch {
      return new Set();
    }
  }

  function storeInboxIds(ids) {
    try {
      localStorage.setItem(inboxReadKey(),JSON.stringify([...ids].slice(-500)));
      return true;
    } catch (error) {
      console.error('[new-world] Could not save inbox read state:',error);
      return false;
    }
  }

  function inboxRecords() {
    if(!onlineGame) return [];
    const inbox=window.NewWorldCommandInbox;
    if(!inbox?.buildRecords) return [];
    return inbox.buildRecords(
      onlineGame.events||[],ordersForCurrentSession(),{
        readIds:readInboxIds(),worldDate:onlineGame.worldDate,
        describeOrder
      }
    );
  }

  function renderPlayerProfile() {
    const button=$('player-profile-toggle');
    const label=$('player-profile-name');
    if(!button || !label) return;
    const identity=onlineGame?.players.find(player=>
      player.id===onlineSession?.playerId);
    const localName=String($('player-name')?.value || '').trim();
    const name=identity?.name || onlineSession?.playerName || localName || 'SET PLAYER';
    label.textContent=String(name).toUpperCase();
    button.title=isOnline()
      ? 'Current player: '+name+'. Open player and session details.'
      : 'Local player name: '+name+'. Open player identity and session setup.';
    button.setAttribute('aria-label',button.title);
  }

  function renderWorldClock() {
    const meter=$('world-clock-progress');
    const fill=$('world-clock-progress-fill');
    if(!meter || !fill) return;
    const active=Boolean(isOnline() && onlineGame?.started &&
      onlineGame.status==='running');
    meter.hidden=!active;
    if(!active) {
      meter.setAttribute('aria-valuenow','0');
      fill.style.width='0%';
      return;
    }
    const clock=window.NewWorldMultiplayer?.clockPresentation?.();
    const progress=Math.max(0,Math.min(.999,Number(clock?.progress) || 0));
    const percent=Math.round(progress*1000)/10;
    meter.setAttribute('aria-valuenow',String(Math.round(progress*100)));
    meter.setAttribute('aria-valuetext',
      Math.floor(Number(clock?.elapsedMs) / 1000)+' of 300 seconds');
    meter.title='Host-authoritative clock · '+percent.toFixed(1)+'% of this day';
    fill.style.width=percent+'%';
  }

  function renderScheduledOrders() {
    const list=$('scheduled-order-list');
    const count=$('scheduled-order-count');
    if(!list||!count) return;
    list.replaceChildren();
    const orders=(onlineGame?.scheduledOrders||[]).slice()
      .sort((left,right)=>
        String(left.targetWorldDate).localeCompare(String(right.targetWorldDate))||
        Number(left.sequence)-Number(right.sequence));
    const pending=orders.filter(item=>item.status==='scheduled');
    count.textContent=pending.length+' pending';
    if(!onlineGame||!orders.length) {
      const empty=document.createElement('p');
      empty.className='scheduled-order-empty';
      empty.textContent=onlineGame
        ? 'No future orders are scheduled.'
        : 'Connect to a world to view future orders.';
      list.appendChild(empty);
      return;
    }
    for(const order of orders.slice(-24).reverse()) {
      const row=document.createElement('article');
      row.className='scheduled-order-card status-'+String(order.status||'scheduled').replace(/[^a-z_-]/g,'');
      const heading=document.createElement('div');
      heading.className='scheduled-order-card-heading';
      const title=document.createElement('strong');
      title.textContent=String(order.type||'ORDER').replaceAll('.',' / ').replaceAll('_',' ').toUpperCase();
      const date=document.createElement('time');
      date.dateTime=order.targetWorldDate||'';
      date.textContent=order.targetWorldDate?formatWorldDate(order.targetWorldDate):'DATE UNAVAILABLE';
      heading.append(title,date);
      const territory=onlineGame.territories.find(item=>item.stateId===order.stateId);
      const author=onlineGame.players.find(item=>item.id===order.playerId);
      const detail=document.createElement('p');
      detail.textContent=(territory?.name||'Unknown State')+' · '+
        (author?.name||'Unknown author')+' · '+String(order.status||'scheduled').toUpperCase();
      row.append(heading,detail);
      if(order.status==='rejected'&&order.result) {
        const reason=document.createElement('p');
        reason.className='scheduled-order-result';
        reason.textContent=order.result;
        row.appendChild(reason);
      }
      const isAuthor=order.playerId===onlineSession?.playerId;
      const membership=membershipsFor(currentPlayer()).find(item=>
        item.stateId===order.stateId&&item.status==='active');
      if(order.status==='scheduled'&&isAuthor&&membership&&
         membership.permissionSetId!=='government-observer') {
        const cancel=document.createElement('button');
        cancel.type='button';
        cancel.className='secondary-button scheduled-order-cancel';
        cancel.textContent='CANCEL ORDER';
        cancel.disabled=onlineGame.status!=='running'||!window.NewWorldMultiplayer?.isConnected();
        cancel.addEventListener('click',()=>{
          sendAction({type:'cancelScheduledOrder',stateId:order.stateId,
            scheduledOrderId:order.id});
        });
        row.appendChild(cancel);
      }
      list.appendChild(row);
    }
  }

  function renderCommandInbox() {
    renderScheduledOrders();
    const list=$('command-inbox-list');
    const toggle=$('command-inbox-toggle');
    if(!list || !toggle) return;
    const records=inboxRecords();
    const unread=records.filter(item=>!item.read).length;
    const pending=records.filter(item=>item.pending).length;
    const badge=$('command-inbox-count');
    badge.textContent=unread>99?'99+':String(unread);
    badge.hidden=unread===0;
    toggle.setAttribute('aria-label',unread
      ? 'Open command inbox, '+unread+' unread items'
      : 'Open command inbox');
    const summary=$('command-inbox-summary');
    summary.textContent=onlineGame
      ? records.length+' recent alerts · '+pending+' pending orders · '+
        unread+' unread'
      : 'Connect to a world to receive updates.';
    list.replaceChildren();
    if(!onlineGame || records.length===0) {
      const empty=document.createElement('div');
      empty.className='command-inbox-empty';
      empty.textContent=onlineGame
        ? 'NO NEW COMMANDS OR ALERTS. WORLD EVENTS WILL APPEAR HERE.'
        : 'NO ACTIVE WORLD. CREATE OR JOIN A MULTIPLAYER SESSION TO ENABLE THE COMMAND INBOX.';
      list.appendChild(empty);
      return;
    }
    for(const record of records) {
      const button=document.createElement('button');
      button.type='button';
      button.className='command-inbox-item'+
        (!record.read?' unread':'')+
        (record.priority==='high'?' priority-high':
          record.priority==='medium'?' priority-medium':'');
      button.dataset.eventType=record.eventType||'order.pending';
      if(record.referenceId) button.dataset.referenceId=record.referenceId;
      button.setAttribute('aria-label',
        (record.read?'Read':'Unread')+' '+record.priority+' priority alert. '+
        record.category+': '+record.title+'. '+record.description+
        (record.count>1?'. '+record.count+' grouped occurrences.':''));
      const top=document.createElement('span');
      top.className='command-inbox-item-top';
      const category=document.createElement('span');
      category.className='command-inbox-category';
      category.textContent=record.category+(record.count>1?' · '+record.count:'');
      const date=document.createElement('span');
      date.className='command-inbox-date';
      date.textContent=record.date?formatWorldDate(record.date):'DATE UNAVAILABLE';
      top.append(category,date);
      const title=document.createElement('strong');
      title.textContent=record.title;
      const description=document.createElement('p');
      description.textContent=record.description;
      const bottom=document.createElement('span');
      bottom.className='command-inbox-item-bottom';
      const origin=document.createElement('span');
      origin.textContent=record.origin;
      const action=document.createElement('span');
      action.textContent=(record.action?.label||'VIEW DETAILS')+' →';
      bottom.append(origin,action);
      button.append(top,title,description,bottom);
      button.addEventListener('click',()=>{
        if(record.eventIds.length) {
          const ids=readInboxIds();
          record.eventIds.forEach(id=>ids.add(id));
          storeInboxIds(ids);
        }
        const targetStateId=record.action?.stateId||record.stateId;
        if(targetStateId) {
          const territory=onlineGame?.territories.find(item=>item.stateId===targetStateId);
          if(territory) selectState(territory.index,false,false);
        }
        const targetView=record.action?.view||record.view;
        activateView(targetView);
        focusInboxReference(targetView,record.action?.referenceId||record.referenceId);
        $('command-inbox').hidden=true;
        $('command-inbox-toggle').setAttribute('aria-expanded','false');
        renderCommandInbox();
      });
      list.appendChild(button);
    }
  }

  function markCommandInboxRead() {
    if(!onlineGame) return;
    const ids=readInboxIds();
    for(const record of inboxRecords())
      record.eventIds.forEach(id=>ids.add(id));
    storeInboxIds(ids);
    renderCommandInbox();
  }

  function renderObjectives() {
    const list = $('campaign-objectives');
    if (!list) return;
    list.replaceChildren();
    if (!onlineGame || !onlineSession?.playerId) {
      addPoliticalRow(list,'Campaign objectives','Create or join a multiplayer world to track your progress.');
      return;
    }
    for (const objective of window.NewWorldStrategy?.objectivesFor?.(onlineGame,onlineSession.playerId) || []) {
      const status = objective.completed ? 'COMPLETED' :
        Number(objective.progress).toLocaleString('en-US') + ' / ' +
        Number(objective.target).toLocaleString('en-US');
      addPoliticalRow(list,objective.name + ' · ' + status,objective.description);
    }
  }

  function renderEconomy() {
    const list = $('company-list');
    list.replaceChildren();
    const marketsList = $('market-list');
    marketsList.replaceChildren();
    const populationList = $('population-group-list');
    populationList.replaceChildren();
    const routesList = $('trade-route-list');
    routesList.replaceChildren();
    $('economy-setup-panel').hidden = !onlineGame ||
      onlineGame.started ||
      onlineGame.hostPlayerId !== onlineSession?.playerId;
    $('trade-route-controls').hidden = true;
    if (!onlineGame) {
      addPoliticalRow(list, 'No production data', 'Connect to a multiplayer world to load server-authoritative inventories.');
      addPoliticalRow(marketsList, 'No market data', 'Connect to a multiplayer world to load prices, supply, and demand.');
      addPoliticalRow(populationList, 'No population data', 'Connect to a multiplayer world to load configured population needs.');
      addPoliticalRow(routesList, 'No trade routes', 'Trade routes are configured as part of the pre-game economic scenario.');
      return;
    }

    const territory = onlineGame.territories.find(item => item.index === state.selected);
    if (territory) {
      const metrics = window.NewWorldSimulation?.getSettlementMetrics?.(territory);
      const residents = Number(territory.population || 0);
      const ratio = (available,needed) => needed <= 0 ? 100 :
        Math.round(Math.max(0,Math.min(1,available/needed))*100);
      const workforce = Number(metrics?.workingAgePopulation || 0);
      const coverage = [
        'housing ' + ratio(metrics?.housingCapacity || 0,residents) + '%',
        'food ' + ratio(metrics?.foodCapacity || 0,residents) + '%',
        'water ' + ratio(metrics?.waterCapacity || 0,residents) + '%',
        'health ' + ratio(metrics?.healthCapacity || 0,residents*.25) + '%',
        'education ' + ratio(metrics?.educationCapacity || 0,workforce*.45) + '%',
        'employment ' + ratio(metrics?.availableJobs || 0,workforce) + '%'
      ];
      addPoliticalRow(populationList,
        'Settlement condition · prosperity ' + Number(territory.prosperity || 0).toFixed(1),
        coverage.join(' · ') + ' · daily change ' +
          Number(territory.prosperityChangeLastDay || 0).toFixed(2));
    }
    const companies = onlineGame.companies?.filter(company => company.stateId === territory?.stateId) || [];
    if (!companies.length) {
      addPoliticalRow(list, 'No companies configured', 'This State has no configured production facilities.');
    } else for (const company of companies) {
      const inventory = Object.entries(company.inventory || {}).map(([goodId, quantity]) => {
        const good = onlineGame.goods?.find(item => item.id === goodId);
        const capacity = good?.storageCapacity
          ? ' / ' + good.storageCapacity + ' ' + good.unit + ' capacity'
          : '';
        return quantity + capacity + ' ' + (good?.unit || goodId) + ' ' + (good?.name || '');
      });
      const facilities = (company.facilities || []).map(facility =>
        facility.recipeName + ' · ' + facility.progressDays + '/' + facility.daysPerBatch + ' day(s)');
      const cash = Object.entries(company.cashBalances || {}).map(([currencyId, amount]) => {
        const currency = onlineGame.currencies?.find(item => item.id === currencyId);
        const currencyName = currency?.code || currency?.name || 'currency ' + currencyId.slice(0, 8);
        return money(amount) + ' ' + currencyName;
      });
      addPoliticalRow(
        list,
        company.name + ' · ' + company.sector,
        'Inventory: ' + (inventory.join(', ') || 'empty') +
        ' · Production: ' + (facilities.join(', ') || 'no active facilities') +
        ' · Cash: ' + (cash.join(', ') || 'no recorded balance'));
    }

    const markets = onlineGame.markets?.filter(item => item.stateId === territory?.stateId) || [];
    if (!markets.length) {
      addPoliticalRow(marketsList, 'No markets configured', 'The world has no configured market data for this State.');
    } else for (const market of markets) {
      const good = onlineGame.goods?.find(item => item.id === market.goodId);
      const currency = onlineGame.currencies?.find(item => item.stateId === market.stateId);
      const latest = (onlineGame.marketHistory || [])
        .filter(item => item.stateId === market.stateId && item.goodId === market.goodId)
        .slice()
        .sort((left, right) => right.worldDate.localeCompare(left.worldDate))[0];
      const unit = good?.unit || 'units';
      const currencyName = currency?.code || currency?.name || 'State currency units';
      addPoliticalRow(
        marketsList,
        (good?.name || market.goodId) + ' · ' + money(market.currentPrice) + ' / ' + unit,
        'Daily demand: ' + market.dailyDemand + ' ' + unit +
          ' · Budget: ' + money(market.dailyConsumerBudget) + ' ' + currencyName +
          ' · Price bounds: ' + money(market.minimumPrice) + '–' + money(market.maximumPrice) +
          (latest
            ? ' · Population demand: ' + latest.populationDemand + ' ' + unit +
              ' · population need met: ' + latest.populationQuantitySold +
              ', unmet: ' + latest.populationUnmetDemand +
              ' · Last clearing ' + formatWorldDate(latest.worldDate) + ': ' +
              latest.quantitySold + ' sold, ' + latest.unmetDemand + ' unmet; ' +
              latest.domesticSupply + ' domestic / ' + latest.importedSupply + ' imported'
            : ' · Population needs are added per 1,000 residents at each daily clearing; awaiting first clearing'));
    }

    const populationGroups = onlineGame.populationGroups?.filter(item =>
      item.stateId === territory?.stateId) || [];
    if (!populationGroups.length) {
      addPoliticalRow(populationList, 'No population groups configured', 'Population-derived market demand requires explicit scenario groups and per-good need rates.');
    } else for (const group of populationGroups) {
      const needs = (group.needs || []).map(need => {
        const good = onlineGame.goods?.find(item => item.id === need.goodId);
        return (good?.name || need.goodId) + ': ' +
          need.dailyQuantityPerThousandPeople + ' ' + (good?.unit || 'units') +
          ' per 1,000 residents/day';
      });
      addPoliticalRow(
        populationList,
        group.name + ' · ' + Number(group.population).toLocaleString('en-US') + ' residents',
        'Configured needs: ' + (needs.join(', ') || 'none'));
    }

    const routes = (onlineGame.tradeRoutes || []).filter(route =>
      route.exportStateId === territory?.stateId || route.importStateId === territory?.stateId);
    if (!routes.length) {
      addPoliticalRow(routesList, 'No trade routes configured', 'Connect markets in other territories to import surplus goods and expand regional supply.');
    }
    const routeMembership = membershipsFor(currentPlayer()).find(item =>
      item.stateId === territory?.stateId);
    for (const route of routes) {
      const origin = onlineGame.territories.find(item => item.stateId === route.exportStateId);
      const destination = onlineGame.territories.find(item => item.stateId === route.importStateId);
      const good = onlineGame.goods?.find(item => item.id === route.goodId);
      const exporterCompany = onlineGame.companies?.find(item => item.id === route.exporterCompanyId);
      const importerCompany = onlineGame.companies?.find(item => item.id === route.importerCompanyId);
      const bilateralTerms = exporterCompany && importerCompany
        ? ' · ' + exporterCompany.name + ' → ' + importerCompany.name +
          ' · contracted daily quantity ' + route.dailyQuantity +
          ' at ' + money(route.unitPrice) + ' per ' + (good?.unit || 'unit')
        : ' · daily capacity ' + route.dailyCapacity + ' ' + (good?.unit || 'units') +
          ' · public market imports settle in the importing State';
      const routeStatus = route.status ||
        (route.enabled === false ? 'cancelled' : 'active');
      const row = addPoliticalRow(
        routesList,
        (origin?.name || 'Unknown State') + ' → ' + (destination?.name || 'Unknown State') +
          ' · ' + (good?.name || route.goodId),
        routeStatus.toUpperCase().replaceAll('_',' ') + bilateralTerms);
      const isImporter = route.importStateId === territory?.stateId;
      const isExporter = route.exportStateId === territory?.stateId;
      if (routeMembership && isImporter && routeStatus === 'pending' &&
          route.createdByPlayerId !== currentPlayer()?.id &&
          onlineGame.status === 'running') {
        for (const [accept,label] of [[true,'ACCEPT ROUTE'],[false,'REJECT ROUTE']]) {
          const response = document.createElement('button');
          response.type = 'button';
          response.className = 'secondary-button';
          response.textContent = label;
          response.addEventListener('click',() => sendAction({
            type:'respondTradeRoute',stateId:territory.stateId,
            tradeRouteId:route.id,accept
          }));
          row.appendChild(response);
        }
      }
      if (routeMembership && (isExporter || isImporter) &&
          ['active','pending'].includes(routeStatus) &&
          onlineGame.status === 'running') {
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'secondary-button';
        cancel.textContent = routeStatus === 'pending' ? 'WITHDRAW PROPOSAL' : 'CANCEL ROUTE';
        cancel.addEventListener('click',() => sendAction({
          type:'cancelTradeRoute',stateId:territory.stateId,tradeRouteId:route.id
        }));
        row.appendChild(cancel);
      }
    }

    const routeControls = $('trade-route-controls');
    const destinationSelect = $('trade-route-destination');
    const goodSelect = $('trade-route-good');
    const routeCapacity = $('trade-route-capacity');
    const createRoute = $('create-trade-route');
    const routeStatus = $('trade-route-status');
    const previousDestination = destinationSelect.value;
    const destinations = onlineGame.territories.filter(item =>
      item.stateId !== territory?.stateId &&
      (onlineGame.markets || []).some(market => market.stateId === item.stateId));
    routeControls.hidden = !routeMembership || onlineGame.status !== 'running';
    destinationSelect.replaceChildren();
    for (const destination of destinations) {
      const option = document.createElement('option');
      option.value = destination.stateId;
      option.textContent = destination.name;
      destinationSelect.appendChild(option);
    }
    if (destinations.some(item => item.stateId === previousDestination))
      destinationSelect.value = previousDestination;
    const destinationStateId = destinationSelect.value;
    const availableGoods = (onlineGame.goods || []).filter(good =>
      (onlineGame.companies || []).some(company => company.stateId === territory?.stateId) &&
      (onlineGame.markets || []).some(market =>
        market.stateId === destinationStateId && market.goodId === good.id) &&
      !(onlineGame.tradeRoutes || []).some(route =>
        route.exportStateId === territory?.stateId &&
        route.importStateId === destinationStateId && route.goodId === good.id &&
        ['active','pending'].includes(route.status || (route.enabled===false?'cancelled':'active'))));
    const previousGood = goodSelect.value;
    goodSelect.replaceChildren();
    for (const good of availableGoods) {
      const option = document.createElement('option');
      option.value = good.id;
      option.textContent = good.name + ' · ' + good.unit;
      goodSelect.appendChild(option);
    }
    if (availableGoods.some(item => item.id === previousGood))
      goodSelect.value = previousGood;
    const validCapacity = routeCapacity.value && routeCapacity.checkValidity() &&
      Number.isSafeInteger(Number(routeCapacity.value));
    createRoute.disabled = onlineGame.status !== 'running' ||
      !routeMembership || !destinationStateId || !goodSelect.value ||
      !validCapacity || Number(routeCapacity.value) < 1 ||
      Number(routeCapacity.value) > 500 || Number(territory?.treasury || 0) < 150 ||
      socket?.readyState !== WebSocket.OPEN;
    routeStatus.textContent = !destinations.length
      ? 'No other State markets are available in this world.'
      : !availableGoods.length
        ? 'No unconnected goods markets are available for this destination.'
        : 'Establishment: ¤150 · Capacity: 1–500 units per world day. A route to another player requires their approval.';
  }

  function renderTerritory() {
    const provinceList = $('province-list');
    const settlementList = $('settlement-list');
    const controlList = $('territorial-control-list');
    for (const list of [provinceList, settlementList, controlList]) list.replaceChildren();
    const territory = onlineGame?.territories.find(item => item.index === state.selected);
    $('territory-title').textContent = territory?.name || 'Territorial administration';
    $('territory-setup-panel').hidden = !canConfigureScenario();
    if (!onlineGame || !territory) {
      $('territory-status').textContent = 'Connect to a multiplayer world and select a State to inspect territorial data.';
      addPoliticalRow(provinceList, 'No province data', 'Province records are loaded from the host scenario.');
      addPoliticalRow(settlementList, 'No settlement data', 'Settlement records are loaded from the host scenario.');
      addPoliticalRow(controlList, 'No control history', 'Control and sovereignty records are kept separately.');
      return;
    }

    const provinces = (onlineGame.provinces || []).filter(item =>
      item.stateId === territory.stateId);
    const selectedProvince = provinces.find(item => item.id === selectedProvinceId);
    $('territory-status').textContent = provinces.length
      ? provinces.length + ' configured province(s) · sovereignty and effective control are distinct.' +
        (selectedProvince ? ' Selected: ' + selectedProvince.name + '.' : '')
      : 'Province configuration is pending for this State.';
    if (!provinces.length) addPoliticalRow(provinceList, 'No provinces configured', 'No province values are inferred from the map.');
    for (const province of provinces) {
      const currentControls = (onlineGame.territorialControls || []).filter(item =>
        item.provinceId === province.id);
      addPoliticalRow(
        provinceList,
        province.name,
        'Sovereignty: ' +
          (onlineGame.territories.find(item => item.stateId === province.sovereignStateId)?.name || 'unknown') +
          ' · SVG mapping: ' + (province.svgElementId || 'not assigned') +
          ' · population: ' + Number(province.population || 0).toLocaleString('en-US') +
          ' · terrain: ' + (province.terrainId || 'pending') +
          ' · control records: ' + currentControls.length);
    }

    const provinceIds = new Set(provinces.map(item => item.id));
    const settlements = (onlineGame.settlements || []).filter(item =>
      provinceIds.has(item.provinceId));
    if (!settlements.length) addPoliticalRow(settlementList, 'No settlements configured', 'No settlement data is available.');
    for (const settlement of settlements) {
      addPoliticalRow(
        settlementList,
        settlement.name + ' · ' + settlement.type,
        Number(settlement.population).toLocaleString('en-US') + ' residents · province ' +
          (provinces.find(item => item.id === settlement.provinceId)?.name || 'unknown'));
    }

    const controls = (onlineGame.territorialControls || []).filter(item =>
      provinceIds.has(item.provinceId));
    const sovereignty = (onlineGame.sovereigntyHistory || []).filter(item =>
      provinceIds.has(item.provinceId));
    if (!controls.length && !sovereignty.length)
      addPoliticalRow(controlList, 'No control or sovereignty changes', 'No changes are recorded.');
    for (const item of controls) {
      const province = provinces.find(candidate => candidate.id === item.provinceId);
      const stateName = onlineGame.territories.find(candidate => candidate.stateId === item.stateId)?.name;
      addPoliticalRow(
        controlList,
        province?.name || 'Province',
        String(item.type) + ' control · ' + formatWorldDate(item.effectiveFrom),
        (stateName || 'Unknown State') + ' · ' + item.cause);
    }
    for (const item of sovereignty) {
      const province = provinces.find(candidate => candidate.id === item.provinceId);
      const previous = onlineGame.territories.find(candidate => candidate.stateId === item.previousStateId)?.name;
      const next = onlineGame.territories.find(candidate => candidate.stateId === item.newStateId)?.name;
      addPoliticalRow(
        controlList,
        province?.name || 'Province',
        'Sovereignty · ' + formatWorldDate(item.effectiveOn),
        (previous || 'No previous State') + ' → ' + (next || 'Unknown State') +
          ' · ' + item.legalMechanism);
    }
  }

  function renderMilitary() {
    const unitsList = $('military-unit-list');
    const operationsList = $('military-operation-list');
    const occupationsList = $('occupation-list');
    for (const list of [unitsList, operationsList, occupationsList]) list.replaceChildren();
    const territory = onlineGame?.territories.find(item => item.index === state.selected);
    $('military-title').textContent = territory?.name
      ? territory.name + ' · Military situation'
      : 'Military situation';
    $('military-setup-panel').hidden = !canConfigureScenario();
    if (!onlineGame || !territory) {
      $('military-status').textContent = 'Connect to a multiplayer world and select a State to inspect military data.';
      addPoliticalRow(unitsList, 'No military units', 'No host-authoritative unit data is available.');
      addPoliticalRow(operationsList, 'No operations or battles', 'Operations are recorded by the host.');
      addPoliticalRow(occupationsList, 'No occupation data', 'Occupation never changes sovereignty by itself.');
      return;
    }

    const membership = membershipsFor(currentPlayer()).find(item => item.stateId === territory.stateId);
    if (membership && membership.permissionSetId !== 'government-observer') {
      const recruitment = addPoliticalRow(unitsList,'Recruitment and mobilisation','Recruit units from the State treasury. Military orders are resolved by the host.');
      const activeUnitCount=(onlineGame.militaryUnits || []).filter(item =>
        item.stateId===territory.stateId && item.personnel>0).length;
      for (const unitType of onlineGame.militaryUnitTypes || []) {
        const discovered = !unitType.requiredTechnologyId ||
          (onlineGame.technologyUnlocks || []).some(item =>
            item.stateId === territory.stateId && item.technologyId === unitType.requiredTechnologyId);
        const discount = Math.min(.5,window.NewWorldStrategy?.effectValue?.(onlineGame,territory.stateId,'recruitment_discount') || 0);
        const cost = Math.ceil(Number(unitType.recruitmentCost || 0) * (1-discount));
        const permission=membership.permissionSetId!=='government-observer' &&
          (unitType.commandPermissionSetIds || []).includes(membership.permissionSetId);
        const reason=!discovered
          ? 'Research '+unitType.requiredTechnologyId+' first.'
          : onlineGame.status!=='running'
            ? onlineGame.status==='lobby'?'Start the world before recruiting.':'The world must be running to recruit.'
            : socket?.readyState!==WebSocket.OPEN
              ? 'Reconnect to the host before recruiting.'
              : !permission
                ? 'Your government role cannot recruit this unit.'
                : activeUnitCount>=12
                  ? 'This State has reached the 12-unit limit.'
                  : Number(territory.treasury)<cost
                    ? 'The State needs '+money(cost)+' in its treasury.'
                    : 'Recruit one unit from the State treasury.';
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = 'RECRUIT ' + unitType.name.toUpperCase() + ' · ' + money(cost);
        button.disabled=reason!=='Recruit one unit from the State treasury.';
        button.title=reason;
        button.addEventListener('click',() => sendAction({
          type:'recruitUnit',stateId:territory.stateId,unitTypeId:unitType.id
        }));
        recruitment.appendChild(button);
      }
    }
    const accessibleStateIds = new Set(membershipsFor(currentPlayer()).map(item => item.stateId));
    const units = (onlineGame.militaryUnits || []).filter(item =>
      accessibleStateIds.has(item.stateId));
    $('military-status').textContent = units.length
      ? units.filter(unit => unit.personnel>0).length + ' active unit(s) · recruitment, movement and battles are processed by the host.'
      : 'No field units are currently stationed in this State.';
    if (!units.length) addPoliticalRow(unitsList, 'No units recruited', 'Recruit militia to begin expanding your military.');

    for (const unit of units) {
      const type = (onlineGame.militaryUnitTypes || []).find(item => item.id === unit.unitTypeId);
      const province = (onlineGame.provinces || []).find(item => item.id === unit.provinceId);
      const commander = (onlineGame.militaryCommanders || []).find(item => item.id === unit.commanderId);
      const row = addPoliticalRow(
        unitsList,
        type?.name || unit.unitTypeId,
        Number(unit.personnel).toLocaleString('en-US') + ' personnel · ' +
          String(unit.status) + ' · province ' + (province?.name || 'unknown'),
        'Training ' + unit.training + ' · morale ' + unit.morale + ' · experience ' +
          unit.experience + ' · commander ' + (commander?.name || 'unassigned'));
      const unitMembership = membershipsFor(currentPlayer()).find(item =>
        item.stateId === unit.stateId);
      const canCommand = Boolean(unitMembership &&
        (type?.commandPermissionSetIds || []).includes(unitMembership.permissionSetId));
      if (canCommand) {
        for (const route of (onlineGame.militaryRoutes || []).filter(item =>
          item.enabled && item.originProvinceId === unit.provinceId)) {
          const destination = (onlineGame.provinces || []).find(item =>
            item.id === route.destinationProvinceId);
          if (!destination) continue;
          const player = currentPlayer();
          const friendly = membershipsFor(player).some(item =>
            item.stateId === destination.stateId);
          const destinationTerritory = onlineGame.territories.find(item =>
            item.stateId === destination.stateId);
          const foreignGovernment = Boolean(destinationTerritory?.ownerPlayerId &&
            destinationTerritory.ownerPlayerId !== player?.id && !friendly);
          const relation = (onlineGame.diplomaticRelations || []).find(item =>
            item.stateAId === unit.stateId && item.stateBId === destination.stateId ||
            item.stateBId === unit.stateId && item.stateAId === destination.stateId);
          const warDeclared = relation?.status === 'war';
          const samePlayerTerritory = destinationTerritory?.ownerPlayerId === player?.id;
          const movementReason=onlineGame.status!=='running'
            ? 'Start or resume the world before moving troops.'
            : unit.personnel<=0
              ? 'This unit has no remaining personnel.'
              : (foreignGovernment && !warDeclared)
                ? 'Declare war in the Diplomacy tab before attacking this government.'
                : samePlayerTerritory
                  ? 'This State is already administered by your player.'
                  : socket?.readyState!==WebSocket.OPEN
                    ? 'Reconnect to the host before issuing military orders.'
                    : '';
          const button = document.createElement('button');
          button.className = 'secondary-button';
          button.type = 'button';
          button.textContent = friendly ? 'MOVE TO ' + destination.name
            : foreignGovernment ? (warDeclared ? 'ATTACK ' : 'WAR REQUIRED · ') + destination.name
              : samePlayerTerritory ? 'ADMINISTERED · ' + destination.name
                : 'ATTACK ' + destination.name;
          button.disabled=Boolean(movementReason);
          button.title=movementReason || (friendly
            ? 'Move this unit to another province in your government.'
            : 'Attack this neutral territory and begin an occupation.');
          button.addEventListener('click', () => sendAction({
            type:'mobilizeUnit',
            stateId:unit.stateId,
            militaryOrderType:friendly?'move':'attack',
            militaryUnitId:unit.id,
            destinationProvinceId:destination.id,
            militaryRouteId:route.id
          }));
          row.appendChild(button);
        }
      }
    }

    const stateProvinceIds = new Set((onlineGame.provinces || [])
      .filter(item => item.stateId === territory.stateId)
      .map(item => item.id));
    const accessibleUnitIds = new Set(units.map(item => item.id));
    const orders = (onlineGame.militaryOrders || []).filter(item =>
      accessibleUnitIds.has(item.unitId));
    const battles = (onlineGame.militaryBattles || []).filter(item =>
      stateProvinceIds.has(item.provinceId) ||
      (item.participantUnitIds || []).some(unitId => accessibleUnitIds.has(unitId)));
    if (!orders.length && !battles.length)
      addPoliticalRow(operationsList, 'No military operations', 'No orders or battles have been recorded.');
    for (const order of orders) {
      const unit = units.find(item => item.id === order.unitId);
      addPoliticalRow(
        operationsList,
        String(order.type) + ' · ' + String(order.status),
        (unit?.unitTypeId || 'Unit') + ' · submitted ' +
          formatWorldDate(order.submittedOnWorldDate),
        order.rejectionReason || 'Remaining travel days: ' + order.travelDaysRemaining);
    }
    for (const battle of battles) {
      const casualtyCount = Object.values(battle.casualtiesByUnit || {})
        .flatMap(item => Object.values(item || {}))
        .reduce((sum, value) => sum + Number(value || 0), 0);
      addPoliticalRow(
        operationsList,
        'Battle · ' + formatWorldDate(battle.worldDate),
        ((onlineGame.provinces || []).find(item => item.id === battle.provinceId)?.name || 'Unknown location') +
          ' · ' + battle.participantUnitIds.length + ' units · ' +
          casualtyCount.toLocaleString('en-US') + ' recorded casualties',
        battle.result || 'Result not recorded');
    }

    const occupations = (onlineGame.occupations || []).filter(item =>
      stateProvinceIds.has(item.provinceId) || item.occupyingStateId === territory.stateId);
    if (!occupations.length)
      addPoliticalRow(occupationsList, 'No active occupation records', 'Sovereignty remains unchanged unless a valid legal transfer is recorded.');
    for (const occupation of occupations) {
      const province = (onlineGame.provinces || []).find(item => item.id === occupation.provinceId);
      const occupyingState = onlineGame.territories.find(item =>
        item.stateId === occupation.occupyingStateId)?.name;
      addPoliticalRow(
        occupationsList,
        province?.name || 'Province',
        'Occupied by ' + (occupyingState || 'Unknown State') +
          ' · since ' + formatWorldDate(occupation.startedOn),
        'Force ' + occupation.occupyingForce + ' · resistance ' + occupation.resistance +
          ' · duration ' + occupation.durationDays + ' / ' +
          (occupation.requiredControlDays || 'pending') + ' days' +
          ' · effective control ' +
          (occupation.controlEffective ? 'established' : 'not established') +
          ' · sovereignty unchanged');
    }
  }

  function renderDiplomacy() {
    const list=$('diplomacy-list');
    const history=$('diplomacy-history');
    if(!list || !history) return;
    list.replaceChildren();
    history.replaceChildren();
    const territory=onlineGame?.territories.find(item=>item.index===state.selected);
    const player=currentPlayer();
    if(!onlineGame || !territory || !player) {
      $('diplomacy-status').textContent='Create or join a multiplayer world to inspect diplomatic relations.';
      addPoliticalRow(list,'No diplomatic data','Foreign relations are stored by the host and shared with the world.');
      addPoliticalRow(history,'No diplomatic record','Declarations and peace agreements will appear here.');
      renderAdvancedDiplomacy(null,null,null);
      return;
    }
    const membership=membershipsFor(player).find(item=>item.stateId===territory.stateId);
    $('diplomacy-status').textContent=membership
      ? 'Foreign policy is issued by '+territory.name+'. War requires a public declaration; peace is blocked while an occupation remains active.'
      : 'You need an active government membership in '+territory.name+' to conduct foreign policy.';
    if(!membership) {
      addPoliticalRow(list,'No diplomatic authority','Select a State in which you hold an active government membership.');
      renderAdvancedDiplomacy(territory,null,player);
      return;
    }
    for(const target of onlineGame.territories.filter(item=>item.stateId!==territory.stateId)) {
      const targetMembers=onlineGame.players.filter(candidate =>
        membershipsFor(candidate).some(item=>item.stateId===target.stateId));
      const owner=onlineGame.players.find(candidate=>candidate.id===target.ownerPlayerId);
      const sharedGovernment=membershipsFor(player).some(item=>item.stateId===target.stateId);
      const relation=(onlineGame.diplomaticRelations || []).find(item =>
        item.stateAId===territory.stateId && item.stateBId===target.stateId ||
        item.stateAId===target.stateId && item.stateBId===territory.stateId);
      const status=relation?.status==='war'
        ? sharedGovernment?'AT WAR · CO-GOVERNED':'AT WAR'
        : sharedGovernment?'CO-GOVERNED'
          : target.ownerPlayerId===player.id?'YOUR ADMINISTRATION'
            : target.ownerPlayerId?'PEACE':'UNCLAIMED';
      const details=target.ownerPlayerId
        ? 'Government: '+(owner?.name || 'Unknown player')+
          ' · '+targetMembers.length+' member(s)'+
          (relation?.status==='war'?' · war declared '+formatWorldDate(relation.declaredOn):'')
        : 'No player administration · may be claimed peacefully or challenged by military campaign.';
      const row=addPoliticalRow(list,target.name+' · '+status,details);
      const foreignGovernment=Boolean(target.ownerPlayerId &&
        target.ownerPlayerId!==player.id && !sharedGovernment);
      const atWar=relation?.status==='war';
      if(foreignGovernment || atWar) {
        const button=document.createElement('button');
        button.type='button';
        button.className='secondary-button';
        button.textContent=atWar?'SIGN PEACE':'DECLARE WAR';
        const pairProvinceIds=new Set((onlineGame.provinces || [])
          .filter(item=>[territory.stateId,target.stateId].includes(item.stateId))
          .map(item=>item.id));
        const occupationActive=(onlineGame.occupations || []).some(item =>
          item.status==='active' && pairProvinceIds.has(item.provinceId) &&
          [territory.stateId,target.stateId].includes(item.occupyingStateId));
        button.disabled=onlineGame.status!=='running' ||
          socket?.readyState!==WebSocket.OPEN || (atWar && occupationActive);
        button.title=atWar && occupationActive
          ? 'Peace is unavailable while this State has an active military occupation.'
          : atWar?'End the current war with a peace agreement.':'Declare a state of war before military attacks.';
        button.addEventListener('click',()=>sendAction({
          type:atWar?'makePeace':'declareWar',
          stateId:territory.stateId,targetStateId:target.stateId
        }));
        row.appendChild(button);
      }
    }
    const events=(onlineGame.events || []).filter(item =>
      String(item.type || '').startsWith('diplomacy.')).slice().reverse().slice(0,20);
    if(!events.length)
      addPoliticalRow(history,'No diplomatic record','No wars or peace agreements have been recorded.');
    for(const event of events)
      addPoliticalRow(history,event.description || event.type,
        formatWorldDate(event.worldDate)+' · '+(onlineGame.territories.find(item =>
          item.stateId===event.stateId)?.name || 'Foreign affairs'));
    renderAdvancedDiplomacy(territory,membership,player);
  }



  function renderAdvancedDiplomacy(territory,membership,player) {
    const ids=['diplomacy-proposal-list','diplomacy-treaty-list',
      'diplomacy-organization-list','diplomacy-conference-list'];
    const lists=ids.map(id=>$(id));
    if(lists.some(item=>!item)) return;
    lists.forEach(item=>item.replaceChildren());
    const [proposalList,treatyList,organizationList,conferenceList]=lists;
    const stateId=territory?.stateId;
    const running=Boolean(onlineGame?.status==='running'&&socket?.readyState===WebSocket.OPEN&&
      membership&&membership.permissionSetId!=='government-observer');
    const represented=new Set((onlineGame?.memberships||[])
      .filter(item=>item.status==='active'&&item.permissionSetId!=='government-observer')
      .map(item=>item.stateId));
    const fill=(select,items,label,value) => {
      const previous=select.multiple
        ? new Set([...select.selectedOptions].map(item=>item.value))
        : new Set([select.value]);
      select.replaceChildren();
      for(const item of items) {
        const option=document.createElement('option');
        option.value=value(item);option.textContent=label(item);
        if(previous.has(option.value)) option.selected=true;
        select.appendChild(option);
      }
    };
    const allStates=onlineGame?.territories||[];
    const counterparts=allStates.filter(item=>item.stateId!==stateId&&represented.has(item.stateId));
    fill($('diplomacy-proposal-target'),counterparts,item=>item.name,item=>item.stateId);
    fill($('diplomacy-sanction-target'),allStates.filter(item=>item.stateId!==stateId),
      item=>item.name,item=>item.stateId);
    const organizations=(onlineGame?.internationalOrganizations||[]).filter(org=>
      org.status==='active'&&org.memberStateIds.includes(stateId));
    fill($('diplomacy-organization-select'),organizations,item=>item.name,item=>item.id);
    fill($('diplomacy-conference-participants'),allStates.filter(item=>represented.has(item.stateId)),
      item=>item.name,item=>item.stateId);
    $('diplomacy-setup-panel').hidden=Boolean(onlineGame?.started||
      onlineGame?.hostPlayerId!==onlineSession?.playerId);
    const proposalTarget=$('diplomacy-proposal-target').value;
    const selectedClauses=[...document.querySelectorAll('.diplomacy-clause:checked')]
      .map(item=>({type:item.value}));
    const validForm=running&&counterparts.some(item=>item.stateId===proposalTarget)&&
      selectedClauses.length>0&&
      Number.isSafeInteger(Number($('diplomacy-duration').value))&&
      Number($('diplomacy-duration').value)>0&&
      Number.isSafeInteger(Number($('diplomacy-valid-days').value))&&
      Number($('diplomacy-valid-days').value)>0&&
      Number.isSafeInteger(Number($('diplomacy-notice-days').value))&&
      Number($('diplomacy-notice-days').value)>=0;
    $('diplomacy-propose-treaty').disabled=!validForm;
    if(!onlineGame||!stateId) {
      addPoliticalRow(proposalList,'No treaty proposals','Connect to a world to negotiate structured treaty terms.');
      addPoliticalRow(treatyList,'No treaties','Treaty obligations become effective only after formal acceptance and the scheduled start date.');
      addPoliticalRow(organizationList,'No international organizations','Member States and charters must be configured by the host before the world starts.');
      addPoliticalRow(conferenceList,'No conferences','Peace conferences require at least two represented States and a documented agenda.');
      $('diplomacy-propose-embargo').disabled=true;$('diplomacy-open-conference').disabled=true;
      return;
    }
    const proposals=(onlineGame.diplomaticProposals||[]).filter(item=>
      item.sourceStateId===stateId||item.targetStateId===stateId)
      .slice().sort((a,b)=>b.proposedOn.localeCompare(a.proposedOn));
    if(!proposals.length) addPoliticalRow(proposalList,'No treaty proposals',
      'No structured treaty has been proposed to or from this State.');
    for(const proposal of proposals) {
      const source=allStates.find(item=>item.stateId===proposal.sourceStateId);
      const target=allStates.find(item=>item.stateId===proposal.targetStateId);
      const row=addPoliticalRow(proposal.status.toUpperCase()+' · '+(source?.name||'Unknown')+
        ' → '+(target?.name||'Unknown'),
        'Proposed '+formatWorldDate(proposal.proposedOn)+' · valid until '+
        formatWorldDate(proposal.validUntil)+' · '+proposal.durationDays+' day(s) · '+
        (proposal.clauses||[]).map(item=>item.type.replaceAll('_',' ')).join(', '));
      if(proposal.negotiationText)
        addPoliticalRow(row,'NON-BINDING NOTE',proposal.negotiationText);
      const canRespond=running&&proposal.targetStateId===stateId&&
        proposal.status==='pending'&&proposal.validUntil>=onlineGame.worldDate;
      if(canRespond) {
        const controls=document.createElement('div');
        controls.className='diplomacy-action-controls';
        for(const [label,response] of [['ACCEPT','accept'],['REJECT','reject']]) {
          const button=document.createElement('button');
          button.type='button';button.className='secondary-button';button.textContent=label;
          button.addEventListener('click',()=>sendAction({
            type:'diplomacy.respondTreaty',stateId,proposalId:proposal.id,response
          }));
          controls.appendChild(button);
        }
        const counterPanel=document.createElement('details');
        counterPanel.className='diplomacy-counter-panel';
        const counterSummary=document.createElement('summary');
        counterSummary.textContent='MAKE COUNTEROFFER';
        counterPanel.appendChild(counterSummary);
        const counterBody=document.createElement('div');
        counterBody.className='diplomacy-counter-body';
        const clauseTitle=document.createElement('p');
        clauseTitle.className='field-label';
        clauseTitle.textContent='PROPOSED CLAUSES';
        counterBody.appendChild(clauseTitle);
        const clauseGrid=document.createElement('div');
        clauseGrid.className='diplomacy-clause-grid';
        const clauseTypes=[
          ['non_aggression','NON-AGGRESSION'],['peace','PEACE'],
          ['mutual_defence','MUTUAL DEFENCE'],['trade_cooperation','TRADE COOPERATION'],
          ['transit_access','TRANSIT ACCESS'],['recognition','RECOGNITION']
        ];
        const counterChecks=[];
        for(const [value,label] of clauseTypes) {
          const wrapper=document.createElement('label');
          const checkbox=document.createElement('input');
          checkbox.type='checkbox';checkbox.value=value;
          checkbox.checked=(proposal.clauses||[]).some(clause=>clause.type===value);
          checkbox.addEventListener('change',()=>updateCounterState());
          const text=document.createElement('span');
          text.textContent=label;
          wrapper.append(checkbox,text);
          clauseGrid.appendChild(wrapper);
          counterChecks.push(checkbox);
        }
        counterBody.appendChild(clauseGrid);
        const durationLabel=document.createElement('label');
        durationLabel.className='field-label';
        durationLabel.textContent='COUNTEROFFER TERM / DAYS';
        const duration=document.createElement('input');
        duration.type='number';duration.className='text-field';
        duration.min='1';duration.max='36500';duration.step='1';
        duration.value=String(proposal.durationDays||365);
        duration.setAttribute('aria-label','Counteroffer duration in days');
        duration.addEventListener('input',()=>updateCounterState());
        durationLabel.appendChild(duration);
        counterBody.appendChild(durationLabel);
        const noteLabel=document.createElement('label');
        noteLabel.className='field-label';
        noteLabel.textContent='NON-BINDING COUNTEROFFER NOTE';
        const note=document.createElement('textarea');
        note.className='text-field';note.rows=2;note.maxLength=2000;
        note.placeholder='Explain which terms you want changed (optional).';
        note.setAttribute('aria-label','Counteroffer negotiation note');
        note.addEventListener('input',()=>updateCounterState());
        noteLabel.appendChild(note);
        counterBody.appendChild(noteLabel);
        const notice=document.createElement('p');
        notice.className='microcopy';
        notice.textContent='The termination notice remains '+proposal.terminationNoticeDays+
          ' day(s), as specified in the original proposal. A counteroffer replaces the pending proposal; it does not create a treaty.';
        counterBody.appendChild(notice);
        const submitCounter=document.createElement('button');
        submitCounter.type='button';submitCounter.className='secondary-button';
        submitCounter.textContent='SEND STRUCTURED COUNTEROFFER';
        submitCounter.disabled=true;
        submitCounter.addEventListener('click',()=>{
          const counterClauses=counterChecks.filter(input=>input.checked)
            .map(input=>({type:input.value}));
          const counterDurationDays=Number(duration.value);
          if(!counterClauses.length||!Number.isSafeInteger(counterDurationDays)||
             counterDurationDays<1||counterDurationDays>36500) return;
          sendAction({
            type:'diplomacy.respondTreaty',stateId,proposalId:proposal.id,
            response:'counter',counterClauses,counterDurationDays,
            negotiationText:note.value.trim()
          });
          submitCounter.disabled=true;
        });
        counterBody.appendChild(submitCounter);
        counterPanel.appendChild(counterBody);
        controls.appendChild(counterPanel);
        row.appendChild(controls);
        function updateCounterState() {
          const count=counterChecks.filter(input=>input.checked).length;
          const days=Number(duration.value);
          submitCounter.disabled=!running||!count||!Number.isSafeInteger(days)||
            days<1||days>36500;
        }
        updateCounterState();
      }
    }
    const treaties=(onlineGame.treaties||[]).filter(item=>
      item.stateAId===stateId||item.stateBId===stateId)
      .slice().sort((a,b)=>b.signedOn.localeCompare(a.signedOn));
    if(!treaties.length) addPoliticalRow(treatyList,'No treaty obligations',
      'Signed agreements will appear here before and after their effective dates.');
    for(const treaty of treaties) {
      const counter=treaty.stateAId===stateId?treaty.stateBId:treaty.stateAId;
      const name=allStates.find(item=>item.stateId===counter)?.name||'Unknown State';
      const row=addPoliticalRow(name+' · '+String(treaty.status).toUpperCase(),
        'Signed '+formatWorldDate(treaty.signedOn)+' · effective '+formatWorldDate(treaty.effectiveOn)+
        ' · expires '+formatWorldDate(treaty.expiresOn)+' · exit notice '+
        treaty.terminationNoticeDays+' day(s) · '+(treaty.clauses||[]).map(item=>
          item.type.replaceAll('_',' ')).join(', '));
      if(['active','scheduled','termination_pending'].includes(treaty.status)&&running) {
        const controls=document.createElement('div');
        controls.className='diplomacy-action-controls';
        const reason=document.createElement('input');
        reason.type='text';reason.className='text-field';reason.maxLength=280;
        reason.placeholder='Legal reason for termination (12–280 chars)';
        reason.setAttribute('aria-label','Treaty termination reason');
        const terminate=document.createElement('button');
        terminate.type='button';terminate.className='secondary-button';
        terminate.textContent='REQUEST TERMINATION';
        terminate.disabled=treaty.status==='termination_pending';
        terminate.addEventListener('click',()=>{
          if(reason.value.trim().length<12) {
            showMessage('A termination reason of at least 12 characters is required.',true);return;
          }
          sendAction({type:'diplomacy.terminateTreaty',stateId,treatyId:treaty.id,reason:reason.value});
        });
        controls.append(reason,terminate);row.appendChild(controls);
      }
    }
    const resolutions=(onlineGame.organizationResolutions||[]);
    const sanctions=(onlineGame.internationalSanctions||[]);
    if(!organizations.length) addPoliticalRow(organizationList,'No organization membership',
      'This State is not in a configured international organization.');
    for(const org of organizations) {
      const row=addPoliticalRow(org.name+' · '+org.status.toUpperCase(),
        'Charter: '+org.charter+' · members '+org.memberStateIds.length+
        ' · vote threshold '+org.votingThresholdPercent+'% · quorum '+org.quorumStateCount+
        ' · competencies '+org.competenceIds.join(', '));
      const orgResolutions=resolutions.filter(item=>item.organizationId===org.id);
      if(!orgResolutions.length) addPoliticalRow(row,'NO RESOLUTIONS','No proposals have been filed under this organization charter.');
      for(const resolution of orgResolutions) {
        const target=allStates.find(item=>item.stateId===resolution.targetStateId);
        const yes=resolution.votes.filter(item=>item.vote==='approve').length;
        const no=resolution.votes.filter(item=>item.vote==='reject').length;
        const voteRow=addPoliticalRow(row,'TRADE EMBARGO · '+resolution.status.toUpperCase(),
          'Target '+(target?.name||'Unknown')+' · '+resolution.durationDays+
          ' days · votes '+yes+' approve / '+no+' reject · '+resolution.votes.length+
          ' of '+org.memberStateIds.length+' States');
        const voted=resolution.votes.some(item=>item.stateId===stateId);
        if(running&&resolution.status==='pending'&&!voted) {
          const controls=document.createElement('div');controls.className='diplomacy-action-controls';
          for(const [label,vote] of [['APPROVE','approve'],['REJECT','reject']]) {
            const button=document.createElement('button');
            button.type='button';button.className='secondary-button';button.textContent=label;
            button.addEventListener('click',()=>sendAction({
              type:'diplomacy.voteOrganizationResolution',stateId,
              resolutionId:resolution.id,vote
            }));
            controls.appendChild(button);
          }
          voteRow.appendChild(controls);
        }
      }
      for(const sanction of sanctions.filter(item=>item.organizationId===org.id)) {
        const target=allStates.find(item=>item.stateId===sanction.targetStateId);
        addPoliticalRow(row,'SANCTION · '+sanction.status.toUpperCase(),
          (target?.name||'Unknown')+' · effective '+formatWorldDate(sanction.effectiveOn)+
          ' · expires '+formatWorldDate(sanction.expiresOn)+
          ' · exempt goods '+(sanction.exemptGoodIds||[]).join(', '));
      }
    }
    const orgSelect=$('diplomacy-organization-select').value;
    const sanctionTarget=$('diplomacy-sanction-target').value;
    const validSanction=running&&organizations.some(item=>item.id===orgSelect)&&
      Boolean(sanctionTarget)&&Number.isSafeInteger(Number($('diplomacy-sanction-days').value))&&
      Number($('diplomacy-sanction-days').value)>0;
    $('diplomacy-propose-embargo').disabled=!validSanction;
    const conferenceParticipants=[...$('diplomacy-conference-participants').selectedOptions]
      .map(item=>item.value);
    $('diplomacy-open-conference').disabled=!running||conferenceParticipants.length<2||
      !conferenceParticipants.includes(stateId)||
      $('diplomacy-conference-agenda').value.trim().length<12;
    const conferences=(onlineGame.diplomaticConferences||[]).filter(item=>
      item.participantStateIds.includes(stateId)).slice().reverse();
    if(!conferences.length) addPoliticalRow(conferenceList,'No conferences',
      'There is no open or historical conference involving this State.');
    for(const conference of conferences) {
      const names=conference.participantStateIds.map(id=>
        allStates.find(item=>item.stateId===id)?.name||id);
      addPoliticalRow(conferenceList,'CONFERENCE · '+conference.status.toUpperCase(),
        formatWorldDate(conference.openedOn)+' · '+conference.agenda+' · '+names.join(', '));
    }
  }

  function renderJustice() {
    const reportList=$('justice-report-list');
    const caseList=$('justice-case-list');
    const historyList=$('justice-history-list');
    if(!reportList || !caseList || !historyList) return;
    reportList.replaceChildren();
    caseList.replaceChildren();
    historyList.replaceChildren();
    const territory=onlineGame?.territories.find(item=>item.index===state.selected);
    const player=currentPlayer();
    const membership=territory && membershipsFor(player).find(item=>item.stateId===territory.stateId);
    const justice=onlineGame?.justiceSystems?.find(item=>item.stateId===territory?.stateId);
    const provinceSelect=$('justice-report-province');
    const description=$('justice-report-description');
    const submit=$('justice-report-submit');

    if(!onlineGame || !territory || !player) {
      $('justice-status').textContent='Create or join a world to load its legal and public-order records.';
      addPoliticalRow(reportList,'No incident register','The shared world register is available after connecting to a multiplayer game.');
      addPoliticalRow(caseList,'No active investigations','Investigations require an enacted legal basis and an authorized police agency and court.');
      addPoliticalRow(historyList,'No justice history','Reports, evidence and procedural events are recorded by the host.');
      submit.disabled=true;
      return;
    }

    const homeProvinces=(onlineGame.provinces || []).filter(item=>item.stateId===territory.stateId);
    const previousProvinceId=provinceSelect.value;
    provinceSelect.replaceChildren();
    for(const province of homeProvinces) {
      const option=document.createElement('option');
      option.value=province.id;
      option.textContent=province.name;
      provinceSelect.appendChild(option);
    }
    if(homeProvinces.some(item=>item.id===previousProvinceId))
      provinceSelect.value=previousProvinceId;
    const configured=Boolean(justice && justice.crimeTypes?.length &&
      justice.courts?.length && justice.policeAgencies?.length);
    $('justice-status').textContent=membership
      ? configured
        ? 'Jurisdiction: '+territory.name+'. Reports remain allegations. Investigations require a current enacted law, a court with jurisdiction, and a police office held by the acting player.'
        : 'Jurisdiction: '+territory.name+'. Incident reporting is available; formal investigations are disabled because this State has no complete, legally configured court, police agency and offence catalogue.'
      : 'Select a State in which you hold an active government membership to submit or manage its public-order records.';
    submit.disabled=!membership || onlineGame.status!=='running' ||
      !provinceSelect.value || !description.value.trim();
    submit.title=!membership?'An active government membership is required.':
      onlineGame.status!=='running'?'Reports can only be submitted while the world is running.':
      'Submit an unclassified incident report. This does not establish that a crime occurred.';

    const reports=(onlineGame.justiceReports || []).filter(item=>item.stateId===territory.stateId)
      .slice().reverse().slice(0,30);
    if(!reports.length)
      addPoliticalRow(reportList,'No reports','No incidents have been submitted for this State.');
    const political=(onlineGame.politicalSystems || []).find(item=>item.stateId===territory.stateId);
    const heldOfficeIds=new Set((political?.offices || [])
      .filter(office=>office.holderPlayerId===player.id).map(office=>office.id));
    const canInvestigate=(agency)=>agency.authorizedOfficeIds?.some(id=>heldOfficeIds.has(id));
    for(const report of reports) {
      const location=homeProvinces.find(item=>item.id===report.provinceId)?.name || 'Unknown province';
      const row=addPoliticalRow(report.status==='investigating'?'REPORT REFERRED TO INVESTIGATION':'UNCLASSIFIED INCIDENT REPORT',
        location+' · '+formatWorldDate(report.reportedOn)+' · '+(report.description || 'No description'));
      if(report.status==='investigating') {
        addPoliticalRow(row,'Investigation opened','Case '+String(report.caseId || '').slice(0,12)+' · no finding of guilt has been made.');
        continue;
      }
      const authorisedAgencies=(justice?.policeAgencies || []).filter(agency=>
        agency.jurisdictionProvinceIds?.includes(report.provinceId) &&
        agency.staff>0 && canInvestigate(agency));
      const eligibleCrimeTypes=(justice?.crimeTypes || []).filter(crime=>
        window.NewWorldJustice?.lawIsActive?.(onlineGame,territory.stateId,crime.lawId));
      if(!membership || onlineGame.status!=='running' ||
          !authorisedAgencies.length || !eligibleCrimeTypes.length) {
        const reason=!justice?.crimeTypes?.length
          ? 'No configured offence category linked to an enacted law.'
          : !authorisedAgencies.length
            ? 'No police office held by this player is authorized in this jurisdiction.'
            : 'The State has no eligible current legal basis for this report.';
        const note=document.createElement('span');
        note.className='justice-inline-note';
        note.textContent=reason;
        row.appendChild(note);
        continue;
      }
      const controls=document.createElement('div');
      controls.className='justice-investigation-controls';
      const crimeSelect=document.createElement('select');
      crimeSelect.className='text-field';
      crimeSelect.setAttribute('aria-label','Legal offence category');
      const agencySelect=document.createElement('select');
      agencySelect.className='text-field';
      agencySelect.setAttribute('aria-label','Authorized police agency');
      const courtSelect=document.createElement('select');
      courtSelect.className='text-field';
      courtSelect.setAttribute('aria-label','Court with jurisdiction');
      for(const crime of eligibleCrimeTypes) {
        const option=document.createElement('option');
        option.value=crime.id;option.textContent=crime.name;
        crimeSelect.appendChild(option);
      }
      const refreshAuthorities=()=>{
        const crimeId=crimeSelect.value;
        const agencies=authorisedAgencies.filter(agency=>agency.crimeTypeIds?.includes(crimeId));
        const courts=(justice?.courts || []).filter(court=>
          court.crimeTypeIds?.includes(crimeId) &&
          court.jurisdictionProvinceIds?.includes(report.provinceId) &&
          (onlineGame.justiceCases || []).filter(item=>
            item.courtId===court.id && ['investigating','charged','trial','appeal'].includes(item.status)
          ).length < court.capacity);
        agencySelect.replaceChildren();courtSelect.replaceChildren();
        for(const agency of agencies) {
          const option=document.createElement('option');option.value=agency.id;option.textContent=agency.name;
          agencySelect.appendChild(option);
        }
        for(const court of courts) {
          const option=document.createElement('option');option.value=court.id;option.textContent=court.name;
          courtSelect.appendChild(option);
        }
      };
      crimeSelect.addEventListener('change',refreshAuthorities);
      refreshAuthorities();
      const open=document.createElement('button');
      open.type='button';open.className='secondary-button';
      open.textContent='OPEN INVESTIGATION';
      open.disabled=onlineGame.status!=='running' || !agencySelect.value || !courtSelect.value;
      crimeSelect.addEventListener('change',()=>{
        open.disabled=onlineGame.status!=='running' || !agencySelect.value || !courtSelect.value;
      });
      open.addEventListener('click',()=>{
        if(!agencySelect.value || !courtSelect.value) {
          showMessage('A matching police agency and court are required for this category.',true);
          return;
        }
        sendAction({
          type:'justice.openInvestigation',stateId:territory.stateId,
          reportId:report.id,crimeTypeId:crimeSelect.value,
          agencyId:agencySelect.value,courtId:courtSelect.value
        });
      });
      controls.append(crimeSelect,agencySelect,courtSelect,open);
      row.appendChild(controls);
    }

    const cases=(onlineGame.justiceCases || []).filter(item=>item.stateId===territory.stateId)
      .slice().reverse().slice(0,30);
    if(!cases.length)
      addPoliticalRow(caseList,'No active investigations','A report becomes an investigation only after an authorized police office applies an enacted law and a court accepts jurisdiction.');
    for(const caseRecord of cases) {
      const crime=justice?.crimeTypes?.find(item=>item.id===caseRecord.crimeTypeId);
      const court=justice?.courts?.find(item=>item.id===caseRecord.courtId);
      const agency=justice?.policeAgencies?.find(item=>item.id===caseRecord.policeAgencyId);
      const row=addPoliticalRow(caseList,(crime?.name || 'Investigation')+' · '+String(caseRecord.status || '').toUpperCase(),
        'Case '+caseRecord.id+' · '+(court?.name || 'Court unavailable')+
        ' · '+formatWorldDate(caseRecord.openedOn)+' · legal basis '+caseRecord.legalBasisId+
        ' · '+(caseRecord.evidence?.length || 0)+' evidence record(s)');
      for(const evidence of caseRecord.evidence || [])
        addPoliticalRow(row,(evidence.type || 'evidence').toUpperCase()+' · UNVERIFIED',
          evidence.description+' · '+formatWorldDate(evidence.recordedOn));
      const running=onlineGame.status==='running';
      const hasAny=(ids)=>Array.isArray(ids) && ids.some(id=>heldOfficeIds.has(id));
      const isConflicted=[caseRecord.reporterPlayerId,caseRecord.investigatorPlayerId,
        caseRecord.prosecutorPlayerId].includes(player.id);
      if(agency && canInvestigate(agency) && caseRecord.status==='investigating' && running) {
        const controls=document.createElement('div');
        controls.className='justice-evidence-controls';
        const typeSelect=document.createElement('select');
        typeSelect.className='text-field';
        typeSelect.setAttribute('aria-label','Evidence type');
        const permittedTypes=Array.isArray(crime?.evidenceTypes) && crime.evidenceTypes.length
          ? crime.evidenceTypes : (window.NewWorldJustice?.evidenceTypes || []);
        for(const type of permittedTypes) {
          const option=document.createElement('option');
          option.value=type;option.textContent=type.toUpperCase();
          typeSelect.appendChild(option);
        }
        const evidenceDescription=document.createElement('input');
        evidenceDescription.type='text';evidenceDescription.maxLength=280;
        evidenceDescription.className='text-field';
        evidenceDescription.placeholder='Evidence description (8–280 characters)';
        evidenceDescription.setAttribute('aria-label','Evidence description');
        const add=document.createElement('button');
        add.type='button';add.className='secondary-button';add.textContent='RECORD EVIDENCE';
        add.addEventListener('click',()=>{
          sendAction({
            type:'justice.addEvidence',stateId:territory.stateId,
            caseId:caseRecord.id,evidenceType:typeSelect.value,
            description:evidenceDescription.value
          });
        });
        controls.append(typeSelect,evidenceDescription,add);
        row.appendChild(controls);
      }
      if(caseRecord.status==='investigating' && running &&
          hasAny(justice?.prosecutorOfficeIds) && caseRecord.investigatorPlayerId!==player.id) {
        const minimum=Number(crime?.minimumEvidenceCount);
        const button=document.createElement('button');
        button.type='button';button.className='secondary-button';
        button.textContent='FILE CHARGES';
        button.disabled=!Number.isSafeInteger(minimum) || minimum<1 ||
          (caseRecord.evidence || []).length<minimum;
        button.title=button.disabled
          ? 'The law must define a minimum evidence count and the case must meet it.'
          : 'File charges under the configured law.';
        button.addEventListener('click',()=>sendAction({
          type:'justice.fileCharges',stateId:territory.stateId,caseId:caseRecord.id
        }));
        row.appendChild(button);
      }
      const authorisedJudge=hasAny(court?.authorizedOfficeIds) ||
        hasAny(justice?.judicialOfficeIds);
      if(caseRecord.status==='charged' && running && authorisedJudge && !isConflicted) {
        const controls=document.createElement('div');
        controls.className='justice-verdict-controls';
        const acquit=document.createElement('button');
        acquit.type='button';acquit.className='secondary-button';acquit.textContent='ACQUIT';
        acquit.addEventListener('click',()=>sendAction({
          type:'justice.decideCase',stateId:territory.stateId,
          caseId:caseRecord.id,verdict:'acquitted'
        }));
        const convict=document.createElement('button');
        convict.type='button';convict.className='secondary-button';convict.textContent='RECORD GUILTY VERDICT';
        const threshold=Number(court?.minimumEvidenceCountForConviction);
        convict.disabled=!Number.isSafeInteger(threshold) || threshold<1 ||
          (caseRecord.evidence || []).length<threshold;
        convict.title=convict.disabled
          ? 'Configure the court evidence threshold and meet it before a guilty verdict.'
          : 'Record a guilty verdict. Sentencing is a separate authorized step.';
        convict.addEventListener('click',()=>sendAction({
          type:'justice.decideCase',stateId:territory.stateId,
          caseId:caseRecord.id,verdict:'guilty'
        }));
        controls.append(acquit,convict);
        row.appendChild(controls);
      }
      if(caseRecord.status==='convicted' && running && hasAny(justice?.sentenceOfficeIds)) {
        const penalties=crime?.penalties || [];
        if(penalties.length) {
          const controls=document.createElement('div');
          controls.className='justice-sentence-controls';
          const penaltySelect=document.createElement('select');
          penaltySelect.className='text-field';
          penaltySelect.setAttribute('aria-label','Lawful sentence type');
          for(const penalty of penalties) {
            const option=document.createElement('option');
            option.value=penalty.id;
            option.textContent=penalty.type.toUpperCase()+' · '+penalty.id;
            penaltySelect.appendChild(option);
          }
          const amount=document.createElement('input');
          amount.type='number';amount.className='text-field';
          amount.setAttribute('aria-label','Fine or reparation amount');
          const duration=document.createElement('input');
          duration.type='number';duration.className='text-field';
          duration.setAttribute('aria-label','Prison sentence duration in days');
          const updatePenaltyFields=()=>{
            const penalty=penalties.find(item=>item.id===penaltySelect.value);
            const moneyPenalty=['fine','reparation'].includes(penalty?.type);
            const prisonPenalty=penalty?.type==='imprisonment';
            amount.hidden=!moneyPenalty;
            duration.hidden=!prisonPenalty;
            amount.min=String(penalty?.minAmount ?? 0);
            amount.max=String(penalty?.maxAmount ?? 0);
            amount.placeholder='Amount '+(penalty?.minAmount ?? '')+'–'+(penalty?.maxAmount ?? '');
            duration.min=String(penalty?.minDays ?? 1);
            duration.max=String(penalty?.maxDays ?? 1);
            duration.placeholder='Days '+(penalty?.minDays ?? '')+'–'+(penalty?.maxDays ?? '');
          };
          penaltySelect.addEventListener('change',updatePenaltyFields);
          updatePenaltyFields();
          const impose=document.createElement('button');
          impose.type='button';impose.className='secondary-button';impose.textContent='IMPOSE LAWFUL SENTENCE';
          impose.addEventListener('click',()=>{
            const penalty=penalties.find(item=>item.id===penaltySelect.value);
            const payload={type:'justice.imposeSentence',stateId:territory.stateId,
              caseId:caseRecord.id,penaltyId:penalty?.id};
            if(['fine','reparation'].includes(penalty?.type)) payload.amount=Number(amount.value);
            if(penalty?.type==='imprisonment') payload.days=Number(duration.value);
            sendAction(payload);
          });
          controls.append(penaltySelect,amount,duration,impose);
          row.appendChild(controls);
        } else {
          addPoliticalRow(row,'No sentence catalogue',
            'This offence has no configured penalty. A conviction alone does not create an invented sanction.');
        }
      }
      if(['convicted','acquitted','sentenced'].includes(caseRecord.status) &&
          running && hasAny(justice?.appealOfficeIds)) {
        const appeal=document.createElement('button');
        appeal.type='button';appeal.className='secondary-button';appeal.textContent='FILE APPEAL';
        appeal.disabled=!Number.isSafeInteger(Number(justice.appealWindowDays)) ||
          Number(justice.appealWindowDays)<1;
        appeal.addEventListener('click',()=>sendAction({
          type:'justice.fileAppeal',stateId:territory.stateId,caseId:caseRecord.id
        }));
        row.appendChild(appeal);
      }
      if(caseRecord.status==='appealed')
        addPoliticalRow(row,'APPEAL FILED',
          'The appeal is registered. Appellate review and its final resolution are not yet implemented.');
    }
    const events=(onlineGame.justiceHistory || []).filter(item=>item.stateId===territory.stateId)
      .slice().reverse().slice(0,20);
    if(!events.length) addPoliticalRow(historyList,'No justice activity','Submitted reports and investigation actions will be recorded here.');
    for(const entry of events)
      addPoliticalRow(historyList,entry.description || entry.type,
        formatWorldDate(entry.worldDate)+' · '+String(entry.type || '').replace(/^justice\./,'').toUpperCase());
  }


  function renderServices() {
    const ids=['services-facility-list','services-group-list','services-history-list'];
    const lists=ids.map(id=>$(id));
    const status=$('services-status');
    if(!status || lists.some(item=>!item)) return;
    lists.forEach(item=>item.replaceChildren());
    const [facilityList,groupList,historyList]=lists;
    const territory=onlineGame?.territories?.find(item=>item.index===state.selected);
    const stateId=territory?.stateId;
    const facilities=(onlineGame?.publicServiceFacilities || []).filter(item=>item.stateId===stateId);
    const groups=(onlineGame?.populationGroups || []).filter(item=>item.stateId===stateId);
    const coverage=(onlineGame?.publicServiceCoverage || []).filter(item=>
      item.stateId===stateId && item.worldDate===onlineGame?.worldDate);
    const types=new Map((onlineGame?.serviceTypes || []).map(item=>[item.id,item]));
    const companies=new Map((onlineGame?.companies || []).map(item=>[item.id,item]));
    const currency=territory?.currencyId || '';
    const format=value=>Number(value||0).toLocaleString('en-US',{maximumFractionDigits:2});
    const provinceName=id=>onlineGame?.provinces?.find(item=>item.id===id)?.name||id||'Unknown province';
    $('services-facility-count').textContent=territory?format(facilities.length):'—';
    $('services-staff-count').textContent=territory
      ? format(facilities.reduce((sum,item)=>sum+Number(item.staff||0),0)) : '—';
    $('services-public-cost').textContent=territory
      ? format(coverage.reduce((sum,item)=>sum+Number(item.publicCost||0),0))+' '+currency : '—';
    $('services-private-cost').textContent=territory
      ? format(coverage.reduce((sum,item)=>sum+Number(item.privateCost||0),0))+' '+currency : '—';

    if(!onlineGame || !territory) {
      status.textContent='Connect to a world and select a State to inspect public-service access.';
      addPoliticalRow(facilityList,'No selected State','Facility coverage is calculated from explicit local population groups.');
      addPoliticalRow(groupList,'No population groups','No coverage is inferred for unconfigured groups.');
      addPoliticalRow(historyList,'No service history','Operating constraints are recorded after the first configured simulation day.');
      return;
    }
    if(!facilities.length) {
      status.textContent=territory.name+' has no configured public or community service facilities. No national coverage rate is assumed.';
      addPoliticalRow(facilityList,'No registered facilities',
        'Configure education, health, social or cultural providers in Advanced Host Scenario Settings.');
    } else {
      status.textContent=territory.name+' · '+facilities.length+
        ' registered facilities · operating expenditure is accounted in '+currency+
        ' · coverage is restricted to the population groups assigned to each facility.';
      for(const facility of facilities) {
        const type=types.get(facility.serviceTypeId);
        const company=companies.get(facility.operatorCompanyId);
        const result=coverage.find(item=>item.serviceId===facility.id);
        const provider=(facility.providerType||'unknown').toUpperCase()+
          (company?' · '+company.name:'');
        const row=addPoliticalRow(facility.name+' · '+(type?.name||facility.serviceTypeId),
          provider+' · '+provinceName(facility.provinceId));
        addPoliticalRow(row,'STAFF / CAPACITY / QUALITY',
          format(facility.staff)+' / '+format(facility.staffRequired)+' required staff · '+
          format(result?.staffedCapacity??facility.capacityPerDay)+' '+(type?.unit||'units')+
          '/day staffed capacity · '+format(facility.qualityPercent)+'% quality');
        addPoliticalRow(row,'LATEST COVERAGE',
          result
            ? format(result.served)+' / '+format(result.demand)+' remaining '+type.unit+
              ' delivered · '+format(result.accessPercent)+'% at this facility · '+
              format(result.waterCoveragePercent)+'% water coverage'
            : 'No daily operating cycle has been recorded yet.');
        addPoliticalRow(row,'DAILY FUNDING',
          format(result?.publicCost??0)+' public · '+format(result?.privateCost??0)+' operator · '+
          format(result?.unfundedPublicCost??0)+' public unfunded · '+
          format(result?.unfundedPrivateCost??0)+' operator unfunded · '+currency);
        addPoliticalRow(row,'ELIGIBLE POPULATION GROUPS',
          (facility.populationGroupIds||[]).map(id=>{
            const group=groups.find(item=>item.id===id);
            return group?group.name+' ('+format(group.population)+')':id;
          }).join(' · '));
      }
    }

    const groupRows=[];
    for(const group of groups) {
      const entries=Object.entries(group.serviceAccess || {});
      const health=Number(group.healthServiceAccessPercent)||0;
      const education=Number(group.educationServiceAccessPercent)||0;
      const social=Number(group.socialServiceAccessPercent)||0;
      const culture=Number(group.culturalServiceAccessPercent)||0;
      const educationIndex=Number(group.educationIndexPercent)||0;
      if(entries.length || health || education || social || culture || educationIndex)
        groupRows.push({group,health,education,social,culture,educationIndex,entries});
    }
    if(!groupRows.length)
      addPoliticalRow(groupList,'No measured access',
        'Population groups are not assigned to a configured facility, or no operating day has run.');
    for(const item of groupRows) {
      const row=addPoliticalRow(item.group.name+' · '+format(item.group.population)+' residents',
        'HEALTH '+format(item.health)+'% · EDUCATION '+format(item.education)+
        '% · SOCIAL '+format(item.social)+'% · CULTURE '+format(item.culture)+'%');
      addPoliticalRow(row,'HEALTH OUTCOME / EDUCATION PROGRESS',
        format(item.group.healthMortalityReductionPercent||0)+
        '% configured mortality-rate reduction at current access · education index '+
        format(item.educationIndex)+'% · '+format(item.group.educationProgressLastDay||0)+
        ' index points gained this day');
      for(const [typeId,entry] of item.entries) {
        const type=types.get(typeId);
        addPoliticalRow(row,type?.name||typeId,
          format(entry.served)+' / '+format(entry.demand)+' '+(type?.unit||'units')+
          ' · '+format(entry.reachPercent)+'% reachable · '+
          format(entry.accessPercent)+'% need served · '+
          format(entry.qualityPercent)+'% quality');
      }
    }

    const history=(onlineGame.publicServiceHistory || []).filter(item=>item.stateId===stateId)
      .slice().reverse().slice(0,25);
    if(!history.length)
      addPoliticalRow(historyList,'No service constraints recorded',
        'Funding shortages, staffing limits and water-related delivery restrictions will be recorded here.');
    for(const item of history)
      addPoliticalRow(historyList,item.description||item.type,
        formatWorldDate(item.worldDate)+' · '+String(item.type||'').replaceAll('_',' ').toUpperCase());
  }

  function renderIndustry() {
    const ids=['industry-workplace-list','industry-labour-list',
      'industry-union-list','industry-history-list'];
    const lists=ids.map(id=>$(id));
    const status=$('industry-status');
    if(!status || lists.some(item=>!item)) return;
    lists.forEach(item=>item.replaceChildren());
    const [workplaceList,labourList,unionList,historyList]=lists;
    const territory=onlineGame?.territories?.find(item=>item.index===state.selected);
    const stateId=territory?.stateId;
    const pools=(onlineGame?.labourPools || []).filter(item=>item.stateId===stateId);
    const workplaces=(onlineGame?.industryWorkplaces || []).filter(item=>item.stateId===stateId);
    const unions=(onlineGame?.labourUnions || []).filter(item=>item.stateId===stateId);
    const contracts=(onlineGame?.industryEmploymentContracts || []).filter(item=>
      item.stateId===stateId && item.worldDate===onlineGame?.worldDate);
    const balances=(onlineGame?.industryLabourBalances || []).find(item=>item.stateId===stateId);
    const companies=new Map((onlineGame?.companies || []).map(item=>[item.id,item]));
    const occupations=new Map((onlineGame?.industryOccupations || []).map(item=>[item.id,item]));
    const provinces=new Map((onlineGame?.provinces || []).map(item=>[item.id,item.name]));
    const groupMap=new Map((onlineGame?.populationGroups || []).map(item=>[item.id,item]));
    const format=value=>Number(value||0).toLocaleString('en-US',{maximumFractionDigits:2});
    const currency=balances?.currencyId||territory?.currencyId||'';
    $('industry-workforce').textContent=territory?format(balances?.workforce||0):'—';
    $('industry-employed').textContent=territory?format(balances?.employed||0):'—';
    $('industry-unemployed').textContent=territory?format(balances?.unemployed||0):'—';
    $('industry-employment-rate').textContent=territory
      ? format(balances?.employmentRatePercent||0)+'%' : '—';
    $('industry-payroll').textContent=territory
      ? format(balances?.dailyPayroll||0)+' '+currency : '—';

    if(!onlineGame || !territory) {
      status.textContent='Connect to a world and select a State to inspect the labour market.';
      addPoliticalRow(workplaceList,'No selected State','Workplace data is State-specific.');
      addPoliticalRow(labourList,'No labour market','The workforce is not invented for an unconfigured population.');
      addPoliticalRow(unionList,'No union register','Recognition and negotiated wage floors require scenario rules.');
      addPoliticalRow(historyList,'No employment history','Hiring constraints and payroll events appear after a configured day.');
      return;
    }
    if(!pools.length && !workplaces.length) {
      status.textContent=territory.name+' has no configured labour pools or workplaces. Existing NPC companies continue to operate through the legacy production model.';
      addPoliticalRow(workplaceList,'No registered workplaces',
        'Link a workplace to an existing NPC company facility; players remain government members, not business managers.');
      addPoliticalRow(labourList,'No configured workforce',
        'Age, qualification, occupation and location distributions must be supplied by the host. No worker count is fabricated.');
    } else {
      status.textContent=territory.name+' · employment matching is local to province and occupation · companies pay wages in '+currency+'.';
      if(!workplaces.length)
        addPoliticalRow(workplaceList,'No vacancies configured',
          'The configured labour pools are currently unemployed because no matching workplace has been registered.');
      for(const workplace of workplaces) {
        const company=companies.get(workplace.companyId);
        const occupation=occupations.get(workplace.occupationId);
        const contract=contracts.find(item=>item.workplaceId===workplace.id);
        const union=unions.find(item=>item.id===workplace.unionId);
        const row=addPoliticalRow(workplace.name+' · '+(company?.name||workplace.companyId),
          (occupation?.name||workplace.occupationId)+' · '+(provinces.get(workplace.provinceId)||workplace.provinceId));
        addPoliticalRow(row,'STAFFING / WAGES / PAYROLL',
          format(contract?.workers??(workplace.workersEmployed||0))+' / '+format(workplace.positions)+
          ' positions · '+format(contract?.wagePerWorkerPerDay??workplace.wagePerWorkerPerDay)+
          ' '+currency+'/worker/day · payroll '+format(contract?.payroll??(workplace.payrollLastDay||0)));
        addPoliticalRow(row,'WORKING CONDITIONS',
          format(workplace.shiftHoursPerDay)+' hours/day · '+format(workplace.safetyRatingPercent)+
          '% safety rating · '+format(workplace.hazardExposurePercent)+'% hazard exposure · '+
          (workplace.operational?'operational':'not operating'));
        if(union)
          addPoliticalRow(row,'COLLECTIVE BARGAINING',
            union.name+' · '+(union.recognized?'recognized':'not recognized')+' · '+
            format(union.membershipPercent)+'% membership · negotiated '+
            format(union.negotiatedWagePerWorkerPerDay||0)+' '+currency+'/day');
      }
      if(!pools.length)
        addPoliticalRow(labourList,'No labour supply configured',
          'Registered workplaces cannot hire without a local occupation pool.');
    }
    for(const pool of pools) {
      const occupation=occupations.get(pool.occupationId);
      const group=groupMap.get(pool.populationGroupId);
      const row=addPoliticalRow(occupation?.name||pool.occupationId,
        format(pool.workforce)+' available workers · qualification '+format(pool.qualificationLevel)+'/100');
      addPoliticalRow(row,'POPULATION SOURCE',
        (group?.name||pool.populationGroupId)+' · '+format(group?.population||0)+
        ' residents · '+(provinces.get(pool.provinceId)||pool.provinceId));
    }
    if(!unions.length)
      addPoliticalRow(unionList,'No recognized labour unions configured',
        'Union representation and collective wage agreements are not assumed.');
    for(const union of unions)
      addPoliticalRow(union.name,
        (union.recognized?'RECOGNIZED':'NOT RECOGNIZED')+' · '+format(union.membershipPercent)+
        '% membership · '+(occupations.get(union.occupationId)?.name||union.occupationId)+
        ' · negotiated '+format(union.negotiatedWagePerWorkerPerDay||0)+' '+currency+'/day');

    const history=(onlineGame.industryHistory || []).filter(item=>item.details?.stateId===stateId)
      .slice().reverse().slice(0,25);
    if(!history.length)
      addPoliticalRow(historyList,'No employment constraints recorded',
        'Unfilled jobs, union wage adjustments and workplace results will appear after the simulation runs.');
    for(const item of history)
      addPoliticalRow(historyList,item.description||item.type,
        formatWorldDate(item.worldDate)+' · '+String(item.type||'').replaceAll('_',' ').toUpperCase());
    if(workplaces.length)
      addPoliticalRow(historyList,'REAL WAGE DATA NOT AVAILABLE',
        'The current economy has no configured consumer-price index. Wages are shown as nominal amounts only.');
  }

  function renderResources() {
    const ids=['resource-deposit-list','resource-stock-list','resource-farm-list',
      'resource-livestock-list','resource-fishery-list','resource-forest-list',
      'resource-environment-list','resource-energy-list','resource-water-list',
      'resource-water-history-list','resource-history-list'];
    const lists=ids.map(id=>$(id));
    const status=$('resources-status');
    if(!status || lists.some(item=>!item)) return;
    lists.forEach(list=>list.replaceChildren());
    const [depositList,stockList,farmList,livestockList,fisheryList,forestList,
      environmentList,energyList,waterList,waterHistoryList,historyList]=lists;
    const territory=onlineGame?.territories?.find(item=>item.index===state.selected);
    const stateId=territory?.stateId;
    const player=currentPlayer();
    const membership=player && membershipsFor(player).find(item=>item.stateId===stateId);
    const companies=(onlineGame?.companies || []).filter(item=>item.stateId===stateId);
    const political=(onlineGame?.politicalSystems || []).find(item=>item.stateId===stateId);
    const heldOfficeIds=new Set((political?.offices || [])
      .filter(item=>item.holderPlayerId===player?.id).map(item=>item.id));
    const formatNumber=value=>Number(value||0).toLocaleString('en-US',{
      maximumFractionDigits:2
    });
    const provinceName=id=>onlineGame?.provinces?.find(item=>item.id===id)?.name || id || 'Unknown province';
    const resourceName=id=>onlineGame?.resourceCatalog?.find(item=>item.id===id)?.name || id || 'Unknown resource';
    const goodName=id=>onlineGame?.goods?.find(item=>item.id===id)?.name || id;
    const empty=(list,title,description)=>addPoliticalRow(list,title,description);

    if(!onlineGame || !territory || !player) {
      status.textContent='Connect to a multiplayer world and select a State to inspect its resource systems.';
      empty(depositList,'No resource deposits','The world has no configured extraction deposits.');
      empty(stockList,'No stored resource output','No resource has been extracted or harvested into the stock register.');
      empty(farmList,'No agricultural installations','No farms have been configured for this State.');
      empty(livestockList,'No livestock sites','Herds, feed, breeding and animal products are not assumed.');
      empty(fisheryList,'No fishing grounds','Fish stocks, seasons and sustainable catches require configuration.');
      empty(forestList,'No managed forest areas','Standing timber, conservation and regeneration require configuration.');
      empty(environmentList,'No environmental measurements','Environmental values are not invented when a scenario has no measurements.');
      empty(energyList,'No energy data','Energy capacity is not assumed.');
      empty(waterList,'No water sources','Water stocks and ecological reserves are not assumed.');
      empty(waterHistoryList,'No water allocations','Water demand and shortages require explicitly configured sources and consumers.');
      empty(historyList,'No resource history','No resource, harvest or environmental events have been recorded.');
      return;
    }

    const deposits=(onlineGame.resourceDeposits || []).filter(item=>item.stateId===stateId);
    const farms=(onlineGame.farms || []).filter(item=>item.stateId===stateId);
    const land=(onlineGame.agriculturalLand || []).filter(item=>item.stateId===stateId);
    const environments=(onlineGame.environmentalStates || []).filter(item=>
      onlineGame.provinces?.some(province=>province.id===item.provinceId && province.stateId===stateId));
    const energy=(onlineGame.energyBalances || []).filter(item=>item.stateId===stateId);
    const stocks=(onlineGame.resourceStocks || []).filter(item=>item.stateId===stateId);
    const livestockSites=(onlineGame.livestockSites || []).filter(item=>item.stateId===stateId);
    const fishingGrounds=(onlineGame.fishingGrounds || []).filter(item=>item.stateId===stateId);
    const forestAreas=(onlineGame.forestAreas || []).filter(item=>item.stateId===stateId);
    const primaryCycles=(onlineGame.primaryProductionCycles || []).filter(item=>item.stateId===stateId)
      .slice().reverse();
    const resourcesConfigured=Boolean((onlineGame.resourceCatalog || []).length ||
      deposits.length || stocks.length || farms.length || environments.length || energy.length ||
      (onlineGame.livestockSites || []).some(item=>item.stateId===stateId) ||
      (onlineGame.fishingGrounds || []).some(item=>item.stateId===stateId) ||
      (onlineGame.forestAreas || []).some(item=>item.stateId===stateId));
    status.textContent=membership
      ? resourcesConfigured
        ? 'Selected jurisdiction: '+territory.name+'. Values come from the shared host snapshot. Extraction and seasonal production are validated by the host.'
        : 'Selected jurisdiction: '+territory.name+'. No resource or climate scenario has been configured. The game will not invent deposits, land fertility, yields or energy output.'
      : 'You can inspect this State. Extraction orders require an active government membership and the specific office authorized by the extraction law.';

    if(!deposits.length) empty(depositList,'No configured deposits',
      'No mineral, forest, water, fuel or other extraction deposits are registered in this State.');
    for(const deposit of deposits) {
      const resource=(onlineGame.resourceCatalog || []).find(item=>item.id===deposit.resourceId);
      const province=provinceName(deposit.provinceId);
      const facilityCompany=companies.find(company=>
        (company.facilities || []).some(item=>item.id===deposit.facilityId));
      const facility=facilityCompany?.facilities?.find(item=>item.id===deposit.facilityId);
      const hasOffice=(deposit.extractionOfficeIds || []).some(id=>heldOfficeIds.has(id));
      const lawActive=window.NewWorldResources?.lawIsActive?.(onlineGame,stateId,deposit.extractionLawId);
      const unlocked=!deposit.requiredTechnologyId ||
        (onlineGame.technologyUnlocks || []).some(item=>
          item.stateId===stateId && item.technologyId===deposit.requiredTechnologyId);
      const remaining=Number(deposit.reserves)||0;
      const extractedToday=deposit.lastExtractionOn===onlineGame.worldDate
        ? Number(deposit.extractedToday)||0 : 0;
      const dailyRemaining=Math.max(0,(Number(deposit.maximumExtractionPerDay)||0)-extractedToday);
      const sustainableRemaining=deposit.sustainableExtractionPerDay===undefined
        ? dailyRemaining : Math.max(0,Number(deposit.sustainableExtractionPerDay)-extractedToday);
      const dailyAvailable=Math.min(remaining,dailyRemaining,sustainableRemaining);
      const balance=energy.find(item=>item.stateId===stateId);
      const energyPerUnit=Number(deposit.energyPerUnit)||0;
      const energyLimit=energyPerUnit>0
        ? Math.floor(Math.max(0,Number(balance?.available)||0)/energyPerUnit)
        : Number.MAX_SAFE_INTEGER;
      const costPerUnit=Number(deposit.costPerUnit)||0;
      const availableCash=Number(facilityCompany?.cashBalances?.[facilityCompany?.currencyId])||0;
      const costLimit=costPerUnit>0?Math.floor(availableCash/costPerUnit):Number.MAX_SAFE_INTEGER;
      const good=(onlineGame.goods || []).find(item=>item.id===resource?.goodId);
      const currentInventory=companies.reduce((sum,company)=>
        sum+Math.max(0,Number(company.inventory?.[resource?.goodId])||0),0);
      const configuredStorageCapacity=Number(good?.storageCapacity);
      const storageCapacity=Number.isFinite(configuredStorageCapacity)
        ? Math.max(0,configuredStorageCapacity) : Number.MAX_SAFE_INTEGER;
      const storageLimit=Math.max(0,storageCapacity-currentInventory);
      const workforce=Number(facility?.workers ?? deposit.workers ?? 0);
      const canExtract=Boolean(
        onlineGame.status==='running' && membership && deposit.accessible &&
        resource && lawActive && hasOffice && facility && facility.operational!==false &&
        workforce>=Number(deposit.requiredWorkers) && unlocked
      );
      const maximum=Math.max(0,Math.min(dailyAvailable,energyLimit,costLimit,storageLimit));
      const row=addPoliticalRow(deposit.accessible?'AVAILABLE RESOURCE DEPOSIT':'INACCESSIBLE DEPOSIT',
        province+' · '+resourceName(deposit.resourceId)+' · '+formatNumber(remaining)+' '+(resource?.unit || 'units')+' remaining');
      addPoliticalRow(row,'RESERVE QUALITY / DAILY LIMIT',
        formatNumber(deposit.quality)+'% quality · '+formatNumber(deposit.maximumExtractionPerDay)+
        ' '+(resource?.unit || 'units')+'/day · '+(resource?.renewable?'REGENERATING':'NON-RENEWABLE'));
      const notes=[];
      if(!lawActive) notes.push('No active extraction law');
      if(!hasOffice) notes.push('Authorized extraction office not held');
      if(!facility || facility.operational===false) notes.push('Operational installation unavailable');
      if(facility && workforce<Number(deposit.requiredWorkers))
        notes.push('Workforce below '+formatNumber(deposit.requiredWorkers));
      if(!unlocked) notes.push('Required technology not unlocked');
      if(energyPerUnit>0 && energyLimit===0) notes.push('Insufficient available energy');
      if(costPerUnit>0 && costLimit===0) notes.push('Insufficient company funds');
      if(storageLimit===0) notes.push('Resource storage full');
      if(dailyAvailable===0) notes.push('No remaining daily or geological extraction capacity');
      if(notes.length) {
        const note=document.createElement('span');
        note.className='resource-inline-note';
        note.textContent=notes.join(' · ');
        row.appendChild(note);
      }
      const controls=document.createElement('div');
      controls.className='resource-extraction-controls';
      const slider=document.createElement('input');
      slider.type='range';slider.min='1';slider.max=String(Math.max(1,maximum));
      slider.step='1';slider.value=String(Math.max(1,Math.min(1,maximum)));
      slider.disabled=!canExtract || maximum<1;
      slider.setAttribute('aria-label','Extraction quantity in '+(resource?.unit || 'units'));
      const readout=document.createElement('output');
      readout.className='resource-quantity-readout';
      const updateReadout=()=>{
        readout.textContent=formatNumber(Number(slider.value))+' '+(resource?.unit || 'units');
      };
      slider.addEventListener('input',updateReadout);
      updateReadout();
      const extract=document.createElement('button');
      extract.type='button';extract.className='secondary-button';
      extract.textContent='EXTRACT RESOURCE';
      extract.disabled=slider.disabled;
      extract.addEventListener('click',()=>{
        const quantity=Number(slider.value);
        if(!Number.isSafeInteger(quantity) || quantity<1 || quantity>maximum) {
          showMessage('The requested quantity is outside the current extraction limits.',true);
          return;
        }
        sendAction({type:'resource.extract',stateId,depositId:deposit.id,quantity});
      });
      controls.append(slider,readout,extract);
      row.appendChild(controls);
    }

    if(!stocks.length) empty(stockList,'No resource stocks',
      'Extraction and harvest output will appear here when production is configured and storage accepts it.');
    for(const stock of stocks) {
      const resource=(onlineGame.resourceCatalog || []).find(item=>item.goodId===stock.goodId);
      const good=(onlineGame.goods || []).find(item=>item.id===stock.goodId);
      addPoliticalRow(stock.goodId.toUpperCase()+' · '+(resource?.name || good?.name || stock.goodId),
        formatNumber(stock.quantity)+' '+(good?.unit || resource?.unit || 'units')+
        ' · updated '+formatWorldDate(stock.updatedOn || onlineGame.worldDate));
    }

    const harvests=(onlineGame.harvestCycles || []).filter(item=>item.stateId===stateId)
      .slice().reverse().slice(0,20);
    if(!farms.length && !land.length && !harvests.length)
      empty(farmList,'No farms or agricultural land',
        'Agriculture requires explicitly configured land, climate, seed, labour and crop definitions.');
    if(!livestockSites.length)
      empty(livestockList,'No livestock or ranches configured',
        'Animal herds, breeding rates, feed, welfare and products are not inferred from farm or population data.');
    for(const site of livestockSites) {
      const company=companies.find(item=>item.id===site.companyId);
      const facility=company?.facilities?.find(item=>item.id===site.facilityId);
      const feed=Number(company?.inventory?.[site.feedGoodId]||0);
      const product=(onlineGame.resourceStocks||[]).find(item=>
        item.stateId===stateId && item.goodId===site.dailyProductGoodId);
      const previous=primaryCycles.find(item=>item.siteId===site.id && item.siteType==='livestock');
      const row=addPoliticalRow('LIVESTOCK · '+site.name,
        provinceName(site.provinceId)+' · '+(company?.name||site.companyId));
      addPoliticalRow(row,'HERD / BREEDING RESERVE',
        formatNumber(site.animals)+' / '+formatNumber(site.maximumHerd)+
        ' animals · '+formatNumber(site.breedingStockMinimum)+' breeding reserve · '+
        formatNumber(site.pastureAreaHectares)+' ha pasture');
      addPoliticalRow(row,'FEED / STAFFING',
        goodName(site.feedGoodId)+' stock '+formatNumber(feed)+' · '+
        formatNumber(facility?.workers||0)+' / '+formatNumber(site.workersRequired)+
        ' workers · '+formatNumber(site.animalsPerHectare)+' animals/ha');
      addPoliticalRow(row,'OUTPUT / LAST CYCLE',
        goodName(site.dailyProductGoodId)+' · '+formatNumber(site.dailyProductPerFedAnimal)+
        ' per fed animal/day · '+(previous
          ? formatWorldDate(previous.worldDate)+' · '+formatNumber(previous.productQuantity||0)+
            ' produced · '+formatNumber(previous.births||0)+' births · '+
            formatNumber(previous.naturalDeaths||0)+' natural deaths · '+
            formatNumber(previous.diseaseDeaths||0)+' disease losses'
          : 'No livestock cycle recorded yet.'));
      if(site.dailySlaughterLimit>0)
        addPoliticalRow(row,'MEAT / SLAUGHTER',
          formatNumber(site.dailySlaughterLimit)+' max animals/day · '+goodName(site.meatGoodId)+
          ' · '+formatNumber(site.meatPerAnimal)+' units/animal · '+
          formatNumber(previous?.slaughteredAnimals||0)+' slaughtered in last cycle');
    }
    if(!fishingGrounds.length)
      empty(fisheryList,'No fishing grounds configured',
        'Fish stocks, seasons, sustainable catch limits and local fishing crews are not assumed.');
    for(const ground of fishingGrounds) {
      const company=companies.find(item=>item.id===ground.companyId);
      const facility=company?.facilities?.find(item=>item.id===ground.facilityId);
      const previous=primaryCycles.find(item=>item.siteId===ground.id && item.siteType==='fishery');
      const month=Number(onlineGame.worldDate.slice(5,7));
      const isOpen=ground.openMonths.includes(month);
      const row=addPoliticalRow('FISHERY · '+ground.name,
        provinceName(ground.provinceId)+' · '+(company?.name||ground.companyId));
      addPoliticalRow(row,'STOCK / ECOLOGICAL RESERVE',
        formatNumber(ground.stock)+' / '+formatNumber(ground.stockCapacity)+' '+
        goodName(ground.outputGoodId)+' · '+formatNumber(ground.ecologicalReserve)+
        ' protected · '+formatNumber(ground.dailyRegeneration)+' regenerated/day');
      addPoliticalRow(row,'SEASON / SUSTAINABLE CATCH',
        (isOpen?'OPEN SEASON':'CLOSED SEASON')+' · months '+ground.openMonths.join(', ')+
        ' · '+formatNumber(ground.sustainableCatchPerDay)+' sustainable / '+
        formatNumber(ground.maximumCatchPerDay)+' maximum per day');
      addPoliticalRow(row,'FISHING CREW / LAST CATCH',
        formatNumber(facility?.workers||0)+' / '+formatNumber(ground.workersRequired)+
        ' workers required · '+(previous
          ? formatWorldDate(previous.worldDate)+' · '+formatNumber(previous.catchQuantity||0)+
            ' caught · '+formatNumber(previous.biodiversityLossPercent||0)+'% biodiversity impact'
          : 'No fishing cycle recorded yet.'));
    }
    if(!forestAreas.length)
      empty(forestList,'No managed forests configured',
        'Standing timber, ecological reserves, regeneration and sustainable harvesting are not assumed.');
    for(const forest of forestAreas) {
      const company=companies.find(item=>item.id===forest.companyId);
      const facility=company?.facilities?.find(item=>item.id===forest.facilityId);
      const previous=primaryCycles.find(item=>item.siteId===forest.id && item.siteType==='forestry');
      const row=addPoliticalRow('FOREST · '+forest.name,
        provinceName(forest.provinceId)+' · '+formatNumber(forest.areaHectares)+' ha');
      addPoliticalRow(row,'STANDING TIMBER / RESERVE',
        formatNumber(forest.standingTimber)+' / '+formatNumber(forest.maximumTimber)+
        ' '+goodName(forest.outputGoodId)+' · '+formatNumber(forest.ecologicalReserve)+
        ' ecological reserve · '+formatNumber(forest.regenerationPerDay)+' regenerated/day');
      addPoliticalRow(row,'HARVEST / CONSERVATION',
        formatNumber(forest.sustainableHarvestPerDay)+' sustainable / '+
        formatNumber(forest.maximumHarvestPerDay)+' maximum/day · '+
        formatNumber(forest.conservationPercent)+'% conservation');
      addPoliticalRow(row,'FORESTRY CREW / LAST HARVEST',
        formatNumber(facility?.workers||0)+' / '+formatNumber(forest.workersRequired)+
        ' workers required · '+(previous
          ? formatWorldDate(previous.worldDate)+' · '+formatNumber(previous.harvested||0)+
            ' units harvested · '+formatNumber(previous.regenerated||0)+' regenerated'
          : 'No forestry cycle recorded yet.'));
    }
    for(const parcel of land) {
      const farmsOnParcel=farms.filter(item=>item.landId===parcel.id);
      const assigned=farmsOnParcel.reduce((sum,item)=>sum+Number(item.areaHectares||0),0);
      const row=addPoliticalRow('AGRICULTURAL LAND · '+String(parcel.use||'').toUpperCase(),
        provinceName(parcel.provinceId)+' · '+formatNumber(parcel.areaHectares)+' hectares · '+
        formatNumber(parcel.soilFertilityPercent)+'% soil fertility');
      addPoliticalRow(row,'LAND ALLOCATION',
        formatNumber(assigned)+' / '+formatNumber(parcel.areaHectares)+' hectares assigned to farms.');
    }
    for(const farm of farms) {
      const crop=(onlineGame.cropDefinitions || []).find(item=>item.id===farm.cropId);
      const row=addPoliticalRow('FARM · '+(crop?.name || farm.cropId),
        provinceName(farm.provinceId)+' · '+formatNumber(farm.areaHectares)+' ha · '+
        formatNumber(farm.workers)+' workers · '+formatNumber(farm.seedStock)+' seed units');
      const climate=window.NewWorldResources?.seasonFor?.(
        onlineGame,farm.provinceId,onlineGame.worldDate);
      addPoliticalRow(row,'CURRENT CLIMATE / SEASON',
        climate?.zone
          ? climate.zone.name+' · '+(climate.season?.name || 'No seasonal parameters')+
            ' · yield factor '+formatNumber(climate.season?.yieldFactor)+
            ' · water factor '+formatNumber(climate.season?.waterFactor)+
            ' · drought exposure '+formatNumber(climate.zone.droughtExposurePercent)+'%'
          : 'No climate zone has been configured for this province.');
      const previous=harvests.find(item=>item.farmId===farm.id);
      addPoliticalRow(row,'LAST RECORDED HARVEST',
        previous?formatNumber(previous.quantity)+' '+goodName(crop?.outputGoodId)+' · '+
          formatWorldDate(previous.harvestedOn):
          'No harvest has been recorded. Harvests only occur on the configured calendar date.');
    }
    if(harvests.length && !farms.length)
      for(const harvest of harvests)
        addPoliticalRow(farmList,'RECORDED HARVEST',formatNumber(harvest.quantity)+' '+goodName(
          (onlineGame.cropDefinitions || []).find(item=>item.id===harvest.cropId)?.outputGoodId)+
          ' · '+formatWorldDate(harvest.harvestedOn));

    if(!environments.length) empty(environmentList,'No environmental measurements',
      'No measurements are configured for this State. Soil, water, forest, biodiversity and pollution are tracked separately.');
    for(const item of environments) {
      const row=addPoliticalRow('ENVIRONMENT · '+provinceName(item.provinceId),
        'Updated '+formatWorldDate(item.updatedOn || onlineGame.worldDate));
      addPoliticalRow(row,'SOIL FERTILITY',formatNumber(item.soilFertilityPercent)+'%');
      addPoliticalRow(row,'WATER AVAILABILITY',formatNumber(item.waterAvailabilityPercent)+'%');
      addPoliticalRow(row,'FOREST COVER',formatNumber(item.forestCoverPercent)+'%');
      addPoliticalRow(row,'BIODIVERSITY',formatNumber(item.biodiversityPercent)+'%');
      addPoliticalRow(row,'POLLUTION INDEX',formatNumber(item.pollutionIndex));
    }
    if(!energy.length) empty(energyList,'No energy balance',
      'No sources, production, losses or consumption are configured for this State.');
    for(const item of energy) {
      const row=addPoliticalRow('ENERGY BALANCE · '+formatWorldDate(item.worldDate),
        'Available '+formatNumber(item.available)+' energy units');
      addPoliticalRow(row,'GENERATED / LOSSES',formatNumber(item.generated)+' generated · '+
        formatNumber(item.losses)+' lost');
      addPoliticalRow(row,'CONSUMPTION / USED',formatNumber(item.consumption)+' consumed before extraction · '+
        formatNumber(item.used)+' used by extraction');
    }

    const waterSources=(onlineGame.waterSources || []).filter(item=>item.stateId===stateId);
    const waterBalances=(onlineGame.waterBalances || []).filter(item=>item.stateId===stateId)
      .slice().reverse();
    if(!waterSources.length)
      empty(waterList,'No configured water sources',
        'Rivers, lakes, aquifers and reservoirs require finite stock, inflow, ecological reserve and withdrawal rules.');
    for(const source of waterSources) {
      const balance=waterBalances.find(item=>item.sourceId===source.id);
      const allocated=(onlineGame.waterAllocations || []).filter(item=>
        item.stateId===stateId && item.worldDate===onlineGame.worldDate &&
        item.sourceAllocations?.some(row=>row.sourceId===source.id))
        .reduce((sum,item)=>sum+item.sourceAllocations
          .filter(row=>row.sourceId===source.id)
          .reduce((value,row)=>value+Number(row.quantity||0),0),0);
      const row=addPoliticalRow(String(source.type||'WATER').toUpperCase()+' · '+source.id,
        provinceName(source.provinceId)+' · '+formatNumber(source.qualityPercent)+'% quality');
      addPoliticalRow(row,'STOCK / ECOLOGICAL RESERVE',
        formatNumber(balance?.closingStock??source.stock)+' / '+formatNumber(source.capacity)+
        ' '+source.unit+' · '+formatNumber(source.environmentalReserve)+' '+source.unit+
        ' protected · '+formatNumber(allocated)+' '+source.unit+' withdrawn today');
      addPoliticalRow(row,'RENEWAL / WITHDRAWAL',
        formatNumber(source.renewableInflowPerDay)+' '+source.unit+'/day inflow · '+
        formatNumber(source.maximumWithdrawalPerDay)+' '+source.unit+'/day maximum withdrawal');
    }
    const waterAllocations=(onlineGame.waterAllocations || []).filter(item=>
      item.stateId===stateId && item.worldDate===onlineGame.worldDate);
    if(!waterAllocations.length)
      empty(waterHistoryList,'No current water allocation',
        'Daily water demands are allocated by priority when a simulation day runs.');
    for(const item of waterAllocations) {
      const row=addPoliticalRow(String(item.targetType||'WATER').toUpperCase()+
        ' · '+(item.targetId||item.demandId),
        provinceName(item.provinceId)+' · priority '+formatNumber(item.priority));
      addPoliticalRow(row,'DELIVERY / SHORTAGE',
        formatNumber(item.allocated)+' / '+formatNumber(item.demand)+' '+item.unit+
        ' · '+formatNumber(item.coveragePercent)+'% covered · '+
        formatNumber(item.shortage)+' '+item.unit+' unmet');
    }
    const waterHistory=(onlineGame.waterHistory || []).filter(item=>item.stateId===stateId)
      .slice().reverse().slice(0,20);
    for(const item of waterHistory)
      addPoliticalRow(waterHistoryList,'WATER SHORTAGE · '+(item.targetId||item.demandId),
        formatWorldDate(item.worldDate)+' · '+formatNumber(item.shortage)+' '+item.unit+' unmet');
    const history=(onlineGame.resourceHistory || []).filter(item=>item.stateId===stateId)
      .slice().reverse().slice(0,30);
    const disasters=(onlineGame.disasters || []).filter(item=>
      item.provinceIds?.some(id=>onlineGame.provinces?.some(p=>p.id===id && p.stateId===stateId)));
    for(const disaster of disasters) {
      const row=addPoliticalRow('DISASTER · '+String(disaster.type||'').toUpperCase(),
        disaster.provinceIds.map(provinceName).join(', ')+' · '+formatWorldDate(disaster.startDate)+
        ' · '+formatNumber(disaster.intensityPercent)+'% intensity · '+formatNumber(disaster.durationDays)+' days');
      addPoliticalRow(row,'RECORDED IMPACT',
        disaster.lastAppliedOn?'Last applied '+formatWorldDate(disaster.lastAppliedOn):
          'Scheduled impact; no environmental change has yet been applied.');
    }
    if(!history.length && !disasters.length)
      empty(historyList,'No resource history','Extraction, harvest and disaster impacts will be recorded here.');
    for(const entry of history) {
      const row=addPoliticalRow(String(entry.type||'RESOURCE EVENT').replaceAll('_',' ').toUpperCase(),
        formatWorldDate(entry.worldDate)+' · '+(entry.description || 'Recorded resource event'));
      if(entry.details?.depositId) addPoliticalRow(row,'DEPOSIT',entry.details.depositId);
    }
    const reserves=(onlineGame.foodReserves || []).filter(item=>item.stateId===stateId);
    for(const reserve of reserves)
      addPoliticalRow(historyList,'PROTECTED STRATEGIC RESERVE',
        formatNumber(reserve.protectedQuantity)+' / '+formatNumber(reserve.quantity)+' '+
        goodName(reserve.goodId)+' protected · '+formatNumber(reserve.quality)+'% quality. No automatic sale.');
  }






  function renderIdentity() {
    const ids=['identity-cohesion-list','identity-group-list','identity-profile-list',
      'identity-program-list','identity-history-list'];
    const lists=ids.map(id=>$(id));
    const status=$('identity-status');
    if(!status||lists.some(item=>!item)) return;
    lists.forEach(list=>list.replaceChildren());
    const [cohesionList,groupList,profileList,programList,historyList]=lists;
    const territory=onlineGame?.territories?.find(item=>item.index===state.selected);
    const stateId=territory?.stateId;
    const player=currentPlayer();
    const membership=player&&membershipsFor(player).find(item=>item.stateId===stateId);
    const political=onlineGame?.politicalSystems?.find(item=>item.stateId===stateId);
    const offices=new Set((political?.offices||[])
      .filter(item=>item.holderPlayerId===player?.id).map(item=>item.id));
    const fmt=value=>Number(value||0).toLocaleString('en-US',{maximumFractionDigits:1});
    const empty=(list,title,description)=>addPoliticalRow(list,title,description);
    if(!onlineGame||!territory||!player) {
      status.textContent='Connect to a world and select a State to inspect aggregated group and community indicators.';
      empty(cohesionList,'No social-cohesion data','Cohesion is calculated only from configured provincial group profiles.');
      empty(groupList,'No identity groups','No religious, cultural, language, ideological or civic groups are invented.');
      empty(profileList,'No provincial profiles','No population estimates or rights indicators have been fabricated.');
      empty(programList,'No community programs','Programs require configured organizations and an active legal mandate.');
      empty(historyList,'No community history','Funded initiatives and social indicator changes will be recorded here.');
      return;
    }
    const groups=(onlineGame.identityGroups||[]).filter(item=>item.stateId===stateId);
    const profiles=(onlineGame.identityProfiles||[]).filter(item=>item.stateId===stateId);
    const organizations=(onlineGame.identityOrganizations||[]).filter(item=>
      item.stateId===stateId&&item.status==='active');
    const programs=(onlineGame.communityPrograms||[]).filter(item=>item.stateId===stateId)
      .slice().reverse().slice(0,50);
    const cohesion=window.NewWorldIdentity?.calculateCohesion?.(onlineGame,stateId);
    status.textContent='Selected State: '+territory.name+'. '+groups.length+
      ' configured group(s), '+profiles.length+' provincial profile(s), '+
      organizations.length+' active community organization(s). All values are aggregated.';
    if(!cohesion) empty(cohesionList,'No calculated indicators',
      'Configure at least one group profile for this State to calculate social cohesion.');
    else {
      const row=addPoliticalRow('SOCIAL COHESION INDEX',
        fmt(cohesion.cohesionIndex)+' / 100 · polarization '+fmt(cohesion.polarizationIndex)+' / 100');
      addPoliticalRow(row,'COVERAGE',
        fmt(cohesion.coveredPopulationSharePercent)+'% of estimated population share · '+
        cohesion.groupCount+' group/province profiles');
      addPoliticalRow(row,'RIGHTS / SERVICES',
        fmt(cohesion.averageRightsProtectionPercent)+'% rights protection · '+
        fmt(cohesion.averageServiceAccessPercent)+'% service access');
      addPoliticalRow(row,'INTEGRATION / GRIEVANCE / TRUST',
        fmt(cohesion.averageIntegrationPercent)+'% integration · '+
        fmt(cohesion.averageGrievancePercent)+'% grievance · '+
        fmt(cohesion.averageInstitutionalTrustPercent)+'% institutional trust');
      addPoliticalRow(row,'SERVICE ACCESS GAP',
        fmt(cohesion.serviceInequalityPercent)+' percentage-point difference between highest and lowest profile access');
      addPoliticalRow(row,'MEASUREMENT',
        'This is an aggregated scenario index, not a validated real-world social-science measure.');
    }
    if(!groups.length) empty(groupList,'No configured identity groups',
      'Groups may represent religion, ideology, language, culture, national identity or civic movements.');
    for(const group of groups) {
      const related=profiles.filter(item=>item.groupId===group.id);
      const orgs=organizations.filter(item=>item.groupId===group.id);
      const row=addPoliticalRow(group.name+' · '+group.category.replaceAll('_',' ').toUpperCase(),
        group.legalStatus.toUpperCase()+' · '+(group.nonExclusive?'overlapping affiliation':'mutually exclusive category'));
      const description=document.createElement('p');
      description.className='identity-group-description';
      description.textContent=group.description;
      row.appendChild(description);
      addPoliticalRow(row,'PROVINCIAL COVERAGE',
        related.length+' aggregate profile(s) · '+orgs.length+' active organization(s)');
    }
    if(!profiles.length) empty(profileList,'No provincial identity profiles',
      'Population share, recognition, rights and service access remain unset until the host configures them.');
    for(const profile of profiles) {
      const group=groups.find(item=>item.id===profile.groupId);
      const province=onlineGame.provinces?.find(item=>item.id===profile.provinceId);
      const row=addPoliticalRow((group?.name||profile.groupId)+' · '+(province?.name||profile.provinceId),
        'estimated population share '+fmt(profile.populationSharePercent)+'% · updated '+formatWorldDate(profile.updatedOn));
      const metrics=[
        ['RECOGNITION',profile.recognitionPercent],['RIGHTS PROTECTION',profile.rightsProtectionPercent],
        ['SERVICE ACCESS',profile.serviceAccessPercent],['INTEGRATION',profile.integrationPercent],
        ['INSTITUTIONAL TRUST',profile.institutionalTrustPercent],
        ['RELIGIOUS FREEDOM',profile.religiousFreedomPercent],['GRIEVANCE',profile.grievancePercent]
      ];
      for(const [label,value] of metrics) {
        const metric=document.createElement('div');
        metric.className='identity-metric';
        const caption=document.createElement('span');caption.textContent=label;
        const output=document.createElement('strong');output.textContent=fmt(value)+'%';
        const bar=document.createElement('progress');bar.max=100;bar.value=Math.max(0,Math.min(100,Number(value)||0));
        metric.append(caption,output,bar);row.appendChild(metric);
      }
    }
    if(!organizations.length) empty(programList,'No authorized organizations',
      'Faith, cultural, language and civic organizations must be defined with active mandates and oversight offices.');
    for(const org of organizations) {
      const group=groups.find(item=>item.id===org.groupId);
      const profile=profiles.find(item=>item.id===org.profileId);
      const province=onlineGame.provinces?.find(item=>item.id===org.provinceId);
      const row=addPoliticalRow(org.name+' · '+org.type.replaceAll('_',' ').toUpperCase(),
        (group?.name||org.groupId)+' · '+(province?.name||org.provinceId));
      addPoliticalRow(row,'LEGAL MANDATE / PROGRAMMES',
        org.mandateLawId+' · '+org.authorizedPrograms.map(value=>value.replaceAll('_',' ')).join(', '));
      addPoliticalRow(row,'COST / CAPACITY / EFFECTIVENESS',
        fmt(org.costPerStrength)+' per strength · '+fmt(org.dailyStrengthCapacity)+
        ' strength/day · '+fmt(org.effectivenessPercent)+'% effectiveness · '+
        fmt(org.transparencyPercent)+'% transparency');
      if(profile) addPoliticalRow(row,'TARGET PROFILE',
        'Recognition '+fmt(profile.recognitionPercent)+'% · rights '+fmt(profile.rightsProtectionPercent)+
        '% · service access '+fmt(profile.serviceAccessPercent)+'% · grievance '+fmt(profile.grievancePercent)+'%');
    }
    if(!programs.length) empty(programList,'No funded programmes',
      'Funded community dialogue, equal-access or cultural initiatives appear here with cost and measured changes.');
    for(const program of programs) {
      const group=groups.find(item=>item.id===program.groupId);
      const org=organizations.find(item=>item.id===program.organizationId) ||
        (onlineGame.identityOrganizations||[]).find(item=>item.id===program.organizationId);
      const profile=profiles.find(item=>item.id===program.profileId);
      const province=onlineGame.provinces?.find(item=>item.id===program.provinceId);
      const row=addPoliticalRow(program.program.replaceAll('_',' ').toUpperCase(),
        (group?.name||program.groupId)+' · '+(province?.name||program.provinceId)+
        ' · '+formatWorldDate(program.worldDate));
      addPoliticalRow(row,'ORGANIZATION / COST',
        (org?.name||program.organizationId)+' · '+fmt(program.cost)+' · strength '+program.strength);
      addPoliticalRow(row,'AGGREGATED PROFILE CHANGE',
        Object.entries(program.changes||{}).map(([key,value])=>key.replace(/Percent$/,'')+
          ' '+fmt(value)+'%').join(' · ')+' · current '+fmt(profile?.grievancePercent)+'% grievance');
    }
    const history=(onlineGame.identityHistory||[]).filter(item=>item.stateId===stateId)
      .slice().reverse().slice(0,35);
    if(!history.length) empty(historyList,'No recorded community actions',
      'Social programmes and daily aggregated cohesion snapshots are retained here.');
    for(const entry of history)
      addPoliticalRow(String(entry.type||'IDENTITY').replaceAll('_',' ').toUpperCase(),
        formatWorldDate(entry.worldDate)+' · '+entry.description);

    const populate=(id,items,value,label,placeholder)=>{
      const select=$(id);if(!select)return;
      const previous=select.value;select.replaceChildren();
      const initial=document.createElement('option');
      initial.value='';initial.textContent=placeholder;select.appendChild(initial);
      for(const item of items) {
        const option=document.createElement('option');
        option.value=value(item);option.textContent=label(item);select.appendChild(option);
      }
      if([...select.options].some(item=>item.value===previous)) select.value=previous;
    };
    populate('identity-org-select',organizations,item=>item.id,item=>item.name,'Select an organization');
    const selectedOrg=organizations.find(item=>item.id===$('identity-org-select')?.value)||organizations[0];
    const linkedProfiles=profiles.filter(item=>
      !selectedOrg || (item.id===selectedOrg.profileId&&item.groupId===selectedOrg.groupId));
    populate('identity-profile-select',linkedProfiles,item=>item.id,item=>{
      const group=groups.find(value=>value.id===item.groupId);
      const province=onlineGame.provinces?.find(value=>value.id===item.provinceId);
      return (group?.name||item.groupId)+' · '+(province?.name||item.provinceId);
    },'Select a profile');
    const programSelect=$('identity-program-select');
    if(programSelect) {
      const previous=programSelect.value;programSelect.replaceChildren();
      for(const type of selectedOrg?.authorizedPrograms||[]) {
        const option=document.createElement('option');option.value=type;
        option.textContent=type.replaceAll('_',' ');programSelect.appendChild(option);
      }
      if([...programSelect.options].some(item=>item.value===previous)) programSelect.value=previous;
    }
    const strength=$('identity-strength');
    if(strength) {
      const value=Math.max(1,Math.min(5,Number(strength.value)||1));
      strength.value=String(value);
      $('identity-strength-readout').textContent=value+' / 5';
    }
    const selectedProfile=profiles.find(item=>item.id===$('identity-profile-select')?.value)||
      linkedProfiles[0];
    const authorized=Boolean(membership&&selectedOrg&&selectedProfile&&
      selectedOrg.programOfficeIds.some(id=>offices.has(id))&&
      window.NewWorldIdentity?.lawIsActive?.(onlineGame,stateId,selectedOrg.mandateLawId)&&
      onlineGame.status==='running');
    const used=selectedOrg?programs.filter(item=>
      item.organizationId===selectedOrg.id&&item.worldDate===onlineGame.worldDate)
      .reduce((sum,item)=>sum+item.strength,0):0;
    const strengthValue=Number(strength?.value||1);
    const cost=selectedOrg?selectedOrg.costPerStrength*strengthValue:0;
    const remaining=selectedOrg?Math.max(0,selectedOrg.dailyStrengthCapacity-used):0;
    const preview=$('identity-program-preview');
    if(preview) preview.textContent=selectedOrg&&selectedProfile
      ? 'Cost: '+fmt(cost)+' · Treasury: '+fmt(territory.treasury)+
        ' · daily capacity remaining: '+fmt(remaining)+' strength · mandate: '+selectedOrg.mandateLawId+
        ' · effect strength: '+fmt(Math.min(10,strengthValue*selectedOrg.effectivenessPercent/100*
          selectedOrg.transparencyPercent/100))+' points before indicator bounds.'
      : 'Select an organization and its linked provincial profile. All programme values are scenario-defined.';
    const fund=$('identity-fund-program');
    if(fund) fund.disabled=!authorized||!programSelect?.value||
      strengthValue>remaining||cost>Number(territory.treasury||0);
  }

  function renderWorldEvents() {
    const activeList=$('world-events-active-list');
    const historyList=$('world-events-history-list');
    const status=$('world-events-status');
    if(!activeList || !historyList || !status) return;
    activeList.replaceChildren();historyList.replaceChildren();
    const territory=onlineGame?.territories?.find(item=>item.index===state.selected);
    const stateId=territory?.stateId;
    const player=currentPlayer();
    const membership=player && membershipsFor(player).find(item=>item.stateId===stateId);
    const offices=new Set((onlineGame?.politicalSystems?.find(item=>item.stateId===stateId)?.offices||[])
      .filter(item=>item.holderPlayerId===player?.id).map(item=>item.id));
    const fmt=value=>Number(value||0).toLocaleString('en-US',{maximumFractionDigits:2});
    const empty=(list,title,description)=>addPoliticalRow(list,title,description);
    if(!onlineGame || !territory || !player) {
      status.textContent='Connect to a world and select a State to inspect events and decisions.';
      empty(activeList,'No active events','No event definitions or pending decisions are configured.');
      empty(historyList,'No event history','World-event records appear after configured events trigger.');
      return;
    }
    const definitions=(onlineGame.eventDefinitions||[]).filter(item=>item.stateId===stateId);
    const active=(onlineGame.worldEvents||[]).filter(item=>
      item.stateId===stateId && item.status==='open').slice().sort((a,b)=>
        a.expiresOn.localeCompare(b.expiresOn)||a.createdOn.localeCompare(b.createdOn));
    const history=(onlineGame.worldEvents||[]).filter(item=>
      item.stateId===stateId && item.status!=='open').slice().reverse().slice(0,30);
    status.textContent='Selected State: '+territory.name+'. '+definitions.length+
      ' configured event definition(s); '+active.length+
      ' event(s) currently require a decision. Only authorized offices can resolve them.';
    if(!active.length) empty(activeList,'No pending events',
      definitions.length
        ? 'No event is currently active. Configured observed conditions, deterministic probability and cooldown are checked during the daily simulation cycle.'
        : 'The host has not configured event definitions for this State.');
    for(const event of active) {
      const row=addPoliticalRow(event.title+' · '+event.category.toUpperCase(),
        'Opened '+formatWorldDate(event.createdOn)+' · decision deadline '+formatWorldDate(event.expiresOn));
      const description=document.createElement('p');
      description.className='world-event-description';
      description.textContent=event.description;
      row.appendChild(description);
      if(event.triggerEvidence?.length) addPoliticalRow(row,'TRIGGER EVIDENCE',
        event.triggerEvidence.map(item=>item.metric.replaceAll('_',' ')+': '+fmt(item.actual)+' '+
          ({gt:'>',gte:'≥',lt:'<',lte:'≤',eq:'='}[item.operator]||item.operator)+' '+
          fmt(item.threshold)+(item.passed?' · MATCH':' · NO MATCH')).join(' · '));
      const allowed=membership && event.decisionOfficeIds.some(id=>offices.has(id)) &&
        onlineGame.status==='running';
      if(!allowed) addPoliticalRow(row,'DECISION AUTHORITY',
        'A player holding one of these configured offices must decide: '+event.decisionOfficeIds.join(', '));
      for(const option of event.options||[]) {
        const choice=document.createElement('div');
        choice.className='world-event-option';
        const heading=document.createElement('strong');heading.textContent=option.label;
        const detail=document.createElement('p');detail.textContent=option.description;
        const effects=document.createElement('p');
        effects.className='world-event-effects';
        effects.textContent=(option.effects||[]).map(effect=>{
          if(effect.type==='treasury_delta') return 'Treasury '+(effect.amount>=0?'+':'')+fmt(effect.amount);
          if(effect.type==='opinion_delta') return 'Opinion '+effect.topicId+' '+(effect.amount>=0?'+':'')+fmt(effect.amount)+' points';
          if(effect.type==='press_freedom_delta') return 'Press freedom '+(effect.amount>=0?'+':'')+fmt(effect.amount)+' points';
          if(effect.type==='resource_quantity_delta') return 'Stock '+effect.goodId+' '+(effect.amount>=0?'+':'')+fmt(effect.amount);
          return effect.type;
        }).join(' · ');
        const button=document.createElement('button');
        button.type='button';button.className='secondary-button';
        button.textContent='CHOOSE OPTION';
        button.disabled=!allowed;
        button.addEventListener('click',()=>sendAction({
          type:'worldEvents.chooseOption',stateId,eventId:event.id,optionId:option.id
        }));
        choice.append(heading,detail,effects,button);
        row.appendChild(choice);
      }
    }
    for(const definition of definitions) {
      if(active.some(event=>event.definitionId===definition.id)) continue;
      const check=window.NewWorldWorldEvents?.explainEvaluation?.(onlineGame,definition.id);
      if(!check?.known) continue;
      const reasonLabels={
        inactive:'definition inactive',outside_date_window:'outside configured date window',
        existing_open_event:'an event from this definition is already open',
        occurrence_limit:'maximum occurrence count reached',cooldown:'cooldown is active',
        conditions_not_met:'observed conditions are not met',
        probability_roll_failed:'deterministic probability roll did not pass'
      };
      const row=addPoliticalRow(activeList,definition.title+' · TRIGGER DIAGNOSTIC',
        check.eligible?'Eligible at the next daily evaluation.':'Not triggered: '+
          (reasonLabels[check.reason]||check.reason||'not eligible'));
      if(check.conditions.length) addPoliticalRow(row,'OBSERVED CONDITIONS',
        check.conditions.map(item=>item.metric.replaceAll('_',' ')+': '+fmt(item.actual)+' '+
          ({gt:'>',gte:'≥',lt:'<',lte:'≤',eq:'='}[item.operator]||item.operator)+' '+
          fmt(item.threshold)+(item.passed?' · MATCH':' · NO MATCH')).join(' · '));
      addPoliticalRow(row,'PROBABILITY / DATE',
        'Deterministic roll '+check.roll+' / '+check.chancePerThousand+
        ' · evaluated for '+formatWorldDate(check.worldDate));
    }
    if(!history.length) empty(historyList,'No resolved events',
      'Resolved and expired events will be retained in the event board.');
    for(const event of history) {
      const option=event.options?.find(item=>item.id===event.chosenOptionId);
      const row=addPoliticalRow(event.title+' · '+String(event.status).toUpperCase(),
        'Opened '+formatWorldDate(event.createdOn)+' · '+(event.resolvedOn
          ? 'resolved '+formatWorldDate(event.resolvedOn)
          : 'expired '+formatWorldDate(event.expiresOn)));
      if(option) addPoliticalRow(row,'SELECTED DECISION',option.label+' · '+option.description);
      if(event.triggerEvidence?.length) addPoliticalRow(row,'TRIGGER EVIDENCE',
        event.triggerEvidence.map(item=>item.metric.replaceAll('_',' ')+': '+fmt(item.actual)+' '+
          ({gt:'>',gte:'≥',lt:'<',lte:'≤',eq:'='}[item.operator]||item.operator)+' '+
          fmt(item.threshold)+(item.passed?' · MATCH':' · NO MATCH')).join(' · '));
      if(event.chosenByPlayerId)
        addPoliticalRow(row,'DECISION OWNER','Player '+event.chosenByPlayerId);
    }
  }

  function renderSecurity() {
    const ids=['security-agency-list','security-incident-list','security-case-list',
      'security-alert-list','security-history-list'];
    const lists=ids.map(id=>$(id));
    const status=$('security-status');
    if(!status || lists.some(item=>!item)) return;
    lists.forEach(list=>list.replaceChildren());
    const [agencyList,incidentList,caseList,alertList,historyList]=lists;
    const territory=onlineGame?.territories?.find(item=>item.index===state.selected);
    const stateId=territory?.stateId;
    const player=currentPlayer();
    const membership=player && membershipsFor(player).find(item=>item.stateId===stateId);
    const political=(onlineGame?.politicalSystems||[]).find(item=>item.stateId===stateId);
    const offices=new Set((political?.offices||[])
      .filter(item=>item.holderPlayerId===player?.id).map(item=>item.id));
    const fmt=value=>Number(value||0).toLocaleString('en-US',{maximumFractionDigits:1});
    const empty=(list,title,description)=>addPoliticalRow(list,title,description);
    if(!onlineGame || !territory || !player) {
      status.textContent='Connect to a world and select a State to inspect intelligence and security systems.';
      empty(agencyList,'No security agencies','Agencies, legal mandates and oversight are defined by the scenario.');
      empty(incidentList,'No reported incidents','Incident reports are not invented.');
      empty(caseList,'No security cases','Investigations require explicit law, jurisdiction and authority.');
      empty(alertList,'No public alerts','Public alerts require an authorized case.');
      empty(historyList,'No security history','Investigation and oversight actions will be recorded here.');
      return;
    }
    const agencies=(onlineGame.securityAgencies||[]).filter(item=>item.stateId===stateId);
    const authorizations=(onlineGame.securityAuthorizations||[]).filter(item=>item.stateId===stateId);
    const incidents=(onlineGame.securityIncidents||[]).filter(item=>item.stateId===stateId)
      .slice().reverse().slice(0,40);
    const cases=(onlineGame.securityCases||[]).filter(item=>item.stateId===stateId)
      .slice().reverse().slice(0,40);
    const alerts=(onlineGame.securityAlerts||[]).filter(item=>item.stateId===stateId)
      .slice().reverse().slice(0,30);
    const provinces=(onlineGame.provinces||[]).filter(item=>item.stateId===stateId);
    status.textContent=membership
      ? 'Selected State: '+territory.name+'. Reports are allegations, investigative findings have explicit confidence, and oversight is separated from the investigating office. This client receives public security data only; classified records are withheld until secure member-specific delivery is available.'
      : 'Inspection mode for '+territory.name+'. Classified security records are withheld. Filing or acting on incidents requires an active State membership.';
    const populate=(id,items,getValue,getLabel,placeholder)=>{
      const select=$(id);
      if(!select) return;
      const previous=select.value;
      select.replaceChildren();
      if(placeholder) {
        const opt=document.createElement('option');opt.value='';opt.textContent=placeholder;select.appendChild(opt);
      }
      for(const item of items) {
        const opt=document.createElement('option');
        opt.value=getValue(item);opt.textContent=getLabel(item);select.appendChild(opt);
      }
      if([...select.options].some(item=>item.value===previous)) select.value=previous;
    };
    populate('security-incident-province',provinces,item=>item.id,item=>item.name,'Select a province');
    const incidentText=$('security-incident-description')?.value?.trim()||'';
    $('security-report-incident').disabled=!membership ||
      onlineGame.status!=='running' || !provinces.length || incidentText.length<20;
    if(!agencies.length) empty(agencyList,'No configured agencies',
      'No agency, legal mandate, provincial jurisdiction or oversight office has been configured.');
    for(const agency of agencies) {
      const related=authorizations.filter(item=>item.agencyId===agency.id);
      const openCount=cases.filter(item=>item.agencyId===agency.id &&
        !['closed','referred_to_justice'].includes(item.status)).length;
      const row=addPoliticalRow(agency.name+' · '+agency.scope.replaceAll('_',' ').toUpperCase(),
        agency.provinceIds.map(id=>onlineGame.provinces.find(item=>item.id===id)?.name||id).join(', '));
      addPoliticalRow(row,'CAPACITY / RELIABILITY',
        fmt(agency.personnel)+' personnel · '+fmt(agency.capacityPercent)+'% capacity · '+
        fmt(agency.reliabilityPercent)+'% reliability · '+fmt(agency.corruptionRiskPercent)+'% risk');
      addPoliticalRow(row,'LEGAL MANDATES',
        related.map(item=>item.lawId+' · '+item.competenceIds.join(', ')+
          ' · review every '+item.reviewIntervalDays+' days'+
          (item.warrantRequired?' · warrant required':'')).join(' | ') || 'No active mandate');
      addPoliticalRow(row,'OPEN CASES / OFFICES',
        openCount+' open case(s) · investigators: '+agency.investigationOfficeIds.join(', ')+
        ' · oversight: '+agency.oversightOfficeIds.join(', '));
    }
    if(!incidents.length) empty(incidentList,'No reported incidents',
      'No incidents have been registered in this State.');
    for(const incident of incidents) {
      const row=addPoliticalRow(incident.incidentType.replaceAll('_',' ').toUpperCase()+
        ' · '+String(incident.status).toUpperCase(),
        (onlineGame.provinces.find(item=>item.id===incident.provinceId)?.name||incident.provinceId)+
        ' · '+formatWorldDate(incident.reportedOn));
      const description=document.createElement('p');
      description.className='security-report-body';
      description.textContent=incident.description;
      row.appendChild(description);
      addPoliticalRow(row,'REPORTING STATUS',
        'Incident '+incident.id+' · reported by a member · no presumption of guilt');
      if(incident.status==='untriaged' || incident.status==='under_review') {
        for(const agency of agencies) {
          const compatible=authorizations.filter(item=>
            item.agencyId===agency.id && item.provinceIds.includes(incident.provinceId) &&
            item.competenceIds.includes(incident.incidentType) &&
            window.NewWorldSecurity?.lawIsActive?.(onlineGame,stateId,item.lawId));
          for(const authorization of compatible) {
            if(!agency.investigationOfficeIds.some(id=>offices.has(id))) continue;
            const button=document.createElement('button');
            button.type='button';button.className='secondary-button';
            button.textContent='OPEN '+agency.name.toUpperCase()+' CASE';
            button.disabled=onlineGame.status!=='running';
            button.addEventListener('click',()=>sendAction({
              type:'security.openCase',stateId,incidentId:incident.id,
              agencyId:agency.id,authorizationId:authorization.id
            }));
            row.appendChild(button);
          }
        }
      }
    }
    if(!cases.length) empty(caseList,'No investigations',
      'Cases are opened only by legally authorized agencies inside their province and competence.');
    const events=(onlineGame.events||[]).filter(item=>item.stateId===stateId)
      .slice().reverse().slice(0,40);
    for(const securityCase of cases) {
      const agency=agencies.find(item=>item.id===securityCase.agencyId);
      const incident=(onlineGame.securityIncidents||[]).find(item=>item.id===securityCase.incidentId);
      const reportRows=(onlineGame.securityReports||[]).filter(item=>item.caseId===securityCase.id);
      const row=addPoliticalRow('CASE '+securityCase.id+' · '+String(securityCase.status).toUpperCase(),
        (agency?.name||securityCase.agencyId)+' · '+(incident?.incidentType||'incident')+
        ' · '+formatWorldDate(securityCase.openedOn));
      addPoliticalRow(row,'LEGAL BASIS / REVIEW',
        'Law '+securityCase.lawId+' · '+securityCase.scope+' · due '+formatWorldDate(securityCase.reviewDueOn)+
        (securityCase.reviewStatus==='overdue'?' · OVERDUE REVIEW':''));
      addPoliticalRow(row,'INTELLIGENCE ASSESSMENT',
        reportRows.length+' report(s) · average confidence '+fmt(securityCase.confidencePercent)+
        '% · highest classification '+securityCase.classification);
      for(const report of reportRows) {
        const reportRow=addPoliticalRow(row,
          report.classification.toUpperCase()+' · '+fmt(report.confidencePercent)+'% confidence',
          formatWorldDate(report.recordedOn)+' · '+report.summary);
        addPoliticalRow(reportRow,'SOURCE RECORD',
          report.sourceEventIds.length
            ? report.sourceEventIds.map(id=>onlineGame.events?.find(event=>event.id===id)?.description||id).join(' · ')
            : 'No linked shared event source. Assessment remains uncorroborated.');
      }
      if(securityCase.status==='investigating' && agency?.investigationOfficeIds?.some(id=>offices.has(id)) &&
         onlineGame.status==='running') {
        const form=document.createElement('div');
        form.className='security-case-controls';
        const summary=document.createElement('textarea');
        summary.className='text-field';summary.rows=2;summary.maxLength=700;
        summary.placeholder='Assessment summary (20–700 characters)';
        const confidence=document.createElement('input');
        confidence.type='range';confidence.min='0';confidence.max='100';confidence.step='1';confidence.value='50';
        const confidenceText=document.createElement('output');confidenceText.textContent='50% confidence';
        confidence.addEventListener('input',()=>confidenceText.textContent=confidence.value+'% confidence');
        const classification=document.createElement('select');
        classification.className='text-field';
        for(const value of ['restricted','confidential','secret']) {
          const option=document.createElement('option');option.value=value;option.textContent=value.toUpperCase();classification.appendChild(option);
        }
        const sourceSelect=document.createElement('select');
        sourceSelect.className='text-field';sourceSelect.multiple=true;sourceSelect.size=3;
        sourceSelect.setAttribute('aria-label','Shared event sources');
        for(const event of events) {
          const option=document.createElement('option');
          option.value=event.id;option.textContent=formatWorldDate(event.worldDate)+' · '+String(event.description||event.type).slice(0,80);
          sourceSelect.appendChild(option);
        }
        const submit=document.createElement('button');
        submit.type='button';submit.className='secondary-button';submit.textContent='ADD INTELLIGENCE ASSESSMENT';
        submit.addEventListener('click',()=>{
          if(summary.value.trim().length<20) {
            showMessage('The assessment needs at least 20 characters.',true);return;
          }
          sendAction({
            type:'security.addReport',stateId,caseId:securityCase.id,
            summary:summary.value,confidencePercent:Number(confidence.value),
            classification:classification.value,
            sourceEventIds:[...sourceSelect.selectedOptions].map(item=>item.value)
          });
        });
        form.append(summary,confidenceText,confidence,classification,sourceSelect,submit);
        row.appendChild(form);
      }
      if(securityCase.status==='investigating' && agency?.oversightOfficeIds?.some(id=>offices.has(id)) &&
         securityCase.openedByPlayerId!==player.id && onlineGame.status==='running') {
        const form=document.createElement('div');form.className='security-case-controls';
        const outcome=document.createElement('select');outcome.className='text-field';
        for(const [value,label] of [
          ['unsubstantiated','Unsubstantiated'],['no_action','No further action'],
          ['referred_to_justice','Refer to justice'],['disrupted','Threat disrupted'],['resolved','Resolved']
        ]) {
          const option=document.createElement('option');option.value=value;option.textContent=label;outcome.appendChild(option);
        }
        const justiceSelect=document.createElement('select');justiceSelect.className='text-field';
        const justiceCases=(onlineGame.justiceCases||[]).filter(item=>item.stateId===stateId);
        for(const justiceCase of justiceCases) {
          const option=document.createElement('option');option.value=justiceCase.id;
          option.textContent=justiceCase.id;justiceSelect.appendChild(option);
        }
        const reason=document.createElement('textarea');reason.className='text-field';
        reason.rows=2;reason.maxLength=500;reason.placeholder='Independent oversight reasons (20–500 characters)';
        const submit=document.createElement('button');submit.type='button';
        submit.className='secondary-button';submit.textContent='CLOSE / REVIEW CASE';
        submit.addEventListener('click',()=>{
          if(reason.value.trim().length<20) {
            showMessage('Oversight requires written reasons of at least 20 characters.',true);return;
          }
          const value=outcome.value;
          if(value==='referred_to_justice' && !justiceSelect.value) {
            showMessage('Select an existing justice case for a referral.',true);return;
          }
          sendAction({
            type:'security.closeCase',stateId,caseId:securityCase.id,
            outcome:value,reason:reason.value,
            justiceCaseId:value==='referred_to_justice'?justiceSelect.value:undefined
          });
        });
        form.append(outcome,justiceSelect,reason,submit);row.appendChild(form);
      }
      if(securityCase.status==='investigating' && agency?.oversightOfficeIds?.some(id=>offices.has(id)) &&
         onlineGame.status==='running') {
        const form=document.createElement('div');form.className='security-case-controls';
        const message=document.createElement('input');message.type='text';
        message.className='text-field';message.maxLength=240;
        message.placeholder='Public alert message (20–240 characters)';
        const severity=document.createElement('input');severity.type='range';
        severity.min='1';severity.max='5';severity.value='2';
        const duration=document.createElement('input');duration.type='range';
        duration.min='1';duration.max='30';duration.value='7';
        const button=document.createElement('button');button.type='button';
        button.className='secondary-button';button.textContent='ISSUE PUBLIC ALERT';
        button.addEventListener('click',()=>{
          sendAction({
            type:'security.issueAlert',stateId,caseId:securityCase.id,
            message:message.value,severity:Number(severity.value),
            durationDays:Number(duration.value)
          });
        });
        form.append(message,severity,duration,button);row.appendChild(form);
      }
    }
    if(!alerts.length) empty(alertList,'No active or expired alerts',
      'Public alerts are issued by a configured oversight office and automatically expire.');
    for(const alert of alerts) {
      const row=addPoliticalRow('LEVEL '+alert.severity+' · '+String(alert.status).toUpperCase(),
        (onlineGame.provinces.find(item=>item.id===alert.provinceId)?.name||alert.provinceId)+
        ' · issued '+formatWorldDate(alert.issuedOn)+' · expires '+formatWorldDate(alert.expiresOn));
      const paragraph=document.createElement('p');paragraph.className='security-report-body';
      paragraph.textContent=alert.message;row.appendChild(paragraph);
    }
    const history=(onlineGame.securityHistory||[]).filter(item=>item.stateId===stateId)
      .slice().reverse().slice(0,35);
    if(!history.length) empty(historyList,'No recorded security actions',
      'Incidents, cases, assessments, independent oversight, referrals and alerts are recorded here.');
    for(const entry of history)
      addPoliticalRow(historyList,String(entry.type||'SECURITY').replaceAll('_',' ').toUpperCase(),
        formatWorldDate(entry.worldDate)+' · '+entry.description);
  }

  function renderMedia() {
    const ids=['media-opinion-list','media-outlet-list','media-article-list',
      'media-poll-list','media-censorship-list'];
    const lists=ids.map(id=>$(id));
    const status=$('media-status');
    if(!status || lists.some(item=>!item)) return;
    lists.forEach(list=>list.replaceChildren());
    const [opinionList,outletList,articleList,pollList,censorshipList]=lists;
    const territory=onlineGame?.territories?.find(item=>item.index===state.selected);
    const stateId=territory?.stateId;
    const player=currentPlayer();
    const membership=player && membershipsFor(player).find(item=>item.stateId===stateId);
    const fmt=value=>Number(value||0).toLocaleString('en-US',{maximumFractionDigits:2});
    const empty=(list,title,description)=>addPoliticalRow(list,title,description);
    const provinces=(onlineGame?.provinces||[]).filter(item=>item.stateId===stateId);
    if(!onlineGame || !territory || !player) {
      status.textContent='Connect to a world and select a State to inspect media, news and public opinion.';
      empty(opinionList,'No public-opinion profiles','Topics and opinion baselines are scenario-configured.');
      empty(outletList,'No registered media outlets','Outlets and editorial permissions are not fabricated.');
      empty(articleList,'No articles','Articles will appear here after publication.');
      empty(pollList,'No registered polls','Polling results require a configured topic and an explicit respondent sample.');
      empty(censorshipList,'No press restrictions','Legal restrictions are recorded, not hidden or silently deleted.');
      return;
    }
    const outlets=(onlineGame.mediaOutlets||[]).filter(item=>item.stateId===stateId);
    const profiles=(onlineGame.publicOpinionProfiles||[]).filter(item=>item.stateId===stateId);
    const articles=(onlineGame.mediaArticles||[]).filter(item=>item.stateId===stateId)
      .slice().reverse().slice(0,50);
    const polls=(onlineGame.opinionPolls||[]).filter(item=>item.stateId===stateId)
      .slice().reverse().slice(0,30);
    const rules=(onlineGame.mediaRules||[]).find(item=>item.stateId===stateId);
    const political=(onlineGame.politicalSystems||[]).find(item=>item.stateId===stateId);
    const heldOfficeIds=new Set((political?.offices||[])
      .filter(item=>item.holderPlayerId===player.id).map(item=>item.id));
    const editors=outlets.filter(item=>item.editorPlayerIds.includes(player.id));
    status.textContent=membership
      ? 'Selected State: '+territory.name+'. Registered editors can publish and submit polls. News must cite events in the shared world record.'
      : 'Inspection mode for '+territory.name+'. Media publication and polling require an active membership and outlet editor authorization.';
    if(!profiles.length) empty(opinionList,'No configured opinion topics',
      'Support, government trust and press trust are not invented for unconfigured issues.');
    for(const profile of profiles) {
      const row=addPoliticalRow(profile.issueTitle,
        fmt(profile.supportPercent)+'% reported support · population estimate '+fmt(profile.populationEstimate));
      addPoliticalRow(row,'INSTITUTIONAL TRUST',
        'Government '+fmt(profile.governmentTrustPercent)+'% · press '+fmt(profile.pressTrustPercent)+'%');
      addPoliticalRow(row,'TOPIC WEIGHT',
        fmt(profile.importancePercent)+'% · updated '+formatWorldDate(profile.updatedOn));
      const lastPoll=polls.find(item=>item.topicId===profile.topicId);
      if(lastPoll) addPoliticalRow(row,'LATEST POLL',
        fmt(lastPoll.supportPercent)+'% support · n='+fmt(lastPoll.sampleSize)+
        ' · ±'+fmt(lastPoll.confidenceMarginPercent)+' points (approximate)');
    }
    if(!outlets.length) empty(outletList,'No registered outlets',
      'The host has not configured outlets, ownership, territorial coverage or editorial staff.');
    for(const outlet of outlets) {
      const row=addPoliticalRow(outlet.name+' · '+outlet.ownershipType.toUpperCase(),
        outlet.editorialLine.toUpperCase()+' · '+outlet.provinceIds.map(id=>
          onlineGame.provinces.find(item=>item.id===id)?.name||id).join(', '));
      addPoliticalRow(row,'REACH / CREDIBILITY / INDEPENDENCE',
        fmt(outlet.reachPercent)+'% reach · '+fmt(outlet.credibilityPercent)+
        '% credibility · '+fmt(outlet.independencePercent)+'% independence');
      addPoliticalRow(row,'EDITORIAL STAFF / CAPACITY',
        outlet.editorPlayerIds.length+' registered editor(s) · '+
        outlet.dailyPublicationCapacity+' article(s)/day · covers '+outlet.topicIds.length+' topic(s)');
    }

    if(!articles.length) empty(articleList,'No published articles',
      'News, editorials, analysis and public notices appear here with their source references.');
    for(const article of articles) {
      const outlet=outlets.find(item=>item.id===article.outletId);
      const profile=profiles.find(item=>item.topicId===article.topicId);
      const row=addPoliticalRow(article.title+' · '+String(article.status).toUpperCase(),
        (outlet?.name||article.outletId)+' · '+String(article.articleType).toUpperCase()+
        ' · '+formatWorldDate(article.publishedOn));
      addPoliticalRow(row,'TOPIC / EDITORIAL POSITION',
        (profile?.issueTitle||article.topicId)+' · '+article.stance.toUpperCase()+
        ' · government '+article.governmentPosition.toUpperCase());
      const body=document.createElement('p');
      body.className='media-article-body';
      body.textContent=article.body;
      row.appendChild(body);
      addPoliticalRow(row,'SOURCE RECORD',
        article.sourceEventIds.length
          ? article.sourceEventIds.map(id=>onlineGame.events?.find(event=>event.id===id)?.description || id).join(' · ')
          : 'No event source. This is explicitly labelled opinion/editorial material.');
      if(article.censored) {
        const restriction=(onlineGame.censorshipOrders||[]).find(item=>item.id===article.restrictionId);
        addPoliticalRow(row,'LEGAL RESTRICTION',
          'Law '+(restriction?.lawId||'unknown')+' · '+(restriction?.reason||'No recorded reason')+
          ' · severity '+fmt(restriction?.severityPercent)+'%');
      } else if(rules && membership && (rules.censorshipOfficeIds||[]).some(id=>heldOfficeIds.has(id)) &&
          article.status==='published' && (rules.censorshipLawIds||[]).length) {
        const controls=document.createElement('div');
        controls.className='media-restriction-controls';
        const lawSelect=document.createElement('select');
        lawSelect.className='text-field';
        lawSelect.setAttribute('aria-label','Legal authority for media restriction');
        for(const lawId of rules.censorshipLawIds) {
          const law=political?.laws?.find(item=>item.id===lawId);
          if(law?.mediaRestrictionAuthorized===true) {
            const option=document.createElement('option');
            option.value=law.id;option.textContent=law.title;
            lawSelect.appendChild(option);
          }
        }
        const reason=document.createElement('input');
        reason.type='text';reason.className='text-field';reason.maxLength=280;
        reason.placeholder='Written legal reasons (12–280 characters)';
        reason.setAttribute('aria-label','Written legal reasons');
        const severity=document.createElement('input');
        severity.type='range';severity.min='1';severity.max='100';severity.step='1';severity.value='10';
        severity.setAttribute('aria-label','Restriction severity');
        const restrict=document.createElement('button');
        restrict.type='button';restrict.className='secondary-button';
        restrict.textContent='RESTRICT UNDER LAW';
        restrict.disabled=!lawSelect.options.length || onlineGame.status!=='running';
        restrict.addEventListener('click',()=>{
          sendAction({
            type:'media.restrictArticle',stateId,articleId:article.id,
            lawId:lawSelect.value,reason:reason.value,severityPercent:Number(severity.value)
          });
        });
        controls.append(lawSelect,reason,severity,restrict);
        row.appendChild(controls);
      }
    }

    if(!polls.length) empty(pollList,'No polls recorded',
      'Poll results require a registered polling outlet and reported response counts.');
    for(const poll of polls) {
      const outlet=outlets.find(item=>item.id===poll.outletId);
      const profile=profiles.find(item=>item.topicId===poll.topicId);
      const row=addPoliticalRow(profile?.issueTitle||poll.topicId,
        fmt(poll.supportPercent)+'% support · '+fmt(poll.sampleSize)+' responses · '+formatWorldDate(poll.fieldworkOn));
      addPoliticalRow(row,'REPORTED RESPONSE COUNTS',
        fmt(poll.supportResponses)+' support · '+fmt(poll.opposeResponses)+' oppose · '+
        fmt(poll.undecidedResponses)+' undecided');
      addPoliticalRow(row,'METHODOLOGY / TRANSPARENCY',
        (outlet?.name||poll.outletId)+' · ±'+fmt(poll.confidenceMarginPercent)+
        ' points approximate margin · '+fmt(poll.pollTransparencyPercent)+
        '% transparency · '+poll.method);
    }

    const restrictions=(onlineGame.censorshipOrders||[]).filter(item=>item.stateId===stateId)
      .slice().reverse().slice(0,30);
    if(!restrictions.length) empty(censorshipList,'No active recorded restrictions',
      'When a legal restriction is issued, the publication remains in the archive with the law, authority and reason visible.');
    for(const restriction of restrictions) {
      const article=articles.find(item=>item.id===restriction.articleId) ||
        (onlineGame.mediaArticles||[]).find(item=>item.id===restriction.articleId);
      const law=political?.laws?.find(item=>item.id===restriction.lawId);
      addPoliticalRow(censorshipList,article?.title||restriction.articleId,
        'Law '+(law?.title||restriction.lawId)+' · '+formatWorldDate(restriction.orderedOn)+
        ' · severity '+fmt(restriction.severityPercent)+'% · '+restriction.status);
      addPoliticalRow(censorshipList,'LEGAL REASON',restriction.reason);
    }

    const populate=(id,items,value,label,placeholder)=>{
      const select=$(id);
      if(!select) return;
      const previous=select.value;
      select.replaceChildren();
      if(placeholder) {
        const option=document.createElement('option');
        option.value='';option.textContent=placeholder;
        select.appendChild(option);
      }
      for(const item of items) {
        const option=document.createElement('option');
        option.value=value(item);option.textContent=label(item);
        select.appendChild(option);
      }
      if([...select.options].some(item=>item.value===previous)) select.value=previous;
    };
    populate('media-editor-outlet',editors,item=>item.id,item=>item.name,'Select an outlet');
    populate('media-poll-outlet',editors,item=>item.id,item=>item.name,'Select a polling outlet');
    const selectedOutlet=outlets.find(item=>item.id===$('media-editor-outlet')?.value) || editors[0];
    const topics=profiles.filter(item=>!selectedOutlet || selectedOutlet.topicIds.includes(item.topicId));
    populate('media-editor-topic',topics,item=>item.topicId,item=>item.issueTitle,'Select a topic');
    const pollOutlet=outlets.find(item=>item.id===$('media-poll-outlet')?.value) || editors[0];
    const pollTopics=profiles.filter(item=>!pollOutlet || pollOutlet.topicIds.includes(item.topicId));
    populate('media-poll-topic',pollTopics,item=>item.topicId,item=>item.issueTitle,'Select a topic');
    const sources=$('media-editor-sources');
    if(sources) {
      const selected=new Set([...sources.selectedOptions].map(item=>item.value));
      sources.replaceChildren();
      const events=(onlineGame.events||[]).filter(item=>item.stateId===stateId)
        .slice().reverse().slice(0,40);
      for(const event of events) {
        const option=document.createElement('option');
        option.value=event.id;
        option.textContent=formatWorldDate(event.worldDate)+' · '+String(event.description||event.type).slice(0,100);
        option.selected=selected.has(event.id);
        sources.appendChild(option);
      }
    }
    const articleType=$('media-editor-type');
    if(articleType) {
      const news=articleType.value==='news';
      const chosenSources=sources?.selectedOptions?.length||0;
      const titleLength=$('media-editor-title')?.value?.trim().length||0;
      const bodyLength=$('media-editor-body')?.value?.trim().length||0;
      $('media-publish-article').disabled=!editors.length ||
        onlineGame.status!=='running' || !selectedOutlet || !profiles.length ||
        titleLength<4 || bodyLength<40 || (news && !chosenSources);
    }
    const sample=$('media-poll-sample');
    const support=$('media-poll-support');
    const undecided=$('media-poll-undecided');
    if(sample && support && undecided) {
      const activeProfile=pollTopics.find(item=>item.topicId===$('media-poll-topic')?.value)||pollTopics[0];
      const maximum=Math.max(30,Math.min(1000,Number(activeProfile?.populationEstimate)||30));
      sample.max=String(maximum);
      sample.value=String(Math.max(30,Math.min(maximum,Number(sample.value)||100)));
      const yes=Math.round(Number(sample.value)*(1-Number(undecided.value)/100)*Number(support.value)/100);
      const undecidedCount=Math.round(Number(sample.value)*Number(undecided.value)/100);
      $('media-sample-readout').textContent=sample.value+' respondents';
      $('media-support-readout').textContent=fmt(sample.value?100*yes/sample.value:0)+'% of sample';
      $('media-undecided-readout').textContent=fmt(Number(undecided.value))+'% undecided';
      $('media-submit-poll').disabled=!editors.length || onlineGame.status!=='running' ||
        !pollOutlet || !activeProfile || Number(sample.value)<30 ||
        Number(sample.value)>Number(activeProfile?.populationEstimate||0);
    }
  }

  function renderAdministration() {
    const ids=['administration-agency-list','administration-staff-list',
      'administration-task-list','administration-project-list',
      'administration-procurement-list','administration-history-list'];
    const lists=ids.map(id=>$(id));
    const status=$('administration-status');
    if(!status || lists.some(item=>!item)) return;
    lists.forEach(list=>list.replaceChildren());
    const [agencyList,staffList,taskList,projectList,procurementList,historyList]=lists;
    const territory=onlineGame?.territories?.find(item=>item.index===state.selected);
    const stateId=territory?.stateId;
    const player=currentPlayer();
    const membership=player && membershipsFor(player).find(item=>item.stateId===stateId);
    const political=(onlineGame?.politicalSystems||[]).find(item=>item.stateId===stateId);
    const heldOfficeIds=new Set((political?.offices||[])
      .filter(item=>item.holderPlayerId===player?.id).map(item=>item.id));
    const fmt=value=>Number(value||0).toLocaleString('en-US',{maximumFractionDigits:2});
    const provinceName=id=>onlineGame?.provinces?.find(item=>item.id===id)?.name||id||'Unknown province';
    const empty=(list,title,description)=>addPoliticalRow(list,title,description);
    if(!onlineGame || !territory || !player) {
      status.textContent='Connect to a world and select a State to inspect its civil administration.';
      empty(agencyList,'No configured agencies','Agencies, competencies and jurisdictions are scenario-defined.');
      empty(staffList,'No civil-service register','No government office holders are treated as civil servants automatically.');
      empty(taskList,'No administrative tasks','Tasks are created only by enacted laws linked to approved procedures.');
      empty(projectList,'No public projects','No project budgets or milestones are invented.');
      empty(procurementList,'No procurement register','Vendor data and procurement workflows are scenario-defined.');
      empty(historyList,'No administrative history','Administrative actions and expenses are recorded by the host.');
      return;
    }
    const agencies=(onlineGame.administrativeAgencies||[]).filter(item=>item.stateId===stateId);
    const departments=(onlineGame.administrativeDepartments||[]).filter(item=>item.stateId===stateId);
    const staff=(onlineGame.civilServants||[]).filter(item=>item.stateId===stateId);
    const budgets=(onlineGame.administrativeBudgets||[]).filter(item=>item.stateId===stateId);
    const tasks=(onlineGame.administrativeTasks||[]).filter(item=>item.stateId===stateId);
    const projects=(onlineGame.publicProjects||[]).filter(item=>item.stateId===stateId);
    const vendors=(onlineGame.procurementVendors||[]).filter(item=>item.stateId===stateId);
    status.textContent=membership
      ? 'Selected administration: '+territory.name+'. Government offices supervise agencies; career staff execute validated procedures and are stored separately from elected or appointed office holders.'
      : 'Inspecting '+territory.name+'. You can read administrative data; official documents can only be registered by a player holding the agency supervisory office.';
    if(!agencies.length)
      empty(agencyList,'No agencies configured','The host has not assigned administrative competencies, jurisdiction, staffing or budgets for this State.');
    for(const agency of agencies) {
      const budget=budgets.find(item=>item.agencyId===agency.id);
      const capacity=window.NewWorldBureaucracy?.calculateAgencyCapacity?.(onlineGame,agency);
      const agencyDepartments=departments.filter(item=>item.agencyId===agency.id);
      const agencyStaff=staff.filter(item=>item.agencyId===agency.id);
      const agencyTasks=tasks.filter(item=>item.agencyId===agency.id &&
        !['completed','cancelled'].includes(item.status));
      const row=addPoliticalRow(agency.name,
        'Agency · '+agency.competenceIds.join(', ')+' · '+fmt(capacity?.activeHeadcount)+' civil-service posts');
      addPoliticalRow(row,'JURISDICTION',
        (onlineGame.administrativeJurisdictions||[]).filter(item=>item.agencyId===agency.id)
          .map(item=>item.level.toUpperCase()+': '+item.provinceIds.map(provinceName).join(', ')).join(' · ') ||
        'No provincial coverage');
      addPoliticalRow(row,'BUDGET / WORKLOAD',
        fmt(budget?.balance)+' available · '+fmt(budget?.dailyAllocation)+' daily allocation · '+
        fmt(capacity?.workloadUnits)+' work units pending · '+
        (capacity?.workloadDays===null?'capacity unavailable':fmt(capacity?.workloadDays)+' estimated capacity-days'));
      addPoliticalRow(row,'CAPACITY FACTORS',
        fmt(capacity?.staffBaseWorkUnits)+' staff base units · infrastructure '+
        fmt((capacity?.factors?.infrastructure||0)*100)+'% · coordination '+
        fmt((capacity?.factors?.coordination||0)*100)+'% · integrity '+
        fmt((capacity?.factors?.agencyIntegrity||0)*100)+'% · '+
        fmt(capacity?.effectiveDailyWorkUnits)+' effective units/day');
      addPoliticalRow(row,'INSTITUTIONAL RISKS',
        'Corruption index '+fmt(agency.corruptionIndex)+' · office capacity '+
        fmt(agency.officeCapacity)+' · unpaid payroll '+fmt(budget?.payrollArrears));
      if(agencyDepartments.length)
        addPoliticalRow(row,'DEPARTMENTS',agencyDepartments.map(item=>item.name+
          ' ('+item.competenceIds.join(', ')+')').join(' · '));
      if(!agencyTasks.length)
        addPoliticalRow(row,'NO OPEN TASKS','No procedure linked to a newly enacted law is currently pending for this agency.');
    }

    if(!staff.length) empty(staffList,'No civil servants',
      'The scenario has no configured career staff. Political office holders are not counted as administrative employees.');
    for(const servant of staff) {
      const agency=agencies.find(item=>item.id===servant.agencyId);
      const department=departments.find(item=>item.id===servant.departmentId);
      const row=addPoliticalRow(servant.name+' · '+String(servant.status||'').toUpperCase(),
        (agency?.name||servant.agencyId)+' · '+(department?.name||'Direct agency assignment')+
        ' · '+fmt(servant.headcount)+' post(s) · '+servant.appointmentBasis.toUpperCase());
      addPoliticalRow(row,'CAREER PROFILE',
        'Qualification '+fmt(servant.qualificationPercent)+'% · experience '+
        fmt(servant.experiencePercent)+'% · merit '+fmt(servant.meritScore)+
        ' · loyalty '+fmt(servant.institutionalLoyaltyPercent)+'% · corruption risk '+
        fmt(servant.corruptionRiskPercent)+'%');
      addPoliticalRow(row,'PAY / CAPACITY',
        fmt(servant.salaryPerDay)+' per post/day · '+fmt(servant.dailyWorkUnitsPerPerson)+' base work units/person/day');
    }

    if(!tasks.length) empty(taskList,'No administrative tasks',
      'An enacted policy creates a task only when the host configured a procedure, agency, legal competence and target provinces.');
    for(const task of tasks.slice().sort((a,b)=>
      (a.status==='completed'?1:0)-(b.status==='completed'?1:0) ||
      b.priority-a.priority || a.createdOn.localeCompare(b.createdOn))) {
      const agency=agencies.find(item=>item.id===task.agencyId);
      const row=addPoliticalRow(task.title+' · '+String(task.status||'').replaceAll('_',' ').toUpperCase(),
        (agency?.name||task.agencyId)+' · priority '+task.priority+' · due '+formatWorldDate(task.dueOn)+
        ' · '+fmt(task.progressPercent)+'% complete');
      const progress=document.createElement('progress');
      progress.className='administration-progress';
      progress.max=100;progress.value=Math.max(0,Math.min(100,Number(task.progressPercent)||0));
      row.appendChild(progress);
      addPoliticalRow(row,'LEGAL / PROCEDURAL BASIS',
        'Law '+task.lawId+' · procedure '+task.procedureId+' · province '+provinceName(task.provinceId));
      addPoliticalRow(row,'EXECUTION / EXPENDITURE',
        'Created '+formatWorldDate(task.createdOn)+' · last worked '+
        (task.lastWorkedOn?formatWorldDate(task.lastWorkedOn):'not started')+
        ' · '+fmt(task.spent)+' spent · '+fmt(task.totalWorkUnits)+' total work units');
      const step=task.steps?.[task.currentStepIndex];
      for(const item of task.steps||[]) {
        const stepRow=addPoliticalRow(row,item.name+' · '+String(item.status||'pending').toUpperCase(),
          fmt(item.completedWorkUnits)+' / '+fmt(item.workUnits)+' work units · '+fmt(item.spent)+' spent');
        if(item.requiredDocuments?.length) {
          const received=new Set((item.documentsSubmitted||[]).map(doc=>doc.documentId));
          const missing=item.requiredDocuments.filter(id=>!received.has(id));
          addPoliticalRow(stepRow,'REQUIRED DOCUMENTS',
            item.requiredDocuments.map(id=>(received.has(id)?'✓ ':'○ ')+id).join(' · '));
          if(item===step && missing.length && onlineGame.status==='running' && membership &&
              agency?.supervisingOfficeIds?.some(id=>heldOfficeIds.has(id))) {
            const controls=document.createElement('div');
            controls.className='administration-document-controls';
            for(const documentId of missing) {
              const button=document.createElement('button');
              button.type='button';button.className='secondary-button';
              button.textContent='REGISTER '+documentId;
              button.addEventListener('click',()=>sendAction({
                type:'administration.submitDocument',stateId,taskId:task.id,documentId
              }));
              controls.appendChild(button);
            }
            stepRow.appendChild(controls);
          }
        }
      }
    }

    if(!projects.length) empty(projectList,'No public projects',
      'Projects remain absent until an approved budget, agency, province and milestones are configured.');
    for(const project of projects) {
      const agency=agencies.find(item=>item.id===project.agencyId);
      const row=addPoliticalRow(project.name+' · '+String(project.status||'planned').toUpperCase(),
        (agency?.name||project.agencyId)+' · '+provinceName(project.provinceId)+
        ' · approved budget '+fmt(project.approvedBudget)+' · spent '+fmt(project.spent));
      for(const milestone of project.milestones||[]) {
        const milestoneRow=addPoliticalRow(row,milestone.name+' · '+String(milestone.status||'pending').toUpperCase(),
          fmt(milestone.completedWorkUnits)+' / '+fmt(milestone.workUnits)+
          ' work units · '+(milestone.lastInspectionRecordId
            ? 'inspection '+milestone.lastInspectionRecordId
            : milestone.lastRecordId?'record '+milestone.lastRecordId:'no completion evidence'));
        if(milestone.status==='awaiting_inspection' && onlineGame.status==='running' &&
           (milestone.inspectionOfficeIds||[]).some(id=>heldOfficeIds.has(id))) {
          const controls=document.createElement('div');
          controls.className='administration-inspection-controls';
          const evidence=document.createElement('input');
          evidence.type='text';evidence.maxLength=280;
          evidence.className='text-field';
          evidence.placeholder='Inspection evidence (12–280 characters)';
          evidence.setAttribute('aria-label','Inspection evidence');
          const accept=document.createElement('button');
          accept.type='button';accept.className='secondary-button';
          accept.textContent='ACCEPT MILESTONE';
          const reject=document.createElement('button');
          reject.type='button';reject.className='secondary-button';
          reject.textContent='REJECT / RECTIFICATION';
          const inspect=outcome=>{
            if(evidence.value.trim().length<12) {
              showMessage('A concise inspection record of at least 12 characters is required.',true);
              return;
            }
            sendAction({
              type:'administration.inspectProjectMilestone',stateId,
              projectId:project.id,milestoneId:milestone.id,
              outcome,evidence:evidence.value
            });
          };
          accept.addEventListener('click',()=>inspect('accepted'));
          reject.addEventListener('click',()=>inspect('rejected'));
          controls.append(evidence,accept,reject);
          milestoneRow.appendChild(controls);
        }
        if(milestone.inspectionEvidence)
          addPoliticalRow(milestoneRow,'INSPECTION RECORD',
            milestone.inspectionEvidence+' · '+formatWorldDate(milestone.inspectedOn));
      }
    }

    const tenderSetup=$('procurement-tender-setup');
    if(tenderSetup) {
      tenderSetup.hidden=!membership||onlineGame.status!=='running'||
        membership.permissionSetId==='government-observer';
      const agencySelect=$('procurement-agency');
      const provinceSelect=$('procurement-province');
      const competenceSelect=$('procurement-competence');
      const inspectorSelect=$('procurement-inspection-office');
      const fillSelect=(select,items,value,label,placeholder)=>{
        if(!select) return;
        const previous=select.value;
        select.replaceChildren();
        const emptyOption=document.createElement('option');
        emptyOption.value='';emptyOption.textContent=placeholder;
        select.appendChild(emptyOption);
        for(const item of items) {
          const option=document.createElement('option');
          option.value=value(item);option.textContent=label(item);
          select.appendChild(option);
        }
        if([...select.options].some(item=>item.value===previous)) select.value=previous;
        else select.value='';
      };
      fillSelect(agencySelect,agencies,item=>item.id,item=>item.name,'Select an agency');
      const selectedAgency=agencies.find(item=>item.id===agencySelect?.value)||agencies[0]||null;
      if(selectedAgency&&agencySelect&&!agencySelect.value) agencySelect.value=selectedAgency.id;
      const jurisdictionProvinceIds=new Set((onlineGame.administrativeJurisdictions||[])
        .filter(item=>item.agencyId===selectedAgency?.id&&item.stateId===stateId)
        .flatMap(item=>item.provinceIds||[]));
      const coveredProvinces=(onlineGame.provinces||[]).filter(item=>
        item.stateId===stateId&&jurisdictionProvinceIds.has(item.id));
      fillSelect(provinceSelect,coveredProvinces,item=>item.id,item=>item.name,'Select a covered province');
      fillSelect(competenceSelect,(selectedAgency?.competenceIds||[]),
        item=>item,item=>String(item).replaceAll('_',' ').toUpperCase(),'Select a competence');
      const independentOffices=(political?.offices||[]).filter(item=>
        !(selectedAgency?.supervisingOfficeIds||[]).includes(item.id)&&
        item.holderPlayerId!==player?.id);
      fillSelect(inspectorSelect,independentOffices,item=>item.id,
        item=>item.name||item.id,'Select an independent inspector');
      const budget=budgets.find(item=>item.agencyId===selectedAgency?.id);
      const available=budget?Number(budget.balance||0)-Number(budget.minimumReserve||0)-
        Number(budget.reservedForProcurement||0):0;
      const estimate=Number($('procurement-estimate')?.value);
      const days=Number($('procurement-submission-days')?.value);
      const title=$('procurement-title')?.value.trim()||'';
      const scope=$('procurement-scope')?.value.trim()||'';
      const authorized=Boolean(selectedAgency&&
        selectedAgency.supervisingOfficeIds?.some(id=>heldOfficeIds.has(id)));
      const valid=Boolean(tenderSetup&&!tenderSetup.hidden&&authorized&&
        coveredProvinces.some(item=>item.id===provinceSelect?.value)&&
        (selectedAgency?.competenceIds||[]).includes(competenceSelect?.value)&&
        independentOffices.some(item=>item.id===inspectorSelect?.value)&&
        title.length>=4&&scope.length>=20&&Number.isFinite(estimate)&&
        estimate>0&&Math.round(estimate*100)===estimate*100&&estimate<=available&&
        Number.isSafeInteger(days)&&days>=1&&days<=365);
      $('procurement-open-tender').disabled=!valid;
      $('procurement-form-status').textContent=!authorized
        ? 'Your current office does not supervise the selected agency.'
        : !budget?'No agency budget account is configured.'
        : 'Available for new reservations: '+fmt(available)+' '+(territory.currencyId||'currency units')+
          '. Estimated value: '+fmt(Number.isFinite(estimate)?estimate:0)+'.';
    }

    if(!vendors.length) empty(procurementList,'No registered suppliers',
      'Only suppliers explicitly registered in the scenario can submit offers. No companies or bids are invented.');
    const tenders=(onlineGame.procurements||[]).filter(item=>item.stateId===stateId&&
      item.kind==='public_tender').slice().sort((a,b)=>String(b.openedOn).localeCompare(String(a.openedOn)));
    if(!tenders.length) addPoliticalRow(procurementList,'NO PUBLIC TENDERS',
      'Publish a tender after an agency, provincial jurisdiction, budget, supplier registry and independent inspection office have been configured.');
    const addControl=(container,label,handler)=>{
      const button=document.createElement('button');
      button.type='button';button.className='secondary-button';
      button.textContent=label;button.addEventListener('click',handler);
      container.appendChild(button);
      return button;
    };
    const addInput=(container,labelText,options={})=>{
      const label=document.createElement('label');
      label.className='field-label';
      label.textContent=labelText;
      const input=options.multiline?document.createElement('textarea'):document.createElement('input');
      input.className='text-field';
      input.maxLength=options.maxLength||280;
      if(options.multiline) input.rows=2;
      else input.type=options.type||'text';
      if(options.min!==undefined) input.min=String(options.min);
      if(options.max!==undefined) input.max=String(options.max);
      if(options.step!==undefined) input.step=String(options.step);
      input.placeholder=options.placeholder||labelText;
      label.appendChild(input);
      container.appendChild(label);
      return input;
    };
    const running=onlineGame.status==='running';
    for(const entry of tenders) {
      const agency=agencies.find(item=>item.id===entry.agencyId);
      const province=provinceName(entry.provinceId);
      const budget=budgets.find(item=>item.agencyId===entry.agencyId);
      const supervisor=Boolean(membership&&membership.permissionSetId!=='government-observer'&&
        agency?.supervisingOfficeIds?.some(id=>heldOfficeIds.has(id)));
      const inspector=Boolean(heldOfficeIds.has(entry.inspectionOfficeId)&&
        player.id!==entry.createdByPlayerId&&player.id!==entry.award?.awardedByPlayerId);
      const reserved=fmt(entry.reservedAmount);
      const row=addPoliticalRow(procurementList,entry.title+' · '+String(entry.status).replaceAll('_',' ').toUpperCase(),
        (agency?.name||entry.agencyId)+' · '+province+' · '+fmt(entry.estimatedAmount)+' '+entry.currencyId+
        ' estimated · '+reserved+' reserved · closes '+formatWorldDate(entry.closingOn));
      addPoliticalRow(row,'SCOPE / ACCEPTANCE BASIS',
        entry.scope+' · award: lowest valid bid · independent inspection required');
      const bidList=document.createElement('div');
      bidList.className='procurement-bid-list';
      const bids=Array.isArray(entry.bids)?entry.bids:[];
      if(!bids.length) {
        const emptyBid=document.createElement('span');
        emptyBid.textContent='No supplier offers recorded.';
        bidList.appendChild(emptyBid);
      }
      for(const bid of bids) {
        const vendor=vendors.find(item=>item.id===bid.vendorId);
        const bidRow=document.createElement('div');
        bidRow.className='procurement-bid-row';
        const bidTitle=document.createElement('strong');
        bidTitle.textContent=(vendor?.name||bid.vendorId)+' · '+fmt(bid.amount)+' '+entry.currencyId;
        const bidDetail=document.createElement('span');
        bidDetail.textContent='Delivery '+fmt(bid.deliveryDays)+' day(s) · received '+
          formatWorldDate(bid.submittedOn)+' · '+bid.offerReference;
        bidRow.append(bidTitle,bidDetail);
        bidList.appendChild(bidRow);
      }
      row.appendChild(bidList);
      if(entry.award)
        addPoliticalRow(row,'CONTRACT AWARD',
          (vendors.find(item=>item.id===entry.award.vendorId)?.name||entry.award.vendorId)+
          ' · '+fmt(entry.award.amount)+' '+entry.currencyId+' · '+fmt(entry.award.deliveryDays)+' delivery day(s)');
      for(const delivery of entry.deliveries||[])
        addPoliticalRow(row,'DELIVERY '+delivery.attempt+' · '+String(delivery.status).toUpperCase(),
          delivery.evidence+(delivery.inspectionEvidence?' · inspection: '+delivery.inspectionEvidence:''));
      if(entry.payment)
        addPoliticalRow(row,'PAYMENT RECORDED',
          fmt(entry.payment.amount)+' '+entry.currencyId+' · '+formatWorldDate(entry.payment.paidOn)+
          ' · authorized by '+(onlineGame.players.find(item=>item.id===entry.payment.paidByPlayerId)?.name||'government office'));

      const controls=document.createElement('div');
      controls.className='procurement-action-row';
      if(running&&entry.status==='open'&&supervisor) {
        const eligibleVendors=vendors.filter(vendor=>vendor.status==='active'&&
          vendor.competenceIds.includes(entry.competenceId)&&
          !bids.some(bid=>bid.vendorId===vendor.id));
        const vendorSelect=document.createElement('select');
        vendorSelect.className='text-field';
        vendorSelect.setAttribute('aria-label','Registered supplier for '+entry.title);
        const supplierPlaceholder=document.createElement('option');
        supplierPlaceholder.value='';supplierPlaceholder.textContent='Select supplier';
        vendorSelect.appendChild(supplierPlaceholder);
        for(const vendor of eligibleVendors) {
          const option=document.createElement('option');
          option.value=vendor.id;option.textContent=vendor.name;
          vendorSelect.appendChild(option);
        }
        const amount=addInput(controls,'OFFER PRICE',{type:'number',min:0.01,max:entry.estimatedAmount,step:0.01});
        const deliveryDays=addInput(controls,'DELIVERY DAYS',{type:'number',min:1,max:36500});
        const reference=addInput(controls,'RECEIVED OFFER REFERENCE',{maxLength:280});
        controls.appendChild(vendorSelect);
        addControl(controls,'REGISTER RECEIVED OFFER',()=>{
          const price=Number(amount.value),days=Number(deliveryDays.value);
          if(!vendorSelect.value||!Number.isFinite(price)||price<=0||
             Math.round(price*100)!==price*100||price>entry.estimatedAmount||
             !Number.isSafeInteger(days)||days<1||days>36500||reference.value.trim().length<12) {
            showMessage('Enter a registered supplier, a valid two-decimal offer, delivery term and offer reference.',true);
            return;
          }
          sendAction({type:'administration.procurement.registerBid',stateId,
            tenderId:entry.id,vendorId:vendorSelect.value,amount:price,
            deliveryDays:days,offerReference:reference.value.trim()});
        });
      }
      if(running&&entry.status==='bids_closed'&&supervisor)
        addControl(controls,'AWARD LOWEST VALID OFFER',()=>
          sendAction({type:'administration.procurement.awardTender',stateId,tenderId:entry.id}));
      if(running&&['awarded','rectification_required'].includes(entry.status)&&supervisor) {
        const evidence=addInput(controls,'DELIVERY RECEIPT / EVIDENCE',{maxLength:280});
        addControl(controls,'REGISTER DELIVERY',()=>{
          if(evidence.value.trim().length<12) {
            showMessage('A delivery receipt and evidence record of at least 12 characters is required.',true);
            return;
          }
          sendAction({type:'administration.procurement.recordDelivery',stateId,
            tenderId:entry.id,evidence:evidence.value.trim()});
        });
      }
      if(running&&entry.status==='awaiting_inspection'&&inspector) {
        const evidence=addInput(controls,'INDEPENDENT INSPECTION EVIDENCE',{maxLength:280});
        addControl(controls,'ACCEPT DELIVERY',()=>{
          if(evidence.value.trim().length<12) {
            showMessage('Independent inspection evidence of at least 12 characters is required.',true);
            return;
          }
          sendAction({type:'administration.procurement.inspectDelivery',stateId,
            tenderId:entry.id,outcome:'accepted',evidence:evidence.value.trim()});
        });
        addControl(controls,'REJECT / RECTIFICATION',()=>{
          if(evidence.value.trim().length<12) {
            showMessage('Independent inspection evidence of at least 12 characters is required.',true);
            return;
          }
          sendAction({type:'administration.procurement.inspectDelivery',stateId,
            tenderId:entry.id,outcome:'rejected',evidence:evidence.value.trim()});
        });
      }
      if(running&&entry.status==='accepted'&&supervisor)
        addControl(controls,'AUTHORIZE CONTRACT PAYMENT',()=>
          sendAction({type:'administration.procurement.payContract',stateId,tenderId:entry.id}));
      if(running&&['open','bids_closed'].includes(entry.status)&&supervisor) {
        const reason=addInput(controls,'PUBLIC CANCELLATION REASON',{maxLength:280});
        addControl(controls,'CANCEL TENDER',()=>{
          if(reason.value.trim().length<12) {
            showMessage('A public cancellation reason of at least 12 characters is required.',true);
            return;
          }
          sendAction({type:'administration.procurement.cancelTender',stateId,
            tenderId:entry.id,evidence:reason.value.trim()});
        });
      }
      if(controls.childElementCount) row.appendChild(controls);
    }

    const history=(onlineGame.administrativeHistory||[])
      .filter(item=>item.stateId===stateId).slice().reverse().slice(0,35);
    if(!history.length) empty(historyList,'No administrative history',
      'Budget allocations, payroll, document receipts, task progress and procedural outcomes will be recorded here.');
    for(const entry of history)
      addPoliticalRow(historyList,String(entry.type||'ADMINISTRATION').replaceAll('_',' ').toUpperCase(),
        formatWorldDate(entry.worldDate)+' · '+entry.description);
  }

  function renderDemography() {
    const status=$('demography-status');
    const groupList=$('demography-group-list');
    const pyramid=$('demography-age-pyramid');
    const eventList=$('demography-event-list');
    const epidemicList=$('epidemic-status-list');
    const originSelect=$('migration-origin-group');
    const destinationSelect=$('migration-destination-group');
    const quantityInput=$('migration-quantity');
    const submit=$('migration-submit');
    if(!status || !groupList || !pyramid || !eventList || !epidemicList ||
       !originSelect || !destinationSelect || !quantityInput || !submit) return;

    for(const list of [groupList,pyramid,eventList,epidemicList]) list.replaceChildren();
    const territory=onlineGame?.territories?.find(item=>item.index===state.selected);
    const stateId=territory?.stateId;
    const groups=(onlineGame?.populationGroups || []).filter(item=>item.stateId===stateId);
    const profile=(onlineGame?.demographicProfiles || []).find(item=>item.stateId===stateId);
    const player=currentPlayer();
    const membership=membershipsFor(player).find(item=>item.stateId===stateId);
    const canMove=Boolean(onlineGame?.status==='running' && membership &&
      profile?.migrationPermissionSetIds?.includes(membership.permissionSetId));
    const formatCount=value=>Number(value||0).toLocaleString('en-US');

    originSelect.replaceChildren();
    destinationSelect.replaceChildren();
    const placeholder=(label)=>{
      const option=document.createElement('option');
      option.value='';option.textContent=label;
      return option;
    };
    originSelect.appendChild(placeholder('SELECT AN ORIGIN GROUP'));
    destinationSelect.appendChild(placeholder('SELECT A DESTINATION GROUP'));
    $('society-population').textContent=territory?formatCount(territory.population):'—';
    $('society-births').textContent=territory?formatCount(territory.demographicBirthsLastDay):'—';
    $('society-deaths').textContent=territory?formatCount(territory.demographicDeathsLastDay):'—';
    const recentMoves=(onlineGame?.migrationRecords || []).filter(item=>
      item.stateId===stateId && item.type==='internal').slice(-30);
    $('society-moves').textContent=territory?formatCount(
      recentMoves.reduce((sum,item)=>sum+Number(item.quantity||0),0)):'—';

    if(!onlineGame || !territory) {
      status.textContent='Connect to a world and select a State to inspect demographic data.';
      addPoliticalRow(groupList,'No population groups','The world has no selected State data.');
      addPoliticalRow(pyramid,'Age pyramid unavailable','No age cohorts are configured.');
      addPoliticalRow(eventList,'No demographic record','No events have been recorded.');
      addPoliticalRow(epidemicList,'No active world','Connect to a world to inspect configured public-health outbreaks.');
      quantityInput.max='1';quantityInput.value='1';quantityInput.disabled=true;
      submit.disabled=true;
      $('migration-status').textContent='Select a State in a connected world.';
      return;
    }
    if(!profile) {
      status.textContent='No cohort profile is configured for '+territory.name+
        '. The legacy settlement growth model remains active; age structure and migration are not simulated.';
      addPoliticalRow(groupList,'Age cohorts not configured',
        'The current population total is '+formatCount(territory.population)+
        '. Add a complete 0–120 age distribution in the host lobby setup before enabling migration.');
      addPoliticalRow(pyramid,'Age pyramid unavailable','No cohort data is configured for this State.');
    } else {
      status.textContent=territory.name+' · '+profile.annualBirthsPerThousand+
        ' configured births per 1,000 residents per year · mortality by configured age band. '+
        'Disease outbreaks run only from explicit scenario profiles, dates and contact links; external migration and life expectancy remain unmodelled.';
      const bands=profile.ageBands.slice().sort((a,b)=>a.minAge-b.minAge);
      const totals=bands.map(band=>({
        label:band.minAge===band.maxAge?String(band.minAge):band.minAge+'–'+band.maxAge,
        minAge:band.minAge,maxAge:band.maxAge,population:0,
        birthsPerThousand:profile.annualBirthsPerThousand,
        deathsPerThousand:band.annualDeathsPerThousand
      }));
      let ageTotal=0;
      for(const group of groups) {
        for(const cohort of group.ageCohorts || []) {
          const band=totals.find(item=>
            cohort.ageYears>=item.minAge && cohort.ageYears<=item.maxAge);
          if(band) band.population+=Number(cohort.population)||0;
          ageTotal+=Number(cohort.population)||0;
        }
      }
      const maxAgePopulation=Math.max(1,...totals.map(item=>item.population));
      for(const band of totals) {
        const row=document.createElement('div');
        row.className='demography-age-row';
        const label=document.createElement('span');
        label.textContent=band.label;
        const bar=document.createElement('div');
        bar.className='demography-age-track';
        const fill=document.createElement('span');
        fill.style.width=(band.population/maxAgePopulation*100).toFixed(2)+'%';
        bar.appendChild(fill);
        const value=document.createElement('strong');
        value.textContent=formatCount(band.population);
        value.setAttribute('aria-label',formatCount(band.population)+' residents aged '+band.label);
        row.append(label,bar,value);
        pyramid.appendChild(row);
      }
      if(!ageTotal) addPoliticalRow(pyramid,'Empty age profile','All cohort counts are zero.');
      for(const group of groups) {
        const cohortTotal=(group.ageCohorts || []).reduce((sum,item)=>sum+item.population,0);
        addPoliticalRow(groupList,group.name+' · '+formatCount(group.population),
          'Location '+group.locationId+' · '+(group.ageCohorts || []).length+
          ' age cohorts · verified cohort total '+formatCount(cohortTotal));
      }
      if(groups.length===0)
        addPoliticalRow(groupList,'No groups configured','This State requires at least one balanced population group.');
      if(groups.some(group=>group.population!==(group.ageCohorts || []).reduce((sum,item)=>sum+item.population,0)))
        addPoliticalRow(groupList,'COHORT TOTAL MISMATCH','Review the host demographic configuration before advancing.');
    }

    const diseaseNames=new Map((onlineGame.epidemicDefinitions||[]).map(item=>[item.id,item.name]));
    const outbreaks=(onlineGame.epidemicOutbreaks||[]).filter(item=>item.stateId===stateId)
      .slice().sort((a,b)=>String(b.startedOn).localeCompare(String(a.startedOn)));
    const pendingStarts=(onlineGame.epidemicStarts||[]).filter(item=>{
      const outbreak=outbreaks.find(entry=>entry.scenarioStartId===item.id);
      return !outbreak && item.startsOn>=onlineGame.worldDate &&
        (onlineGame.epidemicDefinitions||[]).some(definition=>
          definition.id===item.definitionId&&definition.stateId===stateId);
    });
    for(const outbreak of outbreaks) {
      const groupStates=(onlineGame.epidemicGroupStates||[]).filter(item=>item.outbreakId===outbreak.id);
      const count=selector=>groupStates.reduce((sum,item)=>{
        const values=item[selector]||[];
        return sum+values.reduce((inner,cohort)=>inner+Number(cohort.count||0),0);
      },0);
      const exposed=count('exposedCohorts');
      const infectious=count('infectiousCohorts');
      const recovered=groupStates.reduce((sum,item)=>sum+Number(item.recovered||0),0);
      addPoliticalRow(epidemicList,
        (diseaseNames.get(outbreak.definitionId)||outbreak.definitionId)+' · '+
          String(outbreak.status||'unknown').toUpperCase(),
        'Started '+formatWorldDate(outbreak.startedOn)+' · '+formatCount(exposed)+' exposed · '+
          formatCount(infectious)+' infectious · '+formatCount(recovered)+' recovered · '+
          formatCount(outbreak.totalDeaths)+' deaths · '+formatCount(outbreak.totalExposures)+' total exposures');
    }
    for(const start of pendingStarts)
      addPoliticalRow(epidemicList,(diseaseNames.get(start.definitionId)||start.definitionId)+' · SCHEDULED',
        formatCount(start.initialInfectious)+' initial infectious residents · starts '+
        formatWorldDate(start.startsOn)+' · source group '+start.sourceGroupId);
    if(!outbreaks.length&&!pendingStarts.length)
      addPoliticalRow(epidemicList,'No configured outbreak in '+territory.name,
        (onlineGame.epidemicDefinitions||[]).some(item=>item.stateId===stateId)
          ? 'Disease profiles are configured, but there is no dated outbreak for this State.'
          : 'No disease definition or outbreak has been configured. The simulation does not fabricate epidemics.');

    const movePermission=Boolean(profile?.migrationPermissionSetIds?.includes(membership?.permissionSetId));
    const usableGroups=groups.filter(group=>
      typeof group.locationId==='string' && group.locationId.trim() &&
      Array.isArray(group.ageCohorts) && group.ageCohorts.length &&
      Number.isSafeInteger(group.population) && group.population>0);
    const priorOrigin=originSelect.value;
    const priorDestination=destinationSelect.value;
    for(const group of usableGroups) {
      const option=document.createElement('option');
      option.value=group.id;option.textContent=group.name+' · '+formatCount(group.population);
      originSelect.appendChild(option);
    }
    if(usableGroups.some(item=>item.id===priorOrigin)) originSelect.value=priorOrigin;
    const selectedOrigin=usableGroups.find(item=>item.id===originSelect.value) || usableGroups[0] || null;
    const destinations=usableGroups.filter(item=>
      selectedOrigin && item.id!==selectedOrigin.id && item.locationId!==selectedOrigin.locationId);
    for(const group of destinations) {
      const option=document.createElement('option');
      option.value=group.id;option.textContent=group.name+' · '+formatCount(group.population);
      destinationSelect.appendChild(option);
    }
    if(destinations.some(item=>item.id===priorDestination)) destinationSelect.value=priorDestination;
    const maxMove=selectedOrigin?Math.max(1,selectedOrigin.population):1;
    quantityInput.min='1';quantityInput.max=String(maxMove);
    quantityInput.value=String(Math.min(maxMove,Math.max(1,Number(quantityInput.value)||1)));
    quantityInput.disabled=!canMove || !selectedOrigin;
    $('migration-quantity-value').textContent=formatCount(quantityInput.value);
    $('migration-quantity-maximum').textContent=formatCount(maxMove);
    const selectedDestination=destinations.find(item=>item.id===destinationSelect.value) || null;
    const valid=Boolean(canMove && selectedOrigin && selectedDestination &&
      Number.isSafeInteger(Number(quantityInput.value)) &&
      Number(quantityInput.value)>0 && Number(quantityInput.value)<=selectedOrigin.population);
    submit.disabled=!valid;
    destinationSelect.disabled=!canMove || !destinations.length;
    originSelect.disabled=!canMove || !usableGroups.length;
    if(!profile) $('migration-status').textContent='Configure a demographic profile and balanced age cohorts first.';
    else if(!movePermission) $('migration-status').textContent='Your membership does not have the configured migration permission.';
    else if(!selectedOrigin || !destinations.length) $('migration-status').textContent='At least two valid groups at different locations are required in this State.';
    else $('migration-status').textContent='Transfer is internal to '+territory.name+'. It cannot change the State population total.';
    eventList.replaceChildren();
    const events=(onlineGame.demographicEvents || []).filter(item=>item.stateId===stateId)
      .slice(-20).reverse();
    for(const item of events)
      addPoliticalRow(eventList,item.description || item.type,
        formatWorldDate(item.worldDate)+' · '+String(item.type||'').toUpperCase()+
        ' · '+formatCount(item.quantity));
    if(!events.length)
      addPoliticalRow(eventList,'No demographic events','Births, deaths and internal transfers will be recorded here once configured.');
  }

  function renderScenarioAudit() {
    const status=$('scenario-status');
    const list=$('scenario-audit-list');
    const count=$('scenario-validation-count');
    if(!status || !list || !count) return;
    list.replaceChildren();
    if(!onlineGame) {
      status.textContent='Connect to a world to inspect scenario integrity.';
      count.textContent='NOT CHECKED';
      addPoliticalRow(list,'No active scenario','Scenario checks are run against the authoritative world snapshot.');
      return;
    }
    const audit=window.NewWorldScenario?.validate?.(onlineGame);
    const recordValidation=onlineGame.worldScenario
      ? window.NewWorldScenario?.validateRecord?.(onlineGame,onlineGame.worldScenario)
      : {valid:false,errors:['SCENARIO_RECORD_MISSING']};
    if(!audit) {
      status.textContent='Scenario validator is unavailable.';
      count.textContent='UNAVAILABLE';
      addPoliticalRow(list,'Validator unavailable','Reload the game assets before starting this scenario.');
      return;
    }
    const errors=[...audit.errors];
    if(!recordValidation?.valid) errors.push(...(recordValidation?.errors || ['SCENARIO_RECORD_INVALID']));
    const warnings=[...audit.warnings];
    const descriptions={
      INITIAL_POPULATION_DISTRIBUTION_INCOMPLETE:'One or more States have no initial population.',
      NO_GOODS_CATALOG:'No approved goods catalogue is configured.',
      ECONOMY_NOT_SEEDED_FOR_EVERY_STATE:'The initial economic network does not cover every State.',
      GEOGRAPHIC_RESOURCE_DEPOSITS_NOT_CONFIGURED:'No geographically evidenced resource deposits are configured.',
      CURRENCY_METADATA_INCOMPLETE:'One or more currencies lack names, codes or minor-unit metadata.',
      POLITICAL_PROFILES_INCOMPLETE:'One or more political profiles are still pending.',
      PROVINCE_BOUNDARIES_NOT_CONFIGURED:'Province boundary geometry has not been supplied.',
      SEED_NOT_APPLIED_TO_WORLD_GENERATION:'The seed is recorded but does not yet generate the full world deterministically.',
      DEMOGRAPHIC_ECONOMIC_BALANCE_NOT_VERIFIED:'Demographic and economic balance has not passed a defined tolerance audit.',
      WATER_SOURCES_NOT_CONFIGURED:'No province-level water sources, renewable inflows or ecological reserves are configured.',
      LIVESTOCK_NOT_CONFIGURED:'No livestock sites, breeding herds, feed or animal product flows are configured.',
      FISHERIES_NOT_CONFIGURED:'No fishing grounds, seasonal closures or sustainable fish stocks are configured.',
      FORESTRY_NOT_CONFIGURED:'No mapped managed forests, timber stocks or regeneration limits are configured.',
      PUBLIC_SERVICE_NETWORK_NOT_CONFIGURED:'No local education, health, social or cultural service facilities are configured.',
      WORKPLACE_AND_LABOUR_MODEL_NOT_CONFIGURED:'No workplaces, occupations, labour pools or collective agreements are configured.',
      NO_TECHNOLOGY_CATALOG:'No technology catalogue is configured.',
      SCENARIO_FINGERPRINT_MISMATCH:'Scenario identity or initial manifest differs from its recorded fingerprint.'
    };
    status.textContent=(audit.stateCount||0)+' official States · '+
      Number(audit.totalPopulation||0).toLocaleString('en-US')+' residents · '+
      (errors.length?'structural errors detected':'structural checks passed');
    count.textContent=errors.length?errors.length+' ERRORS':
      warnings.length?warnings.length+' WARNINGS':'NO WARNINGS';
    for(const error of errors)
      addPoliticalRow(list,'ERROR · '+error,descriptions[error] || 'This scenario requirement failed validation.');
    for(const warning of warnings)
      addPoliticalRow(list,'WARNING · '+warning,descriptions[warning] || 'This scenario area remains incomplete.');
    if(!errors.length && !warnings.length)
      addPoliticalRow(list,'Scenario validation passed','No structural errors or outstanding warnings were reported.');
    if(recordValidation?.valid)
      addPoliticalRow(list,'Version record verified',
        'Scenario '+onlineGame.worldScenario.scenarioId+' / '+onlineGame.worldScenario.scenarioVersion+
        ' · fingerprint '+onlineGame.worldScenario.fingerprintAlgorithm+
        ' (non-cryptographic integrity check).');
    else
      addPoliticalRow(list,'Version record invalid or missing',
        (recordValidation?.errors || []).join(', '));
  }

  const TECHNOLOGY_DOMAINS = Object.freeze([
    {id:'all',label:'ALL DOMAINS'},
    {id:'agriculture',label:'AGRICULTURE'},
    {id:'metallurgy',label:'METALLURGY'},
    {id:'military',label:'MILITARY'},
    {id:'navigation',label:'NAVIGATION'},
    {id:'medicine',label:'MEDICINE'},
    {id:'industry',label:'INDUSTRY'},
    {id:'science',label:'SCIENCE'},
    {id:'education',label:'EDUCATION'},
    {id:'administration',label:'ADMINISTRATION'},
    {id:'energy',label:'ENERGY'},
    {id:'communication',label:'COMMUNICATION'},
    {id:'construction',label:'CONSTRUCTION'}
  ]);
  let technologyDomainFilter = 'all';
  function technologyDomainKey(value) {
    const key=String(value || '').trim().toLowerCase();
    return key==='infrastructure'?'construction':key;
  }

  function renderTechnology() {
    const technologyList = $('technology-list');
    const projectList = $('research-project-list');
    const adoptionList = $('technology-adoption-list');
    for (const list of [technologyList, projectList, adoptionList]) list.replaceChildren();
    const domainFilters=$('technology-domain-filters');
    domainFilters.replaceChildren();
    for (const domain of TECHNOLOGY_DOMAINS) {
      const button=document.createElement('button');
      button.type='button';
      button.className='technology-domain-filter' +
        (technologyDomainFilter===domain.id?' active':'');
      button.textContent=domain.label;
      button.dataset.domain=domain.id;
      button.setAttribute('aria-pressed',String(technologyDomainFilter===domain.id));
      button.addEventListener('click',()=>{
        if(technologyDomainFilter===domain.id) return;
        technologyDomainFilter=domain.id;
        renderTechnology();
      });
      domainFilters.appendChild(button);
    }
    const territory = onlineGame?.territories.find(item => item.index === state.selected);
    $('technology-setup-panel').hidden = !canConfigureScenario();
    if (!onlineGame) {
      $('technology-status').textContent = 'Connect to a multiplayer world to load technology data.';
      addPoliticalRow(technologyList, 'No technology catalog', 'Research does not unlock automatically by date.');
      addPoliticalRow(projectList, 'No research projects', 'Project progress depends on configured rules.');
      addPoliticalRow(adoptionList, 'No adoption records', 'Discovery and adoption are separate states.');
      return;
    }

    const technologies = onlineGame.technologies || [];
    const visibleTechnologies = technologies.filter(item =>
      technologyDomainFilter==='all' ||
      technologyDomainKey(item.domain)===technologyDomainFilter);
    const stateId = territory?.stateId;
    const stateUnlocks = (onlineGame.technologyUnlocks || [])
      .filter(item => item.stateId === stateId)
      .map(item => item.technologyId);
    const unlockedIds = new Set(stateUnlocks);
    const adoptedIds = new Set((onlineGame.technologyAdoptions || [])
      .filter(item => item.stateId === stateId)
      .map(item => item.technologyId));
    const stateProjects = (onlineGame.researchProjects || [])
      .filter(item => item.stateId === stateId);
    const stateInstitutions = (onlineGame.researchInstitutions || [])
      .filter(item => item.stateId === stateId);
    const stateTreasury = onlineGame.territories.find(item => item.stateId === stateId)?.treasury || 0;
    $('technology-status').textContent = technologies.length
      ? technologies.length + ' catalog entry(s) · selected State: ' +
        (territory?.name || 'none') + ' · discovery does not imply adoption.'
      : 'Technology catalog and initial knowledge are pending scenario data.';
    if (!technologies.length) {
      addPoliticalRow(technologyList, 'No technology catalog', 'No unlocks are inferred.');
    } else if (!visibleTechnologies.length) {
      addPoliticalRow(technologyList,'No configured technologies in this domain',
        'The scenario has no technology entries here. No fictional research items have been added.');
    }
    for (const technology of visibleTechnologies) {
      const prerequisites = (technology.prerequisiteTechnologyIds || [])
        .map(id => technologies.find(item => item.id === id)?.name || id);
      const project = stateProjects.find(item => item.technologyId === technology.id &&
        ['proposed', 'active', 'suspended'].includes(String(item.status).toLowerCase()));
      const institution = stateInstitutions.find(item => item.id === project?.institutionId);
      const missingPrerequisite = (technology.prerequisiteTechnologyIds || [])
        .some(id => !unlockedIds.has(id));
      const missingKnowledge = Object.keys(technology.requiredKnowledge || {})
        .some(id => !unlockedIds.has(id));
      const missingMaterials = Object.entries(technology.requiredMaterials || {})
        .some(([id, quantity]) => Number(project?.materialsReserved?.[id] || 0) < Number(quantity));
      const enoughFunding = project && institution &&
        Number(project.dailyFunding) > 0 &&
        Number(project.dailyProgress) > 0 &&
        (String(project.status).toLowerCase() === 'suspended'
          ? Number(project.fundingRemaining) >=
            Math.ceil(Math.max(0, Number(project.requiredProgress) - Number(project.progress)) /
              Math.max(1, Number(project.dailyProgress))) * Number(project.dailyFunding)
          : Number(project.budget) >= Number(project.dailyFunding) &&
            Number(project.budget) >=
              Math.ceil(Math.max(0, Number(project.requiredProgress) - Number(project.progress)) /
                Math.max(1, Number(project.dailyProgress))) * Number(project.dailyFunding) &&
            (String(institution.type).toLowerCase() === 'private'
              ? Number(institution.funding) >= Number(project.budget)
              : stateTreasury >= Number(project.budget)));
      const allocatedStaff = stateProjects.filter(item =>
        item.id !== project?.id &&
        item.institutionId === project?.institutionId &&
        String(item.status).toLowerCase() === 'active')
        .reduce((sum,item) => sum + Math.max(0,Number(item.staff)||0),0);
      const enoughStaff = project && institution &&
        Number(project.staff) > 0 &&
        allocatedStaff + Number(project.staff) <= Number(institution.staff);
      const status = adoptedIds.has(technology.id) ? 'adopted'
        : unlockedIds.has(technology.id) ? 'discovered'
          : project && String(project.status).toLowerCase() === 'active' ? 'in progress'
            : project && String(project.status).toLowerCase() === 'suspended' ? 'suspended'
              : project && !missingPrerequisite && !missingKnowledge &&
                  !missingMaterials && enoughFunding && enoughStaff ? 'researchable'
                : project ? 'blocked' : 'not configured';
      const row = addPoliticalRow(
        technologyList,
        technology.name,
        String(technology.domain) + ' · ' + status +
          ' · prerequisites: ' + (prerequisites.join(', ') || 'none') +
          (missingKnowledge ? ' · required knowledge unavailable' : '') +
          (missingMaterials ? ' · required materials not reserved' : '') +
          (project && !enoughFunding ? ' · configured funding unavailable' : '') +
          (project && !enoughStaff ? ' · configured staff unavailable' : '') +
          ' · effects: ' + ((technology.effects || []).map(item => item.effectId).join(', ') || 'not configured'));
      row.classList.add('technology-node');
      row.dataset.status=status.replace(/\s+/g,'-');
      row.dataset.domain=technologyDomainKey(technology.domain);
      row.dataset.technologyId=technology.id;
      row.dataset.prerequisites=(technology.prerequisiteTechnologyIds || []).join(',');
      const adoptedAtState = (onlineGame.technologyAdoptions || []).some(item =>
        item.stateId === stateId &&
        item.technologyId === technology.id &&
        !item.provinceId &&
        !item.sector);
      if (unlockedIds.has(technology.id) && !adoptedAtState) {
        const adoptButton = document.createElement('button');
        adoptButton.type = 'button';
        adoptButton.className = 'secondary-button';
        adoptButton.textContent = 'Adopt for State';
        const membership = membershipsFor(currentPlayer())
          .find(item => item.stateId === stateId);
        const adoptionReason=!membership
          ? 'Join this government before adopting technology.'
          : membership.permissionSetId==='government-observer'
            ? 'Observer memberships cannot adopt technology.'
            : onlineGame.status!=='running'
              ? 'Start the world before adopting technology.'
              : socket?.readyState!==WebSocket.OPEN
                ? 'Reconnect to the host before adopting technology.'
                : '';
        adoptButton.disabled=!stateId || Boolean(adoptionReason);
        adoptButton.title=adoptionReason || 'Apply this discovered technology to the whole State.';
        adoptButton.addEventListener('click', () => sendAction({
          type: 'adoptTechnology',
          stateId,
          technologyId: technology.id
        }));
        row.appendChild(adoptButton);
      }
    }

    const institutions = stateInstitutions;
    const projects = stateProjects;
    if (!institutions.length && !projects.length)
      addPoliticalRow(projectList, 'No research institutions or projects', 'Research rules and funding are not inferred.');
    for (const institution of institutions) {
      addPoliticalRow(
        projectList,
        institution.name,
        String(institution.type) + ' · ' + institution.staff + ' staff · funding ' + institution.funding,
        'Specializations: ' + ((institution.specializations || []).join(', ') || 'No specialization recorded.'));
    }
    for (const project of projects) {
      const technology = technologies.find(item => item.id === project.technologyId);
      const row = addPoliticalRow(
        projectList,
        technology?.name || project.technologyId,
        String(project.status) + ' · progress ' + project.progress + ' / ' + project.requiredProgress,
        'Started ' + formatWorldDate(project.startedOn) + ' · configured daily progress ' +
          (project.dailyProgress || 0) + ' · daily funding ' + (project.dailyFunding || 0) +
          ' · reserved materials ' +
          Object.entries(project.materialsReserved || {})
            .map(([id, amount]) => id + ': ' + amount).join(', '));
      if (['proposed', 'suspended'].includes(String(project.status).toLowerCase())) {
        const startButton = document.createElement('button');
        startButton.type = 'button';
        startButton.className = 'secondary-button';
        startButton.textContent =
          String(project.status).toLowerCase() === 'suspended'
            ? 'Resume research'
            : 'Start research';
        const projectTechnology = technologies.find(item => item.id === project.technologyId);
        const projectInstitution = institutions.find(item => item.id === project.institutionId);
        const membership = membershipsFor(currentPlayer())
          .find(item => item.stateId === stateId);
        const projectNeeds = projectTechnology?.requiredMaterials || {};
        const isResuming = String(project.status).toLowerCase() === 'suspended';
        const configuredFunding = isResuming
          ? Number(project.fundingRemaining) >=
            Math.ceil(Math.max(0, Number(project.requiredProgress) - Number(project.progress)) /
              Math.max(1, Number(project.dailyProgress))) * Number(project.dailyFunding)
          : Number(project.budget) >= Number(project.dailyFunding) &&
            Number(project.budget) >=
              Math.ceil(Number(project.requiredProgress) / Number(project.dailyProgress)) *
                Number(project.dailyFunding) &&
            (String(projectInstitution?.type).toLowerCase() === 'private'
              ? Number(projectInstitution?.funding) >= Number(project.budget)
              : stateTreasury >= Number(project.budget));
        const validProjectConfiguration = projectTechnology && projectInstitution &&
          Number(project.dailyProgress) > 0 &&
          Number(project.dailyFunding) > 0 &&
          Number(project.staff) > 0 &&
          Number(project.staff) <= Number(projectInstitution.staff) &&
          configuredFunding &&
          Object.keys(projectTechnology.requiredKnowledge || {})
            .every(id => unlockedIds.has(id)) &&
          (projectTechnology.prerequisiteTechnologyIds || [])
            .every(id => unlockedIds.has(id)) &&
          Object.entries(projectNeeds)
            .every(([id, quantity]) => Number(project.materialsReserved?.[id] || 0) >= Number(quantity)) &&
          (!isResuming || Number(project.fundingRemaining) >= Number(project.dailyFunding));
        const projectReason=!membership
          ? 'Join this government before funding research.'
          : membership.permissionSetId==='government-observer'
            ? 'Observer memberships cannot manage research.'
            : onlineGame.status!=='running'
              ? 'Start the world before starting or resuming research.'
              : socket?.readyState!==WebSocket.OPEN
                ? 'Reconnect to the host before changing research.'
                : !validProjectConfiguration
                  ? 'Project blocked: check the institution, staff, prerequisites, materials and full budget.'
                  : '';
        startButton.disabled=!stateId || Boolean(projectReason);
        startButton.title=projectReason || 'Fund this project and advance it each world day.';
        startButton.addEventListener('click', () => sendAction({
          type: 'startProject',
          stateId,
          researchProjectId: project.id
        }));
        row.appendChild(startButton);
        if (!validProjectConfiguration) {
          const restriction = document.createElement('span');
          restriction.textContent =
            'Cannot start: configure eligible staff, prerequisites, reserved materials, daily progress, and sufficient funding.';
          row.appendChild(restriction);
        }
      }
      if (!['completed', 'cancelled'].includes(String(project.status).toLowerCase())) {
        const cancelButton = document.createElement('button');
        cancelButton.type = 'button';
        cancelButton.className = 'secondary-button';
        cancelButton.textContent = 'Cancel project';
        const membership = membershipsFor(currentPlayer())
          .find(item => item.stateId === stateId);
        const cancelReason=!membership
          ? 'Join this government before cancelling research.'
          : membership.permissionSetId==='government-observer'
            ? 'Observer memberships cannot manage research.'
            : onlineGame.status!=='running'
              ? 'The world must be running to cancel research.'
              : socket?.readyState!==WebSocket.OPEN
                ? 'Reconnect to the host before changing research.'
                : '';
        cancelButton.disabled=Boolean(cancelReason);
        cancelButton.title=cancelReason || 'Cancel this project and return unused funding.';
        cancelButton.addEventListener('click', () => sendAction({
          type: 'cancelProject',
          stateId,
          researchProjectId: project.id
        }));
        row.appendChild(cancelButton);
      }
    }

    const adoptions = (onlineGame.technologyAdoptions || []).filter(item =>
      item.stateId === stateId);
    if (!adoptions.length) addPoliticalRow(adoptionList, 'No adoption records', 'No technology is assumed to be in use.');
    for (const adoption of adoptions) {
      const technology = technologies.find(item => item.id === adoption.technologyId);
      addPoliticalRow(
        adoptionList,
        technology?.name || adoption.technologyId,
        (adoption.sector || 'State-wide') + ' · ' + formatWorldDate(adoption.adoptedOn),
        adoption.cause);
    }
  }

  function canConfigureScenario() {
    return Boolean(onlineGame && !onlineGame.started &&
      onlineGame.hostPlayerId === onlineSession?.playerId);
  }

  function loadScenarioConfiguration(textareaId, fields) {
    if (!onlineGame) return;
    const configuration = {};
    for (const [requestKey, snapshotKey] of Object.entries(fields))
      configuration[requestKey] = onlineGame[snapshotKey] || [];
    $(textareaId).value = JSON.stringify(configuration, null, 2);
  }

  async function saveScenarioConfiguration(endpoint,textareaId,keys,label) {
    if (!canConfigureScenario()) {
      showMessage('Only the host can configure this technical scenario before the world starts.',true);
      return;
    }
    let configuration;
    try {
      configuration = JSON.parse($(textareaId).value);
    } catch (error) {
      showMessage(label + ' scenario JSON is invalid: ' +
        (error instanceof Error ? error.message : 'parse error'),true);
      return;
    }
    if (!configuration || keys.some(key => !Array.isArray(configuration[key]))) {
      showMessage(label + ' scenario requires: ' + keys.join(', ') + '.',true);
      return;
    }
    try {
      const game = await window.NewWorldMultiplayer.admin('configure',{
        kind:endpoint,configuration
      });
      if (game && typeof game === 'object') applySnapshot(game);
      showMessage(label + ' scenario saved to the host device and shared with the room.');
    } catch (error) {
      showServerError(error);
    }
  }


  function loadEconomyConfiguration() {
    if (!onlineGame) return;
    const configuration = {
      goods: onlineGame.goods || [],
      productionRecipes: onlineGame.productionRecipes || [],
      companies: (onlineGame.companies || []).map(company => ({
        id: company.id,
        stateId: company.stateId,
        currencyId: company.currencyId,
        cashBalances: company.cashBalances || {},
        name: company.name,
        sector: company.sector,
        inventory: company.inventory || {},
        facilities: (company.facilities || []).map(facility => ({
          id: facility.id,
          recipeId: facility.recipeId,
          batchesPerCycle: facility.batchesPerCycle,
          progressDays: facility.progressDays
        }))
      })),
      markets: onlineGame.markets || [],
      tradeRoutes: onlineGame.tradeRoutes || [],
      populationGroups: onlineGame.populationGroups || []
    };
    $('economy-config').value = JSON.stringify(configuration, null, 2);
  }

  async function saveEconomyConfiguration() {
    if (!onlineSession || !onlineGame || onlineGame.started ||
        onlineGame.hostPlayerId !== onlineSession.playerId) {
      showMessage('Only the host can configure the technical economy before the world starts.',true);
      return;
    }
    let configuration;
    try {
      configuration = JSON.parse($('economy-config').value);
    } catch (error) {
      showMessage('Economic scenario JSON is invalid: ' +
        (error instanceof Error ? error.message : 'parse error'),true);
      return;
    }
    const collections = [
      'goods','productionRecipes','companies','markets','tradeRoutes','populationGroups'
    ];
    if (!configuration || collections.some(key => !Array.isArray(configuration[key]))) {
      showMessage('The scenario must include goods, productionRecipes, companies, markets, tradeRoutes, and populationGroups arrays.',true);
      return;
    }
    try {
      const game = await window.NewWorldMultiplayer.admin('configure',{
        kind:'economy',configuration
      });
      if (game && typeof game === 'object') applySnapshot(game);
      $('economy-config').value = '';
      showMessage('Economic scenario saved to the host device and shared with the room.');
    } catch (error) {
      showServerError(error);
    }
  }


  function renderFinancialLedger() {
    const list = $('transaction-list');
    list.replaceChildren();
    const companyList = $('company-transaction-list');
    companyList.replaceChildren();
    if (!onlineGame) {
      $('state-currency').textContent = 'Connect to a multiplayer world to load currency and transaction data.';
      addPoliticalRow(list, 'No financial records', 'Connect to a shared world to inspect public treasury activity.');
      addPoliticalRow(companyList, 'No company records', 'Company sales and market transactions appear after the world starts.');
      return;
    }

    const territory = onlineGame.territories.find(item => item.index === state.selected);
    const currency = onlineGame.currencies?.find(item => item.stateId === territory?.stateId);
    $('state-currency').textContent = currency?.name && currency?.code
      ? currency.name + ' (' + currency.code + ') · ' + currency.minorUnitScale + ' decimal place(s)'
      : 'State currency identity is recorded; its official name, code, and precision remain undefined.';
    const transactions = (onlineGame.financialTransactions || [])
      .filter(item => item.stateId === territory?.stateId)
      .slice()
      .reverse();
    if (!transactions.length) {
      addPoliticalRow(list, 'No transactions recorded', 'The State has no financial activity in the available history.');
    } else {
      for (const transaction of transactions) {
        const sign = transaction.amount > 0 ? '+' : transaction.amount < 0 ? '−' : '';
        addPoliticalRow(
          list,
          String(transaction.type).replaceAll(/([A-Z])/g, ' $1').toUpperCase() +
            ' · ' + formatWorldDate(transaction.worldDate),
          transaction.description + ' · ' + sign + money(Math.abs(transaction.amount)) +
            ' · balance ' + money(transaction.balanceAfter));
      }
    }

    const companyTransactions = (onlineGame.companyFinancialTransactions || [])
      .filter(item => item.stateId === territory?.stateId)
      .slice()
      .reverse();
    if (!companyTransactions.length) {
      addPoliticalRow(companyList, 'No company sales recorded', 'Market revenue appears after a configured market clears.');
    } else {
      for (const transaction of companyTransactions) {
        const company = onlineGame.companies?.find(item => item.id === transaction.companyId);
        const currency = onlineGame.currencies?.find(item => item.id === transaction.currencyId);
        addPoliticalRow(
          companyList,
          company?.name || 'Company',
          formatWorldDate(transaction.worldDate) + ' · ' + transaction.quantity + ' ' +
            transaction.goodId + ' at ' + money(transaction.unitPrice) + ' · +' +
            money(transaction.amount) + ' ' + (currency?.code || currency?.name || 'currency units') +
            (transaction.tradeRouteId ? ' · trade route ' + transaction.tradeRouteId.slice(0, 8) : ' · domestic sale'));
      }
    }
  }

  function renderFinance() {
    const ids=['finance-currency-summary','finance-exchange-list','finance-bank-list',
      'finance-debt-list','finance-tax-list','finance-index-list'];
    const lists=ids.map(id=>$(id));
    if(lists.some(item=>!item)) return;
    lists.forEach(list=>list.replaceChildren());
    const status=$('finance-status');
    const bankSelect=$('finance-bank-select');
    const debtSelect=$('finance-debt-select');
    const fill=(select,items,labelFor,valueFor) => {
      const previous=select.value;
      select.replaceChildren();
      for(const item of items) {
        const option=document.createElement('option');
        option.value=valueFor(item);
        option.textContent=labelFor(item);
        select.appendChild(option);
      }
      if(items.some(item=>valueFor(item)===previous)) select.value=previous;
    };
    const player=currentPlayer();
    const territory=onlineGame?.territories?.find(item=>item.index===state.selected);
    const stateId=territory?.stateId;
    const currency=onlineGame?.currencies?.find(item=>item.stateId===stateId);
    const membership=player&&membershipsFor(player).find(item=>item.stateId===stateId);
    const political=onlineGame?.politicalSystems?.find(item=>item.stateId===stateId);
    const hasOffice=(political?.offices||[]).some(office=>
      ['treasurer','chief-executive'].includes(office.id)&&office.holderPlayerId===player?.id);
    const canManage=Boolean(onlineGame?.started&&onlineGame.status==='running'&&membership&&
      membership.permissionSetId!=='government-observer'&&hasOffice&&socket?.readyState===WebSocket.OPEN);
    const formatCurrency=(value,id=currency?.id)=>{
      const meta=onlineGame?.currencies?.find(item=>item.id===id);
      return money(value)+' '+(meta?.code||meta?.name||'currency units');
    };
    if(!onlineGame||!territory) {
      status.textContent='Connect to a multiplayer world to inspect financial institutions and State accounts.';
      addPoliticalRow(lists[0],'No currency account','State currencies are defined before the world starts.');
      for(const [index,title] of ['No exchange rates','No financial banks','No public debt','No tax assessments','No price index'].entries())
        addPoliticalRow(lists[index+1],title,'Financial scenario data has not been loaded.');
      fill(bankSelect,[]);fill(debtSelect,[]);
      $('finance-issue-debt').disabled=true;$('finance-repay-debt').disabled=true;
      $('finance-setup-panel').hidden=true;
      return;
    }
    const banks=(onlineGame.financialBanks||[]).filter(item=>
      item.stateId===stateId&&item.currencyId===currency?.id);
    const debts=(onlineGame.publicDebtIssues||[]).filter(item=>item.stateId===stateId);
    const activeDebts=debts.filter(item=>['active','defaulted'].includes(item.status));
    const taxes=(onlineGame.taxAssessments||[]).filter(item=>item.stateId===stateId)
      .slice().sort((a,b)=>b.worldDate.localeCompare(a.worldDate)).slice(0,30);
    const indices=(onlineGame.priceIndexHistory||[]).filter(item=>item.stateId===stateId)
      .slice().sort((a,b)=>b.worldDate.localeCompare(a.worldDate));
    const exchangeRates=(onlineGame.exchangeRates||[]).filter(item=>
      item.baseCurrencyId===currency?.id||item.quoteCurrencyId===currency?.id)
      .slice().sort((a,b)=>b.effectiveOn.localeCompare(a.effectiveOn));
    const outstanding=activeDebts.reduce((sum,item)=>
      sum+Number(item.principalOutstanding||0)+Number(item.interestAccrued||0),0);
    const activeTaxRules=(onlineGame.taxRules||[]).filter(rule=>
      rule.stateId===stateId&&rule.effectiveOn<=onlineGame.worldDate&&
      (!rule.expiresOn||rule.expiresOn>=onlineGame.worldDate));
    const latestIndexByConfig=new Map();
    for(const item of indices)
      if(!latestIndexByConfig.has(item.configId)) latestIndexByConfig.set(item.configId,item);
    status.textContent=currency?.name&&currency?.code
      ? 'Account: '+currency.name+' ('+currency.code+') · '+currency.minorUnitScale+
        ' decimal place(s). Public borrowing requires the appointed Treasurer or Chief Executive.'
      : 'Currency identity is incomplete. Host must configure a name, unique code and decimal scale before financial operations.';
    addPoliticalRow(lists[0],formatCurrency(territory.treasury),
      (currency?.name||'Undefined State currency')+' · '+(currency?.code||'no code')+
      ' · treasury balance · '+formatCurrency(outstanding)+' outstanding public debt · '+
      activeTaxRules.length+' active daily tax rule(s)');
    if(!exchangeRates.length) addPoliticalRow(lists[1],'No explicit exchange quotes',
      'Currency conversion is unavailable. The engine never infers reverse or missing rates.');
    for(const rate of exchangeRates) {
      const base=onlineGame.currencies?.find(item=>item.id===rate.baseCurrencyId);
      const quote=onlineGame.currencies?.find(item=>item.id===rate.quoteCurrencyId);
      addPoliticalRow(lists[1],(base?.code||rate.baseCurrencyId)+' → '+(quote?.code||rate.quoteCurrencyId)+
        ' · '+rate.rate,
        'Effective '+formatWorldDate(rate.effectiveOn)+
        (rate.expiresOn?' · expires '+formatWorldDate(rate.expiresOn):' · no configured expiry')+
        ' · '+rate.method+' · source: '+rate.source);
    }
    if(!banks.length) addPoliticalRow(lists[2],'No NPC banks in this State currency',
      'Bank capital, cash, reserves and credit limits must be explicitly scenario-configured.');
    for(const bank of banks) addPoliticalRow(lists[2],bank.name+' · '+String(bank.status).toUpperCase(),
      'Cash '+formatCurrency(bank.cashBalance,bank.currencyId)+' · reserve '+
      formatCurrency(bank.minimumReserve,bank.currencyId)+' · lending limit '+
      formatCurrency(bank.loanLimit,bank.currencyId)+' · risk appetite '+bank.riskAppetitePercent+'%');
    if(!debts.length) addPoliticalRow(lists[3],'No public debt issues',
      'No State loan or bond is created automatically.');
    for(const issue of debts.slice().sort((a,b)=>b.issuedOn.localeCompare(a.issuedOn))) {
      addPoliticalRow(lists[3],issue.id.slice(0,12)+' · '+String(issue.status).toUpperCase(),
        'Creditor '+(onlineGame.financialBanks||[]).find(item=>item.id===issue.bankId)?.name+
        ' · principal '+formatCurrency(issue.principalOutstanding,issue.currencyId)+
        ' · accrued interest '+formatCurrency(issue.interestAccrued,issue.currencyId)+
        ' · '+(issue.annualInterestBasisPoints/100)+'% annual · maturity '+formatWorldDate(issue.maturityOn));
    }
    if(!taxes.length) addPoliticalRow(lists[4],'No tax assessments',
      'Daily company-turnover taxes are recorded only after configured sales and a valid rule.');
    for(const item of taxes) {
      const company=onlineGame.companies?.find(entry=>entry.id===item.companyId);
      const rule=(onlineGame.taxRules||[]).find(entry=>entry.id===item.taxRuleId);
      addPoliticalRow(lists[4],(company?.name||item.companyId)+' · '+String(item.status).replaceAll('_',' ').toUpperCase(),
        (rule?.name||item.taxRuleId)+' · '+formatWorldDate(item.worldDate)+
        ' · turnover '+formatCurrency(item.turnover,item.currencyId)+
        ' · due '+formatCurrency(item.amountDue,item.currencyId)+
        ' · paid '+formatCurrency(item.amountPaid,item.currencyId)+
        ' · arrears '+formatCurrency(item.arrearsAfter,item.currencyId));
    }
    if(!latestIndexByConfig.size) addPoliticalRow(lists[5],'No measured price index',
      'A weighted market basket with explicit base prices and 10,000 basis-point weights is required.');
    for(const item of latestIndexByConfig.values())
      addPoliticalRow(lists[5],item.name+' · '+item.indexValue.toFixed(4),
        'Base '+formatWorldDate(item.baseDate)+' = 100 · observed '+formatWorldDate(item.worldDate)+
        (item.changeSincePreviousPercent===null?' · initial observation':
          ' · daily change '+(item.changeSincePreviousPercent>=0?'+':'')+
          item.changeSincePreviousPercent.toFixed(3)+'%')+
        ' · '+item.itemCount+' configured goods');
    fill(bankSelect,banks,bank=>bank.name+' · cash '+formatCurrency(bank.cashBalance,bank.currencyId),bank=>bank.id);
    fill(debtSelect,activeDebts,issue=>issue.id.slice(0,10)+' · due '+
      formatCurrency(Number(issue.principalOutstanding||0)+Number(issue.interestAccrued||0),issue.currencyId),
      issue=>issue.id);
    $('finance-issue-debt').disabled=!canManage||!banks.length;
    $('finance-repay-debt').disabled=!canManage||!activeDebts.length;
    $('finance-issue-debt').title=canManage?'Issue debt from the selected State-currency bank.':
      'An appointed Treasurer or Chief Executive must be connected in a running world.';
    $('finance-repay-debt').title=canManage?'Repay principal and accrued interest from the State treasury.':
      'An appointed Treasurer or Chief Executive must be connected in a running world.';
    $('finance-setup-panel').hidden=Boolean(onlineGame.started||onlineGame.hostPlayerId!==onlineSession?.playerId);
  }

  function addPoliticalRow(container, title, detail) {
    const row = document.createElement('div');
    row.className = 'political-row';
    const heading = document.createElement('strong');
    heading.textContent = title;
    const description = document.createElement('span');
    description.textContent = detail;
    row.append(heading, description);
    container.appendChild(row);
    return row;
  }

  function activeLawPoliciesForSelectedState() {
    const territory = onlineGame?.territories.find(item => item.index === state.selected);
    const system = onlineGame?.politicalSystems?.find(item => item.stateId === territory?.stateId);
    return new Map((system?.policies || []).map(item => [item.policyId,Number(item.value)]));
  }

  function updateLawDraft(activePolicyValues = activeLawPoliciesForSelectedState()) {
    const activePolicyIds = new Set(activePolicyValues.keys());
    const slider = $('law-strength');
    if (!slider) return;
    const available = Object.keys(LAW_POLICIES).filter(id => !activePolicyIds.has(id));
    if (activePolicyIds.has(selectedLawPolicyId) && available.length)
      selectedLawPolicyId = available[0];
    const policy = LAW_POLICIES[selectedLawPolicyId];
    const value = Math.max(policy.min, Math.min(policy.max,
      Number(lawPolicyStrengths[selectedLawPolicyId]) || policy.default));
    lawPolicyStrengths[selectedLawPolicyId] = value;
    slider.min = String(policy.min);
    slider.max = String(policy.max);
    slider.value = String(value);
    $('law-strength-value').textContent = value + '%';
    slider.style.setProperty('--range-progress',
      ((value-policy.min)/Math.max(1,policy.max-policy.min)*100)+'%');
    $('law-strength-min').textContent = policy.min + '%';
    $('law-strength-max').textContent = policy.max + '%';
    $('law-effect-summary').textContent = policy.effectText(value);
    document.querySelectorAll('.law-policy-card').forEach(button => {
      const policyId = button.dataset.policyId;
      const selected = policyId === selectedLawPolicyId;
      button.classList.toggle('selected', selected);
      button.disabled = activePolicyIds.has(policyId);
      button.setAttribute('aria-pressed', String(selected));
      const cardValue = button.querySelector('.law-card-value');
      if (cardValue && LAW_POLICIES[policyId]) {
        const enactedValue = activePolicyValues.get(policyId);
        cardValue.textContent = activePolicyIds.has(policyId) && Number.isFinite(enactedValue)
          ? Math.round(enactedValue*100) + '%'
          : lawPolicyStrengths[policyId] + '%';
      }
      if (activePolicyIds.has(policyId))
        button.title = 'This policy has already been enacted in the selected State.';
      else
        button.removeAttribute('title');
    });
    $('propose-law').querySelector('span').textContent = '→';
    $('propose-law').firstChild.textContent = 'PROPOSE ' + policy.title.toUpperCase() + ' ';
  }

  function updateBudgetReadout() {
    const slider = $('budget-amount');
    const amount = Number(slider?.value) || 0;
    if (slider) {
      const minimum = Number(slider.min) || 0;
      const maximum = Number(slider.max) || 10000;
      slider.style.setProperty('--range-progress',
        ((amount-minimum)/Math.max(1,maximum-minimum)*100)+'%');
    }
    if ($('budget-amount-value')) $('budget-amount-value').textContent = money(amount);
  }

  function renderGovernment() {
    const territory = onlineGame?.territories.find(item => item.index === state.selected);
    const system = onlineGame?.politicalSystems
      ?.find(item => item.stateId === territory?.stateId);
    const summary = $('government-summary');
    const institutions = $('institution-list');
    const competencies = $('competence-list');
    const representation = $('representation-list');
    const oversight = $('oversight-list');
    const parties = $('party-list');
    const laws = $('law-list');
    const policies = $('policy-list');
    const decisions = $('decision-list');
    for (const list of [summary, institutions, competencies, representation, oversight, parties, laws, policies, decisions])
      list.replaceChildren();

    $('government-title').textContent = territory?.name || 'Government';
    if (!onlineGame || !territory || !system) {
      $('government-status').textContent =
        'Connect to a multiplayer world to load authoritative constitutional data.';
      $('propose-law').disabled = true;
      $('approve-budget').disabled = true;
      $('budget-amount').disabled = true;
      document.querySelectorAll('[data-budget-adjust]').forEach(button => button.disabled = true);
      $('law-restriction').textContent = 'Law-making requires an explicitly configured Constitution and permitted government membership.';
      $('budget-restriction').textContent = 'Budget changes require an explicitly configured constitutional competence.';
      updateLawDraft(new Map());
      addPoliticalRow(summary, 'No political data', 'No authoritative State political system is available.');
      addPoliticalRow(competencies,'No constitutional competencies','Connect to a world to inspect configured powers and limits.');
      addPoliticalRow(representation,'No parliamentary data','No chamber, seat allocation or election is assumed.');
      addPoliticalRow(oversight,'No oversight procedures','Opposition rights, censure and inquiries require configured constitutional rules.');
      addPoliticalRow(policies,'No active public policies','Connect to a world to inspect enacted policy effects.');
      return;
    }

    const constitution = system.constitution;
    $('government-status').textContent = system.configurationPending
      ? 'Political configuration is incomplete; powers are available only where constitutional procedures are explicitly configured.'
      : 'Political powers and procedures are governed by this State’s configured constitution.';
    const permissionName = id => ({
      'government-member':'Government member',
      'government-council':'Council member',
      'government-executive':'Executive member',
      'government-observer':'Observer'
    })[id] || id;
    const competenceRules=Array.isArray(constitution?.competenceRules)
      ? constitution.competenceRules : [];
    if (!competenceRules.length) {
      addPoliticalRow(competencies,'No powers configured','This Constitution has no executable competence rules.');
    } else {
      for (const rule of competenceRules) {
        const institutionName=system.institutions.find(item=>item.id===rule.institutionId)?.name || 'Institution not assigned';
        const proposers=(rule.proposerPermissionSetIds || []).map(permissionName);
        const voters=(rule.voterPermissionSetIds || []).map(permissionName);
        const procedure=rule.approvalRequired
          ? 'Approval required · minimum votes: ' + (Number(rule.minimumVotes)||1) + ' · threshold: ' +
            (Number(rule.approvalThresholdPercent)||50) + '% of ' +
            String(rule.approvalThresholdBasis || 'configured basis').replace(/([A-Z])/g,' $1').toLowerCase()
          : 'Direct authority · no additional vote configured';
        addPoliticalRow(competencies,
          String(rule.competence || 'Unlabelled competence').replace(/([A-Z])/g,' $1').toUpperCase(),
          'Institution: ' + institutionName + ' · Proposers: ' + (proposers.join(', ') || 'none') +
            (rule.approvalRequired ? ' · Voters: ' + (voters.join(', ') || 'none') : '') +
            ' · ' + procedure + ' · legal basis: ' + (rule.legalBasis || 'not recorded'));
      }
    }
    const chambers=Array.isArray(system.parliament?.chambers)?system.parliament.chambers:[];
    const elections=Array.isArray(system.elections)?system.elections:[];
    if (chambers.length) {
      for (const chamber of chambers)
        addPoliticalRow(representation,chamber.name || chamber.id,
          'Seats: ' + (Number.isFinite(Number(chamber.seats))?Number(chamber.seats):'not configured') +
          ' · voting rule: ' + (chamber.votingRule || 'not configured'));
    } else {
      addPoliticalRow(representation,'No parliamentary chambers configured',
        'No chamber count, seat allocation or voting system is assumed.');
    }
    if (elections.length) {
      for (const election of elections)
        addPoliticalRow(representation,election.name || election.id,
          'Status: ' + (election.status || 'not recorded') + ' · system: ' +
          (election.system || 'not configured') + ' · scheduled: ' +
          (election.scheduledOn ? formatWorldDate(election.scheduledOn) : 'not scheduled'));
    } else {
      addPoliticalRow(representation,'No election configured',
        'Suffrage, eligibility, constituencies, election system and calendar remain undefined.');
    }
    const oppositionRights=Array.isArray(system.oppositionRights)?system.oppositionRights:[];
    const committees=Array.isArray(system.committees)?system.committees:[];
    const censureMotions=Array.isArray(system.censureMotions)?system.censureMotions:[];
    const investigations=Array.isArray(system.investigations)?system.investigations:[];
    if (!oppositionRights.length && !committees.length && !censureMotions.length && !investigations.length) {
      addPoliticalRow(oversight,'Oversight not configured',
        'Opposition debate, fiscal scrutiny, censure, committees and investigations have no approved rules yet.');
    } else {
      for (const right of oppositionRights)
        addPoliticalRow(oversight,right.name || right.id,
          right.description || 'Opposition right configured by this Constitution.');
      for (const committee of committees)
        addPoliticalRow(oversight,committee.name || committee.id,
          'Committee · ' + (committee.status || 'configured'));
      for (const motion of censureMotions)
        addPoliticalRow(oversight,motion.title || motion.id,
          'Censure motion · ' + (motion.status || 'pending'));
      for (const inquiry of investigations)
        addPoliticalRow(oversight,inquiry.title || inquiry.id,
          'Investigation · ' + (inquiry.status || 'configured'));
    }
    addPoliticalRow(summary, 'REGIME', system.regime?.name || 'Pending definition');
    addPoliticalRow(summary, 'CONSTITUTION',
      constitution ? 'Version ' + constitution.version + ' · effective ' + formatWorldDate(constitution.effectiveFrom) : 'Pending definition');
    if (system.government) {
      const stability = system.stability === null || system.stability === undefined
        ? 'Not configured'
        : system.stability + '/100';
      addPoliticalRow(summary, 'GOVERNMENT',
        (system.government.program || 'No program recorded') +
        ' · budget ' + money(system.government.budget) +
        ' · legitimacy ' + system.government.legitimacy + '/100 · stability ' + stability);
    } else {
      addPoliticalRow(summary, 'GOVERNMENT', 'No government composition is defined.');
    }

    const player = currentPlayer();
    const membership = membershipsFor(player).find(item => item.stateId === system.stateId);
    const lawRule = constitution?.competenceRules
      ?.find(rule => rule.competence === 'proposeLaw');
    const budgetRule = constitution?.competenceRules
      ?.find(rule => rule.competence === 'approveBudget');
    const holdsBudgetOffice = (system.offices || []).some(office =>
      ['treasurer','chief-executive'].includes(office.id) &&
      office.holderPlayerId === player?.id);
    const canApproveBudget = onlineGame.status === 'running' &&
      socket?.readyState === WebSocket.OPEN &&
      system.government &&
      membership &&
      budgetRule?.proposerPermissionSetIds?.includes(membership.permissionSetId) &&
      holdsBudgetOffice;
    const budgetInput = $('budget-amount');
    const currentBudget = Number(system.government?.budget) || 0;
    const budgetMaximum = Math.min(2147483647,
      Math.max(10000,Math.ceil(Math.max(currentBudget,10000)/5000)*5000));
    budgetInput.max = String(budgetMaximum);
    budgetInput.step = String(Math.max(1,Math.round(budgetMaximum/1000)));
    if (system.government && document.activeElement !== budgetInput)
      budgetInput.value = String(Math.min(currentBudget,budgetMaximum));
    $('budget-range-maximum').textContent = money(budgetMaximum);
    $('budget-current-value').textContent = money(currentBudget);
    updateBudgetReadout();
    budgetInput.disabled = !canApproveBudget;
    document.querySelectorAll('[data-budget-adjust]').forEach(button => {
      button.disabled = !canApproveBudget;
    });
    $('approve-budget').disabled = !canApproveBudget;
    const budgetRestrictionReason=!membership
      ? 'Join this State government before changing its budget.'
      : onlineGame.status!=='running'
        ? 'Start the world before changing the budget.'
        : socket?.readyState!==WebSocket.OPEN
          ? 'Reconnect to the host before changing the budget.'
          : !budgetRule?.proposerPermissionSetIds?.includes(membership.permissionSetId)
            ? 'Your government role is not authorised to approve budgets.'
            : !holdsBudgetOffice
              ? 'The State Treasurer or Chief Executive must approve this budget.'
              : '';
    $('budget-restriction').textContent = canApproveBudget
      ? 'Authority: ' + budgetRule.legalBasis + (budgetRule.approvalRequired
        ? '. The configured institution must approve this budget plan.'
        : '. This configured procedure applies the budget plan directly.')
      : budgetRestrictionReason;

    const appointmentRule = constitution?.competenceRules
      ?.find(rule => rule.competence === 'appointOffice');
    const isChiefExecutive = (system.offices || []).some(office =>
      office.id === 'chief-executive' && office.holderPlayerId === player?.id);
    const canAppointOffice = onlineGame.status === 'running' &&
      socket?.readyState === WebSocket.OPEN &&
      membership &&
      appointmentRule?.proposerPermissionSetIds?.includes(membership.permissionSetId) &&
      isChiefExecutive;
    const eligibleAppointees = onlineGame.players.filter(candidate =>
      membershipsFor(candidate).some(item => item.stateId === system.stateId));

    if (system.institutions.length) {
      for (const institution of system.institutions) {
        const officeDetails = (system.offices || [])
          .filter(office => office.institutionId === institution.id)
          .map(office => {
            const holder = onlineGame.players.find(player => player.id === office.holderPlayerId);
            return office.name + ': ' + (holder?.name || 'vacant');
          }).join(' · ');
        const row = addPoliticalRow(
          institutions,
          institution.name + ' · ' + String(institution.branch).toUpperCase(),
          officeDetails || 'No offices are configured.');
        if (canAppointOffice && institution.id === appointmentRule.institutionId) {
          for (const office of (system.offices || []).filter(item =>
            item.institutionId === institution.id)) {
            const select = document.createElement('select');
            select.className = 'text-field appointment-select';
            select.setAttribute('aria-label', 'Appointee for ' + office.name);
            const placeholder = document.createElement('option');
            placeholder.value = '';
            placeholder.textContent = 'Select appointee for ' + office.name;
            select.appendChild(placeholder);
            for (const candidate of eligibleAppointees) {
              const option = document.createElement('option');
              option.value = candidate.id;
              option.textContent = candidate.name;
              select.appendChild(option);
            }
            const appointButton = document.createElement('button');
            appointButton.type = 'button';
            appointButton.textContent = 'APPOINT';
            appointButton.disabled = eligibleAppointees.length === 0;
            select.addEventListener('change', () => {
              appointButton.disabled = !select.value;
            });
            appointButton.addEventListener('click', () => {
              if (!select.value) return;
              sendAction({
                type: 'appointOffice',
                stateId: system.stateId,
                officeId: office.id,
                appointeePlayerId: select.value
              });
            });
            row.append(select, appointButton);
          }
        }
      }
    } else {
      addPoliticalRow(institutions, 'No institutions defined', 'Institutional design remains pending.');
    }

    if (system.parties.length) {
      for (const party of system.parties) {
        addPoliticalRow(parties, party.name,
          party.seats + ' seats · ' + (party.program || 'No program recorded'));
      }
    } else {
      addPoliticalRow(parties, 'No parties defined', 'No party structure is assumed.');
    }

    if (system.laws?.length) {
      for (const law of [...system.laws].reverse()) {
        const status = String(law.status).replaceAll(/([A-Z])/g, ' $1').toUpperCase();
        const effectiveDate = law.effectiveFrom
          ? ' · effective ' + formatWorldDate(law.effectiveFrom)
          : '';
        addPoliticalRow(laws, law.title + ' · ' + status,
          law.text + ' · ' + law.legalBasis + effectiveDate);
      }
    } else {
      addPoliticalRow(laws, 'No legislation recorded', 'Only proposals completing the configured constitutional procedure enter into force.');
    }

    const activePolicies = system.policies || [];
    if (activePolicies.length) {
      for (const policy of activePolicies) {
        const effect = policy.effectId === 'construction_discount'
          ? Math.round(Number(policy.value)*100) + '% lower construction costs'
          : policy.effectId === 'recruitment_discount'
            ? Math.round(Number(policy.value)*100) + '% lower recruitment costs'
            : policy.effectId === 'population_growth_bonus'
              ? Math.round(Number(policy.value)*100) + '% faster population growth'
              : 'No executable effect configured';
        addPoliticalRow(policies,policy.name || policy.policyId,
          effect + ' · enacted ' + formatWorldDate(policy.enactedOn));
      }
    } else {
      addPoliticalRow(policies,'No active public policies',
        'Approved bills appear here and apply their effects to the selected State.');
    }

    if (system.decisions.length) {
      for (const decision of [...system.decisions].reverse()) {
        const decisionRule = constitution?.competenceRules
          ?.find(rule => rule.competence === decision.competence);
        const row = addPoliticalRow(
          decisions,
          decision.title + ' · ' + String(decision.status).replaceAll(/([A-Z])/g, ' $1').toUpperCase(),
          decision.text + ' · ' + decision.votes.length + ' vote(s) · ' + decision.legalBasis);
        const canVote = onlineGame.status === 'running' &&
          socket?.readyState === WebSocket.OPEN &&
          decisionRule?.approvalRequired &&
          decision.status === 'pendingApproval' &&
          membership &&
          decisionRule?.voterPermissionSetIds?.includes(membership.permissionSetId) &&
          !decision.votes.some(vote => vote.playerId === onlineSession.playerId);
        if (canVote) {
          for (const [choice, label] of [['approve', 'APPROVE'], ['reject', 'REJECT']]) {
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = label;
            button.addEventListener('click', () => sendAction({
              type: 'voteDecision',
              stateId: system.stateId,
              decisionId: decision.id,
              voteChoice: choice
            }));
            row.appendChild(button);
          }
        }
      }
    } else {
      addPoliticalRow(decisions, 'No pending decisions', 'This State has no recorded legislative decisions.');
    }

    const canProposeLaw = onlineGame.status === 'running' &&
      socket?.readyState === WebSocket.OPEN &&
      membership &&
      lawRule?.proposerPermissionSetIds?.includes(membership.permissionSetId);
    $('propose-law').disabled = !canProposeLaw;
    const lawRestrictionReason=!membership
      ? 'Join this State government before proposing laws.'
      : onlineGame.status!=='running'
        ? 'Start the world before submitting a law.'
        : socket?.readyState!==WebSocket.OPEN
          ? 'Reconnect to the host before submitting a law.'
          : !lawRule?.proposerPermissionSetIds?.includes(membership.permissionSetId)
            ? 'Your government role is not authorised to propose laws.'
            : 'The Constitution has not configured law-making authority.';
    const activePolicyValues = new Map(activePolicies.map(item =>
      [item.policyId,Number(item.value)]));
    const activePolicyIds = new Set(activePolicyValues.keys());
    updateLawDraft(activePolicyValues);
    const allPoliciesEnacted = Object.keys(LAW_POLICIES).every(id => activePolicyIds.has(id));
    $('propose-law').disabled = !canProposeLaw || allPoliciesEnacted;
    $('law-restriction').textContent = allPoliciesEnacted
      ? 'All available public policies have already been enacted in this State.'
      : canProposeLaw
        ? 'Authority: ' + lawRule.legalBasis + (lawRule.approvalRequired
          ? '. Approval requires ' + lawRule.minimumVotes + ' vote(s) and ' +
            lawRule.approvalThresholdPercent + '% of ' +
            String(lawRule.approvalThresholdBasis).replaceAll(/([A-Z])/g, ' $1').toLowerCase() + '.'
          : '. This configured procedure does not require approval.')
        : lawRestrictionReason;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
  }

  function selectState(index, notify = true, refreshSettlement = true) {
    if (index < 0 || index >= 16) return;
    state.selected = index;
    mapDetailRenderer?.setRegion(index, state.states[index]?.name);
    const territory = state.states[index];
    const territoryView = onlineGame?.territories.find(item => item.index === index);
    if (territoryView) {
      state.governmentFinance = territoryView;
      state.treasury = Number(territoryView.treasury) || 0;
      state.buildings = normalizeBuildings(territoryView.buildings || {});
      mapDetailRenderer?.setBuildings(state.buildings);
    }
    if (selectedProvinceId &&
        onlineGame?.provinces.find(item => item.id === selectedProvinceId)?.sovereignStateId !==
          territoryView?.stateId)
      selectedProvinceId = null;
    const owner = onlineGame?.players.find(player => player.id === territoryView?.ownerPlayerId);
    const governmentMembers = governmentMembersFor(territoryView);
    const mine = state.owned.includes(index);
    const isGovernmentMember = membershipsFor(currentPlayer())
      .some(membership => membership.stateId === territoryView?.stateId);
    $('state-name').textContent = territory.name;
    if (mine) {
      $('state-description').textContent = 'This territory is administered by your government.';
    } else if (isGovernmentMember) {
      const fellowMembers = governmentMembers
        .filter(player => player.id !== onlineSession.playerId)
        .map(player => player.name);
      $('state-description').textContent = fellowMembers.length
        ? 'You share this government with ' + fellowMembers.join(', ') + '.'
        : 'You are currently the only member of this government.';
    } else if (governmentMembers.length) {
      $('state-description').textContent = 'Government members: ' +
        governmentMembers.map(player => player.name).join(', ') + '.';
    } else if (owner) {
      $('state-description').textContent = 'This territory is administered by ' + owner.name + '.';
    } else if (isOnline()) {
      $('state-description').textContent = onlineGame?.started
        ? 'Unclaimed frontier. Secure this region with your founding treasury and expand your territory.'
        : 'Unclaimed frontier. Your group begins with one small founding settlement.';
    } else {
      $('state-description').textContent = 'Create or join a multiplayer world to inspect its shared state.';
    }
    $('state-pop').textContent = onlineGame ? territory.pop.toLocaleString('en-US') : '—';
    $('state-prosperity').textContent = onlineGame ? territory.prosperity + '/100' : '—';
    $('state-revenue').textContent = onlineGame
      ? money(Math.round(territory.pop / 1500 * (territory.prosperity / 100)))
      : '—';
    $('state-infra').textContent = onlineGame ? 'LEVEL ' + territory.infra : '—';
    $('state-owner').textContent = mine
      ? 'YOUR ADMINISTRATION'
      : governmentMembers.length
        ? governmentMembers.map(player => player.name.toUpperCase()).join(' · ')
        : owner ? owner.name.toUpperCase() : onlineGame ? 'UNCLAIMED' : 'NOT CONNECTED';

    const claimButton = $('claim-btn');
    const fundingSource = claimFundingSource();
    const claimTreasury = Number(fundingSource?.territory.treasury ?? 0);
    if (mine || isGovernmentMember) {
      claimButton.disabled = true;
      claimButton.innerHTML = isGovernmentMember ? 'YOUR GOVERNMENT <span>✓</span>' : 'ALREADY ADMINISTERED <span>✓</span>';
    } else if (!isOnline()) {
      claimButton.disabled = true;
      claimButton.textContent = 'MULTIPLAYER WORLD REQUIRED';
    } else if (owner) {
      claimButton.disabled = true;
      claimButton.textContent = 'ADMINISTERED BY ' + owner.name.toUpperCase();
    } else if (governmentMembers.length) {
      claimButton.disabled = true;
      claimButton.textContent = 'GOVERNMENT ALREADY ESTABLISHED';
    } else if (isOnline() && !onlineGame?.started) {
      claimButton.disabled = true;
      claimButton.textContent = 'WORLD NOT STARTED';
    } else if (isOnline() && membershipsFor(currentPlayer()).length === 0) {
      claimButton.disabled = true;
      claimButton.textContent = 'STATE ASSIGNMENT REQUIRED';
    } else if (!fundingSource || claimTreasury < 450) {
      claimButton.disabled = true;
      claimButton.innerHTML = 'FOUNDING TREASURY BELOW <span>¤ 450</span>';
    } else {
      const claimReason=!onlineGame?.started
        ? 'The host must start the world before claiming.'
        : socket?.readyState!==WebSocket.OPEN
          ? 'Reconnect to the host before claiming.'
          : '';
      claimButton.disabled=Boolean(claimReason);
      claimButton.title=claimReason || 'Spend ¤450 from an administered State treasury to found this region.';
      claimButton.innerHTML = claimReason
        ? (onlineGame?.started?'RECONNECT TO CLAIM':'WORLD NOT STARTED')
        : 'CLAIM THIS REGION <span>¤ 450</span>';
    }
    if (notify) toast(territory.name.toUpperCase() + ' SELECTED');
    highlightMap(index);
    if (refreshSettlement) {
      renderFinancialSummary();
      renderCity();
      renderOptions();
      renderObjectives();
      renderEconomy();
      renderGovernment();
      renderTerritory();
      renderMilitary();
      renderTechnology();
      renderDiplomacy();
    }
  }

  function selectProvince(province) {
    const territory = onlineGame?.territories.find(item =>
      item.stateId === province.sovereignStateId);
    if (!territory) return;
    selectState(territory.index, false);
    selectedProvinceId = province.id;
    renderTerritory();
    highlightMap(territory.index);
    document.querySelector('.tab[data-view="territory"]')?.click();
  }

  function activateView(viewName) {
    document.querySelectorAll('.tab').forEach(tab => {
      const active = tab.dataset.view === viewName;
      tab.classList.toggle('active',active);
      tab.setAttribute('aria-selected',String(active));
    });
    document.querySelectorAll('.view').forEach(view => view.classList.remove('active'));
    const view = $(viewName + '-view');
    if (view) view.classList.add('active');
  }

  function focusInboxReference(viewName,referenceId) {
    const view=$(viewName+'-view');
    if(!view) return false;
    const reference=typeof referenceId==='string'?referenceId.trim():'';
    if(reference) {
      const candidates=view.querySelectorAll('[data-record-id],[data-id],[id]');
      for(const candidate of candidates) {
        if(candidate.dataset.recordId===reference ||
           candidate.dataset.id===reference || candidate.id===reference) {
          if(!candidate.hasAttribute('tabindex')) candidate.setAttribute('tabindex','-1');
          candidate.scrollIntoView?.({behavior:'smooth',block:'center'});
          candidate.focus({preventScroll:true});
          return true;
        }
      }
    }
    const heading=view.querySelector('h1,h2,h3,[role="heading"]');
    if(heading) {
      if(!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex','-1');
      heading.focus({preventScroll:true});
      return false;
    }
    view.setAttribute('tabindex','-1');
    view.focus({preventScroll:true});
    return false;
  }

  function prepareBuilderMap() {
    if (!mapDetailRenderer?.active) {
      zoom = 0.05;
      pan = {x:0,y:0};
      $('map-stage').style.transform = 'translate3d(0,0,0) scale(1)';
      mapDetailRenderer?.setCamera(zoom,true);
      mapDetailRenderer?.centerOnPlot(selectedPlot);
    }
  }

  function enterCityMap(index) {
    if (!Number.isInteger(index) || index < 0 || index >= 16) return;
    selectState(index,false,false);
    hideMapTooltip();
    prepareBuilderMap();
    activateView('city');
    renderFinancialSummary();
    renderCity();
    renderOptions();
    buildMenu?.open();
  }

  function renderMapArmyMarkers(svgDocument) {
    const svgNS='http://www.w3.org/2000/svg';
    const root=svgDocument.documentElement;
    if(!root || !onlineGame) return;
    let layer=svgDocument.getElementById('new-world-army-markers');
    if(!layer) {
      layer=svgDocument.createElementNS(svgNS,'g');
      layer.setAttribute('id','new-world-army-markers');
      layer.setAttribute('pointer-events','none');
      layer.setAttribute('aria-hidden','true');
      root.appendChild(layer);
    }
    layer.replaceChildren();
    const provinces=new Map((onlineGame.provinces || []).map(item=>[item.id,item]));
    const forces=new Map();
    for(const unit of onlineGame.militaryUnits || []) {
      if(Number(unit.personnel)<=0) continue;
      const province=provinces.get(unit.provinceId);
      if(!province) continue;
      const entry=forces.get(province.stateId) || {units:0,personnel:0};
      entry.units++;
      entry.personnel+=Number(unit.personnel)||0;
      forces.set(province.stateId,entry);
    }
    const occupied=new Set((onlineGame.occupations || [])
      .filter(item=>item.status==='active')
      .map(item=>provinces.get(item.provinceId)?.stateId)
      .filter(Boolean));
    for(const [stateId,force] of forces) {
      const index=onlineGame.territories.findIndex(item=>item.stateId===stateId);
      if(index<0) continue;
      const territoryPath=svgDocument.getElementById('state'+(index+1));
      if(!territoryPath) continue;
      let bounds;
      try{bounds=territoryPath.getBBox()}catch{continue}
      if(!bounds.width || !bounds.height) continue;
      const x=bounds.x+bounds.width*.73;
      const y=bounds.y+bounds.height*.30;
      const activeOccupation=occupied.has(stateId);
      const marker=svgDocument.createElementNS(svgNS,'g');
      marker.setAttribute('class','new-world-army-marker');
      marker.setAttribute('transform','translate('+x+' '+y+')');
      const halo=svgDocument.createElementNS(svgNS,'circle');
      halo.setAttribute('r','19');
      halo.setAttribute('fill',activeOccupation?'#7c201e':'#172d27');
      halo.setAttribute('stroke',activeOccupation?'#ffb4a7':'#d7e5c1');
      halo.setAttribute('stroke-width','2.5');
      const count=svgDocument.createElementNS(svgNS,'text');
      count.setAttribute('text-anchor','middle');
      count.setAttribute('dominant-baseline','central');
      count.setAttribute('font-family','Arial,sans-serif');
      count.setAttribute('font-size','13');
      count.setAttribute('font-weight','800');
      count.setAttribute('fill','#ffffff');
      count.textContent=String(force.units);
      const personnel=svgDocument.createElementNS(svgNS,'text');
      personnel.setAttribute('text-anchor','middle');
      personnel.setAttribute('y','31');
      personnel.setAttribute('font-family','Arial,sans-serif');
      personnel.setAttribute('font-size','10');
      personnel.setAttribute('font-weight','700');
      personnel.setAttribute('fill','#ffffff');
      personnel.setAttribute('stroke','#17221d');
      personnel.setAttribute('stroke-width','3');
      personnel.setAttribute('paint-order','stroke');
      personnel.textContent=force.personnel.toLocaleString('en-US');
      marker.append(halo,count,personnel);
      layer.appendChild(marker);
    }
  }

  function highlightMap(selectedIndex) {
    const object = $('world-map');
    try {
      const document = object.contentDocument;
      if (!document) return;
      const mix = (from, to, amount) => {
        const a = from.match(/[0-9a-f]{2}/gi).map(value => parseInt(value,16));
        const b = to.match(/[0-9a-f]{2}/gi).map(value => parseInt(value,16));
        return '#' + a.map((value,index) =>
          Math.round(value + (b[index] - value) * amount).toString(16).padStart(2,'0')
        ).join('');
      };
      const terrainPalette = [
        '#9b9d82','#a69b7b','#8e9d8b','#a99a82',
        '#9f9279','#8c9b8a','#a69b82','#91a092',
        '#a3977e','#8fa08e','#aa987b','#929d8c',
        '#9d987f','#8a9c8c','#a69a82','#8f9d91'
      ];
      const populationColor = index => {
        const population = onlineGame?.territories[index]?.population || state.states[index]?.pop || 0;
        const ratio = Math.max(0,Math.min(1,
          (Math.log10(Math.max(1,population)) - 4.2) / (5.15 - 4.2)));
        return mix('#b7aa8a','#657f91',ratio);
      };
      const stateColors = [
        '#8d9f75','#9c866c','#748e9c','#b08d72',
        '#8d819e','#a19b70','#6f978b','#b07e78',
        '#7e91a8','#a28b68','#829a83','#a37c9a',
        '#9a9a70','#7c8f9e','#aa8a76','#81977a'
      ];
      const territoryIndexForState = stateId =>
        onlineGame?.territories.find(item => item.stateId === stateId)?.index ?? -1;
      const stateColor = stateId => {
        const onlineIndex = territoryIndexForState(stateId);
        const catalogIndex = territoryGeometry?.byStateKey(stateId)?.index ?? -1;
        const index = onlineIndex >= 0 ? onlineIndex : catalogIndex;
        return index >= 0 ? stateColors[index % stateColors.length] : '#7c8177';
      };
      for (let index = 0; index < 16; index++) {
        const geometry = territoryGeometry?.byIndex(index);
        const path = document.getElementById(geometry?.svgElementId || 'state' + (index + 1));
        if (!path) continue;
        const territory = onlineGame?.territories[index];
        const owner = onlineGame?.players.find(player => player.id === territory?.ownerPlayerId);
        const governmentMembers = governmentMembersFor(territory);
        const isGovernmentMember = membershipsFor(currentPlayer())
          .some(membership => membership.stateId === territory?.stateId);
        const isMine = state.owned.includes(index) || isGovernmentMember;
        const province = onlineGame?.provinces.find(item => item.stateId === territory?.stateId);
        const activeOccupation = province && (onlineGame?.occupations || []).find(item =>
          item.provinceId === province.id && item.status === 'active');
        const latestControl = province && (onlineGame?.territorialControls || [])
          .filter(item => item.provinceId === province.id).at(-1);
        const sovereignStateId = province?.sovereignStateId || territory?.stateId ||
          territoryGeometry?.byIndex(index)?.stateKey;
        const effectiveControlStateId = activeOccupation?.occupyingStateId ||
          latestControl?.stateId || sovereignStateId;
        let fill = '';
        if (activeMapMode === 'political') {
          fill = isMine ? '#829b70' : governmentMembers.length || owner ? '#b88570' : '';
        } else if (activeMapMode === 'economy') {
          const prosperity = territory?.prosperity ?? state.states[index]?.prosperity ?? 50;
          fill = mix('#a66e64','#91a878',Math.max(0,Math.min(1,prosperity / 100)));
        } else if (activeMapMode === 'population') {
          fill = populationColor(index);
        } else if (activeMapMode === 'terrain') {
          fill = terrainPalette[index];
        } else if (activeMapMode === 'sovereignty') {
          fill = stateColor(sovereignStateId);
        } else if (activeMapMode === 'control') {
          fill = stateColor(effectiveControlStateId);
        }
        path.style.cursor = 'pointer';
        path.style.pointerEvents = 'all';
        path.style.fill = fill;
        path.style.stroke = activeOccupation ? '#c47b55' : index === selectedIndex ? '#f4dfac' :
          governmentMembers.length || owner ? '#e7c99c' : '#657061';
        path.style.strokeWidth = activeOccupation ? '3.5' : index === selectedIndex ? '4' : '2';
        path.style.filter = index === selectedIndex ? 'brightness(1.13)' : 'none';
      }
      for (const province of onlineGame?.provinces || []) {
        const element = document.getElementById(province.svgElementId);
        if (!element) continue;
        const selected = province.id === selectedProvinceId;
        element.style.cursor = 'pointer';
        element.style.pointerEvents = 'all';
        element.style.stroke = selected ? '#f3d37a' : '';
        element.style.strokeWidth = selected ? '3' : '';
      }
      renderMapArmyMarkers(document);
    } catch (error) {
      console.warn('[new-world] Could not update map territory styles:', error);
    }
    document.querySelectorAll('.fallback-state').forEach((button, index) =>
      button.classList.toggle('selected', index === selectedIndex));
  }

  function renderFallback() {
    const fallback = $('map-fallback');
    fallback.hidden = false;
    fallback.innerHTML = names.map((name, index) =>
      '<button class="fallback-state" data-state="' + index + '">' +
      String(index + 1).padStart(2, '0') + ' / ' + escapeHtml(name) + '</button>').join('');
    fallback.querySelectorAll('[data-state]').forEach(button => {
      const index = Number(button.dataset.state);
      button.addEventListener('click', () => selectState(index));
      button.addEventListener('dblclick', () => enterCityMap(index));
    });
  }

  function territoryAtPoint(svgDocument, event) {
    return svgDocument.elementsFromPoint(event.clientX, event.clientY)
      .find(element => territoryGeometry?.bySvgElementId(element.id)) || null;
  }

  function territoryAtEvent(svgDocument, event) {
    const label = event.target.closest?.('[id^="stateLabel"]');
    const labelMatch = label?.id.match(/^stateLabel([1-9]|1[0-6])$/);
    if (labelMatch) return svgDocument.getElementById('state' + labelMatch[1]);
    const target = event.target.closest?.('[id^="state"]');
    if (target && territoryGeometry?.bySvgElementId(target.id)) return target;
    return territoryAtPoint(svgDocument, event);
  }

  function provinceAtEvent(event) {
    for (let element = event.target; element?.id; element = element.parentElement) {
      const province = onlineGame?.provinces.find(item => item.svgElementId === element.id);
      if (province) return province;
    }
    return null;
  }

  const territoryGeometry = window.NewWorldTerritoryGeometry || null;
  const mapModeNames = {
    political:'ADMINISTRATION',
    economy:'ECONOMY',
    population:'POPULATION',
    terrain:'TERRAIN',
    sovereignty:'SOVEREIGNTY',
    control:'EFFECTIVE CONTROL'
  };
  document.querySelectorAll('.map-mode').forEach(button => {
    button.addEventListener('click', () => {
      const mode = button.dataset.mapMode;
      if (!Object.hasOwn(mapModeNames,mode)) return;
      activeMapMode = mode;
      document.querySelectorAll('.map-mode').forEach(item =>
        item.classList.toggle('active',item === button));
      $('map-layer-label').textContent = mapModeNames[mode];
      highlightMap(state.selected);
    });
  });

  const map = $('world-map');
  const viewport = $('map-viewport');
  const mapTooltip = $('map-tooltip');
  mapDetailRenderer = typeof window.NewWorldMapRenderer === 'function'
    ? new window.NewWorldMapRenderer({
      canvas: $('map-detail-canvas'),
      viewport,
      manifestUrl: './assets/sprite-manifest.json',
      onPlotSelected: index => {
        if (buildMenu?.placing) {
          buildMenu.placeAt(index);
          return;
        }
        selectedPlot = index;
        renderCity();
        buildMenu?.updateContext();
      }
    })
    : null;
  mapDetailRenderer?.setRegion(state.selected, state.states[state.selected]?.name);
  mapDetailRenderer?.setSelectedPlot(selectedPlot);
  mapDetailRenderer?.setBuildings(state.buildings);

  buildMenu = typeof window.NewWorldBuildMenu === 'function'
    ? new window.NewWorldBuildMenu({
      mapRenderer:mapDetailRenderer,
      buildingTypes,
      getContext:() => {
        const territory = onlineGame?.territories.find(item => item.index === state.selected);
        const membership = membershipsFor(currentPlayer()).find(item => item.stateId === territory?.stateId);
        const buildReason=!onlineGame
          ? 'CREATE OR JOIN A MULTIPLAYER WORLD FIRST.'
          : !territory
            ? 'SELECT A TERRITORY ON THE MAP.'
            : !membership
              ? 'THIS REGION IS NOT ADMINISTERED BY YOUR GOVERNMENT. CLAIM IT FIRST.'
              : membership.permissionSetId==='government-observer'
                ? 'YOUR GOVERNMENT ROLE DOES NOT ALLOW CONSTRUCTION.'
                : !onlineGame.started
                  ? 'THE HOST MUST START THE WORLD BEFORE CONSTRUCTION.'
                  : onlineGame.status!=='running'
                    ? 'THE WORLD IS PAUSED OR COMPLETED.'
                    : !window.NewWorldMultiplayer?.isConnected()
                      ? 'RECONNECT TO THE HOST BEFORE CONSTRUCTION.'
                      : 'READY TO BUILD.';
        return {
          regionName:territory?.name || state.states[state.selected]?.name || 'No settlement',
          treasury:Number(state.treasury) || 0,
          canBuild:buildReason==='READY TO BUILD.',
          buildReason
        };
      },
      canPlace:(item,index) => {
        const territory = onlineGame?.territories.find(entry => entry.index === state.selected);
        const membership = membershipsFor(currentPlayer()).find(entry => entry.stateId === territory?.stateId);
        if (!onlineGame?.started || onlineGame.status !== 'running' || !territory || !membership ||
            membership.permissionSetId === 'government-observer' ||
            !window.NewWorldMultiplayer?.isConnected() || state.buildings[index] ||
            state.treasury < Number(item?.cost || 0)) return false;
        const cell = mapDetailRenderer?.getPlotCell(index);
        if (!cell) return false;
        const terrain = mapDetailRenderer?.terrainAt(cell.row,cell.col);
        return Boolean(terrain && terrain.type !== 'water');
      },
      onPlace:(item,index,rotation) => {
        const territory = onlineGame?.territories.find(entry => entry.index === state.selected);
        if (!territory || !item) return false;
        return sendAction({
          type:'build',
          stateId:territory.stateId,
          plotIndex:index,
          buildingId:item.buildingId,
          spriteKey:item.spriteKey || '',
          rotation,
          variantName:item.name,
          catalogItemId:item.id
        });
      },
      onSelectedPlot:index => {
        selectedPlot = index;
        mapDetailRenderer?.setSelectedPlot(index);
        renderCity();
      }
    })
    : null;

  function hideMapTooltip() {
    mapTooltip.hidden = true;
    hoveredState = null;
  }

  let mapInitialized = false;
  function initializeMap() {
    if (mapInitialized) return;
    const svgDocument = map.contentDocument;
    if (!svgDocument || !territoryGeometry) return;
    const svgRoot = svgDocument.documentElement;
    if (svgRoot) {
      svgRoot.style.background = '#142b30';
      svgRoot.style.backgroundColor = '#142b30';
      svgRoot.setAttribute('preserveAspectRatio','xMidYMid slice');
    }
    const svgIds = Array.from(svgDocument.querySelectorAll('[id]'),element => element.id);
    const validation = territoryGeometry.validateCatalog(svgIds);
    if (!validation.valid) {
      console.error('[new-world] Territory geometry registry validation failed:',validation.errors);
      renderFallback();
      return;
    }
    for (const mapping of territoryGeometry.states) {
      const path = svgDocument.getElementById(mapping.svgElementId);
      path.style.pointerEvents = 'all';
      path.setAttribute('aria-label', mapping.stateName);
      let title = path.querySelector('title');
      if (!title) {
        title = svgDocument.createElementNS('http://www.w3.org/2000/svg', 'title');
        path.prepend(title);
      }
      title.textContent = mapping.stateName;
    }
    mapInitialized = true;
    map.dataset.loaded = 'true';
    $('map-fallback').hidden = true;
    let pendingProvinceClick = null;
    svgDocument.addEventListener('click', event => {
      const province = provinceAtEvent(event);
      if (province) {
        clearTimeout(pendingProvinceClick);
        pendingProvinceClick = setTimeout(() => {
          pendingProvinceClick = null;
          selectProvince(province);
        }, 240);
        return;
      }
      clearTimeout(pendingProvinceClick);
      pendingProvinceClick = null;
      const path = territoryAtEvent(svgDocument, event);
      const mapping = path && territoryGeometry.bySvgElementId(path.id);
      if (mapping) selectState(mapping.index);
    });
    svgDocument.addEventListener('dblclick', event => {
      const province = provinceAtEvent(event);
      const territory = province
        ? onlineGame?.territories.find(item => item.stateId === province.sovereignStateId)
        : null;
      const path = territoryAtEvent(svgDocument, event);
      const mapping = path && territoryGeometry.bySvgElementId(path.id);
      const index = territory?.index ?? mapping?.index ?? null;
      if (index !== null) {
        clearTimeout(pendingProvinceClick);
        pendingProvinceClick = null;
        event.preventDefault();
        enterCityMap(index);
      }
    });
    svgDocument.addEventListener('pointerdown', event => {
      if (event.button === 0 && !event.shiftKey && territoryAtEvent(svgDocument, event)) return;
      drag = {x: event.clientX - pan.x, y: event.clientY - pan.y};
      svgDocument.documentElement.setPointerCapture(event.pointerId);
    });
    svgDocument.addEventListener('pointermove', event => {
      if (drag) {
        pan = {x: event.clientX - drag.x, y: event.clientY - drag.y};
        applyMapTransform();
        hideMapTooltip();
        return;
      }
      const province = provinceAtEvent(event);
      const path = territoryAtEvent(svgDocument, event);
      if (!path && !province) {
        hideMapTooltip();
        return;
      }
      const stateIndex = path
        ? territoryGeometry.bySvgElementId(path.id)?.index
        : onlineGame?.territories.find(item => item.stateId === province.sovereignStateId)?.index;
      if (hoveredState !== path) {
        if (hoveredState) hoveredState.style.filter =
          Number(hoveredState.id.slice(5)) - 1 === state.selected ? 'brightness(1.18)' : 'none';
        hoveredState = path;
        if (path) path.style.filter = 'brightness(1.15)';
      }
      const mapRect = map.getBoundingClientRect();
      const svgRect = svgDocument.documentElement.getBoundingClientRect();
      const viewRect = viewport.getBoundingClientRect();
      mapTooltip.textContent = province
        ? province.name + ' · ' + Number(province.population).toLocaleString('en-US') + ' POP'
        : names[stateIndex] + ' · ' + state.states[stateIndex].pop.toLocaleString('en-US') + ' POP';
      mapTooltip.style.left = (mapRect.left - viewRect.left + event.clientX * mapRect.width / svgRect.width) + 'px';
      mapTooltip.style.top = (mapRect.top - viewRect.top + event.clientY * mapRect.height / svgRect.height) + 'px';
      mapTooltip.hidden = false;
    });
    svgDocument.addEventListener('pointerleave', hideMapTooltip);
    svgDocument.addEventListener('pointerup', () => { drag = null; });
    svgDocument.addEventListener('pointercancel', () => { drag = null; });
    svgDocument.addEventListener('wheel', event => {
      event.preventDefault();
      setZoom(zoom * Math.exp(-event.deltaY * 0.00115), event.clientX, event.clientY);
    }, {passive: false});
    highlightMap(state.selected);
  }
  map.addEventListener('load', initializeMap);
  map.addEventListener('error', renderFallback);
  initializeMap();
  requestAnimationFrame(initializeMap);
  setTimeout(() => {
    initializeMap();
    if (map.dataset.loaded !== 'true') renderFallback();
  }, 1800);

  function describeBuilding(building) {
    if (Number(building.daysRemaining) > 0)
      return 'UNDER CONSTRUCTION · ' + building.daysRemaining + ' world day(s) remaining.';
    const details = [];
    if (building.housingCapacity) details.push('Housing for ' + building.housingCapacity.toLocaleString('en-US'));
    if (building.foodCapacity) details.push('Food for ' + building.foodCapacity.toLocaleString('en-US'));
    if (building.waterCapacity) details.push('Water for ' + building.waterCapacity.toLocaleString('en-US'));
    if (building.healthCapacity) details.push('Healthcare for ' + building.healthCapacity.toLocaleString('en-US'));
    if (building.educationCapacity) details.push('Education for ' + building.educationCapacity.toLocaleString('en-US'));
    if (building.jobSlots) details.push(building.jobSlots + ' jobs');
    details.push(money(building.income || 0) + ' monthly income');
    details.push(money(building.upkeep || 0) + ' monthly upkeep');
    return details.join(' · ');
  }

  function renderSettlement() {
    const territory = onlineGame?.territories.find(item => item.index === state.selected);
    const population = Math.max(0, Number(territory?.population) || 0);
    const capacity = Math.min(Number(territory?.housingCapacity) || 0,
      Number(territory?.foodCapacity) || 0, Number(territory?.waterCapacity) || 0);
    const available = Math.max(0, capacity - population);
    $('settlement-residents').textContent = onlineGame ? population.toLocaleString('en-US') : '—';
    $('settlement-capacity').textContent = onlineGame ? available.toLocaleString('en-US') : '—';
    const buildings = Math.max(0, Number(territory?.buildingCount) || 0);
    const construction = Math.min(buildings, Math.max(0, Number(territory?.constructionCount) || 0));
    $('settlement-buildings').textContent = onlineGame
      ? Math.max(0, buildings - construction).toLocaleString('en-US') : '—';
    $('settlement-construction').textContent = onlineGame
      ? construction.toLocaleString('en-US') : '—';
    $('settlement-growth').textContent = onlineGame
      ? (Number(territory.populationGrowthLastDay) > 0 ? '+' : '') + (Number(territory.populationGrowthLastDay) || 0).toLocaleString('en-US')
      : '—';
    $('settlement-employment').textContent = onlineGame
      ? Number(territory.availableJobs || 0).toLocaleString('en-US') + ' / ' +
        Number(territory.workingAgePopulation || 0).toLocaleString('en-US')
      : '—';
    const services = [
      ['HOUSING', territory?.housingCapacity, population],
      ['FOOD', territory?.foodCapacity, population],
      ['WATER', territory?.waterCapacity, population],
      ['JOBS', territory?.jobCapacity, territory?.workingAgePopulation],
      ['HEALTH', territory?.healthCapacity, population],
      ['EDUCATION', territory?.educationCapacity, population]
    ];
    $('settlement-services').innerHTML = services.map(([name, rawCapacity, rawNeed]) => {
      const supply = Math.max(0, Number(rawCapacity) || 0);
      const need = Math.max(0, Number(rawNeed) || 0);
      const coverage = need === 0 ? 100 : Math.min(100, supply / need * 100);
      const shortfall = Math.max(0, need - supply);
      return '<div class="service-row"><div><span>' + name + '</span><strong>' +
        (onlineGame ? supply.toLocaleString('en-US') + ' / ' + need.toLocaleString('en-US') : '—') +
        '</strong></div><div class="service-track"><i style="width:' + coverage.toFixed(1) + '%"></i></div>' +
        (onlineGame && shortfall > 0 ? '<small>SHORTAGE ' + shortfall.toLocaleString('en-US') + '</small>' : '') + '</div>';
    }).join('');
    $('settlement-status').textContent = !onlineGame
      ? 'Connect to a multiplayer world to simulate residents and services.'
      : available > 0
        ? 'Room for growth: housing, food and water must all have spare capacity.'
        : 'Growth is constrained. Expand housing, food and water capacity to attract residents.';
  }

  function renderCity() {
    const territory = onlineGame?.territories.find(item => item.index === state.selected);
    $('city-title').textContent = territory?.name || state.states[state.selected]?.name || 'Territory settlement';
    const cell = mapDetailRenderer?.getPlotCell(selectedPlot);
    $('selected-plot-label').textContent = cell
      ? 'X ' + (cell.col + 1).toLocaleString('en-US') + ' / Y ' + (cell.row + 1).toLocaleString('en-US')
      : 'NO PLOT SELECTED';
    $('build-budget-side').textContent = onlineGame ? money(state.treasury) : '—';
    renderSettlement();
    mapDetailRenderer?.setBuildings(state.buildings);
    mapDetailRenderer?.setSelectedPlot(selectedPlot);
    buildMenu?.updateContext();
  }

  function renderOptions() {
    buildMenu?.updateContext();
  }

  function storeSession(session) {
    onlineSession = session;
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    } catch (error) {
      console.error('[new-world] Could not persist the multiplayer session:', error);
      showMessage('This browser could not save your reconnection token. Keep this tab open.', true);
    }
  }

  function showServerError(error) {
    console.error('[new-world] Multiplayer request failed:', error);
    const message = error instanceof Error ? error.message : 'The multiplayer request failed.';
    $('server-status').textContent = 'Multiplayer connection error.';
    $('server-status').classList.add('error');
    showMessage(message, true);
    toast('MULTIPLAYER ERROR');
  }

  function playerName() {
    const name = $('player-name').value.trim();
    if (name.length < 2 || name.length > 24 || /[\u0000-\u001f\u007f]/.test(name))
      throw new Error('Player name must be 2–24 characters.');
    localStorage.setItem(NAME_KEY, name);
    return name;
  }

  function multiplayerHandlers() {
    return {
      playerName:$('player-name').value.trim(),
      onSession:session => {
        if (session) storeSession({...session,playerName:$('player-name').value.trim()});
      },
      onSnapshot:game => {
        if (!game) return;
        socket = {readyState:WebSocket.OPEN};
        applySnapshot(game);
        replayPendingOrders();
        $('server-status').textContent = window.NewWorldMultiplayer.isHost()
          ? 'This device is hosting the authoritative world.'
          : 'Connected to the host device.';
        $('server-status').classList.remove('error');
      },
      onMaintenance:maintenance => {
        const notice=$('technical-maintenance-status');
        if(notice) {
          notice.hidden=!maintenance?.active;
          notice.textContent=maintenance?.active
            ? 'TECHNICAL MAINTENANCE · '+maintenance.reason
            : '';
          notice.dataset.active=maintenance?.active?'true':'false';
        }
        const controlStatus=$('technical-maintenance-control-status');
        if(controlStatus) controlStatus.textContent=maintenance?.active
          ? 'Active since '+new Date(maintenance.changedAt).toLocaleString()+' · daily cycles and the clock are held.'
          : 'Maintenance is inactive. The ordinary world clock follows the multiplayer rules.';
        renderMultiplayer();
      },
      onStatus:status => {
        if (status === 'ready' || status === 'connected') {
          socket = {readyState:WebSocket.OPEN};
          $('server-status').textContent = status === 'ready'
            ? 'Host active · this device owns the world.'
            : 'Relay connected · waiting for the host.';
          $('server-status').classList.remove('error');
          renderMultiplayer();
          return;
        }
        socket = null;
        sentOrderIds.clear();
        $('server-status').textContent = status || 'Disconnected from the relay.';
        if (/offline|failed|error|could not|reconnecting|connecting/i.test(status || ''))
          $('server-status').classList.add('error');
        renderMultiplayer();
      },
      onOrderResult:result => {
        if (!result) return;
        const pending=getPendingOrders().find(item=>item.orderId===result.id);
        const description=pending?describeOrder(pending):'Game action';
        if (result.id) removePendingOrder(result.id);
        if (result.accepted) {
          if(result.code==='ORDER_SCHEDULED') {
            const scheduledDate=pending?.targetWorldDate||'the selected date';
            showMessage(description+' — scheduled for '+formatWorldDate(scheduledDate)+
              '. The host will revalidate permissions and world conditions when that day arrives.');
            toast('FUTURE ORDER SCHEDULED');
          } else if(pending?.type==='cancelScheduledOrder') {
            showMessage('Scheduled order cancelled by the host.');
            toast('SCHEDULE CANCELLED');
          } else {
            showMessage(description+' — confirmed by the host.');
          }
          if(pending?.type==='build'&&result.code!=='ORDER_SCHEDULED') {
            buildMenu?.setStatus('BUILD CONFIRMED BY HOST · THE STRUCTURE IS NOW IN YOUR SETTLEMENT.');
            toast('BUILDING CONFIRMED');
          }
        } else {
          const reason=orderErrorMessage(result.code) || result.error || 'The host rejected the order.';
          showMessage(description+' — '+reason,true);
          if(pending?.type==='build')
            buildMenu?.setStatus('BUILD REJECTED · '+reason.toUpperCase());
        }
        replayPendingOrders();
      },
      onPlayerJoined:player => {
        if (!onlineGame || !player?.id) return;
        const index = onlineGame.players.findIndex(item => item.id === player.id);
        if (index < 0) onlineGame.players.push(player);
        else onlineGame.players[index] = player;
        onlineGame.memberships = (onlineGame.memberships || [])
          .filter(item => item.playerId !== player.id)
          .concat((player.memberships || []).map(item => ({
            ...item,gameId:onlineGame.id
          })));
        onlineGame.lobbyPlayerCount = onlineGame.players.length;
        onlineGame.lobbyConnectedCount = onlineGame.players.filter(item => item.connected).length;
        renderMultiplayer();
      },
      onPlayerPresence:(playerId,online) => {
        const player = onlineGame?.players.find(item => item.id === playerId);
        if (!player) return;
        player.connected = online === true;
        onlineGame.lobbyPlayerCount = onlineGame.players.length;
        onlineGame.lobbyConnectedCount = onlineGame.players.filter(item => item.connected).length;
        renderMultiplayer();
      },
      onPlayerCount:count => {
        if (!onlineGame || !count) return;
        onlineGame.lobbyPlayerCount = count.totalPlayers;
        onlineGame.lobbyConnectedCount = count.connectedPlayers;
        const element = $('lobby-player-count');
        if (element) element.textContent = count.connectedPlayers + ' ONLINE / ' +
          count.totalPlayers + ' OF ' + count.capacity;
      }
    };
  }

  async function createWorld() {
    if (createWorldPending || isOnline()) return;
    const button=$('create-world');
    createWorldPending=true;
    button.disabled=true;
    button.textContent='CONNECTING TO RELAY…';
    showMessage('Creating the room and connecting this device as host. Keep this tab open.');
    try {
      const name = playerName();
      offlineBackup = structuredClone(state);
      const result = await window.NewWorldMultiplayer.createWorld(name,multiplayerHandlers());
      storeSession({...result.session,playerName:name});
      applySnapshot(result.game);
      showMessage('World created. Invite friends with the 8-character code below.');
      toast('PRIVATE WORLD CREATED');
    } catch (error) {
      showServerError(error);
    } finally {
      createWorldPending=false;
      button.disabled=false;
      button.textContent='CREATE PRIVATE WORLD';
      renderMultiplayer();
    }
  }

  async function joinWorld() {
    if (joinWorldPending || isOnline()) return;
    const button=$('join-world');
    joinWorldPending=true;
    button.disabled=true;
    button.textContent='JOINING WORLD…';
    showMessage('Checking the invitation and waiting for the host to answer.');
    try {
      const name = playerName();
      const inviteCode=$('invite-code').value.trim();
      if(!inviteCode) throw new Error('Enter the invitation code shared by the host.');
      offlineBackup = structuredClone(state);
      const session = await window.NewWorldMultiplayer.joinWorld(
        inviteCode,name,multiplayerHandlers());
      storeSession({...session,playerName:name});
      const membership = membershipsFor(currentPlayer())[0];
      const assignedState = onlineGame?.territories.find(item => item.stateId === membership?.stateId);
      showMessage(assignedState
        ? 'Connected to ' + assignedState.name + '. Your founding group shares this government.'
        : 'Connected to the host. Waiting for your State assignment.');
      toast('JOINED PRIVATE WORLD');
    } catch (error) {
      showServerError(error);
    } finally {
      joinWorldPending=false;
      button.disabled=false;
      button.textContent='JOIN WORLD';
      renderMultiplayer();
    }
  }

  async function restoreSession() {
    if (!onlineSession || restorePending) return;
    if(window.NewWorldMultiplayer?.isConnected()) {
      showMessage('This device is already connected to the room relay.');
      return;
    }
    restorePending=true;
    const button=$('reconnect-world');
    if(button) {
      button.disabled=true;
      button.textContent='RECONNECTING…';
    }
    $('server-status').textContent='Reconnecting to the host and restoring the shared world…';
    try {
      if (!offlineBackup) offlineBackup = structuredClone(state);
      const result = await window.NewWorldMultiplayer.restoreSession(
        onlineSession,multiplayerHandlers());
      if (result.session) storeSession({...result.session,
        playerName:$('player-name').value.trim() || result.session.playerName});
      if (result.game) applySnapshot(result.game);
      showMessage('Reconnected. Your current world state has been restored.');
    } catch (error) {
      $('server-status').textContent = 'Reconnect required.';
      showServerError(error);
    } finally {
      restorePending=false;
      renderMultiplayer();
    }
  }

  function applySnapshot(game) {
    const previousEventSequence = Number(onlineSession?.lastEventSequence) || 0;
    const previousWorldVersion = Number(onlineSession?.lastWorldVersion) || 0;
    const recoveryEvent = (game.events || []).some(event =>
      event.type === 'world.recovered' && event.sequence === game.eventSequence);
    const worldVersionRegressed = previousWorldVersion > 0 &&
      Number(game.worldVersion) < previousWorldVersion;
    const recoverySnapshot = recoveryEvent || worldVersionRegressed;
    if (recoverySnapshot) recoveryOrdersNeedCleanup = true;
    if (recoveryOrdersNeedCleanup && discardPendingOrdersForCurrentSession())
      recoveryOrdersNeedCleanup = false;

    const lastEventSequence = recoverySnapshot
      ? Math.max(0, Number(game.eventSequence) - 1)
      : previousEventSequence;
    const recoveredEvents = (game.events || []).filter(event => event.sequence > lastEventSequence);
    if (recoveredEvents.length) {
      game.activity = [
        ...recoveredEvents.map(event => formatWorldDate(event.worldDate) + ' · ' + event.description),
        ...(game.activity || [])
      ].slice(0, 20);
    }
    onlineGame = game;
    onlineGame.lobbyPlayerCount = Number(game.lobbyPlayerCount) || game.players.length;
    onlineGame.lobbyConnectedCount = Number(game.lobbyConnectedCount) ||
      game.players.filter(item => item.connected).length;
    const player = currentPlayer();
    if (!player) {
      showMessage('Your player record is not in this world. Rejoin using a valid invitation.', true);
      return;
    }
    if (onlineSession && (
      recoverySnapshot ||
      game.eventSequence > previousEventSequence ||
      game.worldVersion !== previousWorldVersion
    )) {
      storeSession({
        ...onlineSession,
        lastEventSequence: game.eventSequence,
        lastWorldVersion: game.worldVersion
      });
    }
    const governmentIndex = player.countryIndex ?? membershipsFor(player)[0]?.stateIndex;
    const governmentFinance = game.territories.find(territory => territory.index === governmentIndex) || null;
    const previousSelectionExists = Number.isInteger(state.selected) &&
      game.territories.some(territory => territory.index === state.selected);
    const selectedIndex = previousSelectionExists
      ? state.selected
      : (governmentIndex ?? player.countryIndex ?? 0);
    const selectedFinance = game.territories.find(territory => territory.index === selectedIndex) ||
      governmentFinance;
    state = {
      ...state,
      treasury: selectedFinance?.treasury ?? player.treasury,
      governmentFinance:selectedFinance,
      selected:selectedIndex,
      owned: game.territories.filter(territory => territory.ownerPlayerId === player.id)
        .map(territory => territory.index),
      states: game.territories.map(territory => ({
        name: territory.name,
        pop: territory.population,
        prosperity: territory.prosperity,
        infra: territory.infrastructure,
        owner: governmentMembersFor(territory).map(member => member.name).join(', ') ||
          game.players.find(owner => owner.id === territory.ownerPlayerId)?.name || 'Unclaimed'
      })),
      buildings: normalizeBuildings(selectedFinance?.buildings || player.buildings || {}),
      activity: [...game.activity]
    };
    mapDetailRenderer?.setRegion(state.selected, state.states[state.selected]?.name);
    mapDetailRenderer?.setBuildings(state.buildings);
    update();
  }

  function sendAction(action) {
    const supportedOrders = new Set([
      'claim','build','pause','resume','recruitUnit','mobilizeUnit',
      'startProject','cancelProject','adoptTechnology','approveBudget',
      'proposeLaw','voteDecision','appointOffice',
      'establishTradeRoute','respondTradeRoute','cancelTradeRoute','declareWar','makePeace',
      'justice.reportIncident','justice.openInvestigation','justice.addEvidence',
      'justice.fileCharges','justice.decideCase','justice.imposeSentence','justice.fileAppeal',
      'resource.extract','administration.submitDocument','administration.inspectProjectMilestone',
      'media.publishArticle','media.submitPoll','media.restrictArticle',
      'security.reportIncident','security.openCase','security.addReport',
      'security.closeCase','security.issueAlert','security.requestWarrant',
      'security.approveWarrant','worldEvents.chooseOption',
      'administration.procurement.openTender','administration.procurement.registerBid',
      'administration.procurement.awardTender','administration.procurement.recordDelivery',
      'administration.procurement.inspectDelivery','administration.procurement.payContract',
      'administration.procurement.cancelTender',
      'identity.fundCommunityProgram','movePopulation',
      'finance.issuePublicDebt','finance.repayPublicDebt',
      'diplomacy.proposeTreaty','diplomacy.respondTreaty',
      'diplomacy.withdrawProposal','diplomacy.terminateTreaty',
      'diplomacy.proposeOrganizationResolution',
      'diplomacy.voteOrganizationResolution','diplomacy.openConference',
      'cancelScheduledOrder'
    ]);
    if (!supportedOrders.has(action.type)) {
      showMessage('This gameplay action is not part of the available world rules.',true);
      return false;
    }
    if (!socket || !window.NewWorldMultiplayer?.isConnected()) {
      showMessage('The host or relay is disconnected. Reconnect before acting.',true);
      return false;
    }
    const player = currentPlayer();
    const activeMemberships = membershipsFor(player);
    const selectedMembership = action.stateId
      ? activeMemberships.find(membership => membership.stateId === action.stateId)
      : activeMemberships.find(membership => membership.stateIndex === player?.countryIndex) ||
        activeMemberships[0];
    const isGameWideVote = action.type === 'pause' || action.type === 'resume';
    const targetInput=$('order-target-date');
    const targetWorldDate=action.type==='cancelScheduledOrder'
      ? '' : String(targetInput?.value||'').trim();
    if(targetWorldDate) {
      if(!/^\d{4}-\d{2}-\d{2}$/.test(targetWorldDate)||
         !Number.isFinite(Date.parse(targetWorldDate+'T00:00:00.000Z'))||
         new Date(targetWorldDate+'T00:00:00.000Z').toISOString().slice(0,10)!==targetWorldDate) {
        showMessage('Choose a real Gregorian target date in YYYY-MM-DD format.',true);
        return false;
      }
      if(targetWorldDate<onlineGame.worldDate) {
        showMessage('The target date is earlier than the current world date.',true);
        return false;
      }
      if(targetWorldDate>onlineGame.worldDate&&isGameWideVote) {
        showMessage('Pause and resume votes must be cast when they take effect; they cannot be scheduled.',true);
        return false;
      }
    }
    const order = {
      ...(targetWorldDate?{...action,targetWorldDate}:action),
      sentOnce:false,
      orderId:crypto.randomUUID(),
      gameId:onlineSession.gameId,
      playerId:onlineSession.playerId,
      expectedWorldVersion:onlineGame?.worldVersion,
      stateId:selectedMembership?.stateId ?? action.stateId ?? null
    };
    if (!order.expectedWorldVersion || (!isGameWideVote && !order.stateId)) {
      showMessage('The authoritative world version or government membership is unavailable.',true);
      return false;
    }
    const queued = [...getPendingOrders(),order];
    if (!savePendingOrders(queued)) return false;
    if(targetWorldDate&&action.type!=='cancelScheduledOrder'&&targetInput)
      targetInput.value='';
    renderMultiplayer();
    replayPendingOrders();
    return true;
  }


  function orderErrorMessage(code) {
    const messages = {
      WORLD_NOT_STARTED: 'The host must start the world before actions are allowed.',
      WORLD_NOT_RUNNING: 'This action is unavailable while the world is paused or closed.',
      NOT_MEMBER: 'You are not a member of the selected government.',
      INSUFFICIENT_PERMISSION: 'Your government permissions do not allow this action.',
      GOVERNMENT_NOT_CONFIGURED: 'This State has no configured government budget.',
      NO_ELIGIBLE_VOTERS: 'No active member can vote under this constitutional procedure.',
      INVALID_PAYLOAD: 'The order contains invalid details.',
      INVALID_TERRAIN: 'Construction is only possible on dry land. Choose a plot outside the water.',
      INSUFFICIENT_FUNDS: 'The government treasury does not have enough funds.',
      TARGET_UNAVAILABLE: 'The selected target is no longer available.',
      TARGET_DATE_IN_PAST: 'The requested world date has already passed.',
      SCHEDULE_HORIZON_EXCEEDED: 'Scheduled orders can be set up to 3,650 world days ahead.',
      SCHEDULE_QUEUE_FULL: 'The world already has 200 pending scheduled orders.',
      SCHEDULE_PAYLOAD_TOO_LARGE: 'The scheduled order contains too much data.',
      ORDER_TYPE_NOT_SCHEDULABLE: 'This order must be executed immediately and cannot be scheduled.',
      SCHEDULED_ORDER_NOT_FOUND: 'This scheduled order is no longer pending.',
      SCHEDULED_ORDER_NOT_OWNED: 'Only the player who scheduled this order can cancel it.',
      SCHEDULED_ACTOR_UNAVAILABLE: 'The player who scheduled this order is no longer available.',
      STALE_WORLD_VERSION: 'The world changed. Review the latest state before trying again.',
      PAUSE_STATE_CONFLICT: 'The world pause state changed before this vote was processed.',
      NOT_CONNECTED: 'Reconnect before voting on the world clock.',
      UNSUPPORTED_ORDER: 'This order type is not supported.',
      CONSTITUTION_NOT_CONFIGURED: 'This State has no configured constitution for that procedure.',
      COMPETENCE_NOT_CONFIGURED: 'This constitutional competence has not been defined.',
      INVALID_CONSTITUTION: 'The State constitutional procedure is incomplete or invalid.',
      DECISION_NOT_FOUND: 'That political decision is no longer available.',
      DECISION_CLOSED: 'That political decision is closed.',
      APPROVAL_NOT_REQUIRED: 'This constitutional procedure does not require a vote.',
      DECISION_ID_CONFLICT: 'This decision identifier is already in use.',
      CONSTITUTION_CHANGED: 'The State constitution changed; review the decision before continuing.',
      ALREADY_VOTED: 'You have already voted on this decision.',
      OFFICE_NOT_FOUND: 'That office is no longer available.',
      INSTITUTION_MISMATCH: 'This constitutional authority cannot appoint to that institution.',
      APPOINTEE_NOT_MEMBER: 'The selected appointee must be an active member of this State government.',
      APPOINTEE_ALREADY_HOLDS_OFFICE: 'That player already holds the selected office.',
      OFFICE_APPOINTMENT_PENDING: 'An appointment decision is already pending for that office.',
      ORDER_ID_REUSED: 'This order ID was already used for a different request.',
      JUSTICE_NOT_CONFIGURED: 'Justice institutions and procedures have not been configured for this State.',
      JUSTICE_REPORT_INVALID: 'Choose a province in your State and enter an incident description of 8–280 characters.',
      JUSTICE_INVESTIGATION_UNAUTHORISED: 'An investigation requires an enacted law, a competent court, a police agency and an authorized office holder.',
      JUSTICE_COURT_AT_CAPACITY: 'The selected court has reached its configured case capacity.',
      JUSTICE_CASE_NOT_FOUND: 'The case does not exist in this State.',
      JUSTICE_LAW_NOT_ACTIVE: 'The legal basis was not in force when the investigation was opened.',
      JUSTICE_EVIDENCE_UNAUTHORISED: 'Only the assigned investigator may register evidence under the authorized police office.',
      JUSTICE_EVIDENCE_INVALID: 'Choose an allowed evidence type and enter a description of 8–280 characters.',
      JUSTICE_CHARGES_NOT_AUTHORISED: 'Charges require the configured minimum evidence count and a separate authorized prosecutor.',
      JUSTICE_TRIAL_UNAUTHORISED: 'Only an authorized, non-conflicted judicial office may decide a charged case.',
      JUSTICE_VERDICT_EVIDENCE_INSUFFICIENT: 'The configured evidentiary standard has not been met for a guilty verdict.',
      JUSTICE_SENTENCE_UNAUTHORISED: 'A sentence requires a conviction and an explicitly authorized sentencing office.',
      JUSTICE_PENALTY_NOT_LAWFUL: 'The requested penalty is not defined by the applicable offence law.',
      JUSTICE_SENTENCE_AMOUNT_INVALID: 'The sentence amount is outside the range enacted for this offence.',
      JUSTICE_PRISON_UNAVAILABLE: 'The configured prison or sentence duration is not available under the applicable law.',
      JUSTICE_PRISON_AT_CAPACITY: 'The configured prison has no available capacity.',
      JUSTICE_APPEAL_UNAVAILABLE: 'An appeal requires a configured appeal period and an authorized appeal office.',
      JUSTICE_APPEAL_EXPIRED: 'The configured appeal deadline has passed.',
      JUSTICE_ORDER_UNSUPPORTED: 'This justice procedure is not part of the configured legal system.',
      RESOURCE_DEPOSIT_UNAVAILABLE: 'The selected deposit is not accessible in this State.',
      RESOURCE_PERMIT_REQUIRED: 'Extraction requires an active law and an authorized office held by your player.',
      RESOURCE_INSTALLATION_REQUIRED: 'An operational installation with enough assigned workers is required.',
      RESOURCE_TECHNOLOGY_REQUIRED: 'The required extraction technology has not been unlocked.',
      RESOURCE_EXTRACTION_LIMIT: 'The quantity exceeds the remaining daily extraction limit or geological reserve.',
      RESOURCE_ENERGY_UNAVAILABLE: 'The State does not have enough available energy for this extraction.',
      RESOURCE_FUNDS_UNAVAILABLE: 'The company cannot cover the configured extraction cost.',
      RESOURCE_STORAGE_FULL: 'The configured resource storage cannot hold the requested quantity.',
      RESOURCE_ORDER_UNSUPPORTED: 'This resource action is not available in the current simulation.',
      ADMIN_TASK_NOT_FOUND: 'The administrative task is no longer available in this State.',
      ADMIN_AUTHORITY_REQUIRED: 'Only an office supervising this agency can register its official documents.',
      ADMIN_TASK_CLOSED: 'This administrative task is already closed.',
      ADMIN_DOCUMENT_NOT_REQUIRED: 'This document is not required by the current procedural step.',
      ADMIN_DOCUMENT_DUPLICATE: 'This public document has already been registered for this step.',
      ADMIN_PROJECT_NOT_FOUND: 'The selected public project or milestone does not exist in this State.',
      ADMIN_INSPECTION_NOT_READY: 'This milestone is not ready for inspection.',
      ADMIN_INSPECTOR_AUTHORITY_REQUIRED: 'Your office is not authorized to inspect this public-project milestone.',
      ADMIN_INSPECTION_EVIDENCE_REQUIRED: 'An inspection record of 12–280 characters is required.',
      ADMIN_INSPECTION_OUTCOME_INVALID: 'Choose an explicit accepted or rejected inspection outcome.',
      MEDIA_SYSTEM_NOT_CONFIGURED: 'Media and opinion data are not configured for this State.',
      MEDIA_EDITOR_AUTHORITY_REQUIRED: 'The player is not registered as an editor of this outlet.',
      MEDIA_ARTICLE_TYPE_INVALID: 'Select a supported article format.',
      MEDIA_ARTICLE_INVALID: 'The article title or body does not meet the required length.',
      MEDIA_TOPIC_UNAVAILABLE: 'This outlet is not configured to cover the selected topic.',
      MEDIA_POSITION_INVALID: 'Select a valid editorial and government position.',
      MEDIA_SOURCE_REQUIRED: 'A news report must cite an event from the shared world record.',
      MEDIA_SOURCE_INVALID: 'One or more cited events do not exist in this State record.',
      MEDIA_DAILY_CAPACITY: 'The outlet has reached its daily publication capacity.',
      MEDIA_POLL_AUTHORITY_REQUIRED: 'The player is not authorized to submit a poll for this outlet.',
      MEDIA_POLL_INVALID: 'The sample size or response counts are invalid for this topic.',
      MEDIA_DAILY_POLL_CAPACITY: 'This outlet has already registered its poll for today.',
      MEDIA_ARTICLE_UNAVAILABLE: 'The selected article is unavailable or already restricted.',
      MEDIA_CENSORSHIP_UNAUTHORISED: 'A valid censorship law and authorized office are required.',
      MEDIA_RESTRICTION_INVALID: 'A written legal reason and valid restriction severity are required.',
      MEDIA_ORDER_UNSUPPORTED: 'This media action is not supported.',
      SECURITY_INCIDENT_INVALID: 'The incident report needs a valid local province, category and factual description.',
      SECURITY_CASE_SCOPE_INVALID: 'The selected incident, agency or legal authorization is not valid in this State.',
      SECURITY_INVESTIGATION_AUTHORITY_REQUIRED: 'Your political office is not authorized to investigate for this agency.',
      SECURITY_LEGAL_BASIS_INVALID: 'The current mandate does not cover this competence or province.',
      SECURITY_DAILY_CAPACITY: 'The security agency has reached its daily case capacity.',
      SECURITY_CASE_CAPACITY: 'The agency has no spare investigative capacity.',
      SECURITY_DUPLICATE_CASE: 'This incident already has an investigation.',
      SECURITY_CASE_UNAVAILABLE: 'This security case is no longer available for that action.',
      SECURITY_REPORT_INVALID: 'The intelligence assessment needs a valid summary, confidence and classification.',
      SECURITY_SOURCE_INVALID: 'An assessment can only cite events from this State shared record.',
      SECURITY_PUBLIC_SOURCE_REQUIRED: 'A public security statement must cite a verifiable source.',
      SECURITY_OVERSIGHT_REQUIRED: 'A separate authorized oversight office is required.',
      SECURITY_CONFLICT_OF_INTEREST: 'The investigator cannot independently oversee their own case.',
      SECURITY_CLOSURE_INVALID: 'The case outcome or written closure reasons are invalid.',
      SECURITY_JUSTICE_REFERENCE_REQUIRED: 'A justice referral must reference an existing case.',
      SECURITY_ALERT_INVALID: 'The security alert needs valid severity, message and expiry.',
      SECURITY_ORDER_UNSUPPORTED: 'This security action is not supported.',
      SECURITY_WARRANT_NOT_REQUIRED: 'This agency authorization does not require a warrant.',
      SECURITY_WARRANT_REASON_REQUIRED: 'A written warrant application and proportionality statement are required.',
      SECURITY_WARRANT_REQUEST_DUPLICATE: 'A warrant request is already pending for this incident.',
      SECURITY_WARRANT_REQUEST_UNAVAILABLE: 'This warrant request is no longer pending.',
      SECURITY_WARRANT_JUDICIAL_AUTHORITY_REQUIRED: 'Only a separate configured judicial office can decide this warrant.',
      SECURITY_WARRANT_CONFLICT_OF_INTEREST: 'The investigator cannot approve their own warrant request.',
      SECURITY_WARRANT_DECISION_INVALID: 'A written approval or denial with reasons is required.',
      SECURITY_WARRANT_REQUIRED: 'An unexpired warrant from an independent judicial office is required.',
      WORLD_EVENT_UNAVAILABLE: 'This world event is no longer open for a decision.',
      WORLD_EVENT_AUTHORITY_REQUIRED: 'Your political office is not authorized to decide this event.',
      WORLD_EVENT_OPTION_INVALID: 'The selected event option is not available.',
      WORLD_EVENT_EFFECT_TARGET_MISSING: 'One of the configured event effect targets is not available.',
      WORLD_EVENT_EFFECT_UNAFFORDABLE: 'The State cannot afford the complete event effect.',
      WORLD_EVENT_EFFECT_STORAGE_FULL: 'The configured storage capacity cannot hold the complete event resource effect.',
      WORLD_EVENT_EFFECT_UNSUPPORTED: 'This event effect is not supported.',
      IDENTITY_PROGRAM_TARGET_INVALID: 'The community organization or provincial group profile is not available.',
      IDENTITY_PROGRAM_AUTHORITY_REQUIRED: 'Your political office is not authorized to fund this community programme.',
      IDENTITY_PROGRAM_LEGAL_BASIS_INVALID: 'The community programme mandate is no longer in force.',
      IDENTITY_PROGRAM_INVALID: 'Choose a programme permitted by the organization and a strength from 1 to 5.',
      IDENTITY_PROGRAM_DAILY_CAPACITY: 'The organization has reached its daily programme capacity.',
      IDENTITY_PROGRAM_BUDGET_INSUFFICIENT: 'The State treasury cannot fund the full community programme.',
      MILITARY_RULES_PENDING: 'This military order is not available until its rules are configured.',
      UNIT_NOT_OPERATIONAL: 'This unit is not operational.',
      ROUTE_CAPACITY_EXCEEDED: 'The configured route does not have enough capacity.',
      TERRITORY_ACCESS_DENIED: 'This route crosses territory without configured access.',
      MILITARY_CAPACITY_UNIT_UNSUPPORTED: 'This route uses a capacity unit that cannot yet be validated.',
      TECHNOLOGY_REQUIRED: 'Discover the required military technology before recruiting this unit.',
      UNIT_LIMIT: 'This State has reached its limit of active military units.',
      UNIT_NOT_CONTROLLED: 'You do not have command authority over this unit.',
      ROUTE_UNAVAILABLE: 'No valid military route connects the selected provinces.',
      HOSTILE_TERRITORY: 'You cannot move into territory outside your government. Issue an attack order instead.',
      ALREADY_CONTROLLED: 'Your government already administers this territory.',
      ARMY_TOO_WEAK: 'This unit is not strong enough to launch the operation.',
      PROJECT_UNAVAILABLE: 'This research project cannot be started or cancelled in its current state.',
      INVALID_PROJECT: 'The research project references missing scenario data.',
      PREREQUISITES_MISSING: 'The required technologies have not yet been discovered.',
      PROJECT_RESOURCES_MISSING: 'The research institution lacks available staff, materials or funding.',
      TECHNOLOGY_NOT_DISCOVERED: 'Complete the research project before adopting this technology.',
      ALREADY_ADOPTED: 'This technology is already adopted by the State.',
      INVALID_BUDGET: 'Enter a valid whole-number government budget.',
      INVALID_LAW: 'A law needs a valid title and a sufficiently detailed proposal.',
      INVALID_POLICY: 'Choose one of the available policy effects.',
      POLICY_ALREADY_ACTIVE: 'This policy is already active in the selected State.',
      VOTE_UNAVAILABLE: 'This decision is closed or your membership cannot vote.',
      INVALID_VOTE: 'Choose approve or reject.',
      DUPLICATE_VOTE: 'Your membership has already voted on this decision.',
      INVALID_APPOINTMENT: 'The office or appointee is not eligible in this State.',
      TRADE_DESTINATION_UNAVAILABLE: 'Trade routes require membership in both the exporting and importing governments.',
      TRADE_GOOD_UNAVAILABLE: 'The selected good needs an exporter and a destination market.',
      INVALID_ROUTE_CAPACITY: 'Choose a daily route capacity between 1 and 500.',
      TRADE_ROUTE_EXISTS: 'A route for this good and destination already exists.',
      TRADE_ROUTE_LIMIT: 'The world has reached its public trade route limit.',
      TARGET_OCCUPIED: 'This territory is under military occupation.',
      TRADE_ROUTE_UNAVAILABLE: 'This State does not participate in that active or pending route.',
      TRADE_ROUTE_PENDING_NOT_FOUND: 'This State has no pending trade route to approve.',
      TRADE_ROUTE_SELF_APPROVAL: 'The exporting player cannot approve their own trade proposal.',
      INVALID_DIPLOMATIC_TARGET: 'Choose a valid foreign State.',
      NOT_HOSTILE_STATE: 'War can only be declared against another administered government.',
      WAR_ALREADY_ACTIVE: 'The two governments are already at war.',
      WAR_NOT_DECLARED: 'Declare war before attacking another administered State.',
      PEACE_UNAVAILABLE: 'There is no active war between these governments.',
      OCCUPATION_ACTIVE: 'Finish or withdraw from active occupations before signing peace.',
      INSUFFICIENT_PERMISSION: 'This action is reserved for the appointed government office holder.'
    };
    return messages[code] || 'The host rejected the order.';
  }

  async function assignCountry(playerId,countryIndex) {
    try {
      const game = await window.NewWorldMultiplayer.admin('assign',{playerId,countryIndex});
      if (game && typeof game === 'object') applySnapshot(game);
      showMessage('State assignment saved on the host.');
    } catch (error) {
      showServerError(error);
    }
  }

  async function startWorld() {
    const button = $('start-world');
    if (startRequestPending || button.disabled || !onlineSession?.isHost) return;
    startRequestPending = true;
    button.disabled = true;
    button.textContent = 'STARTING WORLD...';
    try {
      const game = await window.NewWorldMultiplayer.admin('start',{});
      if (game && typeof game === 'object') applySnapshot(game);
      showMessage('The world has started. The host device must remain connected.');
      toast('WORLD STARTED');
    } catch (error) {
      showServerError(error);
    } finally {
      startRequestPending = false;
      renderMultiplayer();
    }
  }


  function renderMultiplayer() {
    const sessionPanel = $('multiplayer-session');
    $('multiplayer-actions').hidden = isOnline();
    sessionPanel.hidden = !isOnline();
    const maintenancePanel=$('technical-maintenance-panel');
    const hostRuntime=Boolean(window.NewWorldMultiplayer?.isHost());
    if(maintenancePanel) maintenancePanel.hidden=!hostRuntime;
    const maintenance=window.NewWorldMultiplayer?.technicalMaintenanceStatus?.()||
      {active:false,reason:''};
    const maintenanceStart=$('activate-technical-maintenance');
    const maintenanceEnd=$('clear-technical-maintenance');
    const maintenanceReason=$('technical-maintenance-reason');
    if(maintenanceStart) maintenanceStart.disabled=!hostRuntime||!window.NewWorldMultiplayer?.isConnected()||
      maintenance.active||(maintenanceReason?.value.trim().length||0)<5;
    if(maintenanceEnd) maintenanceEnd.disabled=!hostRuntime||!window.NewWorldMultiplayer?.isConnected()||!maintenance.active;
    const maintenanceControlStatus=$('technical-maintenance-control-status');
    if(maintenanceControlStatus) maintenanceControlStatus.textContent=maintenance.active
      ? 'Active · '+maintenance.reason+' · clock and daily cycles held.'
      : 'Inactive · technical maintenance does not change the political pause status.';
    const maintenanceNotice=$('technical-maintenance-status');
    if(maintenanceNotice) {
      maintenanceNotice.hidden=!maintenance.active;
      maintenanceNotice.textContent=maintenance.active?'TECHNICAL MAINTENANCE · '+maintenance.reason:'';
    }
    if (!onlineSession) return;

    const reconnectButton=$('reconnect-world');
    const relayConnected=Boolean(window.NewWorldMultiplayer?.isConnected());
    reconnectButton.hidden=relayConnected && !restorePending;
    reconnectButton.disabled=restorePending;
    reconnectButton.textContent=restorePending?'RECONNECTING…':'RECONNECT';
    reconnectButton.title='Reconnect this browser to the host and restore the saved world.';
    const pendingOrders=ordersForCurrentSession();
    const pendingCount=pendingOrders.length;
    $('pending-orders-status').textContent = pendingCount
      ? pendingCount + ' pending order' + (pendingCount === 1 ? '' : 's') + ' · waiting for host confirmation'
      : 'No pending orders.';
    const pendingList=$('pending-order-list');
    pendingList.replaceChildren();
    for(const order of pendingOrders) {
      const row=document.createElement('div');
      row.className='pending-order-row';
      const copy=document.createElement('div');
      const title=document.createElement('strong');
      title.textContent=describeOrder(order);
      const status=document.createElement('small');
      status.textContent=order.sentOnce
        ? 'SENT · WAITING FOR HOST'
        : 'QUEUED · NOT SENT YET';
      copy.append(title,status);
      row.appendChild(copy);
      if(!order.sentOnce && !sentOrderIds.has(order.orderId)) {
        const remove=document.createElement('button');
        remove.type='button';
        remove.textContent='REMOVE';
        remove.title='Remove this order before it is sent to the host';
        remove.addEventListener('click',()=>removePendingOrder(order.orderId));
        row.appendChild(remove);
      }
      pendingList.appendChild(row);
    }
    $('advanced-scenario-settings').hidden=!canConfigureScenario();
    $('session-summary').textContent = onlineGame
      ? (onlineGame.status || (onlineGame.started ? 'running' : 'lobby')).toUpperCase() +
        ' · ' + formatWorldDate(onlineGame.worldDate) +
        ' · WORLD ' + onlineGame.id.slice(0, 8).toUpperCase() + ' · DAY ' + onlineGame.day +
        ' · VERSION ' + onlineGame.worldVersion
      : 'Reconnecting to world ' + onlineSession.gameId.slice(0, 8).toUpperCase() + '…';
    const canShareInvite = Boolean(onlineSession.inviteCode && onlineGame && !onlineGame.started);
    $('invite-panel').hidden = !canShareInvite;
    if (canShareInvite) $('invite-share').value = onlineSession.inviteCode;
    const list = $('player-list');
    list.replaceChildren();

    if (onlineGame) {
      const isHost = onlineSession.playerId === onlineGame.hostPlayerId;
      const totalPlayers = Number(onlineGame.lobbyPlayerCount ?? onlineGame.players.length);
      const connectedPlayers = Number(onlineGame.lobbyConnectedCount ??
        onlineGame.players.filter(player => player.connected).length);
      $('lobby-player-count').textContent = connectedPlayers + ' ONLINE / ' +
        totalPlayers + ' OF ' + (onlineGame.maxHumanPlayers || 20);
      if (!isHost && !onlineGame.started) {
        const row = document.createElement('div');
        row.className = 'player-row';
        row.textContent = 'You are part of the founding party. ' + totalPlayers +
          ' player(s) in this lobby; ' + connectedPlayers + ' online.';
        list.appendChild(row);
      }
      for (const player of (!isHost && !onlineGame.started ? [] : onlineGame.players)) {
        const row = document.createElement('div');
        row.className = 'player-row';
        const summary = document.createElement('div');
        summary.className = 'player-summary';
        const playerLabel = document.createElement('span');
        playerLabel.textContent = player.name + (player.isHost ? ' · HOST' : '');
        const memberStates = membershipsFor(player).map(membership => {
          const territoryName = onlineGame.territories
            .find(territory => territory.stateId === membership.stateId)?.name;
          if (!territoryName) return null;
          const role = membership.permissionSetId.replaceAll('-', ' ').toUpperCase();
          return territoryName + ' · ' + role;
        }).filter(Boolean);
        const stateLabel = document.createElement('span');
        stateLabel.textContent = (player.connected ? '● ONLINE · ' : '○ OFFLINE · ') +
          (memberStates.join(', ') || 'STATE UNASSIGNED');
        summary.append(playerLabel, stateLabel);
        row.appendChild(summary);

        if (!onlineGame.started && membershipsFor(player).length) {
          const role = document.createElement('span');
          role.className = 'player-coop-role';
          role.textContent = player.id === onlineGame.hostPlayerId ? 'FOUNDING PLAYER' : 'FOUNDING PARTY';
          row.appendChild(role);
        }
        list.appendChild(row);
      }

      const startButton = $('start-world');
      startButton.hidden = !isHost || onlineGame.started;
      const missingMembership = onlineGame.players.some(player => membershipsFor(player).length === 0);
      const hostConnected=window.NewWorldMultiplayer?.isConnected() && socket?.readyState===WebSocket.OPEN;
      startButton.disabled=startRequestPending || missingMembership || !hostConnected;
      startButton.textContent=startRequestPending ? 'STARTING WORLD...' : 'START WORLD';
      startButton.title=missingMembership
        ? 'Waiting for every player to join the founding party.'
        : !hostConnected
          ? 'Reconnect the host to the relay before starting.'
          : 'Start the shared frontier for everyone in the lobby.';

      const pauseControls = $('pause-controls');
      pauseControls.hidden = !['running','paused'].includes(onlineGame.status);
      $('hud-quick-actions').hidden = !onlineGame.started;
      const hudPause = $('hud-pause');
      hudPause.disabled = !currentPlayer()?.connected || socket?.readyState !== WebSocket.OPEN ||
        !['running','paused'].includes(onlineGame.status);
      const hasHudPauseVote = (onlineGame.pauseVotePlayerIds || []).includes(onlineSession.playerId);
      hudPause.querySelector('b').textContent = hasHudPauseVote
        ? 'WITHDRAW'
        : onlineGame.paused ? 'RESUME' : 'PAUSE';
      hudPause.title = hasHudPauseVote
        ? 'Withdraw your current simulation vote'
        : onlineGame.paused ? 'Vote to resume the simulation' : 'Vote to pause the simulation';
      if (!pauseControls.hidden) {
        const connectedCount = onlineGame.players.filter(player => player.connected).length;
        const voteIds = onlineGame.pauseVotePlayerIds || [];
        const voteCount = voteIds.filter(playerId =>
          onlineGame.players.some(player => player.id === playerId && player.connected)).length;
        const hasVoted = voteIds.includes(onlineSession.playerId);
        const voteAction = onlineGame.paused ? 'resume' : 'pause';
        $('pause-status').textContent = voteCount + '/' + connectedCount +
          ' connected votes to ' + voteAction + ' · more than half required.';
        const voteButton = $('pause-vote');
        voteButton.textContent = hasVoted ? 'WITHDRAW VOTE' :
          onlineGame.paused ? 'VOTE TO RESUME' : 'VOTE TO PAUSE';
        voteButton.disabled = !currentPlayer()?.connected ||
          socket?.readyState !== WebSocket.OPEN ||
          !['running','paused'].includes(onlineGame.status);
        voteButton.title=voteButton.disabled
          ? 'Reconnect to a running or paused world before voting.'
          : 'Your vote counts with connected players. More than half must agree.';
      }
    } else {
      const status = document.createElement('p');
      status.className = 'muted';
      status.textContent = 'Waiting for the host to restore the lobby.';
      list.appendChild(status);
      $('start-world').hidden = true;
      $('pause-controls').hidden = true;
      $('hud-quick-actions').hidden = true;
    }
  }

  function disconnect() {
    const hosted = Boolean(onlineSession?.isHost ||
      onlineGame?.hostPlayerId === onlineSession?.playerId);
    try {
      window.NewWorldMultiplayer?.disconnect(hosted);
    } catch (error) {
      console.error('[new-world] Could not close the multiplayer connection:',error);
    }
    socket = null;
    onlineSession = null;
    onlineGame = null;
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch (error) {
      console.error('[new-world] Could not clear the saved multiplayer token:',error);
      showMessage('This browser could not clear the saved session.',true);
    }
    if (offlineBackup) state = offlineBackup;
    offlineBackup = null;
    $('server-status').textContent = hosted
      ? 'Host disconnected. The world is now offline.'
      : 'Disconnected from the host.';
    update();
    toast(hosted ? 'WORLD CLOSED ON THIS DEVICE' : 'DISCONNECTED ON THIS DEVICE');
  }


  $('player-profile-toggle').addEventListener('click',()=>{
    activateView('multiplayer');
    if(!isOnline()) $('player-name').focus();
  });
  $('command-inbox-toggle').addEventListener('click',()=>{
    const panel=$('command-inbox');
    const open=panel.hidden;
    panel.hidden=!open;
    $('command-inbox-toggle').setAttribute('aria-expanded',String(open));
    if(open) $('command-inbox-close').focus();
  });
  $('command-inbox-close').addEventListener('click',()=>{
    $('command-inbox').hidden=true;
    $('command-inbox-toggle').setAttribute('aria-expanded','false');
    $('command-inbox-toggle').focus();
  });
  $('command-inbox-mark-read').addEventListener('click',markCommandInboxRead);
  $('order-date-clear')?.addEventListener('click',()=>{
    const input=$('order-target-date');
    if(input) input.value='';
    input?.focus();
  });
  $('order-target-date')?.addEventListener('change',()=>{
    const input=$('order-target-date');
    if(input?.value&&onlineGame?.worldDate&&input.value<onlineGame.worldDate) {
      input.value='';
      showMessage('The target date cannot be earlier than the current world date.',true);
    }
  });
  document.addEventListener('keydown',event=>{
    if(event.key!=='Escape' || $('command-inbox').hidden) return;
    $('command-inbox').hidden=true;
    $('command-inbox-toggle').setAttribute('aria-expanded','false');
    $('command-inbox-toggle').focus();
  });
  $('save-btn').addEventListener('click',()=>{
    if(!isOnline() || !window.NewWorldMultiplayer?.isHost()) return;
    const saved=window.NewWorldMultiplayer.saveNow?.()===true;
    update();
    if(saved) toast('LOCAL WORLD SAVE VERIFIED');
    else showMessage('The local save could not be verified. Keep this browser profile open and check available storage.',true);
  });

  $('export-backup-btn').addEventListener('click',async()=>{
    if(!isOnline()||!window.NewWorldMultiplayer?.isHost()) return;
    const portable=window.NewWorldPortableBackup;
    if(!portable) {
      showMessage('Encrypted backup support did not load. Refresh the page before exporting.',true);
      return;
    }
    const passphrase=window.prompt('Set a password for this encrypted backup (at least 12 characters). The password is not stored.');
    if(passphrase===null) return;
    const confirmation=window.prompt('Enter the same password again to confirm it.');
    if(confirmation===null) return;
    if(passphrase!==confirmation) {
      showMessage('The two backup passwords do not match.',true);
      return;
    }
    try {
      const hostBackup=window.NewWorldMultiplayer.exportHostBackup();
      const encrypted=await portable.encrypt(JSON.stringify(hostBackup),passphrase);
      const blob=new Blob([JSON.stringify(encrypted)],{type:'application/json'});
      const url=URL.createObjectURL(blob);
      const link=document.createElement('a');
      const room=window.NewWorldMultiplayer.currentRoom?.()||'WORLD';
      const stamp=new Date().toISOString().replace(/[:.]/g,'-');
      link.href=url;link.download='NEW-WORLD-'+room+'-'+stamp+'.nwbackup';
      document.body.appendChild(link);link.click();link.remove();
      window.setTimeout(()=>URL.revokeObjectURL(url),1500);
      toast('ENCRYPTED HOST BACKUP EXPORTED');
      showMessage('Encrypted backup exported. Keep both the file and its password private; the file contains the host recovery token and player credentials.');
    } catch(error) {
      showMessage('Backup export failed: '+(error?.message||'unknown error'),true);
    }
  });

  $('import-backup-btn').addEventListener('click',()=>{
    if(isOnline()||window.NewWorldMultiplayer?.isConnected()) {
      showMessage('Disconnect this browser session before importing a host backup.',true);
      return;
    }
    $('import-backup-file').click();
  });

  $('import-backup-file').addEventListener('change',async event=>{
    const file=event.target.files?.[0];
    if(!file) return;
    try {
      const portable=window.NewWorldPortableBackup;
      if(!portable) throw new Error('Encrypted backup support did not load. Refresh the page first.');
      if(file.size>portable.maximumBackupBytes*1.4+16384)
        throw new Error('This backup file exceeds the supported 50 MB world-data limit.');
      const passphrase=window.prompt('Enter the password used when this backup was exported.');
      if(passphrase===null) return;
      const oldHostClosed=window.confirm(
        'IMPORTANT: the original host browser must be fully closed before restoring this backup. '+
        'Otherwise two devices could try to run the same world. Confirm that the old host is offline.'
      );
      if(!oldHostClosed) return;
      const encrypted=JSON.parse(await file.text());
      const plaintext=await portable.decrypt(encrypted,passphrase);
      const hostEnvelope=JSON.parse(plaintext);
      const session=window.NewWorldMultiplayer.importHostBackup(hostEnvelope);
      storeSession({...session,playerName:session.playerName||$('player-name').value.trim()||'HOST'});
      showMessage('Encrypted host backup installed and verified locally. Reconnecting to the shared world…');
      await restoreSession();
    } catch(error) {
      showMessage('Backup import failed: '+(error?.message||'invalid backup file'),true);
    } finally {
      event.target.value='';
    }
  });

  for(const controlId of [
    'procurement-agency','procurement-province','procurement-competence',
    'procurement-inspection-office','procurement-title','procurement-scope',
    'procurement-estimate','procurement-submission-days'
  ]) {
    const control=$(controlId);
    if(!control) continue;
    control.addEventListener('input',()=>renderAdministration());
    control.addEventListener('change',()=>renderAdministration());
  }
  $('procurement-open-tender')?.addEventListener('click',()=>{
    if(!onlineGame||!onlineSession||!window.NewWorldMultiplayer?.isConnected()) return;
    const territory=onlineGame.territories.find(item=>item.index===state.selected);
    if(!territory) return;
    const estimate=Number($('procurement-estimate').value);
    const days=Number($('procurement-submission-days').value);
    sendAction({
      type:'administration.procurement.openTender',stateId:territory.stateId,
      agencyId:$('procurement-agency').value,
      provinceId:$('procurement-province').value,
      competenceId:$('procurement-competence').value,
      inspectionOfficeId:$('procurement-inspection-office').value,
      title:$('procurement-title').value.trim(),
      scope:$('procurement-scope').value.trim(),
      estimatedAmount:estimate,submissionDays:days
    });
  });

  $('claim-btn').addEventListener('click', () => {
    const index = state.selected;
    if (!isOnline() || !onlineGame?.started || $('claim-btn').disabled) return;
    if (state.owned.includes(index)) return;
    const fundingSource = claimFundingSource();
    if (!fundingSource) return;
    sendAction({type:'claim',territoryIndex:index,stateId:fundingSource.membership.stateId});
  });
  $('open-build-menu').addEventListener('click', () => enterCityMap(state.selected));
  $('hud-build').addEventListener('click', () => enterCityMap(state.selected));
  $('hud-city').addEventListener('click', () =>
    document.querySelector('.tab[data-view="city"]')?.click());
  $('hud-economy').addEventListener('click', () =>
    document.querySelector('.tab[data-view="ledger"]')?.click());
  $('hud-government').addEventListener('click', () =>
    document.querySelector('.tab[data-view="government"]')?.click());
  $('hud-pause').addEventListener('click', () =>
    $('pause-vote').click());
  $('pause-vote').addEventListener('click', () => {
    if (!onlineGame?.started) return;
    sendAction({type: onlineGame.paused ? 'resume' : 'pause'});
  });
  $('budget-amount').addEventListener('input', updateBudgetReadout);
  document.querySelectorAll('[data-budget-adjust]').forEach(button => {
    button.addEventListener('click', () => {
      const slider = $('budget-amount');
      const minimum = Number(slider.min) || 0;
      const maximum = Number(slider.max) || 10000;
      const adjustment = Number(button.dataset.budgetAdjust) || 0;
      slider.value = String(Math.max(minimum,Math.min(maximum,
        Number(slider.value) + adjustment)));
      updateBudgetReadout();
    });
  });
  document.querySelectorAll('.law-policy-card').forEach(button => {
    button.addEventListener('click', () => {
      if (button.disabled || !LAW_POLICIES[button.dataset.policyId]) return;
      selectedLawPolicyId = button.dataset.policyId;
      updateLawDraft();
    });
  });
  $('law-strength').addEventListener('input', () => {
    lawPolicyStrengths[selectedLawPolicyId] = Number($('law-strength').value);
    updateLawDraft();
  });

  $('approve-budget').addEventListener('click', () => {
    const territory = onlineGame?.territories.find(item => item.index === state.selected);
    const input = $('budget-amount');
    const amount = Number(input.value);
    if (!territory || $('approve-budget').disabled) return;
    if (!input.value || !input.checkValidity() || !Number.isSafeInteger(amount)) {
      showMessage('Enter a non-negative whole-number budget amount.', true);
      return;
    }
    sendAction({
      type: 'approveBudget',
      stateId: territory.stateId,
      proposedBudget: amount
    });
  });
  $('propose-law').addEventListener('click', () => {
    const territory = onlineGame?.territories.find(item => item.index === state.selected);
    const policy = LAW_POLICIES[selectedLawPolicyId];
    if (!territory || !policy || $('propose-law').disabled) return;
    const strength = Number($('law-strength').value);
    sendAction({
      type:'proposeLaw',
      stateId:territory.stateId,
      decisionTitle:policy.title,
      decisionText:policy.effectText(strength),
      policyId:selectedLawPolicyId,
      policyValue:strength/100
    });
  });
  $('migration-origin-group')?.addEventListener('change',renderDemography);
  $('migration-destination-group')?.addEventListener('change',renderDemography);
  $('migration-quantity')?.addEventListener('input',()=>{
    $('migration-quantity-value').textContent=Number($('migration-quantity').value||0).toLocaleString('en-US');
    const territory=onlineGame?.territories.find(item=>item.index===state.selected);
    const group=(onlineGame?.populationGroups || []).find(item=>
      item.id===$('migration-origin-group').value && item.stateId===territory?.stateId);
    $('migration-submit').disabled=!Boolean(
      onlineGame?.status==='running' && group &&
      $('migration-destination-group').value &&
      Number.isSafeInteger(Number($('migration-quantity').value)) &&
      Number($('migration-quantity').value)>0 &&
      Number($('migration-quantity').value)<=group.population &&
      membershipsFor(currentPlayer()).some(item=>
        item.stateId===territory?.stateId &&
        (onlineGame.demographicProfiles || []).some(profile=>
          profile.stateId===item.stateId &&
          profile.migrationPermissionSetIds?.includes(item.permissionSetId)))
    );
  });
  $('migration-submit')?.addEventListener('click',()=>{
    const territory=onlineGame?.territories.find(item=>item.index===state.selected);
    const quantity=Number($('migration-quantity').value);
    if(!territory || !Number.isSafeInteger(quantity) || quantity<1) return;
    sendAction({
      type:'movePopulation',stateId:territory.stateId,
      originGroupId:$('migration-origin-group').value,
      destinationGroupId:$('migration-destination-group').value,
      quantity
    });
  });
  $('trade-route-destination').addEventListener('change',renderEconomy);
  $('trade-route-capacity').addEventListener('change',renderEconomy);
  $('create-trade-route').addEventListener('click',() => {
    const territory=onlineGame?.territories.find(item => item.index===state.selected);
    const button=$('create-trade-route');
    const capacity=Number($('trade-route-capacity').value);
    if (!territory || button.disabled || !Number.isSafeInteger(capacity)) return;
    sendAction({
      type:'establishTradeRoute',
      stateId:territory.stateId,
      destinationStateId:$('trade-route-destination').value,
      goodId:$('trade-route-good').value,
      dailyCapacity:capacity
    });
  });

  document.querySelectorAll('.tab').forEach(button => button.addEventListener('click',() => {
    const viewName = button.dataset.view;
    activateView(viewName);
    if (viewName === 'city') {
      prepareBuilderMap();
      renderCity();
      renderOptions();
      buildMenu?.close();
    } else {
      buildMenu?.close();
    }
  }));
  $('zoom-in').addEventListener('click', () => setZoom(zoom * 1.2));
  $('zoom-out').addEventListener('click', () => setZoom(zoom / 1.2));
  $('reset-map').addEventListener('click', () => {
    zoom = 1;
    pan = {x: 0, y: 0};
    applyMapTransform();
  });

  function setZoom(value, clientX, clientY) {
    const rect = viewport.getBoundingClientRect();
    const anchorX = Number.isFinite(clientX) ? clientX - rect.left : rect.width / 2;
    const anchorY = Number.isFinite(clientY) ? clientY - rect.top : rect.height / 2;
    const nextZoom = Math.max(.04, Math.min(6, value));

    if (mapDetailRenderer?.active) {
      zoom = nextZoom;
      mapDetailRenderer.setZoomAt(zoom, anchorX, anchorY);
      mapDetailRenderer.setCamera(zoom, true);
      return;
    }

    const localX = (anchorX - pan.x) / zoom;
    const localY = (anchorY - pan.y) / zoom;
    pan = { x: anchorX - localX * nextZoom, y: anchorY - localY * nextZoom };
    zoom = nextZoom;
    applyMapTransform();
  }

  function applyMapTransform() {
    const width = viewport.clientWidth;
    const height = viewport.clientHeight;
    if (zoom < 1) {
      pan.x = width * (1 - zoom) / 2;
      pan.y = height * (1 - zoom) / 2;
    } else {
      pan.x = Math.max(width * (1 - zoom), Math.min(0, pan.x));
      pan.y = Math.max(height * (1 - zoom), Math.min(0, pan.y));
    }
    $('map-stage').style.transform =
      'translate3d(' + pan.x + 'px,' + pan.y + 'px,0) scale(' + zoom + ')';
    mapDetailRenderer?.setCamera(zoom);
  }
  viewport.addEventListener('pointerdown', event => {
    if (mapDetailRenderer?.active) return;
    if (event.target.closest('object') && event.target !== viewport) return;
    drag = {x: event.clientX - pan.x, y: event.clientY - pan.y};
    viewport.setPointerCapture(event.pointerId);
  });
  viewport.addEventListener('pointermove', event => {
    if (mapDetailRenderer?.active || !drag) return;
    pan = {x: event.clientX - drag.x, y: event.clientY - drag.y};
    applyMapTransform();
  });
  viewport.addEventListener('pointerup', () => {
    if (!mapDetailRenderer?.active) drag = null;
  });
  viewport.addEventListener('wheel', event => {
    event.preventDefault();
    setZoom(zoom * Math.exp(-event.deltaY * 0.00115), event.clientX, event.clientY);
  }, {passive: false});

  const advancedScenarioContent=$('advanced-scenario-content');
  for(const panelId of [
    'territory-setup-panel','economy-setup-panel',
    'military-setup-panel','technology-setup-panel','demography-setup-panel'
  ]) {
    const panel=$(panelId);
    if(panel) advancedScenarioContent.appendChild(panel);
  }

  const endpointLabel = $('server-endpoint');
  if (endpointLabel) endpointLabel.textContent = 'MQTT RELAY · HOST RUNS THE WORLD';
  $('player-name').value = localStorage.getItem(NAME_KEY) || '';
  $('test-server').addEventListener('click',async () => {
    if(relayTestPending) return;
    const button=$('test-server');
    relayTestPending=true;
    button.disabled=true;
    button.textContent='TESTING…';
    $('server-status').textContent='Testing the public relay connection…';
    try {
      await window.NewWorldMultiplayer.testRelay();
      $('server-status').textContent = 'Public relay reachable.';
      $('server-status').classList.remove('error');
      showMessage('Relay reachable. Create a world to host a game, or join using an invitation code.');
    } catch (error) {
      showServerError(error);
    } finally {
      relayTestPending=false;
      button.disabled=false;
      button.textContent='TEST';
    }
  });
  $('create-world').addEventListener('click', createWorld);
  $('join-world').addEventListener('click', joinWorld);
  $('reconnect-world').addEventListener('click', restoreSession);
  $('start-world').addEventListener('click', startWorld);
  $('leave-world').addEventListener('click', disconnect);
  $('load-economy-config').addEventListener('click', loadEconomyConfiguration);
  $('save-economy-config').addEventListener('click', saveEconomyConfiguration);
  $('load-territory-config').addEventListener('click', () => loadScenarioConfiguration(
    'territory-config',
    {
      provinces: 'provinces',
      settlements: 'settlements',
      connections: 'provinceConnections',
      controls: 'territorialControls',
      sovereigntyHistory: 'sovereigntyHistory'
    }));
  $('save-territory-config').addEventListener('click', () => saveScenarioConfiguration(
    'territory', 'territory-config',
    ['provinces', 'settlements', 'connections', 'controls', 'sovereigntyHistory'],
    'Territorial'));
  $('load-military-config').addEventListener('click', () => loadScenarioConfiguration(
    'military-config',
    {
      unitTypes: 'militaryUnitTypes',
      commanders: 'militaryCommanders',
      units: 'militaryUnits',
      routes: 'militaryRoutes',
      supplyRoutes: 'supplyRoutes',
      supplyRules: 'supplyRules',
      supplyStocks: 'supplyStocks',
      occupations: 'occupations'
    }));
  $('save-military-config').addEventListener('click', () => saveScenarioConfiguration(
    'military', 'military-config',
    ['unitTypes', 'commanders', 'units', 'routes', 'supplyRoutes',
      'supplyRules', 'supplyStocks', 'occupations'],
    'Military'));
  $('load-demography-config')?.addEventListener('click', () => loadScenarioConfiguration(
    'demography-config', {
      demographicProfiles:'demographicProfiles',
      populationGroups:'populationGroups',
      epidemicDefinitions:'epidemicDefinitions',
      epidemicStarts:'epidemicStarts'
    }));
  $('save-demography-config')?.addEventListener('click', () => saveScenarioConfiguration(
    'demography','demography-config',
    ['demographicProfiles','populationGroups','epidemicDefinitions','epidemicStarts'],
    'Demography and public health'));
  $('load-justice-config')?.addEventListener('click', () => loadScenarioConfiguration(
    'justice-config', {justiceSystems:'justiceSystems'}));
  $('save-justice-config')?.addEventListener('click', () => saveScenarioConfiguration(
    'justice', 'justice-config', ['justiceSystems'], 'Justice'));
  $('load-resources-config')?.addEventListener('click', () => loadScenarioConfiguration(
    'resources-config', {
      resourceCatalog:'resourceCatalog',resourceDeposits:'resourceDeposits',
      agriculturalLand:'agriculturalLand',cropDefinitions:'cropDefinitions',
      farms:'farms',climateZones:'climateZones',environmentalStates:'environmentalStates',
      disasters:'disasters',energySources:'energySources',foodReserves:'foodReserves',
      waterSources:'waterSources',waterDemands:'waterDemands',
      livestockSites:'livestockSites',fishingGrounds:'fishingGrounds',forestAreas:'forestAreas'
    }));
  $('save-resources-config')?.addEventListener('click', () => saveScenarioConfiguration(
    'resources','resources-config',
    ['resourceCatalog','resourceDeposits','agriculturalLand','cropDefinitions','farms',
      'climateZones','environmentalStates','disasters','energySources','foodReserves',
      'waterSources','waterDemands','livestockSites','fishingGrounds','forestAreas'],
    'Resources and environment'));
  $('load-services-config')?.addEventListener('click',()=>loadScenarioConfiguration(
    'services-config',{serviceTypes:'serviceTypes',publicServiceFacilities:'publicServiceFacilities'}));
  $('save-services-config')?.addEventListener('click',()=>saveScenarioConfiguration(
    'services','services-config',['serviceTypes','publicServiceFacilities'],'Public services'));
  $('load-industry-config')?.addEventListener('click',()=>loadScenarioConfiguration(
    'industry-config',{
      industryOccupations:'industryOccupations',labourPools:'labourPools',
      industryWorkplaces:'industryWorkplaces',labourUnions:'labourUnions'
    }));
  $('save-industry-config')?.addEventListener('click',()=>saveScenarioConfiguration(
    'industry','industry-config',
    ['industryOccupations','labourPools','industryWorkplaces','labourUnions'],'Industry and labour'));
  $('load-finance-config')?.addEventListener('click',()=>loadScenarioConfiguration(
    'finance-config',{
      currencies:'currencies',exchangeRates:'exchangeRates',financialBanks:'financialBanks',
      taxRules:'taxRules',priceIndexConfigs:'priceIndexConfigs'
    }));
  $('save-finance-config')?.addEventListener('click',()=>saveScenarioConfiguration(
    'finance','finance-config',
    ['currencies','exchangeRates','financialBanks','taxRules','priceIndexConfigs'],'Finance'));
  $('load-diplomacy-config')?.addEventListener('click',()=>loadScenarioConfiguration(
    'diplomacy-config',{internationalOrganizations:'internationalOrganizations'}));
  $('save-diplomacy-config')?.addEventListener('click',()=>saveScenarioConfiguration(
    'diplomacy','diplomacy-config',['internationalOrganizations'],'International organizations'));
  $('finance-issue-debt')?.addEventListener('click',()=>{
    const territory=onlineGame?.territories?.find(item=>item.index===state.selected);
    sendAction({
      type:'finance.issuePublicDebt',stateId:territory?.stateId,
      bankId:$('finance-bank-select')?.value,
      amount:Number($('finance-debt-amount')?.value),
      annualInterestBasisPoints:Number($('finance-interest-bps')?.value),
      termDays:Number($('finance-term-days')?.value)
    });
  });
  $('finance-repay-debt')?.addEventListener('click',()=>{
    const territory=onlineGame?.territories?.find(item=>item.index===state.selected);
    sendAction({
      type:'finance.repayPublicDebt',stateId:territory?.stateId,
      issueId:$('finance-debt-select')?.value,
      amount:Number($('finance-repay-amount')?.value)
    });
  });
  $('diplomacy-propose-treaty')?.addEventListener('click',()=>{
    const territory=onlineGame?.territories?.find(item=>item.index===state.selected);
    const clauses=[...document.querySelectorAll('.diplomacy-clause:checked')]
      .map(item=>({type:item.value}));
    sendAction({
      type:'diplomacy.proposeTreaty',stateId:territory?.stateId,
      targetStateId:$('diplomacy-proposal-target')?.value,
      clauses,durationDays:Number($('diplomacy-duration')?.value),
      validForDays:Number($('diplomacy-valid-days')?.value),
      terminationNoticeDays:Number($('diplomacy-notice-days')?.value),
      negotiationText:$('diplomacy-negotiation-text')?.value||'',
      visibility:'public'
    });
  });
  $('diplomacy-propose-embargo')?.addEventListener('click',()=>{
    const territory=onlineGame?.territories?.find(item=>item.index===state.selected);
    sendAction({
      type:'diplomacy.proposeOrganizationResolution',stateId:territory?.stateId,
      organizationId:$('diplomacy-organization-select')?.value,
      resolutionType:'trade_embargo',targetStateId:$('diplomacy-sanction-target')?.value,
      durationDays:Number($('diplomacy-sanction-days')?.value),exemptGoodIds:[]
    });
  });
  $('diplomacy-open-conference')?.addEventListener('click',()=>{
    const territory=onlineGame?.territories?.find(item=>item.index===state.selected);
    sendAction({
      type:'diplomacy.openConference',stateId:territory?.stateId,
      participantStateIds:[...($('diplomacy-conference-participants')?.selectedOptions||[])]
        .map(item=>item.value),
      agenda:$('diplomacy-conference-agenda')?.value||''
    });
  });
  document.querySelectorAll('.diplomacy-clause').forEach(item=>
    item.addEventListener('change',renderDiplomacy));
  ['diplomacy-duration','diplomacy-valid-days','diplomacy-notice-days',
    'diplomacy-proposal-target','diplomacy-negotiation-text',
    'diplomacy-organization-select','diplomacy-sanction-target','diplomacy-sanction-days',
    'diplomacy-conference-participants','diplomacy-conference-agenda'].forEach(id=>{
      $(id)?.addEventListener('input',renderDiplomacy);
      $(id)?.addEventListener('change',renderDiplomacy);
    });
  $('load-bureaucracy-config')?.addEventListener('click', () => loadScenarioConfiguration(
    'bureaucracy-config', {
      administrativeAgencies:'administrativeAgencies',
      administrativeDepartments:'administrativeDepartments',civilServants:'civilServants',
      administrativeProcedures:'administrativeProcedures',
      administrativeJurisdictions:'administrativeJurisdictions',
      administrativeBudgets:'administrativeBudgets',publicProjects:'publicProjects',
      procurementVendors:'procurementVendors'
    }));
  $('save-bureaucracy-config')?.addEventListener('click', () => saveScenarioConfiguration(
    'bureaucracy','bureaucracy-config',[
      'administrativeAgencies','administrativeDepartments','civilServants',
      'administrativeProcedures','administrativeJurisdictions','administrativeBudgets',
      'publicProjects','procurementVendors'
    ],'Administration and civil service'));
  $('load-media-config')?.addEventListener('click', () => loadScenarioConfiguration(
    'media-config', {
      mediaOutlets:'mediaOutlets',publicOpinionProfiles:'publicOpinionProfiles',
      mediaRules:'mediaRules'
    }));
  $('save-media-config')?.addEventListener('click', () => saveScenarioConfiguration(
    'media','media-config',['mediaOutlets','publicOpinionProfiles','mediaRules'],
    'Media and public opinion'));
  $('load-security-config')?.addEventListener('click',()=>loadScenarioConfiguration(
    'security-config',{securityAgencies:'securityAgencies',securityAuthorizations:'securityAuthorizations'}));
  $('save-security-config')?.addEventListener('click',()=>saveScenarioConfiguration(
    'security','security-config',['securityAgencies','securityAuthorizations'],
    'Security and intelligence'));
  $('activate-technical-maintenance')?.addEventListener('click',()=>{
    const reason=$('technical-maintenance-reason')?.value||'';
    const result=window.NewWorldMultiplayer?.setTechnicalMaintenance?.(true,reason);
    if(!result?.ok) {
      showMessage(result?.error||'Technical maintenance could not be activated.',true);
      return;
    }
    showMessage(result.published
      ? 'Technical maintenance activated and announced to connected players.'
      : 'Technical maintenance activated locally; the notice will be sent when the relay reconnects.');
    renderMultiplayer();
  });
  $('clear-technical-maintenance')?.addEventListener('click',()=>{
    const result=window.NewWorldMultiplayer?.setTechnicalMaintenance?.(false,'');
    if(!result?.ok) {
      showMessage(result?.error||'Technical maintenance could not be cleared.',true);
      return;
    }
    showMessage(result.published
      ? 'Technical maintenance ended. The clock can continue under the normal world rules.'
      : 'Technical maintenance ended locally; the updated notice will be sent after relay reconnection.');
    renderMultiplayer();
  });
  $('technical-maintenance-reason')?.addEventListener('input',renderMultiplayer);
  $('load-world-events-config')?.addEventListener('click',()=>loadScenarioConfiguration(
    'world-events-config',{eventDefinitions:'eventDefinitions'}));
  $('save-world-events-config')?.addEventListener('click',()=>saveScenarioConfiguration(
    'worldEvents','world-events-config',['eventDefinitions'],'World event scenario'));
  $('load-identity-config')?.addEventListener('click',()=>loadScenarioConfiguration(
    'identity-config',{
      identityGroups:'identityGroups',identityProfiles:'identityProfiles',
      identityOrganizations:'identityOrganizations'
    }));
  $('save-identity-config')?.addEventListener('click',()=>saveScenarioConfiguration(
    'identity','identity-config',
    ['identityGroups','identityProfiles','identityOrganizations'],
    'Identity and community scenario'));
  for(const id of ['identity-org-select','identity-profile-select','identity-program-select',
      'identity-strength']) {
    $(id)?.addEventListener('input',renderIdentity);
    $(id)?.addEventListener('change',renderIdentity);
  }
  $('identity-fund-program')?.addEventListener('click',()=>{
    const stateId=onlineGame?.territories?.find(item=>item.index===state.selected)?.stateId;
    sendAction({
      type:'identity.fundCommunityProgram',stateId,
      organizationId:$('identity-org-select')?.value,
      profileId:$('identity-profile-select')?.value,
      program:$('identity-program-select')?.value,
      strength:Number($('identity-strength')?.value||0)
    });
  });
  $('security-incident-description')?.addEventListener('input',renderSecurity);
  $('security-incident-province')?.addEventListener('change',renderSecurity);
  $('security-incident-type')?.addEventListener('change',renderSecurity);
  $('security-report-incident')?.addEventListener('click',()=>{
    const stateId=onlineGame?.territories?.find(item=>item.index===state.selected)?.stateId;
    sendAction({type:'security.reportIncident',stateId,
      provinceId:$('security-incident-province')?.value,
      incidentType:$('security-incident-type')?.value,
      description:$('security-incident-description')?.value});
  });
  for(const id of ['media-editor-title','media-editor-body','media-editor-type',
      'media-editor-topic','media-editor-stance','media-editor-government','media-editor-sources',
      'media-editor-outlet','media-poll-sample','media-poll-support','media-poll-undecided',
      'media-poll-topic','media-poll-outlet']) {
    $(id)?.addEventListener('input',renderMedia);
    $(id)?.addEventListener('change',renderMedia);
  }
  $('media-publish-article')?.addEventListener('click',()=>{
    const sourceSelect=$('media-editor-sources');
    sendAction({
      type:'media.publishArticle',stateId:onlineGame?.territories?.find(item=>item.index===state.selected)?.stateId,
      outletId:$('media-editor-outlet')?.value,
      topicId:$('media-editor-topic')?.value,
      articleType:$('media-editor-type')?.value,
      stance:$('media-editor-stance')?.value,
      governmentPosition:$('media-editor-government')?.value,
      title:$('media-editor-title')?.value,
      body:$('media-editor-body')?.value,
      sourceEventIds:[...(sourceSelect?.selectedOptions||[])].map(item=>item.value)
    });
  });
  $('media-submit-poll')?.addEventListener('click',()=>{
    const stateId=onlineGame?.territories?.find(item=>item.index===state.selected)?.stateId;
    const sampleSize=Number($('media-poll-sample')?.value||0);
    const undecidedResponses=Math.round(sampleSize*Number($('media-poll-undecided')?.value||0)/100);
    const decided=sampleSize-undecidedResponses;
    const supportResponses=Math.round(decided*Number($('media-poll-support')?.value||0)/100);
    const opposeResponses=decided-supportResponses;
    sendAction({
      type:'media.submitPoll',stateId,
      outletId:$('media-poll-outlet')?.value,
      topicId:$('media-poll-topic')?.value,
      supportResponses,opposeResponses,undecidedResponses
    });
  });
  $('justice-report-description')?.addEventListener('input',()=>{
    const text=$('justice-report-description').value;
    $('justice-report-submit').disabled=!text.trim() || !onlineGame ||
      onlineGame.status!=='running' || !membershipsFor(currentPlayer()).some(item=>
        item.stateId===onlineGame.territories[state.selected]?.stateId);
  });
  $('justice-report-submit')?.addEventListener('click',()=>{
    const territory=onlineGame?.territories.find(item=>item.index===state.selected);
    const description=$('justice-report-description').value;
    if(!territory || !description.trim()) return;
    sendAction({type:'justice.reportIncident',stateId:territory.stateId,
      provinceId:$('justice-report-province').value,description});
    $('justice-report-description').value='';
    renderJustice();
  });
  $('load-technology-config').addEventListener('click', () => loadScenarioConfiguration(
    'technology-config',
    {
      technologies: 'technologies',
      researchInstitutions: 'researchInstitutions',
      researchProjects: 'researchProjects',
      technologyUnlocks: 'technologyUnlocks',
      technologyAdoptions: 'technologyAdoptions'
    }));
  $('save-technology-config').addEventListener('click', () => saveScenarioConfiguration(
    'technology', 'technology-config',
    ['technologies', 'researchInstitutions', 'researchProjects', 'technologyUnlocks', 'technologyAdoptions'],
    'Technology'));
  $('copy-invite').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText($('invite-share').value);
      showMessage('Invitation code copied. Share it only with people you trust.');
    } catch (error) {
      console.error('[new-world] Could not copy the invitation code:', error);
      $('invite-share').focus();
      $('invite-share').select();
      showMessage('Automatic copy was blocked. Select and copy the invitation code manually.', true);
    }
  });
  window.setInterval(renderWorldClock,250);
  update();
  if (!onlineSession) showMessage('Create a world to host it on this device, or join a host with an invitation code.');
  if (onlineSession?.gameId && onlineSession?.playerToken) restoreSession();
})();
