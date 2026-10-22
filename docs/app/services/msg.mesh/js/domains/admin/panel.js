/* ---------------- Admin Panel (roles ladder: owner > admin > moderator > member) ---------------- */
import { api, friendlyError } from "../../infrastructure/api/index.js";
import { state, hasChatPerm, loadRoles, myRank, roleRank } from "../../core/state.js";
import { $, esc } from "../../shared/dom.js";
import { toast } from "../../shared/toast.js";
import { msgBox } from "../../shared/msgbox.js";
import { playSound } from "../../infrastructure/sound.js";

const ROLE_LABEL = { owner: "Owner", admin: "Admin", moderator: "Moderator", member: "Member" };

// Ladder refusals come back as precise server copy ("the owner account is
// protected", "only the owner can grant admin …"); the generic 403 text in
// friendlyError() would hide them. Prefer payload.error for panel actions.
function adminError(e) {
  if (e && e.payload && typeof e.payload.error === "string" && e.payload.error) return e.payload.error;
  return friendlyError(e);
}

function adminTabVisible(tab) {
  if (tab === "users") return hasChatPerm("chat.users.roles") || hasChatPerm("chat.users.mute") || hasChatPerm("chat.users.ban");
  if (tab === "moderation") return hasChatPerm("chat.messages.delete_any") || hasChatPerm("chat.users.mute");
  if (tab === "audit") return hasChatPerm("chat.audit.read");
  return false;
}

function showAdminPane(tab) {
  document.querySelectorAll(".admin-tab").forEach((b) => b.classList.toggle("sel", b.dataset.adminTab === tab));
  $("#adminUsersPane")?.classList.toggle("hidden", tab !== "users");
  $("#adminModPane")?.classList.toggle("hidden", tab !== "moderation");
  $("#adminAuditPane")?.classList.toggle("hidden", tab !== "audit");
  refreshAdminPane(tab);
}

async function refreshAdminPane(tab) {
  const status = $("#adminStatus");
  if (status) status.textContent = "";
  try {
    if (tab === "users") {
      await loadRoles();
      renderAdminUsers();
    } else if (tab === "moderation") {
      renderAdminModLoading();
      const r = await api.chatModRecent(30);
      renderAdminMod(r && Array.isArray(r.items) ? r.items : []);
    } else if (tab === "audit") {
      renderAdminAuditLoading();
      const r = await api.chatAudit(50);
      renderAdminAudit(r && Array.isArray(r.items) ? r.items : []);
    }
  } catch (e) {
    if (status) status.textContent = adminError(e);
  }
}

function adminLadderSelect(u) {
  const me = myRank();
  const target = roleRank(u.app_role);
  const canGrant = hasChatPerm("chat.users.roles");
  // Ladder mirror: act strictly below your rank; owner is never offered.
  const allowed = ["member", "moderator"];
  if (me >= 3) allowed.push("admin");
  const locked = !canGrant || u.app_role === "owner" || target >= me ||
    !allowed.includes(u.app_role);
  const opts = ["owner", "admin", "moderator", "member"].map((r) =>
    `<option value="${r}"${r === u.app_role ? " selected" : ""}${(r === "owner" || (!allowed.includes(r) && r !== u.app_role)) ? " disabled" : ""}>${ROLE_LABEL[r]}</option>`
  ).join("");
  return `<select class="admin-role" data-user="${esc(u.user_id)}"${locked ? " disabled" : ""}>${opts}</select>`;
}

