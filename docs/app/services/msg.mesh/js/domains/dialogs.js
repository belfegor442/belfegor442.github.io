/* ---------------- dialogs: new chat, search, profile, settings ---------------- */
import { api, getToken, friendlyError } from "../infrastructure/api/index.js";
import { state, isFriend, outgoingTo, incomingFrom, loadFriends, primeUsers, ingest, loadBlocked, saveProfile } from "../core/state.js";
import { $, esc, showErr } from "../shared/dom.js";
import * as ui from "../ui.js";
import { hooks } from "../core/hooks.js";


function wireDialogClose(sel) {
  document.querySelectorAll(sel).forEach((b) => {
    b.addEventListener("click", (e) => {
      e.preventDefault();
      b.closest("dialog")?.close();
    });
  });
}
wireDialogClose("dialog .win-cap.close:not(#callClose)"); // callâœ• routes through dismissCall()

export function openNewChat() {
  showErr($("#newChatStatus"), "");
  $("#newChatResults").innerHTML = "";
  $("#newChatInput").value = "";
  ui.renderContacts();
  $("#newChatDialog").showModal();
  $("#newChatInput").focus();
}

$("#newChatForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const q = $("#newChatInput").value.trim().replace(/^@/, "");
  if (!q) return;
  const box = $("#newChatResults");
  showErr($("#newChatStatus"), "Searching…");
  box.innerHTML = '<p class="hint"><img class="hourglass" src="./assets/xp/gifs/hourglass.gif" alt=""> Searching…</p>';
  try {
    const r = await api.usersSearch(q);
    const users = (r.users || []).filter((u) => String(u.user_id) !== state.user.user_id);
    showErr($("#newChatStatus"), users.length ? "" : "No users found.");
    for (const u of users) {
      state.users.set(String(u.user_id), { ...u, user_id: String(u.user_id) });
      const row = document.createElement("div");
      row.className = "user-item-row";
      const friend = isFriend(u.user_id);
      const pending = outgoingTo(u.user_id);
      const incoming = incomingFrom(u.user_id);
      const online = u.status === "online";
      row.innerHTML = `<button type="button" class="user-item">
        <span class="dot ${online ? "on" : ""}"></span>
        <div><strong>${esc(u.display_name || u.username)}</strong><small>@${esc(u.username)}</small></div>
        <span class="status ${online ? "on" : ""}">${online ? "online" : "offline"}</span>
      </button>
      ${friend ? '<span class="tag-ok">FRIEND</span>'
        : incoming ? '<button type="button" class="mini-btn accept" data-act="accept">ACCEPT</button>'
        : pending ? '<span class="tag-ok">PENDING</span>'
        : '<button type="button" class="mini-btn" data-act="add">Add Friend</button>'}`;
      row.querySelector(".user-item").addEventListener("click", () => {
        $("#newChatDialog").close();
        hooks.openChat("u" + u.user_id);
      });
      const act = row.querySelector("[data-act]");
      if (act) {
        act.addEventListener("click", async (ev) => {
          ev.stopPropagation();
          act.disabled = true;
          try {
            if (act.dataset.act === "accept") {
              await api.friendAccept(incoming.request_id);
            } else {
              await api.friendRequest(u.user_id);
            }
            await loadFriends().catch(() => null);
            await primeUsers();
            hooks.emitFriends();
            ui.toast(act.dataset.act === "accept" ? "Contact added" : "Contact request sent");
            openNewChatRefresh();
          } catch (err) {
            ui.toast(friendlyError(err), true);
            act.disabled = false;
          }
        });
      }
      box.appendChild(row);
    }
  } catch (e2) {
    showErr($("#newChatStatus"), friendlyError(e2));
  }
});

function openNewChatRefresh() {
  const d = $("#newChatDialog");
  if (!d.open) return;
  ui.renderContacts();
  const q = $("#newChatInput").value.trim();
  if (q) $("#newChatForm").requestSubmit();
}

export function openSearch() {
  $("#searchInput").value = "";
  $("#searchResults").innerHTML = '<p class="hint">Search runs against your conversations on the server.</p>';
  const d = $("#searchDialog");
  if (!d.open) d.showModal();
  $("#searchInput").focus();
}

