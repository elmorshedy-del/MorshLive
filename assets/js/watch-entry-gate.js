/* CHATGPT-STAMP 2026-09-05 — WATCH-ENTRY-GATE
 *
 * Surgical watch-page gate only. Cards stay clickable and unchanged.
 * Outside the shared KZIptvWindow eligibility window, do not load watch.js at
 * all; render the existing waiting-state presentation instead. This prevents
 * generic channel buttons / fallback routes from accidentally starting a
 * stream hours before kickoff. IPTV Lab and its player logic are untouched.
 *
 * Rollback: remove this file and restore watch-loader.js to load watch.js
 * directly.
 */
(function (global) {
  "use strict";

  const params = new URLSearchParams(location.search);
  const matchId = String(params.get("match") || "");
  let started = false;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.async = false;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  async function startWatch() {
    if (started) return;
    started = true;
    global.__KZ_WATCH_LOADER = "standard";
    try {
      await loadScript("assets/js/watch-lab-continuity-guard.js?v=20260905chatgpt0854");
    } catch (_) {
      /* Continuity helper is best-effort; preserve the existing watch path. */
    }
    await loadScript("assets/js/watch.js?v=20260905entrygate1");
  }

  function hidePlaybackChrome() {
    const selectors = ["#channel-switch", ".watch-sources-card", "#alt-streams", "#manual-mirrors"];
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el) el.hidden = true;
    }
  }

  function label(name) {
    return global.TeamNames?.localize ? global.TeamNames.localize(name) : String(name || "");
  }

  function waitingCopy(phase) {
    const english = global.I18N?.lang === "en";
    if (phase === "after") {
      return english
        ? {
            kicker: "Full time",
            title: "The live TV window has ended",
            hint: "You can continue with the match summary, goals and available replay content below.",
            live: "Summary and details available",
          }
        : {
            kicker: "بعد النهاية",
            title: "انتهت نافذة البث المباشر",
            hint: "يمكنك متابعة ملخص المباراة والأهداف والمحتوى المتاح بعد المباراة أدناه.",
            live: "الملخص والتفاصيل متاحة",
          };
    }
    return english
      ? {
          kicker: "Before the match",
          title: "TV opens about 30 minutes before kickoff",
          hint: "The channel player activates automatically when the pre-match studio window begins. Match details are available now.",
          live: "Match details available",
        }
      : {
          kicker: "قبل المباراة",
          title: "يفتح البث قبل المباراة بنحو 30 دقيقة",
          hint: "يُفعّل مشغل القناة تلقائياً مع بداية الاستوديو التحليلي. تفاصيل المباراة متاحة الآن.",
          live: "تفاصيل المباراة متاحة",
        };
  }

  function renderWaiting(match, phase) {
    hidePlaybackChrome();
    const shell = document.getElementById("player-shell");
    if (shell) {
      const copy = waitingCopy(phase);
      shell.innerHTML = "";
      const waiting = document.createElement("div");
      waiting.className = "player-shell-waiting";
      waiting.dataset.iptvStageCopy = `${phase}:${global.I18N?.lang === "en" ? "en" : "ar"}`;
      waiting.dataset.planWait = phase;
      const kicker = document.createElement("p");
      kicker.className = "player-shell-waiting__kicker";
      kicker.textContent = copy.kicker;
      const title = document.createElement("strong");
      title.textContent = copy.title;
      const hint = document.createElement("span");
      hint.textContent = copy.hint;
      const live = document.createElement("em");
      live.className = "player-shell-waiting__live";
      live.textContent = copy.live;
      waiting.append(kicker, title, hint, live);
      shell.appendChild(waiting);
    }

    const name = document.getElementById("ch-name");
    if (name && match) name.textContent = `${label(match.home)} ضد ${label(match.away)}`;
    const sub = document.getElementById("now-sub");
    if (sub && match) sub.textContent = match.leagueAr || match.league || match.competition || "";
    const commentator = document.getElementById("info-commentator");
    if (commentator && match) commentator.textContent = match.commentator || match.commentators?.[0]?.name || "—";
    const tournament = document.getElementById("info-tournament");
    if (tournament && match) tournament.textContent = match.leagueAr || match.league || match.competition || "—";
    const times = document.getElementById("info-times");
    if (times && match && typeof global.getMatchTimeZones === "function") {
      const zones = global.getMatchTimeZones(match);
      times.textContent = zones.map((zone) => `${zone.shortLabel || zone.label}: ${zone.value}`).join(" · ") || "—";
    }
  }

  async function resolveMatch() {
    if (!matchId || typeof global.getMatches !== "function") return null;
    try {
      const payload = await global.getMatches({ force: false });
      const matches = Array.isArray(payload) ? payload : (payload?.matches || []);
      return matches.find((row) => String(row?.id || "") === matchId) || null;
    } catch (_) {
      return null;
    }
  }

  async function boot() {
    // Explicit diagnostic/Xtream URLs retain their existing isolated path.
    if (params.get("source") === "xtream") {
      await startWatch();
      return;
    }
    if (!matchId) {
      await startWatch();
      return;
    }

    if (!global.KZIptvWindow) {
      try {
        await loadScript("assets/js/iptv-window.js?v=20260905entrygate1");
      } catch (_) {
        await startWatch();
        return;
      }
    }

    const match = await resolveMatch();
    // Fail open if fixture lookup itself is unavailable; never strand a valid
    // live match because of a metadata outage.
    if (!match) {
      await startWatch();
      return;
    }

    const phase = global.KZIptvWindow.phase(match);
    if (global.KZIptvWindow.isEligible(match)) {
      await startWatch();
      return;
    }

    renderWaiting(match, phase);

    // If this is simply early, activate the normal player exactly at T-30
    // without requiring the viewer to click the card again or refresh.
    const minutes = global.KZIptvWindow.minutesFromKickoff(match);
    if (Number.isFinite(minutes) && minutes < -global.KZIptvWindow.PRE_MATCH_MINUTES) {
      const untilOpen = Math.max(1000, (-global.KZIptvWindow.PRE_MATCH_MINUTES - minutes) * 60000 + 250);
      setTimeout(() => startWatch().catch(() => {}), Math.min(untilOpen, 2147483647));
    }
  }

  boot().catch(() => startWatch().catch(() => {}));
})(window);
