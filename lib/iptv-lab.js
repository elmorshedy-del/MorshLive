/** Isolated IPTV lab portal from Wrangler secret IPTV_LAB_JSON. Never mix with XTREAM_PORTALS_JSON. */

function labPortalUrl(raw) {
  try {
    const url = new URL(String(raw || "").trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.pathname = url.pathname.replace(/\/+$/, "");
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

export function parseIptvLabSecret(raw) {
  if (raw == null || String(raw).trim() === "") {
    return { ok: false, error: "IPTV_LAB_JSON secret is not configured" };
  }

  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    const value = parsed?.portal ? parsed.portal : parsed;
    const url = labPortalUrl(value.url || value.portalUrl || value.host);
    const username = value.username || value.user;
    const password = value.password || value.pass;
    if (!url || !username || !password) {
      return { ok: false, error: "IPTV_LAB_JSON needs url, username, and password" };
    }
    return {
      ok: true,
      portal: {
        url,
        username: String(username),
        password: String(password),
        label: String(value.label || value.name || "lab"),
      },
    };
  } catch (error) {
    return { ok: false, error: `Invalid IPTV_LAB_JSON: ${error.message || error}` };
  }
}

/** Overlay the lab portal into a clone of env so getXtream* never reads XTREAM_PORTALS_JSON. */
export function iptvLabWorkerEnv(env) {
  const parsed = parseIptvLabSecret(env?.IPTV_LAB_JSON);
  if (!parsed.ok) return parsed;
  return {
    ok: true,
    env: {
      ...env,
      XTREAM_PORTALS_JSON: JSON.stringify({ portals: [parsed.portal] }),
    },
  };
}
