import { api, getToken, setToken, ApiError, friendlyError, resolveApiBase, setApiBase, apiBase, setOnUnauthorized, lastUsername, rememberUsername } from "./api.js";
import { state, on, ingest, pushLocal, findMessage, maxRowid, primeUsers, rememberUser, refreshUser, resetState, loadFriends, isFriend, incomingFrom, outgoingTo, incomingRequests, peerUser, upsertFriend } from "./store.js";
import { connect as wsConnect, disconnect as wsDisconnect } from "./ws.js";
import { requestNotificationPermission, notifyIncoming } from "./notifications.js";
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

function showErr(box, text) {
  if (!box) return;
  box.textContent = text;
  box.classList.toggle("hidden", !text);
}

/* ---------------- auth ---------------- */

let authMode = "login";

function setMode(mode) {
  authMode = mode;
  ui.setAuthTab(mode);
}

$("#authBack")?.addEventListener("click", () => {
  setMode("login");
  location.hash = "#/login";
});

$("#pwToggle")?.addEventListener("click", () => {
  const pw = $("#authPassword");
  const btn = $("#pwToggle");
  if (!pw || !btn) return;
  const show = pw.type === "password";
  pw.type = show ? "text" : "password";
  btn.textContent = show ? "Hide" : "Show";
});

// Caps Lock indicator while password is focused (matches native client).
$("#authPassword")?.addEventListener("keydown", (e) => {
  const warn = $("#capsWarn");
  if (!warn) return;
  const on = e.getModifierState && e.getModifierState("CapsLock");
  warn.classList.toggle("hidden", !on);
});
$("#authPassword")?.addEventListener("blur", () => $("#capsWarn")?.classList.add("hidden"));

$("#authForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = $("#authUsername").value.trim();
  const password = $("#authPassword").value;
  const errBox = $("#authError");
  showErr(errBox, "");
  authNotice = "";
  if (!username || !password) { showErr(errBox, "Username and password are required."); return; }
  if (authMode === "register" && password.length < 8) {
    showErr(errBox, "Password must be 8-128 characters.");
    return;
  }
  const btn = $("#authSubmit");
  btn.disabled = true;
  const status = $("#authStatus");
  if (status) status.textContent = " Contacting server...";
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
    rememberUsername(username);
    await startSession();
  } catch (err) {
    showErr(errBox, err instanceof ApiError ? friendlyError(err) : "Sign-in failed.");
    if (status) status.textContent = authMode === "register" ? " Create Account" : " Sign In";
  } finally {
    btn.disabled = false;
  }
});

/* ---------------- session lifecycle ---------------- */

let booted = false;

function handleSessionLost() {
  if (!getToken()) return;
  setToken("");
  wsDisconnect();
  resetState();
  booted = false;
  authNotice = "Session expired — please sign in again.";
  ui.showAuth("login");
  setMode("login");
  $("#authUsername").value = lastUsername();
  if (location.hash === "#/login" || location.hash === "#" || !location.hash) route();
  else location.hash = "#/login";
}
setOnUnauthorized(handleSessionLost);

async function startSession() {
  try {
    const w = await api.whoami({ allow401: true });
    state.user = normalizeUser(w);
  } catch (e) {
    setToken("");
    throw e;
  }
  state.selfNode = "u" + state.user.user_id;
  booted = false;
  ui.showApp();
  ui.renderProfile();
  applyServerSettings();
  ui.setActive(null);
  await initialLoad();
  wsConnect();
  booted = true;
  if (!location.hash || location.hash === "#") location.hash = "#/";
  route();
  ui.toast("Signed in as " + (state.user.display_name || state.user.username));
}

async function initialLoad() {
  const sync = $("#syncState");
  if (sync) sync.textContent = "SYNCING";
  try {
    const r = await api.history({ limit: 200 });
    const items = r.items || [];
    ingest(items);
    const hasMore = items.length >= 200;
    for (const c of state.conversations.values()) c.hasMore = hasMore;
  } catch (e) {
    ui.toast("Could not load history: " + friendlyError(e), true);
  }
  try {
    const map = await api.read(null);
    if (map && map.reads) {
      for (const [peer, rowid] of Object.entries(map.reads)) state.pointers.set(peer, Number(rowid) || 0);
    }
  } catch { /* pointers refresh later */ }
  await loadFriends().catch(() => null);
  await primeUsers();
  ui.renderAll();
  emitFriends();
  if (sync) sync.textContent = "SYNCED";
}

