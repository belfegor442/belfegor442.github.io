'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const crypto = require('node:crypto').webcrypto;
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const simulation = require('../simulation.js');
const strategy = require('../strategy.js');

const source = fs.readFileSync(path.join(__dirname,'..','multiplayer.js'),'utf8');

function matches(filter,topic) {
  const a=filter.split('/');
  const b=topic.split('/');
  for(let i=0;i<a.length;i++) {
    if(a[i]==='#') return true;
    if(i>=b.length) return false;
    if(a[i]!=='+' && a[i]!==b[i]) return false;
  }
  return a.length===b.length;
}

class MemoryPeer extends EventEmitter {
  constructor(relay) {
    super();
    this.relay=relay;
    this.connected=false;
    this.closed=false;
    this.subscriptions=new Set();
    relay.peers.add(this);
    queueMicrotask(()=>{
      if(this.closed) return;
      this.connected=true;
      this.emit('connect');
    });
  }

  subscribe(filters,options,callback) {
    if(typeof options==='function') { callback=options; options={}; }
    for(const filter of (Array.isArray(filters)?filters:[filters])) this.subscriptions.add(filter);
    setImmediate(()=>{
      if(this.closed) return callback?.(new Error('peer closed'));
      for(const [topic,payload] of this.relay.retained) {
        if([...this.subscriptions].some(filter=>matches(filter,topic)))
          this.emit('message',topic,payload);
      }
      callback?.(null,[]);
    });
    return this;
  }

  publish(topic,payload,options={}) {
    if(this.closed || !this.connected) return false;
    const bytes=Buffer.isBuffer(payload)?payload:Buffer.from(String(payload));
    let message={};
    try { message=JSON.parse(bytes.toString()); } catch {}
    this.relay.stats.publishes++;
    if(topic.endsWith('/c') && message.t==='hello') this.relay.stats.helloMessages++;
    if(topic.endsWith('/s') && message.t==='snapshot') this.relay.stats.serverSnapshots++;
    if(topic.endsWith('/s') && message.t==='delta') this.relay.stats.deltaMessages++;
    if(topic.endsWith('/c') && message.t==='resync') this.relay.stats.resyncMessages++;
    if(topic.endsWith('/s') && message.t==='playerJoined') this.relay.stats.playerJoinedMessages++;
    if(topic.endsWith('/s') && message.t==='lobbyCount') this.relay.stats.lobbyCountMessages++;
    if(options.retain) {
      if(bytes.length) this.relay.retained.set(topic,bytes);
      else this.relay.retained.delete(topic);
    }
    queueMicrotask(()=>{
      if(topic.endsWith('/s') && message.t==='delta' && this.relay.dropNextDelta) {
        this.relay.dropNextDelta=false;
        return;
      }
      for(const peer of this.relay.peers) {
        if(!peer.connected || peer.closed) continue;
        if([...peer.subscriptions].some(filter=>matches(filter,topic)))
          peer.emit('message',topic,bytes);
      }
    });
    return true;
  }

  end() {
    if(this.closed) return;
    this.closed=true;
    this.connected=false;
    this.relay.peers.delete(this);
    this.emit('close');
  }
}

class MemoryRelay {
  constructor() {
    this.peers=new Set();
    this.retained=new Map();
    this.stats={publishes:0,helloMessages:0,serverSnapshots:0,deltaMessages:0,
      resyncMessages:0,playerJoinedMessages:0,lobbyCountMessages:0};
    this.dropNextDelta=false;
  }
  connect() { return new MemoryPeer(this); }
}

function createClient(relay,storage=new Map(),options={}) {
  const clock={now:Date.now(),intervals:[]};
  class TestDate extends Date {
    constructor(...args) { super(...(args.length?args:[clock.now])); }
    static now() { return clock.now; }
  }
  const context={
    window:{
      NewWorldSimulation:simulation,NewWorldStrategy:strategy,
      NewWorldCapabilities:{snapshotDeltas:options.deltaSync!==false}
    },
    mqtt:{connect:()=>relay.connect()},
    crypto,
    structuredClone,
    Date:TestDate,
    localStorage:{
      getItem:key=>storage.get(key)??null,
      setItem:(key,value)=>storage.set(key,String(value)),
      removeItem:key=>storage.delete(key)
    },
    setTimeout,clearTimeout,
    setInterval:callback=>{clock.intervals.push(callback);return {unref(){}};},
    clearInterval:()=>{},
    console,
    module:{exports:{}}
  };
  vm.createContext(context);
  vm.runInContext(source,context,{filename:'multiplayer.js'});
  const api=context.window.NewWorldMultiplayer;
  Object.defineProperties(api,{
    __testAdvanceTime:{value:milliseconds=>{
      clock.now+=milliseconds;
      for(const callback of clock.intervals) callback();
    }},
    __testPulse:{value:()=>clock.intervals.forEach(callback=>callback())}
  });
  return api;
}

