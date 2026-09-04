/* Safe deterministic match -> current IPTV catalog binding.
 *
 * This intentionally does not create/replace DOM wrappers and does not install a
 * document-wide MutationObserver. It only rewrites an existing match watch href
 * when a deterministic stream is resolved inside the shared TV window.
 */
(function () {
  "use strict";

  const BUILD = "20260904safebind1";
  const REFRESH_MS = 45 * 1000;
  const OVERRIDE_URL = "/assets/data/manual-channel-overrides.json?v=20260904deterministic1";
  const SUPPORTED_COMPETITIONS = new Set(["epl", "laliga", "spl", "ucl"]);
  const SUPPORTED_SLUGS = new Set([
    "eng.1",
    "esp.1",
    "ksa.1",
    "uefa.champions",
    "uefa.champions_qual",
  ]);

  let refreshPromise = null;

  function resolver() { return window.KZIptvChannelResolver; }
  function tvWindow() { return window.KZIptvWindow; }
  function epgMatcher() { return window.KZIptvEpgMatcherCore; }

  async function getJson(url, optional = false) {
    const response = await fetch(url, { cache: "no-store" });
    if (optional && response.status === 404) return {};
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.ok === false) throw new Error(body.error || `HTTP ${response.status}`);
    return body;
  }

  async function waitForApis() {
    for (let i = 0; i < 80; i += 1) {
      if (typeof window.getMatches === "function" && resolver() && tvWindow() && epgMatcher()) return true;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return false;
  }

  function flattenCatalog(body) {
    if (Array.isArray(body?.streams)) return body.streams;
    return (body?.portals || []).flatMap((block) => block.streams || []);
  }

  function normalizeTeam(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9\u0600-\u06ff]+/g, "")
      .trim();
  }

  function pairKey(home, away) {
    return [normalizeTeam(home), normalizeTeam(away)].filter(Boolean).sort().join("~");
  }

  function supportedMatch(match) {
    if (!match?.id) return false;
    if (SUPPORTED_COMPETITIONS.has(String(match.competition || "").toLowerCase())) return true;
    if (SUPPORTED_SLUGS.has(String(match.leagueSlug || "").toLowerCase())) return true;
    const id = String(match.id || "");
    return [...SUPPORTED_SLUGS].some((slug) => id.includes(`espn-${slug}-`));
  }

  function broadcastMaps(today) {
    const byId = new Map();
    const byPair = new Map();
    for (const row of Array.isArray(today?.broadcastIndex) ? today.broadcastIndex : []) {
      if (row?.id) byId.set(String(row.id), row);
      const key = pairKey(row?.home, row?.away);
      if (key) byPair.set(key, row);
    }
    for (const row of Array.isArray(today?.commentaryIndex) ? today.commentaryIndex : []) {
      const key = pairKey(row?.home, row?.away);
      if (key && !byPair.has(key)) byPair.set(key, row);
    }
    return { byId, byPair };
  }

  function enrichMatches(matches, today, overrides) {
    const maps = broadcastMaps(today);
    return new Map((Array.isArray(matches) ? matches : []).filter((m) => m?.id).map((match) => {
      const override = overrides?.[String(match.id)] || {};
      const row = maps.byId.get(String(match.id)) || maps.byPair.get(pairKey(match.home, match.away)) || {};
      const broadcast = override.broadcast || match.broadcast || row.broadcast || null;
      const channelId = override.channelId || match.channelId || row.channelId || broadcast?.channelId || "";
      const channel = override.channel || match.channel || row.channel || "";
      return [String(match.id), { ...match, ...override, broadcast, channelId, channel }];
    }));
  }

  function localAliases(name) {
    const localized = window.TeamNames?.localize?.(name);
    return localized && localized !== name ? [localized] : [];
  }

  function selectByEpg(match, programs, catalog) {
    const hit = epgMatcher().resolveProgramMatch({
      ...match,
      homeAliases: localAliases(match.home),
      awayAliases: localAliases(match.away),
    }, programs);
    if (!hit?.program) return null;
    const program = hit.program;
    const ids = new Set([
      program.representativeStreamId,
      ...(Array.isArray(program.streamIds) ? program.streamIds : []),
    ].filter(Boolean).map(String));
    let selected = resolver().resolveChannel(program.channelName || "", catalog);
    if (!selected?.streamId || (ids.size && !ids.has(String(selected.streamId)))) {
      selected = catalog.find((row) => ids.has(String(row?.streamId || ""))) || null;
    }
    return selected?.streamId ? selected : null;
  }

  function isWatchAnchor(anchor) {
    if (!(anchor instanceof HTMLAnchorElement)) return false;
    if (!anchor.getAttribute("href")?.includes("match=")) return false;
    try {
      const url = new URL(anchor.getAttribute("href"), location.href);
      const path = String(url.pathname || "").replace(/\/$/, "");
      if (!(path === "/watch" || path === "/watch.html" || path.startsWith("/watch/"))) return false;
      if (url.searchParams.get("source") === "xtream" && anchor.dataset.iptvSafeBound !== BUILD) return false;
      return true;
    } catch {
      return false;
    }
  }

  function restoreAnchor(anchor) {
    if (anchor.dataset.iptvSafeBound !== BUILD) return;
    const original = anchor.dataset.iptvSafeOriginalHref;
    if (original) anchor.setAttribute("href", original);
    delete anchor.dataset.iptvSafeBound;
    delete anchor.dataset.iptvSafeOriginalHref;
    delete anchor.dataset.iptvStreamId;
    delete anchor.dataset.iptvChannelName;
    delete anchor.dataset.iptvResolution;
  }

  function routeHref(anchor, match, selected) {
    const baseHref = anchor.dataset.iptvSafeOriginalHref || anchor.getAttribute("href") || "";
    const url = new URL(baseHref, location.href);
    const targetKey = resolver().canonicalKey(match.broadcast?.channelId || match.channelId || match.channel || "");
    url.searchParams.set("match", String(match.id));
    url.searchParams.set("source", "xtream");
    url.searchParams.set("portal", String(selected.portalId || "lab"));
    url.searchParams.set("stream", String(selected.streamId));
    if (targetKey) url.searchParams.set("ch", targetKey);
    url.searchParams.delete("direct");
    url.searchParams.delete("premium");
    url.searchParams.delete("premiumChannelId");
    return `${url.pathname.replace(/^\//, "")}${url.search}${url.hash}`;
  }

  function bindAnchor(anchor, match, selected, resolution) {
    if (!anchor.dataset.iptvSafeOriginalHref) {
      anchor.dataset.iptvSafeOriginalHref = anchor.getAttribute("href") || "";
    }
    const href = routeHref(anchor, match, selected);
    if (anchor.getAttribute("href") !== href) anchor.setAttribute("href", href);
    anchor.dataset.iptvSafeBound = BUILD;
    anchor.dataset.iptvStreamId = String(selected.streamId);
    anchor.dataset.iptvChannelName = String(selected.name || "");
    anchor.dataset.iptvResolution = resolution;
  }

  async function refreshAndBind() {
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
      if (!(await waitForApis())) return;
      const [meta, catalogBody, today, overrides] = await Promise.all([
        window.getMatches({ force: false }),
        getJson("/api/iptv-lab/catalog"),
        getJson("/assets/data/today.json", true),
        getJson(OVERRIDE_URL, true),
      ]);
      const catalog = flattenCatalog(catalogBody);
      const matches = enrichMatches(meta?.matches || [], today, overrides);
      const eligible = [...matches.values()].filter((match) => supportedMatch(match) && tvWindow().isEligible(match));
      const selections = new Map();
      const unresolved = [];

      for (const match of eligible) {
        const selected = resolver().resolveChannel({
          channelId: match.channelId,
          channel: match.channel,
          broadcast: match.broadcast,
        }, catalog);
        if (selected?.streamId) selections.set(String(match.id), { selected, resolution: "broadcaster" });
        else unresolved.push(match);
      }

      if (unresolved.length) {
        const epg = await getJson("/api/iptv-lab/epg").catch(() => ({ programs: [] }));
        const programs = Array.isArray(epg?.programs) ? epg.programs : [];
        for (const match of unresolved) {
          const selected = selectByEpg(match, programs, catalog);
          if (selected) selections.set(String(match.id), { selected, resolution: "epg-program" });
        }
      }

      const anchors = [...document.querySelectorAll('a[href*="match="], a[data-iptv-safe-bound]')].filter(isWatchAnchor);
      for (const anchor of anchors) {
        let url;
        try {
          url = new URL(anchor.dataset.iptvSafeOriginalHref || anchor.getAttribute("href"), location.href);
        } catch {
          continue;
        }
        const match = matches.get(String(url.searchParams.get("match") || ""));
        const selection = match ? selections.get(String(match.id)) : null;
        if (!match || !supportedMatch(match) || !tvWindow().isEligible(match) || !selection?.selected?.streamId) {
          restoreAnchor(anchor);
          continue;
        }
        bindAnchor(anchor, match, selection.selected, selection.resolution);
      }
    })().catch((error) => {
      console.warn("Safe IPTV binding refresh failed", error);
    }).finally(() => {
      refreshPromise = null;
    });
    return refreshPromise;
  }

  async function init() {
    await refreshAndBind();
    setTimeout(refreshAndBind, 750);
    setTimeout(refreshAndBind, 2500);
    setTimeout(refreshAndBind, 6000);
    setInterval(refreshAndBind, REFRESH_MS);
  }

  window.__KZ_IPTV_SAFE_BIND_BUILD = BUILD;
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
