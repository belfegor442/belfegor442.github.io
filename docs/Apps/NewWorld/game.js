(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const names = [
    'Kingdom of Coimbrila', 'United Provinces of Gania', 'Chungia', 'Calcilacia',
    'Pician Empire', 'Meityeun Theocracy', 'Swabing', 'Alba', 'Knosian Despotate',
    'Kalestos', 'Gorkirch', 'Duchy of Shonewesia', 'Shahtehaq', 'Kvinian Empire',
    'Shi', 'Kueopia'
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
    activity: ['Preview only. Connect to a multiplayer server to load the authoritative world.']
  };
  const buildingTypes = [
    {id:'farm',name:'FARM',cost:120,income:18,icon:'♧',desc:'Food production and rural employment.'},
    {id:'market',name:'MARKET',cost:220,income:34,icon:'⌂',desc:'Local exchange and commercial activity.'},
    {id:'workshop',name:'WORKSHOP',cost:360,income:52,icon:'⚒',desc:'Small-scale manufacturing.'},
    {id:'housing',name:'HOUSING',cost:180,income:8,icon:'▦',desc:'Raises the settlement population.'}
  ];
  const SESSION_KEY = 'new-world-session-v1';
  const API_KEY = 'new-world-api-v1';
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

  function removePendingOrder(orderId) {
    const remaining = getPendingOrders().filter(order => order.orderId !== orderId);
    if (savePendingOrders(remaining)) {
      sentOrderIds.delete(orderId);
      renderMultiplayer();
    }
  }

  function replayPendingOrders(currentSocket) {
    if (currentSocket !== socket || currentSocket.readyState !== WebSocket.OPEN ||
        sentOrderIds.size > 0) return;
    const order = ordersForCurrentSession()[0];
    if (!order || sentOrderIds.has(order.orderId)) return;
    try {
      currentSocket.send(JSON.stringify(order));
      sentOrderIds.add(order.orderId);
    } catch (error) {
      console.error('[new-world] Could not resend pending order:', error);
      showMessage('An order is queued and will be retried after reconnecting.', true);
    }
  }

  let state = structuredClone(initial);
  const savedSession = readJson(SESSION_KEY);
  let onlineSession = savedSession?.gameId && savedSession?.playerId && savedSession?.playerToken
    ? savedSession
    : null;
  let onlineGame = null;
  let offlineBackup = null;
  let socket = null;
  let reconnectTimer = null;
  let manuallyDisconnected = false;
  let sentOrderIds = new Set();
  let selectedPlot = null;
  let zoom = 1;
  let pan = {x: 0, y: 0};
  let drag = null;
  let hoveredState = null;

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

  function update() {
    $('treasury').textContent = onlineGame ? money(state.treasury) : '—';
    $('population').textContent = onlineGame ? totalPopulation().toLocaleString('en-US') : '—';
    $('balance').textContent = onlineGame
      ? (balance() >= 0 ? '+' : '−') + money(Math.abs(balance()))
      : '—';
    $('date-label').textContent = isOnline()
      ? formatWorldDate(onlineGame?.worldDate) + ' / DAY ' + String(onlineGame?.day || 1).padStart(3, '0')
      : 'MULTIPLAYER REQUIRED';
    $('city-income').textContent = onlineGame ? money(cityIncome()) : '—';
    $('ledger-treasury').textContent = onlineGame ? money(state.treasury) : '—';
    $('ledger-territory').textContent = onlineGame ? money(ownedIncome()) : '—';
    $('ledger-city').textContent = onlineGame ? money(cityIncome()) : '—';
    $('ledger-cost').textContent = onlineGame ? '−' + money(state.governmentFinance?.upkeep || 0) : '—';
    $('ledger-balance').textContent = onlineGame
      ? (balance() >= 0 ? '+' : '−') + money(Math.abs(balance()))
      : '—';
    $('activity').innerHTML = state.activity.slice(0, 8)
      .map(item => '<div class="activity-item"><small>WORLD RECORD</small>' + escapeHtml(item) + '</div>').join('');
    $('world-mode').textContent = isOnline() ? 'PRIVATE MULTIPLAYER' : 'MULTIPLAYER REQUIRED';
    $('legend-owned').textContent = onlineGame ? 'YOUR GOVERNMENT' : 'GOVERNMENT MEMBERSHIP';
    $('legend-other').textContent = onlineGame ? 'OTHER STATES' : 'WORLD DATA UNAVAILABLE';
    $('save-btn').hidden = true;
    $('next-month').hidden = true;
    $('world-time').hidden = !isOnline();
    $('world-time').textContent = isOnline()
      ? onlineGame?.started
        ? onlineGame.paused ? 'PAUSED · SERVER CLOCK' : '1 DAY / 5 MIN · SERVER CLOCK'
        : 'LOBBY · CLOCK PAUSED'
      : '';
    renderCity();
    renderOptions();
    renderMultiplayer();
    renderGovernment();
    if (state.selected !== null) selectState(state.selected, false);
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

  function renderGovernment() {
    const territory = onlineGame?.territories.find(item => item.index === state.selected);
    const system = onlineGame?.politicalSystems
      ?.find(item => item.stateId === territory?.stateId);
    const summary = $('government-summary');
    const institutions = $('institution-list');
    const parties = $('party-list');
    const laws = $('law-list');
    const decisions = $('decision-list');
    for (const list of [summary, institutions, parties, laws, decisions]) list.replaceChildren();

    $('government-title').textContent = territory?.name || 'Government';
    if (!onlineGame || !territory || !system) {
      $('government-status').textContent =
        'Connect to a multiplayer world to load authoritative constitutional data.';
      $('propose-law').disabled = true;
      $('approve-budget').disabled = true;
      $('law-restriction').textContent = 'Law-making requires an explicitly configured Constitution and permitted government membership.';
      $('budget-restriction').textContent = 'Budget changes require an explicitly configured constitutional competence.';
      addPoliticalRow(summary, 'No political data', 'No authoritative State political system is available.');
      return;
    }

    const constitution = system.constitution;
    $('government-status').textContent = system.configurationPending
      ? 'Political configuration is incomplete; powers are available only where constitutional procedures are explicitly configured.'
      : 'Political powers and procedures are governed by this State’s configured constitution.';
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
    const canApproveBudget = onlineGame.status === 'running' &&
      system.government &&
      membership &&
      budgetRule?.proposerPermissionSetIds?.includes(membership.permissionSetId);
    const budgetInput = $('budget-amount');
    if (system.government && document.activeElement !== budgetInput && !budgetInput.value)
      budgetInput.value = String(system.government.budget);
    $('approve-budget').disabled = !canApproveBudget;
    $('budget-restriction').textContent = canApproveBudget
      ? 'Authority: ' + budgetRule.legalBasis + (budgetRule.approvalRequired
        ? '. The configured institution must approve this budget plan.'
        : '. This configured procedure applies the budget plan directly.')
      : 'Budget changes are unavailable: the government, constitutional competence, or permission is not configured.';

    const appointmentRule = constitution?.competenceRules
      ?.find(rule => rule.competence === 'appointOffice');
    const canAppointOffice = onlineGame.status === 'running' &&
      membership &&
      appointmentRule?.proposerPermissionSetIds?.includes(membership.permissionSetId);
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


    if (system.decisions.length) {
      for (const decision of [...system.decisions].reverse()) {
        const decisionRule = constitution?.competenceRules
          ?.find(rule => rule.competence === decision.competence);
        const row = addPoliticalRow(
          decisions,
          decision.title + ' · ' + String(decision.status).replaceAll(/([A-Z])/g, ' $1').toUpperCase(),
          decision.text + ' · ' + decision.votes.length + ' vote(s) · ' + decision.legalBasis);
        const canVote = onlineGame.status === 'running' &&
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
      membership &&
      lawRule?.proposerPermissionSetIds?.includes(membership.permissionSetId);
    $('propose-law').disabled = !canProposeLaw;
    $('law-restriction').textContent = canProposeLaw
      ? 'Authority: ' + lawRule.legalBasis + (lawRule.approvalRequired
        ? '. Approval requires ' + lawRule.minimumVotes + ' vote(s) and ' +
          lawRule.approvalThresholdPercent + '% of ' +
          String(lawRule.approvalThresholdBasis).replaceAll(/([A-Z])/g, ' $1').toLowerCase() + '.'
        : '. This configured procedure does not require approval.')
      : 'Law proposals are unavailable: the Constitution, State membership, or configured permission does not authorize this action.';
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
  }

  function selectState(index, notify = true) {
    if (index < 0 || index >= 16) return;
    state.selected = index;
    const territory = state.states[index];
    const territoryView = onlineGame?.territories[index];
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
        ? 'An independent territory. You can establish an administration by investing in local governance.'
        : 'This state has no government membership yet.';
    } else {
      $('state-description').textContent = 'Connect to a multiplayer server to inspect the authoritative world.';
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
        : owner ? owner.name.toUpperCase() : onlineGame ? 'INDEPENDENT' : 'NOT CONNECTED';

    const claimButton = $('claim-btn');
    if (mine || isGovernmentMember) {
      claimButton.disabled = true;
      claimButton.innerHTML = isGovernmentMember ? 'YOUR GOVERNMENT <span>✓</span>' : 'ALREADY ADMINISTERED <span>✓</span>';
    } else if (!isOnline()) {
      claimButton.disabled = true;
      claimButton.textContent = 'MULTIPLAYER SERVER REQUIRED';
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
    } else if (state.treasury < 450) {
      claimButton.disabled = true;
      claimButton.innerHTML = 'INSUFFICIENT TREASURY <span>¤ 450</span>';
    } else {
      claimButton.disabled = isOnline() && socket?.readyState !== WebSocket.OPEN;
      claimButton.innerHTML = 'ESTABLISH ADMINISTRATION <span>¤ 450</span>';
    }
    if (notify) toast(territory.name.toUpperCase() + ' SELECTED');
    highlightMap(index);
  }

  function highlightMap(selectedIndex) {
    const object = $('world-map');
    try {
      const document = object.contentDocument;
      if (!document) return;
      for (let index = 0; index < 16; index++) {
        const path = document.getElementById('state' + (index + 1));
        if (!path) continue;
        const territory = onlineGame?.territories[index];
        const owner = onlineGame?.players.find(player => player.id === territory?.ownerPlayerId);
        const governmentMembers = governmentMembersFor(territory);
        const isGovernmentMember = membershipsFor(currentPlayer())
          .some(membership => membership.stateId === territory?.stateId);
        path.style.cursor = 'pointer';
        path.style.pointerEvents = 'all';
        path.style.fill = state.owned.includes(index) || isGovernmentMember
          ? '#8d9f72'
          : governmentMembers.length || owner ? '#b88470' : '';
        path.style.stroke = governmentMembers.length || owner ? '#d8e6ae' : '#59645c';
        path.style.strokeWidth = index === selectedIndex ? '3' : '1.1';
        path.style.filter = index === selectedIndex ? 'brightness(1.18)' : 'none';
      }
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
    fallback.querySelectorAll('[data-state]').forEach(button =>
      button.addEventListener('click', () => selectState(Number(button.dataset.state))));
  }

  function territoryAtPoint(svgDocument, event) {
    return svgDocument.elementsFromPoint(event.clientX, event.clientY)
      .find(element => /^state(?:[1-9]|1[0-6])$/.test(element.id)) || null;
  }

  function territoryAtEvent(svgDocument, event) {
    const label = event.target.closest?.('[id^="stateLabel"]');
    const labelMatch = label?.id.match(/^stateLabel([1-9]|1[0-6])$/);
    if (labelMatch) return svgDocument.getElementById('state' + labelMatch[1]);
    const target = event.target.closest?.('[id^="state"]');
    if (target && /^state(?:[1-9]|1[0-6])$/.test(target.id)) return target;
    return territoryAtPoint(svgDocument, event);
  }

  const map = $('world-map');
  const viewport = $('map-viewport');
  const mapTooltip = $('map-tooltip');

  function hideMapTooltip() {
    mapTooltip.hidden = true;
    hoveredState = null;
  }

  map.addEventListener('load', () => {
    map.dataset.loaded = 'true';
    $('map-fallback').hidden = true;
    const svgDocument = map.contentDocument;
    if (!svgDocument) {
      console.error('[new-world] The Beleland SVG loaded without an accessible document.');
      renderFallback();
      return;
    }
    let matched = 0;
    for (let index = 0; index < 16; index++) {
      const path = svgDocument.getElementById('state' + (index + 1));
      if (!path) continue;
      matched++;
      path.style.pointerEvents = 'all';
      path.setAttribute('aria-label', names[index]);
      let title = path.querySelector('title');
      if (!title) {
        title = svgDocument.createElementNS('http://www.w3.org/2000/svg', 'title');
        path.prepend(title);
      }
      title.textContent = names[index];
    }
    if (matched !== 16) {
      console.error('[new-world] Expected 16 selectable territories in Beleland; found ' + matched + '.');
      renderFallback();
      return;
    }
    svgDocument.addEventListener('click', event => {
      const path = territoryAtEvent(svgDocument, event);
      if (path) selectState(Number(path.id.slice(5)) - 1);
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
      const path = territoryAtEvent(svgDocument, event);
      if (!path) {
        hideMapTooltip();
        return;
      }
      const index = Number(path.id.slice(5)) - 1;
      if (hoveredState !== path) {
        if (hoveredState) hoveredState.style.filter =
          Number(hoveredState.id.slice(5)) - 1 === state.selected ? 'brightness(1.18)' : 'none';
        hoveredState = path;
        path.style.filter = 'brightness(1.15)';
      }
      const mapRect = map.getBoundingClientRect();
      const svgRect = svgDocument.documentElement.getBoundingClientRect();
      const viewRect = viewport.getBoundingClientRect();
      mapTooltip.textContent = names[index] + ' · ' + state.states[index].pop.toLocaleString('en-US') + ' POP';
      mapTooltip.style.left = (mapRect.left - viewRect.left + event.clientX * mapRect.width / svgRect.width) + 'px';
      mapTooltip.style.top = (mapRect.top - viewRect.top + event.clientY * mapRect.height / svgRect.height) + 'px';
      mapTooltip.hidden = false;
    });
    svgDocument.addEventListener('pointerleave', hideMapTooltip);
    svgDocument.addEventListener('pointerup', () => { drag = null; });
    svgDocument.addEventListener('pointercancel', () => { drag = null; });
    svgDocument.addEventListener('wheel', event => {
      event.preventDefault();
      setZoom(zoom * (event.deltaY < 0 ? 1.08 : .92));
    }, {passive: false});
    highlightMap(state.selected);
  });
  map.addEventListener('error', renderFallback);
  setTimeout(() => {
    if (map.dataset.loaded !== 'true') renderFallback();
  }, 1800);

  function renderCity() {
    const grid = $('city-grid');
    grid.innerHTML = '';
    for (let index = 0; index < 144; index++) {
      const building = state.buildings[index];
      const element = document.createElement('button');
      element.className = 'plot' + (building ? ' built' : '') + (selectedPlot === index ? ' selected' : '');
      element.type = 'button';
      element.title = building ? building.name : 'Empty plot';
      element.innerHTML = building ? building.icon + '<span class="plot-label">' + building.name + '</span>' : '·';
      element.addEventListener('click', () => {
        selectedPlot = index;
        renderCity();
        $('plot-title').textContent = building ? building.name : 'Plot ' + (index + 1);
        $('plot-description').textContent = building
          ? 'This building generates ' + money(building.income) + ' per month.'
          : 'Choose a building to develop this plot.';
        renderOptions();
      });
      grid.appendChild(element);
    }
  }

  function renderOptions() {
    const building = state.buildings[selectedPlot];
    const player = currentPlayer();
    const canBuild = onlineGame?.started && membershipsFor(player).length > 0 &&
      socket?.readyState === WebSocket.OPEN;
    $('building-options').innerHTML = building
      ? '<p class="muted">This plot is developed. Buildings cannot currently be demolished.</p>'
      : buildingTypes.map(item =>
        '<button class="build-option" data-build="' + item.id + '" ' +
        (state.treasury < item.cost || selectedPlot === null || !canBuild ? 'disabled' : '') + '>' +
        item.icon + ' ' + item.name + '<span>' + money(item.cost) + '</span></button>').join('');
    $('building-options').querySelectorAll('[data-build]').forEach(button =>
      button.addEventListener('click', () => build(button.dataset.build)));
  }

  function build(id) {
    const building = buildingTypes.find(item => item.id === id);
    if (!building || selectedPlot === null || state.buildings[selectedPlot] || state.treasury < building.cost) return;
    sendAction({type: 'build', plotIndex: selectedPlot, buildingId: id});
  }

  function getApiBase() {
    const raw = $('api-url').value.trim();
    if (!raw) throw new Error('Enter the URL of the multiplayer server.');
    let url;
    try {
      url = new URL(raw);
    } catch {
      throw new Error('The server URL is not valid.');
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
        url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
      throw new Error('Use an HTTP(S) server origin without a path, query, or credentials.');
    }
    const base = url.origin;
    localStorage.setItem(API_KEY, base);
    return base;
  }

  async function apiRequest(path, options = {}, token = null) {
    const base = getApiBase();
    const headers = new Headers(options.headers || {});
    if (options.body) headers.set('Content-Type', 'application/json');
    if (token) headers.set('Authorization', 'Bearer ' + token);
    let response;
    try {
      response = await fetch(base + path, {...options, headers});
    } catch (error) {
      throw new Error('Cannot reach the game server. Check its URL, availability, and allowed website origins.');
    }
    const text = await response.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!response.ok) throw new Error(data?.error || data?.detail || 'Server returned HTTP ' + response.status + '.');
    return data;
  }

  function storeSession(session) {
    onlineSession = session;
    manuallyDisconnected = false;
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
    $('server-status').textContent = 'Server unavailable.';
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

  async function createWorld() {
    try {
      const response = await apiRequest('/api/games', {
        method: 'POST',
        body: JSON.stringify({playerName: playerName()})
      });
      offlineBackup = structuredClone(state);
      storeSession({
        gameId: response.gameId,
        playerId: response.playerId,
        playerToken: response.playerToken,
        inviteCode: response.inviteCode
      });
      applySnapshot(response.game);
      openSocket();
      showMessage('World created. Copy the invitation code and assign a state to every player.');
      toast('PRIVATE WORLD CREATED');
    } catch (error) {
      showServerError(error);
    }
  }

  async function joinWorld() {
    try {
      const response = await apiRequest('/api/games/join', {
        method: 'POST',
        body: JSON.stringify({inviteCode: $('invite-code').value.trim(), playerName: playerName()})
      });
      offlineBackup = structuredClone(state);
      storeSession({
        gameId: response.gameId,
        playerId: response.playerId,
        playerToken: response.playerToken,
        inviteCode: ''
      });
      applySnapshot(response.game);
      openSocket();
      showMessage('You joined the lobby. The host must assign your state.');
      toast('JOINED PRIVATE WORLD');
    } catch (error) {
      showServerError(error);
    }
  }

  async function restoreSession() {
    if (!onlineSession) return;
    manuallyDisconnected = false;
    try {
      if (!offlineBackup) offlineBackup = structuredClone(state);
      const lastEventSequence = Number(onlineSession.lastEventSequence) || 0;
      const game = await apiRequest(
        '/api/games/' + encodeURIComponent(onlineSession.gameId) +
          '?afterEventSequence=' + encodeURIComponent(lastEventSequence),
        {},
        onlineSession.playerToken);
      applySnapshot(game);
      openSocket();
    } catch (error) {
      $('server-status').textContent = 'Reconnect required.';
      showServerError(error);
    }
  }

  function applySnapshot(game) {
    const lastEventSequence = Number(onlineSession?.lastEventSequence) || 0;
    const recoveredEvents = (game.events || []).filter(event => event.sequence > lastEventSequence);
    if (recoveredEvents.length) {
      game.activity = [
        ...recoveredEvents.map(event => formatWorldDate(event.worldDate) + ' · ' + event.description),
        ...(game.activity || [])
      ].slice(0, 20);
    }
    onlineGame = game;
    const player = currentPlayer();
    if (!player) {
      showMessage('Your player record is not in this world. Rejoin using a valid invitation.', true);
      return;
    }
    if (onlineSession && game.eventSequence > lastEventSequence) {
      storeSession({...onlineSession, lastEventSequence: game.eventSequence});
    }
    const governmentIndex = player.countryIndex ?? membershipsFor(player)[0]?.stateIndex;
    const governmentFinance = game.territories.find(territory => territory.index === governmentIndex) || null;
    state = {
      ...state,
      treasury: governmentFinance?.treasury ?? player.treasury,
      governmentFinance,
      selected: governmentIndex ?? player.countryIndex ?? state.selected,
      owned: game.territories.filter(territory => territory.ownerPlayerId === player.id)
        .map(territory => territory.index),
      states: game.territories.map(territory => ({
        name: territory.name,
        pop: territory.population,
        prosperity: territory.prosperity,
        infra: territory.infrastructure,
        owner: governmentMembersFor(territory).map(member => member.name).join(', ') ||
          game.players.find(owner => owner.id === territory.ownerPlayerId)?.name || 'Independent'
      })),
      buildings: {...player.buildings},
      activity: [...game.activity]
    };
    update();
  }

  function openSocket() {
    if (!onlineSession) return;
    let base;
    try {
      base = getApiBase();
    } catch (error) {
      showServerError(error);
      return;
    }
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
    const socketUrl = base.replace(/^http/, 'ws') + '/ws';
    const currentSocket = new WebSocket(socketUrl);
    socket = currentSocket;
    sentOrderIds = new Set();
    $('server-status').textContent = 'Connecting to the world…';
    currentSocket.addEventListener('open', () => {
      currentSocket.send(JSON.stringify({
        type: 'authenticate',
        gameId: onlineSession.gameId,
        token: onlineSession.playerToken,
        lastEventSequence: Number(onlineSession.lastEventSequence) || 0
      }));
    });
    currentSocket.addEventListener('message', event => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch (error) {
        console.error('[new-world] The server sent an invalid message:', error);
        showMessage('Received an unreadable update from the server.', true);
        return;
      }
      if (message.type === 'snapshot' && message.game) {
        applySnapshot(message.game);
        replayPendingOrders(currentSocket);
        $('server-status').textContent = 'Connected to the shared world.';
        $('server-status').classList.remove('error');
      } else if (message.type === 'orderResult' && message.order) {
        removePendingOrder(message.order.id);
        if (message.order.accepted) {
          showMessage(message.order.replayed ? 'Order already applied; world state synchronized.' : 'Order accepted.');
        } else {
          showMessage(orderErrorMessage(message.order.code), true);
        }
        if (message.order.replayed) replayPendingOrders(currentSocket);
      } else if (message.type === 'error') {
        showMessage(message.error || 'The server rejected the request.', true);
      }
    });
    currentSocket.addEventListener('error', () => {
      $('server-status').textContent = 'Connection error.';
      $('server-status').classList.add('error');
    });
    currentSocket.addEventListener('close', () => {
      if (socket === currentSocket) socket = null;
      if (!onlineSession || manuallyDisconnected) return;
      $('server-status').textContent = 'Disconnected — reconnecting…';
      renderMultiplayer();
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(restoreSession, 3000);
    });
  }

  function sendAction(action) {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      showMessage('Not connected to the game server. Reconnect before acting.', true);
      return;
    }
    const player = currentPlayer();
    const activeMemberships = membershipsFor(player);
    const selectedMembership = action.stateId
      ? activeMemberships.find(membership => membership.stateId === action.stateId)
      : activeMemberships.find(membership => membership.stateIndex === player?.countryIndex) ||
        activeMemberships[0];
    const order = {
      ...action,
      orderId: crypto.randomUUID(),
      gameId: onlineSession.gameId,
      playerId: onlineSession.playerId,
      expectedWorldVersion: onlineGame?.worldVersion,
      stateId: selectedMembership?.stateId ?? action.stateId ?? null
    };
    if (!order.expectedWorldVersion || !order.stateId) {
      showMessage('The authoritative world version or government membership is unavailable.', true);
      return;
    }
    const queued = [...getPendingOrders(), order];
    if (!savePendingOrders(queued)) return;
    renderMultiplayer();
    replayPendingOrders(socket);
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
      INSUFFICIENT_FUNDS: 'The government treasury does not have enough funds.',
      TARGET_UNAVAILABLE: 'The selected target is no longer available.',
      TARGET_DATE_IN_PAST: 'The requested world date has already passed.',
      SCHEDULED_ORDERS_UNSUPPORTED: 'Future-dated orders are not available yet.',
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
      ORDER_ID_REUSED: 'This order ID was already used for a different request.'
    };
    return messages[code] || 'The server rejected the order.';
  }

  async function assignCountry(playerId, countryIndex) {
    try {
      const game = await apiRequest('/api/games/' + encodeURIComponent(onlineSession.gameId) + '/assign', {
        method: 'POST',
        body: JSON.stringify({playerId, countryIndex})
      }, onlineSession.playerToken);
      applySnapshot(game);
      await requestSnapshotBroadcast();
      showMessage('State assignment saved.');
    } catch (error) {
      showServerError(error);
    }
  }

  async function requestSnapshotBroadcast() {
    if (socket?.readyState === WebSocket.OPEN) return;
    await restoreSession();
  }

  async function startWorld() {
    try {
      const game = await apiRequest('/api/games/' + encodeURIComponent(onlineSession.gameId) + '/start', {
        method: 'POST',
        body: '{}'
      }, onlineSession.playerToken);
      applySnapshot(game);
      showMessage('The world has started. The server advances one day every five minutes while a player is connected.');
      toast('WORLD STARTED');
    } catch (error) {
      showServerError(error);
    }
  }

  function renderMultiplayer() {
    const sessionPanel = $('multiplayer-session');
    $('multiplayer-actions').hidden = isOnline();
    sessionPanel.hidden = !isOnline();
    if (!onlineSession) return;

    const pendingCount = ordersForCurrentSession().length;
    $('pending-orders-status').textContent = pendingCount
      ? pendingCount + ' pending order' + (pendingCount === 1 ? '' : 's') + ' · saved on this device'
      : 'No pending orders.';
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
      for (const player of onlineGame.players) {
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

        if (isHost && !onlineGame.started) {
          const assignment = document.createElement('div');
          assignment.className = 'player-assignment';
          const select = document.createElement('select');
          select.setAttribute('aria-label', 'State for ' + player.name);
          const unassigned = document.createElement('option');
          unassigned.value = '';
          unassigned.textContent = 'Unassigned';
          select.appendChild(unassigned);
          for (const territory of onlineGame.territories) {
            const option = document.createElement('option');
            option.value = String(territory.index);
            option.textContent = territory.name;
            option.selected = player.countryIndex === territory.index;
            select.appendChild(option);
          }
          const saveAssignment = document.createElement('button');
          saveAssignment.type = 'button';
          saveAssignment.textContent = 'ASSIGN';
          saveAssignment.addEventListener('click', () => assignCountry(
            player.id, select.value === '' ? null : Number(select.value)));
          assignment.append(select, saveAssignment);
          row.appendChild(assignment);
        }
        list.appendChild(row);
      }

      const startButton = $('start-world');
      startButton.hidden = !isHost || onlineGame.started;
      startButton.disabled = onlineGame.players.some(player => membershipsFor(player).length === 0);

      const pauseControls = $('pause-controls');
      pauseControls.hidden = !onlineGame.started;
      if (onlineGame.started) {
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
        voteButton.disabled = !currentPlayer()?.connected || socket?.readyState !== WebSocket.OPEN;
      }
    } else {
      const status = document.createElement('p');
      status.className = 'muted';
      status.textContent = 'Waiting for the server to restore the lobby.';
      list.appendChild(status);
      $('start-world').hidden = true;
      $('pause-controls').hidden = true;
    }
  }

  function disconnect() {
    manuallyDisconnected = true;
    clearTimeout(reconnectTimer);
    if (socket) {
      socket.close();
      socket = null;
    }
    onlineSession = null;
    onlineGame = null;
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch (error) {
      console.error('[new-world] Could not clear the stored multiplayer token:', error);
      showMessage('This browser could not clear the saved reconnection token.', true);
    }
    if (offlineBackup) state = offlineBackup;
    offlineBackup = null;
    $('server-status').textContent = 'Disconnected from the world.';
    update();
    toast('DISCONNECTED ON THIS DEVICE');
  }

  $('claim-btn').addEventListener('click', () => {
    const index = state.selected;
    if (state.owned.includes(index) || state.treasury < 450) return;
    if (!isOnline()) {
      showMessage('Preview data only. Connect to a multiplayer server to play.');
      return;
    }
    sendAction({type: 'claim', territoryIndex: index});
  });
  $('pause-vote').addEventListener('click', () => {
    if (!onlineGame?.started) return;
    sendAction({type: onlineGame.paused ? 'resume' : 'pause'});
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
    if (!territory || $('propose-law').disabled) return;
    sendAction({
      type: 'proposeLaw',
      stateId: territory.stateId,
      decisionTitle: $('law-title').value,
      decisionText: $('law-text').value
    });
  });

  document.querySelectorAll('.tab').forEach(button => button.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(tab => {
      const active = tab === button;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
    });
    document.querySelectorAll('.view').forEach(view => view.classList.remove('active'));
    $(button.dataset.view + '-view').classList.add('active');
  }));
  $('zoom-in').addEventListener('click', () => setZoom(zoom * 1.15));
  $('zoom-out').addEventListener('click', () => setZoom(zoom / 1.15));
  $('reset-map').addEventListener('click', () => {
    zoom = 1;
    pan = {x: 0, y: 0};
    applyMapTransform();
  });
  function setZoom(value) {
    zoom = Math.max(.65, Math.min(3, value));
    applyMapTransform();
  }
  function applyMapTransform() {
    $('map-stage').style.transform = 'translate(' + pan.x + 'px,' + pan.y + 'px) scale(' + zoom + ')';
  }
  viewport.addEventListener('pointerdown', event => {
    if (event.target.closest('object') && event.target !== viewport) return;
    drag = {x: event.clientX - pan.x, y: event.clientY - pan.y};
    viewport.setPointerCapture(event.pointerId);
  });
  viewport.addEventListener('pointermove', event => {
    if (!drag) return;
    pan = {x: event.clientX - drag.x, y: event.clientY - drag.y};
    applyMapTransform();
  });
  viewport.addEventListener('pointerup', () => { drag = null; });
  viewport.addEventListener('wheel', event => {
    event.preventDefault();
    setZoom(zoom * (event.deltaY < 0 ? 1.08 : .92));
  }, {passive: false});

  $('api-url').value = localStorage.getItem(API_KEY) || window.NEW_WORLD_API || '';
  $('player-name').value = localStorage.getItem(NAME_KEY) || '';
  $('test-server').addEventListener('click', async () => {
    try {
      const response = await apiRequest('/api/health');
      $('server-status').textContent = response.status === 'ready'
        ? 'Server and database are ready.'
        : 'Unexpected health response.';
      showMessage(response.status === 'ready' ? 'The multiplayer server is ready.' : 'Unexpected health response.',
        response.status !== 'ready');
    } catch (error) {
      showServerError(error);
    }
  });
  $('create-world').addEventListener('click', createWorld);
  $('join-world').addEventListener('click', joinWorld);
  $('reconnect-world').addEventListener('click', restoreSession);
  $('start-world').addEventListener('click', startWorld);
  $('leave-world').addEventListener('click', disconnect);
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
  update();
  if (!onlineSession) showMessage('Preview data only. Connect to a multiplayer server to play.');
  if (onlineSession?.gameId && onlineSession?.playerToken) restoreSession();
})();
