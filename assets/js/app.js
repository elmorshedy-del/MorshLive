/* ============================================================================
 * app.js — renders the home page (matches + channels) and handles UI.
 * Match data is loaded live from assets/data/today.json via window.getMatches().
 * ==========================================================================*/
(function () {
  let MATCHES = [];

  const statusLabel = { live: "مباشر الآن", upcoming: "لم تبدأ", ended: "انتهت" };

  const ICON = {
    mic: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/></svg>',
    play: '<svg class="ico ico-fill" viewBox="0 0 24 24" aria-hidden="true"><polygon points="6 3 20 12 6 21 6 3"/></svg>',
    trophy: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.7V17c0 .6-.5 1-1 1.2C7.9 18.8 7 20.2 7 22"/><path d="M14 14.7V17c0 .6.5 1 1 1.2 1.1.6 2 2 2 2.8"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg>',
    pin: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>',
    tv: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="7" width="20" height="15" rx="2"/><polyline points="17 2 12 7 7 2"/></svg>',
  };

  function crest(badge, ab) {
    return badge
      ? `<div class="crest"><img src="${badge}" alt="" loading="lazy"></div>`
      : `<div class="crest">${ab || "?"}</div>`;
  }

  // Where a match's watch button points. Real fixtures have no channel mapping,
  // so they open the auto-live player; sample data keeps its channel link.
  function watchHref(m) {
    return m.channelId
      ? `watch.html?ch=${m.channelId}&match=${m.id}`
      : `watch.html?ch=live&match=${m.id}`;
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
    if (!parts.length) parts.push(m.venue ? `${ICON.pin} ${m.venue}` : `${ICON.trophy} ${m.league || ""}`);
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

  /* -------------------------------------------------- Featured live (auto) */
  function renderFeaturedLive() {
    const wrap = document.getElementById("featured-live");
    if (!wrap) return;
    const live = MATCHES.filter((m) => m.status === "live");
    if (!live.length) {
      wrap.innerHTML = `
        <div class="live-empty">
          <span class="live-empty-dot"></span>
          لا توجد مباريات مباشرة الآن — تابع مباريات اليوم بالأسفل.
        </div>`;
      return;
    }
    wrap.innerHTML = `
      <div class="featured-head"><span class="rec-dot"></span> مباشر الآن</div>
      <div class="featured-grid">
        ${live.map((m) => `
          <a class="featured-card" href="${watchHref(m)}">
            <div class="featured-league">${m.league}${m.minute ? ` · ${m.minute}` : ""}</div>
            <div class="featured-teams">
              <span>${m.home}</span>
              <b class="featured-score">${m.score}</b>
              <span>${m.away}</span>
            </div>
            ${commentatorText(m) ? `<div class="featured-commentator">${ICON.mic} ${commentatorText(m)}</div>` : ""}
            ${timeZoneChips(m, { compact: true })}
            <div class="featured-foot">${ICON.play} شاهد الآن</div>
          </a>`).join("")}
      </div>`;
  }

  /* -------------------------------------------------- Matches rendering */
  function matchCard(m) {
    const liveBtn = m.status === "ended"
      ? `<span class="watch-link" style="background:var(--surface-2);color:var(--muted)">انتهت</span>`
      : `<a class="watch-link" href="${watchHref(m)}">${ICON.play} مشاهدة</a>`;
    const minute = m.status === "live" && m.minute ? ` · ${m.minute}` : "";
    return `
      <article class="match-card" data-status="${m.status}">
        <div class="match-top">
          <span class="league-tag">${m.league}</span>
          <span class="status-pill status-${m.status}">${statusLabel[m.status]}${minute}</span>
        </div>
        <div class="teams">
          <div class="team">
            ${crest(m.homeBadge, m.homeAbbr)}
            <div class="tname">${m.home}</div>
          </div>
          <div class="score">${m.score}</div>
          <div class="team">
            ${crest(m.awayBadge, m.awayAbbr)}
            <div class="tname">${m.away}</div>
          </div>
        </div>
        ${timeZoneChips(m)}
        <div class="match-foot">
          <span class="match-meta">${footMeta(m)}</span>
          ${liveBtn}
        </div>
      </article>`;
  }

  function renderMatches(filter) {
    const grid = document.getElementById("matches-grid");
    if (!grid) return;
    const list = filter && filter !== "all"
      ? MATCHES.filter((m) => m.status === filter)
      : MATCHES;
    grid.innerHTML = list.length
      ? list.map(matchCard).join("")
      : `<p style="color:var(--muted)">لا توجد مباريات في هذا التصنيف.</p>`;
    const count = document.getElementById("matches-count");
    if (count) count.textContent = `${list.length} مباراة`;
  }

  /* -------------------------------------------------- Filters */
  let activeFilter = "all";

  function initFilters() {
    document.querySelectorAll(".filter-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".filter-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        activeFilter = btn.dataset.filter;
        renderMatches(activeFilter);
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
      el.innerHTML = `مصدر: <b>${src}</b> · آخر تحديث ${d.toLocaleString("ar")} · <span class="live-refresh-dot"></span> يتحدث تلقائياً`;
    } else {
      el.textContent = "بيانات تجريبية (تعذّر تحميل الجدول المباشر)";
    }
  }

  async function loadMatches({ force } = {}) {
    const meta = await window.getMatches({ force });
    MATCHES = meta.matches;
    showUpdated(meta);
    renderFeaturedLive();
    renderMatches(activeFilter);
    return meta;
  }

  document.addEventListener("DOMContentLoaded", async () => {
    initFilters();
    initNav();
    await loadMatches();
    setInterval(() => loadMatches({ force: true }), 90 * 1000);
  });
})();
