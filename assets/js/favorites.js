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
    if (isTv) return "للحفظ: افتح قائمة المتصفح بالريموت واختر «إضافة إلى المفضلة».";
    return isMac ? "اضغط ⌘ + D لإضافة الموقع إلى المفضلة." : "اضغط Ctrl + D لإضافة الموقع إلى المفضلة.";
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
