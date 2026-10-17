import { api, getToken, setToken, ApiError, friendlyError, resolveApiBase, setApiBase, apiBase, setOnUnauthorized, setOnServerSwitch, lastUsername, rememberUsername } from "./api.js";
import { state, on, ingest, pushLocal, findMessage, maxRowid, primeUsers, rememberUser, refreshUser, resetState, loadFriends, isFriend, incomingFrom, outgoingTo, incomingRequests, peerUser, upsertFriend, loadProfile, saveProfile, refreshConversations, clearProfileCache } from "./store.js";
import { connect as wsConnect, disconnect as wsDisconnect, forceReconnect as wsForceReconnect } from "./ws.js";
import { requestNotificationPermission, notifyIncoming } from "./notifications.js";
import * as ui from "./ui.js";
import { playSound, primeSound } from "./sound.js";
import { setTheme } from "./theme.js";
import * as Call from "./call.js";
import { EMOTICONS } from "./emoticons.js";

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
  errBox?.classList.remove("note");
  errBox?.classList.add("error");
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
    if (!(err instanceof ApiError) || err.status === 0 || err.status === 502 || err.status === 503) {
      startServerWatch();
    }
    playSound("error");
  } finally {
    btn.disabled = false;
  }
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
      startServerWatch();
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
    if (getToken() === sessionToken) setToken("");
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
  const migrationKey = "msg.mesh.profileMigrated." + String(sessionUserId || "");
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

let pendingAttachment = null;

function setPendingAttachment(att) {
  pendingAttachment = att;
  const bar = $("#pendingFile");
  if (bar) {
    if (att) {
      bar.classList.remove("hidden");
      $("#pendingFileName").innerHTML = '<img src="./assets/xp/icons/Generic Document.png" alt="" width="14" height="14"> ' + esc(att.filename);
    } else {
      bar.classList.add("hidden");
      $("#pendingFileName").textContent = "";
    }
  }
  syncSendEnabled();
}

async function sendMessage() {
  const input = $("#messageInput");
  const text = input.value.trim();
  const peer = state.activePeer;
  const sessionToken = getToken();
  const sessionUserId = state.user && state.user.user_id;
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
  const local = pushLocal(peer, { id: tmp, text, env, attachment: env.attachment || null });
  // Stable id for retries: the server dedupes sends by client_msg_id, so a
  // retry after a lost response returns the original message, not a copy.
  local.clientId = tmp;
  input.value = "";
  setPendingAttachment(null);
  ui.renderMessages();
  ui.renderSidebar();

  try {
    const r = await api.send(peer, "text", JSON.stringify(env), tmp);
    if (getToken() !== sessionToken || !state.user || state.user.user_id !== sessionUserId) return;
    const m = findMessage(peer, tmp);
    if (m && r.message_id) {
      m.id = r.message_id;
      if (m.rowid == null && typeof r.rowid === "number") m.rowid = r.rowid;
      if (m.sync === "sending") m.sync = "sent";
      ui.renderMessages({ scroll: false });
    }
    markRead(peer);
  } catch (e) {
    if (getToken() !== sessionToken || !state.user || state.user.user_id !== sessionUserId) return;
    const m = findMessage(peer, tmp);
    if (m) m.sync = "failed";
    ui.renderMessages({ scroll: false });
    ui.toast("Send failed: " + friendlyError(e), true);
  }
  if (getToken() === sessionToken && state.user && state.user.user_id === sessionUserId) ui.renderSidebar();
}

async function retryMessage(peer, m) {
  const sessionToken = getToken();
  const sessionUserId = state.user && state.user.user_id;
  m.sync = "sending";
  ui.renderMessages({ scroll: false });
  const cid = m.clientId || (String(m.id).startsWith("tmp-") ? m.id : "");
  try {
    const r = await api.send(peer, m.type || "text", JSON.stringify(m.env), cid || undefined);
    if (getToken() !== sessionToken || !state.user || state.user.user_id !== sessionUserId) return;
    if (r.message_id && findMessage(peer, m.id)) {
      const cur = findMessage(peer, m.id);
      cur.id = r.message_id;
      if (cur.rowid == null && typeof r.rowid === "number") cur.rowid = r.rowid;
      cur.sync = "sent";
      ui.renderMessages({ scroll: false });
      markRead(peer);
    }
  } catch (e) {
    if (getToken() !== sessionToken || !state.user || state.user.user_id !== sessionUserId) return;
    m.sync = "failed";
    ui.renderMessages({ scroll: false });
    ui.toast("Retry failed: " + friendlyError(e), true);
  }
}

/* ---------------- attachments ---------------- */

const MAX_FILE = 700 * 1024;
const MAX_IMAGE_SOURCE = 5 * 1024 * 1024;

