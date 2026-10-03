/**
 * The match being played, and the stored list it belongs to (PO, match day 4:
 * "matches that complete are not showing in played section, data is stripped").
 *
 * The engine changes the live match in place, and the save folds it into the
 * stored list on disk. The list the app holds in memory, though, kept the
 * copy from before kick-off. Letting go of the live match (leaving a finished
 * match's summary, opening another fixture, Play now) then saved that stale
 * copy over the played one: no periods, no appearances, no subs. The fix is
 * that nothing reads, or lets go of, the list without the live match folded
 * in first. Pure, so the whole sequence is tested without a phone.
 */

import type { MatchState } from '../engine/MatchEngine';
import type { Format, UUID } from '../types/index';
import { matchProgress, type MatchProgress } from './fixtures';
import { mergeCurrentMatch, type SavedMatch } from './persistence';

export interface HeldMatch {
  state: MatchState;
  format: Format;
}

/** The stored list with the live match's latest state in it. */
export function withLiveMatch(matches: SavedMatch[], live: HeldMatch | null): SavedMatch[] {
  return live ? mergeCurrentMatch(matches, live.state, live.format) : matches;
}

/** How far each match has got, the live one read from its live state. */
export function progressById(
  matches: SavedMatch[],
  live: HeldMatch | null
): Map<UUID, MatchProgress> {
  return new Map(withLiveMatch(matches, live).map((m) => [m.match.id, matchProgress(m.quarters)]));
}
