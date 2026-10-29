/**
 * #252 (Rob: B, including between quarters): the score band, bigger and on
 * the pitch. Pure: it says whether the band shows and what it reads, folded
 * from the match's events on every paint (invariant 1). Nothing is stored.
 */

import type { MatchEvent } from '../types/index';
import { scoreOf } from './matchEvents';

/** No score before kick-off (Rob's ruling): the band appears once any period has started. */
export function showsScoreBand(quarters: readonly { status?: string }[]): boolean {
  return quarters.some((q) => q.status !== undefined && q.status !== 'pending');
}

/** The band's figures and its one screen-reader label (AC12), e.g. "Heart 3, Rovers 2". */
export function scoreBand(
  events: MatchEvent[] | undefined,
  squadName: string,
  opponent: string
): { us: number; them: number; text: string; label: string } {
  const { us, them } = scoreOf(events);
  return { us, them, text: `${us}–${them}`, label: `${squadName} ${us}, ${opponent} ${them}` };
}
