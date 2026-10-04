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
 * - **A match with no kick-off snapshot** (every v1 match, ruling C,
 *   ADR-015 §5) infers attended = played at least one interval. It is marked
 *   `inferred`, so a screen can say how many matches were.
 * - **Counted matches** are `completed` ones (ADR-015 §6): closed by the
 *   coach's End match (PO ruling D, #98).
 * - **In the squad at kick-off (ruling E):** a match is only missed by a child
 *   who was in the squad when it kicked off.
 * - **Played is attended (ruling F):** a child brought on is there, whatever
 *   the snapshot said; the app records that as a noted correction.
 * - **Average** = pitch time (goal + outfield) over counted matches attended
 *   ÷ the number of them; null, not zero, when there are none (§7, #102 AC3).
 */

import type { AvailabilityStatus, Player, UUID } from '../types/index';
import { keyOf } from './ledgerChain';
import type { Ledger, LedgerAttendance, LedgerMatch } from './ledger';

export interface PlayerAttendance {
  playerId: UUID;
  attended: boolean;
  /** The recorded status (latest revision); null when inferred from play. */
  status: AvailabilityStatus | null;
}

export interface MatchAttendance {
  /** True when no kick-off snapshot was recorded and attendance is inferred from play. */
  inferred: boolean;
  /**
   * Recorded: everyone in the kick-off snapshot, plus anyone who played
   * without being in it (attended). Inferred: the players who played, all
   * attended, plus any noted correction — who else was absent is not known
   * from the match alone.
   */
  players: PlayerAttendance[];
}

/** A kick-off snapshot is in the ledger: some record carries no note. */
function hasSnapshot(recorded: readonly LedgerAttendance[]): boolean {
  return recorded.some((a) => a.note == null);
}

/** Who attended one match (ADR-015 §4, §5). */
export function attendanceOf(match: LedgerMatch): MatchAttendance {
  const playedIds = new Set(match.intervals.map((i) => i.playerId));
  const recorded = match.attendance ?? [];
  const players: PlayerAttendance[] = recorded.map((a) => ({
    playerId: a.playerId,
    // Played is attended: their minutes are real.
    attended: a.status === 'available' || playedIds.has(a.playerId),
    status: a.status,
  }));
  // Played but not in the record (a player added after kick-off, or every
  // player of a v1 match): they were there.
  for (const playerId of playedIds) {
    if (!recorded.some((a) => a.playerId === playerId)) {
      players.push({ playerId, attended: true, status: null });
    }
  }
  return { inferred: !hasSnapshot(recorded), players };
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
 * What a season fold knows beyond the ledger, to say who was in the squad at
 * each match's kick-off (PO ruling E, #98).
 */
export interface SquadTimeline {
  /** The working squad, retired players included: each one's `createdAt`. */
  players?: readonly Pick<Player, 'id' | 'createdAt'>[];
  /**
   * When each match kicked off, for one with no `kickoffAt` (Play now): its
   * first period's start, from the working document (`kickoffTimes`).
   */
  kickoffs?: ReadonlyMap<UUID, string>;
}

/**
 * Each match's kick-off for ruling E: its `kickoffAt`, else the moment its
 * first period started. A match with neither is left out, and counts for
 * everyone (see `inSquadAt`).
 */
export function kickoffTimes(
  matches: readonly {
    match: { id: UUID; kickoffAt: string | null };
    quarters: readonly { index: number; startedAt: string | null }[];
  }[]
): Map<UUID, string> {
  const out = new Map<UUID, string>();
  for (const m of matches) {
    const first = [...m.quarters]
      .filter((q) => q.startedAt !== null)
      .sort((a, b) => a.index - b.index)[0];
    const at = m.match.kickoffAt ?? first?.startedAt ?? null;
    if (at !== null) out.set(m.match.id, at);
  }
  return out;
}

/** The first entry each record key appears in. */
export function firstSeen(ledger: Ledger): Map<string, number> {
  const seen = new Map<string, number>();
  for (const entry of ledger.entries) {
    for (const record of entry.records) {
      const key = keyOf(record);
      if (key !== null && !seen.has(key)) seen.set(key, entry.seq);
    }
  }
  return seen;
}

/**
 * Whether a player was in the squad when a match kicked off (PO ruling E):
 * their `createdAt` at or before the kick-off.
 *
 * - **Kick-off unknown** (no `kickoffAt`, no period start): counted — with no
 *   time to compare, the squad is taken as it is.
 * - **Not in the working squad** (known to the ledger only, so no
 *   `createdAt`): the ledger's own order decides — recorded no later than
 *   the match.
 *
 * Only a match's *missed* turns on this. A child who played, or who is in a
 * recorded attendance, was in the squad by the record's own say.
 */
export function inSquadAt(
  playerId: UUID,
  match: Pick<LedgerMatch, 'id' | 'kickoffAt'>,
  timeline: SquadTimeline,
  seen: ReadonlyMap<string, number>
): boolean {
  const player = timeline.players?.find((p) => p.id === playerId);
  const joined = player ? Date.parse(player.createdAt) : NaN;
  if (Number.isFinite(joined)) {
    const at = match.kickoffAt ?? timeline.kickoffs?.get(match.id) ?? null;
    const kickoff = at === null ? NaN : Date.parse(at);
    return Number.isFinite(kickoff) ? joined <= kickoff : true;
  }
  return (seen.get(`player:${playerId}`) ?? Infinity) <= (seen.get(`match:${match.id}`) ?? 0);
}

/** Who attended and who missed one match. */
export interface CountedAttendance {
  inferred: boolean;
  attended: Set<UUID>;
  missed: Set<UUID>;
}

/**
 * Attended and missed for one match (ADR-015 §4, §5; rulings E and F). The
 * one rule both the Settings figures and the charts fold with.
 *
 * - **Recorded** (a kick-off snapshot is in the ledger): the latest revision
 *   of each player's status — `available` attended, anything else missed.
 * - **Inferred** (no snapshot — every v1 match): played any interval
 *   attended; everyone else who was in the squad *at its kick-off* missed
 *   (E). A noted correction on such a match overrides the inference for
 *   that child.
 * - **Played is attended**, whatever a record says: the minutes are real.
 */
export function countedAttendance(
  ledger: Ledger,
  match: LedgerMatch,
  timeline: SquadTimeline = {},
  seen: ReadonlyMap<string, number> = firstSeen(ledger)
): CountedAttendance {
  const played = new Set(match.intervals.map((i) => i.playerId));
  const recorded = match.attendance ?? [];
  const inferred = !hasSnapshot(recorded);
  const attended = new Set<UUID>(played);
  const missed = new Set<UUID>();

  if (inferred) {
    const candidates = new Set<UUID>([
      ...ledger.players.map((p) => p.id),
      ...(timeline.players ?? []).map((p) => p.id),
    ]);
    for (const id of candidates) {
      if (!played.has(id) && inSquadAt(id, match, timeline, seen)) missed.add(id);
    }
  }
  // The latest revision per player (the ledger's fold already keeps only
  // that; a list carrying several is read the same way).
  const latest = new Map(recorded.map((a) => [a.playerId, a.status]));
  for (const [playerId, status] of latest) {
    if (played.has(playerId)) continue;
    if (status === 'available') {
      attended.add(playerId);
      missed.delete(playerId);
    } else {
      missed.add(playerId);
    }
  }
  return { inferred, attended, missed };
}

/**
 * Attended, missed and the absence-adjusted average for every player
 * (#102 AC3, AC4). Counted matches are closed ones: `completed`, by the
 * coach's End match (ruling D).
 */
export function seasonAttendance(
  ledger: Ledger,
  timeline: SquadTimeline = {}
): Map<UUID, SeasonAttendance> {
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
    const { attended, missed } = countedAttendance(ledger, match, timeline, seen);
    for (const id of attended) {
      const r = row(id);
      r.attended++;
      r.pitchMsAttended += pitch.get(id) ?? 0;
    }
    for (const id of missed) row(id).missed++;
  }

  for (const r of rows.values()) r.averageMs = r.attended > 0 ? r.pitchMsAttended / r.attended : null;
  return rows;
}

/** Counted matches a player missed. Derived, never stored (#100 AC3). */
export function gamesMissed(ledger: Ledger, playerId: UUID, timeline: SquadTimeline = {}): number {
  return seasonAttendance(ledger, timeline).get(playerId)?.missed ?? 0;
}

/** Counted matches a player attended. */
export function matchesAttended(ledger: Ledger, playerId: UUID, timeline: SquadTimeline = {}): number {
  return seasonAttendance(ledger, timeline).get(playerId)?.attended ?? 0;
}

/** How many counted matches had their attendance inferred from play (ADR-015 §5). */
export function inferredMatchCount(ledger: Ledger): number {
  return ledger.matches.filter((m) => m.status === 'completed' && attendanceOf(m).inferred).length;
}
