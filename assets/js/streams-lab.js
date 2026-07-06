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
  const sir247Grid = document.getElementById("sir-247-grid");
  const siirMatchesGrid = document.getElementById("siir-matches-grid");
  const siirMatchesStatus = document.getElementById("siir-matches-status");
  const reloadBtn = document.getElementById("reload");
  const bestBtn = document.getElementById("best-btn");
  const refreshBtn = document.getElementById("refresh-status");

  const PRIMARY_GROUPS = ["ar", "max", "sir"];
  const GROUP_PICK_ORDER = { ar: 1, max: 2, sir: 3, other: 99 };
  const REGION_STATS = ["ar", "max", "sir"];

  let catalog = { channels: [], groups: [], external: [], defaultGroup: "ar" };
  let sir247 = [];
  let siirMatches = [];
  let currentRoute = null;
  let currentGroup = "ar";
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

  function isPrimaryChannel(ch) {
    return PRIMARY_GROUPS.includes(ch.group);
  }

  function groupPickRank(ch) {
    return GROUP_PICK_ORDER[ch.group] || 50;
  }

  function updateLiveUi() {
    const channels = catalog.channels || [];
    const liveCount = channels.filter((c) => c.live).length;
    const arLive = channels.filter((c) => c.live && isPrimaryChannel(c)).length;
    if (liveCountEl) liveCountEl.textContent = arLive ? String(arLive) + " عربي" : String(liveCount);
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
    const valid = (catalog.groups || []).some((g) => g.id === hash);
    if (hash && valid) currentGroup = hash;
    else if (!hash && catalog.defaultGroup) currentGroup = catalog.defaultGroup;

    const groups = [...(catalog.groups || [])];
    groups.push({ id: "all", label: "الكل", icon: "★" });
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
    (catalog.external || [])
      .sort((a, b) => (a.priority || 99) - (b.priority || 99))
      .forEach((ex) => {
        const a = document.createElement("a");
        a.className = "lab-ext";
        a.href = ex.url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.innerHTML = `<strong>${ex.name}</strong><small>${ex.sub}</small>`;
        externalLinks.appendChild(a);
      });
  }

  function renderSir247() {
    if (!sir247Grid) return;
    sir247Grid.innerHTML = "";
    const list = sir247.length
      ? sir247
      : (catalog.channels || []).filter((c) => c.source === "sir").map((c) => ({
          slug: c.sirSlug,
          name: c.name,
          route: c.route,
          live: c.live,
          sub: c.sub,
        }));
    list.forEach((ch) => {
      const card = document.createElement("button");
      card.type = "button";
      const live = ch.live === true;
      card.className = "lab-card" + (live ? " is-live" : ch.live === false ? " is-dead" : " is-unknown");
      card.dataset.route = ch.route;
      card.innerHTML =
        `<span class="lab-dot" aria-hidden="true"></span>` +
        `<span class="lab-card-name">${ch.name}</span>` +
        `<span class="lab-card-sub">${ch.sub || "24/7"} · SIR</span>`;
      card.addEventListener("click", () => loadRoute(ch.route, ch.name + " 24/7"));
      sir247Grid.appendChild(card);
    });
  }

  function siirStatusLabel(status) {
    if (status === "live") return "مباشر";
    if (status === "soon") return "قريباً";
    if (status === "ended") return "انتهت";
    return "—";
  }

  function renderSiirMatches() {
    if (!siirMatchesGrid) return;
    siirMatchesGrid.innerHTML = "";
    if (!siirMatches.length) {
      if (siirMatchesStatus) siirMatchesStatus.textContent = "لا توجد مباريات في siir-tv.live حالياً";
      return;
    }
    const liveN = siirMatches.filter((m) => m.live).length;
    if (siirMatchesStatus) {
      siirMatchesStatus.textContent = liveN
        ? `${liveN} مباراة ببث متاح · ${siirMatches.length} إجمالي`
        : `${siirMatches.length} مباراة — البث يظهر عند بدء المباراة`;
    }
    siirMatches.forEach((m) => {
      const card = document.createElement("button");
      card.type = "button";
      const cls =
        m.status === "live" ? " match-live is-live" : m.status === "soon" ? " match-soon" : " match-ended is-dead";
      card.className = "lab-card" + cls;
      const label = m.home && m.away ? `${m.home} × ${m.away}` : m.title;
      const sub = [m.channel, m.time, siirStatusLabel(m.status)].filter(Boolean).join(" · ");
      card.innerHTML =
        `<span class="lab-dot" aria-hidden="true"></span>` +
        `<span class="lab-card-name">${label}</span>` +
        `<span class="lab-card-sub">${sub}</span>`;
      if (m.route && m.live) {
        card.dataset.route = m.route;
        card.addEventListener("click", () => loadRoute(m.route, label));
      } else {
        card.disabled = true;
        card.style.cursor = "default";
      }
      siirMatchesGrid.appendChild(card);
    });
  }

  async function refreshSiirMatches() {
    try {
      const res = await fetch("/api/siir-matches", { cache: "no-store" });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "siir-matches failed");
      siirMatches = data.matches || [];
      if (data.sir247?.length) {
        sir247 = data.sir247.map((ch) => ({
          ...ch,
          sub: ch.slug === "ar1" || ch.slug === "ar2" ? "عربي" : ch.slug === "fr" ? "Français" : "English",
        }));
        renderSir247();
        const sirMap = new Map(sir247.map((c) => [c.slug, c.live]));
        catalog.channels = (catalog.channels || []).map((ch) => {
          if (ch.source !== "sir" || !ch.sirSlug) return ch;
          const fromApi = sirMap.get(ch.sirSlug);
          return fromApi === undefined ? ch : { ...ch, live: !!fromApi };
        });
        if (probed) updateLiveUi();
      }
      renderSiirMatches();
      return data;
    } catch (e) {
      if (siirMatchesStatus) siirMatchesStatus.textContent = "تعذّر تحميل مباريات siir-tv.live";
      return null;
    }
  }

  function pickBest(autoPlay) {
    const live = (catalog.channels || []).filter((c) => c.live);
    if (!live.length) {
      setStatus("لا يوجد بث عربي متاح حالياً — جارٍ إعادة الفحص…");
      return null;
    }
    const primary = live.filter(isPrimaryChannel);
    const pool = primary.length ? primary : live;
    pool.sort((a, b) => {
      const g = groupPickRank(a) - groupPickRank(b);
      if (g !== 0) return g;
      return (a.priority || 99) - (b.priority || 99);
    });
    const best = pool[0];
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
      return r.ok && (/\/dl\/hls\?/.test(t) || /\/sir\/hls\?/.test(t) || /playerv5\.php|shootny/i.test(t));
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

      const dlhd = (catalog.channels || [])
        .filter((c) => c.source === "dlhd")
        .sort((a, b) => groupPickRank(a) - groupPickRank(b) || (a.priority || 99) - (b.priority || 99));
      const sir = (catalog.channels || []).filter((c) => c.source === "sir");

      setStatus("جارٍ فحص القنوات العربية…");
      const primaryDlhd = dlhd.filter(isPrimaryChannel);
      const otherDlhd = dlhd.filter((c) => !isPrimaryChannel(c));
      const probedPrimary = await mapPool(primaryDlhd, 5, probeDlhdChannel);
      setStatus("جارٍ فحص القنوات الأخرى…");
      const probedOther = await mapPool(otherDlhd, 4, probeDlhdChannel);
      const probedDlhd = [...probedPrimary, ...probedOther];
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
      const arLive = catalog.channels.filter((c) => c.live && isPrimaryChannel(c)).length;
      updateLiveUi();
      renderExternal();
      renderSir247();
      await refreshSiirMatches();

      const ts = new Date().toLocaleTimeString("ar-SA");
      setStatus(`آخر فحص: ${ts} — ${arLive} عربي · ${liveCount} إجمالي`);

      const keepCurrent =
        currentRoute &&
        (catalog.channels.some((c) => c.route === currentRoute && c.live) ||
          sir247.some((c) => c.route === currentRoute && c.live) ||
          siirMatches.some((m) => m.route === currentRoute && m.live));
      if (!keepCurrent) pickBest(true);
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
      currentGroup = data.defaultGroup || "ar";
      if (totalCountEl) totalCountEl.textContent = String((data.channels || []).filter(isPrimaryChannel).length);
      renderGroups();
      renderGrid();
      renderExternal();
      renderSir247();
    })
    .catch(() => {})
    .finally(() => refreshStatus());

  setInterval(() => refreshStatus(), 90_000);
  setInterval(() => refreshSiirMatches(), 90_000);
})();
