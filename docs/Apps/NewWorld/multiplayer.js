/* New World host-authoritative multiplayer transport.
 * The room owner runs the game rules in this browser. MQTT is only a message
 * relay, following the same model as BREW; it never stores or simulates worlds.
 */
(() => {
  'use strict';

  const BROKERS = [
    'wss://broker.emqx.io:8084/mqtt',
    'wss://test.mosquitto.org:8081/mqtt',
    'wss://broker.hivemq.com:8884/mqtt'
  ];
  const NS = 'north-assembly/new-world/v1/';
  const HOST_SAVE = 'new-world-host-state-v2:';
  const DAY_LENGTH_MS = 5 * 60 * 1000;
  const DAYS_PER_FINANCIAL_PERIOD = 30;
  const MAX_TREASURY = 2147483647;
  const MAX_PLAYERS = 20;
  const BUILDINGS = {
    farm: {id:'farm',name:'FARM',cost:120,income:18,icon:'♧',description:'Food production and rural employment.'},
    market: {id:'market',name:'MARKET',cost:220,income:34,icon:'⌂',description:'Local exchange and commercial activity.'},
    workshop: {id:'workshop',name:'WORKSHOP',cost:360,income:52,icon:'⚒',description:'Small-scale manufacturing.'},
    housing: {id:'housing',name:'HOUSING',cost:180,income:8,icon:'▦',description:'Raises the settlement population.'}
  };
  const NAMES = [
    'Kingdom of Coimbrila','United Provinces of Gania','Chungia','Calcilacia',
    'Pician Empire','Meityeun Theocracy','Swabing','Alba','Knosian Despotate',
    'Kalestos','Gorkirch','Duchy of Shonewesia','Shahtehaq','Kvinian Empire','Shi','Kueopia'
  ];
  const byId = value => crypto.randomUUID ? crypto.randomUUID() :
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = crypto.getRandomValues(new Uint8Array(1))[0] & 15;
      return (c === 'x' ? r : (r & 3) | 8).toString(16);
    });
  const token = (size = 32) => {
    const bytes = crypto.getRandomValues(new Uint8Array(size));
    return Array.from(bytes, value => value.toString(16).padStart(2,'0')).join('');
  };
  const roomCode = () => {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    return Array.from(bytes, value => alphabet[value % alphabet.length]).join('');
  };
  const clone = value => structuredClone(value);
  const topicSet = room => {
    const root = NS + room + '/';
    return {
      root, host: root + 'host', clients: root + 'c', server: root + 's',
      presence: id => root + 'p/' + id + '/presence',
      private: id => root + 'p/' + id,
      pending: id => root + 'pending/' + id
    };
  };

  class BrokerLink {
    constructor(role, room, playerId, onMessage, onStatus) {
      this.role = role;
      this.room = room;
      this.playerId = playerId || '';
      this.topics = topicSet(room);
      this.onMessage = onMessage;
      this.onStatus = onStatus;
      this.client = null;
      this.closed = false;
      this.connected = false;
      this.brokerIndex = 0;
      this.rotateTimer = null;
      this.retryTimer = null;
      this.clientNonce = token(8);
    }

    start() {
      this.connectBroker();
    }

    connectBroker() {
      if (this.closed || typeof mqtt === 'undefined') {
        this.onStatus(typeof mqtt === 'undefined'
          ? 'MQTT transport could not load.' : 'Disconnected.');
        return;
      }
      const url = BROKERS[this.brokerIndex % BROKERS.length];
      this.onStatus('Connecting to relay ' + (this.brokerIndex + 1) + '/' + BROKERS.length + '…');
      try {
        const willTopic = this.role === 'host'
          ? this.topics.host
          : this.topics.presence(this.playerId || this.clientNonce);
        const willPayload = this.role === 'host'
          ? {t:'presence',online:false}
          : {t:'presence',playerId:this.playerId,online:false};
        const client = mqtt.connect(url, {
          connectTimeout: 10000,
          reconnectPeriod: 1500,
          keepalive: 30,
          protocolVersion: 4,
          clean: true,
          resubscribe: false,
          clientId: 'nw-' + token(10),
          will: {topic:willTopic,payload:JSON.stringify(willPayload),retain:true,qos:1}
        });
        this.client = client;
        client.on('connect', () => this.handleConnect(client));
        client.on('message', (topic, payload) => {
          if (client !== this.client || this.closed) return;
          let message;
          try { message = JSON.parse(payload.toString()); } catch { return; }
          if (message && typeof message.t === 'string') this.onMessage(topic, message);
        });
        client.on('reconnect', () => {
          this.connected = false;
          this.onStatus('Relay reconnecting…');
        });
        client.on('offline', () => {
          this.connected = false;
          this.onStatus('Relay offline — reconnecting…');
          this.scheduleBrokerRotation();
        });
        client.on('error', error => {
          this.onStatus('Relay error: ' + (error?.message || 'connection failed'));
        });
        client.on('close', () => {
          this.connected = false;
          if (!this.closed) this.scheduleBrokerRotation();
        });
        this.rotateTimer = setTimeout(() => {
          if (!this.connected && !this.closed) this.rotateBroker();
        }, 13000);
      } catch (error) {
        this.onStatus('Relay connection failed: ' + (error?.message || 'unknown error'));
        this.scheduleBrokerRotation();
      }
    }

    handleConnect(client) {
      if (client !== this.client || this.closed) return;
      this.connected = true;
      if (this.rotateTimer) clearTimeout(this.rotateTimer);
      if (this.retryTimer) clearTimeout(this.retryTimer);
      this.rotateTimer = null;
      this.retryTimer = null;
      const subscriptions = this.role === 'host'
        ? [this.topics.clients, this.topics.root + 'p/+/presence']
        : [this.topics.server, this.topics.host, this.topics.pending(this.clientNonce),
           ...(this.playerId ? [this.topics.private(this.playerId)] : [])];
      client.subscribe(subscriptions, {qos:1}, error => {
        if (error || client !== this.client || this.closed) {
          this.connected = false;
          this.onStatus('Could not subscribe to the room relay.');
          return;
        }
        if (this.role === 'host') {
          this.publish(this.topics.host, {t:'presence',online:true}, {retain:true,qos:1});
          this.onStatus('ready');
        } else {
          this.publish(this.topics.presence(this.playerId || this.clientNonce), {
            t:'presence',playerId:this.playerId || null,clientNonce:this.clientNonce,online:true
          }, {retain:true,qos:1});
          this.onStatus('connected');
        }
      });
    }

    publish(topic, message, options = {qos:1}) {
      if (!this.client || !this.client.connected || !topic) return false;
      try {
        this.client.publish(topic, JSON.stringify(message), options);
        return true;
      } catch (error) {
        this.onStatus('Relay send failed: ' + (error?.message || 'unknown error'));
        return false;
      }
    }

    scheduleBrokerRotation() {
      if (this.closed || this.retryTimer) return;
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        if (!this.connected) this.rotateBroker();
      }, 5000);
    }

    rotateBroker() {
      if (this.closed) return;
      if (this.rotateTimer) clearTimeout(this.rotateTimer);
      if (this.retryTimer) clearTimeout(this.retryTimer);
      this.rotateTimer = null;
      this.retryTimer = null;
      const old = this.client;
      this.client = null;
      this.connected = false;
      if (old) {
        try { old.removeAllListeners(); old.end(true); } catch {}
      }
      this.brokerIndex = (this.brokerIndex + 1) % BROKERS.length;
      this.connectBroker();
    }

    close(sendOffline = true) {
      this.closed = true;
      if (this.rotateTimer) clearTimeout(this.rotateTimer);
      if (this.retryTimer) clearTimeout(this.retryTimer);
      if (sendOffline && this.connected) {
        const topic = this.role === 'host'
          ? this.topics.host
          : this.topics.presence(this.playerId || this.clientNonce);
        const payload = this.role === 'host'
          ? {t:'presence',online:false}
          : {t:'presence',playerId:this.playerId || null,online:false};
        this.publish(topic, payload, {retain:true,qos:1});
      }
      if (this.client) {
        try { this.client.end(true); } catch {}
      }
      this.client = null;
      this.connected = false;
    }
  }

  let runtime = null;

  function emptyCollections() {
    return {
      memberships:[], events:[], orders:[], currencies:[], financialTransactions:[],
      companyFinancialTransactions:[], marketHistory:[], goods:[], productionRecipes:[],
      populationGroups:[], companies:[], markets:[], tradeRoutes:[], politicalSystems:[],
      provinces:[], settlements:[], provinceConnections:[], territorialControls:[],
      sovereigntyHistory:[], militaryUnitTypes:[], militaryCommanders:[], militaryUnits:[],
      militaryOrders:[], militaryBattles:[], militaryRoutes:[], supplyRoutes:[], occupations:[],
      technologies:[], researchInstitutions:[], researchProjects:[], technologyUnlocks:[],
      technologyAdoptions:[]
    };
  }

  function newWorld(name) {
    const gameId = byId();
    const playerId = byId();
    const hostToken = token();
    const game = {
      id:gameId,name:'New World',hostPlayerId:playerId,started:false,paused:false,status:'lobby',
      day:1,worldDate:'1500-01-01',worldVersion:1,eventSequence:0,
      scenarioId:'beleland',scenarioVersion:'1.0',maxHumanPlayers:MAX_PLAYERS,
      pauseVotePlayerIds:[],players:[{
        id:playerId,name,isHost:true,countryIndex:null,treasury:1200,dailyBalanceRemainder:0,
        buildings:{},connected:true,token:hostToken
      }],
      territories:NAMES.map((territoryName,index) => ({
        stateId:byId(),currencyId:byId(),index,name:territoryName,treasury:0,dailyBalanceRemainder:0,
        population:Math.max(1,Math.min(2000000,26000+((index*7919+1337)%56000))),
        prosperity:42+(index*13%48),infrastructure:1+index%4,ownerPlayerId:null
      })),
      activity:[name + ' created a private world.'],
      ...emptyCollections()
    };
    game.currencies = game.territories.map(territory => ({
      id:territory.currencyId,stateId:territory.stateId,name:null,code:null,minorUnitScale:null
    }));
    game.politicalSystems = game.territories.map(territory => ({
      stateId:territory.stateId,configurationPending:true,regime:null,constitution:null,
      government:null,institutions:[],offices:[],parties:[],laws:[],decisions:[],stability:null
    }));
    if (!window.NewWorldSimulation) throw new Error('The New World simulation engine failed to load.');
    Object.assign(game, window.NewWorldSimulation.createStarterEconomy(game.territories, byId));
    pushEvent(game,'world.created',playerId,null,'A private multiplayer world was created with the Beleland starter economy.');
    return {
      game,
      session:{gameId,playerId,playerToken:hostToken,inviteCode:'',roomCode:'',isHost:true}
    };
  }

  function pushActivity(game, description) {
    game.activity.unshift(description);
    game.activity = game.activity.slice(0,100);
  }

  function pushEvent(game,type,actorPlayerId,stateId,description,orderId = null,resultCode = null) {
    game.eventSequence = (game.eventSequence || 0) + 1;
    game.events.push({
      id:byId(),gameId:game.id,orderId,actorPlayerId,stateId,type,resultCode,
      occurredAtUtc:new Date().toISOString(),worldDate:game.worldDate,
      worldVersion:game.worldVersion,description,sequence:game.eventSequence
    });
    if (game.events.length > 1000) game.events.splice(0,game.events.length - 1000);
  }

  function finance(game, territory) {
    const members = game.memberships.filter(item =>
      item.stateId === territory.stateId && item.status === 'active')
      .map(item => game.players.find(player => player.id === item.playerId)).filter(Boolean);
    const cityOwners = members.filter(player => player.countryIndex === territory.index);
    const cityOwnerIds = new Set(cityOwners.map(player => player.id));
    const territoryIncome = game.territories
      .filter(item => item.ownerPlayerId && cityOwnerIds.has(item.ownerPlayerId))
      .reduce((total,item) => total + Math.round(item.population / 1500 * (item.prosperity / 100)),0);
    const cityIncome = cityOwners.length * 85 + cityOwners.reduce((total,player) =>
      total + Object.values(player.buildings || {}).reduce((sum,building) => sum + (building.income || 0),0),0);
    const upkeep = cityOwners.reduce((total,player) =>
      total + Object.keys(player.buildings || {}).length * 2,0);
    return {territoryIncome,cityIncome,upkeep,monthlyBalance:territoryIncome+cityIncome-upkeep};
  }

  function snapshot(game) {
    const memberships = game.memberships.map(item => ({...item}));
    const membershipByPlayer = new Map();
    for (const membership of memberships) {
      if (membership.status !== 'active') continue;
      if (!membershipByPlayer.has(membership.playerId)) membershipByPlayer.set(membership.playerId,[]);
      membershipByPlayer.get(membership.playerId).push(membership);
    }
    const players = game.players.map(player => ({
      id:player.id,name:player.name,isHost:!!player.isHost,countryIndex:player.countryIndex,
      treasury:player.treasury,buildings:clone(player.buildings || {}),connected:!!player.connected,
      memberships:(membershipByPlayer.get(player.id) || []).map(item => ({
        id:item.id,playerId:item.playerId,stateId:item.stateId,
        stateIndex:game.territories.find(territory => territory.stateId === item.stateId)?.index ?? -1,
        status:item.status,permissionSetId:item.permissionSetId
      }))
    }));
    const territories = game.territories.map(territory => ({
      stateId:territory.stateId,index:territory.index,name:territory.name,treasury:territory.treasury,
      ...finance(game,territory),population:territory.population,prosperity:territory.prosperity,
      infrastructure:territory.infrastructure,ownerPlayerId:territory.ownerPlayerId,
      currencyId:territory.currencyId
    }));
    const out = {
      id:game.id,started:game.started,day:game.day,hostPlayerId:game.hostPlayerId,paused:game.paused,
      pauseVotePlayerIds:[...game.pauseVotePlayerIds],players,territories,activity:[...game.activity],
      name:game.name,status:game.status,worldDate:game.worldDate,worldVersion:game.worldVersion,
      scenarioId:game.scenarioId,scenarioVersion:game.scenarioVersion,
      memberships, eventSequence:game.eventSequence,events:clone(game.events),
      politicalSystems:clone(game.politicalSystems),goods:clone(game.goods),
      productionRecipes:clone(game.productionRecipes),populationGroups:clone(game.populationGroups),
      markets:clone(game.markets),tradeRoutes:clone(game.tradeRoutes),currencies:clone(game.currencies),
      financialTransactions:clone(game.financialTransactions),
      companyFinancialTransactions:clone(game.companyFinancialTransactions),
      marketHistory:clone(game.marketHistory),
      companies:game.companies.map(company => ({...clone(company),facilities:clone(company.facilities || [])})),
      provinces:clone(game.provinces),settlements:clone(game.settlements),
      provinceConnections:clone(game.provinceConnections),territorialControls:clone(game.territorialControls),
      sovereigntyHistory:clone(game.sovereigntyHistory),militaryUnitTypes:clone(game.militaryUnitTypes),
      militaryCommanders:clone(game.militaryCommanders),militaryUnits:clone(game.militaryUnits),
      militaryOrders:clone(game.militaryOrders),militaryBattles:clone(game.militaryBattles),
      militaryRoutes:clone(game.militaryRoutes),supplyRoutes:clone(game.supplyRoutes),
      occupations:clone(game.occupations),technologies:clone(game.technologies),
      researchInstitutions:clone(game.researchInstitutions),researchProjects:clone(game.researchProjects),
      technologyUnlocks:clone(game.technologyUnlocks),technologyAdoptions:clone(game.technologyAdoptions)
    };
    return out;
  }

  function persistHost() {
    if (!runtime || runtime.role !== 'host') return;
    try {
      localStorage.setItem(HOST_SAVE + runtime.room, JSON.stringify({
        game:runtime.game,session:runtime.session,version:2,savedAt:new Date().toISOString()
      }));
    } catch (error) {
      runtime.onStatus('Host save failed: browser storage is unavailable or full.');
    }
  }

  function publishSnapshot() {
    if (!runtime || runtime.role !== 'host') return;
    const game = snapshot(runtime.game);
    runtime.link.publish(runtime.topics.server,{t:'snapshot',game,hostTime:Date.now()},{qos:1});
    runtime.onSnapshot(game);
  }

  function emitOrderResult(playerId,result) {
    if (!runtime || runtime.role !== 'host') return;
    runtime.link.publish(runtime.topics.server,{t:'orderResult',to:playerId,order:result},{qos:1});
  }

  function activeMemberships(game,playerId) {
    return game.memberships.filter(item => item.playerId === playerId && item.status === 'active');
  }

  function canPermission(permissionSetId, action) {
    const permissions = {
      'government-member':['claim','build','proposeLaw','voteDecision','startProject'],
      'government-council':['claim','build','proposeLaw','approveBudget','appointOffice','voteDecision','startProject'],
      'government-executive':['claim','build','proposeLaw','approveBudget','appointOffice','voteDecision','startProject'],
      'government-observer':[]
    };
    return (permissions[permissionSetId] || []).includes(action);
  }

  function reject(code,error,id = null) { return {id,accepted:false,code,error,replayed:false}; }

  function applyOrder(game,player,order) {
    if (!order || !order.orderId) return reject('INVALID_PAYLOAD','A valid order ID is required.',order?.orderId || null);
    const duplicate = game.orders.find(item => item.id === order.orderId);
    if (duplicate) {
      const payload = Object.fromEntries(Object.entries(order).filter(([key]) =>
        !['orderId','gameId','playerId','expectedWorldVersion'].includes(key)));
      const samePayload = duplicate.playerId === player.id &&
        duplicate.type === order.type &&
        duplicate.stateId === order.stateId &&
        duplicate.expectedWorldVersion === order.expectedWorldVersion &&
        JSON.stringify(duplicate.payload || {}) === JSON.stringify(payload);
      return samePayload
        ? {id:order.orderId,accepted:duplicate.status === 'executed',
            code:duplicate.resultCode || null,error:duplicate.result || null,replayed:true}
        : reject('ORDER_ID_REUSED','This order ID was already used.',order.orderId);
    }
    if (Number(order.expectedWorldVersion) !== game.worldVersion)
      return reject('STALE_WORLD_VERSION','The world changed. Review the latest state before trying again.',order.orderId);
    const orderType = order.type;
    const isPause = orderType === 'pause' || orderType === 'resume';
    if (!game.started) return reject('WORLD_NOT_STARTED','The host must start the world before actions are allowed.',order.orderId);
    if ((orderType === 'pause' && game.status !== 'running') ||
        (orderType === 'resume' && game.status !== 'paused'))
      return reject('PAUSE_STATE_CONFLICT','The world pause state changed before this order was processed.',order.orderId);
    if (!isPause && game.status !== 'running')
      return reject('WORLD_NOT_RUNNING','This action is unavailable while the world is paused or closed.',order.orderId);
    const memberships = activeMemberships(game,player.id);
    if (!memberships.length) return reject('NOT_MEMBER','This player has not been assigned a state.',order.orderId);
    const membership = isPause ? memberships[0] :
      memberships.find(item => item.stateId === order.stateId) || null;
    if (!isPause && !membership) return reject('NOT_MEMBER','You are not a member of the selected government.',order.orderId);
    let message = null;
    if (orderType === 'pause' || orderType === 'resume') {
      if (!player.connected) return reject('NOT_CONNECTED','Only connected players can vote.',order.orderId);
      const votes = new Set(game.pauseVotePlayerIds);
      if (votes.has(player.id)) votes.delete(player.id); else votes.add(player.id);
      game.pauseVotePlayerIds = [...votes];
      const connectedCount = game.players.filter(item => item.connected).length;
      if (votes.size > connectedCount / 2) {
        game.paused = !game.paused;
        game.status = game.paused ? 'paused' : 'running';
        game.pauseVotePlayerIds = [];
        pushActivity(game,game.paused
          ? 'The connected players voted to pause the world.'
          : 'The connected players voted to resume the world.');
      } else {
        pushActivity(game,player.name + ' voted to ' + orderType + ' the world.');
      }
    } else if (orderType === 'claim') {
      if (!canPermission(membership.permissionSetId,'claim'))
        return reject('INSUFFICIENT_PERMISSION','Your government permissions do not allow establishing an administration.',order.orderId);
      const territory = game.territories[Number(order.territoryIndex)];
      if (!territory || territory.ownerPlayerId)
        return reject('TARGET_UNAVAILABLE','This territory is already administered or invalid.',order.orderId);
      const government = game.territories.find(item => item.stateId === membership.stateId);
      if (!government || government.treasury < 450)
        return reject('INSUFFICIENT_FUNDS','Insufficient treasury (¤450 required).',order.orderId);
      government.treasury -= 450;
      territory.ownerPlayerId = player.id;
      territory.infrastructure++;
      game.financialTransactions.push({
        id:byId(),stateId:government.stateId,currencyId:government.currencyId,
        type:'administrationCost',amount:-450,balanceBefore:government.treasury+450,
        balanceAfter:government.treasury,description:'Administration established in ' + territory.name + '.',
        worldDate:game.worldDate,recordedAtUtc:new Date().toISOString(),orderId:order.orderId,
        membershipId:membership.id
      });
      pushActivity(game,player.name + ' established an administration in ' + territory.name + '.');
    } else if (orderType === 'build') {
      if (!canPermission(membership.permissionSetId,'build'))
        return reject('INSUFFICIENT_PERMISSION','Your government permissions do not allow construction.',order.orderId);
      const plot = Number(order.plotIndex);
      const building = BUILDINGS[order.buildingId];
      if (!Number.isInteger(plot) || plot < 0 || plot >= 144 || !building)
        return reject('INVALID_PAYLOAD','Invalid construction request.',order.orderId);
      if (player.buildings[plot]) return reject('TARGET_UNAVAILABLE','This plot is already developed.',order.orderId);
      const government = game.territories.find(item => item.stateId === membership.stateId);
      if (!government || government.treasury < building.cost)
        return reject('INSUFFICIENT_FUNDS','Insufficient treasury.',order.orderId);
      government.treasury -= building.cost;
      player.buildings[plot] = clone(building);
      game.financialTransactions.push({
        id:byId(),stateId:government.stateId,currencyId:government.currencyId,
        type:'constructionCost',amount:-building.cost,balanceBefore:government.treasury+building.cost,
        balanceAfter:government.treasury,description:'Constructed ' + building.name + '.',
        worldDate:game.worldDate,recordedAtUtc:new Date().toISOString(),orderId:order.orderId,
        membershipId:membership.id
      });
      pushActivity(game,player.name + ' constructed a ' + building.name.toLowerCase() + '.');
    } else {
      return reject('UNSUPPORTED_ORDER','This order is not yet available in the host-authoritative ruleset.',order.orderId);
    }

    game.worldVersion++;
    const orderPayload = Object.fromEntries(Object.entries(order).filter(([key]) =>
      !['orderId','gameId','playerId','expectedWorldVersion'].includes(key)));
    game.orders.push({id:order.orderId,playerId:player.id,type:orderType,stateId:order.stateId,
      payload:orderPayload,status:'executed',expectedWorldVersion:order.expectedWorldVersion,
      worldVersion:game.worldVersion,resultCode:null,result:null});
    pushEvent(game,'order.executed',player.id,order.stateId,
      game.activity[0] || ('Executed ' + orderType + '.'),order.orderId);
    return {id:order.orderId,accepted:true,code:null,error:null,replayed:false};
  }


  function advanceHostDay() {
    if (!runtime || runtime.role !== 'host') return false;
    const game = runtime.game;
    if (!game.started || game.status !== 'running' || !runtime.link.connected) return false;

    const result = window.NewWorldSimulation?.advanceDay(game);
    if (!result?.ok) {
      game.status = 'paused';
      game.paused = true;
      game.pauseVotePlayerIds = [];
      game.worldVersion++;
      const reason = result?.error || 'The browser simulation engine is unavailable.';
      pushActivity(game,'The world was paused because its simulation cycle failed: ' + reason);
      pushEvent(game,'world.paused.simulation_error',null,null,
        'Simulation cycle rejected atomically: ' + reason);
      persistHost();
      publishSnapshot();
      runtime.onStatus('World paused: simulation error — ' + reason);
      return true;
    }

    persistHost();
    publishSnapshot();
    return true;
  }

  function hostPulse() {
    if (!runtime || runtime.role !== 'host') return;
    if (!runtime.link.connected) {
      runtime.lastPulseAt = Date.now();
      return;
    }
    const game = runtime.game;
    if (!game.started || game.status !== 'running') {
      runtime.lastPulseAt = Date.now();
      return;
    }
    const now = Date.now();
    const previous = Number(runtime.lastPulseAt) || now;
    runtime.clockAccumulatorMs = (runtime.clockAccumulatorMs || 0) +
      Math.max(0,Math.min(now-previous,DAY_LENGTH_MS));
    runtime.lastPulseAt = now;
    let advanced = 0;
    while (runtime.clockAccumulatorMs >= DAY_LENGTH_MS && advanced < 24 &&
           runtime.game.status === 'running') {
      runtime.clockAccumulatorMs -= DAY_LENGTH_MS;
      if (!advanceHostDay()) break;
      advanced++;
    }
    if (advanced) persistHost();
  }

  function hostReceive(topic,message) {
    if (!runtime || runtime.role !== 'host') return;
    if (topic.endsWith('/presence')) {
      const match = topic.match(/\/p\/([^/]+)\/presence$/);
      const playerId = match && match[1];
      if (!playerId || playerId === runtime.session.playerId) return;
      const player = runtime.game.players.find(item => item.id === playerId);
      if (player) {
        player.connected = message.online === true;
        if (!player.connected) {
          runtime.game.pauseVotePlayerIds = runtime.game.pauseVotePlayerIds.filter(id => id !== playerId);
        }
        persistHost();
        publishSnapshot();
      }
      return;
    }
    if (topic !== runtime.topics.clients) return;
    if (message.t === 'hello') {
      const pendingTopic = runtime.topics.pending(String(message.clientNonce || ''));
      let player = null;
      if (message.playerId && message.playerToken) {
        player = runtime.game.players.find(item =>
          item.id === message.playerId && item.token === message.playerToken);
        if (player) player.connected = true;
      }
      if (!player) {
        const name = String(message.name || '').trim().replace(/\s+/g,' ').slice(0,24);
        if (runtime.game.started) {
          runtime.link.publish(pendingTopic,{t:'error',error:'This world has already started.'});
          return;
        }
        if (name.length < 2 || /[\u0000-\u001f\u007f]/.test(name)) {
          runtime.link.publish(pendingTopic,{t:'error',error:'Player name must be 2–24 characters.'});
          return;
        }
        if (runtime.game.players.length >= MAX_PLAYERS) {
          runtime.link.publish(pendingTopic,{t:'error',error:'This world has reached its player limit.'});
          return;
        }
        if (runtime.game.players.some(item => item.name.toLowerCase() === name.toLowerCase())) {
          runtime.link.publish(pendingTopic,{t:'error',error:'That player name is already in use.'});
          return;
        }
        player = {
          id:byId(),name,isHost:false,countryIndex:null,treasury:1200,dailyBalanceRemainder:0,
          buildings:{},connected:true,token:token()
        };
        runtime.game.players.push(player);
        runtime.game.worldVersion++;
        pushActivity(runtime.game,name + ' joined the world.');
        pushEvent(runtime.game,'player.joined',player.id,null,name + ' joined the world.');
      }
      const session = {
        gameId:runtime.game.id,playerId:player.id,playerToken:player.token,
        inviteCode:runtime.room,isHost:false,playerName:player.name
      };
      runtime.link.publish(pendingTopic,{t:'welcome',session,game:snapshot(runtime.game)},{qos:1});
      persistHost();
      publishSnapshot();
      return;
    }
    if (message.t === 'order') {
      const player = runtime.game.players.find(item =>
        item.id === message.playerId && item.token === message.playerToken);
      if (!player) {
        emitOrderResult(message.playerId,{id:message.order?.orderId,accepted:false,
          code:'UNAUTHORIZED',error:'Player authentication failed.',replayed:false});
        return;
      }
      const result = applyOrder(runtime.game,player,message.order);
      emitOrderResult(player.id,result);
      persistHost();
      publishSnapshot();
    }
    if (message.t === 'bye') {
      const leaving = runtime.game.players.find(item =>
        item.id === message.playerId && item.token === message.playerToken);
      if (leaving) {
        leaving.connected = false;
        runtime.game.pauseVotePlayerIds = runtime.game.pauseVotePlayerIds.filter(id => id !== leaving.id);
        persistHost();
        publishSnapshot();
      }
      return;
    }
    if (message.t === 'admin') {
      const player = runtime.game.players.find(item =>
        item.id === message.playerId && item.token === message.playerToken);
      if (!player || player.id !== runtime.game.hostPlayerId) {
        runtime.link.publish(runtime.topics.server,{t:'adminResult',to:message.playerId,
          requestId:message.requestId,ok:false,error:'Only the host can manage this world.'});
        return;
      }
      const result = applyAdmin(runtime.game,message.action,message.payload);
      runtime.link.publish(runtime.topics.server,{t:'adminResult',to:player.id,
        requestId:message.requestId,ok:result.ok,error:result.error,
        game:result.ok ? snapshot(runtime.game) : null});
      if (result.ok) { persistHost(); publishSnapshot(); }
    }
  }

  function applyAdmin(game,action,payload) {
    if (action === 'assign') {
      if (game.started) return {ok:false,error:'State assignments are locked after the world starts.'};
      const player = game.players.find(item => item.id === payload.playerId);
      if (!player) return {ok:false,error:'Player not found.'};
      if (payload.countryIndex !== null &&
          (!Number.isInteger(payload.countryIndex) || !game.territories[payload.countryIndex]))
        return {ok:false,error:'Invalid state assignment.'};
      player.countryIndex = payload.countryIndex;
      if (payload.countryIndex === null) {
        const leaving = game.memberships.filter(item =>
          item.playerId === player.id && item.status === 'active');
        for (const membership of leaving) membership.status = 'left';
        for (const stateId of new Set(leaving.map(item => item.stateId))) {
          const territory = game.territories.find(item => item.stateId === stateId);
          const stillHasMembers = game.memberships.some(item =>
            item.stateId === stateId && item.status === 'active');
          if (territory?.ownerPlayerId === player.id && !stillHasMembers)
            territory.ownerPlayerId = null;
        }
      } else {
        const territory = game.territories[payload.countryIndex];
        const active = activeMemberships(game,player.id);
        if (!active.some(item => item.stateId === territory.stateId)) {
          const accumulated = (territory.dailyBalanceRemainder || 0) + (player.dailyBalanceRemainder || 0);
          const transfer = player.treasury + Math.trunc(accumulated / 30);
          territory.treasury += transfer;
          territory.dailyBalanceRemainder = accumulated % 30;
          player.treasury = 0;
          player.dailyBalanceRemainder = 0;
          territory.ownerPlayerId ||= player.id;
          game.memberships.push({
            id:byId(),gameId:game.id,playerId:player.id,stateId:territory.stateId,
            status:'active',permissionSetId:'government-member',joinedAtWorldDate:game.worldDate
          });
          game.financialTransactions.push({
            id:byId(),stateId:territory.stateId,type:'membershipTransfer',amount:transfer,
            balanceAfter:territory.treasury,description:'Initial treasury transferred to ' + territory.name + '.',
            worldDate:game.worldDate
          });
        }
      }
      pushActivity(game,player.name + ' was assigned to ' +
        (payload.countryIndex === null ? 'no State' : game.territories[payload.countryIndex].name) + '.');
    } else if (action === 'start') {
      if (game.started) return {ok:false,error:'The world has already started.'};
      if (game.players.some(player => activeMemberships(game,player.id).length === 0))
        return {ok:false,error:'Assign a state to every player before starting.'};
      game.started = true;
      game.status = 'running';
      game.paused = false;
      game.lastTickUtc = new Date().toISOString();
      runtime.lastPulseAt = Date.now();
      runtime.clockAccumulatorMs = 0;
      pushActivity(game,'The world began.');
    } else if (action === 'configure') {
      if (game.started) return {ok:false,error:'Scenario configuration is locked after the world starts.'};
      const map = {
        economy:{goods:'goods',productionRecipes:'productionRecipes',companies:'companies',
          markets:'markets',tradeRoutes:'tradeRoutes',populationGroups:'populationGroups'},
        territory:{provinces:'provinces',settlements:'settlements',connections:'provinceConnections',
          controls:'territorialControls',sovereigntyHistory:'sovereigntyHistory'},
        military:{unitTypes:'militaryUnitTypes',commanders:'militaryCommanders',units:'militaryUnits',
          routes:'militaryRoutes',supplyRoutes:'supplyRoutes',occupations:'occupations'},
        technology:{technologies:'technologies',researchInstitutions:'researchInstitutions',
          researchProjects:'researchProjects',technologyUnlocks:'technologyUnlocks',
          technologyAdoptions:'technologyAdoptions'}
      };
      const fields = map[payload.kind];
      if (!fields) return {ok:false,error:'Unknown scenario configuration.'};
      for (const [key,target] of Object.entries(fields)) {
        if (!Array.isArray(payload.configuration[key]))
          return {ok:false,error:'Scenario configuration requires an array for ' + key + '.'};
        game[target] = clone(payload.configuration[key]);
      }
      if (payload.kind === 'economy') game.companies = game.companies || [];
      pushActivity(game,'The host updated the ' + payload.kind + ' scenario.');
    } else if (action === 'close') {
      game.status = 'closed';
      pushActivity(game,'The host closed this world.');
    } else {
      return {ok:false,error:'Unknown host operation.'};
    }
    game.worldVersion++;
    pushEvent(game,'world.' + action,game.hostPlayerId,null,game.activity[0]);
    return {ok:true};
  }

  function receiveGuest(topic,message) {
    if (!runtime || runtime.role !== 'guest') return;
    if (topic === runtime.topics.host && message.t === 'presence') {
      runtime.hostOnline = message.online === true;
      runtime.onStatus(runtime.hostOnline ? 'Connected to the host relay.' : 'Host offline — waiting for the host to reconnect.');
      if (runtime.hostOnline) sendHello();
      return;
    }
    if (topic === runtime.topics.pending(runtime.link.clientNonce)) {
      if (message.t === 'error') {
        runtime.rejectJoin(new Error(message.error || 'Could not join the world.'));
      } else if (message.t === 'welcome') {
        runtime.session = message.session;
        runtime.playerId = message.session.playerId;
        runtime.room = message.session.inviteCode;
        runtime.topics = topicSet(runtime.room);
        runtime.link.playerId = runtime.playerId;
        runtime.link.client.subscribe(runtime.topics.private(runtime.playerId),{qos:1});
        runtime.link.publish(runtime.topics.presence(runtime.playerId),{
          t:'presence',playerId:runtime.playerId,online:true
        },{retain:true,qos:1});
        runtime.onSession(runtime.session);
        runtime.onSnapshot(message.game);
        runtime.resolveJoin(runtime.session);
      }
      return;
    }
    if (topic === runtime.topics.server) {
      if (message.to && message.to !== runtime.playerId) return;
      if (message.t === 'snapshot' && message.game) runtime.onSnapshot(message.game);
      if (message.t === 'orderResult' && message.to === runtime.playerId)
        runtime.onOrderResult(message.order);
      if (message.t === 'adminResult' && message.requestId)
        runtime.resolveAdmin(message);
      if (message.t === 'roomClosed') runtime.onStatus('The host closed this world.');
      return;
    }
    if (topic === runtime.topics.private(runtime.playerId) && message.t === 'welcome') {
      runtime.onSnapshot(message.game);
    }
  }

  function sendHello() {
    if (!runtime || runtime.role !== 'guest' || !runtime.link.connected) return;
    runtime.link.publish(runtime.topics.clients,{
      t:'hello',clientNonce:runtime.link.clientNonce,name:runtime.name,
      playerId:runtime.session?.playerId || null,
      playerToken:runtime.session?.playerToken || null
    },{qos:1});
  }

  function setHostRuntime(game,session,handlers) {
    runtime = {
      role:'host',game,session,room:session.inviteCode || session.roomCode,
      topics:topicSet(session.inviteCode || session.roomCode),
      onSnapshot:handlers.onSnapshot || (()=>{}),
      onStatus:handlers.onStatus || (()=>{}),
      onOrderResult:handlers.onOrderResult || (()=>{}),
      onSession:handlers.onSession || (()=>{})
    };
    runtime.session.inviteCode = runtime.room;
    runtime.session.roomCode = runtime.room;
    runtime.lastPulseAt = Date.now();
    runtime.clockAccumulatorMs = 0;
    runtime.game.players.forEach(player => { player.connected = player.id === runtime.session.playerId; });
    runtime.hasConnected = false;
    runtime.link = new BrokerLink('host',runtime.room,session.playerId,
      hostReceive,(status) => {
        if (status === 'ready') {
          runtime.hasConnected = true;
          const host = runtime.game.players.find(player => player.id === runtime.session.playerId);
          if (host) host.connected = true;
          runtime.lastPulseAt = Date.now();
          runtime.onStatus('ready');
          persistHost();
          publishSnapshot();
        } else {
          if (runtime.hasConnected && !runtime.link.connected) {
            const host = runtime.game.players.find(player => player.id === runtime.session.playerId);
            if (host) host.connected = false;
            runtime.lastPulseAt = Date.now();
            if (runtime.game.started && runtime.game.status === 'running') {
              runtime.game.status = 'paused';
              runtime.game.paused = true;
              runtime.game.pauseVotePlayerIds = [];
              runtime.game.worldVersion++;
              pushActivity(runtime.game,'The world paused because the host lost its relay connection.');
              pushEvent(runtime.game,'world.paused.no_players',null,null,
                'The world paused because the host lost its relay connection.');
            }
            persistHost();
          }
          runtime.onStatus(status);
        }
      });
  }

  function createWorld(name,handlers = {}) {
    const normalized = String(name || '').trim().replace(/\s+/g,' ').slice(0,24);
    if (normalized.length < 2 || /[\u0000-\u001f\u007f]/.test(normalized))
      return Promise.reject(new Error('Player name must be 2–24 characters.'));
    const created = newWorld(normalized);
    const room = roomCode();
    created.session.inviteCode = room;
    created.session.roomCode = room;
    setHostRuntime(created.game,created.session,handlers);
    const active = runtime;
    return new Promise((resolve,reject) => {
      const timeout = setTimeout(() => {
        if (runtime === active) active.link.close(false);
        reject(new Error('Could not connect to a public MQTT relay. Check the connection and try again.'));
      },30000);
      const previous = active.onStatus;
      active.onStatus = status => {
        previous(status);
        if (status === 'ready' && runtime === active) {
          clearTimeout(timeout);
          handlers.onSession?.(active.session);
          persistHost();
          resolve({session:active.session,game:snapshot(active.game)});
        } else if (String(status).startsWith('Relay error:') && !active.link.client) {
          clearTimeout(timeout);
          reject(new Error(status));
        }
      };
      active.link.start();
    });
  }

  function joinWorld(code,name,handlers = {},existingSession = null) {
    const room = String(code || '').trim().toUpperCase();
    if (!/^[A-HJ-NP-Z2-9]{8}$/.test(room))
      return Promise.reject(new Error('Enter the 8-character world invitation code.'));
    const normalized = String(name || '').trim().replace(/\s+/g,' ').slice(0,24);
    if (!existingSession && (normalized.length < 2 || /[\u0000-\u001f\u007f]/.test(normalized)))
      return Promise.reject(new Error('Player name must be 2–24 characters.'));
    const active = {
      role:'guest',room,topics:topicSet(room),name:normalized,session:existingSession,
      playerId:existingSession?.playerId || null,hostOnline:false,
      onSnapshot:handlers.onSnapshot || (()=>{}),
      onStatus:handlers.onStatus || (()=>{}),
      onOrderResult:handlers.onOrderResult || (()=>{}),
      onSession:handlers.onSession || (()=>{}),
      resolveJoin:null,rejectJoin:null,adminRequests:new Map()
    };
    runtime = active;
    active.link = new BrokerLink('guest',room,active.playerId,receiveGuest,
      status => {
        active.onStatus(status);
        if (status === 'connected' && active.hostOnline) sendHello();
      });
    return new Promise((resolve,reject) => {
      active.resolveJoin = resolve;
      active.rejectJoin = error => reject(error);
      const timeout = setTimeout(() => {
        if (runtime === active) active.link.close(false);
        reject(new Error('World not found or its host is offline. Check the code and try again.'));
      },30000);
      const resolveOnce = active.resolveJoin;
      active.resolveJoin = session => {
        clearTimeout(timeout);
        resolveOnce(session);
      };
      active.link.start();
    });
  }

  function restoreSession(session,handlers = {}) {
    if (session?.isHost) {
      let saved;
      try { saved = JSON.parse(localStorage.getItem(HOST_SAVE + session.inviteCode)); } catch {}
      if (!saved?.game || saved.game.id !== session.gameId ||
          saved.game.hostPlayerId !== session.playerId) {
        return Promise.reject(new Error('The host save is not available in this browser. The original host device is required.'));
      }
      setHostRuntime(saved.game,saved.session || session,handlers);
      runtime.link.start();
      return Promise.resolve({session:runtime.session,game:snapshot(runtime.game)});
    }
    if (!session?.inviteCode || !session.playerToken)
      return Promise.reject(new Error('The saved multiplayer session is incomplete.'));
    const name = session.playerName || handlers.playerName || 'PLAYER';
    return joinWorld(session.inviteCode,name,handlers,session).then(restored => ({
      session:restored,game:null
    }));
  }

  function sendOrder(order) {
    if (!runtime) return false;
    if (runtime.role === 'host') {
      const player = runtime.game.players.find(item =>
        item.id === runtime.session.playerId && item.token === runtime.session.playerToken);
      if (!player) return false;
      const result = applyOrder(runtime.game,player,order);
      runtime.onOrderResult(result);
      persistHost();
      publishSnapshot();
      return true;
    }
    if (!runtime.link.connected || !runtime.session) return false;
    return runtime.link.publish(runtime.topics.clients,{
      t:'order',playerId:runtime.session.playerId,playerToken:runtime.session.playerToken,order
    },{qos:1});
  }

  function admin(action,payload = {}) {
    if (!runtime || !runtime.session) return Promise.reject(new Error('No active multiplayer session.'));
    if (runtime.role === 'host') {
      const result = applyAdmin(runtime.game,action,payload);
      if (!result.ok) return Promise.reject(new Error(result.error));
      persistHost();
      publishSnapshot();
      return Promise.resolve(snapshot(runtime.game));
    }
    if (!runtime.link.connected) return Promise.reject(new Error('The relay connection is offline.'));
    const requestId = byId();
    return new Promise((resolve,reject) => {
      const timer = setTimeout(() => {
        runtime.adminRequests.delete(requestId);
        reject(new Error('The host did not respond to the request.'));
      },15000);
      runtime.adminRequests.set(requestId,{resolve,reject,timer});
      runtime.link.publish(runtime.topics.clients,{
        t:'admin',playerId:runtime.session.playerId,playerToken:runtime.session.playerToken,
        requestId,action,payload
      },{qos:1});
    });
  }

  function resolveAdmin(message) {
    const pending = runtime?.adminRequests?.get(message.requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    runtime.adminRequests.delete(message.requestId);
    if (message.ok) pending.resolve(message.game || true);
    else pending.reject(new Error(message.error || 'The host rejected the request.'));
  }

  function disconnect(closeHostedWorld = false) {
    if (!runtime) return;
    const active = runtime;
    if (active.role === 'host' && closeHostedWorld) {
      applyAdmin(active.game,'close',{});
      active.link.publish(active.topics.server,{t:'roomClosed'},{qos:1});
      persistHost();
    } else if (active.role === 'guest' && active.session) {
      active.link.publish(active.topics.clients,{
        t:'bye',playerId:active.session.playerId,playerToken:active.session.playerToken
      },{qos:1});
    }
    active.link.close(true);
    runtime = null;
  }

  function testRelay() {
    return new Promise((resolve,reject) => {
      if (typeof mqtt === 'undefined') {
        reject(new Error('MQTT library failed to load.'));
        return;
      }
      const url = BROKERS[0];
      let client;
      const timer = setTimeout(() => {
        try { client?.end(true); } catch {}
        reject(new Error('The public relay did not respond.'));
      },12000);
      try {
        client = mqtt.connect(url,{
          connectTimeout:9000,reconnectPeriod:0,keepalive:15,clean:true,
          clientId:'nw-test-' + token(8)
        });
        client.once('connect',() => {
          clearTimeout(timer);
          client.end(true);
          resolve({status:'ready',broker:url});
        });
        client.once('error',error => {
          clearTimeout(timer);
          try { client.end(true); } catch {}
          reject(error);
        });
      } catch (error) {
        clearTimeout(timer);
        reject(error);
      }
    });
  }

  setInterval(hostPulse,1000);

  window.NewWorldMultiplayer = {
    createWorld,joinWorld,restoreSession,sendOrder,admin,disconnect,testRelay,
    isHost:() => runtime?.role === 'host',
    isConnected:() => !!runtime?.link?.connected,
    currentSession:() => runtime?.session || null,
    currentRoom:() => runtime?.room || ''
  };
})();