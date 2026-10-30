/**
 * #264 E3, E4: saving as a coach sees it — the Saved tick, a form's status,
 * leaving a changed form, and what a sheet writes when it closes.
 */

import { describe, expect, it } from 'vitest';
import {
  SAVED_TICK_MS,
  canSaveForm,
  formReducer,
  formStatusText,
  leaveNeedsAsking,
  leaveQuestion,
  savedTickRemainingMs,
  savedTickVisible,
  sheetCommit,
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
