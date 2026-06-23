/* ============================================================================
 * app.js — renders the home page (matches + channels) and handles UI.
 * Match data is loaded live from assets/data/today.json via window.getMatches().
 * ==========================================================================*/
(function () {
  const { CHANNELS } = window.SITE_DATA;
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

  function footMeta(m) {
    const parts = [];
    if (m.channel) parts.push(`📺 <b>${m.channel}</b>`);
    if (m.commentator) parts.push(`🎙️ ${m.commentator}`);
    if (!parts.length) parts.push(m.venue ? `🏟️ ${m.venue}` : `🏆 ${m.league}`);
    return parts.join(" · ");
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
          <div class="score">${m.score}<small>${m.time}</small></div>
          <div class="team">
            ${crest(m.awayBadge, m.awayAbbr)}
            <div class="tname">${m.away}</div>
          </div>
        </div>
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

  /* -------------------------------------------------- Channels rendering */
  function channelMark(name) {
    return (name || "")
      .replace(/[^A-Za-z0-9 ]/g, "")
      .split(/\s+/)
      .filter(Boolean)
      .map((part) => part[0])
      .join("")
      .slice(0, 3)
      .toUpperCase() || "ML";
  }

  function channelCard(c) {
    return `
      <a class="channel-card" href="watch.html?ch=${c.id}">
        ${c.badge ? `<span class="badge">${c.badge}</span>` : ""}
        <div class="logo-box" aria-hidden="true"><span>${channelMark(c.name)}</span></div>
        <div class="cname">${c.name}</div>
        <div class="cmeta">${c.quality} · ${c.group}</div>
      </a>`;
  }

  function renderChannels() {
    const grid = document.getElementById("channels-grid");
    if (!grid) return;
    grid.innerHTML = CHANNELS.map(channelCard).join("");
    const count = document.getElementById("channels-count");
    if (count) count.textContent = `${CHANNELS.length} قناة`;
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
    renderChannels();
    initFilters();
    initNav();
    await loadMatches();
    setInterval(() => loadMatches({ force: true }), 90 * 1000);
  });
})();
