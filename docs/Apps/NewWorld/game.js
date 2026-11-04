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
    selected: 0,
    owned: [0],
    states: names.map((name, i) => ({
      name,
      pop: Math.round(26000 + ((i * 7919 + 1337) % 56000)),
      prosperity: 42 + (i * 13 % 48),
      infra: 1 + (i % 4),
      owner: i === 0 ? 'Your administration' : 'Independent'
    })),
    buildings: {},
    activity: ['World initialized. Your administration controls the capital district.']
  };
  const buildingTypes = [
    {id:'farm',name:'FARM',cost:120,income:18,icon:'♧',desc:'Food production and rural employment.'},
    {id:'market',name:'MARKET',cost:220,income:34,icon:'⌂',desc:'Local exchange and commercial activity.'},
    {id:'workshop',name:'WORKSHOP',cost:360,income:52,icon:'⚒',desc:'Small-scale manufacturing.'},
    {id:'housing',name:'HOUSING',cost:180,income:8,icon:'▦',desc:'Raises the settlement population.'}
  ];
  const SAVE_KEY = 'new-world-save-v1';
  const SESSION_KEY = 'new-world-session-v1';
  const API_KEY = 'new-world-api-v1';
  const NAME_KEY = 'new-world-player-name-v1';

  function readJson(key) {
    try {
      const value = localStorage.getItem(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      console.error('[new-world] Could not read browser storage:', error);
      return null;
    }
  }

  function load() {
    const saved = readJson(SAVE_KEY);
    if (!saved) return structuredClone(initial);
    if (saved.states?.length === 16 && Array.isArray(saved.owned) && saved.buildings &&
        typeof saved.buildings === 'object') {
      return {...structuredClone(initial), ...saved};
    }
    console.error('[new-world] The local save has an invalid shape.');
    toast('SAVE COULD NOT BE LOADED — NEW WORLD STARTED');
    return structuredClone(initial);
  }

  let state = load();
  const savedSession = readJson(SESSION_KEY);
  let onlineSession = savedSession?.gameId && savedSession?.playerId && savedSession?.playerToken
    ? savedSession
    : null;
  let onlineGame = null;
  let offlineBackup = null;
  let socket = null;
  let reconnectTimer = null;
  let manuallyDisconnected = false;
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
    return Object.values(state.buildings).reduce((sum, building) => sum + building.income, 85);
  }

  function ownedIncome() {
    return state.owned.reduce((sum, index) => {
      const territory = state.states[index];
      return sum + Math.round(territory.pop / 1500 * (territory.prosperity / 100));
    }, 0);
  }

  function balance() {
    return cityIncome() + ownedIncome() - Object.keys(state.buildings).length * 2;
  }

  function totalPopulation() {
    return state.owned.reduce((sum, index) => sum + state.states[index].pop, 0);
  }

  function currentPlayer() {
    return onlineGame?.players.find(player => player.id === onlineSession?.playerId) || null;
  }

  function isOnline() {
    return onlineSession !== null;
  }

  function update() {
    $('treasury').textContent = money(state.treasury);
    $('population').textContent = totalPopulation().toLocaleString('en-US');
    $('balance').textContent = (balance() >= 0 ? '+' : '−') + money(Math.abs(balance()));
    $('date-label').textContent = isOnline()
      ? 'YEAR ' + String(state.year).padStart(2, '0') + ' / DAY ' + String(onlineGame?.day || 1).padStart(3, '0')
      : 'YEAR ' + String(state.year).padStart(2, '0') + ' / ' + ['SPRING', 'SUMMER', 'AUTUMN', 'WINTER'][state.month];
    $('city-income').textContent = money(cityIncome());
    $('ledger-treasury').textContent = money(state.treasury);
    $('ledger-territory').textContent = money(ownedIncome());
    $('ledger-city').textContent = money(cityIncome());
    $('ledger-cost').textContent = '−' + money(Object.keys(state.buildings).length * 2);
    $('ledger-balance').textContent = (balance() >= 0 ? '+' : '−') + money(Math.abs(balance()));
    $('activity').innerHTML = state.activity.slice(0, 8)
      .map(item => '<div class="activity-item"><small>WORLD RECORD</small>' + escapeHtml(item) + '</div>').join('');
    $('world-mode').textContent = isOnline() ? 'PRIVATE MULTIPLAYER' : 'LOCAL PROTOTYPE 0.1.0';
    $('save-btn').hidden = isOnline();
    $('next-month').hidden = isOnline();
    $('world-time').hidden = !isOnline();
    $('world-time').textContent = isOnline()
      ? onlineGame?.started ? '1 DAY / 5 MIN · SERVER CLOCK' : 'LOBBY · CLOCK PAUSED'
      : '';
    renderCity();
    renderOptions();
    renderMultiplayer();
    if (state.selected !== null) selectState(state.selected, false);
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
  }

  function log(message) {
    state.activity.unshift(message);
    state.activity = state.activity.slice(0, 20);
  }

  function selectState(index, notify = true) {
    if (index < 0 || index >= 16) return;
    state.selected = index;
    const territory = state.states[index];
    const owner = onlineGame?.players.find(player => player.id === onlineGame.territories[index].ownerPlayerId);
    const mine = state.owned.includes(index);
    $('state-name').textContent = territory.name;
    $('state-description').textContent = mine
      ? 'This territory is administered by your government. Its population and productivity contribute to your treasury.'
      : owner
        ? 'This territory is administered by ' + owner.name + '.'
        : isOnline()
          ? onlineGame?.started
            ? 'An independent territory. You can establish an administration by investing in local governance.'
            : 'This state is unassigned. The host can allocate it before the world starts.'
          : 'An independent territory. You can establish an administration by investing in local governance.';
    $('state-pop').textContent = territory.pop.toLocaleString('en-US');
    $('state-prosperity').textContent = territory.prosperity + '/100';
    $('state-revenue').textContent = money(Math.round(territory.pop / 1500 * (territory.prosperity / 100)));
    $('state-infra').textContent = 'LEVEL ' + territory.infra;
    $('state-owner').textContent = mine ? 'YOUR ADMINISTRATION' : owner ? owner.name.toUpperCase() : 'INDEPENDENT';

    const claimButton = $('claim-btn');
    if (mine) {
      claimButton.disabled = true;
      claimButton.innerHTML = 'ALREADY ADMINISTERED <span>✓</span>';
    } else if (owner) {
      claimButton.disabled = true;
      claimButton.textContent = 'ADMINISTERED BY ' + owner.name.toUpperCase();
    } else if (isOnline() && !onlineGame?.started) {
      claimButton.disabled = true;
      claimButton.textContent = 'WORLD NOT STARTED';
    } else if (isOnline() && currentPlayer()?.countryIndex == null) {
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
        const owner = onlineGame?.players.find(player => player.id === onlineGame.territories[index].ownerPlayerId);
        path.style.cursor = 'pointer';
        path.style.pointerEvents = 'all';
        path.style.fill = state.owned.includes(index) ? '#8d9f72' : owner ? '#b88470' : '';
        path.style.stroke = owner ? '#d8e6ae' : '#59645c';
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
    const canBuild = !isOnline() ||
      (onlineGame?.started && player?.countryIndex != null && socket?.readyState === WebSocket.OPEN);
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
    if (isOnline()) {
      sendAction({type: 'build', plotIndex: selectedPlot, buildingId: id});
      return;
    }
    state.treasury -= building.cost;
    state.buildings[selectedPlot] = {...building};
    log(building.name + ' constructed in the capital district.');
    toast(building.name + ' CONSTRUCTED');
    update();
    $('plot-title').textContent = building.name;
    $('plot-description').textContent = building.desc;
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
      const game = await apiRequest('/api/games/' + encodeURIComponent(onlineSession.gameId), {}, onlineSession.playerToken);
      applySnapshot(game);
      openSocket();
    } catch (error) {
      $('server-status').textContent = 'Reconnect required.';
      showServerError(error);
    }
  }

  function applySnapshot(game) {
    onlineGame = game;
    const player = currentPlayer();
    if (!player) {
      showMessage('Your player record is not in this world. Rejoin using a valid invitation.', true);
      return;
    }
    state = {
      ...state,
      year: Math.floor((game.day - 1) / 365) + 1,
      month: Math.floor(((game.day - 1) % 365) / 91.25),
      treasury: player.treasury,
      selected: player.countryIndex ?? state.selected,
      owned: game.territories.filter(territory => territory.ownerPlayerId === player.id)
        .map(territory => territory.index),
      states: game.territories.map(territory => ({
        name: territory.name,
        pop: territory.population,
        prosperity: territory.prosperity,
        infra: territory.infrastructure,
        owner: game.players.find(owner => owner.id === territory.ownerPlayerId)?.name || 'Independent'
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
    $('server-status').textContent = 'Connecting to the world…';
    currentSocket.addEventListener('open', () => {
      currentSocket.send(JSON.stringify({
        type: 'authenticate',
        gameId: onlineSession.gameId,
        token: onlineSession.playerToken
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
        $('server-status').textContent = 'Connected to the shared world.';
        $('server-status').classList.remove('error');
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
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(restoreSession, 3000);
    });
  }

  function sendAction(action) {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      showMessage('Not connected to the game server. Reconnect before acting.', true);
      return;
    }
    socket.send(JSON.stringify(action));
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

    $('session-summary').textContent = onlineGame
      ? (onlineGame.started ? 'IN PROGRESS' : 'LOBBY') + ' · WORLD ' + onlineGame.id.slice(0, 8).toUpperCase() +
        ' · DAY ' + onlineGame.day
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
        const country = onlineGame.territories[player.countryIndex];
        const stateLabel = document.createElement('span');
        stateLabel.textContent = (player.connected ? '● ONLINE · ' : '○ OFFLINE · ') +
          (country?.name || 'STATE UNASSIGNED');
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
            if (territory.ownerPlayerId && territory.ownerPlayerId !== player.id) continue;
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
      startButton.disabled = onlineGame.players.some(player => player.countryIndex === null);
    } else {
      const status = document.createElement('p');
      status.className = 'muted';
      status.textContent = 'Waiting for the server to restore the lobby.';
      list.appendChild(status);
      $('start-world').hidden = true;
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
    if (isOnline()) {
      sendAction({type: 'claim', territoryIndex: index});
      return;
    }
    state.treasury -= 450;
    state.owned.push(index);
    state.states[index].owner = 'Your administration';
    state.states[index].infra++;
    log('Administration established in ' + state.states[index].name + '.');
    update();
    toast('TERRITORY ADDED TO YOUR ADMINISTRATION');
  });

  $('next-month').addEventListener('click', () => {
    if (isOnline()) return;
    state.treasury += balance();
    state.month++;
    if (state.month === 4) {
      state.month = 0;
      state.year++;
      state.states.forEach((territory, index) => {
        if (state.owned.includes(index)) {
          territory.pop = Math.round(territory.pop * 1.003);
          territory.prosperity = Math.min(100, territory.prosperity + (Math.random() < .5 ? 1 : 0));
        }
      });
    }
    log('Month advanced. Net fiscal balance: ' +
      (balance() >= 0 ? '+' : '−') + money(Math.abs(balance())) + '.');
    update();
    toast('SIMULATION ADVANCED');
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
  $('save-btn').addEventListener('click', () => {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(state));
      toast('WORLD SAVED LOCALLY');
    } catch (error) {
      console.error('[new-world] Could not save the world:', error);
      toast('SAVE FAILED — CHECK BROWSER STORAGE');
    }
  });
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
  window.addEventListener('beforeunload', () => {
    if (isOnline()) return;
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(state));
    } catch (error) {
      console.error('[new-world] Could not save the world before leaving:', error);
    }
  });

  if (!localStorage.getItem(SAVE_KEY)) log('Initial treasury allocated: ¤ 1,200.');
  update();
  if (onlineSession?.gameId && onlineSession?.playerToken) restoreSession();
})();
