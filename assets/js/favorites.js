/* ============================================================================
 * favorites.js — two kinds of "bookmark":
 *   1) Save the SITE to the browser/TV favorites (best-effort). Modern browsers
 *      block programmatic bookmarking, so we try the legacy APIs and otherwise
 *      show a short hint (Ctrl/⌘+D on desktop, the menu key on a TV remote).
 *   2) Save individual MATCHES to an in-app list kept in localStorage, rendered
 *      on the home page. This always works, everywhere.
 *
 * Exposes window.KZFav. app.js reads it to draw the ☆ buttons + saved section.
 * ==========================================================================*/
(function (global) {
  "use strict";

  const t = (k, v) => (global.I18N ? global.I18N.t(k, v) : k);
  const KEY = "kz-favorites";
  const subs = [];

  function read() {
    try { return JSON.parse(localStorage.getItem(KEY) || "[]") || []; }
    catch (e) { return []; }
  }
  function write(list) {
    try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (e) { /* private mode */ }
    subs.forEach((cb) => { try { cb(list); } catch (e) { /* noop */ } });
  }

  function list() { return read(); }
  function has(id) { return read().some((m) => m.id === id); }

  // Keep only the fields needed to render a saved card + its watch link.
  function slim(m) {
    return {
      id: m.id, home: m.home, away: m.away,
      homeBadge: m.homeBadge, awayBadge: m.awayBadge,
      homeAbbr: m.homeAbbr, awayAbbr: m.awayAbbr,
      league: m.league, channelId: m.channelId, channel: m.channel,
      savedAt: Date.now(),
    };
  }

  function save(m) {
    if (!m || !m.id || has(m.id)) return;
    write(read().concat(slim(m)));
  }
  function remove(id) { write(read().filter((m) => m.id !== id)); }
  function toggle(m) {
    if (!m || !m.id) return false;
    if (has(m.id)) { remove(m.id); return false; }
    save(m); return true;
  }
  function subscribe(cb) { if (typeof cb === "function") subs.push(cb); }

  /* ----------------------------------------- Save the SITE to favorites */
  const isMac = /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || "");
  const isTv = !!(global.KZTv && global.KZTv.isTv) ||
    document.documentElement.classList.contains("tv-mode");

  function bookmarkHint() {
    if (isTv) return t("bookmark.hintTv");
    return isMac ? t("bookmark.hintMac") : t("bookmark.hintWin");
  }

  // Try the legacy native APIs; fall back to a toast with the manual shortcut.
  function bookmarkSite() {
    const url = location.href;
    const title = document.title;
    try {
      if (global.external && typeof global.external.AddFavorite === "function") {
        global.external.AddFavorite(url, title); return { ok: true };
      }
    } catch (e) { /* IE only */ }
    try {
      if (global.sidebar && typeof global.sidebar.addPanel === "function") {
        global.sidebar.addPanel(title, url, ""); return { ok: true };
      }
    } catch (e) { /* old Firefox */ }
    toast(bookmarkHint());
    return { ok: false, hint: bookmarkHint() };
  }

  let toastTimer = null;
  function toast(msg) {
    let el = document.getElementById("kz-toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "kz-toast";
      el.className = "kz-toast";
      el.setAttribute("role", "status");
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 4200);
  }

  function wireBookmarkButtons() {
    document.querySelectorAll(".js-bookmark-site").forEach((btn) => {
      if (btn.__kzWired) return;
      btn.__kzWired = true;
      btn.addEventListener("click", (e) => { e.preventDefault(); bookmarkSite(); });
    });
  }

  document.addEventListener("DOMContentLoaded", wireBookmarkButtons);

  global.KZFav = {
    list, has, save, remove, toggle, subscribe,
    bookmarkSite, bookmarkHint, wireBookmarkButtons, toast,
  };
})(window);

/* Homepage hero: add Messi as a third slide without changing the hero's height. */
(function () {
  "use strict";

  function initThreeSlideHero() {
    const track = document.querySelector(".home-showdown-track");
    if (!track || track.dataset.kzThreeSlides === "1") return;

    if (!track.querySelector('img[src*="korazero-messi"]')) {
      const messi = document.createElement("img");
      messi.src = "assets/img/korazero-messi.avif?v=20260905messi";
      messi.width = 1376;
      messi.height = 768;
      messi.alt = "KoraZero — جميع مباريات إنتر ميامي، تابعوا ميسي طوال الموسم";
      messi.decoding = "async";
      track.appendChild(messi);
    }

    const style = document.createElement("style");
    style.id = "kz-three-slide-hero-style";
    style.textContent = `
      .home-showdown-track {
        width: 300% !important;
        animation: kz-home-showdown-slide-3 15s ease-in-out infinite !important;
      }
      .home-showdown-track img {
        flex: 0 0 33.333333% !important;
        width: 33.333333% !important;
        height: auto !important;
        margin: 0 !important;
        padding: 0 !important;
      }
      @keyframes kz-home-showdown-slide-3 {
        0%, 26% { transform: translateX(0); }
        33%, 59% { transform: translateX(-33.333333%); }
        66%, 92% { transform: translateX(-66.666667%); }
        100% { transform: translateX(0); }
      }
      @media (prefers-reduced-motion: reduce) {
        .home-showdown-track { animation: none !important; }
      }
    `;
    document.getElementById(style.id)?.remove();
    document.head.appendChild(style);
    track.dataset.kzThreeSlides = "1";
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initThreeSlideHero, { once: true });
  } else {
    initThreeSlideHero();
  }
})();
