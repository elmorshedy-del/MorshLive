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

  async function refreshStatus() {
    setStatus("جارٍ فحص المصادر…");
    try {
      const res = await fetch("/api/streams-lab", { cache: "no-store" });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "probe failed");
      catalog = data;
      probed = true;
      if (liveCountEl) liveCountEl.textContent = String(data.liveCount || 0);
      if (totalCountEl) totalCountEl.textContent = String(data.total || 0);
      updateRegionStats();
      renderGroups();
      renderGrid();
      renderExternal();
      setStatus(
        `آخر فحص: ${new Date(data.updatedAt).toLocaleTimeString("ar-SA")} — ${data.liveCount}/${data.total} بثّ متاح`
      );
      if (!currentRoute || !(catalog.channels || []).find((c) => c.route === currentRoute && c.live)) {
        pickBest(true);
      }
      return data;
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
