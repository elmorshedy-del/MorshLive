/* highlight-banners.js — home page: ended-match ملخص banners by day (fast static JSON) */
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

  function formatDay(dateStr) {
    if (!dateStr) return "";
    try {
      const d = new Date(`${dateStr}T12:00:00Z`);
      const lang = document.documentElement.lang === "en" ? "en-GB" : "ar";
      return d.toLocaleDateString(lang, { weekday: "short", day: "numeric", month: "short" });
    } catch { return dateStr; }
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

  function bannerCard(m) {
    const label = `${teamLabel(m.home)} ${m.score ? m.score : "vs"} ${teamLabel(m.away)}`;
    const href = `tournament.html?match=${encodeURIComponent(m.key)}`;
    const poster = m.poster
      ? `<img class="kz-hl-banner__poster" src="${escapeHtml(m.poster.replace(/&amp;/g, "&"))}" alt="" loading="lazy" />`
      : `<span class="kz-hl-banner__poster kz-hl-banner__poster--fallback" aria-hidden="true">▶</span>`;
    return `
      <a class="kz-hl-banner" href="${href}">
        ${poster}
        <span class="kz-hl-banner__shade"></span>
        <span class="kz-hl-banner__play" aria-hidden="true">▶</span>
        <span class="kz-hl-banner__teams">${escapeHtml(label)}</span>
        <span class="kz-hl-banner__cta">${t("home.highlightBannerCta")} →</span>
      </a>`;
  }

  function renderBanners(data) {
    const section = document.getElementById("highlight-banners");
    const host = document.getElementById("highlight-banners-days");
    if (!section || !host) return;

    const days = (data && data.days) || [];
    const recent = days.filter((d) => d.matches && d.matches.length).slice(0, 7);
    if (!recent.length) {
      section.hidden = true;
      return;
    }

    section.hidden = false;
    host.innerHTML = recent.map((day) => `
      <div class="kz-hl-day" data-date="${escapeHtml(day.date)}">
        <div class="kz-hl-day__head">
          <h3 class="kz-hl-day__title">${escapeHtml(formatDay(day.date))}</h3>
          <span class="kz-hl-day__count">${t("home.highlightBannerDayCount", { n: day.matches.length })}</span>
        </div>
        <div class="kz-hl-day__rail">${day.matches.map(bannerCard).join("")}</div>
      </div>`).join("");
  }

  async function loadHighlightBanners() {
    const data = await loadBannersData();
    renderBanners(data);
    return data;
  }

  window.loadHighlightBanners = loadHighlightBanners;

  document.addEventListener("DOMContentLoaded", () => {
    loadHighlightBanners().catch(() => { /* optional */ });
  });
})();