function flush() {
  return new Promise(resolve=>setImmediate(()=>setImmediate(resolve)));
}

test('host supports twenty connected players, rejects player twenty-one, and avoids join snapshot fanout', async t => {
  const relay=new MemoryRelay();
  const host=createClient(relay);
  const guests=[];
  t.after(()=>{
    for(const guest of guests) guest.disconnect();
    host.disconnect();
  });

  let hostJoinCount=0;
  let hostSnapshot=null;
  const hostOrderResults=[];
  const created=await host.createWorld('Host',{
    onPlayerJoined:()=>{hostJoinCount++;},
    onSnapshot:game=>{hostSnapshot=game;},
    onOrderResult:result=>hostOrderResults.push(result)
  });

  for(let index=0;index<19;index++) {
    const guest=createClient(relay);
    guest.lobbyCounts=[];
    guests.push(guest);
    await guest.joinWorld(created.session.inviteCode,'Friend '+String(index+1),{
      onSnapshot:()=>{},
      onPlayerCount:count=>guest.lobbyCounts.push(count)
    });
    await flush();
  }

  assert.equal(relay.peers.size,20);
  assert.equal(relay.stats.helloMessages,19,'each accepted join must send exactly one initial hello');
  assert.equal(relay.stats.playerJoinedMessages,0,'full player cards must not fan out to every guest');
  assert.equal(relay.stats.lobbyCountMessages,19,'each accepted join must publish one compact count update');
  assert.equal(relay.stats.serverSnapshots,1,'joins must not fan out full-world snapshots');
  assert.equal(hostJoinCount,19,'the host roster must receive every accepted join delta');
  assert.equal(guests.at(-1).lobbyCounts.at(-1).totalPlayers,20);
  assert.equal(guests.at(-1).lobbyCounts.at(-1).connectedPlayers,20);

  const overLimit=createClient(relay);
  guests.push(overLimit);
  const overLimitError=await overLimit.joinWorld(
    created.session.inviteCode,'Player Twenty One',{onSnapshot:()=>{}}
  ).then(()=>null,error=>error.message);
  assert.match(overLimitError,/player limit/i);
  await flush();
  assert.equal(hostJoinCount,19,'a rejected join must not emit a player-joined delta');
  overLimit.disconnect();

  const started=await host.admin('start',{});
  assert.equal(started.started,true);
  assert.equal(started.status,'running');
  assert.equal(started.players.length,20);
  assert.equal(started.memberships.length,20);
  assert.equal(hostSnapshot.players.length,20);
  assert.equal(relay.stats.serverSnapshots,2,'starting should send one shared world snapshot');

  const home=started.territories[0];
  const plotIndex=144+512*1024+512;
  const queuedOrder={
    orderId:'host-farm-after-start',gameId:started.id,playerId:started.players[0].id,
    expectedWorldVersion:started.worldVersion,stateId:home.stateId,
    type:'build',plotIndex,buildingId:'farm'
  };
  assert.equal(host.sendOrder(queuedOrder),true);
  await flush();
  assert.equal(hostOrderResults.length,1,'the host must receive its own order acknowledgement locally');
  assert.equal(hostOrderResults[0].id,queuedOrder.orderId);
  assert.equal(hostOrderResults[0].accepted,true);
  assert.equal(hostSnapshot.territories[0].buildings[plotIndex].daysRemaining,2,
    'host-originated building orders must update the authoritative snapshot');
});


