/**
 * A match the coach leaves out of the figures — #187, ADR-020.
 *
 * One test per acceptance criterion on the issue. The strongest check is
 * comparison with a ledger in which the match was never played: if every
 * figure agrees with that, nothing is leaking. Synthetic first names only
 * (invariant 4).
 */

import { describe, expect, it } from 'vitest';
import { MatchEngine } from '../engine/MatchEngine';
import { uuid, type Player, type UUID } from '../types/index';
import { seasonStats, isCounted } from './analysis';
import { seasonAttendance } from './attendance';
import { gridCell, squadViews, trendLabel } from './squadViews';
import {
  emptyLedger,
  foldLedger,
  isExcluded,
  parseLedger,
  recordMatches,
  seasonRows,
  serialiseLedger,
  setMatchExcluded,
  type Ledger,
} from './ledger';
import { seasonOutfieldShares } from './outfieldTarget';
import { makeSevenASideFormat } from './placeholderSquad';
import { makePlayer } from './squad';
import { teamSheetFor } from './lineup';
import { addTestSeason } from './testSeason';

const MIN = 60_000;
const NOW = new Date('2026-10-04T09:00:00Z');
const LATER = new Date('2026-10-05T09:00:00Z');

function season() {
  const base = emptyLedger(uuid(), 'Test FC', NOW);
  const data = addTestSeason({
    players: [],
    matches: [],
    squadId: base.squad.id,
    squadName: 'Test FC',
    format: makeSevenASideFormat(),
    totalMinutes: 50,
    periodCount: 4,
    ledger: base,
    now: NOW,
  });
  return { ledger: data.ledger as Ledger, players: data.players as Player[] };
}

/** The same ledger as if the match had never been played. */
const without = (ledger: Ledger, matchId: UUID): Ledger => ({
  ...ledger,
  matches: ledger.matches.filter((m) => m.id !== matchId),
});

const mark = (ledger: Ledger, matchId: UUID, excluded = true, note = 'Ad hoc kick-about') => {
  const r = setMatchExcluded(ledger, matchId, excluded, note, LATER);
  if (!r.ok) throw new Error(r.reason);
  return r.ledger;
};

describe('AC2 retrospective: a match already played can be left out', () => {
  const { ledger, players } = season();
  const target = ledger.matches[4];
  const marked = mark(ledger, target.id);
  const reference = without(marked, target.id);

  it('the match is still in the ledger, with every interval, marked excluded', () => {
    const m = marked.matches.find((x) => x.id === target.id)!;
    expect(m.intervals).toEqual(target.intervals);
    expect(isExcluded(m)).toBe(true);
    expect(m.excluded).toEqual({ excluded: true, note: 'Ad hoc kick-about' });
  });

  it('works on an abandoned match too', () => {
    const abandoned: Ledger = {
      ...ledger,
      matches: ledger.matches.map((m) => (m.id === target.id ? { ...m, status: 'abandoned' as const } : m)),
    };
    expect(setMatchExcluded(abandoned, target.id, true, 'Called off, friendly', LATER).ok).toBe(true);
  });

  it('AC4: averages, squad average, fairness, owed time and positions agree with the match never played', () => {
    const v = squadViews(marked, players);
    const ref = squadViews(reference, players);
    expect(v.season).toEqual(ref.season);
    expect(v.fairness).toEqual(ref.fairness);
    expect(v.owed).toEqual(ref.owed);
    expect(v.positions).toEqual(ref.positions);
    expect(v.season.countedMatches).toBe(ledger.matches.length - 1);
  });

  it('AC4: season totals, games played and missed, and outfield shares agree too', () => {
    expect(seasonRows(marked)).toEqual(seasonRows(reference));
    const timeline = { players };
    expect(seasonAttendance(marked, timeline)).toEqual(seasonAttendance(reference, timeline));
    expect(seasonStats(marked, players)).toEqual(seasonStats(reference, players));
    expect(seasonOutfieldShares(marked, players)).toEqual(seasonOutfieldShares(reference, players));
  });

  it('and the totals really did change: it is not a no-op', () => {
    expect(seasonRows(marked)).not.toEqual(seasonRows(ledger));
    expect(squadViews(marked, players).season.countedMatches).toBeLessThan(
      squadViews(ledger, players).season.countedMatches
    );
  });

  it('AC4: the trend carries over the last point, and says why', () => {
    const v = squadViews(marked, players);
    const j = v.matches.findIndex((m) => m.matchId === target.id);
    expect(v.trend[j].counted).toBe(false);
    expect(v.trend[j].average).toBe(v.trend[j - 1].average);
    expect(v.trend[j].gap).toBe(v.trend[j - 1].gap);
    expect(trendLabel(v.trend[j], v.matches[j], j, v.matches.length)).toContain('not counted');
    // The counted points are exactly the reference's.
    const counted = v.trend.filter((t) => t.counted !== false).map(({ average, gap }) => ({ average, gap }));
    const ref = squadViews(reference, players).trend.map(({ average, gap }) => ({ average, gap }));
    expect(counted).toEqual(ref);
  });
});

