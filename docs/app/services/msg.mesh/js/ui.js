import { state, conversationOrder, unreadCount, peerLabel, peerUser, maxRowid, isFriend, incomingRequests, outgoingRequests } from "./store.js";

export const $ = (s) => document.querySelector(s);

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function initials(name) {
  return String(name || "?").trim().split(/\s+/).map((x) => x[0]).join("").slice(0, 2).toUpperCase() || "?";
}

const fmtTime = (d) => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dayLabel(ts) {
  const d = new Date(ts);
  const today = new Date();
  const yest = new Date(Date.now() - 86400000);
  const k = dayKey(ts);
  if (k === dayKey(today.getTime())) return "TODAY";
  if (k === dayKey(yest.getTime())) return "YESTERDAY";
  return d.toLocaleDateString([], { day: "2-digit", month: "short", year: "numeric" }).toUpperCase();
}

function fileSize(n) {
  if (n == null) return "";
  if (n < 1024) return n + " B";
  if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
  return (n / 1048576).toFixed(1) + " MB";
}

export function toast(text, isError) {
  const box = $("#toasts");
  const el = document.createElement("div");
  el.className = "toast" + (isError ? " error" : "");
  el.textContent = text;
  box.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

export function showAuth(tab) {
  $("#authView").classList.remove("hidden");
  $("#appView").classList.add("hidden");
  if (tab) setAuthTab(tab);
}

export function showApp() {
  $("#authView").classList.add("hidden");
  $("#appView").classList.remove("hidden");
}

export function setAuthTab(tab) {
  document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  const isReg = tab === "register";
  document.querySelector(".reg-only").classList.toggle("hidden", !isReg);
  $("#authSubmit").textContent = isReg ? "CREATE ACCOUNT" : "SIGN IN";
  $("#authError").textContent = "";
}

export function renderProfile() {
  const u = state.user;
  if (!u) return;
  const name = u.display_name || u.username || "?";
  $("#selfName").textContent = name;
  $("#selfHandle").textContent = "@" + (u.username || "?");
  $("#selfAvatar").textContent = initials(name);
}

export function renderConnection() {
  const mode = state.connection;
  const el = $("#connection");
  const label = { connecting: "CONNECTING", online: "CONNECTED", reconnecting: "RECONNECTING", offline: "OFFLINE" }[mode] || "OFFLINE";
  el.className = "connection " + mode;
  el.title = "msg.mesh server";
  el.innerHTML = "<i></i> " + label;
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
      <div class="avatar small">${esc(initials(name))}</div>
      <div class="request-main"><strong>${esc(name)}</strong><small>wants to connect</small></div>
      <button class="req-btn accept" data-act="accept" title="Accept">✓</button>
      <button class="req-btn decline" data-act="decline" title="Decline">×</button>
    </div>`);
  }
  for (const r of outgoing) {
    const u = state.users.get(String(r.receiver_user_id));
    const name = u ? (u.display_name || u.username) : "u" + r.receiver_user_id;
    rows.push(`<div class="request-row pending" data-req="${esc(r.request_id)}" data-kind="out">
      <div class="avatar small">${esc(initials(name))}</div>
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
    box.innerHTML = '<div class="list-empty">No contacts yet. Search above to find users.</div>';
    return;
  }
  box.innerHTML = ids.map((id) => {
    const u = state.users.get(String(id));
    const name = u ? (u.display_name || u.username) : "u" + id;
    const handle = u ? "@" + u.username : "";
    const online = u && u.status === "online";
    return `<button type="button" class="user-item" data-peer="u${esc(id)}">
      <div class="avatar">${esc(initials(name))}</div>
      <div><strong>${esc(name)}</strong><small>${esc(handle)}</small></div>
      <span class="status ${online ? "on" : ""}">${online ? "online" : ""}</span>
    </button>`;
  }).join("");
}

export function renderSidebar() {
  renderRequests();
  const rows = conversationOrder().filter((r) => state.filter === "all" || r.unread > 0);
  $("#allCount").textContent = state.conversations.size || state.friends.size;
  let total = 0;
  for (const r of conversationOrder()) total += r.unread;
  $("#unreadCount").textContent = total;

  const list = $("#conversationList");
  if (!rows.length) {
    list.innerHTML = '<div class="list-empty">No conversations yet.<br>Use NEW MESSAGE to find a user.</div>';
    return;
  }
  list.innerHTML = rows.map((r) => {
    const label = peerLabel(r.peer);
    const last = r.last;
    const preview = last
      ? (last.mine ? "You: " : "") + (last.text || (last.attachment ? "Attachment" : (last.type || "message")))
      : "No messages yet";
    const time = last ? fmtTime(new Date(last.ts)) : "";
    return `<article class="conversation ${state.activePeer === r.peer ? "active " : ""}${r.unread ? "unread" : ""}" data-peer="${esc(r.peer)}">
      <div class="avatar">${esc(initials(label))}</div>
      <div class="conversation-main">
        <div class="conversation-row"><strong>${esc(label)}</strong><span class="time">${esc(time)}</span></div>
        <span class="preview">${esc(preview)}</span>
      </div>
      ${r.unread ? `<span class="badge">${r.unread}</span>` : ""}
    </article>`;
  }).join("");
}

function metaFor(m, peer) {
  if (m.sync === "sending") return "sending…";
  if (m.sync === "failed") return "failed · tap to retry";
  if (m.mine) {
    const pp = state.peerPointers.get(peer) || 0;
    if (m.rowid != null && pp >= m.rowid) return fmtTime(new Date(m.ts)) + " · read";
    return fmtTime(new Date(m.ts)) + " · sent";
  }
  return fmtTime(new Date(m.ts));
}

