import { wsEndpoint, getToken, api, failoverBase, notifyUnauthorized } from "./api.js";
import { state, emit, ingest, primeUsers, refreshConversations } from "./store.js";

const HEARTBEAT_MS = 30000;   // text frame keeps proxies alive (server discards it)
const POLL_MS = 20000;        // history fallback while the socket is down
const WATCHDOG_MS = 30000;    // API liveness probe while "online" (half-open sockets)
const MAX_BACKOFF_MS = 30000;

let socket = null;
let heartbeat = null;
let poller = null;
let watchdog = null;
let watchdogFails = 0;
let watchdogProbeInFlight = false;
let pollInFlight = false;
let attempts = 0;
let reconnectTimer = null;
let closedByUs = false;
let started = false;

function setConnection(mode) {
  state.connection = mode;
  emit("connection", mode);
}

function startHeartbeat() {
  stopHeartbeat();
  heartbeat = setInterval(() => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      try { socket.send(JSON.stringify({ type: "ping", ts: Date.now() })); } catch { /* ignore */ }
    }
  }, HEARTBEAT_MS);
}

function stopHeartbeat() {
  if (heartbeat) { clearInterval(heartbeat); heartbeat = null; }
}

// Browsers can keep a dead WebSocket "OPEN" for minutes after the network
// drops. Probe the HTTP side; two straight failures force a reconnect.
function startWatchdog() {
  stopWatchdog();
  watchdogFails = 0;
  watchdog = setInterval(async () => {
    if (watchdogProbeInFlight || !socket || socket.readyState !== WebSocket.OPEN) return;
    const checkedSocket = socket;
    watchdogProbeInFlight = true;
    try {
      const h = await api.health();
      // Ignore a probe that completed after its socket was replaced.
      if (socket !== checkedSocket || checkedSocket.readyState !== WebSocket.OPEN) return;
      if (h.ok) {
        watchdogFails = 0;
        return;
      }
      watchdogFails += 1;
      if (watchdogFails >= 2) {
        try { checkedSocket.close(); } catch { /* onclose follows */ }
      }
    } finally {
      watchdogProbeInFlight = false;
    }
  }, WATCHDOG_MS);
}

function stopWatchdog() {
  if (watchdog) { clearInterval(watchdog); watchdog = null; }
  watchdogFails = 0;
}

async function resync() {
  const sessionToken = getToken();
  const sessionNode = state.selfNode;
  if (!sessionToken || !sessionNode) return;
  try {
    const r = await api.history({ limit: 200 });
    if (getToken() !== sessionToken || state.selfNode !== sessionNode) return;
    ingest(r.items || []);
    await primeUsers();
    if (getToken() !== sessionToken || state.selfNode !== sessionNode) return;
    refreshConversations(true);
    emit("conversations");
    emit("messages");
    const ptr = await api.read(null);
    if (getToken() !== sessionToken || state.selfNode !== sessionNode) return;
    if (ptr && ptr.reads) {
      for (const [peer, rowid] of Object.entries(ptr.reads)) state.pointers.set(peer, rowid);
      emit("conversations");
    }
    emit("sync", "SYNCED");
  } catch (e) {
    emit("sync", e && e.status === 401 ? "SESSION EXPIRED" : "SYNC ERROR");
  }
}

function startPolling() {
  if (poller) return;
  poller = setInterval(async () => {
    if (pollInFlight || !getToken() || socket && socket.readyState === WebSocket.OPEN) return;
    const sessionToken = getToken();
    const sessionNode = state.selfNode;
    if (!sessionNode) return;
    pollInFlight = true;
    try {
      const r = await api.history({ limit: 50 });
      // Ignore a late poll after logout/account switch. Deduplication protects
      // message IDs, not the identity boundary between two local sessions.
      if (getToken() !== sessionToken || state.selfNode !== sessionNode) return;
      ingest(r.items || []);
      await primeUsers();
      if (getToken() !== sessionToken || state.selfNode !== sessionNode) return;
      refreshConversations();
      emit("conversations");
      emit("messages");
      emit("sync", socket && socket.readyState === WebSocket.OPEN ? "SYNCED" : "POLLING");
    } catch { /* server unreachable */ }
    finally { pollInFlight = false; }
  }, POLL_MS);
}

function stopPolling() {
  if (poller) { clearInterval(poller); poller = null; }
}

function scheduleReconnect() {
  if (closedByUs || !started || !getToken() || reconnectTimer !== null) return;
  attempts += 1;
  const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.min(attempts, 5)) + Math.random() * 500;
  setConnection("reconnecting");
  emit("sync", "RECONNECTING");
  if (attempts >= 2) startPolling();
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    // The previous base may be the dead server: probe the others first so
    // the reconnect lands on a live one instead of looping on the same host.
    const switched = attempts >= 1 ? await failoverBase().catch(() => null) : null;
    if (switched) attempts = 0;
    connect();
  }, delay);
}

