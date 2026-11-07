/**
 * The team sheet's moves and table — #277 C13–C17. Made-up names only.
 */

import { describe, expect, it } from 'vitest';
import { uuid } from '../types/index';
import type { UUID } from '../types/index';
import { displayName, makePlayer } from './squad';
import { makeFormat } from './shapes';
import { emptyPlan, periodLengthMs, projectPlan } from './matchPlan';
import { buildTeamSheet, rotateKeepers } from './teamSheetBuilder';
import { applyKeepers, benchOf, canRearrange, frontToBack, isPinned, keepPinned, keepersOf, minutesThrough, parseSheetView, pinPlaces, planGaps, rearrangePeriod, sheetTable, subRequestFor, swapInPeriod } from './teamSheetEdit';

const squadId = uuid();
const players = ['Ava', 'Ben', 'Cal', 'Dan', 'Eve', 'Fin', 'Gus', 'Hal', 'Ivy'].map((n) => makePlayer(squadId, n));
const ids = players.map((p) => p.id);
const format = makeFormat('2-3-1');
const name = (id: UUID) => displayName(players.find((p) => p.id === id)!);
const sheet = () =>
  buildTeamSheet({
    format,
    totalMinutes: 50,
    periodCount: 4,
    coming: players,
    keepers: rotateKeepers(players, 4, periodLengthMs(50, 4), new Map()),
    subs: 1,
    fill: 'fair',
    season: new Map(),
  }).plan;

describe('tap one child, then another, and they swap (C17)', () => {
  it('two on the pitch change places; other periods are untouched', () => {
    const plan = sheet();
    const [p1, p2] = Object.entries(plan.periods[0].slots) as [UUID, UUID][];
    const next = swapInPeriod(plan, 0, p1[1], p2[1]);
    expect(next.periods[0].slots[p1[0]]).toBe(p2[1]);
    expect(next.periods[0].slots[p2[0]]).toBe(p1[1]);
    expect(next.periods[1]).toBe(plan.periods[1]);
  });

  it('a bench child swaps onto the pitch, and the sub follows whoever holds its place', () => {
    const plan = sheet();
    const period = plan.periods[0];
    const sub = period.subs[0];
    const bench = benchOf(period, ids);
    // Swap the child coming off with someone on the bench who is not coming on.
    const sitter = bench.find((id) => id !== sub.onId)!;
    const next = swapInPeriod(plan, 0, sub.offId!, sitter);
    const place = (Object.entries(period.slots) as [UUID, UUID][]).find(([, id]) => id === sub.offId)![0];
    expect(next.periods[0].slots[place]).toBe(sitter);
    expect(next.periods[0].subs[0].offId).toBe(sitter);
    expect(next.periods[0].subs[0].onId).toBe(sub.onId);
  });

  it('a swap moves no figure out of the plan: the Plan still finds nothing wrong (B12)', () => {
    const plan = sheet();
    const bench = benchOf(plan.periods[2], ids);
    const starter = Object.values(plan.periods[2].slots)[1]!;
    const next = swapInPeriod(plan, 2, starter, bench[0]);
    expect(projectPlan(next, format, 50, 4, players).problems).toEqual([]);
  });
});

describe('the table (C15, Rob 5 Nov): positions down the side, periods across', () => {
  it('one row per position front to back, the keeper last, then Bench rows', () => {
    const rows = sheetTable(sheet(), format, ids, name);
    const labels = rows.map((r) => r.label);
    const positions = frontToBack(format);
    expect(labels.slice(0, positions.length)).toEqual(positions.map((p) => p.roleCode ?? p.label));
    expect(positions[positions.length - 1].kind).toBe('goalkeeper');
    expect(labels.slice(positions.length).every((l) => l === 'Bench')).toBe(true);
    expect(rows.every((r) => r.cells.length === 4)).toBe(true);
  });

  it('a sub shows under the name it replaces, and the child coming on says when and where', () => {
    const plan = sheet();
    const rows = sheetTable(plan, format, ids, name);
    const sub = plan.periods[0].subs[0];
    const offCell = rows.find((r) => r.cells[0].playerId === sub.offId)!.cells[0];
    expect(offCell.note).toBe(`${name(sub.onId!)} on 6:15`);
    const onRow = rows.find((r) => r.positionId === null && r.cells[0].playerId === sub.onId)!;
    expect(onRow.cells[0].note).toMatch(/^on 6:15 at .+$/);
  });
});

