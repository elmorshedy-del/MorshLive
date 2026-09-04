/* ============================================================================
 * broadcast-registry.js — Normalize human broadcaster labels independently
 * from playback routing.
 *
 * Saudi domestic rights (2025-26 through 2030-31) are held by Thmanyah. Its
 * official free satellite channels are ثمانية.1 / ثمانية.2 / ثمانية.3.
 * This module deliberately keeps `broadcastChannelId` separate from
 * `playbackChannelId`: knowing the real TV channel must not silently route a
 * match into an unrelated stream.
 * ==========================================================================*/

function asciiDigits(value) {
  return String(value || "")
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)));
}

function cleanLabel(value) {
  return asciiDigits(value)
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function channelNumber(text) {
  const match = cleanLabel(text).match(/([1-9]\d*)/);
  return match ? Number.parseInt(match[1], 10) : null;
}

function resolveBroadcastChannel(label) {
  const raw = cleanLabel(label);
  if (!raw) {
    return {
      channel: "",
      provider: null,
      broadcastChannelId: null,
      playbackChannelId: null,
      confidence: "none",
    };
  }

  if (/(?:ثمانية|thmanyah)/i.test(raw)) {
    const number = channelNumber(raw);
    const exact = number >= 1 && number <= 3 ? number : null;
    return {
      channel: exact ? `ثمانية ${exact}` : "ثمانية",
      provider: "thmanyah",
      broadcastChannelId: exact ? `thmanyah-${exact}` : "thmanyah",
      playbackChannelId: null,
      confidence: exact ? "exact" : "network",
    };
  }

  if (/\bssc\b/i.test(raw)) {
    const number = channelNumber(raw);
    return {
      channel: number ? `SSC ${number}` : "SSC",
      provider: "ssc",
      broadcastChannelId: number ? `ssc-${number}` : "ssc",
      playbackChannelId: null,
      confidence: number ? "exact" : "network",
    };
  }

  const max = raw.match(/(?:ماكس|max)\s*([1-4])/i);
  if (max && /(?:بي\s*إن|بين|bein)/i.test(raw)) {
    const number = Number.parseInt(max[1], 10);
    return {
      channel: `beIN MAX ${number}`,
      provider: "bein",
      broadcastChannelId: `bein-max-${number}`,
      playbackChannelId: `bein-max-${number}`,
      confidence: "exact",
    };
  }

  if (/(?:بي\s*إن|بين|bein)/i.test(raw)) {
    const number = channelNumber(raw);
    const resolved = number === 2 ? 2 : 1;
    return {
      channel: `beIN Sports ${resolved}`,
      provider: "bein",
      broadcastChannelId: `bein-sports-${resolved}`,
      playbackChannelId: `bein-sports-${resolved}`,
      confidence: number ? "exact" : "network",
    };
  }

  return {
    channel: raw,
    provider: null,
    broadcastChannelId: null,
    playbackChannelId: null,
    confidence: "source",
  };
}

function isSaudiProLeagueMatch(match) {
  return (
    match?.competition === "spl" ||
    match?.leagueSlug === "ksa.1" ||
    /espn-ksa\.1-/.test(String(match?.id || ""))
  );
}

function defaultSaudiBroadcast() {
  return {
    provider: "thmanyah",
    channelId: "thmanyah",
    source: "spl-rights-holder",
    confidence: "network",
  };
}

function broadcastMetadata(resolved, source) {
  if (!resolved?.provider || !resolved.broadcastChannelId) return null;
  return {
    provider: resolved.provider,
    channelId: resolved.broadcastChannelId,
    source,
    confidence: resolved.confidence,
  };
}

module.exports = {
  asciiDigits,
  cleanLabel,
  resolveBroadcastChannel,
  isSaudiProLeagueMatch,
  defaultSaudiBroadcast,
  broadcastMetadata,
};
