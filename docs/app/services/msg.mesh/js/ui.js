import { state, conversationOrder, peerLabel, peerUser, peerOnline, isTyping, isFriend, incomingRequests, outgoingRequests } from "./store.js";
import { playSound } from "./infrastructure/sound.js";
import { api, getToken } from "./api.js";
import { emoteFile } from "./shared/emoticons.js";

export const $ = (s) => document.querySelector(s);

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function initials(name) {
  return String(name || "?").trim().split(/\s+/).map((x) => x[0]).join("").slice(0, 2).toUpperCase() || "?";
}

const fmtTime = (d) => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });

function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dayLabel(ts) {
  const d = new Date(ts);
  const today = new Date();
  const yest = new Date(Date.now() - 86400000);
  const k = dayKey(ts);
  if (k === dayKey(today.getTime())) return "TODAY";
  if (k === dayKey(yest.getTime())) return "YESTERDAY";
  return d.toLocaleDateString([], { day: "2-digit", month: "short", year: "numeric" }).toUpperCase();
}

function fileSize(n) {
  if (n == null) return "";
  if (n < 1024) return n + " B";
  if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
  return (n / 1048576).toFixed(1) + " MB";
}

export function toast(text, isError) {
  const box = $("#toasts");
  const el = document.createElement("div");
  el.className = "toast" + (isError ? " error" : "");
  const img = document.createElement("img");
  // Native dialog icon mapping: error -> Critical.png, info -> Information.png
  img.src = isError ? "./assets/xp/icons/Critical.png" : "./assets/xp/icons/Information.png";
  img.alt = "";
  img.width = 16;
  img.height = 16;
  el.appendChild(img);
  el.appendChild(document.createTextNode(String(text ?? "")));
  box.appendChild(el);
  setTimeout(() => el.remove(), 3500);
  // Auth flows play their own logon/logoff sounds.
  if (!String(text ?? "").startsWith("Signed")) playSound(isError ? "error" : "notification");
}

const MSGBOX_ICONS = {
  question: "./assets/xp/icons/Question.png",
  info: "./assets/xp/icons/Information.png",
  error: "./assets/xp/icons/Critical.png",
  warning: "./assets/xp/icons/Alert.png",
};

/* Native XP MessageBox (modal): win-frame chrome, 32px glyph + text and
   centered OK/Cancel buttons — replaces window.confirm with the real thing.
   Resolves "ok" or "cancel"; Enter activates the focused default button,
   Esc and the titlebar X resolve as cancel. Plays the matching XP sound
   (notification ding / critical stop) exactly like the native client. */
export function msgBox(opts = {}) {
  const dlg = $("#msgBoxDialog");
  if (!dlg) return Promise.resolve("ok");
  const title = opts.title != null ? String(opts.title) : "msg.mesh";
  const text = opts.text != null ? String(opts.text) : "";
  const icon = opts.icon || "question";
  const okLabel = opts.okLabel != null ? String(opts.okLabel) : "OK";
  const hasCancel = !("cancelLabel" in opts) || (opts.cancelLabel != null && opts.cancelLabel !== "");
  const cancelLabel = "cancelLabel" in opts && opts.cancelLabel != null ? String(opts.cancelLabel) : "Cancel";
  if (dlg.open) return Promise.resolve(hasCancel ? "cancel" : "ok");

  const t = $("#msgBoxTitle");
  if (t) t.textContent = title;
  const body = $("#msgBoxText");
  if (body) body.textContent = text;
  const ico = $("#msgBoxIcon");
  if (ico) ico.src = MSGBOX_ICONS[icon] || MSGBOX_ICONS.question;
  const okBtn = $("#msgBoxOk");
  const cancelBtn = $("#msgBoxCancel");
  const closeBtn = $("#msgBoxClose");
  if (!okBtn || !cancelBtn || !closeBtn) return Promise.resolve("ok");
  okBtn.textContent = okLabel;
  cancelBtn.textContent = cancelLabel || "Cancel";
  cancelBtn.classList.toggle("hidden", !hasCancel);

  return new Promise((resolve) => {
    let settled = null;
    const finish = (result) => {
      if (settled) return;
      settled = result;
      try { dlg.close(); } catch { /* already closing */ }
    };
    const onOk = () => finish("ok");
    const onCancel = () => finish("cancel");
    const onEsc = (e) => { e.preventDefault(); finish("cancel"); };
    const onClose = () => {
      okBtn.removeEventListener("click", onOk);
      cancelBtn.removeEventListener("click", onCancel);
      closeBtn.removeEventListener("click", onCancel);
      dlg.removeEventListener("cancel", onEsc);
      resolve(settled != null ? settled : "cancel");
    };
    okBtn.addEventListener("click", onOk);
    cancelBtn.addEventListener("click", onCancel);
    closeBtn.addEventListener("click", onCancel);
    dlg.addEventListener("cancel", onEsc);
    dlg.addEventListener("close", onClose, { once: true });
    try { dlg.showModal(); } catch { resolve("cancel"); return; }
    playSound(icon === "error" ? "error" : "notification");
    // XP default button is OK: Enter accepts, Tab moves to Cancel, Esc aborts.
    okBtn.focus();
  });
}

