/**
 * The report and chart numbers (#104, #105, #103), asserted against matches
 * played through the real engine and recorded through the real ledger.
 * Synthetic first names only (invariant 4).
 */

import { describe, expect, it } from 'vitest';
import { MatchEngine, type MatchState } from '../engine/MatchEngine';
import { uuid, type Competition, type Player, type UUID } from '../types/index';
import { makePlayer } from './squad';
import { makeSevenASideFormat } from './placeholderSquad';
import { teamSheetFor } from './lineup';
import { currentQuarter } from './matchClock';
import { emptyLedger, recordMatches, seasonRows, type Ledger } from './ledger';
import { mergeCurrentMatch } from './persistence';
import {
  competitionBucket,
  goalOutfieldSplit,
  inSquadOrder,
  largestRemainder,
  matchChart,
  matchReport,
  minutesRowSeconds,
  seasonStats,
  wholeMinuteParts,
  wholeMinutes,
} from './analysis';

const MIN = 60_000;
const QUARTER = 12.5 * MIN;

function squad() {
  const squadId = uuid();
  const players: Player[] = ['Ava', 'Ben', 'Cal', 'Dan', 'Eve', 'Fin', 'Gus', 'Hal', 'Ivy', 'Jo'].map(
    (n) => makePlayer(squadId, n)
  );
  return { squadId, players, format: makeSevenASideFormat() };
}

interface PlayOptions {
  competition?: Competition | null;
  /** Players marked absent before kick-off. */
  absent?: UUID[];
  /** Players available but never brought on. */
  benched?: UUID[];
  /** Quarters to play; fewer than 4 leaves the match unfinished. */
  quarters?: number;
  goals?: boolean;
  /**
   * Press End match after the last period (ruling D). Default true: only a
   * closed match counts towards averages, so a played-out test match is
   * closed unless a test says otherwise.
   */
  close?: boolean;
}

/**
 * Play a 50-minute, four-quarter match through the engine. The first seven
 * available, not-benched players start with the first as keeper; one sub a
 * quarter brings on the eighth for the seventh at six minutes.
 */
function play(sq: ReturnType<typeof squad>, opts: PlayOptions = {}) {
  let now = Date.parse('2026-10-03T09:00:00Z');
  const nowFn = () => new Date(now);
  const engine = new MatchEngine({ nowFn });
  const state = engine.createMatch(sq.squadId, sq.format.id, {
    opponent: 'Rovers',
    competition: opts.competition ?? null,
    totalMinutes: 50,
    quarterCount: 4,
    availablePlayerIds: sq.players.map((p) => p.id),
  });
  for (const id of opts.absent ?? []) engine.setAvailability(state, id, 'absent');
  const ids = sq.players
    .map((p) => p.id)
    .filter((id) => !(opts.absent ?? []).includes(id) && !(opts.benched ?? []).includes(id));
  for (let q = 0; q < (opts.quarters ?? 4); q++) {
    const quarter = currentQuarter(state)!;
    engine.startQuarter(state, quarter, teamSheetFor(ids.slice(0, 7), ids[0], sq.format), sq.format);
    now += 6 * MIN;
    engine.substitute(state, quarter, ids[6], ids[7]);
    if (opts.goals && q === 1) engine.recordEvent(state, quarter, 'goal', ids[5]);
    if (opts.goals && q === 2) {
      engine.recordEvent(state, quarter, 'goal', ids[4]);
      engine.recordEvent(state, quarter, 'goal', ids[4]);
      engine.recordEvent(state, quarter, 'save', ids[0]);
      engine.recordEvent(state, quarter, 'conceded', ids[0]);
    }
    now += QUARTER - 6 * MIN;
    engine.endQuarter(state, quarter);
  }
  if ((opts.quarters ?? 4) === 4 && opts.close !== false) engine.completeMatch(state);
  return { engine, state, advance: (ms: number) => (now += ms) };
}

function ledgerOf(sq: ReturnType<typeof squad>, states: MatchState[]): Ledger {
  const records = states.map((s) => mergeCurrentMatch([], s, sq.format)[0]);
  return recordMatches(emptyLedger(sq.squadId, 'Test FC'), records, sq.players, 'Test FC', new Date(0));
}


