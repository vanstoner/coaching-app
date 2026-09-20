/**
 * Navigation — PO ruling, 2026-09-20 (#70).
 *
 * Pure TypeScript. No React, no navigator.
 *
 * > *"build 55 is awful, there's so much wrong with the UI... its navigation
 * > is clunky"*
 *
 * > *"But basically tabs is preferred."*
 *
 * ---------------------------------------------------------------------------
 * Tuesday has tabs; Saturday does not
 * ---------------------------------------------------------------------------
 *
 * Two different jobs. **Tuesday** is the kitchen table: browse fixtures, fix
 * the squad, change a default, wander between the three without losing
 * anything. Tabs are exactly that — three destinations, always reachable, no
 * order.
 *
 * **Saturday** is one hand on a phone in the rain with a game running. Every
 * pixel is the clock and who comes off next, and a tab bar there is three ways
 * to lose the match you are keeping time for. So the live screens are
 * full-screen and their only exit is an explicit Leave, which returns to Home
 * and leaves the match running.
 *
 * This file is the rule, separated from the rendering, so "which tab is
 * showing" and "is this screen full-screen" are provable in Node rather than
 * inspected on a device.
 */

/** Every screen the app can be on. The step machine, named once. */
export type Step =
  | 'loading'
  | 'resume'
  | 'fixtures'
  | 'fixtureForm'
  | 'summary'
  | 'settings'
  | 'squad'
  | 'lineup'
  | 'playing';

export type Tab = 'home' | 'squad' | 'settings';

/**
 * Why the squad editor is open.
 *
 * The same screen serves two errands and must not behave the same in both. As
 * a TAB it is housekeeping: tabs stay, there is nothing to go on to. On the
 * way to a MATCH it is step one of a kick-off, so the tabs go away and the
 * screen offers a lineup — and a Leave, because a screen whose only exit
 * commits you to starting a game is a trap.
 */
export type SquadErrand = 'home' | 'match';

export interface TabSpec {
  tab: Tab;
  label: string;
  step: Step;
}

/** Left to right, in the order the PO named them. */
export const TABS: readonly TabSpec[] = [
  { tab: 'home', label: 'Home', step: 'fixtures' },
  { tab: 'squad', label: 'Squad', step: 'squad' },
  { tab: 'settings', label: 'Settings', step: 'settings' },
] as const;

/** Where tapping a tab goes. */
export function stepForTab(tab: Tab): Step {
  const spec = TABS.find((t) => t.tab === tab);
  if (!spec) throw new Error(`unknown tab ${tab}`);
  return spec.step;
}

/**
 * Which tab is showing, or null when the screen is full-screen.
 *
 * Null is the Saturday answer and the "in the middle of something" answer:
 * the live clock, the lineup, a half-typed fixture form, a match summary, the
 * resume prompt. None of those is a destination a coach should be able to
 * wander off from by accident.
 */
export function tabForStep(step: Step, errand: SquadErrand = 'home'): Tab | null {
  switch (step) {
    case 'fixtures':
      return 'home';
    case 'settings':
      return 'settings';
    case 'squad':
      return errand === 'home' ? 'squad' : null;
    default:
      return null;
  }
}

/** True when the tab bar is drawn. False on every Saturday screen. */
export function showsTabs(step: Step, errand: SquadErrand = 'home'): boolean {
  return tabForStep(step, errand) !== null;
}
