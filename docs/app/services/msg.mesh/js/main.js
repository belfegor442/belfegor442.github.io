import { api, getToken, setToken, ApiError } from "./api.js";
import { state, on, ingest, pushLocal, findMessage, maxRowid, primeUsers, rememberUser, resetState } from "./store.js";
import { connect as wsConnect, disconnect as wsDisconnect } from "./ws.js";
import * as ui from "./ui.js";

const $ = ui.$;
const esc = ui.esc;

function uid() {
  return "tmp-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
}

function normalizeUser(payload) {
  const u = payload.user || payload;
  return {
    user_id: String(u.user_id ?? ""),
    username: u.username || "",
    display_name: u.display_name || u.username || "",
    role: u.role || payload.role || "user",
    tenant_id: u.tenant_id || payload.tenant_id || "",
    status: u.status || "online",
  };
}

/* ---------------- auth ---------------- */

let authMode = "login";

function setMode(mode) {
  authMode = mode;
  ui.setAuthTab(mode);
}

document.querySelectorAll(".tabs button").forEach((b) => {
  b.addEventListener("click", () => setMode(b.dataset.tab));
});

$("#authForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = $("#authUsername").value.trim();
  const password = $("#authPassword").value;
  const errBox = $("#authError");
  errBox.textContent = "";
  if (!username || !password) { errBox.textContent = "Username and password are required."; return; }
  const btn = $("#authSubmit");
  btn.disabled = true;
  try {
    if (authMode === "register") {
      const display = $("#authDisplayName").value.trim() || username;
      await api.register(username, password, display);
      const r = await api.login(username, password);
      setToken(r.session_token);
    } else {
      const r = await api.login(username, password);
      setToken(r.session_token);
    }
    await startSession();
  } catch (err) {
    errBox.textContent = err instanceof ApiError ? err.message : "Sign-in failed.";
  } finally {
    btn.disabled = false;
  }
});

/* ---------------- session lifecycle ---------------- */

let booted = false;

async function startSession() {
  try {
    const w = await api.whoami();
    state.user = normalizeUser(w);
  } catch (e) {
    setToken("");
    throw e;
  }
  state.selfNode = "u" + state.user.user_id;
  booted = false;
  ui.showApp();
  ui.renderProfile();
  ui.setActive(null);
  await initialLoad();
  wsConnect();
  booted = true;
  if (!location.hash || location.hash === "#") location.hash = "#/";
  route();
  ui.toast("Signed in as " + (state.user.display_name || state.user.username));
}

async function initialLoad() {
  $("#syncState").textContent = "SYNCING";
  try {
    const r = await api.history({ limit: 200 });
    const items = r.items || [];
    ingest(items);
    const hasMore = items.length >= 200;
    for (const c of state.conversations.values()) c.hasMore = hasMore;
  } catch (e) {
    ui.toast("Could not load history: " + e.message, true);
  }
  try {
    const map = await api.read(null);
    if (map && map.reads) {
      for (const [peer, rowid] of Object.entries(map.reads)) state.pointers.set(peer, Number(rowid) || 0);
    }
  } catch { /* pointers refresh later */ }
  await primeUsers();
  ui.renderAll();
  $("#syncState").textContent = "SYNCED";
}

async function logout() {
  try { await api.logout(); } catch { /* session may already be gone */ }
  setToken("");
  wsDisconnect();
  resetState();
  booted = false;
  ui.showAuth("login");
  location.hash = "#/login";
  ui.toast("Signed out");
}

/* ---------------- router ---------------- */

