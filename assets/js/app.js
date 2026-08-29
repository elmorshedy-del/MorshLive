/* ============================================================================
 * app.js — renders the home page (matches + channels) and handles UI.
 * Match data is loaded live from assets/data/today.json via window.getMatches().
 * ==========================================================================*/
(function () {
  let MATCHES = [];

  const t = (k, v) => (window.I18N ? window.I18N.t(k, v) : k);
  const statusLabel = (s) => t("status." + s);
  const teamLabel = (n) => (window.TeamNames ? window.TeamNames.localize(n) : n);
  const leagueLabel = (m) => {
    if (m && m.competition) {
      const translated = t(`league.${m.competition}`);
      if (translated !== `league.${m.competition}`) return translated;
    }
    if (window.I18N?.lang === "ar" && m?.leagueAr) return m.leagueAr;
    return (m && m.league) || "";
  };

  const ICON = {
    mic: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/></svg>',
    play: '<svg class="ico ico-fill" viewBox="0 0 24 24" aria-hidden="true"><polygon points="6 3 20 12 6 21 6 3"/></svg>',
    trophy: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.7V17c0 .6-.5 1-1 1.2C7.9 18.8 7 20.2 7 22"/><path d="M14 14.7V17c0 .6.5 1 1 1.2 1.1.6 2 2 2 2.8"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg>',
    pin: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>',
    tv: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="7" width="20" height="15" rx="2"/><polyline points="17 2 12 7 7 2"/></svg>',
    star: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><polygon points="12 2 15.1 8.6 22 9.3 17 14 18.3 21 12 17.5 5.7 21 7 14 2 9.3 8.9 8.6 12 2"/></svg>',
    trash: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
  };

  const FAV = () => window.KZFav;

  function favStar(m) {
    if (!window.KZFav) return "";
    const saved = window.KZFav.has(m.id);
    return `<button class="fav-star ${saved ? "is-saved" : ""}" data-fav-id="${m.id}" type="button"
      aria-pressed="${saved}" aria-label="${saved ? t("card.removeSaved") : t("card.saveMatch")}"
      title="${saved ? t("card.removeSaved") : t("card.saveMatch")}">${ICON.star}</button>`;
  }

  function crest(badge, ab) {
    return badge
      ? `<div class="crest"><img src="${badge}" alt="" loading="lazy"></div>`
      : `<div class="crest">${ab || "?"}</div>`;
  }

  function isWorldCupMatch(m) {
    return m?.leagueSlug === "fifa.world" || /^espn-fifa\.world-/.test(m?.id || "");
  }

  // Where a match's watch button points. Ended fixtures → archive; live/upcoming → player.
  function watchHref(m) {
    if (m.status === "ended" && m.key && isWorldCupMatch(m)) {
      const href = window.TeamNames?.matchPageHref?.(m);
      if (href) return href;
      return `/tournament?match=${encodeURIComponent(m.key)}`;
    }
    return m.channelId
      ? `watch.html?ch=${m.channelId}&match=${m.id}`
      : `watch.html?ch=live&match=${m.id}`;
  }

  function isBarcelonaMatch(m) {
    return [m?.home, m?.away].some((name) => /^(?:fc\s+)?barcelona$/i.test(String(name || "").trim()));
  }

  function isManchesterCityMatch(m) {
    return [m?.home, m?.away].some((name) => /^manchester\s+city$/i.test(String(name || "").trim()));
  }

  function isLiverpoolMatch(m) {
    return [m?.home, m?.away].some((name) => /^liverpool$/i.test(String(name || "").trim()));
  }

  function isTottenhamMatch(m) {
    return [m?.home, m?.away].some((name) => /^tottenham(?:\s+hotspur)?$/i.test(String(name || "").trim()));
  }

  function isAtleticoMadridMatch(m) {
    return [m?.home, m?.away].some((name) => /^atl[eé]tico\s+madrid$/i.test(String(name || "").trim()));
  }

  function hasPremiumWatchTab(m) {
    return (
      isBarcelonaMatch(m)
      || isManchesterCityMatch(m)
      || isLiverpoolMatch(m)
      || isTottenhamMatch(m)
      || isAtleticoMadridMatch(m)
    );
  }

  function premiumWatchHref(m) {
    const url = new URL(watchHref(m), location.href);
    url.searchParams.set("source", "iptv-premium");
    return `${url.pathname.replace(/^\//, "")}${url.search}`;
  }

  function isCommentaryAvailable(m) {
    return window.isRecentlyEndedMatch && window.isRecentlyEndedMatch(m);
  }

  function watchAction(m) {
    if (m.status === "ended") {
      if (isCommentaryAvailable(m)) {
        return `<a class="watch-link watch-link--commentary" href="${watchHref(m)}">${ICON.mic} ${t("card.watchCommentary")}</a>`;
      }
      return `<span class="watch-link watch-link--disabled">${t("card.ended")}</span>`;
    }
    if (hasPremiumWatchTab(m)) {
      return `
        <div class="match-watch-tabs" role="group" aria-label="${t("watch.sourceTabsAria")}">
          <a class="watch-link watch-link--premium" href="${premiumWatchHref(m)}">${ICON.play} ${t("card.watchPremium")} <small>${t("card.experimental")}</small></a>
          <a class="watch-link watch-link--original" href="${watchHref(m)}">${t("card.watchOriginal")}</a>
        </div>`;
    }
    const label = m.status === "live" ? t("card.watchNow") : t("card.watch");
    return `<a class="watch-link" href="${watchHref(m)}">${ICON.play} ${label}</a>`;
  }

  function commentatorText(m) {
    if (m.commentators && m.commentators.length) {
      const names = m.commentators.map((c) => c.name);
      const extra = names.length > 1 ? ` +${names.length - 1}` : "";
      return `${names[0]}${extra}`;
    }
    return m.commentator || "";
  }

  function footMeta(m) {
    const parts = [];
    const comm = commentatorText(m);
    if (comm) parts.push(`${ICON.mic} <b>${comm}</b>`);
    if (m.channel) parts.push(`${ICON.tv} ${m.channel}`);
    if (!parts.length) parts.push(m.venue ? `${ICON.pin} ${m.venue}` : `${ICON.trophy} ${leagueLabel(m)}`);
    return parts.join(" · ");
  }

  function timeZoneChips(m, { compact = false } = {}) {
    const zones = window.getMatchTimeZones ? window.getMatchTimeZones(m) : [];
    if (!zones.length) return "";
    return `
      <div class="time-zone-row ${compact ? "compact" : ""}">
        ${zones.map((z) => `
          <div class="time-chip time-chip-${z.key}">
            <span>${compact ? z.shortLabel : z.label}</span>
            <b>${z.value}</b>
          </div>`).join("")}
      </div>`;
  }

  function competitionMark(m) {
    if (!m?.competition) return "";
    return `<span class="competition-mark competition-mark--${m.competition}" aria-hidden="true"></span>`;
  }

  function coverageBadges(m) {
    const badges = [];
    if (m.status === "live") badges.push(`<span class="coverage-badge coverage-badge--live">${t("coverage.live")}</span>`);
    if (m.lineups) badges.push(`<span class="coverage-badge">${t("coverage.lineups")}</span>`);
    if (m.stats) badges.push(`<span class="coverage-badge">${t("coverage.stats")}</span>`);
    if (m.goals?.length) badges.push(`<span class="coverage-badge">${t("coverage.goals", { n: m.goals.length })}</span>`);
    return badges.length ? `<div class="coverage-badges">${badges.join("")}</div>` : "";
  }

  /* -------------------------------------------------- Featured live (auto) */
  function renderFeaturedLive() {
    const wrap = document.getElementById("featured-live");
    if (!wrap) return;
    const live = MATCHES.filter((m) => m.status === "live");
    const recentEnded = MATCHES.filter((m) => isCommentaryAvailable(m));
    if (!live.length && !recentEnded.length) {
      wrap.innerHTML = `
        <div class="live-empty">
          <span class="live-empty-dot"></span>
          ${t("live.empty")}
        </div>`;
      return;
    }
    const liveBlock = live.length
      ? `
      <div class="featured-head"><span class="rec-dot"></span> ${t("live.now")}</div>
      <div class="featured-grid">
        ${live.map((m) => `
          <a class="featured-card" href="${watchHref(m)}">
            <div class="featured-league">${competitionMark(m)}${leagueLabel(m)}${m.minute ? ` · ${m.minute}` : ""}</div>
            <div class="featured-teams">
              <span>${teamLabel(m.home)}</span>
              <b class="featured-score">${m.score}${window.liveMinuteLabel && window.liveMinuteLabel(m) ? ` · ${window.liveMinuteLabel(m)}` : (m.minute ? ` · ${m.minute}` : "")}</b>
              <span>${teamLabel(m.away)}</span>
            </div>
            ${commentatorText(m) ? `<div class="featured-commentator">${ICON.mic} ${commentatorText(m)}</div>` : ""}
            ${timeZoneChips(m, { compact: true })}
            <div class="featured-foot">${ICON.play} ${t("card.watchNow")}</div>
          </a>`).join("")}
      </div>`
      : "";
    const endedBlock = recentEnded.length
      ? `
      <div class="featured-head featured-head--commentary"><span class="rec-dot rec-dot--muted"></span> ${t("live.recentEnded")}</div>
      <div class="featured-grid">
        ${recentEnded.map((m) => `
          <a class="featured-card featured-card--commentary" href="${watchHref(m)}">
            <div class="featured-league">${competitionMark(m)}${leagueLabel(m)} · ${t("status.ended")}</div>
            <div class="featured-teams">
              <span>${teamLabel(m.home)}</span>
              <b class="featured-score">${m.score}</b>
              <span>${teamLabel(m.away)}</span>
            </div>
            ${commentatorText(m) ? `<div class="featured-commentator">${ICON.mic} ${commentatorText(m)}</div>` : ""}
            <div class="featured-foot">${ICON.mic} ${t("card.watchCommentary")}</div>
          </a>`).join("")}
      </div>`
      : "";
    wrap.innerHTML = liveBlock + endedBlock;
    const noticeSlot = document.getElementById("match-notice-home");
    if (noticeSlot && window.MatchNotice) {
      window.MatchNotice.showForHome(noticeSlot, MATCHES).catch(() => {
        noticeSlot.innerHTML = "";
      });
    }
  }

  /* -------------------------------------------------- Live match center
     Full pitch + stats for the headline match, shown open (not tucked behind
     a toggle) right below "بث مباشر الآن" and above "مباريات اليوم". */
  function renderLiveDetail() {
    const wrap = document.getElementById("live-detail");
    if (!wrap) return;
    const section = wrap.closest("section");
    const m = MATCHES.find((x) => x.status === "live") || MATCHES.find(isCommentaryAvailable);
    const hasContent = m && (m.lineups || m.stats);
    if (!hasContent) {
      wrap.innerHTML = "";
      if (section) section.hidden = true;
      return;
    }
    if (section) section.hidden = false;

    const live = m.status === "live";
    const minute = window.liveMinuteLabel ? window.liveMinuteLabel(m) : (live && m.minute ? String(m.minute).trim() : "");
    const statusHtml = `<span class="status-pill status-${m.status}">${live ? '<span class="live-dot-i"></span> ' : ""}${statusLabel(m.status)}${minute ? ` · ${minute}` : ""}</span>`;
    const sections = [
      m.lineups ? `
        <div class="live-detail-section">
          <h3>${ICON.trophy} ${t("card.lineups")}</h3>
          ${window.buildLineupsHtml(m)}
        </div>` : "",
      m.stats ? `
        <div class="live-detail-section">
          <div id="live-stats-notice-slot" class="match-notice-slot"></div>
          <h3>${ICON.trophy} ${t("card.stats")}</h3>
          ${window.buildStatsHtml(m)}
        </div>` : "",
    ].join("");

    wrap.innerHTML = `
      <div class="live-detail-card ${live ? "is-live" : "is-ended"}">
        <div class="live-detail-top">
          ${statusHtml}
          <span class="live-detail-league">${competitionMark(m)}${leagueLabel(m)}</span>
        </div>
        <div class="live-detail-teams">
          <div class="team">
            ${crest(m.homeBadge, m.homeAbbr)}
            <div class="tname">${teamLabel(m.home)}</div>
          </div>
          <div class="live-detail-score">${m.score}</div>
          <div class="team">
            ${crest(m.awayBadge, m.awayAbbr)}
            <div class="tname">${teamLabel(m.away)}</div>
          </div>
        </div>
        ${window.buildGoalsHtml ? window.buildGoalsHtml(m) : ""}
        <div class="live-detail-meta">${footMeta(m)}</div>
        <a class="watch-link live-detail-watch" href="${watchHref(m)}">${ICON.play} ${live ? t("card.watchNow") : t("card.watchCommentary")}</a>
        ${!live && window.KZHighlights && window.KZHighlights.hasSummaryContent(m)
          ? `<div class="live-detail-section live-detail-section--highlights">
               <h3>${ICON.trophy} ${t("card.summary")}</h3>
               ${window.KZHighlights.summaryBodyHtml(m)}
             </div>`
          : ""}
        ${sections}
      </div>`;
    if (window.activateStatBars) window.activateStatBars(wrap);
    if (window.KZHighlights) window.KZHighlights.bindReplayLaunch(wrap);
    if (m.stats && window.MatchNotice) {
      const statsSlot = document.getElementById("live-stats-notice-slot");
      window.MatchNotice.showStatsBeta(statsSlot).catch(() => {
        if (statsSlot) statsSlot.innerHTML = "";
      });
    }
  }

  /* -------------------------------------------------- ملخص المباراة (summary) */
  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, (c) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ));
  }

  // Which collapsible panels are expanded, kept across the 90s auto-refresh re-render.
  const openPanels = new Set();

  function panel(id, kind, iconHtml, label, bodyHtml) {
    if (!bodyHtml) return "";
    const panelId = `${id}:${kind}`;
    const open = openPanels.has(panelId) ? " open" : "";
    return `
      <details class="match-panel" data-panel-id="${panelId}"${open}>
        <summary class="match-panel-toggle">${iconHtml} ${label}</summary>
        <div class="match-panel-body">${bodyHtml}</div>
      </details>`;
  }

  function matchSummaryHtml(m) {
    const H = window.KZHighlights;
    if (!H || !H.hasSummaryContent(m)) return "";
    return panel(m.id, "summary", ICON.trophy, t("card.summary"), H.summaryBodyHtml(m));
  }

  function matchLineupsHtml(m) {
    if (!m.lineups) return "";
    return panel(m.id, "lineups", ICON.trophy, t("card.lineups"), window.buildLineupsHtml(m));
  }

  function matchStatsHtml(m) {
    if (!m.stats || (m.status !== "live" && m.status !== "ended")) return "";
    return panel(m.id, "stats", ICON.trophy, t("card.stats"), window.buildStatsHtml(m));
  }

  // `toggle` on <details> doesn't bubble, so track it in the capture phase.
  function initPanelToggles() {
    document.addEventListener("toggle", (e) => {
      const el = e.target;
      if (!el.classList || !el.classList.contains("match-panel")) return;
      const id = el.dataset.panelId;
      if (!id) return;
      if (el.open) {
        openPanels.add(id);
        if (window.activateStatBars) window.activateStatBars(el);
      } else {
        openPanels.delete(id);
      }
    }, true);
  }

  /* -------------------------------------------------- Matches rendering */
  function matchCard(m) {
    const liveBtn = watchAction(m);
    const minute = window.liveMinuteLabel ? window.liveMinuteLabel(m) : (m.status === "live" && m.minute ? String(m.minute).trim() : "");
    const minuteSuffix = minute ? ` · ${minute}` : "";
    return `
      <article class="match-card competition-${m.competition || "other"}${m.status === "live" ? " is-live" : ""}" data-status="${m.status}" data-competition="${m.competition || "other"}">
        <div class="match-top">
          <span class="league-tag">${competitionMark(m)}${leagueLabel(m)}</span>
          <span class="match-top-end">
            <span class="status-pill status-${m.status}">${statusLabel(m.status)}${minuteSuffix}</span>
            ${favStar(m)}
          </span>
        </div>
        <div class="teams">
          <div class="team">
            ${crest(m.homeBadge, m.homeAbbr)}
            <div class="tname">${teamLabel(m.home)}</div>
          </div>
          <div class="score">${m.score}</div>
          <div class="team">
            ${crest(m.awayBadge, m.awayAbbr)}
            <div class="tname">${teamLabel(m.away)}</div>
          </div>
        </div>
        ${window.buildGoalsHtml ? window.buildGoalsHtml(m) : ""}
        ${coverageBadges(m)}
        ${timeZoneChips(m)}
        <div class="match-foot">
          <span class="match-meta">${footMeta(m)}</span>
          ${liveBtn}
        </div>
        ${matchLineupsHtml(m)}
        ${matchStatsHtml(m)}
        ${matchSummaryHtml(m)}
        ${window.KZMatchMemes ? window.KZMatchMemes.panelShell(m) : ""}
      </article>`;
  }

  function arabiaDayKey(kickoffUtc) {
    const kickoff = Date.parse(kickoffUtc || "");
    if (Number.isNaN(kickoff)) return "";
    return new Date(kickoff + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }

  function shiftIsoDay(day, offset) {
    const d = new Date(`${day}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + offset);
    return d.toISOString().slice(0, 10);
  }

  function scheduleDayLabel(day) {
    if (!day) return t("schedule.other");
    const today = arabiaDayKey(new Date().toISOString());
    const prefix = day === today
      ? t("schedule.today")
      : day === shiftIsoDay(today, 1)
        ? t("schedule.tomorrow")
        : day === shiftIsoDay(today, -1)
          ? t("schedule.yesterday")
          : "";
    const locale = window.I18N?.lang === "en" ? "en-GB" : "ar";
    const formatted = new Intl.DateTimeFormat(locale, {
      weekday: "long",
      day: "numeric",
      month: "short",
    }).format(new Date(`${day}T12:00:00Z`));
    return prefix ? `${prefix} · ${formatted}` : formatted;
  }

  function scheduleGroupsHtml(matches) {
    const groups = new Map();
    for (const match of matches) {
      const day = arabiaDayKey(match.kickoffUtc);
      if (!groups.has(day)) groups.set(day, []);
      groups.get(day).push(match);
    }
    const today = arabiaDayKey(new Date().toISOString());
    const rank = (day) => {
      if (!day) return Number.MAX_SAFE_INTEGER;
      if (day === today) return 0;
      if (day > today) return 1 + (Date.parse(day) - Date.parse(today));
      return 1e12 + (Date.parse(today) - Date.parse(day));
    };
    return [...groups.entries()]
      .sort(([a], [b]) => rank(a) - rank(b))
      .map(([day, dayMatches]) => `
        <section class="schedule-day" data-day="${day}">
          <div class="schedule-day-head">
            <h3>${scheduleDayLabel(day)}</h3>
            <span>${t("matches.count", { n: dayMatches.length })}</span>
          </div>
          <div class="matches">${dayMatches.map(matchCard).join("")}</div>
        </section>`)
      .join("");
  }

  function renderMatches(filter) {
    const grid = document.getElementById("matches-grid");
    if (!grid) return;
    const statusFilter = filter || activeStatusFilter;
    const list = MATCHES.filter((m) => {
      const statusMatch = statusFilter === "all" || m.status === statusFilter;
      const leagueMatch = activeCompetitionFilter === "all" || m.competition === activeCompetitionFilter;
      return statusMatch && leagueMatch;
    });
    grid.innerHTML = list.length
      ? scheduleGroupsHtml(list)
      : `<p style="color:var(--muted)">${t("matches.none")}</p>`;
    // Panels re-opened from `openPanels` state don't fire a native `toggle`
    // event (that only fires on user interaction), so activate their bars here.
    if (window.activateStatBars) {
      grid.querySelectorAll(".match-panel[open]").forEach((el) => window.activateStatBars(el));
    }
    if (window.KZMatchMemes) {
      window.KZMatchMemes.hydrateMatchMemes(grid, list).catch(() => { /* optional */ });
    }
    if (window.KZHighlights) window.KZHighlights.bindReplayLaunch(grid);
    const count = document.getElementById("matches-count");
    if (count) count.textContent = t("matches.count", { n: list.length });
    updateCompetitionCounts();
  }

  /* -------------------------------------------------- Saved matches */
  function savedCard(m) {
    const liveBtn = watchAction(m);
    return `
      <article class="match-card saved-card">
        <div class="match-top">
          <span class="league-tag">${competitionMark(m)}${leagueLabel(m)}</span>
          <button class="fav-star is-saved" data-unsave-id="${m.id}" type="button"
            aria-label="${t("card.removeSaved")}" title="${t("card.removeSaved")}">${ICON.trash}</button>
        </div>
        <div class="teams">
          <div class="team">${crest(m.homeBadge, m.homeAbbr)}<div class="tname">${teamLabel(m.home)}</div></div>
          <div class="score">×</div>
          <div class="team">${crest(m.awayBadge, m.awayAbbr)}<div class="tname">${teamLabel(m.away)}</div></div>
        </div>
        <div class="match-foot">
          <span class="match-meta">${m.channel ? `${ICON.tv} ${m.channel}` : ""}</span>
          ${liveBtn}
        </div>
      </article>`;
  }

  function renderSaved() {
    const section = document.getElementById("saved");
    const grid = document.getElementById("saved-grid");
    if (!section || !grid || !window.KZFav) return;
    const saved = window.KZFav.list();
    section.hidden = saved.length === 0;
    grid.innerHTML = saved.map(savedCard).join("");
  }

  // One delegated handler covers ☆ on match cards and the remove button in the
  // saved section, even though both grids re-render on the live refresh.
  function initFavorites() {
    if (!window.KZFav) return;
    document.addEventListener("click", (e) => {
      const star = e.target.closest("[data-fav-id]");
      if (star) {
        const m = MATCHES.find((x) => x.id === star.dataset.favId);
        if (m) window.KZFav.toggle(m);
        return;
      }
      const rm = e.target.closest("[data-unsave-id]");
      if (rm) window.KZFav.remove(rm.dataset.unsaveId);
    });
    // Re-paint stars + saved list whenever the favorites change.
    window.KZFav.subscribe(() => { renderMatches(activeStatusFilter); renderFeaturedLive(); renderSaved(); });
  }

  /* -------------------------------------------------- Filters */
  let activeStatusFilter = "all";
  let activeCompetitionFilter = "all";

  function updateCompetitionCounts() {
    document.querySelectorAll("[data-league-filter]").forEach((btn) => {
      const key = btn.dataset.leagueFilter;
      const count = key === "all"
        ? MATCHES.length
        : MATCHES.filter((m) => m.competition === key).length;
      const el = btn.querySelector("[data-league-count]");
      if (el) el.textContent = count;
      btn.hidden = key !== "all" && count === 0;
    });
  }

  function initFilters() {
    document.querySelectorAll("[data-status-filter]").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("[data-status-filter]").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        activeStatusFilter = btn.dataset.statusFilter;
        renderMatches(activeStatusFilter);
      });
    });
    document.querySelectorAll("[data-league-filter]").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("[data-league-filter]").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        activeCompetitionFilter = btn.dataset.leagueFilter;
        renderMatches(activeStatusFilter);
      });
    });
    document.querySelectorAll("[data-league-jump]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const filter = document.querySelector(`[data-league-filter="${btn.dataset.leagueJump}"]`);
        if (filter && !filter.hidden) filter.click();
        document.getElementById("matches")?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
  }

  /* -------------------------------------------------- Mobile nav */
  function initNav() {
    const toggle = document.querySelector(".nav-toggle");
    const links = document.querySelector(".nav-links");
    if (toggle && links) toggle.addEventListener("click", () => links.classList.toggle("open"));
  }

  function showUpdated(meta) {
    const el = document.getElementById("updated-at");
    if (!el) return;
    if (meta.live && meta.updatedAt) {
      const d = new Date(meta.updatedAt);
      const src = meta.sourceLabel || "TheSportsDB";
      const locale = (window.I18N && window.I18N.lang === "en") ? "en" : "ar";
      el.innerHTML = `${t("updated.prefix")} <b>${src}</b> · ${t("updated.lastUpdate")} ${d.toLocaleString(locale)} · <span class="live-refresh-dot"></span> ${t("updated.auto")}`;
    } else {
      el.textContent = t("updated.demo");
    }
  }

  async function refreshLiveMatchPanels() {
    const headline = MATCHES.find((m) => m.status === "live") || MATCHES.find((m) => m.status === "upcoming");
    if (!headline || !window.MatchDetailAPI) return;
    const before = { lineups: headline.lineups, stats: headline.stats };
    try {
      const enriched = await window.MatchDetailAPI.enrichMatch(headline, { force: true });
      const changed = JSON.stringify(before.lineups) !== JSON.stringify(enriched.lineups)
        || JSON.stringify(before.stats) !== JSON.stringify(enriched.stats);
      if (!changed) return;
      const idx = MATCHES.findIndex((m) => m.id === headline.id);
      if (idx >= 0) MATCHES[idx] = enriched;
      renderFeaturedLive();
      renderLiveDetail();
    } catch (e) {
      console.warn("Live detail refresh failed:", e.message);
    }
  }

  async function loadMatches({ force } = {}) {
    const meta = await window.getMatches({ force });
    MATCHES = meta.matches;
    showUpdated(meta);
    renderFeaturedLive();
    renderLiveDetail();
    renderMatches(activeStatusFilter);
    renderSaved();
    const defer = window.requestIdleCallback || ((cb) => setTimeout(cb, 150));
    defer(() => { if (window.loadRecentTweets) window.loadRecentTweets().catch(() => {}); });
    return meta;
  }

  window.__kzOnMatchesUpdated = (matches) => {
    MATCHES = matches;
    renderFeaturedLive();
    renderLiveDetail();
    renderMatches(activeStatusFilter);
  };

  document.addEventListener("DOMContentLoaded", async () => {
    initFilters();
    initNav();
    initFavorites();
    initPanelToggles();
    renderSaved();
    await loadMatches();
    const pollMatches = async () => {
      const delay = MATCHES.some((m) => m.status === "live") ? 30 * 1000 : 90 * 1000;
      setTimeout(async () => {
        try {
          await loadMatches({ force: true });
        } finally {
          pollMatches();
        }
      }, delay);
    };
    pollMatches();
    setInterval(() => {
      const defer = window.requestIdleCallback || ((cb) => setTimeout(cb, 0));
      defer(() => { if (window.loadRecentTweets) window.loadRecentTweets().catch(() => {}); });
    }, 10 * 60 * 1000);
    setInterval(() => {
      if (MATCHES.some((m) => m.status === "live")) refreshLiveMatchPanels().catch(() => {});
    }, 30 * 1000);
  });
})();
