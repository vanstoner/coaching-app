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
 * Invariant 3: fairness is total time on the pitch, goal plus outfield
 * (ADR-015, #101). Projected time is shown split by position KIND — goalkeeper
 * or outfield — as a breakdown, and never by which outfield position; the fair
 * share, deltas and spread are all on the total.
 */

import { matchFairShare, type NotInShare } from './fairShare';
import type { Format, Player, Position, UUID } from '../types/index';
import { displayName } from './squad';
import { formatClock, periodNoun } from './matchClock';
import { NO_SUB_PLANNED, type PlannedSub } from './subPlan';
import type { Sheet } from './teamSheet';

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
    subs: [...period.subs, { onId: null, offId: null, atMs: newSubTimeMs(periodMs) }],
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
  const atMs = clampSwapTime(swap.atMs + steps * SUB_STEP_MS, periodMs);
  return updateSwap(plan, periodIndex, swapIndex, { atMs });
}

/** A sub time held strictly inside the period: from 00:15 to the last step before the whistle. */
export function clampSwapTime(atMs: number, periodMs: number): number {
  const max = Math.floor((periodMs - 1) / SUB_STEP_MS) * SUB_STEP_MS;
  return Math.min(max, Math.max(SUB_STEP_MS, atMs));
}

/**
 * Who a planned sub can bring on, and who it can take off (PO, match day 4:
 * "only allow selection from off-field players or earlier subbed players").
 *
 * Walks the period up to this swap, in the same order the projection does
 * (time, then entry order): the starters, then each EARLIER complete swap.
 * Coming on: anyone not on the pitch at that moment, so the bench and anyone
 * subbed off earlier. Going off: anyone on the pitch at that moment. This
 * swap's own current picks stay offered, so a choice can be re-made.
 */
export function swapChoices(
  period: PlannedPeriod,
  swapIndex: number,
  players: Player[]
): { on: Player[]; off: Player[] } {
  const target = period.subs[swapIndex];
  if (!target) return { on: [], off: [] };
  const onPitch = new Set<UUID>();
  for (const who of Object.values(period.slots)) if (who !== null) onPitch.add(who);
  const earlier = period.subs
    .map((swap, order) => ({ swap, order }))
    .filter(
      ({ swap, order }) =>
        order !== swapIndex &&
        (swap.atMs < target.atMs || (swap.atMs === target.atMs && order < swapIndex))
    )
    .sort((a, b) => a.swap.atMs - b.swap.atMs || a.order - b.order);
  for (const { swap } of earlier) {
    if (swap.onId === null || swap.offId === null) continue;
    if (!onPitch.has(swap.offId) || onPitch.has(swap.onId)) continue;
    onPitch.delete(swap.offId);
    onPitch.add(swap.onId);
  }
  return {
    on: players.filter((p) => !onPitch.has(p.id) || p.id === target.onId),
    off: players.filter((p) => onPitch.has(p.id) || p.id === target.offId),
  };
}

/**
 * "Whoever is on longest" for a planned sub (#264 V20; QA on #260, D12):
 * the outfield player on the pitch at `atMs` who has been on longest
 * without a break, by the plan's own starters and earlier subs, as the
 * clock's suggestion (`offPicks`) is outfield only. Ties go to the earlier
 * position in the shape. Null when nobody outfield is on.
 *
 * The plan holds a named player for every sub, so the Plan resolves the
 * choice when it is saved, from the plan as it stands.
 */
export function longestOnAt(period: PlannedPeriod, swapIndex: number, atMs: number, format: Format): UUID | null {
  const kindOf = new Map(format.positions.map((p) => [p.id, p.kind]));
  const order = new Map(sortedPositions(format).map((p, i) => [p.id, i]));
  // Who holds each position, and since when.
  const holder = new Map<UUID, { who: UUID; since: number }>();
  for (const [positionId, who] of Object.entries(period.slots)) if (who !== null) holder.set(positionId as UUID, { who, since: 0 });
  const earlier = period.subs
    .map((swap, i) => ({ swap, i }))
    .filter(({ swap, i }) => i !== swapIndex && (swap.atMs < atMs || (swap.atMs === atMs && i < swapIndex)))
    .sort((a, b) => a.swap.atMs - b.swap.atMs || a.i - b.i);
  for (const { swap } of earlier) {
    if (swap.onId === null || swap.offId === null) continue;
    const at = [...holder].find(([, h]) => h.who === swap.offId);
    if (!at || [...holder.values()].some((h) => h.who === swap.onId)) continue;
    holder.set(at[0], { who: swap.onId, since: swap.atMs });
  }
  const candidates = [...holder]
    .filter(([positionId]) => kindOf.get(positionId) !== 'goalkeeper')
    .sort(([a, ha], [b, hb]) => ha.since - hb.since || (order.get(a) ?? 0) - (order.get(b) ?? 0));
  return candidates.length === 0 ? null : candidates[0][1].who;
}

