/**
 * The match plan — #72.
 *
 * Pure TypeScript.
 *
 * > *"I feel we've not yet got to the point where we can plan the halfs or
 * > quaters"* — PO, 2026-10-03, match day 4.
 *
 * The coach plans a match in a spreadsheet: every period's lineup by position,
 * the subs inside each period, and the minutes each player ends up with. This
 * is that spreadsheet, with the arithmetic done for them — the hand sum on
 * match day 4 was 7:30 short and nobody saw it.
 *
 * ---------------------------------------------------------------------------
 * A plan is intent, never a record
 * ---------------------------------------------------------------------------
 *
 * Invariant 1: minutes fold from what happened. Nothing here is ever folded
 * into a played figure. The projection is recomputed from the plan on every
 * call and never stored, and a match played differently from its plan shows
 * what was played (AC8).
 *
 * Slots are keyed by position id from the MATCH'S format snapshot (ADR-012),
 * so changing the squad's default shape cannot scramble a saved plan.
 *
 * Invariant 3: projected time is split by position KIND — goalkeeper or
 * outfield — and never by which outfield position.
 */

import type { Format, Player, Position, UUID } from '../types/index';
import { formatClock, periodNoun } from './matchClock';

/** One planned swap inside a period. */
export interface PlannedSwap {
  /** Who comes on. Null until the coach picks. */
  onId: UUID | null;
  /** Who comes off. Their position passes to `onId`. Null until picked. */
  offId: UUID | null;
  /** How far into the period, in ms. */
  atMs: number;
}

export interface PlannedPeriod {
  /** Position id → the player starting there, or null if not picked yet. */
  slots: Record<UUID, UUID | null>;
  subs: PlannedSwap[];
}

export interface MatchPlan {
  /** `periods[0]` is the first half or quarter. */
  periods: PlannedPeriod[];
}

/** Sub times move in 15-second steps: the PO's "nearest 15s" ruling (#62). */
export const SUB_STEP_MS = 15_000;

export function periodLengthMs(totalMinutes: number, periodCount: number): number {
  return (totalMinutes * 60_000) / periodCount;
}

/** A plan with every period empty. */
export function emptyPlan(periodCount: number): MatchPlan {
  return { periods: Array.from({ length: periodCount }, () => ({ slots: {}, subs: [] })) };
}

/**
 * The plan sized to this match.
 *
 * A stored plan with too few periods is padded and one with too many is cut,
 * so a screen never reads a period that does not exist. Neither should happen
 * — a fixture's period count is fixed once saved — but a plan is not worth a
 * crash.
 */
export function planFor(stored: MatchPlan | undefined, periodCount: number): MatchPlan {
  const periods = (stored?.periods ?? []).slice(0, periodCount);
  while (periods.length < periodCount) periods.push({ slots: {}, subs: [] });
  return { periods };
}

function withPeriod(
  plan: MatchPlan,
  index: number,
  change: (period: PlannedPeriod) => PlannedPeriod
): MatchPlan {
  return { periods: plan.periods.map((p, i) => (i === index ? change(p) : p)) };
}

/**
 * Put a player in a position for the start of a period.
 *
 * A player already in another position that period is moved, not duplicated:
 * one child in two places is the mistake a tap is most likely to make.
 */
export function setSlot(
  plan: MatchPlan,
  periodIndex: number,
  positionId: UUID,
  playerId: UUID | null
): MatchPlan {
  return withPeriod(plan, periodIndex, (period) => {
    const slots: Record<UUID, UUID | null> = {};
    for (const [pos, who] of Object.entries(period.slots)) {
      slots[pos as UUID] = playerId !== null && who === playerId ? null : who;
    }
    slots[positionId] = playerId;
    return { ...period, slots };
  });
}

/** The midpoint of the period, on a 15-second step. */
export function defaultSwapTimeMs(periodMs: number): number {
  return Math.round(periodMs / 2 / SUB_STEP_MS) * SUB_STEP_MS;
}