describe('AC5 what a marked match still shows', () => {
  const { ledger, players } = season();
  const target = ledger.matches[2];
  const marked = mark(ledger, target.id);

  it('stays in the grid and match by match, listed as not counted, with its minutes', () => {
    const v = squadViews(marked, players);
    const was = squadViews(ledger, players);
    expect(v.matches).toHaveLength(was.matches.length);
    const j = v.matches.findIndex((m) => m.matchId === target.id);
    expect(v.matches[j].counted).toBe(false);
    expect(v.matches[j].label).toContain('not counted');
    expect(v.matches.filter((m) => m.counted)).toHaveLength(was.matches.length - 1);
    // Same minutes in the cell as before it was marked; only the words differ.
    const before = was.grid.flatMap((r) => r.cells[j]).filter((c) => c !== null);
    const after = v.grid.flatMap((r) => r.cells[j]).filter((c) => c !== null);
    expect(after.map((c) => c!.total)).toEqual(before.map((c) => c!.total));
    // #199: these test matches are written after the fact, so the words end "reconstructed".
    expect(after.every((c) => c!.counted === false && c!.text.includes('not counted'))).toBe(true);
  });

  it('a cell for a match that counts is exactly as it was', () => {
    const cell = gridCell('Ava', { date: 'Sat 8 Aug', opponent: 'Mock Albion' }, {
      pitchMs: 50 * MIN,
      goalMs: 0,
      unitMs: { GK: 0, DEF: 0, MID: 0, ATT: 0 },
    });
    expect(cell).toEqual({ total: 50, goal: 0, outfield: 50, text: 'Ava, Sat 8 Aug v Mock Albion: 50 min' });
  });
});

describe('AC3 noted, never destructive', () => {
  const { ledger } = season();
  const id = ledger.matches[1].id;

  it('a change needs a note', () => {
    for (const note of ['', '   ']) {
      const r = setMatchExcluded(ledger, id, true, note, LATER);
      expect(r.ok).toBe(false);
    }
  });

  it('refuses a match that is not there, and a change that changes nothing', () => {
    expect(setMatchExcluded(ledger, uuid(), true, 'why', LATER).ok).toBe(false);
    expect(setMatchExcluded(ledger, id, false, 'why', LATER).ok).toBe(false); // already counts
    const once = mark(ledger, id);
    expect(setMatchExcluded(once, id, true, 'again', LATER).ok).toBe(false);
  });

  it('the earlier state stays in the chain: marking and un-marking are two new entries', () => {
    const once = mark(ledger, id, true, 'kick-about');
    const twice = mark(once, id, false, 'it was a proper game after all');
    expect(twice.entries.length).toBe(ledger.entries.length + 2);
    const records = twice.entries.flatMap((e) => e.records).filter((r) => r.type === 'exclusion');
    expect(records.map((r) => [r.excluded, r.note])).toEqual([
      [true, 'kick-about'],
      [false, 'it was a proper game after all'],
    ]);
    // Entries before the change are byte for byte what they were.
    expect(twice.entries.slice(0, ledger.entries.length)).toEqual(ledger.entries);
  });
});

describe('AC6 un-marking restores', () => {
  it('every figure is exactly what it was before the match was ever marked', () => {
    const { ledger, players } = season();
    const id = ledger.matches[3].id;
    const back = mark(mark(ledger, id, true), id, false, 'counted after all');
    expect(isExcluded(back.matches.find((m) => m.id === id)!)).toBe(false);
    expect(squadViews(back, players)).toEqual(squadViews(ledger, players));
    expect(seasonRows(back)).toEqual(seasonRows(ledger));
    expect(seasonStats(back, players)).toEqual(seasonStats(ledger, players));
  });
});

