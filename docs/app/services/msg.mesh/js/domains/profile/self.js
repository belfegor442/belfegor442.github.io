import { state } from "../../core/state.js";
import { $, initials, applyAvatarPhoto } from "../../shared/dom.js";

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
