import { api, friendlyError } from "../../infrastructure/api/index.js";
import { $ } from "../../shared/dom.js";
import * as ui from "../../ui.js";

/* ---------------- shared files (details panel) ---------------- */
$("#sharedFiles").addEventListener("click", async (e) => {
  const item = e.target.closest("[data-att]");
  if (!item) return;
  const id = item.dataset.att;
  const name = item.dataset.attname || "file";
  try {
    const r = await api.download(id);
    const b64 = r.content_base64 || "";
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const blob = new Blob([bytes]);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  } catch (err) {
    ui.toast("Download failed: " + friendlyError(err), true);
  }
});
