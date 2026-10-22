import { api, getToken, setToken, ApiError, friendlyError, resolveApiBase, setApiBase, apiBase, setOnUnauthorized, setOnServerSwitch, lastUsername, rememberUsername } from "./infrastructure/api/index.js";
import { state, on, ingest, ingestOne, pushLocal, findMessage, maxRowid, primeUsers, rememberUser, refreshUser, resetState, loadFriends, loadBlocked, loadGroups, loadRoles, isFriend, isBlocked, isTyping, setTyping, clearTyping, peerOnline, incomingFrom, outgoingTo, incomingRequests, peerUser, upsertFriend, loadProfile, saveProfile, refreshConversations, clearProfileCache, conv, peerLabel, hasChatPerm, myRank, roleRank, isSelfMuted } from "./core/state.js";
import { connect as wsConnect, disconnect as wsDisconnect, forceReconnect as wsForceReconnect } from "./infrastructure/ws/index.js";
import { requestNotificationPermission, notifyIncoming } from "./infrastructure/notifications.js";
import * as ui from "./ui.js";
import { openAdminPanel, adminTabVisible, renderAdminUsers } from "./domains/admin/panel.js";
import { composerState } from "./core/composer-state.js";
import { msgInput, onComposerSend, getPendingAttachment, setPendingAttachment, syncSendEnabled, updateCharCount, maybeSendTyping, scheduleDraftSave, flushDraft, restoreDraft, clearDraft, clearDrafts } from "./domains/chat/composer.js";
import { cancelReply, cancelEdit, saveEdit, toggleReaction, togglePin } from "./domains/chat/actions.js";
import { cancelActiveUpload, openAttachment, setFilesSessionLost } from "./domains/files/index.js";
import "./domains/chat/emoji-gif.js";
import "./adapters/call-dialog.js";
import { playSound, primeSound } from "./infrastructure/sound.js";
import { setTheme } from "./infrastructure/theme.js";
import * as Call from "./call.js";
import { showErr } from "./shared/dom.js";
import { startServerWatch, stopServerWatch } from "./infrastructure/server-watch.js";

onComposerSend(sendMessage);
setFilesSessionLost(handleSessionLost);

const $ = ui.$;
const esc = ui.esc;

function uid() {
  return "tmp-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
}

function normalizeUser(payload) {
  const u = payload.user || payload;
  const appRole = String(u.app_role || payload.app_role || "").toLowerCase();
  const perms = u.chat_permissions || payload.chat_permissions;
  // Login/whoami carry the role ladder; loadRoles() later refines it with the
  // full roster but this makes gating correct before that round-trip lands.
  if (appRole) {
    state.myRole = ["owner", "admin", "moderator", "member"].includes(appRole) ? appRole : "member";
    if (Array.isArray(perms)) state.myPerms = new Set(perms);
  }
  const known = ["owner", "admin", "moderator", "member"];
  const resolved = known.includes(appRole) ? appRole
    : (known.includes(state.myRole) ? state.myRole : "member");
  return {
    user_id: String(u.user_id ?? ""),
    username: u.username || "",
    display_name: u.display_name || u.username || "",
    role: u.role || payload.role || "user",
    tenant_id: u.tenant_id || payload.tenant_id || "",
    status: u.status || "online",
    app_role: resolved,
  };
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
  errBox?.classList.remove("note");
  errBox?.classList.add("error");
  showErr(errBox, "");
  primeSound("logon");
  if (!username || !password) { showErr(errBox, "Username and password are required."); playSound("error"); return; }
  if (password.length < 8) { showErr(errBox, "Password must be 8-128 characters."); playSound("error"); return; }
  const btn = $("#regSubmit2");
  btn.disabled = true;
  // Never race the boot probe: an unresolved base would POST to the page
  // origin (GitHub Pages answers 405) instead of the msg.mesh server.
  if (!apiBase()) await resolveApiBase();
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
    if (!(err instanceof ApiError) || err.status === 0 || err.status === 502 || err.status === 503) {
      startServerWatch(() => { authNotice = ""; });
    }
    playSound("error");
  } finally {
    btn.disabled = false;
  }
});

/* ---------------- change / reset password ---------------- */

function openChangePw() {
  const d = $("#changePwDialog");
  if (!d || d.open) return;
  showErr($("#changePwError"), "");
  $("#changePwForm")?.reset();
  d.showModal();
}

$("#changePwForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const oldP = $("#curPw").value;
  const newP = $("#newPw").value;
  const newP2 = $("#newPw2").value;
  const errBox = $("#changePwError");
  showErr(errBox, "");
  if (!oldP || !newP) { showErr(errBox, "Both passwords are required."); playSound("error"); return; }
  if (newP.length < 8) { showErr(errBox, "Password must be 8-128 characters."); playSound("error"); return; }
  if (newP !== newP2) { showErr(errBox, "New passwords do not match."); playSound("error"); return; }
  const btn = $("#changePwSave");
  btn.disabled = true;
  try {
    await api.changePassword(oldP, newP);
    $("#changePwDialog").close();
    ui.toast("Password changed - sign in again");
    // The server revoked every session for the account; return to logon.
    await logout();
  } catch (err) {
    // 401 here means the CURRENT password was wrong, not a dead session.
    const msg = err instanceof ApiError && err.status === 401
      ? "Current password is incorrect."
      : err instanceof ApiError ? friendlyError(err) : "Could not change password.";
    showErr(errBox, msg);
    playSound("error");
  } finally {
    btn.disabled = false;
  }
});

// Forgot password: no self-service reset exists by design — only the server
// administrator (owner, from the Admin Panel) or the operator with config
// access can reset an account. Point the user there instead of asking for a
// server key they cannot have.
$("#forgotPwBtn")?.addEventListener("click", () => {
  ui.msgBox({
    title: "Reset Password",
    icon: "info",
    text: "Only the server administrator can reset a password. Contact them and ask them to reset your account — they can do it from the Admin Panel.",
    cancelLabel: "",
  });
});

