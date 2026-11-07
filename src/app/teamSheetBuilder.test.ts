/**
 * Build the team sheet — #277 B7–B11, ADR-024 D2–D4. Made-up names only.
 */

import { describe, expect, it } from 'vitest';
import { uuid } from '../types/index';
import type { Player, UUID } from '../types/index';
import { makePlayer } from './squad';
import { makeFormat, type ShapeCode } from './shapes';
import { periodLengthMs, projectPlan } from './matchPlan';
import { formatClock } from './matchClock';
import { buildTeamSheet, fairestSubs, rotateKeepers, seasonInputs, type SeasonInput } from './teamSheetBuilder';

const NAMES = ['Ava', 'Ben', 'Cal', 'Dan', 'Eve', 'Fin', 'Gus', 'Hal', 'Ivy', 'Jo', 'Kai', 'Lou', 'Max', 'Ned', 'Oli', 'Pip'];
const squadOf = (n: number): Player[] => {
  const squadId = uuid();
  return NAMES.slice(0, n).map((name) => makePlayer(squadId, name));
};
const none = new Map<UUID, SeasonInput>();

function build(
  shape: ShapeCode,
  n: number,
  opts: { periods?: number; minutes?: number; subs?: number; fill?: 'fair' | 'positions'; season?: Map<UUID, SeasonInput>; players?: Player[]; format?: ReturnType<typeof makeFormat> } = {}
) {
  const format = opts.format ?? makeFormat(shape);
  const players = opts.players ?? squadOf(n);
  const periods = opts.periods ?? 4;
  const minutes = opts.minutes ?? 50;
  const season = opts.season ?? none;
  const keepers = rotateKeepers(players, periods, periodLengthMs(minutes, periods), season);
  const built = buildTeamSheet({
    format,
    totalMinutes: minutes,
    periodCount: periods,
    coming: players,
    keepers,
    subs: opts.subs ?? 1,
    fill: opts.fill ?? 'fair',
    season,
  });
  return { ...built, format, players, keepers, periods };
}

const range = (m: Map<UUID, number>) => `${formatClock(Math.min(...m.values()))}–${formatClock(Math.max(...m.values()))}`;

describe('the healthy case (B11): 9 coming, 7-a-side, 4 × 12:30', () => {
  it('with subs: 7 children on 37:30 and 2 on 43:45, against a fair share of 38:53', () => {
    const r = build('2-3-1', 9);
    const values = [...r.minutes.values()].sort((a, b) => a - b);
    expect(values.filter((v) => v === 37.5 * 60_000)).toHaveLength(7);
    expect(values.filter((v) => v === 43.75 * 60_000)).toHaveLength(2);
    expect(range(r.minutes)).toBe('37:30–43:45');
    const projection = projectPlan(r.plan, r.format, 50, 4, r.players);
    expect(formatClock(projection.fairShareMs)).toBe('38:53');
    // The Plan's own walk agrees, with nothing wrong (B12).
    expect(projection.problems).toEqual([]);
    for (const row of projection.rows) expect(row.pitchMs).toBe(r.minutes.get(row.playerId));
  });

  it('with None: 37:30–50:00, the best whole quarters allow', () => {
    const r = build('2-3-1', 9, { subs: 0 });
    expect(range(r.minutes)).toBe('37:30–50:00');
    expect(r.plan.periods.every((p) => p.subs.length === 0)).toBe(true);
    expect(projectPlan(r.plan, r.format, 50, 4, r.players).problems).toEqual([]);
  });
});

/**
 * The oracle (D4): the smallest spread any plan could have, in half-periods,
 * by exhaustive search. Time does not depend on which position, so a period
 * is only who gets two halves (the keeper and the full outfield), who gets one
 * (the pair at the sub) and who gets none. Children are interchangeable, so
 * the search runs over sorted count vectors.
 */