$("#sendFileBtn")?.addEventListener("click", () => $("#fileInput").click());
$("#pendingFileCancel")?.addEventListener("click", () => {
  uploadSeq += 1;
  if (activeUploadXhr) { activeUploadXhr.abort(); activeUploadXhr = null; }
  setPendingAttachment(null);
});

// XHR upload so the pending-file bar can show real byte progress (fetch has
// no upload progress events). Same endpoint/headers/failure contract as
// api.upload; falls back to the plain error payload on non-2xx.
let activeUploadXhr = null;

function cancelActiveUpload() {
  uploadSeq += 1;
  if (activeUploadXhr) {
    const xhr = activeUploadXhr;
    activeUploadXhr = null;
    try { xhr.abort(); } catch { /* already completed */ }
  }
}

function uploadWithProgress(filename, contentType, b64, size, onProgress, uploadToken) {
  return new Promise((resolve, reject) => {
    if (!uploadToken || getToken() !== uploadToken) {
      reject(new ApiError(0, { error: "session changed before upload" }));
      return;
    }
    const xhr = new XMLHttpRequest();
    activeUploadXhr = xhr;
    xhr.open("POST", apiBase() + "/api/v1/files/upload");
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.timeout = 60000;
    if (uploadToken) xhr.setRequestHeader("X-Session-Token", uploadToken);
    if (xhr.upload) {
      xhr.upload.addEventListener("progress", (ev) => {
        if (ev.lengthComputable && onProgress) onProgress(ev.loaded, ev.total);
      });
    }
    xhr.onload = () => {
      if (activeUploadXhr === xhr) activeUploadXhr = null;
      if (getToken() !== uploadToken) {
        reject(new ApiError(0, { error: "session changed while upload was in flight" }));
        return;
      }
      let payload = {};
      try { payload = JSON.parse(xhr.responseText || "{}"); } catch { /* empty body */ }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(payload);
      } else {
        // Same session-lost flow as api.call() (api.js onUnauthorized).
        if (xhr.status === 401) handleSessionLost();
        reject(new ApiError(xhr.status, payload));
      }
    };
    xhr.onerror = () => {
      if (activeUploadXhr === xhr) activeUploadXhr = null;
      reject(new ApiError(0, { error: "cannot reach the msg.mesh server" }));
    };
    xhr.ontimeout = () => {
      if (activeUploadXhr === xhr) activeUploadXhr = null;
      reject(new ApiError(0, { error: "upload timed out" }));
    };
    xhr.onabort = () => reject(new ApiError(0, { error: "upload cancelled" }));
    xhr.send(JSON.stringify({
      filename,
      content_type: contentType,
      content_base64: b64,
      size_bytes: size,
    }));
  });
}

let uploadSeq = 0;
async function handleFile(file) {
  const seq = ++uploadSeq; // a new selection supersedes any previous upload
  const uploadToken = getToken();
  const uploadUserId = state.user && state.user.user_id;
  const sessionIsCurrent = () => !!uploadToken && getToken() === uploadToken &&
    !!state.user && state.user.user_id === uploadUserId;
  if (activeUploadXhr) { activeUploadXhr.abort(); activeUploadXhr = null; }
  setPendingAttachment(null);
  if (!file) return;
  if (!sessionIsCurrent()) {
    ui.toast("Sign in before uploading a file.", true);
    return;
  }
  const type = String(file.type || "").toLowerCase();
  const compressibleImage = ["image/jpeg", "image/png", "image/webp"].includes(type);
  const sourceLimit = compressibleImage ? MAX_IMAGE_SOURCE : MAX_FILE;
  if (file.size > sourceLimit) {
    const limit = compressibleImage ? "5 MB before image compression" : `${Math.round(MAX_FILE / 1024)} KB`;
    ui.toast(`File too large (max ${limit})`, true);
    return;
  }
  const bar = $("#pendingFile");
  const label = $("#pendingFileName");
  if (bar) bar.classList.remove("hidden");
  if (label) label.textContent = file.name + " — preparing";
  try {
    const prepared = await prepareUploadFile(file);
    if (seq !== uploadSeq || !sessionIsCurrent()) return;
    if (prepared.size > MAX_FILE) {
      setPendingAttachment(null);
      ui.toast(`Image is still too large after compression (max ${Math.round(MAX_FILE / 1024)} KB)`, true);
      return;
    }
    const uploadName = prepared.filename || file.name;
    const b64 = await fileToBase64(prepared.blob);
    if (seq !== uploadSeq || !sessionIsCurrent()) return;
    const r = await uploadWithProgress(
      uploadName,
      prepared.type,
      b64,
      prepared.size,
      (loaded, total) => {
        if (seq === uploadSeq && sessionIsCurrent() && label && bar && !bar.classList.contains("hidden")) {
          const pct = Math.round((loaded / total) * 100);
          label.textContent = file.name + " — " + pct + "%";
        }
      },
      uploadToken
    );
    if (seq !== uploadSeq || !sessionIsCurrent()) return;
    setPendingAttachment({ id: r.attachment_id, filename: r.filename || uploadName, content_type: r.content_type || prepared.type, size_bytes: r.size_bytes ?? prepared.size });
    const saved = Number(r.size_bytes ?? prepared.size);
    const reduction = file.size > 0 ? Math.round((1 - saved / file.size) * 100) : 0;
    ui.toast(reduction >= 5 ? `Attached ${r.filename || uploadName} (${reduction}% smaller)` : "Attached " + (r.filename || uploadName));
  } catch (e) {
    if (seq !== uploadSeq || !sessionIsCurrent()) return;
    setPendingAttachment(null);
    ui.toast("Upload failed: " + friendlyError(e), true);
  }
}

