/**
 * schema.js — provider-agnostic normalized match model.
 *
 * Every data source (StatsBomb open data, ESPN, SportMonks, a tracking feed…)
 * maps its raw payload into THIS shape. The analysis engine only ever sees the
 * normalized model + a set of capability flags, so the analysis code never
 * changes when you swap the feed underneath it. The flags are what let a claim
 * degrade honestly instead of being faked: if a capability isn't present, the
 * critiques that depend on it are marked `locked`, not invented.
 */

'use strict';

// Capability flags — what the current feed can actually ground.
const CAP = {
  XG: 'xg', // per-shot expected goals
  SHOT_XY: 'shot_xy', // shot-level coordinates (free live: BALLDONTLIE shot maps)
  XY_EVENTS: 'xy_events', // FULL per-event coordinates incl. passes (StatsBomb, Opta)
  PRESSURE: 'pressure_index', // team pressure timeline (SportMonks add-on)
  TRACKING: 'tracking', // continuous all-22 positions (SkillCorner, PFF)
};

// xy_events (full event coords) implies shot_xy (shot coords). Adapters can
// declare just xy_events; call this to get the effective capability set.
function withImplied(caps) {
  const s = new Set(caps);
  if (s.has(CAP.XY_EVENTS)) s.add(CAP.SHOT_XY);
  return s;
}

// Pitch is normalised to the StatsBomb frame: x 0..120 (own goal → opp goal),
// y 0..80 (left touchline → right touchline from the attacking team's view).
const PITCH = { X: 120, Y: 80 };

/**
 * A single on-ball event. Nullable fields are `null` when the feed can't supply
 * them — engine code must treat `null` as "unknown", never as zero.
 */
function makeEvent(o) {
  return {
    index: o.index ?? 0,
    minute: o.minute ?? 0,
    second: o.second ?? 0,
    period: o.period ?? 1,
    team: o.team ?? null,
    type: o.type ?? 'other', // normalized lowercase: pass|carry|shot|goal|substitution|foul_won|ball_recovery|duel|...
    subtype: o.subtype ?? null, // e.g. shot play-pattern
    player: o.player ?? null,
    x: o.x ?? null,
    y: o.y ?? null,
    endX: o.endX ?? null,
    endY: o.endY ?? null,
    length: o.length ?? null, // pass length (m)
    xg: o.xg ?? null,
    outcome: o.outcome ?? null,
    possession: o.possession ?? null, // possession-chain id
    relatedPlayer: o.relatedPlayer ?? null, // pass recipient / sub replacement
  };
}

function makeTeamState(o) {
  return {
    team: o.team,
    possessionPct: o.possessionPct ?? null,
    shots: o.shots ?? null,
    shotsOnTarget: o.shotsOnTarget ?? null,
    corners: o.corners ?? null,
    xgTotal: o.xgTotal ?? null,
    formation: o.formation ?? null,
  };
}

/**
 * The whole match, normalized. `capabilities` is a Set of CAP.* strings.
 */
function makeMatch(o) {
  return {
    source: o.source, // 'statsbomb' | 'espn' | …
    matchId: String(o.matchId),
    competition: o.competition ?? '',
    home: o.home,
    away: o.away,
    score: o.score ?? [null, null],
    events: o.events ?? [],
    teamStates: o.teamStates ?? {}, // keyed by team name
    capabilities: o.capabilities instanceof Set ? o.capabilities : new Set(o.capabilities || []),
    teams() {
      return [o.home, o.away];
    },
  };
}

module.exports = { CAP, PITCH, makeEvent, makeTeamState, makeMatch };
