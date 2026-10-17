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

import { isExcluded, isHidden, type Ledger, type LedgerMatch } from './ledger';

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