// Win98 classic logon Cancel: clear both fields and return focus to user name.
$("#w98CancelBtn")?.addEventListener("click", () => {
  $("#authUsername").value = "";
  $("#authPassword").value = "";
  showErr($("#authError"), "");
  $("#authUsername").focus();
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
  // A manual sign-in supersedes any pending throttled boot retry.
  if (bootRetryTimer) {
    clearTimeout(bootRetryTimer);
    bootRetryTimer = 0;
  }
  // Never race the boot probe: an unresolved base would POST to the page
  // origin (GitHub Pages answers 405) instead of the msg.mesh server.
  if (!apiBase()) await resolveApiBase();
  try {
    const r = await api.login(username, password);
    setToken(r.session_token);
    rememberUsername(username);
    await startSession();
    playSound("logon");
  } catch (err) {
    showErr(errBox, err instanceof ApiError ? friendlyError(err) : "Sign-in failed.");
    if (hint) hint.textContent = "";
    if (!(err instanceof ApiError) || err.status === 0 || err.status === 502 || err.status === 503) {
      startServerWatch(() => { authNotice = ""; });
    }
    playSound("error");
  } finally {
    btn.disabled = false;
    if (hint && !errBox.textContent) hint.textContent = "";
  }
});

/* ---------------- session lifecycle ---------------- */

let booted = false;

function handleSessionLost() {
  if (!getToken()) return;
  cancelActiveUpload();
  ui.clearAttachmentImageCache();
  if (Call.isCallActive()) Call.endCall(); // signaling dies with the session
  setToken("");
  wsDisconnect();
  resetState();
  clearProfileCache();
  booted = false;
  authNotice = "Session expired — please sign in again.";
  ui.showAuth("login");
  setMode("login");
  $("#authUsername").value = lastUsername();
  if (location.hash === "#/login" || location.hash === "#" || !location.hash) route();
  else location.hash = "#/login";
}
setOnUnauthorized(handleSessionLost);
// Mid-session node failover: the old socket points at the dead node, so drop
// it now and reconnect against the base we just switched to (ws.js would
// otherwise wait for the 30s x2 watchdog to notice the half-open connection).
setOnServerSwitch(() => {
  ui.clearAttachmentImageCache();
  try { wsForceReconnect(); } catch { /* reconnect loop continues */ }
});

// localStorage changes are not reflected in this module's in-memory token.
// Keep other tabs aligned when a user signs out or switches accounts.
window.addEventListener("storage", (event) => {
  if (event.key !== "msg.mesh.token") return;
  const nextToken = event.newValue || "";
  if (nextToken === getToken()) return;

  cancelActiveUpload();
  if (Call.isCallActive()) Call.endCall();
  wsDisconnect();
  setToken(nextToken);
  resetState();
  clearProfileCache();
  ui.clearAttachmentImageCache();
  booted = false;

  if (!nextToken) {
    ui.showAuth("login");
    setMode("login");
    location.hash = "#/login";
    ui.toast("Signed out in another tab.");
    return;
  }
  startSession().catch(() => {
    if (getToken() === nextToken) handleSessionLost();
  });
});

async function startSession() {
  const sessionToken = getToken();
  if (!sessionToken) throw new ApiError(401, { error: "session missing" });
  try {
    const w = await api.whoami({ allow401: true });
    // Login/logout/server-switch can race an in-flight whoami request. Never
    // hydrate the app with the identity returned for a token that is no longer
    // the active session.
    if (getToken() !== sessionToken) throw new ApiError(401, { error: "session changed" });
    const nextUser = normalizeUser(w);
    if (state.user && state.user.user_id !== nextUser.user_id) {
      // Attachment IDs and the profile cache are private to an account.
      // Clear them before any asynchronous profile/history work for the new one.
      ui.clearAttachmentImageCache();
      clearProfileCache();
    }
    state.user = nextUser;
    const sessionUserId = state.user.user_id;
    await syncProfileFromServer(w.profile, sessionToken, sessionUserId);
    if (getToken() !== sessionToken || !state.user || state.user.user_id !== sessionUserId) {
      // A newer login may already have populated state.user; do not clear or
      // overwrite state owned by that newer session from this stale promise.
      throw new ApiError(401, { error: "session changed" });
    }
  } catch (e) {
    // A 429 is a temporary throttle, not a dead session: keep the token so
    // the caller can retry without forcing a re-login.
    if (!(e instanceof ApiError && e.status === 429) && getToken() === sessionToken) setToken("");
    throw e;
  }
  state.selfNode = "u" + state.user.user_id;
  booted = false;
  stopServerWatch();
  ui.showApp();
  ui.renderProfile();
  applyServerSettings();
  ui.setActive(null);
  await initialLoad();
  restoreOutbox();
  ui.renderSidebar();
  wsConnect();
  booted = true;
  ["message", "click", "menu", "error", "notification", "call"].forEach(primeSound);
  if (!location.hash || location.hash === "#/") location.hash = "#/";
  route();
  syncInactive();
  ui.toast("Signed in as " + (state.user.display_name || state.user.username));
}