function emitFriends() {
  ui.renderSidebar();
  ui.renderContacts();
}

async function logout() {
  try { await api.logout(); } catch { /* session may already be gone */ }
  setToken("");
  wsDisconnect();
  resetState();
  booted = false;
  ui.showAuth("login");
  setMode("login");
  $("#authUsername").value = lastUsername();
  location.hash = "#/login";
  ui.toast("Signed out");
}

/* ---------------- router ---------------- */

let authNotice = "";

function route() {
  const h = location.hash.replace(/^#\/?/, "");
  const [seg, ...rest] = h.split("/");
  if (!getToken() || !state.user) {
    if (seg === "register") setMode("register");
    else setMode("login");
    ui.showAuth(seg === "register" ? "register" : "login");
    if (authNotice) showErr($("#authError"), authNotice);
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
  const mu = /^u(\d+)$/.exec(peer);
  if (mu) refreshUser(Number(mu[1])).then(() => ui.renderChatHead()).catch(() => null);
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
  if (!bar) return;
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
  requestNotificationPermission();
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
  input.style.height = "28px";
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
    ui.toast("Send failed: " + friendlyError(e), true);
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
    ui.toast("Retry failed: " + friendlyError(e), true);
  }
}

/* ---------------- attachments ---------------- */

const MAX_FILE = 700 * 1024;

$("#sendFileBtn")?.addEventListener("click", () => $("#fileInput").click());
$("#pendingFileCancel")?.addEventListener("click", () => setPendingAttachment(null));

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
    ui.toast("Upload failed: " + friendlyError(e), true);
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
    ui.toast("Download failed: " + friendlyError(e), true);
  }
}

/* ---------------- dialogs ---------------- */

function wireDialogClose(sel) {
  document.querySelectorAll(sel).forEach((b) => {
    b.addEventListener("click", (e) => {
      e.preventDefault();
      b.closest("dialog")?.close();
    });
  });
}
wireDialogClose("dialog .win-cap.close");

function openNewChat() {
  showErr($("#newChatStatus"), "");
  $("#newChatResults").innerHTML = "";
  $("#newChatInput").value = "";
  ui.renderContacts();
  $("#newChatDialog").showModal();
  $("#newChatInput").focus();
}

$("#newChatForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const q = $("#newChatInput").value.trim().replace(/^@/, "");
  if (!q) return;
  const box = $("#newChatResults");
  showErr($("#newChatStatus"), "Searching…");
  box.innerHTML = "";
  try {
    const r = await api.usersSearch(q);
    const users = (r.users || []).filter((u) => String(u.user_id) !== state.user.user_id);
    showErr($("#newChatStatus"), users.length ? "" : "No users found.");
    for (const u of users) {
      state.users.set(String(u.user_id), { ...u, user_id: String(u.user_id) });
      const row = document.createElement("div");
      row.className = "user-item-row";
      const friend = isFriend(u.user_id);
      const pending = outgoingTo(u.user_id);
      const incoming = incomingFrom(u.user_id);
      const online = u.status === "online";
      row.innerHTML = `<button type="button" class="user-item">
        <span class="dot ${online ? "on" : ""}"></span>
        <div><strong>${esc(u.display_name || u.username)}</strong><small>@${esc(u.username)}</small></div>
        <span class="status ${online ? "on" : ""}">${online ? "online" : "offline"}</span>
      </button>
      ${friend ? '<span class="tag-ok">FRIEND</span>'
        : incoming ? '<button type="button" class="mini-btn accept" data-act="accept">ACCEPT</button>'
        : pending ? '<span class="tag-ok">PENDING</span>'
        : '<button type="button" class="mini-btn" data-act="add">Add Friend</button>'}`;
      row.querySelector(".user-item").addEventListener("click", () => {
        $("#newChatDialog").close();
        openChat("u" + u.user_id);
      });
      const act = row.querySelector("[data-act]");
      if (act) {
        act.addEventListener("click", async (ev) => {
          ev.stopPropagation();
          act.disabled = true;
          try {
            if (act.dataset.act === "accept") {
              await api.friendAccept(incoming.request_id);
            } else {
              await api.friendRequest(u.user_id);
            }
            await loadFriends().catch(() => null);
            await primeUsers();
            emitFriends();
            ui.toast(act.dataset.act === "accept" ? "Contact added" : "Contact request sent");
            openNewChatRefresh();
          } catch (err) {
            ui.toast(friendlyError(err), true);
            act.disabled = false;
          }
        });
      }
      box.appendChild(row);
    }
  } catch (e2) {
    showErr($("#newChatStatus"), friendlyError(e2));
  }
});

