/**
 * Tests for in-play events and position swaps — #84, #83 AC4, #82.
 */

import { describe, it, expect } from 'vitest';
import { MatchEngine, MatchEngineError } from '../engine/MatchEngine';
import { uuid } from '../types/index';
import type { Player, UUID } from '../types/index';
import { makePlayer } from './squad';
import { makeFormat } from './shapes';
import { foldPlayerMinutes } from './playerMinutes';
import { sheetFromSelection, toTeamSheet } from './teamSheet';
import {
  UNDO_NOTE,
  canQuickUndo,
  scoreOf,
  talliesOf,
  timeStream,
} from './matchEvents';

const MIN = 60_000;

function kickOff() {
  let nowMs = 1_700_000_000_000;
  const engine = new MatchEngine({ nowFn: () => new Date(nowMs) });
  const format = makeFormat('2-3-1');
  const squadId = uuid();
  const players: Player[] = Array.from({ length: 9 }, (_, i) => makePlayer(squadId, `P${i + 1}`));
  const ids = players.map((p) => p.id);
  const state = engine.createMatch(squadId, format.id, { totalMinutes: 50, quarterCount: 2 });
  // P1 in goal; P2–P7 outfield; P8, P9 on the bench.
  engine.startQuarter(state, state.quarters[0], toTeamSheet(sheetFromSelection(ids.slice(0, 7), ids[0], format)), format);
  const q = state.quarters[0];
  return { engine, state, players, ids, q, advance: (ms: number) => (nowMs += ms), now: () => new Date(nowMs) };
}

describe('goals, saves and goals conceded (#84 AC1–AC3)', () => {
  it('a goal from an outfield player puts our score up; conceded puts theirs up', () => {
    const { engine, state, ids, q, advance } = kickOff();
    advance(3 * MIN);
    engine.recordEvent(state, q, 'goal', ids[4]);
    advance(2 * MIN);
    engine.recordEvent(state, q, 'save', ids[0]);
    engine.recordEvent(state, q, 'conceded', ids[0]);
    expect(scoreOf(state.events)).toEqual({ us: 1, them: 1 });
    expect(state.events![0].atElapsedMs).toBe(3 * MIN);
  });

  it('the keeper can score too', () => {
    const { engine, state, ids, q } = kickOff();
    engine.recordEvent(state, q, 'goal', ids[0]);
    expect(scoreOf(state.events).us).toBe(1);
  });

  it('refuses a save or a goal conceded for an outfield player', () => {
    const { engine, state, ids, q } = kickOff();
    expect(() => engine.recordEvent(state, q, 'save', ids[3])).toThrow(MatchEngineError);
    expect(() => engine.recordEvent(state, q, 'conceded', ids[3])).toThrow(MatchEngineError);
  });

  it('refuses an event for a player on the bench, or between periods', () => {
    const { engine, state, ids, q } = kickOff();
    expect(() => engine.recordEvent(state, q, 'goal', ids[8])).toThrow(MatchEngineError);
    engine.endQuarter(state, q);
    expect(() => engine.recordEvent(state, q, 'goal', ids[3])).toThrow(MatchEngineError);
  });

  it('counts each player’s goals, saves and goals conceded (AC6)', () => {
    const { engine, state, ids, q } = kickOff();
    engine.recordEvent(state, q, 'goal', ids[4]);
    engine.recordEvent(state, q, 'goal', ids[4]);
    engine.recordEvent(state, q, 'save', ids[0]);
    const t = new Map(talliesOf(state.events).map((r) => [r.playerId, r] as [UUID, typeof r]));
    expect(t.get(ids[4])!.goals).toBe(2);
    expect(t.get(ids[0])!.saves).toBe(1);
  });
});