describe('AC7 no change for existing data', () => {
  it('nothing marked: a match counts exactly when it is completed, as before', () => {
    expect(isCounted({ status: 'completed' })).toBe(true);
    expect(isCounted({ status: 'abandoned' })).toBe(false);
    expect(isCounted({ status: 'planned' })).toBe(false);
    expect(isCounted({ status: 'completed', excluded: { excluded: false, note: 'x' } })).toBe(true);
    expect(isCounted({ status: 'completed', excluded: { excluded: true, note: null } })).toBe(false);
  });

  it('a ledger with nothing marked has no exclusion records and no excluded fields', () => {
    const { ledger } = season();
    expect(ledger.entries.flatMap((e) => e.records).some((r) => r.type === 'exclusion')).toBe(false);
    expect(ledger.matches.every((m) => m.excluded === undefined)).toBe(true);
  });
});

describe('AC8 the ledger file', () => {
  const { ledger } = season();
  const id = ledger.matches[4].id;
  const marked = mark(ledger, id);

  it('marking changes no recorded interval, and the summary stays all matches', () => {
    expect(foldLedger(marked)).toEqual(foldLedger(ledger));
    const file = JSON.parse(serialiseLedger(marked));
    expect(file.summary).toEqual(JSON.parse(serialiseLedger(ledger)).summary);
  });

  it('exports, re-imports and verifies, keeping the marking and its note', () => {
    const parsed = parseLedger(serialiseLedger(marked));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.ledger.matches.find((m) => m.id === id)!.excluded).toEqual({
      excluded: true,
      note: 'Ad hoc kick-about',
    });
    // The season view of the re-read file agrees with the original.
    expect(seasonRows(parsed.ledger)).toEqual(seasonRows(marked));
  });

  it('a damaged exclusion record is refused, not guessed at', () => {
    const file = JSON.parse(serialiseLedger(marked));
    // Breaking a record breaks the hash chain first; either way, nothing is imported.
    file.entries[file.entries.length - 1].records[0].excluded = 'yes';
    expect(parseLedger(JSON.stringify(file)).ok).toBe(false);
  });
});

describe('AC1 before the match: the fixture carries the choice, the ledger takes it over', () => {
  function playedFixture(excludeFromStats: boolean) {
    let nowMs = 1_700_000_000_000;
    const engine = new MatchEngine({ nowFn: () => new Date(nowMs) });
    const format = makeSevenASideFormat();
    const squadId = uuid();
    const players: Player[] = Array.from({ length: 9 }, (_, i) => makePlayer(squadId, `P${i + 1}`));
    const state = engine.createMatch(squadId, format.id, {
      totalMinutes: 50,
      quarterCount: 2,
      availablePlayerIds: players.map((p) => p.id),
      excludeFromStats,
    });
    const ids = players.map((p) => p.id);
    const sheet = teamSheetFor(ids.slice(0, 7), ids[0], format);
    engine.startQuarter(state, state.quarters[0], sheet, format);
    nowMs += 10 * MIN;
    engine.endQuarter(state, state.quarters[0]);
    state.match.status = 'completed';
    return { state, players, squadId };
  }

  it('a match that counts is shaped exactly as before', () => {
    const { state } = playedFixture(false);
    expect('excludeFromStats' in state.match).toBe(false);
  });

  it('the ledger writes the first record when it first sees the match, with no note', () => {
    const { state, players, squadId } = playedFixture(true);
    expect(state.match.excludeFromStats).toBe(true);
    const ledger = recordMatches(emptyLedger(squadId, 'Test FC'), [state], players, 'Test FC', NOW);
    const m = ledger.matches.find((x) => x.id === state.match.id)!;
    expect(m.excluded).toEqual({ excluded: true, note: null });
    expect(isCounted(m)).toBe(false);
  });

  it('is written once: saving again adds nothing', () => {
    const { state, players, squadId } = playedFixture(true);
    const once = recordMatches(emptyLedger(squadId, 'Test FC'), [state], players, 'Test FC', NOW);
    const again = recordMatches(once, [state], players, 'Test FC', LATER);
    expect(again.entries.length).toBe(once.entries.length);
  });

  it('after that the ledger is the truth: the fixture is never read again', () => {
    const { state, players, squadId } = playedFixture(true);
    const once = recordMatches(emptyLedger(squadId, 'Test FC'), [state], players, 'Test FC', NOW);
    const counted = mark(once, state.match.id, false, 'it was a proper game');
    // The working document still says "leave out"; the next save must not undo the coach's change.
    const saved = recordMatches(counted, [state], players, 'Test FC', LATER);
    expect(isExcluded(saved.matches.find((x) => x.id === state.match.id)!)).toBe(false);
  });
});
