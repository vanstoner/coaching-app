/**
 * Tests for the match plan — #72.
 *
 * The test that matters most is AC4: the match-day-4 spreadsheet, anonymised,
 * must project to the figures written on the issue. That is the sum the coach
 * did by hand, and it was 7:30 short.
 */

import { describe, it, expect } from 'vitest';
import { uuid } from '../types/index';
import type { Format, Player, UUID } from '../types/index';
import { makePlayer } from './squad';
import { makeFormat } from './shapes';
import { formatClock } from './matchClock';
import {
  addSwap,
  benchSubIndex,
  benchSubOffChoices,
  copyPeriod,
  defaultSwapTimeMs,
  emptyPlan,
  formatDelta,
  nextFreeSwapTimeMs,
  nudgeSwap,
  periodLengthMs,
  planBenchSub,
  planFor,
  planHasContent,
  projectPlan,
  liveBaseline,
  removeSwap,
  setSlot,
  swapChoices,
  updateSwap,
  type MatchPlan,
} from './matchPlan';

const MIN = 60_000;

function squad(n: number): Player[] {
  const squadId = uuid();
  return Array.from({ length: n }, (_, i) => makePlayer(squadId, `P${i + 1}`));
}

function pos(format: Format, label: string): UUID {
  const p = format.positions.find((x) => x.label === label);
  if (!p) throw new Error(`no ${label}`);
  return p.id;
}

/**
 * The match-day-4 sheet, as written on #72 AC4. The sheet's CH-R / CH-L /
 * RM / LM are this shape's RB / LB / RW / LW.
 */
function matchDay4(): { plan: MatchPlan; format: Format; players: Player[] } {
  const format = makeFormat('2-3-1');
  const players = squad(10);
  const [P1, P2, P3, P4, P5, P6, P7, P8, P9, P10] = players.map((p) => p.id);
  const at = (label: string) => pos(format, label);
  const plan: MatchPlan = {
    periods: [
      {
        slots: {
          [at('GK')]: P1,
          [at('RB')]: P2,
          [at('LB')]: P3,
          [at('CM')]: P4,
          [at('RW')]: P5,
          [at('LW')]: P6,
          [at('ST')]: P7,
        },
        subs: [
          { onId: P8, offId: P5, atMs: 7.5 * MIN },
          { onId: P9, offId: P6, atMs: 7.5 * MIN },
          { onId: P10, offId: P7, atMs: 7.5 * MIN },
        ],
      },
      {
        slots: {
          [at('GK')]: P1,
          [at('RB')]: P9,
          [at('LB')]: P7,
          [at('CM')]: P10,
          [at('RW')]: P5,
          [at('LW')]: P6,
          [at('ST')]: P8,
        },
        subs: [
          { onId: P2, offId: P9, atMs: 12.5 * MIN },
          { onId: P3, offId: P8, atMs: 12.5 * MIN },
          { onId: P4, offId: P10, atMs: 12.5 * MIN },
        ],
      },
    ],
  };
  return { plan, format, players };
}

