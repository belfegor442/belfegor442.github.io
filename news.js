(() => {
  "use strict";
  const headlineNode = document.getElementById("news-headline");
  if (!headlineNode) return;

  const DEFAULT_HEADLINE = "North Assembly — independent software and systems.";
  let timer = null;
  let currentHeadline = DEFAULT_HEADLINE;

  function typeHeadline(value) {
    if (timer) window.clearTimeout(timer);
    const text = String(value || DEFAULT_HEADLINE).trim().slice(0, 180) || DEFAULT_HEADLINE;
    currentHeadline = text;
    let position = 0;
    headlineNode.textContent = "";
    const step = () => {
      headlineNode.textContent = text.slice(0, position);
      if (position < text.length) {
        position += 1;
        timer = window.setTimeout(step, 72);
      } else {
        timer = window.setTimeout(() => {
          position = 0;
          step();
        }, 4200);
      }
    };
    step();
  }

  async function loadHeadline() {
    try {
      const response = await fetch("/news.json?ts=" + Date.now(), { cache: "no-store" });
      if (!response.ok) throw new Error("News file unavailable");
      const data = await response.json();
      typeHeadline(typeof data.headline === "string" ? data.headline : DEFAULT_HEADLINE);
    } catch {
      typeHeadline(DEFAULT_HEADLINE);
    }
  }

  async function updateNews(headline) {
    const nextHeadline = String(headline || "").trim();
    if (!nextHeadline || nextHeadline.length > 180) {
      throw new Error("El titular debe contener entre 1 y 180 caracteres.");
    }
    const token = window.prompt("Introduce tu GitHub token de GitHub de la cuenta belfegor442 con permiso de escritura Contents en este repositorio.");
    if (!token) return false;

    const api = "https://api.github.com/repos/belfegor442/belfegor442.github.io/contents/news.json";
    const headers = {
      "Accept": "application/vnd.github+json",
      "Authorization": "Bearer " + token.trim(),
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json"
    };
    const identity = await fetch("https://api.github.com/user", { headers, cache: "no-store" });
    if (!identity.ok) throw new Error("No se pudo verificar la cuenta de GitHub (" + identity.status + ").");
    const account = await identity.json();
    if (String(account.login || "").toLowerCase() !== "belfegor442") {
      throw new Error("Acceso denegado: solo la cuenta belfegor442 puede publicar noticias.");
    }

    const existing = await fetch(api + "?ref=main", { headers, cache: "no-store" });
    if (!existing.ok) throw new Error("GitHub no autorizó la lectura (" + existing.status + "). Comprueba el token y sus permisos.");
    const file = await existing.json();
    const payload = JSON.stringify({ headline: nextHeadline }, null, 2) + "\n";
    const bytes = new TextEncoder().encode(payload);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    const encoded = btoa(binary);

    const saved = await fetch(api, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        message: "Update North Assembly news headline",
        content: encoded,
        sha: file.sha,
        branch: "main"
      })
    });
    if (!saved.ok) {
      const error = await saved.json().catch(() => ({}));
      throw new Error("No se pudo publicar (" + saved.status + "): " + (error.message || "GitHub API error"));
    }
    typeHeadline(nextHeadline);
    return true;
  }

  window.NorthAssembly = Object.freeze({
    updateNews,
    getNews: () => currentHeadline
  });

  loadHeadline();
})();
