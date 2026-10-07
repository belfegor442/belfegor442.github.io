const API_BASE_KEY = "msg.mesh.api";
const TOKEN_KEY = "msg.mesh.token";

const DEFAULT_API = "https://belfegor442-pc.tail026d9a.ts.net";

export function apiBase() {
  let base = localStorage.getItem(API_BASE_KEY);
  if (!base) {
    const q = new URLSearchParams(location.search).get("api");
    if (q) {
      base = q.replace(/\/+$/, "");
      localStorage.setItem(API_BASE_KEY, base);
    } else {
      base = DEFAULT_API;
    }
  }
  return base;
}

export function wsEndpoint() {
  return apiBase().replace(/^http/, "ws") + "/ws";
}

let token = localStorage.getItem(TOKEN_KEY) || "";

export function getToken() { return token; }
export function setToken(next) {
  token = next || "";
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(status, payload) {
    super((payload && payload.error) || `HTTP ${status}`);
    this.status = status;
    this.payload = payload || {};
  }
}

async function call(path, data) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers["X-Session-Token"] = token;
  let res;
  try {
    res = await fetch(apiBase() + path, {
      method: "POST",
      headers,
      body: JSON.stringify(data || {}),
    });
  } catch (e) {
    throw new ApiError(0, { error: "cannot reach the msg.mesh server" });
  }
  let payload = {};
  try { payload = await res.json(); } catch { /* empty body */ }
  if (!res.ok) throw new ApiError(res.status, payload);
  return payload;
}

export const api = {
  login: (username, password) => call("/api/v1/users/login", { username, password }),
  register: (username, password, display_name) =>
    call("/api/v1/users/register", { username, password, display_name }),
  whoami: () => call("/api/v1/auth/whoami", {}),
  logout: () => call("/api/v1/auth/logout", { session_token: token }),

  history: (opts = {}) => call("/api/v1/mesh/history", { limit: 200, ...opts }),
  send: (receiver_node_id, message_type, payload) =>
    call("/api/v1/mesh/send", { receiver_node_id, message_type, payload }),
  read: (peer_node_id, last_read_rowid) => {
    const body = {};
    if (peer_node_id) body.peer_node_id = peer_node_id;
    if (last_read_rowid != null) body.last_read_rowid = last_read_rowid;
    return call("/api/v1/mesh/read", body);
  },
  searchMessages: (query, opts = {}) =>
    call("/api/v1/mesh/search", { query, limit: 50, ...opts }),

  usersSearch: (query) => call("/api/v1/users/search", { query }),
  usersGet: (user_id) => call("/api/v1/users/get", { user_id: Number(user_id) }),
  usersUpdate: (display_name) => call("/api/v1/users/update", { display_name }),

  upload: (filename, content_type, content_base64, size_bytes) =>
    call("/api/v1/files/upload", { filename, content_type, content_base64, size_bytes }),
  download: (attachment_id) => call("/api/v1/files/download", { attachment_id }),
};
