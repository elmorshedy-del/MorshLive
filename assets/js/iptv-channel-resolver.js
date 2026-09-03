/* Deterministic broadcaster -> IPTV catalog resolver.
 *
 * Visible provider names are presentation only. Logical channel identity is anchored
 * to stable provider metadata (EPG id / provider channel id / service id) whenever
 * available. Stream ids are only a portal-scoped last resort.
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
      // Common compact EPG/tvg ids: beinsports1.qa, beinmax2, sscsport1, etc.
      .replace(/\bbeinsports?(\d{1,2})\b/g, " bein sports $1 ")
      .replace(/\bbeinmax(\d{1,2})\b/g, " bein max $1 ")
      .replace(/\bsscsports?(\d{1,2})\b/g, " ssc sports $1 ")
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

  function normalizeIdentifier(value) {
    return normalizeDigits(value)
      .normalize("NFKC")
      .trim()
      .toLowerCase()
      .replace(/^tvg:/, "")
      .replace(/\s+/g, "")
      .replace(/[^a-z0-9._:@/-]+/g, "");
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
    if (match) return { network: "bein", family: "max", number: Number(match[1]), label: label || channelId || "", channelId: channelId || "" };
    match = id.match(/^bein-sports-(\d{1,2})$/);
    if (match) return { network: "bein", family: "sports", number: Number(match[1]), label: label || channelId || "", channelId: channelId || "" };

    const text = `${label || ""} ${channelId || ""}`.trim();
    return {
      network: networkFor(text),
      family: familyFor(text),
      number: channelNumber(text),
      label: label || channelId || "",
      channelId: channelId || "",
    };
  }

  function bindingKey(targetInput) {
    const target = typeof targetInput === "string"
      ? broadcastSpec("", targetInput)
      : broadcastSpec(targetInput?.channelId || "", targetInput?.channel || targetInput?.label || "");
    const canonicalId = normalizeIdentifier(target.channelId);
    if (canonicalId) return `channel:${canonicalId}`;
    if (target.network && target.family && target.number != null) {
      return `broadcast:${target.network}:${target.family}:${target.number}`;
    }
    if (target.network && target.number != null) return `broadcast:${target.network}:${target.number}`;
    const labelKey = normalizeText(target.label).replace(/\s+/g, "-");
    return labelKey ? `label:${labelKey}` : "";
  }

  function candidateText(channel) {
    return `${channel?.name || ""} ${channel?.categoryName || ""} ${channel?.epgChannelId || ""}`.trim();
  }

  function candidateSpec(channel) {
    const text = candidateText(channel);
    return {
      network: networkFor(text),
      family: familyFor(text),
      number: channelNumber(`${channel?.name || ""} ${channel?.epgChannelId || ""} ${channel?.categoryName || ""}`),
      normalized: normalizeText(text),
      tokenSet: new Set(tokens(text)),
    };
  }

  function fingerprint(value) {
    const text = String(value || "");
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return `fp1:${(hash >>> 0).toString(16).padStart(8, "0")}`;
  }

  function variantTraits(channel) {
    const text = normalizeText(`${channel?.name || ""} ${channel?.categoryName || ""}`);
    let quality = "unknown";
    if (/\b4k\b|\buhd\b/.test(text)) quality = "4k";
    else if (/\bfhd\b|\bfullhd\b|\b1080p?\b/.test(text)) quality = "fhd";
    else if (/\bhd\b|\b720p?\b/.test(text)) quality = "hd";
    else if (/\bsd\b/.test(text)) quality = "sd";

    let codec = "unknown";
    if (/\bhevc\b|\bh265\b/.test(text)) codec = "hevc";
    else if (/\bh264\b|\bavc\b/.test(text)) codec = "h264";

    let language = "unknown";
    if (/\barabic\b|\bar\b|عربي|عربى/.test(text)) language = "ar";
    else if (/\benglish\b|\ben\b/.test(text)) language = "en";

    const role = /\bbackup\b|\bbk\b|\btest\b|\balt\b/.test(text) ? "backup" : "primary";
    return { quality, codec, language, role };
  }

  function stableIdentity(channel) {
    const epg = normalizeIdentifier(channel?.epgChannelId);
    const providerChannelId = normalizeIdentifier(
      channel?.providerChannelId || channel?.channelUuid || channel?.channelUid || channel?.uuid,
    );
    const serviceId = normalizeIdentifier(channel?.customSid || channel?.serviceId);
    const portalId = normalizeIdentifier(channel?.portalId || "lab") || "lab";
    const streamId = normalizeIdentifier(channel?.streamId);

    let logicalKey = "";
    let tier = "none";
    let persistent = false;
    const evidence = [];

    if (epg) {
      logicalKey = `epg:${epg}`;
      tier = "epg";
      persistent = true;
      evidence.push("epgChannelId");
    } else if (providerChannelId) {
      logicalKey = `provider-channel:${providerChannelId}`;
      tier = "provider-channel";
      persistent = true;
      evidence.push("providerChannelId");
    } else if (serviceId) {
      logicalKey = `service:${serviceId}`;
      tier = "service-id";
      persistent = true;
      evidence.push("customSid");
    } else if (streamId) {
      logicalKey = `portal:${portalId}:stream:${streamId}`;
      tier = "portal-stream";
      persistent = false;
      evidence.push("streamId");
    }

    const traits = variantTraits(channel);
    const variantKey = logicalKey
      ? `${logicalKey}|${traits.language}|${traits.quality}|${traits.codec}|${traits.role}|stream:${streamId || "_"}`
      : "";

    return {
      logicalKey,
      variantKey,
      fingerprint: logicalKey ? fingerprint(logicalKey) : "",
      tier,
      persistent,
      evidence,
    };
  }

  function qualityScore(channel) {
    const traits = variantTraits(channel);
    let score = 0;
    if (traits.role === "backup") score -= 30;
    if (traits.language === "ar") score += 12;
    else if (traits.language === "en") score -= 5;

    // Prefer broadly compatible high quality over a more fragile HEVC/4K feed.
    if (traits.quality === "fhd") score += 16;
    else if (traits.quality === "hd") score += 13;
    else if (traits.quality === "4k") score += 11;
    else if (traits.quality === "sd") score += 4;

    if (traits.codec === "h264") score += 4;
    else if (traits.codec === "hevc") score -= 1;
    return score;
  }

  function identityScore(channel) {
    const identity = stableIdentity(channel);
    if (identity.tier === "epg") return 18;
    if (identity.tier === "provider-channel") return 15;
    if (identity.tier === "service-id") return 12;
    if (identity.tier === "portal-stream") return 1;
    return -10;
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

    score += identityScore(channel);
    score += qualityScore(channel);
    if (/sport/.test(normalizeText(channel?.categoryName || ""))) score += 2;
    return score;
  }

  function compareVariants(a, b) {
    const quality = qualityScore(b) - qualityScore(a);
    if (quality) return quality;
    const ai = stableIdentity(a);
    const bi = stableIdentity(b);
    const keyCompare = ai.variantKey.localeCompare(bi.variantKey, "en", { numeric: true });
    if (keyCompare) return keyCompare;
    return String(a?.streamId || "").localeCompare(String(b?.streamId || ""), "en", { numeric: true });
  }

  function selectVariant(channels) {
    return [...channels].sort(compareVariants)[0] || null;
  }

  function exactIdentityMatch(logicalKey, channels) {
    if (!logicalKey) return null;
    const matches = (Array.isArray(channels) ? channels : []).filter(
      (channel) => stableIdentity(channel).logicalKey === logicalKey,
    );
    return selectVariant(matches);
  }

  function bootstrapMatch(target, channels) {
    const groups = new Map();
    for (const channel of Array.isArray(channels) ? channels : []) {
      const score = semanticScore(target, channel);
      if (!Number.isFinite(score) || score < 45) continue;
      const identity = stableIdentity(channel);
      const groupKey = identity.logicalKey || `unidentified:${normalizeText(channel?.name || "")}`;
      const existing = groups.get(groupKey) || { key: groupKey, score: Number.NEGATIVE_INFINITY, channels: [] };
      existing.score = Math.max(existing.score, score);
      existing.channels.push(channel);
      groups.set(groupKey, existing);
    }

    const ranked = [...groups.values()].sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const ap = stableIdentity(a.channels[0]).persistent ? 1 : 0;
      const bp = stableIdentity(b.channels[0]).persistent ? 1 : 0;
      if (bp !== ap) return bp - ap;
      return a.key.localeCompare(b.key, "en", { numeric: true });
    });
    if (!ranked.length) return null;
    const best = ranked[0];
    return { channel: selectVariant(best.channels), score: best.score };
  }

  function resolveChannel(targetInput, channels) {
    const target = typeof targetInput === "string"
      ? broadcastSpec("", targetInput)
      : broadcastSpec(targetInput?.channelId || "", targetInput?.channel || targetInput?.label || "");
    if (!target.network && target.number == null && !target.label) return null;

    const requestedLogicalKey = String(
      typeof targetInput === "object"
        ? targetInput?.iptvLogicalKey || targetInput?.logicalKey || ""
        : "",
    );

    let selected = exactIdentityMatch(requestedLogicalKey, channels);
    let score = selected ? Number.POSITIVE_INFINITY : null;
    let bootstrap = false;

    if (!selected) {
      const boot = bootstrapMatch(target, channels);
      if (!boot?.channel) return null;
      selected = boot.channel;
      score = boot.score;
      bootstrap = true;
    }

    const identity = stableIdentity(selected);
    return {
      ...selected,
      resolver: {
        target,
        bindingKey: bindingKey(targetInput),
        score,
        bootstrap,
        logicalKey: identity.logicalKey,
        variantKey: identity.variantKey,
        fingerprint: identity.fingerprint,
        identityTier: identity.tier,
        persistentIdentity: identity.persistent,
        identityEvidence: identity.evidence,
        deterministicKey: identity.variantKey || identity.logicalKey,
      },
    };
  }

  return {
    normalizeText,
    normalizeIdentifier,
    broadcastSpec,
    bindingKey,
    candidateSpec,
    stableIdentity,
    variantTraits,
    semanticScore,
    resolveChannel,
  };
});
