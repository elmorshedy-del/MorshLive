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

/** Parse the upstream channel slug from the iframe inside a worldkoora vip page (routing only). */
function parseUpstreamSlug(html) {
  const tags = String(html || "").match(/<iframe\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const src = tag.match(/\bsrc=['"](https?:\/\/[^'"]+)['"]/i);
    if (!src) continue;
    const slug = src[1].match(/albaplayer\/([^/'"]+)/i);
    if (slug && !/\.js(\?|$)/i.test(slug[1])) return slug[1].toLowerCase();
  }
  return null;
}

/** True when a probed upstream slug matches the registry channel (for vip slot pick). */
function channelMatchesProbeSlug(channelId, slug) {
  if (!channelId || !slug) return false;
  const max = /^bein-max-(\d+)$/.exec(channelId);
  if (max) {
    const n = max[1];
    return slug === `beinmax${n}` || slug === `bein-sports-hd-${n}` || slug === `beinmax-${n}`;
  }
  if (channelId === "bein-sports-1") {
    return slug === "bein-sports-hd-1" || slug === "bein1" || slug === "beinmax1";
  }
  if (channelId === "bein-sports-2") {
    return slug === "bein-sports-hd-2" || slug === "bein2" || slug === "beinmax2";
  }
  return false;
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

/** Resolve vip slot by probing worldkoora — playback URL stays vip.worldkoora.com. */
function embedKeyFromProbe(channelId, slotProbe, embedBinding) {
  const slots = slotProbe && slotProbe.slots;
  if (slots && channelId) {
    for (const slot of VIP_SLOTS) {
      if (channelMatchesProbeSlug(channelId, slots[slot])) return slot;
    }
  }
  return embedKeyFor(channelId, embedBinding);
}

function resolveMatchEmbedKey(match, slotProbe, embedBinding) {
  if (!match || !match.channelId) return "vip1";
  if (match.embedKey) return match.embedKey;
  return embedKeyFromProbe(match.channelId, slotProbe, embedBinding);
}

function embedSpecForMatch(match, slotProbe, embedBinding) {
  if (!match || !match.channelId) {
    return { embedKey: "vip1", embedUrl: EMBED_URLS.vip1, embedUpstream: null };
  }
  const embedKey = resolveMatchEmbedKey(match, slotProbe, embedBinding);
  const embedUpstream =
    (slotProbe && slotProbe.slots && slotProbe.slots[embedKey]) ||
    match.embedUpstream ||
    upstreamSlugForChannelId(match.channelId);
  return {
    embedKey,
    embedUpstream: embedUpstream || null,
    embedUrl: EMBED_URLS[embedKey] || EMBED_URLS.vip1,
  };
}

/** Write per-match embedKey using live vip-slot probe (source of truth for routing). */
function assignMatchEmbeds(matches, slotProbe, embedBinding) {
  const map = embedBinding || loadBindings().embedBinding;
  for (const m of matches || []) {
    if (!m.channelId) continue;
    const spec = embedSpecForMatch(m, slotProbe, map);
    m.embedKey = spec.embedKey;
    if (spec.embedUpstream) m.embedUpstream = spec.embedUpstream;
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
      embedUrl: spec.embedUrl,
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
    "Probe worldkoora vip pages for slot routing only. Playback is always vip.worldkoora.com — no alternate hosts.";

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
  channelMatchesProbeSlug,
  parseUpstreamSlug,
  upstreamSlugForChannelId,
  probeVipSlots,
  embedKeyFor,
  embedKeyFromProbe,
  resolveMatchEmbedKey,
  embedSpecForMatch,
  assignMatchEmbeds,
  pinEndedEmbeds,
  buildLiveSnapshot,
  writeBindingsJs,
  writeLiveSnapshot,
  probeAssignAndSync,
};
