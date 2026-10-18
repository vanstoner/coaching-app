/**
 * 5-a-side — #223 (PO, 18 Oct: "approve 223 add 40mins to match length
 * options"). Two 5-a-side shapes beside the two 7-a-side ones; everything
 * that counts players follows the match's shape; a season can mix both and
 * stays fair; the record keeps each match's shape; 40 minutes is a length.
 *
 * Matches are played through the real engine and recorded through the real
 * ledger. Made-up first names only (invariant 4).
 */

import { describe, expect, it } from 'vitest';
import { MatchEngine, type MatchState } from '../engine/MatchEngine';
import { uuid, type Format, type Player, type UUID } from '../types/index';
import { matchReport } from './analysis';
import { subList } from './clockSubs';
import { emptySquadSentence, startSteps } from './gettingStarted';
import { emptyLedger, foldLedger, parseLedger, recordMatches, serialiseLedger, type Ledger } from './ledger';
import { setupFrom } from './ledgerSetup';
import { lineupIsComplete, suggestLineup, teamSheetFor } from './lineup';
import { PERIOD_COUNT_CHOICES, TOTAL_MINUTES_CHOICES, currentQuarter, formatClock, formatSubTime } from './matchClock';
import { newMatch } from './matchLifecycle';
import { periodLengthMs, projectPlan, type MatchPlan } from './matchPlan';
import { mergeCurrentMatch } from './persistence';
import { planImage } from './planImage';
import { formatFromRecord, restoreFromRecord } from './recordRestore';
import { describeDefaults } from './settings';
import { formatForShape, makeFormat, shapeOfFormat } from './shapes';
import { makePlayer, squadReadiness } from './squad';
import { squadViews } from './squadViews';
import { NO_SUB_PLANNED, defaultSubTimeMs } from './subPlan';
import * as released from './fixtures/reader-1.2.0/ledger';

const MIN = 60_000;
const NAMES = ['Ava', 'Ben', 'Cal', 'Dee', 'Eli', 'Fay', 'Gus', 'Hal'];

function squad(names = NAMES) {
  const squadId = uuid();
  const players: Player[] = names.map((n) => ({ ...makePlayer(squadId, n), createdAt: '2026-01-01T00:00:00.000Z' }));
  return { squadId, players };
}

