/* ============================================================================
 * watch-embed.js — VIP iframe player (vip.worldkoora.com/albaplayer/vip1)
 * Same layout as watch.html; opens in its own tab via watch-embed.html
 * ==========================================================================*/
(function () {
  const EMBED_BASE = "https://vip.worldkoora.com/albaplayer/vip1/";
  const EMBED_PARAM = "serv";
  const EMBED_SERVERS = 3;

  const { CHANNELS } = window.SITE_DATA;
  const params = new URLSearchParams(location.search);

  let MATCHES = [];
  let channel = CHANNELS[0];
  let match = null;

  const frame = document.getElementById("vip-frame");

  function embedUrl(serverIndex) {
    const u = new URL(EMBED_BASE);
    u.searchParams.set(EMBED_PARAM, serverIndex);
    return u.toString();
  }

  function loadEmbed(serverIndex) {
    frame.src = embedUrl(serverIndex);
  }

  function fillInfo() {
    const live = !!(match && match.status === "live");
    document.getElementById("ch-name").textContent = channel.name;
    document.getElementById("ch-status").innerHTML = live
      ? `<span class="status-pill status-live">مباشر الآن</span>`
      : `<span class="status-pill status-upcoming">جاهزة للبث</span>`;
    document.title = `${channel.name} — VIP | MorshLive`;

    const sub = document.getElementById("now-sub");
    sub.textContent = match
      ? `${match.home} ضد ${match.away} · ${match.league}`
      : `بث مباشر بجودة ${channel.quality}`;

    document.getElementById("info-quality").textContent = channel.quality;
    document.getElementById("info-group").textContent = channel.group;
    document.getElementById("info-commentator").textContent = (match && match.commentator) || "—";
    document.getElementById("info-league").textContent = (match && match.league) || "—";
  }

  function renderServers() {
    const row = document.getElementById("servers");
    const activeServ = Number(params.get("serv") || 0);

    row.innerHTML = Array.from({ length: EMBED_SERVERS }, (_, i) =>
      `<button class="server-btn ${i === activeServ ? "active" : ""}" data-srv="${i}">سيرفر ${i + 1}</button>`
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
  }

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

  function renderSidebar() {
    const panel = document.getElementById("side-channels");
    panel.innerHTML = CHANNELS.map((c) =>
      `<a class="side-channel ${c.id === channel.id ? "active" : ""}" href="watch-embed.html?ch=${c.id}">
         <div class="mini-logo">${channelMark(c.name)}</div>
         <div class="meta">
           <div class="n">${c.name}</div>
           <div class="q">${c.quality} · ${c.group}</div>
         </div>
       </a>`
    ).join("");
  }

  function initNav() {
    const toggle = document.querySelector(".nav-toggle");
    const links = document.querySelector(".nav-links");
    if (toggle && links) toggle.addEventListener("click", () => links.classList.toggle("open"));
  }

  function resolveSelection() {
    const liveMatch = MATCHES.find((m) => m.status === "live");
    const reqCh = params.get("ch");
    const wantsAutoLive = !reqCh || reqCh === "live";

    const chId = wantsAutoLive
      ? (liveMatch && liveMatch.channelId ? liveMatch.channelId : CHANNELS[0].id)
      : reqCh;
    const matchId = params.get("match") || (wantsAutoLive && liveMatch ? liveMatch.id : null);

    channel = CHANNELS.find((c) => c.id === chId) || CHANNELS[0];
    match = MATCHES.find((m) => m.id === matchId) || null;
  }

  async function refreshMatches() {
    const meta = await window.getMatches({ force: true });
    MATCHES = meta.matches;
    resolveSelection();
    fillInfo();
  }

  document.addEventListener("DOMContentLoaded", async () => {
    initNav();
    resolveSelection();
    fillInfo();
    renderServers();
    renderSidebar();
    loadEmbed(Number(params.get("serv") || 0));
    refreshMatches().catch((e) => console.warn("Initial match refresh failed:", e.message));
    setInterval(() => refreshMatches().catch((e) => console.warn("Match refresh failed:", e.message)), 90 * 1000);
  });
})();
