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

/** Metadata-only current provider catalog. No playback tokens are minted here. */
export async function getIptvLabCatalog(env) {
  const lab = labOrError(env);
  if (lab.error) return missingSecret(lab);

  const loaded = loadXtreamPortals(lab.env);
  if (loaded.error || !loaded.portals.length) {
    return {
      body: {
        ok: false,
        error: loaded.error || "No IPTV Lab portal configured",
        isolated: true,
        source: "IPTV_LAB_JSON",
      },
      status: 503,
    };
  }

  const portal = loaded.portals[0];
  try {
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

    const streams = rows.map((row) => catalogRow(row, portal, categoryMap));
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
