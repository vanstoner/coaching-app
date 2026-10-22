/**
 * Dominating format — #223 (PO, 19 Oct: "Fairness across dominating format
 * only"; approved 22 Oct with Ada's R1–R5 and ADR-015 §6a).
 *
 * Matches are played through the real engine and recorded through the real
 * ledger. Made-up first names only (invariant 4).
 */

import { describe, expect, it } from 'vitest';
import { MatchEngine, type MatchState } from '../engine/MatchEngine';
import { uuid, type Format, type Player, type UUID } from '../types/index';
import {
  dominantSide,
  formatNote,
  matchChart,
  matchReport,
  seasonStats,
  wholeMinutes,
} from './analysis';
import { seasonSummary, squadSeason } from './childSeason';
import { emptyLedger, recordMatches, setMatchExcluded, type Ledger } from './ledger';
import { teamSheetFor } from './lineup';
import { currentQuarter } from './matchClock';
import { mergeCurrentMatch } from './persistence';
import { makeFormat } from './shapes';
import { makePlayer } from './squad';
import { squadViews, trendLabel } from './squadViews';

const MIN = 60_000;

function squad(names: string[]) {
  const squadId = uuid();
  const players: Player[] = names.map((n) => ({ ...makePlayer(squadId, n), createdAt: '2026-01-01T00:00:00.000Z' }));
  return { squadId, players };
}

/** As in `fiveASide.test.ts`: a closed match where everyone there gets exactly the fair share. */
function playEvenly(
  sq: { squadId: UUID; players: Player[] },
  format: Format,
  totalMinutes: number,
  periodCount: number,
  kickoffAt: string
): { engine: MatchEngine; state: MatchState } {
  let now = Date.parse(kickoffAt);
  const engine = new MatchEngine({ nowFn: () => new Date(now) });
  const state = engine.createMatch(sq.squadId, format.id, {
    opponent: 'Sample Rovers',
    kickoffAt,
    competition: 'league',
    totalMinutes,
    quarterCount: periodCount,
    availablePlayerIds: sq.players.map((p) => p.id),
  });
  const ids = sq.players.map((p) => p.id);
  const n = ids.length;
  const k = format.onFieldCount;
  const stepMs = (totalMinutes * MIN) / n;
  const periodMs = (totalMinutes * MIN) / periodCount;
  const stepsPerPeriod = Math.round(periodMs / stepMs);
  expect(stepsPerPeriod * stepMs).toBe(periodMs);
  let on = ids.slice(0, k);
  let bench = ids.slice(k);
  const rotate = () => {
    const off = on[0];
    on = [...on.slice(1), bench[0]];
    bench = [...bench.slice(1), off];
    return off;
  };
  for (let p = 0; p < periodCount; p++) {
    if (p > 0) rotate();
    const quarter = currentQuarter(state)!;
    engine.startQuarter(state, quarter, teamSheetFor(on, on[0], format), format);
    for (let s = 1; s < stepsPerPeriod; s++) {
      now += stepMs;
      const comingOn = bench[0];
      const off = rotate();
      engine.substitute(state, quarter, off, comingOn);
    }
    now += stepMs;
    engine.endQuarter(state, quarter);
  }
  engine.completeMatch(state);
  return { engine, state };
}

const NINE = ['Ava', 'Ben', 'Cal', 'Dee', 'Eli', 'Fay', 'Gus', 'Hal', 'Ivy'];

/** QA finding 2 on #221: 7-a-side without Ivy, then 5-a-side without Ava. */
function qaProbe() {
  const all = squad(NINE);
  const seven = makeFormat('2-3-1');
  const five = makeFormat('1-2-1');
  const subA = { squadId: all.squadId, players: all.players.filter((p) => p.firstName !== 'Ivy') };
  const subB = { squadId: all.squadId, players: all.players.filter((p) => p.firstName !== 'Ava') };
  const a = playEvenly(subA, seven, 50, 4, '2026-10-03T09:00:00Z');
  const b = playEvenly(subB, five, 40, 4, '2026-10-10T09:00:00Z');
  let ledger: Ledger = emptyLedger(all.squadId, 'Test FC');
  ledger = recordMatches(ledger, [mergeCurrentMatch([], a.state, seven)[0]], all.players, 'Test FC', new Date(0));
  ledger = recordMatches(ledger, [mergeCurrentMatch([], b.state, five)[0]], all.players, 'Test FC', new Date(0));
  return { all, ledger, a, b };
}

