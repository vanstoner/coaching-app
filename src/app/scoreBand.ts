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

/**
 * #252 (Rob: "Half time" for halves; Dee's prototype): what the band says
 * when play has stopped. Null while a period runs or before kick-off.
 */
export function bandCaption(quarters: readonly { index: number; status?: string }[], periodCount: number): string | null {
  if (quarters.some((q) => q.status === 'running')) return null;
  const ended = quarters.filter((q) => q.status === 'ended');
  if (ended.length === 0) return null;
  if (ended.length >= periodCount) return 'Full time';
  if (periodCount === 2) return 'Half time';
  return `End of Q${Math.max(...ended.map((q) => q.index))}`;
}
