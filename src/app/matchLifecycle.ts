/**
 * A match's life on the device: created, opened, let go of, deleted — #99 AC1.
 *
 * These decisions lived in `App.tsx`, untested, and each was the site of a
 * defect a coach found on a Saturday. They are pure here, so every rule and
 * every past bug is a test that runs without a phone. `App.tsx` only calls
 * them and sets state.
 *
 * One builder for a stored match (`newMatch`): the fixture form, Play now and
 * the Test kit all create a match through it, and each records availability
 * at creation — everyone in today's squad `available` (#64). Before this the
 * fixture form wrote an empty availability list and relied on the open-time
 * back-fill; Play now and test data each built their match a third way.
 */

import { MatchEngine, type MatchState } from '../engine/MatchEngine';
import type { AvailabilityStatus, Competition, Format, Player, UUID } from '../types/index';
import { canDeleteFixture } from './fixtures';
import { withLiveMatch, type HeldMatch } from './liveMatch';
import { mergeCurrentMatch, type SavedMatch } from './persistence';
import { isActive } from './squad';

export interface NewMatchInput {
  squadId: UUID;
  /** The shape this match is played in. Snapshotted onto it (ADR-012). */
  format: Format;
  totalMinutes: number;
  periodCount: number;
  /**
   * The squad. Everyone active is recorded `available` (#64): without it no
   * bench stint is ever written. Retired players are left out.
   */
  players: Player[];
  /** Blank or whitespace is no opponent. */
  opponent?: string | null;
  competition?: Competition | null;
  kickoffAt?: string | null;
}

export interface NewMatch {
  /** The live state, for a match played straight away (Play now). */
  held: HeldMatch;
  /** The same match as it is stored, for a fixture saved for later. */
  stored: SavedMatch;
}

/**
 * Create a match: the one way a stored match comes into being.
 *
 * A fixture IS a match with status 'planned', so this goes through the engine
 * rather than building a parallel record. Its length, period count and shape
 * are copied onto it and belong to it from then on: changing a default later
 * must not re-shape a fixture already saved (#70).
 */
export function newMatch(input: NewMatchInput, nowFn: () => Date): NewMatch {
  const opponent = input.opponent?.trim() ? input.opponent.trim() : null;
  const state = new MatchEngine({ nowFn }).createMatch(input.squadId, input.format.id, {
    totalMinutes: input.totalMinutes,
    quarterCount: input.periodCount,
    availablePlayerIds: input.players.filter(isActive).map((p) => p.id),
    opponent,
    competition: input.competition ?? null,
    kickoffAt: input.kickoffAt ?? null,
  });
  return {
    held: { state, format: input.format },
    // Through the same fold every save uses, so the stored shape cannot drift
    // from what a save of the live match would write.
    stored: mergeCurrentMatch([], state, input.format)[0],
  };
}

/** The stored copy of a held match, for a screen that needs one (#88). */
export function storedFromHeld(held: HeldMatch): SavedMatch {
  return withLiveMatch([], held)[0];
}

/**
 * Who is available when a stored match is opened.
 *
 * A match NOT YET STARTED gets everyone in today's squad who is missing from
 * its list, as `available`: a fixture saved before availability was recorded
 * (#64) would otherwise play with an empty map and write no bench stints, and
 * a player added to the squad after the fixture was saved would get none
 * either. An entry already there is never changed, so a recorded absence
 * stands.
 *
 * A match that HAS been played is left exactly as recorded. Back-filling it
 * would invent a bench for children who may not have been there, and a
 * fabricated figure is indistinguishable from a measured one once stored.
 */
export function availabilityForOpening(
  stored: Pick<SavedMatch, 'availability' | 'quarters'>,
  players: Player[]
): Map<UUID, AvailabilityStatus> {
  const availability = new Map(stored.availability ?? []);
  const notStarted = stored.quarters.every((q) => q.status === 'pending');
  if (!notStarted) return availability;
  for (const player of players) {
    if (isActive(player) && !availability.has(player.id)) availability.set(player.id, 'available');
  }
  return availability;
}

/** What opening a match does to the live one. */
export type OpenOutcome<T extends HeldMatch> =
  /** It IS the live match: go back to it as it is. */
  | { kind: 'already_held'; held: T }
  /** Hold this, rebuilt from the stored copy. */
  | { kind: 'open'; held: HeldMatch }
  | { kind: 'not_found' };

/**
 * Open a match.
 *
 * The match already held is returned to as it is: rebuilding it from the
 * stored list would drop everything since it was last folded in. Any other is
 * rebuilt from its stored copy, events included — rebuilt without them, the
 * first goal after reopening started a fresh list and the next save wrote it
 * over every event already recorded (#84).
 */
export function openMatch<T extends HeldMatch>(
  matches: SavedMatch[],
  live: T | null,
  matchId: UUID,
  players: Player[],
  defaultFormat: Format
): OpenOutcome<T> {
  if (live && live.state.match.id === matchId) return { kind: 'already_held', held: live };
  const stored = matches.find((m) => m.match.id === matchId);
  if (!stored) return { kind: 'not_found' };
  const state: MatchState = {
    match: stored.match,
    quarters: stored.quarters,
    appearances: stored.appearances,
    benchStints: stored.benchStints,
    playerAvailability: availabilityForOpening(stored, players),
    events: stored.events ?? [],
  };
  // The shape THIS match is played in. A v3 save that somehow arrives
  // unmigrated has none, and the squad default is the only honest fallback:
  // it is the format that match was created against.
  return { kind: 'open', held: { state, format: stored.format ?? defaultFormat } };
}

/**
 * The stored list after the live match changes from `held` to `next`.
 *
 * The engine changes the live match in place and the list keeps the copy
 * from before kick-off, so the match being let go of is folded in FIRST.
 * Without this, leaving a finished match's summary saved that stale copy over
 * the played match — no periods, no appearances, no subs — and a Play-now
 * match, never in the list at all, was lost outright (PO, match day 4).
 */
export function matchesOnRelease(
  matches: SavedMatch[],
  held: HeldMatch | null,
  next: HeldMatch | null
): SavedMatch[] {
  return held && held !== next ? withLiveMatch(matches, held) : matches;
}

export type DeleteOutcome =
  | { ok: false }
  | {
      ok: true;
      matches: SavedMatch[];
      /**
       * The deleted fixture is the live match (opened and left without
       * kicking off). It must be let go of WITHOUT folding it in: a save that
       * still held it would write it straight back.
       */
      releaseLive: boolean;
    };

/**
 * Delete a fixture.
 *
 * Only one never played: deleting a played match would destroy the record its
 * minutes come from (invariant 5). Judged on the live state when it is the
 * match held, because the stored copy of a match kicked off a moment ago
 * still looks unplayed.
 */
export function deleteMatch(
  matches: SavedMatch[],
  live: HeldMatch | null,
  matchId: UUID
): DeleteOutcome {
  const judged = withLiveMatch(matches, live).find((m) => m.match.id === matchId);
  if (!judged || !canDeleteFixture(judged.quarters, judged.match.status)) return { ok: false };
  return {
    ok: true,
    matches: matches.filter((m) => m.match.id !== matchId),
    releaseLive: live?.state.match.id === matchId,
  };
}