const EIGHT = NINE.slice(0, 8);
const T1 = '2026-10-03T09:00:00Z';
const T2 = '2026-10-10T09:00:00Z';
const T3 = '2026-10-17T09:00:00Z';

/** Plays and records each match in turn, all eight there; a null format is a match recorded without one. */
function season(plays: { format: Format; record: Format | null; minutes: number; periods: number; at: string; without?: string }[]) {
  const all = squad(NINE);
  let ledger: Ledger = emptyLedger(all.squadId, 'Test FC');
  const states: MatchState[] = [];
  const engines: MatchEngine[] = [];
  for (const p of plays) {
    const without = p.without ?? 'Ivy';
    const sub = { squadId: all.squadId, players: all.players.filter((x) => x.firstName !== without) };
    const { engine, state } = playEvenly(sub, p.format, p.minutes, p.periods, p.at);
    ledger = recordMatches(ledger, [mergeCurrentMatch([], state, p.record)[0]], all.players, 'Test FC', new Date(0));
    states.push(state);
    engines.push(engine);
  }
  return { all, ledger, states, engines };
}

const seven = makeFormat('2-3-1');
const sevenB = makeFormat('2-2-2');
const five = makeFormat('1-2-1');
const fiveB = makeFormat('2-2');

describe('QA finding 2 on #221, as a regression (#223 AC3)', () => {
  it('owes nobody time when everyone had the fair share of every match they attended', () => {
    const { all, ledger } = qaProbe();
    const v = squadViews(ledger, all.players);
    for (const r of v.owed) expect(r.owed ?? 0).toBe(0);
    expect(v.fairness?.gap).toBe(0);
  });

  it('applies the tie rule: 1–1, the latest is 5-a-side, so the 7-a-side match is left out and the screen says so', () => {
    const { all, ledger } = qaProbe();
    const v = squadViews(ledger, all.players);
    expect(v.season.formatNote).toBe('Fairness uses 5-a-side matches: 1 seven-a-side match left out');
    expect(v.matches.map((m) => [m.counted, m.offFormat])).toEqual([
      [false, 7],
      [true, null],
    ]);
  });

  it("R5: Ava played only the match left out: her minutes stay, and she reads as played, not 'No matches yet'", () => {
    const { all, ledger } = qaProbe();
    const ava = all.players.find((p) => p.firstName === 'Ava')!;
    const v = squadViews(ledger, all.players);
    const child = v.season.children.find((c) => c.playerId === ava.id)!;
    expect(child.averageMs).toBeNull();
    expect(child.played).toBe(0);
    expect(child.offFormat).toBe(1);
    expect(child.summary).toBe('Played 1 seven-a-side match, not in fairness');
    // Her minutes are still hers: in the season totals and in the grid.
    const stats = seasonStats(ledger, all.players);
    expect(stats.players.find((p) => p.playerId === ava.id)!.pitchMs).toBe(43.75 * MIN);
    const cell = v.grid.find((r) => r.playerId === ava.id)!.cells[0]!;
    expect(cell.total).toBe(44);
    expect(cell.offFormat).toBe(7);
    expect(cell.text).toContain('7-a-side, not in fairness');
    // Ivy, who played only the 5-a-side match, is level, not owed.
    const ivy = v.owed.find((r) => r.name === 'Ivy')!;
    expect(ivy.owed).toBe(0);
    expect(ivy.named).toBe(false);
  });
});