function renderAdminUsers() {
  const pane = $("#adminUsersPane");
  if (!pane) return;
  const users = [...state.roles.values()];
  const me = state.user ? String(state.user.user_id) : "";
  const hint = $("#adminRoleHint");
  if (hint) hint.textContent = "Your role: " + (ROLE_LABEL[state.myRole] || state.myRole);
  if (!users.length) {
    pane.innerHTML = '<div class="list-empty">No users.</div>';
    return;
  }
  pane.innerHTML = users.map((u) => {
    const id = String(u.user_id);
    const isSelf = id === me;
    const target = roleRank(u.app_role);
    const underMe = target < myRank() && u.app_role !== "owner" && !isSelf;
    const canMute = hasChatPerm("chat.users.mute") && underMe;
    const canBan = hasChatPerm("chat.users.ban") && underMe;
    // Password reset is owner-only (server enforces the same rule).
    const canResetPw = myRank() >= 3 && underMe;
    const flags = [
      u.muted ? `<span class="role-badge badge-muted" title="${esc(u.muted_until || "")}">muted</span>` : "",
      u.banned ? `<span class="role-badge badge-banned" title="${esc(u.banned_reason || "")}">banned</span>` : "",
      u.online ? '<span class="role-badge badge-online">online</span>' : "",
    ].join("");
    return `<div class="admin-user-row" data-user="${esc(id)}">
      <div class="admin-user-id">
        <strong>${esc(u.username)}</strong>
        <small class="hint">${esc(u.display_name || "")}</small>
        ${flags}
      </div>
      ${adminLadderSelect(u)}
      <span class="admin-user-acts">
        <button type="button" class="xp-btn gray admin-reset-pw" data-user="${esc(id)}" ${canResetPw ? "" : "disabled"}>Reset pw</button>
        <button type="button" class="xp-btn gray admin-mute" data-user="${esc(id)}" ${canMute ? "" : "disabled"}>${u.muted ? "Unmute" : "Mute"}</button>
        <button type="button" class="xp-btn gray admin-ban" data-user="${esc(id)}" ${canBan ? "" : "disabled"}>${u.banned ? "Unban" : "Ban"}</button>
      </span>
    </div>`;
  }).join("");
}

function renderAdminModLoading() {
  const pane = $("#adminModPane");
  if (pane) pane.innerHTML = '<div class="list-empty">Loading…</div>';
}

function renderAdminMod(items) {
  const pane = $("#adminModPane");
  if (!pane) return;
  if (!items.length) {
    pane.innerHTML = '<div class="list-empty">No recent messages.</div>';
    return;
  }
  const canDelete = hasChatPerm("chat.messages.delete_any");
  const canEdit = hasChatPerm("chat.messages.edit_any");
  pane.innerHTML = items.map((it) => {
    const senderUid = /^u(\d+)$/.exec(it.sender_node_id || "");
    const rec = senderUid ? state.roles.get(senderUid[1]) : null;
    const srank = roleRank(rec ? rec.app_role : "member");
    const underMe = srank < myRank() || senderUid && senderUid[1] === (state.user && state.user.user_id);
    const text = it.deleted
      ? '<em class="hint">Message deleted</em>'
      : esc(it.text || "(" + (it.message_type || "message") + ")");
    return `<div class="admin-msg-row" data-mid="${esc(it.message_id)}">
      <div class="admin-msg-meta"><strong>${esc((it.sender_node_id || "?"))}</strong><span class="hint">${esc(it.created_at || "")}</span></div>
      <div class="admin-msg-text">${text}</div>
      <span class="admin-user-acts">
        <button type="button" class="xp-btn gray admin-mod-edit" data-mid="${esc(it.message_id)}" ${canEdit && !it.deleted && underMe ? "" : "disabled"}>Edit</button>
        <button type="button" class="xp-btn gray admin-mod-del" data-mid="${esc(it.message_id)}" ${canDelete && !it.deleted && underMe ? "" : "disabled"}>Delete</button>
      </span>
    </div>`;
  }).join("");
}

function renderAdminAuditLoading() {
  const pane = $("#adminAuditPane");
  if (pane) pane.innerHTML = '<div class="list-empty">Loading…</div>';
}