describe('matchReport (#104)', () => {
  it('reports the score, scorers, keeper, minutes against the fair share, subs and absentees', () => {
    const sq = squad();
    const [ava, , , , eve, fin, gus, hal, ivy, jo] = sq.players;
    const { engine, state } = play(sq, { absent: [jo.id], goals: true, competition: 'cup' });
    const r = matchReport(engine, state, sq.players, sq.format);

    expect(r.score).toEqual({ us: 3, them: 1 });
    expect(r.scorers).toEqual([
      { playerId: eve.id, name: 'Eve', goals: 2 },
      { playerId: fin.id, name: 'Fin', goals: 1 },
    ]);
    expect(r.keepers).toEqual([{ playerId: ava.id, name: 'Ava', saves: 1, conceded: 1 }]);
    expect(r.saves).toBe(1);
    expect(r.conceded).toBe(1);
    expect(r.competition).toBe('cup');
    expect(r.formatName).toBe(sq.format.name);
    expect(r.totalMinutes).toBe(50);
    expect(r.periodCount).toBe(4);

    // Nine attended (Jo absent): seven on the pitch for 50 minutes, shared.
    expect(r.players).toHaveLength(9);
    const total = r.players.reduce((s, p) => s + p.totalMs, 0);
    expect(total).toBe(7 * 50 * MIN);
    expect(r.fairShareMs).toBe(Math.round((7 * 50 * MIN) / 9));
    // Ivy is available and never brought on: she is in the report, at zero.
    const ivyRow = r.players.find((p) => p.playerId === ivy.id)!;
    expect(ivyRow.totalMs).toBe(0);
    expect(ivyRow.deltaMs).toBe(-r.fairShareMs);
    // Squad order, never by minutes (PO ruling Q1, #143 AC7; it was least
    // pitch time first, which put Ivy at 0 at the top).
    expect(r.players.map((p) => p.name)).toEqual(['Ava', 'Ben', 'Cal', 'Dan', 'Eve', 'Fin', 'Gus', 'Hal', 'Ivy']);
    // Goal and outfield add up to the total; Ava kept goal all match.
    const avaRow = r.players.find((p) => p.playerId === ava.id)!;
    expect(avaRow).toMatchObject({ goalMs: 50 * MIN, outfieldMs: 0, totalMs: 50 * MIN });
    // Gus 6 minutes a quarter, Hal the rest.
    expect(r.players.find((p) => p.playerId === gus.id)!.totalMs).toBe(24 * MIN);
    expect(r.players.find((p) => p.playerId === hal.id)!.totalMs).toBe(26 * MIN);

    expect(r.subs).toHaveLength(4);
    expect(r.subs[0]).toEqual({ atMs: 6 * MIN, onId: hal.id, offId: gus.id });
    expect(r.absentees).toEqual([{ playerId: jo.id, name: 'Jo', status: 'absent' }]);
  });

  it('includes the open interval during a match, recomputed from the anchors', () => {
    const sq = squad();
    const { engine, state, advance } = play(sq, { quarters: 0 });
    const ids = sq.players.map((p) => p.id);
    const quarter = currentQuarter(state)!;
    engine.startQuarter(state, quarter, teamSheetFor(ids.slice(0, 7), ids[0], sq.format), sq.format);
    advance(5 * MIN);
    const r = matchReport(engine, state, sq.players);
    expect(r.players.find((p) => p.playerId === ids[0])!.totalMs).toBe(5 * MIN);
    advance(2 * MIN);
    // Nothing kept between calls: asked again later, it is later.
    expect(matchReport(engine, state, sq.players).players.find((p) => p.playerId === ids[0])!.totalMs).toBe(
      7 * MIN
    );
  });
});

