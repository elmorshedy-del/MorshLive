/* Shared embed-binding config + live routing snapshot (Node). */
const fs = require("fs");
const path = require("path");

const BINDINGS_JSON = path.join(__dirname, "..", "assets", "data", "channel-bindings.json");
const BINDINGS_JS = path.join(__dirname, "..", "assets", "js", "channel-bindings.js");
const SNAPSHOT_JSON = path.join(__dirname, "..", "assets", "data", "live-snapshot.json");
const STREAM_PLANS_JSON = path.join(__dirname, "..", "assets", "data", "stream-plans.json");

const EMBED_URLS = {
  vip1: "https://vip.worldkoora.com/albaplayer/vip1/",
  vip2: "https://vip.worldkoora.com/albaplayer/vip2/",
  amine: "https://yallashooot.tv/albaplayer/amine/",
};

function loadBindings() {
  return JSON.parse(fs.readFileSync(BINDINGS_JSON, "utf8"));
}

function embedKeyFor(channelId, embedBinding) {
  const map = embedBinding || loadBindings().embedBinding;
  return map[channelId] || "vip1";
}

function loadStreamPlanCatalog() {
  try {
    return JSON.parse(fs.readFileSync(STREAM_PLANS_JSON, "utf8"));
  } catch {
    return { plans: [] };
  }
}

/** Match ids that already have a unique stream-plan content key (not the shared 24/7 embed). */
function plannedMatchIds(catalog) {
  const keys = new Map();
  for (const plan of catalog?.plans || []) {
    const id = String(plan.matchId || "").trim();
    const contentKey = String(plan.contentKey || "").trim();
    if (id && contentKey) keys.set(id, contentKey);
  }
  const counts = new Map();
  for (const contentKey of keys.values()) {
    counts.set(contentKey, (counts.get(contentKey) || 0) + 1);
  }
  const planned = new Set();
  for (const [id, contentKey] of keys) {
    if (counts.get(contentKey) === 1) planned.add(id);
  }
  return planned;
}

function buildLiveSnapshot(matches, bindingDoc, catalog) {
  const doc = bindingDoc || loadBindings();
  const embedBinding = doc.embedBinding;
  const planned = plannedMatchIds(catalog || loadStreamPlanCatalog());
  const live = (matches || []).filter((m) => m.status === "live");

  const routes = live.map((m) => {
    const embedKey = embedKeyFor(m.channelId, embedBinding);
    return {
      id: m.id,
      home: m.home,
      away: m.away,
      score: m.score,
      minute: m.minute || "",
      channelId: m.channelId || null,
      channel: m.channel || null,
      commentator: m.commentator || null,
      embedKey,
      embedUrl: EMBED_URLS[embedKey] || EMBED_URLS.vip1,
      kickoffUtc: m.kickoffUtc || null,
    };
  });

  const byEmbed = {};
  routes.forEach((r) => {
    if (planned.has(r.id)) return;
    if (!byEmbed[r.embedKey]) byEmbed[r.embedKey] = [];
    byEmbed[r.embedKey].push(`${r.home} vs ${r.away} (${r.channelId})`);
  });

  const conflicts = Object.entries(byEmbed)
    .filter(([, games]) => games.length > 1)
    .map(([embed, games]) => ({ embed, games }));

  return {
    updatedAt: new Date().toISOString(),
    bindingVersion: doc.version,
    embedBinding,
    liveCount: live.length,
    routes,
    conflicts,
    ok: conflicts.length === 0,
    warning: conflicts.length
      ? `${conflicts.length} embed conflict(s): multiple live matches share the same vip feed`
      : null,
  };
}

function writeBindingsJs(doc) {
  const payload = doc || loadBindings();
  const js =
    "/* Auto-synced from assets/data/channel-bindings.json by fetch-matches.js */\n" +
    `window.KZ_CHANNEL_BINDINGS = ${JSON.stringify(payload, null, 2)};\n`;
  fs.writeFileSync(BINDINGS_JS, js);
}

function writeLiveSnapshot(matches) {
  const doc = loadBindings();
  const snapshot = buildLiveSnapshot(matches, doc, loadStreamPlanCatalog());
  fs.writeFileSync(SNAPSHOT_JSON, JSON.stringify(snapshot, null, 2));
  if (snapshot.conflicts.length) {
    console.warn("⚠️  Channel routing conflict:", JSON.stringify(snapshot.conflicts));
  }
  return snapshot;
}

module.exports = {
  BINDINGS_JSON,
  BINDINGS_JS,
  SNAPSHOT_JSON,
  STREAM_PLANS_JSON,
  EMBED_URLS,
  loadBindings,
  loadStreamPlanCatalog,
  plannedMatchIds,
  embedKeyFor,
  buildLiveSnapshot,
  writeBindingsJs,
  writeLiveSnapshot,
};