test('pause votes reset when a connected player leaves during an unfinished vote', async t => {
  const relay=new MemoryRelay();
  const host=createClient(relay);
  const guests=[];
  t.after(()=>{
    for(const guest of guests) guest.disconnect();
    host.disconnect();
  });

  let hostSnapshot=null;
  const created=await host.createWorld('Host',{
    onSnapshot:game=>{hostSnapshot=game;}
  });

  const guestSnapshots=[];
  for(let index=0;index<3;index++) {
    const guest=createClient(relay);
    let latestSnapshot=null;
    guests.push(guest);
    await guest.joinWorld(created.session.inviteCode,'Voter '+(index+1),{
      onSnapshot:game=>{latestSnapshot=game;}
    });
    guestSnapshots.push(()=>latestSnapshot);
    await flush();
  }

  const started=await host.admin('start',{});
  hostSnapshot=started;
  await flush();
  assert.equal(hostSnapshot.players.filter(player=>player.connected).length,4);

  const hostPlayer=hostSnapshot.players.find(player=>player.isHost);
  const hostMembership=hostSnapshot.memberships.find(item =>
    item.playerId===hostPlayer.id && item.status==='active');
  assert.equal(host.sendOrder({
    orderId:'pause-roster-host-vote',
    gameId:hostSnapshot.id,
    playerId:hostPlayer.id,
    expectedWorldVersion:hostSnapshot.worldVersion,
    stateId:hostMembership.stateId,
    type:'pause'
  }),true);
  await flush();
  assert.equal(hostSnapshot.pauseVotePlayerIds.length,1);
  assert.equal(hostSnapshot.pauseVotePlayerIds[0],hostPlayer.id);

  const firstGuest=guests[0];
  const firstGuestSnapshot=guestSnapshots[0]();
  const firstGuestSession=firstGuest.currentSession();
  const firstGuestMembership=firstGuestSnapshot.memberships.find(item =>
    item.playerId===firstGuestSession.playerId && item.status==='active');
  assert.equal(firstGuest.sendOrder({
    orderId:'pause-roster-guest-vote',
    gameId:firstGuestSnapshot.id,
    playerId:firstGuestSession.playerId,
    expectedWorldVersion:firstGuestSnapshot.worldVersion,
    stateId:firstGuestMembership.stateId,
    type:'pause'
  }),true);
  await flush();
  assert.equal(hostSnapshot.pauseVotePlayerIds.length,2);
  assert.equal(hostSnapshot.status,'running');

  guests[2].disconnect();
  await flush();
  assert.equal(hostSnapshot.pauseVotePlayerIds.length,0,
    'all votes must be cleared when the connected roster changes');
  assert.equal(hostSnapshot.status,'running',
    'a vote collected under the old connected-player count must not pause the world');
  assert.equal(hostSnapshot.events.some(item=>item.type==='world.pause_votes_reset'),true);
});


test('host save slots recover from a corrupted newest copy without discarding the older verified world',async t=>{
  const relay=new MemoryRelay();
  const storage=new Map();
  const host=createClient(relay,storage);
  t.after(()=>host.disconnect());
  const created=await host.createWorld('Backup Host',{});
  assert.equal(host.saveNow(),true);
  assert.equal(host.saveNow(),true);

  const slotKeys=[...storage.keys()].filter(key=>key.includes(':slot:'));
  assert.equal(slotKeys.length,2,'two alternating local save slots must exist');
  const slots=slotKeys.map(key=>({key,envelope:JSON.parse(storage.get(key))}))
    .sort((left,right)=>right.envelope.generation-left.envelope.generation);
  const newest=slots[0];
  newest.envelope.payload.game.worldDate='1500-02-30';
  storage.set(newest.key,JSON.stringify(newest.envelope));

  host.disconnect();
  const restored=createClient(relay,storage);
  t.after(()=>restored.disconnect());
  const result=await restored.restoreSession(created.session,{});
  assert.equal(result.game.id,created.session.gameId);
  assert.equal(result.game.worldDate,'1500-01-01');
  const status=restored.saveStatus();
  assert.equal(status.recoverySource,'verified-slot');
  assert.equal(status.backupAvailable,true);
  assert.equal(status.error,null);

  const repairedSlots=slotKeys.map(key=>JSON.parse(storage.get(key)));
  assert.ok(repairedSlots.every(envelope=>envelope.schemaVersion===3),
    'the damaged newest slot must be replaced only after the older slot was loaded and verified');
  assert.equal(repairedSlots.filter(envelope=>
    envelope.payload.game.worldDate==='1500-01-01').length,2);
});


