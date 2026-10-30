/**
 * #264 E1, E2: the planned-sub sheet's stepper, its light text, and the
 * Bench heading's summary.
 */

import { describe, expect, it } from 'vitest';
import {
  LINEUP_SUB_STEP_MS,
  draftFor,
  plannedSubText,
  saveSubDraft,
  stepLineupSub,
  subTimeValue,
  subsPlannedSummary,
} from './plannedSubSheet';
import { moveSubTime } from './clockSubs';
import { SUB_STEP_MS, clampSwapTime, newSubTimeMs } from './matchPlan';
import { NO_SUB_PLANNED, type PlannedSub } from './subPlan';
import type { UUID } from '../types/index';

const QUARTER = 12.5 * 60_000; // 12:30
const HALF = 25 * 60_000; // 25:00

describe('the stepper (V18, V19, E1)', () => {
  it('from No sub, the first + goes to the midpoint', () => {
    expect(stepLineupSub(NO_SUB_PLANNED, LINEUP_SUB_STEP_MS, QUARTER)).toBe(6 * 60_000 + 15_000);
    expect(stepLineupSub(NO_SUB_PLANNED, LINEUP_SUB_STEP_MS, HALF)).toBe(12 * 60_000 + 30_000);
  });

  it('then each press moves by the step', () => {
    const mid = stepLineupSub(NO_SUB_PLANNED, LINEUP_SUB_STEP_MS, QUARTER);
    expect(stepLineupSub(mid, LINEUP_SUB_STEP_MS, QUARTER)).toBe(mid + 30_000);
    expect(stepLineupSub(mid, -LINEUP_SUB_STEP_MS, QUARTER)).toBe(mid - 30_000);
  });

  it('on the Lineup, − from the earliest returns to No sub, and − from No sub stays', () => {
    expect(stepLineupSub(20_000, -LINEUP_SUB_STEP_MS, QUARTER)).toBe(NO_SUB_PLANNED);
    expect(stepLineupSub(NO_SUB_PLANNED, -LINEUP_SUB_STEP_MS, QUARTER)).toBe(NO_SUB_PLANNED);
  });

  it('never leaves the period', () => {
    expect(stepLineupSub(QUARTER - 10_000, LINEUP_SUB_STEP_MS, QUARTER)).toBeLessThan(QUARTER);
  });

  it('on the clock, − never removes a sub (moveSubTime, unchanged)', () => {
    const id = 'a' as UUID;
    const plan: PlannedSub[] = [{ playerId: id, atMs: 20_000, forPlayerId: null, done: false }];
    expect(moveSubTime(plan, id, -30_000, QUARTER)[0].atMs).toBe(1_000);
  });

  it('the Plan keeps its 15 s step and its midpoint (Q2)', () => {
    expect(SUB_STEP_MS).toBe(15_000);
    expect(newSubTimeMs(QUARTER)).toBe(6 * 60_000 + 15_000);
    expect(clampSwapTime(0, QUARTER)).toBe(15_000);
  });

  it('shows No sub or the time', () => {
    expect(subTimeValue(NO_SUB_PLANNED)).toBe('No sub');
    expect(subTimeValue(6 * 60_000)).toBe('6:00');
  });
});

describe('the plan by the name, and the Bench summary (V22, V23, E2)', () => {
  it('reads as Rob drew it', () => {
    expect(plannedSubText(6 * 60_000, null)).toBe('on at 6:00 for whoever is on longest');
    expect(plannedSubText(6 * 60_000, 'Ben')).toBe('on at 6:00 for Ben');
    expect(plannedSubText(NO_SUB_PLANNED, 'Ben')).toBe('');
  });

  it('counts the subs planned', () => {
    expect(subsPlannedSummary(0)).toBe('No subs planned');
    expect(subsPlannedSummary(1)).toBe('1 sub planned');
    expect(subsPlannedSummary(3)).toBe('3 subs planned');
  });
});

describe('Save and Cancel (V21, V22)', () => {
  const hana = 'h' as UUID;
  const ben = 'b' as UUID;
  const jo = 'j' as UUID;
  const plan: PlannedSub[] = [
    { playerId: hana, atMs: NO_SUB_PLANNED, forPlayerId: null, done: false },
    { playerId: jo, atMs: 90_000, forPlayerId: ben, done: false },
  ];

  it('a sheet opens on what is saved', () => {
    expect(draftFor(plan, hana)).toEqual({ atMs: NO_SUB_PLANNED, forPlayerId: null });
    expect(draftFor(plan, jo)).toEqual({ atMs: 90_000, forPlayerId: ben });
  });

  it('Save writes this child only', () => {
    const next = saveSubDraft(plan, hana, { atMs: 375_000, forPlayerId: ben });
    expect(next[0]).toMatchObject({ atMs: 375_000, forPlayerId: ben });
    expect(next[1]).toBe(plan[1]);
  });

  it('saving at No sub takes the plan away, and who comes off with it', () => {
    const next = saveSubDraft(plan, jo, { atMs: NO_SUB_PLANNED, forPlayerId: ben });
    expect(next[1]).toMatchObject({ atMs: NO_SUB_PLANNED, forPlayerId: null });
  });
});
