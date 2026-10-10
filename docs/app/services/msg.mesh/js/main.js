import { api, getToken, setToken, ApiError, friendlyError, resolveApiBase, setApiBase, apiBase, setOnUnauthorized, lastUsername, rememberUsername } from "./api.js";
import { state, on, ingest, pushLocal, findMessage, maxRowid, primeUsers, rememberUser, refreshUser, resetState, loadFriends, isFriend, incomingFrom, outgoingTo, incomingRequests, peerUser, upsertFriend, loadProfile, saveProfile } from "./store.js";
import { connect as wsConnect, disconnect as wsDisconnect } from "./ws.js";
import { requestNotificationPermission, notifyIncoming } from "./notifications.js";
import * as ui from "./ui.js";
import { playSound, primeSound } from "./sound.js";
import { setTheme } from "./theme.js";

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

/* ---------------- auth (XP Welcome logon + register dialog) ---------------- */

let authMode = "login";

function setMode(mode) {
  authMode = mode;
  ui.setAuthTab(mode);
}

// Tile selection: known user (password only) vs Other User (username+password).
$("#tileKnown")?.addEventListener("click", () => {
  ui.selectLogonTile("login");
  const remembered = lastUsername();
  if (remembered) {
    $("#authUsername").value = remembered;
    $("#authPassword").focus();
  } else {
    // No saved account yet: keep the username field visible so sign-in is possible.
    $("#rowUsername").classList.remove("hidden");
    $("#authUsername").value = "";
    $("#authUsername").focus();
  }
});
$("#tileOther")?.addEventListener("click", () => {
  ui.selectLogonTile("other");
  $("#authUsername").value = "";
  $("#authPassword").value = "";
  $("#authUsername").focus();
});

// Register dialog buttons.
$("#addAccountBtn")?.addEventListener("click", () => {
  setMode("register");
  location.hash = "#/register";
});
$("#regClose")?.addEventListener("click", () => setMode("login"));
$("#regBack2")?.addEventListener("click", () => setMode("login"));
$("#registerDialog")?.addEventListener("close", () => {
  if (authMode === "register") authMode = "login";
  if (location.hash === "#/register") location.hash = "#/login";
});

