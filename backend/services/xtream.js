import { createMediaToken, fetchXtreamJson, loadXtreamPortals, streamUrl } from "../adapters/xtream.js";

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

async function liveRow(row, portal, categoryMap, env) {
  const categoryId = String(row.category_id || "");
  const [hlsToken, tsToken] = await Promise.all([
    createMediaToken(env, streamUrl(portal, row.stream_id, "m3u8")),
    createMediaToken(env, streamUrl(portal, row.stream_id, "ts")),
  ]);
  return {
    portalId: portal.id,
    portalLabel: portal.label,
    streamId: row.stream_id,
    name: row.name || "Untitled channel",
    categoryId,
    categoryName: categoryMap.get(categoryId) || null,
    icon: row.stream_icon || null,
    epgChannelId: row.epg_channel_id || null,
    added: row.added || null,
    num: row.num || null,
    tvArchive: row.tv_archive || 0,
    playbackUrl: `/api/xtream/media/${hlsToken}`,
    tsPlaybackUrl: `/api/xtream/media/${tsToken}`,
  };
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

  const results = await Promise.all(
    selected.portals.map(async (portal) => {
      const safe = publicPortal(portal);
      try {
        const info = await fetchXtreamJson(portal, null, 10000);
        return { ...safe, ok: true, account: accountInfo(info) };
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
        const rows = await fetchXtreamJson(portal, "get_live_categories", 14000);
        const categories = Array.isArray(rows) ? rows.map((row) => categoryRow(row, portal)) : [];
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
        const [categoryRows, streamRows] = await Promise.all([
          fetchXtreamJson(portal, "get_live_categories", 14000).catch(() => []),
          fetchXtreamJson(portal, "get_live_streams", 20000),
        ]);
        const categoryMap = new Map(
          (Array.isArray(categoryRows) ? categoryRows : []).map((row) => [
            String(row.category_id || ""),
            String(row.category_name || row.name || "Uncategorized"),
          ]),
        );
        let rows = Array.isArray(streamRows) ? streamRows : [];
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
        const streams = await Promise.all(rows.map((row) => liveRow(row, portal, categoryMap, env)));
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
