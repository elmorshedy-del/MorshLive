/* Make match-card bodies open their existing watch link.
 *
 * Normal cards follow the existing original watch action. If the premium IPTV
 * test toggle is present, the card body prefers that premium link. Nested
 * anchors, buttons, favorites, source toggles and detail panels keep their own
 * behavior and are never hijacked by the card-level click handler.
 */
(function () {
  "use strict";

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

  function visibleLink(link) {
    return link && !link.hidden ? link : null;
  }

  function premiumLink(card) {
    return visibleLink(card?.querySelector?.(PREMIUM_LINK_SELECTOR));
  }

  function originalLink(card) {
    return visibleLink(card?.querySelector?.(ORIGINAL_LINK_SELECTOR));
  }

  function preferredLink(card) {
    return premiumLink(card) || originalLink(card);
  }

  function isModifiedPrimaryClick(event) {
    return event.button > 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
  }

  function shouldIgnoreTarget(target, card) {
    if (!target?.closest) return true;
    const interactive = target.closest(INTERACTIVE_SELECTOR);
    return Boolean(interactive && card.contains(interactive));
  }

  function markCards(root) {
    const scope = root?.querySelectorAll ? root : document;
    for (const card of scope.querySelectorAll(CARD_SELECTOR)) {
      const link = preferredLink(card);
      if (!link?.href) {
        card.classList.remove("match-card-clickable", "iptv-premium-card-clickable");
        delete card.dataset.matchCardClickable;
        delete card.dataset.iptvPremiumCard;
        continue;
      }
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

  function handleCardClick(event) {
    if (isModifiedPrimaryClick(event)) return;
    const target = event.target;
    const card = target?.closest?.(`${CARD_SELECTOR}[data-match-card-clickable="1"]`);
    if (!card || shouldIgnoreTarget(target, card)) return;

    const link = preferredLink(card);
    if (!link?.href) return;
    window.location.assign(link.href);
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
    document.addEventListener("click", handleCardClick);

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
