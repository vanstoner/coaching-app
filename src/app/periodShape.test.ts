/**
 * #298 (ADR-027): a shape per period, 1-4-1, and the switch by area.
 * Criteria on #298 (Rob, 20 Nov: "approve 298 criteria"). Made-up names only.
 */

import { describe, expect, it } from 'vitest';
import { MatchEngine } from '../engine/MatchEngine';
import { uuid, type UUID } from '../types/index';
import { emptyLedger, recordMatches } from './ledger';
import { makePlayer } from './squad';
import { makeFormat, matchFormatInShape, shapeOfFormat, switchableShapes } from './shapes';
import { formatForPlannedPeriod, formatOfPeriod, overrideLabel, switchShape } from './periodShape';
import { pillWidthFor, slotBox, slotSpots, widestRow } from './pitchLayout';
import { buildTeamSheet } from './teamSheetBuilder';
import { copyPeriod, emptyPlan, projectPlan } from './matchPlan';
import { keepPinned, sheetTable } from './teamSheetEdit';
import { planImage } from './planImage';
import { newMatch } from './matchLifecycle';

const squadId = uuid();
const players = ['Ava', 'Ben', 'Cal', 'Dan', 'Eve', 'Fin', 'Gus', 'Hal'].map((n) => makePlayer(squadId, n));
const base = makeFormat('2-3-1');
const flat = matchFormatInShape(base, '1-4-1')!;
const labels = (f: typeof base) => [...f.positions].sort((a, b) => a.sortOrder - b.sortOrder).map((p) => `${p.label}/${p.unit}`);

describe('1-4-1 (C1, ADR-027 D1)', () => {
  it('GK; SW; RM, CM, CM, LM; ST, and it reads back as itself', () => {
    expect(labels(makeFormat('1-4-1'))).toEqual(['GK/GK', 'SW/DEF', 'RM/MID', 'CM/MID', 'CM/MID', 'LM/MID', 'ST/ATT']);
    expect(shapeOfFormat(makeFormat('1-4-1'))).toBe('1-4-1');
  });

  it('the pitch draws SW alone, the four flat (LM left, RM right), ST alone', () => {
    const spots = slotSpots(makeFormat('1-4-1'));
    const row = (unit: string) => spots.filter((s) => s.unit === unit).sort((a, b) => a.x - b.x).map((s) => s.label);
    expect(row('MID')).toEqual(['LM', 'CM', 'CM', 'RM']);
    expect(row('DEF')).toEqual(['SW']);
    expect(row('ATT')).toEqual(['ST']);
  });

  it('at 360 dp no two pills overlap: a row of four takes the 72 dp pill (fitGuard\'s row-of-four rule)', () => {
    const f = makeFormat('1-4-1');
    const width = 360;
    const pill = pillWidthFor(f.onFieldCount, width, widestRow(f));
    expect(pill).toBe(72);
    const boxes = slotSpots(f).map((s) => slotBox(s, width, 480, pill));
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const [a, b] = [boxes[i], boxes[j]];
        const overlap = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 0 && Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 0;
        expect(overlap).toBe(false);
      }
  });
});

describe('the match\'s shape by default; a period may override it (C2a, D2, D4)', () => {
  it('a period with no snapshot is in the match\'s shape (every save before 2.5.0)', () => {
    expect(formatOfPeriod(base, { format: undefined })).toBe(base);
    expect(formatOfPeriod(base, { format: flat })).toBe(flat);
  });

  it('the same shape gets the same position ids on every read; the match\'s own shape is the match\'s format', () => {
    expect(matchFormatInShape(base, '1-4-1')).toEqual(flat);
    expect(matchFormatInShape(base, '2-3-1')).toBe(base);
  });

  it('a planned period with no shape, or one of another side, is the match\'s', () => {
    expect(formatForPlannedPeriod(base, undefined)).toBe(base);
    expect(formatForPlannedPeriod(base, '4-4-2')).toBe(base);
    expect(formatForPlannedPeriod(base, '1-4-1')).toEqual(flat);
  });

  it('an override is marked; the match\'s shape is not', () => {
    expect(overrideLabel(base, flat)).toBe('1-4-1');
    expect(overrideLabel(base, base)).toBeNull();
  });

  it('7-a-side only (C5): 7 offers its three shapes; 5, 9 and 11 none', () => {
    expect(switchableShapes(base)).toEqual(['2-3-1', '2-2-2', '1-4-1']);
    for (const code of ['2-2', '3-3-2', '4-4-2'] as const) expect(switchableShapes(makeFormat(code))).toEqual([]);
  });
});

