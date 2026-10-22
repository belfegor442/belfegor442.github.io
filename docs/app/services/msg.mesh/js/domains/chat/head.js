import { state, peerLabel, peerUser, peerOnline, isTyping, isFriend } from "../../core/state.js";
import { esc, initials, isSafeImageDataUrl, applyAvatarPhoto, fileSize } from "../../shared/dom.js";
import { roleBadge } from "../contacts/sidebar.js";

export function renderChatHead() {
  const peer = state.activePeer;
  if (!peer) return;
  const label = peerLabel(peer);
  const u = peerUser(peer);
  const nameEl = document.querySelector("#chatName");
  const avEl = document.querySelector("#chatAvatar");
  const metaEl = document.querySelector("#chatMeta");
  if (nameEl) nameEl.textContent = label;
  if (avEl) avEl.textContent = initials(label);

  if (!metaEl) return;
  let head = "";
  const online = peerOnline(peer);
  const typingNow = isTyping(peer);
  const g = state.groups.get(peer);
  head += `<span class="dot ${online ? "on" : ""}"></span>`;
  if (g) {
    const n = Array.isArray(g.members) ? g.members.length : 0;
    head += typingNow
      ? `<span class="typing-meta">typing…</span>`
      : esc(`${n} member${n === 1 ? "" : "s"}`);
  } else if (u) {
    head += typingNow ? `<span class="typing-meta">typing.</span>` : (online ? "Ready to chat" : "Offline");
    head += " &nbsp;·&nbsp; " + esc("@" + u.username) + roleBadge(u.user_id);
  } else {
    head += esc("device " + peer);
  }
  const myLastMine = [...((state.conversations.get(peer) || {}).messages || [])]
    .filter((m) => m.mine && m.rowid != null)
    .reduce((a, m) => Math.max(a, m.rowid), 0);
  const pp = state.peerPointers.get(peer) || 0;
  if (myLastMine > 0) head += " &nbsp;·&nbsp; " + (pp >= myLastMine ? "Read" : "Sent");
  metaEl.innerHTML = head;
  renderDetails();
}

export function renderDetails() {
  const peer = state.activePeer;
  if (!peer) return;
  const label = peerLabel(peer);
  const u = peerUser(peer);
  const c = state.conversations.get(peer);
  const dn = document.querySelector("#detailsName");
  if (dn) dn.textContent = label;
  const g = state.groups.get(peer);
  const dh = document.querySelector("#detailsHandle");
  if (dh) {
    if (g) dh.textContent = (Array.isArray(g.members) ? g.members.length : 0) + " members";
    else dh.textContent = u ? "@" + u.username : peer;
  }
  const photo = u && u.profile ? String(u.profile.photo || "") : "";
  const avatarChar = u && u.profile && u.profile.avatar ? u.profile.avatar : initials(label);
  const dat = document.querySelector("#detailsAvatar");
  if (dat) dat.textContent = avatarChar;
  applyAvatarPhoto(document.querySelector("#detailsAvatarImg"), dat, photo);
  const bb = document.querySelector("#detailsBanner");
  if (bb) {
    const bimg = document.querySelector("#detailsBannerImg");
    const btxt = document.querySelector("#detailsBannerText");
    if (btxt) btxt.textContent = avatarChar;
    if (photo && bimg && isSafeImageDataUrl(photo)) {
      bimg.src = photo;
      bimg.classList.remove("hidden");
      if (btxt) btxt.classList.add("hidden");
      bb.classList.remove("hidden");
    } else {
      if (bimg) { bimg.removeAttribute("src"); bimg.classList.add("hidden"); }
      bb.classList.add("hidden");
    }
  }
  const ds = document.querySelector("#detailsStatus");
  if (ds) {
    if (g) ds.textContent = "Group chat";
    else if (u) ds.textContent = peerOnline(peer) ? "Online" : "Offline";
    else ds.textContent = "Device node";
  }
  // Server-side profile block (migration 018): status text + about.
  const pst = document.querySelector("#detailsPeerStatus");
  if (pst) {
    const st = u && u.profile ? String(u.profile.status_text || "") : "";
    pst.textContent = st;
    pst.classList.toggle("hidden", !st);
  }
  const abRow = document.querySelector("#detailsAboutRow");
  const ab = document.querySelector("#detailsAbout");
  if (abRow && ab) {
    const about = u && u.profile ? String(u.profile.about || "") : "";
    ab.textContent = about || "-";
    abRow.classList.toggle("hidden", !about);
  }
  const dm = document.querySelector("#detailsMessages");
  if (dm) dm.textContent = String(c ? c.messages.length : 0);
  const dr = document.querySelector("#detailsRead");
  const pp = state.peerPointers.get(peer) || 0;
  if (dr) dr.textContent = pp > 0 ? `Row ${pp}` : "—";

  const m = /^u(\d+)$/.exec(peer);
  const addBtn = document.querySelector("#addContactBtn");
  const removeBtn = document.querySelector("#removeContactBtn");
  const blockBtn = document.querySelector("#blockContactBtn");
  if (addBtn && removeBtn) {
    if (m) {
      const friend = isFriend(m[1]);
      const blocked = state.blocked.has(m[1]);
      // A blocked user can never be (re)added as a contact — the server 403s.
      addBtn.classList.toggle("hidden", friend || blocked);
      removeBtn.classList.toggle("hidden", !friend);
    } else {
      addBtn.classList.add("hidden");
      removeBtn.classList.add("hidden");
    }
  }
  if (blockBtn) {
    if (m) {
      const blocked = state.blocked.has(m[1]);
      blockBtn.classList.remove("hidden");
      blockBtn.textContent = blocked ? "Unblock" : "Block";
    } else {
      blockBtn.classList.add("hidden");
    }
  }

  const filesBlock = document.querySelector("#sharedFilesBlock");
  const filesBox = document.querySelector("#sharedFiles");
  if (filesBlock && filesBox) {
    const seen = new Set();
    const files = [];
    for (const msg of (c ? c.messages : [])) {
      const a = msg.attachment;
      if (a && a.id && !seen.has(a.id)) {
        seen.add(a.id);
        files.push(a);
      }
    }
    if (!files.length) {
      filesBlock.classList.add("hidden");
      filesBox.innerHTML = "";
    } else {
      filesBlock.classList.remove("hidden");
      filesBox.innerHTML = files.map((a) =>
        `<button type="button" class="file-row" data-att="${esc(a.id)}" data-attname="${esc(a.filename || "file")}">
          <img src="./assets/xp/icons/Generic Document.png" alt="" width="16" height="16"><span>${esc(a.filename || "file")}<small> ${esc(a.type || "")}${a.size ? " · " + fileSize(a.size) : ""}</small></span>
        </button>`
      ).join("");
    }
  }
}
