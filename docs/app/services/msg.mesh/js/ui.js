import { state } from "./core/state.js";
import { $ } from "./shared/dom.js";
import { renderProfile, renderConnection } from "./domains/profile/self.js";
import { renderSidebar } from "./domains/contacts/sidebar.js";
import { renderMessages } from "./domains/chat/messages.js";
import { renderChatHead } from "./domains/chat/head.js";

export * from "./shared/dom.js";
export { toast } from "./shared/toast.js";
export { msgBox } from "./shared/msgbox.js";
export { emotes, emoteTokens } from "./shared/emotes.js";
export { renderProfile, renderConnection } from "./domains/profile/self.js";
export { renderRequests, renderContacts, renderSidebar } from "./domains/contacts/sidebar.js";
export { renderMessages } from "./domains/chat/messages.js";
export { renderChatHead, renderDetails } from "./domains/chat/head.js";
export { clearAttachmentImageCache } from "./domains/chat/attachments.js";

export function showAuth(tab) {
  $("#authView").classList.remove("hidden");
  $("#appView").classList.add("hidden");
  if (tab) setAuthTab(tab);
}

export function showApp() {
  $("#authView").classList.add("hidden");
  $("#appView").classList.remove("hidden");
}

export function setAuthTab(tab) {
  const isReg = tab === "register";
  const regDlg = $("#registerDialog");
  const err = $("#authError");
  if (err) { err.textContent = ""; err.classList.add("hidden"); }
  if (isReg && regDlg && !regDlg.open) {
    regDlg.showModal();
  } else if (!isReg && regDlg?.open) {
    regDlg.close();
  }
}

export function selectLogonTile(which) {
  const known = $("#tileKnown");
  const other = $("#tileOther");
  const fields = $("#logonFields");
  const rowU = $("#rowUsername");
  const isKnown = which === "login";
  known?.classList.toggle("sel", isKnown);
  other?.classList.toggle("sel", !isKnown);
  fields?.classList.add("show");
  rowU?.classList.toggle("hidden", isKnown);
  if (isKnown) {
    const err = $("#authError");
    if (err) { err.textContent = ""; err.classList.add("hidden"); }
  }
}

export function setActive(peer) {
  state.activePeer = peer;
  const open = !!peer;
  const chat = $("#chatPanel");
  const contacts = $("#contactsCol");
  const empty = $("#emptyState");
  if (empty) empty.classList.toggle("hidden", open);
  if (chat) {
    chat.classList.toggle("hidden", !open);
    chat.classList.toggle("mobile-open", open);
  }
  if (contacts) {
    const mobile = window.matchMedia("(max-width:650px)").matches;
    contacts.classList.toggle("contacts-mobile-hidden", mobile && open);
  }
  renderSidebar();
  if (open) {
    renderChatHead();
    renderMessages();
  }
}

export function renderAll() {
  renderProfile();
  renderConnection();
  renderSidebar();
  if (state.activePeer) {
    renderChatHead();
    renderMessages({ scroll: false });
  }
}