export function showAuth(tab) {
  $("#authView").classList.remove("hidden");
  $("#appView").classList.add("hidden");
  if (tab) setAuthTab(tab);
}

export function showApp() {
  $("#authView").classList.add("hidden");
  $("#appView").classList.remove("hidden");
}

export function setAuthTab(tab) {
  const isReg = tab === "register";
  const regDlg = $("#registerDialog");
  const err = $("#authError");
  if (err) { err.textContent = ""; err.classList.add("hidden"); }
  if (isReg && regDlg && !regDlg.open) {
    regDlg.showModal();
  } else if (!isReg && regDlg?.open) {
    regDlg.close();
  }
}

export function selectLogonTile(which) {
  const known = $("#tileKnown");
  const other = $("#tileOther");
  const fields = $("#logonFields");
  const rowU = $("#rowUsername");
  const isKnown = which === "login";
  known?.classList.toggle("sel", isKnown);
  other?.classList.toggle("sel", !isKnown);
  fields?.classList.add("show");
  rowU?.classList.toggle("hidden", isKnown);
  if (isKnown) {
    const err = $("#authError");
    if (err) { err.textContent = ""; err.classList.add("hidden"); }
  }
}

export function isSafeImageDataUrl(url) {
  return typeof url === "string" && /^data:image\/(png|jpeg|jpg|webp|gif);base64,/.test(url) && url.length < 10 * 1024 * 1024;
}

export function applyAvatarPhoto(imgEl, textEl, photo) {
  if (!imgEl || !textEl) return;
  if (photo && isSafeImageDataUrl(photo)) {
    imgEl.src = photo;
    imgEl.classList.remove("hidden");
    textEl.classList.add("hidden");
  } else {
    imgEl.removeAttribute("src");
    imgEl.classList.add("hidden");
    textEl.classList.remove("hidden");
  }
}

export function renderProfile() {
  const u = state.user;
  if (!u) return;
  const name = u.display_name || u.username || "?";
  const p = state.profile || {};
  const inits = p.avatar || initials(name);
  $("#selfHandle") && ($("#selfHandle").textContent = "@" + (u.username || "?"));
  const pt = $("#profileAvatarText");
  if (pt) pt.textContent = inits;
  applyAvatarPhoto($("#profileAvatarImg"), pt, p.photo);
  const sl = $("#profileStatusLine");
  if (sl) sl.textContent = p.status ? "- " + p.status : "";
  const bn = $("#selfBannerName");
  if (bn) bn.textContent = "Signed in as " + name;
  const bs = $("#selfBannerStatus");
  if (bs) bs.textContent = p.status || "";
  const bt = $("#selfBannerText");
  if (bt) bt.textContent = inits;
  applyAvatarPhoto($("#selfBannerImg"), bt, p.photo);
}

export function renderConnection() {
  const mode = state.connection;
  const led = $("#connection");
  const label = $("#connLabel");
  const map = { connecting: "Connecting", online: "Connected", reconnecting: "Reconnecting", offline: "Local mode" };
  if (led) {
    led.className = "led" + (mode === "online" ? " on" : mode === "connecting" || mode === "reconnecting" ? " warn" : "");
    led.title = "msg.mesh server";
  }
  if (label) label.textContent = map[mode] || "Local mode";
}

export function renderRequests() {
  const strip = $("#requestStrip");
  if (!strip) return;
  const incoming = incomingRequests();
  const outgoing = outgoingRequests();
  if (!incoming.length && !outgoing.length) {
    strip.classList.add("hidden");
    strip.innerHTML = "";
    return;
  }
  strip.classList.remove("hidden");
  const rows = [];
  for (const r of incoming) {
    const u = state.users.get(String(r.sender_user_id));
    const name = u ? (u.display_name || u.username) : "u" + r.sender_user_id;
    rows.push(`<div class="request-row" data-req="${esc(r.request_id)}" data-kind="in">
      <img class="req-ico" src="./assets/xp/icons/Important.png" alt="" width="16" height="16">
      <div class="request-main"><strong>${esc(name)}</strong><small>wants to connect</small></div>
      <button type="button" class="req-btn accept" data-act="accept" title="Accept">✓</button>
      <button type="button" class="req-btn decline" data-act="decline" title="Decline">✕</button>
    </div>`);
  }
  for (const r of outgoing) {
    const u = state.users.get(String(r.receiver_user_id));
    const name = u ? (u.display_name || u.username) : "u" + r.receiver_user_id;
    rows.push(`<div class="request-row" data-req="${esc(r.request_id)}" data-kind="out">
      <span class="dot"></span>
      <div class="request-main"><strong>${esc(name)}</strong><small>request pending</small></div>
    </div>`);
  }
  strip.innerHTML = rows.join("");
}

