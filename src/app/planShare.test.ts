/**
 * The Plan's fair share over the children available (#262 AC3, AC6, AC7,
 * AC9; #261 AC18), and its names (#54 AC7). QA on PR #260, D9 and D11.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MatchEngine } from '../engine/MatchEngine';
import { uuid } from '../types/index';
import type { Player, UUID } from '../types/index';
import { makePlayer } from './squad';
import { makeFormat } from './shapes';
import { sheetFromSelection, toTeamSheet } from './teamSheet';
import { absentIds, markAbsent } from './absence';
import { emptyLedger, recordMatches, type Ledger } from './ledger';
import { matchReport } from './analysis';
import { recordLateArrival } from './matchClosing';
import { formatClock } from './matchClock';
import { longestOnAt, projectPlan, type MatchPlan } from './matchPlan';

const MIN = 60_000;
const NOW = new Date('2026-10-04T12:00:00Z');

function named(names: string[]): Player[] {
  const squadId = uuid();
  return names.map((n) => makePlayer(squadId, n));
}

/**
 * Ada's worked example (#262 AC6), made-up names: 7 in the squad, one marked
 * absent, 5-a-side for 50 minutes (250 planned pitch minutes), a Main keeper
 * in goal throughout.
 */
function adasExample() {
  const format = makeFormat('1-2-1');
  const players = named(['Ada', 'Bo', 'Cy', 'Di', 'Ed', 'Flo', 'Gil']);
  players[0] = { ...players[0], keeper: 'main' };
  const [ada, bo, cy, di, ed, flo, gil] = players.map((p) => p.id);
  const at = (label: string) => format.positions.find((p) => p.label === label)!.id;
  const half = (d: UUID, l: UUID, r: UUID, f: UUID) => ({
    slots: { [at('GK')]: ada, [at('D')]: d, [at('LM')]: l, [at('RM')]: r, [at('F')]: f },
    subs: [],
  });
  const plan: MatchPlan = { periods: [half(bo, cy, di, ed), half(flo, cy, di, ed)] };
  return { format, players, plan, ids: { ada, bo, cy, di, ed, flo, gil } };
}

describe('Ada’s example through projectPlan (#262 AC6, AC9)', () => {
  const { format, players, plan, ids } = adasExample();
  const projection = projectPlan(plan, format, 50, 2, players, null, new Set([ids.gil]));
  const row = (id: UUID) => projection.rows.find((r) => r.playerId === id)!;

  it('the share is 200 ÷ 5 = 40:00, not 250 ÷ 7 = 35:43', () => {
    // The total is over the children in the share: Ada's 50 in goal is out.
    expect(projection.totalPitchMs).toBe(200 * MIN);
    expect(formatClock(projection.fairShareMs)).toBe('40:00');
  });

  it('the absent child reads Absent, with no gap, last', () => {
    expect(row(ids.gil).deltaMs).toBeNull();
    expect(row(ids.gil).notInShare).toBe('absent');
    expect(projection.rows[projection.rows.length - 1].playerId).toBe(ids.gil);
  });

  it('the spread ignores the absent child (and the Main keeper)', () => {
    // In the share: Bo 25, Cy 50, Di 50, Ed 50, Flo 25. Gil's 0 would make it 50.
    expect(projection.spreadMs).toBe(25 * MIN);
  });
});

describe('the sort puts the absent after every available child (D9, #262 AC3)', () => {
  it('after the Main keeper, though earlier in the squad', () => {
    const { format, players, plan, ids } = adasExample();
    // Gil, absent, moved to the front of the squad; Ada is the Main keeper.
    const reordered = [players[6], ...players.slice(0, 6)];
    const p = projectPlan(plan, format, 50, 2, reordered, null, new Set([ids.gil]));
    const last = p.rows.slice(-2).map((r) => r.playerId);
    expect(last).toEqual([ids.ada, ids.gil]);
  });

  it('two absent children keep squad order between them, after everyone else', () => {
    const { format, players, plan, ids } = adasExample();
    const p = projectPlan(plan, format, 50, 2, players, null, new Set([ids.gil, ids.bo]));
    expect(p.rows.slice(-2).map((r) => r.playerId)).toEqual([ids.bo, ids.gil]);
    expect(p.rows.slice(0, -2).every((r) => r.notInShare !== 'absent')).toBe(true);
  });
});