describe('dominantSide (ADR-015 §6a, R1–R3)', () => {
  const at = (iso: string) => Date.parse(iso);

  it('is null with no matches, and with none whose format is known', () => {
    expect(dominantSide([])).toBeNull();
    expect(dominantSide([{ side: null, at: at(T1) }, { side: null, at: at(T2) }])).toBeNull();
  });

  it('is the side with the most matches', () => {
    expect(dominantSide([{ side: 7, at: at(T1) }, { side: 5, at: at(T2) }, { side: 7, at: at(T3) }])).toBe(7);
    expect(dominantSide([{ side: 5, at: at(T1) }, { side: 7, at: at(T2) }, { side: 5, at: at(T3) }])).toBe(5);
  });

  it('breaks a tie by the latest match, whatever order the ledger holds them in', () => {
    expect(dominantSide([{ side: 7, at: at(T1) }, { side: 5, at: at(T2) }])).toBe(5);
    expect(dominantSide([{ side: 7, at: at(T2) }, { side: 5, at: at(T1) }])).toBe(7);
  });

  it('R3: breaks a tie past a latest match whose format is not known', () => {
    expect(dominantSide([{ side: 7, at: at(T1) }, { side: 5, at: at(T2) }, { side: null, at: at(T3) }])).toBe(5);
  });

  it('puts an undated match after the dated ones, as the season grid does', () => {
    expect(dominantSide([{ side: 5, at: NaN }, { side: 7, at: at(T3) }])).toBe(5);
  });
});

