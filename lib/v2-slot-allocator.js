const MINUTE = 60_000;

function finiteMs(value, label) {
  const parsed = typeof value === "number" ? value : Date.parse(value || "");
  if (!Number.isFinite(parsed)) throw new Error(`Invalid ${label}`);
  return parsed;
}

function nonNegativeInt(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function pairKey(left, right) {
  return [String(left || ""), String(right || "")].sort().join("\u0000");
}

function overlaps(left, right) {
  return left.startMs < right.endMs && right.startMs < left.endMs;
}

function sameStreamOverlap(entries) {
  for (let i = 0; i < entries.length; i += 1) {
    for (let j = i + 1; j < entries.length; j += 1) {
      if (entries[i].streamId === entries[j].streamId && overlaps(entries[i], entries[j])) {
        return [entries[i], entries[j]];
      }
    }
  }
  return null;
}

function asWindow(binding) {
  const kickoff = finiteMs(binding?.broadcastKickoffUtc || binding?.kickoffUtc, "binding kickoff");
  const streamId = String(binding?.streamId || "");
  if (!/^\d+$/.test(streamId)) throw new Error(`Invalid streamId for ${binding?.matchId || "match"}`);
  return {
    ...binding,
    matchId: String(binding?.matchId || ""),
    streamId,
    kickoffMs: kickoff,
    startMs: kickoff - 15 * MINUTE,
    endMs: kickoff + 120 * MINUTE,
    startAt: new Date(kickoff - 15 * MINUTE).toISOString(),
    endAt: new Date(kickoff + 120 * MINUTE).toISOString(),
  };
}

export function scoreMatch(binding, priority = {}) {
  const home = String(binding?.home || "");
  const away = String(binding?.away || "");
  const competition = String(binding?.competition || "");
  const teams = priority?.teams || {};
  const tier1 = new Set(Array.isArray(teams.tier1) ? teams.tier1.map(String) : []);
  const tier2 = new Set(Array.isArray(teams.tier2) ? teams.tier2.map(String) : []);
  const rivalries = new Set(
    (Array.isArray(priority?.rivalries) ? priority.rivalries : [])
      .filter((pair) => Array.isArray(pair) && pair.length === 2)
      .map(([left, right]) => pairKey(left, right)),
  );

  let score = 0;
  const reasons = [];

  const competitionWeight = nonNegativeInt(priority?.competition?.[competition]);
  if (competitionWeight) {
    score += competitionWeight;
    reasons.push(`competition:${competition}+${competitionWeight}`);
  }

  const tier1Weight = nonNegativeInt(priority?.tier1);
  const tier2Weight = nonNegativeInt(priority?.tier2);
  for (const team of [home, away]) {
    if (tier1.has(team) && tier1Weight) {
      score += tier1Weight;
      reasons.push(`tier1:${team}+${tier1Weight}`);
    } else if (tier2.has(team) && tier2Weight) {
      score += tier2Weight;
      reasons.push(`tier2:${team}+${tier2Weight}`);
    }
  }

  const rivalryBonus = nonNegativeInt(priority?.rivalryBonus);
  if (rivalryBonus && rivalries.has(pairKey(home, away))) {
    score += rivalryBonus;
    reasons.push(`rivalry+${rivalryBonus}`);
  }

  const bigGameBonus = nonNegativeInt(priority?.bigGameBonus);
  if (bigGameBonus && tier1.has(home) && tier1.has(away)) {
    score += bigGameBonus;
    reasons.push(`big-game+${bigGameBonus}`);
  }

  return { score, reasons };
}

function previousFrozen(previous, bindingsByMatch, slotSet, nowMs) {
  const frozen = [];
  for (const raw of Array.isArray(previous?.entries) ? previous.entries : []) {
    const startMs = Date.parse(raw?.startAt || "");
    const endMs = Date.parse(raw?.endAt || "");
    const matchId = String(raw?.matchId || "");
    const streamId = String(raw?.streamId || "");
    const slot = String(raw?.slot || "");
    const currentBinding = bindingsByMatch.get(matchId);
    if (!slotSet.has(slot) || !currentBinding) continue;
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || !(startMs <= nowMs && nowMs < endMs))
      continue;
    if (String(currentBinding.streamId) !== streamId) continue;
    frozen.push({
      ...raw,
      slot,
      matchId,
      streamId,
      channelId: `iptv-${streamId}`,
      startMs,
      endMs,
      _frozen: true,
    });
  }
  return frozen;
}

function slotAvailable(placed, slot, candidate) {
  return !placed.some((entry) => entry.slot === slot && overlaps(entry, candidate));
}

function adjacentSameStream(placed, slot, candidate) {
  return placed.some(
    (entry) =>
      entry.slot === slot &&
      entry.streamId === candidate.streamId &&
      (entry.endMs === candidate.startMs || candidate.endMs === entry.startMs),
  );
}

function blockingMatches(placed, candidate) {
  return [
    ...new Set(placed.filter((entry) => overlaps(entry, candidate)).map((entry) => String(entry.matchId))),
  ].sort();
}