$("#searchForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const q = $("#searchInput").value.trim();
  if (!q) return;
  const box = $("#searchResults");
  box.innerHTML = '<p class="hint"><img class="hourglass" src="./assets/xp/gifs/hourglass.gif" alt=""> Searching…</p>';
  try {
    const r = await api.searchMessages(q);
    const items = r.items || [];
    ingest(items);
    await primeUsers();
    ui.renderSidebar();
    if (!items.length) {
      box.innerHTML = '<p class="hint">No messages matched.</p>';
      return;
    }
    box.innerHTML = "";
    for (const item of items) {
      let env = {};
      try { env = JSON.parse(item.payload) || {}; } catch { /* raw */ }
      const sender = item.sender_node_id;
      const mine = sender === state.selfNode;
      const peer = mine ? item.receiver_node_id : sender;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "search-hit";
      const d = new Date(String(item.created_at).replace(" ", "T") + "Z");
      btn.innerHTML = `<strong>${esc(mine ? "You â†’ " + peerLabelSafe(peer) : peerLabelSafe(peer) + " â†’ you")}</strong>
        <p>${esc(env.text || "(" + (item.message_type || "message") + ")")}</p>
        <span class="meta">${esc(Number.isNaN(d.getTime()) ? item.created_at : d.toLocaleString())}</span>`;
      btn.addEventListener("click", () => {
        $("#searchDialog").close();
        hooks.openChat(peer, { jumpRowid: item.rowid });
      });
      box.appendChild(btn);
    }
  } catch (e2) {
    box.innerHTML = `<p class="hint">${esc(friendlyError(e2))}</p>`;
  }
});

function peerLabelSafe(peer) {
  const m = /^u(\d+)$/.exec(peer || "");
  const u = m ? state.users.get(m[1]) : null;
  return u ? (u.display_name || u.username) : peer;
}

function selfInitials() {
  if (state.profile && state.profile.avatar) return state.profile.avatar;
  const u = state.user;
  return ui.initials(u ? (u.display_name || u.username) : "");
}

function sanitizeProfileValue(v, max) {
  let s = String(v == null ? "" : v).trim().replace(/[\x00-\x1f\x7f]/g, "");
  return s.length > max ? s.slice(0, max) : s;
}

function readImageScaled(file, maxW, maxH, mime, quality) {
  return new Promise((resolve, reject) => {
    if (!file || String(file.type || "").indexOf("image/") !== 0) { reject(new Error("Choose an image file.")); return; }
    if (file.size > 8 * 1024 * 1024) { reject(new Error("Image too large (max 8 MB).")); return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight, 1);
        const w = Math.max(1, Math.round(img.naturalWidth * scale));
        const h = Math.max(1, Math.round(img.naturalHeight * scale));
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        const ctx = c.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL(mime, quality));
      } catch (err) {
        reject(err);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not read image.")); };
    img.src = url;
  });
}

let pendingPhoto = "";
let pendingBanner = "";
let pendingPhotoName = "";
let pendingBannerName = "";

function renderPhotoBannerPreview() {
  const pt = $("#profileAvatarText");
  if (pt) pt.textContent = selfInitials();
  ui.applyAvatarPhoto($("#profileAvatarImg"), pt, pendingPhoto);
  const strip = $("#profileBannerStrip");
  const bimg = $("#profileBannerImg");
  if (strip && bimg) {
    if (pendingBanner) {
      bimg.src = pendingBanner;
      strip.classList.remove("hidden");
    } else {
      bimg.removeAttribute("src");
      strip.classList.add("hidden");
    }
  }
  const pn = $("#profilePhotoName");
  if (pn) pn.textContent = pendingPhoto ? pendingPhotoName || "Photo set" : "No photo";
  const bn = $("#profileBannerName");
  if (bn) bn.textContent = pendingBanner ? pendingBannerName || "Banner set" : "No banner";
}

function renderProfilePreview() {
  const u = state.user;
  if (!u) return;
  renderPhotoBannerPreview();
  $("#profileName").textContent = u.display_name || u.username;
  $("#profileHandle").textContent = "@" + u.username;
  const sl = $("#profileStatusLine");
  if (sl) sl.textContent = state.profile.status ? "- " + state.profile.status : "";
}

