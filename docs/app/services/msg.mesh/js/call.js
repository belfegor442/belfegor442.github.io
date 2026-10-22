/* Voice/video calls: WebRTC audio (+ video when requested), P2P. The server
   only relays signaling frames (invite/accept/decline/end + SDP/ICE) over the
   authenticated WebSocket — media itself never touches the server, matching
   the native mesh model (CALL <peer> — LAN voice, PacketType::PeerVoiceFrame
   reserved P2P). The invite carries media:"audio"|"video" so the callee knows
   whether to open the camera before Accept. One active call at a time. */
import { state, on, emit, isFriend } from "./store.js";
import { sendFrame } from "./ws.js";
import { api } from "./api.js";
import { startRing, stopRing, playSound } from "./infrastructure/sound.js";

// Fallback until /calls/ice answers: public STUN only. The server config
// (STUN + TURN with credentials) replaces this list per session.
const STUN_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];
let iceServersCache = null;
let iceRefresh = null;
function refreshIce() {
  if (iceRefresh) return iceRefresh;
  iceRefresh = api.callsIce().then((r) => {
    if (r && Array.isArray(r.iceServers) && r.iceServers.length) {
      iceServersCache = r.iceServers;
    }
  }).catch(() => { /* offline: keep STUN fallback */ }).finally(() => { iceRefresh = null; });
  return iceRefresh;
}
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
let connectionGraceTimer = null;
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
  if (connectionGraceTimer) {
    clearTimeout(connectionGraceTimer);
    connectionGraceTimer = null;
  }
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
  const activeCallId = callId;
  const activePeer = peer;
  const p = new RTCPeerConnection({ iceServers: iceServersCache || STUN_SERVERS });
  refreshIce(); // warm the server-provided (STUN+TURN) list for the next call
  p.onicecandidate = (ev) => {
    if (pc !== p || callId !== activeCallId || peer !== activePeer) return;
    sendSignal({
      action: "candidate",
      call_id: activeCallId,
      to: activePeer,
      candidate: ev.candidate ? ev.candidate.toJSON() : null,
    });
  };
  p.ontrack = (ev) => {
    if (pc !== p || callId !== activeCallId || peer !== activePeer) return;
    remoteStream = ev.streams && ev.streams[0] ? ev.streams[0] : new MediaStream([ev.track]);
    emit("callstate", callState());
  };
  p.onconnectionstatechange = () => {
    // Closing a previous RTCPeerConnection is asynchronous. Ignore its late
    // events so they cannot end or mutate a newer call.
    if (pc !== p || callId !== activeCallId || peer !== activePeer) return;
    if (p.connectionState === "connected") {
      if (connectionGraceTimer) {
        clearTimeout(connectionGraceTimer);
        connectionGraceTimer = null;
      }
      if (phase === "connecting" || phase === "in-call") {
        if (phase === "connecting") {
          startedAt = Date.now();
          stopRing();
          clearRingTimer();
          setPhase("in-call");
          playSound("call");
          stopTick();
          tickTimer = setInterval(() => emit("callstate", callState()), 1000);
        }
      }
    } else if (p.connectionState === "disconnected") {
      // Browsers can report a short disconnect during network handover.
      // Allow ICE a few seconds to recover before terminating the call.
      if (!connectionGraceTimer) {
        connectionGraceTimer = setTimeout(() => {
          connectionGraceTimer = null;
          if (pc === p && callId === activeCallId && p.connectionState === "disconnected") {
            endCall("connection lost");
          }
        }, 8000);
      }
    } else if (p.connectionState === "failed") {
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
  const targetMatch = /^u(\d+)$/.exec(String(target || ""));
  if (!targetMatch || target === state.selfNode) return { ok: false, error: "invalid call target" };
  if (!isFriend(targetMatch[1])) return { ok: false, error: "calls are only allowed with friends" };
  if (state.connection !== "online") return { ok: false, error: "not connected to the server" };
  if (typeof RTCPeerConnection === "undefined") return { ok: false, error: "WebRTC is unavailable in this browser" };
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return { ok: false, error: "camera/microphone unavailable in this browser" };
  }
  refreshIce(); // warm STUN/TURN list while the permission prompt is open
  media = kind === "video" ? "video" : "audio";
  // Reserve the call slot before opening the browser permission prompt. Without
  // this, rapid clicks can acquire multiple streams and create parallel calls.
  setPhase("preparing-out");
  try {
    await getMedia(media);
  } catch {
    if (phase === "preparing-out") reset();
    return { ok: false, error: media === "video" ? "camera/microphone access denied" : "microphone access denied" };
  }
  if (phase !== "preparing-out") {
    cleanupMedia();
    return { ok: false, error: "call setup was cancelled" };
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
  if (typeof RTCPeerConnection === "undefined" ||
      !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    sendSignal({ action: "decline", call_id: callId, to: peer });
    reset();
    emit("callnotice", "voice/video calls are unavailable in this browser");
    return { ok: false, error: "WebRTC unavailable" };
  }
  const acceptedCallId = callId;
  const acceptedPeer = peer;
  const acceptedMedia = media;
  setPhase("preparing-in");
  try {
    await getMedia(acceptedMedia);
  } catch {
    if (callId === acceptedCallId && peer === acceptedPeer) {
      sendSignal({ action: "decline", call_id: acceptedCallId, to: acceptedPeer });
      reset();
      emit("callnotice", "camera/microphone access denied");
    }
    return { ok: false, error: "camera/microphone access denied" };
  }
  // The caller may cancel or the call may be reset while permission is pending.
  // Never attach a late media stream to a different call.
  if (phase !== "preparing-in" || callId !== acceptedCallId || peer !== acceptedPeer) {
    cleanupMedia();
    return { ok: false, error: "call setup was cancelled" };
  }
  stopRing();
  clearRingTimer();
  try {
    // Cold start (invite beat the background refresh): one quick fetch so
    // this call already rides TURN when the server configured it.
    if (!iceServersCache) await refreshIce();
    pc = makePc();
    for (const t of localStream.getTracks()) pc.addTrack(t, localStream);
  } catch {
    sendSignal({ action: "decline", call_id: acceptedCallId, to: acceptedPeer });
    reset();
    emit("callnotice", "could not start the audio stream");
    return { ok: false, error: "could not start the audio stream" };
  }
  sendSignal({ action: "accept", call_id: acceptedCallId, to: acceptedPeer });
  setPhase("connecting");
  return { ok: true };
}

export function declineCall() {
  if ((phase !== "ringing-in" && phase !== "preparing-in") || !callId) return;
  sendSignal({ action: "decline", call_id: callId, to: peer });
  reset();
  emit("callstate", callState());
}

export function cancelCall() {
  if (phase !== "ringing-out" && phase !== "preparing-out") return;
  if (callId && peer) sendSignal({ action: "end", call_id: callId, to: peer });
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
  // The server stamps both routing fields. Ignore frames not addressed to this
  // session before they can trigger a decline, UI notification, or call state.
  if (!state.selfNode || d.to !== state.selfNode || typeof d.from !== "string") return;
  const action = d.action;
  if (action === "invite") {
    if (phase !== "idle" || !d.call_id || !d.from) {
      // Busy or malformed invite: polite automatic decline.
      if (d.call_id && d.from) sendSignal({ action: "decline", call_id: d.call_id, to: d.from });
      return;
    }
    // Security: only accept invites from users on the friends list.
    // d.from is "u<id>"; decline silently otherwise (anti-harassment).
    const inviterId = /^u(\d+)$/.exec(String(d.from));
    if (!inviterId || !isFriend(inviterId[1])) {
      if (d.call_id && d.from) sendSignal({ action: "decline", call_id: d.call_id, to: d.from });
      return;
    }
    if (typeof RTCPeerConnection === "undefined" ||
        !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      sendSignal({ action: "decline", call_id: d.call_id, to: d.from });
      emit("callnotice", "voice/video calls are unavailable in this browser");
      return;
    }
    peer = d.from;
    callId = d.call_id;
    role = "callee";
    media = d.media === "video" ? "video" : "audio";
    muted = false;
    cameraOff = false;
    setPhase("ringing-in");
    refreshIce(); // warm STUN/TURN while the user decides to Accept
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
  // Every other action must come from the peer in the current call. This
  // prevents unrelated/stale signaling frames from changing or tearing it down.
  if (!callId || d.call_id !== callId || d.from !== peer) return;
  if (action === "accept" && phase === "ringing-out") {
    stopRing();
    clearRingTimer();
    setPhase("connecting");
    if (!pc) {
      try {
        pc = makePc();
        if (localStream) for (const t of localStream.getTracks()) pc.addTrack(t, localStream);
      } catch {
        endCall("could not start the audio stream");
        return;
      }
    }
    const activePc = pc;
    const activeCallId = callId;
    const activePeer = peer;
    activePc.createOffer()
      .then((offer) => {
        if (pc !== activePc || callId !== activeCallId || peer !== activePeer) {
          throw new Error("call changed during offer creation");
        }
        return activePc.setLocalDescription(offer);
      })
      .then(() => {
        if (pc !== activePc || callId !== activeCallId || peer !== activePeer) return;
        sendSignal({ action: "offer", call_id: activeCallId, to: activePeer, sdp: activePc.localDescription.sdp });
      })
      .catch(() => {
        if (pc === activePc && callId === activeCallId) endCall("could not start the audio stream");
      });
    return;
  }
  if (action === "offer" && phase === "connecting" && pc && d.sdp) {
    const activePc = pc;
    const activeCallId = callId;
    const activePeer = peer;
    activePc.setRemoteDescription({ type: "offer", sdp: d.sdp })
      .then(() => activePc.createAnswer())
      .then((answer) => activePc.setLocalDescription(answer))
      .then(() => {
        if (pc !== activePc || callId !== activeCallId || peer !== activePeer) return;
        sendSignal({ action: "answer", call_id: activeCallId, to: activePeer, sdp: activePc.localDescription.sdp });
        flushCandidates();
      })
      .catch(() => {
        if (pc === activePc && callId === activeCallId) endCall("could not negotiate the audio stream");
      });
    return;
  }
  if (action === "answer" && pc && d.sdp) {
    const activePc = pc;
    const activeCallId = callId;
    activePc.setRemoteDescription({ type: "answer", sdp: d.sdp })
      .then(() => {
        if (pc === activePc && callId === activeCallId) flushCandidates();
      })
      .catch(() => {
        if (pc === activePc && callId === activeCallId) endCall("could not negotiate the audio stream");
      });
    return;
  }
  if (action === "candidate") {
    if (!pc) return;
    if (pc.remoteDescription) {
      pc.addIceCandidate(d.candidate || null).catch(() => { /* late/duplicate candidate or end marker */ });
    } else if (pendingCandidates.length < 50) {
      // Preserve the end-of-candidates marker too; it can arrive before the
      // offer/answer establishes remoteDescription on slower connections.
      pendingCandidates.push(d.candidate || null);
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
on("servererror", (d) => {
  if (!d || !callId || d.call_id !== callId || phase === "idle") return;
  const message = String(d.error || "call failed").slice(0, 160);
  reset();
  emit("callnotice", message);
});
// Socket died mid-call: the relay is gone and so is the peer's signaling.
on("connection", (mode) => {
  if (mode === "online" || phase === "idle") return;
  const wasConnected = phase === "in-call" || phase === "connecting";
  reset();
  if (wasConnected) playSound("logoff");
  emit("callnotice", "connection lost — call ended");
});
