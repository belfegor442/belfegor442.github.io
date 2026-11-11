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
  const STARTING_TERRITORY_INDEX = 0;
  const STATE_CATALOG = Object.freeze([
    {key:'coimbrila',name:'Kingdom of Coimbrila'},
    {key:'gania',name:'United Provinces of Gania'},
    {key:'chungia',name:'Chungia'},
    {key:'calcilacia',name:'Calcilacia'},
    {key:'pician-empire',name:'Pician Empire'},
    {key:'meityeun-theocracy',name:'Meityeun Theocracy'},
    {key:'swabing',name:'Swabing'},
    {key:'alba',name:'Alba'},
    {key:'knosian-despotate',name:'Knosian Despotate'},
    {key:'kalestos',name:'Kalestos'},
    {key:'gorkirch',name:'Gorkirch'},
    {key:'shonewesia',name:'Duchy of Shonewesia'},
    {key:'shahtehaq',name:'Shahtehaq'},
    {key:'kvinian-empire',name:'Kvinian Empire'},
    {key:'shi',name:'Shi'},
    {key:'kueopia',name:'Kueopia'}
  ]);
  const worldPlayerLimit = game => Math.max(1,Math.min(MAX_PLAYERS,
    Math.floor(Number(game?.maxHumanPlayers) || MAX_PLAYERS)));

  const HOST_SAVE_FORMAT = 'north-assembly-new-world-save';
  const HOST_SAVE_SCHEMA = 3;
  const HOST_SAVE_SLOTS = ['a','b'];
  const MAX_CLOCK_DAYS_PER_PULSE = 24;

  function hostSaveChecksum(value) {
    const input=String(value);
    let hash=2166136261;
    for(let index=0;index<input.length;index++) {
      hash^=input.charCodeAt(index);
      hash=Math.imul(hash,16777619);
    }
    return (hash>>>0).toString(16).padStart(8,'0');
  }

  function validWorldDate(value) {
    if(typeof value!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed=new Date(value+'T00:00:00.000Z');
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0,10)===value;
  }

  function validHostGame(game) {
    if(!game || typeof game!=='object' || !game.id || !game.hostPlayerId ||
       !Array.isArray(game.players) || game.players.length<1 ||
       game.players.length>MAX_PLAYERS || !Array.isArray(game.territories) ||
       game.territories.length<1 || !Number.isSafeInteger(game.day) || game.day<1 ||
       !validWorldDate(game.worldDate) || !Number.isSafeInteger(game.worldVersion) ||
       game.worldVersion<0) return false;
    const playerIds=game.players.map(player=>player?.id);
    const stateIds=game.territories.map(territory=>territory?.stateId);
    if(playerIds.some(id=>typeof id!=='string' || !id) ||
       new Set(playerIds).size!==playerIds.length ||
       stateIds.some(id=>typeof id!=='string' || !id) ||
       new Set(stateIds).size!==stateIds.length ||
       !playerIds.includes(game.hostPlayerId)) return false;
    if(game.memberships!==undefined && !Array.isArray(game.memberships)) return false;
    if(game.memberships?.some(item=>item?.status==='active' &&
       (!playerIds.includes(item.playerId) || !stateIds.includes(item.stateId)))) return false;
    return true;
  }

  function createHostSaveEnvelope(game,session,room,generation,clockAccumulatorMs=0,savedAt=new Date().toISOString()) {
    const payload={
      room:String(room || ''),
      gameId:String(game?.id || ''),
      hostPlayerId:String(game?.hostPlayerId || ''),
      clockAccumulatorMs:Number.isFinite(clockAccumulatorMs)
        ? Math.max(0,Math.min(Number.MAX_SAFE_INTEGER,clockAccumulatorMs)) : 0,
      game,session
    };
    const serialized=JSON.stringify(payload);
    return {
      format:HOST_SAVE_FORMAT,
      schemaVersion:HOST_SAVE_SCHEMA,
      generation:Math.max(1,Math.floor(Number(generation) || 1)),
      savedAt,
      checksum:hostSaveChecksum(serialized),
      payload
    };
  }

  function validateHostSaveEnvelope(envelope,expected={}) {
    if(!envelope || envelope.format!==HOST_SAVE_FORMAT ||
       envelope.schemaVersion!==HOST_SAVE_SCHEMA ||
       !Number.isSafeInteger(envelope.generation) || envelope.generation<1 ||
       !envelope.payload || typeof envelope.payload!=='object') return {valid:false,reason:'SAVE_FORMAT_INVALID'};
    let serialized;
    try { serialized=JSON.stringify(envelope.payload); }
    catch { return {valid:false,reason:'SAVE_PAYLOAD_UNREADABLE'}; }
    if(hostSaveChecksum(serialized)!==envelope.checksum)
      return {valid:false,reason:'SAVE_CHECKSUM_MISMATCH'};
    const payload=envelope.payload;
    if(!validHostGame(payload.game) ||
       payload.gameId!==payload.game.id ||
       payload.hostPlayerId!==payload.game.hostPlayerId ||
       !Number.isFinite(payload.clockAccumulatorMs) ||
       payload.clockAccumulatorMs<0 ||
       payload.clockAccumulatorMs>Number.MAX_SAFE_INTEGER)
      return {valid:false,reason:'SAVE_WORLD_INVALID'};
    if(payload.session &&
       (payload.session.gameId!==payload.game.id ||
        payload.session.playerId!==payload.game.hostPlayerId))
      return {valid:false,reason:'SAVE_SESSION_MISMATCH'};
    if(expected.room && payload.room!==expected.room)
      return {valid:false,reason:'SAVE_ROOM_MISMATCH'};
    if(expected.gameId && payload.gameId!==expected.gameId)
      return {valid:false,reason:'SAVE_GAME_MISMATCH'};
    if(expected.hostPlayerId && payload.hostPlayerId!==expected.hostPlayerId)
      return {valid:false,reason:'SAVE_HOST_MISMATCH'};
    return {valid:true,payload,generation:envelope.generation,savedAt:envelope.savedAt || null};
  }

  const TECHNICAL_MAINTENANCE_MAX_REASON=240;

  function createTechnicalMaintenanceMessage(gameId,active,reason='',revision=0,changedAt=new Date().toISOString()) {
    if(typeof gameId!=='string'||gameId.length<2||gameId.length>120||
       typeof active!=='boolean'||!Number.isSafeInteger(revision)||revision<1||
       typeof changedAt!=='string'||!Number.isFinite(Date.parse(changedAt))||
       new Date(changedAt).toISOString()!==changedAt) return null;
    const cleanReason=String(reason||'').trim()
      .replace(/[\u0000-\u001f\u007f<>]/g,' ')
      .replace(/\s+/g,' ').slice(0,TECHNICAL_MAINTENANCE_MAX_REASON);
    if(active && cleanReason.length<5) return null;
    return {
      t:'maintenance',protocolVersion:1,gameId,active,
      reason:active?cleanReason:'',revision,changedAt
    };
  }

  function validateTechnicalMaintenanceMessage(message,expectedGameId) {
    if(!message||message.t!=='maintenance'||message.protocolVersion!==1||
       message.gameId!==expectedGameId||typeof message.active!=='boolean'||
       !Number.isSafeInteger(message.revision)||message.revision<1||
       typeof message.changedAt!=='string'||!Number.isFinite(Date.parse(message.changedAt))||
       new Date(message.changedAt).toISOString()!==message.changedAt||
       typeof message.reason!=='string'||message.reason.length>TECHNICAL_MAINTENANCE_MAX_REASON||
       /[\u0000-\u001f\u007f<>]/.test(message.reason)||
       (message.active&&message.reason.trim().length<5)||
       (!message.active&&message.reason!=='')) return null;
    return {
      active:message.active,reason:message.reason,
      revision:message.revision,changedAt:message.changedAt
    };
  }

  function clockElapsedMs(previousAt,nowAt) {
    const previous=Number(previousAt);
    const now=Number(nowAt);
    if(!Number.isFinite(previous) || !Number.isFinite(now) || now<=previous) return 0;
    return now-previous;
  }

  function accumulateClockMs(accumulatorMs,elapsedMs) {
    const accumulator=Number(accumulatorMs);
    const elapsed=Number(elapsedMs);
    const base=Number.isFinite(accumulator) && accumulator>0 ? accumulator : 0;
    const added=Number.isFinite(elapsed) && elapsed>0 ? elapsed : 0;
    return Math.min(Number.MAX_SAFE_INTEGER,base+added);
  }

  function takeDueClockDays(accumulatorMs,dayLimit=MAX_CLOCK_DAYS_PER_PULSE) {
    const accumulator=Number.isFinite(accumulatorMs) && accumulatorMs>0 ? accumulatorMs : 0;
    const limit=Math.max(0,Math.min(MAX_CLOCK_DAYS_PER_PULSE,Math.floor(Number(dayLimit) || 0)));
    const due=Math.floor(accumulator/DAY_LENGTH_MS);
    const days=Math.min(due,limit);
    return {days,remainingMs:accumulator-days*DAY_LENGTH_MS,pendingDays:due-days};
  }
  const LEGACY_STATE_NAMES = [
    "Founders' Reach",'North Coast','Eastern Coast','Upper March',
    'Western Vale','Highland Basin','Orren Foothills','Eastern Uplands',
    'Western Lowlands','Central Forest','Southern Plain','Eastern Marches',
    'South Coast','Great Riverland','Southern Reach','Far Coast'
  ];
  const LEGACY_PLOT_OFFSET = 144;
  const WORLD_MAP_SIZE = 1024;
  const MAX_WORLD_PLOT_INDEX = LEGACY_PLOT_OFFSET + WORLD_MAP_SIZE * WORLD_MAP_SIZE;
  const BUILDINGS = {
    farm: {id:'farm',name:'FARM',cost:120,income:18,icon:'F',days:2,foodCapacity:5000,jobSlots:1200,upkeep:3,description:'Adds food capacity and agricultural employment.'},
    market: {id:'market',name:'MARKET',cost:220,income:34,icon:'M',days:3,jobSlots:800,upkeep:3,description:'Creates commercial jobs and local exchange.'},
    workshop: {id:'workshop',name:'WORKSHOP',cost:360,income:52,icon:'W',days:4,jobSlots:1800,upkeep:5,description:'Creates industrial jobs.'},
    housing: {id:'housing',name:'HOUSING',cost:180,income:8,icon:'H',days:2,housingCapacity:1000,upkeep:2,description:'Adds housing capacity for residents.'},
    waterworks: {id:'waterworks',name:'WATERWORKS',cost:300,income:6,icon:'U',days:4,waterCapacity:5000,jobSlots:250,upkeep:5,description:'Provides clean water capacity.'},
    clinic: {id:'clinic',name:'CLINIC',cost:420,income:4,icon:'C',days:5,healthCapacity:5000,jobSlots:300,upkeep:7,description:'Provides healthcare services.'},
    school: {id:'school',name:'SCHOOL',cost:360,income:5,icon:'S',days:5,educationCapacity:5000,jobSlots:350,upkeep:6,description:'Provides education services.'},
    road: {id:'road',name:'ROAD',cost:65,income:0,icon:'R',days:1,jobSlots:40,upkeep:1,description:'Improves local access and transport.'}
  };
  function isValidBuildSprite(buildingId,spriteKey) {
    if (!spriteKey) return true;
    if (typeof spriteKey !== "string" || spriteKey.length > 120) return false;
    const parts = spriteKey.split("/");
    if (parts.length !== 2) return false;
    const [category,asset] = parts;
    if (!/^[a-z0-9_-]+$/.test(category) || !/^[a-z0-9_-]+$/.test(asset)) return false;
    switch (buildingId) {
      case "farm": return category === "village" && ["1x1_farmhouse_barn","1x1_fisherman_hut"].includes(asset);
      case "market": return (category === "restaurants" || category === "stores") && asset.startsWith("1x1_commercial_") && asset !== "1x1_commercial_57_clinic" || category === "village" && asset === "1x1_market_stall";
      case "workshop": return category === "village" && asset === "1x1_lumber_shed";
      case "housing": return category === "houses" && asset.startsWith("1x1_house") && Number.isInteger(Number(asset.slice(9))) || category === "village" && ["1x1_dovecote","1x1_longhouse","1x1_round_cottage"].includes(asset);
      case "waterworks": return category === "watertower" && asset.startsWith("1x1_");
      case "clinic": return category === "stores" && asset === "1x1_commercial_57_clinic" || category === "village" && asset === "1x1_apothecary";
      case "school": return category === "village" && asset === "1x1_village_hall";
      case "road": return false;
      default: return false;
    }
  }
  const NAMES = STATE_CATALOG.map(item => item.name);
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
      this.connectionGeneration = 0;
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
      this.connectionGeneration++;
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
          this.onStatus('Could not subscribe to this relay. Trying another relay…');
          if (client === this.client && !this.closed) this.scheduleBrokerRotation();
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
      memberships:[], events:[], orders:[], scheduledOrders:[], currencies:[], diplomaticRelations:[],
      financialTransactions:[],companyFinancialTransactions:[],marketHistory:[],
      goods:[],productionRecipes:[],
      populationGroups:[], companies:[], markets:[], tradeRoutes:[], politicalSystems:[],
      provinces:[], settlements:[], provinceConnections:[], territorialControls:[],
      sovereigntyHistory:[], militaryUnitTypes:[], militaryCommanders:[], militaryUnits:[],
      militaryOrders:[], militaryBattles:[], militaryRoutes:[], supplyRoutes:[], supplyRules:[],
      supplyStocks:[],supplyShipments:[],supplyHistory:[],occupations:[],
      technologies:[], researchInstitutions:[], researchProjects:[], technologyUnlocks:[],
      technologyAdoptions:[],justiceSystems:[],justiceReports:[],justiceCases:[],justiceHistory:[],
      importantNpcs:[],demographicProfiles:[],demographicEvents:[],migrationRecords:[],
      epidemicDefinitions:[],epidemicStarts:[],epidemicOutbreaks:[],
      epidemicGroupStates:[],epidemicHistory:[],
      resourceDeposits:[],waterAllocationDate:null,waterAllocations:[],waterBalances:[],
      waterHistory:[],resourceCycleDate:null,resourceCycleResult:null,
      livestockSites:[],fishingGrounds:[],forestAreas:[],primaryProductionCycles:[],
      administrativeAgencies:[],administrativeDepartments:[],
      civilServants:[],administrativeProcedures:[],administrativeJurisdictions:[],
      administrativeBudgets:[],publicProjects:[],procurementVendors:[],
      administrativeTasks:[],administrativeRecords:[],administrativeHistory:[],
      procurements:[],publicProjectAudits:[],publicRecords:[],
      mediaOutlets:[],publicOpinionProfiles:[],mediaRules:[],mediaArticles:[],
      opinionPolls:[],censorshipOrders:[],mediaHistory:[],mediaBroadcasts:[],
      publicOpinionHistory:[],securityAgencies:[],securityAuthorizations:[],
      securityIncidents:[],securityCases:[],securityReports:[],securityAlerts:[],securityHistory:[],
      securityWarrantRequests:[],securityWarrants:[],
      eventDefinitions:[],worldEvents:[],worldEventHistory:[],worldEventCounters:[],
      identityGroups:[],identityProfiles:[],identityOrganizations:[],communityPrograms:[],
      identityHistory:[],socialCohesionHistory:[],
      serviceTypes:[],publicServiceFacilities:[],publicServiceCoverage:[],publicServiceHistory:[],
      publicServiceCycleDate:null,publicServiceCycleResult:null,
      industryOccupations:[],labourPools:[],industryWorkplaces:[],labourUnions:[],
      industryEmploymentContracts:[],industryLabourBalances:[],industryHistory:[],
      industryPayrollDate:null,
      exchangeRates:[],financialBanks:[],taxRules:[],priceIndexConfigs:[],
      publicDebtIssues:[],bankTransactions:[],taxAssessments:[],priceIndexHistory:[],
      financeHistory:[],financeCycleDate:null,financeCycleResult:null,
      internationalOrganizations:[],diplomaticProposals:[],treaties:[],
      internationalSanctions:[],organizationResolutions:[],diplomaticConferences:[],
      diplomacyHistory:[],diplomacyCycleDate:null,diplomacyCycleResult:null
    };
  }

  function newWorld(name) {
    const gameId = byId();
    const playerId = byId();
    const hostToken = token();
    const game = {
      id:gameId,name:'New World',hostPlayerId:playerId,started:false,paused:false,status:'lobby',
      day:1,worldDate:'1500-01-01',worldVersion:1,eventSequence:0,
      scenarioId:'beleland-frontier',scenarioVersion:'2.1',scenarioSeed:byId(),
      maxHumanPlayers:MAX_PLAYERS,
      startingTerritoryIndex:STARTING_TERRITORY_INDEX,
      pauseVotePlayerIds:[],players:[{
        id:playerId,name,isHost:true,countryIndex:null,treasury:1200,dailyBalanceRemainder:0,
        buildings:{},connected:true,token:hostToken
      }],
      territories:STATE_CATALOG.map((stateDefinition,index) => ({
        stateId:byId(),scenarioStateKey:stateDefinition.key,currencyId:byId(),
        index,name:stateDefinition.name,treasury:0,dailyBalanceRemainder:0,
        population:index === STARTING_TERRITORY_INDEX ? 850 : 0,
        prosperity:index === STARTING_TERRITORY_INDEX ? 28 : 0,
        infrastructure:index === STARTING_TERRITORY_INDEX ? 1 : 0,
        ownerPlayerId:null,buildings:{},
        baseHousingCapacity:index === STARTING_TERRITORY_INDEX ? 1200 : 0,
        baseFoodCapacity:index === STARTING_TERRITORY_INDEX ? 1200 : 0,
        baseWaterCapacity:index === STARTING_TERRITORY_INDEX ? 1200 : 0,
        baseJobCapacity:index === STARTING_TERRITORY_INDEX ? 200 : 0,
        populationGrowthLastDay:0
      })),
      activity:[name + ' founded the first settlement. The surrounding regions are unclaimed.'],
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
    Object.assign(game, window.NewWorldSimulation.createStarterEconomy(
      [game.territories[STARTING_TERRITORY_INDEX]],byId));
    if (window.NewWorldJustice?.ensure) window.NewWorldJustice.ensure(game);
    else {
      game.justiceSystems=game.territories.map(territory=>({
        stateId:territory.stateId,configurationVersion:1,configurationPending:true,
        crimeTypes:[],courts:[],policeAgencies:[],prisons:[]
      }));
      game.justiceReports=[];game.justiceCases=[];game.justiceHistory=[];
    }
    window.NewWorldResources?.ensure?.(game);
    window.NewWorldServices?.ensure?.(game);
    window.NewWorldIndustry?.ensure?.(game);
    window.NewWorldFinance?.ensure?.(game);
    window.NewWorldDiplomacy?.ensure?.(game);
    if (!window.NewWorldStrategy?.createStarterScenario)
      throw new Error('The New World strategy engine failed to load.');
    window.NewWorldStrategy.createStarterScenario(game,byId);
    const hostAssignment = assignLobbyPlayer(game, game.players[0], STARTING_TERRITORY_INDEX);
    if (!hostAssignment.ok)
      throw new Error('The host could not be assigned to the starting State: ' + hostAssignment.error);
    const hostMembership = activeMemberships(game,playerId)[0];
    if (hostMembership) hostMembership.permissionSetId = 'government-executive';
    const foundingSystem = game.politicalSystems.find(item => item.stateId === game.territories[0].stateId);
    if (foundingSystem) {
      const chief = foundingSystem.offices.find(item => item.id === 'chief-executive');
      const treasurer = foundingSystem.offices.find(item => item.id === 'treasurer');
      if (chief) chief.holderPlayerId = playerId;
      if (treasurer) treasurer.holderPlayerId = playerId;
      foundingSystem.government.chiefExecutivePlayerId = playerId;
    }
    if(window.NewWorldScenario?.createRecord)
      game.worldScenario=window.NewWorldScenario.createRecord(game,game.scenarioSeed);
    pushEvent(game,'world.created',playerId,null,
      'A new frontier was founded. ' + name + ' leads the first settlement at ' +
      game.territories[0].name + '.');
    return {
      game,
      session:{gameId,playerId,playerToken:hostToken,inviteCode:'',roomCode:'',isHost:true}
    };
  }

  function assignLobbyPlayer(game, player, requestedIndex = null) {
    if (!game || game.started || !player || !game.players.some(item => item.id === player.id))
      return {ok:false,error:'The player cannot be assigned in this lobby.'};
    let countryIndex = requestedIndex;
    if (countryIndex === null) {
      countryIndex = Number.isInteger(game.startingTerritoryIndex)
        ? game.startingTerritoryIndex
        : STARTING_TERRITORY_INDEX;
    }
    if (countryIndex === null || !Number.isInteger(countryIndex) || !game.territories[countryIndex])
      return {ok:false,error:'No valid State is available for this player.'};
    return applyAdmin(game,'assign',{playerId:player.id,countryIndex});
  }

  function canStartWorld(game) {
    return Boolean(game && !game.started && game.players.length > 0 &&
      game.players.every(player => activeMemberships(game,player.id).length > 0));
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

  function recordConnectedRosterChange(game,player,connected) {
    game.worldVersion = (Number(game.worldVersion) || 0) + 1;
    const stateId = activeMemberships(game,player.id)[0]?.stateId || null;
    const presenceDescription = player.name + (connected ? ' reconnected.' : ' disconnected.');
    pushActivity(game,presenceDescription);
    pushEvent(game,'player.presence_changed',player.id,stateId,presenceDescription);
    if ((game.pauseVotePlayerIds || []).length) {
      game.pauseVotePlayerIds = [];
      const resetDescription = 'The pause vote was reset because the connected player roster changed.';
      pushActivity(game,resetDescription);
      pushEvent(game,'world.pause_votes_reset',player.id,stateId,resetDescription);
    }
  }

  function migrateScenarioIdentity(game) {
    if (!game || game.scenarioId !== 'beleland-frontier' ||
        !Array.isArray(game.territories) || game.territories.length !== STATE_CATALOG.length)
      return false;
    let changed = false;
    for (let index=0;index<STATE_CATALOG.length;index++) {
      const territory = game.territories.find(item => item.index === index);
      if (!territory || territory.scenarioStateKey) continue;
      const definition = STATE_CATALOG[index];
      if (territory.name === LEGACY_STATE_NAMES[index] || territory.name === definition.name) {
        territory.scenarioStateKey = definition.key;
        if (territory.name === LEGACY_STATE_NAMES[index]) territory.name = definition.name;
        changed = true;
      }
    }
    if (!changed) return false;
    game.scenarioVersion = '2.1';
    game.worldVersion = (Number(game.worldVersion) || 0) + 1;
    const description = 'The Beleland State catalogue was upgraded to official State identities. Existing territory IDs, ownership, buildings and economy were preserved.';
    pushActivity(game,description);
    pushEvent(game,'world.state_catalog_migrated',game.hostPlayerId,null,description);
    return true;
  }

  function finance(game, territory) {
    const buildings = territory.buildings || {};
    const allBuildings = Object.values(buildings);
    const completed = allBuildings.filter(building => Number(building.daysRemaining || 0) <= 0);
    const sumEffect = key => completed.reduce((sum,building) => sum + Number(building[key] || 0),0);
    const controlled = Boolean(territory.ownerPlayerId);
    const territoryIncome = controlled
      ? Math.round(territory.population / 1500 * (territory.prosperity / 100))
      : 0;
    const cityIncome = controlled ? 85 + completed.reduce((sum,building) =>
      sum + Number(building.income || 0),0) : 0;
    const upkeep = completed.reduce((sum,building) => sum + Number(building.upkeep || 0),0);
    const metrics = window.NewWorldSimulation?.getSettlementMetrics
      ? window.NewWorldSimulation.getSettlementMetrics(territory)
      : {};
    return {
      territoryIncome,cityIncome,upkeep,monthlyBalance:territoryIncome+cityIncome-upkeep,
      buildings:clone(buildings),buildingCount:allBuildings.length,
      constructionCount:allBuildings.filter(building => Number(building.daysRemaining || 0) > 0).length,
      housingCapacity:Number(metrics.housingCapacity ?? (Number(territory.baseHousingCapacity || 0)+sumEffect('housingCapacity'))),
      foodCapacity:Number(metrics.foodCapacity ?? (Number(territory.baseFoodCapacity || 0)+sumEffect('foodCapacity'))),
      waterCapacity:Number(metrics.waterCapacity ?? (Number(territory.baseWaterCapacity || 0)+sumEffect('waterCapacity'))),
      healthCapacity:Number(metrics.healthCapacity ?? sumEffect('healthCapacity')),
      educationCapacity:Number(metrics.educationCapacity ?? sumEffect('educationCapacity')),
      jobCapacity:Number(metrics.jobCapacity ?? (Number(territory.baseJobCapacity || 0)+sumEffect('jobSlots'))),
      availableJobs:Number(metrics.availableJobs ?? territory.availableJobs ?? 0),
      workingAgePopulation:Number(metrics.workingAgePopulation ?? territory.workingAgePopulation ?? 0),
      populationGrowthLastDay:Number(territory.populationGrowthLastDay || 0)
    };
  }

  function playerRecord(game,player) {
    return {
      id:player.id,name:player.name,isHost:!!player.isHost,countryIndex:player.countryIndex,
      treasury:player.treasury,buildings:clone(player.buildings || {}),connected:!!player.connected,
      memberships:game.memberships.filter(item =>
        item.playerId === player.id && item.status === 'active').map(item => ({
          id:item.id,playerId:item.playerId,stateId:item.stateId,
          stateIndex:game.territories.find(territory => territory.stateId === item.stateId)?.index ?? -1,
          status:item.status,permissionSetId:item.permissionSetId
        }))
    };
  }

  function publishLobbyCount() {
    if (!runtime || runtime.role !== 'host') return;
    runtime.link.publish(runtime.topics.server,{
      t:'lobbyCount',
      totalPlayers:runtime.game.players.length,
      connectedPlayers:runtime.game.players.filter(player => player.connected).length,
      capacity:worldPlayerLimit(runtime.game)
    },{qos:0});
  }

  function notifyPlayerJoined(player) {
    if (!runtime || runtime.role !== 'host') return;
    runtime.onPlayerJoined?.(playerRecord(runtime.game,player));
    publishLobbyCount();
  }

  function notifyPlayerPresence(player) {
    if (!runtime || runtime.role !== 'host') return;
    runtime.onPlayerPresence?.(player.id,!!player.connected);
    publishLobbyCount();
  }

  function snapshot(game) {
    if (window.NewWorldJustice?.ensure) window.NewWorldJustice.ensure(game);
    window.NewWorldResources?.ensure?.(game);
    window.NewWorldServices?.ensure?.(game);
    window.NewWorldIndustry?.ensure?.(game);
    window.NewWorldBureaucracy?.ensure?.(game);
    window.NewWorldMedia?.ensure?.(game);
    window.NewWorldSecurity?.ensure?.(game);
    window.NewWorldWorldEvents?.ensure?.(game);
    window.NewWorldIdentity?.ensure?.(game);
    const memberships = game.memberships.map(item => ({...item}));
    const membershipByPlayer = new Map();
    for (const membership of memberships) {
      if (membership.status !== 'active') continue;
      if (!membershipByPlayer.has(membership.playerId)) membershipByPlayer.set(membership.playerId,[]);
      membershipByPlayer.get(membership.playerId).push(membership);
    }
    const players = game.players.map(player => playerRecord(game,player));
    const territories = game.territories.map(territory => ({
      stateId:territory.stateId,scenarioStateKey:territory.scenarioStateKey || null,
      index:territory.index,name:territory.name,treasury:territory.treasury,
      ...finance(game,territory),population:territory.population,prosperity:territory.prosperity,
      infrastructure:territory.infrastructure,ownerPlayerId:territory.ownerPlayerId,
      currencyId:territory.currencyId
    }));
    const out = {
      id:game.id,started:game.started,day:game.day,hostPlayerId:game.hostPlayerId,paused:game.paused,
      pauseVotePlayerIds:[...game.pauseVotePlayerIds],players,territories,activity:[...game.activity],
      orders:clone((game.orders || []).slice(-150)),
      orderHistoryTotal:(game.orders || []).length,
      scheduledOrders:clone((game.scheduledOrders || []).slice(-200)),
      name:game.name,status:game.status,worldDate:game.worldDate,worldVersion:game.worldVersion,
      scenarioId:game.scenarioId,scenarioVersion:game.scenarioVersion,
      scenarioSeed:game.scenarioSeed || null,worldScenario:clone(game.worldScenario || null),
      scenarioAudit:window.NewWorldScenario?.validate?.(game) || null,
      maxHumanPlayers:worldPlayerLimit(game),
      memberships, eventSequence:game.eventSequence,events:clone(game.events),
      politicalSystems:clone(game.politicalSystems),goods:clone(game.goods),
      productionRecipes:clone(game.productionRecipes),populationGroups:clone(game.populationGroups),
      markets:clone(game.markets),tradeRoutes:clone(game.tradeRoutes),currencies:clone(game.currencies),
      financialTransactions:clone(game.financialTransactions),
      companyFinancialTransactions:clone(game.companyFinancialTransactions),
      marketHistory:clone(game.marketHistory),
      companies:game.companies.map(company => ({
        ...clone(company),
        facilities:(company.facilities || []).map(facility => {
          const recipe = game.productionRecipes.find(item => item.id === facility.recipeId);
          return {
            ...clone(facility),
            recipeName:recipe?.name || facility.recipeId,
            daysPerBatch:recipe?.daysPerBatch || 1
          };
        })
      })),
      provinces:clone(game.provinces),settlements:clone(game.settlements),
      provinceConnections:clone(game.provinceConnections),territorialControls:clone(game.territorialControls),
      sovereigntyHistory:clone(game.sovereigntyHistory),militaryUnitTypes:clone(game.militaryUnitTypes),
      militaryCommanders:clone(game.militaryCommanders),militaryUnits:clone(game.militaryUnits),
      militaryOrders:clone(game.militaryOrders),militaryBattles:clone(game.militaryBattles),
      militaryRoutes:clone(game.militaryRoutes),supplyRoutes:clone(game.supplyRoutes),
      supplyRules:clone(game.supplyRules||[]),supplyStocks:clone(game.supplyStocks||[]),
      supplyShipments:clone(game.supplyShipments||[]),supplyHistory:clone(game.supplyHistory||[]),
      militarySupplyCycleDate:game.militarySupplyCycleDate||null,
      militarySupplyCycleResult:clone(game.militarySupplyCycleResult||null),
      occupations:clone(game.occupations),technologies:clone(game.technologies),
      researchInstitutions:clone(game.researchInstitutions),researchProjects:clone(game.researchProjects),
      technologyUnlocks:clone(game.technologyUnlocks),technologyAdoptions:clone(game.technologyAdoptions),
      justiceSystems:clone(game.justiceSystems || []),justiceReports:clone(game.justiceReports || []),
      justiceCases:clone(game.justiceCases || []),justiceHistory:clone(game.justiceHistory || []),
      importantNpcs:clone(game.importantNpcs || []),
      demographicProfiles:clone(game.demographicProfiles || []),
      demographicEvents:clone((game.demographicEvents || []).slice(-500)),
      migrationRecords:clone((game.migrationRecords || []).slice(-500)),
      epidemicDefinitions:clone(game.epidemicDefinitions || []),
      epidemicStarts:clone(game.epidemicStarts || []),
      epidemicOutbreaks:clone(game.epidemicOutbreaks || []),
      epidemicGroupStates:clone(game.epidemicGroupStates || []),
      epidemicHistory:clone((game.epidemicHistory || []).slice(-500)),
      resourceCatalog:clone(game.resourceCatalog || []),
      resourceDeposits:clone(game.resourceDeposits || []),
      livestockSites:clone(game.livestockSites || []),
      fishingGrounds:clone(game.fishingGrounds || []),
      forestAreas:clone(game.forestAreas || []),
      primaryProductionCycles:clone((game.primaryProductionCycles || []).slice(-500)),
      resourceCycleDate:game.resourceCycleDate || null,
      resourceCycleResult:clone(game.resourceCycleResult || null),
      resourceStocks:clone(game.resourceStocks || []),
      agriculturalLand:clone(game.agriculturalLand || []),
      cropDefinitions:clone(game.cropDefinitions || []),
      farms:clone(game.farms || []),
      climateZones:clone(game.climateZones || []),
      environmentalStates:clone(game.environmentalStates || []),
      disasters:clone(game.disasters || []),
      energySources:clone(game.energySources || []),
      energyBalances:clone(game.energyBalances || []),
      harvestCycles:clone((game.harvestCycles || []).slice(-500)),
      resourceHistory:clone((game.resourceHistory || []).slice(-500)),
      foodReserves:clone(game.foodReserves || []),
      waterSources:clone(game.waterSources || []),
      waterDemands:clone(game.waterDemands || []),
      waterBalances:clone(game.waterBalances || []),
      waterAllocationDate:game.waterAllocationDate || null,
      waterAllocations:clone(game.waterAllocations || []),
      waterHistory:clone((game.waterHistory || []).slice(-500)),
      serviceTypes:clone(game.serviceTypes || []),
      publicServiceFacilities:clone(game.publicServiceFacilities || []),
      publicServiceCoverage:clone(game.publicServiceCoverage || []),
      publicServiceHistory:clone((game.publicServiceHistory || []).slice(-500)),
      publicServiceCycleDate:game.publicServiceCycleDate || null,
      publicServiceCycleResult:clone(game.publicServiceCycleResult || null),
      industryOccupations:clone(game.industryOccupations || []),
      labourPools:clone(game.labourPools || []),
      industryWorkplaces:clone(game.industryWorkplaces || []),
      labourUnions:clone(game.labourUnions || []),
      industryEmploymentContracts:clone(game.industryEmploymentContracts || []),
      industryLabourBalances:clone(game.industryLabourBalances || []),
      industryHistory:clone((game.industryHistory || []).slice(-500)),
      industryPayrollDate:game.industryPayrollDate || null,
      administrativeAgencies:clone(game.administrativeAgencies || []),
      administrativeDepartments:clone(game.administrativeDepartments || []),
      civilServants:clone(game.civilServants || []),
      administrativeProcedures:clone(game.administrativeProcedures || []),
      administrativeJurisdictions:clone(game.administrativeJurisdictions || []),
      administrativeBudgets:clone(game.administrativeBudgets || []),
      administrativeTasks:clone(game.administrativeTasks || []),
      administrativeRecords:clone((game.administrativeRecords || []).slice(-500)),
      administrativeHistory:clone((game.administrativeHistory || []).slice(-500)),
      publicProjects:clone(game.publicProjects || []),
      procurementVendors:clone(game.procurementVendors || []),
      procurements:clone(game.procurements || []),
      publicProjectAudits:clone(game.publicProjectAudits || []),
      publicRecords:clone(game.publicRecords || []),
      mediaOutlets:clone(game.mediaOutlets || []),
      publicOpinionProfiles:clone(game.publicOpinionProfiles || []),
      mediaRules:clone(game.mediaRules || []),
      mediaArticles:clone((game.mediaArticles || []).slice(-300)),
      opinionPolls:clone((game.opinionPolls || []).slice(-300)),
      censorshipOrders:clone(game.censorshipOrders || []),
      mediaHistory:clone((game.mediaHistory || []).slice(-500)),
      mediaBroadcasts:clone(game.mediaBroadcasts || []),
      publicOpinionHistory:clone((game.publicOpinionHistory || []).slice(-500)),
      securityAgencies:clone(game.securityAgencies || []),
      securityAuthorizations:clone(game.securityAuthorizations || []),
      securityIncidents:clone(game.securityIncidents || []),
      securityCases:clone(game.securityCases || []),
      securityReports:clone(game.securityReports || []),
      securityAlerts:clone(game.securityAlerts || []),
      securityHistory:clone((game.securityHistory || []).slice(-500)),
      securityWarrantRequests:clone(game.securityWarrantRequests || []),
      securityWarrants:clone(game.securityWarrants || []),
      eventDefinitions:clone(game.eventDefinitions || []),
      worldEvents:clone(game.worldEvents || []),
      worldEventHistory:clone((game.worldEventHistory || []).slice(-500)),
      worldEventCounters:clone(game.worldEventCounters || []),
      identityGroups:clone(game.identityGroups || []),
      identityProfiles:clone(game.identityProfiles || []),
      identityOrganizations:clone(game.identityOrganizations || []),
      communityPrograms:clone((game.communityPrograms || []).slice(-300)),
      identityHistory:clone((game.identityHistory || []).slice(-500)),
      socialCohesionHistory:clone((game.socialCohesionHistory || []).slice(-500)),
      exchangeRates:clone(game.exchangeRates || []),financialBanks:clone(game.financialBanks || []),
      taxRules:clone(game.taxRules || []),priceIndexConfigs:clone(game.priceIndexConfigs || []),
      publicDebtIssues:clone(game.publicDebtIssues || []),bankTransactions:clone((game.bankTransactions || []).slice(-1000)),
      taxAssessments:clone((game.taxAssessments || []).slice(-1000)),
      priceIndexHistory:clone((game.priceIndexHistory || []).slice(-1000)),
      financeHistory:clone((game.financeHistory || []).slice(-1000)),
      financeCycleDate:game.financeCycleDate || null,financeCycleResult:clone(game.financeCycleResult || null),
      internationalOrganizations:clone(game.internationalOrganizations || []),
      diplomaticProposals:clone(game.diplomaticProposals || []),treaties:clone(game.treaties || []),
      internationalSanctions:clone(game.internationalSanctions || []),
      organizationResolutions:clone(game.organizationResolutions || []),
      diplomaticConferences:clone(game.diplomaticConferences || []),
      diplomacyHistory:clone((game.diplomacyHistory || []).slice(-1000)),
      diplomacyCycleDate:game.diplomacyCycleDate || null,
      diplomacyCycleResult:clone(game.diplomacyCycleResult || null)
    };
    return out;
  }

  const PRIVATE_SECURITY_FIELDS=Object.freeze([
    'securityAgencies','securityAuthorizations','securityIncidents','securityCases',
    'securityReports','securityHistory','securityWarrantRequests','securityWarrants'
  ]);

  function activeMemberStateIds(game,playerId) {
    return new Set((game.memberships||[]).filter(item=>
      item.playerId===playerId && item.status==='active').map(item=>item.stateId));
  }

  function privateSecurityFor(game,playerId) {
    const stateIds=activeMemberStateIds(game,playerId);
    const result={};
    for(const field of PRIVATE_SECURITY_FIELDS)
      result[field]=clone((game[field]||[]).filter(item=>stateIds.has(item.stateId)));
    return result;
  }

  function isPrivateSecurityOrder(order) {
    return String(order?.type||'').startsWith('security.');
  }

  function isPrivateSecurityEvent(event) {
    return String(event?.type||'').startsWith('security.');
  }

  function publicSnapshot(game) {
    const out=snapshot(game);
    for(const field of PRIVATE_SECURITY_FIELDS) out[field]=[];
    out.securityReports=clone((game.securityReports||[]).filter(item=>item.classification==='public'));
    out.securityAlerts=clone(game.securityAlerts||[]);
    out.orders=clone((game.orders||[]).filter(item=>!isPrivateSecurityOrder(item)).slice(-100));
    out.events=clone((game.events||[]).filter(item=>!isPrivateSecurityEvent(item)));
    return out;
  }

  function snapshotForPlayer(game,playerId) {
    const out=snapshot(game);
    const stateIds=activeMemberStateIds(game,playerId);
    Object.assign(out,privateSecurityFor(game,playerId));
    out.orders=clone((game.orders||[]).filter(item=>
      !isPrivateSecurityOrder(item) || stateIds.has(item.stateId)).slice(-100));
    out.events=clone((game.events||[]).filter(item=>
      !isPrivateSecurityEvent(item) || stateIds.has(item.stateId)));
    return out;
  }

  function hostSaveSlotKey(room,slot) {
    return HOST_SAVE + room + ':slot:' + slot;
  }

  function readValidHostSaveSlots(room,expected={}) {
    const valid=[];
    for(const slot of HOST_SAVE_SLOTS) {
      try {
        const raw=localStorage.getItem(hostSaveSlotKey(room,slot));
        if(!raw) continue;
        const envelope=JSON.parse(raw);
        const checked=validateHostSaveEnvelope(envelope,{...expected,room});
        if(checked.valid) valid.push({slot,envelope,checked});
      } catch {}
    }
    return valid.sort((left,right)=>right.checked.generation-left.checked.generation);
  }

  function loadHostSave(session) {
    const room=String(session?.inviteCode || session?.roomCode || '');
    const expected={
      room,
      gameId:session?.gameId || '',
      hostPlayerId:session?.playerId || ''
    };
    const slots=readValidHostSaveSlots(room,expected);
    if(slots.length) {
      const selected=slots[0];
      return {
        game:selected.checked.payload.game,
        session:selected.checked.payload.session || session,
        clockAccumulatorMs:selected.checked.payload.clockAccumulatorMs,
        generation:selected.checked.generation,
        source:'verified-slot',
        backupAvailable:slots.length>1
      };
    }
    try {
      const legacy=JSON.parse(localStorage.getItem(HOST_SAVE + room) || 'null');
      if(legacy?.version===2 && validHostGame(legacy.game) &&
         legacy.game.id===expected.gameId &&
         legacy.game.hostPlayerId===expected.hostPlayerId &&
         (!legacy.session ||
           (legacy.session.gameId===legacy.game.id &&
            legacy.session.playerId===legacy.game.hostPlayerId))) {
        return {
          game:legacy.game,session:legacy.session || session,
          clockAccumulatorMs:0,generation:0,source:'legacy-v2',
          backupAvailable:false
        };
      }
    } catch {}
    return null;
  }

  function persistHost() {
    if (!runtime || runtime.role !== 'host') return false;
    try {
      const validSlots=readValidHostSaveSlots(runtime.room,{
        gameId:runtime.game.id,hostPlayerId:runtime.game.hostPlayerId
      });
      const latest=validSlots[0] || null;
      const targetSlot=latest?.slot==='a'?'b':'a';
      const generation=(latest?.checked.generation || 0)+1;
      const envelope=createHostSaveEnvelope(
        runtime.game,runtime.session,runtime.room,generation,
        runtime.clockAccumulatorMs || 0
      );
      const key=hostSaveSlotKey(runtime.room,targetSlot);
      localStorage.setItem(key,JSON.stringify(envelope));
      const persisted=JSON.parse(localStorage.getItem(key) || 'null');
      const verified=validateHostSaveEnvelope(persisted,{
        room:runtime.room,gameId:runtime.game.id,
        hostPlayerId:runtime.game.hostPlayerId
      });
      if(!verified.valid || verified.generation!==generation)
        throw new Error('The new host save did not pass its read-back integrity check.');
      try {
        localStorage.setItem(HOST_SAVE + runtime.room + ':head',JSON.stringify({
          slot:targetSlot,generation,checksum:envelope.checksum
        }));
      } catch {}
      const afterSave=readValidHostSaveSlots(runtime.room,{
        gameId:runtime.game.id,hostPlayerId:runtime.game.hostPlayerId
      });
      if(afterSave.length>=2) {
        try { localStorage.removeItem(HOST_SAVE + runtime.room); } catch {}
      }
      runtime.lastSavedAt=envelope.savedAt;
      runtime.lastSaveError=null;
      return true;
    } catch (error) {
      runtime.lastSaveError=error?.message || 'Browser storage is unavailable or full.';
      runtime.onSaveError?.(runtime.lastSaveError);
      runtime.onStatus('Host save failed: '+runtime.lastSaveError);
      return false;
    }
  }

  function createVersionedSnapshotDelta(previous,current) {
    if(!previous || !current || previous.id!==current.id ||
       !Number.isSafeInteger(previous.worldVersion) ||
       !Number.isSafeInteger(current.worldVersion) ||
       current.worldVersion<=previous.worldVersion) return null;
    const operations=[];
    const maximumOperations=1800;
    function same(left,right) {
      try { return JSON.stringify(left)===JSON.stringify(right); }
      catch { return false; }
    }
    function set(path,value) {
      operations.push({op:'set',path:[...path],value:clone(value)});
    }
    function compare(before,after,path,depth=0) {
      if(same(before,after)) return;
      if(operations.length>=maximumOperations || depth>=24) {
        set(path,after);
        return;
      }
      if(Array.isArray(before) && Array.isArray(after)) {
        if(after.length<before.length) {
          set(path,after);
          return;
        }
        const common=Math.min(before.length,after.length);
        for(let index=0;index<common && operations.length<maximumOperations;index++)
          compare(before[index],after[index],[...path,index],depth+1);
        if(after.length>before.length)
          operations.push({op:'append',path:[...path],values:clone(after.slice(before.length))});
        return;
      }
      const beforeObject=before && typeof before==='object' && !Array.isArray(before);
      const afterObject=after && typeof after==='object' && !Array.isArray(after);
      if(beforeObject && afterObject) {
        for(const key of Object.keys(before)) {
          if(operations.length>=maximumOperations) break;
          if(!Object.prototype.hasOwnProperty.call(after,key))
            operations.push({op:'remove',path:[...path,key]});
          else compare(before[key],after[key],[...path,key],depth+1);
        }
        for(const key of Object.keys(after)) {
          if(operations.length>=maximumOperations) break;
          if(!Object.prototype.hasOwnProperty.call(before,key))
            set([...path,key],after[key]);
        }
        return;
      }
      set(path,after);
    }
    compare(previous,current,[]);
    if(operations.length>=maximumOperations) return null;
    return {
      gameId:current.id,baseWorldVersion:previous.worldVersion,
      worldVersion:current.worldVersion,operations
    };
  }

  function applyVersionedSnapshotDelta(previous,delta) {
    if(!previous || !delta || delta.gameId!==previous.id ||
       delta.baseWorldVersion!==previous.worldVersion ||
       !Number.isSafeInteger(delta.worldVersion) ||
       delta.worldVersion<=delta.baseWorldVersion ||
       !Array.isArray(delta.operations) || delta.operations.length>1800) return null;
    let draft;
    try { draft=clone(previous); } catch { return null; }
    const blockedKeys=new Set(['__proto__','prototype','constructor']);
    for(const operation of delta.operations) {
      if(!operation || !Array.isArray(operation.path) ||
         operation.path.length>24 ||
         operation.path.some(part=>
           !(typeof part==='string' || Number.isSafeInteger(part)) ||
           (typeof part==='string' && blockedKeys.has(part)) ||
           (typeof part==='number' && part<0))) return null;
      const path=operation.path;
      if(!path.length) return null;
      let parent=draft;
      for(let index=0;index<path.length-1;index++) {
        const part=path[index];
        if(parent===null || typeof parent!=='object' ||
           !Object.prototype.hasOwnProperty.call(parent,part)) return null;
        parent=parent[part];
      }
      const leaf=path[path.length-1];
      if(parent===null || typeof parent!=='object') return null;
      if(operation.op==='set') {
        if(Array.isArray(parent) && (!Number.isSafeInteger(leaf) || leaf>parent.length-1)) return null;
        if(!Array.isArray(parent) && typeof leaf!=='string') return null;
        try { parent[leaf]=clone(operation.value); } catch { return null; }
      } else if(operation.op==='remove') {
        if(Array.isArray(parent) && (!Number.isSafeInteger(leaf) || leaf>parent.length-1)) return null;
        if(!Array.isArray(parent) && typeof leaf!=='string') return null;
        if(!Object.prototype.hasOwnProperty.call(parent,leaf)) return null;
        if(Array.isArray(parent)) parent.splice(leaf,1);
        else delete parent[leaf];
      } else if(operation.op==='append') {
        if(!Array.isArray(parent[leaf]) || !Array.isArray(operation.values)) return null;
        try { parent[leaf].push(...clone(operation.values)); } catch { return null; }
      } else return null;
    }
    draft.worldVersion=delta.worldVersion;
    if(!validHostGame(draft)) return null;
    return draft;
  }

  function publishSnapshot() {
    if (!runtime || runtime.role !== 'host') return false;
    const game=publicSnapshot(runtime.game);
    const previous=runtime.lastPublishedSnapshot || null;
    const connectedGuests=runtime.game.players.filter(player=>
      player.connected && player.id!==runtime.session.playerId);
    const supportsDeltas=connectedGuests.every(player=>
      runtime.deltaCapablePlayerIds?.has(player.id));
    const delta=previous && supportsDeltas
      ? createVersionedSnapshotDelta(previous,game) : null;
    let sent=false;
    let payload=null;
    if(delta) {
      const deltaPayload={
        t:'delta',delta,hostTime:Date.now(),
        clockAccumulatorMs:runtime.clockAccumulatorMs || 0,
        technicalMaintenance:createTechnicalMaintenanceMessage(
          runtime.game.id,runtime.technicalMaintenance.active,
          runtime.technicalMaintenance.reason,runtime.technicalMaintenance.revision,
          runtime.technicalMaintenance.changedAt
        ),protocolVersion:1
      };
      const deltaSize=JSON.stringify(deltaPayload).length;
      const snapshotPayload={
        t:'snapshot',game,hostTime:Date.now(),
        clockAccumulatorMs:runtime.clockAccumulatorMs || 0,
        technicalMaintenance:createTechnicalMaintenanceMessage(
          runtime.game.id,runtime.technicalMaintenance.active,
          runtime.technicalMaintenance.reason,runtime.technicalMaintenance.revision,
          runtime.technicalMaintenance.changedAt
        )
      };
      const snapshotSize=JSON.stringify(snapshotPayload).length;
      payload=deltaSize<snapshotSize*.72 ? deltaPayload : snapshotPayload;
    } else {
      payload={
        t:'snapshot',game,hostTime:Date.now(),
        clockAccumulatorMs:runtime.clockAccumulatorMs || 0,
        technicalMaintenance:createTechnicalMaintenanceMessage(
          runtime.game.id,runtime.technicalMaintenance.active,
          runtime.technicalMaintenance.reason,runtime.technicalMaintenance.revision,
          runtime.technicalMaintenance.changedAt
        )
      };
    }
    sent=runtime.link.publish(runtime.topics.server,payload,{qos:1})!==false;
    if(sent) {
      runtime.lastPublishedSnapshot=clone(game);
    }
    runtime.onSnapshot(snapshotForPlayer(runtime.game,runtime.session.playerId));
    return sent;
  }

  function emitOrderResult(playerId,result) {
    if (!runtime || runtime.role !== 'host') return;
    if (playerId === runtime.session.playerId)
      runtime.onOrderResult(result);
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

  const MAX_SCHEDULED_ORDERS=200;
  const MAX_SCHEDULE_DAYS=3650;

  function orderPayload(order) {
    return Object.fromEntries(Object.entries(order).filter(([key]) =>
      !['orderId','gameId','playerId','expectedWorldVersion'].includes(key)));
  }

  function scheduleFutureOrder(game,player,membership,order,targetDate) {
    if(['pause','resume','cancelScheduledOrder'].includes(order.type)||
       String(order.type||'').startsWith('security.')||
       String(order.type||'').startsWith('justice.'))
      return reject('ORDER_TYPE_NOT_SCHEDULABLE',
        'This order must be executed immediately or contains information that cannot be placed in the public scheduled-order queue.',order.orderId);
    if(membership.permissionSetId==='government-observer')
      return reject('INSUFFICIENT_PERMISSION',
        'Observer memberships cannot schedule government orders.',order.orderId);
    const days=(Date.parse(targetDate+'T00:00:00.000Z')-
      Date.parse(game.worldDate+'T00:00:00.000Z'))/86400000;
    if(!Number.isSafeInteger(days)||days<1||days>MAX_SCHEDULE_DAYS)
      return reject('SCHEDULE_HORIZON_EXCEEDED',
        'Orders may be scheduled from tomorrow up to 3,650 world days ahead.',order.orderId);
    game.scheduledOrders ||= [];
    if(game.scheduledOrders.filter(item=>item.status==='scheduled').length>=MAX_SCHEDULED_ORDERS)
      return reject('SCHEDULE_QUEUE_FULL',
        'The world already has 200 pending scheduled orders.',order.orderId);
    let payload;
    try {
      payload=orderPayload(order);
      const serialized=JSON.stringify(payload);
      if(serialized.length>20000)
        return reject('SCHEDULE_PAYLOAD_TOO_LARGE',
          'A scheduled order cannot exceed 20,000 characters.',order.orderId);
    } catch {
      return reject('INVALID_PAYLOAD','The scheduled order could not be serialized safely.',order.orderId);
    }
    const sequence=(Number(game.eventSequence)||0)+1;
    game.eventSequence=sequence;
    const scheduled={
      id:order.orderId,gameId:game.id,playerId:player.id,stateId:membership.stateId,
      type:order.type,payload,targetWorldDate:targetDate,
      submittedOnWorldDate:game.worldDate,expectedWorldVersion:order.expectedWorldVersion,
      sequence,status:'scheduled',executionOrderId:byId(),resultCode:null,result:null,
      completedOnWorldDate:null
    };
    game.scheduledOrders.push(scheduled);
    game.orders.push({
      id:order.orderId,gameId:game.id,playerId:player.id,type:order.type,
      stateId:membership.stateId,payload,status:'scheduled',
      expectedWorldVersion:order.expectedWorldVersion,worldVersion:game.worldVersion+1,
      resultCode:'ORDER_SCHEDULED',
      result:'Scheduled for '+targetDate+'. The host will revalidate permissions and world conditions on that date.',
      rejectionReason:null,recordedAtUtc:new Date().toISOString(),
      worldDate:game.worldDate,targetWorldDate:targetDate
    });
    game.worldVersion++;
    const description=player.name+' scheduled '+order.type+' for '+targetDate+'.';
    game.activity.unshift(description);
    if(game.activity.length>100) game.activity.length=100;
    pushEvent(game,'order.scheduled',player.id,membership.stateId,description,order.orderId,'ORDER_SCHEDULED');
    return {id:order.orderId,accepted:true,code:'ORDER_SCHEDULED',error:null,replayed:false};
  }

  function reject(code,error,id = null) { return {id,accepted:false,code,error,replayed:false}; }

  function applyOrderCore(game,player,order) {
    if (!order || !order.orderId) return reject('INVALID_PAYLOAD','A valid order ID is required.',order?.orderId || null);
    const duplicate = game.orders.find(item => item.id === order.orderId);
    if (duplicate) {
      const payload = Object.fromEntries(Object.entries(order).filter(([key]) =>
        !['orderId','gameId','playerId','expectedWorldVersion'].includes(key)));
      const samePayload = duplicate.playerId === player.id &&
        order.playerId === player.id &&
        (duplicate.gameId || game.id) === order.gameId &&
        duplicate.type === order.type &&
        duplicate.stateId === order.stateId &&
        duplicate.expectedWorldVersion === order.expectedWorldVersion &&
        JSON.stringify(duplicate.payload || {}) === JSON.stringify(payload);
      return samePayload
        ? {id:order.orderId,accepted:['executed','scheduled'].includes(duplicate.status),
            code:duplicate.resultCode || null,error:duplicate.result || null,replayed:true}
        : reject('ORDER_ID_REUSED','This order ID was already used.',order.orderId);
    }
    if (order.gameId !== game.id)
      return reject('WRONG_GAME','This order belongs to a different world.',order.orderId);
    if (order.playerId !== player.id)
      return reject('WRONG_ACTOR','The order sender does not match the authenticated player.',order.orderId);
    if (Number(order.expectedWorldVersion) !== game.worldVersion)
      return reject('STALE_WORLD_VERSION','The world changed. Review the latest state before trying again.',order.orderId);
    let futureTargetDate=null;
    if(order.targetWorldDate!==undefined && order.targetWorldDate!==null && order.targetWorldDate!=='') {
      const target=order.targetWorldDate;
      const targetDate=typeof target==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(target)
        ? new Date(target+'T00:00:00.000Z') : null;
      const validTarget=targetDate && Number.isFinite(targetDate.getTime()) &&
        targetDate.toISOString().slice(0,10)===target;
      if(!validTarget)
        return reject('INVALID_TARGET_DATE','The order target date must be a real Gregorian date in YYYY-MM-DD format.',order.orderId);
      if(target<game.worldDate)
        return reject('TARGET_DATE_IN_PAST','An order cannot target a date before the current world date.',order.orderId);
      if(target>game.worldDate) futureTargetDate=target;
    }
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
    if(futureTargetDate)
      return scheduleFutureOrder(game,player,membership,order,futureTargetDate);
    let message = null;
    if(orderType==='cancelScheduledOrder') {
      const scheduled=game.scheduledOrders?.find(item=>
        item.id===order.scheduledOrderId&&item.status==='scheduled');
      if(!scheduled)
        return reject('SCHEDULED_ORDER_NOT_FOUND',
          'The scheduled order is no longer pending or does not exist.',order.orderId);
      if(scheduled.playerId!==player.id||scheduled.stateId!==membership?.stateId)
        return reject('SCHEDULED_ORDER_NOT_OWNED',
          'Only the author can cancel a scheduled order from this government.',order.orderId);
      scheduled.status='cancelled';
      scheduled.completedOnWorldDate=game.worldDate;
      scheduled.resultCode='ORDER_CANCELLED';
      scheduled.result='Cancelled by its author before execution.';
      const history=game.orders.find(item=>item.id===scheduled.id);
      if(history) {
        history.status='cancelled';
        history.resultCode='ORDER_CANCELLED';
        history.result=scheduled.result;
        history.completedOnWorldDate=game.worldDate;
      }
      message='Scheduled order for '+scheduled.targetWorldDate+' was cancelled.';
    } else if (orderType === 'pause' || orderType === 'resume') {
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
      const targetProvince = (game.provinces || []).find(item => item.stateId === territory.stateId);
      if ((game.occupations || []).some(item =>
          item.provinceId === targetProvince?.id && item.status === 'active'))
        return reject('TARGET_OCCUPIED','This territory is under military occupation.',order.orderId);
      const government = game.territories.find(item => item.stateId === membership.stateId);
      if (!government || government.treasury < 450)
        return reject('INSUFFICIENT_FUNDS','Insufficient treasury (¤450 required).',order.orderId);
      const sourceTreasuryBefore = government.treasury;
      government.treasury -= 450;
      territory.ownerPlayerId = player.id;
      territory.infrastructure++;
      territory.buildings ||= {};
      window.NewWorldStrategy?.onClaim?.(game,territory,player.id,byId);
      if (window.NewWorldSimulation?.createStarterEconomy) {
        const localEconomy = window.NewWorldSimulation.createStarterEconomy([territory],byId);
        game.companies ||= [];
        game.markets ||= [];
        game.populationGroups ||= [];
        if (!game.companies.some(item => item.stateId === territory.stateId))
          game.companies.push(...localEconomy.companies);
        if (!game.markets.some(item => item.stateId === territory.stateId))
          game.markets.push(...localEconomy.markets);
        if (!game.populationGroups.some(item => item.stateId === territory.stateId))
          game.populationGroups.push(...localEconomy.populationGroups);
      }
      const foundingMembers = game.memberships.filter(item =>
        item.stateId === membership.stateId && item.status === 'active');
      const settlementGrant = Math.min(600,government.treasury);
      government.treasury -= settlementGrant;
      territory.treasury += settlementGrant;
      for (const member of foundingMembers) {
        if (game.memberships.some(item => item.playerId === member.playerId &&
            item.stateId === territory.stateId && item.status === 'active')) continue;
        game.memberships.push({
          id:byId(),gameId:game.id,playerId:member.playerId,stateId:territory.stateId,
          status:'active',permissionSetId:member.permissionSetId || 'government-member',
          joinedAtWorldDate:game.worldDate
        });
      }
      game.financialTransactions.push({
        id:byId(),stateId:government.stateId,currencyId:government.currencyId,
        type:'administrationCost',amount:-450,balanceBefore:sourceTreasuryBefore,
        balanceAfter:sourceTreasuryBefore-450,description:'Frontier region claimed: ' + territory.name + '.',
        worldDate:game.worldDate,recordedAtUtc:new Date().toISOString(),orderId:order.orderId,
        membershipId:membership.id
      });
      if (settlementGrant > 0) {
        game.financialTransactions.push({
          id:byId(),stateId:government.stateId,currencyId:government.currencyId,
          type:'frontierSettlementGrantOut',amount:-settlementGrant,
          balanceBefore:sourceTreasuryBefore-450,balanceAfter:government.treasury,
          description:'Development reserve transferred to ' + territory.name + '.',
          worldDate:game.worldDate,recordedAtUtc:new Date().toISOString(),orderId:order.orderId,
          membershipId:membership.id
        });
        game.financialTransactions.push({
          id:byId(),stateId:territory.stateId,currencyId:territory.currencyId,
          type:'frontierSettlementGrant',amount:settlementGrant,balanceBefore:0,
          balanceAfter:territory.treasury,
          description:'Initial development reserve received by the new frontier settlement.',
          worldDate:game.worldDate,recordedAtUtc:new Date().toISOString(),orderId:order.orderId,
          membershipId:null
        });
      }
      pushActivity(game,player.name + ' secured and annexed ' + territory.name + '.');
    } else if (orderType === 'build') {
      if (!canPermission(membership.permissionSetId,'build'))
        return reject('INSUFFICIENT_PERMISSION','Your government permissions do not allow construction.',order.orderId);
      const plot = Number(order.plotIndex);
      const building = BUILDINGS[order.buildingId];
      const validPlot = Number.isSafeInteger(plot) && plot >= 0 &&
        (plot < LEGACY_PLOT_OFFSET || plot < MAX_WORLD_PLOT_INDEX);
      const spriteKey = String(order.spriteKey || '');
      const rotation = Number(order.rotation ?? 0);
      if (!validPlot || !building || !isValidBuildSprite(order.buildingId,spriteKey) ||
          !Number.isInteger(rotation) || rotation < 0 || rotation > 3)
        return reject('INVALID_PAYLOAD','Invalid construction request.',order.orderId);
      const variantName = String(order.variantName || building.name)
        .trim().replace(/\s+/g,' ').slice(0,56);
      if (!variantName || /[<>\u0000-\u001f]/.test(variantName))
        return reject('INVALID_PAYLOAD','Invalid construction name.',order.orderId);
      const government = game.territories.find(item => item.stateId === membership.stateId);
      if (!government) return reject('NOT_MEMBER','The selected territory has no active administration.',order.orderId);
      government.buildings ||= {};
      if (government.buildings[plot]) return reject('TARGET_UNAVAILABLE','This plot is already developed.',order.orderId);
      const constructionDiscount = Math.min(.5,
        window.NewWorldStrategy?.effectValue?.(game,membership.stateId,'construction_discount') || 0);
      const constructionCost = Math.max(1,Math.ceil(building.cost * (1-constructionDiscount)));
      if (government.treasury < constructionCost)
        return reject('INSUFFICIENT_FUNDS','Insufficient treasury.',order.orderId);
      government.treasury -= constructionCost;
      government.buildings[plot] = {
        ...clone(building),name:variantName,
        ...(spriteKey ? {spriteKey,rotation} : {}),
        catalogItemId:String(order.catalogItemId || '').slice(0,120) || null,
        daysRemaining:building.days,startedOn:game.worldDate,
        builderPlayerId:player.id
      };
      game.financialTransactions.push({
        id:byId(),stateId:government.stateId,currencyId:government.currencyId,
        type:'constructionCost',amount:-constructionCost,balanceBefore:government.treasury+constructionCost,
        balanceAfter:government.treasury,description:'Constructed ' + variantName + '.',
        worldDate:game.worldDate,recordedAtUtc:new Date().toISOString(),orderId:order.orderId,
        membershipId:membership.id
      });
      pushActivity(game,player.name + ' started construction of ' + variantName +
        ' in ' + government.name + '.');
    } else if (String(orderType).startsWith('identity.') && window.NewWorldIdentity?.applyOrder) {
      const result=window.NewWorldIdentity.applyOrder(game,player,membership,order,byId);
      if (!result?.ok)
        return reject(result?.code || 'IDENTITY_ORDER_REJECTED',
          result?.error || 'The identity and community rules rejected this order.',order.orderId);
    } else if (String(orderType).startsWith('worldEvents.') && window.NewWorldWorldEvents?.applyOrder) {
      const result=window.NewWorldWorldEvents.applyOrder(game,player,membership,order,byId);
      if (!result?.ok)
        return reject(result?.code || 'WORLD_EVENT_ORDER_REJECTED',
          result?.error || 'The world event rules rejected this order.',order.orderId);
    } else if (String(orderType).startsWith('security.') && window.NewWorldSecurity?.applyOrder) {
      const result=window.NewWorldSecurity.applyOrder(game,player,membership,order,byId);
      if (!result?.ok)
        return reject(result?.code || 'SECURITY_ORDER_REJECTED',
          result?.error || 'The security rules rejected this order.',order.orderId);
    } else if (String(orderType).startsWith('media.') && window.NewWorldMedia?.applyOrder) {
      const result=window.NewWorldMedia.applyOrder(game,player,membership,order,byId);
      if (!result?.ok)
        return reject(result?.code || 'MEDIA_ORDER_REJECTED',
          result?.error || 'The media rules rejected this order.',order.orderId);
    } else if (String(orderType).startsWith('finance.') && window.NewWorldFinance?.applyOrder) {
      const result=window.NewWorldFinance.applyOrder(game,player,membership,order,byId);
      if (!result?.ok) return reject(result?.code || 'FINANCE_ORDER_REJECTED',
        result?.error || 'The financial rules rejected this order.',order.orderId);
    } else if (String(orderType).startsWith('diplomacy.') && window.NewWorldDiplomacy?.applyOrder) {
      const result=window.NewWorldDiplomacy.applyOrder(game,player,membership,order,byId);
      if (!result?.ok) return reject(result?.code || 'DIPLOMACY_ORDER_REJECTED',
        result?.error || 'The advanced diplomatic rules rejected this order.',order.orderId);
    } else if (String(orderType).startsWith('administration.') && window.NewWorldBureaucracy?.applyOrder) {
      const result=window.NewWorldBureaucracy.applyOrder(game,player,membership,order,byId);
      if (!result?.ok)
        return reject(result?.code || 'ADMIN_ORDER_REJECTED',
          result?.error || 'The administrative rules rejected this order.',order.orderId);
    } else if (String(orderType).startsWith('resource.') && window.NewWorldResources?.applyOrder) {
      const result=window.NewWorldResources.applyOrder(game,player,membership,order,byId);
      if (!result?.ok)
        return reject(result?.code || 'RESOURCE_ORDER_REJECTED',
          result?.error || 'The environmental rules rejected this order.',order.orderId);
    } else if (String(orderType).startsWith('justice.') && window.NewWorldJustice?.applyOrder) {
      const result=window.NewWorldJustice.applyOrder(game,player,membership,order,byId);
      if (!result?.ok)
        return reject(result?.code || 'JUSTICE_ORDER_REJECTED',
          result?.error || 'The justice rules rejected this order.',order.orderId);
    } else if (window.NewWorldStrategy?.applyOrder) {
      const result = window.NewWorldStrategy.applyOrder(game,player,membership,order,byId);
      if (!result.ok)
        return reject(result.code || 'STRATEGY_ORDER_REJECTED',
          result.error || 'The strategy rules rejected this order.',order.orderId);
    } else {
      return reject('UNSUPPORTED_ORDER','The strategy rules engine is unavailable.',order.orderId);
    }

    game.worldVersion++;
    const orderPayload = Object.fromEntries(Object.entries(order).filter(([key]) =>
      !['orderId','gameId','playerId','expectedWorldVersion'].includes(key)));
    game.orders.push({
      id:order.orderId,gameId:game.id,playerId:player.id,type:orderType,stateId:order.stateId,
      payload:orderPayload,status:'executed',expectedWorldVersion:order.expectedWorldVersion,
      worldVersion:game.worldVersion,resultCode:null,result:null,rejectionReason:null,
      recordedAtUtc:new Date().toISOString(),worldDate:game.worldDate,
      targetWorldDate:order.targetWorldDate || null
    });
    window.NewWorldStrategy?.checkVictory?.(game);
    pushEvent(game,'order.executed',player.id,order.stateId,
      game.activity[0] || ('Executed ' + orderType + '.'),order.orderId);
    return {id:order.orderId,accepted:true,code:null,error:null,replayed:false};
  }


  function applyOrder(game,player,order) {
    const existingOrder = order?.orderId
      ? (game.orders || []).find(item => item.id === order.orderId)
      : null;
    const result = applyOrderCore(game,player,order);
    if (!game || !player || !order?.orderId || existingOrder || result.replayed || result.accepted)
      return result;

    const submittedAtUtc = new Date().toISOString();
    const payload = Object.fromEntries(Object.entries(order).filter(([key]) =>
      !['orderId','gameId','playerId','expectedWorldVersion'].includes(key)));
    game.orders.push({
      id:order.orderId,gameId:game.id,playerId:player.id,type:order.type || 'unknown',
      stateId:order.stateId || null,payload,status:'rejected',
      expectedWorldVersion:Number(order.expectedWorldVersion),
      worldVersion:game.worldVersion,
      resultCode:result.code || 'ORDER_REJECTED',
      result:result.error || 'The order was rejected.',
      rejectionReason:{
        code:result.code || 'ORDER_REJECTED',
        message:result.error || 'The order was rejected.',
        recordedOnWorldDate:game.worldDate
      },
      recordedAtUtc:submittedAtUtc,worldDate:game.worldDate,
      targetWorldDate:order.targetWorldDate || null
    });
    pushEvent(game,'order.rejected',player.id,order.stateId || null,
      result.error || 'The order was rejected.',order.orderId,
      result.code || 'ORDER_REJECTED');
    return result;
  }

  function executeScheduledOrders(game) {
    if(!game||!Array.isArray(game.players))
      return {ok:false,executed:0,rejected:0,error:'The world is unavailable.'};
    game.scheduledOrders ||= [];
    const due=game.scheduledOrders.filter(item=>
      item.status==='scheduled'&&item.targetWorldDate<=game.worldDate)
      .slice().sort((left,right)=>
        left.targetWorldDate.localeCompare(right.targetWorldDate)||
        Number(left.sequence)-Number(right.sequence)||
        String(left.id).localeCompare(String(right.id)));
    let executed=0,rejected=0;
    for(const scheduled of due) {
      const player=game.players.find(item=>item.id===scheduled.playerId);
      let result;
      if(!player) {
        result=reject('SCHEDULED_ACTOR_UNAVAILABLE',
          'The player who submitted this order no longer exists.',scheduled.executionOrderId);
      } else {
        const executionOrder={
          ...(scheduled.payload||{}),
          orderId:scheduled.executionOrderId,
          gameId:game.id,playerId:scheduled.playerId,
          expectedWorldVersion:game.worldVersion,
          targetWorldDate:game.worldDate
        };
        result=applyOrder(game,player,executionOrder);
      }
      scheduled.status=result.accepted?'executed':'rejected';
      scheduled.completedOnWorldDate=game.worldDate;
      scheduled.resultCode=result.code||null;
      scheduled.result=result.error||null;
      const original=game.orders.find(item=>item.id===scheduled.id);
      if(original) {
        original.status=scheduled.status;
        original.resultCode=result.accepted?null:(result.code||'SCHEDULED_ORDER_REJECTED');
        original.result=result.accepted?'Executed on '+game.worldDate+'.':
          (result.error||'The scheduled order was rejected.');
        original.rejectionReason=result.accepted?null:{
          code:original.resultCode,message:original.result,
          recordedOnWorldDate:game.worldDate
        };
        original.completedOnWorldDate=game.worldDate;
      }
      game.worldVersion++;
      const description=result.accepted
        ? 'Scheduled order '+scheduled.type+' executed on '+game.worldDate+'.'
        : 'Scheduled order '+scheduled.type+' was rejected on '+game.worldDate+': '+
          (result.error||result.code||'unknown reason')+'.';
      pushEvent(game,'order.schedule_resolved',scheduled.playerId,scheduled.stateId,
        description,scheduled.id,result.accepted?'ORDER_EXECUTED':(result.code||'ORDER_REJECTED'));
      if(result.accepted) executed++; else rejected++;
    }
    return {ok:true,executed,rejected,
      pending:game.scheduledOrders.filter(item=>item.status==='scheduled').length};
  }

  function resetClockReferenceOnRunTransition(previousStatus) {
    if(runtime?.role==='host'&&previousStatus!=='running'&&runtime.game.status==='running')
      runtime.lastPulseAt=Date.now();
  }

  function maintenanceMessageFor(runtimeState,active,reason,revision) {
    return createTechnicalMaintenanceMessage(
      runtimeState.game.id,active,reason,revision,new Date().toISOString()
    );
  }

  function publishTechnicalMaintenance() {
    if(!runtime || runtime.role!=='host') return false;
    const current=runtime.technicalMaintenance;
    const message=createTechnicalMaintenanceMessage(
      runtime.game.id,current.active,current.reason,current.revision,current.changedAt
    );
    if(!message) return false;
    const sent=runtime.link.publish(runtime.topics.server,message,{qos:1})!==false;
    runtime.lastMaintenancePublishedAt=Date.now();
    runtime.onMaintenance?.({
      active:current.active,reason:current.reason,
      revision:current.revision,changedAt:current.changedAt
    });
    return sent;
  }

  function setTechnicalMaintenance(active,reason='') {
    if(!runtime || runtime.role!=='host')
      return {ok:false,error:'Only the active host can change technical maintenance status.'};
    if(typeof active!=='boolean')
      return {ok:false,error:'Technical maintenance must be enabled or disabled explicitly.'};
    const revision=(runtime.technicalMaintenance?.revision||0)+1;
    const message=maintenanceMessageFor(runtime,active,reason,revision);
    if(!message)
      return {ok:false,error:'Active maintenance requires a valid public reason of 5–240 characters.'};
    runtime.technicalMaintenance={
      active:message.active,reason:message.reason,
      revision:message.revision,changedAt:message.changedAt
    };
    runtime.lastPulseAt=Date.now();
    const published=publishTechnicalMaintenance();
    return {ok:true,status:{...runtime.technicalMaintenance},published};
  }

  function receiveTechnicalMaintenance(message,game) {
    if(!runtime || runtime.role!=='guest') return false;
    const validated=validateTechnicalMaintenanceMessage(message,runtime.session?.gameId);
    if(!validated || validated.revision<=(runtime.technicalMaintenance?.revision||0)) return false;
    runtime.technicalMaintenance=validated;
    runtime.hostClockReceivedAt=Date.now();
    const currentGame=game||runtime.lastSnapshot;
    runtime.hostClockRunning=Boolean(runtime.hostOnline&&currentGame?.started&&
      currentGame.status==='running'&&!validated.active);
    runtime.onMaintenance?.({...validated});
    return true;
  }

  function pauseForNoConnectedPlayers() {
    if(!runtime || runtime.role!=='host') return false;
    const game=runtime.game;
    if(!game.started || game.status!=='running' ||
       game.players.some(player=>player.connected)) return false;
    game.status='paused';
    game.paused=true;
    game.pauseVotePlayerIds=[];
    game.worldVersion=(Number(game.worldVersion) || 0)+1;
    const description='The world paused automatically because no players are connected.';
    pushActivity(game,description);
    pushEvent(game,'world.paused.no_connected_players',null,null,
      description,null,'NoConnectedPlayers');
    persistHost();
    publishSnapshot();
    return true;
  }

  function advanceHostDay(options={}) {
    if (!runtime || runtime.role !== 'host') return false;
    const game = runtime.game;
    if(runtime.technicalMaintenance?.active) return false;
    if (!game.started || game.status !== 'running' || !runtime.link.connected ||
        !game.players.some(player=>player.connected)) return false;

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
      if(options.persist!==false) persistHost();
      if(options.publish!==false) publishSnapshot();
      runtime.onStatus('World paused: simulation error — ' + reason);
      return false;
    }

    if(options.persist!==false) persistHost();
    if(options.publish!==false) publishSnapshot();
    return true;
  }

  function hostPulse() {
    if (!runtime || runtime.role !== 'host') return;
    const now=Date.now();
    if (!runtime.link.connected) {
      runtime.lastPulseAt=now;
      return;
    }
    const game=runtime.game;
    if(runtime.technicalMaintenance?.active) {
      if(now-(runtime.lastMaintenancePublishedAt||0)>=10000)
        publishTechnicalMaintenance();
      runtime.lastPulseAt=now;
      return;
    }
    if (!game.started || game.status !== 'running') {
      runtime.lastPulseAt=now;
      return;
    }
    if(!game.players.some(player=>player.connected)) {
      pauseForNoConnectedPlayers();
      runtime.lastPulseAt=now;
      return;
    }

    const previous=Number.isFinite(Number(runtime.lastPulseAt))
      ? Number(runtime.lastPulseAt) : now;
    runtime.clockAccumulatorMs=accumulateClockMs(
      runtime.clockAccumulatorMs,clockElapsedMs(previous,now)
    );
    runtime.lastPulseAt=now;

    let advanced=0;
    let worldChanged=false;
    const due=takeDueClockDays(runtime.clockAccumulatorMs,MAX_CLOCK_DAYS_PER_PULSE);
    while(advanced<due.days && runtime.game.status==='running') {
      runtime.clockAccumulatorMs-=DAY_LENGTH_MS;
      if(!advanceHostDay({persist:false,publish:false})) {
        runtime.clockAccumulatorMs=accumulateClockMs(runtime.clockAccumulatorMs,DAY_LENGTH_MS);
        worldChanged=true;
        break;
      }
      advanced++;
      worldChanged=true;
    }
    if(worldChanged || now-(Number(runtime.lastClockPersistAt) || 0)>=30000) {
      if(persistHost()) runtime.lastClockPersistAt=now;
      if(worldChanged) publishSnapshot();
    }
  }

  function hostReceive(topic,message) {
    if (!runtime || runtime.role !== 'host') return;
    if (topic.endsWith('/presence')) {
      const match = topic.match(/\/p\/([^/]+)\/presence$/);
      const playerId = match && match[1];
      if (!playerId || playerId === runtime.session.playerId) return;
      const player = runtime.game.players.find(item => item.id === playerId);
      const connected = message.online === true;
      if (player && player.connected !== connected) {
        player.connected = connected;
        recordConnectedRosterChange(runtime.game,player,connected);
        notifyPlayerPresence(player);
        persistHost();
        publishSnapshot();
      }
      return;
    }
    if (topic !== runtime.topics.clients) return;
    if(message.t==='resync') {
      const player=runtime.game.players.find(item=>
        item.id===message.playerId && item.token===message.playerToken);
      if(!player || !player.connected || message.gameId!==runtime.game.id) return;
      runtime.link.publish(runtime.topics.private(player.id),{
        t:'welcome',game:publicSnapshot(runtime.game),hostTime:Date.now(),
        clockAccumulatorMs:runtime.clockAccumulatorMs || 0,
        technicalMaintenance:createTechnicalMaintenanceMessage(
          runtime.game.id,runtime.technicalMaintenance.active,
          runtime.technicalMaintenance.reason,runtime.technicalMaintenance.revision,
          runtime.technicalMaintenance.changedAt
        ),resync:true
      },{qos:1});
      return;
    }
    if (message.t === 'hello') {
      const clientNonce = String(message.clientNonce || '');
      const pendingTopic = runtime.topics.pending(clientNonce);
      let player = null;
      let isNewPlayer = false;
      let isReconnectedPlayer = false;
      if (message.playerId && message.playerToken) {
        player = runtime.game.players.find(item =>
          item.id === message.playerId && item.token === message.playerToken);
        if (player && !player.connected) {
          player.connected = true;
          isReconnectedPlayer = true;
          recordConnectedRosterChange(runtime.game,player,true);
        }
      }
      if (!player && clientNonce) {
        const pendingPlayerId = runtime.pendingJoins.get(clientNonce);
        player = runtime.game.players.find(item => item.id === pendingPlayerId) || null;
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
        if (runtime.game.players.length >= worldPlayerLimit(runtime.game)) {
          runtime.link.publish(pendingTopic,{t:'error',error:'This world has reached its player limit.'});
          return;
        }
        if (runtime.game.players.some(item => item.name.toLowerCase() === name.toLowerCase())) {
          runtime.link.publish(pendingTopic,{t:'error',error:'That player name is already in use.'});
          return;
        }
        player = {
          id:byId(),name,isHost:false,countryIndex:null,treasury:0,dailyBalanceRemainder:0,
          buildings:{},connected:true,token:token()
        };
        runtime.game.players.push(player);
        isNewPlayer = true;
        runtime.game.worldVersion++;
        pushActivity(runtime.game,name + ' joined the world.');
        pushEvent(runtime.game,'player.joined',player.id,null,name + ' joined the world.');
        const assignment = assignLobbyPlayer(runtime.game,player);
        if (!assignment.ok) {
          runtime.game.players = runtime.game.players.filter(item => item.id !== player.id);
          runtime.link.publish(pendingTopic,{t:'error',error:assignment.error});
          return;
        }
        if (clientNonce) runtime.pendingJoins.set(clientNonce,player.id);
      }
      if(message.deltaSyncVersion===1) runtime.deltaCapablePlayerIds.add(player.id);
      else runtime.deltaCapablePlayerIds.delete(player.id);
      const session = {
        gameId:runtime.game.id,playerId:player.id,playerToken:player.token,
        inviteCode:runtime.room,isHost:false,playerName:player.name
      };
      runtime.link.publish(pendingTopic,{
        t:'welcome',session,game:publicSnapshot(runtime.game),hostTime:Date.now(),
        clockAccumulatorMs:runtime.clockAccumulatorMs || 0,
        technicalMaintenance:createTechnicalMaintenanceMessage(
          runtime.game.id,runtime.technicalMaintenance.active,
          runtime.technicalMaintenance.reason,runtime.technicalMaintenance.revision,
          runtime.technicalMaintenance.changedAt
        )
      },{qos:1});
      runtime.lastPublishedSnapshot=null;
      persistHost();
      if (isNewPlayer) notifyPlayerJoined(player);
      else if (isReconnectedPlayer) {
        notifyPlayerPresence(player);
        publishSnapshot();
      }
      return;
    }
    if (message.t === 'order') {
      const player = runtime.game.players.find(item =>
        item.id === message.playerId && item.token === message.playerToken);
      if (!player) {
        publishSnapshot();
        emitOrderResult(message.playerId,{id:message.order?.orderId,accepted:false,
          code:'UNAUTHORIZED',error:'Player authentication failed.',replayed:false});
        return;
      }
      const previousStatus=runtime.game.status;
      const result = applyOrder(runtime.game,player,message.order);
      if(result.accepted) resetClockReferenceOnRunTransition(previousStatus);
      persistHost();
      publishSnapshot();
      emitOrderResult(player.id,result);
    }
    if (message.t === 'bye') {
      const leaving = runtime.game.players.find(item =>
        item.id === message.playerId && item.token === message.playerToken);
      if (leaving) {
        if (leaving.connected) {
          leaving.connected = false;
          recordConnectedRosterChange(runtime.game,leaving,false);
          notifyPlayerPresence(leaving);
          persistHost();
          publishSnapshot();
        }
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
          const isFoundingSettlement = Number(territory.population || 0) <= 0 &&
            !territory.ownerPlayerId &&
            !(game.memberships || []).some(item =>
              item.stateId===territory.stateId && item.status==='active');
          const transfer = player.treasury + Math.trunc(accumulated / 30);
          const foundingCapital = isFoundingSettlement ? 1200 : 0;
          territory.treasury += transfer + foundingCapital;
          territory.dailyBalanceRemainder = accumulated % 30;
          player.treasury = 0;
          player.dailyBalanceRemainder = 0;
          territory.ownerPlayerId ||= player.id;
          if (isFoundingSettlement) {
            territory.population=850;
            territory.prosperity=28;
            territory.infrastructure=Math.max(1,Number(territory.infrastructure)||0);
            territory.baseHousingCapacity=1200;
            territory.baseFoodCapacity=1200;
            territory.baseWaterCapacity=1200;
            territory.baseJobCapacity=200;
            territory.populationGrowthLastDay=0;
          }
          game.memberships.push({
            id:byId(),gameId:game.id,playerId:player.id,stateId:territory.stateId,
            status:'active',permissionSetId:'government-member',joinedAtWorldDate:game.worldDate
          });
          if (!game.companies?.some(item=>item.stateId===territory.stateId) &&
              window.NewWorldSimulation?.createStarterEconomy) {
            const localEconomy=window.NewWorldSimulation.createStarterEconomy([territory],byId);
            game.companies ||= [];
            game.markets ||= [];
            game.populationGroups ||= [];
            game.companies.push(...localEconomy.companies);
            game.markets.push(...localEconomy.markets);
            game.populationGroups.push(...localEconomy.populationGroups);
          }
          window.NewWorldStrategy?.onClaim?.(game,territory,player.id,byId);
          game.financialTransactions.push({
            id:byId(),stateId:territory.stateId,type:foundingCapital?'foundingCapital':'membershipTransfer',
            amount:transfer+foundingCapital,balanceBefore:territory.treasury-transfer-foundingCapital,
            balanceAfter:territory.treasury,
            description:foundingCapital
              ? 'Founding capital and initial treasury allocated to ' + territory.name + '.'
              : 'Initial treasury transferred to ' + territory.name + '.',
            worldDate:game.worldDate
          });
        }
      }
      pushActivity(game,player.name + ' was assigned to ' +
        (payload.countryIndex === null ? 'no State' : game.territories[payload.countryIndex].name) + '.');
    } else if (action === 'start') {
      if (game.started) return {ok:false,error:'The world has already started.'};
      if (!canStartWorld(game))
        return {ok:false,error:'Every player must have a State assignment before starting.'};
      const scenarioAudit=window.NewWorldScenario?.validate?.(game);
      if(scenarioAudit && !scenarioAudit.valid)
        return {ok:false,error:'The scenario contains structural errors: '+scenarioAudit.errors.join(', ')};
      if(window.NewWorldScenario?.createRecord)
        game.worldScenario=window.NewWorldScenario.createRecord(game,game.scenarioSeed);
      game.started = true;
      game.status = 'running';
      game.paused = false;
      game.lastTickUtc = new Date().toISOString();
      if (runtime?.role === 'host') {
        runtime.lastPulseAt = Date.now();
        runtime.clockAccumulatorMs = 0;
      }
      pushActivity(game,'The world began.');
    } else if (action === 'configure') {
      if (game.started) return {ok:false,error:'Scenario configuration is locked after the world starts.'};
      const map = {
        economy:{goods:'goods',productionRecipes:'productionRecipes',companies:'companies',
          markets:'markets',tradeRoutes:'tradeRoutes',populationGroups:'populationGroups'},
        finance:{currencies:'currencies',exchangeRates:'exchangeRates',financialBanks:'financialBanks',
          taxRules:'taxRules',priceIndexConfigs:'priceIndexConfigs'},
        diplomacy:{internationalOrganizations:'internationalOrganizations'},
        territory:{provinces:'provinces',settlements:'settlements',connections:'provinceConnections',
          controls:'territorialControls',sovereigntyHistory:'sovereigntyHistory',resourceDeposits:'resourceDeposits'},
        military:{unitTypes:'militaryUnitTypes',commanders:'militaryCommanders',units:'militaryUnits',
          routes:'militaryRoutes',supplyRoutes:'supplyRoutes',supplyRules:'supplyRules',
          supplyStocks:'supplyStocks',occupations:'occupations'},
        technology:{technologies:'technologies',researchInstitutions:'researchInstitutions',
          researchProjects:'researchProjects',technologyUnlocks:'technologyUnlocks',
          technologyAdoptions:'technologyAdoptions'},
        demography:{demographicProfiles:'demographicProfiles',populationGroups:'populationGroups',
          epidemicDefinitions:'epidemicDefinitions',epidemicStarts:'epidemicStarts'},
        justice:{justiceSystems:'justiceSystems'},
        identity:{identityGroups:'identityGroups',identityProfiles:'identityProfiles',
          identityOrganizations:'identityOrganizations'},
        worldEvents:{eventDefinitions:'eventDefinitions'},
        security:{securityAgencies:'securityAgencies',securityAuthorizations:'securityAuthorizations'},
        media:{mediaOutlets:'mediaOutlets',publicOpinionProfiles:'publicOpinionProfiles',mediaRules:'mediaRules'},
        bureaucracy:{
          administrativeAgencies:'administrativeAgencies',
          administrativeDepartments:'administrativeDepartments',civilServants:'civilServants',
          administrativeProcedures:'administrativeProcedures',
          administrativeJurisdictions:'administrativeJurisdictions',
          administrativeBudgets:'administrativeBudgets',publicProjects:'publicProjects',
          procurementVendors:'procurementVendors'
        },
        resources:{
          resourceCatalog:'resourceCatalog',resourceDeposits:'resourceDeposits',
          agriculturalLand:'agriculturalLand',cropDefinitions:'cropDefinitions',
          farms:'farms',climateZones:'climateZones',environmentalStates:'environmentalStates',
          disasters:'disasters',energySources:'energySources',foodReserves:'foodReserves',
          waterSources:'waterSources',waterDemands:'waterDemands',
          livestockSites:'livestockSites',fishingGrounds:'fishingGrounds',forestAreas:'forestAreas'
        },
        services:{serviceTypes:'serviceTypes',publicServiceFacilities:'publicServiceFacilities'},
        industry:{
          industryOccupations:'industryOccupations',labourPools:'labourPools',
          industryWorkplaces:'industryWorkplaces',labourUnions:'labourUnions'
        }
      };
      const fields = map[payload.kind];
      if (!fields) return {ok:false,error:'Unknown scenario configuration.'};
      if(payload.kind==='military') {
        const configuration={
          ...(payload.configuration||{}),
          supplyRoutes:payload.configuration?.supplyRoutes||[],
          supplyRules:payload.configuration?.supplyRules||[],
          supplyStocks:payload.configuration?.supplyStocks||[]
        };
        const validated=window.NewWorldMilitaryLogistics?.validateConfiguration?.(game,configuration);
        if(!validated?.ok)
          return {ok:false,error:validated?.error||'Military logistics scenario validation failed.'};
        payload.configuration=configuration;
      }
      if(payload.kind==='demography') {
        const configuration={
          ...(payload.configuration||{}),
          epidemicDefinitions:payload.configuration?.epidemicDefinitions||[],
          epidemicStarts:payload.configuration?.epidemicStarts||[]
        };
        const validated=window.NewWorldDemography?.validateConfiguration?.(
          game,configuration.demographicProfiles,configuration.populationGroups);
        if(!validated?.valid)
          return {ok:false,error:'Demographic scenario validation failed: '+(validated?.errors || []).join(', ')};
        const epidemicValidation=window.NewWorldEpidemiology?.validateConfiguration?.(
          game,configuration);
        if(!epidemicValidation?.ok)
          return {ok:false,error:'Epidemic scenario validation failed: '+epidemicValidation.error};
        payload.configuration=configuration;
      }
      if (payload.kind==='justice') {
        const validated=window.NewWorldJustice?.validateConfiguration?.(game,payload.configuration);
        if (!validated?.ok) return {ok:false,error:validated?.error || 'Justice scenario validation failed.'};
      }
      if (payload.kind==='identity') {
        const validated=window.NewWorldIdentity?.validateConfiguration?.(game,payload.configuration);
        if (!validated?.ok) return {ok:false,error:validated?.error || 'Identity and community scenario validation failed.'};
      }
      if (payload.kind==='worldEvents') {
        const validated=window.NewWorldWorldEvents?.validateConfiguration?.(game,payload.configuration);
        if (!validated?.ok) return {ok:false,error:validated?.error || 'World event scenario validation failed.'};
      }
      if (payload.kind==='security') {
        const validated=window.NewWorldSecurity?.validateConfiguration?.(game,payload.configuration);
        if (!validated?.ok) return {ok:false,error:validated?.error || 'Security scenario validation failed.'};
      }
      if (payload.kind==='media') {
        const validated=window.NewWorldMedia?.validateConfiguration?.(game,payload.configuration);
        if (!validated?.ok) return {ok:false,error:validated?.error || 'Media and opinion scenario validation failed.'};
      }
      if (payload.kind==='finance') {
        const validated=window.NewWorldFinance?.validateConfiguration?.(game,payload.configuration);
        if (!validated?.ok) return {ok:false,error:validated?.error || 'Financial scenario validation failed.'};
      }
      if (payload.kind==='diplomacy') {
        const validated=window.NewWorldDiplomacy?.validateConfiguration?.(game,payload.configuration);
        if (!validated?.ok) return {ok:false,error:validated?.error || 'Diplomatic scenario validation failed.'};
      }
      if (payload.kind==='bureaucracy') {
        const validated=window.NewWorldBureaucracy?.validateConfiguration?.(game,payload.configuration);
        if (!validated?.ok) return {ok:false,error:validated?.error || 'Administrative scenario validation failed.'};
      }
      if (payload.kind==='resources') {
        const validated=window.NewWorldResources?.validateConfiguration?.(game,payload.configuration);
        if (!validated?.ok) return {ok:false,error:validated?.error || 'Resource and climate scenario validation failed.'};
      }
      if (payload.kind==='services') {
        const validated=window.NewWorldServices?.validateConfiguration?.(game,payload.configuration);
        if (!validated?.ok) return {ok:false,error:validated?.error || 'Public service scenario validation failed.'};
      }
      if (payload.kind==='industry') {
        const validated=window.NewWorldIndustry?.validateConfiguration?.(game,payload.configuration);
        if (!validated?.ok) return {ok:false,error:validated?.error || 'Industry and labour scenario validation failed.'};
      }
      const replacements={};
      for (const [key,target] of Object.entries(fields)) {
        if (!Array.isArray(payload.configuration?.[key]))
          return {ok:false,error:'Scenario configuration requires an array for ' + key + '.'};
        replacements[target]=clone(payload.configuration[key]);
      }
      Object.assign(game,replacements);
      if(payload.kind==='military') {
        window.NewWorldMilitaryLogistics?.ensure?.(game);
        for(const stock of game.supplyStocks) {
          if(!Number.isFinite(stock.initialQuantity)) stock.initialQuantity=stock.quantity;
        }
        game.militarySupplyCycleDate=null;
        game.militarySupplyCycleResult=null;
      }
      if (payload.kind === 'economy') game.companies = game.companies || [];
      if(payload.kind==='demography') {
        game.demographicEvents ||= [];
        game.migrationRecords ||= [];
        window.NewWorldEpidemiology?.ensure?.(game);
      }
      if (payload.kind === 'justice') window.NewWorldJustice?.ensure?.(game);
      if (payload.kind === 'finance') {
        window.NewWorldFinance?.ensure?.(game);
        game.financeCycleDate=null;game.financeCycleResult=null;
      }
      if (payload.kind === 'diplomacy') {
        window.NewWorldDiplomacy?.ensure?.(game);
        game.diplomacyCycleDate=null;game.diplomacyCycleResult=null;
      }
      if (payload.kind === 'bureaucracy') {
        window.NewWorldBureaucracy?.ensure?.(game);
        for(const budget of game.administrativeBudgets)
          if(!Number.isFinite(budget.balance)) budget.balance=budget.openingBalance;
        for(const project of game.publicProjects) {
          project.status ||= 'planned';
          if(!Number.isFinite(project.spent)) project.spent=0;
          for(const milestone of project.milestones || []) {
            if(!Number.isFinite(milestone.completedWorkUnits)) milestone.completedWorkUnits=0;
            milestone.status ||= 'pending';
          }
        }
      }
      if (payload.kind === 'resources') {
        window.NewWorldResources?.ensure?.(game);
        game.resourceCycleDate=null;
        game.resourceCycleResult=null;
        game.waterAllocationDate=null;
        for (const territory of game.territories)
          window.NewWorldResources?.refreshEnergy?.(game,territory.stateId);
      }
      if (payload.kind === 'services') window.NewWorldServices?.ensure?.(game);
      if (payload.kind === 'industry') window.NewWorldIndustry?.ensure?.(game);
      if(window.NewWorldScenario?.createRecord)
        game.worldScenario=window.NewWorldScenario.createRecord(game,game.scenarioSeed);
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

  function receiveHostClock(message,game) {
    if(!runtime || runtime.role!=='guest') return;
    const accumulator=Number(message?.clockAccumulatorMs);
    runtime.hostClockAccumulatorMs=Number.isFinite(accumulator) && accumulator>=0
      ? Math.min(accumulator,Number.MAX_SAFE_INTEGER) : 0;
    runtime.hostClockReceivedAt=Date.now();
    runtime.hostClockRunning=Boolean(game?.started && game.status==='running' &&
      !runtime.technicalMaintenance?.active);
  }

  function requestSnapshotResync() {
    if(!runtime || runtime.role!=='guest' || !runtime.session ||
       !runtime.link.connected ||
       (runtime.resyncRequested && Date.now()-(runtime.resyncRequestedAt || 0)<5000)) return false;
    runtime.resyncRequested=true;
    runtime.resyncRequestedAt=Date.now();
    return runtime.link.publish(runtime.topics.clients,{
      t:'resync',gameId:runtime.session.gameId,
      playerId:runtime.session.playerId,playerToken:runtime.session.playerToken,
      knownWorldVersion:runtime.lastSnapshot?.worldVersion ?? null
    },{qos:1})!==false;
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
        runtime.lastSnapshot=clone(message.game);
        runtime.resyncRequested=false;
        receiveTechnicalMaintenance(message.technicalMaintenance,message.game);
        receiveHostClock(message,message.game);
        runtime.onSnapshot(message.game);
        runtime.resolveJoin(runtime.session);
      }
      return;
    }
    if (topic === runtime.topics.server) {
      if (message.to && message.to !== runtime.playerId) return;
      if (message.t === 'maintenance') {
        receiveTechnicalMaintenance(message,runtime.lastSnapshot);
      }
      if (message.t === 'snapshot' && message.game) {
        runtime.lastSnapshot=clone(message.game);
        runtime.resyncRequested=false;
        receiveTechnicalMaintenance(message.technicalMaintenance,message.game);
        receiveHostClock(message,message.game);
        runtime.onSnapshot(message.game);
      }
      if(message.t==='delta' && message.delta) {
        const updated=message.protocolVersion===1
          ? applyVersionedSnapshotDelta(runtime.lastSnapshot,message.delta)
          : null;
        if(updated) {
          runtime.lastSnapshot=updated;
          runtime.resyncRequested=false;
          receiveTechnicalMaintenance(message.technicalMaintenance,updated);
          receiveHostClock(message,updated);
          runtime.onSnapshot(updated);
        } else requestSnapshotResync();
      }
      if (message.t === 'playerJoined' && message.player) runtime.onPlayerJoined?.(message.player);
      if (message.t === 'playerPresence')
        runtime.onPlayerPresence?.(message.playerId,message.online === true);
      if (message.t === 'lobbyCount')
        runtime.onPlayerCount?.({
          totalPlayers:Number(message.totalPlayers) || 0,
          connectedPlayers:Number(message.connectedPlayers) || 0,
          capacity:Number(message.capacity) || MAX_PLAYERS
        });
      if (message.t === 'orderResult' && message.to === runtime.playerId)
        runtime.onOrderResult(message.order);
      if (message.t === 'adminResult' && message.requestId)
        runtime.resolveAdmin(message);
      if (message.t === 'roomClosed') runtime.onStatus('The host closed this world.');
      return;
    }
    if (topic === runtime.topics.private(runtime.playerId) && message.t === 'welcome') {
      if(message.game?.id!==runtime.session?.gameId) return;
      runtime.lastSnapshot=clone(message.game);
      runtime.resyncRequested=false;
      receiveTechnicalMaintenance(message.technicalMaintenance,message.game);
      receiveHostClock(message,message.game);
      runtime.onSnapshot(message.game);
    }
  }

  function sendHello() {
    if (!runtime || runtime.role !== 'guest' || !runtime.link.connected) return;
    const generation = runtime.link.connectionGeneration;
    if (runtime.lastHelloGeneration === generation) return;
    const sent = runtime.link.publish(runtime.topics.clients,{
      t:'hello',clientNonce:runtime.link.clientNonce,name:runtime.name,
      playerId:runtime.session?.playerId || null,
      playerToken:runtime.session?.playerToken || null,
      deltaSyncVersion:window.NewWorldCapabilities?.snapshotDeltas===false ? 0 : 1
    },{qos:1});
    if (sent) runtime.lastHelloGeneration = generation;
  }

  function migrateStrategyScenario(game) {
    if (!game || Number(game.strategyVersion || 0) >= 1 ||
        !window.NewWorldStrategy?.createStarterScenario) return false;
    const hasExistingStrategy = (game.provinces || []).length ||
      (game.militaryUnits || []).length ||
      (game.technologies || []).length ||
      (game.politicalSystems || []).some(system =>
        system.constitution || system.institutions?.length ||
        system.laws?.some(law => law.id !== 'founding-charter')) ||
      (game.diplomaticRelations || []).length>0;
    if (hasExistingStrategy) return false;

    window.NewWorldStrategy.createStarterScenario(game,byId);
    const hostPlayerId = game.hostPlayerId || game.players?.find(player => player.isHost)?.id;
    const memberships = activeMemberships(game,hostPlayerId);
    const homeMembership = memberships[0];
    const homeTerritory = game.territories?.find(item =>
      item.stateId === homeMembership?.stateId);
    const homeProvince = game.provinces?.find(item =>
      item.stateId === homeMembership?.stateId);
    const foundingUnit = (game.militaryUnits || []).find(item =>
      item.ownerPlayerId === hostPlayerId);
    if (foundingUnit && homeTerritory && homeProvince) {
      foundingUnit.stateId = homeTerritory.stateId;
      foundingUnit.provinceId = homeProvince.id;
      foundingUnit.maxPersonnel = Math.max(
        Number(foundingUnit.maxPersonnel) || 0,
        Number(foundingUnit.personnel) || 0);
    }
    for (const territory of game.territories || []) {
      const member=(game.memberships || []).find(item =>
        item.stateId===territory.stateId && item.status==='active');
      const ownerPlayerId=territory.ownerPlayerId || member?.playerId;
      if (ownerPlayerId)
        window.NewWorldStrategy.onClaim?.(game,territory,ownerPlayerId,byId);
    }
    game.strategyVersion = 1;
    game.worldVersion = (Number(game.worldVersion) || 0) + 1;
    pushActivity(game,'The saved world was upgraded with military, research and government systems. Existing territory, buildings and economic data were preserved.');
    pushEvent(game,'world.strategy_migrated',hostPlayerId,homeMembership?.stateId || null,
      'The saved world was upgraded to strategy rules version 1.');
    return true;
  }

  function setHostRuntime(game,session,handlers) {
    migrateScenarioIdentity(game);
    const configuredLimit = Number(game.maxHumanPlayers) || MAX_PLAYERS;
    game.maxHumanPlayers = worldPlayerLimit(game);
    if (configuredLimit !== game.maxHumanPlayers) {
      game.worldVersion = (Number(game.worldVersion) || 0) + 1;
      pushActivity(game,'The legacy lobby capacity was reduced to the current 20-player maximum.');
      pushEvent(game,'world.player_limit_migrated',game.hostPlayerId,null,
        'The legacy lobby capacity was reduced to the current 20-player maximum.');
    }
    migrateStrategyScenario(game);
    if (window.NewWorldJustice?.ensure) window.NewWorldJustice.ensure(game);
    runtime = {
      role:'host',game,session,room:session.inviteCode || session.roomCode,
      topics:topicSet(session.inviteCode || session.roomCode),pendingJoins:new Map(),
      onSnapshot:handlers.onSnapshot || (()=>{}),
      onStatus:handlers.onStatus || (()=>{}),
      onMaintenance:handlers.onMaintenance || (()=>{}),
      onOrderResult:handlers.onOrderResult || (()=>{}),
      onSession:handlers.onSession || (()=>{}),
      onPlayerJoined:handlers.onPlayerJoined || (()=>{}),
      onPlayerPresence:handlers.onPlayerPresence || (()=>{}),
      onPlayerCount:handlers.onPlayerCount || (()=>{}),
      deltaCapablePlayerIds:new Set(),
      lastPublishedSnapshot:null,
      technicalMaintenance:{
        active:false,reason:'',revision:1,changedAt:new Date().toISOString()
      },lastMaintenancePublishedAt:0
    };
    runtime.session.inviteCode = runtime.room;
    runtime.session.roomCode = runtime.room;
    runtime.lastPulseAt = Date.now();
    runtime.lastClockPersistAt = runtime.lastPulseAt;
    runtime.clockAccumulatorMs = 0;
    for (const player of runtime.game.players) {
      const shouldBeConnected = player.id === runtime.session.playerId;
      if (player.connected !== shouldBeConnected) {
        player.connected = shouldBeConnected;
        recordConnectedRosterChange(runtime.game,player,shouldBeConnected);
      }
    }
    runtime.hasConnected = false;
    runtime.link = new BrokerLink('host',runtime.room,session.playerId,
      hostReceive,(status) => {
        if (status === 'ready') {
          runtime.hasConnected = true;
          const host = runtime.game.players.find(player => player.id === runtime.session.playerId);
          if (host && !host.connected) {
            host.connected = true;
            recordConnectedRosterChange(runtime.game,host,true);
          }
          runtime.lastPulseAt = Date.now();
          runtime.onStatus('ready');
          publishTechnicalMaintenance();
          persistHost();
          publishSnapshot();
        } else {
          if (runtime.hasConnected && !runtime.link.connected) {
            const host = runtime.game.players.find(player => player.id === runtime.session.playerId);
            if (host && host.connected) {
              host.connected = false;
              recordConnectedRosterChange(runtime.game,host,false);
            }
            runtime.lastPulseAt = Date.now();
            if (runtime.game.started && runtime.game.status === 'running') {
              runtime.game.status = 'paused';
              runtime.game.paused = true;
              runtime.game.pauseVotePlayerIds = [];
              runtime.game.worldVersion++;
              const noPlayersConnected=!runtime.game.players.some(player=>player.connected);
              const pauseReason=noPlayersConnected?'NoConnectedPlayers':'HostRelayLost';
              const description=noPlayersConnected
                ? 'The world paused automatically because the last connected player lost the relay connection.'
                : 'The world paused because the host lost its relay connection while other players remained connected.';
              pushActivity(runtime.game,description);
              pushEvent(runtime.game,noPlayersConnected
                ? 'world.paused.no_connected_players' : 'world.paused.host_relay_lost',
                null,null,description,null,pauseReason);
            }
            persistHost();
            publishSnapshot();
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
      playerId:existingSession?.playerId || null,hostOnline:false,lastHelloGeneration:-1,
      onSnapshot:handlers.onSnapshot || (()=>{}),
      onStatus:handlers.onStatus || (()=>{}),
      onMaintenance:handlers.onMaintenance || (()=>{}),
      onOrderResult:handlers.onOrderResult || (()=>{}),
      onSession:handlers.onSession || (()=>{}),
      onPlayerJoined:handlers.onPlayerJoined || (()=>{}),
      onPlayerPresence:handlers.onPlayerPresence || (()=>{}),
      onPlayerCount:handlers.onPlayerCount || (()=>{}),
      resolveJoin:null,rejectJoin:null,adminRequests:new Map(),
      technicalMaintenance:{active:false,reason:'',revision:0,changedAt:null},
      lastSnapshot:null
    };
    runtime = active;
    active.link = new BrokerLink('guest',room,active.playerId,receiveGuest,
      status => {
        active.onStatus(status);
        if (status === 'connected' && active.hostOnline) sendHello();
      });
    return new Promise((resolve,reject) => {
      active.resolveJoin = resolve;
      const timeout = setTimeout(() => {
        if (runtime === active) {
          active.link.close(false);
          runtime = null;
        }
        reject(new Error('World not found or its host is offline. Check the code and try again.'));
      },30000);
      active.rejectJoin = error => {
        clearTimeout(timeout);
        active.link.close(false);
        if (runtime === active) runtime = null;
        reject(error);
      };
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
      let saved=null;
      try { saved=loadHostSave(session); } catch {}
      if (!saved?.game) {
        return Promise.reject(new Error('No valid host save was found. Both local save slots may be damaged or the original browser profile may be unavailable.'));
      }
      const previousRuntime=runtime;
      previousRuntime?.link?.close(false);
      setHostRuntime(saved.game,saved.session || session,handlers);
      runtime.clockAccumulatorMs=saved.clockAccumulatorMs || 0;
      runtime.lastPulseAt=Date.now();
      runtime.recoverySource=saved.source;
      const active=runtime;
      return new Promise((resolve,reject) => {
        const timeout=setTimeout(() => {
          if(runtime===active) active.link.close(false);
          reject(new Error('The saved world was loaded, but the host could not reconnect to the public relay. Check the network and press RECONNECT to retry.'));
        },30000);
        const previousStatus=active.onStatus;
        active.onStatus=status => {
          previousStatus(status);
          if(runtime!==active) return;
          if(status==='ready') {
            clearTimeout(timeout);
            handlers.onSession?.(active.session);
            persistHost();
            resolve({session:active.session,game:snapshot(active.game)});
          } else if(String(status).startsWith('Relay error:') && !active.link.client) {
            clearTimeout(timeout);
            reject(new Error(status));
          }
        };
        active.link.start();
      });
    }
    if (!session?.inviteCode || !session.playerToken)
      return Promise.reject(new Error('The saved multiplayer session is incomplete.'));
    const name = session.playerName || handlers.playerName || 'PLAYER';
    const previousRuntime=runtime;
    previousRuntime?.link?.close(false);
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
      const previousStatus=runtime.game.status;
      const result = applyOrder(runtime.game,player,order);
      if(result.accepted) resetClockReferenceOnRunTransition(previousStatus);
      persistHost();
      publishSnapshot();
      const onOrderResult=runtime.onOrderResult;
      Promise.resolve().then(()=>onOrderResult?.(result));
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
      const previousStatus=runtime.game.status;
      const result = applyAdmin(runtime.game,action,payload);
      if (!result.ok) return Promise.reject(new Error(result.error));
      resetClockReferenceOnRunTransition(previousStatus);
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

  const hostPulseTimer = setInterval(hostPulse,1000);
  hostPulseTimer.unref?.();

  window.NewWorldMultiplayer = {
    createWorld,joinWorld,restoreSession,sendOrder,admin,disconnect,testRelay,executeScheduledOrders,
    saveNow:() => persistHost(),
    exportHostBackup:() => {
      if(!runtime||runtime.role!=='host')
        throw new Error('Only the active host can export a portable world backup.');
      if(!persistHost())
        throw new Error('The latest world state could not be saved and verified locally.');
      const slots=readValidHostSaveSlots(runtime.room,{
        gameId:runtime.game.id,hostPlayerId:runtime.game.hostPlayerId
      });
      if(!slots.length)
        throw new Error('No verified host save is available for export.');
      return clone(slots[0].envelope);
    },
    importHostBackup:envelope => {
      if(runtime)
        throw new Error('Disconnect the current multiplayer session before importing a host backup.');
      const checked=validateHostSaveEnvelope(envelope);
      if(!checked.valid)
        throw new Error('The file does not contain a valid supported host save ('+checked.reason+').');
      const payload=checked.payload;
      const room=String(payload.room||'');
      const session=payload.session;
      const host=payload.game.players.find(player=>player.id===payload.game.hostPlayerId);
      if(!/^[A-HJ-NP-Z2-9]{8}$/.test(room)||!host||!session||
         session.isHost!==true||session.gameId!==payload.game.id||
         session.playerId!==payload.game.hostPlayerId||
         session.playerToken!==host.token||
         session.inviteCode!==room||session.roomCode!==room)
        throw new Error('The backup has no matching host identity, room code and recovery token.');
      const existing=readValidHostSaveSlots(room,{
        gameId:payload.game.id,hostPlayerId:payload.game.hostPlayerId
      });
      const latest=existing[0]||null;
      const generation=Math.max(checked.generation,(latest?.checked.generation||0)+1);
      const targetSlot=latest?.slot==='a'?'b':'a';
      const imported=createHostSaveEnvelope(
        payload.game,session,room,generation,payload.clockAccumulatorMs
      );
      const key=hostSaveSlotKey(room,targetSlot);
      let previousRaw=null;
      try {
        previousRaw=localStorage.getItem(key);
        localStorage.setItem(key,JSON.stringify(imported));
        const persisted=JSON.parse(localStorage.getItem(key)||'null');
        const verified=validateHostSaveEnvelope(persisted,{
          room,gameId:payload.game.id,hostPlayerId:payload.game.hostPlayerId
        });
        if(!verified.valid||verified.generation!==generation)
          throw new Error('The imported backup failed its local read-back verification.');
      } catch(error) {
        try {
          if(previousRaw===null) localStorage.removeItem(key);
          else localStorage.setItem(key,previousRaw);
        } catch {}
        throw new Error('The host backup could not be installed in this browser: '+
          (error?.message||'browser storage unavailable or full.'));
      }
      return clone({...session,playerName:session.playerName||host.name});
    },
    saveStatus:() => ({
      savedAt:runtime?.lastSavedAt || null,
      error:runtime?.lastSaveError || null,
      clockAccumulatorMs:runtime?.clockAccumulatorMs || 0,
      recoverySource:runtime?.recoverySource || null,
      backupAvailable:runtime?.role==='host'
        ? readValidHostSaveSlots(runtime.room).length>1 : false
    }),
    setTechnicalMaintenance,
    technicalMaintenanceStatus:() => runtime?.technicalMaintenance
      ? {...runtime.technicalMaintenance} : {active:false,reason:'',revision:0,changedAt:null},
    clockStatus:() => ({
      status:runtime?.role==='host' ? runtime.game.status : null,
      day:runtime?.role==='host' ? runtime.game.day : null,
      connectedPlayers:runtime?.role==='host'
        ? runtime.game.players.filter(player=>player.connected).length : null,
      technicalMaintenance:runtime?.technicalMaintenance?{...runtime.technicalMaintenance}:null,
      accumulatorMs:runtime?.role==='host' ? runtime.clockAccumulatorMs || 0 : null,
      pendingDays:runtime?.role==='host'
        ? Math.floor((runtime.clockAccumulatorMs || 0)/DAY_LENGTH_MS) : null,
      dayLengthMs:DAY_LENGTH_MS
    }),
    clockPresentation:() => {
      if(!runtime) return {progress:0,elapsedMs:0,dayLengthMs:DAY_LENGTH_MS,running:false};
      let accumulator=0;
      let running=false;
      if(runtime.role==='host') {
        accumulator=runtime.clockAccumulatorMs || 0;
        running=Boolean(runtime.game.started && runtime.game.status==='running' &&
          !runtime.technicalMaintenance?.active && runtime.link.connected &&
          runtime.game.players.some(player=>player.connected));
        if(running) accumulator+=clockElapsedMs(runtime.lastPulseAt,Date.now());
      } else {
        accumulator=runtime.hostClockAccumulatorMs || 0;
        running=Boolean(runtime.hostOnline && runtime.hostClockRunning &&
          !runtime.technicalMaintenance?.active);
        if(running)
          accumulator+=clockElapsedMs(runtime.hostClockReceivedAt,Date.now());
      }
      const elapsedMs=Math.min(DAY_LENGTH_MS-1,Math.max(0,accumulator%DAY_LENGTH_MS));
      return {
        progress:elapsedMs/DAY_LENGTH_MS,
        elapsedMs,dayLengthMs:DAY_LENGTH_MS,running
      };
    },
    isHost:() => runtime?.role === 'host',
    isConnected:() => !!runtime?.link?.connected,
    currentSession:() => runtime?.session || null,
    currentRoom:() => runtime?.room || ''
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Object.freeze({
      createInitialWorld:newWorld,
      migrateScenarioIdentity,
      assignLobbyPlayer,
      canStartWorld,
      applyAdmin,
      applyOrder,
      executeScheduledOrders,
      migrateStrategyScenario,
      snapshot,
      publicSnapshot,
      snapshotForPlayer,
      createHostSaveEnvelope,
      validateHostSaveEnvelope,
      validHostGame,
      hostSaveChecksum,
      clockElapsedMs,
      accumulateClockMs,
      takeDueClockDays,
      createVersionedSnapshotDelta,
      applyVersionedSnapshotDelta,
      createTechnicalMaintenanceMessage,
      validateTechnicalMaintenanceMessage,
      dayLengthMs:DAY_LENGTH_MS,
      maxClockDaysPerPulse:MAX_CLOCK_DAYS_PER_PULSE,
      maxPlayers:MAX_PLAYERS
    });
  }
})();