// The server owns the profile (shared with the native client); localStorage
// only caches it for offline rendering. A legacy local-only profile is
// migrated to the server once so it stops being device-private.
async function syncProfileFromServer(serverProfile, sessionToken = getToken(), sessionUserId = state.user && state.user.user_id) {
  const has = (v) => typeof v === "string" && v.length > 0;
  const sp = serverProfile || {};
  const sessionIsCurrent = () => getToken() === sessionToken &&
    !!state.user && state.user.user_id === sessionUserId;
  if (!sessionIsCurrent()) return;

  // The legacy profile cache was global to the browser, not account-scoped.
  // Never let it leak into a different account after a tab reload or account
  // switch. Migrate an unowned legacy cache only when the remembered username
  // matches the account that just authenticated.
  const profileOwnerKey = "msg.mesh.profileOwner";
  const userId = String(sessionUserId || "");
  try {
    const cachedOwner = localStorage.getItem(profileOwnerKey) || "";
    const remembered = lastUsername().trim().toLowerCase();
    const currentUsername = String(state.user.username || "").trim().toLowerCase();
    if ((cachedOwner && cachedOwner !== userId) ||
        (!cachedOwner && remembered !== currentUsername)) {
      clearProfileCache();
    }
    localStorage.setItem(profileOwnerKey, userId);
  } catch { /* private mode: in-memory session checks still apply */ }

  const migrationKey = "msg.mesh.profileMigrated." + userId;
  const markMigrated = () => {
    try { localStorage.setItem(migrationKey, "1"); } catch { /* storage may be unavailable */ }
  };
  const alreadyMigrated = (() => {
    try { return localStorage.getItem(migrationKey) === "1"; } catch { return false; }
  })();
  const serverHas = has(sp.status_text) || has(sp.about) || has(sp.avatar) || has(sp.photo) || has(sp.banner);
  if (serverHas) {
    if (!sessionIsCurrent()) return;
    saveProfile({
      status: sp.status_text || "",
      about: sp.about || "",
      avatar: sp.avatar || "",
      photo: sp.photo || "",
      banner: sp.banner || "",
    });
    // An intentionally empty profile after a later edit must not resurrect
    // stale local values on the next sign-in.
    markMigrated();
    return;
  }
  if (alreadyMigrated) {
    if (!sessionIsCurrent()) return;
    saveProfile({ status: "", about: "", avatar: "", photo: "", banner: "" });
    return;
  }
  if (!sessionIsCurrent()) return;
  const local = loadProfile();
  const localHas = local.status || local.about || local.avatar || local.photo || local.banner;
  if (!localHas) {
    if (sessionIsCurrent()) markMigrated();
    return;
  }
  try {
    await api.usersUpdate({
      status_text: local.status,
      about: local.about,
      avatar: local.avatar,
      photo: local.photo,
      banner: local.banner,
    });
    if (sessionIsCurrent()) markMigrated();
  } catch { /* keep the local cache; retry migration on next sign-in */ }
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
  await refreshConversations(true);
  await loadFriends().catch(() => null);
  await Promise.all([loadBlocked().catch(() => null), loadGroups().catch(() => null), loadRoles().catch(() => null)]);
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
  cancelActiveUpload();
  ui.clearAttachmentImageCache();
  if (Call.isCallActive()) Call.endCall(); // signaling dies with the session
  try { await api.logout(); } catch { /* session may already be gone */ }
  setToken("");
  wsDisconnect();
  clearOutbox();
  clearDrafts();
  resetState();
  clearProfileCache(); // do not leave PII/photo on shared device after sign-out
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
  flushDraft();
  const existed = state.conversations.has(peer);
  if (!existed) {
    const m = /^u(\d+)$/.exec(peer);
    if (m) rememberUser(m[1]);
  }
  ui.setActive(peer);
  ensurePeerHistory(peer);
  // Reply/edit modes are per-conversation: never carry them across chats.
  cancelReply();
  cancelEdit();
  restoreDraft(peer);
  if (opts.push !== false && location.hash !== "#/chat/" + encodeURIComponent(peer)) {
    location.hash = "#/chat/" + encodeURIComponent(peer);
  }
  const mu = /^u(\d+)$/.exec(peer);
  if (mu) refreshUser(Number(mu[1])).then(() => ui.renderChatHead()).catch(() => null);
  markRead(peer);
  if (opts.jumpRowid) jumpTo(opts.jumpRowid);
  syncSendEnabled();
}

window.addEventListener("hashchange", route);

/* ---------------- read state ---------------- */

const readRequestsInFlight = new Set();

async function markRead(peer) {
  if (!peer || readRequestsInFlight.has(peer) || !getToken()) return;
  const sessionToken = getToken();
  const sessionUserId = state.user && state.user.user_id;
  const max = maxRowid(peer);
  if (!max) return;
  const ptr = state.pointers.get(peer) || 0;
  if (max <= ptr) return;

  // Coalesce overlapping focus/open/message events into one request per peer.
  // If a newer message arrives while it is in flight, send one follow-up after
  // the successful response instead of flooding the server with duplicates.
  const requestedMax = max;
  readRequestsInFlight.add(peer);
  let succeeded = false;
  try {
    const r = await api.read(peer, requestedMax);
    // An HTTP response from a previous account must never mutate the new
    // account's read pointers after logout, expiry, or a fast account switch.
    if (getToken() !== sessionToken || !state.user || state.user.user_id !== sessionUserId) return;
    if (r && typeof r.my_last_read_rowid === "number") {
      const cur = state.pointers.get(peer) || 0;
      if (r.my_last_read_rowid > cur) state.pointers.set(peer, r.my_last_read_rowid);
    }
    if (r && typeof r.peer_last_read_rowid === "number" && r.peer_last_read_rowid >= 0) {
      const curP = state.peerPointers.get(peer) || 0;
      if (r.peer_last_read_rowid > curP) state.peerPointers.set(peer, r.peer_last_read_rowid);
    }
    const meta = state.convMeta.get(peer);
    if (meta) meta.unread = 0;
    refreshConversations();
    ui.renderSidebar();
    if (state.activePeer === peer) ui.renderChatHead();
    succeeded = true;
  } catch { /* pointer retried on next event */ }
  finally {
    readRequestsInFlight.delete(peer);
    const latest = maxRowid(peer);
    const current = state.pointers.get(peer) || 0;
    if (succeeded && latest > requestedMax && latest > current) {
      queueMicrotask(() => markRead(peer));
    }
  }
}

/* ---------------- sending ---------------- */

