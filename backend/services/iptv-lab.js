import { iptvLabWorkerEnv } from "../../lib/iptv-lab.js";
import { fetchXtreamJson, fetchXtreamSourceMaps, loadXtreamPortals } from "../adapters/xtream.js";
import { getXtreamCategories, getXtreamLive, getXtreamStatus, probeXtreamChannel } from "./xtream.js";

function labOrError(env) {
  const lab = iptvLabWorkerEnv(env);
  if (!lab.ok) return { error: lab.error, status: 404 };
  return lab;
}

function isolate(result) {
  return {
    ...result,
    body: { ...result.body, isolated: true, source: "IPTV_LAB_JSON" },
  };
}

function missingSecret(lab) {
  return {
    body: { ok: false, error: lab.error, isolated: true, source: "IPTV_LAB_JSON" },
    status: lab.status,
  };
}

function catalogRow(row, portal, categoryMap) {
  const categoryId = String(row.category_id || row._playlistGroup || "");
  return {
    portalId: portal.id,
    portalLabel: portal.label,
    streamId: row.stream_id || row.streamId,
    name: String(row.name || "Untitled channel"),
    categoryId,
    categoryName: categoryMap.get(categoryId) || row._playlistGroup || null,
    icon: row.stream_icon || row._playlistIcon || null,

    // Stable logical-channel metadata. The browser resolver uses these before
    // any display-name matching. EPG/tvg id is normally shared by HD/SD/HEVC
    // variants of the same real channel.
    epgChannelId: row.epg_channel_id || row._playlistEpgId || null,
    providerChannelId: row.channel_id || row.channelId || row.uuid || row.channel_uuid || null,
    customSid: row.custom_sid || row.customSid || null,
    serviceId: row.service_id || row.serviceId || null,

    // Provider-scoped metadata used only to distinguish variants / diagnose a
    // catalog when no persistent identity field exists.
    num: row.num || null,
    streamType: row.stream_type || row.streamType || null,
    added: row.added || null,
    tvArchive: row.tv_archive || 0,
    tvArchiveDuration: row.tv_archive_duration || null,
  };
}

function playlistRows(sources) {
  const seen = new Set();
  const rows = [];
  for (const entry of [...sources.hlsEntries, ...sources.tsEntries]) {
    const id = String(entry.streamId || "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    rows.push({
      stream_id: id,
      name: entry.name,
      category_id: entry.group,
      _playlistGroup: entry.group,
      _playlistIcon: entry.icon,
      _playlistEpgId: entry.epgChannelId,
    });
  }
  return rows;
}

async function loadCatalog(lab) {
  const loaded = loadXtreamPortals(lab.env);
  if (loaded.error || !loaded.portals.length) {
    throw new Error(loaded.error || "No IPTV Lab portal configured");
  }

  const portal = loaded.portals[0];
  const [categoryRows, streamRows] = await Promise.all([
    fetchXtreamJson(portal, "get_live_categories", 14000).catch(() => []),
    fetchXtreamJson(portal, "get_live_streams", 20000).catch(() => []),
  ]);
  const categoryMap = new Map(
    (Array.isArray(categoryRows) ? categoryRows : []).map((row) => [
      String(row.category_id || ""),
      String(row.category_name || row.name || "Uncategorized"),
    ]),
  );

  let rows = Array.isArray(streamRows) ? streamRows : [];
  if (!rows.length) {
    const sources = await fetchXtreamSourceMaps(portal);
    rows = playlistRows(sources);
    for (const entry of [...sources.hlsEntries, ...sources.tsEntries]) {
      if (entry.group && !categoryMap.has(entry.group)) categoryMap.set(entry.group, entry.group);
    }
  }

  return {
    portal,
    streams: rows.map((row) => catalogRow(row, portal, categoryMap)),
  };
}

function normalizedIdentifier(value) {
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/^tvg:/, "")
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9._:@/-]+/g, "");
}

function logicalKey(channel) {
  const epg = normalizedIdentifier(channel?.epgChannelId);
  if (epg) return `epg:${epg}`;
  const provider = normalizedIdentifier(channel?.providerChannelId);
  if (provider) return `provider-channel:${provider}`;
  const service = normalizedIdentifier(channel?.customSid || channel?.serviceId);
  if (service) return `service:${service}`;
  const stream = normalizedIdentifier(channel?.streamId);
  return stream ? `portal:${normalizedIdentifier(channel?.portalId || "lab") || "lab"}:stream:${stream}` : "";
}

function sportsCandidate(channel) {
  const text =
    `${channel?.name || ""} ${channel?.categoryName || ""} ${channel?.epgChannelId || ""}`.toLowerCase();
  return /(sport|bein|ssc|dazn|espn|tnt|sky|alkass|الكاس|الكأس|mbc|football|soccer|كرة|رياض)/i.test(text);
}

function representativeScore(channel) {
  const text = `${channel?.name || ""} ${channel?.categoryName || ""}`.toLowerCase();
  let score = 0;
  if (channel?.epgChannelId) score += 20;
  if (/\bfhd\b|1080/.test(text)) score += 5;
  else if (/\bhd\b|720/.test(text)) score += 4;
  if (/backup|\bbk\b|test|alt/.test(text)) score -= 20;
  return score;
}

function decodeMaybeBase64(value) {
  const input = String(value || "").trim();
  if (!input || input.length < 8 || input.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(input)) {
    return input;
  }
  try {
    const bytes = Uint8Array.from(atob(input), (character) => character.charCodeAt(0));
    const decoded = new TextDecoder().decode(bytes).trim();
    const hasControl = [...decoded].some((character) => character.charCodeAt(0) < 9);
    if (decoded && /[A-Za-z0-9\u0600-\u06ff]/.test(decoded) && !hasControl) {
      return decoded;
    }
  } catch {
    // Plain text is valid too.
  }
  return input;
}

