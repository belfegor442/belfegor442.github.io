export {
  cancelReply, cancelEdit, saveEdit, toggleReaction, togglePin, deleteMessageFlow
};

/* ---------------- message control: reply / edit / react / pin / delete ---------------- */
import { api, getToken, friendlyError } from "../../infrastructure/api/index.js";
import { state, roleRank, hasChatPerm, myRank, peerLabel, ingestOne, findMessage } from "../../core/state.js";
import { $ } from "../../shared/dom.js";
import { composerState } from "../../core/composer-state.js";
import { msgInput, updateCharCount, syncSendEnabled, restoreDraft } from "./composer.js";
import * as ui from "../../ui.js";

let ctxLine = null;
let ctxMsg = null;

const ctxMenu = $("#ctxMenu");
let ctxText = "";
function hideCtxMenu() {
  ctxMenu?.classList.add("hidden");
  document.getElementById("ctxReactGrid")?.classList.add("hidden");
}
function messagePlainText(line) {
  const body = line?.querySelector(".body");
  if (!body) return "";
  const clone = body.cloneNode(true);
  // native emoticons render as <img alt=":eNNN:"> — keep the token on copy
  clone.querySelectorAll("img.emote").forEach((img) => {
    img.replaceWith(document.createTextNode(img.getAttribute("alt") || ""));
  });
  return (clone.textContent || "").trim();
}

function updateCtxMenu(m) {
  const mine = !!(m && m.mine);
  const gone = !!(m && m.deleted);
  // Moderators+ act on messages strictly below their rank (server ladder);
  // own messages are always editable/deletable by the author.
  const canEdit = !gone && (mine || canModerateMessage(m, "chat.messages.edit_any"));
  const canDelete = !gone && (mine || canModerateMessage(m, "chat.messages.delete_any"));
  const show = (id, on) => document.getElementById(id)?.classList.toggle("hidden", !on);
  show("ctxReply", !!m && !gone);
  show("ctxEdit", canEdit);
  show("ctxReact", !!m && !gone);
  show("ctxPin", !!m && !gone);
  const pin = document.getElementById("ctxPin");
  if (pin && m) pin.textContent = m.pinned ? "Unpin" : "Pin";
  show("ctxDelete", canDelete);
  show("ctxCopy", !!ctxText);
  document.getElementById("ctxReactGrid")?.classList.add("hidden");
}

// Rank of a message's author from the role roster (member when unknown).
function senderRank(m) {
  const mm = m && m.sender ? /^u(\d+)$/.exec(String(m.sender)) : null;
  const rec = mm ? state.roles.get(mm[1]) : null;
  return roleRank(rec ? rec.app_role : "member");
}

// Ladder mirror of the server: act strictly below your own rank; the owner
// (rank 3) is immutable. `perm` is the capability the server will check.
function canModerateMessage(m, perm) {
  if (!m || m.deleted || m.mine) return false;
  if (!hasChatPerm(perm)) return false;
  return senderRank(m) < myRank();
}

function startReply(m) {
  if (!m || m.deleted) return;
  if (composerState.editingMsg) cancelEdit();
  composerState.replyTarget = m;
  const who = m.mine ? "You" : peerLabel(state.activePeer).slice(0, 16);
  const shown = String(m.text || (m.attachment ? m.attachment.filename : "") || "(" + (m.type || "message") + ")");
  const whoEl = $("#replyBarWho");
  if (whoEl) whoEl.textContent = who;
  const txtEl = $("#replyBarText");
  if (txtEl) txtEl.textContent = shown.slice(0, 140);
  $("#replyBar")?.classList.remove("hidden");
  msgInput?.focus();
}
function cancelReply() {
  composerState.replyTarget = null;
  $("#replyBar")?.classList.add("hidden");
}