export function addSwap(plan: MatchPlan, periodIndex: number, periodMs: number): MatchPlan {
  return withPeriod(plan, periodIndex, (period) => ({
    ...period,
    subs: [...period.subs, { onId: null, offId: null, atMs: defaultSwapTimeMs(periodMs) }],
  }));
}

export function updateSwap(
  plan: MatchPlan,
  periodIndex: number,
  swapIndex: number,
  change: Partial<PlannedSwap>
): MatchPlan {
  return withPeriod(plan, periodIndex, (period) => ({
    ...period,
    subs: period.subs.map((s, i) => (i === swapIndex ? { ...s, ...change } : s)),
  }));
}

/** Move a swap by whole 15-second steps, kept strictly inside the period. */
export function nudgeSwap(
  plan: MatchPlan,
  periodIndex: number,
  swapIndex: number,
  steps: number,
  periodMs: number
): MatchPlan {
  const swap = plan.periods[periodIndex]?.subs[swapIndex];
  if (!swap) return plan;
  const max = Math.floor((periodMs - 1) / SUB_STEP_MS) * SUB_STEP_MS;
  const atMs = Math.min(max, Math.max(SUB_STEP_MS, swap.atMs + steps * SUB_STEP_MS));
  return updateSwap(plan, periodIndex, swapIndex, { atMs });
}

export function removeSwap(plan: MatchPlan, periodIndex: number, swapIndex: number): MatchPlan {
  return withPeriod(plan, periodIndex, (period) => ({
    ...period,
    subs: period.subs.filter((_, i) => i !== swapIndex),
  }));
}

/** Start a period as a copy of another — most periods are a small change. */
export function copyPeriod(plan: MatchPlan, from: number, to: number): MatchPlan {
  const source = plan.periods[from];
  if (!source) return plan;
  return withPeriod(plan, to, () => ({
    slots: { ...source.slots },
    subs: source.subs.map((s) => ({ ...s })),
  }));
}

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

export interface PlanProblem {
  /** 0-based period index. */
  periodIndex: number;
  /** Plain English, for the screen. */
  message: string;
}

export interface ProjectedRow {
  playerId: UUID;
  firstName: string;
  outfieldMs: number;
  goalkeeperMs: number;
  /**
   * Difference from the fair share. Null for a player in goal for the whole
   * match, who is not in the outfield share at all.
   */
  deltaMs: number | null;
}

export interface Projection {
  /** Every squad player, most owed first; full-match keepers last. */
  rows: ProjectedRow[];
  totalOutfieldMs: number;
  /** Total outfield ÷ players not in goal for the whole match. */
  fairShareMs: number;
  /** Most minus least outfield time among those same players. */
  spreadMs: number;
  problems: PlanProblem[];
}

function sortedPositions(format: Format): Position[] {
  return [...format.positions].sort((a, b) => a.sortOrder - b.sortOrder);
}

/**
 * What the plan adds up to, and what is wrong with it.
 *
 * Each period is walked in time order. Everyone on accumulates time by the
 * KIND of position they hold; at a valid swap the player coming on takes the
 * position of the player going off. An invalid swap is reported and left out,
 * so the figures are those of a match where the coach skips it.
 */