describe('nobody marked gives the old figure (#262 AC9)', () => {
  it('with no Main keeper, the share is the planned minutes ÷ the whole squad', () => {
    const { format, players, plan } = adasExample();
    const noKeeper = players.map((p) => ({ ...p, keeper: null }));
    const p = projectPlan(plan, format, 50, 2, noKeeper, null, new Set());
    expect(p.fairShareMs).toBe((250 * MIN) / 7);
    expect(p.rows.every((r) => r.deltaMs !== null)).toBe(true);
  });
});

/** Nine players, halves of 25, seven a side, as in matchClosing.test.ts. */
function day(absent: number[] = []) {
  let nowMs = Date.parse('2026-10-03T09:00:00Z');
  const engine = new MatchEngine({ nowFn: () => new Date(nowMs) });
  const format = makeFormat('2-3-1');
  const players = named(['Ava', 'Ben', 'Cal', 'Dan', 'Eve', 'Fin', 'Gus', 'Hal', 'Ivy']);
  const ids = players.map((p) => p.id);
  const state = engine.createMatch(players[0].squadId, format.id, {
    totalMinutes: 50,
    quarterCount: 2,
    availablePlayerIds: ids,
  });
  for (const i of absent) markAbsent(engine, state, ids[i], true);
  let ledger: Ledger = emptyLedger(players[0].squadId, 'Test FC', NOW);
  const record = () => (ledger = recordMatches(ledger, [state], players, 'Test FC', NOW));
  return {
    engine,
    format,
    players,
    ids,
    state,
    record,
    ledger: () => ledger,
    advance: (ms: number) => (nowMs += ms),
  };
}

describe('a child who arrived mid-match is back in the share (#262 AC1, AC9)', () => {
  it('absent at kick-off: out; brought on and recorded arrived: in, with a gap', () => {
    const d = day([8]);
    const ivy = d.ids[8];
    const sheet = sheetFromSelection(d.ids.slice(0, 7), d.ids[0], d.format);
    d.engine.startQuarter(d.state, d.state.quarters[0], toTeamSheet(sheet), d.format);
    d.record();
    const plan: MatchPlan = { periods: [{ slots: sheet, subs: [] }, { slots: sheet, subs: [] }] };

    const before = projectPlan(plan, d.format, 50, 2, d.players, null, absentIds(d.state));
    expect(before.rows.find((r) => r.playerId === ivy)!.notInShare).toBe('absent');

    d.advance(10 * MIN);
    d.engine.substitute(d.state, d.state.quarters[0], d.ids[6], ivy);
    const arrived = recordLateArrival(d.engine, d.state, d.ledger(), ivy, NOW);
    expect(arrived?.ok).toBe(true);

    const after = projectPlan(plan, d.format, 50, 2, d.players, null, absentIds(d.state));
    const row = after.rows.find((r) => r.playerId === ivy)!;
    expect(row.notInShare).toBeUndefined();
    expect(row.deltaMs).not.toBeNull();
    // Nine in the share now, not eight.
    expect(after.fairShareMs).toBeCloseTo(after.totalPitchMs / 9);
    expect(before.fairShareMs).toBeCloseTo(before.totalPitchMs / 8);
  });
});

describe('the report and the Plan give the same share (#262 AC7, #261 AC3)', () => {
  it('a match played exactly to plan, one absent, a Main keeper', () => {
    const d = day([7]);
    d.players[0] = { ...d.players[0], keeper: 'main' };
    const here = d.ids.filter((_, i) => i !== 7);
    const first = sheetFromSelection(here.slice(0, 7), here[0], d.format);
    const second = sheetFromSelection([here[0], ...here.slice(2, 8)], here[0], d.format);
    const plan: MatchPlan = { periods: [{ slots: first, subs: [] }, { slots: second, subs: [] }] };

    d.engine.startQuarter(d.state, d.state.quarters[0], toTeamSheet(first), d.format);
    d.advance(25 * MIN);
    d.engine.endQuarter(d.state, d.state.quarters[0]);
    d.engine.startQuarter(d.state, d.state.quarters[1], toTeamSheet(second), d.format);
    d.advance(25 * MIN);
    d.engine.endQuarter(d.state, d.state.quarters[1]);

    const report = matchReport(d.engine, d.state, d.players, d.format);
    const planned = projectPlan(plan, d.format, 50, 2, d.players, null, absentIds(d.state));
    // The Main keeper's 50 out; 300 ÷ 7 outfielders here.
    expect(planned.fairShareMs).toBeCloseTo((300 * MIN) / 7);
    expect(report.fairShareMs).toBe(Math.round(planned.fairShareMs));
  });
});

