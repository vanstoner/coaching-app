/**
 * #264 E1, E2: the planned-sub sheet's stepper, its light text, and the
 * Bench heading's summary.
 */

import { describe, expect, it } from 'vitest';
import {
  LINEUP_SUB_STEP_MS,
  chooseFor,
  draftFor,
  stepDraft,
  plannedSubText,
  saveSubDraft,
  stepLineupSub,
  subTimeValue,
  subsPlannedSummary,
} from './plannedSubSheet';
import { moveSubTime } from './clockSubs';
import { SUB_STEP_MS, clampSwapTime, newSubTimeMs } from './matchPlan';
import { NO_SUB_PLANNED, isPlanned, warnedSubs, type PlannedSub } from './subPlan';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

describe('choosing who comes off plans the sub (#293, Rob\'s ruling (a), 19 Nov)', () => {
  const hana = 'h' as UUID;
  const ben = 'b' as UUID;
  const plan: PlannedSub[] = [{ playerId: hana, atMs: NO_SUB_PLANNED, forPlayerId: null, done: false }];

  it('the sheet still opens at No sub (Rob: "always start with no sub then increment")', () => {
    expect(draftFor(plan, hana)).toEqual({ atMs: NO_SUB_PLANNED, forPlayerId: null });
  });

  it('from No sub, choosing a child under For sets At to halfway, shown before Save', () => {
    const draft = chooseFor(draftFor(plan, hana), ben, QUARTER);
    expect(draft).toEqual({ atMs: 6 * 60_000 + 15_000, forPlayerId: ben });
    expect(subTimeValue(draft.atMs)).toBe('6:15');
  });

  it('so does choosing Whoever is on longest', () => {
    expect(chooseFor(draftFor(plan, hana), null, HALF)).toEqual({ atMs: 12 * 60_000 + 30_000, forPlayerId: null });
  });

  it('a time already set is kept', () => {
    expect(chooseFor({ atMs: 90_000, forPlayerId: null }, ben, QUARTER)).toEqual({ atMs: 90_000, forPlayerId: ben });
  });

  it('Rob\'s steps (a bench child, a name under For, Save) plan the sub: the bench row says so and it counts', () => {
    const saved = saveSubDraft(plan, hana, chooseFor(draftFor(plan, hana), ben, QUARTER));
    expect(isPlanned(saved[0])).toBe(true);
    expect(plannedSubText(saved[0].atMs, 'Ben')).toBe('on at 6:15 for Ben');
    expect(subsPlannedSummary(saved.filter(isPlanned).length)).toBe('1 sub planned');
  });

  it('on the clock its prompt rises 30 s before its time, not before', () => {
    const saved = saveSubDraft(plan, hana, chooseFor(draftFor(plan, hana), ben, QUARTER));
    expect(warnedSubs(saved, 6 * 60_000 + 15_000 - 30_000 - 1)).toEqual([]);
    expect(warnedSubs(saved, 6 * 60_000 + 15_000 - 30_000).map((s) => s.playerId)).toEqual([hana]);
  });

  it('2.4.0\'s path dropped it: a name chosen at No sub, saved, planned nothing', () => {
    // What the sheet sent before #293: the For choice alone, At still No sub.
    const before = saveSubDraft(plan, hana, { atMs: NO_SUB_PLANNED, forPlayerId: ben });
    expect(isPlanned(before[0])).toBe(false);
  });

  it('the Lineup\'s For rows go through chooseFor, never setting forPlayerId alone', () => {
    const src = readFileSync(join(__dirname, '../screens/LineupScreen.tsx'), 'utf8');
    expect(src.match(/chooseFor\(subSheet\.draft, /g)?.length).toBe(2);
    expect(src).not.toMatch(/draft: \{ \.\.\.subSheet\.draft, forPlayerId:/);
  });
});

describe('− back to No sub clears who comes off (#293 C2)', () => {
  const ben = 'b' as UUID;
  it('from the earliest time, − is No sub and the For choice goes with it, so the sheet shows nothing Save would drop', () => {
    expect(stepDraft({ atMs: 30_000, forPlayerId: ben }, -LINEUP_SUB_STEP_MS, QUARTER)).toEqual({ atMs: NO_SUB_PLANNED, forPlayerId: null });
  });
  it('a − that stays on a time keeps the choice; + from No sub still lands on halfway', () => {
    expect(stepDraft({ atMs: 375_000, forPlayerId: ben }, -LINEUP_SUB_STEP_MS, QUARTER)).toEqual({ atMs: 345_000, forPlayerId: ben });
    expect(stepDraft({ atMs: NO_SUB_PLANNED, forPlayerId: null }, LINEUP_SUB_STEP_MS, QUARTER).atMs).toBe(375_000);
  });
  it('the Lineup\'s − goes through stepDraft', () => {
    const src = readFileSync(join(__dirname, '../screens/LineupScreen.tsx'), 'utf8');
    expect(src).toMatch(/draft: stepDraft\(subSheet\.draft, -LINEUP_SUB_STEP_MS, periodMs\)/);
  });
});