export function removeSwap(plan: MatchPlan, periodIndex: number, swapIndex: number): MatchPlan {
  return withPeriod(plan, periodIndex, (period) => ({
    ...period,
    subs: period.subs.filter((_, i) => i !== swapIndex),
  }));
}

// ---------------------------------------------------------------------------
// Tap a bench player to plan their sub — #120
// ---------------------------------------------------------------------------

/**
 * Where every new sub starts: the period's midpoint, 6:15 in a 12:30 quarter
 * and 12:30 in a 25:00 half. The second and third subs too (#205 AC1).
 *
 * > *"I don't want to stagger subs automatically ... We usually bring them
 * > all off and shove them all on, so we can lose that code."* — Rob,
 * > 2026-10-17.
 *
 * This replaces the #120 rule that moved each further sub to the next free
 * 15-second step. Nothing already saved is moved (#205 AC5): this only
 * decides where a NEW sub starts, and the coach moves any one sub with the
 * ± steps without touching the others (AC2).
 */
export function newSubTimeMs(periodMs: number): number {
  return clampSwapTime(defaultSwapTimeMs(periodMs), periodMs);
}

/**
 * The index of the sub bringing this player on this period — the earliest,
 * if somehow there are two — or -1. One per player is what the menu keeps.
 */
export function benchSubIndex(period: PlannedPeriod, playerId: UUID): number {
  let found = -1;
  period.subs.forEach((s, i) => {
    if (s.onId !== playerId) return;
    if (found === -1 || s.atMs < period.subs[found].atMs) found = i;
  });
  return found;
}

/**
 * Who can come off for this player at this time: exactly who `swapChoices`
 * would offer the same sub, but only those on the pitch at that moment — the
 * sub's own previous pick is not kept on offer, since the menu asks afresh.
 */
export function benchSubOffChoices(
  period: PlannedPeriod,
  playerId: UUID,
  atMs: number,
  players: Player[]
): Player[] {
  const existing = benchSubIndex(period, playerId);
  const probe: PlannedSwap = { onId: playerId, offId: null, atMs };
  const subs =
    existing === -1
      ? [...period.subs, probe]
      : period.subs.map((s, i) => (i === existing ? probe : s));
  const index = existing === -1 ? subs.length - 1 : existing;
  return swapChoices({ ...period, subs }, index, players).off.filter((p) => p.id !== playerId);
}

/**
 * Plan a sub from the bench player's menu. Creates the same swap "Add a sub"
 * then picking on, off and time would, at the end of the list; if the player
 * already has a sub this period it is changed in place, never duplicated.
 */
export function planBenchSub(
  plan: MatchPlan,
  periodIndex: number,
  playerId: UUID,
  offId: UUID,
  atMs: number,
  periodMs: number
): MatchPlan {
  const period = plan.periods[periodIndex];
  if (!period) return plan;
  const at = clampSwapTime(atMs, periodMs);
  const existing = benchSubIndex(period, playerId);
  if (existing !== -1) return updateSwap(plan, periodIndex, existing, { offId, atMs: at });
  return withPeriod(plan, periodIndex, (p) => ({
    ...p,
    subs: [...p.subs, { onId: playerId, offId, atMs: at }],
  }));
}

