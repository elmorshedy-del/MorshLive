/* ============================================================================
 * saudi-tv-guide-lib.js — Exact Saudi Pro League TV-channel assignments.
 *
 * LiveFootballTV publishes fixture-level Thmanyah 1/2/3 assignments in simple
 * schema.org event markup. This adapter extracts only exact numbered Thmanyah
 * channels. Generic "Thmanyah Channels" rows are intentionally ignored so the
 * official rights-holder fallback can remain lower-confidence until a numbered
 * channel is actually published.
 * ==========================================================================*/

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

const TEAM_TOKEN_ALIASES = new Map([
  ["qadisiya", "qadsiah"],
  ["qadisiyah", "qadsiah"],
  ["qadsia", "qadsiah"],
  ["khaleej", "khaleej"],
  ["khalij", "khaleej"],
  ["kholoud", "kholood"],
  ["fayhaa", "fayha"],
  ["faiha", "fayha"],
  ["feha", "fayha"],
  ["taawon", "taawoun"],
  ["taawun", "taawoun"],
  ["diriyah", "diriyah"],
  ["draih", "diriyah"],
]);

function normalizeSaudiTeam(value) {
  const tokens = decodeHtml(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !["fc", "sc", "club", "jeddah"].includes(token));

  if (tokens[0] === "al") tokens.shift();
  return tokens
    .map((token) => TEAM_TOKEN_ALIASES.get(token) || token)
    .join("");
}

function guidePairKey(home, away) {
  return [normalizeSaudiTeam(home), normalizeSaudiTeam(away)].sort().join("~");
}

function exactThmanyahChannel(block) {
  const titles = [...String(block || "").matchAll(/<li[^>]*\btitle="([^"]+)"[^>]*>/gi)]
    .map((match) => decodeHtml(match[1]).trim());
  for (const title of titles) {
    const match = title.match(/^Thmanyah\s*([123])\s*HD$/i);
    if (match) return Number.parseInt(match[1], 10);
  }
  return null;
}

function splitFixtureName(value) {
  const parts = decodeHtml(value).split(/\s+-\s+/);
  if (parts.length < 2) return null;
  return {
    home: parts.shift().trim(),
    away: parts.join(" - ").trim(),
  };
}

function parseSaudiTvGuide(html) {
  const rows = [];
  const segments = String(html || "").split(/<td[^>]*class="canales"[^>]*>/i).slice(1);
  for (const segment of segments) {
    const block = segment.split(/<\/td>/i)[0] || "";
    const name = block.match(/<meta[^>]*itemprop="name"[^>]*content="([^"]+)"[^>]*>/i)?.[1];
    if (!name) continue;
    const fixture = splitFixtureName(name);
    if (!fixture) continue;
    const channelNumber = exactThmanyahChannel(block);
    if (!channelNumber) continue;
    const startDate = block.match(/<meta[^>]*itemprop="startDate"[^>]*content="([^"]+)"[^>]*>/i)?.[1] || null;
    rows.push({
      key: guidePairKey(fixture.home, fixture.away),
      home: fixture.home,
      away: fixture.away,
      startDate,
      channel: `ثمانية ${channelNumber}`,
      broadcast: {
        provider: "thmanyah",
        channelId: `thmanyah-${channelNumber}`,
        source: "livefootballtv",
        confidence: "exact",
      },
    });
  }
  return rows;
}

function applySaudiTvGuide(matches, commentaryIndex, guideRows) {
  const guideByKey = new Map((guideRows || []).map((row) => [row.key, row]));
  const commentaryByKey = new Map((commentaryIndex || []).map((row) => [guidePairKey(row.home, row.away), row]));
  let matched = 0;

  for (const match of matches || []) {
    const guide = guideByKey.get(guidePairKey(match.home, match.away));
    if (!guide) continue;
    matched++;
    match.channel = guide.channel;
    match.broadcast = { ...guide.broadcast };
    delete match.channelId;

    const existing = commentaryByKey.get(guidePairKey(match.home, match.away));
    if (existing) {
      existing.channel = guide.channel;
      existing.broadcast = { ...guide.broadcast };
      delete existing.channelId;
      continue;
    }

    const row = {
      key: [
        String(match.home || "").toLowerCase().replace(/[^a-z0-9]/g, ""),
        String(match.away || "").toLowerCase().replace(/[^a-z0-9]/g, ""),
      ].sort().join("~"),
      home: match.home,
      away: match.away,
      commentators: match.commentators || [],
      channel: guide.channel,
      broadcast: { ...guide.broadcast },
    };
    commentaryIndex.push(row);
    commentaryByKey.set(guidePairKey(match.home, match.away), row);
  }

  return matched;
}

module.exports = {
  decodeHtml,
  normalizeSaudiTeam,
  guidePairKey,
  exactThmanyahChannel,
  parseSaudiTvGuide,
  applySaudiTvGuide,
};
