import { api } from "./api.js";

export const state = {
  user: null,            // {user_id, username, display_name, status, ...}
  profile: { status: "", about: "", avatar: "", photo: "", banner: "" }, // native profile.* (display name stays server-side)
  selfNode: "",          // "u73"
  conversations: new Map(), // peerId -> {peer, messages:[], hasMore}
  convMeta: new Map(),   // peerId -> {unread, last} from /mesh/conversations (server truth beyond the loaded window)
  users: new Map(),      // userId -> {user_id, username, display_name, status, profile?}
  friends: new Map(),    // userId -> {user_id, friendship_id, created_at}
  requests: new Map(),   // request_id -> {request_id, sender_user_id, receiver_user_id, status}
  pointers: new Map(),   // peerId -> my last-read rowid
  peerPointers: new Map(),// peerId -> peer's last-read rowid (towards me)
  activePeer: null,
  filter: "all",
  connection: "offline",
  loading: false,
};

const listeners = new Map();

const PROFILE_KEY = "msg.mesh.profile";

export function loadProfile() {
  try {
    const p = JSON.parse(localStorage.getItem(PROFILE_KEY) || "{}") || {};
    state.profile = {
      status: typeof p.status === "string" ? p.status : "",
      about: typeof p.about === "string" ? p.about : "",
      avatar: typeof p.avatar === "string" ? p.avatar : "",
      photo: typeof p.photo === "string" ? p.photo : "",
      banner: typeof p.banner === "string" ? p.banner : "",
    };
  } catch {
    state.profile = { status: "", about: "", avatar: "", photo: "", banner: "" };
  }
  return state.profile;
}

export function saveProfile(p) {
  state.profile = {
    status: String(p.status || ""),
    about: String(p.about || ""),
    avatar: String(p.avatar || ""),
    photo: String(p.photo || ""),
    banner: String(p.banner || ""),
  };
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(state.profile));
    return true;
  } catch {
    return false;
  }
}

loadProfile();

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
  state.convMeta = new Map();
  if (convRefreshTimer) { clearTimeout(convRefreshTimer); convRefreshTimer = null; }
  state.users = new Map();
  state.friends = new Map();
  state.requests = new Map();
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
  const seen = new Set();
  for (const c of state.conversations.values()) {
    seen.add(c.peer);
    const last = c.messages[c.messages.length - 1];
    const meta = state.convMeta.get(c.peer);
    // Server unread covers messages older than the loaded window; local
    // count stays authoritative for anything just ingested.
    const unread = Math.max(unreadCount(c.peer), meta ? meta.unread : 0);
    rows.push({ peer: c.peer, last, unread, count: c.messages.length });
  }
  // Conversations the server knows but this session has not loaded (older
  // than the history window) still belong in the sidebar.
  for (const [peer, meta] of state.convMeta) {
    if (seen.has(peer) || !meta || !meta.last) continue;
    const l = meta.last;
    const env = parseEnvelope(l.payload);
    rows.push({
      peer,
      last: {
        rowid: l.rowid,
        id: l.message_id,
        mine: l.sender_node_id === state.selfNode,
        text: typeof env.text === "string" ? env.text : "",
        attachment: env.attachment && env.attachment.id ? env.attachment : null,
        type: l.message_type || "message",
        ts: typeof env.ts === "number" ? env.ts : createdMs(l),
      },
      unread: meta.unread || 0,
      count: 0,
    });
    seen.add(peer);
  }
  // Friends with no traffic yet still belong in the sidebar.
  for (const f of state.friends.keys()) {
    const peer = "u" + f;
    if (seen.has(peer)) continue;
    rows.push({ peer, last: null, unread: 0, count: 0 });
    seen.add(peer);
  }
  rows.sort((a, b) => {
    const ar = a.last && a.last.rowid != null ? a.last.rowid : (a.last ? a.last.ts : 0);
    const br = b.last && b.last.rowid != null ? b.last.rowid : (b.last ? b.last.ts : 0);
    return br - ar;
  });
  return rows;
}

