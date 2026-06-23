/* ============================================================================
 * watch.js — watch page: HLS player + server switching + sidebar.
 * Uses hls.js for browsers without native HLS, native playback on Safari/iOS.
 * Match data is loaded live via window.getMatches() (assets/data/today.json).
 * ==========================================================================*/
(function () {
  const VIP_EMBED_BASE = "https://vip.worldkoora.com/albaplayer/vip1/";
  const VIP_SERVERS = 3;

  const { CHANNELS } = window.SITE_DATA;
  const params = new URLSearchParams(location.search);

  let MATCHES = [];
  let channel = CHANNELS[0];
  let match = null;
  let isEmbed = false;
  let activePlayer = params.get("player") === "2" ? 2 : 1;

  const shell = document.getElementById("player-shell");
  const video = document.getElementById("video");
  const overlay = document.getElementById("overlay");
  const vipFrame = document.getElementById("vip-frame");
  let hls = null;
  let started = false;
  let savedShellMarkup = null;

  /* ---------------------------------------------- Player core */
  function loadStream(url) {
    if (hls) { hls.destroy(); hls = null; }
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = url; // native HLS (Safari / iOS)
    } else if (window.Hls && window.Hls.isSupported()) {
      hls = new window.Hls({ lowLatencyMode: true });
      hls.loadSource(url);
      hls.attachMedia(video);
    } else {
      video.src = url; // last-resort fallback
    }
  }

  function play() {
    started = true;
    overlay.classList.add("hidden");
    video.play().catch(() => {/* user gesture may still be required */});
  }

  /* ---------------------------------------------- Embed (iframe) mode */
  function embedUrl(serverIndex) {
    const u = new URL(channel.embed.url);
    if (channel.embed.param != null) u.searchParams.set(channel.embed.param, serverIndex);
    return u.toString();
  }

  function loadEmbed(serverIndex) {
    if (!savedShellMarkup) savedShellMarkup = shell.innerHTML;
    shell.innerHTML =
      `<iframe class="embed-frame" src="${embedUrl(serverIndex)}" ` +
      `allow="autoplay; encrypted-media; fullscreen" allowfullscreen ` +
      `referrerpolicy="no-referrer" scrolling="no"></iframe>`;
  }

  function vipEmbedUrl(serverIndex) {
    const u = new URL(VIP_EMBED_BASE);
    u.searchParams.set("serv", serverIndex);
    return u.toString();
  }

  function loadVipEmbed(serverIndex) {
    if (vipFrame) vipFrame.src = vipEmbedUrl(serverIndex);
  }

  function setActivePlayer(n) {
    activePlayer = n;
    isEmbed = !!channel.embed && n === 1;

    document.querySelectorAll(".player-switch-btn").forEach((btn) => {
      btn.classList.toggle("active", Number(btn.dataset.player) === n);
    });
    document.getElementById("player-panel-1").classList.toggle("active", n === 1);
    document.getElementById("player-panel-2").classList.toggle("active", n === 2);

    const servers = document.getElementById("servers");
    const vipServers = document.getElementById("vip-servers");
    if (servers) servers.hidden = n !== 1;
    if (vipServers) vipServers.hidden = n !== 2;

    if (n === 1) {
      if (isEmbed) {
        loadEmbed(0);
      } else if (savedShellMarkup) {
        shell.innerHTML = savedShellMarkup;
        const freshVideo = document.getElementById("video");
        const freshOverlay = document.getElementById("overlay");
        if (freshVideo && channel.stream) loadStream(channel.stream);
        if (freshOverlay) freshOverlay.addEventListener("click", play);
      }
      renderServers();
    }

    const next = new URL(location.href);
    next.searchParams.set("player", n);
    history.replaceState(null, "", next);
  }

  function initPlayerSwitch() {
    document.querySelectorAll(".player-switch-btn").forEach((btn) => {
      btn.addEventListener("click", () => setActivePlayer(Number(btn.dataset.player)));
    });
    setActivePlayer(activePlayer);
  }

  function renderVipServers() {
    const row = document.getElementById("vip-servers");
    if (!row) return;
    const activeServ = Number(params.get("serv") || 0);

    row.innerHTML = Array.from({ length: VIP_SERVERS }, (_, i) =>
      `<button class="server-btn ${i === activeServ ? "active" : ""}" data-vip-srv="${i}">VIP سيرفر ${i + 1}</button>`
    ).join("");

    row.querySelectorAll("[data-vip-srv]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const srv = Number(btn.dataset.vipSrv);
        row.querySelectorAll("[data-vip-srv]").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        loadVipEmbed(srv);
        const next = new URL(location.href);
        next.searchParams.set("serv", srv);
        history.replaceState(null, "", next);
      });
    });
  }

  /* ---------------------------------------------- Head info */
  function fillInfo() {
    const live = !!(match && match.status === "live");
    document.getElementById("ch-name").textContent = channel.name;
    document.getElementById("ch-status").innerHTML = live
      ? `<span class="status-pill status-live">مباشر الآن</span>`
      : `<span class="status-pill status-upcoming">جاهزة للبث</span>`;
    document.title = `${channel.name} — مشاهدة مباشرة | MorshLive`;

    const sub = document.getElementById("now-sub");
    sub.textContent = match
      ? `${match.home} ضد ${match.away} · ${match.league}`
      : `بث مباشر بجودة ${channel.quality}`;

    document.getElementById("info-quality").textContent = channel.quality;
    document.getElementById("info-group").textContent = channel.group;
    document.getElementById("info-commentator").textContent = (match && match.commentator) || "—";
    document.getElementById("info-league").textContent = (match && match.league) || "—";

    document.getElementById("overlay-title").textContent = channel.name;
    document.getElementById("overlay-sub").textContent = match
      ? `${match.home} ضد ${match.away}`
      : `اضغط للتشغيل · جودة ${channel.quality}`;
  }

  /* ---------------------------------------------- Servers (quality mirrors) */
  function renderServers() {
    const row = document.getElementById("servers");

    if (isEmbed) {
      const n = channel.embed.servers || 1;
      row.innerHTML = Array.from({ length: n }, (_, i) =>
        `<button class="server-btn ${i === 0 ? "active" : ""}" data-srv="${i}">سيرفر ${i + 1}</button>`
      ).join("");
      row.querySelectorAll(".server-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          row.querySelectorAll(".server-btn").forEach((b) => b.classList.remove("active"));
          btn.classList.add("active");
          loadEmbed(Number(btn.dataset.srv));
        });
      });
      return;
    }

    const servers = [
      { label: "سيرفر 1 · HD", url: channel.stream },
      { label: "سيرفر 2 · SD", url: channel.stream },
      { label: "سيرفر 3 · احتياطي", url: channel.stream },
    ];
    row.innerHTML = servers
      .map((s, i) => `<button class="server-btn ${i === 0 ? "active" : ""}" data-url="${s.url}">${s.label}</button>`)
      .join("");
    row.querySelectorAll(".server-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        row.querySelectorAll(".server-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        loadStream(btn.dataset.url);
        if (started) video.play().catch(() => {});
      });
    });
  }

  /* ---------------------------------------------- Sidebar */
  function renderSidebar() {
    const panel = document.getElementById("side-channels");
    panel.innerHTML = CHANNELS.map((c) =>
      `<a class="side-channel ${c.id === channel.id ? "active" : ""}" href="watch.html?ch=${c.id}">
         <div class="mini-logo">📡</div>
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
    // Auto-pick the live match when none / "live" is requested.
    const liveMatch = MATCHES.find((m) => m.status === "live");
    const reqCh = params.get("ch");
    const wantsAutoLive = !reqCh || reqCh === "live";

    const chId = wantsAutoLive
      ? (liveMatch && liveMatch.channelId ? liveMatch.channelId : CHANNELS[0].id)
      : reqCh;
    const matchId = params.get("match") || (wantsAutoLive && liveMatch ? liveMatch.id : null);

    channel = CHANNELS.find((c) => c.id === chId) || CHANNELS[0];
    match = MATCHES.find((m) => m.id === matchId) || null;
    isEmbed = !!channel.embed && activePlayer === 1;
  }

  async function refreshMatches() {
    const meta = await window.getMatches({ force: true });
    MATCHES = meta.matches;
    resolveSelection();
    fillInfo();
  }

  document.addEventListener("DOMContentLoaded", async () => {
    initNav();
    if (shell) savedShellMarkup = shell.innerHTML;
    const meta = await window.getMatches();
    MATCHES = meta.matches;
    resolveSelection();
    fillInfo();
    renderServers();
    renderVipServers();
    renderSidebar();
    loadVipEmbed(Number(params.get("serv") || 0));
    if (activePlayer === 1) {
      if (isEmbed) loadEmbed(0);
      else {
        loadStream(channel.stream);
        overlay.addEventListener("click", play);
      }
    }
    initPlayerSwitch();
    setInterval(() => refreshMatches().catch((e) => console.warn("Match refresh failed:", e.message)), 90 * 1000);
  });
})();
