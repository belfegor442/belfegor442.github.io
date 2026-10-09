/* Classic (non-module) bootstrap: sets data-theme before first paint so the
   win98 overrides never flash XP. CSP script-src 'self' blocks inline scripts,
   hence the external file. Mirrors native ThemeManager() default (WIN98 when
   stored, otherwise the native XP Luna look shipped on the web today). */
(function () {
  try {
    var t = localStorage.getItem("msg.mesh.theme");
    document.documentElement.setAttribute("data-theme", t === "win98" ? "win98" : "winxp");
  } catch (e) {
    document.documentElement.setAttribute("data-theme", "winxp");
  }
})();
