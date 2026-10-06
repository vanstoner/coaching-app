/**
 * The squad views (#143), from matches played through the real engine and
 * recorded through the real ledger. The Test kit's past season is the season
 * the approved prototype (#138) drew, so its figures are the design's.
 * Synthetic first names only (invariant 4).
 */

import { describe, expect, it } from 'vitest';
import { MatchEngine, type MatchState } from '../engine/MatchEngine';
import { uuid, type KeeperPreference, type Player, type UUID } from '../types/index';
import { emptyLedger, recordMatches, type Ledger } from './ledger';
import { teamSheetFor } from './lineup';
import { currentQuarter } from './matchClock';
import { mergeCurrentMatch } from './persistence';
import { makeSevenASideFormat } from './placeholderSquad';
import { makePlayer } from './squad';
import { addTestSeason } from './testSeason';
import { goalOutfieldLine } from './childSeason';
import {
  AFTER_FIRST_MATCH,
  LENS_TITLE,
  OWED_MIN,
  VIEW_TITLE,
  axisLabels,
  childMatches,
  lensCards,
  fairnessHeadline,
  fairnessTile,
  gridTile,
  mainKeeperWords,
  offsetWords,
  owedText,
  positionsTile,
  saturdayTile,
  squadTiles,
  squadViews,
  trendLabel,
  type SquadViews,
} from './squadViews';

const MIN = 60_000;
const QUARTER = 12.5 * MIN;

// ---------------------------------------------------------------------------
// The Test kit's season: what the prototype showed Rob
// ---------------------------------------------------------------------------

const NOW = new Date('2026-10-04T09:00:00Z'); // a Sunday: the season's last match is Sat 3 Oct

function testSeason() {
  const ledger = emptyLedger(uuid(), 'Test FC', NOW);
  const data = addTestSeason({
    players: [],
    matches: [],
    squadId: ledger.squad.id,
    squadName: 'Test FC',
    format: makeSevenASideFormat(),
    totalMinutes: 50,
    periodCount: 4,
    ledger,
    now: NOW,
  });
  return { ledger: data.ledger as Ledger, players: data.players };
}

const withKeeper = (players: Player[], name: string, keeper: KeeperPreference | null): Player[] =>
  players.map((p) => (p.firstName === name ? { ...p, keeper } : p));

const row = <T extends { name: string }>(rows: T[], name: string): T => rows.find((r) => r.name === name) as T;

