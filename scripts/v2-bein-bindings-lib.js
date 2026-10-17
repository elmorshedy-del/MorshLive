const { TeamNames } = require("../assets/js/team-names.js");
const { normalizeArabic, levenshtein } = require("./arabic-team-resolver.js");

const GENERATED_BY = "v2-bein-qualifiers";
const QUALIFIER_COMPETITIONS = new Set(["unl", "afconq"]);
const BEIN_COMPETITIONS = new Set(["epl", "laliga", "ucl", "ligue1", ...QUALIFIER_COMPETITIONS]);

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
  if (!/\bbein\b/i.test(raw) || /\bfr\b/i.test(raw) || /\ben\b/i.test(raw)) return null;
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
  if (/الدوري-الإنجليزي-الممتاز/.test(text)) return "epl";
  if (/الدوري-الإسباني/.test(text)) return "laliga";
  if (/دوري-أبطال-أوروبا/.test(text)) return "ucl";
  if (/الدوري-الفرنسي/.test(text)) return "ligue1";
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
  const score = (a, b) => a <= 0.35 && b <= 0.35 ? a + b : Infinity;
  const direct = score(distance(row.homeAr, home), distance(row.awayAr, away));
  const swapped = score(distance(row.homeAr, away), distance(row.awayAr, home));
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

