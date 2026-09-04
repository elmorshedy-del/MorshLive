/* Deterministic match -> broadcaster -> IPTV router.
 *
 * Existing match metadata is authoritative. The router first resolves the
 * published broadcaster identity against the current IPTV catalog. If that is
 * unavailable, it uses the provider's own EPG with the same fail-closed
 * two-team/timing matcher that was previously experimental.
 *
 * IPTV is exposed only during the shared TV window (T-30 through the short
 * post-match studio window). Outside it, cards remain match-detail/replay UI.
 */
(function () {
  "use strict";

  const resolver = () => window.KZIptvChannelResolver;
  const tvWindow = () => window.KZIptvWindow;
  const epgMatcher = () => window.KZIptvEpgMatcherCore;
  const OVERRIDE_URL = "/assets/data/manual-channel-overrides.json?v=20260904deterministic1";
  const REFRESH_MS = 45 * 1000;
  const SUPPORTED_COMPETITIONS = new Set(["epl", "laliga", "spl", "ucl"]);
  const SUPPORTED_SLUGS = new Set([
    "eng.1",
    "esp.1",
    "ksa.1",
    "uefa.champions",
    "uefa.champions_qual",
  ]);

  let state = null;
  let refreshPromise = null;
  let observer = null;
  let rewriteQueued = false;
  let refreshTimer = 0;

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

  async function waitForApis() {
    for (let index = 0; index < 80; index += 1) {
      if (
        typeof window.getMatches === "function"
        && resolver()
        && tvWindow()
        && epgMatcher()
      ) return true;
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
    return new Map(
      (Array.isArray(matches) ? matches : [])
        .filter((match) => match?.id)
        .map((match) => {
          const override = overrides?.[String(match.id)] || {};
          const row = maps.byId.get(String(match.id)) || maps.byPair.get(pairKey(match.home, match.away)) || {};
          const broadcast = override.broadcast || match.broadcast || row.broadcast || null;
          const channelId = override.channelId || match.channelId || row.channelId || broadcast?.channelId || "";
          const channel = override.channel || match.channel || row.channel || "";
          return [
            String(match.id),
            {
              ...match,
              ...override,
              channelId,
              channel,
              broadcast,
            },
          ];
        }),
    );
  }

  function localAliases(name) {
    const localized = window.TeamNames?.localize?.(name);
    return localized && localized !== name ? [localized] : [];
  }

  function matchForEpg(match) {
    return {
      ...match,
      homeAliases: localAliases(match.home),
      awayAliases: localAliases(match.away),
    };
  }

  function primarySelection(match, catalog) {
    if (!supportedMatch(match) || !tvWindow().isEligible(match)) return null;
    const target = {
      channelId: match.channelId,
      channel: match.channel,
      broadcast: match.broadcast,
    };
    const selected = resolver().resolveChannel(target, catalog);
    if (!selected?.streamId) return null;
    return { selected, resolution: "broadcaster" };
  }

  function epgSelection(match, programs, catalog) {
    if (!supportedMatch(match) || !tvWindow().isEligible(match)) return null;
    const hit = epgMatcher().resolveProgramMatch(matchForEpg(match), programs);
    if (!hit?.program) return null;
    const program = hit.program;
    const programIds = new Set(
      [program.representativeStreamId, ...(Array.isArray(program.streamIds) ? program.streamIds : [])]
        .filter(Boolean)
        .map(String),
    );
    let selected = resolver().resolveChannel(program.channelName || "", catalog);
    if (!selected?.streamId || (programIds.size && !programIds.has(String(selected.streamId)))) {
      selected = catalog.find((row) => programIds.has(String(row?.streamId || ""))) || null;
    }
    if (!selected?.streamId) return null;
    return {
      selected: {
        ...selected,
        resolver: {
          ...(selected.resolver || {}),
          method: "epg-program",
          logicalKey: program.logicalKey || "",
          epgProgramScore: hit.score,
          epgProgramTitle: program.title || "",
        },
      },
      resolution: "epg-program",
    };
  }

  async function refreshState() {
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
      if (!(await waitForApis())) return null;
      const [meta, catalogBody, today, overrides] = await Promise.all([
        window.getMatches({ force: false }),
        getJson("/api/iptv-lab/catalog"),
        getJson("/assets/data/today.json", true),
        getJson(OVERRIDE_URL, true),
      ]);
      const catalog = flattenCatalog(catalogBody);
      const matches = enrichMatches(meta?.matches || [], today, overrides);
      const selections = new Map();
      const unresolved = [];

      for (const match of matches.values()) {
        if (!supportedMatch(match) || !tvWindow().isEligible(match)) continue;
        const primary = primarySelection(match, catalog);
        if (primary) selections.set(String(match.id), primary);
        else unresolved.push(match);
      }

      let programs = [];
      if (unresolved.length) {
        const epg = await getJson("/api/iptv-lab/epg").catch(() => ({ programs: [] }));
        programs = Array.isArray(epg?.programs) ? epg.programs : [];
        for (const match of unresolved) {
          const fallback = epgSelection(match, programs, catalog);
          if (fallback) selections.set(String(match.id), fallback);
        }
      }

      state = { matches, catalog, programs, selections };
      return state;
    })()
      .catch((error) => {
        console.warn("Deterministic IPTV refresh failed", error);
        return null;
      })
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
      if (anchor.dataset.iptvAutoPrimary === "1") return false;
      try {
        const url = new URL(anchor.getAttribute("href"), location.href);
        if (!isWatchUrl(url)) return false;
        return url.searchParams.get("source") !== "xtream";
      } catch {
        return false;
      }
    });
  }

  function phaseLabel(match) {
    const phase = tvWindow().phase(match);
    if (phase === "live") return text("card.watchNow", "شاهد الآن");
    if (phase === "postgame") return text("card.watchCommentary", "مشاهدة التعليق");
    return text("card.watch", "مشاهدة");
  }

  function normalizeStageCopy(anchor, match) {
    if (!anchor?.classList?.contains("watch-link") || match?.status === "ended") return;
    const phase = tvWindow().phase(match);
    const key = phase === "details"
      ? "card.matchCentre"
      : phase === "live"
        ? "card.watchNow"
        : "card.watch";
    const fallback = phase === "details" ? "تفاصيل المباراة" : phase === "live" ? "شاهد الآن" : "مشاهدة";
    if (anchor.dataset.iptvStageKey === key) return;
    anchor.textContent = text(key, fallback);
    anchor.dataset.iptvStageKey = key;
    anchor.classList.toggle("watch-link--soon", phase === "details");
  }

  function routedHref(originalAnchor, match, selected) {
    const url = new URL(originalAnchor.getAttribute("href"), location.href);
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

  // Identifies what the rendered toggle currently shows. Used to skip the
  // innerHTML rewrite (and the childList mutation it produces) when nothing
  // the user would see has actually changed - the router previously
  // rewrote unconditionally on every trigger, including the 45s refresh
  // timer and every unrelated DOM mutation on the page.
  function toggleSignature(href, match, selected) {
    return `${href}|${phaseLabel(match)}|${match.channel || selected.name || "TV"}`;
  }

  function annotate(link, selected, resolution) {
    link.dataset.iptvAutoLink = "1";
    link.dataset.iptvAuto = "resolved";
    link.dataset.iptvStreamId = String(selected.streamId);
    link.dataset.iptvChannelName = String(selected.name || "");
    link.dataset.iptvResolution = resolution || selected.resolver?.method || "broadcaster";
    link.dataset.iptvLogicalKey = String(selected.resolver?.logicalKey || selected.resolver?.channelId || "");
  }

  function restoreExistingPremium(link) {
    if (link?.dataset?.iptvAutoExisting !== "1") return;
    if (link.dataset.iptvAutoOriginalHref != null) link.setAttribute("href", link.dataset.iptvAutoOriginalHref);
    if (link.dataset.iptvAutoOriginalHtml != null) link.innerHTML = link.dataset.iptvAutoOriginalHtml;
    [
      "iptvAutoExisting",
      "iptvAutoOriginalHref",
      "iptvAutoOriginalHtml",
      "iptvAutoLink",
      "iptvAuto",
      "iptvStreamId",
      "iptvChannelName",
      "iptvResolution",
      "iptvLogicalKey",
      "iptvAutoPrimary",
      "iptvAutoSig",
    ].forEach((key) => delete link.dataset[key]);
  }

  function unwrapGeneratedToggle(original) {
    const toggle = original?.closest?.(".iptv-auto-toggle");
    if (!toggle) return false;
    const savedHtml = original.dataset.iptvAutoOriginalHtml;
    const savedClass = original.dataset.iptvAutoOriginalClass;
    if (savedHtml != null) original.innerHTML = savedHtml;
    if (savedClass != null) original.className = savedClass;
    [
      "iptvAutoOriginalHtml",
      "iptvAutoOriginalClass",
      "iptvAutoLink",
      "iptvAuto",
      "iptvStreamId",
      "iptvChannelName",
      "iptvResolution",
      "iptvLogicalKey",
    ].forEach((key) => delete original.dataset[key]);
    const parent = toggle.parentNode;
    if (parent) {
      parent.insertBefore(original, toggle);
      toggle.remove();
    }
    return true;
  }

  function clearAuto(original) {
    if (!original) return;
    if (unwrapGeneratedToggle(original)) return;
    const toggle = original.closest?.(".watch-source-toggle");
    if (!toggle) return;
    restoreExistingPremium(toggle.querySelector('[data-iptv-auto-existing="1"]'));
  }

  function ensureAutoToggle(original, match, selected, resolution) {
    const href = routedHref(original, match, selected);
    const existing = original.closest(".watch-source-toggle");
    if (existing && !existing.classList.contains("iptv-auto-toggle")) {
      const primary = existing.querySelector(".watch-source-toggle__opt--premium");
      if (primary) {
        if (primary.dataset.iptvAutoExisting !== "1") {
          primary.dataset.iptvAutoExisting = "1";
          primary.dataset.iptvAutoOriginalHref = primary.getAttribute("href") || "";
          primary.dataset.iptvAutoOriginalHtml = primary.innerHTML;
        }
        const signature = toggleSignature(href, match, selected);
        if (primary.dataset.iptvAutoSig !== signature) {
          primary.href = href;
          primary.innerHTML = `<span>${phaseLabel(match)}</span><small>${match.channel || selected.name || "TV"}</small>`;
          primary.dataset.iptvAutoSig = signature;
        }
        primary.dataset.iptvAutoPrimary = "1";
        annotate(primary, selected, resolution);
        annotate(original, selected, resolution);
        return;
      }
    }

    if (existing?.classList.contains("iptv-auto-toggle")) {
      const primary = existing.querySelector('[data-iptv-auto-primary="1"]');
      if (primary) {
        const signature = toggleSignature(href, match, selected);
        if (primary.dataset.iptvAutoSig !== signature) {
          primary.href = href;
          primary.innerHTML = `<span>${phaseLabel(match)}</span><small>${match.channel || selected.name || "TV"}</small>`;
          primary.dataset.iptvAutoSig = signature;
        }
        annotate(primary, selected, resolution);
        annotate(original, selected, resolution);
      }
      return;
    }

    const wrapper = document.createElement("div");
    wrapper.className = "watch-source-toggle iptv-auto-toggle";
    wrapper.setAttribute("role", "group");
    wrapper.setAttribute("aria-label", text("watch.sourceTabsAria", "مصدر المشاهدة"));

    const kicker = document.createElement("span");
    kicker.className = "watch-source-toggle__kicker";
    kicker.textContent = text("watch.sourceToggle", "المصدر");

    const track = document.createElement("div");
    track.className = "watch-source-toggle__track";

    const primary = document.createElement("a");
    primary.className = "watch-source-toggle__opt watch-source-toggle__opt--premium";
    primary.href = href;
    primary.dataset.iptvAutoPrimary = "1";
    primary.innerHTML = `<span>${phaseLabel(match)}</span><small>${match.channel || selected.name || "TV"}</small>`;
    primary.dataset.iptvAutoSig = toggleSignature(href, match, selected);
    annotate(primary, selected, resolution);

    original.dataset.iptvAutoOriginalHtml = original.innerHTML;
    original.dataset.iptvAutoOriginalClass = original.className;
    original.classList.remove("watch-link", "watch-link--soon", "watch-link--commentary", "watch-link--disabled");
    original.classList.add("watch-source-toggle__opt", "watch-source-toggle__opt--original");
    original.innerHTML = `<span>${text("card.watchOriginal", "تفاصيل المباراة")}</span>`;
    annotate(original, selected, resolution);

    original.parentNode?.insertBefore(wrapper, original);
    wrapper.append(kicker, track);
    track.append(primary, original);
  }

  function rewriteAnchor(original) {
    if (!state || !original?.isConnected) return;
    let url;
    try {
      url = new URL(original.getAttribute("href"), location.href);
    } catch {
      return;
    }
    const match = state.matches.get(String(url.searchParams.get("match") || ""));
    if (!match || !supportedMatch(match)) return;

    const selection = state.selections.get(String(match.id));
    if (!tvWindow().isEligible(match) || !selection?.selected?.streamId) {
      clearAuto(original);
      normalizeStageCopy(original, match);
      return;
    }
    ensureAutoToggle(original, match, selection.selected, selection.resolution);
  }

  function rewriteAll(root) {
    if (!state) return;
    originalWatchAnchors(root || document).forEach(rewriteAnchor);
  }

  function queueRewrite() {
    if (rewriteQueued) return;
    rewriteQueued = true;
    queueMicrotask(() => {
      rewriteQueued = false;
      rewriteAll(document);
    });
  }

  // Only these containers ever hold a watch anchor this router cares about
  // (home page match cards, the watch page sidebar and its own source
  // toggle). Watching document.documentElement instead reacted to every
  // unrelated mutation on the page - live score ticks, tweet cards, banner
  // rotation, animations.js - each one forcing a full-document anchor
  // rescan and, for a handful of stale-observer runs still touching the
  // toggle, an innerHTML rewrite. That's the freeze: this router turning
  // every unrelated DOM change anywhere on the page into extra work.
  function observedRoots() {
    return ["matches-grid", "live-detail", "side-channels", "player-toolbar"]
      .map((id) => document.getElementById(id))
      .filter(Boolean);
  }

  function startObserver() {
    if (observer) return;
    const roots = observedRoots();
    if (!roots.length) return;
    observer = new MutationObserver((mutations) => {
      if (mutations.some((mutation) => mutation.type === "childList" && mutation.addedNodes.length)) queueRewrite();
    });
    roots.forEach((root) => observer.observe(root, { childList: true, subtree: true }));
  }

  async function refreshAndRewrite() {
    if (await refreshState()) rewriteAll(document);
  }

  async function init() {
    startObserver();
    await refreshAndRewrite();
    clearInterval(refreshTimer);
    refreshTimer = setInterval(refreshAndRewrite, REFRESH_MS);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
