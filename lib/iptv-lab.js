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

/** Arabic beIN Sports SD bouquet: `AR ❖ BEIN SPORTS SD`. Not TOD (HEVC) or English. */
export function isArBeinSportsSdCategory(name) {
  const text = String(name || "");
  if (!/^\s*ar\b/i.test(text)) return false;
  if (!/bein/i.test(text)) return false;
  if (!/\bsd\b/i.test(text)) return false;
  if (/\btod\b/i.test(text) || /english/i.test(text)) return false;
  return true;
}

/** Channel 1 in that bouquet: `BEIN SPORTS 1 SD`, not ENGLISH / SD² / SD³. */
export function isArBeinSports1SdChannel(channel) {
  const name = String(channel?.name || "").trim();
  if (/english/i.test(name)) return false;
  if (!/bein\s+sports?\s+(?:1\s+sd|sd\s*1)$/i.test(name)) return false;
  return isArBeinSportsSdCategory(channel?.categoryName);
}

export function pickArBeinSports1Sd(channels) {
  const matches = (Array.isArray(channels) ? channels : []).filter(isArBeinSports1SdChannel);
  return matches.find((channel) => String(channel.streamId) === "991") || matches[0] || null;
}

export function preferredIptvLabCategoryId(categories) {
  const rows = Array.isArray(categories) ? categories : [];
  const arBeinSd = rows.find((category) => isArBeinSportsSdCategory(category?.name));
  if (arBeinSd?.categoryId) return String(arBeinSd.categoryId);
  const scored = rows
    .map((category) => ({
      category,
      score:
        /ca/i.test(category?.name || "") && /sport/i.test(category?.name || "")
          ? 4
          : /bein/i.test(category?.name || "")
            ? 3
            : /sport|dazn|espn|sky|ssn|tnt|premiere|liga|football/i.test(category?.name || "")
              ? 2
              : 0,
    }))
    .filter((row) => row.score > 0)
    .sort(
      (a, b) => b.score - a.score || String(a.category.name).localeCompare(String(b.category.name), "ar"),
    );
  return scored[0]?.category.categoryId ? String(scored[0].category.categoryId) : "";
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