function startEdit(m) {
  if (!m || m.deleted || !msgInput) return;
  if (!m.mine && !canModerateMessage(m, "chat.messages.edit_any")) return;
  cancelReply();
  composerState.editingMsg = m;
  msgInput.value = m.text || "";
  msgInput.rows = Math.min(5, Math.max(1, msgInput.value.split("\n").length));
  $("#editBar")?.classList.remove("hidden");
  msgInput.focus();
  try { msgInput.setSelectionRange(msgInput.value.length, msgInput.value.length); } catch { /* ignore */ }
  updateCharCount();
  syncSendEnabled();
}
function cancelEdit() {
  if (!composerState.editingMsg) return;
  composerState.editingMsg = null;
  $("#editBar")?.classList.add("hidden");
  if (msgInput) msgInput.value = "";
  // The pre-edit draft was preserved by the scheduleDraftSave guard; put it back.
  restoreDraft(state.activePeer);
}

async function saveEdit(target, newText) {
  const peer = state.activePeer;
  const sessionToken = getToken();
  const sessionUserId = state.user && state.user.user_id;
  try {
    const r = await api.editMessage(target.id, newText);
    if (getToken() !== sessionToken || !state.user || state.user.user_id !== sessionUserId) return;
    if (r && r.item) ingestOne(r.item);
    else {
      const m = findMessage(peer, target.id);
      if (m) m.text = newText;
    }
    cancelEdit();
    ui.renderMessages({ scroll: false });
    ui.renderSidebar();
    ui.toast("Message edited");
  } catch (e) {
    if (getToken() !== sessionToken || !state.user || state.user.user_id !== sessionUserId) return;
    if (Number(e && e.status) === 409) {
      ui.toast("That message was deleted.", true);
      cancelEdit();
      ui.renderMessages({ scroll: false });
      ui.renderSidebar();
    } else {
      // Keep edit mode so the user can retry or cancel.
      ui.toast("Edit failed: " + friendlyError(e), true);
    }
  }
}

async function toggleReaction(m, emoji) {
  if (!m || m.rowid == null || m.deleted || !emoji) return;
  const self = String(state.selfNode);
  const ids = m.reactions && Array.isArray(m.reactions[emoji]) ? m.reactions[emoji] : [];
  const on = !ids.includes(self);
  const sessionToken = getToken();
  const sessionUserId = state.user && state.user.user_id;
  try {
    const r = await api.reactMessage(m.id, emoji, on);
    if (getToken() !== sessionToken || !state.user || state.user.user_id !== sessionUserId) return;
    if (r && r.item) {
      ingestOne(r.item);
      ui.renderMessages({ scroll: false });
      ui.renderSidebar();
    }
  } catch (e) {
    if (getToken() !== sessionToken || !state.user || state.user.user_id !== sessionUserId) return;
    ui.toast("Reaction failed: " + friendlyError(e), true);
  }
}

async function togglePin(m) {
  if (!m || m.rowid == null || m.deleted) return;
  const pinned = !m.pinned;
  const sessionToken = getToken();
  const sessionUserId = state.user && state.user.user_id;
  try {
    const r = await api.pinMessage(m.id, pinned);
    if (getToken() !== sessionToken || !state.user || state.user.user_id !== sessionUserId) return;
    if (r && r.item) {
      ingestOne(r.item);
      ui.renderMessages({ scroll: false });
      ui.renderSidebar();
    }
  } catch (e) {
    if (getToken() !== sessionToken || !state.user || state.user.user_id !== sessionUserId) return;
    ui.toast("Pin failed: " + friendlyError(e), true);
  }
}

async function deleteMessageFlow(m) {
  if (!m || m.rowid == null || m.deleted) return;
  if (!m.mine && !canModerateMessage(m, "chat.messages.delete_any")) return;
  const answer = await ui.msgBox({ title: "msg.mesh", text: m.mine ? "Delete this message for everyone?" : "Delete this message as a moderator?" });
  if (answer !== "ok") return;
  const sessionToken = getToken();
  const sessionUserId = state.user && state.user.user_id;
  (async () => {
    try {
      const r = await api.deleteMessage(m.id);
      if (getToken() !== sessionToken || !state.user || state.user.user_id !== sessionUserId) return;
      if (r && r.item) {
        ingestOne(r.item);
        ui.renderMessages({ scroll: false });
        ui.renderSidebar();
      }
    } catch (e) {
      if (getToken() !== sessionToken || !state.user || state.user.user_id !== sessionUserId) return;
      ui.toast("Delete failed: " + friendlyError(e), true);
    }
  })();
}

