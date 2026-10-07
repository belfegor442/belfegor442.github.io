import { api } from "./api.js";

export const state = {
  user: null,            // {user_id, username, display_name, status, ...}
  selfNode: "",          // "u73"
  conversations: new Map(), // peerId -> {peer, messages:[], hasMore}
  users: new Map(),      // userId -> {user_id, username, display_name, status}
  pointers: new Map(),   // peerId -> my last-read rowid
  peerPointers: new Map(),// peerId -> peer's last-read rowid (towards me)
  activePeer: null,
  filter: "all",
  connection: "offline",
  loading: false,
};

const listeners = new Map();

export function on(type, fn) {
  if (!listeners.has(type)) listeners.set(type, new Set());
  listeners.get(type).add(fn);
  return () => listeners.get(type).delete(fn);
}

export function emit(type, detail) {
  const set = listeners.get(type);
  if (set) for (const fn of [...set]) {
    try { fn(detail); } catch (e) { console.error(e); }
  }
}

export function resetState() {
  state.user = null;
  state.selfNode = "";
  state.conversations = new Map();
  state.users = new Map();
  state.pointers = new Map();
  state.peerPointers = new Map();
  state.activePeer = null;
  state.connection = "offline";
}

export function conv(peer) {
  let c = state.conversations.get(peer);
  if (!c) {
    c = { peer, messages: [], hasMore: false };
    state.conversations.set(peer, c);
  }
  return c;
}

function parseEnvelope(raw) {
  if (typeof raw !== "string") return {};
  try { return JSON.parse(raw) || {}; } catch { return {}; }
}

function createdMs(item) {
  const iso = String(item.created_at || "").replace(" ", "T") + (String(item.created_at || "").endsWith("Z") ? "" : "Z");
  const t = Date.parse(iso);
  return Number.isNaN(t) ? Date.now() : t;
}

function normalize(item, mine) {
  const env = parseEnvelope(item.payload);
  return {
    rowid: item.rowid,
    id: item.message_id,
    mine,
    sender: item.sender_node_id,
    receiver: item.receiver_node_id,
    type: item.message_type || "text",
    text: typeof env.text === "string" ? env.text : "",
    env,
    attachment: env.attachment && env.attachment.id ? env.attachment : null,
    ts: typeof env.ts === "number" ? env.ts : createdMs(item),
    created: item.created_at || "",
    sync: "ok",
  };
}

function sortMessages(c) {
  c.messages.sort((a, b) => {
    const ar = a.rowid != null ? a.rowid : Number.MAX_SAFE_INTEGER;
    const br = b.rowid != null ? b.rowid : Number.MAX_SAFE_INTEGER;
    if (ar !== br) return ar - br;
    return (a.ts || 0) - (b.ts || 0);
  });
}

// Returns the conversation the item belongs to.
export function ingestOne(item) {
  if (!item || !item.message_id) return null;
  const sender = item.sender_node_id || "";
  const receiver = item.receiver_node_id || "";
  const mine = sender === state.selfNode;
  const peer = mine ? receiver : sender;
  if (!peer) return null;
  const c = conv(peer);
  const existing = c.messages.find((m) => m.id === item.message_id);
  const next = normalize(item, mine);
  if (existing) {
    const wasPending = existing.rowid == null;
    Object.assign(existing, next);
    if (wasPending) existing.sync = "ok";
  } else if (mine) {
    // The optimistic local copy (still keyed by its temp id) wins the race:
    // replace it so the echo does not duplicate the message.
    const temp = c.messages.find(
      (m) => m.rowid == null && m.mine && String(m.id).startsWith("tmp-") &&
        m.ts === next.ts && m.text === next.text
    );
    if (temp) c.messages.splice(c.messages.indexOf(temp), 1);
    c.messages.push(next);
  } else {
    c.messages.push(next);
  }
  sortMessages(c);
  return c;
}

// Bulk ingest (history / search results). Returns touched peers.
export function ingest(items) {
  const touched = new Set();
  for (const item of items || []) {
    const c = ingestOne(item);
    if (c) touched.add(c.peer);
  }
  return [...touched];
}

// Optimistic local message (before the server acknowledges it).
export function pushLocal(peer, partial) {
  const c = conv(peer);
  const m = {
    rowid: null,
    id: partial.id,
    mine: true,
    sender: state.selfNode,
    receiver: peer,
    type: "text",
    text: partial.text || "",
    env: partial.env || {},
    attachment: partial.attachment || null,
    ts: partial.ts || Date.now(),
    created: "",
    sync: "sending",
  };
  c.messages.push(m);
  sortMessages(c);
  return m;
}

export function findMessage(peer, id) {
  const c = state.conversations.get(peer);
  return c ? c.messages.find((m) => m.id === id) : null;
}

export function maxRowid(peer) {
  const c = state.conversations.get(peer);
  if (!c) return 0;
  let max = 0;
  for (const m of c.messages) if (m.rowid != null && m.rowid > max) max = m.rowid;
  return max;
}

export function unreadCount(peer) {
  const c = state.conversations.get(peer);
  if (!c) return 0;
  const ptr = state.pointers.get(peer) || 0;
  let n = 0;
  for (const m of c.messages) if (!m.mine && m.rowid != null && m.rowid > ptr) n++;
  return n;
}

export function totalUnread() {
  let n = 0;
  for (const peer of state.conversations.keys()) n += unreadCount(peer);
  return n;
}

export function conversationOrder() {
  const rows = [];
  for (const c of state.conversations.values()) {
    const last = c.messages[c.messages.length - 1];
    rows.push({ peer: c.peer, last, unread: unreadCount(c.peer), count: c.messages.length });
  }
  rows.sort((a, b) => {
    const ar = a.last && a.last.rowid != null ? a.last.rowid : (a.last ? a.last.ts : 0);
    const br = b.last && b.last.rowid != null ? b.last.rowid : (b.last ? b.last.ts : 0);
    return br - ar;
  });
  return rows;
}

export function peerUser(peer) {
  const m = /^u(\d+)$/.exec(peer || "");
  return m ? state.users.get(m[1]) || null : null;
}

export function peerLabel(peer) {
  const u = peerUser(peer);
  if (u) return u.display_name || u.username || peer;
  return peer || "unknown";
}

export function setPointer(peer, rowid) {
  const cur = state.pointers.get(peer) || 0;
  if (rowid > cur) state.pointers.set(peer, rowid);
  return state.pointers.get(peer) || 0;
}

// Resolve u<id> peers to usernames (cached).
export async function primeUsers() {
  const ids = new Set();
  for (const peer of state.conversations.keys()) {
    const m = /^u(\d+)$/.exec(peer || "");
    if (m && !state.users.has(m[1])) ids.add(m[1]);
  }
  await Promise.all([...ids].map(async (id) => {
    try {
      const r = await api.usersGet(id);
      if (r && r.found !== false && r.user) {
        state.users.set(String(r.user.user_id), { ...r.user, user_id: String(r.user.user_id) });
      }
    } catch { /* user may be a device node or removed */ }
  }));
  return ids.size;
}

export async function rememberUser(userId) {
  const id = String(userId);
  if (state.users.has(id)) return state.users.get(id);
  try {
    const r = await api.usersGet(id);
    if (r && r.found !== false && r.user) {
      const u = { ...r.user, user_id: String(r.user.user_id) };
      state.users.set(id, u);
      return u;
    }
  } catch { /* ignore */ }
  return null;
}
