/**
 * The core match record — #196 AC1–AC6 (PO `approve readiness`, 18 Oct):
 * result from events, goals with time or scorer unknown, the structure the
 * clock ran with a noted correction, and minutes by position.
 *
 * Matches are played through the real engine and recorded through the real
 * ledger. Made-up first names only (invariant 4).
 */

import { describe, expect, it } from 'vitest';
import { MatchEngine, type MatchState } from '../engine/MatchEngine';
import { uuid, type Player, type UUID } from '../types/index';
import {
  addUnknownTimeEvent,
  correctStructure,
  emptyLedger,
  foldLedger,
  parseLedger,
  recordMatches,
  serialiseLedger,
  withdrawRecordEvent,
  type Ledger,
} from './ledger';
import * as released from './fixtures/reader-1.2.0/ledger';
import { latestRecords } from './ledgerChain';
import {
  parsePeriodLengths,
  positionMinutes,
  resultLabel,
  scoreFromEvents,
  scoreWithRecord,
  structureLabel,
  structureOf,
  timedEvents,
} from './matchRecord';
import { recordMatchPage, recordOnlyMatches, scoreLabel } from './recordOnly';
import { makeFormat } from './shapes';
import { makePlayer } from './squad';
import { sheetFromSelection, toTeamSheet } from './teamSheet';

const MIN = 60_000;
const NOW = new Date('2026-10-18T12:00:00Z');
const squadId = uuid();
const names = ['Ada', 'Bo', 'Cy', 'Di', 'Ed', 'Flo', 'Gil', 'Hal', 'Ivy'];
const players: Player[] = names.map((n) => makePlayer(squadId, n));
const ids = players.map((p) => p.id);
const format = makeFormat('2-3-1');

/** A match through the engine: `periods` of `minutes`, a sub mid-way through each, then completed. */
function played(
  periods: number,
  minutes: number,
  events: (e: MatchEngine, s: MatchState, q: MatchState['quarters'][number]) => void = () => {}
) {
  let nowMs = Date.parse('2026-10-03T09:00:00Z');
  const engine = new MatchEngine({ nowFn: () => new Date(nowMs) });
  const state = engine.createMatch(squadId, format.id, { totalMinutes: periods * minutes, quarterCount: periods });
  state.match.kickoffAt = '2026-10-03T09:00:00Z';
  state.match.opponent = 'Mock Rovers';
  for (const id of ids) engine.setAvailability(state, id, 'available');
  for (const q of state.quarters) {
    engine.startQuarter(state, q, toTeamSheet(sheetFromSelection(ids.slice(0, 7), ids[0], format)), format);
    nowMs += (minutes / 2) * MIN;
    engine.substitute(state, q, ids[6], ids[7]);
    nowMs += (minutes / 2) * MIN;
    events(engine, state, q);
    engine.endQuarter(state, q);
  }
  engine.completeMatch(state);
  return state;
}

const recorded = (states: MatchState[]): Ledger =>
  recordMatches(
    emptyLedger(squadId, 'Test FC', NOW),
    states.map((s) => ({ ...s, format })),
    players,
    'Test FC',
    NOW
  );

const ok = (r: { ok: true; ledger: Ledger } | { ok: false; reason: string }): Ledger => {
  if (!r.ok) throw new Error(r.reason);
  return r.ledger;
};