describe('AC4 — the match-day-4 worked example', () => {
  const { plan, format, players } = matchDay4();
  const projection = projectPlan(plan, format, 50, 2, players);
  const row = (name: string) => projection.rows.find((r) => r.firstName === name)!;

  it('projects every player to the figures on the issue', () => {
    expect(row('P1').outfieldMs).toBe(0);
    expect(row('P1').goalkeeperMs).toBe(50 * MIN);
    for (const p of ['P2', 'P3', 'P4']) expect(row(p).outfieldMs).toBe(37.5 * MIN);
    for (const p of ['P5', 'P6', 'P7']) expect(row(p).outfieldMs).toBe(32.5 * MIN);
    for (const p of ['P8', 'P9', 'P10']) expect(row(p).outfieldMs).toBe(30 * MIN);
  });

  // #101 / ADR-015 replaced the outfield-only figures written on #72 AC4
  // (300:00 outfield, fair share 33:20 over nine, spread 7:30, keeper left
  // out). Fairness is now total pitch time over the whole squad: 300:00
  // outfield + 50:00 in goal = 350:00, ÷ 10 = 35:00; spread 50:00 − 30:00.
  it('totals 350:00 on the pitch, a fair share of 35:00 and a spread of 20:00', () => {
    expect(projection.totalPitchMs).toBe(350 * MIN);
    expect(projection.fairShareMs).toBe(35 * MIN);
    expect(projection.spreadMs).toBe(20 * MIN);
  });

  it('finds nothing wrong with it', () => {
    expect(projection.problems).toEqual([]);
  });

  // #101 / ADR-015: this replaces "leaves the full-match keeper out of the
  // fair share". Under the outfield-only rule a keeper with only GK time had
  // no delta; now their 50:00 in goal is time played, and it reads as ahead.
  it('puts the full-match keeper in the fair share, on their time in goal', () => {
    expect(row('P1').pitchMs).toBe(50 * MIN);
    expect(formatDelta(row('P1').deltaMs)).toBe('+15:00');
    expect(projection.rows[projection.rows.length - 1].firstName).toBe('P1');
  });

  it('lists the most owed first', () => {
    expect(projection.rows.slice(0, 3).map((r) => r.firstName)).toEqual(['P8', 'P9', 'P10']);
    expect(formatDelta(row('P8').deltaMs)).toBe('-05:00');
    expect(formatDelta(row('P2').deltaMs)).toBe('+02:30');
  });

  it('catches the slip the hand sum made: subs at 7:30 on a 15:00 bench', () => {
    // The sheet said the subs played 15:00 after coming on at 7:30 of a 25:00
    // half. The plan cannot say both: the subs play what is left — 17:30.
    const half1 = projectPlan(
      { periods: [plan.periods[0], { slots: {}, subs: [] }] },
      format,
      50,
      2,
      players
    );
    expect(half1.rows.find((r) => r.firstName === 'P8')!.outfieldMs).toBe(17.5 * MIN);
  });
});

// #101 / ADR-015: keeping is still shown apart from outfield, but both count
// towards the fairness figure.
describe('invariant 3 — keeping is pitch time, shown apart from outfield', () => {
  it('a keeper for one half is credited both halves, split by kind', () => {
    const format = makeFormat('2-3-1');
    const players = squad(7);
    const ids = players.map((p) => p.id);
    const labels = ['GK', 'LB', 'RB', 'CM', 'LW', 'RW', 'ST'];
    let plan = emptyPlan(2);
    labels.forEach((l, i) => (plan = setSlot(plan, 0, pos(format, l), ids[i])));
    // Second half: P1 and P2 swap places.
    labels.forEach((l, i) => (plan = setSlot(plan, 1, pos(format, l), ids[i])));
    plan = setSlot(plan, 1, pos(format, 'GK'), ids[1]);
    plan = setSlot(plan, 1, pos(format, 'LB'), ids[0]);
    const p = projectPlan(plan, format, 50, 2, players);
    const p1 = p.rows.find((r) => r.playerId === ids[0])!;
    expect(p1.goalkeeperMs).toBe(25 * MIN);
    expect(p1.outfieldMs).toBe(25 * MIN);
    expect(p1.pitchMs).toBe(50 * MIN);
    // Seven players, all on for all 50:00: everyone is exactly fair.
    expect(p.fairShareMs).toBe(50 * MIN);
    expect(p1.deltaMs).toBe(0);
    expect(p.spreadMs).toBe(0);
  });
});

