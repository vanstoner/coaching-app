/**
 * The clock the coach actually looks at — REQ-01, issue #1.
 *
 * Pure TypeScript. No React, no platform imports, so every rule below is
 * provable without a device.
 *
 * Invariant 2 lives here. Nothing in this file increments anything. Every value
 * the screen shows is recomputed from the engine's wall-clock anchors on each
 * call. A repaint timer in the UI decides *when* to call `deriveClockView`; it
 * never contributes to *what* the value is. That is the whole distinction
 * between a clock that survives Android throttling one that silently loses
 * time, and it is why this is a function of state rather than a counter.
 */

import { MatchEngine } from '../engine/MatchEngine';
import type { MatchState } from '../engine/MatchEngine';
import type { Quarter } from '../types/index';

/**
 * Milliseconds as MM:SS, always two digits each.
 *
 * The first release showed "00:0" on a real phone, which is why the
 * zero-padding is asserted rather than assumed. Negative input clamps to zero:
 * a clock that reads "-0:01" is a bug report from a coach, not a feature.
 * Beyond 99:59 it keeps counting in minutes (100:00) rather than wrapping,
 * because a wrapped clock is worse than a wide one.
 */
export function formatClock(ms: number): string {
  const safe = Number.isFinite(ms) && ms > 0 ? ms : 0;
  const totalSeconds = Math.floor(safe / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/** What the screen needs to render. Everything derived, nothing stored. */
export interface ClockView {
  /** e.g. "Quarter 2 of 4". */
  quarterLabel: string;
  /** Elapsed in the current quarter, capped at the planned length. */
  quarterElapsedMs: number;
  /** Planned length minus elapsed, floored at zero. */
  quarterRemainingMs: number;
  /** Elapsed across every quarter that has started. */
  matchElapsedMs: number;
  /** True while a quarter is running. */
  isRunning: boolean;
  /**
   * True when a running quarter has passed its planned length. The clock face
   * holds at the planned length — "hard stop at quarter end" — and the screen
   * tells the coach to end the quarter. The engine keeps the real elapsed, so
   * ending late records actual time, not nominal.
   */
  isOvertime: boolean;
  /** True when the match has no quarters left to start. */
  isMatchOver: boolean;
  canStart: boolean;
  canEnd: boolean;
}

/** The quarter the coach is looking at: the running one, else the next pending. */
export function currentQuarter(state: MatchState): Quarter | null {
  return (
    state.quarters.find((q) => q.status === 'running') ??
    state.quarters.find((q) => q.status === 'pending') ??
    null
  );
}

/**
 * Derive everything the screen shows from the engine's anchors.
 *
 * Call it as often as you like — it is a function of (state, now) with no
 * memory between calls, so calling it once a second and calling it once after
 * ten minutes in the background give the same answer for the same instant.
 */
export function deriveClockView(engine: MatchEngine, state: MatchState): ClockView {
  const plannedMs = engine.getPlannedQuarterMs(state.match);
  const quarter = currentQuarter(state);
  const matchElapsedMs = engine.getMatchElapsedMs(state);

  if (!quarter) {
    return {
      quarterLabel: 'Full time',
      quarterElapsedMs: 0,
      quarterRemainingMs: 0,
      matchElapsedMs,
      isRunning: false,
      isOvertime: false,
      isMatchOver: true,
      canStart: false,
      canEnd: false,
    };
  }

  const isRunning = quarter.status === 'running';
  const rawElapsed = isRunning ? engine.getQuarterElapsedMs(quarter) : 0;
  const isOvertime = isRunning && rawElapsed >= plannedMs;

  return {
    quarterLabel: `Quarter ${quarter.index} of ${state.match.quarterCount}`,
    quarterElapsedMs: Math.min(rawElapsed, plannedMs),
    quarterRemainingMs: Math.max(plannedMs - rawElapsed, 0),
    matchElapsedMs,
    isRunning,
    isOvertime,
    isMatchOver: false,
    canStart: !isRunning,
    canEnd: isRunning,
  };
}
