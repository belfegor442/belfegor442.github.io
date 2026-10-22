import { state, conversationOrder, peerLabel, peerOnline, isTyping, incomingRequests, outgoingRequests } from "../../core/state.js";
import { $, esc, fmtTime } from "../../shared/dom.js";
import { emotes, emoteTokens } from "../../shared/emotes.js";

// Role badge next to a name (owner > admin > moderator; members stay bare).
// state.roles comes from /chat/roles/list — empty until the roster loads.
export function roleBadge(userId) {
  const rec = state.roles.get(String(userId));
  if (!rec) return "";
  const role = String(rec.app_role || "").toLowerCase();
  if (role === "member" || !role) return "";
  const label = role === "owner" ? "owner" : role === "admin" ? "admin" : "mod";
  return `<span class="role-badge badge-${esc(role)}" title="${esc(role)}">${label}</span>`;
}

export function renderRequests() {
  const strip = $("#requestStrip");
  if (!strip) return;
  const incoming = incomingRequests();
  const outgoing = outgoingRequests();
  if (!incoming.length && !outgoing.length) {
    strip.classList.add("hidden");
    strip.innerHTML = "";
    return;
  }
  strip.classList.remove("hidden");
  const rows = [];
  for (const r of incoming) {
    const u = state.users.get(String(r.sender_user_id));
    const name = u ? (u.display_name || u.username) : "u" + r.sender_user_id;
    rows.push(`<div class="request-row" data-req="${esc(r.request_id)}" data-kind="in">
      <img class="req-ico" src="./assets/xp/icons/Important.png" alt="" width="16" height="16">
      <div class="request-main"><strong>${esc(name)}</strong><small>wants to connect</small></div>
      <button type="button" class="req-btn accept" data-act="accept" title="Accept">✓</button>
      <button type="button" class="req-btn decline" data-act="decline" title="Decline">✕</button>
    </div>`);
  }
  for (const r of outgoing) {
    const u = state.users.get(String(r.receiver_user_id));
    const name = u ? (u.display_name || u.username) : "u" + r.receiver_user_id;
    rows.push(`<div class="request-row" data-req="${esc(r.request_id)}" data-kind="out">
      <span class="dot"></span>
      <div class="request-main"><strong>${esc(name)}</strong><small>request pending</small></div>
    </div>`);
  }
  strip.innerHTML = rows.join("");
}

export function renderContacts() {
  const box = $("#contactResults");
  if (!box) return;
  const ids = [...state.friends.keys()];
  if (!ids.length) {
    box.innerHTML = '<div class="list-empty">No contacts yet. Use Search or Add Friend.</div>';
    return;
  }
  box.innerHTML = ids.map((id) => {
    const u = state.users.get(String(id));
    const name = u ? (u.display_name || u.username) : "u" + id;
    const handle = u ? "@" + u.username : "";
    const online = state.online.has("u" + id);
    return `<button type="button" class="user-item" data-peer="u${esc(id)}">
      <span class="dot ${online ? "on" : ""}"></span>
      <div><strong>${esc(name)}</strong>${roleBadge(id)}<small>${esc(handle)}</small></div>
      <span class="status ${online ? "on" : ""}">${online ? "online" : "offline"}</span>
    </button>`;
  }).join("");
}

function rowMeta(r) {
  const label = peerLabel(r.peer);
  const last = r.last;
  const isGroupPeer = /^g\d+$/.test(r.peer);
  const preview = isTyping(r.peer)
    ? "typing…"
    : (last
      ? (last.deleted
        ? "Message deleted"
        : (last.mine
          ? "You: "
          : (isGroupPeer ? peerLabel(last.sender).slice(0, 16) + ": " : "")) +
          (last.text || (last.attachment ? "Attachment" : (last.type || "message"))))
      : "");
  const time = last ? fmtTime(new Date(last.ts)) : "";
  const online = peerOnline(r.peer);
  return { label, preview, time, online, unread: r.unread };
}

function contactRowHtml(r, active) {
  const m = rowMeta(r);
  return `<button type="button" class="contact-row ${active ? "active" : ""} ${r.unread ? "has-unread" : ""}" data-peer="${esc(r.peer)}">
    <span class="dot ${m.online ? "on" : ""}"></span>
    <span class="contact-name-wrap contact-name-flex">
      <span class="contact-name">${esc(m.label)}${roleBadge(/^u(\d+)$/.exec(r.peer) ? /^u(\d+)$/.exec(r.peer)[1] : "")}</span>
      ${m.preview ? `<span class="contact-preview">${emoteTokens(esc(emotes(m.preview)))}</span>` : ""}
    </span>
    <span class="contact-time">${esc(m.time)}</span>
    ${r.unread ? `<span class="unread">${r.unread > 99 ? "99+" : r.unread}</span>` : ""}
  </button>`;
}

export function renderSidebar() {
  renderRequests();
  const rows = conversationOrder().filter((r) => state.filter === "all" || r.unread > 0);
  let total = 0;
  for (const r of conversationOrder()) total += r.unread;
  const unreadEl = $("#unreadCount");
  if (unreadEl) unreadEl.textContent = String(total);
  const allEl = $("#allCount");
  if (allEl) allEl.textContent = String(state.conversations.size || state.friends.size);

  // presence counts for status bar (1:1 peers only; groups don't skew them)
  let online = 0, offline = 0;
  for (const r of conversationOrder()) {
    if (!/^u\d+$/.test(r.peer)) continue;
    if (peerOnline(r.peer)) online++;
    else offline++;
  }
  const oc = $("#onlineCount");
  if (oc) oc.textContent = String(online);
  const fc = $("#offlineCount");
  if (fc) fc.textContent = String(offline);

  const list = $("#conversationList");
  if (!list) return;
  if (!rows.length) {
    list.innerHTML = '<div class="list-empty">No contacts yet. Friends &gt; Search to find people.<br>Or use toolbar Add Contact.</div>';
    return;
  }

  // Group Online / Offline like the native client (live presence now)
  const on = rows.filter((r) => peerOnline(r.peer));
  const off = rows.filter((r) => !on.includes(r));

  let html = "";
  if (on.length) {
    html += `<div class="group-label">Online (${on.length})</div>`;
    html += on.map((r) => contactRowHtml(r, state.activePeer === r.peer)).join("");
  }
  if (off.length) {
    html += `<div class="group-label">Offline (${off.length})</div>`;
    html += off.map((r) => contactRowHtml(r, state.activePeer === r.peer)).join("");
  }
  list.innerHTML = html;
}