async function sendMessage() {
  const input = $("#messageInput");
  const text = input.value.trim();
  const peer = state.activePeer;
  const sessionToken = getToken();
  const sessionUserId = state.user && state.user.user_id;
  if (!peer || (!text && !getPendingAttachment())) return;
  if (composerState.editingMsg) {
    saveEdit(composerState.editingMsg, text);
    return;
  }
  if (isSelfMuted()) {
    const muted = state.roles.get(state.user && state.user.user_id);
    ui.toast("You are muted until " + ((muted && muted.muted_until) || "later") + ".", true);
    return;
  }
  requestNotificationPermission();
  const att = getPendingAttachment();
  const env = {
    v: 1,
    from: Number(state.user.user_id),
    from_name: state.user.display_name || state.user.username,
    ts: Date.now(),
    text,
  };
  if (att) env.attachment = { id: att.id, filename: att.filename, type: att.content_type, size: att.size_bytes };
  if (composerState.replyTarget && composerState.replyTarget.id) {
    // Reply rides in the envelope only: it never touches mesh_messages
    // columns, so the whole history shape stays stable server-side.
    env.reply = {
      id: composerState.replyTarget.id,
      rowid: composerState.replyTarget.rowid != null ? composerState.replyTarget.rowid : null,
      from: composerState.replyTarget.sender,
      text: String(composerState.replyTarget.text || (composerState.replyTarget.attachment ? composerState.replyTarget.attachment.filename : "") || "").slice(0, 140),
    };
  }
  const tmp = uid();
  const local = pushLocal(peer, { id: tmp, text, env, attachment: env.attachment || null });
  // Stable id for retries: the server dedupes sends by client_msg_id, so a
  // retry after a lost response returns the original message, not a copy.
  local.clientId = tmp;
  outboxPut({ peer, id: tmp, type: "text", env, ts: env.ts });
  input.value = "";
  clearDraft(peer);
  setPendingAttachment(null);
  cancelReply();
  ui.renderMessages();
  ui.renderSidebar();

  try {
    const r = await api.send(peer, "text", JSON.stringify(env), tmp);
    if (getToken() !== sessionToken || !state.user || state.user.user_id !== sessionUserId) return;
    if (!r || !r.message_id) throw new ApiError(502, { error: "server did not confirm the message" });
    const m = findMessage(peer, tmp);
    if (m && r.message_id) {
      m.id = r.message_id;
      if (m.rowid == null && typeof r.rowid === "number") m.rowid = r.rowid;
      if (m.sync === "sending") m.sync = "sent";
      m.retryable = false;
      ui.renderMessages({ scroll: false });
    }
    outboxDrop(tmp);
    markRead(peer);
  } catch (e) {
    if (getToken() !== sessionToken || !state.user || state.user.user_id !== sessionUserId) return;
    const m = findMessage(peer, tmp);
    if (m) {
      m.sync = "failed";
      m.retryable = isRetryableSendError(e);
    }
    ui.renderMessages({ scroll: false });
    // The server's mute/ban fences carry specifics the generic 403 copy
    // would hide ("muted until …"); surface them verbatim.
    const serverMsg = e && e.payload && (e.payload.muted || e.payload.banned) ? e.payload.error : "";
    ui.toast("Send failed: " + (serverMsg || friendlyError(e)), true);
    if (e && e.payload && e.payload.muted) loadRoles().catch(() => null);
  }
  if (getToken() === sessionToken && state.user && state.user.user_id === sessionUserId) ui.renderSidebar();
}

function isRetryableSendError(error) {
  const status = Number(error && error.status);
  return status === 0 || status === 408 || status === 429 ||
    status === 500 || status === 502 || status === 503;
}

async function retryMessage(peer, m) {
  const sessionToken = getToken();
  const sessionUserId = state.user && state.user.user_id;
  m.sync = "sending";
  ui.renderMessages({ scroll: false });
  const cid = m.clientId || (String(m.id).startsWith("tmp-") ? m.id : "");
  try {
    const r = await api.send(peer, m.type || "text", JSON.stringify(m.env), cid || undefined);
    if (getToken() !== sessionToken || !state.user || state.user.user_id !== sessionUserId) return false;
    if (!r || !r.message_id) {
      m.sync = "failed";
      m.retryable = true;
      ui.renderMessages({ scroll: false });
      ui.renderSidebar();
      ui.toast("The server did not confirm the message. You can retry it.", true);
      return false;
    }
    if (findMessage(peer, m.id)) {
      const cur = findMessage(peer, m.id);
      cur.id = r.message_id;
      if (cur.rowid == null && typeof r.rowid === "number") cur.rowid = r.rowid;
      cur.sync = "sent";
      cur.retryable = false;
      ui.renderMessages({ scroll: false });
      markRead(peer);
    }
    outboxDrop(m.clientId || m.id);
    ui.renderSidebar();
    return true;
  } catch (e) {
    if (getToken() !== sessionToken || !state.user || state.user.user_id !== sessionUserId) return false;
    m.sync = "failed";
    m.retryable = isRetryableSendError(e);
    ui.renderMessages({ scroll: false });
    ui.renderSidebar();
    ui.toast("Retry failed: " + friendlyError(e), true);
    return false;
  }
}

const OUTBOX_MAX = 200;
const OUTBOX_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

function outboxKey() {
  const id = state.user && state.user.user_id;
  return id ? "msg.mesh.outbox." + id : "";
}

