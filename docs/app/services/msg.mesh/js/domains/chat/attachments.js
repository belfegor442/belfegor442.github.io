import { api, getToken } from "../../infrastructure/api/index.js";

export function isImageAtt(att) {
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

export function hydrateAttImages(root) {
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
