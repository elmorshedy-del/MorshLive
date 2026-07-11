import {
  createMediaToken,
  fetchXtreamJson,
  fetchXtreamSourceMaps,
  loadXtreamPortals,
  probeXtreamPlayback,
  streamUrl,
} from "../adapters/xtream.js";

function mask(value) {
  const text = String(value || "");
  if (text.length <= 4) return "***";
  return `${text.slice(0, 2)}***${text.slice(-2)}`;
}

function publicPortal(portal) {
  return {
    id: portal.id,
    label: portal.label,
    usernameMasked: mask(portal.username),
    passwordMasked: mask(portal.password),
    expiry: portal.expiry,
    maxConnections: portal.maxConnections,
    activeConnections: portal.activeConnections,
  };
}

function accountInfo(info) {
  const user = info?.user_info ? info.user_info : {};
  const server = info?.server_info ? info.server_info : {};
  return {
    auth: user.auth,
    status: user.status,
    expDate: user.exp_date || null,
    maxConnections: user.max_connections || null,
    activeConnections: user.active_cons || null,
    allowedOutputFormats: user.allowed_output_formats || [],
    serverProtocol: server.server_protocol || null,
    serverPort: server.port || null,
    timezone: server.timezone || null,
  };
}

function categoryRow(row, portal) {
  return {
    portalId: portal.id,
    portalLabel: portal.label,
    categoryId: String(row.category_id || ""),
    name: String(row.category_name || row.name || "Uncategorized"),
    parentId: row.parent_id || null,
  };
}

async function liveRow(row, portal, categoryMap, env, sources) {
  const categoryId = String(row.category_id || row._playlistGroup || "");
  const id = String(row.stream_id || "");
  const hlsSource = sources.hls.get(id) || streamUrl(portal, row.stream_id, "m3u8");
  const tsSource = sources.ts.get(id) || streamUrl(portal, row.stream_id, "ts");
  const [hlsToken, tsToken] = await Promise.all([
    createMediaToken(env, hlsSource),
    createMediaToken(env, tsSource),
  ]);
  return {
    portalId: portal.id,
    portalLabel: portal.label,
    streamId: row.stream_id,
    name: row.name || "Untitled channel",
    categoryId,
    categoryName: categoryMap.get(categoryId) || row._playlistGroup || null,
    icon: row.stream_icon || row._playlistIcon || null,
    epgChannelId: row.epg_channel_id || row._playlistEpgId || null,
    added: row.added || null,
    num: row.num || null,
    tvArchive: row.tv_archive || 0,
    playbackUrl: `/api/xtream/media/${hlsToken}`,
    tsPlaybackUrl: `/api/xtream/media/${tsToken}`,
  };
}

function rowsFromPlaylists(sources) {
  const byId = new Map();
  for (const entry of [...sources.hlsEntries, ...sources.tsEntries]) {
    const id = String(entry.streamId || "");
    if (!id || byId.has(id)) continue;
    byId.set(id, {
      stream_id: id,
      name: entry.name,
      category_id: entry.group,
      _playlistGroup: entry.group,
      _playlistIcon: entry.icon,
      _playlistEpgId: entry.epgChannelId,
    });
  }
  return [...byId.values()];
}

function selectPortals(env, searchParams) {
  const { portals, error } = loadXtreamPortals(env);
  if (error) return { portals: [], all: [], error };
  const selected = String(searchParams.get("portal") || "").trim();
  const usable = selected
    ? portals.filter((portal) => portal.id === selected || portal.label === selected)
    : portals;
  if (!usable.length) {
    return {
      portals: [],
      all: portals,
      error: "No matching Xtream portal configured",
      status: 404,
    };
  }
  return { portals: usable, all: portals };
}

function safeError(error) {
  return error && error.name === "AbortError" ? "timeout" : String(error.message || error);
}

export async function probeXtreamChannel(env, searchParams) {
  const selected = selectPortals(env, searchParams);
  if (selected.error) {
    return {
      body: { ok: false, playable: false, error: selected.error },
      status: selected.status || 503,
    };
  }
  const streamId = String(searchParams.get("stream") || "").replace(/[^0-9]/g, "");
  if (!streamId) {
    return { body: { ok: false, playable: false, error: "stream is required" }, status: 400 };
  }
  const portal = selected.portals[0];
  const sources = await fetchXtreamSourceMaps(portal);
  const result = await probeXtreamPlayback(portal, streamId, sources);
  return {
    body: {
      ok: true,
      playable: Boolean(result.ok),
      portalId: portal.id,
      streamId,
      protocol: result.ok ? result.protocol : null,
      mobileCompatible: Boolean(result.ok && result.mobileCompatible),
      codecs: result.ok ? result.codecs || null : null,
      status: result.ok ? result.status : result.ts?.status || result.hls?.status || 0,
    },
    status: 200,
  };
}

