/**
 * Tests for the clock the coach looks at — REQ-01, issue #1.
 *
 * The important ones are the invariant-2 tests: the displayed value must be
 * identical whether the app was awake for the whole quarter or asleep for all
 * of it, because it is derived from wall-clock anchors rather than counted.
 */

import { describe, it, expect } from 'vitest';
import { MatchEngine } from '../engine/MatchEngine';
import { uuid } from '../types/index';
import type { Format, Position, UUID } from '../types/index';
import { formatClock, deriveClockView, currentQuarter } from './matchClock';

// --- fixtures ---------------------------------------------------------------

function makeFormat(onFieldCount = 7): Format {
  const formatId = uuid();
  const positions: Position[] = Array.from({ length: onFieldCount }, (_, i) => ({
    id: uuid(),
    formatId,
    label: i === 0 ? 'GK' : `P${i}`,
    kind: i === 0 ? ('goalkeeper' as const) : ('outfield' as const),
    sortOrder: i,
  }));
  return { id: formatId, name: `${onFieldCount}-a-side`, onFieldCount, positions };
}

/** A clock frozen at `t`, movable by the test. */
function makeClock(startMs: number) {
  let nowMs = startMs;
  return {
    nowFn: () => new Date(nowMs),
    advance: (ms: number) => {
      nowMs += ms;
    },
  };
}

function setUp(totalMinutes = 50, quarterCount = 4, startMs = 1_700_000_000_000) {
  const clock = makeClock(startMs);
  const engine = new MatchEngine({ nowFn: clock.nowFn });
  const format = makeFormat();
  const state = engine.createMatch(uuid(), format.id, { totalMinutes, quarterCount });
  const teamSheet = new Map<UUID, UUID>();
  for (const p of format.positions) teamSheet.set(p.id, uuid());
  return { clock, engine, format, state, teamSheet };
}

// --- formatClock ------------------------------------------------------------

describe('formatClock', () => {
  it('always pads both fields to two digits', () => {
    // The first release on a real phone showed "00:0". This is that assertion.
    expect(formatClock(0)).toBe('00:00');
    expect(formatClock(1_000)).toBe('00:01');
    expect(formatClock(9_000)).toBe('00:09');
    expect(formatClock(60_000)).toBe('01:00');
    expect(formatClock(9 * 60_000)).toBe('09:00');
    expect(formatClock(9 * 60_000 + 9_000)).toBe('09:09');
  });

  it('every output is exactly five characters MM:SS', () => {
    for (let s = 0; s < 60 * 100; s += 37) {
      const out = formatClock(s * 1000);
      expect(out).toMatch(/^\d{2}:\d{2}$/);
      expect(out).toHaveLength(5);
    }
  });

  it('truncates rather than rounds, so the clock never shows time not yet elapsed', () => {
    expect(formatClock(1_999)).toBe('00:01');
    expect(formatClock(59_999)).toBe('00:59');
  });

  it('clamps nonsense to zero rather than rendering it', () => {
    expect(formatClock(-1)).toBe('00:00');
    expect(formatClock(-60_000)).toBe('00:00');
    expect(formatClock(Number.NaN)).toBe('00:00');
    expect(formatClock(Number.POSITIVE_INFINITY)).toBe('00:00');
  });

  it('counts past an hour rather than wrapping', () => {
    expect(formatClock(100 * 60_000)).toBe('100:00');
  });
});

// --- invariant 2: wall-clock derivation, not tick counting ------------------

describe('invariant 2 — elapsed comes from wall-clock anchors', () => {
  it('shows the same time whether or not anything was called during the quarter', () => {
    const awake = setUp();
    awake.engine.startQuarter(awake.state, awake.state.quarters[0], awake.teamSheet, awake.format);
    // Simulate an app that repainted every second for five minutes.
    for (let i = 0; i < 300; i++) {
      awake.clock.advance(1_000);
      deriveClockView(awake.engine, awake.state);
    }

    const asleep = setUp();
    asleep.engine.startQuarter(
      asleep.state,
      asleep.state.quarters[0],
      asleep.teamSheet,
      asleep.format
    );
    // Simulate an app Android froze: one jump, nothing called in between.
    asleep.clock.advance(300_000);

    const a = deriveClockView(awake.engine, awake.state);
    const b = deriveClockView(asleep.engine, asleep.state);
    expect(a.quarterElapsedMs).toBe(b.quarterElapsedMs);
    expect(formatClock(a.quarterElapsedMs)).toBe('05:00');
    expect(formatClock(b.quarterElapsedMs)).toBe('05:00');
  });

  it('is a pure function of the instant: repeated calls at one instant agree', () => {
    const { engine, state, teamSheet, format, clock } = setUp();
    engine.startQuarter(state, state.quarters[0], teamSheet, format);
    clock.advance(90_000);
    const first = deriveClockView(engine, state);
    const second = deriveClockView(engine, state);
    const third = deriveClockView(engine, state);
    expect(second).toEqual(first);
    expect(third).toEqual(first);
  });
});

// --- the quarter lifecycle the coach sees -----------------------------------

