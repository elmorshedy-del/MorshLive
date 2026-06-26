/* ============================================================================
 * watch-embed.js — VIP iframe player (vip.worldkoora.com/albaplayer/vip1)
 * Same layout as watch.html; opens in its own tab via watch-embed.html
 * ==========================================================================*/
(function () {
  function currentEmbed() {
    return activeEmbed || channel.embed || null;
  }

  function channelEmbed() {
    return currentEmbed() || { url: "https://vip.worldkoora.com/albaplayer/vip1/", param: "serv", servers: 1 };
  }

  const { CHANNELS } = window.SITE_DATA;
  const params = new URLSearchParams(location.search);

  let MATCHES = [];
  let channel = CHANNELS[0];
  let match = null;
  let activeEmbed = null;

  const frame = document.getElementById("vip-frame");

  function mirrorAt(embed, serverIndex) {
    if (!embed) return { url: "", param: null };
    if (embed.mirrors && embed.mirrors[serverIndex]) return embed.mirrors[serverIndex];
    return { url: embed.url, param: embed.param };
  }

  function embedUrl(serverIndex) {
    const embed = channelEmbed();
    const mirror = mirrorAt(embed, serverIndex);
    if (!mirror.url) return "";
    const u = new URL(mirror.url);
    if (mirror.param != null) u.searchParams.set(mirror.param, serverIndex);
    return u.toString();
  }

  let embedLoadedUrl = "";

  function loadEmbed(serverIndex) {
    if (!frame) return;
    const next = embedUrl(serverIndex);
    if (embedLoadedUrl === next) return;
    frame.src = next;
    embedLoadedUrl = next;
  }

  function timeZoneHtml(m) {
    const zones = window.getMatchTimeZones && m ? window.getMatchTimeZones(m) : [];
    if (!zones.length) return "—";
    return `
      <div class="time-zone-row watch-times">
        ${zones.map((z) => `
          <div class="time-chip time-chip-${z.key}">
            <span>${z.label}</span>
            <b>${z.value}</b>
          </div>`).join("")}
      </div>`;
  }

  function commentatorHtml(m) {
    if (m && m.commentators && m.commentators.length) {
      return `<div class="commentator-list">${m.commentators
        .map((c) => `<span class="commentator-item"><b>${c.name}</b>${c.channel ? `<i>${c.channel}</i>` : ""}</span>`)
        .join("")}</div>`;
    }
    return (m && m.commentator) || "—";
  }

  function fillInfo() {
    const live = !!(match && match.status === "live");
    const commentary = match && window.isRecentlyEndedMatch && window.isRecentlyEndedMatch(match);
    document.getElementById("ch-name").textContent = channel.name;
    document.getElementById("ch-status").innerHTML = live
      ? `<span class="status-pill status-live">مباشر الآن</span>`
      : commentary
        ? `<span class="status-pill status-ended">انتهت · شاهد التعليق</span>`
        : `<span class="status-pill status-upcoming">جاهزة للبث</span>`;
    document.title = commentary
      ? `${match.home} ضد ${match.away} — التعليق متاح`
      : `${channel.name} — VIP | KoraZero`;

    const sub = document.getElementById("now-sub");
    sub.textContent = match
      ? commentary
        ? `${match.home} ضد ${match.away} · ${match.score} · التعليق متاح`
        : `${match.home} ضد ${match.away} · ${match.league}`
      : `بث مباشر بجودة ${channel.quality}`;

    document.getElementById("info-quality").textContent = channel.quality;
    document.getElementById("info-group").textContent = channel.group;
    document.getElementById("info-commentator").innerHTML = commentatorHtml(match);
    document.getElementById("info-league").textContent = (match && match.league) || "—";
    const infoTimes = document.getElementById("info-times");
    if (infoTimes) infoTimes.innerHTML = timeZoneHtml(match);
  }

  function renderServers() {
    const row = document.getElementById("servers");
    const activeServ = Number(params.get("serv") || 0);

    const n = channelEmbed().servers || 1;
    row.innerHTML = Array.from({ length: n }, (_, i) =>
      `<button class="server-btn ${i === activeServ ? "active" : ""}" data-srv="${i}" data-kind="reachable" data-url="${embedUrl(i)}" data-label="سيرفر ${i + 1}"><span class="srv-label">سيرفر ${i + 1}</span></button>`
    ).join("");

    row.querySelectorAll(".server-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const srv = Number(btn.dataset.srv);
        row.querySelectorAll(".server-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        loadEmbed(srv);

        const next = new URL(location.href);
        next.searchParams.set("serv", srv);
        history.replaceState(null, "", next);
      });
    });

    if (window.StreamCheck) window.StreamCheck.autoHighlight(row, { autoSelect: false }).catch(() => {});
  }

  function renderSidebar() {
    const panel = document.getElementById("side-channels");
    if (!panel) return;
    const order = { live: 0, upcoming: 1, ended: 2 };
    const list = MATCHES.slice().sort((a, b) => (order[a.status] - order[b.status])).slice(0, 14);
    if (!list.length) {
      panel.innerHTML = `<div class="side-empty">لا توجد مباريات متاحة الآن</div>`;
      return;
    }
    const label = { live: "مباشر", upcoming: "قادمة", ended: "انتهت" };
    panel.innerHTML = list.map((m) => {
      const sideLabel = (window.isRecentlyEndedMatch && window.isRecentlyEndedMatch(m))
        ? "التعليق"
        : (label[m.status] || m.status);
      return `<a class="side-match ${match && m.id === match.id ? "active" : ""}" href="watch.html?ch=${m.channelId || "live"}&match=${m.id}">
         <span class="side-status status-${m.status}">${sideLabel}</span>
         <span class="side-teams">${m.home} <i>×</i> ${m.away}</span>
         <span class="side-league">${m.league || ""}</span>
       </a>`;
    }).join("");
  }

  function initNav() {
    const toggle = document.querySelector(".nav-toggle");
    const links = document.querySelector(".nav-links");
    if (toggle && links) toggle.addEventListener("click", () => links.classList.toggle("open"));
  }

  function resolveSelection() {
    const picked = window.resolveWatchSelection
      ? window.resolveWatchSelection(MATCHES, CHANNELS, params)
      : { channel: CHANNELS[0], match: null };
    channel = picked.channel;
    match = picked.match;
    activeEmbed = picked.embed || channel.embed;
  }

  async function refreshMatches({ force } = {}) {
    const previousChannelId = channel.id;
    const previousEmbedUrl = activeEmbed && activeEmbed.url;
    const meta = await window.getMatches({ force: !!force });
    MATCHES = meta.matches;
    resolveSelection();
    fillInfo();
    renderSidebar();
    const embedChanged = (activeEmbed && activeEmbed.url) !== previousEmbedUrl;
    if (channel.id !== previousChannelId || embedChanged) {
      renderServers();
      loadEmbed(Number(params.get("serv") || 0));
    }
  }

  document.addEventListener("DOMContentLoaded", async () => {
    initNav();
    resolveSelection();
    fillInfo();
    renderServers();
    renderSidebar();
    loadEmbed(Number(params.get("serv") || 0));
    refreshMatches({ force: false }).catch((e) => console.warn("Initial match refresh failed:", e.message));
    setInterval(() => refreshMatches({ force: true }).catch((e) => console.warn("Match refresh failed:", e.message)), 90 * 1000);
    setInterval(() => {
      const row = document.getElementById("servers");
      if (row && window.StreamCheck) window.StreamCheck.autoHighlight(row, { autoSelect: false }).catch(() => {});
    }, 120 * 1000);
  });
})();