function renderAdminAudit(items) {
  const pane = $("#adminAuditPane");
  if (!pane) return;
  if (!items.length) {
    pane.innerHTML = '<div class="list-empty">The audit log is empty.</div>';
    return;
  }
  pane.innerHTML = items.map((it) =>
    `<div class="admin-audit-row">
      <div class="admin-msg-meta"><strong>${esc(it.action)}</strong><span class="hint">${esc(it.created_at || "")}</span></div>
      <div class="hint">${esc(it.actor || "")} — ${esc(it.detail || "")}</div>
    </div>`
  ).join("");
}

async function openAdminPanel() {
  if (!adminTabVisible("users") && !adminTabVisible("moderation") && !adminTabVisible("audit")) {
    toast("Admin Panel requires moderator or higher.", true);
    return;
  }
  const d = $("#adminPanelDialog");
  if (!d) return;
  await loadRoles();
  const first = ["users", "moderation", "audit"].find((t) => adminTabVisible(t)) || "users";
  document.querySelectorAll(".admin-tab").forEach((b) => {
    b.classList.toggle("hidden", !adminTabVisible(b.dataset.adminTab));
  });
  if (!d.open) d.showModal();
  showAdminPane(first);
}

$("#adminPanelClose")?.addEventListener("click", () => $("#adminPanelDialog")?.close());
document.querySelectorAll(".admin-tab").forEach((b) =>
  b.addEventListener("click", () => showAdminPane(b.dataset.adminTab)));
$("#adminRefresh")?.addEventListener("click", () => {
  const sel = document.querySelector(".admin-tab.sel");
  refreshAdminPane(sel ? sel.dataset.adminTab : "users");
});

async function adminAct(run, reload = true) {
  const status = $("#adminStatus");
  if (status) status.textContent = "";
  try {
    await run();
    await loadRoles();
    if (reload) renderAdminUsers();
    toast("Done.");
  } catch (e) {
    if (status) status.textContent = adminError(e);
    toast(adminError(e), true);
  }
}

let muteTargetId = null;

function openMuteDialog(userId, rec) {
  muteTargetId = String(userId);
  const who = $("#muteWho");
  if (who) who.textContent = "Muting " + ((rec && rec.username) || "u" + userId);
  const mins = $("#muteMinutes");
  if (mins) mins.value = "60";
  const reason = $("#muteReason");
  if (reason) reason.value = "";
  const st = $("#muteStatus");
  if (st) st.textContent = "";
  const d = $("#muteDialog");
  if (d && !d.open) d.showModal();
}

$("#muteCancel")?.addEventListener("click", () => $("#muteDialog")?.close());
$("#muteClose")?.addEventListener("click", () => $("#muteDialog")?.close());
$("#muteForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!muteTargetId) return;
  const minutes = Math.floor(Number($("#muteMinutes").value));
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 525600) {
    const st = $("#muteStatus");
    if (st) st.textContent = "Minutes must be 1-525600.";
    return;
  }
  const btn = $("#muteSubmit");
  btn.disabled = true;
  try {
    await api.chatUserMute(muteTargetId, minutes, ($("#muteReason").value || "").trim());
    $("#muteDialog").close();
    await loadRoles();
    renderAdminUsers();
    toast("User muted");
  } catch (err) {
    const st = $("#muteStatus");
    if (st) st.textContent = adminError(err);
  } finally {
    btn.disabled = false;
  }
});

let adminResetPwId = null;

function openAdminResetPwDialog(userId, rec) {
  adminResetPwId = String(userId);
  const who = $("#adminResetPwWho");
  if (who) who.textContent = "Setting a new password for " + ((rec && rec.username) || "u" + userId) +
    " - their sessions will be signed out.";
  const pw = $("#adminResetPwNew");
  if (pw) pw.value = "";
  const st = $("#adminResetPwStatus");
  if (st) st.textContent = "";
  const d = $("#adminResetPwDialog");
  if (d && !d.open) d.showModal();
  pw?.focus();
}

