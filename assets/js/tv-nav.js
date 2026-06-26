/* ============================================================================
 * tv-nav.js — Smart-TV support: large-screen scaling + D-pad/remote navigation.
 *
 * Two parts:
 *   1) TV detection → adds `tv-mode` on <html> so the CSS can scale up the UI
 *      for 720p/1080p/4K TV browsers. Forceable with ?tv=1 (persisted) and
 *      disable with ?tv=0.
 *   2) Spatial focus navigation for a TV remote / keyboard: Arrow keys move
 *      focus to the nearest control in that direction, Enter/OK activates it,
 *      and Back/Escape steps out. Only active in tv-mode so desktop scrolling
 *      and normal tabbing are untouched.
 * ==========================================================================*/
(function () {
  "use strict";

  const root = document.documentElement;

  /* ----------------------------------------------------- TV detection */
  const TV_UA = /\b(SmartTV|Smart-TV|GoogleTV|AppleTV|Tizen|Web0S|WebOS|NetCast|HbbTV|BRAVIA|CrKey|AFTS|AFTB|AFTM|VIDAA|HiTV|DTV)\b/i;

  function detectTv() {
    try {
      const q = new URLSearchParams(location.search);
      if (q.get("tv") === "1") { localStorage.setItem("kz-tv", "1"); return true; }
      if (q.get("tv") === "0") { localStorage.removeItem("kz-tv"); return false; }
      if (localStorage.getItem("kz-tv") === "1") return true;
    } catch (e) { /* localStorage may be unavailable */ }
    if (TV_UA.test(navigator.userAgent || "")) return true;
    // Big screen + no fine pointer (typical of a TV browser).
    const coarse = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
    const noHover = window.matchMedia && window.matchMedia("(hover: none)").matches;
    if ((window.innerWidth >= 1920 || screen.width >= 1920) && (coarse || noHover)) return true;
    return false;
  }

  const isTv = detectTv();
  if (isTv) root.classList.add("tv-mode");

  function setTvMode(on) {
    try {
      if (on) localStorage.setItem("kz-tv", "1");
      else localStorage.removeItem("kz-tv");
    } catch (e) { /* private mode */ }
    root.classList.toggle("tv-mode", on);
    syncTvToggles();
    if (on) {
      const first = focusables()[0];
      if (first) setTimeout(() => focusEl(first), 200);
    }
    return on;
  }

  function toggleTvMode() {
    return setTvMode(!root.classList.contains("tv-mode"));
  }

  function syncTvToggles() {
    const on = root.classList.contains("tv-mode");
    const t = (k) => (window.I18N ? window.I18N.t(k) : k);
    document.querySelectorAll(".js-tv-toggle").forEach((btn) => {
      btn.classList.toggle("is-on", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
      const label = btn.querySelector("[data-tv-label]");
      if (label) label.textContent = on ? t("tv.toggleOn") : t("tv.toggle");
      const cta = btn.querySelector("[data-tv-cta]");
      if (cta) cta.textContent = on ? t("tv.ctaOn") : t("tv.ctaEnable");
      btn.setAttribute("aria-label", on ? t("tv.toggleAriaOff") : t("tv.toggleAria"));
    });
    document.querySelectorAll(".js-tv-status-text").forEach((el) => {
      el.textContent = on ? t("tv.statusOn") : t("tv.statusOff");
    });
    document.querySelectorAll(".js-tv-status-dot").forEach((el) => {
      el.classList.toggle("is-on", on);
    });
    document.querySelectorAll(".tv-spotlight").forEach((el) => {
      el.classList.toggle("tv-spotlight--active", on);
    });
  }

  function wireTvToggles() {
    document.querySelectorAll(".js-tv-toggle").forEach((btn) => {
      if (btn.__kzWired) return;
      btn.__kzWired = true;
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        toggleTvMode();
      });
    });
    syncTvToggles();
  }

  document.addEventListener("DOMContentLoaded", wireTvToggles);

  /* ----------------------------------------------- Focusable collection */
  const FOCUSABLE = [
    "a[href]", "button:not([disabled])", "input:not([disabled])",
    "select:not([disabled])", "[tabindex]:not([tabindex='-1'])",
    "video[controls]", "iframe",
  ].join(",");

  function visible(el) {
    if (!el || el.hidden) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const style = getComputedStyle(el);
    if (style.visibility === "hidden" || style.display === "none" || style.opacity === "0") return false;
    // NOTE: we deliberately do NOT require the element to be in the viewport —
    // arrowing to an off-screen control (then scrolling it into view) is the
    // whole point of remote navigation.
    return true;
  }

  function focusables() {
    return Array.prototype.filter.call(document.querySelectorAll(FOCUSABLE), visible);
  }

  function center(rect) {
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  /* ------------------------------------------- Pick nearest in a direction */
  // Score candidates by primary-axis travel plus a penalty for cross-axis drift,
  // so "down" prefers the element most directly below the current one.
  function bestInDirection(from, dir) {
    const cur = from.getBoundingClientRect();
    const c = center(cur);
    let best = null;
    let bestScore = Infinity;

    focusables().forEach((el) => {
      if (el === from) return;
      const r = el.getBoundingClientRect();
      const t = center(r);
      const dx = t.x - c.x;
      const dy = t.y - c.y;

      let primary, cross;
      if (dir === "left")      { if (dx >= -4) return; primary = -dx; cross = Math.abs(dy); }
      else if (dir === "right"){ if (dx <= 4)  return; primary = dx;  cross = Math.abs(dy); }
      else if (dir === "up")   { if (dy >= -4) return; primary = -dy; cross = Math.abs(dx); }
      else /* down */          { if (dy <= 4)  return; primary = dy;  cross = Math.abs(dx); }

      const score = primary + cross * 2;
      if (score < bestScore) { bestScore = score; best = el; }
    });
    return best;
  }

  function focusEl(el) {
    if (!el) return;
    try { el.focus({ preventScroll: false }); } catch (e) { el.focus(); }
    if (el.scrollIntoView) {
      try { el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" }); } catch (e) { /* old TV */ }
    }
  }

  /* Leanback lists — up/down (or left/right in a row) move focus predictably. */
  const LIST_ITEM = ".tv-row[href], .tv-lb-tab, .side-match, .server-btn, .player-switch-btn";

  function listContainer(el) {
    return el && el.closest(".tv-focus-list, .tv-lb-list, .tv-lb-filters, .server-row, #side-channels, .player-switch");
  }

  function listItems(container) {
    if (!container) return [];
    return Array.prototype.filter.call(container.querySelectorAll(LIST_ITEM), visible);
  }

  function listSibling(from, dir) {
    const container = listContainer(from);
    if (!container) return null;
    const items = listItems(container);
    const idx = items.indexOf(from);
    if (idx < 0) return null;
    const horizontal = container.classList.contains("tv-lb-filters")
      || container.classList.contains("server-row")
      || container.classList.contains("player-switch");
    let next = null;
    if (horizontal) {
      if (dir === "left") next = items[idx - 1];
      else if (dir === "right") next = items[idx + 1];
    } else {
      if (dir === "up") next = items[idx - 1];
      else if (dir === "down") next = items[idx + 1];
    }
    return next || null;
  }

  function wireListNav() { /* no-op — list nav is handled in onKey */ }

  const DIRS = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" };
  // TV remotes report arrows via standard keys, but some send keyCodes 37–40.
  const CODE_DIRS = { 37: "left", 38: "up", 39: "right", 40: "down" };

  function onKey(e) {
    if (!root.classList.contains("tv-mode")) return;
    const dir = DIRS[e.key] || CODE_DIRS[e.keyCode];

    // Back / Escape — step focus out to the header so the user is never stuck.
    if (e.key === "Escape" || e.key === "GoBack" || e.key === "BrowserBack" || e.keyCode === 10009 /* Tizen back */) {
      const header = document.querySelector(".site-header a, .nav-links a");
      if (header) { focusEl(header); e.preventDefault(); }
      return;
    }

    if (dir) {
      const active = document.activeElement;
      const start = active && active !== document.body && visible(active) ? active : focusables()[0];
      if (!start) return;
      if (!active || active === document.body) { focusEl(start); e.preventDefault(); return; }
      /* Leanback: list-style navigation inside match rows / server buttons. */
      if (root.classList.contains("tv-leanback") && listContainer(start)) {
        const listed = listSibling(start, dir);
        if (listed) { focusEl(listed); e.preventDefault(); return; }
      }
      const next = bestInDirection(start, dir);
      if (next) { focusEl(next); e.preventDefault(); }
      return;
    }

    // Enter / OK on a non-native control → trigger a click.
    if ((e.key === "Enter" || e.keyCode === 13) && document.activeElement) {
      const el = document.activeElement;
      if (el.tagName === "A" || el.tagName === "BUTTON" || el.tagName === "INPUT") return; // native
      el.click();
      e.preventDefault();
    }
  }

  document.addEventListener("keydown", onKey, true);

  // On first interaction in tv-mode, make sure something is focused.
  if (isTv) {
    window.addEventListener("DOMContentLoaded", () => {
      const first = focusables()[0];
      if (first) setTimeout(() => focusEl(first), 300);
    });
  }

  window.KZTv = {
    isTv, refreshFocusables: focusables, setTvMode, toggleTvMode,
    wireTvToggles, syncTvToggles, wireListNav, focusEl,
  };
})();