test('authoritative host clock advances at 299, 300 and 301 seconds and drains delayed days in bounded batches',async t=>{
  const relay=new MemoryRelay();
  const host=createClient(relay);
  t.after(()=>host.disconnect());
  await host.createWorld('Clock Host',{});
  const started=await host.admin('start',{});
  assert.equal(started.day,1);
  assert.equal(host.clockStatus().status,'running');

  host.__testAdvanceTime(299000);
  assert.equal(host.clockStatus().day,1);
  assert.equal(host.clockStatus().accumulatorMs,299000);

  host.__testAdvanceTime(1000);
  assert.equal(host.clockStatus().day,2);
  assert.equal(host.clockStatus().accumulatorMs,0);

  host.__testAdvanceTime(301000);
  assert.equal(host.clockStatus().day,3);
  assert.equal(host.clockStatus().accumulatorMs,1000);

  host.__testAdvanceTime(host.clockStatus().dayLengthMs*26+11500);
  assert.equal(host.clockStatus().day,27,
    'one pulse advances at most 24 delayed days');
  assert.equal(host.clockStatus().pendingDays,2,
    'days beyond the pulse limit remain queued instead of being discarded');
  assert.equal(host.clockStatus().accumulatorMs,host.clockStatus().dayLengthMs*2+12500);

  host.__testPulse();
  assert.equal(host.clockStatus().day,29);
  assert.equal(host.clockStatus().accumulatorMs,12500);
});


test('connected delta-capable guests receive compact updates and recover automatically after a missed delta',async t=>{
  const relay=new MemoryRelay();
  const host=createClient(relay);
  const guest=createClient(relay);
  t.after(()=>{guest.disconnect();host.disconnect();});
  let hostSnapshot=null;
  let guestSnapshot=null;
  const created=await host.createWorld('Delta Host',{
    onSnapshot:game=>{hostSnapshot=game;}
  });
  await guest.joinWorld(created.session.inviteCode,'Delta Guest',{
    onSnapshot:game=>{guestSnapshot=game;}
  });
  await flush();
  const started=await host.admin('start',{});
  await flush();
  assert.equal(guestSnapshot.worldVersion,started.worldVersion);
  const initialGuestDay=guestSnapshot.day;
  guest.__testAdvanceTime(150000);
  assert.equal(guest.clockPresentation().running,true);
  assert.ok(Math.abs(guest.clockPresentation().progress-.5)<.01,
    'a guest interpolates the progress bar from the latest host clock sample');
  assert.equal(guestSnapshot.day,initialGuestDay,
    'guest interpolation must never advance the authoritative calendar');

  const base=144+512*1024+512;
  const sendBuild=plotIndex=>{
    const home=hostSnapshot.territories[0];
    return host.sendOrder({
      orderId:'delta-build-'+plotIndex,gameId:hostSnapshot.id,
      playerId:created.session.playerId,
      expectedWorldVersion:hostSnapshot.worldVersion,
      stateId:home.stateId,type:'build',plotIndex,buildingId:'farm'
    });
  };
  assert.equal(sendBuild(base),true);
  await flush();
  assert.ok(relay.stats.deltaMessages>=1,'supported clients should receive a versioned world delta');
  assert.equal(guestSnapshot.worldVersion,hostSnapshot.worldVersion);
  assert.ok(guestSnapshot.territories[0].buildings[base]);

  relay.dropNextDelta=true;
  assert.equal(sendBuild(base+1),true);
  await flush();
  const missedVersion=hostSnapshot.worldVersion;
  assert.equal(guestSnapshot.worldVersion<missedVersion,true,
    'the test relay deliberately dropped the second delta');

  assert.equal(sendBuild(base+2),true);
  await flush();
  await flush();
  assert.ok(relay.stats.resyncMessages>=1,
    'a guest with a stale base must request an authenticated full resynchronisation');
  assert.equal(guestSnapshot.worldVersion,hostSnapshot.worldVersion);
  assert.ok(guestSnapshot.territories[0].buildings[base+1]);
  assert.ok(guestSnapshot.territories[0].buildings[base+2]);
});

