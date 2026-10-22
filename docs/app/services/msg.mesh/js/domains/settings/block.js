import { api, friendlyError } from "../../infrastructure/api/index.js";
import { state, isBlocked } from "../../core/state.js";
import { hooks } from "../../core/hooks.js";
import { $, esc } from "../../shared/dom.js";
import * as ui from "../../ui.js";

/* ---------------- block / unblock ---------------- */

// Server-side block: deletes the friendship and fences requests + messages
// both directions ("user is blocked" 403). Unblock is idempotent.
$("#blockContactBtn")?.addEventListener("click", async () => {
  const peer = state.activePeer;
  const m = /^u(\d+)$/.exec(peer || "");
  if (!m) return;
  const uidStr = m[1];
  const blocked = isBlocked(uidStr);
  if (!blocked) {
    const answer = await ui.msgBox({
      title: "msg.mesh",
      text: "Block this contact? They will no longer be able to message or contact you.",
    });
    if (answer !== "ok") return;
  }
  const btn = $("#blockContactBtn");
  btn.disabled = true;
  try {
    if (blocked) {
      await api.unblockUser(uidStr);
      state.blocked.delete(uidStr);
      ui.toast("Contact unblocked");
    } else {
      await api.blockUser(uidStr);
      state.blocked.set(uidStr, { user_id: uidStr });
      state.friends.delete(uidStr);
      hooks.emitFriends();
      ui.toast("Contact blocked");
    }
    renderBlockedList();
    ui.renderDetails();
    ui.renderSidebar();
  } catch (err) {
    ui.toast(friendlyError(err), true);
  } finally {
    btn.disabled = false;
  }
});

export async function renderBlockedList() {
  const box = $("#blockedList");
  if (!box) return;
  const ids = [...state.blocked.keys()];
  if (!ids.length) {
    box.innerHTML = '<div class="list-empty">Nobody is blocked.</div>';
    return;
  }
  box.innerHTML = ids.map((id) => {
    const u = state.users.get(String(id));
    const name = u ? (u.display_name || u.username) : "u" + id;
    return `<div class="user-item" data-unblock="${esc(id)}">
      <span class="dot"></span>
      <div><strong>${esc(name)}</strong><small>${esc(u ? "@" + u.username : "")}</small></div>
      <button type="button" class="xp-btn gray small" data-unblock-btn="${esc(id)}">Unblock</button>
    </div>`;
  }).join("");
}

$("#blockedList")?.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-unblock-btn]");
  if (!btn) return;
  const id = String(btn.dataset.unblockBtn);
  btn.disabled = true;
  try {
    await api.unblockUser(id);
    state.blocked.delete(id);
    ui.toast("Contact unblocked");
    await renderBlockedList();
    if (state.activePeer === "u" + id) ui.renderDetails();
  } catch (err) {
    ui.toast(friendlyError(err), true);
  } finally {
    btn.disabled = false;
  }
});
