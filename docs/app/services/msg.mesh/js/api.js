const API_BASE_KEY = "msg.mesh.api";
const TOKEN_KEY = "msg.mesh.token";
const LAST_USER_KEY = "msg.mesh.lastUser";

// Known production endpoints, probed in order until one answers /health.
// The primary server may be offline; the client must not stay dead because
// of it — every candidate speaking the msg.mesh protocol is equivalent.
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

export function setApiBase(next) {
  base = String(next || "").replace(/\/+$/, "");
  if (base) safeSet(API_BASE_KEY, base);
  else safeRemove(API_BASE_KEY);
}

function baseFromQuery() {
  const q = new URLSearchParams(location.search).get("api");
  return q ? q.replace(/\/+$/, "") : "";
}

export function wsEndpoint() {
  return apiBase().replace(/^http/, "ws") + "/ws";
}

async function probe(url, timeoutMs = 4000) {
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
    if (await probe(candidate)) {
      setApiBase(candidate);
      return candidate;
    }
    return null;
  }
  const fromQuery = baseFromQuery();
  if (fromQuery) {
    setApiBase(fromQuery);
    return fromQuery;
  }
  const stored = safeGet(API_BASE_KEY);
  const order = [];
  if (stored) order.push(stored);
  for (const c of SERVER_CANDIDATES) if (!order.includes(c)) order.push(c);

  for (const candidate of order) {
    if (await probe(candidate)) {
      setApiBase(candidate);
      return candidate;
    }
  }
  // Nothing answered: keep the remembered/primary URL so the UI can show a
  // real "server unreachable" state instead of guessing forever.
  setApiBase(stored || DEFAULT_API);
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
  if (FRIENDLY[err.status]) return FRIENDLY[err.status];
  return err.message || `Server error (${err.status}).`;
}

async function call(path, data, opts = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers["X-Session-Token"] = token;
  let res;
  try {
    res = await fetch(apiBase() + path, {
      method: "POST",
      headers,
      body: JSON.stringify(data || {}),
      signal: opts.signal !== undefined
        ? opts.signal
        : (typeof AbortSignal !== "undefined" && AbortSignal.timeout
            ? AbortSignal.timeout(opts.timeoutMs || 15000)
            : undefined),
      cache: "no-store",
    });
  } catch (e) {
    const timedOut = !!(e && (e.name === "TimeoutError" || e.name === "AbortError"));
    if (!opts.noFailover) {
      const switched = await failoverBase().catch(() => null);
      // Connection-level errors never reached the server: safe to replay on
      // the new base. Timeouts may have been processed: switch but don't replay.
      if (switched && !timedOut) return call(path, data, { ...opts, noFailover: true });
    }
    if (timedOut) {
      throw new ApiError(0, { error: "the msg.mesh server did not respond in time" });
    }
    throw new ApiError(0, { error: "cannot reach the msg.mesh server" });
  }
  let payload = {};
  try { payload = await res.json(); } catch { /* empty body */ }
  if (res.status === 401 && token && !opts.allow401 && onUnauthorized) {
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
        return cand;
      }
    }
    return null;
  })().finally(() => { failoverInFlight = null; });
  return failoverInFlight;
}

export const api = {
  health: async () => {
    try {
      const res = await fetch(apiBase() + "/health", { cache: "no-store", signal: AbortSignal.timeout(5000) });
      if (!res.ok) return { ok: false };
      const j = await res.json().catch(() => ({}));
      return { ok: j.status === "ok", ...j };
    } catch {
      return { ok: false };
    }
  },

  login: (username, password) => call("/api/v1/users/login", { username, password }, { allow401: true }),
  register: (username, password, display_name) =>
    call("/api/v1/users/register", { username, password, display_name }, { allow401: true }),
  whoami: (opts = {}) => call("/api/v1/auth/whoami", {}, opts),
  logout: () => call("/api/v1/auth/logout", { session_token: getToken() }, { allow401: true }),

  history: (o = {}) => call("/api/v1/mesh/history", { limit: 200, ...o }),
  send: (receiver_node_id, message_type, payload) =>
    call("/api/v1/mesh/send", { receiver_node_id, message_type, payload }),
  read: (peer_node_id, last_read_rowid) => {
    const body = {};
    if (peer_node_id) body.peer_node_id = peer_node_id;
    if (last_read_rowid != null) body.last_read_rowid = last_read_rowid;
    return call("/api/v1/mesh/read", body);
  },
  searchMessages: (query, o = {}) => call("/api/v1/mesh/search", { query, limit: 50, ...o }),

  usersSearch: (query) => call("/api/v1/users/search", { query }),
  usersGet: (user_id) => call("/api/v1/users/get", { user_id: Number(user_id) }),
  usersUpdate: (display_name) => call("/api/v1/users/update", { display_name }),

  friendsList: () => call("/api/v1/friends/list", {}),
  friendRequests: () => call("/api/v1/friends/requests", {}),
  friendRequest: (receiver_id) => call("/api/v1/friends/request", { receiver_id: Number(receiver_id) }),
  friendAccept: (request_id) => call("/api/v1/friends/accept", { request_id: Number(request_id) }),
  friendReject: (request_id) => call("/api/v1/friends/reject", { request_id: Number(request_id) }),
  friendRemove: (friendship_id) => call("/api/v1/friends/remove", { friendship_id: Number(friendship_id) }),

  upload: (filename, content_type, content_base64, size_bytes) =>
    call("/api/v1/files/upload", { filename, content_type, content_base64, size_bytes }),
  download: (attachment_id) => call("/api/v1/files/download", { attachment_id }),
};