export function renderContacts() {
  const box = $("#contactResults");
  if (!box) return;
  const ids = [...state.friends.keys()];
  if (!ids.length) {
    box.innerHTML = '<div class="list-empty">No contacts yet. Use Search or Add Friend.</div>';
    return;
  }
  box.innerHTML = ids.map((id) => {
    const u = state.users.get(String(id));
    const name = u ? (u.display_name || u.username) : "u" + id;
    const handle = u ? "@" + u.username : "";
    const online = state.online.has("u" + id);
    return `<button type="button" class="user-item" data-peer="u${esc(id)}">
      <span class="dot ${online ? "on" : ""}"></span>
      <div><strong>${esc(name)}</strong>${roleBadge(id)}<small>${esc(handle)}</small></div>
      <span class="status ${online ? "on" : ""}">${online ? "online" : "offline"}</span>
    </button>`;
  }).join("");
}

// Role badge next to a name (owner > admin > moderator; members stay bare).
// state.roles comes from /chat/roles/list — empty until the roster loads.
function roleBadge(userId) {
  const rec = state.roles.get(String(userId));
  if (!rec) return "";
  const role = String(rec.app_role || "").toLowerCase();
  if (role === "member" || !role) return "";
  const label = role === "owner" ? "owner" : role === "admin" ? "admin" : "mod";
  return `<span class="role-badge badge-${esc(role)}" title="${esc(role)}">${label}</span>`;
}

function rowMeta(r) {
  const label = peerLabel(r.peer);
  const last = r.last;
  const isGroupPeer = /^g\d+$/.test(r.peer);
  const preview = isTyping(r.peer)
    ? "typing…"
    : (last
      ? (last.deleted
        ? "Message deleted"
        : (last.mine
          ? "You: "
          : (isGroupPeer ? peerLabel(last.sender).slice(0, 16) + ": " : "")) +
          (last.text || (last.attachment ? "Attachment" : (last.type || "message"))))
      : "");
  const time = last ? fmtTime(new Date(last.ts)) : "";
  const online = peerOnline(r.peer);
  return { label, preview, time, online, unread: r.unread };
}

function contactRowHtml(r, active) {
  const m = rowMeta(r);
  return `<button type="button" class="contact-row ${active ? "active" : ""} ${r.unread ? "has-unread" : ""}" data-peer="${esc(r.peer)}">
    <span class="dot ${m.online ? "on" : ""}"></span>
    <span class="contact-name-wrap contact-name-flex">
      <span class="contact-name">${esc(m.label)}${roleBadge(/^u(\d+)$/.exec(r.peer) ? /^u(\d+)$/.exec(r.peer)[1] : "")}</span>
      ${m.preview ? `<span class="contact-preview">${emoteTokens(esc(emotes(m.preview)))}</span>` : ""}
    </span>
    <span class="contact-time">${esc(m.time)}</span>
    ${r.unread ? `<span class="unread">${r.unread > 99 ? "99+" : r.unread}</span>` : ""}
  </button>`;
}

export function renderSidebar() {
  renderRequests();
  const rows = conversationOrder().filter((r) => state.filter === "all" || r.unread > 0);
  let total = 0;
  for (const r of conversationOrder()) total += r.unread;
  const unreadEl = $("#unreadCount");
  if (unreadEl) unreadEl.textContent = String(total);
  const allEl = $("#allCount");
  if (allEl) allEl.textContent = String(state.conversations.size || state.friends.size);

  // presence counts for status bar (1:1 peers only; groups don't skew them)
  let online = 0, offline = 0;
  for (const r of conversationOrder()) {
    if (!/^u\d+$/.test(r.peer)) continue;
    if (peerOnline(r.peer)) online++;
    else offline++;
  }
  const oc = $("#onlineCount");
  if (oc) oc.textContent = String(online);
  const fc = $("#offlineCount");
  if (fc) fc.textContent = String(offline);

  const list = $("#conversationList");
  if (!list) return;
  if (!rows.length) {
    list.innerHTML = '<div class="list-empty">No contacts yet. Friends &gt; Search to find people.<br>Or use toolbar Add Contact.</div>';
    return;
  }

  // Group Online / Offline like the native client (live presence now)
  const on = rows.filter((r) => peerOnline(r.peer));
  const off = rows.filter((r) => !on.includes(r));

  let html = "";
  if (on.length) {
    html += `<div class="group-label">Online (${on.length})</div>`;
    html += on.map((r) => contactRowHtml(r, state.activePeer === r.peer)).join("");
  }
  if (off.length) {
    html += `<div class="group-label">Offline (${off.length})</div>`;
    html += off.map((r) => contactRowHtml(r, state.activePeer === r.peer)).join("");
  }
  list.innerHTML = html;
}

