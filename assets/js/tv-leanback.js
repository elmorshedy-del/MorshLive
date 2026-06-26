/* ============================================================================
 * tv-leanback.js — Leanback TV shell: one focusable row per match, simplified
 * watch layout. Activates when tv-mode is on (tv-nav.js). Home page renders
 * into #tv-leanback; watch page restyles via .watch-page on <body>.
 * ==========================================================================*/
(function () {
  "use strict";

  const LB = "tv-leanback";
  let filter = "all";
  let matches = [];
  let refreshTimer = null;

  const t = (k, v) => (window.I18N ? window.I18N.t(k, v) : k);
  const statusLabel = (s) => t("status." + s);

  function isTvMode() {
    return document.documentElement.classList.contains("tv-mode");
  }

  function isWatchPage() {
    return document.body.classList.contains("watch-page");
  }

  function watchHref(m) {
    const tv = isTvMode() ? "&tv=1" : "";
    return m.channelId
      ? `watch.html?ch=${m.channelId}&match=${m.id}${tv}`
      : `watch.html?ch=live&match=${m.id}${tv}`;
  }

  function commentatorText(m) {
    if (m.commentators && m.commentators.length) {
      const names = m.commentators.map((c) => c.name);
      const extra = names.length > 1 ? ` +${names.length - 1}` : "";
      return `${names[0]}${extra}`;
    }
    return m.commentator || "";
  }

  function isCommentaryAvailable(m) {
    return window.isRecentlyEndedMatch && window.isRecentlyEndedMatch(m);
  }

  function rowMeta(m) {
    const parts = [m.league];
    const comm = commentatorText(m);
    if (comm) parts.push(`<b>${comm}</b>`);
    if (m.channel) parts.push(m.channel);
    return parts.filter(Boolean).join(" · ");
  }

  function rowAction(m) {
    if (m.status === "ended") {
      return isCommentaryAvailable(m) ? t("card.watchCommentary") : t("card.ended");
    }
    return m.status === "live" ? t("card.watchNow") : t("card.watch");
  }

  function tvRow(m, { hero = false } = {}) {
    const minute = m.status === "live" && m.minute ? ` · ${m.minute}` : "";
    const disabled = m.status === "ended" && !isCommentaryAvailable(m);
    const tag = disabled ? "div" : "a";
    const href = disabled ? "" : ` href="${watchHref(m)}"`;
    const score = m.score && m.score !== "vs" ? m.score : t("tv.lbVs");
    return `
      <${tag} class="tv-row${hero ? " tv-row--hero" : ""}"${href} data-status="${m.status}" role="listitem"${disabled ? ' aria-disabled="true"' : ""}>
        <span class="tv-row-status status-pill status-${m.status}">${statusLabel(m.status)}${minute}</span>
        <span class="tv-row-teams">
          <b>${m.home}</b>
          <span class="tv-row-score">${score}</span>
          <b>${m.away}</b>
        </span>
        <span class="tv-row-action">${rowAction(m)}</span>
        <span class="tv-row-meta">${rowMeta(m)}</span>
      </${tag}>`;
  }

  function filteredList() {
    if (filter === "all") return matches;
    return matches.filter((m) => m.status === filter);
  }

  function renderHome() {
    const root = document.getElementById("tv-leanback");
    const list = document.getElementById("tv-lb-matches");
    const now = document.getElementById("tv-lb-now");
    if (!root || !list) return;

    const live = matches.filter((m) => m.status === "live");
    const recentEnded = matches.filter((m) => isCommentaryAvailable(m));

    if (now) {
      const featured = live.length ? live : recentEnded;
      if (featured.length) {
        now.hidden = false;
        now.innerHTML = `
          <p class="tv-lb-section-label">
            <span class="rec-dot"></span>
            ${live.length ? t("live.now") : t("live.recentEnded")}
          </p>
          <div class="tv-lb-list tv-focus-list" role="list">
            ${featured.slice(0, 3).map((m) => tvRow(m, { hero: true })).join("")}
          </div>`;
      } else {
        now.hidden = true;
        now.innerHTML = "";
      }
    }

    const listData = filteredList();
    list.innerHTML = listData.length
      ? listData.map((m) => tvRow(m)).join("")
      : `<p class="tv-lb-empty">${t("matches.none")}</p>`;

    document.querySelectorAll(".tv-lb-tab").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.filter === filter);
    });
  }

  function enhanceWatchSidebar() {
    const panel = document.getElementById("side-channels");
    if (!panel) return;
    panel.classList.add("tv-focus-list");
    panel.querySelectorAll(".side-match").forEach((el) => {
      el.classList.add("tv-row");
      if (!/[?&]tv=1/.test(el.href)) {
        el.href += (el.href.includes("?") ? "&" : "?") + "tv=1";
      }
    });
    let hint = document.getElementById("tv-lb-watch-hint");
    if (!hint) {
      hint = document.createElement("p");
      hint.id = "tv-lb-watch-hint";
      hint.className = "tv-lb-watch-hint";
      hint.setAttribute("data-i18n", "tv.lbHint");
      hint.textContent = t("tv.lbHint");
      panel.parentElement.appendChild(hint);
    }
  }

  function renderWatch() {
    enhanceWatchSidebar();
  }

  function render() {
    if (!isTvMode()) return;
    if (isWatchPage()) renderWatch();
    else renderHome();
    if (window.KZTv && window.KZTv.wireListNav) window.KZTv.wireListNav();
  }

  function syncLeanback() {
    const on = isTvMode();
    document.documentElement.classList.toggle(LB, on);
    const root = document.getElementById("tv-leanback");
    if (root) root.hidden = !on || isWatchPage();
    if (on) {
      if (!isWatchPage() && !matches.length) loadMatches();
      else render();
      startRefresh();
      if (!isWatchPage()) focusFirstRow();
    }
    if (window.KZTv && window.KZTv.syncTvToggles) window.KZTv.syncTvToggles();
  }

  function focusFirstRow() {
    const first = document.querySelector("#tv-leanback .tv-row[href], #tv-leanback .tv-lb-tab");
    if (first && window.KZTv) {
      setTimeout(() => {
        try { first.focus({ preventScroll: false }); } catch (e) { first.focus(); }
      }, 250);
    }
  }

  function initFilters() {
    document.querySelectorAll(".tv-lb-tab").forEach((btn) => {
      if (btn.__kzLbWired) return;
      btn.__kzLbWired = true;
      btn.addEventListener("click", () => {
        filter = btn.dataset.filter || "all";
        renderHome();
        const row = document.querySelector("#tv-lb-matches .tv-row[href]");
        if (row) row.focus();
      });
    });
  }

  async function loadMatches() {
    if (!window.getMatches) return;
    try {
      const meta = await window.getMatches();
      matches = meta.matches || [];
      renderHome();
    } catch (e) {
      console.warn("TV leanback: match load failed", e.message);
    }
  }

  function startRefresh() {
    if (refreshTimer) return;
    refreshTimer = setInterval(() => {
      if (isTvMode() && !isWatchPage()) loadMatches();
    }, 90 * 1000);
  }

  function observeTvMode() {
    const obs = new MutationObserver(() => syncLeanback());
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  }

  function observeSidebar() {
    const panel = document.getElementById("side-channels");
    if (!panel) return;
    const obs = new MutationObserver(() => {
      if (isTvMode()) enhanceWatchSidebar();
    });
    obs.observe(panel, { childList: true });
  }

  document.addEventListener("DOMContentLoaded", () => {
    initFilters();
    observeTvMode();
    observeSidebar();
    syncLeanback();
    if (isTvMode()) {
      loadMatches();
      startRefresh();
    }
  });

  window.KZTvLeanback = { refresh: render, sync: syncLeanback, loadMatches };
})();
