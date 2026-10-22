/* ---------------- attachments: upload pipeline, pending file, download ---------------- */
import { getToken, apiBase, ApiError, friendlyError } from "../../infrastructure/api/index.js";
import { $ } from "../../shared/dom.js";
import { state } from "../../core/state.js";
import { setPendingAttachment } from "../chat/composer.js";
import * as ui from "../../ui.js";

// main.js registers the session-lost handler (handleSessionLost lives in
// the session module and importing main from here would create a cycle).
let filesSessionLost = null;
export function setFilesSessionLost(fn) {
  filesSessionLost = fn;
}


export const MAX_FILE = 700 * 1024;
const MAX_IMAGE_SOURCE = 5 * 1024 * 1024;

$("#sendFileBtn")?.addEventListener("click", () => $("#fileInput").click());
$("#pendingFileCancel")?.addEventListener("click", () => {
  uploadSeq += 1;
  if (activeUploadXhr) { activeUploadXhr.abort(); activeUploadXhr = null; }
  setPendingAttachment(null);
});

// XHR upload so the pending-file bar can show real byte progress (fetch has
// no upload progress events). Same endpoint/headers/failure contract as
// api.upload; falls back to the plain error payload on non-2xx.
let activeUploadXhr = null;

export function cancelActiveUpload() {
  uploadSeq += 1;
  if (activeUploadXhr) {
    const xhr = activeUploadXhr;
    activeUploadXhr = null;
    try { xhr.abort(); } catch { /* already completed */ }
  }
}

function uploadWithProgress(filename, contentType, b64, size, onProgress, uploadToken) {
  return new Promise((resolve, reject) => {
    if (!uploadToken || getToken() !== uploadToken) {
      reject(new ApiError(0, { error: "session changed before upload" }));
      return;
    }
    const xhr = new XMLHttpRequest();
    activeUploadXhr = xhr;
    xhr.open("POST", apiBase() + "/api/v1/files/upload");
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.timeout = 60000;
    if (uploadToken) xhr.setRequestHeader("X-Session-Token", uploadToken);
    if (xhr.upload) {
      xhr.upload.addEventListener("progress", (ev) => {
        if (ev.lengthComputable && onProgress) onProgress(ev.loaded, ev.total);
      });
    }
    xhr.onload = () => {
      if (activeUploadXhr === xhr) activeUploadXhr = null;
      if (getToken() !== uploadToken) {
        reject(new ApiError(0, { error: "session changed while upload was in flight" }));
        return;
      }
      let payload = {};
      try { payload = JSON.parse(xhr.responseText || "{}"); } catch { /* empty body */ }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(payload);
      } else {
        // Same session-lost flow as api.call() (api.js onUnauthorized).
        if (xhr.status === 401) filesSessionLost?.();
        reject(new ApiError(xhr.status, payload));
      }
    };
    xhr.onerror = () => {
      if (activeUploadXhr === xhr) activeUploadXhr = null;
      reject(new ApiError(0, { error: "cannot reach the msg.mesh server" }));
    };
    xhr.ontimeout = () => {
      if (activeUploadXhr === xhr) activeUploadXhr = null;
      reject(new ApiError(0, { error: "upload timed out" }));
    };
    xhr.onabort = () => reject(new ApiError(0, { error: "upload cancelled" }));
    xhr.send(JSON.stringify({
      filename,
      content_type: contentType,
      content_base64: b64,
      size_bytes: size,
    }));
  });
}

let uploadSeq = 0;
export async function handleFile(file) {
  const seq = ++uploadSeq; // a new selection supersedes any previous upload
  const uploadToken = getToken();
  const uploadUserId = state.user && state.user.user_id;
  const sessionIsCurrent = () => !!uploadToken && getToken() === uploadToken &&
    !!state.user && state.user.user_id === uploadUserId;
  if (activeUploadXhr) { activeUploadXhr.abort(); activeUploadXhr = null; }
  setPendingAttachment(null);
  if (!file) return;
  if (!sessionIsCurrent()) {
    ui.toast("Sign in before uploading a file.", true);
    return;
  }
  const type = String(file.type || "").toLowerCase();
  const compressibleImage = ["image/jpeg", "image/png", "image/webp"].includes(type);
  const sourceLimit = compressibleImage ? MAX_IMAGE_SOURCE : MAX_FILE;
  if (file.size > sourceLimit) {
    const limit = compressibleImage ? "5 MB before image compression" : `${Math.round(MAX_FILE / 1024)} KB`;
    ui.toast(`File too large (max ${limit})`, true);
    return;
  }
  const bar = $("#pendingFile");
  const label = $("#pendingFileName");
  if (bar) bar.classList.remove("hidden");
  if (label) label.textContent = file.name + " — preparing";
  try {
    const prepared = await prepareUploadFile(file);
    if (seq !== uploadSeq || !sessionIsCurrent()) return;
    if (prepared.size > MAX_FILE) {
      setPendingAttachment(null);
      ui.toast(`Image is still too large after compression (max ${Math.round(MAX_FILE / 1024)} KB)`, true);
      return;
    }
    const uploadName = prepared.filename || file.name;
    const b64 = await fileToBase64(prepared.blob);
    if (seq !== uploadSeq || !sessionIsCurrent()) return;
    const r = await uploadWithProgress(
      uploadName,
      prepared.type,
      b64,
      prepared.size,
      (loaded, total) => {
        if (seq === uploadSeq && sessionIsCurrent() && label && bar && !bar.classList.contains("hidden")) {
          const pct = Math.round((loaded / total) * 100);
          label.textContent = file.name + " — " + pct + "%";
        }
      },
      uploadToken
    );
    if (seq !== uploadSeq || !sessionIsCurrent()) return;
    setPendingAttachment({ id: r.attachment_id, filename: r.filename || uploadName, content_type: r.content_type || prepared.type, size_bytes: r.size_bytes ?? prepared.size });
    const saved = Number(r.size_bytes ?? prepared.size);
    const reduction = file.size > 0 ? Math.round((1 - saved / file.size) * 100) : 0;
    ui.toast(reduction >= 5 ? `Attached ${r.filename || uploadName} (${reduction}% smaller)` : "Attached " + (r.filename || uploadName));
  } catch (e) {
    if (seq !== uploadSeq || !sessionIsCurrent()) return;
    setPendingAttachment(null);
    ui.toast("Upload failed: " + friendlyError(e), true);
  }
}