describe('the dominating format in a season (#223 AC3, ADR-015 §6a)', () => {
  it('has nothing to leave out before the first match', () => {
    const all = squad(EIGHT);
    const ledger = emptyLedger(all.squadId, 'Test FC');
    const stats = seasonStats(ledger, all.players);
    expect(stats.side).toBeNull();
    expect(stats.formatNote).toBeNull();
    const v = squadViews(ledger, all.players);
    expect(v.season.formatNote).toBeNull();
    expect(v.matches).toEqual([]);
    expect(v.fairness).toBeNull();
  });

  it('R1: a season of 2-3-1 and 2-2-2 matches is one format, 7-a-side, and nothing is left out', () => {
    const { all, ledger } = season([
      { format: seven, record: seven, minutes: 50, periods: 4, at: T1 },
      { format: sevenB, record: sevenB, minutes: 50, periods: 4, at: T2 },
      { format: seven, record: seven, minutes: 50, periods: 4, at: T3 },
    ]);
    const v = squadViews(ledger, all.players);
    expect(seasonStats(ledger, all.players).side).toBe(7);
    expect(v.season.formatNote).toBeNull();
    expect(v.matches.every((m) => m.counted && m.offFormat === null)).toBe(true);
    expect(v.season.countedMatches).toBe(3);
  });

  it('R1: 1-2-1 and 2-2 are both 5-a-side', () => {
    const { all, ledger } = season([
      { format: five, record: five, minutes: 40, periods: 4, at: T1 },
      { format: fiveB, record: fiveB, minutes: 40, periods: 4, at: T2 },
      { format: seven, record: seven, minutes: 50, periods: 4, at: T3 },
    ]);
    expect(seasonStats(ledger, all.players).side).toBe(5);
    expect(squadViews(ledger, all.players).season.formatNote).toBe(
      'Fairness uses 5-a-side matches: 1 seven-a-side match left out'
    );
  });

  it('R2: a match recorded without its format neither votes nor is left out', () => {
    const { all, ledger } = season([
      { format: seven, record: seven, minutes: 50, periods: 4, at: T1 },
      // A 7-a-side match recorded without its format, as every 1.2.0 match was.
      { format: seven, record: null, minutes: 50, periods: 4, at: T2 },
      { format: five, record: five, minutes: 40, periods: 4, at: T3 },
      { format: fiveB, record: fiveB, minutes: 40, periods: 4, at: '2026-10-24T09:00:00Z' },
    ]);
    const v = squadViews(ledger, all.players);
    // 5-a-side 2, 7-a-side 1: the unknown match did not make it 2–2.
    expect(seasonStats(ledger, all.players).side).toBe(5);
    expect(v.matches.map((m) => m.counted)).toEqual([false, true, true, true]);
    expect(v.matches[1].offFormat).toBeNull();
    expect(v.season.formatNote).toBe('Fairness uses 5-a-side matches: 1 seven-a-side match left out');
    expect(v.season.countedMatches).toBe(3);
  });

  it('R2: a season with no format recorded anywhere is exactly as before', () => {
    const { all, ledger } = season([
      { format: seven, record: null, minutes: 50, periods: 4, at: T1 },
      { format: five, record: null, minutes: 40, periods: 4, at: T2 },
    ]);
    const v = squadViews(ledger, all.players);
    expect(seasonStats(ledger, all.players).side).toBeNull();
    expect(v.season.formatNote).toBeNull();
    expect(v.matches.every((m) => m.counted)).toBe(true);
  });

  it('R3: breaks a tie by the latest match whose format is known, past a later unknown one', () => {
    const { all, ledger } = season([
      { format: seven, record: seven, minutes: 50, periods: 4, at: T1 },
      { format: five, record: five, minutes: 40, periods: 4, at: T2 },
      { format: seven, record: null, minutes: 50, periods: 4, at: T3 },
    ]);
    const v = squadViews(ledger, all.players);
    expect(seasonStats(ledger, all.players).side).toBe(5);
    expect(v.matches.map((m) => [m.counted, m.offFormat])).toEqual([
      [false, 7],
      [true, null],
      [true, null],
    ]);
  });

  it('R4: a match the coach left out (ADR-020) does not vote, so it can change which format dominates', () => {
    const s = season([
      { format: seven, record: seven, minutes: 50, periods: 4, at: T1 },
      { format: five, record: five, minutes: 40, periods: 4, at: T2 },
      { format: seven, record: seven, minutes: 50, periods: 4, at: T3 },
    ]);
    expect(seasonStats(s.ledger, s.all.players).side).toBe(7);
    const out = setMatchExcluded(s.ledger, s.states[2].match.id, true, 'Played in the rain, half a pitch', new Date(1));
    if (!out.ok) throw new Error(out.reason);
    // 1–1 now; the latest counted match is the 5-a-side one.
    expect(seasonStats(out.ledger, s.all.players).side).toBe(5);
  });

  it('keeps a match in the other format in positions tried, which is a total', () => {
    const { all, ledger, states } = season([
      { format: seven, record: seven, minutes: 50, periods: 4, at: T1 },
      { format: five, record: five, minutes: 40, periods: 4, at: T2 },
      { format: seven, record: seven, minutes: 50, periods: 4, at: T3 },
    ]);
    const v = squadViews(ledger, all.players);
    const ben = all.players.find((p) => p.firstName === 'Ben')!;
    const total = states.reduce(
      (sum, st) => sum + st.appearances.filter((a) => a.playerId === ben.id).reduce((s, a) => s + ((a.endElapsedMs ?? 0) - a.startElapsedMs), 0),
      0
    );
    expect(v.positions.find((r) => r.playerId === ben.id)!.total).toBe(wholeMinutes(total));
    // ...and in the season totals, out of every average.
    const stats = seasonStats(ledger, all.players);
    const b = stats.players.find((p) => p.playerId === ben.id)!;
    expect(b.pitchMs).toBe(total);
    expect(b.attended).toBe(2);
    expect(b.averageMs).toBe(43.75 * MIN);
  });

  it('says the trend point of a match in the other format changes nothing, and why', () => {
    const { all, ledger } = season([
      { format: seven, record: seven, minutes: 50, periods: 4, at: T1 },
      { format: five, record: five, minutes: 40, periods: 4, at: T2 },
      { format: seven, record: seven, minutes: 50, periods: 4, at: T3 },
    ]);
    const v = squadViews(ledger, all.players);
    expect(v.trend[1]).toMatchObject({ counted: false, average: v.trend[0].average, gap: v.trend[0].gap });
    expect(trendLabel(v.trend[1], v.matches[1], 1, 3)).toMatch(/: 5-a-side, not in fairness, so nothing changes$/);
  });
});