describe('AC5 — a plan that does not add up is flagged, not blocked', () => {
  const format = makeFormat('2-3-1');
  const players = squad(9);
  const ids = players.map((p) => p.id);
  const full = (): MatchPlan => {
    let plan = emptyPlan(4);
    const labels = ['GK', 'LB', 'RB', 'CM', 'LW', 'RW', 'ST'];
    for (let q = 0; q < 4; q++) {
      labels.forEach((l, i) => (plan = setSlot(plan, q, pos(format, l), ids[i])));
    }
    return plan;
  };
  const problems = (plan: MatchPlan) => projectPlan(plan, format, 50, 4, players).problems;

  it('names an empty position, in the period it is in', () => {
    const plan = setSlot(full(), 2, pos(format, 'ST'), null);
    expect(problems(plan)).toEqual([{ periodIndex: 2, message: 'ST has nobody in it.' }]);
  });

  it('names a player in two positions in a stored plan', () => {
    const plan = full();
    plan.periods[0].slots[pos(format, 'ST')] = ids[1];
    expect(problems(plan)).toContainEqual({ periodIndex: 0, message: 'P2 is in two positions.' });
  });

  it('names a sub bringing on someone already on', () => {
    const plan = updateSwap(addSwap(full(), 0, 12.5 * MIN), 0, 0, { onId: ids[2], offId: ids[3] });
    expect(problems(plan)).toEqual([
      { periodIndex: 0, message: 'Sub at 06:15: P3 is already on.' },
    ]);
  });

  it('names a sub taking off someone not on', () => {
    const plan = updateSwap(addSwap(full(), 1, 12.5 * MIN), 1, 0, { onId: ids[7], offId: ids[8] });
    expect(problems(plan)).toEqual([
      { periodIndex: 1, message: 'Sub at 06:15: P9 is not on at that point.' },
    ]);
  });

  it('names a sub time outside the period', () => {
    const plan = updateSwap(addSwap(full(), 3, 12.5 * MIN), 3, 0, {
      onId: ids[7],
      offId: ids[1],
      atMs: 13 * MIN,
    });
    expect(problems(plan)).toEqual([
      { periodIndex: 3, message: 'Sub at 13:00 is outside the quarter.' },
    ]);
  });

  it('names a sub with nobody picked', () => {
    const plan = addSwap(full(), 0, 12.5 * MIN);
    expect(problems(plan)).toEqual([
      { periodIndex: 0, message: 'Sub at 06:15: pick who comes on and who comes off.' },
    ]);
  });

  it('leaves an invalid sub out of the figures, as if the coach skipped it', () => {
    const plan = updateSwap(addSwap(full(), 0, 12.5 * MIN), 0, 0, { onId: ids[2], offId: ids[3] });
    const p = projectPlan(plan, format, 50, 4, players);
    expect(p.rows.find((r) => r.playerId === ids[3])!.outfieldMs).toBe(50 * MIN);
  });

  it('still projects an incomplete plan rather than refusing it', () => {
    const p = projectPlan(emptyPlan(4), format, 50, 4, players);
    expect(p.totalPitchMs).toBe(0);
    expect(p.problems).toHaveLength(28);
  });

  it('a later sub can take off the player an earlier sub brought on', () => {
    let plan = addSwap(addSwap(full(), 0, 12.5 * MIN), 0, 12.5 * MIN);
    plan = updateSwap(plan, 0, 0, { onId: ids[7], offId: ids[6], atMs: 3 * MIN });
    plan = updateSwap(plan, 0, 1, { onId: ids[8], offId: ids[7], atMs: 9 * MIN });
    const p = projectPlan(plan, format, 50, 4, players);
    expect(p.problems.filter((x) => x.periodIndex === 0)).toEqual([]);
    expect(p.rows.find((r) => r.playerId === ids[7])!.outfieldMs).toBe(6 * MIN);
    expect(p.rows.find((r) => r.playerId === ids[8])!.outfieldMs).toBe(3.5 * MIN);
  });
});