// Resize raster images and, when needed, use WebP for a much smaller upload.
// GIF/SVG and non-image files are never transcoded. If the browser cannot decode
// an image or encoding is not beneficial, retain the original bytes unchanged.
async function prepareUploadFile(file) {
  const type = String(file.type || "").toLowerCase();
  const supported = ["image/jpeg", "image/png", "image/webp"].includes(type);
  if (!supported || typeof createImageBitmap !== "function" || file.size < 96 * 1024) {
    return { blob: file, type: file.type || "application/octet-stream", size: file.size };
  }

  // Do not recompress an image that already fits the wire limit. Compression
  // is a fallback for oversized images, not a blanket quality reduction.
  if (file.size <= MAX_FILE) {
    let dimensions;
    try { dimensions = await createImageBitmap(file); }
    catch { return { blob: file, type, size: file.size }; }
    const fits = Math.max(dimensions.width, dimensions.height) <= 1920;
    dimensions.close?.();
    if (fits) return { blob: file, type, size: file.size };
  }

  let bitmap;
  try { bitmap = await createImageBitmap(file); }
  catch { return { blob: file, type, size: file.size }; }
  try {
    const sourceMax = Math.max(bitmap.width, bitmap.height);
    const edgeTargets = [1920, 1600, 1280, 1024, 800, 640];
    const targets = [...new Set(edgeTargets.map(edge => Math.min(sourceMax, edge)))];
    const qualities = [0.88, 0.82, 0.76, 0.70, 0.64, 0.58, 0.52];
    let best = null;

    for (const edge of targets) {
      const scale = Math.min(1, edge / sourceMax);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext("2d", { alpha: type === "image/png" });
      if (!ctx) continue;
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const encode = (mime, quality) => new Promise(resolve => canvas.toBlob(resolve, mime, quality));

      // PNG's quality parameter is ignored by browsers, so encode it once.
      // JPEG/WebP are tried from high to lower quality; the first candidate
      // under the server limit is the best-quality candidate at this size.
      if (type === "image/png") {
        const png = await encode("image/png");
        if (png && png.type === "image/png") {
          if (!best || png.size < best.blob.size) best = { blob: png, type: png.type, size: png.size };
          if (png.size <= MAX_FILE) {
            return { blob: png, type: png.type, size: png.size };
          }
        }
      }

      const outputTypes = type === "image/webp"
        ? ["image/webp"]
        : type === "image/jpeg"
          ? ["image/jpeg", "image/webp"]
          : ["image/webp"];
      for (const outputType of outputTypes) {
        for (const quality of qualities) {
          const encoded = await encode(outputType, quality);
          if (!encoded || encoded.type !== outputType) continue;
          const filename = outputType !== type
            ? file.name.replace(/\.[^.]+$/, "") + ".webp"
            : undefined;
          if (!best || encoded.size < best.blob.size) {
            best = { blob: encoded, type: encoded.type, size: encoded.size, filename };
          }
          if (encoded.size <= MAX_FILE) {
            return { blob: encoded, type: encoded.type, size: encoded.size, filename };
          }
        }
      }
    }

    // Keep the smallest successful encoding so the caller can report the
    // precise size-limit failure; never silently send an oversized payload.
    return best && best.size < file.size ? best : { blob: file, type, size: file.size };
  } finally {
    bitmap.close?.();
  }
}
$("#fileInput").addEventListener("change", () => {
  const file = $("#fileInput").files[0];
  $("#fileInput").value = "";
  handleFile(file);
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
    // Security: always force save-to-disk via <a download>. Never window.open(blob)
    // — blob URLs inherit the app origin and a hostile file (e.g. text/html with
    // script) could execute in our origin and steal the session token.
    const blob = new Blob([bytes], { type: r.content_type || "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = r.filename || filename || "attachment";
    document.body.appendChild(a);
    a.click();
    a.remove();
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
wireDialogClose("dialog .win-cap.close:not(#callClose)"); // call✕ routes through dismissCall()

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

/* ---------------- voice calls (WebRTC + WS signaling relay) ---------------- */

function renderCallState(st) {
  const dlg = $("#callDialog");
  if (!dlg) return;
  if (st.phase === "idle") {
    if (dlg.open) dlg.close();
    return;
  }
  if (!dlg.open) dlg.show();
  const u = st.peer ? peerUser(st.peer) : null;
  const name = u ? (u.display_name || u.username) : (st.peer || "");
  const title = $("#callTitle");
  if (title) title.textContent = st.media === "video" ? "Windows Video Call" : "Windows Voice Call";
  const pn = $("#callPeerName");
  if (pn) pn.textContent = name;
  const ph = $("#callPeerHandle");
  if (ph) ph.textContent = u ? "@" + u.username : "";
  const av = $("#callAvatar");
  if (av) av.textContent = u && u.profile && u.profile.avatar ? u.profile.avatar : (name ? name.slice(0, 2).toUpperCase() : "?");
  const btns = {
    accept: $("#callAcceptBtn"),
    decline: $("#callDeclineBtn"),
    mute: $("#callMuteBtn"),
    camera: $("#callCameraBtn"),
    cancel: $("#callCancelBtn"),
    hangup: $("#callHangupBtn"),
  };
  for (const b of Object.values(btns)) if (b) b.classList.add("hidden");
  const status = $("#callStatus");
  const timer = $("#callTimer");
  const live = st.phase === "in-call" || st.phase === "connecting";
  const videoLive = live && st.media === "video";
  // video stage: show for video calls once media exists (not while ringing)
  const stage = $("#callVideoStage");
  if (stage) stage.classList.toggle("hidden", !videoLive);
  // avatar: hide while the video stage is visible
  if (av) av.classList.toggle("hidden", videoLive);
  if (st.phase === "preparing-in") {
    if (status) status.textContent = "Preparing camera/microphone…";
    if (btns.decline) btns.decline.classList.remove("hidden");
    if (timer) timer.classList.add("hidden");
  } else if (st.phase === "preparing-out") {
    if (status) status.textContent = "Requesting camera/microphone access…";
    if (btns.cancel) btns.cancel.classList.remove("hidden");
    if (timer) timer.classList.add("hidden");
  } else if (st.phase === "ringing-in") {
    if (status) status.textContent = st.media === "video" ? "Incoming video call…" : "Incoming call…";
    if (btns.accept) btns.accept.classList.remove("hidden");
    if (btns.decline) btns.decline.classList.remove("hidden");
    if (timer) timer.classList.add("hidden");
  } else if (st.phase === "ringing-out") {
    if (status) status.textContent = st.media === "video" ? "Ringing (video)…" : "Ringing…";
    if (btns.cancel) btns.cancel.classList.remove("hidden");
    if (timer) timer.classList.add("hidden");
  } else if (st.phase === "connecting") {
    if (status) status.textContent = st.media === "video" ? "Connecting video…" : "Connecting…";
    if (btns.mute) btns.mute.classList.remove("hidden");
    if (videoLive && btns.camera) btns.camera.classList.remove("hidden");
    if (btns.hangup) btns.hangup.classList.remove("hidden");
    if (timer) timer.classList.add("hidden");
  } else if (st.phase === "in-call") {
    const secs = Math.max(0, Math.floor((Date.now() - st.startedAt) / 1000));
    if (status) {
      const bits = [];
      bits.push(st.media === "video" ? "Video call" : "In call");
      if (st.muted) bits.push("muted");
      if (st.cameraOff) bits.push("camera off");
      status.textContent = bits.join(" — ");
    }
    if (timer) {
      timer.textContent = String(Math.floor(secs / 60)).padStart(2, "0") + ":" + String(secs % 60).padStart(2, "0");
      timer.classList.remove("hidden");
    }
    if (btns.mute) {
      btns.mute.textContent = st.muted ? "Unmute" : "Mute";
      btns.mute.classList.remove("hidden");
    }
    if (videoLive && btns.camera) {
      btns.camera.textContent = st.cameraOff ? "Camera On" : "Camera Off";
      btns.camera.classList.remove("hidden");
    }
    if (btns.hangup) btns.hangup.classList.remove("hidden");
  }
  // media elements: audio always (video calls also carry audio); video when live
  const audio = $("#callRemoteAudio");
  if (audio) {
    if (st.remoteStream && st.media !== "video" && audio.srcObject !== st.remoteStream) audio.srcObject = st.remoteStream;
    else if ((!st.remoteStream || st.media === "video") && audio.srcObject) audio.srcObject = null;
  }
  const rv = $("#callRemoteVideo");
  if (rv) {
    if (videoLive && st.remoteStream && rv.srcObject !== st.remoteStream) rv.srcObject = st.remoteStream;
    else if (!videoLive && rv.srcObject) rv.srcObject = null;
  }
  const lv = $("#callLocalVideo");
  if (lv) {
    if (videoLive && st.localStream && lv.srcObject !== st.localStream) lv.srcObject = st.localStream;
    else if (!videoLive && lv.srcObject) lv.srcObject = null;
  }
}

async function startCallUI(kind) {
  const peer = state.activePeer;
  if (!peer) {
    ui.toast("Open a conversation first", true);
    return;
  }
  const r = await Call.startCall(peer, kind);
  if (!r.ok) ui.toast("Call failed: " + r.error, true);
}
$("#chatCallBtn")?.addEventListener("click", () => startCallUI("audio"));
$("#chatVideoBtn")?.addEventListener("click", () => startCallUI("video"));
$("#callAcceptBtn")?.addEventListener("click", () => {
  Call.acceptCall().then((r) => {
    if (!r.ok && r.error) ui.toast("Call failed: " + r.error, true);
  });
});
$("#callDeclineBtn")?.addEventListener("click", () => Call.declineCall());
$("#callCancelBtn")?.addEventListener("click", () => Call.cancelCall());
$("#callHangupBtn")?.addEventListener("click", () => Call.endCall());
$("#callMuteBtn")?.addEventListener("click", () => Call.toggleMute());
$("#callCameraBtn")?.addEventListener("click", () => Call.toggleCamera());
$("#callClose")?.addEventListener("click", (e) => {
  e.preventDefault();
  Call.dismissCall();
});
$("#callDialog")?.addEventListener("cancel", (e) => {
  e.preventDefault(); // ESC routes to the phase-correct teardown
  Call.dismissCall();
});
// Non-modal dialogs do not receive the "cancel" event on ESC — handle it globally.
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !Call.isCallActive()) return;
  if (e.key === "Escape" && $("#callDialog")?.open) {
    e.preventDefault();
    Call.dismissCall();
  }
});

// Drag the floating call window by its titlebar (pointer events, works on touch).
(() => {
  const frame = document.querySelector("#callDialog .call-frame");
  const bar = frame && frame.querySelector(".win-titlebar");
  if (!frame || !bar) return;
  let dragging = false, ox = 0, oy = 0;
  bar.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button")) return; // don't drag from the close button
    dragging = true;
    const r = frame.getBoundingClientRect();
    ox = e.clientX - r.left;
    oy = e.clientY - r.top;
    frame.style.right = "auto";
    frame.style.bottom = "auto";
    bar.setPointerCapture(e.pointerId);
  });
  bar.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const x = Math.max(0, Math.min(window.innerWidth - frame.offsetWidth, e.clientX - ox));
    const y = Math.max(0, Math.min(window.innerHeight - 40, e.clientY - oy));
    frame.style.left = x + "px";
    frame.style.top = y + "px";
  });
  bar.addEventListener("pointerup", () => { dragging = false; });
  bar.addEventListener("pointercancel", () => { dragging = false; });
})();

