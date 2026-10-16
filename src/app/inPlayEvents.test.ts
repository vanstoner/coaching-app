/**
 * Tackles, corners and free kicks won, and assists — #185 AC2–AC8.
 */

import { describe, it, expect } from 'vitest';
import { MatchEngine, MatchEngineError } from '../engine/MatchEngine';
import { uuid } from '../types/index';
import type { Player, UUID } from '../types/index';
import { makePlayer } from './squad';
import { makeFormat } from './shapes';
import { sheetFromSelection, toTeamSheet } from './teamSheet';
import { matchReport } from './analysis';
import { periodEndChoices, PERIOD_END_MARGIN_MS } from './periodEnd';
import {
  UNDO_NOTE,
  assistCandidates,
  eventGridColumns,
  eventGridRows,
  isWithdrawn,
  scoreOf,
  talliesOf,
  tapEventsFor,
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
  return { engine, state, players, ids, q, format, advance: (ms: number) => (nowMs += ms) };
}

const tallyOf = (events: Parameters<typeof talliesOf>[0], id: UUID) =>
  talliesOf(events).find((t) => t.playerId === id);

describe('the picture buttons offered (AC1)', () => {
  it('anyone on the pitch: Goal, Tackle, Corner won, Free kick won; the keeper adds Save and Conceded first', () => {
    expect(tapEventsFor(false)).toEqual(['goal', 'tackle', 'corner', 'free_kick']);
    expect(tapEventsFor(true)).toEqual(['save', 'conceded', 'goal', 'tackle', 'corner', 'free_kick']);
  });
});

describe('the picture buttons are laid out evenly', () => {
  it('four are a 2 x 2 square, six are two rows of three', () => {
    expect(eventGridRows(tapEventsFor(false)).map((r) => r.length)).toEqual([2, 2]);
    expect(eventGridRows(tapEventsFor(true)).map((r) => r.length)).toEqual([3, 3]);
  });

  it('no row is a single stub unless there is only one button, and nothing is lost or reordered', () => {
    for (let n = 1; n <= 6; n++) {
      const items = Array.from({ length: n }, (_, i) => i);
      const rows = eventGridRows(items);
      expect(rows.flat()).toEqual(items);
      expect(rows.every((r) => r.length <= eventGridColumns(n))).toBe(true);
      if (n > 1) expect(rows[rows.length - 1].length).toBeGreaterThan(1);
    }
    expect(eventGridRows([])).toEqual([]);
  });
});

describe('tackles, corners won and free kicks won (AC2)', () => {
  it('are recorded for the player, at the match time of the tap', () => {
    const { engine, state, ids, q, advance } = kickOff();
    advance(4 * MIN);
    engine.recordEvent(state, q, 'tackle', ids[2]);
    advance(MIN);
    engine.recordEvent(state, q, 'corner', ids[3]);
    engine.recordEvent(state, q, 'free_kick', ids[3]);
    engine.recordEvent(state, q, 'tackle', ids[0]); // the keeper can tackle too

    expect(state.events!.map((e) => [e.kind, e.atElapsedMs])).toEqual([
      ['tackle', 4 * MIN],
      ['corner', 5 * MIN],
      ['free_kick', 5 * MIN],
      ['tackle', 5 * MIN],
    ]);
    expect(tallyOf(state.events, ids[2])).toMatchObject({ tackles: 1, corners: 0, freeKicks: 0 });
    expect(tallyOf(state.events, ids[3])).toMatchObject({ tackles: 0, corners: 1, freeKicks: 1 });
  });

  it('are refused for a player on the bench, or between periods, as a goal is', () => {
    const { engine, state, ids, q } = kickOff();
    for (const kind of ['tackle', 'corner', 'free_kick'] as const) {
      expect(() => engine.recordEvent(state, q, kind, ids[8])).toThrow(MatchEngineError);
    }
    engine.endQuarter(state, q);
    expect(() => engine.recordEvent(state, q, 'corner', ids[3])).toThrow(MatchEngineError);
  });

  it('never change the score (AC8)', () => {
    const { engine, state, ids, q } = kickOff();
    engine.recordEvent(state, q, 'tackle', ids[2]);
    engine.recordEvent(state, q, 'corner', ids[2]);
    engine.recordEvent(state, q, 'free_kick', ids[2]);
    expect(scoreOf(state.events)).toEqual({ us: 0, them: 0 });
  });
});

