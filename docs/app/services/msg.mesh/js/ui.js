import { state, conversationOrder, peerLabel, peerUser, isFriend, incomingRequests, outgoingRequests } from "./store.js";

export const $ = (s) => document.querySelector(s);

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function initials(name) {
  return String(name || "?").trim().split(/\s+/).map((x) => x[0]).join("").slice(0, 2).toUpperCase() || "?";
}

const fmtTime = (d) => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });

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
  const isReg = tab === "register";
  document.querySelector(".reg-only")?.classList.toggle("hidden", !isReg);
  const heading = $("#authHeading");
  const sub = $("#authSub");
  const bar = $("#authTitleBar");
  const status = $("#authStatus");
  const submit = $("#authSubmit");
  const back = $("#authBack");
  if (heading) heading.textContent = isReg ? "Create Account" : "Sign In";
  if (sub) sub.textContent = isReg ? "Register on the Weird Stuff Server" : "Log in to the Weird Stuff Server";
  if (bar) bar.textContent = isReg ? "Create Account - msg.mesh" : "Sign In - msg.mesh";
  if (status) status.textContent = isReg ? " Create Account" : " Sign In";
  if (submit) submit.textContent = isReg ? "Create" : "Sign In";
  if (back) back.classList.toggle("hidden", !isReg);
  const err = $("#authError");
  if (err) { err.textContent = ""; err.classList.add("hidden"); }
}

export function renderProfile() {
  const u = state.user;
  if (!u) return;
  const name = u.display_name || u.username || "?";
  $("#selfName") && ($("#selfName").textContent = name);
  $("#selfHandle") && ($("#selfHandle").textContent = "@" + (u.username || "?"));
  const pa = $("#profileAvatar");
  if (pa) pa.textContent = initials(name);
}

export function renderConnection() {
  const mode = state.connection;
  const led = $("#connection");
  const label = $("#connLabel");
  const map = { connecting: "Connecting", online: "Connected", reconnecting: "Reconnecting", offline: "Local mode" };
  if (led) {
    led.className = "led" + (mode === "online" ? " on" : mode === "connecting" || mode === "reconnecting" ? " warn" : "");
    led.title = "msg.mesh server";
  }
  if (label) label.textContent = map[mode] || "Local mode";
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
      <span class="dot on"></span>
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
    const online = u && u.status === "online";
    return `<button type="button" class="user-item" data-peer="u${esc(id)}">
      <span class="dot ${online ? "on" : ""}"></span>
      <div><strong>${esc(name)}</strong><small>${esc(handle)}</small></div>
      <span class="status ${online ? "on" : ""}">${online ? "online" : "offline"}</span>
    </button>`;
  }).join("");
}

function rowMeta(r) {
  const label = peerLabel(r.peer);
  const last = r.last;
  const preview = last
    ? (last.mine ? "You: " : "") + (last.text || (last.attachment ? "Attachment" : (last.type || "message")))
    : "";
  const time = last ? fmtTime(new Date(last.ts)) : "";
  const online = (() => {
    const u = peerUser(r.peer);
    return !!(u && u.status === "online");
  })();
  return { label, preview, time, online, unread: r.unread };
}

