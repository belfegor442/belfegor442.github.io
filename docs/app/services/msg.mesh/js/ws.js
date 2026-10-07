import { wsEndpoint, getToken, api } from "./api.js";
import { state, emit, ingest, primeUsers } from "./store.js";

const HEARTBEAT_MS = 30000;   // text frame keeps proxies alive (server discards it)
const POLL_MS = 20000;        // history fallback while the socket is down
const MAX_BACKOFF_MS = 30000;

let socket = null;
let heartbeat = null;
let poller = null;
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
    emit("sync", "SYNC ERROR");
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
  setTimeout(connect, delay);
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
        state.peerPointers.set(other, data.last_read_rowid);
      }
      emit("readstate", data);
    }
  };

  ws.onclose = () => {
    stopHeartbeat();
    if (socket === ws) socket = null;
    if (closedByUs) { setConnection("offline"); return; }
    setConnection("offline");
    scheduleReconnect();
  };

  ws.onerror = () => { /* onclose follows */ };
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
  stopPolling();
  if (socket) {
    try { socket.close(); } catch { /* ignore */ }
    socket = null;
  }
  setConnection("offline");
}

export function isOpen() {
  return !!socket && socket.readyState === WebSocket.OPEN;
}
