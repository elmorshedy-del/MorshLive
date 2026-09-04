/* Make match-card bodies open their existing watch link.
 *
 * Normal cards follow the existing original watch action. If the premium IPTV
 * test toggle is present, the card body prefers that premium link. Ended cards
 * that intentionally render only the disabled "ended" label fall back to the
 * exact match id already present on the card's favorite control. Nested links,
 * buttons, favorites, source toggles and detail panels keep their own behavior.
 */
(function () {
  "use strict";

  const CARD_CLICK_BUILD = "20260904cardclick3";
  const CARD_SELECTOR = ".match-card";
  const PREMIUM_LINK_SELECTOR =
    '.iptv-premium-test-toggle .watch-source-toggle__opt--premium[data-iptv-premium-test="1"]';
  const ORIGINAL_LINK_SELECTOR = [
    'a.watch-link[href*="match="]',
    '.watch-source-toggle__opt--original[href*="match="]',
  ].join(",");
  const INTERACTIVE_SELECTOR = [
    "a",
    "button",
    "input",
    "select",
    "textarea",
    "summary",
    "details",
    '[role="button"]',
    '[role="link"]',
    '[contenteditable="true"]',
    ".match-panel",
  ].join(",");

  window.__KZ_MATCH_CARD_CLICK_BUILD = CARD_CLICK_BUILD;

  function visibleLink(link) {
    return link && !link.hidden ? link : null;
  }

  function premiumLink(card) {
    return visibleLink(card?.querySelector?.(PREMIUM_LINK_SELECTOR));
  }

  function originalLink(card) {
    return visibleLink(card?.querySelector?.(ORIGINAL_LINK_SELECTOR));
  }

  function fallbackHref(card) {
    const id = card?.querySelector?.("[data-fav-id]")?.dataset?.favId;
    if (!id) return "";
    const url = new URL("watch.html", location.href);
    url.searchParams.set("ch", "live");
    url.searchParams.set("match", id);
    return url.href;
  }

  function preferredHref(card) {
    return premiumLink(card)?.href || originalLink(card)?.href || fallbackHref(card);
  }

  function isModifiedPrimaryClick(event) {
    return event.button > 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
  }

  function shouldIgnoreTarget(target, card) {
    if (!target?.closest) return true;
    const interactive = target.closest(INTERACTIVE_SELECTOR);
    return Boolean(interactive && card.contains(interactive));
  }

  function handleCardClick(event) {
    if (isModifiedPrimaryClick(event)) return;
    const card = event.currentTarget;
    const target = event.target;
    if (!(card instanceof Element) || card.dataset.matchCardClickable !== "1") return;
    if (shouldIgnoreTarget(target, card)) return;

    const href = preferredHref(card);
    if (!href) return;
    window.location.assign(href);
  }

  function bindCard(card) {
    if (card.dataset.matchCardClickBound === CARD_CLICK_BUILD) return;
    card.addEventListener("click", handleCardClick, true);
    card.dataset.matchCardClickBound = CARD_CLICK_BUILD;
  }

  function markCards(root) {
    const scope = root?.querySelectorAll ? root : document;
    for (const card of scope.querySelectorAll(CARD_SELECTOR)) {
      const href = preferredHref(card);
      if (!href) {
        card.classList.remove("match-card-clickable", "iptv-premium-card-clickable");
        delete card.dataset.matchCardClickable;
        delete card.dataset.iptvPremiumCard;
        continue;
      }
      bindCard(card);
      card.classList.add("match-card-clickable");
      card.dataset.matchCardClickable = "1";
      if (premiumLink(card)) {
        card.classList.add("iptv-premium-card-clickable");
        card.dataset.iptvPremiumCard = "1";
      } else {
        card.classList.remove("iptv-premium-card-clickable");
        delete card.dataset.iptvPremiumCard;
      }
    }
  }

  function installCursorStyle() {
    if (document.getElementById("match-card-click-style")) return;
    const style = document.createElement("style");
    style.id = "match-card-click-style";
    style.textContent = ".match-card.match-card-clickable{cursor:pointer}";
    document.head?.appendChild(style);
  }

  function init() {
    installCursorStyle();
    markCards(document);

    const observer = new MutationObserver((mutations) => {
      if (mutations.some((mutation) => mutation.type === "childList" && mutation.addedNodes.length)) {
        markCards(document);
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
