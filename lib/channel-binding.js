/**
 * How much to trust the channel a match is bound to.
 *
 * A match carries one `channelId`, and the watch page plays that channel. When
 * the broadcast scraper cannot resolve a real channel it falls back to
 * `bein-sports-1` — so a page can confidently play a channel nobody verified is
 * carrying that game. Observed in production: all 40 matches in today.json were
 * bound to bein-sports-1, and one 19:00 slot had five of them at once,
 * Real Madrid among them. Four of those five viewers necessarily saw a
 * different match.
 *
 * We cannot fix the upstream data from here, but we can stop presenting a guess
 * as a fact. These levels let the UI offer the viewer a way out exactly when the
 * binding is not trustworthy.
 */

/** The broadcast registry named this channel. Trust it. */
export const BINDING_RESOLVED = "resolved";
/** Nothing resolved; this is the default channel, not a known one. */
export const BINDING_FALLBACK = "fallback";
/** Another match claims this same channel at the same time. At most one can be right. */
export const BINDING_CONTESTED = "contested";

/** Matches this far apart in kickoff can share a channel without clashing. */
export const OVERLAP_MINUTES = 105;

export function bindingConfidence(match) {
  const value = String(match?.channelBinding || "");
  if (value === BINDING_RESOLVED || value === BINDING_CONTESTED) return value;
  if (value === BINDING_FALLBACK) return BINDING_FALLBACK;
  // No annotation at all (older payloads): a bare channelId is only as good as
  // its provenance, and the default channel is the one the scraper guesses.
  if (!match?.channelId) return BINDING_FALLBACK;
  return match.channelId === "bein-sports-1" ? BINDING_FALLBACK : BINDING_RESOLVED;
}

export function isTrustedBinding(match) {
  return bindingConfidence(match) === BINDING_RESOLVED;
}

function kickoffMs(match) {
  const ms = Date.parse(String(match?.kickoffUtc || ""));
  return Number.isFinite(ms) ? ms : Number.NaN;
}

/**
 * Flag every match whose channel is also claimed by another match kicking off
 * around the same time. Mutates and returns the list so a pipeline step can use
 * it in place.
 */
export function markContestedBindings(matches) {
  const rows = Array.isArray(matches) ? matches : [];
  const byChannel = new Map();
  for (const match of rows) {
    const channelId = match?.channelId;
    if (!channelId) continue;
    if (!byChannel.has(channelId)) byChannel.set(channelId, []);
    byChannel.get(channelId).push(match);
  }

  for (const group of byChannel.values()) {
    if (group.length < 2) continue;
    for (const match of group) {
      const at = kickoffMs(match);
      if (!Number.isFinite(at)) continue;
      const clashes = group.some((other) => {
        if (other === match) return false;
        const otherAt = kickoffMs(other);
        if (!Number.isFinite(otherAt)) return false;
        return Math.abs(otherAt - at) < OVERLAP_MINUTES * 60000;
      });
      // A resolved binding stays resolved: if the registry named the channel for
      // both, the clash is upstream reality, not our guesswork. Only an
      // unverified binding gets demoted.
      if (clashes && match.channelBinding !== BINDING_RESOLVED) {
        match.channelBinding = BINDING_CONTESTED;
      }
    }
  }
  return rows;
}
