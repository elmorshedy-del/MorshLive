/* Auto-route match watch links through the current IPTV Lab catalog.
 *
 * The match broadcaster is authoritative. Once a broadcaster is resolved, its
 * stable IPTV logical identity (EPG/provider/service id) is persisted locally so
 * later provider renames and variant changes do not require name matching again.
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
    } catch { /* storage is optional */ }
  }

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
      .finally(() => { refreshPromise = null; });
    return refreshPromise;
  }

  function resolutionKey(match) {
    return resolver()?.bindingKey({
      channelId: match?.channelId || "",
      channel: match?.channel || "",
    }) || `${match?.channelId || ""}|${match?.channel || ""}`;
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
    const key = resolutionKey(match);
    const next = {
      logicalKey: info.logicalKey,
      fingerprint: info.fingerprint || "",
      identityTier: info.identityTier || "",
      updatedAt: Date.now(),
    };
    const prev = bindings[key];
    if (
      prev?.logicalKey === next.logicalKey
      && prev?.fingerprint === next.fingerprint
      && prev?.identityTier === next.identityTier
    ) return;
    bindings[key] = next;
    saveBindings();
  }

  function resolveForMatch(match) {
    if (!state || !match || match.status === "ended") return null;
    if (!match.channel && !match.channelId) return null;

    // Upstream sometimes emits a generic beIN label. Never guess a numbered
    // channel from an ambiguous broadcaster record.
    const labelSpec = resolver().broadcastSpec("", match.channel || "");
    if (labelSpec.network === "bein" && labelSpec.number == null && !match.channelId) return null;

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

    // Bootstrap only when there is no usable stable binding. This is where names
    // may help discover the current provider's metadata once; the resulting EPG /
    // service identity is then persisted and becomes authoritative.
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
      delete anchor.dataset.iptvLogicalKey;
      delete anchor.dataset.iptvFingerprint;
      return;
    }

    const href = routedHref(anchor, match, selected);
    if (anchor.getAttribute("href") !== href) anchor.setAttribute("href", href);
    anchor.dataset.iptvAuto = "resolved";
    anchor.dataset.iptvStreamId = String(selected.streamId);
    anchor.dataset.iptvChannelName = String(selected.name || "");
    anchor.dataset.iptvLogicalKey = String(selected.resolver?.logicalKey || "");
    anchor.dataset.iptvVariantKey = String(selected.resolver?.variantKey || "");
    anchor.dataset.iptvFingerprint = String(selected.resolver?.fingerprint || "");
    anchor.dataset.iptvIdentityTier = String(selected.resolver?.identityTier || "");
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