describe('an assist hangs off a goal (AC3, AC4)', () => {
  it('offers everyone on the pitch but the scorer', () => {
    const { ids } = kickOff();
    expect(assistCandidates(ids.slice(0, 7), ids[4])).toEqual([ids[0], ids[1], ids[2], ids[3], ids[5], ids[6]]);
  });

  it('is credited to the chosen player, linked to the goal, at the goal’s moment', () => {
    const { engine, state, ids, q, advance } = kickOff();
    advance(7 * MIN);
    const goal = engine.recordEvent(state, q, 'goal', ids[4]);
    advance(3_000); // the coach picks the passer a few seconds later
    const assist = engine.recordAssist(state, goal.id, ids[5]);
    expect(assist).toMatchObject({ kind: 'assist', playerId: ids[5], refersTo: goal.id, atElapsedMs: 7 * MIN });
    expect(tallyOf(state.events, ids[5])!.assists).toBe(1);
    expect(tallyOf(state.events, ids[4])).toMatchObject({ goals: 1, assists: 0 });
    expect(scoreOf(state.events).us).toBe(1); // AC8: an assist is not a goal
  });

  it('a goal with no assist simply stands', () => {
    const { engine, state, ids, q } = kickOff();
    engine.recordEvent(state, q, 'goal', ids[4]);
    expect(scoreOf(state.events).us).toBe(1);
    expect(talliesOf(state.events).every((t) => t.assists === 0)).toBe(true);
  });

  it('is refused for the scorer, a player on the bench, a second assist, or a withdrawn goal', () => {
    const { engine, state, ids, q } = kickOff();
    const goal = engine.recordEvent(state, q, 'goal', ids[4]);
    expect(() => engine.recordAssist(state, goal.id, ids[4])).toThrow(MatchEngineError);
    expect(() => engine.recordAssist(state, goal.id, ids[8])).toThrow(MatchEngineError);
    engine.recordAssist(state, goal.id, ids[5]);
    expect(() => engine.recordAssist(state, goal.id, ids[6])).toThrow(MatchEngineError);

    const tackle = engine.recordEvent(state, q, 'tackle', ids[2]);
    expect(() => engine.recordAssist(state, tackle.id, ids[5])).toThrow(MatchEngineError);

    const other = engine.recordEvent(state, q, 'goal', ids[3]);
    engine.withdrawEvent(state, other.id, UNDO_NOTE);
    expect(() => engine.recordAssist(state, other.id, ids[5])).toThrow(MatchEngineError);
  });

  it('a withdrawn assist can be replaced by the right one', () => {
    const { engine, state, ids, q } = kickOff();
    const goal = engine.recordEvent(state, q, 'goal', ids[4]);
    const wrong = engine.recordAssist(state, goal.id, ids[5]);
    engine.withdrawEvent(state, wrong.id, 'wrong passer');
    engine.recordAssist(state, goal.id, ids[6]);
    expect(tallyOf(state.events, ids[5])).toBeUndefined(); // nothing left standing
    expect(tallyOf(state.events, ids[6])!.assists).toBe(1);
  });

  it('AC4/AC5: withdrawing the goal takes the assist out of every count, and both stay in the log', () => {
    const { engine, state, ids, q } = kickOff();
    const goal = engine.recordEvent(state, q, 'goal', ids[4]);
    const assist = engine.recordAssist(state, goal.id, ids[5]);
    engine.withdrawEvent(state, goal.id, UNDO_NOTE); // the one-tap Undo

    expect(scoreOf(state.events).us).toBe(0);
    expect(talliesOf(state.events).find((t) => t.playerId === ids[5])).toBeUndefined();
    expect(isWithdrawn(state.events, assist.id)).toBe(true);
    expect(state.events!.map((e) => e.kind)).toEqual(['goal', 'assist', 'withdrawn']);
  });
});

