const API_BASE_KEY = "msg.mesh.api";
const TOKEN_KEY = "msg.mesh.token";
const LAST_USER_KEY = "msg.mesh.lastUser";

// Known production endpoints, probed in order until one answers /health.
// The primary server may be offline; the client must not stay dead because
// of it — every candidate speaking the msg.mesh protocol is equivalent.
// pene is the live server (Tailscale Funnel, publicly reachable);
// belfegor442-pc is a secondary node that may be offline.
const SERVER_CANDIDATES = [
  "https://pene.tail026d9a.ts.net",
  "https://belfegor442-pc.tail026d9a.ts.net",
];

const DEFAULT_API = SERVER_CANDIDATES[0];

function safeGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function safeSet(key, value) {
  try { localStorage.setItem(key, value); } catch { /* private mode */ }
}
function safeRemove(key) {
  try { localStorage.removeItem(key); } catch { /* private mode */ }
}

let base = "";

export function apiBase() { return base; }
export { isHttpsUrl, isLocalhost, isAllowedBase };

export function setApiBase(next) {
  base = String(next || "").replace(/\/+$/, "");
  if (base) safeSet(API_BASE_KEY, base);
  else safeRemove(API_BASE_KEY);
}

function baseFromQuery() {
  const q = new URLSearchParams(location.search).get("api");
  if (!q) return "";
  const candidate = q.replace(/\/+$/, "");
  // Never send login credentials to an arbitrary HTTPS host supplied by a
  // shared URL. Custom servers remain available through the explicit server
  // settings flow, where the user can validate the destination themselves.
  if (SERVER_CANDIDATES.includes(candidate) || isLocalhost(candidate)) return candidate;
  return "";
}

function isHttpsUrl(u) {
  try {
    const parsed = new URL(u);
    return parsed.protocol === "https:";
  } catch { return false; }
}
function isLocalhost(u) {
  try {
    const parsed = new URL(u);
    return parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "::1";
  } catch { return false; }
}
function isAllowedBase(u) {
  return isHttpsUrl(u) || isLocalhost(u);
}

export function wsEndpoint() {
  return apiBase().replace(/^http/, "ws") + "/ws";
}

// Cheap liveness check for the current base (login screen auto-retry).
export async function pingServer(timeoutMs = 5000) {
  return probe(apiBase(), timeoutMs);
}

async function probe(url, timeoutMs = 5000) {
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const res = await fetch(url + "/health", {
      method: "GET",
      cache: "no-store",
      signal: ctrl ? ctrl.signal : undefined,
    });
    if (!res.ok) return false;
    const j = await res.json().catch(() => null);
    return !!j && j.status === "ok";
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Resolve the API base before the app starts:
//   explicit candidate (user-initiated switch): probe it, null if dead
//   1. explicit ?api= query (persisted)
//   2. previously chosen server (verified first, kept if reachable)
//   3. candidate list, first healthy wins
// Never assumes localhost or any single host.
export async function resolveApiBase(candidate) {
  if (candidate) {
    if (!isAllowedBase(candidate)) return null;
    if (await probe(candidate)) {
      setApiBase(candidate);
      return candidate;
    }
    return null;
  }
  const fromQuery = baseFromQuery();
  if (fromQuery) {
    // ?api= is attacker-influenceable (shared link): never trust it without
    // an HTTPS/localhost check AND a live /health probe before persisting.
    if (!isAllowedBase(fromQuery)) {
      // fall through to stored/candidates instead of honouring a poisoned base
    } else if (await probe(fromQuery)) {
      setApiBase(fromQuery);
      return fromQuery;
    }
    // dead or rejected query base: do NOT persist, fall through
  }
  const stored = safeGet(API_BASE_KEY);
  const order = [];
  if (stored && isAllowedBase(stored)) order.push(stored);
  for (const c of SERVER_CANDIDATES) if (!order.includes(c)) order.push(c);

  // Probe every candidate in parallel: a dead server costs one timeout
  // instead of one timeout per candidate (was up to ~30s of dead air).
  const hits = await Promise.all(order.map((c) => probe(c, 5000)));
  const idx = hits.indexOf(true);
  if (idx >= 0) {
    setApiBase(order[idx]);
    return order[idx];
  }
  // Nothing answered: keep the remembered/primary URL so the UI can show a
  // real "server unreachable" state instead of guessing forever.
  // But if the stored URL was tried and failed, drop it so next load
  // starts fresh with the candidate list (avoids pinning a dead server).
  if (stored && !SERVER_CANDIDATES.includes(stored) && isAllowedBase(stored)) {
    // custom user URL — keep it (they chose it explicitly via validated flow)
  } else {
    safeRemove(API_BASE_KEY);
  }
  setApiBase((stored && isAllowedBase(stored) && !SERVER_CANDIDATES.includes(stored)) ? stored : DEFAULT_API);
  return base;
}

export function lastUsername() { return safeGet(LAST_USER_KEY) || ""; }
export function rememberUsername(u) { safeSet(LAST_USER_KEY, u || ""); }

let token = safeGet(TOKEN_KEY) || "";

export function getToken() { return token; }
export function setToken(next) {
  token = next || "";
  if (token) safeSet(TOKEN_KEY, token);
  else safeRemove(TOKEN_KEY);
}

// Keep separate tabs on the same browser origin from silently retaining an
// older account session. Reloading lets the normal boot flow pick up the new
// token (or show login after logout) and drops all in-memory private caches.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === TOKEN_KEY && (event.newValue || "") !== token) {
      window.location.reload();
    }
  });
}

