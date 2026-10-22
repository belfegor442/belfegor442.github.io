/* ---------------- voice call dialog: render, buttons, drag ---------------- */
import { state, on, peerUser } from "../core/state.js";
import { $ } from "../shared/dom.js";
import * as Call from "../call.js";
import * as ui from "../ui.js";


function renderCallState(st) {
  const dlg = $("#callDialog");
  if (!dlg) return;
  if (st.phase === "idle") {
    if (dlg.open) dlg.close();
    return;
  }
  if (!dlg.open) dlg.show();
  const u = st.peer ? peerUser(st.peer) : null;
  const name = u ? (u.display_name || u.username) : (st.peer || "");
  const title = $("#callTitle");
  if (title) title.textContent = st.media === "video" ? "Windows Video Call" : "Windows Voice Call";
  const titleIco = $("#callTitleIco");
  if (titleIco) titleIco.src = st.media === "video" ? "./assets/xp/icons/TB Video.png" : "./assets/xp/icons/TB Call.png";
  const pn = $("#callPeerName");
  if (pn) pn.textContent = name;
  const ph = $("#callPeerHandle");
  if (ph) ph.textContent = u ? "@" + u.username : "";
  const av = $("#callAvatar");
  if (av) av.textContent = u && u.profile && u.profile.avatar ? u.profile.avatar : (name ? name.slice(0, 2).toUpperCase() : "?");
  const btns = {
    accept: $("#callAcceptBtn"),
    decline: $("#callDeclineBtn"),
    mute: $("#callMuteBtn"),
    camera: $("#callCameraBtn"),
    cancel: $("#callCancelBtn"),
    hangup: $("#callHangupBtn"),
  };
  for (const b of Object.values(btns)) if (b) b.classList.add("hidden");
  const status = $("#callStatus");
  const timer = $("#callTimer");
  const live = st.phase === "in-call" || st.phase === "connecting";
  const videoLive = live && st.media === "video";
  // video stage: show for video calls once media exists (not while ringing)
  const stage = $("#callVideoStage");
  if (stage) stage.classList.toggle("hidden", !videoLive);
  // avatar: hide while the video stage is visible
  if (av) av.classList.toggle("hidden", videoLive);
  if (st.phase === "preparing-in") {
    if (status) status.textContent = "Preparing camera/microphone…";
    if (btns.decline) btns.decline.classList.remove("hidden");
    if (timer) timer.classList.add("hidden");
  } else if (st.phase === "preparing-out") {
    if (status) status.textContent = "Requesting camera/microphone access…";
    if (btns.cancel) btns.cancel.classList.remove("hidden");
    if (timer) timer.classList.add("hidden");
  } else if (st.phase === "ringing-in") {
    if (status) status.textContent = st.media === "video" ? "Incoming video call…" : "Incoming call…";
    if (btns.accept) btns.accept.classList.remove("hidden");
    if (btns.decline) btns.decline.classList.remove("hidden");
    if (timer) timer.classList.add("hidden");
  } else if (st.phase === "ringing-out") {
    if (status) status.textContent = st.media === "video" ? "Ringing (video)…" : "Ringing…";
    if (btns.cancel) btns.cancel.classList.remove("hidden");
    if (timer) timer.classList.add("hidden");
  } else if (st.phase === "connecting") {
    if (status) status.textContent = st.media === "video" ? "Connecting video…" : "Connecting…";
    if (btns.mute) btns.mute.classList.remove("hidden");
    if (videoLive && btns.camera) btns.camera.classList.remove("hidden");
    if (btns.hangup) btns.hangup.classList.remove("hidden");
    if (timer) timer.classList.add("hidden");
  } else if (st.phase === "in-call") {
    const secs = Math.max(0, Math.floor((Date.now() - st.startedAt) / 1000));
    if (status) {
      const bits = [];
      bits.push(st.media === "video" ? "Video call" : "In call");
      if (st.muted) bits.push("muted");
      if (st.cameraOff) bits.push("camera off");
      status.textContent = bits.join(" — ");
    }
    if (timer) {
      timer.textContent = String(Math.floor(secs / 60)).padStart(2, "0") + ":" + String(secs % 60).padStart(2, "0");
      timer.classList.remove("hidden");
    }
    if (btns.mute) {
      btns.mute.textContent = st.muted ? "Unmute" : "Mute";
      btns.mute.classList.remove("hidden");
    }
    if (videoLive && btns.camera) {
      btns.camera.textContent = st.cameraOff ? "Camera On" : "Camera Off";
      btns.camera.classList.remove("hidden");
    }
    if (btns.hangup) btns.hangup.classList.remove("hidden");
  }
  // media elements: audio always (video calls also carry audio); video when live
  const audio = $("#callRemoteAudio");
  if (audio) {
    if (st.remoteStream && st.media !== "video" && audio.srcObject !== st.remoteStream) audio.srcObject = st.remoteStream;
    else if ((!st.remoteStream || st.media === "video") && audio.srcObject) audio.srcObject = null;
  }
  const rv = $("#callRemoteVideo");
  if (rv) {
    if (videoLive && st.remoteStream && rv.srcObject !== st.remoteStream) rv.srcObject = st.remoteStream;
    else if (!videoLive && rv.srcObject) rv.srcObject = null;
  }
  const lv = $("#callLocalVideo");
  if (lv) {
    if (videoLive && st.localStream && lv.srcObject !== st.localStream) lv.srcObject = st.localStream;
    else if (!videoLive && lv.srcObject) lv.srcObject = null;
  }
}