/**
 * A closed match where every child gets exactly the same time: a rolling
 * rotation, one child off and the longest benched on every T ÷ n. Each sits
 * out (n − onField) × T ÷ n, so each plays onField × T ÷ n, the fair share.
 * A step that lands on a period boundary is made at the restart instead.
 */
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
  expect(stepsPerPeriod * stepMs).toBe(periodMs); // the helper needs boundaries on steps

  // `on` in the order they came on: the front has been on longest.
  let on = ids.slice(0, k);
  let bench = ids.slice(k);
  const rotate = () => {
    const off = on[0];
    on = [...on.slice(1), bench[0]];
    bench = [...bench.slice(1), off];
    return off;
  };
  for (let p = 0; p < periodCount; p++) {
    if (p > 0) rotate(); // the step on the whistle, made at the restart
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

const pitchOf = (state: MatchState, id: UUID) =>
  state.appearances
    .filter((a) => a.playerId === id)
    .reduce((sum, a) => sum + ((a.endElapsedMs ?? 0) - a.startElapsedMs), 0);

// ---------------------------------------------------------------------------
// AC2: everything that counts players follows the match's shape
// ---------------------------------------------------------------------------

describe('everything that counts players follows the shape, never a fixed 7 (#223 AC2)', () => {
  it('picks five for the lineup of a 5-a-side match, and a lineup of five is complete', () => {
    const { players } = squad();
    for (const code of ['1-2-1', '2-2'] as const) {
      const format = makeFormat(code);
      const s = suggestLineup(players, [], format);
      expect(s.onPitch).toHaveLength(5);
      expect(s.bench).toHaveLength(3);
      expect(s.goalkeeper).not.toBeNull();
      expect(lineupIsComplete(s.onPitch, format)).toBe(true);
      expect(lineupIsComplete(players.slice(0, 7).map((p) => p.id), format)).toBe(false);
      const sheet = teamSheetFor(s.onPitch, s.goalkeeper, format);
      expect(sheet.size).toBe(5);
    }
  });

  it('says five is enough to field a 5-a-side team, where seven is needed for 7-a-side', () => {
    const { players } = squad(NAMES.slice(0, 5));
    expect(squadReadiness(players, makeFormat('2-2').onFieldCount)).toMatchObject({ ready: true, shortBy: 0 });
    expect(squadReadiness(players, makeFormat('2-3-1').onFieldCount)).toMatchObject({ ready: false, shortBy: 2 });
    const six = squad(NAMES.slice(0, 6)).players;
    expect(squadReadiness(six, 5).message).toBe('5 on the pitch, 1 on the bench.');
  });

  it("counts Getting started's squad step against a 5-a-side default: N of 5 added (#218)", () => {
    const five = makeFormat('1-2-1').onFieldCount;
    const steps = (activePlayers: number) =>
      startSteps({ activePlayers, onFieldCount: five, matches: [], ledgerMatches: 0 });
    expect(steps(3)[0]).toMatchObject({ detail: 'First names only · 3 of 5 added', done: false });
    expect(steps(5)[0]).toMatchObject({ detail: '5 players', done: true });
    expect(emptySquadSentence(five)).toBe("Type each child's first name and press Add. Five makes a team; anyone more is a sub.");
  });

  it("lists the clock's subs for a 5-a-side match: three on the bench, each planned or named", () => {
    const { players } = squad();
    const ids = players.map((p) => p.id);
    const periodMs = periodLengthMs(40, 4);
    const plan = [
      { playerId: ids[5], atMs: defaultSubTimeMs(periodMs), forPlayerId: ids[1], done: false },
      { playerId: ids[6], atMs: defaultSubTimeMs(periodMs), forPlayerId: null, done: false },
      { playerId: ids[7], atMs: NO_SUB_PLANNED, forPlayerId: null, done: false },
    ];
    const name = (id: UUID) => players.find((p) => p.id === id)!.firstName;
    const list = subList({
      plan,
      periodElapsedMs: 0,
      prompting: false,
      nameOf: name,
      outfieldOn: ids.slice(1, 5).map((playerId, i) => ({ playerId, currentStintMs: i })),
      onPitchIds: new Set(ids.slice(0, 5)),
      madeFor: () => null,
    });
    expect(list.notPlanned).toEqual([ids[7]]);
    expect(list.lines.map((l) => l.text)).toEqual([
      'Fay on for Ben · 5:00',
      expect.stringMatching(/^Gus on · 5:00 \(who comes off: suggested (Cal|Dee|Eli)\)$/),
    ]);
  });

  it('draws five slots on the shared plan image, and the bench is everyone else', () => {
    const { players } = squad();
    const format = makeFormat('2-2');
    const at = (label: string) => format.positions.find((p) => p.label === label)!.id;
    const id = (name: string) => players.find((p) => p.firstName === name)!.id;
    const slots = { [at('GK')]: id('Ava'), [at('LB')]: id('Ben'), [at('RB')]: id('Cal'), [at('LF')]: id('Dee'), [at('RF')]: id('Eli') };
    const plan: MatchPlan = { periods: [{ slots, subs: [{ onId: id('Fay'), offId: id('Dee'), atMs: 5 * MIN }] }, { slots, subs: [] }] };
    const match = newMatch({ squadId: players[0].squadId, format, totalMinutes: 40, periodCount: 2, players, opponent: 'Mock Town' }, () => new Date(2026, 9, 17, 10)).stored.match;
    const image = planImage({ match, squadName: 'Test FC', format, plan, players });
    expect(image.periods).toHaveLength(2);
    expect(image.periods[0].slots).toHaveLength(5);
    expect(image.periods[0].slots.map((s) => s.label)).toEqual(['LF', 'RF', 'LB', 'RB', 'GK']);
    expect(image.periods[0].subLines).toEqual(['Fay on for Dee – 5:00']);
    expect(image.periods[0].bench).toBe('Bench: Fay, Gus, Hal');
    expect(image.details).toMatch(/2 halves of 20 min$/);
  });
});

// ---------------------------------------------------------------------------
// AC3, AC6: fairness is total time against the minutes each match had
// ---------------------------------------------------------------------------

describe('a 5-a-side plan and match give correct fair shares (#223 AC3, AC6)', () => {
  it('projects a 5-a-side plan: 5 × 40 = 200 minutes on the pitch, 25:00 each over eight', () => {
    const { players } = squad();
    const format = makeFormat('1-2-1');
    const ids = players.map((p) => p.id);
    const at = (label: string) => format.positions.find((p) => p.label === label)!.id;
    // Four quarters of 10:00. Each quarter starts the five from offset o round
    // the squad, and at 5:00 the two at o and o + 1 come off for o + 5 and
    // o + 6. Offsets 0, 4, 1, 5 (then 2, 6, 3, 7 after the subs) are all
    // eight, so every child is on for five halves of a quarter: 25:00.
    const kid = (i: number) => ids[i % 8];
    const labels = ['GK', 'D', 'LM', 'RM', 'F'];
    const plan: MatchPlan = {
      periods: [0, 4, 1, 5].map((o) => ({
        slots: Object.fromEntries(labels.map((l, i) => [at(l), kid(o + i)])),
        subs: [
          { onId: kid(o + 5), offId: kid(o), atMs: 5 * MIN },
          { onId: kid(o + 6), offId: kid(o + 1), atMs: 5 * MIN },
        ],
      })),
    };
    const p = projectPlan(plan, format, 40, 4, players);
    expect(p.problems).toEqual([]);
    expect(p.totalPitchMs).toBe(200 * MIN);
    expect(formatClock(p.fairShareMs)).toBe('25:00');
    expect(p.spreadMs).toBe(0);
    for (const r of p.rows) expect(r.outfieldMs + r.goalkeeperMs).toBe(25 * MIN);
  });

  it("measures a 5-a-side match's report against the minutes it had: 200 ÷ 8 = 25:00, nobody behind", () => {
    const sq = squad();
    const format = makeFormat('2-2');
    const { engine, state } = playEvenly(sq, format, 40, 2, '2026-10-17T09:00:00Z');
    const report = matchReport(engine, state, sq.players, format);
    expect(report.formatName).toBe('5-a-side');
    expect(report.fairShareMs).toBe(25 * MIN);
    for (const r of report.players) {
      expect(r.totalMs).toBe(25 * MIN);
      expect(r.deltaMs).toBe(0);
    }
  });

  it('keeps a season mixing 5- and 7-a-side fair: same share in each match, nobody owed, gap 0', () => {
    const sq = squad();
    const seven = makeFormat('2-3-1');
    const five = makeFormat('1-2-1');
    const played = [
      { format: seven, ...playEvenly(sq, seven, 50, 4, '2026-10-03T09:00:00Z') },
      { format: five, ...playEvenly(sq, five, 40, 4, '2026-10-10T09:00:00Z') },
      { format: seven, ...playEvenly(sq, seven, 60, 2, '2026-10-17T09:00:00Z') },
    ];
    // Each match's fair share is its own: 7 × 50 ÷ 8, 5 × 40 ÷ 8, 7 × 60 ÷ 8.
    const shares = played.map(({ engine, state, format }) => matchReport(engine, state, sq.players, format).fairShareMs);
    expect(shares).toEqual([43.75 * MIN, 25 * MIN, 52.5 * MIN]);
    for (const [i, { state }] of played.entries()) {
      for (const p of sq.players) expect(pitchOf(state, p.id)).toBe(shares[i]);
    }

    let ledger: Ledger = emptyLedger(sq.squadId, 'Test FC');
    for (const { state, format } of played) {
      ledger = recordMatches(ledger, [mergeCurrentMatch([], state, format)[0]], sq.players, 'Test FC', new Date(0));
    }
    const v = squadViews(ledger, sq.players);
    expect(v.matches).toHaveLength(3);
    // (43.75 + 25 + 52.5) ÷ 3 = 40.42 a game, the same for everyone.
    expect(v.fairness?.average).toBe(40);
    expect(v.fairness?.gap).toBe(0);
    for (const r of v.owed) expect(r.owed).toBe(0);
    expect(v.owed.some((r) => r.named)).toBe(false);
    // The grid shows each match's own minutes: 44, 25, 53 (whole, as shown).
    for (const row of v.grid) expect(row.cells.map((c) => c?.total)).toEqual([44, 25, 53]);
  });

  it('shows a child given less in the 5-a-side match as behind, by that match\'s share', () => {
    const sq = squad();
    const seven = makeFormat('2-3-1');
    const five = makeFormat('2-2');
    const a = playEvenly(sq, seven, 50, 4, '2026-10-03T09:00:00Z');
    // A 5-a-side match where Hal sits out the whole of it: five of seven
    // others share 200 minutes, Hal gets none.
    let now = Date.parse('2026-10-10T09:00:00Z');
    const engine = new MatchEngine({ nowFn: () => new Date(now) });
    const ids = sq.players.map((p) => p.id);
    const state = engine.createMatch(sq.squadId, five.id, {
      opponent: 'Mock Town',
      kickoffAt: '2026-10-10T09:00:00Z',
      competition: 'league',
      totalMinutes: 40,
      quarterCount: 2,
      availablePlayerIds: ids,
    });
    // Recorded at kick-off as the app does, so Hal's attendance is the
    // snapshot (available), not inferred from play (ADR-015 §4, §5).
    let ledger: Ledger = emptyLedger(sq.squadId, 'Test FC');
    const record = (s: MatchState, f: Format) => {
      ledger = recordMatches(ledger, [mergeCurrentMatch([], s, f)[0]], sq.players, 'Test FC', new Date(0));
    };
    record(a.state, seven);
    const rotaFirst = ids.slice(0, 5);
    const rotaSecond = [ids[5], ids[6], ids[0], ids[1], ids[2]];
    for (const [i, on] of [rotaFirst, rotaSecond].entries()) {
      const q = currentQuarter(state)!;
      engine.startQuarter(state, q, teamSheetFor(on, on[0], five), five);
      if (i === 0) record(state, five);
      now += 20 * MIN;
      engine.endQuarter(state, q);
    }
    engine.completeMatch(state);
    const report = matchReport(engine, state, sq.players, five);
    expect(report.fairShareMs).toBe(25 * MIN); // 200 ÷ 8: Hal was there, so Hal is in the share
    expect(report.players.find((r) => r.name === 'Hal')!.deltaMs).toBe(-25 * MIN);

    record(state, five);
    const owed = squadViews(ledger, sq.players).owed;
    const hal = owed.find((r) => r.name === 'Hal')!;
    expect(hal.named).toBe(true);
    // Squad average (43.75 × 8 + 200) ÷ 2 ÷ 8 = 34.375; Hal's is 21.875; × 2 = 25 owed.
    expect(hal.owed).toBe(25);
  });
});

// ---------------------------------------------------------------------------
// AC4: the record keeps each match's shape, and a restore gives it back
// ---------------------------------------------------------------------------

describe('the record keeps each match 5- or 7-a-side (#223 AC4, #196, #195)', () => {
  it("writes a played 5-a-side match's structure as its shape and five on the pitch, through a file and back", () => {
    const sq = squad();
    const five = makeFormat('1-2-1');
    const { state } = playEvenly(sq, five, 40, 2, '2026-10-17T09:00:00Z');
    const ledger = recordMatches(emptyLedger(sq.squadId, 'Test FC'), [mergeCurrentMatch([], state, five)[0]], sq.players, 'Test FC', new Date(0));
    const file = parseLedger(serialiseLedger(ledger));
    if (!file.ok) throw new Error(file.reason);
    const m = file.ledger.matches.find((x) => x.id === state.match.id)!;
    expect(m.structure).toMatchObject({ shape: '1-2-1', onField: 5, periodCount: 2, periodMs: [20 * MIN, 20 * MIN] });
  });

  it('restores a 5-a-side fixture and a 5-a-side default as 5-a-side, renamed labels and all', () => {
    const sq = squad();
    const seven = makeFormat('2-3-1');
    const fiveDefault = makeFormat('2-2');
    const renamed = { ...fiveDefault, positions: fiveDefault.positions.map((p) => (p.label === 'LF' ? { ...p, label: 'Runner' } : p)) };
    const fixture = (shape: '1-2-1' | '2-3-1', days: number) =>
      newMatch(
        {
          squadId: sq.squadId,
          format: formatForShape(shape, seven),
          totalMinutes: 40,
          periodCount: 4,
          players: sq.players,
          opponent: `Sample ${shape}`,
          kickoffAt: new Date(Date.parse('2026-10-18T09:00:00Z') + days * 86_400_000).toISOString(),
        },
        () => new Date('2026-10-18T09:00:00Z')
      ).stored;
    const matches = [fixture('1-2-1', 6), fixture('2-3-1', 13)];
    const setup = setupFrom({ players: sq.players, matches, live: null, format: renamed, totalMinutes: 40, periodCount: 4, buzzWhenSubDue: true });
    const ledger = recordMatches(emptyLedger(sq.squadId, 'Test FC'), matches, sq.players, 'Test FC', new Date('2026-10-18T09:00:00Z'), setup);
    const file = parseLedger(serialiseLedger(ledger));
    if (!file.ok) throw new Error(file.reason);

    const r = restoreFromRecord(file.ledger, uuid(), seven, new Date('2026-10-18T10:00:00Z'));
    expect(r.settings?.format.onFieldCount).toBe(5);
    expect(shapeOfFormat(r.settings!.format)).toBe('2-2');
    expect(r.settings?.format.positions.map((p) => p.label)).toEqual(['GK', 'LB', 'RB', 'Runner', 'RF']);
    expect(r.settings?.totalMinutes).toBe(40);
    const byOpponent = new Map(r.fixtures.map((f) => [f.match.opponent, f]));
    expect(shapeOfFormat(byOpponent.get('Sample 1-2-1')!.format!)).toBe('1-2-1');
    expect(byOpponent.get('Sample 1-2-1')!.format!.onFieldCount).toBe(5);
    expect(shapeOfFormat(byOpponent.get('Sample 2-3-1')!.format!)).toBe('2-3-1');
  });

  it('reads both 5-a-side codes from a record, and a code it does not know as the fallback', () => {
    expect(formatFromRecord('1-2-1', []).onFieldCount).toBe(5);
    expect(formatFromRecord('2-2', ['GK', 'A', 'B', 'C', 'D']).positions.map((p) => p.label)).toEqual(['GK', 'A', 'B', 'C', 'D']);
    expect(formatFromRecord('4-4-2', []).onFieldCount).toBe(7);
  });

  it('the released 1.2.0 reader parses a record with 5-a-side matches, and gives the same minutes (ADR-021 D1)', () => {
    const sq = squad();
    const five = makeFormat('2-2');
    const { state } = playEvenly(sq, five, 40, 4, '2026-10-17T09:00:00Z');
    const ledger = recordMatches(emptyLedger(sq.squadId, 'Test FC'), [mergeCurrentMatch([], state, five)[0]], sq.players, 'Test FC', new Date(0));
    const old = released.parseLedger(serialiseLedger(ledger));
    if (!old.ok) throw new Error(old.reason);
    expect(released.foldLedger(old.ledger)).toEqual(foldLedger(ledger));
  });
});

// ---------------------------------------------------------------------------
// AC8: 40 minutes
// ---------------------------------------------------------------------------

describe('40 minutes is a match length (#223 AC8)', () => {
  it('offers 40, 50, 60, 75 and 90, in that order', () => {
    expect([...TOTAL_MINUTES_CHOICES]).toEqual([40, 50, 60, 75, 90]);
  });

  it('splits 40 into halves of 20:00 or quarters of 10:00, a default sub at 10:00 or 5:00', () => {
    expect(PERIOD_COUNT_CHOICES).toContain(2);
    expect(PERIOD_COUNT_CHOICES).toContain(4);
    expect(describeDefaults(40, 2)).toBe('2 × 20:00 halves');
    expect(describeDefaults(40, 4)).toBe('4 × 10:00 quarters');
    expect(formatSubTime(defaultSubTimeMs(periodLengthMs(40, 4)))).toBe('5:00');
    expect(formatSubTime(defaultSubTimeMs(periodLengthMs(40, 2)))).toBe('10:00');
  });
});
