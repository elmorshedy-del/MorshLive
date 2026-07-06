/**
 * engine.js — source-agnostic analysis engine.
 *
 * Ported 1:1 from the proven Python `engine.py`. Reads ONLY the MatchModel +
 * capability flags. Computes every primitive it can and records what's `locked`
 * and why, so nothing is ever faked. Attach a tracking source later and
 * CAP.TRACKING flips the locked block to live — no analysis rewrite.
 *
 * This whole file is deterministic: no randomness, no model calls. Same match →
 * identical primitives. The LLM only ever sees this output, never raw data.
 */

'use strict';

const { CAP } = require('./schema');

function round2(n) {
  return Math.round(n * 100) / 100;
}

function analyze(m) {
  const caps = m.capabilities;
  const out = {
    meta: {
      source: m.source,
      matchId: m.matchId,
      competition: m.competition,
      home: m.home,
      away: m.away,
      score: m.score,
      capabilities: [...caps].sort(),
    },
    primitives: {},
    locked: [],
  };
  const P = out.primitives;
  const teams = m.teams();

  const goals = m.events.filter((e) => e.type === 'goal' && e.period <= 4);
  P.goals = goals.map((g) => ({
    minute: g.minute,
    team: g.team,
    player: g.player,
    xg: g.xg,
    subtype: g.subtype,
  }));

  P.teamSummary = {};
  for (const [t, s] of Object.entries(m.teamStates)) {
    P.teamSummary[t] = {
      possessionPct: s.possessionPct,
      shots: s.shots,
      shotsOnTarget: s.shotsOnTarget,
      corners: s.corners,
      xgTotal: s.xgTotal,
      formation: s.formation,
    };
  }

  // xG by half
  if (caps.has(CAP.XG)) {
    const shots = m.events.filter(
      (e) => (e.type === 'shot' || e.type === 'goal') && e.period <= 4
    );
    P.xgByHalf = {};
    for (const t of teams) {
      P.xgByHalf[t] = {
        h1: round2(
          shots
            .filter((e) => e.team === t && e.period === 1)
            .reduce((a, e) => a + (e.xg || 0), 0)
        ),
        h2: round2(
          shots
            .filter((e) => e.team === t && e.period === 2)
            .reduce((a, e) => a + (e.xg || 0), 0)
        ),
      };
    }
  } else {
    out.locked.push('xgByHalf — needs xG');
  }

  // Goal build-up chains + flank vulnerability (need x/y)
  if (caps.has(CAP.XY_EVENTS)) {
    const byPoss = {};
    for (const e of m.events) {
      (byPoss[e.possession] = byPoss[e.possession] || []).push(e);
    }
    const chainTypes = new Set([
      'pass',
      'carry',
      'shot',
      'goal',
      'dribble',
      'foul_won',
    ]);
    P.goalChains = goals.map((g) => {
      const seq = (byPoss[g.possession] || [])
        .slice()
        .sort((a, b) => a.index - b.index)
        .filter((e) => chainTypes.has(e.type));
      return {
        goalMinute: g.minute,
        team: g.team,
        sequence: seq.slice(-7).map((e) => ({
          type: e.type,
          player: e.player,
          x: e.x,
          y: e.y,
          to: e.relatedPlayer,
        })),
      };
    });
    P.chanceFlank = flank(m, teams);
  } else {
    out.locked.push(
      'goalChains — needs x/y events',
      'flankVulnerability — needs x/y events'
    );
    P.goalChainsBasic = goals.map((g) => ({
      goalMinute: g.minute,
      team: g.team,
      scorer: g.player,
      assist: g.relatedPlayer,
    }));
  }

  // Pressure timeline (SportMonks add-on) — not present on StatsBomb
  if (caps.has(CAP.PRESSURE)) {
    P.pressureTimeline = {};
    for (const t of teams) {
      if (m.teamStates[t]) P.pressureTimeline[t] = m.teamStates[t].pressureTimeline;
    }
  } else {
    out.locked.push('pressureTimeline — needs pressure-index add-on');
  }

  // Substitutions
  P.subs = m.events
    .filter((e) => e.type === 'substitution' && e.period <= 4)
    .map((e) => ({ minute: e.minute, team: e.team, off: e.player, on: e.relatedPlayer }));

  if (caps.has(CAP.XG) && P.subs.length) {
    P.subImpact = subImpact(m, teams);
  }

  // Tracking metrics (SkillCorner / PFF) — locked until a tracking feed slots in
  if (caps.has(CAP.TRACKING) && m.tracking) {
    P.trackingMetrics = {
      frames: m.tracking.length,
      pitchControl: 'computed',
      offBallRuns: 'computed',
      defensiveLineHeight: 'computed',
      ppdaTracking: 'computed',
    };
  } else {
    out.locked.push(
      'pitchControl — needs tracking',
      'offBallRuns — needs tracking',
      'defensiveLineHeight — needs tracking',
      'ppdaFromTracking — needs tracking'
    );
  }

  return out;
}

// Bin each team's shots by pitch width (y): left / center / right, sum xG + count.
function flank(m, teams) {
  const shots = m.events.filter(
    (e) => (e.type === 'shot' || e.type === 'goal') && e.y != null && e.period <= 4
  );
  const res = {};
  for (const t of teams) {
    const b = {
      'left(0-27)': { xg: 0, n: 0 },
      'center(27-53)': { xg: 0, n: 0 },
      'right(53-80)': { xg: 0, n: 0 },
    };
    for (const e of shots) {
      if (e.team !== t) continue;
      const k =
        e.y < 26.7 ? 'left(0-27)' : e.y < 53.3 ? 'center(27-53)' : 'right(53-80)';
      b[k].xg = round2(b[k].xg + (e.xg || 0));
      b[k].n += 1;
    }
    res[t] = b;
  }
  return res;
}

// xG generated by each team in the 15 min before vs after the match's first sub.
function subImpact(m, teams) {
  const subs = m.events.filter((e) => e.type === 'substitution' && e.period <= 4);
  if (!subs.length) return {};
  const first = Math.min(...subs.map((s) => s.minute));
  const shots = m.events.filter(
    (e) => (e.type === 'shot' || e.type === 'goal') && e.period <= 4
  );
  const out = {};
  for (const t of teams) {
    const pre = shots
      .filter((e) => e.team === t && e.minute >= first - 15 && e.minute < first)
      .reduce((a, e) => a + (e.xg || 0), 0);
    const post = shots
      .filter((e) => e.team === t && e.minute >= first && e.minute < first + 15)
      .reduce((a, e) => a + (e.xg || 0), 0);
    out[t] = { windowMin: first, xgPre15: round2(pre), xgPost15: round2(post) };
  }
  return out;
}

module.exports = { analyze };
