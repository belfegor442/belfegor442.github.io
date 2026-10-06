const $=s=>document.querySelector(s);
const home=$("#home"),lobby=$("#lobby"),game=$("#game"),status=$("#status"),lobbyStatus=$("#lobbyStatus"),gameStatus=$("#gameStatus");
let peer=null,conn=null,isHost=false,room="",balance=1000,opBalance=1000;
const MAXJOIN=5;
let myChoice=null,remoteChoice=null,myStake=25,remoteStake=25,roundLocked=false,hosting=false,joinTries=0,connTimer=null;

const ICE={iceServers:[
 {urls:["stun:stun.l.google.com:19302","stun:stun1.l.google.com:19302","stun:stun.cloudflare.com:3478"]},
 {urls:["turn:openrelay.metered.ca:80","turn:openrelay.metered.ca:443","turn:openrelay.metered.ca:443?transport=tcp"],username:"openrelayproject",credential:"openrelayproject"}
]};

function show(x){[home,lobby,game].forEach(e=>e.classList.add("hidden"));x.classList.remove("hidden")}
function code(){const a="ABCDEFGHJKLMNPQRSTUVWXYZ23456789",b=new Uint8Array(6);crypto.getRandomValues(b);return [...b].map(n=>a[n%a.length]).join("")}
function send(o){if(conn&&conn.open)conn.send(o)}
function dropPeer(){if(connTimer){clearTimeout(connTimer);connTimer=null}if(conn){try{conn.close()}catch(e){}conn=null}if(peer){try{peer.destroy()}catch(e){}peer=null}}
function errText(e){
 const t=e&&e.type;
 if(t==="peer-unavailable")return "No room with that code. Check it with the host.";
 if(t==="unavailable-id")return "Room code already in use.";
 if(t==="network"||t==="server-error"||t==="socket-error"||t==="socket-closed")return "Cannot reach the game network. Check your internet connection.";
 if(t==="browser-incompatible")return "This browser does not support WebRTC.";
 if(t==="disconnected"||t==="webrtc")return "Peer-to-peer connection failed ("+t+").";
 return "Connection problem ("+(t||"unknown")+").";
}
function setLobby(){
 $("#roomCode").textContent=room||"------";
 const ready=!!(peer&&peer.open);
 $("#startBtn").disabled=!conn||!isHost||!ready;
 $("#startBtn").textContent=conn?(isHost?"START DUEL":"WAITING FOR HOST"):(isHost?"CREATING ROOM…":"WAITING FOR PLAYER");
 $("#p2").textContent=conn?"PLAYER 2":"WAITING";$(".dot.waiting").style.background=conn?"#111":"#ccc";
}
function wire(c){
 c.on("data",onData);
 c.on("error",e=>{if(conn===c)lobbyStatus.textContent="Link error: "+((e&&e.type)||e)});
 c.on("close",()=>{if(conn!==c)return;conn=null;if(!game.classList.contains("hidden")){gameStatus.textContent="Connection closed.";disableChoices()}else setLobby()});
}
function create(){
 if(!hosting)return;
 if(peer){try{peer.destroy()}catch(e){}peer=null}conn=null;
 room=code();isHost=true;show(lobby);setLobby();lobbyStatus.textContent="Creating room…";
 peer=new Peer("brew-"+room,{debug:0,config:ICE});
 peer.on("open",()=>{lobbyStatus.textContent="Share the code: "+room;setLobby()});
 peer.on("connection",c=>{
  if(conn){c.close();return} conn=c;wire(c);
  c.on("open",()=>{setLobby();send({type:"hello",name:"PLAYER 2"});lobbyStatus.textContent="Player connected. You can start the duel."});
 });
 peer.on("error",e=>{
  if(e.type==="unavailable-id"){lobbyStatus.textContent="Code in use, generating a new one…";setTimeout(create,350);return}
  lobbyStatus.textContent=errText(e);
 });
 peer.on("disconnected",()=>{if(peer&&!peer.destroyed)try{peer.reconnect()}catch(e){}});
}
function join(){
 const v=$("#roomInput").value.trim().toUpperCase();
 if(v.length!==6){status.textContent="Enter a 6-character room code.";return}
 hosting=false;room=v;isHost=false;joinTries=0;dropPeer();
 show(lobby);setLobby();lobbyStatus.textContent="Connecting…";
 attempt();
}
function attempt(){
 joinTries++;
 const my=joinTries;
 dropPeer();
 peer=new Peer({debug:0,config:ICE});
 const retry=delay=>{
  if(joinTries!==my)return;
  if(joinTries<MAXJOIN){
   lobbyStatus.textContent="Looking for room "+room+"… ("+joinTries+"/"+MAXJOIN+")";
   connTimer=setTimeout(()=>{if(joinTries===my)attempt()},delay);
  }else lobbyStatus.textContent="Room "+room+" not found. Ask the host for a new code.";
 };
 peer.on("open",()=>{
  if(joinTries!==my)return;
  const c=peer.connect("brew-"+room,{reliable:true});
  conn=c;wire(c);setLobby();
  let opened=false;
  c.on("open",()=>{
   if(joinTries!==my)return;
   opened=true;setLobby();lobbyStatus.textContent="Connected. Waiting for the host.";send({type:"hello",name:"PLAYER 2"});
  });
  connTimer=setTimeout(()=>{
   if(opened||joinTries!==my)return;
   conn=null;retry(350);
  },2200);
 });
 peer.on("error",e=>{
  if(joinTries!==my)return;
  if(e.type==="peer-unavailable"||e.type==="network")retry(400);
  else lobbyStatus.textContent=errText(e);
 });
 peer.on("disconnected",()=>{if(peer&&!peer.destroyed)try{peer.reconnect()}catch(e){}});
}
function start(){if(!conn||!isHost||!conn.open)return;show(game);begin();send({type:"start"})}
function begin(){
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
 gameStatus.textContent=won?"YOU WIN +"+s:"YOU LOSE -"+s;setTimeout(begin,1100);
}
function onData(m){
 if(m.type==="hello"){return}
 if(m.type==="start"){show(game);begin();return}
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
