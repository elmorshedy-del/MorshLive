/* Premium-only IPTV path.
 *
 * Original watch links stay untouched. For explicitly test-enabled cards only,
 * channelId -> current IPTV Lab catalog -> streamId -> existing Xtream player.
 * No EPG fixture matching, team-name routing, localStorage binding, or scoring.
 */
(function () {
  "use strict";

  const resolver = () => window.KZIptvChannelResolver;
  let state = null;
  let refreshPromise = null;
  let observer = null;
  let rewriteQueued = false;

  function text(key, fallback) {
    try {
      const value = window.I18N?.t?.(key);
      return value && value !== key ? value : fallback;
    } catch {
      return fallback;
    }
  }

  async function getJson(url, optional = false) {
    const response = await fetch(url, { cache: "no-store" });
    if (optional && response.status === 404) return {};
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.ok === false) throw new Error(body.error || `HTTP ${response.status}`);
    return body;
  }

  async function waitForMatchesApi() {
    for (let index = 0; index < 80; index += 1) {
      if (typeof window.getMatches === "function") return true;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return false;
  }

  function flattenCatalog(body) {
    if (Array.isArray(body?.streams)) return body.streams;
    return (body?.portals || []).flatMap((block) => block.streams || []);
  }

  function makeMatchMap(matches, overrides) {
    return new Map(
      (Array.isArray(matches) ? matches : [])
        .filter((match) => match?.id)
        .map((match) => {
          const override = overrides?.[String(match.id)];
          return [String(match.id), override ? { ...match, ...override } : match];
        }),
    );
  }

  async function refreshState() {
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
      if (!resolver() || !(await waitForMatchesApi())) return null;
      const [meta, catalog, overrides] = await Promise.all([
        window.getMatches({ force: false }),
        getJson("/api/iptv-lab/catalog"),
        getJson("/assets/data/manual-channel-overrides.json", true),
      ]);
      state = {
        matches: makeMatchMap(meta?.matches || [], overrides),
        channelMap: resolver().buildChannelMap(flattenCatalog(catalog)),
      };
      return state;
    })()
      .catch(() => null)
      .finally(() => {
        refreshPromise = null;
      });
    return refreshPromise;
  }

  function isWatchUrl(url) {
    const path = String(url.pathname || "").replace(/\/$/, "");
    return path === "/watch.html" || path.startsWith("/watch/");
  }

  function originalWatchAnchors(root) {
    const scope = root?.querySelectorAll ? root : document;
    return [...scope.querySelectorAll('a[href*="match="]')].filter((anchor) => {
      if (anchor.dataset.iptvPremiumTest === "1") return false;
      try {
        const url = new URL(anchor.getAttribute("href"), location.href);
        if (!isWatchUrl(url)) return false;
        const source = url.searchParams.get("source");
        return source !== "iptv-premium" && !(source === "xtream" && url.searchParams.get("portal") === "lab");
      } catch {
        return false;
      }
    });
  }

  function premiumEnabled(match) {
    return match?.premiumTest === true && !!match?.channelId;
  }

  function selectedChannel(match) {
    if (!premiumEnabled(match) || !state) return null;
    const key = resolver().canonicalKey(match.channelId);
    return key ? state.channelMap.get(key) || null : null;
  }

  function premiumHref(originalAnchor, match, selected) {
    const url = new URL(originalAnchor.getAttribute("href"), location.href);
    url.searchParams.set("match", String(match.id));
    url.searchParams.set("ch", match.channelId);
    url.searchParams.set("source", "xtream");
    url.searchParams.set("portal", "lab");
    url.searchParams.set("stream", String(selected.streamId));
    url.searchParams.set("premium", "1");
    url.searchParams.set("premiumChannelId", match.channelId);
    url.searchParams.delete("direct");
    return `${url.pathname.replace(/^\//, "")}${url.search}${url.hash}`;
  }

  function unwrapLegacyPremium(original) {
    const toggle = original.closest(".watch-source-toggle");
    if (!toggle || toggle.classList.contains("iptv-premium-test-toggle")) return;
    const premium = toggle.querySelector(".watch-source-toggle__opt--premium");
    if (!premium) return;

    original.classList.remove("watch-source-toggle__opt", "watch-source-toggle__opt--original");
    original.classList.add("watch-link");
    const onlySpan = original.querySelector(":scope > span");
    if (onlySpan && original.children.length === 1) original.innerHTML = onlySpan.innerHTML;

    const parent = toggle.parentNode;
    if (parent) {
      parent.insertBefore(original, toggle);
      toggle.remove();
    }
  }

  function stripLegacyPremiumToggles(root) {
    const scope = root?.querySelectorAll ? root : document;
    const premiums = [
      ...scope.querySelectorAll('.watch-source-toggle__opt--premium[href*="source=iptv-premium"]'),
    ].filter((anchor) => anchor.dataset.iptvPremiumTest !== "1");

    for (const premium of premiums) {
      const toggle = premium.closest(".watch-source-toggle");
      if (!toggle || toggle.classList.contains("iptv-premium-test-toggle")) continue;

      // The watch page does not need a source toggle at all unless this new
      // premium test installed it. Removing the legacy group leaves playback
      // and the original stream untouched.
      if (toggle.closest("#player-toolbar")) {
        toggle.remove();
        continue;
      }

      const original = toggle.querySelector(".watch-source-toggle__opt--original");
      if (original) unwrapLegacyPremium(original);
      else toggle.remove();
    }
  }

  function ensurePremiumToggle(original, match, selected) {
    const existing = original.closest(".watch-source-toggle");
    if (existing) {
      const premium = existing.querySelector(".watch-source-toggle__opt--premium");
      if (premium) {
        premium.href = premiumHref(original, match, selected);
        premium.dataset.iptvPremiumTest = "1";
        premium.hidden = false;
        const small = premium.querySelector("small");
        if (small) small.textContent = match.channel || match.channelId;
        return;
      }
    }

    const wrapper = document.createElement("div");
    wrapper.className = "watch-source-toggle iptv-premium-test-toggle";
    wrapper.setAttribute("role", "group");
    wrapper.setAttribute("aria-label", text("watch.sourceTabsAria", "Watch source"));

    const kicker = document.createElement("span");
    kicker.className = "watch-source-toggle__kicker";
    kicker.textContent = text("watch.sourceToggle", "Source");

    const track = document.createElement("div");
    track.className = "watch-source-toggle__track";

    const premium = document.createElement("a");
    premium.className = "watch-source-toggle__opt watch-source-toggle__opt--premium";
    premium.href = premiumHref(original, match, selected);
    premium.dataset.iptvPremiumTest = "1";
    premium.innerHTML =
      `<span>${text("card.watchPremium", "IPTV")}</span><small>${match.channel || match.channelId}</small>`;

    const originalHtml = original.innerHTML;
    original.classList.remove("watch-link", "watch-link--soon", "watch-link--commentary", "watch-link--disabled");
    original.classList.add("watch-source-toggle__opt", "watch-source-toggle__opt--original");
    original.innerHTML = `<span>${originalHtml}</span>`;

    original.parentNode?.insertBefore(wrapper, original);
    wrapper.append(kicker, track);
    track.append(premium, original);
  }

  function rewriteCardAnchor(original) {
    if (!state || !original?.isConnected) return;
    let url;
    try {
      url = new URL(original.getAttribute("href"), location.href);
    } catch {
      return;
    }
    const match = state.matches.get(String(url.searchParams.get("match") || ""));
    if (!match) return;

    if (!premiumEnabled(match)) {
      unwrapLegacyPremium(original);
      return;
    }

    const selected = selectedChannel(match);
    if (!selected?.streamId) {
      unwrapLegacyPremium(original);
      return;
    }
    ensurePremiumToggle(original, match, selected);
  }

  function installWatchPageToggle() {
    const params = new URLSearchParams(location.search);
    if (params.get("premium") !== "1") return;
    const host = document.getElementById("player-toolbar");
    if (!host || host.querySelector(".iptv-premium-test-toggle")) return;

    const originalUrl = new URL(location.href);
    ["source", "portal", "stream", "direct", "premium", "premiumChannelId"].forEach((key) => {
      originalUrl.searchParams.delete(key);
    });

    const wrapper = document.createElement("div");
    wrapper.className = "watch-source-toggle iptv-premium-test-toggle";
    wrapper.setAttribute("role", "group");
    wrapper.setAttribute("aria-label", text("watch.sourceTabsAria", "Watch source"));
    wrapper.innerHTML = `
      <span class="watch-source-toggle__kicker">${text("watch.sourceToggle", "Source")}</span>
      <div class="watch-source-toggle__track">
        <a class="watch-source-toggle__opt watch-source-toggle__opt--premium is-active"
           aria-selected="true" href="${location.pathname}${location.search}">
          <span>${text("card.watchPremium", "IPTV")}</span>
          <small>${params.get("premiumChannelId") || "IPTV Lab"}</small>
        </a>
        <a class="watch-source-toggle__opt watch-source-toggle__opt--original"
           aria-selected="false" href="${originalUrl.pathname}${originalUrl.search}">
          <span>${text("card.watchOriginal", "Original stream")}</span>
        </a>
      </div>`;
    host.appendChild(wrapper);
  }

  function rewriteAll(root) {
    stripLegacyPremiumToggles(root || document);
    if (state) originalWatchAnchors(root || document).forEach(rewriteCardAnchor);
    installWatchPageToggle();
  }

  function queueRewrite() {
    if (rewriteQueued) return;
    rewriteQueued = true;
    queueMicrotask(() => {
      rewriteQueued = false;
      rewriteAll(document);
    });
  }

  function startObserver() {
    if (observer || !document.documentElement) return;
    observer = new MutationObserver((mutations) => {
      if (mutations.some((mutation) => mutation.type === "childList" && mutation.addedNodes.length)) queueRewrite();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  async function init() {
    startObserver();
    stripLegacyPremiumToggles(document);
    if (await refreshState()) rewriteAll(document);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
