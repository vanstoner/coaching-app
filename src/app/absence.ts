/**
 * Marking a player absent before kick-off — #102 AC1, AC2.
 *
 * Pure TypeScript over the engine's state; no React. Everyone is present by
 * default (the match records the squad `available` when it is created, #64).
 * Before the first period kicks off the coach can mark a player absent, and
 * an absent player cannot be picked. After kick-off the availability is the
 * snapshot the ledger took (ADR-014 §4), and a change is only a noted
 * correction (`correctAttendance` in `ledger.ts`, invariant 5) — so this
 * refuses.
 */

import type { MatchEngine, MatchState } from '../engine/MatchEngine';
import type { Player, UUID } from '../types/index';
import { isActive } from './squad';

/** True until the first period has kicked off. */
export function beforeKickoff(state: Pick<MatchState, 'quarters'>): boolean {
  return state.quarters.every((q) => q.status === 'pending');
}

/** Everyone marked anything other than available for this match. */
export function absentIds(state: Pick<MatchState, 'playerAvailability'>): Set<UUID> {
  const out = new Set<UUID>();
  for (const [id, status] of state.playerAvailability) if (status !== 'available') out.add(id);
  return out;
}

/**
 * The players a lineup may pick from: everyone not marked absent. One who has
 * already played in this match stays, whatever their mark says — the minutes
 * they played are real.
 */
export function pickablePlayers(
  players: Player[],
  state: Pick<MatchState, 'playerAvailability' | 'appearances'>
): Player[] {
  const absent = absentIds(state);
  const played = new Set(state.appearances.map((a) => a.playerId));
  return players.filter((p) => !absent.has(p.id) || played.has(p.id));
}

/**
 * Mark a player absent (or present again) before kick-off. Returns false, and
 * changes nothing, once the match has kicked off.
 */
export function markAbsent(
  engine: MatchEngine,
  state: MatchState,
  playerId: UUID,
  absent: boolean
): boolean {
  if (!beforeKickoff(state)) return false;
  engine.setAvailability(state, playerId, absent ? 'absent' : 'available');
  return true;
}

/**
 * At kick-off, everyone in today's squad has an entry (QA on #102, ruling B).
 *
 * A fixture records the squad as it was when it was saved (#64). A child
 * added afterwards had no entry, though the lineup showed them "Here"
 * (missing reads as available): the engine wrote them no bench stint, the
 * ledger's kick-off snapshot left them out, and a match they sat through on
 * the bench counted for nothing. So, the moment before the first period
 * starts, every active squad player without an entry is recorded available
 * — the default the lineup showed. An entry already there (an absence) is
 * never changed. After kick-off this does nothing.
 */
export function fillSquadAtKickoff(engine: MatchEngine, state: MatchState, players: Player[]): void {
  if (!beforeKickoff(state)) return;
  for (const p of players) {
    if (isActive(p) && !state.playerAvailability.has(p.id)) engine.setAvailability(state, p.id, 'available');
  }
}
