/* Deterministic broadcaster -> IPTV catalog resolver.
 * Provider display names, categories and stream ids are treated as runtime data.
 * No stream id or old bouquet name is hardcoded here.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.KZIptvChannelResolver = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const ARABIC_DIGITS = { "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9" };
  const NOISE = new Set([
    "ar", "arab", "arabic", "mena", "vip", "live", "tv", "channel", "ch",
    "uhd", "fhd", "fullhd", "hd", "sd", "4k", "hevc", "h265", "h264",
    "backup", "bk", "server", "srv", "feed", "official", "premium",
  ]);

  function normalizeDigits(value) {
    return String(value || "").replace(/[٠-٩]/g, (digit) => ARABIC_DIGITS[digit] || digit);
  }

  function normalizeText(value) {
    return normalizeDigits(value)
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/بي\s*(?:إن|ان)|بين(?=\s*(?:سبورت|sport))/g, " bein ")
      .replace(/سبورت(?:س)?/g, " sports ")
      .replace(/اكسترا|إكسترا/g, " xtra ")
      .replace(/ماكس/g, " max ")
      .replace(/\bbe\s*in\b/g, " bein ")
      .replace(/\bsport\b/g, " sports ")
      .replace(/h\.?\s*265/g, " hevc ")
      .replace(/h\.?\s*264/g, " h264 ")
      .replace(/[^a-z0-9\u0600-\u06ff]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function tokens(value) {
    return normalizeText(value)
      .split(" ")
      .filter(Boolean)
      .filter((token) => !NOISE.has(token));
  }

  function networkFor(text) {
    const n = normalizeText(text);
    if (/\bbein\b/.test(n)) return "bein";
    if (/\bssc\b/.test(n)) return "ssc";
    if (/\bdazn\b/.test(n)) return "dazn";
    if (/\bespn\b/.test(n)) return "espn";
    if (/\btnt\b/.test(n)) return "tnt";
    if (/\bsky\b/.test(n)) return "sky";
    if (/\balkass\b|الكاس|الكأس/.test(n)) return "alkass";
    if (/\bmbc\b/.test(n)) return "mbc";
    if (/\bfox\b/.test(n)) return "fox";
    if (/\bcbs\b/.test(n)) return "cbs";
    if (/\bnbc\b/.test(n)) return "nbc";
    if (/\bcanal\b/.test(n)) return "canal";
    return "";
  }

  function familyFor(text) {
    const n = normalizeText(text);
    if (/\b(?:max|xtra|extra)\b/.test(n)) return "max";
    if (/\bsports\b/.test(n)) return "sports";
    return "";
  }

  function channelNumber(text) {
    const n = normalizeText(text);
    const preferred = n.match(/(?:max|xtra|extra|sports)\s*(\d{1,2})\b/);
    if (preferred) return Number(preferred[1]);
    const numbers = [...n.matchAll(/\b(\d{1,2})\b/g)].map((match) => Number(match[1]));
    return numbers.length ? numbers[0] : null;
  }

  function broadcastSpec(channelId, label) {
    const id = normalizeText(channelId).replace(/\s+/g, "-");
    let match = id.match(/^bein-max-(\d{1,2})$/);
    if (match) return { network: "bein", family: "max", number: Number(match[1]), label: label || channelId || "" };
    match = id.match(/^bein-sports-(\d{1,2})$/);
    if (match) return { network: "bein", family: "sports", number: Number(match[1]), label: label || channelId || "" };

    const text = `${label || ""} ${channelId || ""}`.trim();
    return {
      network: networkFor(text),
      family: familyFor(text),
      number: channelNumber(text),
      label: label || channelId || "",
    };
  }

  function candidateText(channel) {
    return `${channel?.name || ""} ${channel?.categoryName || ""} ${channel?.epgChannelId || ""}`.trim();
  }

  function candidateSpec(channel) {
    const text = candidateText(channel);
    return {
      network: networkFor(text),
      family: familyFor(text),
      number: channelNumber(channel?.name || channel?.epgChannelId || text),
      normalized: normalizeText(text),
      tokenSet: new Set(tokens(text)),
    };
  }

  function qualityScore(channel) {
    const text = normalizeText(candidateText(channel));
    let score = 0;
    if (/\bfhd\b|\bfullhd\b/.test(text)) score += 5;
    else if (/\bhd\b/.test(text)) score += 4;
    else if (/\bsd\b/.test(text)) score += 1;
    if (/\b4k\b|\buhd\b/.test(text)) score += 2;
    if (/\bhevc\b/.test(text)) score -= 1;
    if (/\bbackup\b|\bbk\b|\btest\b/.test(text)) score -= 5;
    return score;
  }

  function languageScore(channel) {
    const text = normalizeText(`${channel?.name || ""} ${channel?.categoryName || ""}`);
    if (/\barabic\b|\bar\b|عربي|عربى/.test(text)) return 5;
    if (/\benglish\b|\ben\b/.test(text)) return -3;
    return 0;
  }

  function semanticScore(target, channel) {
    const candidate = candidateSpec(channel);
    if (target.network && candidate.network && target.network !== candidate.network) return Number.NEGATIVE_INFINITY;

    let score = 0;
    if (target.network && candidate.network === target.network) score += 70;

    if (target.family) {
      if (target.family === "max" && candidate.family !== "max") return Number.NEGATIVE_INFINITY;
      if (target.family === "sports" && candidate.family === "max") return Number.NEGATIVE_INFINITY;
      if (candidate.family === target.family) score += 35;
    }

    if (target.number != null) {
      if (candidate.number != null && candidate.number !== target.number) return Number.NEGATIVE_INFINITY;
      if (candidate.number === target.number) score += 55;
      else score -= 25;
    }

    const targetTokens = new Set(tokens(target.label));
    for (const token of targetTokens) {
      if (candidate.tokenSet.has(token)) score += 7;
    }

    score += languageScore(channel);
    score += qualityScore(channel);
    if (/sport/.test(normalizeText(channel?.categoryName || ""))) score += 2;
    return score;
  }

  function stableCompare(a, b) {
    if (b.score !== a.score) return b.score - a.score;
    const aq = qualityScore(a.channel);
    const bq = qualityScore(b.channel);
    if (bq !== aq) return bq - aq;
    const an = normalizeText(a.channel?.name || "");
    const bn = normalizeText(b.channel?.name || "");
    const byName = an.localeCompare(bn, "en");
    if (byName) return byName;
    const ac = normalizeText(a.channel?.categoryName || "");
    const bc = normalizeText(b.channel?.categoryName || "");
    const byCategory = ac.localeCompare(bc, "en");
    if (byCategory) return byCategory;
    return String(a.channel?.streamId || "").localeCompare(String(b.channel?.streamId || ""), "en", { numeric: true });
  }

  function resolveChannel(targetInput, channels) {
    const target = typeof targetInput === "string"
      ? broadcastSpec("", targetInput)
      : broadcastSpec(targetInput?.channelId || "", targetInput?.channel || targetInput?.label || "");
    if (!target.network && target.number == null && !target.label) return null;

    const ranked = (Array.isArray(channels) ? channels : [])
      .map((channel) => ({ channel, score: semanticScore(target, channel) }))
      .filter((row) => Number.isFinite(row.score) && row.score >= 45)
      .sort(stableCompare);

    if (!ranked.length) return null;
    const best = ranked[0];
    return {
      ...best.channel,
      resolver: {
        target,
        score: best.score,
        deterministicKey: `${normalizeText(best.channel?.name || "")}|${normalizeText(best.channel?.categoryName || "")}|${best.channel?.streamId || ""}`,
      },
    };
  }

  return {
    normalizeText,
    broadcastSpec,
    candidateSpec,
    semanticScore,
    resolveChannel,
  };
});
