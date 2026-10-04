/**
 * Closing a match, and attendance corrections on its report — PO rulings D
 * and F (#98, 2026-10-04). Pure TypeScript over the engine and the ledger.
 *
 * > *"I'd like a coach to read the report and close the match with a button
 * > like end quarter but end match"* — PO
 *
 * **D: End match.** After the last period the report offers End match. It
 * marks the match `completed` (`MatchEngine.completeMatch`): a status change
 * only. The next save records it, and the ledger takes the changed match
 * record as a chain entry like any other change. Closed matches are what
 * season averages count (ADR-015 §6). Leaving the report without closing
 * keeps everything — the match is still Played, and offers End match when
 * opened again.
 *
 * **F: late arrivals and corrections.** A child marked absent who is brought
 * on is recorded as attended, with the note "arrived after kick-off": an
 * explicit correction entry in the ledger, never an edit (invariant 5). The
 * report's "Correct attendance" writes the same kind of entry with the
 * coach's own note. Each also sets the match's own availability, so the
 * report and the season agree.
 */

import type { MatchEngine, MatchState } from '../engine/MatchEngine';
import type { AvailabilityStatus, UUID } from '../types/index';
import { matchProgress, type QuarterLike } from './fixtures';
import { correctAttendance, type CorrectionResult, type Ledger } from './ledger';

// --- D: End match -------------------------------------------------------------

/** Every period has ended and the coach has not closed it yet. */
export function canEndMatch(state: {
  match: { status: string };
  quarters: QuarterLike[];
}): boolean {
  return (
    state.match.status !== 'completed' &&
    state.match.status !== 'abandoned' &&
    matchProgress(state.quarters) === 'finished'
  );
}

/**
 * The matches played to the end but not closed, for the "Not closed" hint on
 * their fixture cards. Pass the stored list with the live match folded in
 * (`withLiveMatch`), or the live match's own status is a stale copy's.
 */
export function notClosedIds(
  matches: readonly { match: { id: UUID; status: string }; quarters: QuarterLike[] }[]
): Set<UUID> {
  return new Set(matches.filter(canEndMatch).map((m) => m.match.id));
}

/** Close the match. False, and nothing changed, when it cannot be closed. */
export function endMatch(engine: MatchEngine, state: MatchState): boolean {
  if (!canEndMatch(state)) return false;
  engine.completeMatch(state);
  return true;
}

// --- F: attendance corrections ------------------------------------------------

/** The note a late arrival's correction carries (ruling F). */
export const LATE_ARRIVAL_NOTE = 'arrived after kick-off';

/** Marked anything other than available for this match. */
export function isMarkedAbsent(state: Pick<MatchState, 'playerAvailability'>, playerId: UUID): boolean {
  const status = state.playerAvailability.get(playerId);
  return status !== undefined && status !== 'available';
}

/**
 * Correct a player's attendance after kick-off: a noted ledger entry
 * (`correctAttendance`), and the match's own availability set to match.
 *
 * Refused — nothing changed — before kick-off (marking absent is the tool
 * then), without a ledger to record it in, without a note, or to mark absent
 * a child who has played in this match: their minutes are real.
 */
export function correctMatchAttendance(
  engine: MatchEngine,
  state: MatchState,
  ledger: Ledger | null,
  playerId: UUID,
  status: AvailabilityStatus,
  note: string,
  now: Date
): CorrectionResult {
  if (state.quarters.every((q) => q.status === 'pending')) {
    return { ok: false, reason: 'Before kick-off, mark the player absent on the lineup instead.' };
  }
  if (!ledger) return { ok: false, reason: 'Player minutes cannot be written on this phone.' };
  if (status !== 'available' && state.appearances.some((a) => a.playerId === playerId)) {
    return { ok: false, reason: 'They played in this match, so they were here.' };
  }
  const result = correctAttendance(ledger, state.match.id, playerId, status, note, now);
  if (result.ok) engine.setAvailability(state, playerId, status);
  return result;
}

/**
 * After a substitution: a child marked absent who has just come on arrived
 * late (ruling F). Null when they were not marked absent — nothing to record.
 */
export function recordLateArrival(
  engine: MatchEngine,
  state: MatchState,
  ledger: Ledger | null,
  playerId: UUID,
  now: Date
): CorrectionResult | null {
  if (!isMarkedAbsent(state, playerId)) return null;
  return correctMatchAttendance(engine, state, ledger, playerId, 'available', LATE_ARRIVAL_NOTE, now);
}
