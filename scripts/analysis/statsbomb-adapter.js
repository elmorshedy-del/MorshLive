/**
 * statsbomb-adapter.js — StatsBomb Open Data → normalized MatchModel.
 *
 * Ported 1:1 from the proven Python `adapter_statsbomb.py`, with one change: the
 * Python read a *flattened pandas* frame (shot_statsbomb_xg, pass_end_location);
 * here we read the **nested raw JSON** exactly as StatsBomb ships it
 * (shot.statsbomb_xg, pass.end_location, type.name). Free, no key, no library —
 * the events file is just JSON on GitHub.
 *
 * Declares capabilities {xy_events, xg}: rich on-ball x/y + StatsBomb's own xG.
 * Not tracking, not live pressure — those stay locked and honest.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { CAP, makeEvent, makeTeamState, makeMatch } = require('./schema');

const OPEN_DATA_BASE =
  'https://raw.githubusercontent.com/statsbomb/open-data/master/data/events';

const TYPE = {
  Pass: 'pass',
  Carry: 'carry',
  Shot: 'shot',
  'Ball Recovery': 'recovery',
  Interception: 'interception',
  Duel: 'duel',
  'Foul Won': 'foul_won',
  'Foul Committed': 'foul',
  Substitution: 'substitution',
  Dribble: 'dribble',
  'Ball Receipt*': 'receipt',
  Pressure: 'pressure',
  Block: 'block',
};

function xy(loc) {
  return Array.isArray(loc) && loc.length >= 2
    ? [Number(loc[0]), Number(loc[1])]
    : [null, null];
}

/**
 * Fetch raw events for a match id. Uses a local cache file if present (so we
 * don't refetch a 3–4 MB file), otherwise pulls from StatsBomb open data.
 */
async function fetchEvents(matchId, cacheDir) {
  if (cacheDir) {
    const cached = path.join(cacheDir, `sb_${matchId}.json`);
    if (fs.existsSync(cached)) {
      return JSON.parse(fs.readFileSync(cached, 'utf8'));
    }
  }
  const res = await fetch(`${OPEN_DATA_BASE}/${matchId}.json`);
  if (!res.ok) throw new Error(`StatsBomb open data ${matchId}: HTTP ${res.status}`);
  const events = await res.json();
  if (cacheDir) {
    try {
      fs.writeFileSync(path.join(cacheDir, `sb_${matchId}.json`), JSON.stringify(events));
    } catch (_) {
      /* cache is best-effort */
    }
  }
  return events;
}

/**
 * Normalize raw StatsBomb events + a meta object into a MatchModel.
 * meta = { matchId, competition, home, away, score:[h,a] }
 */
function fromStatsBomb(rawEvents, meta) {
  const rows = [...rawEvents].sort((a, b) => (a.index || 0) - (b.index || 0));
  const events = [];
  const formations = {};

  for (const r of rows) {
    const typName = r.type && r.type.name;
    if (typName === 'Starting XI' && r.team && r.tactics) {
      formations[r.team.name] = r.tactics.formation || null;
      continue;
    }
    const [x, y] = xy(r.location);
    const isGoal =
      typName === 'Shot' && r.shot && r.shot.outcome && r.shot.outcome.name === 'Goal';
    const endLoc =
      typName === 'Pass'
        ? r.pass && r.pass.end_location
        : typName === 'Carry'
        ? r.carry && r.carry.end_location
        : null;
    const [ex, ey] = xy(endLoc);

    events.push(
      makeEvent({
        index: r.index || 0,
        minute: r.minute || 0,
        second: r.second || 0,
        period: r.period || 1,
        team: (r.team && r.team.name) || '',
        type: isGoal ? 'goal' : TYPE[typName] || 'other',
        subtype:
          typName === 'Shot' && r.shot && r.shot.type ? r.shot.type.name : null,
        player: (r.player && r.player.name) || null,
        x,
        y,
        endX: ex,
        endY: ey,
        length: typName === 'Pass' && r.pass ? r.pass.length ?? null : null,
        xg:
          typName === 'Shot' && r.shot && r.shot.statsbomb_xg != null
            ? Number(r.shot.statsbomb_xg)
            : null,
        outcome:
          typName === 'Shot' && r.shot && r.shot.outcome ? r.shot.outcome.name : null,
        possession: r.possession != null ? Number(r.possession) : null,
        relatedPlayer:
          typName === 'Pass' && r.pass && r.pass.recipient
            ? r.pass.recipient.name
            : typName === 'Substitution' && r.substitution && r.substitution.replacement
            ? r.substitution.replacement.name
            : null,
      })
    );
  }

  // possession_pct ≈ pass-share (StatsBomb ships no possession stat; the proven
  // pipeline used this proxy — kept, and labeled honestly in the dashboard).
  const passes = events.filter((e) => e.type === 'pass');
  const totalPasses = passes.length || 1;
  const shots = events.filter((e) => e.type === 'shot' || e.type === 'goal');

  const teamStates = {};
  for (const t of [meta.home, meta.away]) {
    const ts = shots.filter((e) => e.team === t && e.period <= 4);
    teamStates[t] = makeTeamState({
      team: t,
      possessionPct: Math.round(
        (1000 * passes.filter((p) => p.team === t).length) / totalPasses
      ) / 10,
      shots: ts.length,
      shotsOnTarget: null,
      corners: null,
      xgTotal: Math.round(ts.reduce((s, e) => s + (e.xg || 0), 0) * 100) / 100,
      formation: formations[t] || null,
    });
  }

  return makeMatch({
    source: 'statsbomb_open',
    matchId: String(meta.matchId),
    competition: meta.competition || '',
    home: meta.home,
    away: meta.away,
    score: meta.score || [null, null],
    events,
    teamStates,
    capabilities: new Set([CAP.XY_EVENTS, CAP.XG]),
  });
}

module.exports = { fetchEvents, fromStatsBomb, OPEN_DATA_BASE };