describe('seasonStats (ADR-015, #102 AC3, #103)', () => {
  it('infers attendance for v1 matches from intervals and says how many were inferred', () => {
    const sq = squad();
    const ivy = sq.players[8];
    const jo = sq.players[9];
    const a = play(sq).state; // Ivy and Jo never on
    const b = play(sq, { benched: [sq.players[1].id] }).state; // Ben benched, Ivy plays
    const ledger = ledgerOf(sq, [a, b]);
    const s = seasonStats(ledger, sq.players);
    expect(s.countedMatches).toBe(2);
    expect(s.inferredMatches).toBe(2);
    const row = (id: UUID) => s.players.find((p) => p.playerId === id)!;
    expect(row(jo.id)).toMatchObject({ attended: 0, missed: 2, averageMs: null, pitchMs: 0 });
    // Ivy played match b only (as the sub coming on), so one attended.
    expect(row(ivy.id).attended).toBe(1);
    expect(row(ivy.id).missed).toBe(1);
    expect(row(ivy.id).averageMs).toBe(row(ivy.id).pitchMs);
    // Ava kept goal both: 50 a match, goal counts as pitch time (ADR-015 §1).
    expect(row(sq.players[0].id).averageMs).toBe(50 * MIN);
  });

  // Ruling D (#98) replaced "finished by its periods": only a match the coach
  // closed with End match counts.
  it('counts nothing towards averages until the match is closed, but keeps the minutes', () => {
    const sq = squad();
    const a = play(sq, { close: false }).state; // every period ended, End match not pressed
    expect(a.quarters.every((q) => q.status === 'ended')).toBe(true);
    expect(a.match.status).toBe('in_progress');
    const ledger = ledgerOf(sq, [a]);
    const s = seasonStats(ledger, sq.players);
    expect(s.countedMatches).toBe(0);
    expect(s.players[0].averageMs).toBeNull();
    expect(s.players[0].pitchMs).toBe(50 * MIN);
    // `completed` counts on its own.
    ledger.matches[0].status = 'completed';
    expect(seasonStats(ledger, sq.players).countedMatches).toBe(1);
    // An abandoned match never counts towards averages; its minutes still do.
    ledger.matches[0].status = 'abandoned';
    const ab = seasonStats(ledger, sq.players);
    expect(ab.countedMatches).toBe(0);
    expect(ab.players[0].pitchMs).toBe(50 * MIN);
  });

  it('a recorded attendance counts a child benched all match as attended, at zero', () => {
    const sq = squad();
    const ben = sq.players[1];
    const jo = sq.players[9];
    const a = play(sq, { benched: [ben.id], absent: [jo.id] }).state;
    const ledger = ledgerOf(sq, [a]);
    // Attendance as #100 will record it (ADR-014 §4), read optionally.
    (ledger.matches[0] as { attendance?: unknown }).attendance = [
      ...[...a.playerAvailability].map(([playerId, status]) => ({ matchId: a.match.id, playerId, status })),
    ];
    const s = seasonStats(ledger, sq.players);
    expect(s.inferredMatches).toBe(0);
    const benRow = s.players.find((p) => p.playerId === ben.id)!;
    expect(benRow).toMatchObject({ attended: 1, missed: 0, averageMs: 0 });
    expect(s.players.find((p) => p.playerId === jo.id)).toMatchObject({ attended: 0, missed: 1, averageMs: null });
  });

  it('the latest attendance revision wins', () => {
    const sq = squad();
    const a = play(sq).state;
    const ledger = ledgerOf(sq, [a]);
    const ivy = sq.players[8];
    (ledger.matches[0] as { attendance?: unknown }).attendance = [
      { playerId: ivy.id, status: 'available' },
      { playerId: ivy.id, status: 'injured', note: 'arrived hurt' },
    ];
    const s = seasonStats(ledger, sq.players);
    expect(s.players.find((p) => p.playerId === ivy.id)).toMatchObject({ attended: 0, missed: 1 });
  });

  it('splits by competition; a null competition is league; cups count in the season', () => {
    const sq = squad();
    const league = play(sq, { competition: null }).state;
    const cup = play(sq, { competition: 'cup' }).state;
    const friendly = play(sq, { competition: 'friendly' }).state;
    const states = [league, cup, friendly];
    const s = seasonStats(ledgerOf(sq, states), sq.players);
    const gus = s.players.find((p) => p.playerId === sq.players[6].id)!;
    expect(gus.attended).toBe(3);
    expect(gus.byCompetition.league).toEqual({ attended: 1, pitchMs: 24 * MIN, averageMs: 24 * MIN });
    expect(gus.byCompetition.cup.attended).toBe(1);
    expect(gus.byCompetition.friendly.attended).toBe(1);
    expect(gus.byCompetition.tournament).toEqual({ attended: 0, pitchMs: 0, averageMs: null });
    expect(gus.averageMs).toBe(24 * MIN);
    expect(competitionBucket(null)).toBe('league');
  });

  it("a competition this build doesn't know goes to Other, never a crash (QA on #103, ruling N3)", () => {
    const sq = squad();
    const a = play(sq).state;
    const ledger = ledgerOf(sq, [a]);
    // A later version's competition, carried through the ledger (#99 AC2).
    (ledger.matches[0] as { competition: string }).competition = 'futsal';
    expect(competitionBucket('futsal' as Competition)).toBe('other');
    const gus = seasonStats(ledger, sq.players).players.find((p) => p.playerId === sq.players[6].id)!;
    expect(gus.attended).toBe(1);
    expect(gus.byCompetition.league.attended).toBe(0);
    expect(gus.byCompetition.friendly.attended).toBe(0);
    expect(gus.byCompetition.other).toEqual({ attended: 1, pitchMs: 24 * MIN, averageMs: 24 * MIN });
  });
});