// Pull sidebar metadata (last message + unread counts) from the server.
// Debounced so bursts of read/ingest events cost one request; pass
// true to run immediately (session start, reconnect resync).
let convRefreshTimer = null;
export function refreshConversations(immediate = false) {
  if (convRefreshTimer) {
    clearTimeout(convRefreshTimer);
    convRefreshTimer = null;
  }
  const run = async () => {
    if (!state.user) return;
    try {
      const r = await api.meshConversations();
      if (r && Array.isArray(r.conversations)) {
        const meta = new Map();
        for (const c of r.conversations) {
          if (!c || !c.peer) continue;
          meta.set(c.peer, { unread: Number(c.unread) || 0, last: c.last || null });
        }
        state.convMeta = meta;
        emit("conversations");
      }
    } catch { /* offline: keep the last known metadata */ }
  };
  if (immediate) return run();
  convRefreshTimer = setTimeout(() => {
    convRefreshTimer = null;
    run();
  }, 600);
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
  for (const id of state.friends.keys()) {
    if (!state.users.has(String(id))) ids.add(String(id));
  }
  for (const r of state.requests.values()) {
    for (const raw of [r.sender_user_id, r.receiver_user_id]) {
      const id = String(raw);
      if (/^\d+$/.test(id) && !state.users.has(id)) ids.add(id);
    }
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

// Re-fetch a user record (status goes stale otherwise: users.status only
// changes on login, so we re-read it when looking at someone).
export async function refreshUser(userId) {
  const id = String(userId);
  try {
    const r = await api.usersGet(id);
    if (r && r.found !== false && r.user) {
      const u = { ...r.user, user_id: String(r.user.user_id) };
      state.users.set(id, u);
      return u;
    }
  } catch { /* ignore */ }
  return state.users.get(id) || null;
}

/* ---------------- friends ---------------- */

function selfId() {
  return state.user ? String(state.user.user_id) : "";
}

export function isFriend(userId) {
  return state.friends.has(String(userId));
}

export function incomingRequests() {
  const me = selfId();
  return [...state.requests.values()].filter((r) => String(r.receiver_user_id) === me);
}

export function outgoingRequests() {
  const me = selfId();
  return [...state.requests.values()].filter((r) => String(r.sender_user_id) === me);
}

export function incomingFrom(userId) {
  return incomingRequests().find((r) => String(r.sender_user_id) === String(userId)) || null;
}

export function outgoingTo(userId) {
  return outgoingRequests().find((r) => String(r.receiver_user_id) === String(userId)) || null;
}

// Pull the authoritative friendship state from the server.
export async function loadFriends() {
  const [fl, fr] = await Promise.all([
    api.friendsList().catch(() => null),
    api.friendRequests().catch(() => null),
  ]);
  if (fl && Array.isArray(fl.friends)) {
    state.friends = new Map();
    const me = selfId();
    for (const f of fl.friends) {
      const a = String(f.user_a);
      const b = String(f.user_b);
      const other = a === me ? b : a;
      if (other && other !== me && f.status === "active") {
        state.friends.set(other, { user_id: other, friendship_id: f.friendship_id, created_at: f.created_at });
      }
    }
  }
  if (fr && Array.isArray(fr.requests)) {
    state.requests = new Map();
    for (const r of fr.requests) {
      if (r.status === "pending") state.requests.set(String(r.request_id), r);
    }
  }
  emit("friends");
  return true;
}

export function upsertFriend(userId) {
  const id = String(userId);
  state.friends.set(id, { user_id: id, friendship_id: "", created_at: "" });
  for (const [rid, r] of state.requests) {
    if (String(r.sender_user_id) === id || String(r.receiver_user_id) === id) {
      state.requests.delete(rid);
    }
  }
}
