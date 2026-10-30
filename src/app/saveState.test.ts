/**
 * #264 E3, E4: saving as a coach sees it — the Saved tick, a form's status,
 * leaving a changed form, and what a sheet writes when it closes.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makePlayer, renamedIn } from './squad';
import { uuid } from '../types/index';
import {
  SAVED_TICK_MS,
  canSaveForm,
  formReducer,
  formStatusText,
  initialFormPhase,
  leaveNeedsAsking,
  leaveQuestion,
  savedTickRemainingMs,
  savedTickVisible,
  savedToast,
  sheetCommit,
  tickWhenSaved,
  sheetExit,
  sheetStatus,
  type FormAction,
  type FormPhase,
} from './saveState';

describe('✓ Saved on a setting (V28)', () => {
  it('shows for 2 s after the save, then goes', () => {
    expect(SAVED_TICK_MS).toBe(2_000);
    expect(savedTickVisible(null, 1_000)).toBe(false);
    expect(savedTickVisible(10_000, 10_000)).toBe(true);
    expect(savedTickVisible(10_000, 11_999)).toBe(true);
    expect(savedTickVisible(10_000, 12_000)).toBe(false);
  });

  it('another change restarts the 2 s', () => {
    // Saved at 10 s, changed again at 11.5 s: the tick lasts to 13.5 s.
    const second = 11_500;
    expect(savedTickVisible(second, 12_500)).toBe(true);
    expect(savedTickVisible(second, 13_499)).toBe(true);
    expect(savedTickVisible(second, 13_500)).toBe(false);
  });

  it('says how long is left, for the one repaint that hides it', () => {
    expect(savedTickRemainingMs(10_000, 10_500)).toBe(1_500);
    expect(savedTickRemainingMs(10_000, 12_000)).toBe(0);
    expect(savedTickRemainingMs(null, 0)).toBe(0);
  });

  it('a clock set backwards never shows a stale tick', () => {
    expect(savedTickVisible(10_000, 9_000)).toBe(false);
  });
});

describe('a form (V29, V30)', () => {
  const run = (...actions: FormAction[]): FormPhase => actions.reduce<FormPhase>(formReducer, 'pristine');

  it('pristine says nothing to save, and Save is off', () => {
    expect(formStatusText('pristine')).toBe('Nothing to save yet');
    expect(canSaveForm('pristine', true)).toBe(false);
  });

  it('the first change makes it dirty: Not saved yet, Save on once valid', () => {
    const p = run({ type: 'change' });
    expect(p).toBe('dirty');
    expect(formStatusText(p)).toBe('Not saved yet');
    expect(canSaveForm(p, false)).toBe(false);
    expect(canSaveForm(p, true)).toBe(true);
  });

  it('Save makes it saved; a later change makes it dirty again', () => {
    expect(run({ type: 'change' }, { type: 'save' })).toBe('saved');
    expect(run({ type: 'change' }, { type: 'save' }, { type: 'change' })).toBe('dirty');
  });

  it('Save on an untouched form changes nothing', () => {
    expect(run({ type: 'save' })).toBe('pristine');
  });

  it('reset starts it afresh', () => {
    expect(run({ type: 'change' }, { type: 'reset' })).toBe('pristine');
  });

  it('leaving from pristine or saved is free; from dirty it asks', () => {
    expect(leaveNeedsAsking('pristine')).toBe(false);
    expect(leaveNeedsAsking('saved')).toBe(false);
    expect(leaveNeedsAsking('dirty')).toBe(true);
    expect(leaveQuestion('fixture')).toBe('Leave without saving this fixture?');
  });
});

describe('a sheet writes only on Save (V32, C3)', () => {
  const draft = { surface: 'grass', condition: 'good', referee: 'Sam' };
  it('Save returns the draft', () => {
    expect(sheetCommit('save', draft)).toBe(draft);
  });
  it('Cancel, a tap outside and Android Back write nothing', () => {
    expect(sheetCommit('cancel', draft)).toBeNull();
    expect(sheetCommit('outside', draft)).toBeNull();
    expect(sheetCommit('back', draft)).toBeNull();
  });
});

describe('a form sheet says Not saved yet and asks before discarding (V29, V30; QA on #260, D5)', () => {
  it('a sheet that tracks no changes has no status line and closes at once', () => {
    expect(sheetStatus(undefined)).toBeNull();
    expect(sheetExit(undefined)).toBe('close');
  });

  it('unchanged: "Nothing to save yet", and Cancel closes', () => {
    expect(formStatusText(sheetStatus(false)!)).toBe('Nothing to save yet');
    expect(sheetExit(false)).toBe('close');
  });

  it('changed: "Not saved yet", and Cancel, a tap outside or Back asks first', () => {
    expect(formStatusText(sheetStatus(true)!)).toBe('Not saved yet');
    expect(sheetExit(true)).toBe('ask');
  });
});

describe('a form’s Save shows a toast naming what was saved (V29; QA on #260, D7)', () => {
  it('names it', () => {
    expect(savedToast('fixture v Rovers')).toBe('Saved: fixture v Rovers');
  });

  it('a rename names the child by their new shown name; nothing else is a rename', () => {
    const squad = uuid();
    const alex = makePlayer(squad, 'Alex');
    const bo = makePlayer(squad, 'Bo');
    expect(renamedIn([alex, bo], [{ ...alex, displaySuffix: 'S' }, bo])).toBe('Alex S');
    expect(renamedIn([alex, bo], [alex, bo])).toBeNull();
    expect(renamedIn([alex], [alex, bo])).toBeNull(); // an add
    expect(renamedIn([alex, bo], [alex])).toBeNull(); // a remove
    expect(renamedIn([alex, bo], [{ ...alex, keeper: 'main' }, bo])).toBeNull(); // a preference
  });

  it('App toasts after the fixture, rename and correction saves succeed', () => {
    const app = readFileSync(join(__dirname, '..', '..', 'App.tsx'), 'utf-8');
    expect(app).toMatch(/showToast\(savedToast\(`fixture v \$\{opponentLabel\(stored\.match\)\}`\)\)/);
    expect(app).toMatch(/if \(renamed !== null\) showToast\(savedToast\(`the name \$\{renamed\}`\)\)/);
    // Each Record correction goes through apply(), which toasts only when ok.
    expect(app).toMatch(/if \(!r\.ok\) return r\.reason;\s+commitLedger\(r\.ledger\);\s+showToast\(savedToast\(what\)\);/);
    expect(app).toMatch(/showToast\(savedToast\('attendance correction'\)\)/);
  });
});

describe('✓ Saved only after the save succeeded (V28; QA on #260, D8)', () => {
  it('a save that resolves true ticks', async () => {
    let ticked = 0;
    await tickWhenSaved(Promise.resolve(true), () => ticked++);
    expect(ticked).toBe(1);
  });

  it('a failed, refused or throwing save never ticks', async () => {
    let ticked = 0;
    await tickWhenSaved(Promise.resolve(false), () => ticked++);
    await tickWhenSaved(Promise.reject(new Error('disk full')), () => ticked++);
    expect(ticked).toBe(0);
  });

  it('no tick before the save has resolved', async () => {
    let ticked = 0;
    let finish: (ok: boolean) => void = () => {};
    const done = tickWhenSaved(new Promise<boolean>((r) => (finish = r)), () => ticked++);
    await Promise.resolve();
    expect(ticked).toBe(0);
    finish(true);
    await done;
    expect(ticked).toBe(1);
  });

  it('Settings marks every tick through tickWhenSaved, never straight after the call', () => {
    const settings = readFileSync(join(__dirname, '..', 'screens', 'SettingsScreen.tsx'), 'utf-8');
    const marks = settings.match(/ticks\.mark\(/g) ?? [];
    const waited = settings.match(/tickWhenSaved\([^;]*ticks\.mark\(/g) ?? [];
    expect(marks.length).toBe(5);
    expect(waited.length).toBe(marks.length);
  });
});

describe('a new fixture can be saved untouched (Rob, 30 Oct; V29 as ruled)', () => {
  it('a form that creates starts Not saved yet with Save on; one that edits starts with nothing to save', () => {
    expect(formStatusText(initialFormPhase(true))).toBe('Not saved yet');
    expect(canSaveForm(initialFormPhase(true), true)).toBe(true);
    expect(formStatusText(initialFormPhase(false))).toBe('Nothing to save yet');
    expect(canSaveForm(initialFormPhase(false), true)).toBe(false);
  });

  it('the New fixture form starts that way, and an untouched one leaves without asking', () => {
    const form = readFileSync(join(__dirname, '..', 'screens', 'FixtureFormScreen.tsx'), 'utf-8');
    expect(form).toMatch(/useReducer\(formReducer, creates, initialFormPhase\)/);
    expect(form).toMatch(/creates = true,/);
    expect(form).toMatch(/touched && leaveNeedsAsking\(phase\) \? setAsking\(true\) : onCancel\(\)/);
    const app = readFileSync(join(__dirname, '..', '..', 'App.tsx'), 'utf-8');
    expect(app).not.toMatch(/creates=\{false\}/);
  });
});
