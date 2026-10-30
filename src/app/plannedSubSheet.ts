/**
 * The planned-sub sheet — #264 V17 to V23 (Rob's design, 29 Oct).
 *
 * A bench child is a row; tapping it opens "*name* comes on" with **At** (a
 * compact −|+ stepper) and, separately, **For** (whoever is on longest first,
 * then the children on the pitch). Cancel changes nothing; Save writes the
 * plan through the existing `subPlan.ts` functions. Pure: the sheet holds a
 * draft and asks here what each press does.
 *
 * The stepper keeps today's rules exactly (V18, V19, Rob: *"the first + makes
 * it half way through the quarter/half"*):
 *
 * - From No sub, + goes to the period's midpoint (`defaultSubTimeMs`), then
 *   each press moves by the screen's step.
 * - On the Lineup, − from the earliest time returns to No sub (`nudgeSubTime`).
 * - Nothing ever leaves the period.
 */

import { formatSubTime } from './matchClock';
import { NO_SUB_PLANNED, nudgeSubTime, type PlannedSub } from './subPlan';
import type { UUID } from '../types/index';

/** The Lineup's step: 30 s, as today (V19). The Plan keeps its 15 s (Q2). */
export const LINEUP_SUB_STEP_MS = 30_000;

/** The sheet's draft: a time (or No sub) and who comes off (null: whoever is on longest). */
export interface SubDraft {
  atMs: number;
  forPlayerId: UUID | null;
}

const PROBE = 'draft' as UUID;

/**
 * One press of the Lineup sheet's stepper, by `nudgeSubTime`'s rules: the
 * first + is the midpoint, − from the earliest is No sub.
 */
export function stepLineupSub(atMs: number, deltaMs: number, periodMs: number): number {
  const probe: PlannedSub[] = [{ playerId: PROBE, atMs, forPlayerId: null, done: false }];
  return nudgeSubTime(probe, PROBE, deltaMs, periodMs)[0].atMs;
}

/** The value beside the stepper: "No sub" or "6:15". */
export function subTimeValue(atMs: number): string {
  return atMs === NO_SUB_PLANNED ? 'No sub' : formatSubTime(atMs);
}

/** The words for "whoever is on longest", in one place. */
export const LONGEST_ON = 'whoever is on longest';

/**
 * The light text after a bench child's name once a sub is saved (V22):
 * "on at 6:00 for Ben", "on at 6:00 for whoever is on longest", or nothing
 * when no time is set.
 */
export function plannedSubText(atMs: number, forName: string | null): string {
  if (atMs === NO_SUB_PLANNED) return '';
  return `on at ${formatSubTime(atMs)} for ${forName ?? LONGEST_ON}`;
}

/** The Bench heading's summary (V23). */
export function subsPlannedSummary(count: number): string {
  if (count <= 0) return 'No subs planned';
  return count === 1 ? '1 sub planned' : `${count} subs planned`;
}

/**
 * Save the sheet: the draft written into the plan for this child. With the
 * time at No sub the plan is taken away, and who comes off goes back to the
 * suggestion (V22).
 */
export function saveSubDraft(plan: PlannedSub[], playerId: UUID, draft: SubDraft): PlannedSub[] {
  return plan.map((s) =>
    s.playerId === playerId
      ? {
          ...s,
          atMs: draft.atMs === NO_SUB_PLANNED ? NO_SUB_PLANNED : draft.atMs,
          forPlayerId: draft.atMs === NO_SUB_PLANNED ? null : draft.forPlayerId,
        }
      : s
  );
}

/** The draft a sheet opens with: the saved time and choice, or No sub. */
export function draftFor(plan: PlannedSub[], playerId: UUID): SubDraft {
  const entry = plan.find((s) => s.playerId === playerId);
  return { atMs: entry?.atMs ?? NO_SUB_PLANNED, forPlayerId: entry?.forPlayerId ?? null };
}