describe('deriveClockView', () => {
  it('reads 00:00 and offers Start before kick-off', () => {
    const { engine, state } = setUp();
    const v = deriveClockView(engine, state);
    expect(formatClock(v.quarterElapsedMs)).toBe('00:00');
    expect(v.quarterLabel).toBe('Quarter 1 of 4');
    expect(v.isRunning).toBe(false);
    expect(v.canStart).toBe(true);
    expect(v.canEnd).toBe(false);
  });

  it('counts up while the quarter runs, and offers End not Start', () => {
    const { engine, state, teamSheet, format, clock } = setUp();
    engine.startQuarter(state, state.quarters[0], teamSheet, format);
    clock.advance(62_000);
    const v = deriveClockView(engine, state);
    expect(formatClock(v.quarterElapsedMs)).toBe('01:02');
    expect(v.isRunning).toBe(true);
    expect(v.canStart).toBe(false);
    expect(v.canEnd).toBe(true);
  });

  it('counts the remainder of the quarter down to zero', () => {
    // 50 minutes over 4 quarters is 12m30s each.
    const { engine, state, teamSheet, format, clock } = setUp(50, 4);
    engine.startQuarter(state, state.quarters[0], teamSheet, format);
    expect(formatClock(deriveClockView(engine, state).quarterRemainingMs)).toBe('12:30');
    clock.advance(2 * 60_000 + 30_000);
    expect(formatClock(deriveClockView(engine, state).quarterRemainingMs)).toBe('10:00');
  });

  it('holds the face at the planned length and flags overtime rather than running on', () => {
    const { engine, state, teamSheet, format, clock } = setUp(50, 4);
    engine.startQuarter(state, state.quarters[0], teamSheet, format);
    clock.advance(12 * 60_000 + 30_000 + 45_000); // 45s past the whistle
    const v = deriveClockView(engine, state);
    expect(v.isOvertime).toBe(true);
    expect(formatClock(v.quarterElapsedMs)).toBe('12:30');
    expect(formatClock(v.quarterRemainingMs)).toBe('00:00');
  });

  it('records actual elapsed when a quarter is ended late, not the nominal length', () => {
    const { engine, state, teamSheet, format, clock } = setUp(50, 4);
    engine.startQuarter(state, state.quarters[0], teamSheet, format);
    clock.advance(12 * 60_000 + 30_000 + 45_000);
    engine.endQuarter(state, state.quarters[0]);
    // The face capped at 12:30; the record keeps the 45 extra seconds.
    expect(engine.getQuarterElapsedMs(state.quarters[0])).toBe(13 * 60_000 + 15_000);
  });

  it('records actual elapsed when a quarter is ended early', () => {
    const { engine, state, teamSheet, format, clock } = setUp(50, 4);
    engine.startQuarter(state, state.quarters[0], teamSheet, format);
    clock.advance(4 * 60_000);
    engine.endQuarter(state, state.quarters[0]);
    expect(engine.getQuarterElapsedMs(state.quarters[0])).toBe(4 * 60_000);
  });

  it('moves to the next quarter, and the match total carries across', () => {
    const { engine, state, teamSheet, format, clock } = setUp(50, 4);
    engine.startQuarter(state, state.quarters[0], teamSheet, format);
    clock.advance(10 * 60_000);
    engine.endQuarter(state, state.quarters[0]);

    const v = deriveClockView(engine, state);
    expect(v.quarterLabel).toBe('Quarter 2 of 4');
    expect(v.isRunning).toBe(false);
    expect(v.canStart).toBe(true);
    expect(formatClock(v.quarterElapsedMs)).toBe('00:00');
    expect(formatClock(v.matchElapsedMs)).toBe('10:00');

    engine.startQuarter(state, state.quarters[1], teamSheet, format);
    clock.advance(3 * 60_000);
    expect(formatClock(deriveClockView(engine, state).matchElapsedMs)).toBe('13:00');
  });

  it('reports full time once every quarter has ended', () => {
    const { engine, state, teamSheet, format, clock } = setUp(40, 2);
    for (const q of state.quarters) {
      engine.startQuarter(state, q, teamSheet, format);
      clock.advance(20 * 60_000);
      engine.endQuarter(state, q);
    }
    const v = deriveClockView(engine, state);
    expect(v.isMatchOver).toBe(true);
    expect(v.quarterLabel).toBe('Full time');
    expect(v.canStart).toBe(false);
    expect(v.canEnd).toBe(false);
    expect(formatClock(v.matchElapsedMs)).toBe('40:00');
  });
});

describe('currentQuarter', () => {
  it('prefers the running quarter over the next pending one', () => {
    const { engine, state, teamSheet, format } = setUp();
    engine.startQuarter(state, state.quarters[0], teamSheet, format);
    expect(currentQuarter(state)?.index).toBe(1);
  });

  it('is null when nothing is left to play', () => {
    const { engine, state, teamSheet, format, clock } = setUp(40, 2);
    for (const q of state.quarters) {
      engine.startQuarter(state, q, teamSheet, format);
      clock.advance(60_000);
      engine.endQuarter(state, q);
    }
    expect(currentQuarter(state)).toBeNull();
  });
});