$("#replyBarCancel")?.addEventListener("click", () => cancelReply());
$("#editBarCancel")?.addEventListener("click", () => cancelEdit());

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (composerState.editingMsg) cancelEdit();
  else if (composerState.replyTarget) cancelReply();
});

$("#messageList")?.addEventListener("contextmenu", (e) => {
  const line = e.target.closest(".msg-line");
  if (!line) return;
  e.preventDefault();
  const c = state.conversations.get(state.activePeer);
  const m = c ? c.messages.find((x) => x.id === line.dataset.id) : null;
  let text = messagePlainText(line);
  if (!text) {
    const chip = line.querySelector("[data-attname]");
    text = (chip && chip.getAttribute("data-attname")) || "";
  }
  if (!m && !text) return;
  // A tombstone has no copyable text and no actions — no menu at all.
  if (m && m.deleted) return;
  if (!ctxMenu) return;
  ctxText = text;
  ctxLine = line;
  ctxMsg = m;
  updateCtxMenu(m);
  ctxMenu.classList.remove("hidden");
  const mw = ctxMenu.offsetWidth;
  const mh = ctxMenu.offsetHeight;
  ctxMenu.style.left = Math.max(2, Math.min(e.clientX, window.innerWidth - mw - 4)) + "px";
  ctxMenu.style.top = Math.max(2, Math.min(e.clientY, window.innerHeight - mh - 4)) + "px";
});
ctxMenu?.addEventListener("click", async (e) => {
  e.stopPropagation();
  const btn = e.target.closest("button");
  if (!btn) return;
  // The reaction grid lives inside the menu: picking one applies and closes.
  if (btn.closest("#ctxReactGrid")) {
    const emoji = btn.getAttribute("data-emoji");
    const m = ctxMsg;
    hideCtxMenu();
    if (m && emoji) toggleReaction(m, emoji);
    return;
  }
  if (btn.id === "ctxReact") {
    document.getElementById("ctxReactGrid")?.classList.toggle("hidden");
    return;
  }
  const m = ctxMsg;
  hideCtxMenu();
  if (btn.id === "ctxReply") { if (m) startReply(m); return; }
  if (btn.id === "ctxEdit") { if (m) startEdit(m); return; }
  if (btn.id === "ctxPin") { if (m) togglePin(m); return; }
  if (btn.id === "ctxDelete") { if (m) deleteMessageFlow(m); return; }
  if (btn.id === "ctxCopy") {
    try {
      await navigator.clipboard.writeText(ctxText);
      ui.toast("Message copied");
    } catch {
      // fallback for contexts without the async clipboard API
      const ta = document.createElement("textarea");
      ta.value = ctxText;
      ta.className = "ctx-ghost";
      ta.setAttribute("readonly", "");
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        ui.toast("Message copied");
      } catch {
        ui.toast("Copy failed", true);
      }
      ta.remove();
    }
  }
});
document.addEventListener("click", hideCtxMenu);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" || ["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"].includes(e.key)) {
    hideCtxMenu();
  }
});
// Dismiss on real user scroll intent only. A bare scroll listener also fires
// for the app's own adjustments (history pagination, autoscroll to a new
// message, focus scrollIntoView) and would blink the menu shut the instant it
// opened — right-click was racing those internal scrolls. Wheel/touch cover
// gesture scrolling, and pointerdown-outside also catches scrollbar drags
// (a scroll with no gesture before it is programmatic: leave the menu alone).
document.addEventListener("wheel", hideCtxMenu, { passive: true, capture: true });
document.addEventListener("touchmove", hideCtxMenu, { passive: true, capture: true });
document.addEventListener("pointerdown", (e) => {
  if (ctxMenu && !e.target.closest("#ctxMenu")) hideCtxMenu();
}, true);
