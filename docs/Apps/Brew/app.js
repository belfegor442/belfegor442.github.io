const $=s=>document.querySelector(s);
const home=$("#home"),lobby=$("#lobby"),game=$("#game"),status=$("#status"),lobbyStatus=$("#lobbyStatus"),gameStatus=$("#gameStatus");
const NS="na-brew/v2/";
const BROKERS=(()=>{try{
 const q=new URLSearchParams(location.search).get("brokers");
 if(q){const l=q.split(",").map(s=>s.trim()).filter(s=>/^wss?:\/\//.test(s));if(l.length)return l}
 }catch(e){}
 return["wss://broker.emqx.io:8084/mqtt","wss://test.mosquitto.org:8081/mqtt","wss://broker.hivemq.com:8884/mqtt"];
})();
const MAXJOIN=9;
let isHost=false,hosting=false,room="",balance=1000,opBalance=1000;
let myChoice=null,remoteChoice=null,myStake=25,remoteStake=25,roundLocked=false;
let conns=[],guestUid=null,hostOn=false,linked=false,joinTries=0,joinTimer=null,beatTimer=null;
let gList=[],gIdx=0,gSwitch=0,nextTimer=null;
const myUid=uid();

function uid(){const a="abcdefghijklmnopqrstuvwxyz0123456789",b=new Uint8Array(8);crypto.getRandomValues(b);return [...b].map(n=>a[n%a.length]).join("")}
function code(){const a="ABCDEFGHJKLMNPQRSTUVWXYZ23456789",b=new Uint8Array(6);crypto.getRandomValues(b);return [...b].map(n=>a[n%a.length]).join("")}
function T(k){return NS+room+"/"+k}
function show(x){[home,lobby,game].forEach(e=>e.classList.add("hidden"));x.classList.remove("hidden")}
function inGame(){return !game.classList.contains("hidden")}
function stopTimers(){if(joinTimer){clearTimeout(joinTimer);joinTimer=null}if(beatTimer){clearInterval(beatTimer);beatTimer=null}}
function anyUp(){return conns.some(c=>c.connected)}
function closeMq(){const l=conns;conns=[];for(const c of l){try{c.removeAllListeners();c.end(true)}catch(e){}}}
function send(o){
 if(!conns.length)return;
 const m=isHost?Object.assign({},o,{to:guestUid}):Object.assign({},o,{from:myUid});
 const topic=isHost?T("h2g"):T("g2h");
 const payload=JSON.stringify(m);
 for(const c of conns){if(c.connected){try{c.publish(topic,payload,{qos:0})}catch(e){}}}
}
function setLobby(){
 $("#roomCode").textContent=room||"------";
 const on=isHost?!!guestUid:false;
 $("#startBtn").disabled=!on;
 $("#startBtn").textContent=isHost?(on?"START DUEL":"WAITING FOR PLAYER"):"WAITING FOR HOST";
 $("#p2").textContent=on?"PLAYER 2":"WAITING";
 $(".dot.waiting").style.background=on?"#111":"#ccc";
}
function order(){
 let h=0;for(const ch of room)h=(h*131+ch.charCodeAt(0))>>>0;
 const s=h%BROKERS.length;
 return BROKERS.slice(s).concat(BROKERS.slice(0,s));
}
function connectOne(url,will,onReady,onFail){
 if(typeof mqtt==="undefined"){onFail();return}
 let c;
 try{
  c=mqtt.connect(url,{connectTimeout:6000,reconnectPeriod:2500,keepalive:15,resubscribe:true,queueQoSZero:true,will:will||undefined});
 }catch(e){onFail();return}
 let settled=false;
 const bad=()=>{
  if(settled)return;settled=true;clearTimeout(t);
  try{c.removeAllListeners();c.end(true)}catch(e){}
  onFail();
 };
 const ok=()=>{
  if(settled)return;settled=true;clearTimeout(t);
  c.removeListener("error",bad);c.removeListener("offline",bad);
  c.on("error",()=>{});
  onReady(c,url);
 };
 const t=setTimeout(bad,7000);
 c.once("connect",ok);
 c.on("error",bad);
 c.on("offline",bad);
}
function connectList(list,will,onReady,onFail){
 let i=0;
 const next=()=>{if(i>=list.length){onFail();return}connectOne(list[i++],will,onReady,next)};
 next();
}
function create(){
 if(!hosting)return;
 hosting=true;isHost=true;room=code();guestUid=null;linked=false;
 closeMq();stopTimers();
 show(lobby);setLobby();lobbyStatus.textContent="Connecting to the network…";
 const will={topic:T("host"),payload:'{"on":0}',retain:true,qos:0};
 const list=order();
 let left=list.length,up=0;
 list.forEach(url=>{
  connectOne(url,will,c=>{
   up++;conns.push(c);
   c.on("message",onHostMsg);
   c.on("reconnect",()=>{if(!anyUp())lobbyStatus.textContent="Reconnecting…";try{c.publish(T("host"),'{"on":1}',{retain:true})}catch(e){}});
   c.on("close",()=>{if(isHost&&!anyUp())lobbyStatus.textContent="Connection lost — reconnecting…"});
   c.subscribe([T("g2h")],()=>{});
   c.publish(T("host"),'{"on":1}',{retain:true});
   if(up===1){lobbyStatus.textContent="Share the code: "+room;setLobby()}
  },()=>{
   left--;
   if(up===0&&left===0)lobbyStatus.textContent="Cannot reach the game network. Check your connection and try again.";
  });
 });
 beatTimer=setInterval(()=>{
  for(const c of conns){if(c.connected){try{c.publish(T("host"),'{"on":1}',{retain:true})}catch(e){}}}
 },20000);
}
function onHostMsg(t,p){
 let m;try{m=JSON.parse(p.toString())}catch(e){return}
 if(m.type==="join"){
  if(!m.from)return;
  if(!guestUid){guestUid=m.from;setLobby();lobbyStatus.textContent="Player connected. You can start the duel.";send({type:"hello",name:"PLAYER 2"})}
  else if(m.from!==guestUid)send({type:"full",to:m.from});
  return;
 }
 if(t===T("host"))return;
 if(t!==T("g2h"))return;
 if(!guestUid)guestUid=m.from||"unknown";
 if(m.from&&m.from!==guestUid)return;
 onData(m);
}
function join(){
 const v=$("#roomInput").value.trim().toUpperCase();
 if(v.length!==6){status.textContent="Enter a 6-character room code.";return}
 hosting=false;isHost=false;room=v;joinTries=0;hostOn=false;linked=false;
 gList=order();gIdx=0;gSwitch=0;
 closeMq();stopTimers();
 show(lobby);setLobby();lobbyStatus.textContent="Connecting to the network…";
 guestConnect();
}
function guestConnect(){
 closeMq();
 const list=gList.slice(gIdx).concat(gList.slice(0,gIdx));
 connectList(list,null,c=>{
  conns=[c];
  c.on("message",onGuestMsg);
  c.on("reconnect",()=>{if(!linked)lobbyStatus.textContent="Reconnecting…"});
  c.on("close",()=>{if(!linked&&!isHost&&!anyUp())lobbyStatus.textContent="Connection lost — reconnecting…"});
  c.subscribe([T("host"),T("h2g")],()=>{});
  sendJoin();
 },()=>{
  if(gSwitch<gList.length-1){gSwitch++;gIdx=(gIdx+1)%gList.length;lobbyStatus.textContent="Connecting to the network…";setTimeout(guestConnect,400)}
  else lobbyStatus.textContent="Cannot reach the game network. Check your connection and try again.";
 });
}
function sendJoin(){
 if(linked)return;
 joinTries++;
 if(anyUp())send({type:"join",from:myUid});
 lobbyStatus.textContent=hostOn?"Joining room "+room+"…":"Looking for room "+room+"… ("+joinTries+"/"+MAXJOIN+")";
 if(linked)return;
 if(joinTries<MAXJOIN){
  if(joinTries%3===0&&!hostOn&&gSwitch<gList.length-1){
   gSwitch++;gIdx=(gIdx+1)%gList.length;
   lobbyStatus.textContent="Looking in another network…";
   joinTimer=setTimeout(guestConnect,400);
   return;
  }
  joinTimer=setTimeout(sendJoin,1300);
 }else if(!linked)lobbyStatus.textContent=hostOn?"The host is not responding. Ask them to create a new room.":"Room "+room+" not found. Ask the host for a new code.";
}
function onGuestMsg(t,p){
 let m;try{m=JSON.parse(p.toString())}catch(e){return}
 if(t===T("host")){
  const on=m.on===1;
  if(on&&!hostOn){hostOn=true;if(!linked){lobbyStatus.textContent="Room found. Joining…";if(anyUp())send({type:"join",from:myUid})}}
  if(!on&&hostOn){
   hostOn=false;linked=false;
   if(inGame()){gameStatus.textContent="Host left the room.";disableChoices()}
   else lobbyStatus.textContent="The host closed the room.";
  }
  return;
 }
 if(t!==T("h2g"))return;
 if(m.to&&m.to!==myUid)return;
 if(m.type==="full"){linked=false;lobbyStatus.textContent="Room "+room+" already has 2 players.";return}
 onData(m);
}
function start(){if(!isHost||!guestUid)return;show(game);begin();send({type:"start"})}
function begin(){
 if(nextTimer){clearTimeout(nextTimer);nextTimer=null}
 myChoice=null;remoteChoice=null;roundLocked=false;$("#coin").textContent="?";
 $("#turnText").textContent="Choose heads or tails.";gameStatus.textContent="";
 $("#youScore").textContent=balance;$("#opScore").textContent=opBalance;enableChoices();
}
function enableChoices(){document.querySelectorAll(".choices button").forEach(b=>b.disabled=false)}
function disableChoices(){document.querySelectorAll(".choices button").forEach(b=>b.disabled=true)}
function play(c){
 if(roundLocked||myChoice)return;
 myChoice=c;myStake=Math.max(1,Math.min(1000,Number($("#stake").value)||1));disableChoices();
 $("#turnText").textContent="Waiting for opponent…";send({type:"choice",choice:c,stake:myStake});
 if(isHost)resolveIfReady();
}
function resolveIfReady(){
 if(!isHost||!myChoice||!remoteChoice||roundLocked)return;
 roundLocked=true;
 const s=Math.min(myStake,remoteStake,balance,opBalance),result=Math.random()<.5?"heads":"tails";
 const hostWon=myChoice===result;
 if(hostWon){balance+=s;opBalance-=s}else{balance-=s;opBalance+=s}
 send({type:"result",result,hostWon,hostBalance:balance,guestBalance:opBalance,stake:s});
 applyResult(result,hostWon,s);
}
function applyResult(result,hostWon,s){
 const won=isHost?hostWon:!hostWon;$("#coin").textContent=result==="heads"?"H":"T";
 $("#youScore").textContent=balance;$("#opScore").textContent=opBalance;
 gameStatus.textContent=won?"YOU WIN +"+s:"YOU LOSE -"+s;
 if(isHost)setTimeout(()=>{begin();send({type:"begin"})},1100);
 else nextTimer=setTimeout(()=>{if(inGame())begin()},4500);
}
function onData(m){
 if(m.type==="hello"){linked=true;stopTimers();setLobby();lobbyStatus.textContent="Connected. Waiting for the host.";return}
 if(m.type==="start"){linked=true;stopTimers();show(game);begin();return}
 if(m.type==="begin"){if(inGame())begin();return}
 if(m.type==="full"){lobbyStatus.textContent="Room "+room+" already has 2 players.";return}
 if(m.type==="choice"){
  remoteChoice=m.choice;remoteStake=Math.max(1,Number(m.stake)||1);
  if(isHost)resolveIfReady();return;
 }
 if(m.type==="result"){
  balance=isHost?m.hostBalance:m.guestBalance;opBalance=isHost?m.guestBalance:m.hostBalance;
  roundLocked=true;applyResult(m.result,m.hostWon,m.stake);
 }
}
$("#createBtn").onclick=()=>{hosting=true;create()};
$("#joinBtn").onclick=join;
$("#startBtn").onclick=start;
$("#leaveBtn").onclick=()=>location.reload();$("#gameLeave").onclick=()=>location.reload();
$("#copyBtn").onclick=async()=>{try{await navigator.clipboard.writeText(room);lobbyStatus.textContent="Room code copied."}catch{lobbyStatus.textContent="Room code: "+room}};
document.querySelectorAll(".choices button").forEach(b=>b.onclick=()=>play(b.dataset.choice));
setInterval(setLobby,700);
