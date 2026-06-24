/* ============================================================================
 * app.js — renders the home page (matches + channels) and handles UI.
 * Match data is loaded live from assets/data/today.json via window.getMatches().
 * ==========================================================================*/
(function () {
  let MATCHES = [];

  const statusLabel = { live: "مباشر الآن", upcoming: "لم تبدأ", ended: "انتهت" };

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
    if (comm) parts.push(`🎙️ <b>${comm}</b>`);
    if (m.channel) parts.push(`📺 ${m.channel}`);
    if (!parts.length) parts.push(m.venue ? `🏟️ ${m.venue}` : `🏆 ${m.league}`);
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
            ${commentatorText(m) ? `<div class="featured-commentator">🎙️ ${commentatorText(m)}</div>` : ""}
            ${timeZoneChips(m, { compact: true })}
            <div class="featured-foot">▶ شاهد الآن</div>
          </a>`).join("")}
      </div>`;
  }

  /* -------------------------------------------------- Matches rendering */
  function matchCard(m) {
    const liveBtn = m.status === "ended"
      ? `<span class="watch-link" style="background:var(--surface-2);color:var(--muted)">انتهت</span>`
      : `<a class="watch-link" href="${watchHref(m)}">▶ مشاهدة</a>`;
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