function readOutbox() {
  const key = outboxKey();
  if (!key) return [];
  try {
    const list = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}

function writeOutbox(list) {
  const key = outboxKey();
  if (!key) return;
  try {
    if (list.length) localStorage.setItem(key, JSON.stringify(list.slice(-OUTBOX_MAX)));
    else localStorage.removeItem(key);
  } catch { /* private mode */ }
}

function outboxPut(entry) {
  const list = readOutbox().filter((q) => q && q.id !== entry.id);
  list.push(entry);
  writeOutbox(list);
}

function outboxDrop(id) {
  const list = readOutbox();
  const next = list.filter((q) => q && q.id !== id);
  if (next.length !== list.length) writeOutbox(next);
}

function clearOutbox() {
  const key = outboxKey();
  if (key) {
    try { localStorage.removeItem(key); } catch { /* private mode */ }
  }
}

// Re-materialize undelivered messages from a previous session as visible
// failed entries: the reconnect burst (or a manual click) retries them with
// their original client_msg_id, so a send that actually landed before the
// crash cannot duplicate. Entries whose server copy is already in the loaded
// window are simply dropped from the outbox.
function restoreOutbox() {
  const list = readOutbox();
  if (!list.length) return;
  const now = Date.now();
  const keep = [];
  for (const e of list) {
    if (!e || !e.peer || !e.id || typeof e.id !== "string") continue;
    if (now - (Number(e.ts) || 0) > OUTBOX_MAX_AGE) continue;
    const env = e.env && typeof e.env === "object" ? e.env : {};
    const text = typeof env.text === "string" ? env.text : "";
    const attId = (env.attachment && env.attachment.id) || "";
    const existing = state.conversations.get(e.peer);
    const dup = existing && existing.messages.find((m) => m.mine &&
      (m.id === e.id ||
        (m.rowid != null &&
          (Number(m.env && m.env.ts) || 0) === (Number(e.ts) || 0) &&
          (m.text || "") === text &&
          ((m.env && m.env.attachment && m.env.attachment.id) || "") === attId)));
    if (dup) continue;
    const m = pushLocal(e.peer, {
      id: e.id,
      text,
      env,
      attachment: env.attachment || null,
      ts: Number(e.ts) || Date.now(),
    });
    m.clientId = e.id;
    m.sync = "failed";
    m.retryable = true;
    keep.push(e);
  }
  writeOutbox(keep);
}

window.addEventListener("beforeunload", () => flushDraft());

/* ---------------- dialogs ---------------- */

function wireDialogClose(sel) {
  document.querySelectorAll(sel).forEach((b) => {
    b.addEventListener("click", (e) => {
      e.preventDefault();
      b.closest("dialog")?.close();
    });
  });
}
wireDialogClose("dialog .win-cap.close:not(#callClose)"); // callâœ• routes through dismissCall()

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
  box.innerHTML = '<p class="hint"><img class="hourglass" src="./assets/xp/gifs/hourglass.gif" alt=""> Searching…</p>';
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
  box.innerHTML = '<p class="hint"><img class="hourglass" src="./assets/xp/gifs/hourglass.gif" alt=""> Searching…</p>';
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
      btn.innerHTML = `<strong>${esc(mine ? "You â†’ " + peerLabelSafe(peer) : peerLabelSafe(peer) + " â†’ you")}</strong>
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

function readImageScaled(file, maxW, maxH, mime, quality) {
  return new Promise((resolve, reject) => {
    if (!file || String(file.type || "").indexOf("image/") !== 0) { reject(new Error("Choose an image file.")); return; }
    if (file.size > 8 * 1024 * 1024) { reject(new Error("Image too large (max 8 MB).")); return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight, 1);
        const w = Math.max(1, Math.round(img.naturalWidth * scale));
        const h = Math.max(1, Math.round(img.naturalHeight * scale));
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        const ctx = c.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL(mime, quality));
      } catch (err) {
        reject(err);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not read image.")); };
    img.src = url;
  });
}

let pendingPhoto = "";
let pendingBanner = "";
let pendingPhotoName = "";
let pendingBannerName = "";

function renderPhotoBannerPreview() {
  const pt = $("#profileAvatarText");
  if (pt) pt.textContent = selfInitials();
  ui.applyAvatarPhoto($("#profileAvatarImg"), pt, pendingPhoto);
  const strip = $("#profileBannerStrip");
  const bimg = $("#profileBannerImg");
  if (strip && bimg) {
    if (pendingBanner) {
      bimg.src = pendingBanner;
      strip.classList.remove("hidden");
    } else {
      bimg.removeAttribute("src");
      strip.classList.add("hidden");
    }
  }
  const pn = $("#profilePhotoName");
  if (pn) pn.textContent = pendingPhoto ? pendingPhotoName || "Photo set" : "No photo";
  const bn = $("#profileBannerName");
  if (bn) bn.textContent = pendingBanner ? pendingBannerName || "Banner set" : "No banner";
}

function renderProfilePreview() {
  const u = state.user;
  if (!u) return;
  renderPhotoBannerPreview();
  $("#profileName").textContent = u.display_name || u.username;
  $("#profileHandle").textContent = "@" + u.username;
  const sl = $("#profileStatusLine");
  if (sl) sl.textContent = state.profile.status ? "- " + state.profile.status : "";
}

function openProfile() {
  const u = state.user;
  if (!u) return;
  pendingPhoto = state.profile.photo || "";
  pendingBanner = state.profile.banner || "";
  pendingPhotoName = "";
  pendingBannerName = "";
  renderProfilePreview();
  $("#profileDisplayName").value = u.display_name || "";
  $("#profileStatusText").value = state.profile.status || "";
  $("#profileAbout").value = state.profile.about || "";
  $("#profileAvatarField").value = state.profile.avatar || "";
  showErr($("#profileStatus"), "");
  $("#profileDialog").showModal();
}

function openSettings() {
  applyServerSettings();
  $("#settingsDialog").showModal();
  // Refresh from the server so the list survives a reload/account switch.
  loadBlocked().catch(() => null).finally(() => renderBlockedList());
}

function wireImagePicker(btnId, inputId, clearId, maxW, maxH, mime, quality, apply) {
  const btn = $(btnId);
  const input = $(inputId);
  const clear = $(clearId);
  btn?.addEventListener("click", () => input.click());
  clear?.addEventListener("click", () => {
    apply("", "");
    showErr($("#profileStatus"), "");
    renderPhotoBannerPreview();
  });
  input?.addEventListener("change", async (e) => {
    const f = e.target.files && e.target.files[0];
    const fname = f ? f.name : "";
    e.target.value = "";
    if (!f) return;
    try {
      const dataUrl = await readImageScaled(f, maxW, maxH, mime, quality);
      apply(dataUrl, fname);
      showErr($("#profileStatus"), "");
      renderPhotoBannerPreview();
    } catch (err) {
      showErr($("#profileStatus"), err.message);
    }
  });
}

wireImagePicker("#profilePhotoBrowse", "#profilePhotoInput", "#profilePhotoClear", 160, 160, "image/png", undefined, (v, n) => {
  pendingPhoto = v;
  pendingPhotoName = n || "";
});
wireImagePicker("#profileBannerBrowse", "#profileBannerInput", "#profileBannerClear", 600, 160, "image/jpeg", 0.85, (v, n) => {
  pendingBanner = v;
  pendingBannerName = n || "";
});

$("#profileForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const sessionToken = getToken();
  const sessionUserId = state.user && state.user.user_id;
  if (!sessionToken || !sessionUserId) return;
  const name = sanitizeProfileValue($("#profileDisplayName").value, 64);
  if (!name) { showErr($("#profileStatus"), "Display name must be 1-64 characters."); return; }
  const status = sanitizeProfileValue($("#profileStatusText").value, 128);
  const about = sanitizeProfileValue($("#profileAbout").value, 256);
  const avatar = sanitizeProfileValue($("#profileAvatarField").value, 2);
  try {
    // One server round-trip: the server stores every field and returns the
    // canonical profile, which we mirror into the local cache.
    const r = await api.usersUpdate({
      display_name: name,
      status_text: status,
      about,
      avatar,
      photo: pendingPhoto,
      banner: pendingBanner,
    });
    if (getToken() !== sessionToken || !state.user || state.user.user_id !== sessionUserId) return;
    state.user = normalizeUser(r.user ? { user: r.user, role: state.user.role, tenant_id: state.user.tenant_id } : r);
    const sp = (r.user && r.user.profile) || {};
    if (!saveProfile({
      status: typeof sp.status_text === "string" ? sp.status_text : status,
      about: typeof sp.about === "string" ? sp.about : about,
      avatar: typeof sp.avatar === "string" ? sp.avatar : avatar,
      photo: typeof sp.photo === "string" ? sp.photo : pendingPhoto,
      banner: typeof sp.banner === "string" ? sp.banner : pendingBanner,
    })) {
      showErr($("#profileStatus"), "Profile is too large for browser storage.");
      return;
    }
    ui.renderProfile();
    renderProfilePreview();
    showErr($("#profileStatus"), "");
    $("#profileDialog").close();
    ui.toast("Profile updated");
    ui.renderMessages({ scroll: false });
  } catch (err) {
    showErr($("#profileStatus"), friendlyError(err));
  }
});

$("#logoutBtn").addEventListener("click", () => {
  $("#settingsDialog").close();
  logout();
});

/* ---------------- app chrome ---------------- */

$("#newChatBtn").addEventListener("click", openNewChat);
$("#startBtn")?.addEventListener("click", openNewChat);
$("#emptyAddBtn")?.addEventListener("click", openNewChat);
$("#sendImBtn")?.addEventListener("click", openNewChat);
$("#chatSearchBtn").addEventListener("click", openSearch);
$("#settingsBtn")?.addEventListener("click", openSettings);
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

/* ---------------- new messages pill + smart scroll ---------------- */
const newMsgsPill = $("#newMsgsPill");
const messagesWrap = $("#messages");
newMsgsPill?.addEventListener("click", () => {
  if (messagesWrap) messagesWrap.scrollTop = messagesWrap.scrollHeight;
  newMsgsPill.classList.add("hidden");
});
messagesWrap?.addEventListener("scroll", () => {
  if (!newMsgsPill) return;
  const atBottom = messagesWrap.scrollHeight - messagesWrap.scrollTop - messagesWrap.clientHeight < 60;
  if (atBottom) newMsgsPill.classList.add("hidden");
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
  const react = e.target.closest("[data-react]");
  if (react) {
    const line = react.closest(".msg-line");
    const c = state.conversations.get(state.activePeer);
    const m = line && c ? c.messages.find((x) => x.id === line.dataset.id) : null;
    if (m) toggleReaction(m, react.getAttribute("data-react"));
    return;
  }
  const quote = e.target.closest(".reply-quote");
  if (quote) {
    const rid = quote.getAttribute("data-jumprow");
    if (rid) jumpTo(rid);
    return;
  }
  const msg = e.target.closest(".msg-line");
  if (msg && msg.classList.contains("failed")) {
    const c = state.conversations.get(state.activePeer);
    const m = c && c.messages.find((x) => x.id === msg.dataset.id);
    if (m) retryMessage(state.activePeer, m);
  }
});

// Pinned-message strip: jump to the pinned message or unpin it in place.
$("#pinnedStrip")?.addEventListener("click", (e) => {
  const c = state.conversations.get(state.activePeer);
  if (!c) return;
  const pinned = [...c.messages].reverse().find((m) => m.pinned && !m.deleted);
  if (!pinned) return;
  if (e.target.closest(".pinned-x")) {
    togglePin(pinned);
    return;
  }
  if (e.target.closest(".pinned-jump") && pinned.rowid != null) jumpTo(pinned.rowid);
});

const historyLoads = new Set();

// Conversations created after the boot window (fresh WS message, sidebar row
// that only carries metadata) start with hasMore=null: load their first page
// from the server when they are opened so the transcript is never empty or
// truncated. Boot-window conversations already know their state.
async function ensurePeerHistory(peer) {
  if (!peer || historyLoads.has(peer)) return;
  const c = conv(peer);
  if (c.hasMore !== null) return;
  const sessionToken = getToken();
  const sessionUserId = state.user && state.user.user_id;
  historyLoads.add(peer);
  try {
    const r = await api.history({ limit: 200, peer_node_id: peer });
    if (getToken() !== sessionToken || !state.user || state.user.user_id !== sessionUserId) return;
    const items = r.items || [];
    ingest(items);
    const cur = state.conversations.get(peer);
    if (cur) cur.hasMore = items.length >= 200;
    ui.renderSidebar();
    if (state.activePeer === peer) ui.renderMessages({ scroll: false });
  } catch { /* hasMore stays null: retried on the next open */ }
  finally { historyLoads.delete(peer); }
}

async function loadOlder() {
  const peer = state.activePeer;
  const c = state.conversations.get(peer);
  if (!peer || !c || !c.hasMore) return;
  // Avoid spreading an unbounded conversation into Math.min(...values),
  // which can exceed the engine's argument limit in long-running chats.
  let before = Infinity;
  for (const message of c.messages) {
    if (message.rowid != null && message.rowid < before) before = message.rowid;
  }
  if (!Number.isFinite(before)) {
    c.hasMore = false;
    ui.renderMessages({ scroll: false });
    return;
  }
  const wrap = $("#messages");
  const keepBottom = wrap.scrollHeight - wrap.scrollTop;
  try {
    const r = await api.history({ limit: 200, before_id: before, peer_node_id: peer });
    const items = r.items || [];
    const countBefore = c.messages.length;
    ingest(items);
    await primeUsers();
    if (!items.length || c.messages.length === countBefore) c.hasMore = false;
    else c.hasMore = items.length >= 200;
    // The user may have switched conversations while history was loading.
    // Keep the old conversation updated, but never restore its scroll offset
    // onto the newly active conversation.
    if (state.activePeer !== peer) {
      ui.renderSidebar();
      return;
    }
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
  // update: a control event (edit/delete/react/pin) for a message we already
  // have — re-render it, but never beep or notify as if it were new mail.
  const isUpdate = !!(detail && detail.update);
  if (detail && detail.item && !isUpdate && detail.item.sender_node_id !== state.selfNode) {
    playSound("message");
  }
  if (detail && detail.peer && detail.peer !== state.activePeer && !isUpdate) {
    const u = state.users.get(String(Number(String(detail.peer).slice(1))));
    notifyIncoming({
      tag: "peer-" + detail.peer,
      title: (u && (u.display_name || u.username)) || "msg.mesh",
      body: "New message",
    });
  }
  // Someone reacted to one of MY messages (1:1 or group): the server pushes
  // the control frame back to the author too — surface it, don't just beep.
  // detail.item is the raw wire payload: the author field is sender_node_id.
  if (isUpdate && detail.item && detail.item.update === "react" &&
      detail.item.sender_node_id === state.selfNode && detail.item.reactions) {
    const reacted = Object.entries(detail.item.reactions).some(
      ([, ids]) => Array.isArray(ids) && ids.some((n) => String(n) !== String(state.selfNode))
    );
    if (reacted) {
      const u = state.users.get(String(Number(String(detail.peer || "").slice(1))));
      const who = (u && (u.display_name || u.username)) || "Someone";
      ui.toast(who + " reacted to your message");
    }
  }
  if (!detail || detail.peer === state.activePeer) {
    // "auto": stay pinned when already at the bottom; otherwise the user
    // keeps their reading position and gets the "new messages" pill.
    // Updates re-render in place (scroll:false) so no pill appears for them.
    ui.renderMessages({ scroll: isUpdate ? false : "auto" });
    if (detail && detail.peer && !isUpdate) markRead(detail.peer);
    if (state.activePeer) ui.renderChatHead();
  }
});

let reconnectRetryTimer = null;
on("connection", (mode) => {
  ui.renderConnection();
  if (mode !== "online" || reconnectRetryTimer !== null) return;
  reconnectRetryTimer = setTimeout(async () => {
    reconnectRetryTimer = null;
    const sessionToken = getToken();
    const sessionUserId = state.user && state.user.user_id;
    if (!sessionToken || !sessionUserId || state.connection !== "online") return;
    const pending = [];
    for (const [peer, conversation] of state.conversations) {
      for (const message of conversation.messages) {
        if (message.mine && message.sync === "failed" && message.retryable) {
          pending.push({ peer, message });
          if (pending.length >= 20) break;
        }
      }
      if (pending.length >= 20) break;
    }
    // Bound the burst after a reconnect; client_msg_id makes ambiguous retries
    // idempotent on the server. Stop immediately if the session changes.
    for (const item of pending) {
      if (getToken() !== sessionToken || !state.user ||
          state.user.user_id !== sessionUserId || state.connection !== "online") break;
      const sent = await retryMessage(item.peer, item.message);
      // One failure usually means the HTTP path is still unhealthy. Stop this
      // reconnect burst rather than stacking up to 20 long timeout waits.
      if (!sent) break;
    }
  }, 250);
});
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
// The Tools menu only exists for moderator+ (any chat capability at all).
on("roles", () => {
  const slot = $("#toolsMenuSlot");
  const allowed = adminTabVisible("users") || adminTabVisible("moderation") || adminTabVisible("audit");
  if (slot) slot.classList.toggle("hidden", !allowed);
  const d = $("#adminPanelDialog");
  if (d && d.open) renderAdminUsers();
  ui.renderSidebar();
  ui.renderContacts();
  syncSendEnabled();
  if (state.activePeer) ui.renderChatHead();
});
on("userupdated", (u) => {
  // Live profile push: same account on another tab/device, or a friend's
  // name/avatar refresh. Applies without waiting for the next refetch.
  if (!u || !u.user_id) return;
  const uid = String(u.user_id);
  if (state.users.has(uid)) {
    const prev = state.users.get(uid);
    state.users.set(uid, { ...prev, ...u, user_id: uid });
    ui.renderSidebar();
    if (state.activePeer === "u" + uid || state.activePeer === uid) ui.renderChatHead();
    ui.renderDetails();
  }
  if (state.user && String(state.user.user_id) === uid) {
    state.user = normalizeUser({ ...u, role: state.user.role, tenant_id: state.user.tenant_id });
    if (u.profile) {
      saveProfile({
        status: u.profile.status_text || "",
        about: u.profile.about || "",
        avatar: u.profile.avatar || "",
        photo: u.profile.photo || "",
        banner: u.profile.banner || "",
      });
    }
    ui.renderProfile();
    ui.renderMessages({ scroll: false });
  }
});

/* ---------------- live presence + typing (WS) ---------------- */

// Presence transitions ({user_id:"u73", status}) and the one-shot snapshot
// both funnel into state.online; every dot in the app reads from it.
on("presence", (d) => {
  if (!d || !d.user_id) return;
  const node = String(d.user_id);
  if (node === state.selfNode) return;
  if (d.status === "online") state.online.add(node);
  else state.online.delete(node);
  ui.renderSidebar();
  if (state.activePeer === node) ui.renderChatHead();
  else ui.renderDetails();
});

// Friends already online when this tab attached (add-only: a live transition
// may have arrived first and must not be wiped by a stale snapshot).
on("presence.snapshot", (d) => {
  const list = d && Array.isArray(d.online) ? d.online : [];
  for (const raw of list) {
    const node = String(raw);
    if (/^u\d+$/.test(node) && node !== state.selfNode) state.online.add(node);
  }
  ui.renderSidebar();
  if (state.activePeer) ui.renderChatHead();
});

// Keep the "typing…" indicator alive while frames keep arriving; expire it
// shortly after the peer goes quiet (server does not send a stop frame).
const typingTimers = new Map();
function scheduleTypingExpiry(peer) {
  const prev = typingTimers.get(peer);
  if (prev) clearTimeout(prev);
  typingTimers.set(peer, setTimeout(() => {
    typingTimers.delete(peer);
    clearTyping(peer);
    ui.renderSidebar();
    if (state.activePeer === peer) ui.renderChatHead();
  }, 4200));
}

on("typing", (d) => {
  if (!d || !d.from) return;
  const from = String(d.from);
  const to = String(d.to || "");
  if (from === state.selfNode) return;
  let peer = null;
  if (/^g\d+$/.test(to)) {
    // Group typing rides the members list; only members ever see the frame.
    if (!Array.isArray(d.recipients) || !d.recipients.includes(state.selfNode)) return;
    peer = to;
  } else if (to === state.selfNode) {
    peer = from;
  } else {
    return;
  }
  setTyping(peer);
  scheduleTypingExpiry(peer);
  ui.renderSidebar();
  if (state.activePeer === peer) ui.renderChatHead();
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
      emitFriends();
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

async function renderBlockedList() {
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

/* ---------------- call history ---------------- */

const CALL_STATE_LABEL = {
  ended: "Completed",
  missed: "Missed",
  declined: "Declined",
};

async function renderCallHistory() {
  const list = $("#callHistoryList");
  if (!list) return;
  try {
    const r = await api.callHistory(50);
    const items = (r && Array.isArray(r.items)) ? r.items : [];
    if (!items.length) {
      list.innerHTML = '<div class="list-empty">No calls yet.</div>';
      return;
    }
    list.innerHTML = items.map((c) => {
      const peer = String(c.peer || "");
      const name = peerLabel(peer);
      const dirIcon = "./assets/xp/icons/TB Call.png";
      const media = c.media === "video" ? "Video" : "Audio";
      const stateLabel = CALL_STATE_LABEL[String(c.state || "")] || String(c.state || "?");
      const when = String(c.created_at || "").replace("T", " ").slice(0, 16);
      const dur = c.duration_s != null ? " Â· " + String(Math.floor(c.duration_s / 60)).padStart(2, "0") + ":" + String(c.duration_s % 60).padStart(2, "0") : "";
      return `<button type="button" class="user-item" data-peer="${esc(peer)}">
        <img src="${dirIcon}" alt="" width="16" height="16">
        <div><strong>${esc(name)}</strong><small>${esc(c.direction === "out" ? "Outgoing" : "Incoming")} ${esc(media)} Â· ${esc(stateLabel)}${esc(dur)}</small></div>
        <span class="status">${esc(when)}</span>
      </button>`;
    }).join("");
  } catch (err) {
    list.innerHTML = `<div class="list-empty">Could not load call history: ${esc(friendlyError(err))}</div>`;
  }
}

async function openCallHistory() {
  const d = $("#callHistoryDialog");
  const list = $("#callHistoryList");
  if (!d) return;
  if (list) list.innerHTML = '<div class="list-empty">Loading…</div>';
  if (!d.open) d.showModal();
  await renderCallHistory();
}

$("#callHistoryRefresh")?.addEventListener("click", () => renderCallHistory());
$("#callHistoryList")?.addEventListener("click", (e) => {
  const item = e.target.closest("[data-peer]");
  if (!item) return;
  $("#callHistoryDialog").close();
  openChat(item.dataset.peer);
});

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

function openNewGroup() {
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
    openChat(String(g.id));
  } catch (err) {
    if (status) status.textContent = friendlyError(err);
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
    ["Settings...", openSettings, "Control Panel.png"],
    // Native File menu has a Theme submenu; web ships the two themes it
    // implements (XP Luna + Windows 98).
    ["Theme", null, null, [
      ["Windows XP", () => setTheme("winxp"), "Theme.png"],
      ["Windows 98", () => setTheme("win98"), "Theme.png"],
      ["North Assembly", () => setTheme("north"), "Theme.png"],
    ]],
    ["-", null],
    ["Sign In...", () => { setMode("login"); location.hash = "#/login"; }, "Login Question.png"],
    ["Create Account...", () => { setMode("register"); location.hash = "#/register"; }, "User Accounts.png"],
    ["Change Password...", openChangePw, "Key.png"],
    ["Sign Out", logout, "Logout.png"],
  ],
  contacts: [
    ["Contact List", () => { ui.setActive(null); }, "Address Book.png"],
    ["Search User...", openNewChat, "Search.png"],
    ["Add Friend...", openNewChat, "User Accounts.png", "address_book_card_users.png"],
    ["New Group...", openNewGroup, "Windows Messenger.png"],
    ["-", null],
    ["Refresh", () => { loadFriends().catch(() => null); }, "Network Connections.png"],
  ],
  actions: [
    ["Sync History", () => { if (booted) initialLoad(); }, "IE History.png"],
    ["Call History...", openCallHistory, "TB Call.png"],
    ["-", null],
    ["Chats List", () => { ui.setActive(null); }, "Windows Messenger.png"],
  ],
  view: [
    ["Contact List", () => { ui.setActive(null); }, "Address Book.png"],
    ["Sync History", () => { if (booted) initialLoad(); }, "IE History.png"],
  ],
  tools: [
    ["Admin Panel...", openAdminPanel, "Manage Your Server.png"],
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
  // Security: only accept https:// (or localhost for dev). Reject cleartext http.
  if (!api.isAllowedBase(value)) {
    hint.textContent = "Only HTTPS servers are allowed (or localhost for development).";
    return;
  }
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

let bootRetryTimer = 0;
let bootInflight = false;

async function startFromToken() {
  if (!getToken()) {
    ui.showAuth("login");
    route();
    return;
  }
  if (booted || bootInflight) return;
  const sessionToken = getToken();
  bootInflight = true;
  try {
    await startSession();
    authNotice = "";
    if (bootRetryTimer) {
      clearTimeout(bootRetryTimer);
      bootRetryTimer = 0;
    }
  } catch (e) {
    // startSession clears the dead token itself before rethrowing, so an empty
    // token here is our own cleanup for a died session, not a newer owner.
    // Only a different live token means a newer login took over mid-boot.
    if (getToken() && getToken() !== sessionToken) return;
    if (e instanceof ApiError && e.status === 429) {
      // Throttled, not dead: keep the token and keep retrying until the
      // server window clears instead of kicking the session to a fresh login.
      authNotice = "Too many requests — slow down for a moment. Retrying…";
      ui.showAuth("login");
      setMode("login");
      route();
      if (!bootRetryTimer) {
        bootRetryTimer = setTimeout(() => {
          bootRetryTimer = 0;
          startFromToken();
        }, 10000);
      }
      return;
    }
    setToken("");
    const netDown = !(e instanceof ApiError) || e.status === 0 || e.status === 502 || e.status === 503;
    authNotice = e instanceof ApiError && e.status === 401
      ? "Session expired — please sign in again."
      : "Cannot reach the msg.mesh server. Check your connection and retry.";
    if (netDown) startServerWatch(() => { authNotice = ""; });
    ui.showAuth("login");
    setMode("login");
    route();
  } finally {
    bootInflight = false;
  }
}

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
  await startFromToken();
}

boot();
