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
import {
  addSwap,
  copyPeriod,
  defaultSwapTimeMs,
  emptyPlan,
  formatDelta,
  nudgeSwap,
  periodLengthMs,
  planFor,
  planHasContent,
  projectPlan,
  liveBaseline,
  removeSwap,
  setSlot,
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

  it('totals 300:00, a fair share of 33:20 and a spread of 7:30', () => {
    expect(projection.totalOutfieldMs).toBe(300 * MIN);
    expect(projection.fairShareMs).toBe(33 * MIN + 20_000);
    expect(projection.spreadMs).toBe(7.5 * MIN);
  });

  it('finds nothing wrong with it', () => {
    expect(projection.problems).toEqual([]);
  });

  it('leaves the full-match keeper out of the fair share, and lists them last', () => {
    expect(row('P1').deltaMs).toBeNull();
    expect(projection.rows[projection.rows.length - 1].firstName).toBe('P1');
  });

  it('lists the most owed first', () => {
    expect(projection.rows.slice(0, 3).map((r) => r.firstName)).toEqual(['P8', 'P9', 'P10']);
    expect(formatDelta(row('P8').deltaMs!)).toBe('-03:20');
    expect(formatDelta(row('P2').deltaMs!)).toBe('+04:10');
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

describe('invariant 3 — keeping is not outfield time', () => {
  it('a keeper for one half is in the fair share and is credited only the other half', () => {
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
    expect(p1.deltaMs).not.toBeNull();
    expect(p.fairShareMs).toBeCloseTo((300 * MIN) / 7, 6);
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
    expect(p.totalOutfieldMs).toBe(0);
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