function outputEntry(entry) {
  return {
    slot: entry.slot,
    matchId: entry.matchId,
    streamId: entry.streamId,
    channelId: entry.channelId,
    startAt: entry.startAt,
    endAt: entry.endAt,
    score: Number.isFinite(entry.score) ? entry.score : 0,
    reasons: Array.isArray(entry.reasons) ? entry.reasons : [],
    pinned: Boolean(entry.pinned),
  };
}

export function allocateSlots({
  bindings = [],
  slots = ["a", "b"],
  priority = {},
  pins = {},
  previous = null,
  now,
} = {}) {
  const nowMs = finiteMs(now, "allocator now");
  const normalizedSlots = [...new Set((slots || []).map(String).filter(Boolean))];
  if (!normalizedSlots.length) throw new Error("Allocator requires at least one slot");
  const slotSet = new Set(normalizedSlots);

  const windows = (bindings || [])
    .filter((binding) => binding?.matchId)
    .map(asWindow)
    .filter((binding) => binding.endMs > nowMs);

  const overlapViolation = sameStreamOverlap(windows);
  if (overlapViolation) {
    throw new Error(
      `Overlapping bindings share stream ${overlapViolation[0].streamId}: ` +
        `${overlapViolation[0].matchId} / ${overlapViolation[1].matchId}`,
    );
  }

  const bindingsByMatch = new Map(windows.map((binding) => [binding.matchId, binding]));
  const placed = previousFrozen(previous, bindingsByMatch, slotSet, nowMs);
  const frozenIds = new Set(placed.map((entry) => entry.matchId));
  const unassigned = [];

  const frozenViolation = sameStreamOverlap(placed);
  if (frozenViolation) {
    throw new Error(`Frozen schedule has overlapping stream ${frozenViolation[0].streamId}`);
  }

  const candidates = windows
    .filter((binding) => !frozenIds.has(binding.matchId))
    .map((binding) => {
      const scored = scoreMatch(binding, priority);
      const pin = pins?.[binding.matchId] === "must" || pins?.[binding.matchId] === "never"
        ? pins[binding.matchId]
        : null;
      return {
        ...binding,
        ...scored,
        pin,
        pinned: pin === "must",
        channelId: `iptv-${binding.streamId}`,
      };
    });

  for (const candidate of candidates.filter((entry) => entry.pin === "never")) {
    unassigned.push({
      matchId: candidate.matchId,
      streamId: candidate.streamId,
      score: candidate.score,
      reason: "pinned-never",
      by: [],
    });
  }

  const allocatable = candidates.filter((entry) => entry.pin !== "never");
  allocatable.sort((left, right) => {
    const leftMust = left.pin === "must" ? 1 : 0;
    const rightMust = right.pin === "must" ? 1 : 0;
    if (leftMust !== rightMust) return rightMust - leftMust;
    if (left.score !== right.score) return right.score - left.score;
    if (left.startMs !== right.startMs) return left.startMs - right.startMs;
    return left.matchId.localeCompare(right.matchId);
  });

  for (const candidate of allocatable) {
    const available = normalizedSlots.filter((slot) => slotAvailable(placed, slot, candidate));
    if (!available.length) {
      unassigned.push({
        matchId: candidate.matchId,
        streamId: candidate.streamId,
        score: candidate.score,
        reason: "outranked",
        by: blockingMatches(placed, candidate),
      });
      continue;
    }

    const sameStreamConflict = placed.find(
      (entry) => entry.streamId === candidate.streamId && overlaps(entry, candidate),
    );
    if (sameStreamConflict) {
      throw new Error(
        `Allocator attempted overlapping duplicate stream ${candidate.streamId}: ` +
          `${sameStreamConflict.matchId} / ${candidate.matchId}`,
      );
    }

    const preferred = available.find((slot) => adjacentSameStream(placed, slot, candidate));
    const slot = preferred || available[0];
    placed.push({
      slot,
      matchId: candidate.matchId,
      streamId: candidate.streamId,
      channelId: candidate.channelId,
      startAt: candidate.startAt,
      endAt: candidate.endAt,
      score: candidate.score,
      reasons: candidate.reasons,
      pinned: candidate.pin === "must",
      startMs: candidate.startMs,
      endMs: candidate.endMs,
      kickoffMs: candidate.kickoffMs,
    });
  }

  const finalViolation = sameStreamOverlap(placed);
  if (finalViolation) {
    throw new Error(`Allocated schedule overlaps stream ${finalViolation[0].streamId}`);
  }

  const slotIndex = new Map(normalizedSlots.map((slot, index) => [slot, index]));
  placed.sort(
    (left, right) =>
      left.startMs - right.startMs ||
      (slotIndex.get(left.slot) ?? 999) - (slotIndex.get(right.slot) ?? 999) ||
      left.matchId.localeCompare(right.matchId),
  );

  unassigned.sort(
    (left, right) =>
      (bindingsByMatch.get(left.matchId)?.startMs ?? 0) -
        (bindingsByMatch.get(right.matchId)?.startMs ?? 0) || left.matchId.localeCompare(right.matchId),
  );

  return {
    version: 1,
    generatedAt: new Date(nowMs).toISOString(),
    capacity: normalizedSlots.length,
    slots: normalizedSlots,
    entries: placed.map(outputEntry),
    unassigned,
  };
}
