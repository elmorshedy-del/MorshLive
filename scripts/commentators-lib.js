/* ============================================================================
 * commentators-lib.js — Parse + join Arabic match commentators (المعلّق).
 *
 * Full coverage source: almaghrebsport.com/commentators (daily, all leagues).
 * Markup is stable divs: .mt-match > (.mt-team, .mt-time, .mt-team) + .mt-info
 * (.mt-commentator, .mt-channel). Matches with multiple broadcast channels can
 * repeat, so we aggregate every commentator/channel per team-pair.
 *
 * Fixtures come from ESPN/TheSportsDB in English, the source is Arabic, so we
 * join by team name via an alias map (normalized on both sides).
 * ==========================================================================*/

/* Arabic team name → canonical English (matching ESPN/TheSportsDB naming). */
const NATION_ALIASES = [
  [["البرتغال"], "Portugal"],
  [["اوزبكستان", "أوزبكستان", "اوزباكستان"], "Uzbekistan"],
  [["انجلترا", "إنجلترا", "انكلترا", "إنكلترا"], "England"],
  [["غانا"], "Ghana"],
  [["بنما", "بناما"], "Panama"],
  [["كرواتيا"], "Croatia"],
  [["كولومبيا"], "Colombia"],
  [["الكونغو الديمقراطية", "ج.الكونغو", "جمهورية الكونغو الديمقراطية", "الكونغو الديموقراطية", "الكونغو"], "Congo DR"],
  [["سويسرا"], "Switzerland"],
  [["كندا"], "Canada"],
  [["البوسنة والهرسك", "البوسنة", "البوسنة و الهرسك"], "Bosnia-Herzegovina"],
  [["قطر"], "Qatar"],
  [["المغرب"], "Morocco"],
  [["هايتي"], "Haiti"],
  [["اسكتلندا", "إسكتلندا", "سكوتلندا", "اسكوتلندا"], "Scotland"],
  [["البرازيل"], "Brazil"],
  [["تشيكيا", "التشيك", "جمهورية التشيك", "التشيك"], "Czechia"],
  [["المكسيك"], "Mexico"],
  [["جنوب افريقيا", "جنوب أفريقيا", "جنوب إفريقيا"], "South Africa"],
  [["كوريا الجنوبية"], "South Korea"],
  [["كوريا الشمالية"], "North Korea"],
  [["النرويج"], "Norway"],
  [["السنغال"], "Senegal"],
  [["الاردن", "الأردن"], "Jordan"],
  [["الجزائر"], "Algeria"],
  [["الولايات المتحدة", "أمريكا", "امريكا", "الولايات المتحدة الامريكية"], "United States"],
  [["الارجنتين", "الأرجنتين"], "Argentina"],
  [["فرنسا"], "France"],
  [["اسبانيا", "إسبانيا"], "Spain"],
  [["المانيا", "ألمانيا"], "Germany"],
  [["ايطاليا", "إيطاليا"], "Italy"],
  [["هولندا"], "Netherlands"],
  [["بلجيكا"], "Belgium"],
  [["اوروغواي", "أوروغواي", "الاوروغواي", "الأوروغواي"], "Uruguay"],
  [["الدنمارك"], "Denmark"],
  [["السويد"], "Sweden"],
  [["صربيا"], "Serbia"],
  [["بولندا"], "Poland"],
  [["اليابان"], "Japan"],
  [["استراليا", "أستراليا"], "Australia"],
  [["ايران", "إيران"], "Iran"],
  [["السعودية", "العربية السعودية"], "Saudi Arabia"],
  [["تونس"], "Tunisia"],
  [["مصر"], "Egypt"],
  [["نيجيريا"], "Nigeria"],
  [["الكاميرون"], "Cameroon"],
  [["ساحل العاج", "كوت ديفوار"], "Ivory Coast"],
  [["الاكوادور", "الإكوادور"], "Ecuador"],
  [["كوستاريكا"], "Costa Rica"],
  [["باراغواي", "الباراغواي", "باراجواي"], "Paraguay"],
  [["بيرو"], "Peru"],
  [["تشيلي"], "Chile"],
  [["فنزويلا"], "Venezuela"],
  [["ويلز"], "Wales"],
  [["ايرلندا", "أيرلندا", "جمهورية ايرلندا"], "Republic of Ireland"],
  [["النمسا"], "Austria"],
  [["المجر"], "Hungary"],
  [["تركيا", "توركيا"], "Turkey"],
  [["اليونان"], "Greece"],
  [["رومانيا"], "Romania"],
  [["سلوفاكيا"], "Slovakia"],
  [["سلوفينيا"], "Slovenia"],
  [["البانيا", "ألبانيا"], "Albania"],
  [["شمال مقدونيا", "مقدونيا الشمالية"], "North Macedonia"],
  [["نيوزيلندا", "نيوزيلاندا"], "New Zealand"],
  [["الامارات", "الإمارات"], "United Arab Emirates"],
  [["العراق"], "Iraq"],
  [["عمان", "عُمان"], "Oman"],
  [["الكويت"], "Kuwait"],
  [["البحرين"], "Bahrain"],
  [["فلسطين"], "Palestine"],
  [["لبنان"], "Lebanon"],
  [["سوريا"], "Syria"],
  [["ليبيا"], "Libya"],
  [["انغولا", "أنغولا"], "Angola"],
  [["مالي"], "Mali"],
  [["بوركينا فاسو"], "Burkina Faso"],
  [["الراس الاخضر", "الرأس الأخضر"], "Cape Verde"],
  [["جامايكا"], "Jamaica"],
  [["هندوراس"], "Honduras"],
  [["كوراساو", "كوراكاو"], "Curacao"],
];

