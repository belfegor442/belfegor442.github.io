/* Real XP sounds from the native client (assets/themes/WinXP/Sounds/*.wav).
   Plays are best-effort: browsers may block audio before a user gesture, so
   every rejection is swallowed and the attempt is logged for QA. */
const FILES = {
  startup: "strtup.wav",
  logon: "logon.wav",
  logoff: "logoff.wav",
  message: "msg.recived.wav",
  click: "click.wav",
  menu: "menu.wav",
  error: "error.wav",
  notification: "notification.wav",
  call: "call.wav", // native assets/themes/WinXP/Sounds/call.wav
};

const BASE = new URL("../assets/xp/sounds/", import.meta.url);
const cache = new Map();

function get(name) {
  const f = FILES[name];
  if (!f) return null;
  let a = cache.get(name);
  if (!a) {
    a = new Audio(new URL(f, BASE).href);
    a.preload = "auto";
    cache.set(name, a);
  }
  return a;
}

// Fetch a sound ahead of its moment (logon is primed during the sign-in
// gesture so the file is ready by the time the round-trip finishes).
export function primeSound(name) {
  try { get(name); } catch { /* audio unavailable */ }
}

export function playSound(name) {
  try {
    const a = get(name);
    if (!a) return;
    if (typeof window !== "undefined") {
      if (!Array.isArray(window.__sfxLog)) window.__sfxLog = [];
      window.__sfxLog.push(name);
    }
    a.currentTime = 0;
    const p = a.play();
    if (p && typeof p.catch === "function") p.catch(() => { /* autoplay blocked */ });
  } catch { /* audio unavailable */ }
}

// Ringing loop for calls (native call.wav): loops until stopRing(). Both the
// caller ringback and the callee ring-in use it; autoplay may be blocked
// before a gesture, the visible call dialog is the real signal either way.
let ringing = false;
export function startRing() {
  if (ringing) return;
  const a = get("call");
  if (!a) return;
  ringing = true;
  try {
    a.loop = true;
    a.currentTime = 0;
    const p = a.play();
    if (p && typeof p.catch === "function") p.catch(() => { /* autoplay blocked */ });
  } catch { /* audio unavailable */ }
}
export function stopRing() {
  if (!ringing) return;
  ringing = false;
  const a = get("call");
  if (!a) return;
  try { a.pause(); a.currentTime = 0; } catch { /* audio unavailable */ }
}
