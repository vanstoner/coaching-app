/**
 * #293 criterion 5 (Rob, 19 Nov, "approve criteria 293 (a)"): what is set on
 * the Lineup for the coming period survives leaving it, until that period
 * starts or the plan is edited. Made-up names only.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LINEUP_DRAFT_KEY,
  draftToSave,
  isLineupDraftShaped,
  parseKeptLineupDraft,
  restoreLineupDraft,
  sameDraft,
} from './lineupDraft';
import { NO_SUB_PLANNED, type PlannedSub } from './subPlan';
import type { UUID } from '../types/index';

const id = (s: string) => s as UUID;
const [gk, d1, m1] = [id('pos-gk'), id('pos-d1'), id('pos-m1')];
const format = { positions: [{ id: gk }, { id: d1 }, { id: m1 }] } as never;
const [ava, ben, cal, dan] = [id('ava'), id('ben'), id('cal'), id('dan')];
const q2 = id('q2');
const sheet = { [gk]: ava, [d1]: ben, [m1]: cal };
const plan: PlannedSub[] = [{ playerId: dan, atMs: 375_000, forPlayerId: ben, done: false }];

describe('the Lineup draft (#293 C5)', () => {
  it('keeps the intention without done, and reads back as the Lineup left it', () => {
    const kept = draftToSave(q2, sheet, plan);
    expect(kept).toEqual({ quarterId: q2, sheet, subs: [{ playerId: dan, atMs: 375_000, forPlayerId: ben }] });
    expect(restoreLineupDraft(kept, q2, format, [ava, ben, cal, dan])).toEqual({ sheet, subs: plan });
  });

  it('survives Android ending the app: stored, parsed back the same', () => {
    const kept = { matchId: id('match-1'), draft: draftToSave(q2, sheet, plan) };
    expect(parseKeptLineupDraft(JSON.stringify(kept))).toEqual(kept);
    expect(LINEUP_DRAFT_KEY).toBe('coaching-app/lineup-draft/v1');
  });

  it('is never shown for another period: the next break starts as before', () => {
    expect(restoreLineupDraft(draftToSave(q2, sheet, plan), id('q3'), format, [ava, ben, cal, dan])).toBeNull();
    expect(restoreLineupDraft(undefined, q2, format, [ava, ben, cal, dan])).toBeNull();
  });

  it('a child marked absent since is left out: their place empty, their sub dropped, nothing invented', () => {
    const back = restoreLineupDraft(draftToSave(q2, sheet, plan), q2, format, [ava, cal, dan]);
    expect(back?.sheet).toEqual({ [gk]: ava, [d1]: null, [m1]: cal });
    // Dan still comes on, now for whoever is on longest, since Ben is not on.
    expect(back?.subs).toEqual([{ playerId: dan, atMs: 375_000, forPlayerId: null, done: false }]);
  });

  it('a draft naming a position this shape lacks is not used', () => {
    const bad = { quarterId: q2, sheet: { [id('pos-x')]: ava }, subs: [] };
    expect(restoreLineupDraft(bad, q2, format, [ava])).toBeNull();
  });

  it('an unchanged Lineup writes nothing; a changed one does', () => {
    const a = draftToSave(q2, sheet, plan);
    expect(sameDraft(a, draftToSave(q2, { ...sheet }, [...plan]))).toBe(true);
    expect(sameDraft(a, draftToSave(q2, sheet, [{ ...plan[0], atMs: NO_SUB_PLANNED }]))).toBe(false);
  });

  it('a malformed store reads as nothing kept', () => {
    expect(parseKeptLineupDraft('{not json')).toBeNull();
    expect(parseKeptLineupDraft(JSON.stringify({ matchId: 'm', draft: { quarterId: 'q', sheet: {}, subs: [{}] } }))).toBeNull();
    expect(isLineupDraftShaped({ quarterId: 'q', sheet: { a: 3 }, subs: [] })).toBe(false);
    expect(parseKeptLineupDraft(null)).toBeNull();
  });
});

describe('the app keeps and drops it (#293 C4, C5)', () => {
  const app = readFileSync(join(__dirname, '../../App.tsx'), 'utf8');

  it('the Lineup is given the draft kept for its match, and every change', () => {
    expect(app).toMatch(/draft=\{keptDraft\?\.matchId === match\.state\.match\.id \? keptDraft\.draft : undefined\}/);
    expect(app).toMatch(/onDraft=\{keepLineupDraft\}/);
  });

  it('Start drops it: it became the period\'s reminders', () => {
    const start = app.slice(app.indexOf('const startQuarter = useCallback('), app.indexOf('const keepLineupDraft'));
    expect(start).toMatch(/setSubPlan\(plan\);[\s\S]*keepDraft\(null\);/);
  });

  it('an edit on the plan drops it for that match (C4: the plan wins)', () => {
    const save = app.slice(app.indexOf('const savePlan = useCallback('), app.indexOf('const saveComing'));
    expect(save).toMatch(/if \(keptDraftRef\.current\?\.matchId === matchId\) keepDraft\(null\);/);
  });

  it('End match drops it for that match', () => {
    const close = app.slice(app.indexOf('const closeMatch = useCallback('), app.indexOf('const correctAttendanceOnReport'));
    expect(close).toMatch(/if \(keptDraftRef\.current\?\.matchId === match\.state\.match\.id\) keepDraft\(null\);/);
  });

  it('a relaunch reads it back from this phone', () => {
    expect(app).toMatch(/parseKeptLineupDraft\(await store\.getItem\(LINEUP_DRAFT_KEY\)/);
  });
});
