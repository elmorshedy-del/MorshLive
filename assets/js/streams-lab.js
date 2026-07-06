/**
 * Streams Lab — 24/7 beIN hub (dlhd + SIR + sir-tv-new links).
 * Does not touch main watch page STREAM_SOURCES.
 */
(function () {
  const player = document.getElementById("player");
  const grid = document.getElementById("channel-grid");
  const groupTabs = document.getElementById("group-tabs");
  const nowLabel = document.getElementById("now-label");
  const statusLine = document.getElementById("status-line");
  const liveCountEl = document.getElementById("live-count");
  const totalCountEl = document.getElementById("total-count");
  const externalLinks = document.getElementById("external-links");
  const reloadBtn = document.getElementById("reload");
  const bestBtn = document.getElementById("best-btn");
  const refreshBtn = document.getElementById("refresh-status");

  const REGION_STATS = ["ar", "fr", "en", "tr"];

  let catalog = { channels: [], groups: [], external: [] };
  let currentRoute = null;
  let currentGroup = "all";
  let probed = false;

  function setStatus(msg) {
    if (statusLine) statusLine.textContent = msg;
  }

  function loadRoute(route, label) {
    if (!route || !player) return;
    currentRoute = route;
    player.src = route;
    if (nowLabel) nowLabel.textContent = label || route;
    document.querySelectorAll(".lab-card").forEach((el) => {
      el.classList.toggle("active", el.dataset.route === route);
    });
  }

  function channelLabel(ch) {
    let t = ch.name;
    if (ch.sub) t += " — " + ch.sub;
    if (ch.mirror) t += " (مرآة)";
    return t;
  }

  function filteredChannels() {
    const list = catalog.channels || [];
    if (currentGroup === "all") return list;
    return list.filter((c) => c.group === currentGroup);
  }

  function groupLiveCount(groupId) {
    const list = catalog.channels || [];
    const scoped = groupId === "all" ? list : list.filter((c) => c.group === groupId);
    return scoped.filter((c) => c.live).length;
  }

  function updateLiveUi() {
    const channels = catalog.channels || [];
    const liveCount = channels.filter((c) => c.live).length;
    if (liveCountEl) liveCountEl.textContent = String(liveCount);
    if (totalCountEl) totalCountEl.textContent = String(channels.length);
    updateRegionStats();
    renderGroups();
    renderGrid();
  }

  function updateRegionStats() {
    REGION_STATS.forEach((gid) => {
      const el = document.getElementById("stat-" + gid);
      if (!el) return;
      const live = groupLiveCount(gid);
      const total = (catalog.channels || []).filter((c) => c.group === gid).length;
      el.textContent = probed ? live + "/" + total : "—";
    });
  }

  function renderGroups() {
    if (!groupTabs) return;
    groupTabs.innerHTML = "";
    const hash = (location.hash || "").replace("#", "");
    if (hash && hash !== currentGroup && (hash === "all" || (catalog.groups || []).some((g) => g.id === hash))) {
      currentGroup = hash;
    }
    const groups = [{ id: "all", label: "الكل", icon: "★" }, ...(catalog.groups || [])];
    groups.forEach((g) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "lab-group" + (currentGroup === g.id ? " active" : "");
      b.dataset.group = g.id;
      const cnt = probed ? groupLiveCount(g.id) : null;
      const cntHtml = cnt !== null && g.id !== "match" ? `<span class="cnt">${cnt}</span>` : "";
      b.innerHTML = `<span>${g.icon || ""}</span> ${g.label}${cntHtml}`;
      b.addEventListener("click", () => {
        currentGroup = g.id;
        history.replaceState(null, "", g.id === "all" ? location.pathname : "#" + g.id);
        renderGroups();
        renderGrid();
      });
      groupTabs.appendChild(b);
    });
  }

  function cardClass(ch) {
    if (ch.live === true) return " is-live";
    if (ch.live === false) return " is-dead";
    return " is-unknown";
  }

  function renderGrid() {
    if (!grid) return;
    grid.innerHTML = "";
    const list = filteredChannels().sort((a, b) => (a.priority || 99) - (b.priority || 99));
    list.forEach((ch) => {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "lab-card" + cardClass(ch);
      card.dataset.route = ch.route;
      const sub = ch.mirror ? (ch.sub || ch.source) + " · مرآة" : ch.sub || ch.source;
      card.innerHTML =
        `<span class="lab-dot" aria-hidden="true"></span>` +
        `<span class="lab-card-name">${ch.name}</span>` +
        `<span class="lab-card-sub">${sub}</span>`;
      card.addEventListener("click", () => loadRoute(ch.route, channelLabel(ch)));
      grid.appendChild(card);
    });
  }

  function renderExternal() {
    if (!externalLinks) return;
    externalLinks.innerHTML = "";
    (catalog.external || []).forEach((ex) => {
      const a = document.createElement("a");
      a.className = "lab-ext";
      a.href = ex.url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.innerHTML = `<strong>${ex.name}</strong><small>${ex.sub}</small>`;
      externalLinks.appendChild(a);
    });
  }

  function pickBest(autoPlay) {
    const live = (catalog.channels || []).filter((c) => c.live);
    if (!live.length) {
      setStatus("لا يوجد بث متاح حالياً — جارٍ إعادة الفحص…");
      return null;
    }
    live.sort((a, b) => (a.priority || 99) - (b.priority || 99));
    const best = live[0];
    if (autoPlay) loadRoute(best.route, channelLabel(best));
    return best;
  }

  async function mapPool(items, limit, fn) {
    const out = new Array(items.length);
    let i = 0;
    async function worker() {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx], idx);
      }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
    return out;
  }

  async function probeEmbed(route) {
    try {
      const r = await fetch(route, { cache: "no-store", signal: AbortSignal.timeout(16_000) });
      const t = await r.text();
      return r.ok && (/\/dl\/hls\?/.test(t) || /\/sir\/hls\?/.test(t));
    } catch {
      return false;
    }
  }

  async function probeDlhdChannel(ch) {
    const mirrors = ch.mirrors || [];
    if (await probeEmbed(ch.route)) {
      return { ...ch, live: true, route: ch.route, mirror: null };
    }
    for (const mirror of mirrors) {
      if (await probeEmbed(mirror)) {
        return { ...ch, live: true, route: mirror, mirror };
      }
    }
    return { ...ch, live: false, route: ch.route, mirror: null };
  }

  async function refreshStatus() {
    setStatus("جارٍ فحص المصادر…");
    try {
      if (!(catalog.channels || []).length) {
        const res = await fetch("/assets/data/streams-lab.json", { cache: "no-store" });
        const data = await res.json();
        catalog = { ...data, channels: (data.channels || []).map((c) => ({ ...c, live: null })) };
        catalog.external = data.external || [];
        catalog.groups = data.groups || [];
      }

      const apiRes = await fetch("/api/streams-lab", { cache: "no-store" });
      const apiData = await apiRes.json();
      if (!apiData.ok) throw new Error(apiData.error || "probe failed");

      const sirMap = new Map((apiData.channels || []).filter((c) => c.source === "sir").map((c) => [c.id, c]));

      const dlhd = (catalog.channels || []).filter((c) => c.source === "dlhd");
      const sir = (catalog.channels || []).filter((c) => c.source === "sir");

      const probedDlhd = await mapPool(dlhd, 5, probeDlhdChannel);
      const probedSir = sir.map((ch) => {
        const fromApi = sirMap.get(ch.id);
        const live = fromApi ? !!fromApi.live : false;
        return { ...ch, live, route: ch.route, mirror: null };
      });

      catalog.channels = [...probedDlhd, ...probedSir].sort((a, b) => (a.priority || 99) - (b.priority || 99));
      catalog.groups = apiData.groups || catalog.groups;
      catalog.external = apiData.external || catalog.external;
      probed = true;

      const liveCount = catalog.channels.filter((c) => c.live).length;
      updateLiveUi();
      renderExternal();

      const ts = new Date().toLocaleTimeString("ar-SA");
      setStatus(`آخر فحص: ${ts} — ${liveCount}/${catalog.channels.length} بثّ متاح`);

      if (!currentRoute || !catalog.channels.find((c) => c.route === currentRoute && c.live)) {
        pickBest(true);
      }
      return catalog;
    } catch (e) {
      setStatus("تعذّر فحص المصادر: " + (e.message || e));
      return null;
    }
  }

  if (reloadBtn) {
    reloadBtn.addEventListener("click", () => {
      const keep = currentRoute;
      player.src = "about:blank";
      setTimeout(() => loadRoute(keep, nowLabel ? nowLabel.textContent : keep), 120);
    });
  }
  if (bestBtn) bestBtn.addEventListener("click", () => pickBest(true));
  if (refreshBtn) refreshBtn.addEventListener("click", () => refreshStatus());

  fetch("/assets/data/streams-lab.json")
    .then((r) => r.json())
    .then((data) => {
      catalog = { ...data, channels: (data.channels || []).map((c) => ({ ...c, live: null })) };
      if (totalCountEl) totalCountEl.textContent = String((data.channels || []).length);
      renderGroups();
      renderGrid();
      renderExternal();
    })
    .catch(() => {})
    .finally(() => refreshStatus());

  setInterval(() => refreshStatus(), 90_000);
})();