function statusGlyph(m, peer) {
  if (m.sync === "sending") return "…";
  if (m.sync === "failed") return "!";
  if (!m.mine) return "";
  const pp = state.peerPointers.get(peer) || 0;
  if (m.rowid != null && pp >= m.rowid) return "✓✓";
  return "✓";
}

/* Classic typed emoticon codes -> unicode, on RAW text before esc() so
   "<3" still reaches the converter (esc would make it "&lt;3"). Longer
   codes must come first so the alternation prefers them. */
const EMOTE_PAIRS = [
  ["</3", "💔"], [":'(", "😢"], ["^_^", "😊"], [":-)", "😀"], [":-(", "😞"], [";-)", "😉"],
  ["<3", "❤️"], [":)", "😀"], [":(", "😞"], [":D", "😄"], [";)", "😉"], [":P", "😛"],
  [":p", "😛"], [":O", "😮"], [":o", "😮"], [":|", "😐"], [":*", "😘"],
  [":S", "😕"], [":s", "😕"], ["XD", "😂"], ["xd", "😂"], ["B)", "😎"],
];
const EMOTE_LOOKUP = new Map(EMOTE_PAIRS);
const EMOTE_RE = new RegExp(
  EMOTE_PAIRS.map(([code]) => code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"),
  "g"
);
function emotes(t) {
  return String(t).replace(EMOTE_RE, (m) => EMOTE_LOOKUP.get(m) || m);
}

/* Native emoticon tokens (:eNNN:) -> inline <img>. Runs AFTER esc() so the
   injected markup survives (tokens contain no escapable characters, so they
   pass through esc untouched). Unknown ids stay as literal text. */
function emoteTokens(html) {
  return html.replace(/:e(\d{3}):/g, (m, id) => {
    const file = emoteFile(id);
    if (!file) return m;
    return `<img class="emote" src="./assets/xp/emoticons/${file}" alt="${m}" title="${m}">`;
  });
}

function isImageAtt(att) {
  if (!att) return false;
  const type = String(att.type || "").toLowerCase().split(";")[0];
  const safeTypes = new Set(["image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp", "image/bmp", "image/avif"]);
  if (safeTypes.has(type)) return true;
  return /\.(png|jpe?g|gif|webp|bmp|avif)$/i.test(att.filename || "");
}

/* Image attachments render as inline thumbnails. A bounded object-URL cache
   avoids retaining large base64 strings for every preview and is cleared at
   account/session boundaries. */
const attImgCache = new Map();
let attImgCacheGeneration = 0;
// A transcript can carry dozens of stickers (42+ distinct images is common);
// a small cache forced a full re-download wave on every full-list re-render
// and on every chat switch, which is enough traffic to drain the server
// rate-limit bucket. Keep every transcript's previews resident; the byte cap
// bounds memory if a future transcript is heavier.
const MAX_ATT_IMAGE_CACHE_ENTRIES = 96;
const MAX_ATT_IMAGE_CACHE_BYTES = 32 * 1024 * 1024;
let attImgCacheBytes = 0;
const MAX_ATT_IMAGE_PREVIEW_BYTES = 2 * 1024 * 1024;

// Attachment data URLs contain private content; discard them at account/session
// boundaries so a shared browser cannot reuse one user's cached images.
function revokeAttImageUrl(url) {
  if (typeof url === "string" && url.startsWith("blob:") &&
      typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
    try { URL.revokeObjectURL(url); } catch { /* already released */ }
  }
}

export function clearAttachmentImageCache() {
  attImgCacheGeneration += 1;
  attImgFailedAt.clear();
  for (const entry of attImgCache.values()) revokeAttImageUrl(entry.url);
  attImgCache.clear();
  attImgCacheBytes = 0;
  if (typeof document !== "undefined") {
    document.querySelectorAll("img[data-attimg]").forEach(img => {
      img.removeAttribute("src");
      delete img.dataset.loading;
      img.classList.remove("att-img-ready", "att-img-loading");
    });
  }
}

function cacheAttImage(id, url, bytes) {
  // Bounded LRU cache (entries + total bytes) of object-URL previews.
  const previous = attImgCache.get(id);
  if (previous) {
    attImgCacheBytes -= previous.bytes || 0;
    if (previous.url !== url) revokeAttImageUrl(previous.url);
  }
  attImgCache.delete(id);
  attImgCache.set(id, { url, bytes: bytes || 0 });
  while (attImgCache.size > MAX_ATT_IMAGE_CACHE_ENTRIES ||
         attImgCacheBytes > MAX_ATT_IMAGE_CACHE_BYTES) {
    const oldestId = attImgCache.keys().next().value;
    if (oldestId === undefined || (oldestId === id && attImgCache.size === 1)) break;
    const oldest = attImgCache.get(oldestId);
    attImgCache.delete(oldestId);
    attImgCacheBytes -= oldest.bytes || 0;
    revokeAttImageUrl(oldest.url);
  }
}

// A failed download (rate-limited, revoked grant, gone row) must not re-fire
// on every full-list re-render: each render rebuilds every <img>, so an
// immediate retry turns one outage into a request storm that drains the
// server rate-limit bucket. Back off before trying the same id again.
const attImgFailedAt = new Map();
const MAX_ATT_IMAGE_FAILED = 64;
const ATT_IMAGE_RETRY_MS = 45000;

function noteAttImageFailure(id) {
  attImgFailedAt.delete(id);
  attImgFailedAt.set(id, Date.now());
  while (attImgFailedAt.size > MAX_ATT_IMAGE_FAILED) {
    attImgFailedAt.delete(attImgFailedAt.keys().next().value);
  }
}

function attImageFailureFresh(id) {
  const at = attImgFailedAt.get(id);
  if (!at) return false;
  if (Date.now() - at >= ATT_IMAGE_RETRY_MS) {
    attImgFailedAt.delete(id);
    return false;
  }
  return true;
}

// Ids with a download in flight. The list re-renders by rebuilding every
// <img>, so a per-node guard alone restarted the wave under a new node: the
// in-flight promise must be shared per id, and its result applied to every
// live node for that id (the node that started it may already be detached).
const attImgLoading = new Set();

function applyAttImageToDom(id, cls, url) {
  if (typeof document === "undefined") return;
  document.querySelectorAll("img[data-attimg]").forEach((img) => {
    if (img.dataset.attimg !== id) return;
    if (url) img.src = url;
    delete img.dataset.loading;
    img.classList.remove("att-img-loading");
    if (cls === "att-img-ready") {
      img.classList.remove("att-img-failed");
      img.classList.add("att-img-ready");
    } else if (cls === "att-img-failed") {
      img.classList.remove("att-img-ready");
      img.classList.add("att-img-failed");
    }
  });
}

function hydrateAttImages(root) {
  if (!root || !root.querySelectorAll) return;
  root.querySelectorAll("img[data-attimg]").forEach((img) => {
    const id = img.dataset.attimg;
    if ((Number(img.dataset.attimgSize) || 0) > MAX_ATT_IMAGE_PREVIEW_BYTES) {
      img.classList.add("att-img-failed");
      return;
    }
    if (attImgCache.has(id)) {
      const hit = attImgCache.get(id);
      attImgCache.delete(id);
      attImgCache.set(id, hit); // touch: most-recently used
      img.src = hit.url;
      img.classList.add("att-img-ready");
      return;
    }
    if (attImageFailureFresh(id)) {
      img.classList.add("att-img-failed");
      return;
    }
    if (attImgLoading.has(id)) {
      // An in-flight download will fill this node when it settles.
      img.classList.add("att-img-loading");
      return;
    }
    attImgLoading.add(id);
    img.dataset.loading = "1";
    img.classList.add("att-img-loading");
    const sessionToken = getToken();
    const cacheGeneration = attImgCacheGeneration;
    const stillMine = () => getToken() === sessionToken &&
      cacheGeneration === attImgCacheGeneration;
    api.download(id).then((r) => {
      if (!stillMine()) throw new Error("session changed");
      const size = Number(r.size_bytes) || 0;
      const encoded = typeof r.content_base64 === "string" ? r.content_base64 : "";
      if (size > MAX_ATT_IMAGE_PREVIEW_BYTES ||
          encoded.length > Math.ceil(MAX_ATT_IMAGE_PREVIEW_BYTES * 4 / 3) + 8) {
        throw new Error("image preview exceeds memory limit");
      }
      const contentType = String(r.content_type || "").toLowerCase().split(";")[0];
      if (!["image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp", "image/bmp", "image/avif"].includes(contentType)) {
        throw new Error("unsupported image preview type");
      }
      let url;
      if (typeof Blob !== "undefined" && typeof URL !== "undefined" &&
          typeof URL.createObjectURL === "function") {
        const binary = atob(encoded);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        url = URL.createObjectURL(new Blob([bytes], { type: contentType }));
      } else {
        // Legacy browser fallback; the cache limit still bounds retained data.
        url = "data:" + contentType + ";base64," + encoded;
      }
      cacheAttImage(id, url, Math.floor(encoded.length * 3 / 4));
      attImgFailedAt.delete(id);
      applyAttImageToDom(id, "att-img-ready", url);
    }).catch(() => {
      if (stillMine()) {
        noteAttImageFailure(id);
        applyAttImageToDom(id, "att-img-failed", null);
      } else {
        applyAttImageToDom(id, null, null); // stale session: clear markers only
      }
    }).finally(() => {
      attImgLoading.delete(id);
    });
  });
}

function messageLineHtml(m, peer) {
  const rid = m.rowid != null && Number.isFinite(Number(m.rowid)) ? Number(m.rowid) : "";
  const cls = ["msg-line", m.mine ? "mine" : "other"];
  if (m.sync === "sending") cls.push("pending");
  if (m.sync === "failed") cls.push("failed");
  if (m.deleted) cls.push("deleted");
  const ts = `<span class="ts">${esc(fmtTime(new Date(m.ts)))}</span>`;
  // In a group every incoming line is labelled with its actual sender.
  const isGroupPeer = /^g\d+$/.test(peer);
  const who = m.mine ? "You" : peerLabel(isGroupPeer ? m.sender : peer).slice(0, 16);
  const whoSpan = `<span class="who">${esc(who)}:</span>`;

  if (m.deleted) {
    return `<div class="${cls.join(" ")}" data-id="${esc(m.id)}" data-rowid="${rid}">
      ${ts}${whoSpan}<span class="body msg-deleted">Message deleted</span>
    </div>`;
  }

  let att = "";
  if (m.attachment) {
    const fname = m.attachment.filename || "file";
    const meta = `${esc(fname)}<small> ${esc(m.attachment.type || "")}${m.attachment.size ? " · " + fileSize(m.attachment.size) : ""}</small>`;
    att = isImageAtt(m.attachment)
      ? `<a class="att-chip att-img-chip" data-att="${esc(m.attachment.id)}" data-attname="${esc(fname)}" href="#"><img class="att-img" data-attimg="${esc(m.attachment.id)}" data-attimg-size="${esc(m.attachment.size || 0)}" alt="${esc(fname)}"><span>${meta}</span></a>`
      : `<a class="att-chip" data-att="${esc(m.attachment.id)}" data-attname="${esc(fname)}" href="#"><img src="./assets/xp/icons/Generic Document.png" alt="" width="14" height="14"><span>${meta}</span></a>`;
  }
  const body = m.text ? emoteTokens(esc(emotes(m.text))) : (att ? "" : `<span class="msg-type-label">(${esc(m.type)})</span>`);
  const st = statusGlyph(m, peer);
  const retryHint = m.sync === "failed" ? ' title="Send failed — click to retry"' : "";
  const editedTag = m.edited ? `<span class="edited-tag" title="Edited">(edited)</span>` : "";
  const pinTag = m.pinned ? `<span class="pinned-tag" title="Pinned">📌</span>` : "";

  let quote = "";
  const r = m.reply;
  if (r && r.id) {
    const rwho = r.from != null && String(r.from) === String(state.selfNode)
      ? "You"
      : peerLabel(isGroupPeer && r.from != null ? String(r.from) : peer).slice(0, 16);
    const rtext = r.text ? esc(String(r.text).slice(0, 140)) : "(attachment)";
    quote = `<div class="reply-quote" data-jumprow="${r.rowid != null && Number.isFinite(Number(r.rowid)) ? Number(r.rowid) : ""}" title="Jump to quoted message"><b>${esc(rwho)}:</b> ${rtext}</div>`;
  }

  let chips = "";
  const entries = (m.reactions && typeof m.reactions === "object" && !Array.isArray(m.reactions))
    ? Object.entries(m.reactions).filter(([, v]) => Array.isArray(v) && v.length)
    : [];
  if (entries.length) {
    const self = String(state.selfNode);
    chips = `<span class="reactions">` + entries.map(([emoji, ids]) => {
      const mineOn = ids.map(String).includes(self);
      return `<button type="button" class="reaction-chip${mineOn ? " mine" : ""}" data-react="${esc(emoji)}" title="${ids.length} reaction${ids.length === 1 ? "" : "s"} — click to ${mineOn ? "remove" : "react"}">${esc(emoji)}<span class="reaction-count">${ids.length}</span></button>`;
    }).join("") + `</span>`;
  }

  return `<div class="${cls.join(" ")}" data-id="${esc(m.id)}" data-rowid="${rid}"${retryHint}>
    ${quote}${ts}${whoSpan}<span class="body">${body}</span>${st ? `<span class="st">${esc(st)}</span>` : ""}${att}${editedTag}${pinTag}${chips}
  </div>`;
}

function renderPinnedStrip(c) {
  const strip = $("#pinnedStrip");
  if (!strip) return;
  const pinned = c ? [...c.messages].reverse().find((m) => m.pinned && !m.deleted) : null;
  if (!pinned) {
    strip.classList.add("hidden");
    strip.innerHTML = "";
    return;
  }
  const who = pinned.mine
    ? "You"
    : peerLabel(/^g\d+$/.test(state.activePeer) && pinned.sender ? pinned.sender : state.activePeer).slice(0, 16);
  const text = String(pinned.text || (pinned.attachment ? pinned.attachment.filename : "") || "(" + (pinned.type || "message") + ")").slice(0, 140);
  strip.classList.remove("hidden");
  strip.innerHTML = `<span class="pinned-ico" title="Pinned message">📌</span><button type="button" class="pinned-jump" title="Jump to pinned message">${esc(who)}: ${esc(text)}</button><button type="button" class="pinned-x" title="Unpin">✕</button>`;
}

export function renderMessages(opts = {}) {
  const peer = state.activePeer;
  if (!peer) return;
  const c = state.conversations.get(peer);
  const box = $("#messageList");
  const wrap = $("#messages");
  if (!box || !wrap) return;

  if (!c || !c.messages.length) {
    box.innerHTML = '<div class="list-empty">No messages yet. Say hello!</div>';
    $("#loadOlder")?.classList.add("hidden");
    $("#newMsgsPill")?.classList.add("hidden");
    renderPinnedStrip(null);
    return;
  }

  // capture before the re-render: the new content grows the scroller
  const atBottom = wrap.scrollHeight - wrap.scrollTop - wrap.clientHeight < 60;
  let html = "";
  let lastDay = "";
  for (const m of c.messages) {
    const k = dayKey(m.ts);
    if (k !== lastDay) {
      html += `<div class="day-divider">${dayLabel(m.ts)}</div>`;
      lastDay = k;
    }
    html += messageLineHtml(m, peer);
  }
  box.innerHTML = html;
  $("#loadOlder")?.classList.toggle("hidden", !c.hasMore);
  hydrateAttImages(box);
  renderPinnedStrip(c);

  // scroll: default/true = pin to bottom (send / open chat); "auto" = pin only
  // when the user was already at the bottom, otherwise offer the pill; false =
  // caller manages scroll position (load older).
  if (opts.scroll === "auto") {
    if (atBottom) wrap.scrollTop = wrap.scrollHeight;
    else $("#newMsgsPill")?.classList.remove("hidden");
  } else if (opts.scroll !== false) {
    wrap.scrollTop = wrap.scrollHeight;
  }
}

export function renderChatHead() {
  const peer = state.activePeer;
  if (!peer) return;
  const label = peerLabel(peer);
  const u = peerUser(peer);
  const nameEl = $("#chatName");
  const avEl = $("#chatAvatar");
  const metaEl = $("#chatMeta");
  if (nameEl) nameEl.textContent = label;
  if (avEl) avEl.textContent = initials(label);

  if (!metaEl) return;
  let head = "";
  const online = peerOnline(peer);
  const typingNow = isTyping(peer);
  const g = state.groups.get(peer);
  head += `<span class="dot ${online ? "on" : ""}"></span>`;
  if (g) {
    const n = Array.isArray(g.members) ? g.members.length : 0;
    head += typingNow
      ? `<span class="typing-meta">typing…</span>`
      : esc(`${n} member${n === 1 ? "" : "s"}`);
  } else if (u) {
    head += typingNow ? `<span class="typing-meta">typing.</span>` : (online ? "Ready to chat" : "Offline");
    head += " &nbsp;·&nbsp; " + esc("@" + u.username) + roleBadge(u.user_id);
  } else {
    head += esc("device " + peer);
  }
  const myLastMine = [...((state.conversations.get(peer) || {}).messages || [])]
    .filter((m) => m.mine && m.rowid != null)
    .reduce((a, m) => Math.max(a, m.rowid), 0);
  const pp = state.peerPointers.get(peer) || 0;
  if (myLastMine > 0) head += " &nbsp;·&nbsp; " + (pp >= myLastMine ? "Read" : "Sent");
  metaEl.innerHTML = head;
  renderDetails();
}

export function renderDetails() {
  const peer = state.activePeer;
  if (!peer) return;
  const label = peerLabel(peer);
  const u = peerUser(peer);
  const c = state.conversations.get(peer);
  const dn = $("#detailsName");
  if (dn) dn.textContent = label;
  const g = state.groups.get(peer);
  const dh = $("#detailsHandle");
  if (dh) {
    if (g) dh.textContent = (Array.isArray(g.members) ? g.members.length : 0) + " members";
    else dh.textContent = u ? "@" + u.username : peer;
  }
  const photo = u && u.profile ? String(u.profile.photo || "") : "";
  const avatarChar = u && u.profile && u.profile.avatar ? u.profile.avatar : initials(label);
  const dat = $("#detailsAvatar");
  if (dat) dat.textContent = avatarChar;
  applyAvatarPhoto($("#detailsAvatarImg"), dat, photo);
  const bb = $("#detailsBanner");
  if (bb) {
    const bimg = $("#detailsBannerImg");
    const btxt = $("#detailsBannerText");
    if (btxt) btxt.textContent = avatarChar;
    if (photo && bimg && isSafeImageDataUrl(photo)) {
      bimg.src = photo;
      bimg.classList.remove("hidden");
      if (btxt) btxt.classList.add("hidden");
      bb.classList.remove("hidden");
    } else {
      if (bimg) { bimg.removeAttribute("src"); bimg.classList.add("hidden"); }
      bb.classList.add("hidden");
    }
  }
  const ds = $("#detailsStatus");
  if (ds) {
    if (g) ds.textContent = "Group chat";
    else if (u) ds.textContent = peerOnline(peer) ? "Online" : "Offline";
    else ds.textContent = "Device node";
  }
  // Server-side profile block (migration 018): status text + about.
  const pst = $("#detailsPeerStatus");
  if (pst) {
    const st = u && u.profile ? String(u.profile.status_text || "") : "";
    pst.textContent = st;
    pst.classList.toggle("hidden", !st);
  }
  const abRow = $("#detailsAboutRow");
  const ab = $("#detailsAbout");
  if (abRow && ab) {
    const about = u && u.profile ? String(u.profile.about || "") : "";
    ab.textContent = about || "-";
    abRow.classList.toggle("hidden", !about);
  }
  const dm = $("#detailsMessages");
  if (dm) dm.textContent = String(c ? c.messages.length : 0);
  const dr = $("#detailsRead");
  const pp = state.peerPointers.get(peer) || 0;
  if (dr) dr.textContent = pp > 0 ? `Row ${pp}` : "—";

  const m = /^u(\d+)$/.exec(peer);
  const addBtn = $("#addContactBtn");
  const removeBtn = $("#removeContactBtn");
  const blockBtn = $("#blockContactBtn");
  if (addBtn && removeBtn) {
    if (m) {
      const friend = isFriend(m[1]);
      const blocked = state.blocked.has(m[1]);
      // A blocked user can never be (re)added as a contact — the server 403s.
      addBtn.classList.toggle("hidden", friend || blocked);
      removeBtn.classList.toggle("hidden", !friend);
    } else {
      addBtn.classList.add("hidden");
      removeBtn.classList.add("hidden");
    }
  }
  if (blockBtn) {
    if (m) {
      const blocked = state.blocked.has(m[1]);
      blockBtn.classList.remove("hidden");
      blockBtn.textContent = blocked ? "Unblock" : "Block";
    } else {
      blockBtn.classList.add("hidden");
    }
  }

  const filesBlock = $("#sharedFilesBlock");
  const filesBox = $("#sharedFiles");
  if (filesBlock && filesBox) {
    const seen = new Set();
    const files = [];
    for (const msg of (c ? c.messages : [])) {
      const a = msg.attachment;
      if (a && a.id && !seen.has(a.id)) {
        seen.add(a.id);
        files.push(a);
      }
    }
    if (!files.length) {
      filesBlock.classList.add("hidden");
      filesBox.innerHTML = "";
    } else {
      filesBlock.classList.remove("hidden");
      filesBox.innerHTML = files.map((a) =>
        `<button type="button" class="file-row" data-att="${esc(a.id)}" data-attname="${esc(a.filename || "file")}">
          <img src="./assets/xp/icons/Generic Document.png" alt="" width="16" height="16"><span>${esc(a.filename || "file")}<small> ${esc(a.type || "")}${a.size ? " · " + fileSize(a.size) : ""}</small></span>
        </button>`
      ).join("");
    }
  }
}

export function setActive(peer) {
  state.activePeer = peer;
  const open = !!peer;
  const chat = $("#chatPanel");
  const contacts = $("#contactsCol");
  const empty = $("#emptyState");
  if (empty) empty.classList.toggle("hidden", open);
  if (chat) {
    chat.classList.toggle("hidden", !open);
    chat.classList.toggle("mobile-open", open);
  }
  if (contacts) {
    const mobile = window.matchMedia("(max-width:650px)").matches;
    contacts.classList.toggle("contacts-mobile-hidden", mobile && open);
  }
  renderSidebar();
  if (open) {
    renderChatHead();
    renderMessages();
  }
}

export function renderAll() {
  renderProfile();
  renderConnection();
  renderSidebar();
  if (state.activePeer) {
    renderChatHead();
    renderMessages({ scroll: false });
  }
}