export function connect() {
  if (!getToken()) return;
  const socketToken = getToken();
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (socket && (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN)) return;
  closedByUs = false;
  started = true;
  setConnection(attempts ? "reconnecting" : "connecting");

  let ws;
  try {
    // No credentials in the URL: the token is sent in the first frame
    // (see onopen), so it never lands in proxy/server logs.
    ws = new WebSocket(wsEndpoint());
  } catch {
    scheduleReconnect();
    return;
  }
  socket = ws;

  ws.onopen = () => {
    // A replaced socket can finish opening after forceReconnect() has already
    // installed its successor. It must not reset timers or mark the new session online.
    // Never authenticate a socket created for an older account with a newer token.
    if (socket !== ws || closedByUs || !started || getToken() !== socketToken) {
      try { ws.close(); } catch { /* already closed */ }
      return;
    }
    attempts = 0;
    try {
      ws.send(JSON.stringify({ type: "auth", session_token: socketToken }));
    } catch { /* onclose follows */ }
    setConnection("online");
    startHeartbeat();
    startWatchdog();
    stopPolling();
    emit("sync", "SYNCED");
    resync();
  };

  ws.onmessage = (ev) => {
    if (socket !== ws || closedByUs || !started) return;
    if (getToken() !== socketToken) {
      try { ws.close(); } catch { /* already closed */ }
      return;
    }
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (!msg || typeof msg !== "object") return;
    const { event, data } = msg;
    if (event === "mesh.message" && data) {
      const c = ingest([data]);
      if (c.length) {
        primeUsers();
        // First traffic in a group this session has not labeled yet (the
        // creator made it while we were online): pull conversation metadata
        // so the sidebar shows the real group name instead of "g<id>".
        if (/^g\d+$/.test(c[0]) && !state.groups.has(c[0])) refreshConversations(true);
        emit("conversations");
        // update: server-initiated control event (edit/delete/react/pin) —
        // consumers must not treat it as a brand-new incoming message.
        emit("messages", { peer: c[0], item: data, update: data.update || undefined });
      }
    } else if (event === "call.signal" && data) {
      // Voice call signaling relayed by the server (invite/SDP/ICE/end).
      emit("call", data);
    } else if (event === "user.updated" && data) {
      // Profile edit from another tab/device of the same account, or a
      // friend's name/avatar refresh pushed by the server.
      emit("userupdated", data);
    } else if (event === "presence" && data) {
      // Live presence transition: {user_id:"u73", status:"online"|"offline"}.
      emit("presence", data);
    } else if (event === "presence.snapshot" && data) {
      // One-shot list of friends already online when this tab attached.
      emit("presence.snapshot", data);
    } else if (event === "typing" && data) {
      // {from:"u73", to:"u76"|"g5"} — server already fence-checked blocks
      // and group membership; the client just renders the indicator.
      emit("typing", data);
    } else if (event === "read.state" && data) {
      const reader = data.reader_node_id;
      const other = reader === state.selfNode ? data.peer_node_id : reader;
      if (reader === state.selfNode) {
        setPointerLocal(data.peer_node_id, data.last_read_rowid);
      } else if (data.peer_node_id === state.selfNode) {
        const cur = state.peerPointers.get(other) || 0;
        if (data.last_read_rowid > cur) state.peerPointers.set(other, data.last_read_rowid);
      }
      emit("readstate", data);
    } else if (event === "error" && data) {
      const code = Number(data.code) || 0;
      // Surface correlated call-signaling failures (offline peer, permission
      // denied, rate limit) instead of leaving the caller ringing until timeout.
      emit("servererror", data);
      if (code === 401) {
        // Session rejected during WS auth: stop reconnecting and hand the
        // session-lost flow to the app (same path as an HTTP 401).
        closedByUs = true;
        started = false;
        stopHeartbeat();
        stopWatchdog();
        stopPolling();
        setConnection("offline");
        try { ws.close(); } catch { /* already closed */ }
        notifyUnauthorized();
      }
    }
  };

  ws.onclose = () => {
    // A deliberately replaced socket can close asynchronously after a new
    // socket has already opened. It must not stop the new socket's watchdog
    // or schedule a second reconnect loop.
    if (socket !== ws) return;
    stopHeartbeat();
    stopWatchdog();
    socket = null;
    if (closedByUs) { setConnection("offline"); return; }
    setConnection("offline");
    scheduleReconnect();
  };

  ws.onerror = () => { /* onclose follows */ };
}

// The OS says connectivity is back: skip the remaining backoff delay.
if (typeof window !== "undefined") {
  window.addEventListener("offline", () => {
    if (!started || !socket) return;
    // Proactively drop the socket: half-open sockets look CONNECTED forever.
    try { socket.close(); } catch { /* onclose follows */ }
  });
  window.addEventListener("online", () => {
    if (started && getToken() && (!socket || socket.readyState === WebSocket.CLOSED)) {
      attempts = 0;
      connect();
    }
  });
}

function setPointerLocal(peer, rowid) {
  const cur = state.pointers.get(peer) || 0;
  if (rowid > cur) state.pointers.set(peer, rowid);
}

export function disconnect() {
  closedByUs = true;
  started = false;
  attempts = 0;
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  stopHeartbeat();
  stopWatchdog();
  stopPolling();
  if (socket) {
    try { socket.close(); } catch { /* ignore */ }
    socket = null;
  }
  setConnection("offline");
}

// Used after a server switch: drop the socket immediately, then reconnect.
export function forceReconnect() {
  if (!started || !getToken()) return;
  attempts = 0;
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (socket) {
    closedByUs = true;
    try { socket.close(); } catch { /* ignore */ }
    socket = null;
    closedByUs = false;
  }
  connect();
}

export function isOpen() {
  return !!socket && socket.readyState === WebSocket.OPEN;
}

// Raw frame out (call signaling uses this; ping/HTTP paths keep their own).
export function sendFrame(obj) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return false;
  try {
    socket.send(JSON.stringify(obj));
    return true;
  } catch { /* onclose follows */ }
  return false;
}