function normalizeListing(row) {
  const startTimestamp = Number(row?.start_timestamp || row?.startTimestamp || 0) || 0;
  const stopTimestamp = Number(row?.stop_timestamp || row?.stopTimestamp || 0) || 0;
  return {
    id: String(row?.id || ""),
    title: decodeMaybeBase64(row?.title),
    description: decodeMaybeBase64(row?.description),
    channelId: row?.channel_id || row?.channelId || null,
    start: row?.start || null,
    end: row?.end || null,
    startTimestamp,
    stopTimestamp,
    nowPlaying: Number(row?.now_playing || row?.nowPlaying || 0) === 1,
  };
}

// Testing switch. Set true to restore the normal one-hour post-match EPG expiry.
const EPG_POST_MATCH_EXPIRY_ENABLED = false;
const EPG_POST_MATCH_EXPIRY_SECONDS = 60 * 60;
const EPG_FUTURE_WINDOW_SECONDS = 8 * 60 * 60;

function usefulListings(payload, nowSeconds = Math.floor(Date.now() / 1000)) {
  const rows = Array.isArray(payload?.epg_listings)
    ? payload.epg_listings
    : Array.isArray(payload?.epgListings)
      ? payload.epgListings
      : [];
  return rows.map(normalizeListing).filter((listing) => {
    if (listing.nowPlaying) return true;
    if (!listing.startTimestamp || !listing.stopTimestamp) return true;
    if (listing.startTimestamp > nowSeconds + EPG_FUTURE_WINDOW_SECONDS) return false;
    if (!EPG_POST_MATCH_EXPIRY_ENABLED) return true;
    return listing.stopTimestamp >= nowSeconds - EPG_POST_MATCH_EXPIRY_SECONDS;
  });
}

async function fetchGroupEpg(portal, group) {
  const representative = [...group.channels].sort(
    (a, b) => representativeScore(b) - representativeScore(a),
  )[0];
  if (!representative?.streamId) return [];
  try {
    const payload = await fetchXtreamJson(portal, "get_short_epg", 9000, {
      stream_id: representative.streamId,
      limit: 8,
    });
    return usefulListings(payload).map((listing) => ({
      ...listing,
      logicalKey: group.logicalKey,
      epgChannelId: representative.epgChannelId || null,
      providerChannelId: representative.providerChannelId || null,
      serviceId: representative.customSid || representative.serviceId || null,
      channelName: representative.name || "",
      categoryName: representative.categoryName || "",
      representativeStreamId: String(representative.streamId),
      streamIds: group.channels.map((channel) => String(channel.streamId || "")).filter(Boolean),
    }));
  } catch {
    return [];
  }
}

async function mapInBatches(items, batchSize, mapper) {
  const output = [];
  for (let index = 0; index < items.length; index += batchSize) {
    const batch = items.slice(index, index + batchSize);
    const rows = await Promise.all(batch.map(mapper));
    output.push(...rows.flat());
  }
  return output;
}

/** Metadata-only current provider catalog. No playback tokens are minted here. */
export async function getIptvLabCatalog(env) {
  const lab = labOrError(env);
  if (lab.error) return missingSecret(lab);

  try {
    const { streams } = await loadCatalog(lab);
    return {
      body: {
        ok: true,
        isolated: true,
        source: "IPTV_LAB_JSON",
        count: streams.length,
        streams,
      },
      status: 200,
    };
  } catch (error) {
    return {
      body: {
        ok: false,
        isolated: true,
        source: "IPTV_LAB_JSON",
        error: String(error?.message || error),
      },
      status: 502,
    };
  }
}

/** Current + near-future EPG for logical sports channels, grouped across variants. */
export async function getIptvLabEpg(env) {
  const lab = labOrError(env);
  if (lab.error) return missingSecret(lab);

  try {
    const { portal, streams } = await loadCatalog(lab);
    const groupsByKey = new Map();
    for (const channel of streams) {
      if (!sportsCandidate(channel)) continue;
      const key = logicalKey(channel);
      if (!key) continue;
      const group = groupsByKey.get(key) || { logicalKey: key, channels: [] };
      group.channels.push(channel);
      groupsByKey.set(key, group);
    }

    const groups = [...groupsByKey.values()].slice(0, 64);
    const programs = await mapInBatches(groups, 8, (group) => fetchGroupEpg(portal, group));
    return {
      body: {
        ok: true,
        isolated: true,
        source: "IPTV_LAB_JSON",
        generatedAt: new Date().toISOString(),
        channelGroups: groups.length,
        count: programs.length,
        programs,
      },
      status: 200,
    };
  } catch (error) {
    return {
      body: {
        ok: false,
        isolated: true,
        source: "IPTV_LAB_JSON",
        error: String(error?.message || error),
      },
      status: 502,
    };
  }
}

export async function getIptvLabStatus(env, searchParams) {
  const lab = labOrError(env);
  if (lab.error) return missingSecret(lab);
  return isolate(await getXtreamStatus(lab.env, searchParams));
}

export async function getIptvLabCategories(env, searchParams) {
  const lab = labOrError(env);
  if (lab.error) return missingSecret(lab);
  return isolate(await getXtreamCategories(lab.env, searchParams));
}

export async function getIptvLabLive(env, searchParams) {
  const lab = labOrError(env);
  if (lab.error) return missingSecret(lab);
  const params = new URLSearchParams(searchParams);
  params.delete("direct");
  return isolate(await getXtreamLive(lab.env, params));
}

export async function probeIptvLabChannel(env, searchParams) {
  const lab = labOrError(env);
  if (lab.error) return missingSecret(lab);
  return isolate(await probeXtreamChannel(lab.env, searchParams));
}