describe('the approved design, from the Test kit season (#138 prototype, #143)', () => {
  const { ledger, players } = testSeason();
  const v = squadViews(ledger, players);

  it('Season grid: nine closed matches across, oldest first, with the date range on the tile (AC1, AC2)', () => {
    expect(v.matches.map((m) => m.day)).toEqual([
      '8 Aug',
      '15 Aug',
      '22 Aug',
      '29 Aug',
      '5 Sep',
      '12 Sep',
      '19 Sep',
      '26 Sep',
      '3 Oct',
    ]);
    expect(v.matches.map((m) => m.competitionShort).join('')).toBe('LLCLLFLCL');
    expect(v.matches[0].label).toBe('Sat 8 Aug · League · v Mock Albion');
    expect(gridTile(v.matches)).toBe('9 matches, 8 Aug to 3 Oct');
    expect(axisLabels(v.matches).map((l) => `${l.day} ${l.month}`.trim())).toEqual([
      '8 Aug',
      '15',
      '22',
      '29',
      '5 Sep',
      '12',
      '19',
      '26',
      '3 Oct',
    ]);
  });

  it('Season grid: whole minutes in each cell, a blank where a child was not there, time in goal within the total', () => {
    const ava = row(v.grid, 'Ava');
    expect(ava.mainKeeper).toBe(true);
    expect(ava.perGame).toBe(50);
    expect(ava.cells[0]).toEqual({
      total: 50,
      goal: 38,
      outfield: 12,
      text: 'Ava, Sat 8 Aug v Mock Albion: 50 min (38 in goal, 12 outfield)',
    });
    // Ava missed the friendly; Jo and Ben missed three each.
    expect(ava.cells.map((c) => c === null)).toEqual([false, false, false, false, false, true, false, false, false]);
    expect(row(v.grid, 'Jo').cells.filter((c) => c === null)).toHaveLength(3);
    expect(row(v.grid, 'Ben').cells.filter((c) => c === null)).toHaveLength(3);
    // Every cell: in goal plus outfield is the total shown (AC10).
    for (const r of v.grid) {
      for (const c of r.cells) if (c) expect(c.goal + c.outfield).toBe(c.total);
    }
    // A child never in goal has no split in their words.
    const ivyFirst = row(v.grid, 'Ivy').cells[0];
    expect(ivyFirst?.goal).toBe(0);
    expect(ivyFirst?.text).toMatch(/^Ivy, Sat 8 Aug v Mock Albion: \d+ min$/);
  });

  it('Fairness: "Everyone within 5 min a game of the squad average, 39", the Main keeper outside it (AC3, AC7)', () => {
    const f = v.fairness!;
    expect(f.average).toBe(39);
    expect(f.gap).toBe(5);
    expect(fairnessHeadline(f)).toBe('Everyone within 5 min a game of the squad average, 39');
    expect(fairnessTile(f)).toBe('Everyone within 5 min a game');
    expect(f.mainKeepers).toEqual(['Ava']);
    expect(row(f.rows, 'Ava')).toMatchObject({ mainKeeper: true, perGame: 50, offset: null });
    // The gap is worked out from the whole minutes shown: the widest |shown − 39|.
    const shown = f.rows.filter((r) => r.offset !== null);
    expect(shown).toHaveLength(9);
    for (const r of shown) expect(r.offset).toBe((r.perGame as number) - 39);
    expect(Math.max(...shown.map((r) => Math.abs(r.offset as number)))).toBe(5);
  });

  it('Fairness trend: the gap for the season so far, recalculated after each match; the last is the headline (ruling 25)', () => {
    expect(v.trend.map((t) => t.gap)).toEqual([15, 16, 5, 6, 7, 6, 6, 7, 5]);
    expect(v.trend[v.trend.length - 1]).toMatchObject({ average: v.fairness!.average, gap: v.fairness!.gap });
    expect(v.trend.map((t) => t.matchId)).toEqual(v.matches.map((m) => m.matchId));
  });

  it('Going into Saturday: owed 5 min or more over the season, in squad order, never the Main keeper (AC4, ruling 24)', () => {
    const named = v.owed.filter((r) => r.named).map((r) => `${r.name} ${r.owed}`);
    expect(named).toEqual(['Dee 6', 'Gus 9', 'Ivy 20', 'Jo 14']);
    expect(saturdayTile(v.owed, v.fairness)).toBe('Owed time: Dee, Gus, Ivy, Jo');
    expect(row(v.owed, 'Ava')).toMatchObject({ mainKeeper: true, owed: null, named: false });
    // Squad order, everyone listed.
    expect(v.owed.map((r) => r.name)).toEqual(players.map((p) => p.firstName));
    // (squad average − their average) × matches played, from the averages, rounded once.
    const avg = v.season.squadAverageMs as number;
    for (const r of v.owed.filter((x) => x.owed !== null)) {
      const c = row(v.season.children, r.name);
      expect(r.owed).toBe(Math.round(((avg - (c.averageMs as number)) * c.played) / MIN) || 0);
      expect(r.named).toBe((r.owed as number) >= OWED_MIN);
    }
  });

  it('Positions tried: GK, DEF, MID and FWD minutes that add up to the total, in squad order (AC5, AC10)', () => {
    expect(v.positions.map((r) => r.name)).toEqual(players.map((p) => p.firstName));
    const ava = row(v.positions, 'Ava');
    expect(ava.minutes).toEqual({ GK: 300, DEF: 100, MID: 0, ATT: 0 });
    expect(ava.text).toBe('GK 300 · DEF 100');
    expect(ava.keeper).toBe('main');
    for (const r of v.positions) {
      expect(r.minutes.GK + r.minutes.DEF + r.minutes.MID + r.minutes.ATT).toBe(r.total);
      expect(r.unplacedMs).toBe(0);
    }
    expect(positionsTile(v.matches)).toBe('Time in GK, DEF, MID, FWD');
  });

  it("the child page's in goal and outfield add up: Ava 38 + 12 of 50, Hal 16 + 28 of 44 (#142)", () => {
    const ava = row(v.season.children, 'Ava');
    expect(goalOutfieldLine(ava)).toBe('In goal 38 min a game, outfield 12');
    const hal = row(v.season.children, 'Hal');
    expect(row(v.grid, 'Hal').perGame).toBe(44);
    expect(goalOutfieldLine(hal)).toBe('In goal 16 min a game, outfield 28');
  });

  it('the four tiles above the Squad list, each with its answer before it is tapped (AC1)', () => {
    expect(squadTiles(v)).toEqual([
      { view: 'grid', title: 'Season grid', answer: '9 matches, 8 Aug to 3 Oct' },
      { view: 'fairness', title: 'Fairness', answer: 'Everyone within 5 min a game' },
      { view: 'saturday', title: 'Going into Saturday', answer: 'Owed time: Dee, Gus, Ivy, Jo' },
      { view: 'positions', title: 'Positions tried', answer: 'Time in GK, DEF, MID, FWD' },
    ]);
    expect(VIEW_TITLE.fairness).toBe('Fairness at a glance');
  });

  it('words for a tapped trend column and a dot', () => {
    expect(trendLabel(v.trend[0], v.matches[0], 0, 9)).toMatch(
      /^After Sat 8 Aug v Mock Albion \(1 of 9\): everyone within 15 min a game of \d+$/
    );
    expect(trendLabel({ ...v.trend[0], average: null, gap: null }, v.matches[0], 0, 9)).toBe(
      'After Sat 8 Aug v Mock Albion (1 of 9): no squad average yet'
    );
    expect(offsetWords(0)).toBe('level with the squad average');
    expect(offsetWords(-4)).toBe('4 below the squad average');
    expect(offsetWords(3)).toBe('3 above the squad average');
  });

  it("the child page: Playing time first and always there, then match by match, positions, preference (AC6)", () => {
    expect(lensCards(row(v.season.children, 'Ava')).map((c) => LENS_TITLE[c])).toEqual([
      'Playing time',
      'Match by match',
      'Positions tried',
      'Position preference',
    ]);
    // Before a closed match: Playing time (which says so) and the preferences.
    expect(lensCards({ played: 0 })).toEqual(['playing', 'preference']);
    expect(lensCards(undefined)).toEqual(['playing', 'preference']);
  });

  it("the child page's match by match: a column per match, a dash where not there, in goal and outfield adding up (AC6, AC10)", () => {
    const ava = childMatches(v, row(v.season.children, 'Ava').playerId);
    expect(ava).toHaveLength(9);
    expect(ava[0]).toMatchObject({ day: '8', month: 'Aug', cell: { total: 50, goal: 38, outfield: 12 } });
    expect(ava[0].label).toBe('Sat 8 Aug v Mock Albion, League: 50 min (38 in goal)');
    expect(ava[5].cell).toBeNull();
    expect(ava[5].label).toBe('Sat 12 Sep v Fixture Forest, Friendly: not there');
    for (const m of ava) if (m.cell) expect(m.cell.goal + m.cell.outfield).toBe(m.cell.total);
    const ivy = childMatches(v, row(v.season.children, 'Ivy').playerId);
    expect(ivy[0].label).toMatch(/^Sat 8 Aug v Mock Albion, League: \d+ min$/);
    // Someone not in the squad: every match a dash, nothing invented.
    expect(childMatches(v, uuid()).every((m) => m.cell === null)).toBe(true);
  });

  it('a Main keeper changed to Back-up is back in the average straight away: 40, within 10', () => {
    const back = squadViews(ledger, withKeeper(players, 'Ava', 'backup'));
    expect(back.fairness).toMatchObject({ average: 40, gap: 10, mainKeepers: [] });
    expect(row(back.owed, 'Ava').owed).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Small matches through the real engine
// ---------------------------------------------------------------------------

function squad(names = ['Ava', 'Ben', 'Cal', 'Dan', 'Eve', 'Fin', 'Gus', 'Hal', 'Ivy', 'Jo']) {
  const squadId = uuid();
  const players: Player[] = names.map((n) => ({ ...makePlayer(squadId, n), createdAt: '2026-01-01T00:00:00.000Z' }));
  return { squadId, players, format: makeSevenASideFormat() };
}
type Squad = ReturnType<typeof squad>;

/**
 * A closed 50-minute match: the first seven available start, the first in
 * goal throughout; the eighth comes on for the seventh at six minutes each
 * quarter (seventh 24 min, eighth 26). The rest sit out.
 */
function play(
  sq: Squad,
  opts: { kickoffAt?: string | null; absent?: UUID[]; onKickoff?: (state: MatchState) => void } = {}
): MatchState {
  let now = Date.parse(opts.kickoffAt ?? '2026-10-03T09:00:00Z');
  const engine = new MatchEngine({ nowFn: () => new Date(now) });
  const state = engine.createMatch(sq.squadId, sq.format.id, {
    opponent: 'Rovers',
    kickoffAt: opts.kickoffAt ?? null,
    competition: 'league',
    totalMinutes: 50,
    quarterCount: 4,
    availablePlayerIds: sq.players.map((p) => p.id),
  });
  for (const id of opts.absent ?? []) engine.setAvailability(state, id, 'absent');
  const ids = sq.players.map((p) => p.id).filter((id) => !(opts.absent ?? []).includes(id));
  for (let q = 0; q < 4; q++) {
    const quarter = currentQuarter(state)!;
    engine.startQuarter(state, quarter, teamSheetFor(ids.slice(0, 7), ids[0], sq.format), sq.format);
    if (q === 0) opts.onKickoff?.(state);
    now += 6 * MIN;
    engine.substitute(state, quarter, ids[6], ids[7]);
    now += QUARTER - 6 * MIN;
    engine.endQuarter(state, quarter);
  }
  engine.completeMatch(state);
  return state;
}

/**
 * Matches recorded only once played: no kick-off snapshot, so attendance is
 * inferred from play (ADR-015 §5) and a child never brought on missed it.
 */
function ledgerOf(sq: Squad, states: MatchState[], at = new Date(0)): Ledger {
  const records = states.map((s) => mergeCurrentMatch([], s, sq.format)[0]);
  return recordMatches(emptyLedger(sq.squadId, 'Test FC'), records, sq.players, 'Test FC', at);
}

/** Matches recorded at kick-off and at the end, as the app saves them: attendance is the snapshot. */
function recordedLedger(sq: Squad, matches: { absent?: UUID[] }[]): Ledger {
  let ledger = emptyLedger(sq.squadId, 'Test FC');
  const record = (state: MatchState) => {
    ledger = recordMatches(ledger, [mergeCurrentMatch([], state, sq.format)[0]], sq.players, 'Test FC', new Date(0));
  };
  for (const opts of matches) record(play(sq, { ...opts, onKickoff: record }));
  return ledger;
}

function expectEmpty(v: SquadViews, children: number) {
  expect(v.matches).toEqual([]);
  expect(v.grid).toHaveLength(children);
  expect(v.grid.every((r) => r.perGame === null && r.cells.length === 0)).toBe(true);
  expect(v.fairness).toBeNull();
  expect(v.trend).toEqual([]);
  expect(v.owed.every((r) => r.owed === null && !r.named)).toBe(true);
  expect(v.positions.every((r) => r.total === 0 && r.text === '' && r.played === 0)).toBe(true);
  expect(gridTile(v.matches)).toBe('No matches yet');
  expect(fairnessTile(v.fairness)).toBe(AFTER_FIRST_MATCH);
  expect(saturdayTile(v.owed, v.fairness)).toBe(AFTER_FIRST_MATCH);
  expect(positionsTile(v.matches)).toBe(AFTER_FIRST_MATCH);
}

describe('an empty season (AC8)', () => {
  it('with no ledger: every view says it waits for the first match', () => {
    expectEmpty(squadViews(null, squad().players), 10);
  });

  it('with a ledger holding no closed match: the same, and an unclosed match does not count', () => {
    const sq = squad();
    expectEmpty(squadViews(emptyLedger(sq.squadId, 'Test FC'), sq.players), 10);
    const unclosed = play(sq);
    unclosed.match.status = 'in_progress';
    expectEmpty(squadViews(ledgerOf(sq, [unclosed]), sq.players), 10);
  });

  it('with nobody in the squad', () => {
    expectEmpty(squadViews(null, []), 0);
  });
});

describe('a squad with no Main keeper: shared gloves, everyone counts (AC7, AC8, #121)', () => {
  // One match: Ava in goal 50, Ben to Fin 50, Gus 24, Hal 26; Ivy and Jo never on.
  const sq = squad();
  const v = squadViews(ledgerOf(sq, [play(sq)]), sq.players);

  it('puts everyone who played in the average and the band, and the keeper in Going into Saturday', () => {
    const f = v.fairness!;
    // (6 × 50 + 24 + 26) / 8 = 43.75 → 44; widest |shown − 44| is Gus at 24.
    expect(f.average).toBe(44);
    expect(f.gap).toBe(20);
    expect(f.mainKeepers).toEqual([]);
    expect(row(f.rows, 'Ava').offset).toBe(6);
    expect(row(v.owed, 'Ava').owed).toBe(-6);
    expect(row(v.owed, 'Gus')).toMatchObject({ owed: 20, named: true });
    expect(row(v.owed, 'Hal')).toMatchObject({ owed: 18, named: true });
    expect(owedText(-6)).toBe('Had 6 min more');
    expect(owedText(20)).toBe('Owed 20 min');
    expect(owedText(0)).toBe('Level');
  });

  it('with no kick-off snapshot, a child never brought on is inferred to have missed it: a blank, owed nothing (ADR-015 §5)', () => {
    expect(row(v.grid, 'Ivy').cells).toEqual([null]);
    expect(row(v.season.children, 'Ivy').averageMs).toBeNull();
    expect(row(v.owed, 'Ivy')).toMatchObject({ played: 0, owed: null, named: false });
  });

  it('benched all match but there is a 0, not a blank; a missed match is a blank and never owed time', () => {
    const jo = sq.players[9];
    const two = squadViews(recordedLedger(sq, [{}, { absent: [jo.id] }]), sq.players);
    expect(row(two.grid, 'Jo').cells).toEqual([expect.objectContaining({ total: 0, goal: 0, outfield: 0 }), null]);
    // Played 1 (there, benched): owed the squad average for that one match, not for two.
    const avgMs = two.season.squadAverageMs as number;
    expect(row(two.owed, 'Jo')).toMatchObject({ played: 1, owed: Math.round(avgMs / MIN), named: true });
    expect(row(two.season.children, 'Jo')).toMatchObject({ played: 1, missed: 1, averageMs: 0 });
  });
});

describe('the rules that hold in every view (AC7)', () => {
  it('keeps the squad order, never ranks, and leaves retired children out', () => {
    const sq = squad();
    const ledger = ledgerOf(sq, [play(sq)]);
    const order = ['Jo', 'Gus', 'Ava', 'Ivy', 'Cal', 'Ben', 'Hal', 'Dan', 'Fin', 'Eve'];
    const reordered = order.map((n) => sq.players.find((p) => p.firstName === n)!);
    const players = reordered.map((p) => (p.firstName === 'Cal' ? { ...p, active: false } : p));
    const v = squadViews(ledger, players);
    const expected = order.filter((n) => n !== 'Cal');
    expect(v.grid.map((r) => r.name)).toEqual(expected);
    expect(v.fairness!.rows.map((r) => r.name)).toEqual(expected);
    expect(v.owed.map((r) => r.name)).toEqual(expected);
    expect(v.positions.map((r) => r.name)).toEqual(expected);
  });

  it('is worked out fresh from the ledger each time: same ledger, same views, and the ledger untouched (AC8)', () => {
    const sq = squad();
    const ledger = ledgerOf(sq, [play(sq), play(sq, { absent: [sq.players[3].id] })]);
    const before = JSON.stringify(ledger);
    const a = squadViews(ledger, sq.players);
    const b = squadViews(ledger, sq.players);
    expect(b).toEqual(a);
    expect(JSON.stringify(ledger)).toBe(before);
  });

  it('names Main keepers in words', () => {
    expect(mainKeeperWords(['Ava'])).toBe('Ava is Main keeper');
    expect(mainKeeperWords(['Ava', 'Hal'])).toBe('Ava and Hal are Main keepers');
    expect(mainKeeperWords(['Ava', 'Hal', 'Jo'])).toBe('Ava, Hal and Jo are Main keepers');
  });

  it('with only Main keepers to count, there is no squad average: the views wait rather than divide by nobody', () => {
    const sq = squad();
    const ledger = ledgerOf(sq, [play(sq)]);
    const allMain = sq.players.map((p) => ({ ...p, keeper: 'main' as const }));
    const v = squadViews(ledger, allMain);
    expect(v.fairness).toBeNull();
    expect(v.trend.map((t) => t.gap)).toEqual([null]);
    expect(v.owed.every((r) => r.owed === null)).toBe(true);
    expect(v.grid[0].cells[0]).not.toBeNull();
  });
});

describe('which match is oldest', () => {
  it('orders closed matches by kick-off, not by when the ledger recorded them', () => {
    const sq = squad();
    const later = play(sq, { kickoffAt: '2026-09-19T09:00:00.000Z' });
    later.match.opponent = 'Later';
    const earlier = play(sq, { kickoffAt: '2026-09-12T09:00:00.000Z' });
    earlier.match.opponent = 'Earlier';
    const v = squadViews(ledgerOf(sq, [later, earlier]), sq.players);
    expect(v.matches.map((m) => m.opponent)).toEqual(['Earlier', 'Later']);
    expect(gridTile(v.matches)).toBe('2 matches, 12 Sep to 19 Sep');
  });

  it('a Play now match (no kick-off) takes its first period from the working document, else the ledger entry time', () => {
    const sq = squad();
    const playNow = play(sq);
    playNow.match.opponent = 'Play now';
    const dated = play(sq, { kickoffAt: '2026-09-12T09:00:00.000Z' });
    const ledger = ledgerOf(sq, [playNow, dated], new Date('2026-09-26T12:00:00.000Z'));
    // From the working document's first period: 3 Oct.
    const fromDoc = squadViews(ledger, sq.players, {
      kickoffs: new Map([[playNow.match.id, '2026-10-03T09:00:00.000Z']]),
    });
    expect(fromDoc.matches.map((m) => m.day)).toEqual(['12 Sep', '3 Oct']);
    // Not in this phone's list (an imported match): when the ledger first recorded it, 26 Sep.
    const fromLedger = squadViews(ledger, sq.players);
    expect(fromLedger.matches.map((m) => m.day)).toEqual(['12 Sep', '26 Sep']);
    expect(fromLedger.matches[1].label).toBe('Sat 26 Sep · League · v Play now');
  });

  it('a match with no time anywhere sits after the dated ones, in ledger order, as "Date TBC"', () => {
    const sq = squad();
    const first = play(sq);
    first.match.opponent = 'First undated';
    const dated = play(sq, { kickoffAt: '2026-09-12T09:00:00.000Z' });
    const second = play(sq);
    second.match.opponent = 'Second undated';
    const ledger = ledgerOf(sq, [first, dated, second]);
    // An entry time that does not parse (a damaged or foreign file): nothing to date them by.
    const undatable = { ...ledger, entries: ledger.entries.map((e) => ({ ...e, at: 'unknown' })) };
    const v = squadViews(undatable, sq.players);
    expect(v.matches.map((m) => m.opponent)).toEqual(['Rovers', 'First undated', 'Second undated']);
    expect(v.matches.map((m) => m.day)).toEqual(['12 Sep', 'Date TBC', 'Date TBC']);
    expect(v.matches[1].label).toBe('Date TBC · League · v First undated');
    expect(gridTile(v.matches)).toBe('3 matches');
  });

  it('one match, or dates not known: the tile still reads', () => {
    const sq = squad();
    const one = squadViews(ledgerOf(sq, [play(sq, { kickoffAt: '2026-09-12T09:00:00.000Z' })]), sq.players);
    expect(gridTile(one.matches)).toBe('1 match, 12 Sep');
    const undated = { ...one.matches[0], at: null, day: 'Date TBC', date: 'Date TBC' };
    expect(gridTile([undated, undated])).toBe('2 matches');
    expect(axisLabels([undated])).toEqual([{ day: '–', month: '' }]);
  });
});