function bestPossibleHalves(n: number, onField: number, periods: number, subs: number): number {
  // k pairs a period: the keeper is always a two, so at most onField - 1 outfielders swap.
  const k = Math.max(0, Math.min(subs, n - onField, onField - 1));
  const twos = onField - k;
  const ones = 2 * k;
  let states = new Set<string>([JSON.stringify(Array(n).fill(0))]);
  for (let p = 0; p < periods; p++) {
    const next = new Set<string>();
    for (const key of states) {
      const counts: number[] = JSON.parse(key);
      // Every way to pick the twos, then the ones from the rest.
      const pick = (from: number[], k: number, start = 0, chosen: number[] = [], out: number[][] = []) => {
        if (chosen.length === k) out.push([...chosen]);
        else for (let i = start; i < from.length; i++) pick(from, k, i + 1, [...chosen, from[i]], out);
        return out;
      };
      const all = counts.map((_, i) => i);
      for (const two of pick(all, twos)) {
        const rest = all.filter((i) => !two.includes(i));
        for (const one of pick(rest, ones)) {
          const c = [...counts];
          for (const i of two) c[i] += 2;
          for (const i of one) c[i] += 1;
          next.add(JSON.stringify(c.sort((a, b) => a - b)));
        }
      }
    }
    states = next;
  }
  let best = Infinity;
  for (const key of states) {
    const c: number[] = JSON.parse(key);
    best = Math.min(best, c[c.length - 1] - c[0]);
  }
  return best;
}

describe('no plan with a smaller spread exists (D4), checked by exhaustive search', () => {
  const cases: { shape: ShapeCode; onField: number; ns: number[] }[] = [
    { shape: '1-2-1', onField: 5, ns: [5, 6, 7, 8] },
    { shape: '2-3-1', onField: 7, ns: [7, 8, 9, 10] },
  ];
  for (const { shape, onField, ns } of cases) {
    for (const n of ns) {
      for (const periods of [2, 4]) {
        for (const subs of [0, 1, 2]) {
          if (subs === 2 && n - onField < 2) continue;
          it(`${n} coming at ${onField}-a-side, ${periods} periods, ${subs} sub${subs === 1 ? '' : 's'} a period`, () => {
            const r = build(shape, n, { periods, minutes: 48, subs });
            const halfMs = periodLengthMs(48, periods) / 2;
            const oracle = bestPossibleHalves(n, onField, periods, subs) * halfMs;
            expect(r.rangeMs).toBe(oracle);
          });
        }
      }
    }
  }
});

describe('Fill the rest (Rob, 6 Nov): the same answer every time, around what is placed', () => {
  it('Fairly gives the identical plan twice', () => {
    const players = squadOf(10);
    const format = makeFormat('2-3-1');
    const a = build('2-3-1', 10, { players, format });
    const b = build('2-3-1', 10, { players, format });
    expect(a.plan).toEqual(b.plan);
  });

  it('children already placed stay where they are, and the empty places are filled', () => {
    const players = squadOf(9);
    const format = makeFormat('2-3-1');
    const first = build('2-3-1', 9, { players, format });
    // The coach places two children in Q2 by hand, on an otherwise empty sheet.
    const [p1, p2] = format.positions.filter((x) => x.kind !== 'goalkeeper');
    const goal = format.positions.find((x) => x.kind === 'goalkeeper')!;
    const existing = { periods: first.plan.periods.map(() => ({ slots: {} as Record<UUID, UUID | null>, subs: [] })) };
    existing.periods[1].slots[p1.id] = players[7].id;
    existing.periods[1].slots[p2.id] = players[8].id;
    const filled = buildTeamSheet({
      format,
      totalMinutes: 50,
      periodCount: 4,
      coming: players,
      keepers: first.keepers,
      subs: 1,
      fill: 'fair',
      season: none,
      existing,
    });
    expect(filled.plan.periods[1].slots[p1.id]).toBe(players[7].id);
    expect(filled.plan.periods[1].slots[p2.id]).toBe(players[8].id);
    expect(filled.plan.periods.every((p) => Object.values(p.slots).every((id) => id !== null))).toBe(true);
    expect(filled.plan.periods[1].slots[goal.id]).toBe(first.keepers[1]);
    // Neither child placed by hand is taken off at the sub.
    for (const s of filled.plan.periods[1].subs) expect([players[7].id, players[8].id]).not.toContain(s.offId);
    expect(projectPlan(filled.plan, format, 50, 4, players).problems).toEqual([]);
  });

  it('a sheet already full is left exactly as it is', () => {
    const players = squadOf(9);
    const format = makeFormat('2-3-1');
    const first = build('2-3-1', 9, { players, format });
    const again = buildTeamSheet({
      format,
      totalMinutes: 50,
      periodCount: 4,
      coming: players,
      keepers: first.keepers,
      subs: 1,
      fill: 'fair',
      season: none,
      existing: first.plan,
    });
    expect(again.plan).toEqual(first.plan);
  });

  it('Using positions puts children in their preferred area where the minutes allow, with the same minutes as Fairly', () => {
    const format = makeFormat('2-3-1');
    const players = squadOf(9).map((p, i) => ({ ...p, prefers: (['DEF', 'MID', 'ATT'] as const)[i % 3] }));
    const fair = build('2-3-1', 9, { players, format });
    const pos = build('2-3-1', 9, { players, format, fill: 'positions' });
    expect([...pos.minutes.values()].sort()).toEqual([...fair.minutes.values()].sort());
    expect(pos.rangeMs).toBe(fair.rangeMs);
    const unitOf = new Map(format.positions.map((x) => [x.id, x.unit]));
    const inArea = (plan: typeof pos.plan) =>
      plan.periods.reduce(
        (n, period) =>
          n +
          (Object.entries(period.slots) as [UUID, UUID | null][]).filter(
            ([at, id]) => id && unitOf.get(at) !== 'GK' && players.find((p) => p.id === id)?.prefers === unitOf.get(at)
          ).length,
        0
      );
    expect(inArea(pos.plan)).toBeGreaterThan(inArea(fair.plan));
  });

  it('is fast: 16 children and 4 periods well under 100 ms (D4)', () => {
    const t = performance.now();
    build('4-4-2', 16);
    expect(performance.now() - t).toBeLessThan(100);
  });
});

