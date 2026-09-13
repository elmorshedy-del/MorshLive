/**
 * Resolve a site channel id (bein-sports-1, bein-max-3, …) to a stream in the
 * live Xtream catalogue.
 *
 * Why this is not a lookup table. The previous mapping pinned stream ids
 * directly — PREMIUM_CHANNELS held 991 and 992 for beIN Sports 1 and 2. Those
 * ids are not in the current catalogue at all, because the portal's catalogue
 * was rebuilt underneath them. A pinned id does not fail loudly when that
 * happens: it either 404s or, worse, now belongs to some other channel, which
 * is how a Madrid page ends up playing PSG.
 *
 * So resolution goes the other way round: describe what the channel *is*
 * (network, tier, number, language) and find it in whatever catalogue is in
 * front of us. Providers rename channels constantly — beIN_1HD_1080p,
 * beIN_1_HD720, beIN_SPORTS1_4K and beIN_Sport_1_H265 are all "beIN Sports 1"
 * — and a describe-and-search resolver survives that, where an id table cannot.
 *
 * The catalogue is also full of near misses that must never be selected for an
 * Arabic beIN Sports channel: English, French and Turkish feeds, the Xtra and
 * AFC tiers, and the movies/series channels. Those are rejected explicitly
 * rather than out-ranked, because "wrong channel, ranked low" is still a wrong
 * channel if nothing else resolves.
 */

/** Tiers that are real, separate channels rather than variants of one. */
const TIERS = Object.freeze(["sports", "max", "xtra", "afc"]);

const ENTERTAINMENT = /\b(movies?|series|box|office|premiere|comedy|vice|drama|gourmet|kids)\b/;

/**
 * Split digits from letters so "1HD", "SPORTS1" and "1English" tokenize the
 * same way as their spaced equivalents. This is what makes the resolver
 * indifferent to a provider's separator style.
 */
export function normalizeChannelName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[_.\-[\]()/]+/g, " ")
    .replace(/(\d)([a-z])/g, "$1 $2")
    .replace(/([a-z])(\d)/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * A single digit is part of a quality figure only when a magnitude unit follows
 * it — the 4 in "4K", the 8 in "8M". Nothing else disqualifies a digit: in
 * "beIN_Sport_1_H265" and "beIN_Max_4_Ultra_4K" the digit is the channel and
 * the codec or tier word after it is unrelated.
 */
function isMagnitudeUnit(token) {
  return token === "k" || token === "m";
}

/**
 * Read a catalogue channel name into what it actually identifies.
 *
 * The channel number is the first 1-9 that follows a network/tier marker and is
 * not part of a quality figure — that rule is what keeps "beIN_1_512K" as
 * channel 1 rather than channel 512, and "beIN_SPORTS1_4K" as channel 1 rather
 * than channel 4.
 */
export function parseXtreamChannelName(value) {
  const text = normalizeChannelName(value);
  const tokens = text.split(" ").filter(Boolean);

  const network = /\bbe ?in\b/.test(text) || tokens.includes("bein") ? "bein" : null;

  let tier = null;
  if (tokens.includes("max")) tier = "max";
  else if (tokens.includes("xtra")) tier = "xtra";
  else if (tokens.includes("afc")) tier = "afc";
  else if (ENTERTAINMENT.test(text)) tier = "entertainment";
  else if (network) tier = "sports";

  let language = "ar";
  if (/\benglish\b|\beng\b/.test(text)) language = "en";
  else if (/\bfrench\b|\bfra\b/.test(text)) language = "fr";
  else if (/\bturkish\b/.test(text) || tokens.includes("tr")) language = "tr";

  let number = null;
  let armed = false;
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (/^(bein|sport|sports|max|xtra)$/.test(token)) {
      armed = true;
      continue;
    }
    if (!armed || !/^\d+$/.test(token)) continue;
    // "4 k" and "8 m" are bitrate/resolution figures, not channel numbers.
    if (isMagnitudeUnit(tokens[i + 1] || "")) continue;
    const parsed = Number.parseInt(token, 10);
    if (parsed >= 1 && parsed <= 9) {
      number = parsed;
      break;
    }
  }

  const codec = /\bh 26 5\b|\bh 265\b|\bhevc\b/.test(text) ? "h265" : "h264";

  let quality = "sd";
  if (/\b4 k\b|\b4k\b/.test(text)) quality = "4k";
  else if (/\b1080\b/.test(text)) quality = "1080";
  else if (/\b720\b/.test(text) || /\bhd\b/.test(text)) quality = "hd";
  else if (/\blow\b|\b512\b|\b256\b/.test(text)) quality = "low";
  else if (/\bvega\b/.test(text)) quality = "vega";

  return { network, tier, number, language, codec, quality };
}

/** Turn "bein-max-3" into the thing we are looking for. */
export function parseSiteChannelId(channelId) {
  const match = /^bein-(sports|max|xtra)-([1-9])$/.exec(String(channelId || "").toLowerCase());
  if (!match) return null;
  return { network: "bein", tier: match[1], number: Number.parseInt(match[2], 10) };
}

/**
 * Playback preference. H.264 before HEVC because HEVC does not decode in
 * Chrome's MediaSource on most desktops; 1080p before 720p before the low-rate
 * feeds; 4K last because it is the heaviest and is usually HEVC anyway.
 */
const QUALITY_RANK = Object.freeze({ 1080: 5, hd: 4, sd: 3, vega: 2, low: 1, "4k": 0 });

function score(parsed) {
  const codecRank = parsed.codec === "h264" ? 100 : 0;
  return codecRank + (QUALITY_RANK[parsed.quality] ?? 0);
}

/**
 * Every catalogue entry that genuinely is this channel, best first.
 * Returns [] rather than a near miss when the channel is absent — a caller that
 * gets nothing can say so, where a caller handed the wrong channel cannot.
 */
export function rankXtreamCandidates(channelId, streams) {
  const want = parseSiteChannelId(channelId);
  if (!want) return [];
  const rows = Array.isArray(streams) ? streams : [];

  return rows
    .map((row) => ({ row, parsed: parseXtreamChannelName(row?.name) }))
    .filter(({ parsed }) => {
      if (parsed.network !== want.network) return false;
      if (parsed.tier !== want.tier) return false;
      if (parsed.number !== want.number) return false;
      // Only the Arabic feed. An English or Turkish beIN 1 is a different
      // commentary team on a different schedule, not a lower-quality variant.
      return parsed.language === "ar";
    })
    .sort((a, b) => score(b.parsed) - score(a.parsed))
    .map(({ row, parsed }) => ({
      streamId: String(row.streamId),
      name: row.name,
      categoryName: row.categoryName ?? null,
      quality: parsed.quality,
      codec: parsed.codec,
    }));
}

/** The one to play, plus what to fall back to. Null when the channel is absent. */
export function resolveXtreamChannel(channelId, streams) {
  const ranked = rankXtreamCandidates(channelId, streams);
  if (!ranked.length) return null;
  const [best, ...alternates] = ranked;
  return { ...best, alternates };
}
