import { emoteFile } from "./emoticons.js";

/* Classic typed emoticon codes -> unicode, on RAW text before esc() so
   "<3" still reaches the converter (esc would make it "&lt;3"). Longer
   codes must come first so the alternation prefers them. */
const EMOTE_PAIRS = [
  ["</3", "💔"], [":'(", "😢"], ["^_^", "😊"], [":-)", "😀"], [":-(", "😞"], [";-)", "😉"],
  ["<3", "❤️"], [":)", "😀"], [":(", "😞"], [":D", "😄"], [";)", "😉"], [":P", "😛"],
  [":p", "😛"], [":O", "😮"], [":o", "😮"], [":|", "😐"], [":*", "😘"],
  [":S", "😕"], [":s", "😕"], ["XD", "😂"], ["xd", "😂"], ["B)", "😎"],
];
const EMOTE_LOOKUP = new Map(EMOTE_PAIRS);
const EMOTE_RE = new RegExp(
  EMOTE_PAIRS.map(([code]) => code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"),
  "g"
);
export function emotes(t) {
  return String(t).replace(EMOTE_RE, (m) => EMOTE_LOOKUP.get(m) || m);
}

/* Native emoticon tokens (:eNNN:) -> inline <img>. Runs AFTER esc() so the
   injected markup survives (tokens contain no escapable characters, so they
   pass through esc untouched). Unknown ids stay as literal text. */
export function emoteTokens(html) {
  return html.replace(/:e(\d{3}):/g, (m, id) => {
    const file = emoteFile(id);
    if (!file) return m;
    return `<img class="emote" src="./assets/xp/emoticons/${file}" alt="${m}" title="${m}">`;
  });
}
