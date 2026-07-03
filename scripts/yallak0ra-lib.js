/* ============================================================================
 * yallak0ra-lib.js — Scrape يلا كورة fixture cards and attach per-match stream
 * pages to our English-named schedule. Streams are resolved at playback time by
 * the Worker's /yk/embed route (same AlbaPlayer → m3u8 logic as worldkoora).
 * ==========================================================================*/
const { arabicTeamToEnglish, pairKey } = require("./commentators-lib");

const YALLA_HOME = "https://www.yallak0ra.com/";
const YALLA_TODAY = "https://www.yallak0ra.com/matches-today/";
const YALLA_INDEX_URLS = [YALLA_HOME, YALLA_TODAY];

function parseMatchCards(html) {
  const out = [];
  const seen = new Set();
  const blocks = String(html || "").split(/(?=<div class="AY_Match )/);
  for (const block of blocks.slice(1)) {
    const status = (block.match(/AY_Match (\S+)/) || [])[1] || "";
    const names = [...block.matchAll(/class="TM_Name">\s*([^<]+)/g)].map((m) => m[1].trim());
    if (names.length < 2) continue;
    const link =
      (block.match(/<a href="([^"]+)"[^>]*title="تفاصيل/) || [])[1] ||
      (block.match(/<a href="([^"]+)"[^>]*><div class='MT_Mask'/) || [])[1] ||
      "";
    if (!link) continue;
    const homeAr = names[0];
    const awayAr = names[1];
    const home = arabicTeamToEnglish(homeAr);
    const away = arabicTeamToEnglish(awayAr);
    if (!home || !away) continue;
    const key = pairKey(home, away);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      key,
      home,
      away,
      homeAr,
      awayAr,
      status: status.replace(/">$/, "").trim(),
      page: link,
    });
  }
  return out;
}

// Merge cards from homepage + matches-today; prefer the row marked live.
function mergeYallaCards(htmlPages) {
  const byKey = new Map();
  for (const html of htmlPages) {
    for (const card of parseMatchCards(html)) {
      const prev = byKey.get(card.key);
      if (!prev || card.status === "live") byKey.set(card.key, card);
    }
  }
  return Array.from(byKey.values());
}

function findLiveYallaCard(cards) {
  return cards.find((c) => c.status === "live") || null;
}

function attachYallaPages(matches, cards) {
  if (!cards.length) return 0;
  const byKey = new Map(cards.map((c) => [c.key, c]));
  let attached = 0;
  for (const m of matches) {
    const card = byKey.get(pairKey(m.home, m.away));
    if (!card || !card.page) continue;
    m.yallaPage = card.page;
    attached++;
  }
  return attached;
}

module.exports = {
  YALLA_HOME,
  YALLA_TODAY,
  YALLA_INDEX_URLS,
  parseMatchCards,
  mergeYallaCards,
  findLiveYallaCard,
  attachYallaPages,
};