// Resize raster images and, when needed, use WebP for a much smaller upload.
// GIF/SVG and non-image files are never transcoded. If the browser cannot decode
// an image or encoding is not beneficial, retain the original bytes unchanged.
async function prepareUploadFile(file) {
  const type = String(file.type || "").toLowerCase();
  const supported = ["image/jpeg", "image/png", "image/webp"].includes(type);
  if (!supported || typeof createImageBitmap !== "function" || file.size < 96 * 1024) {
    return { blob: file, type: file.type || "application/octet-stream", size: file.size };
  }

  // Do not recompress an image that already fits the wire limit. Compression
  // is a fallback for oversized images, not a blanket quality reduction.
  if (file.size <= MAX_FILE) return { blob: file, type, size: file.size };

  let bitmap;
  try { bitmap = await createImageBitmap(file); }
  catch { return { blob: file, type, size: file.size }; }
  try {
    const sourceMax = Math.max(bitmap.width, bitmap.height);
    const edgeTargets = [1920, 1600, 1280, 1024, 800, 640];
    const targets = [...new Set(edgeTargets.map(edge => Math.min(sourceMax, edge)))];
    const qualities = [0.88, 0.82, 0.76, 0.70, 0.64, 0.58, 0.52];
    let best = null;

    for (const edge of targets) {
      const scale = Math.min(1, edge / sourceMax);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      // Preserve transparent pixels for both PNG and WebP; only JPEG is opaque.
      const ctx = canvas.getContext("2d", { alpha: type !== "image/jpeg" });
      if (!ctx) continue;
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const encode = (mime, quality) => new Promise(resolve => canvas.toBlob(resolve, mime, quality));

      // PNG's quality parameter is ignored by browsers, so encode it once.
      // JPEG/WebP are tried from high to lower quality; the first candidate
      // under the server limit is the best-quality candidate at this size.
      if (type === "image/png") {
        const png = await encode("image/png");
        if (png && png.type === "image/png") {
          if (!best || png.size < best.blob.size) best = { blob: png, type: png.type, size: png.size };
          if (png.size <= MAX_FILE) {
            return { blob: png, type: png.type, size: png.size };
          }
        }
      }

      const outputTypes = type === "image/webp"
        ? ["image/webp"]
        : type === "image/jpeg"
          ? ["image/jpeg", "image/webp"]
          : ["image/webp"];
      for (const outputType of outputTypes) {
        for (const quality of qualities) {
          const encoded = await encode(outputType, quality);
          if (!encoded || encoded.type !== outputType) continue;
          const filename = outputType !== type
            ? file.name.replace(/\.[^.]+$/, "") + ".webp"
            : undefined;
          if (!best || encoded.size < best.blob.size) {
            best = { blob: encoded, type: encoded.type, size: encoded.size, filename };
          }
          if (encoded.size <= MAX_FILE) {
            return { blob: encoded, type: encoded.type, size: encoded.size, filename };
          }
        }
      }
    }

    // Keep the smallest successful encoding so the caller can report the
    // precise size-limit failure; never silently send an oversized payload.
    return best && best.size < file.size ? best : { blob: file, type, size: file.size };
  } finally {
    bitmap.close?.();
  }
}
$("#fileInput").addEventListener("change", () => {
  const file = $("#fileInput").files[0];
  $("#fileInput").value = "";
  handleFile(file);
});

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(",")[1] || "");
    fr.onerror = () => reject(new Error("could not read file"));
    fr.readAsDataURL(file);
  });
}

export async function openAttachment(attachmentId, filename) {
  try {
    const r = await api.download(attachmentId);
    const bin = atob(r.content_base64 || "");
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    // Security: always force save-to-disk via <a download>. Never window.open(blob)
    // — blob URLs inherit the app origin and a hostile file (e.g. text/html with
    // script) could execute in our origin and steal the session token.
    const blob = new Blob([bytes], { type: r.content_type || "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = r.filename || filename || "attachment";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (e) {
    ui.toast("Download failed: " + friendlyError(e), true);
  }
}
