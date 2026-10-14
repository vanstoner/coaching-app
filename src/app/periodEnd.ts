/**
 * The forgotten clock — #180 (PO: `approve 7`, "the smallest version").
 *
 * When the coach taps End period long after the period should have ended,
 * the app asks when it ended rather than crediting everyone on the pitch
 * with the overrun. The words and rules are Rob's Spec 02 rulings:
 *
 * - "Ended at planned time" / "Ended just now" / "Still playing" (PR #20).
 * - The margin defaults to one minute (#18); a squad setting for it is out
 *   of scope here, so it is fixed.
 * - "The earliest allowed end is the last recorded event, and 'Ended at
 *   planned time' shows as 'Ended at <last event time> (last sub)' when an
 *   event came after planned length" (PR #20, open question 7).
 *
 * Within the margin nothing is asked and End works as it always has.
 */

import type { MatchEngine, MatchState } from '../engine/MatchEngine';
import type { Quarter } from '../types/index';
import { formatClock } from './matchClock';

/** Spec 02 default margin (#18): one minute past planned length. */
export const PERIOD_END_MARGIN_MS = 60_000;

const LAST_LABEL = {
  sub: 'last sub',
  swap: 'last swap',
  goal: 'last goal',
  save: 'last save',
  conceded: 'last goal conceded',
} as const;

export interface PeriodEndChoices {
  /** "Ended at planned time", floored at the last recorded event. */
  planned: { atMs: number; label: string };
  /** "Ended just now": the period's elapsed time at the tap. */
  now: { atMs: number; label: string };
}

/**
 * The choices to offer when End is tapped, or null to end at once as before.
 * Read from the anchors at the moment of the tap (invariant 2).
 */
export function periodEndChoices(
  engine: MatchEngine,
  state: MatchState,
  quarter: Quarter
): PeriodEndChoices | null {
  if (quarter.status !== 'running') return null;
  const elapsed = engine.getQuarterElapsedMs(quarter);
  const planned = engine.getPlannedQuarterMs(state.match);
  if (elapsed <= planned + PERIOD_END_MARGIN_MS) return null;

  const last = engine.lastRecordedInQuarter(state, quarter);
  const floored = last !== null && last.atMs > planned;
  return {
    planned: floored
      ? { atMs: last.atMs, label: `Ended at ${formatClock(last.atMs)} (${LAST_LABEL[last.kind]})` }
      : { atMs: planned, label: 'Ended at planned time' },
    now: { atMs: elapsed, label: `Ended just now (${formatClock(elapsed)})` },
  };
}
