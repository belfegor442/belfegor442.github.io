/* ---------------- composer: input, char count, typing, drafts, pending file ---------------- */
import { state, isSelfMuted } from "../../core/state.js";
import { $, esc } from "../../shared/dom.js";
import { sendFrame as wsSendFrame } from "../../infrastructure/ws/index.js";
import { composerState } from "../../core/composer-state.js";

let pendingAttachment = null;

export function getPendingAttachment() {
  return pendingAttachment;
}

// main.js registers the real send handler (sendMessage lives there and
// would create an import cycle if imported from this module).
let sendHandler = null;
export function onComposerSend(fn) {
  sendHandler = fn;
}

export function setPendingAttachment(att) {
  pendingAttachment = att;
  const bar = $("#pendingFile");
  if (bar) {
    if (att) {
      bar.classList.remove("hidden");
      $("#pendingFileName").innerHTML = '<img src="./assets/xp/icons/Generic Document.png" alt="" width="14" height="14"> ' + esc(att.filename);
    } else {
      bar.classList.add("hidden");
      $("#pendingFileName").textContent = "";
    }
  }
  syncSendEnabled();
}

/* ---------------- drafts ---------------- */

const DRAFTS_PREFIX = "msg.mesh.drafts.";
let draftTimer = null;

function draftsKey() {
  const id = state.user && state.user.user_id;
  return id ? DRAFTS_PREFIX + id : "";
}

function readDrafts() {
  const key = draftsKey();
  if (!key) return {};
  try {
    const d = JSON.parse(localStorage.getItem(key) || "{}");
    return d && typeof d === "object" ? d : {};
  } catch { return {}; }
}

function saveDraft(peer, text) {
  const key = draftsKey();
  if (!key || !peer) return;
  try {
    const d = readDrafts();
    if (text) d[peer] = text;
    else delete d[peer];
    if (Object.keys(d).length) localStorage.setItem(key, JSON.stringify(d));
    else localStorage.removeItem(key);
  } catch { /* private mode */ }
}

function scheduleDraftSave() {
  const peer = state.activePeer;
  if (!peer) return;
  // While editing, the composer holds someone else's message, not a draft.
  if (composerState.editingMsg) return;
  if (draftTimer) clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    draftTimer = null;
    if (state.activePeer === peer) saveDraft(peer, msgInput ? msgInput.value : "");
  }, 300);
}

function flushDraft() {
  if (draftTimer) {
    clearTimeout(draftTimer);
    draftTimer = null;
  }
  if (composerState.editingMsg) return;
  if (state.activePeer) saveDraft(state.activePeer, msgInput ? msgInput.value : "");
}

function restoreDraft(peer) {
  if (!msgInput) return;
  const d = readDrafts();
  msgInput.value = (peer && typeof d[peer] === "string") ? d[peer] : "";
  msgInput.rows = Math.max(1, Math.min(msgInput.value.split("\n").length, 5));
  updateCharCount();
  syncSendEnabled();
}

function clearDraft(peer) {
  saveDraft(peer, "");
}

function clearDrafts() {
  const key = draftsKey();
  if (key) {
    try { localStorage.removeItem(key); } catch { /* private mode */ }
  }
}

// Composer: Enter sends, Shift+Enter newline; auto-grow via rows (CSP-safe).
export const msgInput = $("#messageInput");
msgInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendHandler?.();
  }
});
msgInput?.addEventListener("input", () => {
  const lines = Math.min(msgInput.value.split("\n").length, 5);
  msgInput.rows = Math.max(1, lines);
  updateCharCount();
  syncSendEnabled();
  scheduleDraftSave();
  maybeSendTyping();
});

// Fire-and-forget "I'm typing" toward the open chat (1:1 or group). Throttled
// so a fast typist doesn't flood the socket; the server re-fans group frames.
let lastTypingSentAt = 0;
function maybeSendTyping() {
  const peer = state.activePeer;
  if (!peer || !msgInput || !msgInput.value.trim()) return;
  // Muted accounts emit no typing indicators (the server drops these frames;
  // not sending them at all keeps the fence invisible in the network log).
  if (isSelfMuted()) return;
  const now = Date.now();
  if (now - lastTypingSentAt < 1500) return;
  lastTypingSentAt = now;
  wsSendFrame({ type: "typing", to: peer });
}
function syncSendEnabled() {
  const send = $("#sendBtn");
  updateCharCount();
  if (!send) return;
  const hasText = !!(msgInput && msgInput.value.trim());
  const muted = isSelfMuted();
  send.disabled = !(hasText || pendingAttachment) || muted;
  send.title = muted ? "You are muted by a moderator" : "";
}
// Character budget: quiet until the last 500, amber then red near the cap
// (the textarea's maxlength=4000 is the hard stop).
function updateCharCount() {
  const el = $("#charCount");
  if (!el || !msgInput) return;
  const len = msgInput.value.length;
  const show = len >= 3500;
  el.classList.toggle("hidden", !show);
  if (!show) return;
  el.textContent = len + "/4000";
  el.classList.toggle("warn", len < 3900);
  el.classList.toggle("danger", len >= 3900);
}


export {
  syncSendEnabled, updateCharCount, maybeSendTyping, scheduleDraftSave,
  flushDraft, restoreDraft, clearDraft, clearDrafts
};
