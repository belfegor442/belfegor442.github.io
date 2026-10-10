/* Voice/video calls: WebRTC audio (+ video when requested), P2P. The server
   only relays signaling frames (invite/accept/decline/end + SDP/ICE) over the
   authenticated WebSocket — media itself never touches the server, matching
   the native mesh model (CALL <peer> — LAN voice, PacketType::PeerVoiceFrame
   reserved P2P). The invite carries media:"audio"|"video" so the callee knows
   whether to open the camera before Accept. One active call at a time. */
import { state, on, emit } from "./store.js";
import { sendFrame } from "./ws.js";
import { startRing, stopRing, playSound } from "./sound.js";

const STUN_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];
const RING_TIMEOUT_MS = 45000;

let callId = null;
let peer = null;
let role = null;          // "caller" | "callee"
let phase = "idle";       // idle | ringing-out | ringing-in | connecting | in-call
let media = "audio";      // "audio" | "video" (decided at invite time)
let pc = null;
let localStream = null;
let remoteStream = null;
let muted = false;
let cameraOff = false;
let startedAt = 0;
let ringTimer = null;
let tickTimer = null;
let pendingCandidates = [];

export function callState() {
  return { phase, peer, callId, role, media, muted, cameraOff, startedAt, localStream, remoteStream };
}
export function isCallActive() { return phase !== "idle"; }
export function activePeer() { return peer; }

