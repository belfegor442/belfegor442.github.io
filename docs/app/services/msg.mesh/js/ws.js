import { wsEndpoint, getToken, api, failoverBase } from "./api.js";
import { state, emit, ingest, primeUsers } from "./store.js";

const HEARTBEAT_MS = 30000;   // text frame keeps proxies alive (server discards it)
const POLL_MS = 20000;        // history fallback while the socket is down
const WATCHDOG_MS = 30000;    // API liveness probe while "online" (half-open sockets)
const MAX_BACKOFF_MS = 30000;

let socket = null;
let heartbeat = null;
let poller = null;
let watchdog = null;
let watchdogFails = 0;
let attempts = 0;
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
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    const h = await api.health();
    if (h.ok) {
      watchdogFails = 0;
      return;
    }
    watchdogFails += 1;
    if (watchdogFails >= 2) {
      try { socket.close(); } catch { /* onclose follows */ }
    }
  }, WATCHDOG_MS);
}

function stopWatchdog() {
  if (watchdog) { clearInterval(watchdog); watchdog = null; }
  watchdogFails = 0;
}

async function resync() {
  try {
    const r = await api.history({ limit: 200 });
    ingest(r.items || []);
    await primeUsers();
    emit("conversations");
    emit("messages");
    const ptr = await api.read(null);
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
    if (!getToken()) return;
    try {
      const r = await api.history({ limit: 50 });
      ingest(r.items || []);
      await primeUsers();
      emit("conversations");
      emit("messages");
      emit("sync", "POLLING");
    } catch { /* server unreachable */ }
  }, POLL_MS);
}

function stopPolling() {
  if (poller) { clearInterval(poller); poller = null; }
}

function scheduleReconnect() {
  if (closedByUs || !started || !getToken()) return;
  attempts += 1;
  const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.min(attempts, 5)) + Math.random() * 500;
  setConnection("reconnecting");
  emit("sync", "RECONNECTING");
  if (attempts >= 2) startPolling();
  setTimeout(async () => {
    // The previous base may be the dead server: probe the others first so
    // the reconnect lands on a live one instead of looping on the same host.
    const switched = attempts >= 1 ? await failoverBase().catch(() => null) : null;
    if (switched) attempts = 0;
    connect();
  }, delay);
}

export function connect() {
  if (!getToken()) return;
  if (socket && (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN)) return;
  closedByUs = false;
  started = true;
  setConnection(attempts ? "reconnecting" : "connecting");

  let ws;
  try {
    ws = new WebSocket(`${wsEndpoint()}?session_token=${encodeURIComponent(getToken())}`);
  } catch {
    scheduleReconnect();
    return;
  }
  socket = ws;

  ws.onopen = () => {
    attempts = 0;
    setConnection("online");
    startHeartbeat();
    startWatchdog();
    stopPolling();
    emit("sync", "SYNCED");
    resync();
  };

  ws.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (!msg || typeof msg !== "object") return;
    const { event, data } = msg;
    if (event === "mesh.message" && data) {
      const c = ingest([data]);
      if (c.length) {
        primeUsers();
        emit("conversations");
        emit("messages", { peer: c[0], item: data });
      }
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
    }
  };

  ws.onclose = () => {
    stopHeartbeat();
    stopWatchdog();
    if (socket === ws) socket = null;
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
