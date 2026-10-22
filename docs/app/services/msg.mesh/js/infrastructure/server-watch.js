import { api, resolveApiBase, apiBase } from "./api/index.js";
import { playSound } from "./sound.js";
import { $, showErr } from "../shared/dom.js";
import { toast } from "../shared/toast.js";

let serverWatchTimer = 0;
let serverWatchTries = 0;

function stopServerWatch() {
  if (serverWatchTimer) {
    clearInterval(serverWatchTimer);
    serverWatchTimer = 0;
  }
}

// Append a one-click probe to the unreachable note: opening /health in a new
// tab shows plain JSON when the user's network reaches the server, or the
// browser's own network error when it does not — separates "my app is broken"
// from "my network cannot reach the funnel" without any support round-trip.
function appendWatchDiag(box) {
  if (!box) return;
  const a = document.createElement("a");
  a.href = (apiBase() || "") + "/health";
  a.target = "_blank";
  a.rel = "noopener";
  a.textContent = " (open server status)";
  box.appendChild(a);
}

function bumpWatchNote() {
  serverWatchTries += 1;
  const text = `Server unreachable — retrying automatically... (try ${serverWatchTries})`;
  const hint = $("#authHint");
  const regDlg = $("#registerDialog");
  if (hint && !regDlg?.open && (!hint.textContent || hint.textContent.startsWith("Server unreachable"))) {
    hint.textContent = text;
    appendWatchDiag(hint);
  }
  if (regDlg?.open) {
    const regErr = $("#regError");
    if (regErr) {
      regErr.classList.remove("error");
      regErr.classList.add("note");
      regErr.textContent = text;
      regErr.classList.remove("hidden");
      appendWatchDiag(regErr);
    }
  }
}

// Login/register/boot failed at the network level: re-probe the candidate
// servers every few seconds so the screen heals itself when one comes back
// (the funnel/host may have been rebooting) — no manual page reload needed.
// onRecovered runs when the probe succeeds (session code clears its notice).
function startServerWatch(onRecovered = null) {
  if (serverWatchTimer) return;
  serverWatchTries = 0;
  const hint = $("#authHint");
  const regDlg = $("#registerDialog");
  if (regDlg?.open || (hint && !hint.textContent)) bumpWatchNote();
  serverWatchTimer = setInterval(async () => {
    if (!serverWatchTimer) return;
    try {
      await resolveApiBase(); // re-probe all candidates, repoint if one is healthy
      const h = await api.health();
      if (!h.ok) { bumpWatchNote(); return; }
      stopServerWatch();
      if (typeof onRecovered === "function") onRecovered();
      showErr($("#authError"), "");
      if (hint) hint.textContent = "Server is back online — sign in to continue.";
      // The register dialog is a modal <dialog>: everything outside it (toast,
      // auth hint) is stuck in the top-layer backdrop — surface recovery
      // inside the dialog itself.
      const regDlg2 = $("#registerDialog");
      if (regDlg2?.open) {
        const regErr = $("#regError");
        showErr(regErr, "Server is back online — try creating your account again.");
        regErr?.classList.remove("error");
        regErr?.classList.add("note");
      }
      toast("Server is back online");
      playSound("message");
    } catch { bumpWatchNote(); }
  }, 8000);
}

export { stopServerWatch, startServerWatch };
