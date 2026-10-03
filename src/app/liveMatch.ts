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
import { scoreOf, type Score } from './matchEvents';
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

/**
 * The score of every match that has been kicked off, the live one read from
 * its live state, for the fixture cards (PO, match day 4: a played match
 * "doesn't seem to have a result"; "scores are not being retained"). Folded
 * from the events, never stored (invariant 1). A match not yet kicked off has
 * no score to show.
 */
export function scoresById(matches: SavedMatch[], live: HeldMatch | null): Map<UUID, Score> {
  return new Map(
    withLiveMatch(matches, live)
      .filter((m) => matchProgress(m.quarters) !== 'not_started')
      .map((m) => [m.match.id, scoreOf(m.events)])
  );
}