describe('the switch keeps each child in their area (C3, D5)', () => {
  const pos = (f: typeof base, label: string, nth = 0) => [...f.positions].sort((a, b) => a.sortOrder - b.sortOrder).filter((p) => p.label === label)[nth].id;
  const [gk, lb, rb, cm, lw, rw, st] = players;
  const sheet = {
    [pos(base, 'GK')]: gk.id, [pos(base, 'LB')]: lb.id, [pos(base, 'RB')]: rb.id,
    [pos(base, 'CM')]: cm.id, [pos(base, 'LW')]: lw.id, [pos(base, 'RW')]: rw.id, [pos(base, 'ST')]: st.id,
  } as Record<UUID, UUID | null>;

  it('2-3-1 to 1-4-1: keeper in goal, one defender stays back, the other moves up to midfield, the three mids stay mid, the striker stays up', () => {
    const next = switchShape(sheet, base, flat);
    expect(next[pos(flat, 'GK')]).toBe(gk.id);
    expect(next[pos(flat, 'SW')]).toBe(lb.id);
    const mids = ['RM', 'CM', 'CM', 'LM'].map((l, i) => next[pos(flat, l, l === 'CM' ? (i === 1 ? 0 : 1) : 0)]);
    expect(new Set(mids)).toEqual(new Set([cm.id, lw.id, rw.id, rb.id]));
    expect(next[pos(flat, 'ST')]).toBe(st.id);
  });

  it('nobody comes on or goes off, and back again gives the same seven', () => {
    const there = switchShape(sheet, base, flat);
    expect(new Set(Object.values(there))).toEqual(new Set(Object.values(sheet)));
    const back = switchShape(there, flat, base);
    expect(new Set(Object.values(back))).toEqual(new Set(Object.values(sheet)));
    expect(back[pos(base, 'GK')]).toBe(gk.id);
  });

  it('an empty place stays empty; nobody is invented', () => {
    const partial = { ...sheet, [pos(base, 'ST')]: null };
    const next = switchShape(partial, base, flat);
    expect(Object.values(next).filter((v) => v !== null)).toHaveLength(6);
  });
});

describe('the engine and the record (C4, C7, D2, D6)', () => {
  it('a period started in 1-4-1 keeps that shape; minutes and the record are as in any other shape', () => {
    const engine = new MatchEngine({ nowFn: () => new Date('2026-11-21T10:00:00Z') });
    const state = engine.createMatch(squadId, base.id, { totalMinutes: 50, quarterCount: 4, availablePlayerIds: players.map((p) => p.id) });
    const q1 = state.quarters[0];
    const sheet = new Map<UUID, UUID>();
    [...flat.positions].sort((a, b) => a.sortOrder - b.sortOrder).forEach((p, i) => sheet.set(p.id, players[i].id));
    engine.startQuarter(state, q1, sheet, flat);
    expect(q1.format).toBe(flat);
    expect(state.quarters[1].format).toBeUndefined();
    engine.endQuarter(state, q1);
    const ledger = recordMatches(emptyLedger(squadId, 'Test FC', new Date()), [{ ...state, format: base }], players, 'Test FC', new Date());
    const intervals = ledger.matches[0]?.intervals ?? [];
    expect(intervals.length).toBe(7);
    // The role comes from the period's own shape: the sweeper is SW, not null.
    expect(intervals.map((i) => i.role)).toContain('SW');
    expect(intervals.filter((i) => i.unit === 'MID')).toHaveLength(4);
  });
});

describe('the plan holds a shape per period (C2, C2a, C6, D4)', () => {
  const plan = emptyPlan(4);
  plan.periods[2] = { ...plan.periods[2], shape: '1-4-1' };
  const built = buildTeamSheet({
    format: base, totalMinutes: 50, periodCount: 4, coming: players, keepers: [players[0].id, players[1].id, players[0].id, players[1].id],
    subs: 1, fill: 'fair', season: new Map(), existing: plan,
  }).plan;

  it('the fill keeps Q3 in 1-4-1 and fills that shape\'s places; the other quarters stay in the match\'s shape', () => {
    expect(built.periods[2].shape).toBe('1-4-1');
    expect(Object.keys(built.periods[2].slots).sort()).toEqual(flat.positions.map((p) => p.id).sort());
    expect(Object.values(built.periods[2].slots).filter(Boolean)).toHaveLength(7);
    expect(built.periods[0].shape).toBeUndefined();
    expect(Object.keys(built.periods[0].slots).sort()).toEqual(base.positions.map((p) => p.id).sort());
  });

  it('the projection reads Q3 in its own shape: every place filled, no "nobody in it"', () => {
    const projection = projectPlan(built, base, 50, 4, players);
    expect(projection.problems.filter((p) => p.periodIndex === 2)).toEqual([]);
  });

  it('a fill from pins keeps the shape; a copy of a period copies its shape', () => {
    expect(keepPinned(built, base).periods[2].shape).toBe('1-4-1');
    expect(copyPeriod(built, 2, 3).periods[3].shape).toBe('1-4-1');
  });

  it('the table fills Q3\'s rows from its own places and names a place where it differs', () => {
    const rows = sheetTable(built, base, players.map((p) => p.id), (id) => players.find((p) => p.id === id)!.firstName);
    expect(rows.slice(0, 7).every((r) => r.cells[2].playerId !== null)).toBe(true);
    expect(rows.some((r) => (r.cells[2].note ?? '').startsWith('SW'))).toBe(true);
  });

  it('Share plan: each quarter on its own shape\'s pitch, the shape in every heading when one changes (C6)', () => {
    const match = newMatch({ squadId, format: base, totalMinutes: 50, periodCount: 4, players, opponent: 'Rovers' }, () => new Date()).stored.match;
    const image = planImage({ match, squadName: 'Test FC', format: base, plan: built, players });
    expect(image.periods.map((p) => p.title)).toEqual(['Q1 · 2-3-1', 'Q2 · 2-3-1', 'Q3 · 1-4-1', 'Q4 · 2-3-1']);
    expect(image.periods[2].slots.map((s) => s.label)).toContain('SW');
    expect(image.periods[0].slots.map((s) => s.label)).not.toContain('SW');
    const plain = planImage({ match, squadName: 'Test FC', format: base, plan: emptyPlan(4), players });
    expect(plain.periods[0].title).toBe('Quarter 1');
  });
});