describe('goals with time unknown: the 3 Oct cup match, 4–1 (#196 AC1, AC2)', () => {
  // Imported from paper: minutes, no goal events. Three scorers, 2, 1 and 1.
  const m = played(4, 12);
  const base = recorded([m]);

  function withGoals(): Ledger {
    let l = base;
    for (const who of [ids[2], ids[2], ids[3], ids[4]]) {
      l = ok(addUnknownTimeEvent(l, m.match.id, 'goal', who, 'Match report', NOW));
    }
    return ok(addUnknownTimeEvent(l, m.match.id, 'conceded', null, 'Match report', NOW));
  }

  it('before: no events, so the score is not recorded, never a 0–0', () => {
    expect(recordOnlyMatches(base, new Set())[0].score).toBeNull();
  });

  it('after: the score reads W 4 – 1 on the card and the page', () => {
    const l = withGoals();
    const [row] = recordOnlyMatches(l, new Set());
    expect(row.score).toEqual({ us: 4, them: 1 });
    expect(scoreLabel(row.score)).toBe('W 4 – 1');
    const page = recordMatchPage(l, m.match.id);
    expect(page?.result).toBe('W');
    expect(page?.goals.map((g) => [g.name, g.timeKnown, g.note])).toEqual([
      ['Cy', false, 'Match report'],
      ['Cy', false, 'Match report'],
      ['Di', false, 'Match report'],
      ['Ed', false, 'Match report'],
    ]);
    expect(page?.conceded).toBe(1);
  });

  it('counts in the score and in no per-time figure; minutes are untouched', () => {
    const l = withGoals();
    const events = l.matches[0].events ?? [];
    expect(scoreFromEvents(events)).toEqual({ us: 4, them: 1 });
    expect(timedEvents(events)).toEqual([]);
    expect(events.every((e) => e.period === 0 && e.atMs === 0 && e.timeKnown === false)).toBe(true);
    expect(foldLedger(l)).toEqual(foldLedger(base));
  });

  it('a goal may have no scorer: it counts in the score and in no child’s figure', () => {
    const l = ok(addUnknownTimeEvent(base, m.match.id, 'goal', null, 'Match report', NOW));
    const page = recordMatchPage(l, m.match.id);
    expect(page?.goals.map((g) => g.name)).toEqual(['Scorer unknown']);
    expect(page?.match.score).toEqual({ us: 1, them: 0 });
  });

  it('needs a note; a goal against is credited to no one; the match must be in the record', () => {
    expect(addUnknownTimeEvent(base, m.match.id, 'goal', ids[2], ' ', NOW).ok).toBe(false);
    expect(addUnknownTimeEvent(base, m.match.id, 'conceded', ids[0], 'Report', NOW).ok).toBe(false);
    expect(addUnknownTimeEvent(base, uuid() as UUID, 'goal', null, 'Report', NOW).ok).toBe(false);
  });

  it('taking one back is a new record with a note; the goal stays in the chain', () => {
    const l = withGoals();
    const goal = recordMatchPage(l, m.match.id)?.goals[0];
    expect(withdrawRecordEvent(l, m.match.id, goal?.id as UUID, '', NOW).ok).toBe(false);
    const back = ok(withdrawRecordEvent(l, m.match.id, goal?.id as UUID, 'Own goal, not ours', NOW));
    expect(recordOnlyMatches(back, new Set())[0].score).toEqual({ us: 3, them: 1 });
    expect(back.entries.slice(0, l.entries.length)).toEqual(l.entries);
    expect(withdrawRecordEvent(back, m.match.id, goal?.id as UUID, 'again', NOW).ok).toBe(false);
  });

  it('the released 1.2.0 parser still reads it, with the same minutes (ADR-021 D1)', () => {
    const l = withGoals();
    const old = released.parseLedger(serialiseLedger(l));
    if (!old.ok) throw new Error(old.reason);
    expect(released.foldLedger(old.ledger)).toEqual(foldLedger(l));
    // And what it writes back still has them.
    const again = parseLedger(released.serialiseLedger(released.recordMatches(old.ledger, [m], players, 'Test FC', NOW)));
    if (!again.ok) throw new Error(again.reason);
    expect(recordOnlyMatches(again.ledger, new Set())[0].score).toEqual({ us: 4, them: 1 });
  });

  it('on a match played here, the card adds the record’s goals to the phone’s own', () => {
    const here = played(2, 20, (e, s, q) => void e.recordEvent(s, q, 'goal', ids[3]));
    let l = recorded([here]);
    l = ok(addUnknownTimeEvent(l, here.match.id, 'conceded', null, 'Ref’s card', NOW));
    const phoneIds = new Set((here.events ?? []).map((e) => e.id));
    expect(scoreWithRecord({ us: 2, them: 0 }, phoneIds, l.matches[0])).toEqual({ us: 2, them: 1 });
    expect(resultLabel({ us: 2, them: 1 })).toBe('W 2 – 1');
    expect(resultLabel({ us: 1, them: 1 })).toBe('D 1 – 1');
    expect(resultLabel({ us: 0, them: 3 })).toBe('L 0 – 3');
  });
});