$("#regForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = $("#regUsername2").value.trim();
  const password = $("#regPassword2").value;
  const display = $("#regDisplay2").value.trim() || username;
  const errBox = $("#regError");
  showErr(errBox, "");
  primeSound("logon");
  if (!username || !password) { showErr(errBox, "Username and password are required."); playSound("error"); return; }
  if (password.length < 8) { showErr(errBox, "Password must be 8-128 characters."); playSound("error"); return; }
  const btn = $("#regSubmit2");
  btn.disabled = true;
  try {
    await api.register(username, password, display);
    const r = await api.login(username, password);
    setToken(r.session_token);
    rememberUsername(username);
    $("#registerDialog").close();
    await startSession();
    playSound("logon");
  } catch (err) {
    showErr(errBox, err instanceof ApiError ? friendlyError(err) : "Registration failed.");
    playSound("error");
  } finally {
    btn.disabled = false;
  }
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
  // If "Other User" tile selected, username comes from #authUsername;
  // if known tile selected, prefilled from lastUsername.
  const known = $("#tileKnown")?.classList.contains("sel");
  const username = known
    ? ($("#authUsername").value.trim() || lastUsername() || "")
    : $("#authUsername").value.trim();
  const password = $("#authPassword").value;
  const errBox = $("#authError");
  showErr(errBox, "");
  if (!username) {
    $("#rowUsername")?.classList.remove("hidden");
    showErr(errBox, "Enter your user name.");
    $("#authUsername")?.focus();
    playSound("error");
    return;
  }
  if (!password) { showErr(errBox, "Password is required."); playSound("error"); return; }
  const btn = $("#authSubmit");
  btn.disabled = true;
  const hint = $("#authHint");
  if (hint) hint.textContent = "Contacting server...";
  primeSound("logon");
  try {
    const r = await api.login(username, password);
    setToken(r.session_token);
    rememberUsername(username);
    await startSession();
    playSound("logon");
  } catch (err) {
    showErr(errBox, err instanceof ApiError ? friendlyError(err) : "Sign-in failed.");
    playSound("error");
    if (hint) hint.textContent = "";
  } finally {
    btn.disabled = false;
    if (hint && !errBox.textContent) hint.textContent = "";
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
  ["message", "click", "menu", "error", "notification"].forEach(primeSound);
  if (!location.hash || location.hash === "#/") location.hash = "#/";
  route();
  syncInactive();
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
  primeSound("logoff");
  try { await api.logout(); } catch { /* session may already be gone */ }
  setToken("");
  wsDisconnect();
  resetState();
  booted = false;
  ui.showAuth("login");
  setMode("login");
  playSound("logoff");
  const remembered = lastUsername();
  if (remembered) {
    $("#authUsername").value = remembered;
    $("#knownName").textContent = remembered;
    ui.selectLogonTile("login");
  }
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
  syncInactive();
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
    $("#pendingFileName").innerHTML = '<img src="./assets/xp/icons/Generic Document.png" alt="" width="14" height="14"> ' + esc(att.filename);
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

function selfInitials() {
  if (state.profile && state.profile.avatar) return state.profile.avatar;
  const u = state.user;
  return ui.initials(u ? (u.display_name || u.username) : "");
}

function sanitizeProfileValue(v, max) {
  let s = String(v == null ? "" : v).trim().replace(/[\x00-\x1f\x7f]/g, "");
  return s.length > max ? s.slice(0, max) : s;
}

function renderProfilePreview() {
  const u = state.user;
  if (!u) return;
  $("#profileAvatar").textContent = selfInitials();
  $("#profileName").textContent = u.display_name || u.username;
  $("#profileHandle").textContent = "@" + u.username;
  const sl = $("#profileStatusLine");
  if (sl) sl.textContent = state.profile.status ? "- " + state.profile.status : "";
}

function openProfile() {
  const u = state.user;
  if (!u) return;
  loadProfile();
  renderProfilePreview();
  $("#profileDisplayName").value = u.display_name || "";
  $("#profileStatusText").value = state.profile.status || "";
  $("#profileAbout").value = state.profile.about || "";
  $("#profileAvatarField").value = state.profile.avatar || "";
  showErr($("#profileStatus"), "");
  applyServerSettings();
  $("#profileDialog").showModal();
}

$("#profileForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = sanitizeProfileValue($("#profileDisplayName").value, 64);
  if (!name) { showErr($("#profileStatus"), "Display name must be 1-64 characters."); return; }
  const status = sanitizeProfileValue($("#profileStatusText").value, 128);
  const about = sanitizeProfileValue($("#profileAbout").value, 256);
  const avatar = sanitizeProfileValue($("#profileAvatarField").value, 2);
  try {
    const r = await api.usersUpdate(name);
    state.user = normalizeUser(r.user ? { user: r.user, role: state.user.role, tenant_id: state.user.tenant_id } : r);
    saveProfile({ status, about, avatar });
    ui.renderProfile();
    renderProfilePreview();
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
  $("#contactsCol").classList.remove("contacts-mobile-hidden");
  $("#details").classList.add("hidden");
  location.hash = "#/";
});
$("#chatInfoBtn").addEventListener("click", () => $("#details").classList.toggle("hidden"));
$("#closeDetails").addEventListener("click", () => $("#details").classList.add("hidden"));
$("#sendBtn").addEventListener("click", () => sendMessage());
$("#loadOlder").addEventListener("click", loadOlder);

// Composer: Enter sends, Shift+Enter newline; auto-grow via rows (CSP-safe).
const msgInput = $("#messageInput");
msgInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});
msgInput?.addEventListener("input", () => {
  const lines = Math.min(msgInput.value.split("\n").length, 5);
  msgInput.rows = Math.max(1, lines);
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
  if (detail && detail.item && detail.item.sender_node_id !== state.selfNode) {
    playSound("message");
  }
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

// Icon files map 1:1 to the native client's kXpIcons entries (menu actions
// get the same 16px art the native render_menu_dropdown draws).
const menuActions = {
  file: [
    ["Open Messenger", () => { location.hash = "#/"; }, "Windows Messenger.png"],
    ["-", null],
    ["Settings...", openProfile, "Control Panel.png"],
    // Native File menu has a Theme submenu; web ships the two themes it
    // implements (XP Luna + Windows 98).
    ["Theme", null, null, [
      ["Windows XP", () => setTheme("winxp"), "Theme.png"],
      ["Windows 98", () => setTheme("win98"), "Theme.png"],
    ]],
    ["-", null],
    ["Sign In...", () => { setMode("login"); location.hash = "#/login"; }, "Login Question.png"],
    ["Create Account...", () => { setMode("register"); location.hash = "#/register"; }, "User Accounts.png"],
    ["Sign Out", logout, "Logout.png"],
  ],
  contacts: [
    ["Contact List", () => { ui.setActive(null); }, "Address Book.png"],
    ["Search User...", openNewChat, "Search.png"],
    ["Add Friend...", openNewChat, "User Accounts.png", "address_book_card_users.png"],
    ["-", null],
    ["Refresh", () => { loadFriends().catch(() => null); }, "Network Connections.png"],
  ],
  actions: [
    ["Sync History", () => { if (booted) initialLoad(); }, "IE History.png"],
    ["-", null],
    ["Chats List", () => { ui.setActive(null); }, "Windows Messenger.png"],
  ],
  view: [
    ["Contact List", () => { ui.setActive(null); }, "Address Book.png"],
    ["Sync History", () => { if (booted) initialLoad(); }, "IE History.png"],
  ],
  help: [
    ["Server Status", async () => {
      const h = await api.health();
      ui.toast(h.ok ? "Server: online" : "Server: offline", !h.ok);
    }, "Manage Your Server.png"],
    ["About msg.mesh...", () => {
      const d = $("#aboutDialog");
      if (d && !d.open) d.showModal();
    }, "Properties.png"],
  ],
};

// en = [label, action, iconFile, extra]; extra is either a string (win98 icon
// override passed through to theme.js) or an array (nested submenu, as in the
// native File > Theme flyout). Submenu parent rows carry no icon, matching
// native draw_action_icon (empty action = no art).
function buildMenuRow(en, dd, item) {
  if (en[0] === "-") {
    const sep = document.createElement("div");
    sep.className = "dd-sep";
    dd.appendChild(sep);
    return;
  }
  const isSub = Array.isArray(en[3]);
  const row = document.createElement("button");
  row.type = "button";
  row.className = isSub ? "dd-item has-sub" : "dd-item";
  if (!isSub && en[2]) {
    const ic = document.createElement("img");
    ic.className = "dd-ico";
    ic.src = "./assets/xp/icons/" + en[2];
    ic.alt = "";
    ic.width = 16;
    ic.height = 16;
    if (typeof en[3] === "string") ic.dataset.w98 = en[3];
    row.appendChild(ic);
  }
  row.appendChild(document.createTextNode(en[0]));
  if (isSub) {
    const arrow = document.createElement("span");
    arrow.className = "dd-sub-arrow";
    arrow.textContent = ">";
    row.appendChild(arrow);
    const wrap = document.createElement("div");
    wrap.className = "dd-row-wrap";
    row.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const wasOpen = wrap.classList.contains("sub-open");
      dd.querySelectorAll(".dd-row-wrap.sub-open").forEach((w) => w.classList.remove("sub-open"));
      wrap.classList.toggle("sub-open", !wasOpen);
    });
    const sub = document.createElement("div");
    sub.className = "menu-dd dd-sub";
    for (const child of en[3]) buildMenuRow(child, sub, item);
    wrap.appendChild(row);
    wrap.appendChild(sub);
    dd.appendChild(wrap);
    return;
  }
  row.addEventListener("click", (ev) => {
    ev.stopPropagation();
    document.querySelectorAll(".menu-dd").forEach((d) => d.remove());
    item.classList.remove("open");
    if (en[1]) en[1]();
  });
  dd.appendChild(row);
}

