const $=s=>document.querySelector(s);
const home=$("#home"),lobby=$("#lobby"),game=$("#game"),status=$("#status"),lobbyStatus=$("#lobbyStatus"),gameStatus=$("#gameStatus");
let peer=null,conn=null,isHost=false,room="",balance=1000,opBalance=1000,choice=null,stake=25;

function show(x){[home,lobby,game].forEach(e=>e.classList.add("hidden"));x.classList.remove("hidden")}
function code(){return Math.random().toString(36).slice(2,8).toUpperCase()}
function send(o){if(conn&&conn.open)conn.send(o)}
function setLobby(){ $("#roomCode").textContent=room; $("#startBtn").disabled=!conn; $("#startBtn").textContent=conn?"START DUEL":"WAITING FOR PLAYER"; $("#p2").textContent=conn?"PLAYER 2":"WAITING"; $(".dot.waiting").style.background=conn?"#111":"#ccc"; }
function initPeer(id){
  peer=new Peer(id,{debug:0});
  peer.on("open",()=>{});
  peer.on("connection",c=>{if(conn)return;c.on("open",()=>{conn=c;isHost=true;setLobby();send({type:"hello",name:"PLAYER 2"});lobbyStatus.textContent="Player connected. You can start the duel.";});wire(c)});
  peer.on("error",e=>{status.textContent=e.type==="unavailable-id"?"Room unavailable. Try again.":"Connection error.";});
}
function wire(c){
 c.on("data",onData);
 c.on("close",()=>{conn=null;if(!game.classList.contains("hidden")){gameStatus.textContent="Connection closed.";disableChoices()}else{setLobby()}});
}
function create(){
 room=code();isHost=true;show(lobby);setLobby();lobbyStatus.textContent="Creating room…";
 initPeer("brew-"+room);setTimeout(()=>{lobbyStatus.textContent="Share the code: "+room},600);
}
function join(){
 const v=$("#roomInput").value.trim().toUpperCase();if(v.length!==6){status.textContent="Enter a 6-character room code.";return}
 room=v;isHost=false;show(lobby);setLobby();lobbyStatus.textContent="Connecting…";
 peer=new Peer({debug:0});peer.on("open",()=>{conn=peer.connect("brew-"+room,{reliable:true});wire(conn);conn.on("open",()=>{setLobby();lobbyStatus.textContent="Connected. Waiting for the host.";send({type:"hello",name:"PLAYER 2"})})});
 peer.on("error",()=>{lobbyStatus.textContent="Could not join that room.";});
}
function start(){if(!conn)return;show(game);send({type:"start"});begin()}
function begin(){choice=null;$("#coin").textContent="?";$("#turnText").textContent="Choose heads or tails.";gameStatus.textContent="";$("#youScore").textContent=balance;$("#opScore").textContent=opBalance;document.querySelectorAll(".choices button").forEach(b=>b.disabled=false)}
function disableChoices(){document.querySelectorAll(".choices button").forEach(b=>b.disabled=true)}
function play(c){
 if(choice)return;choice=c;stake=Math.max(1,Math.min(1000,Number($("#stake").value)||1));disableChoices();$("#turnText").textContent="Waiting for opponent…";send({type:"choice",choice:c,stake});
}
function resolve(remote){
 const mine=choice;const s=Math.min(stake,remote.stake||stake,balance,opBalance);
 const result=Math.random()<.5?"heads":"tails";
 $("#coin").textContent=result[0].toUpperCase();
 const win=mine===result;
 if(win){balance+=s;opBalance-=s}else{balance-=s;opBalance+=s}
 $("#youScore").textContent=balance;$("#opScore").textContent=opBalance;
 gameStatus.textContent=win?"YOU WIN +"+s:"YOU LOSE -"+s;
 choice=null;setTimeout(()=>{send({type:"round",result,balance});begin()},1100)
}
let remoteChoice=null;
function onData(m){
 if(m.type==="hello"){$("#opponentName").textContent=m.name||"OPPONENT";return}
 if(m.type==="start"){show(game);begin();return}
 if(m.type==="choice"){remoteChoice=m;if(choice)resolve(remoteChoice);return}
 if(m.type==="round"){balance=m.balance;$("#youScore").textContent=balance;remoteChoice=null;begin()}
}
$("#createBtn").onclick=create;$("#joinBtn").onclick=join;$("#startBtn").onclick=start;$("#leaveBtn").onclick=()=>location.reload();$("#gameLeave").onclick=()=>location.reload();
$("#copyBtn").onclick=async()=>{try{await navigator.clipboard.writeText(room);lobbyStatus.textContent="Room code copied."}catch{lobbyStatus.textContent="Room code: "+room}};
document.querySelectorAll(".choices button").forEach(b=>b.onclick=()=>play(b.dataset.choice));