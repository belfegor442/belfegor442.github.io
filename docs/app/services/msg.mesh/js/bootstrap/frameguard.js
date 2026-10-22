/* Clickjacking guard: GitHub Pages cannot send X-Frame-Options or a
   frame-ancestors CSP directive, so break out of any embedding frame. */
try {
  if (window.top !== window.self) window.top.location.replace(window.self.location.href);
} catch (e) {
  /* cross-origin frame — cannot navigate it, but same-origin frames are busted */
}
