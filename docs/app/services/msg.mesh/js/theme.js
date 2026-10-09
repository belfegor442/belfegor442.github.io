/* Windows 98 theme switcher + icon mapper (web mirror of native
   ThemeManager's kW98Icons / icon names). Real native sprites only — every
   swap points at assets/win98/* extracted from the native client. */

const KEY = "msg.mesh.theme";
const XP_DIR = "./assets/xp/icons/";
const W98_DIR = "./assets/win98/icons/";

// XP icon file -> Win98 icon file (native kW98Icons keyed the same way).
// null = native renders label-only in win98 (no art) -> hide the img.
// Critical/Alert intentionally absent: native dialogs fall back to the XP set.
const W98 = {
  "Windows Messenger.png": "mailbox_world-0.png",
  "Control Panel.png": "directory_control_panel-0.png",
  "Login Question.png": "computer_padlock.png",
  "User Accounts.png": "appwizard_list.png",
  "Logout.png": "computer_win_lock-0.png",
  "Address Book.png": "address_book-0.png",
  "Search.png": "magnifying_glass-0.png",
  "Search for people.png": "magnifying_glass-0.png",
  "Network Connections.png": "network-0.png",
  "IE History.png": "clock-0.png",
  "Manage Your Server.png": "certificate_server-0.png",
  "Properties.png": "msg_information-0.png",
  "Theme.png": "color_profile-0.png",
  "Information.png": "msg_information-0.png",
  "Important.png": "address_book_card_copy-0.png",
  "Help and Support.png": "circle_question-0.png",
  "TB Help.png": "circle_question-0.png",
  "TB Add.png": "address_book_card_users.png",
  "TB IM.png": "mailbox_world-0.png",
  "TB Settings.png": "directory_control_panel-0.png",
  "Key.png": "certificate_envelope_key-0.png",
  "Question.png": "circle_question-0.png",
  "Generic Document.png": null,
  "TB File.png": null,
  "Folder Closed.png": null,
};

export function currentTheme() {
  return document.documentElement.getAttribute("data-theme") === "win98" ? "win98" : "winxp";
}

function applyToImg(el) {
  // Native draw_xp_logon_background is unconditional: the logon screen stays
  // XP regardless of theme.
  if (el.closest && el.closest("#authView")) return;
  if (!el.dataset.icon) {
    const src = el.getAttribute("src") || "";
    const i = src.indexOf(XP_DIR);
    if (i === -1) return;
    el.dataset.icon = src.slice(i + XP_DIR.length);
  }
  const icon = el.dataset.icon;
  if (currentTheme() === "win98") {
    let target;
    if (el.dataset.w98 !== undefined) {
      target = el.dataset.w98 === "none" ? null : el.dataset.w98;
    } else if (Object.prototype.hasOwnProperty.call(W98, icon)) {
      target = W98[icon];
    } else {
      el.classList.remove("i98-hidden");
      return;
    }
    if (target === null) {
      el.classList.add("i98-hidden");
      return;
    }
    el.classList.remove("i98-hidden");
    const want = W98_DIR + target;
    if ((el.getAttribute("src") || "") !== want) el.src = want;
  } else {
    el.classList.remove("i98-hidden");
    const want = XP_DIR + icon;
    if ((el.getAttribute("src") || "") !== want) el.src = want;
  }
}

function sweep(root) {
  if (!root) return;
  if (root.nodeType === 1 && root.tagName === "IMG") applyToImg(root);
  if (root.querySelectorAll) root.querySelectorAll("img").forEach(applyToImg);
}

function updateThemeOpts() {
  const t = currentTheme();
  document.querySelectorAll(".theme-opt").forEach((b) => {
    b.classList.toggle("on", b.dataset.themeOpt === t);
  });
}

export function setTheme(name) {
  const v = name === "win98" ? "win98" : "winxp";
  document.documentElement.setAttribute("data-theme", v);
  try { localStorage.setItem(KEY, v); } catch { /* private mode */ }
  sweep(document.body);
  updateThemeOpts();
  window.dispatchEvent(new CustomEvent("msgmesh:theme", { detail: v }));
}

sweep(document.body);
new MutationObserver((muts) => {
  for (const m of muts) {
    for (const n of m.addedNodes) if (n.nodeType === 1) sweep(n);
  }
}).observe(document.body, { childList: true, subtree: true });
document.querySelectorAll(".theme-opt").forEach((b) => {
  b.addEventListener("click", () => setTheme(b.dataset.themeOpt));
});
updateThemeOpts();
