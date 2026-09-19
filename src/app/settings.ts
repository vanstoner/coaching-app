/**
 * Settings — the things a coach sets once, not every Saturday.
 *
 * Pure TypeScript. The screen stays thin; every rule here is provable in Node.
 *
 * ---------------------------------------------------------------------------
 * Why this exists
 * ---------------------------------------------------------------------------
 *
 * The team name, the match length and the number of periods were wedged into
 * the pre-match flow, so the coach re-answered them every week — and the only
 * way to reach the squad was to start setting up a match.
 *
 * A squad barely changes week to week. Neither does a team name or a kick-off
 * length. They are standing facts about a club, so they belong somewhere you
 * can go and change, not on a path you can only walk forwards.
 *
 * Nothing here adds to what is stored: `SavedSession` already carries
 * squadName, format, totalMinutes and periodCount. **No schema bump, so every
 * existing save still loads** — which matters more than it sounds, because a
 * coach mid-season losing their squad to a version bump is unforgivable.
 */

import { formatClock, periodNounPlural } from './matchClock';

/** Matches the team-name input, so the model cannot hold what the UI forbids. */
export const MAX_TEAM_NAME_LENGTH = 28;

/**
 * Clean up a typed team name.
 *
 * Empty falls back rather than saving blank: a fresh install showing no name
 * at all looks broken, and a coach who clears the field has not asked for
 * that. Whitespace is collapsed because "Sunday   Rovers" pasted from a
 * message is a typo, not an intention.
 */
export function normaliseTeamName(raw: string, fallback: string): string {
  const collapsed = raw.replace(/\s+/g, ' ').trim();
  if (collapsed === '') return fallback;
  return collapsed.slice(0, MAX_TEAM_NAME_LENGTH);
}

/** True when the name would be stored as typed, with nothing cleaned up. */
export function teamNameIsClean(raw: string): boolean {
  return raw === raw.replace(/\s+/g, ' ').trim() && raw.length <= MAX_TEAM_NAME_LENGTH;
}

/**
 * The defaults in one line a coach can check at a glance: "4 × 12:30 quarters".
 *
 * Shown rather than left to arithmetic. A coach setting 75 minutes in halves
 * should see 37:30 before Saturday, not discover it at kick-off.
 */
export function describeDefaults(totalMinutes: number, periodCount: number): string {
  if (!Number.isFinite(totalMinutes) || !Number.isFinite(periodCount) || periodCount <= 0) {
    return '—';
  }
  const periodMs = (totalMinutes * 60_000) / periodCount;
  return `${periodCount} × ${formatClock(periodMs)} ${periodNounPlural(periodCount).toLowerCase()}`;
}

/** How long one period runs, in ms. The number the sub plan anchors to. */
export function periodMsFor(totalMinutes: number, periodCount: number): number {
  if (!Number.isFinite(totalMinutes) || !Number.isFinite(periodCount) || periodCount <= 0) {
    return 0;
  }
  return (totalMinutes * 60_000) / periodCount;
}