async function startCallUI(kind) {
  const peer = state.activePeer;
  if (!peer) {
    ui.toast("Open a conversation first", true);
    return;
  }
  const r = await Call.startCall(peer, kind);
  if (!r.ok) ui.msgBox({ title: "msg.mesh", text: "Call failed: " + r.error, icon: "error", cancelLabel: "" });
}
$("#chatCallBtn")?.addEventListener("click", () => startCallUI("audio"));
$("#chatVideoBtn")?.addEventListener("click", () => startCallUI("video"));
$("#callAcceptBtn")?.addEventListener("click", () => {
  Call.acceptCall().then((r) => {
    if (!r.ok && r.error) ui.msgBox({ title: "msg.mesh", text: "Call failed: " + r.error, icon: "error", cancelLabel: "" });
  });
});
$("#callDeclineBtn")?.addEventListener("click", () => Call.declineCall());
$("#callCancelBtn")?.addEventListener("click", () => Call.cancelCall());
$("#callHangupBtn")?.addEventListener("click", () => Call.endCall());
$("#callMuteBtn")?.addEventListener("click", () => Call.toggleMute());
$("#callCameraBtn")?.addEventListener("click", () => Call.toggleCamera());
$("#callClose")?.addEventListener("click", (e) => {
  e.preventDefault();
  Call.dismissCall();
});
$("#callDialog")?.addEventListener("cancel", (e) => {
  e.preventDefault(); // ESC routes to the phase-correct teardown
  Call.dismissCall();
});
// Non-modal dialogs do not receive the "cancel" event on ESC — handle it globally.
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !Call.isCallActive()) return;
  if (e.key === "Escape" && $("#callDialog")?.open) {
    e.preventDefault();
    Call.dismissCall();
  }
});

// Drag the floating call window by its titlebar (pointer events, works on touch).
(() => {
  const frame = document.querySelector("#callDialog .call-frame");
  const bar = frame && frame.querySelector(".win-titlebar");
  if (!frame || !bar) return;
  let dragging = false, ox = 0, oy = 0;
  bar.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button")) return; // don't drag from the close button
    dragging = true;
    const r = frame.getBoundingClientRect();
    ox = e.clientX - r.left;
    oy = e.clientY - r.top;
    frame.style.right = "auto";
    frame.style.bottom = "auto";
    bar.setPointerCapture(e.pointerId);
  });
  bar.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const x = Math.max(0, Math.min(window.innerWidth - frame.offsetWidth, e.clientX - ox));
    const y = Math.max(0, Math.min(window.innerHeight - 40, e.clientY - oy));
    frame.style.left = x + "px";
    frame.style.top = y + "px";
  });
  bar.addEventListener("pointerup", () => { dragging = false; });
  bar.addEventListener("pointercancel", () => { dragging = false; });
})();

on("callstate", renderCallState);
on("callinvite", () => renderCallState(Call.callState()));
on("callnotice", (msg) => ui.toast(msg));
