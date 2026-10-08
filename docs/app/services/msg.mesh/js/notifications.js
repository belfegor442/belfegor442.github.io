// Desktop-style notifications for incoming messages while the tab is hidden.
// Uses the browser Notification API only after explicit user permission.

let permission = typeof Notification !== "undefined" ? Notification.permission : "denied";

export function notificationsSupported() {
  return typeof Notification !== "undefined";
}

export function notificationsGranted() {
  return notificationsSupported() && Notification.permission === "granted";
}

// Ask once, on a user gesture (opening a chat or sending the first message).
export async function requestNotificationPermission() {
  if (!notificationsSupported() || Notification.permission !== "default") return;
  try {
    const res = await Notification.requestPermission();
    permission = res;
  } catch { /* older API shape */ }
}

const cooldown = new Map(); // tag -> last shown ms (avoid spam per conversation)

export function notifyIncoming({ tag, title, body }) {
  if (!notificationsGranted()) return;
  if (document.visibilityState === "visible" && document.hasFocus()) return;
  const now = Date.now();
  const last = cooldown.get(tag) || 0;
  if (now - last < 4000) return;
  cooldown.set(tag, now);
  try {
    new Notification(title, { body, tag, silent: false });
  } catch { /* notification construction can fail on some platforms */ }
}
