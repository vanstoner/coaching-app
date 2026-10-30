/**
 * Who is in a match's fair share (#261 item 1, Rob's ruling 1b; #262).
 *
 * Pure TypeScript. One rule, used by the match report and the Plan alike, so
 * the two can never show different shares for the same match (#261 AC3):
 *
 * - a child not there (absent, or not available for a planned match) is out
 *   and shows no gap (#262);
 * - a Main keeper is out when the match has one there, as in the season
 *   average (`squadAverage`), so the outfielders are not all shown short;
 * - a fill-in is IN on the day (Rob, #190: "they still get a fair share"),
 *   though out of the season average.
 *
 * The share is the pitch time (goal plus outfield, invariant 3) of the
 * children in it, divided by how many they are. Nothing is stored.
 */

import type { UUID } from '../types/index';

export type NotInShare = 'absent' | 'main-keeper';

export interface ShareInput {
  playerId: UUID;
  /** Goal plus outfield, this match. */
  pitchMs: number;
  /** There (report) or available (Plan). */
  present: boolean;
  /** The child's keeper preference is Main (#105). */
  mainKeeper: boolean;
}

export interface ShareResult {
  /** Null when nobody is in the share. */
  shareMs: number | null;
  /** Why a child is out of the share; absent from the map means in. */
  out: ReadonlyMap<UUID, NotInShare>;
}

export function matchFairShare(children: readonly ShareInput[]): ShareResult {
  const out = new Map<UUID, NotInShare>();
  const anyMain = children.some((c) => c.present && c.mainKeeper);
  let total = 0;
  let count = 0;
  for (const c of children) {
    if (!c.present) out.set(c.playerId, 'absent');
    else if (anyMain && c.mainKeeper) out.set(c.playerId, 'main-keeper');
    else {
      total += c.pitchMs;
      count += 1;
    }
  }
  return { shareMs: count === 0 ? null : total / count, out };
}

/** For a narrow column: the reason in a word or two. */
export const NOT_IN_SHARE_SHORT: Record<NotInShare, string> = {
  absent: 'Absent',
  'main-keeper': 'Main keeper',
};

/** The one-line reason shown in place of a difference (#261 AC2). */
export const NOT_IN_SHARE_TEXT: Record<NotInShare, string> = {
  absent: 'Absent',
  'main-keeper': 'Main keeper: not in the share',
};
