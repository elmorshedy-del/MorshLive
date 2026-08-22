/* highlight-banners.js — home page: ended-match ملخص banners by day.
 * Club fixtures play in the replay modal. World Cup rows keep the archive href.
 * Embed URL rules live in lib/highlight-embed.js — keep this file in sync. */
(function () {
  "use strict";

  const t = (k, vars) => (window.I18N && window.I18N.t(k, vars)) || k;
  const teamLabel = (n) => (window.TeamNames && window.TeamNames.localize(n)) || n;

  let _cache = null;
  let _cacheAt = 0;

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, (c) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ));
  }

  const HIGHLIGHT_BANNER_DAYS = 3;

  function arabiaTodayIso() {
    return new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }

  function arabiaDayIso(kickoffUtc) {
    const ms = Date.parse(kickoffUtc);
    if (!ms) return "";
    return new Date(ms + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }

  function rollingBannerDates(refDay, count) {
    const out = [];
    for (let i = 0; i < count; i++) {
      const d = new Date(`${refDay}T12:00:00Z`);
      d.setUTCDate(d.getUTCDate() - i);
      out.push(d.toISOString().slice(0, 10));
    }
    return out;
  }

  function bannerDayAllowed(dateStr) {
    return rollingBannerDates(arabiaTodayIso(), HIGHLIGHT_BANNER_DAYS).includes(dateStr);
  }

  function formatDay(dateStr) {
    if (!dateStr) return "";
    try {
      const d = new Date(`${dateStr}T12:00:00Z`);
      const lang = document.documentElement.lang === "en" ? "en-GB" : "ar";
      return d.toLocaleDateString(lang, { weekday: "short", day: "numeric", month: "short" });
    } catch { return dateStr; }
  }

  function pairKey(home, away) {
    const token = (s) => String(s || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
    return [token(home), token(away)].sort().join("~");
  }

  function isWorldCupBanner(m) {
    if (!m) return false;
    if (m.leagueSlug === "fifa.world" || m.competition === "wc") return true;
    if (/^espn-fifa\.world-/.test(m.id || "")) return true;
    return /fifa\.world|world cup|كأس العالم|المونديال/i.test(
      `${m.league || ""} ${m.leagueAr || ""} ${m.stage || ""}`
    );
  }

  function leagueLabel(m) {
    const english = document.documentElement.lang === "en";
    return (english ? (m.league || m.leagueAr) : (m.leagueAr || m.league)) || "";
  }

  function bannerMedia(m) {
    if (m.embed) return { embed: m.embed, poster: m.poster || "" };
    const full = m.highlights?.full || m.highlight;
    const goals = m.highlights?.goals;
    const clip = full || goals;
    return {
      embed: clip?.videoUrl || "",
      poster: m.poster || clip?.thumbnail || "",
    };
  }

  function replayUrl(embed) {
    if (window.KZHighlights?.replayEmbedUrl) return window.KZHighlights.replayEmbedUrl(embed);
    return embed;
  }

  function bannerHref(m) {
    if (!isWorldCupBanner(m)) return "";
    return window.TeamNames?.matchPageHref?.(m)
      || (m.key ? `/tournament?match=${encodeURIComponent(m.key)}` : "");
  }

  async function loadBannersData() {
    if (_cache && Date.now() - _cacheAt < 5 * 60 * 1000) return _cache;
    try {
      const res = await fetch("/assets/data/highlights-banners.json", { cache: "default" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      _cache = await res.json();
      _cacheAt = Date.now();
    } catch {
      _cache = _cache || { days: [] };
    }
    return _cache;
  }

  async function loadEndedMatches() {
    try {
      if (typeof window.getMatches === "function") {
        const meta = await window.getMatches();
        return (meta.matches || []).filter((m) => m.status === "ended");
      }
    } catch { /* fall through to static cache */ }
    try {
      const res = await fetch("/assets/data/today.json", { cache: "default" });
      if (!res.ok) return [];
      const data = await res.json();
      return (data.matches || []).filter((m) => m.status === "ended");
    } catch {
      return [];
    }
  }

  function rowFromMatch(m) {
    const media = bannerMedia(m);
    if (!media.embed) return null;
    const day = arabiaDayIso(m.kickoffUtc);
    if (!day || !bannerDayAllowed(day)) return null;
    return {
      date: day,
      match: {
        key: m.key || pairKey(m.home, m.away),
        home: m.home,
        away: m.away,
        score: m.score || "",
        kickoffUtc: m.kickoffUtc,
        poster: media.poster,
        embed: media.embed,
        stage: m.stage || "",
        league: m.league || "",
        leagueAr: m.leagueAr || "",
        competition: m.competition || "",
        leagueSlug: m.leagueSlug || "",
        id: m.id || "",
      },
    };
  }

  function mergeTodayIntoBanners(data, ended) {
    const daysMap = new Map();
    for (const day of (data && data.days) || []) {
      if (!day?.date || !bannerDayAllowed(day.date)) continue;
      daysMap.set(day.date, [...(day.matches || [])]);
    }
    for (const m of ended || []) {
      const row = rowFromMatch(m);
      if (!row) continue;
      const list = daysMap.get(row.date) || [];
      const idx = list.findIndex((item) => item.key === row.match.key);
      if (idx >= 0) list[idx] = { ...list[idx], ...row.match };
      else list.push(row.match);
      daysMap.set(row.date, list);
    }
    const days = [...daysMap.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([date, matches]) => ({
        date,
        matches: matches.sort((a, b) => Date.parse(b.kickoffUtc || 0) - Date.parse(a.kickoffUtc || 0)),
      }));
    return { updatedAt: (data && data.updatedAt) || new Date().toISOString(), days };
  }

  function bannerCard(m, eager) {
    const label = `${teamLabel(m.home)} ${m.score ? m.score : "vs"} ${teamLabel(m.away)}`;
    const league = leagueLabel(m);
    const href = bannerHref(m);
    const embed = m.embed ? replayUrl(m.embed) : "";
    const poster = m.poster
      ? `<img class="kz-hl-banner__poster" src="${escapeHtml(m.poster.replace(/&amp;/g, "&"))}" alt="" loading="${eager ? "eager" : "lazy"}"${eager ? ' fetchpriority="high"' : ""} />`
      : `<span class="kz-hl-banner__poster kz-hl-banner__poster--fallback" aria-hidden="true">▶</span>`;
    const inner = `
        ${poster}
        <span class="kz-hl-banner__shade"></span>
        <span class="kz-hl-banner__play" aria-hidden="true">▶</span>
        ${league ? `<span class="kz-hl-banner__league">${escapeHtml(league)}</span>` : ""}
        <span class="kz-hl-banner__teams">${escapeHtml(label)}</span>
        <span class="kz-hl-banner__cta">${t("home.highlightBannerCta")} →</span>`;
    if (embed) {
      return `
      <button type="button" class="kz-hl-banner match-replay-launch" data-embed="${escapeHtml(embed)}" aria-label="${escapeHtml(label)}">
        ${inner}
      </button>`;
    }
    if (href) {
      return `
      <a class="kz-hl-banner" href="${href}">
        ${inner}
      </a>`;
    }
    return "";
  }

  function renderBanners(data) {
    const section = document.getElementById("highlight-banners");
    const host = document.getElementById("highlight-banners-days");
    if (!section || !host) return;

    const days = ((data && data.days) || [])
      .map((day) => ({
        ...day,
        matches: (day.matches || []).filter((m) => m && (m.embed || bannerHref(m))),
      }))
      .filter((d) => d.matches.length && bannerDayAllowed(d.date))
      .slice(0, HIGHLIGHT_BANNER_DAYS);
    if (!days.length) {
      section.hidden = true;
      return;
    }

    section.hidden = false;
    host.innerHTML = days.map((day) => `
      <div class="kz-hl-day" data-date="${escapeHtml(day.date)}">
        <div class="kz-hl-day__head">
          <h3 class="kz-hl-day__title">${escapeHtml(formatDay(day.date))}</h3>
          <span class="kz-hl-day__count">${t("home.highlightBannerDayCount", { n: day.matches.length })}</span>
        </div>
        <div class="kz-hl-day__rail">${day.matches.map((m, i) => bannerCard(m, i === 0 && day === days[0])).join("")}</div>
      </div>`).join("");
    if (window.KZHighlights) window.KZHighlights.bindReplayLaunch(host);
  }

  async function loadHighlightBanners() {
    const [data, ended] = await Promise.all([loadBannersData(), loadEndedMatches()]);
    const merged = mergeTodayIntoBanners(data, ended);
    renderBanners(merged);
    return merged;
  }

  window.loadHighlightBanners = loadHighlightBanners;

  document.addEventListener("DOMContentLoaded", () => {
    loadHighlightBanners().catch(() => { /* optional */ });
  });
})();