export class ApiError extends Error {
  constructor(status, payload) {
    super((payload && payload.error) || `HTTP ${status}`);
    this.status = status;
    this.payload = payload || {};
  }
}

// Fired when the server rejects the session mid-flight (401).
// The handler must be idempotent — parallel calls may trigger it together.
let onUnauthorized = null;
export function setOnUnauthorized(fn) { onUnauthorized = fn; }
// Same signal for non-HTTP callers (the WebSocket auth frame path).
export function notifyUnauthorized() {
  if (onUnauthorized) {
    try { onUnauthorized(); } catch { /* idempotent handler */ }
  }
}

// Fired after a successful mid-session failover so the WebSocket layer can
// drop its (dead) socket and reconnect against the new base immediately,
// instead of waiting for the watchdog to notice the half-open connection.
let onServerSwitch = null;
export function setOnServerSwitch(fn) { onServerSwitch = fn; }

const FRIENDLY = {
  0: "Cannot reach the msg.mesh server. Check your connection.",
  401: "Your session is no longer valid. Please sign in again.",
  403: "You do not have permission to do that.",
  404: "Not found on the server.",
  409: "That conflicts with something that already exists.",
  429: "Too many requests — slow down for a moment.",
  500: "The server hit an internal error.",
  502: "The msg.mesh server is unreachable right now.",
  503: "The msg.mesh server is starting up or unavailable.",
};

export function friendlyError(err) {
  if (!(err instanceof ApiError)) return "Something went wrong. Please try again.";
  // Status 0 covers both "never reached the server" and "gave up waiting":
  // a slow/busy server must not masquerade as an outage.
  if (err.status === 0 && /did not respond in time/.test(err.message || "")) {
    return "The msg.mesh server took too long to respond — it may be busy. Try again in a moment.";
  }
  if (FRIENDLY[err.status]) return FRIENDLY[err.status];
  return err.message || `Server error (${err.status}).`;
}

async function call(path, data, opts = {}) {
  // Bind each request to the session that started it. A late network failure
  // must not replay an account-A operation using account B's newer token.
  const requestToken = token;
  const headers = { "Content-Type": "application/json" };
  if (requestToken) headers["X-Session-Token"] = requestToken;
  let res;
  let timeoutController = null;
  let timeoutTimer = null;
  let requestSignal = opts.signal;
  if (requestSignal === undefined) {
    const timeoutMs = opts.timeoutMs || 15000;
    if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
      requestSignal = AbortSignal.timeout(timeoutMs);
    } else if (typeof AbortController !== "undefined") {
      // Older browsers (including embedded WebViews) lack AbortSignal.timeout.
      // Keep the same bounded request time instead of hanging forever.
      timeoutController = new AbortController();
      requestSignal = timeoutController.signal;
      timeoutTimer = setTimeout(() => timeoutController.abort(), timeoutMs);
    }
  }
  try {
    res = await fetch(apiBase() + path, {
      method: "POST",
      headers,
      body: JSON.stringify(data || {}),
      signal: requestSignal,
      cache: "no-store",
    });
    if (timeoutTimer) { clearTimeout(timeoutTimer); timeoutTimer = null; }
  } catch (e) {
    if (timeoutTimer) { clearTimeout(timeoutTimer); timeoutTimer = null; }
    const timedOut = !!(e && (e.name === "TimeoutError" || e.name === "AbortError"));
    if (!opts.noFailover) {
      const switched = await failoverBase().catch(() => null);
      // Timeouts may have been processed: switch but don't replay. Replays
      // are limited to idempotent requests — the connection can die after the
      // server committed a state change (friend request, profile update), and
      // replaying those on the new base would execute them twice.
      if (switched && !timedOut && token === requestToken && opts.idempotent) {
        return call(path, data, { ...opts, noFailover: true });
      }
      if (token !== requestToken) {
        throw new ApiError(0, { error: "session changed while request was in flight" });
      }
    }
    if (timedOut) {
      throw new ApiError(0, { error: "the msg.mesh server did not respond in time" });
    }
    throw new ApiError(0, { error: "cannot reach the msg.mesh server" });
  }
  // Ignore late responses after logout or account switch. This also avoids
  // a stale 401 logging out a different, newly authenticated account.
  if (token !== requestToken) {
    throw new ApiError(0, { error: "session changed while request was in flight" });
  }
  let payload = {};
  try { payload = await res.json(); } catch { /* empty body */ }
  if (res.status === 401 && requestToken && !opts.allow401 && onUnauthorized) {
    onUnauthorized();
  }
  if (!res.ok) throw new ApiError(res.status, payload);
  return payload;
}