describe('editing a plan', () => {
  const format = makeFormat('2-2-2');
  const players = squad(8);
  const [a, b] = players.map((p) => p.id);

  it('moves a player rather than putting them in two places', () => {
    let plan = setSlot(emptyPlan(2), 0, pos(format, 'LB'), a);
    plan = setSlot(plan, 0, pos(format, 'RF'), a);
    expect(plan.periods[0].slots[pos(format, 'LB')]).toBeNull();
    expect(plan.periods[0].slots[pos(format, 'RF')]).toBe(a);
  });

  it('only touches the period being edited', () => {
    const plan = setSlot(emptyPlan(2), 1, pos(format, 'LB'), b);
    expect(plan.periods[0].slots).toEqual({});
  });

  it('adds a sub at the midpoint on a 15-second step, and nudges by 15 seconds', () => {
    const periodMs = periodLengthMs(50, 4);
    expect(defaultSwapTimeMs(periodMs)).toBe(6 * MIN + 15_000);
    let plan = addSwap(emptyPlan(4), 0, periodMs);
    plan = nudgeSwap(plan, 0, 0, 1, periodMs);
    expect(plan.periods[0].subs[0].atMs).toBe(6.5 * MIN);
    plan = nudgeSwap(plan, 0, 0, -1000, periodMs);
    expect(plan.periods[0].subs[0].atMs).toBe(15_000);
    plan = nudgeSwap(plan, 0, 0, 1000, periodMs);
    expect(plan.periods[0].subs[0].atMs).toBe(12 * MIN + 15_000);
    expect(removeSwap(plan, 0, 0).periods[0].subs).toEqual([]);
  });

  it('copies a period without sharing its objects', () => {
    let plan = setSlot(emptyPlan(2), 0, pos(format, 'LB'), a);
    plan = addSwap(plan, 0, 25 * MIN);
    plan = copyPeriod(plan, 0, 1);
    expect(plan.periods[1]).toEqual(plan.periods[0]);
    plan = updateSwap(plan, 1, 0, { atMs: MIN });
    expect(plan.periods[0].subs[0].atMs).toBe(12.5 * MIN);
  });

  it('sizes a stored plan to the match', () => {
    expect(planFor(undefined, 4).periods).toHaveLength(4);
    expect(planFor(emptyPlan(4), 2).periods).toHaveLength(2);
  });

  it('knows an empty plan from a started one', () => {
    expect(planHasContent(undefined)).toBe(false);
    expect(planHasContent(emptyPlan(2))).toBe(false);
    expect(planHasContent(setSlot(emptyPlan(2), 0, pos(format, 'LB'), a))).toBe(true);
  });

  it('names a removed player rather than crashing', () => {
    const plan = setSlot(emptyPlan(2), 0, pos(format, 'LB'), uuid());
    plan.periods[0].slots[pos(format, 'RB')] = plan.periods[0].slots[pos(format, 'LB')];
    const p = projectPlan(plan, format, 50, 2, players);
    expect(p.problems).toContainEqual({
      periodIndex: 0,
      message: 'A removed player is in two positions.',
    });
  });
});

describe('re-planning during play (#88 AC3)', () => {
  it('adds the plan for periods to come onto what has actually been played', () => {
    const { plan, format, players } = matchDay4();
    const [P1, P2, , , , , , P8] = players.map((p) => p.id);
    // Half 1 has actually been played, but not as planned: P2 played 25:00.
    const baseline = liveBaseline(
      [
        { playerId: P2, outfieldMs: 25 * MIN, goalkeeperMs: 0 },
        { playerId: P1, outfieldMs: 0, goalkeeperMs: 25 * MIN },
      ],
      [],
      0
    );
    const p = projectPlan(plan, format, 50, 2, players, { fromPeriod: 1, baseline });
    const row = (id: UUID) => p.rows.find((r) => r.playerId === id)!;
    // P2 = 25:00 actual + 12:30 planned in half 2.
    expect(row(P2).outfieldMs).toBe(37.5 * MIN);
    // P8's planned half-1 minutes are history and do not count; half 2 does.
    expect(row(P8).outfieldMs).toBe(12.5 * MIN);
    expect(row(P1).goalkeeperMs).toBe(50 * MIN);
  });

  it('ignores problems in periods already played', () => {
    const { format, players } = matchDay4();
    const p = projectPlan(emptyPlan(2), format, 50, 2, players, { fromPeriod: 1, baseline: new Map() });
    expect(p.problems.every((x) => x.periodIndex === 1)).toBe(true);
  });

  it('counts the rest of the period in progress for the players on now', () => {
    const b = liveBaseline(
      [{ playerId: 'a' as UUID, outfieldMs: 5 * MIN, goalkeeperMs: 0 }],
      [
        { playerId: 'a' as UUID, positionKind: 'outfield' },
        { playerId: 'k' as UUID, positionKind: 'goalkeeper' },
      ],
      7 * MIN
    );
    expect(b.get('a' as UUID)).toEqual({ outfieldMs: 12 * MIN, goalkeeperMs: 0 });
    expect(b.get('k' as UUID)).toEqual({ outfieldMs: 0, goalkeeperMs: 7 * MIN });
  });
});