describe('matchChart (#105 AC1)', () => {
  it('shadows each bar with the average from the OTHER matches, furthest below usual first', () => {
    const sq = squad();
    const [ava, ben, , , , , gus, hal, ivy, jo] = sq.players;
    // Earlier: Ben benched, so everyone moves up one: Gus plays all 50, Hal
    // goes off for Ivy at six minutes each quarter (Ivy 26).
    const earlier = play(sq, { benched: [ben.id] }).state;
    // This match: everyone as normal, Jo absent.
    const { engine, state } = play(sq, { absent: [jo.id] });
    const ledger = ledgerOf(sq, [earlier, state]);
    const report = matchReport(engine, state, sq.players);
    const chart = matchChart(report, ledger, sq.players);

    const row = (id: UUID) => chart.rows.find((r) => r.playerId === id)!;
    // The shadow excludes this match (ADR-015 §9): only `earlier` counts.
    expect(row(ava.id).shadowMs).toBe(50 * MIN);
    expect(row(ava.id).thisMatchMs).toBe(50 * MIN);
    expect(row(ava.id).goalMs).toBe(50 * MIN);
    // Ben was there but benched in `earlier` -> inferred NOT attended (v1),
    // so no average yet.
    expect(row(ben.id).shadowMs).toBeNull();
    expect(row(ben.id).label).toBe(`Ben ${wholeMinutes(row(ben.id).thisMatchMs)} · no average yet`);
    // Ivy 26 before and 0 today; Gus 50 before and 24 today. Both 26 below
    // their usual: furthest below first, ties by name.
    expect(row(ivy.id).shadowMs).toBe(26 * MIN);
    expect(row(gus.id).shadowMs).toBe(50 * MIN);
    expect(chart.rows.slice(0, 2).map((r) => r.name)).toEqual(['Gus', 'Ivy']);
    expect(row(ivy.id).label).toBe('Ivy 0 · avg 26');
    // Hal came off each quarter before (24) and on today (26): above usual.
    expect(row(hal.id).shadowMs).toBe(24 * MIN);
    expect(row(hal.id).thisMatchMs).toBe(26 * MIN);
    // Players without an average come last.
    expect(chart.rows[chart.rows.length - 1].shadowMs).toBeNull();
    // Gus and Hal: the sub pattern is the same both matches.
    expect(row(gus.id).thisMatchMs).toBe(24 * MIN);
    // One axis: the match length at least.
    expect(chart.maxMs).toBe(50 * MIN);
    // Absent: named, never a zero bar.
    expect(chart.absent).toEqual(['Jo']);
    expect(chart.rows.some((r) => r.playerId === jo.id)).toBe(false);
  });

  it('works with no ledger at all: no shadows', () => {
    const sq = squad();
    const { engine, state } = play(sq);
    const chart = matchChart(matchReport(engine, state, sq.players), null, sq.players);
    expect(chart.rows.every((r) => r.shadowMs === null)).toBe(true);
    // Least played first when nobody has an average.
    expect(chart.rows[0].thisMatchMs).toBe(0);
  });
});

