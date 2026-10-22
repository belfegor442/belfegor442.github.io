import { $ } from "./dom.js";
import { playSound } from "../infrastructure/sound.js";

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
