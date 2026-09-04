/* Remove the old club-specific premium/original card toggle before the
 * deterministic IPTV router runs. The historical toggle was rendered for a
 * handful of European clubs regardless of kickoff time and could point at the
 * retired `source=iptv-premium` path. All leagues now start from the same
 * single match action; iptv-auto.js promotes it to TV only when a deterministic
 * source is resolved inside the shared T-30 broadcast window.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.KZIptvLegacyToggleNormalizer = api;

  if (typeof window === "undefined" || typeof document === "undefined") return;

  function normalizeAll(scope = document) {
    const toggles = scope.querySelectorAll?.(".watch-source-toggle:not(.iptv-auto-toggle)") || [];
    for (const toggle of toggles) api.normalizeToggle(toggle, window);
  }

  let queued = false;
  const queue = () => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      normalizeAll(document);
    });
  };

  const start = () => {
    normalizeAll(document);
    if (!document.documentElement || typeof MutationObserver === "undefined") return;
    const observer = new MutationObserver((mutations) => {
      if (mutations.some((mutation) => mutation.type === "childList" && mutation.addedNodes.length)) queue();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  function isLegacyPremiumHref(href, base = "https://korazero.com/") {
    try {
      const url = new URL(String(href || ""), base);
      return url.searchParams.get("source") === "iptv-premium";
    } catch {
      return false;
    }
  }

  function labelFor(match, win) {
    const phase = win?.KZIptvWindow?.phase?.(match);
    const key = phase === "live"
      ? "card.watchNow"
      : phase === "postgame"
        ? "card.watchCommentary"
        : "card.matchCentre";
    const fallback = phase === "live" ? "شاهد الآن" : phase === "postgame" ? "مشاهدة التعليق" : "تفاصيل المباراة";
    try {
      const translated = win?.I18N?.t?.(key);
      return translated && translated !== key ? translated : fallback;
    } catch {
      return fallback;
    }
  }

  function findMatch(original, win) {
    const href = original?.getAttribute?.("href") || "";
    let id = "";
    try {
      id = new URL(href, win?.location?.href || "https://korazero.com/").searchParams.get("match") || "";
    } catch {}
    const matches = win?.KZIptvAutoState?.matches;
    if (id && matches?.get) return matches.get(String(id)) || null;
    return null;
  }

  function normalizeToggle(toggle, win) {
    if (!toggle?.querySelector || toggle.classList?.contains("iptv-auto-toggle")) return false;
    const premium = toggle.querySelector(".watch-source-toggle__opt--premium");
    const original = toggle.querySelector(".watch-source-toggle__opt--original");
    if (!premium || !original) return false;
    if (premium.dataset?.iptvAutoPrimary === "1" || premium.dataset?.iptvAuto === "resolved") return false;
    if (!isLegacyPremiumHref(premium.getAttribute("href"), win?.location?.href)) return false;

    const link = original.cloneNode(true);
    link.className = "watch-link watch-link--soon";
    link.removeAttribute("data-iptv-auto");
    link.removeAttribute("data-iptv-auto-link");
    link.removeAttribute("data-iptv-auto-primary");
    const match = findMatch(original, win);
    link.textContent = labelFor(match, win);
    if (match && win?.KZIptvWindow?.isEligible?.(match)) link.classList.remove("watch-link--soon");
    toggle.replaceWith(link);
    return true;
  }

  return { isLegacyPremiumHref, labelFor, normalizeToggle };
});
