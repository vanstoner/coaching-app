/**
 * Earlier test matches: finding them, and listing what is hidden — #194
 * (PO, 2026-10-17: "the 3 on the 16th lasting a minute look silly being shown
 * in the league tables").
 *
 * A Play now pressed to try something used to be recorded like any match.
 * Leaving it out of the figures (ADR-020) kept it out of the sums but not off
 * the screens. Marking it a test (`setMatchKind`) hides it everywhere while
 * the record keeps it (invariant 5). Nothing here hides anything on its own:
 * it only offers, and the coach confirms.
 */

import { virtualNowMs, withSpeed, type ClockSpeed } from './appClock';
import type { Match, TestMatchMark, UUID } from '../types/index';
import { isExcluded, isHidden, type Ledger, type LedgerMatch } from './ledger';
import { withLiveMatch, type HeldMatch } from './liveMatch';
import type { SavedMatch } from './persistence';

/** The note the one-off clean-up writes on each match it hides. */
export const CLEANUP_NOTE = 'Hidden as a test match';

/** How long a match lasted: the end of its last stretch on the pitch. */
export function playedMs(m: { intervals: readonly { endMs: number }[] }): number {
  return m.intervals.reduce((end, i) => Math.max(end, i.endMs), 0);
}

const noOpponent = (m: LedgerMatch) => (m.opponent ?? '').trim() === '';

/**
 * Matches that look like tests, for the coach to confirm: no opponent, and
 * either left out with a note starting "test", or over before one period of
 * its planned length was played. A match with an opponent is never offered.
 */
export function testMatchCandidates(ledger: Ledger | null): LedgerMatch[] {
  if (!ledger) return [];
  return ledger.matches.filter((m) => {
    if (isHidden(m) || !noOpponent(m)) return false;
    const notedTest = isExcluded(m) && /^\s*test/i.test(m.excluded?.note ?? '');
    const periodMs = m.periodCount > 0 ? (m.totalMinutes * 60_000) / m.periodCount : 0;
    const tooShort = periodMs > 0 && m.intervals.length > 0 && playedMs(m) < periodMs;
    return notedTest || tooShort;
  });
}

/** Matches hidden as tests or voided, for Settings › Test matches. */
export function hiddenMatches(ledger: Ledger | null): LedgerMatch[] {
  return ledger ? ledger.matches.filter(isHidden) : [];
}

// --- part B: a test match started from Settings, never recorded -------------
//
// ADR-021 D3, PO ruling 3 on #191: "Test matches never enter the record." A
// test match lives in the session only, carries `match.test`, and is never
// handed to `recordMatches`. It is listed only in Settings › Test matches and
// deletes outright, because there is nothing in the record to keep.

/** True for a match started as a test from Settings (#194). */
export function isTestMatch(match: { test?: unknown } | null | undefined): boolean {
  return match?.test !== undefined && match.test !== null;
}

/** The matches every screen and figure sees: test matches left out (#194 AC2). */
export function realMatches<T extends { match: { test?: unknown } }>(matches: readonly T[]): T[] {
  return matches.filter((m) => !isTestMatch(m.match));
}

/**
 * What may be written to the minutes record: every record but a test match.
 * Every call to `recordMatches` in the app goes through this (AC2, AC6).
 */
export function recordable<T extends { match: { test?: unknown } }>(records: readonly T[]): T[] {
  return realMatches(records);
}

/** A new test match's clock: the app's own time, at ×1, from `nowMs`. */
export function newTestMark(nowMs: number): TestMatchMark {
  return { clock: { offsetMs: 0, speed: 1, sinceMs: nowMs } };
}

const asSetting = (mark: TestMatchMark) => ({
  offsetMs: mark.clock.offsetMs,
  speed: mark.clock.speed,
  sinceRealMs: mark.clock.sinceMs,
});

/**
 * A test match's time at app time `baseMs`. Computed every time it is read,
 * never counted (invariant 2), and never behind the app's clock, so ×5 and
 * ×10 change only this match: nothing else on the phone runs fast.
 */
export function testMatchNowMs(mark: TestMatchMark, baseMs: number): number {
  return virtualNowMs(asSetting(mark), baseMs);
}

/** The same clock from `baseMs` on, at a new speed: no jump at the change. */
export function withTestSpeed(mark: TestMatchMark, speed: ClockSpeed, baseMs: number): TestMatchMark {
  const next = withSpeed(asSetting(mark), speed, baseMs);
  return { clock: { offsetMs: next.offsetMs, speed: next.speed, sinceMs: next.sinceRealMs } };
}

/**
 * The clock a match's engine reads: the app's for a real match, its own for
 * a test match. Reads `state.match` on every call, so a speed change made on
 * the held state takes effect at once.
 */
export function matchClock(state: { match: Pick<Match, 'test'> }, base: () => Date): () => Date {
  return () => {
    const mark = state.match.test;
    const at = base();
    return mark ? new Date(testMatchNowMs(mark, at.getTime())) : at;
  };
}

/** Every test match on this phone, the held one at its latest (Settings › Test matches). */
export function testMatchesOnPhone(matches: SavedMatch[], live: HeldMatch | null): SavedMatch[] {
  return withLiveMatch(matches, live).filter((m) => isTestMatch(m.match));
}

export interface TestDeleteOutcome {
  matches: SavedMatch[];
  /** The held match was one deleted: let go of it without folding it back in. */
  releaseLive: boolean;
  deleted: number;
}

/**
 * Delete test matches outright (#194 AC3): they were never in the record, so
 * nothing is lost. Only a test match is ever deleted here; a real match in
 * `ids` is left exactly where it is.
 */
export function deleteTestMatches(
  matches: SavedMatch[],
  live: HeldMatch | null,
  ids: readonly UUID[]
): TestDeleteOutcome {
  const wanted = new Set(ids);
  const doomed = new Set(
    testMatchesOnPhone(matches, live)
      .map((m) => m.match.id)
      .filter((id) => wanted.has(id))
  );
  return {
    matches: matches.filter((m) => !doomed.has(m.match.id)),
    releaseLive: live !== null && doomed.has(live.state.match.id),
    deleted: doomed.size,
  };
}