describe('Formation or Table is a view choice on this phone (C13, D5)', () => {
  it('reads the Pitch unless All quarters or Table was chosen', () => {
    expect(parseSheetView(null)).toBe('formation');
    expect(parseSheetView('table')).toBe('table');
    expect(parseSheetView('all')).toBe('all');
    expect(parseSheetView('junk')).toBe('formation');
  });
});

describe('match day: a child unticked who is in the plan is pointed out (D20)', () => {
  it('names every period they are placed in, and re-plans nothing', () => {
    const plan = sheet();
    const absentee = Object.values(plan.periods[0].slots)[2]!;
    const lines = planGaps(plan, new Set([absentee]), name, 'Q');
    const periods = plan.periods
      .map((p, i) => (Object.values(p.slots).includes(absentee) || p.subs.some((s) => s.onId === absentee) ? `Q${i + 1}` : null))
      .filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(new RegExp(`^${name(absentee)} is in .*Q1.* of the plan but not here today\\.$`));
    for (const p of periods) expect(lines[0]).toContain(p!);
    expect(planGaps(plan, new Set(), name, 'Q')).toEqual([]);
  });

  it('periods already played are left out', () => {
    const plan = sheet();
    const only0 = Object.values(plan.periods[0].slots).find((id) => !plan.periods.slice(1).some((p) => Object.values(p.slots).includes(id) || p.subs.some((s) => s.onId === id)));
    if (only0) expect(planGaps(plan, new Set([only0]), name, 'Q', 1)).toEqual([]);
  });
});

describe('the keepers go in goal from the start (Rob, 6 Nov)', () => {
  it('an empty sheet gets each period’s keeper in goal, nothing else', () => {
    const keepers = [ids[0], ids[1], ids[2], ids[3]];
    const plan = applyKeepers(emptyPlan(4), format, keepers);
    expect(keepersOf(plan, format)).toEqual(keepers);
    for (const period of plan.periods) expect(Object.values(period.slots).filter(Boolean)).toHaveLength(1);
  });

  it('a keeper who was on the pitch swaps with whoever was in goal', () => {
    const plan = sheet();
    const goal = format.positions.find((p) => p.kind === 'goalkeeper')!;
    const outfielder = Object.entries(plan.periods[0].slots).find(([pos, id]) => pos !== goal.id && id)![1]!;
    const was = plan.periods[0].slots[goal.id]!;
    const next = applyKeepers(plan, format, [outfielder, ...keepersOf(plan, format).slice(1)]);
    expect(next.periods[0].slots[goal.id]).toBe(outfielder);
    expect(Object.values(next.periods[0].slots)).toContain(was);
    expect(projectPlan(next, format, 50, 4, players).problems).toEqual([]);
  });
});

