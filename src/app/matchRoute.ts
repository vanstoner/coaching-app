/**
 * Which match the Squad errand is on the way to — #223 AC2, QA finding 3 on
 * #221, PO ruling 22 Oct (`fix fixture start in 1.3.0`):
 *
 * > When a fixture is opened without enough players, both the "enough
 * > players" check and the match that Start begins follow **that fixture's**
 * > format and opponent. Start never begins a Play-now match from the
 * > Settings defaults on that route.
 *
 * Two routes reach the squad editor with a match to start. Play now (no
 * fixture) counts against the Settings default and starts from the defaults,
 * as before. Opening a fixture counts against that fixture's shape, and Start
 * opens that fixture again, so its opponent, shape, length and periods are its
 * own. Pure, so the decision is tested without a phone.
 */

import type { Format, UUID } from '../types/index';
import type { HeldMatch } from './liveMatch';
import type { SavedMatch } from './persistence';

export type MatchRoute = { kind: 'play_now' } | { kind: 'fixture'; matchId: UUID };

/** Play now: no fixture, the Settings defaults. */
export const PLAY_NOW_ROUTE: MatchRoute = { kind: 'play_now' };

/**
 * The shape the squad is counted against on this route.
 *
 * A fixture's own shape: the held copy when it is the match held (opening a
 * fixture holds it), else its stored copy. A stored match with no shape falls
 * back to the default, as opening it does (`openMatch`).
 */
export function routeFormat(
  route: MatchRoute,
  held: HeldMatch | null,
  matches: SavedMatch[],
  defaultFormat: Format
): Format {
  if (route.kind === 'play_now') return defaultFormat;
  if (held && held.state.match.id === route.matchId) return held.format;
  return matches.find((m) => m.match.id === route.matchId)?.format ?? defaultFormat;
}

/**
 * What Squad's Start does on this route: a Play-now match from the defaults,
 * or the fixture opened again. Never the first on the fixture route.
 */
export function startOnRoute(
  route: MatchRoute,
  start: { playNow: () => void; openFixture: (matchId: UUID) => void }
): void {
  if (route.kind === 'fixture') start.openFixture(route.matchId);
  else start.playNow();
}