describe('taking an event back (#84 AC5, invariant 5)', () => {
  it('a withdrawal stops the event counting and leaves it in the log', () => {
    const { engine, state, ids, q } = kickOff();
    const goal = engine.recordEvent(state, q, 'goal', ids[4]);
    engine.withdrawEvent(state, goal.id, UNDO_NOTE);
    expect(scoreOf(state.events)).toEqual({ us: 0, them: 0 });
    expect(state.events!.find((e) => e.id === goal.id)).toBeDefined();
    expect(state.events!.at(-1)).toMatchObject({ kind: 'withdrawn', refersTo: goal.id, note: UNDO_NOTE });
  });

  it('needs a note, and cannot withdraw twice or withdraw a withdrawal', () => {
    const { engine, state, ids, q } = kickOff();
    const goal = engine.recordEvent(state, q, 'goal', ids[4]);
    expect(() => engine.withdrawEvent(state, goal.id, '   ')).toThrow(MatchEngineError);
    const w = engine.withdrawEvent(state, goal.id, 'it hit their player last');
    expect(() => engine.withdrawEvent(state, goal.id, 'again')).toThrow(MatchEngineError);
    expect(() => engine.withdrawEvent(state, w.id, 'undo the undo')).toThrow(MatchEngineError);
  });

  it('can be withdrawn after the period has ended', () => {
    const { engine, state, ids, q } = kickOff();
    const goal = engine.recordEvent(state, q, 'goal', ids[4]);
    engine.endQuarter(state, q);
    engine.withdrawEvent(state, goal.id, 'scorer was wrong');
    expect(scoreOf(state.events).us).toBe(0);
  });

  it('offers the quick Undo for ten seconds only (PO ruling 12)', () => {
    const { engine, state, ids, q, advance, now } = kickOff();
    const goal = engine.recordEvent(state, q, 'goal', ids[4]);
    advance(9_000);
    expect(canQuickUndo(goal, now())).toBe(true);
    advance(1_000);
    expect(canQuickUndo(goal, now())).toBe(false);
  });
});

describe('swapping positions during play (#83 AC4, #82 AC3/AC4)', () => {
  it('minutes carry on unbroken, and a keeper swap moves GK and outfield time at that moment', () => {
    const { engine, state, players, ids, q, advance } = kickOff();
    advance(10 * MIN);
    engine.swapPositions(state, q, ids[0], ids[1]); // P1 out of goal, P2 in
    advance(5 * MIN);
    const m = new Map(foldPlayerMinutes(engine, state, players).map((r) => [r.playerId, r] as [UUID, typeof r]));
    expect(m.get(ids[0])).toMatchObject({ goalkeeperMs: 10 * MIN, outfieldMs: 5 * MIN, totalMs: 15 * MIN });
    expect(m.get(ids[1])).toMatchObject({ goalkeeperMs: 5 * MIN, outfieldMs: 10 * MIN, totalMs: 15 * MIN });
  });

  it('records the position each stint was really played in', () => {
    const { engine, state, ids, q, advance } = kickOff();
    const before = state.appearances.find((a) => a.playerId === ids[2])!.positionId;
    const other = state.appearances.find((a) => a.playerId === ids[5])!.positionId;
    advance(MIN);
    engine.swapPositions(state, q, ids[2], ids[5]);
    const open = (id: UUID) => state.appearances.find((a) => a.playerId === id && a.endElapsedMs === null)!;
    expect(open(ids[2]).positionId).toBe(other);
    expect(open(ids[5]).positionId).toBe(before);
    expect(state.appearances.filter((a) => a.endReason === 'position_change')).toHaveLength(2);
  });

  it('refuses a swap with someone on the bench', () => {
    const { engine, state, ids, q } = kickOff();
    expect(() => engine.swapPositions(state, q, ids[2], ids[8])).toThrow(MatchEngineError);
  });
});

describe('the time stream', () => {
  it('lists events, subs and swaps in match-time order', () => {
    const { engine, state, players, ids, q, advance } = kickOff();
    advance(2 * MIN);
    const goal = engine.recordEvent(state, q, 'goal', ids[4]);
    advance(2 * MIN);
    engine.substitute(state, q, ids[6], ids[7]);
    advance(2 * MIN);
    engine.swapPositions(state, q, ids[2], ids[3]);
    engine.withdrawEvent(state, goal.id, 'offside');
    const rows = timeStream(state.appearances, state.events, players);
    expect(rows.map((r) => r.text)).toEqual([
      'Goal: P5',
      'Sub: P8 on for P7',
      'Swap: P3 and P4',
      'Withdrawn: offside',
    ]);
    expect(rows[0].withdrawn).toBe(true);
  });
});
