/**
 * Minutes per player — REQ-03 (#3), and the prerequisite for the substitution
 * reminder (REQ-04, #4).
 *
 * Pure TypeScript. No React, no platform imports, no storage.
 *
 * ---------------------------------------------------------------------------
 * Which invariants live here, and how
 * ---------------------------------------------------------------------------
 *
 * **Invariant 1 — minutes fold, they are never stored.** Nothing in this file
 * keeps a running total. Every figure is recomputed from the Appearance and
 * BenchStint records each time it is asked for, so the number on screen and the
 * audit trail are the same arithmetic and cannot drift apart.
 *
 * **Invariant 2 — wall-clock, not ticks.** An interval still open has no
 * `endElapsedMs`. It is closed at the *live* match elapsed the engine computes
 * from its anchors, so a player currently on the pitch has their time included
 * and it stays correct across a phone being asleep.
 *
 * **Invariant 3 — fairness is total OUTFIELD time, never per position.**
 * `outfieldMs` is the fairness figure. Goalkeeper time is counted separately
 * and deliberately excluded from it: a coach who puts a child in goal for a
 * quarter has made a decision, not created an unfairness, and measuring per
 * position would flag their own choices as anomalies. `totalMs` exists for
 * display — "how long have they been involved" — and must never be used to
 * decide who comes off.
 */

import { MatchEngine } from '../engine/MatchEngine';
import type { MatchState } from '../engine/MatchEngine';
import type { Player, UUID } from '../types/index';

export interface PlayerMinutes {
  playerId: UUID;
  /** **The fairness figure.** Outfield only, per invariant 3. */
  outfieldMs: number;
  /** Counted, shown, and never part of fairness. */
  goalkeeperMs: number;
  /** outfieldMs + goalkeeperMs. For display only — never for who comes off. */
  totalMs: number;
  /** Time on the bench. Not the inverse of totalMs: a player can be neither. */
  benchMs: number;
  onPitchNow: boolean;
  /**
   * How long this player has been on the pitch *without a break*, right now.
   *
   * This is what a substitution reminder needs — a child who has played 20
   * minutes in two spells is in a different state from one who has played 20
   * minutes straight. Zero when they are not on.
   */
  currentStintMs: number;
}

/**
 * Fold every player's minutes out of the match state.
 *
 * Players with no recorded time appear with zeros rather than being omitted, so
 * a squad list built from this never silently loses the child who has not been
 * on yet — which is exactly the child a fairness view most needs to show.
 */
export function foldPlayerMinutes(
  engine: MatchEngine,
  state: MatchState,
  players: Player[]
): PlayerMinutes[] {
  const now = engine.getMatchElapsedMs(state);

  const byPlayer = new Map<UUID, PlayerMinutes>();
  for (const player of players) {
    byPlayer.set(player.id, {
      playerId: player.id,
      outfieldMs: 0,
      goalkeeperMs: 0,
      totalMs: 0,
      benchMs: 0,
      onPitchNow: false,
      currentStintMs: 0,
    });
  }

  const blank = (playerId: UUID): PlayerMinutes => ({
    playerId,
    outfieldMs: 0,
    goalkeeperMs: 0,
    totalMs: 0,
    benchMs: 0,
    onPitchNow: false,
    currentStintMs: 0,
  });

  for (const appearance of state.appearances) {
    let row = byPlayer.get(appearance.playerId);
    if (!row) {
      // An appearance for someone not in the squad list passed in. Counted
      // rather than dropped: silently losing recorded time is the one thing
      // invariant 1 exists to prevent.
      row = blank(appearance.playerId);
      byPlayer.set(appearance.playerId, row);
    }

    // `?? now` rather than a boolean and a ternary: TypeScript does not narrow
    // through a separate `const open = ... === null`, and the compiler was
    // right to object — the tests never exercised a null because the engine
    // always writes one or the other.
    const open = appearance.endElapsedMs === null;
    const end = appearance.endElapsedMs ?? now;
    const ms = Math.max(0, end - appearance.startElapsedMs);

    if (appearance.positionKind === 'goalkeeper') {
      row.goalkeeperMs += ms;
    } else {
      row.outfieldMs += ms;
    }
    row.totalMs += ms;

    if (open) {
      row.onPitchNow = true;
      // A player could in principle hold two open appearances if a position
      // change were recorded without closing the first. Take the longest
      // rather than summing: this is "how long since they last sat down".
      row.currentStintMs = Math.max(row.currentStintMs, ms);
    }
  }

  for (const stint of state.benchStints) {
    let row = byPlayer.get(stint.playerId);
    if (!row) {
      row = blank(stint.playerId);
      byPlayer.set(stint.playerId, row);
    }
    const end = stint.endElapsedMs ?? now;
    row.benchMs += Math.max(0, end - stint.startElapsedMs);
  }

  // Squad order first, so the screen is stable; anyone unknown appended.
  const ordered: PlayerMinutes[] = [];
  for (const player of players) {
    const row = byPlayer.get(player.id);
    if (row) {
      ordered.push(row);
      byPlayer.delete(player.id);
    }
  }
  for (const row of byPlayer.values()) ordered.push(row);
  return ordered;
}

/**
 * The gap between the most and least played, measured in outfield time.
 *
 * This is the number that says whether the match is fair so far. It is
 * deliberately outfield-only (invariant 3), and it is zero for an empty squad
 * rather than undefined, because a screen should not have to special-case it.
 */
export function fairnessSpreadMs(minutes: PlayerMinutes[]): number {
  if (minutes.length === 0) return 0;
  let min = Infinity;
  let max = -Infinity;
  for (const m of minutes) {
    if (m.outfieldMs < min) min = m.outfieldMs;
    if (m.outfieldMs > max) max = m.outfieldMs;
  }
  return max - min;
}

/**
 * Who has played least, least first.
 *
 * The answer to "who should come on next". Ties keep squad order, so the same
 * question asked twice in a row gives the same answer — a list that reshuffles
 * under a coach's thumb at a touchline is worse than no list.
 */
export function leastPlayedFirst(minutes: PlayerMinutes[]): PlayerMinutes[] {
  return minutes
    .map((m, i) => ({ m, i }))
    .sort((a, b) => a.m.outfieldMs - b.m.outfieldMs || a.i - b.i)
    .map(({ m }) => m);
}

/**
 * Who has been on longest without a break, longest first, on-pitch only.
 *
 * The answer to "who should come off next", which is not the mirror of the
 * question above: the child who has played most in total may have just come
 * on. Ties keep squad order for the same reason.
 */
export function longestOnPitchFirst(minutes: PlayerMinutes[]): PlayerMinutes[] {
  return minutes
    .map((m, i) => ({ m, i }))
    .filter(({ m }) => m.onPitchNow)
    .sort((a, b) => b.m.currentStintMs - a.m.currentStintMs || a.i - b.i)
    .map(({ m }) => m);
}