describe('squad order, never ranked (PO ruling Q1, #143 AC7)', () => {
  it("the match report follows the squad's own order, whatever the minutes", () => {
    const sq = squad();
    const { engine, state } = play(sq);
    // A squad order that is neither alphabetical nor by minutes.
    const order = ['Ivy', 'Ava', 'Hal', 'Jo', 'Gus', 'Ben', 'Fin', 'Cal', 'Eve', 'Dan'];
    const players = order.map((n) => sq.players.find((p) => p.firstName === n)!);
    const names = matchReport(engine, state, players).players.map((p) => p.name);
    expect(names).toEqual(order);
    const byMinutes = [...matchReport(engine, state, players).players]
      .sort((a, b) => a.totalMs - b.totalMs)
      .map((p) => p.name);
    expect(names).not.toEqual(byMinutes);
  });

  it('the Settings minutes table: seasonRows comes most outfield first; inSquadOrder puts it back in squad order', () => {
    const sq = squad();
    const ledger = ledgerOf(sq, [play(sq).state]);
    const rows = seasonRows(ledger);
    const order = ['Jo', 'Gus', 'Ava', 'Ivy', 'Hal', 'Ben', 'Cal', 'Dan', 'Eve', 'Fin'];
    const players = order.map((n) => sq.players.find((p) => p.firstName === n)!);
    const ordered = inSquadOrder(rows, players).map((r) => r.name);
    expect(ordered).toEqual(order);
    expect(rows.map((r) => r.name)).not.toEqual(order);
  });

  it('anyone not in the squad follows, in the order given; nothing is dropped', () => {
    const [a, b, c] = squad().players;
    const rows = [{ playerId: c.id }, { playerId: uuid() }, { playerId: a.id }, { playerId: b.id }];
    expect(inSquadOrder(rows, [a, b, c])).toEqual([rows[2], rows[3], rows[0], rows[1]]);
    expect(inSquadOrder([], [a])).toEqual([]);
  });
});