describe('placed by hand, Fill and ⟳ Rearrange (#277, Rob 6 Nov)', () => {
  const goal = () => format.positions.find((p) => p.kind === 'goalkeeper')!.id;
  const outfieldIds = () => frontToBack(format).filter((p) => p.kind !== 'goalkeeper').map((p) => p.id);

  it('Fill starts from the keepers and the places filled by hand, subs cleared', () => {
    const plan = pinPlaces(sheet(), 1, [outfieldIds()[0]]);
    const start = keepPinned(plan, format);
    expect(start.periods[1].slots[outfieldIds()[0]]).toBe(plan.periods[1].slots[outfieldIds()[0]]);
    expect(start.periods[1].slots[goal()]).toBe(plan.periods[1].slots[goal()]);
    expect(Object.values(start.periods[0].slots).filter(Boolean)).toHaveLength(1);
    expect(start.periods.every((p) => p.subs.length === 0)).toBe(true);
  });

  it('a pin on an emptied place no longer counts', () => {
    const plan = pinPlaces(sheet(), 0, [outfieldIds()[0]]);
    plan.periods[0].slots[outfieldIds()[0]] = null;
    expect(isPinned(plan.periods[0], outfieldIds()[0])).toBe(false);
  });

  it('Rearrange keeps the same children on and off, so no minute moves', () => {
    const plan = sheet();
    const next = rearrangePeriod(plan, 2, format, 1);
    const on = (p: typeof plan) => new Set(Object.values(p.periods[2].slots));
    expect(on(next)).toEqual(on(plan));
    expect(next.periods[2].subs).toEqual(plan.periods[2].subs);
    expect(next.periods[2].slots).not.toEqual(plan.periods[2].slots);
    const mins = (p: typeof plan) => projectPlan(p, format, 50, 4, players).rows.map((r) => r.pitchMs);
    expect(mins(next)).toEqual(mins(plan));
    expect(next.periods[0]).toBe(plan.periods[0]);
  });

  it('Rearrange leaves the keeper and places filled by hand where they are', () => {
    const pinned = outfieldIds()[1];
    const plan = pinPlaces(sheet(), 0, [pinned]);
    for (const turn of [1, 2, 3]) {
      const next = rearrangePeriod(plan, 0, format, turn);
      expect(next.periods[0].slots[pinned]).toBe(plan.periods[0].slots[pinned]);
      expect(next.periods[0].slots[goal()]).toBe(plan.periods[0].slots[goal()]);
    }
  });

  it('nothing to rearrange with fewer than two free places', () => {
    const plan = pinPlaces(sheet(), 0, outfieldIds().slice(1));
    expect(canRearrange(plan.periods[0], format)).toBe(false);
    expect(rearrangePeriod(plan, 0, format, 1)).toBe(plan);
  });

  it('a swap keeps the period’s pins (the plan carries them)', () => {
    const plan = pinPlaces(sheet(), 0, [outfieldIds()[0]]);
    const [a, b] = Object.values(plan.periods[0].slots).filter(Boolean) as UUID[];
    expect(swapInPeriod(plan, 0, a, b).periods[0].pinned).toEqual([outfieldIds()[0]]);
  });
});

describe('the number under a name is the running total to the end of that quarter (Rob, 7 Nov)', () => {
  it('Q1 shows Q1 alone, Q4 shows the whole match', () => {
    const plan = sheet();
    const q1 = minutesThrough(plan, 0, format, 50, 4, players);
    const q4 = minutesThrough(plan, 3, format, 50, 4, players);
    const whole = new Map(projectPlan(plan, format, 50, 4, players).rows.map((r) => [r.playerId, r.pitchMs]));
    const goal = format.positions.find((p) => p.kind === 'goalkeeper')!.id;
    expect(q1.get(plan.periods[0].slots[goal]!)).toBe(12.5 * 60_000);
    expect(Math.max(...q1.values())).toBeLessThanOrEqual(12.5 * 60_000);
    expect(q4).toEqual(whole);
  });

  it('only ever grows from one quarter to the next', () => {
    const plan = sheet();
    for (let p = 1; p < 4; p++) {
      const before = minutesThrough(plan, p - 1, format, 50, 4, players);
      const after = minutesThrough(plan, p, format, 50, 4, players);
      for (const [id, ms] of after) expect(ms).toBeGreaterThanOrEqual(before.get(id)!);
    }
  });
});

describe('the sub a tap opens (Rob, 7 Nov: tap a placed child and sub them)', () => {
  it('a child on the pitch: their sub off, else a new one taking them off', () => {
    const period = sheet().periods[0];
    const sub = period.subs[0];
    expect(subRequestFor(period, sub.offId!, true)).toEqual({ swapIndex: 0, onId: sub.onId, offId: sub.offId });
    const stays = Object.values(period.slots).find((id) => id && !period.subs.some((s) => s.offId === id))!;
    expect(subRequestFor(period, stays, true)).toEqual({ swapIndex: -1, onId: null, offId: stays });
  });
  it('a bench child: their sub on, else a new one bringing them on', () => {
    const period = sheet().periods[0];
    const sub = period.subs[0];
    expect(subRequestFor(period, sub.onId!, false)).toEqual({ swapIndex: 0, onId: sub.onId, offId: sub.offId });
    const sitter = benchOf(period, ids).find((id) => id !== sub.onId)!;
    expect(subRequestFor(period, sitter, false)).toEqual({ swapIndex: -1, onId: sitter, offId: null });
  });
});