function normalizeArabic(s) {
  return (s || "")
    .replace(/[\u064B-\u0652\u0670\u0640]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ء/g, "")
    .replace(/[^\u0621-\u064A]/g, "")
    .replace(/^ال/, "");
}

function normalizeEnglish(s) {
  return (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

const AR_TO_EN = (() => {
  const map = new Map();
  for (const [variants, english] of NATION_ALIASES) {
    for (const v of variants) map.set(normalizeArabic(v), english);
  }
  return map;
})();

function arabicTeamToEnglish(ar) {
  return AR_TO_EN.get(normalizeArabic(ar)) || null;
}

function pairKey(enHome, enAway) {
  return [normalizeEnglish(enHome), normalizeEnglish(enAway)].sort().join("~");
}

function prettyChannel(ar) {
  const text = (ar || "").trim();
  const max = text.match(/ماكس\s*(\d+)/);
  if (max) return `beIN MAX ${max[1]}`;
  if (/(بي\s*إن|بين)/.test(text)) {
    const n = text.match(/(\d+)/);
    return `beIN${n ? " " + n[1] : ""}`;
  }
  return text;
}

function pick(re, segment) {
  const m = segment.match(re);
  return m ? m[1].trim() : "";
}
function pickAll(re, segment) {
  const out = [];
  let m;
  const g = new RegExp(re.source, "g");
  while ((m = g.exec(segment))) out.push(m[1].trim());
  return out;
}

function parseCommentators(html) {
  if (!html) return [];
  const rows = [];
  const blocks = String(html).split(/class="mt-match"/).slice(1);
  for (const raw of blocks) {
    const segment = raw.split(/class="mt-footer"/)[0];
    const teams = pickAll(/mt-team">([^<]+)</, segment);
    if (teams.length < 2) continue;
    const time = pick(/mt-time">([^<]+)</, segment);
    const commentators = pickAll(/mt-commentator">([^<]+)</, segment);
    const channels = pickAll(/mt-channel">([^<]+)</, segment);
    const infos = commentators.map((name, i) => ({
      name: name.trim(),
      channel: prettyChannel(channels[i] || ""),
    })).filter((x) => x.name);
    if (!infos.length) continue;
    rows.push({ homeAr: teams[0], awayAr: teams[1], time, infos });
  }
  return rows;
}

function buildIndex(rows) {
  const index = new Map();
  for (const row of rows) {
    const enHome = arabicTeamToEnglish(row.homeAr);
    const enAway = arabicTeamToEnglish(row.awayAr);
    if (!enHome || !enAway) continue;
    const key = pairKey(enHome, enAway);
    const entry = index.get(key) || { commentators: [], seen: new Set() };
    for (const info of row.infos) {
      const dedupe = info.name + "|" + info.channel;
      if (entry.seen.has(dedupe)) continue;
      entry.seen.add(dedupe);
      entry.commentators.push(info);
    }
    index.set(key, entry);
  }
  return index;
}

function channelNumber(label) {
  const m = (label || "").match(/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

/* Map the broadcast channel label to a registry channel id, KEEPING the true
   channel. World Cup matches air on beIN MAX 1–4; we preserve that exact channel
   (e.g. "beIN MAX 2" → "bein-max-2") instead of collapsing odd/even into two
   generic feeds. A non-MAX "beIN 2" still resolves to beIN Sports 2; anything
   without a recognizable number falls back to beIN Sports 1. The id is then
   routed to a playable embed by EMBED_BINDING in assets/js/data.js. */
function channelIdFor(commentators) {
  const c = commentators.find((x) => channelNumber(x.channel) != null);
  if (!c) return "bein-sports-1";
  const n = channelNumber(c.channel);
  if (/max/i.test(c.channel) && n >= 1 && n <= 4) return "bein-max-" + n;
  if (n === 2) return "bein-sports-2";
  return "bein-sports-1";
}

/* The human-readable broadcast channel for display (the source's own label,
   e.g. "beIN MAX 2"), falling back to a name derived from the resolved id. */
function channelNameFor(commentators, channelId) {
  const c = commentators.find((x) => x.channel);
  if (c && c.channel) return c.channel;
  if (/^bein-max-(\d)$/.test(channelId)) return "beIN MAX " + channelId.slice(-1);
  return channelId === "bein-sports-2" ? "beIN Sports 2" : "beIN Sports 1";
}

/* Attach commentator + channel data to fixtures; returns a compact index for
   the JSON cache so the browser can re-attach onto live API results. */
function attachCommentators(matches, html) {
  const index = buildIndex(parseCommentators(html));
  const commentaryIndex = [];
  let matched = 0;
  for (const m of matches) {
    const entry = index.get(pairKey(m.home, m.away));
    if (!entry || !entry.commentators.length) continue;
    matched++;
    const channelId = channelIdFor(entry.commentators);
    const channelName = channelNameFor(entry.commentators, channelId);
    m.commentators = entry.commentators;
    m.commentator = entry.commentators[0].name;
    m.channel = channelName;
    m.channelId = channelId;
    commentaryIndex.push({
      key: pairKey(m.home, m.away),
      home: m.home,
      away: m.away,
      commentators: entry.commentators,
      channel: channelName,
      channelId,
    });
  }
  return { matched, commentaryIndex };
}

function channelFieldsFrom(row) {
  if (!row) return {};
  const out = {};
  if (row.channel) out.channel = row.channel;
  if (row.channelId) out.channelId = row.channelId;
  if (row.commentators && row.commentators.length) out.commentators = row.commentators;
  return out;
}

function hasRealChannel(row) {
  return !!(row && row.channelId && row.channelId !== "bein-sports-1");
}

/** Keep the broadcast channel that was assigned while the match was live. */
function pinEndedChannels(matches, previousPayload) {
  if (!previousPayload) return;
  const prevMatches = previousPayload.matches || [];
  const prevIndex = new Map((previousPayload.commentaryIndex || []).map((c) => [c.key, c]));
  const prevByKey = new Map(prevMatches.map((m) => [pairKey(m.home, m.away), m]));

  for (const m of matches) {
    if (m.status !== "ended") continue;
    const key = pairKey(m.home, m.away);
    const prevM = prevByKey.get(key);
    const prevC = prevIndex.get(key);
    const pin = hasRealChannel(prevM) ? prevM : hasRealChannel(prevC) ? prevC : null;
    if (!pin) continue;
    Object.assign(m, channelFieldsFrom(pin));
    if (pin.commentators && pin.commentators.length) {
      m.commentator = pin.commentators[0].name;
    }
  }
}

/** Merge fresh commentators with cache; never replace channel mapping for ended fixtures. */
function mergeCommentaryIndex(fresh, previous, matches) {
  const endedKeys = new Set(
    matches.filter((m) => m.status === "ended").map((m) => pairKey(m.home, m.away))
  );
  const prevByKey = new Map((previous || []).map((c) => [c.key, c]));
  const out = [];
  const seen = new Set();

  for (const row of fresh || []) {
    if (!row || !row.key) continue;
    if (endedKeys.has(row.key)) {
      const prev = prevByKey.get(row.key);
      if (hasRealChannel(prev)) {
        out.push({ ...row, ...channelFieldsFrom(prev), locked: true });
        seen.add(row.key);
        continue;
      }
    }
    out.push(row.locked ? row : { ...row, locked: false });
    seen.add(row.key);
  }

  for (const row of previous || []) {
    if (!row || !row.key || seen.has(row.key)) continue;
    out.push({ ...row, locked: row.locked || endedKeys.has(row.key) });
    seen.add(row.key);
  }

  for (const m of matches) {
    if (m.status !== "ended" || !hasRealChannel(m)) continue;
    const key = pairKey(m.home, m.away);
    if (seen.has(key)) continue;
    out.push({
      key,
      home: m.home,
      away: m.away,
      commentators: m.commentators || [],
      channel: m.channel,
      channelId: m.channelId,
      locked: true,
    });
    seen.add(key);
  }

  return out;
}

module.exports = {
  normalizeArabic,
  normalizeEnglish,
  arabicTeamToEnglish,
  pairKey,
  prettyChannel,
  parseCommentators,
  buildIndex,
  attachCommentators,
  pinEndedChannels,
  mergeCommentaryIndex,
};