describe('who a planned sub can choose (match day 4)', () => {
  const format = makeFormat('2-3-1');
  const players = squad(9); // 7 start, P8 and P9 on the bench
  const ids = (ps: Player[]) => ps.map((p) => p.firstName).sort();
  const startingPeriod = () => {
    let plan = emptyPlan(2);
    const labels = ['GK', 'LB', 'RB', 'LW', 'CM', 'RW', 'ST'];
    labels.forEach((l, i) => (plan = setSlot(plan, 0, pos(format, l), players[i].id)));
    return plan;
  };

  it('brings on only the bench, and takes off only who is on the pitch', () => {
    const plan = addSwap(startingPeriod(), 0, 12.5 * MIN);
    const c = swapChoices(plan.periods[0], 0, players);
    expect(ids(c.on)).toEqual(['P8', 'P9']);
    expect(ids(c.off)).toEqual(['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7']);
  });

  it('offers a player subbed off earlier to come back on, and not the one who replaced them', () => {
    let plan = addSwap(startingPeriod(), 0, 12.5 * MIN);
    plan = updateSwap(plan, 0, 0, { onId: players[7].id, offId: players[6].id, atMs: 4 * MIN });
    plan = addSwap(plan, 0, 12.5 * MIN);
    plan = updateSwap(plan, 0, 1, { atMs: 8 * MIN });
    const c = swapChoices(plan.periods[0], 1, players);
    expect(ids(c.on)).toEqual(['P7', 'P9']); // P7 came off at 4:00
    expect(ids(c.off)).toContain('P8'); // P8 came on at 4:00
    expect(ids(c.off)).not.toContain('P7');
  });

  it('ignores swaps later in the period, and keeps this swap\'s own picks on offer', () => {
    let plan = addSwap(startingPeriod(), 0, 12.5 * MIN);
    plan = updateSwap(plan, 0, 0, { onId: players[7].id, offId: players[6].id, atMs: 10 * MIN });
    plan = addSwap(plan, 0, 12.5 * MIN);
    plan = updateSwap(plan, 0, 1, { onId: players[8].id, offId: players[5].id, atMs: 4 * MIN });
    // The 4:00 swap is first in time, so the 10:00 one does not apply to it.
    const first = swapChoices(plan.periods[0], 1, players);
    expect(ids(first.on)).toEqual(['P8', 'P9']);
    expect(ids(first.off)).toContain('P6');
    // The 10:00 swap sees the 4:00 one; its own picks (P8 on, P7 off) remain.
    const second = swapChoices(plan.periods[0], 0, players);
    expect(ids(second.on)).toEqual(['P6', 'P8']);
    expect(ids(second.off)).toContain('P7');
    expect(ids(second.off)).toContain('P9');
  });
});

