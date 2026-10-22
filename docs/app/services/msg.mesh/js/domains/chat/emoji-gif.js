/* ---------------- emoticon / sticker picker + online GIF search ---------------- */
import { EMOTICONS } from "../../shared/emoticons.js";
import { $, esc } from "../../shared/dom.js";
import { msgInput } from "./composer.js";
import { handleFile, MAX_FILE } from "../files/index.js";
import * as ui from "../../ui.js";

const STICKERS = ["wink", "surprise", "cry", "party", "thumbsup", "wave", "heart", "coffee", "smile"];
const STICKER_LABELS = {
  wink: "Wink", surprise: "Surprised", cry: "Crying", party: "Party",
  thumbsup: "Thumbs up", wave: "Wave", heart: "Heart", coffee: "Coffee", smile: "Smile",
};

const emojiPanel = $("#emojiPanel");
const emojiBtn = $("#emojiBtn");
const emojiFacesBox = $("#emojiFaces");
const emojiStickersBox = $("#emojiStickers");
const emojiTabFaces = $("#emojiTabFaces");
const emojiTabGifs = $("#emojiTabGifs");
const emojiTabGifSearch = $("#emojiTabGifSearch");

function insertAtCursor(text) {
  const el = msgInput;
  if (!el) return;
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? start;
  el.focus();
  el.setRangeText(text, start, end, "end");
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function closeEmojiPanel() {
  if (!emojiPanel) return;
  emojiPanel.classList.add("hidden");
  emojiBtn?.setAttribute("aria-expanded", "false");
}

function emojiTab(which) {
  const faces = which === "faces";
  const stickers = which === "stickers";
  const gifs = which === "gifs";
  emojiTabFaces.classList.toggle("active", faces);
  emojiTabGifs.classList.toggle("active", stickers);
  emojiTabGifSearch.classList.toggle("active", gifs);
  emojiTabFaces.setAttribute("aria-selected", String(faces));
  emojiTabGifs.setAttribute("aria-selected", String(stickers));
  emojiTabGifSearch.setAttribute("aria-selected", String(gifs));
  emojiFacesBox.classList.toggle("hidden", !faces);
  emojiStickersBox.classList.toggle("hidden", !stickers);
  gifPane.classList.toggle("hidden", !gifs);
  if (gifs) gifFirstOpen();
}

async function insertSticker(name) {
  const path = "./assets/xp/gifs/sticker_" + name + ".gif";
  closeEmojiPanel();
  try {
    const res = await fetchWithTimeout(path, 12000);
    if (!res.ok) throw new Error("http " + res.status);
    const blob = await res.blob();
    const file = new File([blob], "sticker_" + name + ".gif", { type: "image/gif" });
    handleFile(file);
  } catch {
    ui.toast("Sticker failed to load", true);
  }
}

/* ---------------- online GIF search (keyless) ---------------- */
/* Same public, CORS-open endpoint Discord's own GIF picker calls — no API key.
   Results are CDN hotlinks (static.klipy.com, ACAO=*) downloaded as blobs and
   pushed through the normal upload pipeline. */
const GIF_API = "https://discord.com/api/v10/";
const gifPane = $("#gifPane");
const gifSearch = $("#gifSearch");
const gifGrid = $("#gifGrid");
const gifStatus = $("#gifStatus");
let gifBooted = false;
let gifSeq = 0;
let gifTimer = 0;

function gifState(text) {
  if (!gifStatus) return;
  gifStatus.classList.toggle("hidden", !text);
  gifStatus.innerHTML = text
    ? '<img class="hourglass" src="./assets/xp/gifs/hourglass.gif" alt="" width="16" height="16"> ' + esc(text)
    : "";
}

async function fetchWithTimeout(url, timeoutMs = 12000) {
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    return await fetch(url, ctrl ? { signal: ctrl.signal } : {});
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function gifFetch(path) {
  const r = await fetchWithTimeout(GIF_API + path, 12000);
  if (!r.ok) throw new Error("http " + r.status);
  return r.json();
}

function gifRender(items, seq) {
  if (seq !== gifSeq) return;
  gifGrid.textContent = "";
  for (const it of items) {
    if (!it || typeof it.src !== "string" || !it.src) continue;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "gif-cell";
    b.title = String(it.title || "GIF").replace(/\s+/g, " ").slice(0, 80);
    const img = document.createElement("img");
    img.src = it.src;
    img.alt = b.title;
    img.loading = "lazy";
    img.draggable = false;
    b.appendChild(img);
    b.addEventListener("click", () => gifSend(it));
    gifGrid.appendChild(b);
  }
}

function gifRenderCats(cats, seq) {
  if (seq !== gifSeq) return;
  gifGrid.textContent = "";
  for (const c of cats) {
    if (!c || typeof c.name !== "string" || !c.name) continue;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "gif-cat";
    b.title = c.name;
    if (typeof c.src === "string" && c.src) {
      const img = document.createElement("img");
      // downscale the Discord image proxy: 440px thumbs ~540KB vs ~77KB at 132px
      img.src = c.src.replace(/height=\d+/, "height=132").replace(/width=\d+/, "width=132");
      img.alt = "";
      img.loading = "lazy";
      img.draggable = false;
      b.appendChild(img);
    }
    const s = document.createElement("span");
    s.className = "gif-cat-label";
    s.textContent = c.name;
    b.appendChild(s);
    b.addEventListener("click", () => {
      gifSearch.value = c.name;
      gifSearchSchedule(true);
    });
    gifGrid.appendChild(b);
  }
}

async function gifLoad(kind, query) {
  const seq = ++gifSeq;
  gifState(kind === "search" ? "Searching GIFs..." : "Loading GIFs...");
  try {
    if (kind === "search") {
      const arr = await gifFetch("gifs/search?q=" + encodeURIComponent(query) + "&media_format=gif&limit=20");
      if (seq !== gifSeq) return;
      gifRender(Array.isArray(arr) ? arr : [], seq);
      gifState(gifGrid.childElementCount ? "" : "No GIFs found");
    } else {
      const t = await gifFetch("gifs/trending?media_format=gif&limit=20");
      if (seq !== gifSeq) return;
      gifRenderCats((t && Array.isArray(t.categories)) ? t.categories : [], seq);
      gifState(gifGrid.childElementCount ? "" : "No GIFs found");
    }
  } catch {
    if (seq !== gifSeq) return;
    gifGrid.textContent = "";
    gifState("GIF search unavailable");
    ui.toast("GIF search unavailable", true);
  }
}

function gifSearchSchedule(immediate) {
  clearTimeout(gifTimer);
  const q = (gifSearch.value || "").trim();
  if (!q) {
    gifLoad("trending");
    return;
  }
  if (immediate) {
    gifLoad("search", q);
    return;
  }
  gifTimer = setTimeout(() => gifLoad("search", q), 350);
}

function gifFirstOpen() {
  if (gifBooted) return;
  gifBooted = true;
  gifLoad("trending");
}

async function gifSend(it) {
  closeEmojiPanel();
  const base = String(it.id || "gif").replace(/[^\w.-]+/g, "_").slice(0, 40);
  const candidates = [it.src, it.gif_src].filter((u) => typeof u === "string" && u);
  let file = null;
  for (const u of candidates) {
    try {
      const res = await fetchWithTimeout(u, 15000);
      if (!res.ok) continue;
      const blob = await res.blob();
      const webp = /\.webp(\?|$)/i.test(u) || blob.type === "image/webp";
      const cand = new File([blob], base + (webp ? ".webp" : ".gif"),
        { type: blob.type || (webp ? "image/webp" : "image/gif") });
      if (!file || cand.size < file.size) file = cand;
      if (file.size <= MAX_FILE) break;
    } catch {
      /* try the next candidate */
    }
  }
  if (!file) {
    ui.toast("GIF failed to load", true);
    return;
  }
  handleFile(file); // toasts + clears when still over MAX_FILE
}

if (emojiPanel) {
  // Native 19x19 emoticon art (Themes/emoticons): click inserts the :eNNN:
  // token, ui.js renders it back as an inline <img class="emote">.
  for (const file of EMOTICONS) {
    const id = file.split(".")[0];
    const b = document.createElement("button");
    b.type = "button";
    b.className = "emoji-cell emote-cell";
    b.title = ":e" + id + ":";
    const img = document.createElement("img");
    img.src = "./assets/xp/emoticons/" + file;
    img.alt = ":e" + id + ":";
    img.loading = "lazy";
    img.draggable = false;
    b.appendChild(img);
    b.addEventListener("click", () => insertAtCursor(":e" + id + ":"));
    emojiFacesBox.appendChild(b);
  }
  for (const name of STICKERS) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "emoji-cell sticker-cell";
    b.title = STICKER_LABELS[name] || name;
    const img = document.createElement("img");
    img.src = "./assets/xp/gifs/sticker_" + name + ".gif";
    img.alt = STICKER_LABELS[name] || name;
    img.loading = "lazy";
    img.draggable = false;
    b.appendChild(img);
    b.addEventListener("click", () => insertSticker(name));
    emojiStickersBox.appendChild(b);
  }
  emojiTabFaces.addEventListener("click", () => emojiTab("faces"));
  emojiTabGifs.addEventListener("click", () => emojiTab("stickers"));
  emojiTabGifSearch.addEventListener("click", () => emojiTab("gifs"));
  gifSearch?.addEventListener("input", gifSearchSchedule);
  gifSearch?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      gifSearchSchedule(true);
    }
  });
  emojiBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    const nowHidden = emojiPanel.classList.toggle("hidden");
    emojiBtn.setAttribute("aria-expanded", String(!nowHidden));
  });
  // Staying open on face picks (MSN-style) — panel closes on sticker, outside
  // click or Esc; the sticker tap itself closes via insertSticker().
  document.addEventListener("click", (e) => {
    if (emojiPanel.classList.contains("hidden")) return;
    if (e.target.closest?.("#emojiPanel") || e.target.closest?.("#emojiBtn")) return;
    closeEmojiPanel();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeEmojiPanel();
  });
}
