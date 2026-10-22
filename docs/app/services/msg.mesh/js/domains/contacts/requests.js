import { api, friendlyError } from "../../infrastructure/api/index.js";
import { state, incomingRequests, upsertFriend, loadFriends, primeUsers } from "../../core/state.js";
import { hooks } from "../../core/hooks.js";
import { $ } from "../../shared/dom.js";
import * as ui from "../../ui.js";

/* ---------------- friend requests & contacts ---------------- */

$("#requestStrip").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-act]");
  if (!btn) return;
  const row = e.target.closest(".request-row");
  if (!row) return;
  const requestId = row.dataset.req;
  btn.disabled = true;
  try {
    if (btn.dataset.act === "accept") {
      const r = incomingRequests().find((x) => String(x.request_id) === requestId);
      await api.friendAccept(requestId);
      if (r) upsertFriend(r.sender_user_id);
      ui.toast("Contact added");
    } else {
      await api.friendReject(requestId);
      ui.toast("Request declined");
    }
    await loadFriends().catch(() => null);
    await primeUsers();
  } catch (err) {
    ui.toast(friendlyError(err), true);
    btn.disabled = false;
  }
});

$("#contactResults").addEventListener("click", (e) => {
  const item = e.target.closest("[data-peer]");
  if (!item) return;
  $("#newChatDialog").close();
  hooks.openChat(item.dataset.peer);
});

$("#addContactBtn").addEventListener("click", async () => {
  const peer = state.activePeer;
  const m = /^u(\d+)$/.exec(peer || "");
  if (!m) return;
  const btn = $("#addContactBtn");
  btn.disabled = true;
  try {
    const incoming = incomingFrom(m[1]);
    if (incoming) await api.friendAccept(incoming.request_id);
    else await api.friendRequest(m[1]);
    await loadFriends().catch(() => null);
    await primeUsers();
    ui.toast(outgoingTo(m[1]) || isFriend(m[1]) ? "Contact request sent" : "Contact added");
    ui.renderDetails();
  } catch (err) {
    ui.toast(friendlyError(err), true);
  } finally {
    btn.disabled = false;
  }
});

$("#removeContactBtn").addEventListener("click", async () => {
  const peer = state.activePeer;
  const m = /^u(\d+)$/.exec(peer || "");
  if (!m) return;
  const entry = state.friends.get(m[1]);
  if (!entry || !entry.friendship_id) { ui.toast("No friendship record", true); return; }
  const answer = await ui.msgBox({ title: "msg.mesh", text: "Remove this contact?" });
  if (answer !== "ok") return;
  const btn = $("#removeContactBtn");
  btn.disabled = true;
  try {
    await api.friendRemove(entry.friendship_id);
    state.friends.delete(m[1]);
    ui.renderDetails();
    ui.toast("Contact removed");
  } catch (err) {
    ui.toast(friendlyError(err), true);
  } finally {
    btn.disabled = false;
  }
});