test('a guest without delta support keeps receiving full snapshots',async t=>{
  const relay=new MemoryRelay();
  const host=createClient(relay);
  const legacyGuest=createClient(relay,new Map(),{deltaSync:false});
  t.after(()=>{legacyGuest.disconnect();host.disconnect();});
  let hostSnapshot=null;
  const created=await host.createWorld('Legacy Compatibility Host',{
    onSnapshot:game=>{hostSnapshot=game;}
  });
  await legacyGuest.joinWorld(created.session.inviteCode,'Legacy Guest',{onSnapshot:()=>{}});
  const started=await host.admin('start',{});
  const plotIndex=144+512*1024+512;
  assert.equal(host.sendOrder({
    orderId:'legacy-client-build',gameId:started.id,
    playerId:created.session.playerId,expectedWorldVersion:hostSnapshot.worldVersion,
    stateId:started.territories[0].stateId,type:'build',
    plotIndex,buildingId:'farm'
  }),true);
  await flush();
  assert.equal(relay.stats.deltaMessages,0,
    'the host must not send unsupported delta messages to older clients');
  assert.ok(relay.stats.serverSnapshots>=3,
    'older clients continue to receive complete authoritative snapshots');
});


test('the authoritative clock excludes pause duration when the world resumes',async t=>{
  const relay=new MemoryRelay();
  const host=createClient(relay);
  const guest=createClient(relay);
  t.after(()=>{guest.disconnect();host.disconnect();});
  let hostSnapshot=null;
  let guestSnapshot=null;
  const created=await host.createWorld('Pause Clock Host',{
    onSnapshot:game=>{hostSnapshot=game;}
  });
  await guest.joinWorld(created.session.inviteCode,'Pause Clock Guest',{
    onSnapshot:game=>{guestSnapshot=game;}
  });
  await flush();
  const started=await host.admin('start',{});
  await flush();
  assert.equal(started.status,'running');

  host.__testAdvanceTime(120000);
  assert.equal(host.clockStatus().accumulatorMs,120000);
  const hostPlayer=hostSnapshot.players.find(player=>player.isHost);
  const hostMembership=hostSnapshot.memberships.find(item=>
    item.playerId===hostPlayer.id&&item.status==='active');
  const guestSession=guest.currentSession();
  const guestMembership=guestSnapshot.memberships.find(item=>
    item.playerId===guestSession.playerId&&item.status==='active');

  assert.equal(host.sendOrder({
    orderId:'pause-clock-host',gameId:hostSnapshot.id,
    playerId:hostPlayer.id,expectedWorldVersion:hostSnapshot.worldVersion,
    stateId:hostMembership.stateId,type:'pause'
  }),true);
  await flush();
  assert.equal(host.clockStatus().status,'running','one of two votes is not a majority');

  assert.equal(guest.sendOrder({
    orderId:'pause-clock-guest',gameId:guestSnapshot.id,
    playerId:guestSession.playerId,expectedWorldVersion:guestSnapshot.worldVersion,
    stateId:guestMembership.stateId,type:'pause'
  }),true);
  await flush();
  assert.equal(host.clockStatus().status,'paused');
  assert.equal(host.clockStatus().accumulatorMs,120000);

  host.__testAdvanceTime(600000);
  assert.equal(host.clockStatus().status,'paused');
  assert.equal(host.clockStatus().accumulatorMs,120000,
    'ten minutes of political pause must not enter the simulation accumulator');

  assert.equal(host.sendOrder({
    orderId:'resume-clock-host',gameId:hostSnapshot.id,
    playerId:hostPlayer.id,expectedWorldVersion:hostSnapshot.worldVersion,
    stateId:hostMembership.stateId,type:'resume'
  }),true);
  await flush();
  assert.equal(host.clockStatus().status,'paused','one of two resume votes is not a majority');
  assert.equal(guest.sendOrder({
    orderId:'resume-clock-guest',gameId:guestSnapshot.id,
    playerId:guestSession.playerId,expectedWorldVersion:guestSnapshot.worldVersion,
    stateId:guestMembership.stateId,type:'resume'
  }),true);
  await flush();
  assert.equal(host.clockStatus().status,'running');
  assert.equal(host.clockStatus().accumulatorMs,120000);
  assert.equal(host.clockPresentation().elapsedMs,120000,
    'resuming must retain completed progress without adding the paused interval');

  host.__testAdvanceTime(5000);
  assert.equal(host.clockStatus().accumulatorMs,125000,
    'only five seconds after resuming may be counted');
  assert.equal(host.clockStatus().day,1);
});