function messageHtml(m, peer) {
  const att = m.attachment
    ? `<a class="att-chip" data-att="${esc(m.attachment.id)}" data-attname="${esc(m.attachment.filename || "file")}" href="#"><span class="ico">📎</span><span>${esc(m.attachment.filename || "file")}<small>${esc(m.attachment.type || "")}${m.attachment.size ? " · " + fileSize(m.attachment.size) : ""}</small></span></a>`
    : "";
  const body = m.text ? esc(m.text) : (att ? "" : `<span class="type-tag">(${esc(m.type)})</span>`);
  const rid = m.rowid != null && Number.isFinite(Number(m.rowid)) ? Number(m.rowid) : "";
  return `<div class="message ${m.mine ? "mine " : ""}${m.sync === "sending" ? "pending " : ""}${m.sync === "failed" ? "failed " : ""}" data-id="${esc(m.id)}" data-rowid="${rid}">
    <div class="bubble">${body}${att}</div>
    <span class="message-meta">${esc(metaFor(m, peer))}</span>
  </div>`;
}

export function renderMessages(opts = {}) {
  const peer = state.activePeer;
  if (!peer) return;
  const c = state.conversations.get(peer);
  const box = $("#messageList");
  const wrap = $("#messages");

  if (!c || !c.messages.length) {
    box.innerHTML = '<div class="list-empty">No messages yet. Say hello — messages sync to your other clients.</div>';
    $("#loadOlder").classList.add("hidden");
    return;
  }

  let html = "";
  let lastDay = "";
  for (const m of c.messages) {
    const k = dayKey(m.ts);
    if (k !== lastDay) {
      html += `<div class="day-divider">${dayLabel(m.ts)}</div>`;
      lastDay = k;
    }
    html += messageHtml(m, peer);
  }
  box.innerHTML = html;
  $("#loadOlder").classList.toggle("hidden", !c.hasMore);

  if (opts.scroll !== false) wrap.scrollTop = wrap.scrollHeight;
}

export function renderChatHead() {
  const peer = state.activePeer;
  if (!peer) return;
  const label = peerLabel(peer);
  const u = peerUser(peer);
  $("#chatName").textContent = label;
  $("#chatAvatar").textContent = initials(label);

  let head = "";
  if (u) {
    head += `<span class="dot ${u.status === "online" ? "on" : ""}"></span>${u.status === "online" ? "online" : "offline"}`;
    head += " · " + esc("@" + u.username);
  } else {
    head += esc("device " + peer);
  }
  const myLastMine = [...((state.conversations.get(peer) || {}).messages || [])]
    .filter((m) => m.mine && m.rowid != null)
    .reduce((a, m) => Math.max(a, m.rowid), 0);
  const pp = state.peerPointers.get(peer) || 0;
  if (myLastMine > 0) head += " · " + (pp >= myLastMine ? "read ✓" : "sent");
  $("#chatMeta").innerHTML = head;
  renderDetails();
}

export function renderDetails() {
  const peer = state.activePeer;
  if (!peer) return;
  const label = peerLabel(peer);
  const u = peerUser(peer);
  const c = state.conversations.get(peer);
  $("#detailsName").textContent = label;
  $("#detailsHandle").textContent = u ? "@" + u.username : peer;
  $("#detailsAvatar").textContent = initials(label);
  $("#detailsStatus").textContent = u ? (u.status === "online" ? "Online" : "Offline") : "Device node";
  $("#detailsMessages").textContent = c ? c.messages.length : 0;
  const pp = state.peerPointers.get(peer) || 0;
  $("#detailsRead").textContent = pp > 0 ? `Row ${pp}` : "—";

  const m = /^u(\d+)$/.exec(peer);
  const addBtn = $("#addContactBtn");
  const removeBtn = $("#removeContactBtn");
  if (addBtn && removeBtn) {
    if (m) {
      const friend = isFriend(m[1]);
      addBtn.classList.toggle("hidden", friend);
      removeBtn.classList.toggle("hidden", !friend);
    } else {
      addBtn.classList.add("hidden");
      removeBtn.classList.add("hidden");
    }
  }

  const filesBlock = $("#sharedFilesBlock");
  const filesBox = $("#sharedFiles");
  if (filesBlock && filesBox) {
    const seen = new Set();
    const files = [];
    for (const msg of (c ? c.messages : [])) {
      const a = msg.attachment;
      if (a && a.id && !seen.has(a.id)) {
        seen.add(a.id);
        files.push(a);
      }
    }
    if (!files.length) {
      filesBlock.classList.add("hidden");
      filesBox.innerHTML = "";
    } else {
      filesBlock.classList.remove("hidden");
      filesBox.innerHTML = files.map((a) =>
        `<button type="button" class="file-row" data-att="${esc(a.id)}" data-attname="${esc(a.filename || "file")}">
          <span class="ico">📎</span><span>${esc(a.filename || "file")}<small>${esc(a.type || "")}${a.size ? " · " + fileSize(a.size) : ""}</small></span>
        </button>`
      ).join("");
    }
  }
}

export function setActive(peer) {
  state.activePeer = peer;
  const open = !!peer;
  $("#emptyState").classList.toggle("hidden", open);
  $("#chatView").classList.toggle("hidden", !open);
  $("#chatPanel").classList.toggle("mobile-open", open);
  renderSidebar();
  if (open) {
    renderChatHead();
    renderMessages();
  }
}

export function renderAll() {
  renderProfile();
  renderConnection();
  renderSidebar();
  if (state.activePeer) {
    renderChatHead();
    renderMessages({ scroll: false });
  }
}
