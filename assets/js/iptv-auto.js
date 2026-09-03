/* Auto-route match watch links through the current IPTV Lab catalog.
 *
 * The match broadcaster is authoritative. Once a broadcaster is resolved, its
 * stable IPTV logical identity (EPG/provider/service id) is persisted locally so
 * later provider renames and variant changes do not require name matching again.
 *
 * The original watch source is never overwritten. A resolved game gets a visible
 * IPTV option whose URL already contains the exact current Lab stream id.
 */
(function () {
  "use strict";

  const REFRESH_MS = 60 * 1000;
  const BINDINGS_KEY = "kz:iptv-channel-bindings:v2";
  const resolver = () => window.KZIptvChannelResolver;
  let state = null;
  let refreshPromise = null;
  let observer = null;
  let rewriteQueued = false;
  let bindings = loadBindings();

  function loadBindings() {
    try {
      const parsed = JSON.parse(localStorage.getItem(BINDINGS_KEY) || "{}");
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  function saveBindings() {
    try {
      localStorage.setItem(BINDINGS_KEY, JSON.stringify(bindings));
    } catch {
      /* storage is optional */
    }
  }

  function text(key, fallback) {
    try {
      const value = window.I18N?.t?.(key);
      return value && value !== key ? value : fallback;
    } catch {
      return fallback;
    }
  }

  function isWatchUrl(url) {
    const path = String(url.pathname || "").replace(/\/$/, "");
    return path === "/watch.html" || path.startsWith("/watch/");
  }

  function findWatchAnchors(root) {
    const scope = root && root.querySelectorAll ? root : document;
    return [...scope.querySelectorAll('a[href*="match="]')].filter((anchor) => {
      if (anchor.dataset.iptvAutoLink === "1") return false;
      try {
        return isWatchUrl(new URL(anchor.getAttribute("href"), location.href));
      } catch {
        return false;
      }
    });
  }

  async function waitForMatchesApi() {
    for (let i = 0; i < 80; i += 1) {
      if (typeof window.getMatches === "function") return true;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return false;
  }

  async function getJson(url) {
    const response = await fetch(url, { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.ok === false) throw new Error(body.error || `HTTP ${response.status}`);
    return body;
  }

  function flattenCatalog(body) {
    if (Array.isArray(body.streams)) return body.streams;
    return (body.portals || []).flatMap((block) => block.streams || []);
  }

  function makeMatchMap(matches) {
    return new Map(
      (Array.isArray(matches) ? matches : [])
        .filter((match) => match && match.id)
        .map((match) => [String(match.id), match]),
    );
  }

  async function refreshState() {
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
      if (!resolver()) return null;
      const ready = await waitForMatchesApi();
      if (!ready) return null;
      const [meta, catalog] = await Promise.all([
        window.getMatches({ force: false }),
        getJson("/api/iptv-lab/catalog"),
      ]);
      state = {
        matchMap: makeMatchMap(meta?.matches || []),
        channels: flattenCatalog(catalog),
        resolved: new Map(),
        updatedAt: Date.now(),
      };
      return state;
    })()
      .catch(() => null)
      .finally(() => {
        refreshPromise = null;
      });
    return refreshPromise;
  }

  function resolutionKey(match) {
    return (
      resolver()?.bindingKey({
        channelId: match?.channelId || "",
        channel: match?.channel || "",
      }) || `${match?.channelId || ""}|${match?.channel || ""}`
    );
  }

  function storedBinding(match) {
    return bindings[resolutionKey(match)] || null;
  }

  function forgetBinding(match) {
    const key = resolutionKey(match);
    if (!bindings[key]) return;
    delete bindings[key];
    saveBindings();
  }

  function rememberBinding(match, selected) {
    const info = selected?.resolver;
    if (!info?.persistentIdentity || !info.logicalKey) return;
    if (info.bootstrap && Number(info.score || 0) < 120) return;
    const key = resolutionKey(match);
    const next = {
      logicalKey: info.logicalKey,
      fingerprint: info.fingerprint || "",
      identityTier: info.identityTier || "",
      updatedAt: Date.now(),
    };
    const prev = bindings[key];
    if (
      prev?.logicalKey === next.logicalKey &&
      prev?.fingerprint === next.fingerprint &&
      prev?.identityTier === next.identityTier
    ) {
      return;
    }
    bindings[key] = next;
    saveBindings();
  }

  function resolveForMatch(match) {
    if (!state || !match || match.status === "ended") return null;
    if (!match.channel && !match.channelId) return null;

    // Upstream sometimes emits a generic beIN label while channelId is merely a
    // fallback. If the broadcaster record itself has no number, do not guess.
    const labelSpec = resolver().broadcastSpec("", match.channel || "");
    if (labelSpec.network === "bein" && labelSpec.number == null) return null;

    const cacheKey = resolutionKey(match);
    if (state.resolved.has(cacheKey)) return state.resolved.get(cacheKey);

    const saved = storedBinding(match);
    let selected = null;

    // Strong path: exact stable logical identity. Display name and stream id can
    // both change and this still resolves the right real channel.
    if (saved?.logicalKey) {
      selected = resolver().resolveChannel(
        {
          channelId: match.channelId || "",
          channel: match.channel || "",
          iptvLogicalKey: saved.logicalKey,
        },
        state.channels,
      );
      if (!selected || selected.resolver?.logicalKey !== saved.logicalKey) {
        forgetBinding(match);
        selected = null;
      }
    }

    // Bootstrap only when there is no usable stable binding. Names may help
    // discover the provider metadata once; the resulting EPG/service identity
    // becomes authoritative after a high-confidence match.
    if (!selected) {
      selected = resolver().resolveChannel(
        { channelId: match.channelId || "", channel: match.channel || "" },
        state.channels,
      );
      if (selected) rememberBinding(match, selected);
    }

    state.resolved.set(cacheKey, selected || null);
    return selected || null;
  }

  function routedHref(anchor, match, selected) {
    const url = new URL(anchor.getAttribute("href"), location.href);
    url.searchParams.set("match", String(match.id));
    url.searchParams.set("ch", match.channelId || "live");
    url.searchParams.set("source", "xtream");
    url.searchParams.set("portal", "lab");
    url.searchParams.set("stream", String(selected.streamId));
    url.searchParams.delete("direct");
    return `${url.pathname.replace(/^\//, "")}${url.search}${url.hash}`;
  }

  function annotate(anchor, selected) {
    anchor.dataset.iptvAuto = "resolved";
    anchor.dataset.iptvStreamId = String(selected.streamId);
    anchor.dataset.iptvChannelName = String(selected.name || "");
    anchor.dataset.iptvLogicalKey = String(selected.resolver?.logicalKey || "");
    anchor.dataset.iptvVariantKey = String(selected.resolver?.variantKey || "");
    anchor.dataset.iptvFingerprint = String(selected.resolver?.fingerprint || "");
    anchor.dataset.iptvIdentityTier = String(selected.resolver?.identityTier || "");
  }

  function clearAnnotation(anchor) {
    anchor.dataset.iptvAuto = "unresolved";
    delete anchor.dataset.iptvStreamId;
    delete anchor.dataset.iptvLogicalKey;
    delete anchor.dataset.iptvVariantKey;
    delete anchor.dataset.iptvFingerprint;
    delete anchor.dataset.iptvIdentityTier;
  }

  function clearResolvedUi(anchor) {
    clearAnnotation(anchor);
    const toggle = anchor.closest(".watch-source-toggle");
    if (!toggle) return;

    const premium = toggle.querySelector(
      '.watch-source-toggle__opt--premium, a[href*="source=iptv-premium"], a[data-iptv-auto-link="1"]',
    );

    if (toggle.classList.contains("iptv-auto-toggle")) {
      const originalSpan = anchor.querySelector(":scope > span");
      if (originalSpan) anchor.innerHTML = originalSpan.innerHTML;
      anchor.classList.remove("watch-source-toggle__opt", "watch-source-toggle__opt--original");
      delete anchor.dataset.iptvAutoWrapped;
      const parent = toggle.parentNode;
      if (parent) {
        parent.insertBefore(anchor, toggle);
        toggle.remove();
      }
      return;
    }

    if (premium) {
      premium.hidden = true;
      premium.removeAttribute("href");
      delete premium.dataset.iptvAutoLink;
      clearAnnotation(premium);
    }
  }

  function premiumLabel() {
    return text("card.watchPremium", "IPTV");
  }

  function premiumSubLabel(selected) {
    const identity = selected?.resolver?.identityTier || "auto";
    return identity === "epg" ? "EPG · Auto" : "Auto";
  }

  function ensureExistingToggle(anchor, match, selected) {
    const toggle = anchor.closest(".watch-source-toggle");
    if (!toggle) return false;

    const premium = toggle.querySelector(
      '.watch-source-toggle__opt--premium, a[href*="source=iptv-premium"], a[data-iptv-auto-link="1"]',
    );
    if (premium) {
      const nextHref = routedHref(anchor, match, selected);
      if (premium.getAttribute("href") !== nextHref) premium.setAttribute("href", nextHref);
      premium.hidden = false;
      premium.dataset.iptvAutoLink = "1";
      annotate(premium, selected);
    }
    annotate(anchor, selected);
    return true;
  }

  function addResolvedToggle(anchor, match, selected) {
    if (anchor.closest(".watch-source-toggle")) return;
    if (anchor.dataset.iptvAutoWrapped === "1") return;

    const wrapper = document.createElement("div");
    wrapper.className = "watch-source-toggle iptv-auto-toggle";
    wrapper.setAttribute("role", "group");
    wrapper.setAttribute("aria-label", text("watch.sourceTabsAria", "Watch source"));

    const kicker = document.createElement("span");
    kicker.className = "watch-source-toggle__kicker";
    kicker.textContent = text("watch.sourceToggle", "Source");

    const track = document.createElement("div");
    track.className = "watch-source-toggle__track";

    const premium = document.createElement("a");
    premium.className = "watch-source-toggle__opt watch-source-toggle__opt--premium";
    premium.href = routedHref(anchor, match, selected);
    premium.dataset.iptvAutoLink = "1";
    const premiumText = document.createElement("span");
    premiumText.textContent = premiumLabel();
    const premiumSmall = document.createElement("small");
    premiumSmall.textContent = premiumSubLabel(selected);
    premium.append(premiumText, premiumSmall);
    annotate(premium, selected);

    const originalHtml = anchor.innerHTML;
    anchor.dataset.iptvAutoWrapped = "1";
    anchor.classList.remove(
      "watch-link",
      "watch-link--soon",
      "watch-link--commentary",
      "watch-link--disabled",
    );
    anchor.classList.add("watch-source-toggle__opt", "watch-source-toggle__opt--original");
    anchor.innerHTML = "";
    const originalText = document.createElement("span");
    originalText.innerHTML = originalHtml;
    anchor.appendChild(originalText);
    annotate(anchor, selected);

    anchor.parentNode?.insertBefore(wrapper, anchor);
    wrapper.append(kicker, track);
    track.append(premium, anchor);
  }

  function rewriteAnchor(anchor) {
    if (!state || !anchor || !anchor.isConnected) return;
    let url;
    try {
      url = new URL(anchor.getAttribute("href"), location.href);
    } catch {
      return;
    }

    const matchId = url.searchParams.get("match");
    if (!matchId) return;
    const match = state.matchMap.get(String(matchId));
    if (!match) return;
    const selected = resolveForMatch(match);
    if (!selected?.streamId) {
      clearResolvedUi(anchor);
      return;
    }

    // Legacy premium cards still exist in app.js. Convert that premium href to
    // the exact Lab stream, but never touch the original source href.
    if (url.searchParams.get("source") === "iptv-premium") {
      const nextHref = routedHref(anchor, match, selected);
      if (anchor.getAttribute("href") !== nextHref) anchor.setAttribute("href", nextHref);
      anchor.hidden = false;
      anchor.dataset.iptvAutoLink = "1";
      annotate(anchor, selected);
      return;
    }

    if (url.searchParams.get("source") === "xtream" && url.searchParams.get("portal") === "lab") {
      anchor.dataset.iptvAutoLink = "1";
      annotate(anchor, selected);
      return;
    }

    if (ensureExistingToggle(anchor, match, selected)) return;
    addResolvedToggle(anchor, match, selected);
  }

  function rewriteAll(root) {
    if (!state) return;
    findWatchAnchors(root || document).forEach(rewriteAnchor);
  }

  function queueRewrite(root) {
    if (rewriteQueued) return;
    rewriteQueued = true;
    queueMicrotask(() => {
      rewriteQueued = false;
      rewriteAll(root || document);
    });
  }

  async function refreshAndRewrite() {
    const current = await refreshState();
    if (current) rewriteAll(document);
  }

  function startObserver() {
    if (observer || !document.documentElement) return;
    observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "childList" && mutation.addedNodes.length) {
          queueRewrite(document);
          return;
        }
        if (mutation.type === "attributes" && mutation.target?.tagName === "A") {
          queueRewrite(mutation.target.parentElement || document);
          return;
        }
      }
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["href"],
    });
  }

  function init() {
    startObserver();
    refreshAndRewrite();
    setInterval(() => {
      state = null;
      refreshAndRewrite();
    }, REFRESH_MS);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
