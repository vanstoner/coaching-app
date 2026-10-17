/**
 * Shot on target — #202. Acceptance criteria are on the issue; each test
 * names the one it proves.
 */

import { describe, it, expect } from 'vitest';
import { MatchEngine } from '../engine/MatchEngine';
import { uuid } from '../types/index';
import type { Player, UUID } from '../types/index';
import { makePlayer } from './squad';
import { makeFormat } from './shapes';
import { sheetFromSelection, toTeamSheet } from './teamSheet';
import { matchReport } from './analysis';
import { emptyLedger, parseLedger, recordMatches, serialiseLedger } from './ledger';
import { periodEndChoices, PERIOD_END_MARGIN_MS } from './periodEnd';
import { TAP_LABEL, UNDO_NOTE, talliesOf, tapEventsFor, timeStream } from './matchEvents';

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

const shotsOf = (events: Parameters<typeof talliesOf>[0], id: UUID) =>
  talliesOf(events).find((t) => t.playerId === id)?.shotsOnTarget ?? 0;

describe('recording a shot on target (#202 AC1)', () => {
  it('is offered to anyone on the pitch, keeper included, next to Goal', () => {
    expect(tapEventsFor(false).slice(0, 2)).toEqual(['goal', 'shot_on_target']);
    expect(tapEventsFor(true)).toContain('shot_on_target');
    expect(TAP_LABEL.shot_on_target).toBe('Shot on target');
  });

  it('is credited to the shooter at the match time of the tap, and reads on the time stream', () => {
    const { engine, state, players, ids, q, advance } = kickOff();
    advance(4 * MIN);
    const e = engine.recordEvent(state, q, 'shot_on_target', ids[3]);
    expect(e.playerId).toBe(ids[3]);
    expect(e.atElapsedMs).toBe(4 * MIN);
    expect(timeStream(state.appearances, state.events, players).map((r) => r.text)).toContain('Shot on target: P4');
  });

  it('Undo takes it back, and it no longer counts', () => {
    const { engine, state, ids, q } = kickOff();
    const e = engine.recordEvent(state, q, 'shot_on_target', ids[3]);
    expect(shotsOf(state.events, ids[3])).toBe(1);
    engine.withdrawEvent(state, e.id, UNDO_NOTE);
    expect(shotsOf(state.events, ids[3])).toBe(0);
  });
});

describe('a goal is a shot on target (#202 AC2)', () => {
  it('two tapped shots and a goal make three, with no second tap for the goal', () => {
    const { engine, state, ids, q } = kickOff();
    engine.recordEvent(state, q, 'shot_on_target', ids[4]);
    engine.recordEvent(state, q, 'shot_on_target', ids[4]);
    engine.recordEvent(state, q, 'goal', ids[4]);
    expect(shotsOf(state.events, ids[4])).toBe(3);
  });

  it('a withdrawn goal is no longer a shot on target', () => {
    const { engine, state, ids, q } = kickOff();
    const goal = engine.recordEvent(state, q, 'goal', ids[4]);
    engine.withdrawEvent(state, goal.id, 'not a goal');
    expect(shotsOf(state.events, ids[4])).toBe(0);
  });

  it('nothing about it is stored: the event log holds only what was tapped', () => {
    const { engine, state, ids, q } = kickOff();
    engine.recordEvent(state, q, 'goal', ids[4]);
    expect((state.events ?? []).map((e) => e.kind)).toEqual(['goal']);
  });
});

describe('the match report (#202 AC3, open question 2)', () => {
  it('Play lists tapped shots with goals included; a player who only scored stays in Scorers', () => {
    const { engine, state, players, ids, q, format } = kickOff();
    engine.recordEvent(state, q, 'shot_on_target', ids[2]);
    engine.recordEvent(state, q, 'goal', ids[2]);
    engine.recordEvent(state, q, 'goal', ids[5]); // a goal and nothing else
    const report = matchReport(engine, state, players, format);
    expect(report.play.map((p) => [p.name, p.shotsOnTarget])).toEqual([['P3', 2]]);
    expect(report.scorers.map((s) => s.name).sort()).toEqual(['P3', 'P6']);
  });

  it("their shots on target are our saves plus the goals against", () => {
    const { engine, state, players, ids, q, format } = kickOff();
    engine.recordEvent(state, q, 'save', ids[0]);
    engine.recordEvent(state, q, 'save', ids[0]);
    engine.recordEvent(state, q, 'conceded', ids[0]);
    expect(matchReport(engine, state, players, format).theirShotsOnTarget).toBe(3);
  });
});

describe('period end (#202 AC4)', () => {
  it('a shot on target after planned time is the floor, and says so', () => {
    const { engine, state, ids, q, advance } = kickOff();
    const planned = engine.getPlannedQuarterMs(state.match);
    advance(planned + 20_000);
    engine.recordEvent(state, q, 'shot_on_target', ids[2]);
    advance(PERIOD_END_MARGIN_MS);
    const choices = periodEndChoices(engine, state, q)!;
    expect(choices.planned.atMs).toBe(planned + 20_000);
    expect(choices.planned.label).toMatch(/\(last shot on target\)$/);
  });
});

describe('the minutes record (#202 AC5, AC6)', () => {
  it('records it as an event and reads it back unchanged', () => {
    const { engine, state, players, ids, q } = kickOff();
    engine.recordEvent(state, q, 'shot_on_target', ids[3]);
    const ledger = recordMatches(emptyLedger(state.match.squadId, 'Test FC'), [state], players, 'Test FC', new Date(1));
    const parsed = parseLedger(serialiseLedger(ledger));
    if (!parsed.ok) throw new Error(parsed.reason);
    const events = parsed.ledger.matches[0].events ?? [];
    expect(events.map((e) => [e.kind, e.playerId])).toEqual([['shot_on_target', ids[3]]]);
  });

  it('never feeds the score', () => {
    const { engine, state, players, ids, q, format } = kickOff();
    engine.recordEvent(state, q, 'shot_on_target', ids[3]);
    expect(matchReport(engine, state, players, format).score).toEqual({ us: 0, them: 0 });
  });
});
