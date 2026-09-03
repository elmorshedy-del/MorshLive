/* Exact canonical broadcaster -> current IPTV Lab stream resolver.
 *
 * The match card's channelId is authoritative. Provider metadata is used first
 * when it can identify the logical channel; provider name + category is the
 * deterministic fallback when those metadata fields are absent. streamId is
 * only the current playback value attached to the canonical channel key.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.KZIptvChannelResolver = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const ARABIC_DIGITS = {
    "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4",
    "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
  };

  function normalizeDigits(value) {
    return String(value || "").replace(/[٠-٩]/g, (digit) => ARABIC_DIGITS[digit] || digit);
  }

  function normalizeText(value) {
    return normalizeDigits(value)
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/\bbeinsports?(\d{1,2})\b/g, " bein sports $1 ")
      .replace(/\bbeinmax(\d{1,2})\b/g, " bein max $1 ")
      .replace(/\bsscsports?(\d{1,2})\b/g, " ssc sports $1 ")
      .replace(/بي\s*(?:إن|ان)|بين(?=\s*(?:سبورت|sport))/g, " bein ")
      .replace(/سبورت(?:س)?/g, " sports ")
      .replace(/ماكس/g, " max ")
      .replace(/\bbe\s*in\b/g, " bein ")
      .replace(/\bsport\b/g, " sports ")
      .replace(/[^a-z0-9\u0600-\u06ff]+/g, " ")
      .replace(/([a-z])(\d)/g, "$1 $2")
      .replace(/(\d)([a-z])/g, "$1 $2")
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

  function canonicalKey(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";

    const slug = raw
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    if (/^bein-(?:sports|max)-\d{1,2}$/.test(slug)) return slug;
    if (/^ssc-sports-\d{1,2}$/.test(slug)) return slug;

    const text = normalizeText(raw);
    let match = text.match(/\bbein\s+max\s+(\d{1,2})\b/);
    if (match) return `bein-max-${Number(match[1])}`;
    match = text.match(/\bbein\s+sports\s+(\d{1,2})\b/);
    if (match) return `bein-sports-${Number(match[1])}`;
    match = text.match(/\bssc\s+sports\s+(\d{1,2})\b/);
    if (match) return `ssc-sports-${Number(match[1])}`;
    return "";
  }

  function stableProviderId(channel) {
    const fields = [
      ["epgChannelId", channel?.epgChannelId],
      ["providerChannelId", channel?.providerChannelId],
      ["channelUuid", channel?.channelUuid],
      ["channelUid", channel?.channelUid],
      ["uuid", channel?.uuid],
      ["customSid", channel?.customSid],
      ["serviceId", channel?.serviceId],
    ];
    for (const [field, raw] of fields) {
      const value = normalizeIdentifier(raw);
      if (value) return { field, value };
    }
    return null;
  }

  function fallbackNameCategoryKey(channel) {
    const name = normalizeText(channel?.name || "");
    const category = normalizeText(channel?.categoryName || "");
    const combined = `${name} ${category}`.trim();

    let numberMatch = name.match(/\bbein\s+(?:sports\s+)?(\d{1,2})\b/);
    if (!numberMatch) numberMatch = combined.match(/\bbein\s+(?:sports\s+)?(\d{1,2})\b/);
    if (numberMatch) {
      const number = Number(numberMatch[1]);
      if (/\bbein\s+max\b/.test(category) || /\bbein\s+max\b/.test(name)) return `bein-max-${number}`;
      if (/\bbein\s+sports\b/.test(category) || /\bbein\s+sports\b/.test(name)) return `bein-sports-${number}`;
    }

    numberMatch = name.match(/\bssc\s+(?:sports\s+)?(\d{1,2})\b/);
    if (!numberMatch) numberMatch = combined.match(/\bssc\s+(?:sports\s+)?(\d{1,2})\b/);
    if (numberMatch && (/\bssc\s+sports\b/.test(category) || /\bssc\s+sports\b/.test(name))) {
      return `ssc-sports-${Number(numberMatch[1])}`;
    }
    return "";
  }

  function channelCanonicalKey(channel) {
    const metadata = [
      channel?.epgChannelId,
      channel?.providerChannelId,
      channel?.channelUuid,
      channel?.channelUid,
      channel?.uuid,
      channel?.customSid,
      channel?.serviceId,
    ];
    for (const value of metadata) {
      const key = canonicalKey(value);
      if (key) return key;
    }

    const nameKey = canonicalKey(channel?.name || "");
    if (nameKey) return nameKey;
    return fallbackNameCategoryKey(channel);
  }

  function variantTuple(channel) {
    const text = normalizeText(`${channel?.name || ""} ${channel?.categoryName || ""}`);
    const stable = stableProviderId(channel);
    const arabic = /\barab(?:ic)?\b|\bar\b|عربي|عربى/.test(text);
    const english = /\benglish\b|\ben\b/.test(text);
    const backup = /\bbackup\b|\bbk\b|\btest\b|\balt\b/.test(text);
    const sd = /\bsd\b/.test(text);
    return [
      stable ? 0 : 1,
      arabic ? 0 : 1,
      english ? 1 : 0,
      backup ? 1 : 0,
      sd ? 0 : 1,
      stable?.value || "~",
      String(channel?.streamId || "~"),
    ];
  }

  function compareVariants(a, b) {
    const aa = variantTuple(a);
    const bb = variantTuple(b);
    for (let index = 0; index < aa.length; index += 1) {
      if (typeof aa[index] === "number" && typeof bb[index] === "number") {
        if (aa[index] !== bb[index]) return aa[index] - bb[index];
        continue;
      }
      const cmp = String(aa[index]).localeCompare(String(bb[index]), "en", { numeric: true });
      if (cmp) return cmp;
    }
    return 0;
  }

  function buildChannelMap(channels) {
    const map = new Map();
    for (const channel of Array.isArray(channels) ? channels : []) {
      if (!channel?.streamId) continue;
      const key = channelCanonicalKey(channel);
      if (!key) continue;
      const previous = map.get(key);
      if (!previous || compareVariants(channel, previous) < 0) map.set(key, channel);
    }
    return map;
  }

  function targetCanonicalKey(targetInput) {
    if (typeof targetInput === "string") return canonicalKey(targetInput);
    return canonicalKey(targetInput?.channelId || "")
      || canonicalKey(targetInput?.channel || targetInput?.label || "");
  }

  function bindingKey(targetInput) {
    const key = targetCanonicalKey(targetInput);
    return key ? `channel:${key}` : "";
  }

  function resolveChannel(targetInput, channels) {
    const key = targetCanonicalKey(targetInput);
    if (!key) return null;
    const selected = buildChannelMap(channels).get(key);
    if (!selected) return null;
    const provider = stableProviderId(selected);
    return {
      ...selected,
      resolver: {
        channelId: key,
        bindingKey: `channel:${key}`,
        stableProviderField: provider?.field || "",
        stableProviderId: provider?.value || "",
      },
    };
  }

  return {
    normalizeText,
    normalizeIdentifier,
    canonicalKey,
    channelCanonicalKey,
    stableProviderId,
    buildChannelMap,
    bindingKey,
    resolveChannel,
  };
});