describe('parts that add up to the total shown beside them (#142, #143 AC10)', () => {
  it('37.6 and 12.6 beside a total of 50 read 38 and 12; rounded one by one they read 38 and 13', () => {
    expect([37.6, 12.6].map((m) => Math.round(m))).toEqual([38, 13]);
    expect(largestRemainder([37.6, 12.6], 50)).toEqual([38, 12]);
    expect(wholeMinuteParts([37.6 * MIN, 12.6 * MIN], 50.2 * MIN)).toEqual([38, 12]);
  });

  it('gives the missing units to the largest fractions, the earlier part first on a tie', () => {
    expect(largestRemainder([37.5, 12.5], 50)).toEqual([38, 12]);
    expect(largestRemainder([1.2, 1.7, 1.1], 4)).toEqual([1, 2, 1]);
    expect(largestRemainder([0.4, 0.4, 0.4], 1)).toEqual([1, 0, 0]);
    expect(largestRemainder([10, 20], 30)).toEqual([10, 20]);
  });

  it('still adds up when the total is a unit away from the parts, never below zero, never stuck', () => {
    // Floors 10 + 9 = 19 beside 18: the smallest fraction gives one back.
    expect(largestRemainder([10.1, 9.2], 18)).toEqual([9, 9]);
    expect(largestRemainder([1, 0], 0)).toEqual([0, 0]);
    expect(largestRemainder([0.2, 0.3], -1)).toEqual([0, 0]);
    expect(largestRemainder([], 5)).toEqual([]);
    // A part that is not a number counts as nothing; a total that is not a number as zero.
    expect(largestRemainder([Number.NaN, 2.6], 3)).toEqual([0, 3]);
    expect(largestRemainder([1.5], Number.NaN)).toEqual([0]);
  });

  it('over 500 made-up splits: always adds up, every part within a minute of its own value', () => {
    let seed = 42;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let n = 0; n < 500; n++) {
      const partsMs = Array.from({ length: 2 + (n % 3) }, () => Math.floor(rand() * 50 * MIN));
      const totalMs = partsMs.reduce((sum, ms) => sum + ms, 0);
      const parts = wholeMinuteParts(partsMs, totalMs);
      expect(parts.reduce((sum, m) => sum + m, 0)).toBe(wholeMinutes(totalMs));
      parts.forEach((m, i) => expect(Math.abs(m - partsMs[i] / MIN)).toBeLessThan(1));
    }
  });

  it("the match report's GK and Out add up to its Total: a keeper 10.6 in goal and 10.6 outfield reads 11 + 10 of 21", () => {
    // Through the engine: Ava keeps goal 10.6 min, swaps out to the field,
    // and is subbed off 10.6 min later. Rounded one by one: 11 + 11 beside 21.
    const sq = squad();
    const ids = sq.players.map((p) => p.id);
    let now = Date.parse('2026-10-03T09:00:00Z');
    const engine = new MatchEngine({ nowFn: () => new Date(now) });
    const state = engine.createMatch(sq.squadId, sq.format.id, {
      opponent: 'Rovers',
      totalMinutes: 50,
      quarterCount: 4,
      availablePlayerIds: ids,
    });
    const q1 = currentQuarter(state)!;
    engine.startQuarter(state, q1, teamSheetFor(ids.slice(0, 7), ids[0], sq.format), sq.format);
    now += 10.6 * MIN;
    engine.swapPositions(state, q1, ids[0], ids[1]);
    now += QUARTER - 10.6 * MIN;
    engine.endQuarter(state, q1);
    const q2 = currentQuarter(state)!;
    engine.startQuarter(state, q2, teamSheetFor(ids.slice(0, 7), ids[1], sq.format), sq.format);
    now += 8.7 * MIN; // 1.9 + 8.7 = 10.6 outfield
    engine.substitute(state, q2, ids[0], ids[7]);
    now += QUARTER - 8.7 * MIN;
    engine.endQuarter(state, q2);

    const ava = matchReport(engine, state, sq.players).players.find((p) => p.playerId === ids[0])!;
    expect(ava.goalMs).toBe(10.6 * MIN);
    expect(ava.outfieldMs).toBe(10.6 * MIN);
    expect(wholeMinutes(ava.goalMs) + wholeMinutes(ava.outfieldMs)).toBe(22);
    expect(goalOutfieldSplit(ava.goalMs, ava.outfieldMs, ava.totalMs)).toEqual({ total: 21, goal: 11, outfield: 10 });
    for (const row of matchReport(engine, state, sq.players).players) {
      const s = goalOutfieldSplit(row.goalMs, row.outfieldMs, row.totalMs);
      expect(s.goal + s.outfield).toBe(s.total);
    }
  });

  it('the Settings minutes table: Out and GK add up to Total, and DEF, MID and FWD to Out', () => {
    // 10:00.7 outfield and 5:00.6 in goal: floored one by one, 10:00 + 5:00 beside 15:01.
    const row = { outfieldMs: 600_700, goalkeeperMs: 300_600, byUnit: { DEF: 200_300, MID: 200_200, ATT: 200_200 } };
    expect(minutesRowSeconds(row)).toEqual({ outfield: 601, goal: 300, total: 901, byUnit: { DEF: 201, MID: 200, ATT: 200 } });
    // Outfield time with no unit (an early match) cannot be shared out: each unit is floored, as before.
    expect(minutesRowSeconds({ ...row, byUnit: { DEF: 300_900, MID: 0, ATT: 0 } }).byUnit).toEqual({ DEF: 300, MID: 0, ATT: 0 });
    expect(minutesRowSeconds({ outfieldMs: 0, goalkeeperMs: 0, byUnit: { DEF: 0, MID: 0, ATT: 0 } })).toEqual({
      outfield: 0,
      goal: 0,
      total: 0,
      byUnit: { DEF: 0, MID: 0, ATT: 0 },
    });
  });
});