function newCallId() {
  return "call-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}
function sendSignal(payload) {
  return sendFrame({ type: "call", ...payload });
}
function setPhase(next) {
  phase = next;
  emit("callstate", callState());
}
function clearRingTimer() {
  if (ringTimer) { clearTimeout(ringTimer); ringTimer = null; }
}
function stopTick() {
  if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
}
function cleanupMedia() {
  if (localStream) {
    for (const t of localStream.getTracks()) {
      try { t.stop(); } catch { /* track already ended */ }
    }
    localStream = null;
  }
  remoteStream = null;
}
function reset() {
  clearRingTimer();
  stopTick();
  stopRing();
  pendingCandidates = [];
  if (pc) {
    try { pc.close(); } catch { /* already closed */ }
    pc = null;
  }
  cleanupMedia();
  callId = null;
  peer = null;
  role = null;
  media = "audio";
  muted = false;
  cameraOff = false;
  startedAt = 0;
  setPhase("idle");
}

function makePc() {
  const p = new RTCPeerConnection({ iceServers: STUN_SERVERS });
  p.onicecandidate = (ev) => {
    if (!callId || !peer) return;
    sendSignal({
      action: "candidate",
      call_id: callId,
      to: peer,
      candidate: ev.candidate ? ev.candidate.toJSON() : null,
    });
  };
  p.ontrack = (ev) => {
    remoteStream = ev.streams && ev.streams[0] ? ev.streams[0] : new MediaStream([ev.track]);
    emit("callstate", callState());
  };
  p.onconnectionstatechange = () => {
    if (!pc) return;
    if (pc.connectionState === "connected" && (phase === "connecting" || phase === "in-call")) {
      if (phase === "connecting") {
        startedAt = Date.now();
        stopRing();
        clearRingTimer();
        setPhase("in-call");
        playSound("logon");
        stopTick();
        tickTimer = setInterval(() => emit("callstate", callState()), 1000);
      }
    } else if (pc.connectionState === "failed") {
      endCall("connection failed");
    }
  };
  return p;
}
function flushCandidates() {
  if (!pc || !pc.remoteDescription) return;
  const queued = pendingCandidates.splice(0);
  for (const c of queued) {
    pc.addIceCandidate(c).catch(() => { /* late/duplicate candidate */ });
  }
}
async function getMedia(kind) {
  const wantVideo = kind === "video";
  localStream = await navigator.mediaDevices.getUserMedia({
    audio: true,
    video: wantVideo ? { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" } : false,
  });
  return localStream;
}

export async function startCall(target, kind) {
  if (phase !== "idle") return { ok: false, error: "another call is already active" };
  if (!target || target === state.selfNode) return { ok: false, error: "invalid call target" };
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return { ok: false, error: "camera/microphone unavailable in this browser" };
  }
  media = kind === "video" ? "video" : "audio";
  try {
    await getMedia(media);
  } catch {
    reset();
    return { ok: false, error: media === "video" ? "camera/microphone access denied" : "microphone access denied" };
  }
  peer = target;
  role = "caller";
  callId = newCallId();
  muted = false;
  cameraOff = false;
  if (!sendSignal({ action: "invite", call_id: callId, to: peer, media })) {
    reset();
    return { ok: false, error: "not connected to the server" };
  }
  setPhase("ringing-out");
  startRing();
  ringTimer = setTimeout(() => endCall("no answer"), RING_TIMEOUT_MS);
  return { ok: true };
}

export async function acceptCall() {
  if (phase !== "ringing-in" || !callId || !peer) return { ok: false };
  try {
    await getMedia(media);
  } catch {
    sendSignal({ action: "decline", call_id: callId, to: peer });
    reset();
    emit("callnotice", "camera/microphone access denied");
    return { ok: false, error: "camera/microphone access denied" };
  }
  stopRing();
  clearRingTimer();
  pc = makePc();
  for (const t of localStream.getTracks()) pc.addTrack(t, localStream);
  sendSignal({ action: "accept", call_id: callId, to: peer });
  setPhase("connecting");
  return { ok: true };
}

export function declineCall() {
  if (phase !== "ringing-in" || !callId) return;
  sendSignal({ action: "decline", call_id: callId, to: peer });
  reset();
  emit("callstate", callState());
}

export function cancelCall() {
  if (phase !== "ringing-out" || !callId) return;
  sendSignal({ action: "end", call_id: callId, to: peer });
  reset();
  emit("callstate", callState());
}

export function endCall(notice) {
  if (phase === "idle") return;
  const wasConnected = phase === "in-call" || phase === "connecting";
  if (callId && peer) sendSignal({ action: "end", call_id: callId, to: peer });
  reset();
  if (wasConnected) playSound("logoff");
  emit("callstate", callState());
  if (notice) emit("callnotice", notice);
}

export function toggleMute() {
  if (!localStream || (phase !== "in-call" && phase !== "connecting")) return muted;
  muted = !muted;
  for (const t of localStream.getAudioTracks()) t.enabled = !muted;
  emit("callstate", callState());
  return muted;
}

export function toggleCamera() {
  if (media !== "video" || !localStream || (phase !== "in-call" && phase !== "connecting")) return cameraOff;
  cameraOff = !cameraOff;
  for (const t of localStream.getVideoTracks()) t.enabled = !cameraOff;
  emit("callstate", callState());
  return cameraOff;
}

// Closing the dialog routes to the right teardown for the current phase.
export function dismissCall() {
  if (phase === "ringing-in") declineCall();
  else if (phase === "ringing-out") cancelCall();
  else if (phase !== "idle") endCall();
}

function onSignal(d) {
  if (!d || typeof d !== "object") return;
  if (d.from === state.selfNode) return; // our own frame echoed back
  const action = d.action;
  if (action === "invite") {
    if (phase !== "idle" || !d.call_id || !d.from) {
      // Busy or malformed invite: polite automatic decline.
      if (d.call_id && d.from) sendSignal({ action: "decline", call_id: d.call_id, to: d.from });
      return;
    }
    peer = d.from;
    callId = d.call_id;
    role = "callee";
    media = d.media === "video" ? "video" : "audio";
    muted = false;
    cameraOff = false;
    setPhase("ringing-in");
    startRing();
    ringTimer = setTimeout(() => {
      if (phase === "ringing-in" && callId && peer) {
        sendSignal({ action: "end", call_id: callId, to: peer });
        reset();
        emit("callstate", callState());
        emit("callnotice", "missed call");
      }
    }, RING_TIMEOUT_MS);
    emit("callinvite", { from: d.from, call_id: d.call_id });
    return;
  }
  // Every other action belongs to the active call only.
  if (!callId || d.call_id !== callId) return;
  if (action === "accept" && phase === "ringing-out") {
    stopRing();
    clearRingTimer();
    setPhase("connecting");
    if (!pc) {
      pc = makePc();
      if (localStream) for (const t of localStream.getTracks()) pc.addTrack(t, localStream);
    }
    pc.createOffer()
      .then((offer) => pc.setLocalDescription(offer))
      .then(() => {
        if (pc && callId && peer) {
          sendSignal({ action: "offer", call_id: callId, to: peer, sdp: pc.localDescription.sdp });
        }
      })
      .catch(() => endCall("could not start the audio stream"));
    return;
  }
  if (action === "offer" && phase === "connecting" && pc && d.sdp) {
    pc.setRemoteDescription({ type: "offer", sdp: d.sdp })
      .then(() => pc.createAnswer())
      .then((answer) => pc.setLocalDescription(answer))
      .then(() => {
        if (pc && callId && peer) {
          sendSignal({ action: "answer", call_id: callId, to: peer, sdp: pc.localDescription.sdp });
        }
        flushCandidates();
      })
      .catch(() => endCall("could not negotiate the audio stream"));
    return;
  }
  if (action === "answer" && pc && d.sdp) {
    pc.setRemoteDescription({ type: "answer", sdp: d.sdp })
      .then(flushCandidates)
      .catch(() => endCall("could not negotiate the audio stream"));
    return;
  }
  if (action === "candidate") {
    if (!pc) return;
    if (pc.remoteDescription && d.candidate) {
      pc.addIceCandidate(d.candidate).catch(() => { /* late/duplicate candidate */ });
    } else if (d.candidate) {
      pendingCandidates.push(d.candidate);
    } else if (pc.remoteDescription) {
      pc.addIceCandidate(null).catch(() => { /* end marker already implied */ });
    }
    return;
  }
  if (action === "decline") {
    reset();
    emit("callstate", callState());
    emit("callnotice", "call declined");
    return;
  }
  if (action === "end") {
    const wasConnected = phase === "in-call" || phase === "connecting";
    const wasRingingIn = phase === "ringing-in";
    reset();
    if (wasConnected) playSound("logoff");
    emit("callstate", callState());
    emit("callnotice", wasRingingIn ? "missed call" : "call ended");
    return;
  }
}

on("call", onSignal);
// Socket died mid-call: the relay is gone and so is the peer's signaling.
on("connection", (mode) => {
  if (mode === "online" || phase === "idle") return;
  const wasConnected = phase === "in-call" || phase === "connecting";
  reset();
  if (wasConnected) playSound("logoff");
  emit("callnotice", "connection lost — call ended");
});
