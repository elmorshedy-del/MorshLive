/* Current-season highlights / match recap page. World Cup content is deliberately excluded. */
(function () {
  "use strict";

  const SUPPORTED = new Set(["epl", "laliga", "ucl"]);
  let allMatches = [];
  let activeCompetition = "all";

  function isEnglish() {
    return (window.I18N && window.I18N.lang === "en") || document.documentElement.lang === "en";
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]
    ));
  }

  function teamLabel(name) {
    return window.TeamNames ? window.TeamNames.localize(name) : name;
  }

  function competitionLabel(m) {
    const key = m.competition;
    const map = isEnglish()
      ? { epl: "Premier League", laliga: "La Liga", spl: "Saudi Pro League", ucl: "UEFA Champions League" }
      : { epl: "الدوري الإنجليزي الممتاز", laliga: "الدوري الإسباني", spl: "الدوري السعودي", ucl: "دوري أبطال أوروبا" };
    return map[key] || (isEnglish() ? m.league : (m.leagueAr || m.league)) || "";
  }

  function isWorldCup(m) {
    if (!m) return false;
    if (m.competition === "wc" || m.leagueSlug === "fifa.world") return true;
    if (/^espn-fifa\.world-/.test(m.id || "")) return true;
    return /world cup|كأس العالم|المونديال/i.test(`${m.league || ""} ${m.leagueAr || ""}`);
  }

  function pairKey(m) {
    if (m.id) return `id:${m.id}`;
    if (m.key) return `key:${m.key}`;
    if (window.TeamNames?.canonicalKey) return `pair:${window.TeamNames.canonicalKey(m.home, m.away)}`;
    return `pair:${[m.home, m.away].sort().join("~").toLowerCase()}`;
  }

  function arabiaDayIso(iso) {
    const ms = Date.parse(iso || "");
    if (Number.isNaN(ms)) return "";
    return new Date(ms + 3 * 3600e3).toISOString().slice(0, 10);
  }

  function formatDay(day) {
    if (!day) return "";
    try {
      return new Intl.DateTimeFormat(isEnglish() ? "en-GB" : "ar", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      }).format(new Date(`${day}T12:00:00Z`));
    } catch {
      return day;
    }
  }

  function scoreParts(score) {
    const hit = String(score || "").match(/(\d+)\s*[-–]\s*(\d+)/);
    return hit ? [Number(hit[1]), Number(hit[2])] : null;
  }

  function fallbackSummary(m) {
    const home = teamLabel(m.home);
    const away = teamLabel(m.away);
    const parts = scoreParts(m.score);
    if (!parts) {
      return isEnglish()
        ? `${home} vs ${away} — match recap and available highlights.`
        : `مراجعة مباراة ${home} و${away} وأبرز اللقطات المتاحة.`;
    }
    const [h, a] = parts;
    if (h === a) {
      return isEnglish()
        ? `${home} and ${away} drew ${h}–${a}.`
        : `تعادل ${home} و${away} بنتيجة ${h}-${a}.`;
    }
    const winner = h > a ? home : away;
    const loser = h > a ? away : home;
    const ws = Math.max(h, a);
    const ls = Math.min(h, a);
    return isEnglish()
      ? `${winner} beat ${loser} ${ws}–${ls}.`
      : `فاز ${winner} على ${loser} بنتيجة ${ws}-${ls}.`;
  }

  function bannerToMatch(row, day) {
    if (!row?.home || !row?.away) return null;
    const videoUrl = row.embed || "";
    return {
      ...row,
      status: "ended",
      kickoffUtc: row.kickoffUtc || `${day}T12:00:00Z`,
      highlight: videoUrl ? { videoUrl, thumbnail: row.poster || "", title: "" } : null,
    };
  }

  function flattenHighlightDoc(data) {
    return (data?.days || [])
      .flatMap((day) => (day.matches || []).map((m) => bannerToMatch(m, day.date)))
      .filter(Boolean);
  }

  async function fetchHighlightDoc(url) {
    try {
      const res = await fetch(url, { cache: "default" });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  async function loadStaticHighlights() {
    const season = await fetchHighlightDoc("/assets/data/season-highlights.json");
    if (season?.days?.length) return flattenHighlightDoc(season);
    const recent = await fetchHighlightDoc("/assets/data/highlights-banners.json");
    return flattenHighlightDoc(recent);
  }

  async function loadLiveEnded() {
    try {
      if (typeof window.getMatches !== "function") return [];
      const meta = await window.getMatches({ force: false });
      return (meta.matches || []).filter((m) => m.status === "ended");
    } catch {
      return [];
    }
  }

  function mergeMatches(staticRows, liveRows) {
    const byKey = new Map();
    for (const m of [...staticRows, ...liveRows]) {
      if (!m || isWorldCup(m) || !SUPPORTED.has(m.competition)) continue;
      const key = pairKey(m);
      const prev = byKey.get(key) || {};
      byKey.set(key, {
        ...prev,
        ...m,
        highlight: m.highlight || prev.highlight,
        highlights: m.highlights || prev.highlights,
        clips: m.clips?.length ? m.clips : prev.clips,
        summaryAr: m.summaryAr || prev.summaryAr,
      });
    }
    return [...byKey.values()].sort((a, b) => Date.parse(b.kickoffUtc || 0) - Date.parse(a.kickoffUtc || 0));
  }

  function copy() {
    return isEnglish()
      ? {
          kicker: "2026/27 season",
          title: "Highlights & match recaps",
          lede: "A dedicated home for current-season recaps: results, key moments, goals and available video from the Premier League, La Liga and UEFA Champions League.",
          count: (n) => `${n} recap${n === 1 ? "" : "s"}`,
          dayCount: (n) => `${n} match${n === 1 ? "" : "es"}`,
          empty: "No current-season recaps are available for this filter yet.",
          wcTitle: "Looking for World Cup 2026 highlights?",
          wcBody: "The tournament has its own permanent 104-match archive.",
          wcCta: "Open World Cup archive",
        }
      : {
          kicker: "الموسم 2026/27",
          title: "ملخصات ومراجعات المباريات",
          lede: "صفحة مستقلة لمباريات الموسم الحالي: النتائج، مراجعة سريعة، الأهداف وأبرز اللقطات للدوري الإنجليزي والدوري الإسباني ودوري أبطال أوروبا عند توفرها.",
          count: (n) => `${n} ملخص`,
          dayCount: (n) => `${n} مباراة`,
          empty: "لا توجد ملخصات متاحة حالياً لهذا الاختيار.",
          wcTitle: "تبحث عن ملخصات كأس العالم 2026؟",
          wcBody: "للبطولة أرشيف مستقل يضم جميع المباريات الـ104.",
          wcCta: "فتح أرشيف كأس العالم",
        };
  }

  function videoHtml(m) {
    if (!window.KZHighlights) return "";
    const clone = { ...m, status: "ended", summaryAr: "" };
    if (!window.KZHighlights.hasSummaryContent(clone)) return "";
    return window.KZHighlights.summaryBodyHtml(clone);
  }

  function renderCard(m) {
    const rawId = String(m.id || m.key || pairKey(m));
    const id = encodeURIComponent(rawId);
    const home = escapeHtml(teamLabel(m.home));
    const away = escapeHtml(teamLabel(m.away));
    const summary = escapeHtml(!isEnglish() && m.summaryAr ? m.summaryAr : fallbackSummary(m));
    return `
      <article class="current-review-card" data-review-id="${id}" data-review-raw-id="${escapeHtml(rawId)}">
        <div class="current-review-meta">
          <span class="current-review-league">${escapeHtml(competitionLabel(m))}</span>
          <span>${escapeHtml(formatDay(arabiaDayIso(m.kickoffUtc)))}</span>
        </div>
        <div class="current-review-scoreline">
          <span class="current-review-team">${home}</span>
          <strong class="current-review-score">${escapeHtml(m.score || "—")}</strong>
          <span class="current-review-team">${away}</span>
        </div>
        <p class="current-review-summary">${summary}</p>
        ${videoHtml(m)}
      </article>`;
  }

  function renderFilters() {
    const host = document.getElementById("current-highlights-filters");
    if (!host) return;
    const labels = isEnglish()
      ? { all: "All", epl: "Premier League", laliga: "La Liga", spl: "Saudi Pro League", ucl: "Champions League" }
      : { all: "الكل", epl: "الدوري الإنجليزي", laliga: "الدوري الإسباني", spl: "الدوري السعودي", ucl: "دوري الأبطال" };
    host.innerHTML = Object.entries(labels)
      .map(([key, label]) => `
        <button type="button" class="current-highlights-filter${activeCompetition === key ? " active" : ""}" data-filter="${key}">${label}</button>`)
      .join("");
    host.querySelectorAll("[data-filter]").forEach((btn) => {
      btn.addEventListener("click", () => {
        activeCompetition = btn.dataset.filter;
        render();
      });
    });
  }

  function focusQuery() {
    const wanted = new URLSearchParams(location.search).get("match");
    if (!wanted) return;
    const card = [...document.querySelectorAll(".current-review-card")].find(
      (el) => el.dataset.reviewRawId === wanted || decodeURIComponent(el.dataset.reviewId || "") === wanted,
    );
    if (!card) return;
    card.classList.add("is-target");
    setTimeout(() => card.scrollIntoView({ behavior: "smooth", block: "center" }), 60);
  }

  function render() {
    const c = copy();
    document.getElementById("current-highlights-kicker").textContent = c.kicker;
    document.getElementById("current-highlights-title").textContent = c.title;
    document.getElementById("current-highlights-lede").textContent = c.lede;
    document.getElementById("current-highlights-wc-title").textContent = c.wcTitle;
    document.getElementById("current-highlights-wc-body").textContent = c.wcBody;
    document.getElementById("current-highlights-wc-cta").textContent = c.wcCta;
    renderFilters();

    const list = activeCompetition === "all"
      ? allMatches
      : allMatches.filter((m) => m.competition === activeCompetition);
    const count = document.getElementById("current-highlights-count");
    if (count) count.textContent = c.count(list.length);

    const host = document.getElementById("current-highlights-list");
    const empty = document.getElementById("current-highlights-empty");
    if (!list.length) {
      host.innerHTML = "";
      empty.hidden = false;
      empty.textContent = c.empty;
      return;
    }
    empty.hidden = true;

    const groups = new Map();
    for (const m of list) {
      const day = arabiaDayIso(m.kickoffUtc) || "unknown";
      if (!groups.has(day)) groups.set(day, []);
      groups.get(day).push(m);
    }
    host.innerHTML = [...groups.entries()]
      .map(([day, matches]) => `
        <section class="current-review-day">
          <div class="current-review-day__head"><h2>${escapeHtml(formatDay(day))}</h2><span>${c.dayCount(matches.length)}</span></div>
          <div class="current-review-grid">${matches.map(renderCard).join("")}</div>
        </section>`)
      .join("");
    if (window.KZHighlights) window.KZHighlights.bindReplayLaunch(host);
    focusQuery();
  }

  function bindNavToggle() {
    const toggle = document.querySelector(".nav-toggle");
    const nav = document.querySelector(".nav-links");
    if (toggle && nav) toggle.addEventListener("click", () => nav.classList.toggle("open"));
  }

  document.addEventListener("DOMContentLoaded", async () => {
    bindNavToggle();
    const [staticRows, liveRows] = await Promise.all([loadStaticHighlights(), loadLiveEnded()]);
    allMatches = mergeMatches(staticRows, liveRows);
    render();
    new MutationObserver((mutations) => {
      if (mutations.some((m) => m.attributeName === "lang")) render();
    }).observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
  });
})();