function openNewChatRefresh() {
  const d = $("#newChatDialog");
  if (!d.open) return;
  ui.renderContacts();
  const q = $("#newChatInput").value.trim();
  if (q) $("#newChatForm").requestSubmit();
}

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
    box.innerHTML = `<p class="hint">${esc(friendlyError(e2))}</p>`;
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
  showErr($("#profileStatus"), "");
  applyServerSettings();
  $("#profileDialog").showModal();
}

$("#profileForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("#profileDisplayName").value.trim();
  if (!name || name.length > 64) { showErr($("#profileStatus"), "Display name must be 1-64 characters."); return; }
  try {
    const r = await api.usersUpdate(name);
    state.user = normalizeUser(r.user ? { user: r.user, role: state.user.role, tenant_id: state.user.tenant_id } : r);
    ui.renderProfile();
    $("#profileName").textContent = state.user.display_name;
    $("#profileAvatar").textContent = ui.initials(state.user.display_name);
    showErr($("#profileStatus"), "");
    $("#profileDialog").close();
    ui.toast("Profile updated");
    ui.renderMessages({ scroll: false });
  } catch (err) {
    showErr($("#profileStatus"), err.message);
  }
});

$("#logoutBtn").addEventListener("click", () => {
  $("#profileDialog").close();
  logout();
});

/* ---------------- app chrome ---------------- */

$("#newChatBtn").addEventListener("click", openNewChat);
$("#startBtn")?.addEventListener("click", openNewChat);
$("#sendImBtn")?.addEventListener("click", openNewChat);
$("#chatSearchBtn").addEventListener("click", openSearch);
$("#settingsBtn")?.addEventListener("click", openProfile);
$("#profileBtn").addEventListener("click", openProfile);
$("#backBtn").addEventListener("click", () => {
  $("#chatPanel").classList.remove("mobile-open");
  $("#chatPanel").classList.add("hidden");
  $("#contactsCol").style.display = "";
  $("#details").classList.add("hidden");
  location.hash = "#/";
});
$("#chatInfoBtn").addEventListener("click", () => $("#details").classList.toggle("hidden"));
$("#closeDetails").addEventListener("click", () => $("#details").classList.add("hidden"));
$("#sendBtn").addEventListener("click", () => sendMessage());
$("#loadOlder").addEventListener("click", loadOlder);

// Composer: Enter sends, Shift+Enter newline; auto-grow textarea (max 5 lines).
const msgInput = $("#messageInput");
msgInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});
msgInput?.addEventListener("input", () => {
  msgInput.style.height = "28px";
  const next = Math.min(msgInput.scrollHeight, 110);
  msgInput.style.height = next + "px";
});

$("#conversationList").addEventListener("click", (e) => {
  const row = e.target.closest(".contact-row");
  if (row) openChat(row.dataset.peer);
});

$("#messageList").addEventListener("click", (e) => {
  const att = e.target.closest("[data-att]");
  if (att) {
    e.preventDefault();
    openAttachment(att.dataset.att, att.dataset.attname);
    return;
  }
  const msg = e.target.closest(".msg-line");
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
    ui.toast("Could not load older messages: " + friendlyError(e), true);
  }
}

/* ---------------- store events ---------------- */