describe('the time stream and the summary (AC6, AC7)', () => {
  it('names each new event in words, and an assist names whose goal it was', () => {
    const { engine, state, players, ids, q, advance } = kickOff();
    advance(MIN);
    engine.recordEvent(state, q, 'tackle', ids[2]);
    advance(MIN);
    engine.recordEvent(state, q, 'corner', ids[3]);
    advance(MIN);
    engine.recordEvent(state, q, 'free_kick', ids[3]);
    advance(MIN);
    const goal = engine.recordEvent(state, q, 'goal', ids[4]);
    engine.recordAssist(state, goal.id, ids[5]);

    const rows = timeStream(state.appearances, state.events, players);
    expect(rows.map((r) => r.text)).toEqual([
      'Tackle: P3',
      'Corner won: P4',
      'Free kick won: P4',
      'Goal: P5',
      "Assist: P6 (P5's goal)",
    ]);
    expect(rows.every((r) => r.eventId !== null)).toBe(true); // AC6: each can be withdrawn
  });

  it('shows an assist as withdrawn once its goal is', () => {
    const { engine, state, players, ids, q } = kickOff();
    const goal = engine.recordEvent(state, q, 'goal', ids[4]);
    engine.recordAssist(state, goal.id, ids[5]);
    engine.withdrawEvent(state, goal.id, UNDO_NOTE);
    const assistRow = timeStream(state.appearances, state.events, players).find((r) => r.text.startsWith('Assist'));
    expect(assistRow!.withdrawn).toBe(true);
  });

  it('the match report lists each player’s assists, tackles, corners and free kicks won', () => {
    const { engine, state, players, ids, q, format } = kickOff();
    const goal = engine.recordEvent(state, q, 'goal', ids[4]);
    engine.recordAssist(state, goal.id, ids[5]);
    engine.recordEvent(state, q, 'tackle', ids[5]);
    engine.recordEvent(state, q, 'tackle', ids[2]);
    engine.recordEvent(state, q, 'corner', ids[2]);
    engine.recordEvent(state, q, 'free_kick', ids[2]);

    const report = matchReport(engine, state, players, format);
    expect(report.play).toEqual([
      { playerId: ids[2], name: 'P3', assists: 0, tackles: 1, corners: 1, freeKicks: 1 },
      { playerId: ids[5], name: 'P6', assists: 1, tackles: 1, corners: 0, freeKicks: 0 },
    ]);
    // The scorer has only a goal, so is not in Play.
    expect(report.scorers.map((s) => s.name)).toEqual(['P5']);
  });

  it('a match with none of the new events has an empty Play list (AC9)', () => {
    const { engine, state, players, ids, q, format } = kickOff();
    engine.recordEvent(state, q, 'goal', ids[4]);
    expect(matchReport(engine, state, players, format).play).toEqual([]);
  });
});

describe('the last-event floor counts the new events (#180)', () => {
  it('a tackle after planned time is the floor, and says so', () => {
    const { engine, state, ids, q, advance } = kickOff();
    const planned = engine.getPlannedQuarterMs(state.match);
    advance(planned + 30_000);
    engine.recordEvent(state, q, 'tackle', ids[2]);
    advance(PERIOD_END_MARGIN_MS);
    const choices = periodEndChoices(engine, state, q)!;
    expect(choices.planned.atMs).toBe(planned + 30_000);
    expect(choices.planned.label).toMatch(/\(last tackle\)$/);
  });
});
