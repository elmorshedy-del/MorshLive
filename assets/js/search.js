/* ============================================================================
 * search.js — /search page. Filters today's fixtures (window.getMatches) by
 * team, league, venue or commentator and links each result to its watch page.
 * Self-contained so it doesn't depend on app.js internals; reuses the shared
 * data layer (data.js) and i18n.
 * ==========================================================================*/
(function () {
  let MATCHES = [];

  const t = (k, v) => (window.I18N ? window.I18N.t(k, v) : k);
  const statusLabel = (s) => t("status." + s);

  const ICON = {
    mic: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/></svg>',
    play: '<svg class="ico ico-fill" viewBox="0 0 24 24" aria-hidden="true"><polygon points="6 3 20 12 6 21 6 3"/></svg>',
    tv: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="7" width="20" height="15" rx="2"/><polyline points="17 2 12 7 7 2"/></svg>',
    trophy: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.7V17c0 .6-.5 1-1 1.2C7.9 18.8 7 20.2 7 22"/><path d="M14 14.7V17c0 .6.5 1 1 1.2 1.1.6 2 2 2 2.8"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg>',
    pin: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>',
  };

  const norm = (s) => (s || "")
    .toString()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")        // strip Latin accents
    .replace(/[\u064b-\u065f\u0670]/g, "") // strip Arabic harakat
    .replace(/[آأإ]/g, "ا") // alef variants
    .replace(/ة/g, "ه")           // ta marbuta -> ha
    .replace(/ى/g, "ي")           // alef maqsura -> ya
    .toLowerCase()
    .trim();

  function watchHref(m) {
    return m.channelId
      ? `watch.html?ch=${m.channelId}&match=${m.id}`
      : `watch.html?ch=live&match=${m.id}`;
  }

  function commentatorText(m) {
    if (m.commentators && m.commentators.length) {
      const names = m.commentators.map((c) => c.name);
      return names.join(" ");
    }
    return m.commentator || "";
  }

  function crest(badge, ab) {
    return badge
      ? `<div class="crest"><img src="${badge}" alt="" loading="lazy"></div>`
      : `<div class="crest">${ab || "?"}</div>`;
  }

  function timeZoneChips(m) {
    const zones = window.getMatchTimeZones ? window.getMatchTimeZones(m) : [];
    if (!zones.length) return "";
    return `
      <div class="time-zone-row">
        ${zones.map((z) => `
          <div class="time-chip time-chip-${z.key}">
            <span>${z.label}</span><b>${z.value}</b>
          </div>`).join("")}
      </div>`;
  }

  function footMeta(m) {
    const parts = [];
    const comm = commentatorText(m);
    if (comm) parts.push(`${ICON.mic} <b>${comm.split(" ")[0]}</b>`);
    if (m.channel) parts.push(`${ICON.tv} ${m.channel}`);
    if (!parts.length) parts.push(m.venue ? `${ICON.pin} ${m.venue}` : `${ICON.trophy} ${m.league || ""}`);
    return parts.join(" · ");
  }

  function watchAction(m) {
    const recent = window.isRecentlyEndedMatch && window.isRecentlyEndedMatch(m);
    if (m.status === "ended") {
      if (recent) return `<a class="watch-link watch-link--commentary" href="${watchHref(m)}">${ICON.mic} ${t("card.watchCommentary")}</a>`;
      return `<span class="watch-link watch-link--disabled">${t("card.ended")}</span>`;
    }
    const label = m.status === "live" ? t("card.watchNow") : t("card.watch");
    return `<a class="watch-link" href="${watchHref(m)}">${ICON.play} ${label}</a>`;
  }

  function matchCard(m) {
    const minute = window.liveMinuteLabel ? window.liveMinuteLabel(m) : (m.status === "live" && m.minute ? String(m.minute).trim() : "");
    const minuteSuffix = minute ? ` · ${minute}` : "";
    return `
      <article class="match-card" data-status="${m.status}">
        <div class="match-top">
          <span class="league-tag">${m.league || ""}</span>
          <span class="status-pill status-${m.status}">${statusLabel(m.status)}${minute}</span>
        </div>
        <div class="teams">
          <div class="team">${crest(m.homeBadge, m.homeAbbr)}<div class="tname">${teamLabel(m.home)}</div></div>
          <div class="score">${m.score || "×"}</div>
          <div class="team">${crest(m.awayBadge, m.awayAbbr)}<div class="tname">${teamLabel(m.away)}</div></div>
        </div>
        ${timeZoneChips(m)}
        <div class="match-foot">
          <span class="match-meta">${footMeta(m)}</span>
          ${watchAction(m)}
        </div>
      </article>`;
  }

  function teamAliases(name) {
    return window.TeamNames ? window.TeamNames.aliases(name).join(" ") : name;
  }
  function teamLabel(name) {
    return window.TeamNames ? window.TeamNames.localize(name) : name;
  }

  function haystack(m) {
    return norm([
      teamAliases(m.home), teamAliases(m.away), m.homeAbbr, m.awayAbbr,
      m.league, m.venue, m.channel, commentatorText(m),
    ].join(" "));
  }

  function search(q) {
    const terms = norm(q).split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    return MATCHES.filter((m) => {
      const hay = haystack(m);
      return terms.every((term) => hay.includes(term));
    });
  }

  function render(q) {
    const grid = document.getElementById("search-grid");
    const count = document.getElementById("search-count");
    const empty = document.getElementById("search-empty");
    if (!grid) return;
    const query = (q || "").trim();
    if (!query) {
      grid.innerHTML = "";
      if (empty) { empty.hidden = false; empty.textContent = t("search.prompt"); }
      if (count) count.textContent = "";
      return;
    }
    const results = search(query);
    if (count) count.textContent = t("search.count", { n: results.length });
    if (!results.length) {
      grid.innerHTML = "";
      if (empty) { empty.hidden = false; empty.textContent = t("search.none", { q: query }); }
      return;
    }
    if (empty) empty.hidden = true;
    grid.innerHTML = results.map(matchCard).join("");
  }

  function getQ() {
    return new URLSearchParams(location.search).get("q") || "";
  }

  function setQ(q) {
    const url = new URL(location.href);
    if (q) url.searchParams.set("q", q);
    else url.searchParams.delete("q");
    history.replaceState(null, "", url);
  }

  document.addEventListener("DOMContentLoaded", async () => {
    const input = document.getElementById("search-input");
    if (input) {
      input.value = getQ();
      let timer = null;
      input.addEventListener("input", () => {
        clearTimeout(timer);
        timer = setTimeout(() => { setQ(input.value); render(input.value); }, 150);
      });
      const form = document.getElementById("search-form");
      if (form) form.addEventListener("submit", (e) => { e.preventDefault(); setQ(input.value); render(input.value); input.blur(); });
    }

    const meta = await window.getMatches({ force: false });
    MATCHES = meta.matches || [];
    render(getQ());
    if (input) input.focus();

    setInterval(async () => {
      try {
        const m = await window.getMatches({ force: true });
        MATCHES = m.matches || [];
        render(input ? input.value : getQ());
      } catch (e) { /* keep last results */ }
    }, 90 * 1000);
  });
})();