document.querySelectorAll(".menu-item[data-menu]").forEach((item) => {
  const slot = item.closest(".menu-slot") || item.parentElement;
  item.addEventListener("click", (e) => {
    e.stopPropagation();
    document.querySelectorAll(".menu-dd").forEach((d) => d.remove());
    document.querySelectorAll(".menu-item.open").forEach((x) => x.classList.remove("open"));
    if (item.classList.contains("open")) return;
    item.classList.add("open");
    const key = item.dataset.menu;
    const dd = document.createElement("div");
    dd.className = "menu-dd";
    for (const en of (menuActions[key] || [])) buildMenuRow(en, dd, item);
    slot.appendChild(dd);
  });
});
document.addEventListener("click", () => {
  document.querySelectorAll(".menu-dd").forEach((d) => d.remove());
  document.querySelectorAll(".menu-item.open").forEach((x) => x.classList.remove("open"));
});

/* ---------------- native XP sounds + window activation state ---------------- */

// Native dispatch.cpp plays "menu" when a menu opens and "click" on buttons.
// Capture phase: the menubar handler stops propagation, so bubbling would
// never reach this listener for menu titles.
document.addEventListener("click", (e) => {
  try {
    const t = e.target;
    if (t && t.closest && t.closest(".menu-item[data-menu]")) { playSound("menu"); return; }
    if (t && t.closest && t.closest("button, .logon-tile, .win-cap")) playSound("click");
  } catch { /* audio is best-effort */ }
}, true);

// stopPropagation: without it the helpBtn event keeps bubbling to the
// document listener below and closes the dropdown we just opened.
$("#helpBtn")?.addEventListener("click", (e) => {
  e.stopPropagation();
  document.querySelector('.menu-item[data-menu="help"]')?.click();
});

$("#showTimestamps")?.addEventListener("change", (e) => {
  $("#messageList")?.classList.toggle("no-ts", !e.target.checked);
});

$("#aboutOk")?.addEventListener("click", () => $("#aboutDialog")?.close());

// Native XP greys the caption and window body while a dialog owns focus or
// the window sits in the background (titlebar_inactive/window_body_inactive).
function syncInactive() {
  const app = $("#appView");
  if (!app || app.classList.contains("hidden")) return;
  let open = false;
  document.querySelectorAll("dialog").forEach((d) => { if (d.open) open = true; });
  const focused = typeof document.hasFocus === "function" ? document.hasFocus() : true;
  app.classList.toggle("inactive", open || !focused);
}
document.querySelectorAll("dialog").forEach((d) => {
  new MutationObserver(syncInactive).observe(d, { attributes: true, attributeFilter: ["open"] });
});
window.addEventListener("focus", syncInactive);
window.addEventListener("blur", syncInactive);

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
  playSound("startup");
  ui.renderConnection();
  setMode("login");
  await resolveApiBase();
  const remembered = lastUsername();
  if (remembered) {
    $("#authUsername").value = remembered;
    $("#knownName").textContent = remembered;
    ui.selectLogonTile("login");
  } else {
    ui.selectLogonTile("other");
    $("#knownName").textContent = "Sign In";
  }
  if (!getToken()) {
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
    route();
  }
}

boot();