on("callstate", renderCallState);
on("callinvite", () => renderCallState(Call.callState()));
on("callnotice", (msg) => ui.toast(msg));

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
  updateCharCount();
  syncSendEnabled();
});
function syncSendEnabled() {
  const send = $("#sendBtn");
  updateCharCount();
  if (!send) return;
  const hasText = !!(msgInput && msgInput.value.trim());
  send.disabled = !(hasText || pendingAttachment);
}
// Character budget: quiet until the last 500, amber then red near the cap
// (the textarea's maxlength=4000 is the hard stop).
function updateCharCount() {
  const el = $("#charCount");
  if (!el || !msgInput) return;
  const len = msgInput.value.length;
  const show = len >= 3500;
  el.classList.toggle("hidden", !show);
  if (!show) return;
  el.textContent = len + "/4000";
  el.classList.toggle("warn", len < 3900);
  el.classList.toggle("danger", len >= 3900);
}

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

/* ---------------- copy message (context menu) ---------------- */
const ctxMenu = $("#ctxMenu");
let ctxText = "";
function hideCtxMenu() {
  ctxMenu?.classList.add("hidden");
}
function messagePlainText(line) {
  const body = line?.querySelector(".body");
  if (!body) return "";
  const clone = body.cloneNode(true);
  // native emoticons render as <img alt=":eNNN:"> — keep the token on copy
  clone.querySelectorAll("img.emote").forEach((img) => {
    img.replaceWith(document.createTextNode(img.getAttribute("alt") || ""));
  });
  return (clone.textContent || "").trim();
}
$("#messageList")?.addEventListener("contextmenu", (e) => {
  const line = e.target.closest(".msg-line");
  if (!line) return;
  e.preventDefault();
  let text = messagePlainText(line);
  if (!text) {
    const chip = line.querySelector("[data-attname]");
    text = (chip && chip.getAttribute("data-attname")) || "";
  }
  if (!text || !ctxMenu) return;
  ctxText = text;
  ctxMenu.classList.remove("hidden");
  const mw = ctxMenu.offsetWidth;
  const mh = ctxMenu.offsetHeight;
  ctxMenu.style.left = Math.max(2, Math.min(e.clientX, window.innerWidth - mw - 4)) + "px";
  ctxMenu.style.top = Math.max(2, Math.min(e.clientY, window.innerHeight - mh - 4)) + "px";
});
ctxMenu?.addEventListener("click", async (e) => {
  e.stopPropagation();
  if (!e.target.closest("#ctxCopy")) return;
  hideCtxMenu();
  try {
    await navigator.clipboard.writeText(ctxText);
    ui.toast("Message copied");
  } catch {
    // fallback for contexts without the async clipboard API
    const ta = document.createElement("textarea");
    ta.value = ctxText;
    ta.className = "ctx-ghost";
    ta.setAttribute("readonly", "");
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
      ui.toast("Message copied");
    } catch {
      ui.toast("Copy failed", true);
    }
    ta.remove();
  }
});
document.addEventListener("click", hideCtxMenu);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") hideCtxMenu();
});
document.addEventListener("scroll", hideCtxMenu, true);