describe('the Squad list, owed time and the trend agree (#223, ADR-015 "Harder")', () => {
  it('counts the same matches in all three in a mixed season with absences', () => {
    const { all, ledger } = season([
      { format: seven, record: seven, minutes: 50, periods: 4, at: T1, without: 'Ivy' },
      { format: five, record: five, minutes: 40, periods: 4, at: T2, without: 'Ava' },
      { format: sevenB, record: sevenB, minutes: 50, periods: 4, at: T3, without: 'Hal' },
    ]);
    const v = squadViews(ledger, all.players);
    const list = squadSeason(ledger, all.players);
    expect(list.formatNote).toBe(v.season.formatNote);
    for (const c of list.children) {
      // "Played X of Y" on the Squad list counts the matches the figures use.
      const inFigures = v.matches.filter((m) => m.counted && m.minutes.has(c.playerId));
      expect(c.played).toBe(inFigures.length);
      const ms = inFigures.reduce((sum, m) => sum + m.minutes.get(c.playerId)!.pitchMs, 0);
      expect(c.averageMs).toBe(inFigures.length === 0 ? null : Math.round(ms / inFigures.length));
      const owed = v.owed.find((r) => r.playerId === c.playerId)!;
      expect(owed.played).toBe(c.played);
      expect(owed.perGame).toBe(c.averageMs === null ? null : wholeMinutes(c.averageMs));
      expect(v.grid.find((r) => r.playerId === c.playerId)!.perGame).toBe(owed.perGame);
      // Everyone had their fair share of each 7-a-side match they were at.
      expect(owed.owed ?? 0).toBe(0);
    }
    // The trend's last point is the headline.
    const last = v.trend[v.trend.length - 1];
    expect(last.average).toBe(v.fairness!.average);
    expect(last.gap).toBe(v.fairness!.gap);
    expect(v.fairness!.gap).toBe(0);
  });
});

describe("the match chart's shadow (ADR-015 §9 with §6a)", () => {
  const played = () =>
    season([
      { format: seven, record: seven, minutes: 50, periods: 4, at: T1 },
      { format: five, record: five, minutes: 40, periods: 4, at: T2 },
      { format: seven, record: seven, minutes: 50, periods: 4, at: T3 },
    ]);

  it('draws no shadow on a match in the other format, and says why', () => {
    const { all, ledger, states, engines } = played();
    const report = matchReport(engines[1], states[1], all.players, five);
    const chart = matchChart(report, ledger, all.players);
    expect(chart.rows.length).toBe(8);
    for (const r of chart.rows) {
      expect(r.shadowMs).toBeNull();
      expect(r.label).toMatch(/ · not in fairness$/);
    }
    expect(chart.formatNote).toBe(
      'A 5-a-side match. Fairness uses 7-a-side matches, so there is no average to compare it with'
    );
  });

  it('draws a 7-a-side match against the 7-a-side matches only', () => {
    const { all, ledger, states, engines } = played();
    const report = matchReport(engines[2], states[2], all.players, seven);
    const chart = matchChart(report, ledger, all.players);
    // The other 7-a-side match only: 43.75, not dragged down by the 25 of the 5-a-side one.
    for (const r of chart.rows) expect(r.shadowMs).toBe(43.75 * MIN);
    expect(chart.formatNote).toBe('Fairness uses 7-a-side matches: 1 five-a-side match left out');
  });
});

describe('the words (#223 R5, §6a)', () => {
  it('says what a child played when it was all in the other format', () => {
    expect(seasonSummary(null, 0, 0, [5])).toBe('Played 1 five-a-side match, not in fairness');
    expect(seasonSummary(null, 0, 0, [7, 7])).toBe('Played 2 seven-a-side matches, not in fairness');
    expect(seasonSummary(null, 0, 0)).toBe('No matches yet');
    expect(seasonSummary(30 * MIN, 2, 3, [5])).toBe('30 min a game · played 2 of 3');
  });

  it('counts the matches left out', () => {
    expect(formatNote(null, [])).toBeNull();
    expect(formatNote(7, [])).toBeNull();
    expect(formatNote(7, [5, 5])).toBe('Fairness uses 7-a-side matches: 2 five-a-side matches left out');
    expect(formatNote(7, [5, 9])).toBe('Fairness uses 7-a-side matches: 2 matches in other formats left out');
  });
});