export function openProfile() {
  const u = state.user;
  if (!u) return;
  pendingPhoto = state.profile.photo || "";
  pendingBanner = state.profile.banner || "";
  pendingPhotoName = "";
  pendingBannerName = "";
  renderProfilePreview();
  $("#profileDisplayName").value = u.display_name || "";
  $("#profileStatusText").value = state.profile.status || "";
  $("#profileAbout").value = state.profile.about || "";
  $("#profileAvatarField").value = state.profile.avatar || "";
  showErr($("#profileStatus"), "");
  $("#profileDialog").showModal();
}

export function openSettings() {
  hooks.applyServerSettings();
  $("#settingsDialog").showModal();
  // Refresh from the server so the list survives a reload/account switch.
  loadBlocked().catch(() => null).finally(() => hooks.renderBlockedList());
}

function wireImagePicker(btnId, inputId, clearId, maxW, maxH, mime, quality, apply) {
  const btn = $(btnId);
  const input = $(inputId);
  const clear = $(clearId);
  btn?.addEventListener("click", () => input.click());
  clear?.addEventListener("click", () => {
    apply("", "");
    showErr($("#profileStatus"), "");
    renderPhotoBannerPreview();
  });
  input?.addEventListener("change", async (e) => {
    const f = e.target.files && e.target.files[0];
    const fname = f ? f.name : "";
    e.target.value = "";
    if (!f) return;
    try {
      const dataUrl = await readImageScaled(f, maxW, maxH, mime, quality);
      apply(dataUrl, fname);
      showErr($("#profileStatus"), "");
      renderPhotoBannerPreview();
    } catch (err) {
      showErr($("#profileStatus"), err.message);
    }
  });
}

wireImagePicker("#profilePhotoBrowse", "#profilePhotoInput", "#profilePhotoClear", 160, 160, "image/png", undefined, (v, n) => {
  pendingPhoto = v;
  pendingPhotoName = n || "";
});
wireImagePicker("#profileBannerBrowse", "#profileBannerInput", "#profileBannerClear", 600, 160, "image/jpeg", 0.85, (v, n) => {
  pendingBanner = v;
  pendingBannerName = n || "";
});

$("#profileForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const sessionToken = getToken();
  const sessionUserId = state.user && state.user.user_id;
  if (!sessionToken || !sessionUserId) return;
  const name = sanitizeProfileValue($("#profileDisplayName").value, 64);
  if (!name) { showErr($("#profileStatus"), "Display name must be 1-64 characters."); return; }
  const status = sanitizeProfileValue($("#profileStatusText").value, 128);
  const about = sanitizeProfileValue($("#profileAbout").value, 256);
  const avatar = sanitizeProfileValue($("#profileAvatarField").value, 2);
  try {
    // One server round-trip: the server stores every field and returns the
    // canonical profile, which we mirror into the local cache.
    const r = await api.usersUpdate({
      display_name: name,
      status_text: status,
      about,
      avatar,
      photo: pendingPhoto,
      banner: pendingBanner,
    });
    if (getToken() !== sessionToken || !state.user || state.user.user_id !== sessionUserId) return;
    state.user = hooks.normalizeUser(r.user ? { user: r.user, role: state.user.role, tenant_id: state.user.tenant_id } : r);
    const sp = (r.user && r.user.profile) || {};
    if (!saveProfile({
      status: typeof sp.status_text === "string" ? sp.status_text : status,
      about: typeof sp.about === "string" ? sp.about : about,
      avatar: typeof sp.avatar === "string" ? sp.avatar : avatar,
      photo: typeof sp.photo === "string" ? sp.photo : pendingPhoto,
      banner: typeof sp.banner === "string" ? sp.banner : pendingBanner,
    })) {
      showErr($("#profileStatus"), "Profile is too large for browser storage.");
      return;
    }
    ui.renderProfile();
    renderProfilePreview();
    showErr($("#profileStatus"), "");
    $("#profileDialog").close();
    ui.toast("Profile updated");
    ui.renderMessages({ scroll: false });
  } catch (err) {
    showErr($("#profileStatus"), friendlyError(err));
  }
});

$("#logoutBtn").addEventListener("click", () => {
  $("#settingsDialog").close();
  hooks.logout();
});