/** Replace a period's starting slots — what a pitch move produces (#83). */
export function setPeriodSlots(
  plan: MatchPlan,
  periodIndex: number,
  slots: Record<UUID, UUID | null>
): MatchPlan {
  return withPeriod(plan, periodIndex, (period) => ({ ...period, slots: { ...slots } }));
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

/**
 * "Same as the previous period" (#111). A period already played or under
 * way copies who was on the pitch at its end, from the match record, and
 * keeps this period's planned subs; a period still to come copies its plan,
 * subs and all. Null when there is nothing to copy, so the screen can say so
 * instead of doing nothing.
 */
export function sameAsPrevious(
  plan: MatchPlan,
  to: number,
  recordedEnd: Record<UUID, UUID | null> | null
): MatchPlan | null {
  const from = to - 1;
  if (from < 0 || !plan.periods[to]) return null;
  if (recordedEnd) {
    if (!Object.values(recordedEnd).some((id) => id !== null)) return null;
    return withPeriod(plan, to, (period) => ({ ...period, slots: { ...recordedEnd } }));
  }
  const source = plan.periods[from];
  if (!source || !Object.values(source.slots).some((id) => id !== null)) return null;
  return copyPeriod(plan, from, to);
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
  /** `displayName`: "Alex S" and "Alex T" read apart (#54 AC7). */
  name: string;
  outfieldMs: number;
  goalkeeperMs: number;
  /** Goal plus outfield: the fairness figure (ADR-015). */
  pitchMs: number;
  /**
   * Difference from the fair share, on pitch time; null when the child is not
   * in the share: absent (#262) or the Main keeper (#261 Q1 b).
   */
  deltaMs: number | null;
  notInShare?: NotInShare;
}

export interface Projection {
  /** Every squad player, most owed first. */
  rows: ProjectedRow[];
  /** Goal plus outfield, summed over the squad. */
  totalPitchMs: number;
  /** The pitch time of the children in the share ÷ how many (`matchFairShare`, #261 item 1). */
  fairShareMs: number;
  /** Most minus least pitch time across the squad. */
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
  players: Player[],
  /**
   * Re-planning during play (#88). `fromPeriod` is the first period still to
   * come (0-based); earlier ones are history and are neither walked nor
   * checked. `baseline` is what each player already has — actual minutes so
   * far plus the rest of the period in progress — which the plan adds to.
   */
  live: {
    fromPeriod: number;
    baseline: Map<UUID, { outfieldMs: number; goalkeeperMs: number }>;
  } | null = null,
  /** Not available for this match (#262): out of the share, no gap. */
  absent: ReadonlySet<UUID> = new Set()
): Projection {
  const periodMs = periodLengthMs(totalMinutes, periodCount);
  const noun = periodNoun(periodCount);
  const nameOf = new Map(players.map((p) => [p.id, displayName(p)]));
  const name = (id: UUID) => nameOf.get(id) ?? 'A removed player';
  const positions = sortedPositions(format);

  const outfield = new Map<UUID, number>();
  const keeping = new Map<UUID, number>();
  const problems: PlanProblem[] = [];

  for (const [id, b] of live?.baseline ?? []) {
    if (b.outfieldMs > 0) outfield.set(id, b.outfieldMs);
    if (b.goalkeeperMs > 0) keeping.set(id, b.goalkeeperMs);
  }

  planFor(plan, periodCount).periods.forEach((period, periodIndex) => {
    if (live && periodIndex < live.fromPeriod) return; // already played
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

  // Invariant 3 (ADR-015, #101): the fairness figure is goal plus outfield.
  // Who is in the share is the one rule the match report uses too (#261
  // item 1, Rob 1b): the available, a Main keeper left out, fill-ins in (#262).
  const pitch = (id: UUID) => (outfield.get(id) ?? 0) + (keeping.get(id) ?? 0);
  const share = matchFairShare(
    players.map((p) => ({ playerId: p.id, pitchMs: pitch(p.id), present: !absent.has(p.id), mainKeeper: p.keeper === 'main' }))
  );
  const inShare = players.filter((p) => !share.out.has(p.id)).map((p) => pitch(p.id));
  const totalPitchMs = inShare.reduce((a, b) => a + b, 0);
  const fairShareMs = share.shareMs ?? 0;
  const spreadMs = inShare.length === 0 ? 0 : Math.max(...inShare) - Math.min(...inShare);

  const rows: ProjectedRow[] = players.map((p) => {
    const pitchMs = pitch(p.id);
    const out = share.out.get(p.id);
    return {
      playerId: p.id,
      name: displayName(p),
      outfieldMs: outfield.get(p.id) ?? 0,
      goalkeeperMs: keeping.get(p.id) ?? 0,
      pitchMs,
      deltaMs: out || share.shareMs === null ? null : Math.round(pitchMs - fairShareMs),
      ...(out ? { notInShare: out } : {}),
    };
  });
  // Furthest under the share first; then those out of it but available (the
  // Main keeper); the absent after every available child (#262 AC3); ties in
  // squad order. A rank, not +∞ for both: ∞ − ∞ is NaN and lost the order.
  const order = new Map(players.map((p, i) => [p.id, i]));
  const rank = (r: ProjectedRow) => (r.notInShare === 'absent' ? 2 : r.deltaMs === null ? 1 : 0);
  rows.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (rank(a) === 0 ? a.deltaMs! - b.deltaMs! : 0) ||
      order.get(a.playerId)! - order.get(b.playerId)!
  );

  return { rows, totalPitchMs, fairShareMs, spreadMs, problems };
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

// ---------------------------------------------------------------------------
// The whistle reads the plan — AC7
// ---------------------------------------------------------------------------

/** True when a period has anything planned in it. */
export function periodHasContent(period: PlannedPeriod | undefined): boolean {
  if (!period) return false;
  return Object.values(period.slots).some((v) => v !== null) || period.subs.length > 0;
}

/**
 * One planned period, as the lineup screen holds it: the team sheet, and a
 * sub entry for every bench player.
 *
 * Only what is sound is carried across. A player no longer in the squad, or
 * already placed in an earlier position, is left out, so the screen never
 * starts with a slot it cannot name. A bench player with a valid planned swap
 * gets its time and who it replaces; every other bench player starts as "no
 * sub", exactly as an unplanned period does. The live screen holds ONE entry
 * per bench player, so a second swap bringing the same player on is dropped.
 *
 * The coach can change all of it; what they start with is what is recorded
 * (AC8). This is a starting point, never a record.
 */
export function lineupFromPlan(
  period: PlannedPeriod,
  format: Format,
  players: Player[]
): { sheet: Sheet; subs: PlannedSub[] } {
  const known = new Set(players.map((p) => p.id));
  const sheet: Sheet = {};
  const placed = new Set<UUID>();
  for (const position of sortedPositions(format)) {
    const who = period.slots[position.id] ?? null;
    if (who !== null && known.has(who) && !placed.has(who)) {
      sheet[position.id] = who;
      placed.add(who);
    } else {
      sheet[position.id] = null;
    }
  }

  const bench = players.map((p) => p.id).filter((id) => !placed.has(id));
  const planned = new Map<UUID, PlannedSwap>();
  for (const swap of [...period.subs].sort((a, b) => a.atMs - b.atMs)) {
    if (swap.onId === null || swap.atMs <= 0) continue;
    if (!bench.includes(swap.onId) || planned.has(swap.onId)) continue;
    planned.set(swap.onId, swap);
  }

  const subs: PlannedSub[] = bench.map((playerId) => {
    const swap = planned.get(playerId);
    return {
      playerId,
      atMs: swap ? swap.atMs : NO_SUB_PLANNED,
      forPlayerId: swap && swap.offId !== null && known.has(swap.offId) ? swap.offId : null,
      done: false,
    };
  });
  return { sheet, subs };
}

/**
 * What each player already has during a live match (#88 AC3): minutes
 * actually played so far, plus the rest of the period in progress with the
 * players on now, by the kind of position they hold. Recomputed on every
 * call from the record, never stored (invariant 1).
 */
export function liveBaseline(
  played: { playerId: UUID; outfieldMs: number; goalkeeperMs: number }[],
  onNow: { playerId: UUID; positionKind: 'goalkeeper' | 'outfield' }[],
  remainingMs: number
): Map<UUID, { outfieldMs: number; goalkeeperMs: number }> {
  const out = new Map<UUID, { outfieldMs: number; goalkeeperMs: number }>();
  for (const m of played) out.set(m.playerId, { outfieldMs: m.outfieldMs, goalkeeperMs: m.goalkeeperMs });
  const rest = Math.max(0, remainingMs);
  for (const o of onNow) {
    const row = out.get(o.playerId) ?? { outfieldMs: 0, goalkeeperMs: 0 };
    if (o.positionKind === 'goalkeeper') row.goalkeeperMs += rest;
    else row.outfieldMs += rest;
    out.set(o.playerId, row);
  }
  return out;
}
