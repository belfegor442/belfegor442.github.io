import { api, ApiError, friendlyError } from "../../infrastructure/api/index.js";
import { state, refreshConversations, primeUsers } from "../../core/state.js";
import { hooks } from "../../core/hooks.js";
import { $, esc } from "../../shared/dom.js";
import * as ui from "../../ui.js";

/* ---------------- new group ---------------- */

function renderNewGroupMembers(selected) {
  const box = $("#newGroupMembers");
  if (!box) return;
  const ids = [...state.friends.keys()];
  if (!ids.length) {
    box.innerHTML = '<div class="list-empty">Add contacts first — groups are made of your contacts.</div>';
    return;
  }
  const picked = new Set((selected || []).map(String));
  box.innerHTML = ids.map((id) => {
    const u = state.users.get(String(id));
    const name = u ? (u.display_name || u.username) : "u" + id;
    return `<label class="chk-row"><input type="checkbox" value="${esc(id)}"${picked.has(id) ? " checked" : ""}><span class="chk-x">x</span> ${esc(name)}</label>`;
  }).join("");
}

export function openNewGroup() {
  const status = $("#newGroupStatus");
  if (status) status.textContent = "";
  const input = $("#newGroupInput");
  if (input) input.value = "";
  renderNewGroupMembers([]);
  const d = $("#newGroupDialog");
  if (d && !d.open) d.showModal();
  input?.focus();
}

$("#newGroupForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = $("#newGroupInput");
  const name = (input?.value || "").trim();
  const members = [...document.querySelectorAll("#newGroupMembers input:checked")].map((i) => i.value);
  const status = $("#newGroupStatus");
  if (!name) return;
  if (!members.length) {
    if (status) status.textContent = "Select at least one contact.";
    return;
  }
  const btn = $("#newGroupCreate");
  btn.disabled = true;
  try {
    const r = await api.groupCreate(name, members);
    const g = r && r.group;
    if (!g || !g.id) throw new ApiError(502, { error: "server did not confirm the group" });
    state.groups.set(String(g.id), g);
    $("#newGroupDialog").close();
    ui.toast("Group created");
    refreshConversations(true).catch(() => null);
    primeUsers().catch(() => null);
    hooks.openChat(String(g.id));
  } catch (err) {
    if (status) status.textContent = friendlyError(err);
  } finally {
    btn.disabled = false;
  }
});
