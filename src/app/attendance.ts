/**
 * Attendance and games missed, derived from the ledger — #102, ADR-014 §4,
 * ADR-015 §4–7.
 *
 * Pure TypeScript. Nothing here is stored: matches attended, games missed and
 * the per-match average are folded from the ledger every time (invariant 1).
 *
 * > *"Not everyone plays every match so we need to keep track in the overall
 * > ledger of games missed... so we don't skew playing time and can justify
 * > across a season."* — PO, 2026-10-04 (#98)
 *
 * - **Attended = available at kick-off** (ruling B, ADR-015 §4), even if
 *   benched for the whole match: that match counts against their average,
 *   because a child benched all match is exactly what this measure exists to
 *   show. `absent`, `injured` and `unavailable` are games missed.
 * - **A match with no attendance records** (every v1 match, ruling C,
 *   ADR-015 §5) infers attended = played at least one interval. It is marked
 *   `inferred`, so a screen can say how many matches were.
 * - **Counted matches** are `completed` ones (ADR-015 §6).
 * - **Average** = pitch time (goal + outfield) over counted matches attended
 *   ÷ the number of them; null, not zero, when there are none (§7, #102 AC3).
 */

import type { AvailabilityStatus, UUID } from '../types/index';
import { keyOf } from './ledgerChain';
import type { Ledger, LedgerMatch } from './ledger';

export interface PlayerAttendance {
  playerId: UUID;
  attended: boolean;
  /** The recorded status (latest revision); null when inferred from play. */
  status: AvailabilityStatus | null;
}

export interface MatchAttendance {
  /** True when nothing was recorded and attendance is inferred from play. */
  inferred: boolean;
  /**
   * Recorded: everyone in the kick-off snapshot, plus anyone who played
   * without being in it (attended). Inferred: only the players who played,
   * all attended — who was absent is not known from the match alone.
   */
  players: PlayerAttendance[];
}

/** Who attended one match (ADR-015 §4, §5). */
export function attendanceOf(match: LedgerMatch): MatchAttendance {
  const playedIds = new Set(match.intervals.map((i) => i.playerId));
  const recorded = match.attendance ?? [];
  if (recorded.length === 0) {
    return {
      inferred: true,
      players: [...playedIds].map((playerId) => ({ playerId, attended: true, status: null })),
    };
  }
  const players: PlayerAttendance[] = recorded.map((a) => ({
    playerId: a.playerId,
    attended: a.status === 'available',
    status: a.status,
  }));
  // Played but not in the snapshot (a player added after kick-off): they
  // were there.
  for (const playerId of playedIds) {
    if (!recorded.some((a) => a.playerId === playerId)) {
      players.push({ playerId, attended: true, status: null });
    }
  }
  return { inferred: false, players };
}

export interface SeasonAttendance {
  playerId: UUID;
  /** Counted (completed) matches attended. */
  attended: number;
  /** Counted matches missed: absent, injured or unavailable. */
  missed: number;
  /** Pitch time (goal + outfield) over counted matches attended. */
  pitchMsAttended: number;
  /** pitchMsAttended ÷ attended; null when none attended (#102 AC3). */
  averageMs: number | null;
}

/**
 * The first entry each record key appears in. An inferred match only counts
 * as missed for a player who was already in the ledger when the match was
 * first recorded — a child who joined later did not miss it.
 */
function firstSeen(ledger: Ledger): Map<string, number> {
  const seen = new Map<string, number>();
  for (const entry of ledger.entries) {
    for (const record of entry.records) {
      const key = keyOf(record);
      if (key !== null && !seen.has(key)) seen.set(key, entry.seq);
    }
  }
  return seen;
}

/** Attended, missed and the absence-adjusted average for every player (#102 AC3, AC4). */
export function seasonAttendance(ledger: Ledger): Map<UUID, SeasonAttendance> {
  const rows = new Map<UUID, SeasonAttendance>();
  const row = (playerId: UUID) => {
    let r = rows.get(playerId);
    if (!r) {
      r = { playerId, attended: 0, missed: 0, pitchMsAttended: 0, averageMs: null };
      rows.set(playerId, r);
    }
    return r;
  };
  for (const p of ledger.players) row(p.id);
  const seen = firstSeen(ledger);

  for (const match of ledger.matches) {
    if (match.status !== 'completed') continue;
    const pitch = new Map<UUID, number>();
    for (const i of match.intervals) {
      pitch.set(i.playerId, (pitch.get(i.playerId) ?? 0) + Math.max(0, i.endMs - i.startMs));
    }
    const { inferred, players } = attendanceOf(match);
    for (const a of players) {
      const r = row(a.playerId);
      if (a.attended) {
        r.attended++;
        r.pitchMsAttended += pitch.get(a.playerId) ?? 0;
      } else {
        r.missed++;
      }
    }
    if (inferred) {
      const matchSeen = seen.get(`match:${match.id}`) ?? 0;
      const there = new Set(players.map((a) => a.playerId));
      for (const p of ledger.players) {
        if (there.has(p.id)) continue;
        if ((seen.get(`player:${p.id}`) ?? Infinity) <= matchSeen) row(p.id).missed++;
      }
    }
  }

  for (const r of rows.values()) r.averageMs = r.attended > 0 ? r.pitchMsAttended / r.attended : null;
  return rows;
}

/** Counted matches a player missed. Derived, never stored (#100 AC3). */
export function gamesMissed(ledger: Ledger, playerId: UUID): number {
  return seasonAttendance(ledger).get(playerId)?.missed ?? 0;
}

/** Counted matches a player attended. */
export function matchesAttended(ledger: Ledger, playerId: UUID): number {
  return seasonAttendance(ledger).get(playerId)?.attended ?? 0;
}

/** How many counted matches had their attendance inferred from play (ADR-015 §5). */
export function inferredMatchCount(ledger: Ledger): number {
  return ledger.matches.filter((m) => m.status === 'completed' && attendanceOf(m).inferred).length;
}
