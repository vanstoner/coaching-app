import { describe, expect, it } from 'vitest';

import { TABS, showsTabs, stepForTab, tabForStep, type Step } from './tabs';

const EVERY_STEP: Step[] = [
  'loading',
  'resume',
  'fixtures',
  'fixtureForm',
  'summary',
  'settings',
  'squad',
  'lineup',
  'playing',
];

describe('the three tabs the PO ruled for Tuesday', () => {
  it('is Home, Squad, Settings, in that order', () => {
    expect(TABS.map((t) => t.label)).toEqual(['Home', 'Squad', 'Settings']);
  });

  it('puts Home on the fixtures list — the front door from #69', () => {
    expect(stepForTab('home')).toBe<Step>('fixtures');
    expect(stepForTab('squad')).toBe<Step>('squad');
    expect(stepForTab('settings')).toBe<Step>('settings');
  });

  it('round-trips: every tab lands on a screen that shows that tab', () => {
    for (const spec of TABS) {
      expect(tabForStep(stepForTab(spec.tab))).toBe(spec.tab);
    }
  });
});

describe('Saturday is full-screen', () => {
  it('draws no tabs on the live clock', () => {
    // The ruling, and the reason: a tab bar under a running match is three
    // ways to lose the game you are keeping time for.
    expect(tabForStep('playing')).toBeNull();
    expect(showsTabs('playing')).toBe(false);
  });

  it('draws no tabs on the lineup either — it is the same Saturday flow', () => {
    expect(showsTabs('lineup')).toBe(false);
  });

  it('draws no tabs while something is half-finished', () => {
    // A half-typed fixture, a summary being read, the resume prompt. None is
    // a destination to wander off from by accident.
    expect(showsTabs('fixtureForm')).toBe(false);
    expect(showsTabs('summary')).toBe(false);
    expect(showsTabs('resume')).toBe(false);
    expect(showsTabs('loading')).toBe(false);
  });
});

describe('the squad editor serves two errands', () => {
  it('shows tabs when it is housekeeping', () => {
    expect(tabForStep('squad', 'home')).toBe('squad');
    expect(showsTabs('squad', 'home')).toBe(true);
  });

  it('hides them when it is step one of a kick-off', () => {
    expect(tabForStep('squad', 'match')).toBeNull();
    expect(showsTabs('squad', 'match')).toBe(false);
  });

  it('treats housekeeping as the default, so a plain call is the safe one', () => {
    expect(tabForStep('squad')).toBe('squad');
  });
});

describe('every step has an answer', () => {
  it('never throws, whichever screen it is asked about', () => {
    for (const step of EVERY_STEP) {
      expect(() => tabForStep(step)).not.toThrow();
      expect(() => showsTabs(step, 'match')).not.toThrow();
    }
  });

  it('shows tabs on exactly three screens', () => {
    const withTabs = EVERY_STEP.filter((s) => showsTabs(s));
    expect(withTabs).toEqual<Step[]>(['fixtures', 'settings', 'squad']);
  });
});