function contactRowHtml(r, active) {
  const m = rowMeta(r);
  return `<button type="button" class="contact-row ${active ? "active" : ""} ${r.unread ? "has-unread" : ""}" data-peer="${esc(r.peer)}">
    <span class="dot ${m.online ? "on" : ""}"></span>
    <span class="contact-name-wrap contact-name-flex">
      <span class="contact-name">${esc(m.label)}</span>
      ${m.preview ? `<span class="contact-preview">${esc(m.preview)}</span>` : ""}
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

  // presence counts for status bar
  let online = 0, offline = 0;
  for (const r of conversationOrder()) {
    const u = peerUser(r.peer);
    if (u && u.status === "online") online++;
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

  // Group Online / Offline like the native client
  const on = rows.filter((r) => {
    const u = peerUser(r.peer);
    return u && u.status === "online";
  });
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

function statusGlyph(m, peer) {
  if (m.sync === "sending") return "…";
  if (m.sync === "failed") return "!";
  if (!m.mine) return "";
  const pp = state.peerPointers.get(peer) || 0;
  if (m.rowid != null && pp >= m.rowid) return "✓✓";
  return "✓";
}

function messageLineHtml(m, peer) {
  const att = m.attachment
    ? `<a class="att-chip" data-att="${esc(m.attachment.id)}" data-attname="${esc(m.attachment.filename || "file")}" href="#"><span>📎</span><span>${esc(m.attachment.filename || "file")}<small> ${esc(m.attachment.type || "")}${m.attachment.size ? " · " + fileSize(m.attachment.size) : ""}</small></span></a>`
    : "";
  const who = m.mine ? "You" : peerLabel(peer).slice(0, 16);
  const body = m.text ? esc(m.text) : (att ? "" : `<span class="msg-type-label">(${esc(m.type)})</span>`);
  const st = statusGlyph(m, peer);
  const cls = ["msg-line", m.mine ? "mine" : "other"];
  if (m.sync === "sending") cls.push("pending");
  if (m.sync === "failed") cls.push("failed");
  const rid = m.rowid != null && Number.isFinite(Number(m.rowid)) ? Number(m.rowid) : "";
  return `<div class="${cls.join(" ")}" data-id="${esc(m.id)}" data-rowid="${rid}">
    <span class="ts">${esc(fmtTime(new Date(m.ts)))}</span><span class="who">${esc(who)}:</span><span class="body">${body}</span>${st ? `<span class="st">${esc(st)}</span>` : ""}${att}
  </div>`;
}

export function renderMessages(opts = {}) {
  const peer = state.activePeer;
  if (!peer) return;
  const c = state.conversations.get(peer);
  const box = $("#messageList");
  const wrap = $("#messages");
  if (!box || !wrap) return;

  if (!c || !c.messages.length) {
    box.innerHTML = '<div class="list-empty">No messages yet. Say hello!</div>';
    $("#loadOlder")?.classList.add("hidden");
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
    html += messageLineHtml(m, peer);
  }
  box.innerHTML = html;
  $("#loadOlder")?.classList.toggle("hidden", !c.hasMore);

  if (opts.scroll !== false) wrap.scrollTop = wrap.scrollHeight;
}

export function renderChatHead() {
  const peer = state.activePeer;
  if (!peer) return;
  const label = peerLabel(peer);
  const u = peerUser(peer);
  const nameEl = $("#chatName");
  const avEl = $("#chatAvatar");
  const metaEl = $("#chatMeta");
  if (nameEl) nameEl.textContent = label;
  if (avEl) avEl.textContent = initials(label);

  if (!metaEl) return;
  let head = "";
  const online = u && u.status === "online";
  head += `<span class="dot ${online ? "on" : ""}"></span>`;
  if (u) {
    head += online ? "Ready to chat" : "Offline";
    head += " &nbsp;·&nbsp; " + esc("@" + u.username);
  } else {
    head += esc("device " + peer);
  }
  const myLastMine = [...((state.conversations.get(peer) || {}).messages || [])]
    .filter((m) => m.mine && m.rowid != null)
    .reduce((a, m) => Math.max(a, m.rowid), 0);
  const pp = state.peerPointers.get(peer) || 0;
  if (myLastMine > 0) head += " &nbsp;·&nbsp; " + (pp >= myLastMine ? "Read" : "Sent");
  metaEl.innerHTML = head;
  renderDetails();
}

export function renderDetails() {
  const peer = state.activePeer;
  if (!peer) return;
  const label = peerLabel(peer);
  const u = peerUser(peer);
  const c = state.conversations.get(peer);
  const dn = $("#detailsName");
  if (dn) dn.textContent = label;
  const dh = $("#detailsHandle");
  if (dh) dh.textContent = u ? "@" + u.username : peer;
  const da = $("#detailsAvatar");
  if (da) da.textContent = initials(label);
  const ds = $("#detailsStatus");
  if (ds) ds.textContent = u ? (u.status === "online" ? "Online" : "Offline") : "Device node";
  const dm = $("#detailsMessages");
  if (dm) dm.textContent = String(c ? c.messages.length : 0);
  const dr = $("#detailsRead");
  const pp = state.peerPointers.get(peer) || 0;
  if (dr) dr.textContent = pp > 0 ? `Row ${pp}` : "—";

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
          <span>📎</span><span>${esc(a.filename || "file")}<small> ${esc(a.type || "")}${a.size ? " · " + fileSize(a.size) : ""}</small></span>
        </button>`
      ).join("");
    }
  }
}

export function setActive(peer) {
  state.activePeer = peer;
  const open = !!peer;
  const chat = $("#chatPanel");
  const contacts = $("#contactsCol");
  const empty = $("#emptyState");
  if (empty) empty.classList.toggle("hidden", open);
  if (chat) {
    chat.classList.toggle("hidden", !open);
    chat.classList.toggle("mobile-open", open);
  }
  if (contacts) {
    const mobile = window.matchMedia("(max-width:650px)").matches;
    contacts.classList.toggle("contacts-mobile-hidden", mobile && open);
  }
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
