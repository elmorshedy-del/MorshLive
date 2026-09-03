/* Auto-route match watch links through the current IPTV Lab catalog.
 * The match card broadcaster (channel/channelId) is authoritative.
 * No fixture/EPG inference is used here: broadcaster -> IPTV channel -> stream.
 */
(function () {
  "use strict";

  const REFRESH_MS = 60 * 1000;
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

  function isWatchUrl(url) {
    const path = String(url.pathname || "").replace(/\/$/, "");
    return path === "/watch.html" || path.startsWith("/watch/");
  }

  function findWatchAnchors(root) {
    const scope = root && root.querySelectorAll ? root : document;
    return [...scope.querySelectorAll('a[href*="match="]')].filter((anchor) => {
      if (anchor.dataset.iptvAutoLink === "1") return false;
      try { return isWatchUrl(new URL(anchor.getAttribute("href"), location.href)); }
      catch { return false; }
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
    return new Map((Array.isArray(matches) ? matches : []).filter((m) => m?.id).map((m) => [String(m.id), m]));
  }

  async function refreshState() {
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
      if (!resolver() || !(await waitForMatchesApi())) return null;
      const [meta, catalog] = await Promise.all([
        window.getMatches({ force: false }),
        getJson("/api/iptv-lab/catalog"),
      ]);
      state = {
        matchMap: makeMatchMap(meta?.matches || []),
        channels: flattenCatalog(catalog),
        resolved: new Map(),
      };
      return state;
    })().catch(() => null).finally(() => { refreshPromise = null; });
    return refreshPromise;
  }

  function resolutionKey(match) {
    return resolver()?.bindingKey({ channelId: match?.channelId || "", channel: match?.channel || "" })
      || `${match?.channelId || ""}|${match?.channel || ""}`;
  }

  function resolveForMatch(match) {
    if (!state || !match || (!match.channel && !match.channelId)) return null;
    const key = resolutionKey(match);
    if (state.resolved.has(key)) return state.resolved.get(key);

    // The card's broadcaster is the source of truth. Resolve that exact
    // broadcaster against the current provider catalog. This intentionally
    // works for live, upcoming and recently-ended matches alike.
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

  function annotate(anchor, selected) {
    anchor.dataset.iptvAuto = "resolved";
    anchor.dataset.iptvStreamId = String(selected.streamId);
    anchor.dataset.iptvChannelName = String(selected.name || "");
  }

  function clearResolvedUi(anchor) {
    anchor.dataset.iptvAuto = "unresolved";
    delete anchor.dataset.iptvStreamId;
    delete anchor.dataset.iptvChannelName;
    const toggle = anchor.closest(".watch-source-toggle");
    if (!toggle) return;
    const premium = toggle.querySelector('.watch-source-toggle__opt--premium, a[href*="source=iptv-premium"], a[data-iptv-auto-link="1"]');
    if (toggle.classList.contains("iptv-auto-toggle")) {
      const originalSpan = anchor.querySelector(":scope > span");
      if (originalSpan) anchor.innerHTML = originalSpan.innerHTML;
      anchor.classList.remove("watch-source-toggle__opt", "watch-source-toggle__opt--original");
      delete anchor.dataset.iptvAutoWrapped;
      const parent = toggle.parentNode;
      if (parent) { parent.insertBefore(anchor, toggle); toggle.remove(); }
    } else if (premium) {
      premium.hidden = true;
      premium.removeAttribute("href");
      delete premium.dataset.iptvAutoLink;
    }
  }

  function ensureExistingToggle(anchor, match, selected) {
    const toggle = anchor.closest(".watch-source-toggle");
    if (!toggle) return false;
    const premium = toggle.querySelector('.watch-source-toggle__opt--premium, a[href*="source=iptv-premium"], a[data-iptv-auto-link="1"]');
    if (premium) {
      premium.href = routedHref(anchor, match, selected);
      premium.hidden = false;
      premium.dataset.iptvAutoLink = "1";
      annotate(premium, selected);
    }
    annotate(anchor, selected);
    return true;
  }

  function addResolvedToggle(anchor, match, selected) {
    if (anchor.closest(".watch-source-toggle") || anchor.dataset.iptvAutoWrapped === "1") return;
    const wrapper = document.createElement("div");
    wrapper.className = "watch-source-toggle iptv-auto-toggle";
    wrapper.setAttribute("role", "group");
    wrapper.setAttribute("aria-label", text("watch.sourceTabsAria", "Watch source"));
    const kicker = document.createElement("span");
    kicker.className = "watch-source-toggle__kicker";
    kicker.textContent = text("watch.sourceToggle", "Source");
    const track = document.createElement("div");
    track.className = "watch-source-toggle__track";
    const iptv = document.createElement("a");
    iptv.className = "watch-source-toggle__opt watch-source-toggle__opt--premium";
    iptv.href = routedHref(anchor, match, selected);
    iptv.dataset.iptvAutoLink = "1";
    iptv.innerHTML = `<span>${text("card.watchPremium", "IPTV")}</span><small>${selected.name || match.channel || "Auto"}</small>`;
    annotate(iptv, selected);
    const originalHtml = anchor.innerHTML;
    anchor.dataset.iptvAutoWrapped = "1";
    anchor.classList.remove("watch-link", "watch-link--soon", "watch-link--commentary", "watch-link--disabled");
    anchor.classList.add("watch-source-toggle__opt", "watch-source-toggle__opt--original");
    anchor.innerHTML = `<span>${originalHtml}</span>`;
    annotate(anchor, selected);
    anchor.parentNode?.insertBefore(wrapper, anchor);
    wrapper.append(kicker, track);
    track.append(iptv, anchor);
  }

  function rewriteAnchor(anchor) {
    if (!state || !anchor?.isConnected) return;
    let url;
    try { url = new URL(anchor.getAttribute("href"), location.href); }
    catch { return; }
    const match = state.matchMap.get(String(url.searchParams.get("match") || ""));
    if (!match) return;
    const selected = resolveForMatch(match);
    if (!selected?.streamId) { clearResolvedUi(anchor); return; }
    if (url.searchParams.get("source") === "iptv-premium") {
      anchor.href = routedHref(anchor, match, selected);
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
    if (!ensureExistingToggle(anchor, match, selected)) addResolvedToggle(anchor, match, selected);
  }

  function rewriteAll(root) {
    if (state) findWatchAnchors(root || document).forEach(rewriteAnchor);
  }

  function queueRewrite(root) {
    if (rewriteQueued) return;
    rewriteQueued = true;
    queueMicrotask(() => { rewriteQueued = false; rewriteAll(root || document); });
  }

  async function refreshAndRewrite() {
    if (await refreshState()) rewriteAll(document);
  }

  function startObserver() {
    if (observer || !document.documentElement) return;
    observer = new MutationObserver((mutations) => {
      if (mutations.some((m) => (m.type === "childList" && m.addedNodes.length) || (m.type === "attributes" && m.target?.tagName === "A"))) queueRewrite(document);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["href"] });
  }

  function init() {
    startObserver();
    refreshAndRewrite();
    setInterval(() => { state = null; refreshAndRewrite(); }, REFRESH_MS);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