async function getPortalMediaStatus(portal) {
  try {
    const [rows, sources] = await Promise.all([
      fetchXtreamJson(portal, "get_live_streams", 20000).catch(() => []),
      fetchXtreamSourceMaps(portal),
    ]);
    const apiRows = Array.isArray(rows) ? rows : [];
    const all = apiRows.length ? apiRows : rowsFromPlaylists(sources);
    const preferred = all.filter((row) => /bein|sport/i.test(String(row.name || "")));
    const candidates = [...preferred, ...all.filter((row) => !preferred.includes(row))].slice(0, 8);
    const diagnostics = {
      catalogCount: all.length,
      hlsPlaylistCount: sources.hlsEntries.length,
      tsPlaylistCount: sources.tsEntries.length,
      tested: [],
    };
    let desktopFallback = null;
    for (const row of candidates) {
      const probe = await probeXtreamPlayback(portal, row.stream_id, sources);
      diagnostics.tested.push({
        streamId: row.stream_id,
        hlsStatus: probe.ok && probe.protocol === "hls" ? probe.status : probe.hls?.status || null,
        tsStatus: probe.ok && probe.protocol === "ts" ? probe.status : probe.ts?.status || null,
      });
      if (!probe.ok) continue;
      const result = {
        playable: true,
        protocol: probe.protocol,
        mobileCompatible: Boolean(probe.mobileCompatible),
        codecs: probe.codecs || null,
        sampleStreamId: row.stream_id,
        sampleName: row.name || null,
        diagnostics,
      };
      if (probe.mobileCompatible) return result;
      if (!desktopFallback) desktopFallback = result;
    }
    return desktopFallback || { playable: false, protocol: null, mobileCompatible: false, diagnostics };
  } catch (error) {
    return { playable: false, protocol: null, mobileCompatible: false, error: safeError(error) };
  }
}

export async function getXtreamStatus(env, searchParams) {
  const selected = selectPortals(env, searchParams);
  if (selected.error) {
    return {
      body: {
        ok: false,
        error: selected.error,
        portals: selected.all.map(publicPortal),
      },
      status: selected.status || 503,
    };
  }

  const includeMedia = searchParams.get("media") === "1";
  const results = await Promise.all(
    selected.portals.map(async (portal) => {
      const safe = publicPortal(portal);
      try {
        const [info, media] = await Promise.all([
          fetchXtreamJson(portal, null, 10000),
          includeMedia ? getPortalMediaStatus(portal) : Promise.resolve(null),
        ]);
        return { ...safe, ok: true, account: accountInfo(info), ...(media ? { media } : {}) };
      } catch (error) {
        return { ...safe, ok: false, error: safeError(error) };
      }
    }),
  );
  return { body: { ok: true, count: results.length, portals: results }, status: 200 };
}

export async function getXtreamCategories(env, searchParams) {
  const selected = selectPortals(env, searchParams);
  if (selected.error) {
    return {
      body: { ok: false, error: selected.error, portals: selected.all.map(publicPortal) },
      status: selected.status || 503,
    };
  }

  const blocks = await Promise.all(
    selected.portals.map(async (portal) => {
      const safe = publicPortal(portal);
      try {
        const [rows, sources] = await Promise.all([
          fetchXtreamJson(portal, "get_live_categories", 14000).catch(() => []),
          fetchXtreamSourceMaps(portal),
        ]);
        let categories = Array.isArray(rows) ? rows.map((row) => categoryRow(row, portal)) : [];
        if (!categories.length) {
          const groups = [
            ...new Set([...sources.hlsEntries, ...sources.tsEntries].map((entry) => entry.group)),
          ];
          categories = groups.map((name) => ({
            portalId: portal.id,
            portalLabel: portal.label,
            categoryId: name,
            name,
            parentId: null,
          }));
        }
        return { portal: safe, ok: true, count: categories.length, categories };
      } catch (error) {
        return { portal: safe, ok: false, error: safeError(error), categories: [] };
      }
    }),
  );
  return {
    body: {
      ok: true,
      count: blocks.reduce((sum, block) => sum + block.categories.length, 0),
      portals: blocks,
    },
    status: 200,
  };
}

export async function getXtreamLive(env, searchParams) {
  const selected = selectPortals(env, searchParams);
  if (selected.error) {
    return {
      body: { ok: false, error: selected.error, portals: selected.all.map(publicPortal) },
      status: selected.status || 503,
    };
  }

  const query = String(searchParams.get("q") || "")
    .trim()
    .toLowerCase();
  const category = String(searchParams.get("category") || "").trim();
  const streamId = String(searchParams.get("stream") || "").replace(/[^0-9]/g, "");
  const limit = Math.max(1, Math.min(1000, Number(searchParams.get("limit") || 250)));

  const blocks = await Promise.all(
    selected.portals.map(async (portal) => {
      const safe = publicPortal(portal);
      try {
        const [categoryRows, streamRows, sources] = await Promise.all([
          fetchXtreamJson(portal, "get_live_categories", 14000).catch(() => []),
          fetchXtreamJson(portal, "get_live_streams", 20000).catch(() => []),
          fetchXtreamSourceMaps(portal),
        ]);
        const categoryMap = new Map(
          (Array.isArray(categoryRows) ? categoryRows : []).map((row) => [
            String(row.category_id || ""),
            String(row.category_name || row.name || "Uncategorized"),
          ]),
        );
        for (const entry of [...sources.hlsEntries, ...sources.tsEntries]) {
          if (!categoryMap.has(entry.group)) categoryMap.set(entry.group, entry.group);
        }
        const apiRows = Array.isArray(streamRows) ? streamRows : [];
        let rows = apiRows.length ? apiRows : rowsFromPlaylists(sources);
        if (streamId) rows = rows.filter((row) => String(row.stream_id || "") === streamId);
        if (category) {
          rows = rows.filter((row) => {
            const id = String(row.category_id || "");
            return id === category || (categoryMap.get(id) || "").toLowerCase() === category.toLowerCase();
          });
        }
        if (query) {
          rows = rows.filter((row) =>
            String(row.name || "")
              .toLowerCase()
              .includes(query),
          );
        }
        rows = rows.slice(0, limit);
        const streams = await Promise.all(rows.map((row) => liveRow(row, portal, categoryMap, env, sources)));
        return { portal: safe, ok: true, count: streams.length, streams };
      } catch (error) {
        return { portal: safe, ok: false, error: safeError(error), streams: [] };
      }
    }),
  );

  return {
    body: {
      ok: true,
      count: blocks.reduce((sum, block) => sum + block.streams.length, 0),
      portals: blocks,
    },
    status: 200,
  };
}