/* ---------------- emoticon / sticker picker ---------------- */
const STICKERS = ["wink", "surprise", "cry", "party", "thumbsup", "wave", "heart", "coffee", "smile"];
const STICKER_LABELS = {
  wink: "Wink", surprise: "Surprised", cry: "Crying", party: "Party",
  thumbsup: "Thumbs up", wave: "Wave", heart: "Heart", coffee: "Coffee", smile: "Smile",
};

const emojiPanel = $("#emojiPanel");
const emojiBtn = $("#emojiBtn");
const emojiFacesBox = $("#emojiFaces");
const emojiStickersBox = $("#emojiStickers");
const emojiTabFaces = $("#emojiTabFaces");
const emojiTabGifs = $("#emojiTabGifs");
const emojiTabGifSearch = $("#emojiTabGifSearch");

function insertAtCursor(text) {
  const el = msgInput;
  if (!el) return;
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? start;
  el.focus();
  el.setRangeText(text, start, end, "end");
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function closeEmojiPanel() {
  if (!emojiPanel) return;
  emojiPanel.classList.add("hidden");
  emojiBtn?.setAttribute("aria-expanded", "false");
}

function emojiTab(which) {
  const faces = which === "faces";
  const stickers = which === "stickers";
  const gifs = which === "gifs";
  emojiTabFaces.classList.toggle("active", faces);
  emojiTabGifs.classList.toggle("active", stickers);
  emojiTabGifSearch.classList.toggle("active", gifs);
  emojiTabFaces.setAttribute("aria-selected", String(faces));
  emojiTabGifs.setAttribute("aria-selected", String(stickers));
  emojiTabGifSearch.setAttribute("aria-selected", String(gifs));
  emojiFacesBox.classList.toggle("hidden", !faces);
  emojiStickersBox.classList.toggle("hidden", !stickers);
  gifPane.classList.toggle("hidden", !gifs);
  if (gifs) gifFirstOpen();
}

async function insertSticker(name) {
  const path = "./assets/xp/gifs/sticker_" + name + ".gif";
  closeEmojiPanel();
  try {
    const res = await fetch(path);
    if (!res.ok) throw new Error("http " + res.status);
    const blob = await res.blob();
    const file = new File([blob], "sticker_" + name + ".gif", { type: "image/gif" });
    handleFile(file);
  } catch {
    ui.toast("Sticker failed to load", true);
  }
}

/* ---------------- online GIF search (keyless) ---------------- */
/* Same public, CORS-open endpoint Discord's own GIF picker calls — no API key.
   Results are CDN hotlinks (static.klipy.com, ACAO=*) downloaded as blobs and
   pushed through the normal upload pipeline. */
const GIF_API = "https://discord.com/api/v10/";
const gifPane = $("#gifPane");
const gifSearch = $("#gifSearch");
const gifGrid = $("#gifGrid");
const gifStatus = $("#gifStatus");
let gifBooted = false;
let gifSeq = 0;
let gifTimer = 0;

function gifState(text) {
  if (!gifStatus) return;
  gifStatus.classList.toggle("hidden", !text);
  gifStatus.innerHTML = text
    ? '<img class="hourglass" src="./assets/xp/gifs/hourglass.gif" alt="" width="16" height="16"> ' + esc(text)
    : "";
}

async function fetchWithTimeout(url, timeoutMs = 12000) {
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    return await fetch(url, ctrl ? { signal: ctrl.signal } : {});
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function gifFetch(path) {
  const r = await fetchWithTimeout(GIF_API + path, 12000);
  if (!r.ok) throw new Error("http " + r.status);
  return r.json();
}

function gifRender(items, seq) {
  if (seq !== gifSeq) return;
  gifGrid.textContent = "";
  for (const it of items) {
    if (!it || typeof it.src !== "string" || !it.src) continue;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "gif-cell";
    b.title = String(it.title || "GIF").replace(/\s+/g, " ").slice(0, 80);
    const img = document.createElement("img");
    img.src = it.src;
    img.alt = b.title;
    img.loading = "lazy";
    img.draggable = false;
    b.appendChild(img);
    b.addEventListener("click", () => gifSend(it));
    gifGrid.appendChild(b);
  }
}

function gifRenderCats(cats, seq) {
  if (seq !== gifSeq) return;
  gifGrid.textContent = "";
  for (const c of cats) {
    if (!c || typeof c.name !== "string" || !c.name) continue;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "gif-cat";
    b.title = c.name;
    if (typeof c.src === "string" && c.src) {
      const img = document.createElement("img");
      // downscale the Discord image proxy: 440px thumbs ~540KB vs ~77KB at 132px
      img.src = c.src.replace(/height=\d+/, "height=132").replace(/width=\d+/, "width=132");
      img.alt = "";
      img.loading = "lazy";
      img.draggable = false;
      b.appendChild(img);
    }
    const s = document.createElement("span");
    s.className = "gif-cat-label";
    s.textContent = c.name;
    b.appendChild(s);
    b.addEventListener("click", () => {
      gifSearch.value = c.name;
      gifSearchSchedule(true);
    });
    gifGrid.appendChild(b);
  }
}

async function gifLoad(kind, query) {
  const seq = ++gifSeq;
  gifState(kind === "search" ? "Searching GIFs..." : "Loading GIFs...");
  try {
    if (kind === "search") {
      const arr = await gifFetch("gifs/search?q=" + encodeURIComponent(query) + "&media_format=gif&limit=20");
      if (seq !== gifSeq) return;
      gifRender(Array.isArray(arr) ? arr : [], seq);
      gifState(gifGrid.childElementCount ? "" : "No GIFs found");
    } else {
      const t = await gifFetch("gifs/trending?media_format=gif&limit=20");
      if (seq !== gifSeq) return;
      gifRenderCats((t && Array.isArray(t.categories)) ? t.categories : [], seq);
      gifState(gifGrid.childElementCount ? "" : "No GIFs found");
    }
  } catch {
    if (seq !== gifSeq) return;
    gifGrid.textContent = "";
    gifState("GIF search unavailable");
    ui.toast("GIF search unavailable", true);
  }
}

function gifSearchSchedule(immediate) {
  clearTimeout(gifTimer);
  const q = (gifSearch.value || "").trim();
  if (!q) {
    gifLoad("trending");
    return;
  }
  if (immediate) {
    gifLoad("search", q);
    return;
  }
  gifTimer = setTimeout(() => gifLoad("search", q), 350);
}

function gifFirstOpen() {
  if (gifBooted) return;
  gifBooted = true;
  gifLoad("trending");
}

async function gifSend(it) {
  closeEmojiPanel();
  const base = String(it.id || "gif").replace(/[^\w.-]+/g, "_").slice(0, 40);
  const candidates = [it.src, it.gif_src].filter((u) => typeof u === "string" && u);
  let file = null;
  for (const u of candidates) {
    try {
      const res = await fetchWithTimeout(u, 15000);
      if (!res.ok) continue;
      const blob = await res.blob();
      const webp = /\.webp(\?|$)/i.test(u) || blob.type === "image/webp";
      const cand = new File([blob], base + (webp ? ".webp" : ".gif"),
        { type: blob.type || (webp ? "image/webp" : "image/gif") });
      if (!file || cand.size < file.size) file = cand;
      if (file.size <= MAX_FILE) break;
    } catch {
      /* try the next candidate */
    }
  }
  if (!file) {
    ui.toast("GIF failed to load", true);
    return;
  }
  handleFile(file); // toasts + clears when still over MAX_FILE
}

if (emojiPanel) {
  // Native 19x19 emoticon art (Themes/emoticons): click inserts the :eNNN:
  // token, ui.js renders it back as an inline <img class="emote">.
  for (const file of EMOTICONS) {
    const id = file.split(".")[0];
    const b = document.createElement("button");
    b.type = "button";
    b.className = "emoji-cell emote-cell";
    b.title = ":e" + id + ":";
    const img = document.createElement("img");
    img.src = "./assets/xp/emoticons/" + file;
    img.alt = ":e" + id + ":";
    img.loading = "lazy";
    img.draggable = false;
    b.appendChild(img);
    b.addEventListener("click", () => insertAtCursor(":e" + id + ":"));
    emojiFacesBox.appendChild(b);
  }
  for (const name of STICKERS) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "emoji-cell sticker-cell";
    b.title = STICKER_LABELS[name] || name;
    const img = document.createElement("img");
    img.src = "./assets/xp/gifs/sticker_" + name + ".gif";
    img.alt = STICKER_LABELS[name] || name;
    img.loading = "lazy";
    img.draggable = false;
    b.appendChild(img);
    b.addEventListener("click", () => insertSticker(name));
    emojiStickersBox.appendChild(b);
  }
  emojiTabFaces.addEventListener("click", () => emojiTab("faces"));
  emojiTabGifs.addEventListener("click", () => emojiTab("stickers"));
  emojiTabGifSearch.addEventListener("click", () => emojiTab("gifs"));
  gifSearch?.addEventListener("input", gifSearchSchedule);
  gifSearch?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      gifSearchSchedule(true);
    }
  });
  emojiBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    const nowHidden = emojiPanel.classList.toggle("hidden");
    emojiBtn.setAttribute("aria-expanded", String(!nowHidden));
  });
  // Staying open on face picks (MSN-style) — panel closes on sticker, outside
  // click or Esc; the sticker tap itself closes via insertSticker().
  document.addEventListener("click", (e) => {
    if (emojiPanel.classList.contains("hidden")) return;
    if (e.target.closest?.("#emojiPanel") || e.target.closest?.("#emojiBtn")) return;
    closeEmojiPanel();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeEmojiPanel();
  });
}

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
    // "auto": stay pinned when already at the bottom; otherwise the user
    // keeps their reading position and gets the "new messages" pill.
    ui.renderMessages({ scroll: "auto" });
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

