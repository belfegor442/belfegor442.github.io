export const $ = (s) => document.querySelector(s);

export function showErr(box, text) {
  if (!box) return;
  box.textContent = text;
  box.classList.toggle("hidden", !text);
}

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function initials(name) {
  return String(name || "?").trim().split(/\s+/).map((x) => x[0]).join("").slice(0, 2).toUpperCase() || "?";
}

export const fmtTime = (d) => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });

export function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function dayLabel(ts) {
  const d = new Date(ts);
  const today = new Date();
  const yest = new Date(Date.now() - 86400000);
  const k = dayKey(ts);
  if (k === dayKey(today.getTime())) return "TODAY";
  if (k === dayKey(yest.getTime())) return "YESTERDAY";
  return d.toLocaleDateString([], { day: "2-digit", month: "short", year: "numeric" }).toUpperCase();
}

export function fileSize(n) {
  if (n == null) return "";
  if (n < 1024) return n + " B";
  if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
  return (n / 1048576).toFixed(1) + " MB";
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