test('technical maintenance freezes host and guest clocks without changing political status',async t=>{
  const relay=new MemoryRelay();
  const host=createClient(relay);
  const guest=createClient(relay);
  t.after(()=>{guest.disconnect();host.disconnect();});
  let guestSnapshot=null;
  const guestNotices=[];
  const created=await host.createWorld('Maintenance Clock Host',{});
  await guest.joinWorld(created.session.inviteCode,'Maintenance Clock Guest',{
    onSnapshot:game=>{guestSnapshot=game;},
    onMaintenance:status=>guestNotices.push(status)
  });
  await flush();
  await host.admin('start',{});
  await flush();
  host.__testAdvanceTime(120000);
  assert.equal(host.clockStatus().accumulatorMs,120000);
  assert.equal(guest.clockPresentation().running,true);

  const startedDay=host.clockStatus().day;
  const startedVersion=guestSnapshot.worldVersion;
  const activated=host.setTechnicalMaintenance(true,'Database migration and index verification');
  assert.equal(activated.ok,true,activated.error);
  assert.equal(activated.published,true);
  await flush();
  assert.equal(guest.technicalMaintenanceStatus().active,true);
  assert.equal(guest.clockPresentation().running,false);
  assert.ok(guestNotices.some(status=>status.active===true));

  host.__testAdvanceTime(600000);
  assert.equal(host.clockStatus().status,'running',
    'technical maintenance is not a political pause');
  assert.equal(host.clockStatus().day,startedDay,
    'no world day may advance during technical maintenance');
  assert.equal(host.clockStatus().accumulatorMs,120000,
    'maintenance time must not accumulate');
  assert.equal(guest.clockPresentation().running,false);

  const cleared=host.setTechnicalMaintenance(false,'');
  assert.equal(cleared.ok,true,cleared.error);
  await flush();
  assert.equal(guest.technicalMaintenanceStatus().active,false);
  assert.equal(guest.clockPresentation().running,true);
  assert.ok(guestNotices.some(status=>status.active===false));

  host.__testAdvanceTime(5000);
  assert.equal(host.clockStatus().accumulatorMs,125000,
    'ending maintenance must reset the host clock reference');
  assert.equal(host.clockStatus().day,startedDay);
  assert.equal(guestSnapshot.worldVersion,startedVersion,
    'technical maintenance messages must not mutate the political world snapshot');
});

test('host relay loss pauses an isolated host with an explicit no-connected-players reason',async t=>{
  const relay=new MemoryRelay();
  const host=createClient(relay);
  t.after(()=>host.disconnect());
  let latestSnapshot=null;
  const created=await host.createWorld('No Player Host',{
    onSnapshot:game=>{latestSnapshot=game;}
  });
  await host.admin('start',{});
  assert.equal(host.clockStatus().status,'running');
  const hostPeer=[...relay.peers].find(peer=>
    [...peer.subscriptions].some(filter=>filter.endsWith('/c')));
  assert.ok(hostPeer,'the test must locate the host relay connection');
  hostPeer.connected=false;
  hostPeer.emit('offline');
  assert.equal(host.clockStatus().status,'paused');
  assert.equal(latestSnapshot.players.every(player=>!player.connected),true);
  assert.equal(latestSnapshot.events.at(-1).type,'world.paused.no_connected_players');
  assert.equal(latestSnapshot.events.at(-1).resultCode,'NoConnectedPlayers');
});


test('host restart restores the verified in-progress clock accumulator without counting offline time',async t=>{
  const relay=new MemoryRelay();
  const storage=new Map();
  const host=createClient(relay,storage);
  const created=await host.createWorld('Clock Recovery Host',{});
  await host.admin('start',{});
  host.__testAdvanceTime(125000);
  assert.equal(host.clockStatus().day,1);
  assert.equal(host.clockStatus().accumulatorMs,125000);
  assert.equal(host.saveNow(),true);
  host.disconnect();

  const restored=createClient(relay,storage);
  t.after(()=>restored.disconnect());
  const result=await restored.restoreSession(created.session,{});
  assert.equal(result.game.id,created.session.gameId);
  assert.equal(result.game.day,1);
  assert.equal(restored.clockStatus().status,'running');
  assert.equal(restored.clockStatus().accumulatorMs,125000,
    'the saved sub-day remainder must survive host process restart');
  restored.__testAdvanceTime(174999);
  assert.equal(restored.clockStatus().day,1);
  assert.equal(restored.clockStatus().accumulatorMs,299999);
  restored.__testAdvanceTime(1);
  assert.equal(restored.clockStatus().day,2);
  assert.equal(restored.clockStatus().accumulatorMs,0,
    'offline time between the two host runtimes must not be counted');
});


