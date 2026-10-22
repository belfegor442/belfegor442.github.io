import { state, peerLabel } from "../../core/state.js";
import { esc, fmtTime, dayKey, dayLabel, fileSize } from "../../shared/dom.js";
import { emotes, emoteTokens } from "../../shared/emotes.js";
import { isImageAtt, hydrateAttImages } from "./attachments.js";

function statusGlyph(m, peer) {
  if (m.sync === "sending") return "…";
  if (m.sync === "failed") return "!";
  if (!m.mine) return "";
  const pp = state.peerPointers.get(peer) || 0;
  if (m.rowid != null && pp >= m.rowid) return "✓✓";
  return "✓";
}

function messageLineHtml(m, peer) {
  const rid = m.rowid != null && Number.isFinite(Number(m.rowid)) ? Number(m.rowid) : "";
  const cls = ["msg-line", m.mine ? "mine" : "other"];
  if (m.sync === "sending") cls.push("pending");
  if (m.sync === "failed") cls.push("failed");
  if (m.deleted) cls.push("deleted");
  const ts = `<span class="ts">${esc(fmtTime(new Date(m.ts)))}</span>`;
  // In a group every incoming line is labelled with its actual sender.
  const isGroupPeer = /^g\d+$/.test(peer);
  const who = m.mine ? "You" : peerLabel(isGroupPeer ? m.sender : peer).slice(0, 16);
  const whoSpan = `<span class="who">${esc(who)}:</span>`;

  if (m.deleted) {
    return `<div class="${cls.join(" ")}" data-id="${esc(m.id)}" data-rowid="${rid}">
      ${ts}${whoSpan}<span class="body msg-deleted">Message deleted</span>
    </div>`;
  }

  let att = "";
  if (m.attachment) {
    const fname = m.attachment.filename || "file";
    const meta = `${esc(fname)}<small> ${esc(m.attachment.type || "")}${m.attachment.size ? " · " + fileSize(m.attachment.size) : ""}</small>`;
    att = isImageAtt(m.attachment)
      ? `<a class="att-chip att-img-chip" data-att="${esc(m.attachment.id)}" data-attname="${esc(fname)}" href="#"><img class="att-img" data-attimg="${esc(m.attachment.id)}" data-attimg-size="${esc(m.attachment.size || 0)}" alt="${esc(fname)}"><span>${meta}</span></a>`
      : `<a class="att-chip" data-att="${esc(m.attachment.id)}" data-attname="${esc(fname)}" href="#"><img src="./assets/xp/icons/Generic Document.png" alt="" width="14" height="14"><span>${meta}</span></a>`;
  }
  const body = m.text ? emoteTokens(esc(emotes(m.text))) : (att ? "" : `<span class="msg-type-label">(${esc(m.type)})</span>`);
  const st = statusGlyph(m, peer);
  const retryHint = m.sync === "failed" ? ' title="Send failed — click to retry"' : "";
  const editedTag = m.edited ? `<span class="edited-tag" title="Edited">(edited)</span>` : "";
  const pinTag = m.pinned ? `<span class="pinned-tag" title="Pinned">📌</span>` : "";

  let quote = "";
  const r = m.reply;
  if (r && r.id) {
    const rwho = r.from != null && String(r.from) === String(state.selfNode)
      ? "You"
      : peerLabel(isGroupPeer && r.from != null ? String(r.from) : peer).slice(0, 16);
    const rtext = r.text ? esc(String(r.text).slice(0, 140)) : "(attachment)";
    quote = `<div class="reply-quote" data-jumprow="${r.rowid != null && Number.isFinite(Number(r.rowid)) ? Number(r.rowid) : ""}" title="Jump to quoted message"><b>${esc(rwho)}:</b> ${rtext}</div>`;
  }

  let chips = "";
  const entries = (m.reactions && typeof m.reactions === "object" && !Array.isArray(m.reactions))
    ? Object.entries(m.reactions).filter(([, v]) => Array.isArray(v) && v.length)
    : [];
  if (entries.length) {
    const self = String(state.selfNode);
    chips = `<span class="reactions">` + entries.map(([emoji, ids]) => {
      const mineOn = ids.map(String).includes(self);
      return `<button type="button" class="reaction-chip${mineOn ? " mine" : ""}" data-react="${esc(emoji)}" title="${ids.length} reaction${ids.length === 1 ? "" : "s"} — click to ${mineOn ? "remove" : "react"}">${esc(emoji)}<span class="reaction-count">${ids.length}</span></button>`;
    }).join("") + `</span>`;
  }

  return `<div class="${cls.join(" ")}" data-id="${esc(m.id)}" data-rowid="${rid}"${retryHint}>
    ${quote}${ts}${whoSpan}<span class="body">${body}</span>${st ? `<span class="st">${esc(st)}</span>` : ""}${att}${editedTag}${pinTag}${chips}
  </div>`;
}

function renderPinnedStrip(c) {
  const strip = document.querySelector("#pinnedStrip");
  if (!strip) return;
  const pinned = c ? [...c.messages].reverse().find((m) => m.pinned && !m.deleted) : null;
  if (!pinned) {
    strip.classList.add("hidden");
    strip.innerHTML = "";
    return;
  }
  const who = pinned.mine
    ? "You"
    : peerLabel(/^g\d+$/.test(state.activePeer) && pinned.sender ? pinned.sender : state.activePeer).slice(0, 16);
  const text = String(pinned.text || (pinned.attachment ? pinned.attachment.filename : "") || "(" + (pinned.type || "message") + ")").slice(0, 140);
  strip.classList.remove("hidden");
  strip.innerHTML = `<span class="pinned-ico" title="Pinned message">📌</span><button type="button" class="pinned-jump" title="Jump to pinned message">${esc(who)}: ${esc(text)}</button><button type="button" class="pinned-x" title="Unpin">✕</button>`;
}

export function renderMessages(opts = {}) {
  const peer = state.activePeer;
  if (!peer) return;
  const c = state.conversations.get(peer);
  const box = document.querySelector("#messageList");
  const wrap = document.querySelector("#messages");
  if (!box || !wrap) return;

  if (!c || !c.messages.length) {
    box.innerHTML = '<div class="list-empty">No messages yet. Say hello!</div>';
    document.querySelector("#loadOlder")?.classList.add("hidden");
    document.querySelector("#newMsgsPill")?.classList.add("hidden");
    renderPinnedStrip(null);
    return;
  }

  // capture before the re-render: the new content grows the scroller
  const atBottom = wrap.scrollHeight - wrap.scrollTop - wrap.clientHeight < 60;
  let html = "";
  let lastDay = "";
  for (const m of c.messages) {
    const k = dayKey(m.ts);
    if (k !== lastDay) {
      html += `<div class="day-divider">${dayLabel(m.ts)}</div>`;
      lastDay = k;
    }
    html += messageLineHtml(m, peer);
  }
  box.innerHTML = html;
  document.querySelector("#loadOlder")?.classList.toggle("hidden", !c.hasMore);
  hydrateAttImages(box);
  renderPinnedStrip(c);

  // scroll: default/true = pin to bottom (send / open chat); "auto" = pin only
  // when the user was already at the bottom, otherwise offer the pill; false =
  // caller manages scroll position (load older).
  if (opts.scroll === "auto") {
    if (atBottom) wrap.scrollTop = wrap.scrollHeight;
    else document.querySelector("#newMsgsPill")?.classList.remove("hidden");
  } else if (opts.scroll !== false) {
    wrap.scrollTop = wrap.scrollHeight;
  }
}
