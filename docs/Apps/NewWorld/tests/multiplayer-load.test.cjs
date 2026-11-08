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
    if(topic.endsWith('/s') && message.t==='playerJoined') this.relay.stats.playerJoinedMessages++;
    if(topic.endsWith('/s') && message.t==='lobbyCount') this.relay.stats.lobbyCountMessages++;
    if(options.retain) {
      if(bytes.length) this.relay.retained.set(topic,bytes);
      else this.relay.retained.delete(topic);
    }
    queueMicrotask(()=>{
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
    this.stats={publishes:0,helloMessages:0,serverSnapshots:0,playerJoinedMessages:0,lobbyCountMessages:0};
  }
  connect() { return new MemoryPeer(this); }
}

function createClient(relay) {
  const storage=new Map();
  const context={
    window:{NewWorldSimulation:simulation,NewWorldStrategy:strategy},
    mqtt:{connect:()=>relay.connect()},
    crypto,
    structuredClone,
    localStorage:{
      getItem:key=>storage.get(key)??null,
      setItem:(key,value)=>storage.set(key,String(value)),
      removeItem:key=>storage.delete(key)
    },
    setTimeout,clearTimeout,
    setInterval:()=>({unref(){}}),
    clearInterval:()=>{},
    console,
    module:{exports:{}}
  };
  vm.createContext(context);
  vm.runInContext(source,context,{filename:'multiplayer.js'});
  return context.window.NewWorldMultiplayer;
}

function flush() {
  return new Promise(resolve=>setImmediate(()=>setImmediate(resolve)));
}

test('host starts an end-to-end 67-client relay room without broadcasting full snapshots on every join', async t => {
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

  for(let index=0;index<66;index++) {
    const guest=createClient(relay);
    guest.lobbyCounts=[];
    guests.push(guest);
    await guest.joinWorld(created.session.inviteCode,'Friend '+String(index+1),{
      onSnapshot:()=>{},
      onPlayerCount:count=>guest.lobbyCounts.push(count)
    });
    await flush();
  }

  assert.equal(relay.peers.size,67);
  assert.equal(relay.stats.helloMessages,66,'each join must send exactly one initial hello');
  assert.equal(relay.stats.playerJoinedMessages,0,'full player cards must not fan out to every guest');
  assert.equal(relay.stats.lobbyCountMessages,66,'each join must publish one compact count update');
  assert.equal(relay.stats.serverSnapshots,1,'joins must not fan out full-world snapshots');
  assert.equal(hostJoinCount,66,'the host roster must receive every join delta');
  assert.equal(guests.at(-1).lobbyCounts.at(-1).totalPlayers,67);
  assert.equal(guests.at(-1).lobbyCounts.at(-1).connectedPlayers,67);

  const started=await host.admin('start',{});
  assert.equal(started.started,true);
  assert.equal(started.status,'running');
  assert.equal(started.players.length,67);
  assert.equal(started.memberships.length,67);
  assert.equal(hostSnapshot.players.length,67);
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