test('the host relay reconnects into a paused state and excludes the disconnected interval',async t=>{
  const relay=new MemoryRelay();
  const host=createClient(relay);
  t.after(()=>host.disconnect());
  let latestSnapshot=null;
  const created=await host.createWorld('Reconnect Clock Host',{
    onSnapshot:game=>{latestSnapshot=game;}
  });
  await host.admin('start',{});
  host.__testAdvanceTime(45000);
  assert.equal(host.clockStatus().accumulatorMs,45000);

  const hostPeer=[...relay.peers].find(peer=>
    [...peer.subscriptions].some(filter=>filter.endsWith('/c')));
  assert.ok(hostPeer);
  hostPeer.connected=false;
  hostPeer.emit('offline');
  assert.equal(host.clockStatus().status,'paused');
  assert.equal(latestSnapshot.events.at(-1).type,'world.paused.no_connected_players');
  assert.equal(latestSnapshot.events.at(-1).resultCode,'NoConnectedPlayers');

  host.__testAdvanceTime(600000);
  assert.equal(host.clockStatus().accumulatorMs,45000,
    'offline real time must not be accumulated by the disconnected host');

  hostPeer.connected=true;
  hostPeer.emit('connect');
  await flush();
  assert.equal(host.isConnected(),true);
  assert.equal(host.clockStatus().status,'paused',
    'reconnection must not silently resume a politically paused world');
  assert.equal(latestSnapshot.players.find(player=>player.id===created.session.playerId).connected,true);

  const hostPlayer=latestSnapshot.players.find(player=>player.isHost);
  const membership=latestSnapshot.memberships.find(item=>
    item.playerId===hostPlayer.id&&item.status==='active');
  assert.equal(host.sendOrder({
    orderId:'reconnect-clock-resume',gameId:latestSnapshot.id,
    playerId:hostPlayer.id,expectedWorldVersion:latestSnapshot.worldVersion,
    stateId:membership.stateId,type:'resume'
  }),true);
  await flush();
  assert.equal(host.clockStatus().status,'running');
  assert.equal(host.clockStatus().accumulatorMs,45000);
  host.__testAdvanceTime(5000);
  assert.equal(host.clockStatus().accumulatorMs,50000,
    'the resumed clock must begin at the reconnection/resume reference');
  assert.equal(host.clockStatus().day,1);
});


test('all connected clients receive the same authoritative Gregorian date from the host',async t=>{
  const relay=new MemoryRelay();
  const host=createClient(relay);
  const guestA=createClient(relay);
  const guestB=createClient(relay);
  t.after(()=>{guestB.disconnect();guestA.disconnect();host.disconnect();});
  let hostSnapshot=null;
  let snapshotA=null;
  let snapshotB=null;
  const created=await host.createWorld('Shared Calendar Host',{
    onSnapshot:game=>{hostSnapshot=game;}
  });
  await guestA.joinWorld(created.session.inviteCode,'Calendar Guest A',{
    onSnapshot:game=>{snapshotA=game;}
  });
  await guestB.joinWorld(created.session.inviteCode,'Calendar Guest B',{
    onSnapshot:game=>{snapshotB=game;}
  });
  await flush();
  await host.admin('start',{});
  await flush();

  host.__testAdvanceTime(300000);
  await flush();
  assert.equal(hostSnapshot.day,2);
  assert.equal(hostSnapshot.worldDate,'1500-01-02');
  assert.equal(snapshotA.worldDate,hostSnapshot.worldDate);
  assert.equal(snapshotB.worldDate,hostSnapshot.worldDate);
  assert.equal(snapshotA.day,hostSnapshot.day);
  assert.equal(snapshotB.day,hostSnapshot.day);
  assert.equal(snapshotA.worldVersion,hostSnapshot.worldVersion);
  assert.equal(snapshotB.worldVersion,hostSnapshot.worldVersion);
});
