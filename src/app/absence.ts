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