// Auto-failover for mid-session server death: on a network error, probe the
// other known candidates and switch to the first that answers. An explicit
// ?api= pin is never overridden. Concurrent failures share one probe run.
let failoverInFlight = null;
export function failoverBase() {
  if (failoverInFlight) return failoverInFlight;
  failoverInFlight = (async () => {
    if (baseFromQuery()) return null;
    const prev = base;
    for (const cand of SERVER_CANDIDATES) {
      if (cand === prev) continue;
      if (await probe(cand, 3000)) {
        setApiBase(cand);
        if (onServerSwitch) {
          try { onServerSwitch(cand, prev); } catch { /* optional hook */ }
        }
        return cand;
      }
    }
    return null;
  })().finally(() => { failoverInFlight = null; });
  return failoverInFlight;
}

export const api = {
  health: async () => {
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), 5000) : null;
    try {
      const res = await fetch(apiBase() + "/health", {
        cache: "no-store",
        signal: ctrl ? ctrl.signal : undefined,
      });
      if (!res.ok) return { ok: false };
      const j = await res.json().catch(() => ({}));
      return { ok: j.status === "ok", ...j };
    } catch {
      return { ok: false };
    } finally {
      if (timer) clearTimeout(timer);
    }
  },

  // Auth endpoints hash passwords server-side (PBKDF2 100k): give them more
  // headroom than regular calls so a busy server reads as slow, not dead.
  login: (username, password) => call("/api/v1/users/login", { username, password }, { allow401: true, timeoutMs: 30000 }),
  register: (username, password, display_name) =>
    call("/api/v1/users/register", { username, password, display_name }, { allow401: true, timeoutMs: 30000 }),
  whoami: (opts = {}) => call("/api/v1/auth/whoami", {}, { idempotent: true, ...opts }),
  logout: () => call("/api/v1/auth/logout", { session_token: getToken() }, { allow401: true, idempotent: true }),

  history: (o = {}) => call("/api/v1/mesh/history", { limit: 200, ...o }, { idempotent: true }),
  // client_msg_id makes retries idempotent: re-sending the same id returns
  // the original message instead of storing a duplicate.
  send: (receiver_node_id, message_type, payload, client_msg_id) => {
    const body = { receiver_node_id, message_type, payload };
    if (client_msg_id) body.client_msg_id = client_msg_id;
    return call("/api/v1/mesh/send", body, { idempotent: true });
  },
  meshConversations: () => call("/api/v1/mesh/conversations", {}, { idempotent: true }),
  read: (peer_node_id, last_read_rowid) => {
    const body = {};
    if (peer_node_id) body.peer_node_id = peer_node_id;
    if (last_read_rowid != null) body.last_read_rowid = last_read_rowid;
    return call("/api/v1/mesh/read", body, { idempotent: true });
  },
  searchMessages: (query, o = {}) =>
    call("/api/v1/mesh/search", { query, limit: 50, ...o }, { idempotent: true }),

  // Message control (edit / delete / react / pin). Every endpoint is
  // read-modify-write on one row, so retries are safe with failover enabled.
  editMessage: (message_id, text) =>
    call("/api/v1/mesh/edit", { message_id, text }, { idempotent: true }),
  deleteMessage: (message_id) =>
    call("/api/v1/mesh/delete", { message_id }, { idempotent: true }),
  reactMessage: (message_id, emoji, on) =>
    call("/api/v1/mesh/react", { message_id, emoji, on }, { idempotent: true }),
  pinMessage: (message_id, pinned) =>
    call("/api/v1/mesh/pin", { message_id, pinned }, { idempotent: true }),

  usersSearch: (query) => call("/api/v1/users/search", { query }, { idempotent: true }),
  usersGet: (user_id) => call("/api/v1/users/get", { user_id: Number(user_id) }, { idempotent: true }),
  // Accepts an object of fields ({display_name, status_text, about, avatar,
  // photo, banner}) or a plain display name string (legacy callers).
  usersUpdate: (fields) =>
    call("/api/v1/users/update",
      typeof fields === "string" ? { display_name: fields } : (fields || {}),
      { idempotent: true }),

  friendsList: () => call("/api/v1/friends/list", {}, { idempotent: true }),
  friendRequests: () => call("/api/v1/friends/requests", {}, { idempotent: true }),
  friendRequest: (receiver_id) => call("/api/v1/friends/request", { receiver_id: Number(receiver_id) }),
  friendAccept: (request_id) => call("/api/v1/friends/accept", { request_id: Number(request_id) }),
  friendReject: (request_id) => call("/api/v1/friends/reject", { request_id: Number(request_id) }),
  friendRemove: (friendship_id) => call("/api/v1/friends/remove", { friendship_id: Number(friendship_id) }),

  upload: (filename, content_type, content_base64, size_bytes) =>
    call("/api/v1/files/upload", { filename, content_type, content_base64, size_bytes }),
  download: (attachment_id) =>
    call("/api/v1/files/download", { attachment_id }, { idempotent: true }),
};
