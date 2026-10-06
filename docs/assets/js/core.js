/* North Assembly — shared frontend runtime */
(() => {
  'use strict';

  const root = document.documentElement;
  const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

  root.dataset.motion = prefersReducedMotion ? 'reduced' : 'full';

  // Mark external links without changing authored markup.
  document.querySelectorAll('a[href^="http"]:not([data-external-marked])').forEach((link) => {
    try {
      if (new URL(link.href, location.href).origin !== location.origin) {
        link.dataset.externalMarked = 'true';
        link.setAttribute('rel', 'noopener noreferrer');
        link.setAttribute('target', '_blank');
      }
    } catch (_) {
      // Ignore malformed links; the browser handles navigation normally.
    }
  });

  // Add a consistent active state to same-origin navigation links.
  const currentPath = location.pathname.replace(/\/+$/, '') || '/';
  document.querySelectorAll('a[href]').forEach((link) => {
    try {
      const url = new URL(link.href, location.href);
      const path = url.pathname.replace(/\/+$/, '') || '/';
      if (url.origin === location.origin && path === currentPath) {
        link.setAttribute('aria-current', 'page');
        link.classList.add('is-active');
      }
    } catch (_) {
      // Ignore invalid href values.
    }
  });

  // Lightweight reveal behavior; never hides content when motion is reduced.
  if (!prefersReducedMotion && 'IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries, instance) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.dataset.revealed = 'true';
        instance.unobserve(entry.target);
      });
    }, { threshold: 0.08 });

    document.querySelectorAll('[data-reveal]').forEach((element) => observer.observe(element));
  } else {
    document.querySelectorAll('[data-reveal]').forEach((element) => {
      element.dataset.revealed = 'true';
    });
  }

  // Keyboard escape closes any authored dismissible element.
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    document.querySelectorAll('[data-dismiss-on-escape]').forEach((element) => {
      element.hidden = true;
    });
  });
})();
