/* Shared embed-binding config + live routing snapshot (Node). */
const fs = require("fs");
const https = require("https");
const path = require("path");

const BINDINGS_JSON = path.join(__dirname, "..", "assets", "data", "channel-bindings.json");
const BINDINGS_JS = path.join(__dirname, "..", "assets", "js", "channel-bindings.js");
const SNAPSHOT_JSON = path.join(__dirname, "..", "assets", "data", "live-snapshot.json");

const EMBED_URLS = {
  vip1: "https://vip.worldkoora.com/albaplayer/vip1/",
  vip2: "https://vip.worldkoora.com/albaplayer/vip2/",
};

const UPSTREAM_PLAYER_BASE = "https://player.syria-player.live/albaplayer/";

const VIP_SLOTS = Object.keys(EMBED_URLS);

function loadBindings() {
  return JSON.parse(fs.readFileSync(BINDINGS_JSON, "utf8"));
}

function saveBindings(doc) {
  fs.writeFileSync(BINDINGS_JSON, JSON.stringify(doc, null, 2) + "\n");
}

function fetchText(url, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { "User-Agent": "morsh-live/1.0" } }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve(data));
    });
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`timeout after ${timeoutMs}ms`));
    });
  });
}

/** Parse the upstream beIN slug from a worldkoora vip wrapper page. */
function parseUpstreamSlug(html) {
  const match = String(html || "").match(/albaplayer\/(beinmax\d+|bein\d+)\//i);
  return match ? match[1].toLowerCase() : null;
}

/** Map a registry channel id to the upstream slug worldkoora carries inside vip slots. */
function upstreamSlugForChannelId(channelId) {
  const max = /^bein-max-(\d+)$/.exec(channelId || "");
  if (max) return `beinmax${max[1]}`;
  if (channelId === "bein-sports-2") return "bein2";
  if (channelId === "bein-sports-1") return "bein1";
  return null;
}

async function probeVipSlots() {
  const slots = {};
  for (const slot of VIP_SLOTS) {
    try {
      const html = await fetchText(EMBED_URLS[slot]);
      slots[slot] = parseUpstreamSlug(html);
    } catch (_) {
      slots[slot] = null;
    }
  }
  return { probedAt: new Date().toISOString(), slots };
}

function embedKeyFor(channelId, embedBinding) {
  const map = embedBinding || loadBindings().embedBinding;
  return map[channelId] || "vip1";
}

/** Resolve vip slot by matching the probed upstream slug for the match's channel. */
function embedKeyFromProbe(channelId, slotProbe, embedBinding) {
  const slug = upstreamSlugForChannelId(channelId);
  const slots = slotProbe && slotProbe.slots;
  if (slug && slots) {
    for (const slot of VIP_SLOTS) {
      if (slots[slot] === slug) return slot;
    }
  }
  return embedKeyFor(channelId, embedBinding);
}

function resolveMatchEmbedKey(match, slotProbe, embedBinding) {
  if (!match || !match.channelId) return "vip1";
  const slug = upstreamSlugForChannelId(match.channelId);
  const slots = slotProbe && slotProbe.slots;
  if (slug && slots && (match.status === "live" || !match.embedKey)) {
    for (const slot of VIP_SLOTS) {
      if (slots[slot] === slug) return slot;
    }
  }
  if (match.embedKey) return match.embedKey;
  return embedKeyFromProbe(match.channelId, slotProbe, embedBinding);
}

function buildEmbedSpec(embedKey, upstream) {
  const wrapperUrl = EMBED_URLS[embedKey] || EMBED_URLS.vip1;
  if (!upstream) {
    return {
      embedKey,
      embedUpstream: null,
      directEmbedUrl: null,
      wrapperEmbedUrl: wrapperUrl,
      url: wrapperUrl,
      param: "serv",
      servers: 1,
    };
  }
  const directUrl = `${UPSTREAM_PLAYER_BASE}${upstream}/`;
  return {
    embedKey,
    embedUpstream: upstream,
    directEmbedUrl: directUrl,
    wrapperEmbedUrl: wrapperUrl,
    url: directUrl,
    param: null,
    servers: 2,
    mirrors: [
      { url: directUrl, param: null, kind: "direct" },
      { url: wrapperUrl, param: "serv", kind: "wrapper" },
    ],
  };
}

function embedSpecForMatch(match, slotProbe, embedBinding) {
  const embedKey = resolveMatchEmbedKey(match, slotProbe, embedBinding);
  const upstream =
    (slotProbe && slotProbe.slots && slotProbe.slots[embedKey]) ||
    match.embedUpstream ||
    upstreamSlugForChannelId(match.channelId);
  return buildEmbedSpec(embedKey, upstream);
}

/** Write per-match embedKey using live vip-slot probe (source of truth for routing). */
function assignMatchEmbeds(matches, slotProbe, embedBinding) {
  const map = embedBinding || loadBindings().embedBinding;
  for (const m of matches || []) {
    if (!m.channelId) continue;
    const spec = embedSpecForMatch(m, slotProbe, map);
    m.embedKey = spec.embedKey;
    if (spec.embedUpstream) m.embedUpstream = spec.embedUpstream;
    if (spec.directEmbedUrl) m.directEmbedUrl = spec.directEmbedUrl;
    if (spec.wrapperEmbedUrl) m.wrapperEmbedUrl = spec.wrapperEmbedUrl;
  }
}

function pinEndedEmbeds(matches, previousPayload) {
  if (!previousPayload) return;
  const prevById = new Map((previousPayload.matches || []).map((m) => [m.id, m]));
  for (const m of matches || []) {
    if (m.status !== "ended") continue;
    const prev = prevById.get(m.id);
    if (prev && prev.embedKey) {
      m.embedKey = prev.embedKey;
      if (prev.embedUpstream) m.embedUpstream = prev.embedUpstream;
    }
  }
}

function buildLiveSnapshot(matches, bindingDoc) {
  const doc = bindingDoc || loadBindings();
  const embedBinding = doc.embedBinding;
  const slotProbe = doc.vipSlotProbe || null;
  const live = (matches || []).filter((m) => m.status === "live");

  const routes = live.map((m) => {
    const spec = embedSpecForMatch(m, slotProbe, embedBinding);
    const embedKey = spec.embedKey;
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
      embedUpstream: spec.embedUpstream,
      directEmbedUrl: spec.directEmbedUrl,
      embedUrl: spec.url,
      wrapperEmbedUrl: spec.wrapperEmbedUrl,
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
    vipSlotProbe: slotProbe,
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

function writeLiveSnapshot(matches, bindingDoc) {
  const doc = bindingDoc || loadBindings();
  const snapshot = buildLiveSnapshot(matches, doc);
  fs.writeFileSync(SNAPSHOT_JSON, JSON.stringify(snapshot, null, 2) + "\n");
  if (snapshot.conflicts.length) {
    console.warn("⚠️  Channel routing conflict:", JSON.stringify(snapshot.conflicts));
  }
  return snapshot;
}

async function probeAssignAndSync(matches, options = {}) {
  const slotProbe = await probeVipSlots();
  const doc = loadBindings();
  doc.vipSlotProbe = slotProbe;
  doc.updatedAt = new Date().toISOString();
  if (!doc.routing) doc.routing = {};
  doc.routing.mode = "probe-match";
  doc.routing.note =
    "vip1/vip2 are generic wrappers; upstream beinmaxN is probed at fetch time and stored per match as embedKey.";

  assignMatchEmbeds(matches, slotProbe, doc.embedBinding);
  if (options.pinEndedEmbeds && options.previousPayload) {
    pinEndedEmbeds(matches, options.previousPayload);
  }

  saveBindings(doc);
  writeBindingsJs(doc);
  const snapshot = writeLiveSnapshot(matches, doc);
  return { slotProbe, doc, snapshot };
}

module.exports = {
  BINDINGS_JSON,
  BINDINGS_JS,
  SNAPSHOT_JSON,
  EMBED_URLS,
  VIP_SLOTS,
  loadBindings,
  saveBindings,
  parseUpstreamSlug,
  upstreamSlugForChannelId,
  probeVipSlots,
  embedKeyFor,
  embedKeyFromProbe,
  resolveMatchEmbedKey,
  buildEmbedSpec,
  embedSpecForMatch,
  assignMatchEmbeds,
  pinEndedEmbeds,
  buildLiveSnapshot,
  writeBindingsJs,
  writeLiveSnapshot,
  probeAssignAndSync,
};