describe('structure: how the match was actually played (#196 AC3)', () => {
  it('the clock’s periods are recorded as they ran', () => {
    const l = recorded([played(2, 20)]);
    const st = structureOf(l.matches[0]);
    expect(st).toMatchObject({ periodCount: 2, periodMs: [20 * MIN, 20 * MIN], shape: '2-3-1', onField: 7, source: 'clock' });
    expect(structureLabel(st)).toBe('2 halves of 20:00');
  });

  it('halves that turned into quarters: a noted correction; the clock’s record stays; minutes untouched', () => {
    const m = played(2, 20);
    const l = recorded([m]);
    expect(correctStructure(l, m.match.id, [10 * MIN, 10 * MIN, 10 * MIN, 10 * MIN], '', NOW).ok).toBe(false);
    const fixed = ok(
      correctStructure(l, m.match.id, [10 * MIN, 10 * MIN, 10 * MIN, 10 * MIN], 'Halves turned into quarters', NOW)
    );
    const st = structureOf(fixed.matches[0]);
    expect(st).toMatchObject({ periodCount: 4, source: 'corrected', note: 'Halves turned into quarters', shape: '2-3-1' });
    expect(structureLabel(st)).toBe('4 quarters of 10:00');
    expect(fixed.entries.flatMap((e) => e.records).filter((r) => r.type === 'structure')).toHaveLength(2);
    expect(foldLedger(fixed)).toEqual(foldLedger(l));
    // A later save never writes the clock's version over the correction.
    expect(recordMatches(fixed, [{ ...m, format }], players, 'Test FC', NOW)).toBe(fixed);
  });

  it('periods of different lengths are listed one by one', () => {
    expect(structureLabel({ periodCount: 3, periodMs: [20 * MIN, 20 * MIN, 10 * MIN] })).toBe('3 periods: 20:00, 20:00, 10:00');
    expect(parsePeriodLengths('20 20 10, 12.5')).toEqual([20 * MIN, 20 * MIN, 10 * MIN, 12.5 * MIN]);
    expect(parsePeriodLengths('20 x')).toBeNull();
    expect(parsePeriodLengths('0')).toBeNull();
  });

  it('a match recorded before this reads as its planned structure', () => {
    const m = played(4, 12);
    // As 1.2.0 recorded it: the same match, with no structure record.
    const l = released.recordMatches(released.emptyLedger(squadId, 'Test FC', NOW), [m], players, 'Test FC', NOW);
    const parsed = parseLedger(released.serialiseLedger(l));
    if (!parsed.ok) throw new Error(parsed.reason);
    const st = structureOf(parsed.ledger.matches[0]);
    expect(st).toMatchObject({ periodCount: 4, source: 'planned' });
    expect(structureLabel(st)).toBe('4 quarters of 12:00');
    // Saving it with this build does not invent one after the fact.
    const next = recordMatches(parsed.ledger, [{ ...m, format }], players, 'Test FC', NOW);
    expect(next.matches[0].structure).toBeUndefined();
  });
});

describe('minutes in positions (#196 AC4, AC5)', () => {
  it('each interval carries its role; role minutes add up to unit minutes and to the total', () => {
    const l = recorded([played(4, 12)]);
    const m = l.matches[0];
    expect(m.intervals.every((i) => typeof i.role === 'string')).toBe(true);
    for (const id of ids.slice(0, 8)) {
      const parts = positionMinutes(m.intervals, id);
      const total = m.intervals.filter((i) => i.playerId === id).reduce((s, i) => s + (i.endMs - i.startMs), 0);
      expect(parts.reduce((s, p) => s + p.ms, 0)).toBe(total);
      // Each unit's minutes are the sum of its roles'.
      const roleUnit = new Map(format.positions.map((p) => [p.roleCode, p.unit]));
      const byUnit = new Map<string, number>();
      for (const p of parts) byUnit.set(String(roleUnit.get(p.label)), (byUnit.get(String(roleUnit.get(p.label))) ?? 0) + p.ms);
      for (const i of m.intervals.filter((x) => x.playerId === id)) expect(byUnit.has(String(i.unit))).toBe(true);
    }
    const page = recordMatchPage(l, m.id);
    expect(page?.positions.get(ids[0])).toEqual([{ label: 'GK', ms: 48 * MIN }]);
  });

  it('an interval already in the chain is never rewritten to add a role; it reads per unit', () => {
    const m = played(2, 20);
    const old = released.recordMatches(released.emptyLedger(squadId, 'Test FC', NOW), [m], players, 'Test FC', NOW);
    const parsed = parseLedger(released.serialiseLedger(old));
    if (!parsed.ok) throw new Error(parsed.reason);
    const next = recordMatches(parsed.ledger, [{ ...m, format }], players, 'Test FC', NOW);
    expect(next).toBe(parsed.ledger);
    const someone = positionMinutes(next.matches[0].intervals, ids[1]);
    expect(someone.map((p) => p.label)).toEqual(['DEF']);
  });

  it('positions are a description: no fairness figure reads them (invariant 3)', () => {
    const l = recorded([played(2, 20)]);
    const intervals = [...latestRecords(l.entries).values()].filter((r) => r.type === 'interval');
    const stripped: Ledger = { ...l, matches: l.matches.map((x) => ({ ...x, intervals: x.intervals.map((i) => ({ ...i, role: null })) })) };
    expect(intervals.length).toBeGreaterThan(0);
    expect(foldLedger(stripped)).toEqual(foldLedger(l));
  });
});