describe('keepers (B7, D2)', () => {
  it('one per period, least time in goal this season first, nobody marked Not in goal', () => {
    const players = squadOf(9);
    players[0] = { ...players[0], keeper: 'never' };
    const season = new Map<UUID, SeasonInput>(players.map((p, i) => [p.id, { goalMs: i < 3 ? 60 * 60_000 : 0, owedMs: 0 }]));
    const keepers = rotateKeepers(players, 4, periodLengthMs(50, 4), season);
    expect(keepers).toEqual([players[3].id, players[4].id, players[5].id, players[6].id]);
  });

  it('ties go to whoever is owed most', () => {
    const players = squadOf(8);
    const season = new Map<UUID, SeasonInput>(players.map((p, i) => [p.id, { goalMs: 0, owedMs: i === 5 ? 9 * 60_000 : 0 }]));
    expect(rotateKeepers(players, 1, periodLengthMs(50, 4), season)).toEqual([players[5].id]);
  });

  it('with no Main keeper coming, a Back-up keeps every period (Rob, 6 Nov)', () => {
    const players = squadOf(9);
    players[2] = { ...players[2], keeper: 'backup' };
    players[6] = { ...players[6], keeper: 'backup' };
    // The Back-up with less time in goal this season keeps.
    const season = new Map<UUID, SeasonInput>([[players[2].id, { goalMs: 25 * 60_000, owedMs: 0 }]]);
    expect(rotateKeepers(players, 4, periodLengthMs(50, 4), season)).toEqual(Array(4).fill(players[6].id));
    // A Main keeper still comes first.
    players[4] = { ...players[4], keeper: 'main' };
    expect(rotateKeepers(players, 4, periodLengthMs(50, 4), season)).toEqual(Array(4).fill(players[4].id));
  });

  it('with a Main keeper in goal all match, everyone else gets the best spread whole quarters allow', () => {
    // 9 coming, the Main keeper in goal: 6 outfield places × 4 quarters among 8.
    const players = squadOf(9);
    players[0] = { ...players[0], keeper: 'main' };
    const r = build('2-3-1', 9, { players, subs: 0 });
    const others = players.slice(1).map((p) => r.minutes.get(p.id)!);
    expect(Math.max(...others) - Math.min(...others)).toBe(0); // 24 places / 8 = 3 quarters each
    expect(r.minutes.get(players[0].id)).toBe(50 * 60_000);
  });

  it('a Main keeper who is coming keeps every period', () => {
    const players = squadOf(9);
    players[4] = { ...players[4], keeper: 'main' };
    expect(rotateKeepers(players, 4, periodLengthMs(50, 4), none)).toEqual(Array(4).fill(players[4].id));
  });

  it('the keeper is in goal in their period and never comes off (B9)', () => {
    const r = build('2-3-1', 9);
    const goal = r.format.positions.find((p) => p.kind === 'goalkeeper')!;
    r.plan.periods.forEach((period, i) => {
      expect(period.slots[goal.id]).toBe(r.keepers[i]);
      for (const s of period.subs) expect(s.offId).not.toBe(r.keepers[i]);
    });
  });
});