/* ---------------- server availability watch ---------------- */
let serverWatchTimer = 0;

function stopServerWatch() {
  if (serverWatchTimer) {
    clearInterval(serverWatchTimer);
    serverWatchTimer = 0;
  }
}

// Login/register/boot failed at the network level: re-probe the candidate
// servers every few seconds so the screen heals itself when one comes back
// (the funnel/host may have been rebooting) — no manual page reload needed.
let serverWatchTries = 0;

// Append a one-click probe to the unreachable note: opening /health in a new
// tab shows plain JSON when the user's network reaches the server, or the
// browser's own network error when it does not — separates "my app is broken"
// from "my network cannot reach the funnel" without any support round-trip.
function appendWatchDiag(box) {
  if (!box) return;
  const a = document.createElement("a");
  a.href = (apiBase() || "") + "/health";
  a.target = "_blank";
  a.rel = "noopener";
  a.textContent = " (open server status)";
  box.appendChild(a);
}

function bumpWatchNote() {
  serverWatchTries += 1;
  const text = `Server unreachable — retrying automatically... (try ${serverWatchTries})`;
  const hint = $("#authHint");
  const regDlg = $("#registerDialog");
  if (hint && !regDlg?.open && (!hint.textContent || hint.textContent.startsWith("Server unreachable"))) {
    hint.textContent = text;
    appendWatchDiag(hint);
  }
  if (regDlg?.open) {
    const regErr = $("#regError");
    if (regErr) {
      regErr.classList.remove("error");
      regErr.classList.add("note");
      regErr.textContent = text;
      regErr.classList.remove("hidden");
      appendWatchDiag(regErr);
    }
  }
}

