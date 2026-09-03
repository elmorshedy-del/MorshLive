/* Auto-route match watch links through the current IPTV Lab catalog.
 * The broadcaster on the match is authoritative; provider names/ids are discovered
 * at runtime and resolved deterministically by KZIptvChannelResolver.
 */
(function () {
  "use strict";

  const REFRESH_MS = 60 * 1000;
  const resolver = () => window.KZIptvChannelResolver;
  let state = null;
  let refreshPromise = null;
  let observer = null;
  let rewriteQueued = false;

  function isWatchUrl(url) {
    const path = String(url.pathname || "").replace(/\/$/, "");
    return path === "/watch.html" || path.startsWith("/watch/");
  }

  function findWatchAnchors(root) {
    const scope = root && root.querySelectorAll ? root : document;
    return [...scope.querySelectorAll('a[href*="match="]')].filter((anchor) => {
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
    return new Map((Array.isArray(matches) ? matches : []).filter((m) => m && m.id).map((m) => [String(m.id), m]));
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
      .finally(() => { refreshPromise = null; });
    return refreshPromise;
  }

  function resolutionKey(match) {
    return `${match?.channelId || ""}|${match?.channel || ""}`;
  }

  function resolveForMatch(match) {
    if (!state || !match || match.status === "ended") return null;
    if (!match.channel && !match.channelId) return null;

    // Upstream may use beIN Sports 1 as a generic fallback when a broadcaster
    // name has no number. Never auto-route that ambiguous case.
    const labelSpec = resolver().broadcastSpec("", match.channel || "");
    if (labelSpec.network === "bein" && labelSpec.number == null) return null;

    const key = resolutionKey(match);
    if (state.resolved.has(key)) return state.resolved.get(key);
    const selected = resolver().resolveChannel(
      { channelId: match.channelId || "", channel: match.channel || "" },
      state.channels,
    );
    state.resolved.set(key, selected || null);
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
      anchor.dataset.iptvAuto = "unresolved";
      delete anchor.dataset.iptvStreamId;
      return;
    }

    const href = routedHref(anchor, match, selected);
    if (anchor.getAttribute("href") !== href) anchor.setAttribute("href", href);
    anchor.dataset.iptvAuto = "resolved";
    anchor.dataset.iptvStreamId = String(selected.streamId);
    anchor.dataset.iptvChannelName = String(selected.name || "");
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
