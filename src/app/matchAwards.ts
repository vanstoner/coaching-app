/**
 * Awards during a match and before it is closed — #228 item 6 (Bea's criteria
 * 19–31; Q5 and Q6 approved as recommended, and Dee's placements, 23 Oct).
 *
 * Pure TypeScript over the record. The awards themselves are the existing
 * `award` records (#197): given with `giveAward`, changed or taken back with
 * `changeAward`. Nothing here is stored; who has which award is read from the
 * record on every call (invariant 1), and awards never feed minutes or
 * fairness (#197 AC5).
 *
 * - **Offered** from the kick-off of the first period until the match is
 *   closed, breaks included, in a real match whose record can be written and
 *   with at least one active award type. Never in a test match (Q6 a): it has
 *   no record to write to.
 * - **The prompt** comes when the coach taps End match (Q5 a), unless every
 *   active award type already has a winner (Q5, second part).
 */

import type { UUID } from '../types/index';
import { displayName } from './squad';
import { matchProgress, type QuarterLike } from './fixtures';
import { canEndMatch } from './matchClosing';
import { isWritable, type Ledger } from './ledger';
import { isTestMatch } from './testMatches';

export interface AwardRow {
  typeId: UUID;
  name: string;
  /** Who has it for this match, from the record: joint winners are one each. */
  winners: { playerId: UUID; name: string; note: string | null }[];
}

export interface LiveMatchLike {
  match: { id: UUID; status: string; test?: unknown };
  quarters: QuarterLike[];
}

/**
 * Whether awards can be given for this match now (criteria 23, 27). `ledger`
 * is null when the record cannot be written on this phone.
 */
export function awardsOffered(ledger: Ledger | null, state: LiveMatchLike): boolean {
  if (!ledger || !isWritable(ledger)) return false;
  if (isTestMatch(state.match)) return false;
  if (state.match.status === 'completed' || state.match.status === 'abandoned') return false;
  if (matchProgress(state.quarters) === 'not_started') return false;
  return ledger.awardTypes.some((t) => t.active);
}

/** The active award types, each with who has it for this match (retired types are not offered). */
export function awardRows(ledger: Ledger, matchId: UUID, nameOf: (id: UUID) => string): AwardRow[] {
  const standing = ledger.matches.find((m) => m.id === matchId)?.awards ?? [];
  return ledger.awardTypes
    .filter((t) => t.active)
    .map((t) => ({
      typeId: t.id,
      name: t.name,
      winners: standing
        .filter((a) => a.awardTypeId === t.id)
        .map((a) => ({ playerId: a.playerId, name: nameOf(a.playerId), note: a.note })),
    }));
}

/** "Awards: 1 of 2 given" — the line at a break between periods (Dee). */
export function awardsLine(rows: readonly AwardRow[]): string {
  const given = rows.filter((r) => r.winners.length > 0).length;
  return `Awards: ${given} of ${rows.length} given`;
}

/**
 * Whether End match asks for awards first (criteria 19, 22; Q5): every period
 * ended, not closed, awards offered, and at least one active type still
 * without a winner. When it is false, End match closes as it always has.
 */
export function awardPromptDue(ledger: Ledger | null, state: LiveMatchLike): boolean {
  if (!canEndMatch(state) || !awardsOffered(ledger, state) || !ledger) return false;
  return awardRows(ledger, state.match.id, () => '').some((r) => r.winners.length === 0);
}

/**
 * Whether the clock shows the award card at full time (PO ruling `both`,
 * 23 Oct, on #228): as soon as every period has ended and until the match is
 * closed, whenever awards are offered. It shows awards already given, so it
 * comes whether or not every award has a winner; End match still asks only
 * while one has none (`awardPromptDue`).
 */
export function awardCardAtFullTime(ledger: Ledger | null, state: LiveMatchLike): boolean {
  return canEndMatch(state) && awardsOffered(ledger, state);
}

/** The children an award can go to: everyone who took part in this match, in squad order. */
export function childrenInMatch(
  players: readonly { id: UUID; firstName: string; displaySuffix?: string | null }[],
  appearances: readonly { playerId: UUID }[]
): { playerId: UUID; name: string }[] {
  const here = new Set(appearances.map((a) => a.playerId));
  return players.filter((p) => here.has(p.id)).map((p) => ({ playerId: p.id, name: displayName(p) }));
}
