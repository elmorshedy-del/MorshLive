/* Deterministic fixture -> IPTV mapping from the provider's own EPG.
 *
 * This is the fallback path for live/upcoming fixtures that do not already carry
 * broadcaster metadata. A channel is attached only when BOTH teams match an EPG
 * program and the program timing is coherent with the fixture. Ambiguous matches
 * fail closed.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) {
    root.KZIptvEpgMatcher = api;
    if (root.document) api.install(root);
  }
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const REFRESH_MS = 45 * 1000;
  const MIN_SCORE = 165;
  const AMBIGUITY_MARGIN = 15;
  const TEAM_NOISE = new Set(["fc", "sc", "cf", "club", "football", "soccer", "team"]);

  function normalize(value) {
    return String(value || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[\u064b-\u065f\u0670\u0640]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9\u0600-\u06ff]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function compactTeam(value) {
    return normalize(value)
      .split(" ")
      .filter(Boolean)
      .filter((token) => !TEAM_NOISE.has(token))
      .join(" ");
  }

  function teamForms(name, aliases) {
    const values = [name, ...(Array.isArray(aliases) ? aliases : [])];
    const forms = new Set();
    for (const value of values) {
      const normalized = normalize(value);
      const compact = compactTeam(value);
      if (normalized.length >= 3) forms.add(normalized);
      if (compact.length >= 3) forms.add(compact);
    }
    return [...forms].sort((a, b) => b.length - a.length);
  }

  function teamScore(programText, forms) {
    const text = ` ${normalize(programText)} `;
    for (const form of forms) {
      if (text.includes(` ${form} `) || text.includes(form)) return 80;
    }
    return 0;
  }

  function timestampMs(value) {
    const number = Number(value || 0);
    if (!Number.isFinite(number) || number <= 0) return NaN;
    return number < 1e12 ? number * 1000 : number;
  }

  function programMatchScore(match, program) {
    if (!match || !program?.logicalKey) return Number.NEGATIVE_INFINITY;
    const programText = `${program.title || ""} ${program.description || ""}`.trim();
    if (!programText) return Number.NEGATIVE_INFINITY;

    const homeForms = teamForms(match.home, match.homeAliases);
    const awayForms = teamForms(match.away, match.awayAliases);
    const homeScore = teamScore(programText, homeForms);
    const awayScore = teamScore(programText, awayForms);
    if (!homeScore || !awayScore) return Number.NEGATIVE_INFINITY;

    let score = homeScore + awayScore;
    const kickoff = Date.parse(match.kickoffUtc || "");
    const start = timestampMs(program.startTimestamp);
    const stop = timestampMs(program.stopTimestamp);

    if (match.status === "live" && program.nowPlaying) score += 35;

    if (Number.isFinite(kickoff) && Number.isFinite(start)) {
      if (Number.isFinite(stop) && kickoff >= start - 45 * 60 * 1000 && kickoff <= stop + 45 * 60 * 1000) {
        score += 30;
      } else {
        const startDelta = Math.abs(start - kickoff);
        if (startDelta <= 90 * 60 * 1000) score += 20;
        else if (startDelta <= 3 * 60 * 60 * 1000) score += 5;
        else return Number.NEGATIVE_INFINITY;
      }
    }

    return score;
  }

  function resolveProgramMatch(match, programs) {
    const byLogicalKey = new Map();
    for (const program of Array.isArray(programs) ? programs : []) {
      const score = programMatchScore(match, program);
      if (!Number.isFinite(score)) continue;
      const key = String(program.logicalKey || "");
      const previous = byLogicalKey.get(key);
      if (!previous || score > previous.score) byLogicalKey.set(key, { program, score });
    }

    const ranked = [...byLogicalKey.values()].sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return String(a.program.logicalKey).localeCompare(String(b.program.logicalKey), "en", { numeric: true });
    });
    if (!ranked.length || ranked[0].score < MIN_SCORE) return null;
    if (ranked[1] && ranked[0].score - ranked[1].score < AMBIGUITY_MARGIN) return null;
    return ranked[0];
  }

  function install(win) {
    const resolver = () => win.KZIptvChannelResolver;
    let state = null;
    let refreshPromise = null;
    let observer = null;
    let rewriteQueued = false;

    function text(key, fallback) {
      try {
        const value = win.I18N?.t?.(key);
        return value && value !== key ? value : fallback;
      } catch {
        return fallback;
      }
    }

    async function getJson(url) {
      const response = await win.fetch(url, { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.ok === false) throw new Error(body.error || `HTTP ${response.status}`);
      return body;
    }

    async function waitForApis() {
      for (let index = 0; index < 80; index += 1) {
        if (typeof win.getMatches === "function" && resolver()) return true;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return false;
    }

    function flattenCatalog(body) {
      if (Array.isArray(body.streams)) return body.streams;
      return (body.portals || []).flatMap((block) => block.streams || []);
    }

    function localAliases(name) {
      const localized = win.TeamNames?.localize?.(name);
      return localized && localized !== name ? [localized] : [];
    }

    function matchForProgram(match) {
      return {
        ...match,
        homeAliases: localAliases(match.home),
        awayAliases: localAliases(match.away),
      };
    }

    function makeMatchMap(matches) {
      return new Map(
        (Array.isArray(matches) ? matches : [])
          .filter((match) => match?.id && match.status !== "ended")
          .map((match) => [String(match.id), match]),
      );
    }

    async function refreshState() {
      if (refreshPromise) return refreshPromise;
      refreshPromise = (async () => {
        if (!(await waitForApis())) return null;
        const [meta, catalog, epg] = await Promise.all([
          win.getMatches({ force: false }),
          getJson("/api/iptv-lab/catalog"),
          getJson("/api/iptv-lab/epg").catch(() => ({ programs: [] })),
        ]);
        state = {
          matches: makeMatchMap(meta?.matches || []),
          channels: flattenCatalog(catalog),
          programs: Array.isArray(epg?.programs) ? epg.programs : [],
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

    function findOriginalAnchors() {
      return [...win.document.querySelectorAll('a[href*="match="]')].filter((anchor) => {
        if (anchor.dataset.iptvEpgPremium === "1") return false;
        if (anchor.dataset.iptvAutoLink === "1" && anchor.dataset.iptvEpgManaged !== "1") return false;
        try {
          return isWatchUrl(new URL(anchor.getAttribute("href"), win.location.href));
        } catch {
          return false;
        }
      });
    }

    function selectedFromProgram(match) {
      const programMatch = resolveProgramMatch(matchForProgram(match), state?.programs || []);
      if (!programMatch) return null;
      const program = programMatch.program;
      const selected = resolver().resolveChannel(
        {
          label: program.channelName || program.logicalKey,
          iptvLogicalKey: program.logicalKey,
        },
        state.channels,
      );
      if (!selected || selected.resolver?.logicalKey !== program.logicalKey) return null;
      selected.resolver.epgProgramScore = programMatch.score;
      selected.resolver.epgProgramTitle = program.title || "";
      selected.resolver.method = "epg-program";
      return selected;
    }

    function routedHref(anchor, match, selected) {
      const url = new URL(anchor.getAttribute("href"), win.location.href);
      url.searchParams.set("match", String(match.id));
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
      anchor.dataset.iptvIdentityTier = String(selected.resolver?.identityTier || "");
      anchor.dataset.iptvResolution = "epg-program";
    }

    function clearManaged(anchor) {
      if (anchor.dataset.iptvEpgManaged !== "1") return;
      const toggle = anchor.closest(".iptv-epg-auto-toggle");
      if (toggle) {
        const originalSpan = anchor.querySelector(":scope > span");
        if (originalSpan) anchor.innerHTML = originalSpan.innerHTML;
        anchor.classList.remove("watch-source-toggle__opt", "watch-source-toggle__opt--original");
        const parent = toggle.parentNode;
        if (parent) {
          parent.insertBefore(anchor, toggle);
          toggle.remove();
        }
      }
      delete anchor.dataset.iptvEpgManaged;
      delete anchor.dataset.iptvAutoLink;
      delete anchor.dataset.iptvAuto;
      delete anchor.dataset.iptvStreamId;
      delete anchor.dataset.iptvChannelName;
      delete anchor.dataset.iptvLogicalKey;
      delete anchor.dataset.iptvIdentityTier;
      delete anchor.dataset.iptvResolution;
    }

    function ensureToggle(anchor, match, selected) {
      const existingToggle = anchor.closest(".watch-source-toggle");
      if (existingToggle && !existingToggle.classList.contains("iptv-epg-auto-toggle")) {
        const premium = existingToggle.querySelector(
          '.watch-source-toggle__opt--premium, a[data-iptv-auto-link="1"]',
        );
        if (premium?.dataset.iptvAuto === "resolved") return;
      }

      if (existingToggle?.classList.contains("iptv-epg-auto-toggle")) {
        const premium = existingToggle.querySelector('[data-iptv-epg-premium="1"]');
        const href = routedHref(anchor, match, selected);
        if (premium && premium.getAttribute("href") !== href) premium.setAttribute("href", href);
        if (premium) annotate(premium, selected);
        annotate(anchor, selected);
        return;
      }

      const wrapper = win.document.createElement("div");
      wrapper.className = "watch-source-toggle iptv-epg-auto-toggle";
      wrapper.setAttribute("role", "group");
      wrapper.setAttribute("aria-label", text("watch.sourceTabsAria", "Watch source"));

      const kicker = win.document.createElement("span");
      kicker.className = "watch-source-toggle__kicker";
      kicker.textContent = text("watch.sourceToggle", "Source");

      const track = win.document.createElement("div");
      track.className = "watch-source-toggle__track";

      const premium = win.document.createElement("a");
      premium.className = "watch-source-toggle__opt watch-source-toggle__opt--premium";
      premium.href = routedHref(anchor, match, selected);
      premium.dataset.iptvAutoLink = "1";
      premium.dataset.iptvEpgPremium = "1";
      const premiumText = win.document.createElement("span");
      premiumText.textContent = text("card.watchPremium", "IPTV");
      const premiumSmall = win.document.createElement("small");
      premiumSmall.textContent = "EPG · Auto";
      premium.append(premiumText, premiumSmall);
      annotate(premium, selected);

      const originalHtml = anchor.innerHTML;
      anchor.dataset.iptvEpgManaged = "1";
      // Prevent the older broadcaster-only auto-router from clearing this EPG mapping.
      anchor.dataset.iptvAutoLink = "1";
      anchor.classList.remove(
        "watch-link",
        "watch-link--soon",
        "watch-link--commentary",
        "watch-link--disabled",
      );
      anchor.classList.add("watch-source-toggle__opt", "watch-source-toggle__opt--original");
      anchor.innerHTML = "";
      const originalText = win.document.createElement("span");
      originalText.innerHTML = originalHtml;
      anchor.appendChild(originalText);
      annotate(anchor, selected);

      anchor.parentNode?.insertBefore(wrapper, anchor);
      wrapper.append(kicker, track);
      track.append(premium, anchor);
    }

    function rewriteAll() {
      if (!state) return;
      for (const anchor of findOriginalAnchors()) {
        let url;
        try {
          url = new URL(anchor.getAttribute("href"), win.location.href);
        } catch {
          continue;
        }
        const match = state.matches.get(String(url.searchParams.get("match") || ""));
        if (!match) {
          clearManaged(anchor);
          continue;
        }

        // Broadcaster metadata gets first priority in iptv-auto.js. This EPG
        // fallback is only needed when that path has not already resolved.
        const alreadyResolved = anchor.closest(".watch-source-toggle")?.querySelector(
          'a[data-iptv-auto-link="1"][data-iptv-auto="resolved"]:not([data-iptv-epg-premium="1"])',
        );
        if (alreadyResolved) continue;

        const selected = selectedFromProgram(match);
        if (!selected?.streamId) {
          clearManaged(anchor);
          continue;
        }
        ensureToggle(anchor, match, selected);
      }
    }

    function queueRewrite() {
      if (rewriteQueued) return;
      rewriteQueued = true;
      queueMicrotask(() => {
        rewriteQueued = false;
        rewriteAll();
      });
    }

    async function refreshAndRewrite() {
      const current = await refreshState();
      if (current) rewriteAll();
    }

    function startObserver() {
      if (observer || !win.document.documentElement) return;
      observer = new MutationObserver((mutations) => {
        if (mutations.some((mutation) => mutation.type === "childList" && mutation.addedNodes.length)) {
          queueRewrite();
        }
      });
      observer.observe(win.document.documentElement, { childList: true, subtree: true });
    }

    function init() {
      startObserver();
      refreshAndRewrite();
      setInterval(() => {
        state = null;
        refreshAndRewrite();
      }, REFRESH_MS);
    }

    if (win.document.readyState === "loading") {
      win.document.addEventListener("DOMContentLoaded", init, { once: true });
    } else {
      init();
    }
  }

  return {
    normalize,
    teamForms,
    programMatchScore,
    resolveProgramMatch,
    install,
  };
});