describe('mid-period subs (B9)', () => {
  it('at most one per period, at the midpoint', () => {
    const r = build('2-3-1', 10);
    for (const period of r.plan.periods) {
      expect(period.subs.length).toBeLessThanOrEqual(1);
      for (const s of period.subs) expect(s.atMs).toBe(periodLengthMs(50, 4) / 2);
    }
  });

  it('the child who comes off is on the pitch and the one who comes on is not', () => {
    const r = build('2-3-1', 10);
    for (const period of r.plan.periods) {
      const on = new Set(Object.values(period.slots));
      for (const s of period.subs) {
        expect(on.has(s.offId)).toBe(true);
        expect(on.has(s.onId)).toBe(false);
      }
    }
  });
});

describe('positions rotate (B10)', () => {
  it('nobody holds the same outfield position in consecutive periods when they start both', () => {
    const r = build('2-3-1', 8, { subs: 0 });
    const goal = r.format.positions.find((p) => p.kind === 'goalkeeper')!.id;
    for (let p = 1; p < r.plan.periods.length; p++) {
      for (const [pos, who] of Object.entries(r.plan.periods[p].slots)) {
        if (pos === goal || !who) continue;
        expect(r.plan.periods[p - 1].slots[pos as UUID]).not.toBe(who);
      }
    }
  });
});

describe('the season inputs come from the record’s own folds (D2, D3)', () => {
  it('sums goal time, counts the matches kept, and carries owed time in ms', () => {
    const [a, b] = squadOf(2);
    const goal = (ms: number) => ({ goalMs: ms });
    const inputs = seasonInputs(
      [
        { minutes: new Map([[a.id, goal(12.5 * 60_000)], [b.id, goal(0)]]) },
        { minutes: new Map([[a.id, goal(6.25 * 60_000)]]) },
      ],
      [
        { playerId: a.id, owed: -3 },
        { playerId: b.id, owed: null },
      ]
    );
    expect(inputs.get(a.id)).toEqual({ goalMs: 18.75 * 60_000, owedMs: -3 * 60_000, timesKept: 2 });
    expect(inputs.get(b.id)).toEqual({ goalMs: 0, owedMs: null, timesKept: 0 });
  });
});

describe('the Subs stepper starts at the fewest subs with the fairest split (Rob, 6 Nov)', () => {
  it('9 coming at 7-a-side: 1', () => {
    const players = squadOf(9);
    const format = makeFormat('2-3-1');
    const keepers = rotateKeepers(players, 4, periodLengthMs(50, 4), none);
    expect(fairestSubs({ format, totalMinutes: 50, periodCount: 4, coming: players, keepers, fill: 'fair', season: none })).toBe(1);
  });

  it('a full bench of 7 coming at 7-a-side: none', () => {
    const players = squadOf(7);
    const format = makeFormat('2-3-1');
    const keepers = rotateKeepers(players, 4, periodLengthMs(50, 4), none);
    expect(fairestSubs({ format, totalMinutes: 50, periodCount: 4, coming: players, keepers, fill: 'fair', season: none })).toBe(0);
  });

  it('two subs a period: two pairs at the midpoint, none of them the keeper', () => {
    const r = build('2-3-1', 10, { subs: 2 });
    r.plan.periods.forEach((period, i) => {
      expect(period.subs).toHaveLength(2);
      for (const s of period.subs) {
        expect(s.atMs).toBe(periodLengthMs(50, 4) / 2);
        expect(s.offId).not.toBe(r.keepers[i]);
      }
    });
    expect(projectPlan(r.plan, r.format, 50, 4, r.players).problems).toEqual([]);
  });
});