$("#adminResetPwCancel")?.addEventListener("click", () => $("#adminResetPwDialog")?.close());
$("#adminResetPwClose")?.addEventListener("click", () => $("#adminResetPwDialog")?.close());
$("#adminResetPwForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!adminResetPwId) return;
  const rec = state.roles.get(adminResetPwId);
  const username = rec && rec.username;
  if (!username) return;
  const newP = $("#adminResetPwNew").value;
  const st = $("#adminResetPwStatus");
  if (st) st.textContent = "";
  if (newP.length < 8) {
    if (st) st.textContent = "Password must be 8-128 characters.";
    playSound("error");
    return;
  }
  const btn = $("#adminResetPwSubmit");
  if (btn) btn.disabled = true;
  try {
    await api.resetPassword(username, newP);
    $("#adminResetPwDialog").close();
    toast("Password reset for " + username);
  } catch (err) {
    if (st) st.textContent = adminError(err);
    playSound("error");
  } finally {
    if (btn) btn.disabled = false;
  }
});

$("#adminUsersPane")?.addEventListener("change", (e) => {
  const sel = e.target.closest(".admin-role");
  if (!sel) return;
  const id = sel.dataset.user;
  const role = sel.value;
  adminAct(async () => {
    await api.chatRoleSet(id, role);
  }).then(() => {
    // A changed grant may re-gate the panel itself (self-demotion etc.).
    const still = adminTabVisible("users");
    if (!still) $("#adminPanelDialog")?.close();
  });
});

$("#adminUsersPane")?.addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  const id = btn.dataset.user;
  if (!id) return;
  const rec = state.roles.get(id);
  if (btn.classList.contains("admin-reset-pw")) {
    openAdminResetPwDialog(id, rec);
    return;
  }
  if (btn.classList.contains("admin-mute")) {
    if (rec && rec.muted) {
      adminAct(() => api.chatUserUnmute(id));
      return;
    }
    openMuteDialog(id, rec);
    return;
  }
  if (btn.classList.contains("admin-ban")) {
    if (rec && rec.banned) {
      adminAct(() => api.chatUserUnban(id));
      return;
    }
    const answer = msgBox({ title: "msg.mesh", text: "Ban " + ((rec && rec.username) || "this user") + "? They will be signed out everywhere." });
    answer.then((a) => { if (a === "ok") adminAct(() => api.chatUserBan(id, "banned from Admin Panel")); });
  }
});

$("#adminModPane")?.addEventListener("click", async (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  const mid = btn.dataset.mid;
  if (!mid) return;
  const status = $("#adminStatus");
  if (btn.classList.contains("admin-mod-del")) {
    const answer = await msgBox({ title: "msg.mesh", text: "Delete this message for everyone?" });
    if (answer !== "ok") return;
    try {
      await api.chatModMessage(mid, "delete");
      await refreshAdminPane("moderation");
      toast("Message deleted");
    } catch (err) {
      if (status) status.textContent = adminError(err);
      toast(adminError(err), true);
    }
    return;
  }
  if (btn.classList.contains("admin-mod-edit")) {
    const row = btn.closest(".admin-msg-row");
    const textEl = row?.querySelector(".admin-msg-text");
    if (!textEl || row.querySelector(".admin-edit-input")) return;
    const input = document.createElement("input");
    input.type = "text";
    input.className = "admin-edit-input";
    input.maxLength = 4000;
    input.value = textEl.textContent || "";
    textEl.replaceWith(input);
    input.focus();
    const save = async () => {
      const text = input.value;
      if (!text.trim()) return;
      try {
        await api.chatModMessage(mid, "edit", text);
        await refreshAdminPane("moderation");
        toast("Message edited");
      } catch (err) {
        if (status) status.textContent = adminError(err);
        toast(adminError(err), true);
      }
    };
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") { ev.preventDefault(); save(); }
      if (ev.key === "Escape") refreshAdminPane("moderation");
    });
  }
});
export { openAdminPanel, adminTabVisible, renderAdminUsers };
