/**
 * The team sheet's moves and table — #277 C13–C17. Made-up names only.
 */

import { describe, expect, it } from 'vitest';
import { uuid } from '../types/index';
import type { UUID } from '../types/index';
import { displayName, makePlayer } from './squad';
import { makeFormat } from './shapes';
import { periodLengthMs, projectPlan } from './matchPlan';
import { buildTeamSheet, rotateKeepers } from './teamSheetBuilder';
import { benchOf, frontToBack, parseSheetView, sheetTable, swapInPeriod } from './teamSheetEdit';

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
    subs: true,
    fill: 'even',
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
    expect(offCell.note).toBe(`⇄ ${name(sub.onId!)} 6:15`);
    const onRow = rows.find((r) => r.positionId === null && r.cells[0].playerId === sub.onId)!;
    expect(onRow.cells[0].note).toMatch(/^on 6:15 at .+$/);
  });
});

describe('Formation or Table is a view choice on this phone (C13, D5)', () => {
  it('reads Formation unless Table was chosen', () => {
    expect(parseSheetView(null)).toBe('formation');
    expect(parseSheetView('table')).toBe('table');
    expect(parseSheetView('junk')).toBe('formation');
  });
});
