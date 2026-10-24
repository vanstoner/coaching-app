/**
 * #195 AC1 (pulled forward, PO `approve played` / `approve tag`): Played lists
 * the record's played matches that have no fixture on this phone, and each
 * opens read-only from the record.
 */

import { describe, it, expect } from 'vitest';
import { MatchEngine, type MatchState } from '../engine/MatchEngine';
import { uuid, type Player, type UUID } from '../types/index';
import { makePlayer } from './squad';
import { makeFormat } from './shapes';
import { sheetFromSelection, toTeamSheet } from './teamSheet';
import { emptyLedger, recordMatches, setMatchExcluded, type Ledger } from './ledger';
import { UNDO_NOTE } from './matchEvents';
import { recordMatchPage, recordOnlyMatches, scoreLabel } from './recordOnly';

const MIN = 60_000;
const squadId = uuid();
const players: Player[] = Array.from({ length: 9 }, (_, i) => makePlayer(squadId, `P${i + 1}`));
const ids = players.map((p) => p.id);

/** One match played through the engine: a quarter of `minutes`, then `play` events, then completed. */
function played(kickoffAt: string | null, play: (e: MatchEngine, s: MatchState) => void = () => {}, minutes = 10) {
  let nowMs = Date.parse(kickoffAt ?? '2026-09-01T09:00:00Z');
  const engine = new MatchEngine({ nowFn: () => new Date(nowMs) });
  const format = makeFormat('2-3-1');
  const state = engine.createMatch(squadId, format.id, { totalMinutes: 10, quarterCount: 1 });
  state.match.kickoffAt = kickoffAt;
  state.match.opponent = kickoffAt ? `Opp ${kickoffAt.slice(5, 10)}` : null;
  state.match.competition = 'league';
  const q = state.quarters[0];
  engine.startQuarter(state, q, toTeamSheet(sheetFromSelection(ids.slice(0, 7), ids[0], format)), format);
  nowMs += minutes * MIN;
  play(engine, state);
  engine.endQuarter(state, q);
  engine.completeMatch(state);
  return state;
}

function record(states: MatchState[]): Ledger {
  return recordMatches(emptyLedger(squadId, 'Test FC'), states, players, 'Test FC', new Date(1));
}

describe('Played lists the record’s other matches (#195 AC1)', () => {
  it('lists completed matches with no fixture here, and leaves out the ones that have one', () => {
    const a = played('2026-09-12T09:30:00Z');
    const b = played('2026-09-19T08:00:00Z');
    const ledger = record([a, b]);
    expect(recordOnlyMatches(ledger, new Set()).map((m) => m.id)).toEqual([b.match.id, a.match.id]);
    expect(recordOnlyMatches(ledger, new Set([a.match.id])).map((m) => m.id)).toEqual([b.match.id]);
  });

  it('most recent first, undated last, as Played orders fixtures', () => {
    const old = played('2026-09-12T09:30:00Z');
    const undated = played(null);
    const recent = played('2026-10-03T09:30:00Z');
    const list = recordOnlyMatches(record([old, undated, recent]), new Set());
    expect(list.map((m) => m.id)).toEqual([recent.match.id, old.match.id, undated.match.id]);
  });

  it('a match not yet completed is not Played', () => {
    const engine = new MatchEngine({ nowFn: () => new Date(0) });
    const format = makeFormat('2-3-1');
    const s = engine.createMatch(squadId, format.id, { totalMinutes: 40, quarterCount: 4 });
    engine.startQuarter(s, s.quarters[0], toTeamSheet(sheetFromSelection(ids.slice(0, 7), ids[0], format)), format);
    expect(recordOnlyMatches(record([s]), new Set())).toEqual([]);
  });

  it('carries the date, opponent and competition the card shows', () => {
    const m = played('2026-09-26T08:00:00Z');
    const [row] = recordOnlyMatches(record([m]), new Set());
    expect(row).toMatchObject({ kickoffAt: '2026-09-26T08:00:00Z', opponent: 'Opp 09-26', competition: 'league' });
  });
});

describe('the score (#195 AC1, PO ruling: never a 0–0 that did not happen)', () => {
  it('is folded from goal and conceded events, a withdrawn goal left out', () => {
    const m = played('2026-09-12T09:30:00Z', (e, s) => {
      e.recordEvent(s, s.quarters[0], 'goal', ids[3]);
      e.recordEvent(s, s.quarters[0], 'goal', ids[4]);
      const taken = e.recordEvent(s, s.quarters[0], 'goal', ids[5]);
      e.withdrawEvent(s, taken.id, UNDO_NOTE);
      e.recordEvent(s, s.quarters[0], 'conceded', ids[0]);
    });
    const [row] = recordOnlyMatches(record([m]), new Set());
    expect(row.score).toEqual({ us: 2, them: 1 });
    // #196 AC1 (approved 18 Oct): the card shows the result as W/D/L with the score.
    expect(scoreLabel(row.score)).toBe('W 2 – 1');
  });

  it('a match with no events at all reads "Score not recorded"', () => {
    const [row] = recordOnlyMatches(record([played('2026-10-03T09:30:00Z')]), new Set());
    expect(row.score).toBeNull();
    expect(scoreLabel(row.score)).toBe('Score not recorded');
  });

  it('a match with events but no goals is a real 0–0', () => {
    const m = played('2026-10-03T09:30:00Z', (e, s) => void e.recordEvent(s, s.quarters[0], 'save', ids[0]));
    expect(recordOnlyMatches(record([m]), new Set())[0].score).toEqual({ us: 0, them: 0 });
  });
});

describe('left out of the figures (ADR-020)', () => {
  it('stays in Played, carrying its note', () => {
    const m = played('2026-09-05T09:00:00Z');
    const r = setMatchExcluded(record([m]), m.match.id, true, 'Test', new Date(2));
    if (!r.ok) throw new Error(r.reason);
    expect(recordOnlyMatches(r.ledger, new Set())[0].leftOut).toBe('Test');
  });
});

describe('the read-only page', () => {
  it('folds each child’s minutes, goal time apart, most first', () => {
    const m = played('2026-09-12T09:30:00Z', () => {}, 10);
    const page = recordMatchPage(record([m]), m.match.id)!;
    expect(page.minutes).toHaveLength(7);
    const keeper = page.minutes.find((r) => r.playerId === ids[0])!;
    expect(keeper).toMatchObject({ name: 'P1', totalMs: 10 * MIN, goalMs: 10 * MIN });
    expect(page.minutes.every((r) => r.totalMs === 10 * MIN)).toBe(true);
  });

  it('lists our goals by scorer and period, and counts the goals against', () => {
    const m = played('2026-09-12T09:30:00Z', (e, s) => {
      e.recordEvent(s, s.quarters[0], 'goal', ids[3]);
      e.recordEvent(s, s.quarters[0], 'conceded', ids[0]);
    });
    const page = recordMatchPage(record([m]), m.match.id)!;
    expect(page.goals).toEqual([
      { id: expect.any(String), name: 'P4', period: 1, atMs: 10 * MIN, timeKnown: true, note: null },
    ]);
    expect(page.result).toBe('D');
    expect(page.conceded).toBe(1);
  });

  it('is null for a match the record does not hold', () => {
    expect(recordMatchPage(record([]), uuid() as UUID)).toBeNull();
    expect(recordMatchPage(null, uuid() as UUID)).toBeNull();
  });
});