export function projectPlan(
  plan: MatchPlan,
  format: Format,
  totalMinutes: number,
  periodCount: number,
  players: Player[]
): Projection {
  const periodMs = periodLengthMs(totalMinutes, periodCount);
  const matchMs = totalMinutes * 60_000;
  const noun = periodNoun(periodCount);
  const nameOf = new Map(players.map((p) => [p.id, p.firstName]));
  const name = (id: UUID) => nameOf.get(id) ?? 'A removed player';
  const positions = sortedPositions(format);

  const outfield = new Map<UUID, number>();
  const keeping = new Map<UUID, number>();
  const problems: PlanProblem[] = [];

  planFor(plan, periodCount).periods.forEach((period, periodIndex) => {
    const problem = (message: string) => problems.push({ periodIndex, message });

    // Who is where at the whistle. A player in two places counts once, in
    // the first, and is reported.
    const on = new Map<UUID, Position>();
    for (const position of positions) {
      const who = period.slots[position.id] ?? null;
      if (who === null) {
        problem(`${position.label} has nobody in it.`);
        continue;
      }
      if (on.has(who)) {
        problem(`${name(who)} is in two positions.`);
        continue;
      }
      on.set(who, position);
    }

    const credit = (fromMs: number, toMs: number) => {
      const span = toMs - fromMs;
      if (span <= 0) return;
      for (const [who, position] of on) {
        const ledger = position.kind === 'goalkeeper' ? keeping : outfield;
        ledger.set(who, (ledger.get(who) ?? 0) + span);
      }
    };

    let at = 0;
    const swaps = period.subs
      .map((swap, order) => ({ swap, order }))
      .sort((a, b) => a.swap.atMs - b.swap.atMs || a.order - b.order);

    for (const { swap } of swaps) {
      const when = formatClock(swap.atMs);
      if (swap.onId === null || swap.offId === null) {
        problem(`Sub at ${when}: pick who comes on and who comes off.`);
        continue;
      }
      if (!(swap.atMs > 0 && swap.atMs < periodMs)) {
        problem(`Sub at ${when} is outside the ${noun.toLowerCase()}.`);
        continue;
      }
      if (on.has(swap.onId)) {
        problem(`Sub at ${when}: ${name(swap.onId)} is already on.`);
        continue;
      }
      const position = on.get(swap.offId);
      if (!position) {
        problem(`Sub at ${when}: ${name(swap.offId)} is not on at that point.`);
        continue;
      }
      credit(at, swap.atMs);
      at = swap.atMs;
      on.delete(swap.offId);
      on.set(swap.onId, position);
    }
    credit(at, periodMs);
  });

  const fullTimeKeeper = (id: UUID) =>
    (keeping.get(id) ?? 0) >= matchMs && (outfield.get(id) ?? 0) === 0;
  const sharers = players.filter((p) => !fullTimeKeeper(p.id));
  const totalOutfieldMs = [...outfield.values()].reduce((a, b) => a + b, 0);
  const fairShareMs = sharers.length === 0 ? 0 : totalOutfieldMs / sharers.length;
  const shares = sharers.map((p) => outfield.get(p.id) ?? 0);
  const spreadMs = shares.length === 0 ? 0 : Math.max(...shares) - Math.min(...shares);

  const rows: ProjectedRow[] = players.map((p) => {
    const outfieldMs = outfield.get(p.id) ?? 0;
    return {
      playerId: p.id,
      firstName: p.firstName,
      outfieldMs,
      goalkeeperMs: keeping.get(p.id) ?? 0,
      deltaMs: fullTimeKeeper(p.id) ? null : Math.round(outfieldMs - fairShareMs),
    };
  });
  // Most owed first, as the live fairness table does; ties in squad order.
  const order = new Map(players.map((p, i) => [p.id, i]));
  rows.sort((a, b) => {
    if (a.deltaMs === null || b.deltaMs === null) {
      if (a.deltaMs === b.deltaMs) return order.get(a.playerId)! - order.get(b.playerId)!;
      return a.deltaMs === null ? 1 : -1;
    }
    return a.deltaMs - b.deltaMs || order.get(a.playerId)! - order.get(b.playerId)!;
  });

  return { rows, totalOutfieldMs, fairShareMs, spreadMs, problems };
}

/** "+04:10" / "-05:50" / "±00:00", for a difference from the fair share. */
export function formatDelta(ms: number): string {
  const rounded = Math.round(ms / 1000) * 1000;
  if (rounded === 0) return '±00:00';
  return `${rounded > 0 ? '+' : '-'}${formatClock(Math.abs(rounded))}`;
}

/** True when the plan has at least one player in it — worth saving. */
export function planHasContent(plan: MatchPlan | undefined): boolean {
  return (plan?.periods ?? []).some(
    (p) => Object.values(p.slots).some((v) => v !== null) || p.subs.length > 0
  );
}
