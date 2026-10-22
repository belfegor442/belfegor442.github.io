import { api, friendlyError } from "../../infrastructure/api/index.js";
import { peerLabel } from "../../core/state.js";
import { hooks } from "../../core/hooks.js";
import { $, esc } from "../../shared/dom.js";

/* ---------------- call history ---------------- */

const CALL_STATE_LABEL = {
  ended: "Completed",
  missed: "Missed",
  declined: "Declined",
};

async function renderCallHistory() {
  const list = $("#callHistoryList");
  if (!list) return;
  try {
    const r = await api.callHistory(50);
    const items = (r && Array.isArray(r.items)) ? r.items : [];
    if (!items.length) {
      list.innerHTML = '<div class="list-empty">No calls yet.</div>';
      return;
    }
    list.innerHTML = items.map((c) => {
      const peer = String(c.peer || "");
      const name = peerLabel(peer);
      const dirIcon = "./assets/xp/icons/TB Call.png";
      const media = c.media === "video" ? "Video" : "Audio";
      const stateLabel = CALL_STATE_LABEL[String(c.state || "")] || String(c.state || "?");
      const when = String(c.created_at || "").replace("T", " ").slice(0, 16);
      const dur = c.duration_s != null ? " · " + String(Math.floor(c.duration_s / 60)).padStart(2, "0") + ":" + String(c.duration_s % 60).padStart(2, "0") : "";
      return `<button type="button" class="user-item" data-peer="${esc(peer)}">
        <img src="${dirIcon}" alt="" width="16" height="16">
        <div><strong>${esc(name)}</strong><small>${esc(c.direction === "out" ? "Outgoing" : "Incoming")} ${esc(media)} · ${esc(stateLabel)}${esc(dur)}</small></div>
        <span class="status">${esc(when)}</span>
      </button>`;
    }).join("");
  } catch (err) {
    list.innerHTML = `<div class="list-empty">Could not load call history: ${esc(friendlyError(err))}</div>`;
  }
}

export async function openCallHistory() {
  const d = $("#callHistoryDialog");
  const list = $("#callHistoryList");
  if (!d) return;
  if (list) list.innerHTML = '<div class="list-empty">Loading…</div>';
  if (!d.open) d.showModal();
  await renderCallHistory();
}

$("#callHistoryRefresh")?.addEventListener("click", () => renderCallHistory());
$("#callHistoryList")?.addEventListener("click", (e) => {
  const item = e.target.closest("[data-peer]");
  if (!item) return;
  $("#callHistoryDialog").close();
  hooks.openChat(item.dataset.peer);
});
