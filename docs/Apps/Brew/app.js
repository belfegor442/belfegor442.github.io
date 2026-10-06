const $=s=>document.querySelector(s);
const home=$("#home"),lobby=$("#lobby"),game=$("#game"),status=$("#status"),lobbyStatus=$("#lobbyStatus"),gameStatus=$("#gameStatus");
let peer=null,conn=null,isHost=false,room="",balance=1000,opBalance=1000;
let myChoice=null,remoteChoice=null,myStake=25,remoteStake=25,roundLocked=false;

function show(x){[home,lobby,game].forEach(e=>e.classList.add("hidden"));x.classList.remove("hidden")}
function code(){return Math.random().toString(36).slice(2,8).toUpperCase()}
function send(o){if(conn&&conn.open)conn.send(o)}
function setLobby(){
 $("#roomCode").textContent=room;$("#startBtn").disabled=!conn||!isHost;
 $("#startBtn").textContent=conn?(isHost?"START DUEL":"WAITING FOR HOST"):"WAITING FOR PLAYER";
 $("#p2").textContent=conn?"PLAYER 2":"WAITING";$(".dot.waiting").style.background=conn?"#111":"#ccc";
}
function wire(c){
 c.on("data",onData);c.on("close",()=>{conn=null;if(!game.classList.contains("hidden")){gameStatus.textContent="Connection closed.";disableChoices()}else setLobby()});
}
function create(){
 room=code();isHost=true;show(lobby);setLobby();lobbyStatus.textContent="Creating room…";
 peer=new Peer("brew-"+room,{debug:0});
 peer.on("open",()=>lobbyStatus.textContent="Share the code: "+room);
 peer.on("connection",c=>{
  if(conn){c.close();return} conn=c;wire(c);
  c.on("open",()=>{setLobby();send({type:"hello",name:"PLAYER 2"});lobbyStatus.textContent="Player connected. You can start the duel."});
 });
 peer.on("error",e=>{lobbyStatus.textContent=e.type==="unavailable-id"?"Room unavailable. Try again.":"Connection error."});
}
function join(){
 const v=$("#roomInput").value.trim().toUpperCase();
 if(v.length!==6){status.textContent="Enter a 6-character room code.";return}
 room=v;isHost=false;show(lobby);setLobby();lobbyStatus.textContent="Connecting…";
 peer=new Peer({debug:0});
 peer.on("open",()=>{
  conn=peer.connect("brew-"+room,{reliable:true});wire(conn);
  conn.on("open",()=>{setLobby();lobbyStatus.textContent="Connected. Waiting for the host.";send({type:"hello",name:"PLAYER 2"})});
 });
 peer.on("error",()=>lobbyStatus.textContent="Could not join that room.");
}
function start(){if(!conn||!isHost)return;show(game);begin();send({type:"start"})}
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
$("#createBtn").onclick=create;$("#joinBtn").onclick=join;$("#startBtn").onclick=start;
$("#leaveBtn").onclick=()=>location.reload();$("#gameLeave").onclick=()=>location.reload();
$("#copyBtn").onclick=async()=>{try{await navigator.clipboard.writeText(room);lobbyStatus.textContent="Room code copied."}catch{lobbyStatus.textContent="Room code: "+room}};
document.querySelectorAll(".choices button").forEach(b=>b.onclick=()=>play(b.dataset.choice));