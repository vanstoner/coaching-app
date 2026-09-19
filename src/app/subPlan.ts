/**
 * Planned substitutions within a period — REQ-04 (#4).
 *
 * Pure TypeScript.
 *
 * ---------------------------------------------------------------------------
 * What the coach asked for
 * ---------------------------------------------------------------------------
 *
 * > *"if we have 2 subs we will throughout the course of a quarter or half
 * > rotate them through a specified time, e.g. 6.15 mins in a quarter. I should
 * > be able to set that time for a sub next to their name and that's the anchor
 * > for a reminder"*
 *
 * So a substitution is planned as **a player and a time into the period**. The
 * default is the midpoint — 6:15 into a 12:30 quarter, which is the coach's own
 * example — and every entry is individually adjustable, because a coach who
 * cannot move the time will stop using the plan the first week it does not fit.
 *
 * The plan is an intention, not a record. Nothing here changes who is on the
 * pitch; it decides *when to tell the coach*. The swap itself goes through
 * `MatchEngine.substitute`, so the minutes still fold from intervals and the
 * displayed figure cannot part company with the truth (invariant 1).
 *
 * Times are offsets into the CURRENT period, not match-elapsed. A coach thinks
 * "six minutes into this quarter", never "thirty-one minutes into the match".
 */

import type { UUID } from '../types/index';

/**
 * `atMs` when the coach has decided this player is NOT coming on this period.
 *
 * Field note, 2026-09-19 (#62), from the first real match:
 *
 * > *"we need to cater for the case where we don't plan to sub them on in a
 * > quarter. So a value of 0 should be allowed which would indicate no sub
 * > plan"*
 *
 * Zero is not a time here, it is the absence of one. Before this, every bench
 * player carried a planned time whether the coach wanted one or not, so a
 * squad with three substitutes and two coming on had no way to say so — and
 * the third player's reminder fired anyway, mid-match, wrongly.
 */
export const NO_SUB_PLANNED = 0;

export interface PlannedSub {
  /** The player coming on. */
  playerId: UUID;
  /** How far into the period they should come on, or NO_SUB_PLANNED. */
  atMs: number;
  /**
   * Who they replace. Null means the coach has not said, and the app will
   * suggest whoever has been on longest at the time.
   */
  forPlayerId: UUID | null;
  /** Set once the coach has actually made the swap. */
  done: boolean;
}

/** True when this entry names a real moment rather than "not this period". */
export function isPlanned(sub: PlannedSub): boolean {
  return sub.atMs > 0;
}

/**
 * The default moment to bring a substitute on: halfway through the period.
 *
 * Every planned sub defaults to the same point rather than being spread out.
 * That matches how this squad plays — one rotation moment, everyone who is
 * coming on comes on — and it matches the PO's example exactly: a 12:30 quarter
 * gives 6:15. Spreading them would be tidier arithmetic and a worse fit for a
 * coach juggling a whistle.
 */
export function defaultSubTimeMs(periodMs: number): number {
  if (!Number.isFinite(periodMs) || periodMs <= 0) return 0;
  return Math.floor(periodMs / 2);
}

/**
 * Build a starting plan: everyone on the bench, NOBODY scheduled.
 *
 * PO ruling from the second round of field testing, 2026-09-19 (#62):
 *
 * > *"always start with no sub then I can increment the sub timer, first
 * > increment should be half way through the half or quarter then + and -
 * > should just increment or decrement by as appropriate 30s"*
 *
 * The first version defaulted everyone to the midpoint, which meant a coach
 * who wanted two of three substitutes on had to turn one OFF — work to undo
 * something they never asked for. Defaulting to nothing makes the common case
 * one press per player who is actually coming on, and the uncommon case
 * costs nothing at all.
 *
 * `defaultSubTimeMs` is still the midpoint; it is now where the FIRST press
 * lands rather than where everyone starts.
 */
export function planSubs(benchPlayerIds: UUID[], periodMs: number): PlannedSub[] {
  void periodMs; // kept in the signature: the period is what a time would clamp to
  return benchPlayerIds.map((playerId) => ({
    playerId,
    atMs: NO_SUB_PLANNED,
    forPlayerId: null,
    done: false,
  }));
}

