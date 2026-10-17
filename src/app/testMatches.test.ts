/**
 * #194 (part A): earlier test matches are hidden from every screen, kept in
 * the record, and can be shown again.
 */

import { describe, it, expect } from 'vitest';
import { MatchEngine, type MatchState } from '../engine/MatchEngine';
import { uuid, type Player } from '../types/index';
import { makePlayer } from './squad';
import { makeFormat } from './shapes';
import { sheetFromSelection, toTeamSheet } from './teamSheet';
import {
  emptyLedger,
  isHidden,
  parseLedger,
  recordMatches,
  seasonRows,
  serialiseLedger,
  setMatchExcluded,
  setMatchKind,
  visibleLedger,
  type Ledger,
} from './ledger';
import { recordOnlyMatches } from './recordOnly';
import { CLEANUP_NOTE, hiddenMatches, testMatchCandidates } from './testMatches';

const MIN = 60_000;
const squadId = uuid();
const players: Player[] = Array.from({ length: 9 }, (_, i) => makePlayer(squadId, `P${i + 1}`));
const ids = players.map((p) => p.id);
const NOW = new Date('2026-10-17T12:00:00Z');

/** A one-period match of `minutes`, planned as 10 minutes in one period unless said. */
function played(opponent: string | null, minutes: number, plan = { totalMinutes: 50, quarterCount: 4 }): MatchState {
  let nowMs = Date.parse('2026-10-16T18:00:00Z');
  const engine = new MatchEngine({ nowFn: () => new Date(nowMs) });
  const format = makeFormat('2-3-1');
  const state = engine.createMatch(squadId, format.id, { totalMinutes: plan.totalMinutes, quarterCount: plan.quarterCount });
  state.match.opponent = opponent;
  for (const q of state.quarters) {
    engine.startQuarter(state, q, toTeamSheet(sheetFromSelection(ids.slice(0, 7), ids[0], format)), format);
    nowMs += (minutes * MIN) / state.quarters.length;
    engine.endQuarter(state, q);
  }
  engine.completeMatch(state);
  return state;
}

const record = (states: MatchState[]): Ledger =>
  recordMatches(emptyLedger(squadId, 'Test FC', NOW), states, players, 'Test FC', NOW);

function leaveOut(l: Ledger, id: string, note: string): Ledger {
  const r = setMatchExcluded(l, id as never, true, note, NOW);
  if (!r.ok) throw new Error(r.reason);
  return r.ledger;
}

describe('the one-off clean-up offers only what looks like a test (#194 AC5)', () => {
  it('offers a no-opponent match left out as a test, and one over within a period', () => {
    const notedTest = played(null, 50);
    const quick = played(null, 1);
    const real = played('Mock Albion', 50);
    const realShort = played('Trial Town', 1); // abandoned, but a real fixture: never offered
    const fullNoOpponent = played(null, 50); // a Play now kickabout played properly: not offered
    let l = record([notedTest, quick, real, realShort, fullNoOpponent]);
    l = leaveOut(l, notedTest.match.id, 'Testing');
    expect(testMatchCandidates(l).map((m) => m.id).sort()).toEqual([notedTest.match.id, quick.match.id].sort());
  });

  it('never offers a match already hidden', () => {
    const quick = played(null, 1);
    const r = setMatchKind(record([quick]), quick.match.id, 'test', CLEANUP_NOTE, NOW);
    if (!r.ok) throw new Error(r.reason);
    expect(testMatchCandidates(r.ledger)).toEqual([]);
  });
});

describe('a match marked a test is hidden everywhere and kept in the record (#194, PO 17 Oct)', () => {
  const real = played('Mock Albion', 50);
  const test = played(null, 1);
  const marked = (() => {
    const r = setMatchKind(record([real, test]), test.match.id, 'test', CLEANUP_NOTE, NOW);
    if (!r.ok) throw new Error(r.reason);
    return r.ledger;
  })();

  it('the record keeps it, with its intervals and the note', () => {
    const m = marked.matches.find((x) => x.id === test.match.id)!;
    expect(isHidden(m)).toBe(true);
    expect(m.matchKind).toEqual({ kind: 'test', note: CLEANUP_NOTE });
    expect(m.intervals.length).toBeGreaterThan(0);
  });

  it('every screen’s ledger leaves it out: season minutes, Played', () => {
    const view = visibleLedger(marked);
    expect(view.matches.map((m) => m.id)).toEqual([real.match.id]);
    // P1 kept goal in both: the season row counts only the real match.
    const keeper = seasonRows(view).find((r) => r.playerId === ids[0])!;
    expect(keeper.goalkeeperMs).toBe(50 * MIN);
    expect(recordOnlyMatches(view, new Set()).map((m) => m.id)).toEqual([real.match.id]);
  });

  it('it is listed under Settings › Test matches', () => {
    expect(hiddenMatches(marked).map((m) => m.id)).toEqual([test.match.id]);
  });

  it('survives the minutes file', () => {
    const parsed = parseLedger(serialiseLedger(marked));
    if (!parsed.ok) throw new Error(parsed.reason);
    expect(hiddenMatches(parsed.ledger).map((m) => m.id)).toEqual([test.match.id]);
  });

  it('can be shown again, with a note; the earlier record stays in the chain', () => {
    const r = setMatchKind(marked, test.match.id, 'real', 'Shown again by the coach', NOW);
    if (!r.ok) throw new Error(r.reason);
    expect(visibleLedger(r.ledger).matches).toHaveLength(2);
    const kinds = r.ledger.entries.flatMap((e) => e.records).filter((x) => x.type === 'match-kind');
    expect(kinds.map((x) => x.kind)).toEqual(['test', 'real']);
  });

  it('a change needs a note, and marking it what it already is says so', () => {
    expect(setMatchKind(marked, test.match.id, 'real', '  ', NOW).ok).toBe(false);
    expect(setMatchKind(marked, test.match.id, 'test', 'again', NOW).ok).toBe(false);
  });

  it('with nothing hidden, the screens see the very same ledger', () => {
    const plain = record([real]);
    expect(visibleLedger(plain)).toBe(plain);
  });
});
