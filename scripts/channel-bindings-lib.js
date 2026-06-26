/* Shared embed-binding config + live routing snapshot (Node). */
const fs = require("fs");
const path = require("path");

const BINDINGS_JSON = path.join(__dirname, "..", "assets", "data", "channel-bindings.json");
const BINDINGS_JS = path.join(__dirname, "..", "assets", "js", "channel-bindings.js");
const SNAPSHOT_JSON = path.join(__dirname, "..", "assets", "data", "live-snapshot.json");

const EMBED_URLS = {
  vip1: "https://vip.worldkoora.com/albaplayer/vip1/",
  vip2: "https://vip.worldkoora.com/albaplayer/vip2/",
};

function loadBindings() {
  return JSON.parse(fs.readFileSync(BINDINGS_JSON, "utf8"));
}

function embedKeyFor(channelId, embedBinding) {
  const map = embedBinding || loadBindings().embedBinding;
  return map[channelId] || "vip1";
}

function buildLiveSnapshot(matches, bindingDoc, overrides) {
  const doc = bindingDoc || loadBindings();
  const embedBinding = doc.embedBinding;
  const over = overrides || { embedBinding: {}, matchOverrides: {} };
  const merged = { ...embedBinding, ...(over.embedBinding || {}) };
  const matchOverrides = over.matchOverrides || {};
  const live = (matches || []).filter((m) => m.status === "live");

  const routes = live.map((m) => {
    const embedKey = matchOverrides[m.id] || m.embedKey || embedKeyFor(m.channelId, merged);
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
  const snapshot = buildLiveSnapshot(matches, doc);
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
  EMBED_URLS,
  loadBindings,
  embedKeyFor,
  buildLiveSnapshot,
  writeBindingsJs,
  writeLiveSnapshot,
};