/**
 * Move one planned substitution, clamped inside the period.
 *
 * A sub planned after the whistle would never fire, and one at zero is a
 * starter rather than a substitute, so both ends are held one second inside.
 */
export function setSubTime(
  plan: PlannedSub[],
  playerId: UUID,
  atMs: number,
  periodMs: number
): PlannedSub[] {
  // Zero or below means "not coming on this period" and is kept exactly,
  // rather than clamped up to one second as it used to be. The old clamp made
  // the coach's actual intention inexpressible.
  const value =
    atMs <= 0
      ? NO_SUB_PLANNED
      : Math.max(1_000, Math.min(atMs, Math.max(1_000, periodMs - 1_000)));
  return plan.map((s) => (s.playerId === playerId ? { ...s, atMs: value } : s));
}

/**
 * Nudge a planned time by a step, keeping it inside the period.
 *
 * The two ends are where this earns its keep at a touchline. Nudging DOWN past
 * the start turns the plan off — one more press of the same button a coach is
 * already pressing, rather than a separate control. Nudging UP from off jumps
 * straight to the default rather than to one second, because a coach turning a
 * sub back on means "about halfway", not "immediately".
 */
export function nudgeSubTime(
  plan: PlannedSub[],
  playerId: UUID,
  deltaMs: number,
  periodMs: number
): PlannedSub[] {
  const entry = plan.find((s) => s.playerId === playerId);
  if (!entry) return plan;
  if (entry.atMs === NO_SUB_PLANNED) {
    if (deltaMs <= 0) return plan; // already off; nothing below it
    return setSubTime(plan, playerId, defaultSubTimeMs(periodMs), periodMs);
  }
  return setSubTime(plan, playerId, entry.atMs + deltaMs, periodMs);
}

/** Turn a planned substitution off without losing the player from the plan. */
export function clearSubTime(plan: PlannedSub[], playerId: UUID): PlannedSub[] {
  return plan.map((s) => (s.playerId === playerId ? { ...s, atMs: NO_SUB_PLANNED } : s));
}

export function markDone(plan: PlannedSub[], playerId: UUID): PlannedSub[] {
  return plan.map((s) => (s.playerId === playerId ? { ...s, done: true } : s));
}

/**
 * Which substitutions are due now: planned, not yet made, and the moment has
 * passed. Earliest first, so the coach is told about the oldest one first.
 *
 * Deliberately `>=` and never expiring. A sub due at 6:15 that the coach has
 * not made by 9:00 is still due — the whole point is that he forgot, and an
 * alert that quietly gives up is worse than none.
 */
export function dueSubs(plan: PlannedSub[], periodElapsedMs: number): PlannedSub[] {
  return plan
    .filter((s) => isPlanned(s) && !s.done && periodElapsedMs >= s.atMs)
    .sort((a, b) => a.atMs - b.atMs);
}

/** The next substitution not yet due, for a countdown. Null when none remain. */
export function nextSub(plan: PlannedSub[], periodElapsedMs: number): PlannedSub | null {
  const upcoming = plan
    .filter((s) => isPlanned(s) && !s.done && periodElapsedMs < s.atMs)
    .sort((a, b) => a.atMs - b.atMs);
  return upcoming[0] ?? null;
}

/** How long until the next planned substitution. Null when none remain. */
export function msUntilNextSub(
  plan: PlannedSub[],
  periodElapsedMs: number
): number | null {
  const next = nextSub(plan, periodElapsedMs);
  return next === null ? null : Math.max(0, next.atMs - periodElapsedMs);
}

/**
 * Who should come off for this substitute.
 *
 * The coach's own choice if they made one and that player is still on.
 * Otherwise whoever has been on longest without a break — which is the
 * question a coach is actually asking at that moment, and is not the same as
 * who has played most in total.
 *
 * Returns null when there is nobody to take off, which the screen must handle
 * rather than assume away.
 */
export function whoComesOff(
  sub: PlannedSub,
  onPitch: { playerId: UUID; currentStintMs: number }[]
): UUID | null {
  if (onPitch.length === 0) return null;
  if (sub.forPlayerId && onPitch.some((p) => p.playerId === sub.forPlayerId)) {
    return sub.forPlayerId;
  }
  return [...onPitch].sort((a, b) => b.currentStintMs - a.currentStintMs)[0].playerId;
}
