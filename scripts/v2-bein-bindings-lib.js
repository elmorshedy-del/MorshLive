const { TeamNames } = require("../assets/js/team-names.js");
const { normalizeArabic, levenshtein } = require("./arabic-team-resolver.js");

const GENERATED_BY = "v2-bein-qualifiers";
const QUALIFIER_COMPETITIONS = new Set(["unl", "afconq"]);

function stripHtml(value) {
  return String(value || "")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/\s+/g, " ")
    .trim();
}

function parseBeinChannel(label) {
  const raw = stripHtml(label);
  if (!/\bbein\b/i.test(raw) || /\bfr\b/i.test(raw)) return null;
  let m = raw.match(/\bbein\s+sports\s+xtra\s*([1-9])/i);
  if (m) return { key: `bein-xtra-${Number(m[1])}`, label: raw };
  m = raw.match(/\bbein\s+sports\s+en\s*([1-9])/i);
  if (m) return { key: `bein-en-${Number(m[1])}`, label: raw };
  m = raw.match(/\bbein\s+sports\s*([1-9])/i);
  if (m) return { key: `bein-sports-${Number(m[1])}`, label: raw };
  return null;
}

function competitionHint(href) {
  const text = decodeURIComponent(String(href || ""));
  if (/دوري-الأمم-الأوروبية/.test(text)) return "unl";
  if (/تصفيات-كأس-الأمم-الإفريقية/.test(text)) return "afconq";
  return "";
}

function parseFilGoalKickoff(value) {
  const m = String(value || "").match(/(\d{2})-(\d{2})-(\d{4})\s*-\s*(\d{2}):(\d{2})/);
  if (!m) return null;
  const [, day, month, year, hour, minute] = m;
  return new Date(Date.UTC(+year, +month - 1, +day, +hour - 3, +minute)).toISOString();
}

function parseFilGoalBroadcasts(html) {
  const rows = [];
  for (const block of String(html || "").split('<div class="cin_cntnr">').slice(1)) {
    const href = block.match(/href="(\/matches\/\d+\/[^"]+)"/)?.[1] || "";
    const competition = competitionHint(href);
    if (!competition) continue;
    const teams = [...block.matchAll(/<strong>([\s\S]*?)<\/strong>/g)]
      .map((m) => stripHtml(m[1])).filter(Boolean).slice(0, 2);
    if (teams.length !== 2) continue;
    const aux = block.match(/<div class="match-aux">([\s\S]*?)<\/div>/)?.[1] || "";
    const spans = [...aux.matchAll(/<span[^>]*>([\s\S]*?)<\/span>/g)]
      .map((m) => stripHtml(m[1])).filter(Boolean);
    const channel = spans.map(parseBeinChannel).find(Boolean);
    const kickoffUtc = spans.map(parseFilGoalKickoff).find(Boolean);
    if (!channel || !kickoffUtc) continue;
    rows.push({
      competition,
      homeAr: teams[0],
      awayAr: teams[1],
      channelKey: channel.key,
      channelLabel: channel.label,
      kickoffUtc,
      sourceHref: href,
    });
  }
  return rows;
}

function distance(left, right) {
  const a = normalizeArabic(left);
  const b = normalizeArabic(right);
  if (!a || !b) return 1;
  return levenshtein(a, b) / Math.max(a.length, b.length, 1);
}

function pairScore(row, fixture) {
  const home = TeamNames.arabicFor(fixture.home) || fixture.home;
  const away = TeamNames.arabicFor(fixture.away) || fixture.away;
  const direct = distance(row.homeAr, home) + distance(row.awayAr, away);
  const swapped = distance(row.homeAr, away) + distance(row.awayAr, home);
  return Math.min(direct, swapped);
}

function matchRowToFixture(row, fixtures) {
  const target = Date.parse(row.kickoffUtc);
  const ranked = (fixtures || [])
    .filter((m) => m.competition === row.competition)
    .filter((m) => Math.abs(Date.parse(m.kickoffUtc) - target) <= 20 * 60000)
    .map((m) => ({ m, score: pairScore(row, m) }))
    .sort((a, b) => a.score - b.score);
  if (!ranked.length || ranked[0].score > 0.65) return null;
  if (ranked[1] && ranked[1].score - ranked[0].score < 0.1) return null;
  return ranked[0].m;
}

function buildBindings(fixtures, rows, vegaCatalog, now = Date.now()) {
  const channels = vegaCatalog?.channels || {};
  const out = [];
  const seen = new Set();
  for (const row of rows || []) {
    const fixture = matchRowToFixture(row, fixtures);
    const channel = channels[row.channelKey];
    if (!fixture?.id || !channel?.streamId || seen.has(fixture.id)) continue;
    const expiresAt = Date.parse(fixture.kickoffUtc) + 165 * 60000;
    if (expiresAt <= now) continue;
    seen.add(fixture.id);
    out.push({
      matchId: fixture.id,
      home: fixture.home,
      away: fixture.away,
      kickoffUtc: fixture.kickoffUtc,
      competition: fixture.competition,
      broadcastChannelId: row.channelKey,
      channel: channel.name,
      playbackChannelId: channel.playbackChannelId,
      streamId: String(channel.streamId),
      observedLabel: row.channelLabel,
      sourceHref: row.sourceHref,
      expiresAt: new Date(expiresAt).toISOString(),
    });
  }
  return out.sort((a, b) => Date.parse(a.kickoffUtc) - Date.parse(b.kickoffUtc));
}

function generatedPlan(binding, baseUrl, nowIso) {
  const contentKey = `match:${binding.matchId}`;
  return {
    matchId: binding.matchId,
    teams: [[binding.home], [binding.away]],
    contentKey,
    kickoffUtc: binding.kickoffUtc,
    status: "operator",
    verifiedAt: nowIso,
    expiresAt: binding.expiresAt,
    generatedBy: GENERATED_BY,
    policy: {
      sameContentOnly: true,
      allowAutoHeal: false,
      allowUnverifiedFallback: false,
      allowLegacy: false,
    },
    sources: [{
      id: `v2-bein-${binding.streamId}`,
      role: "primary",
      kind: "hls",
      profile: "hls-direct-v1",
      url: `${String(baseUrl).replace(/\/$/, "")}/iptv-${binding.streamId}/index.m3u8`,
      contentKey,
      status: "operator",
      verifiedAt: nowIso,
      expiresAt: binding.expiresAt,
      label: `${binding.channel} · V2 Vega`,
      note: `Published broadcaster binding: ${binding.observedLabel}`,
    }],
  };
}

function mergeGeneratedPlans(catalog, bindings, vegaCatalog, now = Date.now()) {
  const nowIso = new Date(now).toISOString();
  const existing = Array.isArray(catalog?.plans) ? catalog.plans : [];
  const retained = existing.filter((p) => p?.generatedBy !== GENERATED_BY);
  const occupied = new Set(retained.map((p) => String(p?.matchId || "")));
  const generated = bindings
    .filter((b) => !occupied.has(String(b.matchId)))
    .map((b) => generatedPlan(b, vegaCatalog.baseUrl, nowIso));
  return {
    ...(catalog || {}),
    version: Number(catalog?.version) || 1,
    updatedAt: nowIso,
    plans: retained.concat(generated),
  };
}

module.exports = {
  GENERATED_BY,
  QUALIFIER_COMPETITIONS,
  buildBindings,
  mergeGeneratedPlans,
  parseBeinChannel,
  parseFilGoalBroadcasts,
  parseFilGoalKickoff,
  matchRowToFixture,
};
