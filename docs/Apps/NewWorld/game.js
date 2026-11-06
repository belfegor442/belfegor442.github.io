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
    activity: ['Local preview. Create or join a world to play online.']
  };
  const buildingTypes = [
    {id:'farm',name:'FARM',cost:120,income:18,icon:'♧',desc:'Food production and rural employment.'},
    {id:'market',name:'MARKET',cost:220,income:34,icon:'⌂',desc:'Local exchange and commercial activity.'},
    {id:'workshop',name:'WORKSHOP',cost:360,income:52,icon:'⚒',desc:'Small-scale manufacturing.'},
    {id:'housing',name:'HOUSING',cost:180,income:8,icon:'▦',desc:'Raises the settlement population.'}
  ];
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
        recoveryOrdersNeedCleanup) return;
    const order = ordersForCurrentSession()[0];
    if (!order || sentOrderIds.has(order.orderId)) return;
    if (window.NewWorldMultiplayer.sendOrder(order)) sentOrderIds.add(order.orderId);
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
  let reconnectAttempts = 0;
  let manuallyDisconnected = false;
  let sentOrderIds = new Set();
  let recoveryOrdersNeedCleanup = false;
  let selectedPlot = null;
  let zoom = 1;
  let pan = {x: 0, y: 0};
  let drag = null;
  let hoveredState = null;
  let selectedProvinceId = null;

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
    renderFinancialLedger();
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
        ? onlineGame.paused ? 'PAUSED · HOST CLOCK' : '1 DAY / 5 MIN · HOST CLOCK'
        : 'LOBBY · CLOCK PAUSED'
      : '';
    renderCity();
    renderOptions();
    renderMultiplayer();
    renderEconomy();
    renderGovernment();
    renderTerritory();
    renderMilitary();
    renderTechnology();
    if (state.selected !== null) selectState(state.selected, false);
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
    if (!onlineGame) {
      addPoliticalRow(list, 'No production data', 'Connect to a multiplayer world to load server-authoritative inventories.');
      addPoliticalRow(marketsList, 'No market data', 'Connect to a multiplayer world to load prices, supply, and demand.');
      addPoliticalRow(populationList, 'No population data', 'Connect to a multiplayer world to load configured population needs.');
      addPoliticalRow(routesList, 'No trade routes', 'Trade routes are configured as part of the pre-game economic scenario.');
      return;
    }

    const territory = onlineGame.territories.find(item => item.index === state.selected);
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
      addPoliticalRow(routesList, 'No trade routes configured', 'No inter-State goods routes are active.');
    } else for (const route of routes) {
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
          ' · exporter receives proceeds in the importing market currency';
      addPoliticalRow(
        routesList,
        (origin?.name || 'Unknown State') + ' → ' + (destination?.name || 'Unknown State') +
          ' · ' + (good?.name || route.goodId),
        (route.enabled ? 'Active' : 'Suspended') + bilateralTerms);
    }
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
      item.sovereignStateId === territory.stateId);
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
        'SVG mapping: ' + province.svgElementId + ' · population: ' +
          Number(province.population).toLocaleString('en-US') + ' · terrain: ' +
          (province.terrainId || 'pending') + ' · control records: ' + currentControls.length);
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
        province?.name || 'Province',
        String(item.type) + ' control · ' + formatWorldDate(item.effectiveFrom),
        (stateName || 'Unknown State') + ' · ' + item.cause);
    }
    for (const item of sovereignty) {
      const province = provinces.find(candidate => candidate.id === item.provinceId);
      const previous = onlineGame.territories.find(candidate => candidate.stateId === item.previousStateId)?.name;
      const next = onlineGame.territories.find(candidate => candidate.stateId === item.newStateId)?.name;
      addPoliticalRow(
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

    const units = (onlineGame.militaryUnits || []).filter(item => item.stateId === territory.stateId);
    $('military-status').textContent = units.length
      ? units.length + ' configured unit(s) · movement and combat values come from the server.'
      : 'Military scenario configuration is pending for this State.';
    if (!units.length) addPoliticalRow(unitsList, 'No units configured', 'Unit composition and combat balance are not inferred.');
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
      const membership = membershipsFor(currentPlayer()).find(item =>
        item.stateId === territory.stateId);
      const canCommand = Boolean(membership &&
        (type?.commandPermissionSetIds || []).includes(membership.permissionSetId));
      if (canCommand) {
        for (const route of (onlineGame.militaryRoutes || []).filter(item =>
          item.enabled && item.originProvinceId === unit.provinceId)) {
          const button = document.createElement('button');
          button.className = 'secondary-button';
          button.type = 'button';
          button.textContent = 'MOVE TO ' +
            ((onlineGame.provinces || []).find(item =>
              item.id === route.destinationProvinceId)?.name || 'DESTINATION');
          button.addEventListener('click', () => sendAction({
            type: 'mobilizeUnit',
            stateId: territory.stateId,
            militaryOrderType: 'move',
            militaryUnitId: unit.id,
            destinationProvinceId: route.destinationProvinceId,
            militaryRouteId: route.id
          }));
          row.appendChild(button);
        }
      }
    }

    const stateProvinceIds = new Set((onlineGame.provinces || [])
      .filter(item => item.sovereignStateId === territory.stateId)
      .map(item => item.id));
    const orders = (onlineGame.militaryOrders || []).filter(item => item.stateId === territory.stateId);
    const battles = (onlineGame.militaryBattles || []).filter(item =>
      stateProvinceIds.has(item.provinceId));
    if (!orders.length && !battles.length)
      addPoliticalRow(operationsList, 'No military operations', 'No orders or battles have been recorded.');
    for (const order of orders) {
      const unit = units.find(item => item.id === order.unitId);
      addPoliticalRow(
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

  function renderTechnology() {
    const technologyList = $('technology-list');
    const projectList = $('research-project-list');
    const adoptionList = $('technology-adoption-list');
    for (const list of [technologyList, projectList, adoptionList]) list.replaceChildren();
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
    if (!technologies.length) addPoliticalRow(technologyList, 'No technology catalog', 'No unlocks are inferred.');
    for (const technology of technologies) {
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
      const enoughStaff = project && institution &&
        Number(project.staff) > 0 && Number(project.staff) <= Number(institution.staff);
      const status = adoptedIds.has(technology.id) ? 'adopted'
        : unlockedIds.has(technology.id) ? 'discovered'
          : project && String(project.status).toLowerCase() === 'active' ? 'in progress'
            : project && String(project.status).toLowerCase() === 'suspended' ? 'suspended'
              : project && !missingPrerequisite && !missingKnowledge &&
                  !missingMaterials && enoughFunding && enoughStaff ? 'researchable'
                : project ? 'blocked' : 'not configured';
      const row = addPoliticalRow(
        technology.name,
        String(technology.domain) + ' · ' + status,
        'Prerequisites: ' + (prerequisites.join(', ') || 'none') +
          (missingKnowledge
            ? ' · required knowledge unavailable'
            : '') +
          (missingMaterials
            ? ' · required materials not reserved'
            : '') +
          (project && !enoughFunding
            ? ' · configured funding unavailable'
            : '') +
          (project && !enoughStaff
            ? ' · configured staff unavailable'
            : '') +
          ' · effects: ' + ((technology.effects || []).map(item => item.effectId).join(', ') || 'not configured'));
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
        adoptButton.disabled = !stateId ||
          !membership ||
          membership.permissionSetId === 'government-observer' ||
          socket?.readyState !== WebSocket.OPEN;
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
        institution.name,
        String(institution.type) + ' · ' + institution.staff + ' staff · funding ' + institution.funding,
        'Specializations: ' + (institution.specializations || []).join(', ') || 'No specialization recorded.');
    }
    for (const project of projects) {
      const technology = technologies.find(item => item.id === project.technologyId);
      const row = addPoliticalRow(
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
        startButton.disabled = !stateId ||
          !membership ||
          ['government-observer'].includes(membership.permissionSetId) ||
          !validProjectConfiguration ||
          socket?.readyState !== WebSocket.OPEN;
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
        cancelButton.disabled = !stateId ||
          !membership ||
          membership.permissionSetId === 'government-observer' ||
          socket?.readyState !== WebSocket.OPEN;
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
      return;
    }
    for (const transaction of transactions) {
      const sign = transaction.amount > 0 ? '+' : transaction.amount < 0 ? '−' : '';
      addPoliticalRow(
        list,
        String(transaction.type).replaceAll(/([A-Z])/g, ' $1').toUpperCase() +
          ' · ' + formatWorldDate(transaction.worldDate),
        transaction.description + ' · ' + sign + money(Math.abs(transaction.amount)) +
          ' · balance ' + money(transaction.balanceAfter));
    }

    const companyTransactions = (onlineGame.companyFinancialTransactions || [])
      .filter(item => item.stateId === territory?.stateId)
      .slice()
      .reverse();
    if (!companyTransactions.length) {
      addPoliticalRow(companyList, 'No company sales recorded', 'Market revenue appears after a configured market clears.');
      return;
    }
    for (const transaction of companyTransactions) {
      const company = onlineGame.companies?.find(item => item.id === transaction.companyId);
      const currency = onlineGame.currencies?.find(item => item.id === transaction.currencyId);
      addPoliticalRow(
        company?.name || 'Company',
        formatWorldDate(transaction.worldDate) + ' · ' + transaction.quantity + ' ' +
        transaction.goodId + ' × ' + money(transaction.unitPrice) + ' · +' +
        money(transaction.amount) + ' ' + (currency?.code || currency?.name || 'currency units') +
        (transaction.tradeRouteId ? ' · trade route ' + transaction.tradeRouteId.slice(0, 8) : ' · domestic sale'));
    }
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
        ? 'An independent territory. You can establish an administration by investing in local governance.'
        : 'This state has no government membership yet.';
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
        : owner ? owner.name.toUpperCase() : onlineGame ? 'INDEPENDENT' : 'NOT CONNECTED';

    const claimButton = $('claim-btn');
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
      for (const province of onlineGame?.provinces || []) {
        const element = document.getElementById(province.svgElementId);
        if (!element) continue;
        const selected = province.id === selectedProvinceId;
        element.style.cursor = 'pointer';
        element.style.pointerEvents = 'all';
        element.style.stroke = selected ? '#f3d37a' : '';
        element.style.strokeWidth = selected ? '3' : '';
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

  function provinceAtEvent(event) {
    for (let element = event.target; element?.id; element = element.parentElement) {
      const province = onlineGame?.provinces.find(item => item.svgElementId === element.id);
      if (province) return province;
    }
    return null;
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
      const province = provinceAtEvent(event);
      if (province) {
        selectProvince(province);
        return;
      }
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
      const province = provinceAtEvent(event);
      const path = territoryAtEvent(svgDocument, event);
      if (!path && !province) {
        hideMapTooltip();
        return;
      }
      const stateIndex = path
        ? Number(path.id.slice(5)) - 1
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

  function storeSession(session) {
    onlineSession = session;
    manuallyDisconnected = false;
    try {
      localStorage.setItem(SESSION_KEY,JSON.stringify(session));
    } catch (error) {
      console.error('[new-world] Could not persist the multiplayer session:',error);
      showMessage('This browser could not save the session token. Keep this tab open.',true);
    }
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
    $('recover-previous-save').hidden = error?.code !== 'SAVE_INVALID';
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
        reconnectAttempts = 0;
        applySnapshot(game);
        replayPendingOrders();
        $('server-status').textContent = window.NewWorldMultiplayer.isHost()
          ? 'This device is hosting the authoritative world.'
          : 'Connected to the host device.';
        $('server-status').classList.remove('error');
      },
      onStatus:status => {
        if (status === 'ready' || status === 'connected') {
          socket = {readyState:WebSocket.OPEN};
          $('server-status').textContent = status === 'ready'
            ? 'Host active · this device owns the world.'
            : 'Relay connected · waiting for the host.';
          $('server-status').classList.remove('error');
          return;
        }
        socket = null;
        $('server-status').textContent = status || 'Disconnected from the relay.';
        if (/offline|failed|error|could not/i.test(status || ''))
          $('server-status').classList.add('error');
      },
      onOrderResult:result => {
        if (!result) return;
        if (result.id) removePendingOrder(result.id);
        if (result.accepted) showMessage('Order accepted by the host.');
        else showMessage(orderErrorMessage(result.code) || result.error ||
          'The host rejected the order.',true);
      }
    };
  }

  async function createWorld() {
    try {
      const name = playerName();
      offlineBackup = structuredClone(state);
      const result = await window.NewWorldMultiplayer.createWorld(name,multiplayerHandlers());
      storeSession({...result.session,playerName:name});
      applySnapshot(result.game);
      showMessage('World created on this device. Keep this browser open while the world is running.');
      toast('PRIVATE WORLD CREATED');
    } catch (error) {
      showServerError(error);
    }
  }

  async function joinWorld() {
    try {
      const name = playerName();
      offlineBackup = structuredClone(state);
      const session = await window.NewWorldMultiplayer.joinWorld(
        $('invite-code').value.trim(),name,multiplayerHandlers());
      storeSession({...session,playerName:name});
      showMessage('Connected to the host. The host must assign your State.');
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
      const result = await window.NewWorldMultiplayer.restoreSession(
        onlineSession,multiplayerHandlers());
      if (result.session) storeSession({...result.session,
        playerName:$('player-name').value.trim() || result.session.playerName});
      if (result.game) applySnapshot(result.game);
    } catch (error) {
      $('server-status').textContent = 'Reconnect required.';
      showServerError(error);
    }
  }

  function scheduleReconnect() {
    if (!onlineSession || manuallyDisconnected || reconnectTimer !== null) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (!window.NewWorldMultiplayer?.isConnected()) restoreSession();
    },5000);
  }

  async function recoverPreviousSave() {
    showMessage('Saves are stored on the host device. Reopen the original host browser to restore this world.',true);
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
    socket = window.NewWorldMultiplayer?.isConnected()
      ? {readyState:WebSocket.OPEN}
      : null;
    if (!socket) restoreSession();
  }

  function sendAction(action) {
    if (!socket || !window.NewWorldMultiplayer?.isConnected()) {
      showMessage('The host or relay is disconnected. Reconnect before acting.',true);
      return;
    }
    const player = currentPlayer();
    const activeMemberships = membershipsFor(player);
    const selectedMembership = action.stateId
      ? activeMemberships.find(membership => membership.stateId === action.stateId)
      : activeMemberships.find(membership => membership.stateIndex === player?.countryIndex) ||
        activeMemberships[0];
    const isGameWideVote = action.type === 'pause' || action.type === 'resume';
    const order = {
      ...action,
      orderId:crypto.randomUUID(),
      gameId:onlineSession.gameId,
      playerId:onlineSession.playerId,
      expectedWorldVersion:onlineGame?.worldVersion,
      stateId:selectedMembership?.stateId ?? action.stateId ?? null
    };
    if (!order.expectedWorldVersion || (!isGameWideVote && !order.stateId)) {
      showMessage('The authoritative world version or government membership is unavailable.',true);
      return;
    }
    const queued = [...getPendingOrders(),order];
    if (!savePendingOrders(queued)) return;
    renderMultiplayer();
    replayPendingOrders();
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
      ORDER_ID_REUSED: 'This order ID was already used for a different request.',
      MILITARY_RULES_PENDING: 'This military order is not available until its rules are configured.',
      UNIT_NOT_OPERATIONAL: 'This unit is not operational.',
      ROUTE_CAPACITY_EXCEEDED: 'The configured route does not have enough capacity.',
      TERRITORY_ACCESS_DENIED: 'This route crosses territory without configured access.',
      MILITARY_CAPACITY_UNIT_UNSUPPORTED: 'This route uses a capacity unit that cannot yet be validated.'
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

  async function requestSnapshotBroadcast() {
    if (window.NewWorldMultiplayer?.isConnected()) return;
    await restoreSession();
  }

  async function startWorld() {
    try {
      const game = await window.NewWorldMultiplayer.admin('start',{});
      if (game && typeof game === 'object') applySnapshot(game);
      showMessage('The world has started. The host device must remain connected.');
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
      status.textContent = 'Waiting for the host to restore the lobby.';
      list.appendChild(status);
      $('start-world').hidden = true;
      $('pause-controls').hidden = true;
    }
  }

  function disconnect() {
    manuallyDisconnected = true;
    clearTimeout(reconnectTimer);
    const hosted = Boolean(onlineSession?.isHost ||
      onlineGame?.hostPlayerId === onlineSession?.playerId);
    try {
      window.NewWorldMultiplayer?.disconnect(hosted);
    } catch (error) {
      console.error('[new-world] Could not close the multiplayer connection:',error);
    }
    socket = null;
    reconnectAttempts = 0;
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

  const endpointLabel = $('server-endpoint');
  if (endpointLabel) endpointLabel.textContent = 'MQTT RELAY · HOST RUNS THE WORLD';
  $('player-name').value = localStorage.getItem(NAME_KEY) || '';
  $('test-server').addEventListener('click',async () => {
    try {
      await window.NewWorldMultiplayer.testRelay();
      $('server-status').textContent = 'Public relay reachable.';
      $('server-status').classList.remove('error');
      showMessage('Relay reachable. The host device, not the relay, runs the world.');
    } catch (error) {
      showServerError(error);
    }
  });
  $('create-world').addEventListener('click', createWorld);
  $('join-world').addEventListener('click', joinWorld);
  $('reconnect-world').addEventListener('click', restoreSession);
  $('recover-previous-save').addEventListener('click', recoverPreviousSave);
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
      occupations: 'occupations'
    }));
  $('save-military-config').addEventListener('click', () => saveScenarioConfiguration(
    'military', 'military-config',
    ['unitTypes', 'commanders', 'units', 'routes', 'supplyRoutes', 'occupations'],
    'Military'));
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
  update();
  if (!onlineSession) showMessage('Create a world to host it on this device, or join a host with an invitation code.');
  if (onlineSession?.gameId && onlineSession?.playerToken) restoreSession();
})();