describe('tap a bench player to plan their sub (#120)', () => {
  const format = makeFormat('2-3-1');
  const players = squad(9); // 7 start, P8 and P9 on the bench
  const [P1, , , , , P6, P7, P8, P9] = players.map((p) => p.id);
  const QUARTER = 12.5 * MIN;
  const names = (ps: Player[]) => ps.map((p) => p.firstName).sort();
  const startingPeriod = () => {
    let plan = emptyPlan(4);
    const labels = ['GK', 'LB', 'RB', 'LW', 'CM', 'RW', 'ST'];
    labels.forEach((l, i) => (plan = setSlot(plan, 0, pos(format, l), players[i].id)));
    return plan;
  };

  it('AC2: defaults to the midpoint when no sub has it', () => {
    const t = nextFreeSwapTimeMs(startingPeriod().periods[0], QUARTER);
    expect(t).toBe(defaultSwapTimeMs(QUARTER));
    expect(formatClock(t)).toBe('06:15');
  });

  it('AC2: skips a time already taken this period, to the next 15-second step', () => {
    let plan = planBenchSub(startingPeriod(), 0, P8, P7, 6.25 * MIN, QUARTER);
    expect(nextFreeSwapTimeMs(plan.periods[0], QUARTER)).toBe(6.5 * MIN);
    plan = planBenchSub(plan, 0, P9, P6, 6.5 * MIN, QUARTER);
    expect(nextFreeSwapTimeMs(plan.periods[0], QUARTER)).toBe(6.75 * MIN);
    // A sub being changed does not block its own time.
    expect(nextFreeSwapTimeMs(plan.periods[0], QUARTER, 0)).toBe(6.25 * MIN);
  });

  it('AC2: steps back before the midpoint once every later step is taken', () => {
    const periodMs = MIN; // midpoint 00:30; the only later step is 00:45
    const period = {
      slots: {},
      subs: [30_000, 45_000].map((atMs) => ({ onId: null, offId: null, atMs })),
    };
    expect(nextFreeSwapTimeMs(period, periodMs)).toBe(15_000);
  });

  it('AC3: offers only players on the pitch at that moment to come off', () => {
    const plan = planBenchSub(startingPeriod(), 0, P8, P7, 4 * MIN, QUARTER);
    // Before 4:00, P7 is still on; after it, P8 is on and P7 is not.
    expect(names(benchSubOffChoices(plan.periods[0], P9, 3 * MIN, players))).toEqual([
      'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7',
    ]);
    const later = names(benchSubOffChoices(plan.periods[0], P9, 8 * MIN, players));
    expect(later).toContain('P8');
    expect(later).not.toContain('P7');
    expect(later).not.toContain('P9');
  });

  it('AC3: offers nobody when the period has no lineup yet', () => {
    expect(benchSubOffChoices(emptyPlan(4).periods[0], P8, 6.25 * MIN, players)).toEqual([]);
  });

  it('AC6: a menu-created sub equals the Add-a-sub equivalent', () => {
    const base = planBenchSub(startingPeriod(), 0, P9, P6, 3 * MIN, QUARTER); // one sub already
    const fromMenu = planBenchSub(base, 0, P8, P7, 6.5 * MIN, QUARTER);
    let byHand = addSwap(base, 0, QUARTER);
    byHand = nudgeSwap(byHand, 0, 1, 1, QUARTER); // 06:15 -> 06:30
    byHand = updateSwap(byHand, 0, 1, { onId: P8 });
    byHand = updateSwap(byHand, 0, 1, { offId: P7 });
    expect(fromMenu).toEqual(byHand);
    const projected = (plan: MatchPlan) => projectPlan(plan, format, 50, 4, players);
    expect(projected(fromMenu)).toEqual(projected(byHand));
  });

  it('AC4/AC6: a player with a sub already is changed in place, never duplicated', () => {
    let plan = planBenchSub(startingPeriod(), 0, P8, P7, 6.25 * MIN, QUARTER);
    plan = planBenchSub(plan, 0, P8, P1, 9 * MIN, QUARTER);
    expect(plan.periods[0].subs).toEqual([{ onId: P8, offId: P1, atMs: 9 * MIN }]);
    expect(benchSubIndex(plan.periods[0], P8)).toBe(0);
    expect(benchSubIndex(plan.periods[0], P9)).toBe(-1);
    // A sub begun with Add a sub is found too, so the menu shows it.
    let added = updateSwap(addSwap(startingPeriod(), 0, QUARTER), 0, 0, { onId: P9 });
    expect(benchSubIndex(added.periods[0], P9)).toBe(0);
    added = planBenchSub(added, 0, P9, P6, 7 * MIN, QUARTER);
    expect(added.periods[0].subs).toEqual([{ onId: P9, offId: P6, atMs: 7 * MIN }]);
  });

  it('AC4: finds the earliest when a player is on two subs', () => {
    let plan = updateSwap(addSwap(startingPeriod(), 0, QUARTER), 0, 0, { onId: P8, atMs: 9 * MIN });
    plan = updateSwap(addSwap(plan, 0, QUARTER), 0, 1, { onId: P8, atMs: 2 * MIN });
    expect(benchSubIndex(plan.periods[0], P8)).toBe(1);
  });

  it('holds a menu time inside the period, and leaves other periods alone', () => {
    const plan = planBenchSub(startingPeriod(), 0, P8, P7, 99 * MIN, QUARTER);
    expect(plan.periods[0].subs[0].atMs).toBe(12.25 * MIN);
    expect(plan.periods.slice(1)).toEqual(startingPeriod().periods.slice(1));
    expect(planBenchSub(plan, 9, P8, P7, MIN, QUARTER)).toBe(plan);
  });
});
