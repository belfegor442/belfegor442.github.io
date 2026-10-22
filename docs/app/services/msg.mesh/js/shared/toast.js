import { $ } from "./dom.js";
import { playSound } from "../infrastructure/sound.js";

export function toast(text, isError) {
  const box = $("#toasts");
  const el = document.createElement("div");
  el.className = "toast" + (isError ? " error" : "");
  const img = document.createElement("img");
  // Native dialog icon mapping: error -> Critical.png, info -> Information.png
  img.src = isError ? "./assets/xp/icons/Critical.png" : "./assets/xp/icons/Information.png";
  img.alt = "";
  img.width = 16;
  img.height = 16;
  el.appendChild(img);
  el.appendChild(document.createTextNode(String(text ?? "")));
  box.appendChild(el);
  setTimeout(() => el.remove(), 3500);
  // Auth flows play their own logon/logoff sounds.
  if (!String(text ?? "").startsWith("Signed")) playSound(isError ? "error" : "notification");
}
