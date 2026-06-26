/* Admin routing panel — view all routes, vip slots, manual overrides. */
(function () {
  const LS_KEY = "kz-admin-token";
  const LS_DRAFT = "kz-routing-draft";
  const VIP_KEYS = ["vip1", "vip2"];
  const CHANNEL_IDS = [
    "bein-sports-1", "bein-sports-2",
    "bein-max-1", "bein-max-2", "bein-max-3", "bein-max-4",
  ];
  const CHANNEL_LABELS = {
    "bein-sports-1": "beIN Sports 1",
    "bein-sports-2": "beIN Sports 2",
    "bein-max-1": "beIN MAX 1",
    "bein-max-2": "beIN MAX 2",
    "bein-max-3": "beIN MAX 3",
    "bein-max-4": "beIN MAX 4",
  };

  let baseBindings = {};
  let serverOverrides = { embedBinding: {}, matchOverrides: {} };
  let draft = { embedBinding: {}, matchOverrides: {} };
  let matches = [];
  let token = sessionStorage.getItem(LS_KEY) || "";

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  function embedUrl(key) {
    return `/wk/albaplayer/${key}/?serv=1`;
  }

  function mergedBinding() {
    return window.KZ_ROUTING.mergeBindings(baseBindings, {
      embedBinding: { ...serverOverrides.embedBinding, ...draft.embedBinding },
    });
  }

  function effectiveDraft() {
    return {
      embedBinding: { ...serverOverrides.embedBinding, ...draft.embedBinding },
      matchOverrides: { ...serverOverrides.matchOverrides, ...draft.matchOverrides },
    };
  }

  function saveDraft() {
    sessionStorage.setItem(LS_DRAFT, JSON.stringify(draft));
  }

  function loadDraft() {
    try {
      const raw = sessionStorage.getItem(LS_DRAFT);
      if (raw) draft = JSON.parse(raw);
    } catch (e) {
      draft = { embedBinding: {}, matchOverrides: {} };
    }
  }

  function setStatus(msg, type) {
    const el = $("#status");
    if (!el) return;
    el.textContent = msg;
    el.className = "admin-status" + (type ? ` admin-status--${type}` : "");
  }

  async function fetchJson(url, opts) {
    const res = await fetch(url, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  async function loadBase() {
    const res = await fetch("assets/data/channel-bindings.json", { cache: "no-store" });
    const doc = await res.json();
    baseBindings = doc.embedBinding || {};
    $("#binding-version").textContent = `v${doc.version || "?"}`;
  }

  async function loadServerOverrides() {
    try {
      serverOverrides = await fetchJson("/api/routing");
    } catch (e) {
      serverOverrides = { embedBinding: {}, matchOverrides: {}, source: "unavailable" };
    }
    $("#server-source").textContent = serverOverrides.source || "api";
    if (serverOverrides.updatedAt) {
      $("#server-updated").textContent = new Date(serverOverrides.updatedAt).toLocaleString();
    }
  }

  async function loadMatches() {
    if (window.getMatches) {
      const meta = await window.getMatches({ force: true });
      matches = meta.matches || [];
    } else {
      const res = await fetch("assets/data/today.json", { cache: "no-store" });
      const data = await res.json();
      matches = data.matches || [];
    }
    $("#match-updated").textContent = new Date().toLocaleString();
  }

  function renderVipSlots() {
    const merged = mergedBinding();
    const all = effectiveDraft();
    const { routes, conflicts } = window.KZ_ROUTING.buildRouteRows(matches, merged, all);

    const liveByVip = { vip1: [], vip2: [] };
    routes.filter((r) => r.status === "live").forEach((r) => {
      if (liveByVip[r.embedKey]) liveByVip[r.embedKey].push(r);
    });

    const grid = $("#vip-grid");
    grid.innerHTML = VIP_KEYS.map((vip) => {
      const live = liveByVip[vip] || [];
      const channelsOnVip = CHANNEL_IDS.filter((id) => merged[id] === vip);
      return `<article class="vip-card ${conflicts.some((c) => c.embed === vip) ? "vip-card--warn" : ""}">
        <header class="vip-card__head">
          <h2>${vip.toUpperCase()}</h2>
          <a class="btn btn--sm" href="${embedUrl(vip)}" target="_blank" rel="noopener">Open feed</a>
        </header>
        <p class="vip-card__url"><code>${embedUrl(vip)}</code></p>
        <div class="vip-card__section">
          <h3>Channels bound here</h3>
          <ul>${channelsOnVip.map((id) => `<li>${CHANNEL_LABELS[id] || id}</li>`).join("") || "<li class='muted'>None</li>"}</ul>
        </div>
        <div class="vip-card__section">
          <h3>Live matches routed here</h3>
          <ul>${live.map((r) => `<li><strong>${r.home} vs ${r.away}</strong> <span class="muted">(${r.channel || r.channelId})</span></li>`).join("") || "<li class='muted'>No live matches</li>"}</ul>
        </div>
      </article>`;
    }).join("");

    const alert = $("#conflicts");
    if (conflicts.length) {
      alert.hidden = false;
      alert.innerHTML = `<strong>⚠ ${conflicts.length} conflict(s)</strong> — multiple live matches share the same vip feed:<ul>${
        conflicts.map((c) => `<li><b>${c.embed}</b>: ${c.games.join("; ")}</li>`).join("")
      }</ul>`;
    } else {
      alert.hidden = true;
      alert.innerHTML = "";
    }
  }

  function vipSelect(name, value, attrs) {
    const opts = VIP_KEYS.map((k) => `<option value="${k}" ${value === k ? "selected" : ""}>${k}</option>`).join("");
    return `<select name="${name}" class="route-select" ${attrs || ""}>${opts}</select>`;
  }

  function renderChannelTable() {
    const merged = mergedBinding();
    const tbody = $("#channel-rows");
    tbody.innerHTML = CHANNEL_IDS.map((id) => {
      const base = baseBindings[id] || "vip1";
      const effective = merged[id] || "vip1";
      const changed = effective !== base;
      return `<tr class="${changed ? "row-changed" : ""}">
        <td>${CHANNEL_LABELS[id] || id}</td>
        <td><code>${id}</code></td>
        <td><span class="pill">${base}</span></td>
        <td>${vipSelect(`ch-${id}`, effective, `data-channel="${id}"`)}</td>
        <td><a class="btn btn--sm" href="watch.html?ch=${id}" target="_blank" rel="noopener">Watch</a></td>
      </tr>`;
    }).join("");

    $$("#channel-rows .route-select").forEach((sel) => {
      sel.addEventListener("change", () => {
        const ch = sel.dataset.channel;
        const val = sel.value;
        if (val === (baseBindings[ch] || "vip1")) {
          delete draft.embedBinding[ch];
        } else {
          draft.embedBinding[ch] = val;
        }
        saveDraft();
        renderAll();
      });
    });
  }

  function renderMatchTable() {
    const merged = mergedBinding();
    const all = effectiveDraft();
    const { routes } = window.KZ_ROUTING.buildRouteRows(matches, merged, all);
    const order = { live: 0, upcoming: 1, ended: 2 };
    routes.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));

    const tbody = $("#match-rows");
    tbody.innerHTML = routes.map((r) => {
      const channelDefault = merged[r.channelId] || "vip1";
      const overrideVal = all.matchOverrides[r.id] || "";
      const changed = r.hasOverride || r.embedKey !== channelDefault;
      return `<tr class="${changed ? "row-changed" : ""} status-${r.status}">
        <td><span class="pill pill--${r.status}">${r.status}</span></td>
        <td><strong>${r.home}</strong> vs ${r.away}</td>
        <td>${r.channel || r.channelId || "—"}</td>
        <td><span class="pill">${channelDefault}</span></td>
        <td>
          <select class="route-select" data-match="${r.id}" data-default="${channelDefault}">
            <option value="">(channel default)</option>
            ${VIP_KEYS.map((k) => `<option value="${k}" ${overrideVal === k ? "selected" : ""}>${k}</option>`).join("")}
          </select>
        </td>
        <td><span class="pill pill--route">${r.embedKey}</span></td>
        <td><a class="btn btn--sm" href="watch.html?match=${r.id}&ch=${r.channelId || "live"}" target="_blank" rel="noopener">Watch</a></td>
      </tr>`;
    }).join("") || "<tr><td colspan='7' class='muted'>No matches loaded</td></tr>";

    $$("#match-rows .route-select").forEach((sel) => {
      sel.addEventListener("change", () => {
        const id = sel.dataset.match;
        const def = sel.dataset.default;
        if (!sel.value || sel.value === def) {
          delete draft.matchOverrides[id];
        } else {
          draft.matchOverrides[id] = sel.value;
        }
        saveDraft();
        renderAll();
      });
    });
  }

  function renderAll() {
    renderVipSlots();
    renderChannelTable();
    renderMatchTable();
    const hasDraft = Object.keys(draft.embedBinding).length || Object.keys(draft.matchOverrides).length;
    $("#btn-save").disabled = !hasDraft;
    $("#btn-reset-draft").disabled = !hasDraft;
  }

  async function saveToServer() {
    if (!token) {
      setStatus("Enter admin token first", "error");
      return;
    }
    const payload = effectiveDraft();
    try {
      const data = await fetchJson("/api/admin/routing", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      serverOverrides = data;
      draft = { embedBinding: {}, matchOverrides: {} };
      saveDraft();
      setStatus("Saved — live for all visitors", "ok");
      renderAll();
    } catch (e) {
      setStatus(`Save failed: ${e.message}. Is ROUTING_KV + ADMIN_TOKEN configured on the Worker?`, "error");
    }
  }

  function resetDraft() {
    draft = { embedBinding: {}, matchOverrides: {} };
    saveDraft();
    setStatus("Draft cleared", "ok");
    renderAll();
  }

  function exportJson() {
    const payload = {
      ...effectiveDraft(),
      exportedAt: new Date().toISOString(),
      note: "Merge embedBinding into assets/data/channel-bindings.json for permanent git-based routing",
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `routing-overrides-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    setStatus("Exported JSON", "ok");
  }

  function showApp(show) {
    $("#gate").hidden = show;
    $("#app").hidden = !show;
  }

  async function initApp() {
    loadDraft();
    await Promise.all([loadBase(), loadServerOverrides(), loadMatches()]);
    renderAll();
    setStatus("Dashboard loaded", "ok");
  }

  document.addEventListener("DOMContentLoaded", () => {
    if (token) {
      showApp(true);
      initApp().catch((e) => setStatus(e.message, "error"));
    }

    $("#gate-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      token = $("#token-input").value.trim();
      if (!token) return;
      sessionStorage.setItem(LS_KEY, token);
      showApp(true);
      try {
        await initApp();
      } catch (err) {
        setStatus(err.message, "error");
      }
    });

    $("#btn-logout").addEventListener("click", () => {
      sessionStorage.removeItem(LS_KEY);
      token = "";
      showApp(false);
      $("#token-input").value = "";
    });

    $("#btn-refresh").addEventListener("click", async () => {
      setStatus("Refreshing…");
      await Promise.all([loadServerOverrides(), loadMatches()]);
      renderAll();
      setStatus("Refreshed", "ok");
    });

    $("#btn-save").addEventListener("click", saveToServer);
    $("#btn-reset-draft").addEventListener("click", resetDraft);
    $("#btn-export").addEventListener("click", exportJson);

    $("#btn-skip-gate").addEventListener("click", () => {
      showApp(true);
      initApp().catch((e) => setStatus(e.message, "error"));
    });
  });
})();