describe('the Plan names children with displayName (#54 AC7, D1)', () => {
  it('"Alex S" and "Alex T" read apart', () => {
    const { format, plan } = adasExample();
    const squadId = uuid();
    const players = [
      { ...makePlayer(squadId, 'Alex', 'S'), keeper: 'main' as const },
      ...['Bo', 'Cy', 'Di', 'Ed'].map((n) => makePlayer(squadId, n)),
      makePlayer(squadId, 'Alex', 'T'),
    ];
    const p = projectPlan(plan, format, 50, 2, players);
    expect(p.rows.map((r) => r.name).filter((n) => n.startsWith('Alex')).sort()).toEqual(['Alex S', 'Alex T']);
  });
});

describe('"Whoever is on longest" on the Plan (#264 V20; QA on #260, D12)', () => {
  it('the outfield child on since earliest at that time; never the keeper, never one just on', () => {
    const { format, plan, ids } = adasExample();
    const first = plan.periods[0];
    // Bo, Cy, Di, Ed all on since 0; ties go to the shape's order (D first).
    expect(longestOnAt(first, -1, 10 * MIN, format)).toBe(ids.bo);
    // Flo on for Bo at 5:00: at 10:00 Cy, Di and Ed have been on longer.
    const subbed = { ...first, subs: [{ onId: ids.flo, offId: ids.bo, atMs: 5 * MIN }] };
    expect(longestOnAt(subbed, -1, 10 * MIN, format)).toBe(ids.cy);
    // Before that sub, it is still Bo; the sub being edited is not counted.
    expect(longestOnAt(subbed, -1, 4 * MIN, format)).toBe(ids.bo);
    expect(longestOnAt(subbed, 0, 10 * MIN, format)).toBe(ids.bo);
    // Ada, the keeper, on since 0 too, is never it.
    expect(longestOnAt(first, -1, 10 * MIN, format)).not.toBe(ids.ada);
  });

  it('a new sub at the same time as one already planned comes after it (QA D16)', () => {
    const { format, plan, ids } = adasExample();
    // Every new sub starts at the midpoint, so two at one time is the usual case.
    const one = { ...plan.periods[0], subs: [{ onId: ids.flo, offId: ids.bo, atMs: 10 * MIN }] };
    expect(longestOnAt(one, -1, 10 * MIN, format)).toBe(ids.cy);
    // Editing that first sub still leaves itself out.
    expect(longestOnAt(one, 0, 10 * MIN, format)).toBe(ids.bo);
  });

  it('nobody outfield on: null, so Save stays off', () => {
    const { format, ids } = adasExample();
    const keeperOnly = { slots: { [format.positions.find((p) => p.kind === 'goalkeeper')!.id]: ids.ada }, subs: [] };
    expect(longestOnAt(keeperOnly, -1, MIN, format)).toBeNull();
  });

  it('the Plan’s For list offers it first, and Save waits for For', () => {
    const screen = readFileSync(join(__dirname, '..', 'screens', 'PlanScreen.tsx'), 'utf-8');
    const forList = screen.slice(screen.indexOf('<Text style={screen.fieldLabel}>For</Text>'));
    expect(forList.indexOf('label="Whoever is on longest"')).toBeGreaterThan(-1);
    expect(forList.indexOf('label="Whoever is on longest"')).toBeLessThan(forList.indexOf('sheetChoices.off.map'));
    expect(screen).toMatch(/saveDisabled=\{subSheet === null \|\| subSheet\.onId === null \|\| forId === null\}/);
  });
});