function route() {
  const h = location.hash.replace(/^#\/?/, "");
  const [seg, ...rest] = h.split("/");
  if (!getToken() || !state.user) {
    if (seg === "register") setMode("register");
    else setMode("login");
    ui.showAuth(seg === "register" ? "register" : "login");
    return;
  }
  ui.showApp();
  if (seg === "chat" && rest[0]) {
    openChat(decodeURIComponent(rest[0]), { push: false });
  } else if (seg === "search") {
    openSearch();
    if (state.activePeer) openChat(state.activePeer, { push: false });
    else showEmpty();
  } else {
    showEmpty();
  }
}

function showEmpty() {
  ui.setActive(null);
}

function openChat(peer, opts = {}) {
  if (!peer) return;
  const existed = state.conversations.has(peer);
  if (!existed) {
    const m = /^u(\d+)$/.exec(peer);
    if (m) rememberUser(m[1]);
  }
  ui.setActive(peer);
  if (opts.push !== false && location.hash !== "#/chat/" + encodeURIComponent(peer)) {
    location.hash = "#/chat/" + encodeURIComponent(peer);
  }
  markRead(peer);
  if (opts.jumpRowid) jumpTo(opts.jumpRowid);
}

window.addEventListener("hashchange", route);

/* ---------------- read state ---------------- */

async function markRead(peer) {
  if (!peer) return;
  const max = maxRowid(peer);
  if (!max) return;
  const ptr = state.pointers.get(peer) || 0;
  if (max <= ptr) return;
  try {
    const r = await api.read(peer, max);
    if (r && typeof r.my_last_read_rowid === "number") {
      const cur = state.pointers.get(peer) || 0;
      if (r.my_last_read_rowid > cur) state.pointers.set(peer, r.my_last_read_rowid);
    }
    if (r && typeof r.peer_last_read_rowid === "number" && r.peer_last_read_rowid >= 0) {
      const curP = state.peerPointers.get(peer) || 0;
      if (r.peer_last_read_rowid > curP) state.peerPointers.set(peer, r.peer_last_read_rowid);
    }
    ui.renderSidebar();
    if (state.activePeer === peer) ui.renderChatHead();
  } catch { /* pointer retried on next event */ }
}

/* ---------------- sending ---------------- */

let pendingAttachment = null;

function setPendingAttachment(att) {
  pendingAttachment = att;
  const bar = $("#pendingFile");
  if (att) {
    bar.classList.remove("hidden");
    $("#pendingFileName").textContent = "📎 " + att.filename;
  } else {
    bar.classList.add("hidden");
    $("#pendingFileName").textContent = "";
  }
}

async function sendMessage() {
  const input = $("#messageInput");
  const text = input.value.trim();
  const peer = state.activePeer;
  if (!peer || (!text && !pendingAttachment)) return;
  const att = pendingAttachment;
  const env = {
    v: 1,
    from: Number(state.user.user_id),
    from_name: state.user.display_name || state.user.username,
    ts: Date.now(),
    text,
  };
  if (att) env.attachment = { id: att.id, filename: att.filename, type: att.content_type, size: att.size_bytes };
  const tmp = uid();
  pushLocal(peer, { id: tmp, text, env, attachment: env.attachment || null });
  input.value = "";
  setPendingAttachment(null);
  ui.renderMessages();
  ui.renderSidebar();

  try {
    const r = await api.send(peer, "text", JSON.stringify(env));
    const m = findMessage(peer, tmp);
    if (m && r.message_id) {
      m.id = r.message_id;
      if (m.sync === "sending") m.sync = "sent";
      ui.renderMessages({ scroll: false });
    }
    markRead(peer);
  } catch (e) {
    const m = findMessage(peer, tmp);
    if (m) m.sync = "failed";
    ui.renderMessages({ scroll: false });
    ui.toast("Send failed: " + e.message, true);
  }
  ui.renderSidebar();
}

async function retryMessage(peer, m) {
  m.sync = "sending";
  ui.renderMessages({ scroll: false });
  try {
    const r = await api.send(peer, m.type || "text", JSON.stringify(m.env));
    if (r.message_id && findMessage(peer, m.id)) {
      const cur = findMessage(peer, m.id);
      cur.id = r.message_id;
      cur.sync = "sent";
      ui.renderMessages({ scroll: false });
    }
  } catch (e) {
    m.sync = "failed";
    ui.renderMessages({ scroll: false });
    ui.toast("Retry failed: " + e.message, true);
  }
}

/* ---------------- attachments ---------------- */

const MAX_FILE = 700 * 1024; // stays under the 1 MB JSON body cap after base64

$("#attachBtn").addEventListener("click", () => $("#fileInput").click());
$("#pendingFileCancel").addEventListener("click", () => setPendingAttachment(null));

$("#fileInput").addEventListener("change", async () => {
  const file = $("#fileInput").files[0];
  $("#fileInput").value = "";
  if (!file) return;
  if (file.size > MAX_FILE) {
    ui.toast(`File too large (max ${Math.round(MAX_FILE / 1024)} KB)`, true);
    return;
  }
  try {
    const b64 = await fileToBase64(file);
    const r = await api.upload(file.name, file.type || "application/octet-stream", b64, file.size);
    setPendingAttachment({ id: r.attachment_id, filename: r.filename || file.name, content_type: r.content_type || file.type, size_bytes: r.size_bytes ?? file.size });
    ui.toast("Attached " + (r.filename || file.name));
  } catch (e) {
    ui.toast("Upload failed: " + e.message, true);
  }
});

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(",")[1] || "");
    fr.onerror = () => reject(new Error("could not read file"));
    fr.readAsDataURL(file);
  });
}