function buildBindings(fixtures, rows, vegaCatalog, now = Date.now(), excludedMatchIds = new Set()) {
  const channels = vegaCatalog?.channels || {};
  const out = [];
  const seen = new Set();
  const conflicts = new Set();
  for (const row of rows || []) {
    const fixture = matchRowToFixture(row, fixtures);
    const channel = channels[row.channelKey];
    if (!fixture?.id || !channel?.streamId) continue;
    if (seen.has(fixture.id)) {
      if (out.find((binding) => binding.matchId === fixture.id)?.streamId !== String(channel.streamId)) {
        conflicts.add(fixture.id);
      }
      continue;
    }
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
  for (const id of conflicts) excludedMatchIds.add(String(id));
  return normalizeChannelWindows(out, excludedMatchIds);
}

function normalizeChannelWindows(bindings, excludedMatchIds) {
  const out = bindings.filter((binding) => !excludedMatchIds.has(String(binding.matchId)))
    .map((binding) => ({ ...binding }));
  const conflicts = new Set();
  for (const first of out) {
    const later = out.filter((binding) => binding.matchId !== first.matchId &&
      binding.streamId === first.streamId && Date.parse(binding.kickoffUtc) >= Date.parse(first.kickoffUtc))
      .sort((a, b) => Date.parse(a.kickoffUtc) - Date.parse(b.kickoffUtc))[0];
    if (!later) continue;
    const gap = Date.parse(later.kickoffUtc) - Date.parse(first.kickoffUtc);
    if (gap < 120 * 60000) {
      conflicts.add(first.matchId);
      conflicts.add(later.matchId);
    } else {
      first.expiresAt = new Date(Math.min(Date.parse(first.expiresAt),
        Date.parse(later.kickoffUtc) - 30 * 60000)).toISOString();
    }
  }
  for (const id of conflicts) excludedMatchIds.add(String(id));
  return out.filter((binding) => !excludedMatchIds.has(String(binding.matchId)))
    .sort((a, b) => Date.parse(a.kickoffUtc) - Date.parse(b.kickoffUtc));
}

// Join by ESPN identity, never by a recurring team pair. Preserve every archive
// field and all operator overrides; this only supplies broadcaster metadata.
function mergeFixtureChannels(payload, bindings, fixtures, overrides = {}, now = Date.now(), excludedMatchIds = new Set()) {
  const byId = new Map((payload?.matches || []).map((match) => [String(match.id), match]));
  const fixtureById = new Map((fixtures || []).map((match) => [String(match.id), match]));
  let changed = false;
  for (const [id, match] of byId) {
    if (overrides[id]) {
      const next = { ...match, ...overrides[id], channelSource: "manual" };
      delete next.channelExpiresAt;
      if (JSON.stringify(next) === JSON.stringify(match)) continue;
      byId.set(id, next);
      changed = true;
      continue;
    }
    if (match.channelSource !== GENERATED_BY) continue;
    if (!excludedMatchIds.has(id) && !(Date.parse(match.channelExpiresAt) <= now)) continue;
    const next = { ...match };
    for (const field of ["channelId", "channel", "channelSource", "channelExpiresAt"]) delete next[field];
    byId.set(id, next);
    changed = true;
  }
  for (const binding of bindings || []) {
    const id = String(binding.matchId);
    const fixture = fixtureById.get(id);
    if (!fixture || overrides[id] || Date.parse(binding.expiresAt) <= now) continue;
    const previous = byId.get(id) || fixture;
    const next = { ...previous, kickoffUtc: fixture.kickoffUtc, channelId: binding.broadcastChannelId,
      channel: binding.channel, channelSource: GENERATED_BY, channelExpiresAt: binding.expiresAt };
    if (JSON.stringify(previous) === JSON.stringify(next) && byId.has(id)) continue;
    byId.set(id, next);
    changed = true;
  }
  return changed ? { ...payload, matches: [...byId.values()] } : payload;
}

function mergeActiveBindings(previous, fresh, fixtures, now = Date.now(), excludedMatchIds = new Set()) {
  const liveFixtureIds = new Set((fixtures || []).map((match) => String(match?.id || "")));
  const fixtureFeedAvailable = liveFixtureIds.size > 0;
  const byMatch = new Map(
    (previous || [])
      .filter((binding) => Date.parse(binding?.expiresAt || "") > now)
      .filter((binding) => !excludedMatchIds.has(String(binding?.matchId)))
      .filter((binding) =>
        fixtureFeedAvailable ? liveFixtureIds.has(String(binding?.matchId || "")) : true
      )
      .map((binding) => [String(binding.matchId), binding]),
  );
  for (const binding of fresh || []) {
    if (!excludedMatchIds.has(String(binding.matchId))) byMatch.set(String(binding.matchId), binding);
  }
  return normalizeChannelWindows([...byMatch.values()], excludedMatchIds);
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

function mergeGeneratedPlans(catalog, bindings, vegaCatalog, now = Date.now(), fixtures = []) {
  const nowIso = new Date(now).toISOString();
  const existing = Array.isArray(catalog?.plans) ? catalog.plans : [];
  const retained = existing.filter((p) => p?.generatedBy !== GENERATED_BY);
  const occupied = new Set(retained.map((p) => String(p?.matchId || "")));
  const generated = bindings
    .filter((b) => !occupied.has(String(b.matchId)))
    .map((b) => {
      const old = existing.find((plan) => plan.generatedBy === GENERATED_BY && plan.matchId === b.matchId);
      const next = generatedPlan(b, vegaCatalog.baseUrl, old?.verifiedAt || nowIso);
      return old && JSON.stringify(old) === JSON.stringify(next)
        ? old : generatedPlan(b, vegaCatalog.baseUrl, nowIso);
    });
  const assigned = new Set([...occupied, ...generated.map((plan) => String(plan.matchId))]);
  for (const fixture of fixtures) {
    if (assigned.has(String(fixture.id))) continue;
    const expires = Date.parse(fixture.kickoffUtc) + 165 * 60000;
    if (!Number.isFinite(expires) || expires <= now) continue;
    generated.push({
      matchId: fixture.id,
      teams: [[fixture.home], [fixture.away]],
      contentKey: `match:${fixture.id}`,
      kickoffUtc: fixture.kickoffUtc,
      expiresAt: new Date(expires).toISOString(),
      generatedBy: GENERATED_BY,
      status: "pending",
      policy: { sameContentOnly: true, allowAutoHeal: false, allowUnverifiedFallback: false, allowLegacy: false },
      sources: [],
    });
  }
  const plans = retained.concat(generated);
  if (JSON.stringify(existing) === JSON.stringify(plans)) return catalog;
  return {
    ...(catalog || {}),
    version: Number(catalog?.version) || 1,
    updatedAt: nowIso,
    plans,
  };
}

module.exports = {
  GENERATED_BY,
  QUALIFIER_COMPETITIONS,
  BEIN_COMPETITIONS,
  buildBindings,
  mergeGeneratedPlans,
  mergeFixtureChannels,
  parseBeinChannel,
  parseFilGoalBroadcasts,
  parseFilGoalKickoff,
  matchRowToFixture,
  mergeActiveBindings,
};