function jumpTo(rowid) {
  const rid = Number(rowid);
  if (!Number.isFinite(rid)) return;
  requestAnimationFrame(() => {
    const el = document.querySelector(`#messageList .msg-line[data-rowid="${rid}"]`);
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
  if (detail && detail.peer && detail.peer !== state.activePeer) {
    const u = state.users.get(String(Number(String(detail.peer).slice(1))));
    notifyIncoming({
      tag: "peer-" + detail.peer,
      title: (u && (u.display_name || u.username)) || "msg.mesh",
      body: "New message",
    });
  }
  if (!detail || detail.peer === state.activePeer) {
    ui.renderMessages();
    if (detail && detail.peer) markRead(detail.peer);
    if (state.activePeer) ui.renderChatHead();
  }
});

on("connection", () => ui.renderConnection());
on("sync", (text) => {
  const sync = $("#syncState");
  if (sync) sync.textContent = text;
  if (text === "SYNCED") loadFriends().catch(() => null);
});
on("friends", async () => {
  await primeUsers().catch(() => null);
  emitFriends();
});
on("readstate", () => {
  ui.renderSidebar();
  if (state.activePeer) ui.renderChatHead();
});

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
  openChat(item.dataset.peer);
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
  if (!confirm("Remove this contact?")) return;
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

$("#sharedFiles").addEventListener("click", async (e) => {
  const item = e.target.closest("[data-att]");
  if (!item) return;
  const id = item.dataset.att;
  const name = item.dataset.attname || "file";
  try {
    const r = await api.download(id);
    const b64 = r.content_base64 || "";
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const blob = new Blob([bytes]);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  } catch (err) {
    ui.toast("Download failed: " + friendlyError(err), true);
  }
});

/* ---------------- menu bar (native-style) ---------------- */

const menuActions = {
  file: [
    ["Open Messenger", () => { location.hash = "#/"; }],
    ["-", null],
    ["Settings...", openProfile],
    ["-", null],
    ["Sign In...", () => { setMode("login"); location.hash = "#/login"; }],
    ["Create Account...", () => { setMode("register"); location.hash = "#/register"; }],
    ["Sign Out", logout],
  ],
  contacts: [
    ["Contact List", () => { ui.setActive(null); }],
    ["Search User...", openNewChat],
    ["Add Friend...", openNewChat],
    ["-", null],
    ["Refresh", () => { loadFriends().catch(() => null); }],
  ],
  actions: [
    ["Sync History", () => { if (booted) initialLoad(); }],
    ["-", null],
    ["Chats List", () => { ui.setActive(null); }],
  ],
  view: [
    ["Contact List", () => { ui.setActive(null); }],
    ["Sync History", () => { if (booted) initialLoad(); }],
  ],
  help: [
    ["Server Status", async () => {
      const h = await api.health();
      ui.toast(h.ok ? "Server: online" : "Server: offline", !h.ok);
    }],
    ["About msg.mesh...", () => ui.toast("msg.mesh 1.0.8 — secure mesh messenger")],
  ],
};

document.querySelectorAll(".menu-item[data-menu]").forEach((item) => {
  let open = null;
  item.addEventListener("click", (e) => {
    e.stopPropagation();
    document.querySelectorAll(".menu-dd").forEach((d) => d.remove());
    document.querySelectorAll(".menu-item.open").forEach((x) => x.classList.remove("open"));
    if (open === item.dataset.menu) { open = null; return; }
    open = item.dataset.menu;
    item.classList.add("open");
    const key = item.dataset.menu;
    const entries = (menuActions[key] || []).filter((en) => en[0] !== "-");
    const dd = document.createElement("div");
    dd.className = "menu-dd";
    dd.style.cssText = "position:fixed;z-index:70;min-width:180px;background:#fff;border:1px solid #788cac;box-shadow:4px 4px 12px rgba(0,0,0,.3);padding:2px 0;font-size:12px";
    for (const en of (menuActions[key] || [])) {
      if (en[0] === "-") {
        const sep = document.createElement("div");
        sep.style.cssText = "height:1px;background:#c8cdd4;margin:3px 6px";
        dd.appendChild(sep);
        continue;
      }
      const row = document.createElement("button");
      row.type = "button";
      row.textContent = en[0];
      row.style.cssText = "display:block;width:100%;text-align:left;border:0;background:none;padding:6px 16px;font-size:12px";
      row.addEventListener("mouseenter", () => { row.style.background = "#3366cc"; row.style.color = "#fff"; });
      row.addEventListener("mouseleave", () => { row.style.background = "none"; row.style.color = "#000"; });
      row.addEventListener("click", (ev) => {
        ev.stopPropagation();
        dd.remove();
        item.classList.remove("open");
        open = null;
        if (en[1]) en[1]();
      });
      dd.appendChild(row);
    }
    const r = item.getBoundingClientRect();
    dd.style.left = Math.min(r.left, window.innerWidth - 190) + "px";
    dd.style.top = r.bottom + "px";
    document.body.appendChild(dd);
  });
});
document.addEventListener("click", () => {
  document.querySelectorAll(".menu-dd").forEach((d) => d.remove());
  document.querySelectorAll(".menu-item.open").forEach((x) => x.classList.remove("open"));
});

/* ---------------- server settings ---------------- */

function applyServerSettings() {
  const input = $("#profileServer");
  if (input) input.value = apiBase() || "";
}

$("#serverApply").addEventListener("click", async () => {
  const input = $("#profileServer");
  const hint = $("#serverHint");
  let value = (input.value || "").trim().replace(/\/+$/, "");
  if (!value) { hint.textContent = "Enter a server URL, e.g. https://host"; return; }
  if (!/^https?:\/\//.test(value)) value = "https://" + value;
  hint.textContent = "Checking server…";
  const btn = $("#serverApply");
  btn.disabled = true;
  try {
    const next = await resolveApiBase(value);
    if (!next) throw new Error("unreachable");
    setApiBase(next);
    hint.textContent = "Server saved. Reconnecting…";
    setToken("");
    wsDisconnect();
    resetState();
    booted = false;
    setTimeout(() => location.reload(), 400);
  } catch {
    hint.textContent = "Cannot reach that server. It was not saved.";
    btn.disabled = false;
  }
});

/* ---------------- presence / focus ---------------- */

setInterval(() => {
  if (booted && getToken()) loadFriends().catch(() => null);
}, 20000);

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  if (booted && getToken()) loadFriends().catch(() => null);
  if (!state.user) return;
  if (state.activePeer) {
    markRead(state.activePeer);
    const u = peerUser(state.activePeer);
    if (u && /^u\d+$/.test(state.activePeer)) {
      refreshUser(Number(state.activePeer.slice(1))).then(() => ui.renderChatHead()).catch(() => null);
    }
  }
});
window.addEventListener("focus", () => {
  if (!state.user || document.visibilityState !== "visible") return;
  if (state.activePeer && /^u\d+$/.test(state.activePeer)) {
    refreshUser(Number(state.activePeer.slice(1))).then(() => ui.renderChatHead()).catch(() => null);
  }
});

/* ---------------- mobile keyboard ---------------- */

function scrollMessagesToBottom() {
  const wrap = $("#messages");
  if (wrap) wrap.scrollTop = wrap.scrollHeight;
}

msgInput?.addEventListener("focus", () => {
  setTimeout(scrollMessagesToBottom, 250);
});

if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", () => {
    if (!state.activePeer) return;
    if (document.activeElement === $("#messageInput")) {
      requestAnimationFrame(scrollMessagesToBottom);
    }
  });
}

/* ---------------- boot ---------------- */

async function boot() {
  ui.renderConnection();
  setMode("login");
  await resolveApiBase();
  if (!getToken()) {
    $("#authUsername").value = lastUsername();
    ui.showAuth("login");
    route();
    return;
  }
  try {
    await startSession();
  } catch (e) {
    setToken("");
    authNotice =
      e instanceof ApiError && e.status === 401
        ? "Session expired — please sign in again."
        : "Cannot reach the msg.mesh server. Check your connection and retry.";
    ui.showAuth("login");
    setMode("login");
    $("#authUsername").value = lastUsername();
    route();
  }
}

boot();