async function openAttachment(attachmentId, filename) {
  try {
    const r = await api.download(attachmentId);
    const bin = atob(r.content_base64 || "");
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const blob = new Blob([bytes], { type: r.content_type || "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const win = window.open(url, "_blank");
    if (!win) {
      const a = document.createElement("a");
      a.href = url;
      a.download = r.filename || filename || "attachment";
      a.click();
    }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (e) {
    ui.toast("Download failed: " + e.message, true);
  }
}

/* ---------------- dialogs ---------------- */

document.querySelectorAll("dialog .dialog-head .icon-btn").forEach((b) => {
  b.addEventListener("click", (e) => {
    e.preventDefault();
    b.closest("dialog").close();
  });
});

function openNewChat() {
  $("#newChatStatus").textContent = "";
  $("#newChatResults").innerHTML = "";
  $("#newChatInput").value = "";
  $("#newChatDialog").showModal();
  $("#newChatInput").focus();
}

$("#newChatForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const q = $("#newChatInput").value.trim().replace(/^@/, "");
  if (!q) return;
  const box = $("#newChatResults");
  $("#newChatStatus").textContent = "Searching…";
  box.innerHTML = "";
  try {
    const r = await api.usersSearch(q);
    const users = (r.users || []).filter((u) => String(u.user_id) !== state.user.user_id);
    $("#newChatStatus").textContent = users.length ? "" : "No users found.";
    for (const u of users) {
      state.users.set(String(u.user_id), { ...u, user_id: String(u.user_id) });
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "user-item";
      btn.innerHTML = `<div class="avatar">${esc(ui.initials(u.display_name || u.username))}</div>
        <div><strong>${esc(u.display_name || u.username)}</strong><small>@${esc(u.username)}</small></div>
        <span class="status ${u.status === "online" ? "on" : ""}">${esc(u.status || "")}</span>`;
      btn.addEventListener("click", () => {
        $("#newChatDialog").close();
        openChat("u" + u.user_id);
      });
      box.appendChild(btn);
    }
  } catch (e2) {
    $("#newChatStatus").textContent = e2.message;
  }
});

function openSearch() {
  $("#searchInput").value = "";
  $("#searchResults").innerHTML = '<p class="hint">Search runs against your conversations on the server.</p>';
  const d = $("#searchDialog");
  if (!d.open) d.showModal();
  $("#searchInput").focus();
}

$("#searchForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const q = $("#searchInput").value.trim();
  if (!q) return;
  const box = $("#searchResults");
  box.innerHTML = '<p class="hint">Searching…</p>';
  try {
    const r = await api.searchMessages(q);
    const items = r.items || [];
    ingest(items);
    await primeUsers();
    ui.renderSidebar();
    if (!items.length) {
      box.innerHTML = '<p class="hint">No messages matched.</p>';
      return;
    }
    box.innerHTML = "";
    for (const item of items) {
      let env = {};
      try { env = JSON.parse(item.payload) || {}; } catch { /* raw */ }
      const sender = item.sender_node_id;
      const mine = sender === state.selfNode;
      const peer = mine ? item.receiver_node_id : sender;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "search-hit";
      const d = new Date(String(item.created_at).replace(" ", "T") + "Z");
      btn.innerHTML = `<strong>${esc(mine ? "You → " + peerLabelSafe(peer) : peerLabelSafe(peer) + " → you")}</strong>
        <p>${esc(env.text || "(" + (item.message_type || "message") + ")")}</p>
        <span class="meta">${esc(Number.isNaN(d.getTime()) ? item.created_at : d.toLocaleString())}</span>`;
      btn.addEventListener("click", () => {
        $("#searchDialog").close();
        openChat(peer, { jumpRowid: item.rowid });
      });
      box.appendChild(btn);
    }
  } catch (e2) {
    box.innerHTML = `<p class="hint">${esc(e2.message)}</p>`;
  }
});

function peerLabelSafe(peer) {
  const m = /^u(\d+)$/.exec(peer || "");
  const u = m ? state.users.get(m[1]) : null;
  return u ? (u.display_name || u.username) : peer;
}

function openProfile() {
  const u = state.user;
  if (!u) return;
  $("#profileAvatar").textContent = ui.initials(u.display_name || u.username);
  $("#profileName").textContent = u.display_name || u.username;
  $("#profileHandle").textContent = "@" + u.username;
  $("#profileDisplayName").value = u.display_name || "";
  $("#profileStatus").textContent = "";
  $("#profileDialog").showModal();
}

$("#profileForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("#profileDisplayName").value.trim();
  const box = $("#profileStatus");
  if (!name || name.length > 64) { box.textContent = "Display name must be 1-64 characters."; return; }
  try {
    const r = await api.usersUpdate(name);
    state.user = normalizeUser(r.user ? { user: r.user, role: state.user.role, tenant_id: state.user.tenant_id } : r);
    ui.renderProfile();
    $("#profileName").textContent = state.user.display_name;
    $("#profileAvatar").textContent = ui.initials(state.user.display_name);
    box.textContent = "";
    $("#profileDialog").close();
    ui.toast("Profile updated");
    ui.renderMessages({ scroll: false });
  } catch (err) {
    box.textContent = err.message;
  }
});