function startServerWatch() {
  if (serverWatchTimer) return;
  serverWatchTries = 0;
  const hint = $("#authHint");
  const regDlg = $("#registerDialog");
  if (regDlg?.open || (hint && !hint.textContent)) bumpWatchNote();
  serverWatchTimer = setInterval(async () => {
    if (!serverWatchTimer) return;
    try {
      await resolveApiBase(); // re-probe all candidates, repoint if one is healthy
      const h = await api.health();
      if (!h.ok) { bumpWatchNote(); return; }
      stopServerWatch();
      authNotice = "";
      showErr($("#authError"), "");
      if (hint) hint.textContent = "Server is back online — sign in to continue.";
      // The register dialog is a modal <dialog>: everything outside it (toast,
      // auth hint) is stuck in the top-layer backdrop — surface recovery
      // inside the dialog itself.
      const regDlg = $("#registerDialog");
      if (regDlg?.open) {
        const regErr = $("#regError");
        showErr(regErr, "Server is back online — try creating your account again.");
        regErr?.classList.remove("error");
        regErr?.classList.add("note");
      }
      ui.toast("Server is back online");
      playSound("message");
    } catch { bumpWatchNote(); }
  }, 8000);
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
    const netDown = !(e instanceof ApiError) || e.status === 0 || e.status === 502 || e.status === 503;
    authNotice = e instanceof ApiError && e.status === 401
      ? "Session expired — please sign in again."
      : "Cannot reach the msg.mesh server. Check your connection and retry.";
    if (netDown) startServerWatch();
    ui.showAuth("login");
    setMode("login");
    route();
  }
}

boot();