$("#logoutBtn").addEventListener("click", () => {
  $("#profileDialog").close();
  logout();
});

/* ---------------- app chrome ---------------- */

$("#newChatBtn").addEventListener("click", openNewChat);
$("#startBtn").addEventListener("click", openNewChat);
$("#searchBtn").addEventListener("click", openSearch);
$("#chatSearchBtn").addEventListener("click", openSearch);
$("#profileBtn").addEventListener("click", openProfile);
$("#backBtn").addEventListener("click", () => {
  $("#chatPanel").classList.remove("mobile-open");
  location.hash = "#/";
});
$("#chatInfoBtn").addEventListener("click", () => $("#details").classList.toggle("hidden"));
$("#closeDetails").addEventListener("click", () => $("#details").classList.add("hidden"));
$("#composer").addEventListener("submit", (e) => { e.preventDefault(); sendMessage(); });
$("#loadOlder").addEventListener("click", loadOlder);

document.querySelectorAll(".filters button").forEach((b) => {
  b.addEventListener("click", () => {
    document.querySelectorAll(".filters button").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    state.filter = b.dataset.filter;
    ui.renderSidebar();
  });
});

$("#conversationList").addEventListener("click", (e) => {
  const row = e.target.closest(".conversation");
  if (row) openChat(row.dataset.peer);
});

$("#messageList").addEventListener("click", (e) => {
  const att = e.target.closest("[data-att]");
  if (att) {
    e.preventDefault();
    openAttachment(att.dataset.att, att.dataset.attname);
    return;
  }
  const msg = e.target.closest(".message");
  if (msg && msg.classList.contains("failed")) {
    const c = state.conversations.get(state.activePeer);
    const m = c && c.messages.find((x) => x.id === msg.dataset.id);
    if (m) retryMessage(state.activePeer, m);
  }
});

async function loadOlder() {
  const peer = state.activePeer;
  const c = state.conversations.get(peer);
  if (!peer || !c || !c.hasMore) return;
  const rowids = c.messages.filter((m) => m.rowid != null).map((m) => m.rowid);
  if (!rowids.length) { c.hasMore = false; ui.renderMessages({ scroll: false }); return; }
  const before = Math.min(...rowids);
  const wrap = $("#messages");
  const keepBottom = wrap.scrollHeight - wrap.scrollTop;
  try {
    const r = await api.history({ limit: 200, before_id: before });
    const items = r.items || [];
    const countBefore = c.messages.length;
    ingest(items);
    await primeUsers();
    if (!items.length || c.messages.length === countBefore) c.hasMore = false;
    else c.hasMore = items.length >= 200;
    ui.renderMessages({ scroll: false });
    wrap.scrollTop = wrap.scrollHeight - keepBottom;
    ui.renderSidebar();
  } catch (e) {
    ui.toast("Could not load older messages: " + e.message, true);
  }
}

/* ---------------- store events ---------------- */

function jumpTo(rowid) {
  const rid = Number(rowid);
  if (!Number.isFinite(rid)) return;
  requestAnimationFrame(() => {
    const el = document.querySelector(`#messageList .message[data-rowid="${rid}"]`);
    if (el) {
      el.scrollIntoView({ block: "center" });
      el.classList.add("jump");
      setTimeout(() => el.classList.remove("jump"), 2400);
    }
  });
}

on("conversations", () => {
  ui.renderSidebar();
  if (state.activePeer) ui.renderChatHead();
});

on("messages", (detail) => {
  ui.renderSidebar();
  if (!detail || detail.peer === state.activePeer) {
    ui.renderMessages();
    if (detail && detail.peer) markRead(detail.peer);
    if (state.activePeer) ui.renderChatHead();
  }
});

on("connection", () => ui.renderConnection());
on("sync", (text) => { $("#syncState").textContent = text; });
on("readstate", () => {
  ui.renderSidebar();
  if (state.activePeer) ui.renderChatHead();
});

/* ---------------- boot ---------------- */

async function boot() {
  ui.renderConnection();
  if (!getToken()) {
    ui.showAuth("login");
    route();
    return;
  }
  try {
    await startSession();
  } catch (e) {
    setToken("");
    ui.showAuth("login");
    $("#authError").textContent =
      e instanceof ApiError && e.status === 401
        ? "Session expired — please sign in again."
        : "Cannot reach the msg.mesh server. Check your connection and retry.";
    route();
  }
}

boot();
