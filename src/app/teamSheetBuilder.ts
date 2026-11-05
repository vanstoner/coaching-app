/**
 * Build the team sheet — #277 B7–B11, ADR-024 D2–D4.
 *
 * Pure TypeScript (the engine stays pure: no React, no platform). It fills
 * every period of a match plan from four choices the coach can see at once:
 * who's coming, the keepers, mid-period subs, and Even or Shuffle.
 *
 * - **Keepers** (B7, D2): one per period. Rotate takes the coming child not
 *   marked Not in goal with the least time in goal this season (this plan's
 *   periods counted as it goes); ties to whoever is owed most, then squad
 *   order. A Main keeper who is coming keeps every period. The season's goal
 *   time is an input to this suggestion only: never stored, never a target
 *   (invariant 3, ADR-015).
 * - **Mid-period subs** (B9): at most one per period, at its midpoint (#205).
 *   Whoever has played most comes off, for whoever has played least. The
 *   keeper never comes off.
 * - **Everyone else** (B10, B11): equal pitch time across the match, in
 *   half-periods with subs and whole periods without, with the best spread
 *   those units allow. Ties go to who is owed most this season (D3). Even is
 *   the same answer every time; Shuffle breaks ties differently per seed.
 *   Positions rotate from period to period.
 *
 * The result is an ordinary `MatchPlan` (B12, D6): it moves no minute
 * (invariant 1), and the Plan, Share plan and the clock read it as before.
 */

import type { Format, Player, Position, UUID } from '../types/index';
import { defaultSwapTimeMs, periodLengthMs, type MatchPlan, type PlannedPeriod } from './matchPlan';

/** What the season says about one child, worked out from the record by the caller. */
export interface SeasonInput {
  /** Time in goal this season, ms. Keeper rotation only (D2). */
  goalMs: number;
  /** Owed time this season (Going into Saturday's figure), ms; null when there is none (D3). */
  owedMs: number | null;
}

export type Fill = 'even' | 'shuffle';

export interface BuildInput {
  format: Format;
  totalMinutes: number;
  periodCount: number;
  /** The children coming, in squad order. */
  coming: readonly Player[];
  /** Each period's keeper (see `rotateKeepers`); null leaves goal to the fill. */
  keepers: readonly (UUID | null)[];
  /** Place one mid-period sub per period (B9), or none. */
  subs: boolean;
  fill: Fill;
  /** Shuffle's seed: a new one per tap. Ignored for Even. */
  seed?: number;
  season: ReadonlyMap<UUID, SeasonInput>;
}

export interface BuiltSheet {
  plan: MatchPlan;
  /** Each child's planned pitch time, ms. */
  minutes: Map<UUID, number>;
  /** max − min of `minutes`, ms. */
  rangeMs: number;
}

const owed = (season: ReadonlyMap<UUID, SeasonInput>, id: UUID) => season.get(id)?.owedMs ?? 0;

/**
 * Each period's keeper, rotating (B7). A Main keeper who is coming keeps
 * every period. Otherwise each period takes the eligible child with the least
 * time in goal, the season's plus this plan's so far; ties to the most owed,
 * then squad order. Null for a period when nobody coming may go in goal.
 */
export function rotateKeepers(
  coming: readonly Player[],
  periodCount: number,
  periodMs: number,
  season: ReadonlyMap<UUID, SeasonInput>
): (UUID | null)[] {
  const main = coming.find((p) => p.keeper === 'main');
  if (main) return Array.from({ length: periodCount }, () => main.id);
  const eligible = coming.filter((p) => p.keeper !== 'never');
  const goal = new Map(eligible.map((p) => [p.id, season.get(p.id)?.goalMs ?? 0]));
  const order = new Map(coming.map((p, i) => [p.id, i]));
  const keepers: (UUID | null)[] = [];
  for (let i = 0; i < periodCount; i++) {
    const next = [...eligible].sort(
      (a, b) =>
        goal.get(a.id)! - goal.get(b.id)! ||
        owed(season, b.id) - owed(season, a.id) ||
        order.get(a.id)! - order.get(b.id)!
    )[0];
    keepers.push(next ? next.id : null);
    if (next) goal.set(next.id, goal.get(next.id)! + periodMs);
  }
  return keepers;
}

/** A small seeded generator (mulberry32): Shuffle and the search are repeatable. */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: readonly T[], next: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** One period's time, in half-periods: who is full (2), who starts and comes off, who comes on. */
interface PeriodTime {
  keeper: UUID | null;
  full: UUID[];
  off: UUID | null;
  on: UUID | null;
}

/**
 * Hand out each period's outfield time, in halves, by need. `order` breaks
 * every tie, so trying several orders searches the ways the rule can go.
 */
function allocate(
  ids: readonly UUID[],
  order: readonly UUID[],
  keepers: readonly (UUID | null)[],
  outfieldSlots: number,
  useSubs: boolean,
  season: ReadonlyMap<UUID, SeasonInput>
): { periods: PeriodTime[]; halves: Map<UUID, number> } {
  const rank = new Map(order.map((id, i) => [id, i]));
  const periodCount = keepers.length;
  const keeperHalves = keepers.filter((k) => k !== null).length * 2;
  const total = outfieldSlots * 2 * periodCount + keeperHalves;
  const base = Math.floor(total / ids.length);
  // Who gets the extra half: most owed first, then the order (D3).
  const extra = total - base * ids.length;
  const byOwed = [...ids].sort((a, b) => owed(season, b) - owed(season, a) || rank.get(a)! - rank.get(b)!);
  const target = new Map(ids.map((id) => [id, base + (byOwed.indexOf(id) < extra ? 1 : 0)]));
  const halves = new Map(ids.map((id) => [id, 0]));
  const periods: PeriodTime[] = [];

  keepers.forEach((keeper, p) => {
    if (keeper !== null) halves.set(keeper, halves.get(keeper)! + 2);
    const left = periodCount - p;
    const need = (id: UUID) => target.get(id)! - halves.get(id)!;
    // Most need first; a child whose need cannot wait (it fills every half
    // left) is never left out. Then the order.
    const candidates = ids
      .filter((id) => id !== keeper)
      .sort((a, b) => need(b) - need(a) || rank.get(a)! - rank.get(b)!);
    const subs = useSubs && candidates.length > outfieldSlots;
    const fullCount = Math.min(candidates.length, subs ? outfieldSlots - 1 : outfieldSlots);
    // A child who needs an odd number of halves takes a single when one is going.
    let full: UUID[];
    let singles: UUID[] = [];
    if (subs) {
      const odd = candidates.filter((id) => need(id) % 2 === 1 && need(id) < 2 * left);
      const pickSingles = odd.slice(0, 2);
      for (const id of candidates) {
        if (pickSingles.length >= 2) break;
        if (!pickSingles.includes(id) && candidates.indexOf(id) >= fullCount) pickSingles.push(id);
      }
      singles = pickSingles;
      full = candidates.filter((id) => !singles.includes(id)).slice(0, fullCount);
    } else {
      full = candidates.slice(0, fullCount);
    }
    for (const id of full) halves.set(id, halves.get(id)! + 2);
    for (const id of singles) halves.set(id, halves.get(id)! + 1);
    // B9: whoever has played most so far (before this period) comes off; ties
    // to the less owed, so the more owed comes on.
    let off: UUID | null = null;
    let on: UUID | null = null;
    if (singles.length === 2) {
      const [a, b] = singles;
      const before = (id: UUID) => halves.get(id)! - 1;
      const aOff = before(a) > before(b) || (before(a) === before(b) && owed(season, a) <= owed(season, b));
      off = aOff ? a : b;
      on = aOff ? b : a;
    }
    periods.push({ keeper, full, off, on });
  });
  return { periods, halves };
}

const spread = (values: Iterable<number>) => {
  const all = [...values];
  return all.length === 0 ? 0 : Math.max(...all) - Math.min(...all);
};

/** How many orders the search tries (D4: fast; Even stays deterministic). */
const TRIES = 300;
/** Even's fixed seed. */
const EVEN_SEED = 277;

/** Positions, the keeper's first, then outfield front to back by sort order. */
function positionsOf(format: Format): { keeper: Position | null; outfield: Position[] } {
  const sorted = [...format.positions].sort((a, b) => a.sortOrder - b.sortOrder);
  return {
    keeper: sorted.find((p) => p.kind === 'goalkeeper') ?? null,
    outfield: sorted.filter((p) => p.kind !== 'goalkeeper'),
  };
}

/** Make the team sheet (B11). */
export function buildTeamSheet(input: BuildInput): BuiltSheet {
  const { format, totalMinutes, periodCount, coming, keepers, subs, fill, season } = input;
  const periodMs = periodLengthMs(totalMinutes, periodCount);
  const atMs = defaultSwapTimeMs(periodMs);
  const ids = coming.map((p) => p.id);
  const { keeper: goal, outfield } = positionsOf(format);
  const periodKeepers = Array.from({ length: periodCount }, (_, i) =>
    goal && keepers[i] && ids.includes(keepers[i]!) ? keepers[i]! : null
  );

  const next = random(fill === 'even' ? EVEN_SEED : (input.seed ?? EVEN_SEED));
  const first = fill === 'even' ? ids : shuffled(ids, next);
  let best: { periods: PeriodTime[]; halves: Map<UUID, number> } | null = null;
  for (let t = 0; t < TRIES && ids.length > 0; t++) {
    const order = t === 0 ? first : shuffled(ids, next);
    const tried = allocate(ids, order, periodKeepers, outfield.length, subs, season);
    if (!best || spread(tried.halves.values()) < spread(best.halves.values())) best = tried;
    if (spread(best.halves.values()) <= 1) break;
  }

  const plan: MatchPlan = { periods: [] };
  const lastPlace = new Map<UUID, number>();
  for (let p = 0; p < periodCount; p++) {
    const time = best?.periods[p] ?? { keeper: null, full: [], off: null, on: null };
    const slots: Record<UUID, UUID | null> = {};
    for (const position of format.positions) slots[position.id] = null;
    if (goal && time.keeper) slots[goal.id] = time.keeper;
    // Positions rotate (B10): each starter takes the place one on from where
    // they last played; new faces fill what is left, in squad order.
    const starters = [...time.full, ...(time.off ? [time.off] : [])].sort((a, b) => ids.indexOf(a) - ids.indexOf(b));
    const taken = new Set<number>();
    const returning = starters.filter((id) => lastPlace.has(id));
    const fresh = starters.filter((id) => !lastPlace.has(id));
    for (const id of [...returning, ...fresh].slice(0, outfield.length)) {
      let i = lastPlace.has(id) ? (lastPlace.get(id)! + 1) % outfield.length : 0;
      while (taken.has(i)) i = (i + 1) % outfield.length;
      taken.add(i);
      lastPlace.set(id, i);
      slots[outfield[i].id] = id;
    }
    const period: PlannedPeriod = {
      slots,
      subs: time.off && time.on ? [{ offId: time.off, onId: time.on, atMs }] : [],
    };
    // The child who comes on takes the place; they rotate from it next time.
    if (time.off && time.on) lastPlace.set(time.on, lastPlace.get(time.off)!);
    plan.periods.push(period);
  }

  const minutes = new Map<UUID, number>();
  for (const id of ids) minutes.set(id, 0);
  for (const period of plan.periods) {
    for (const who of Object.values(period.slots)) if (who) minutes.set(who, minutes.get(who)! + periodMs);
    for (const s of period.subs) {
      if (s.offId) minutes.set(s.offId, minutes.get(s.offId)! - (periodMs - s.atMs));
      if (s.onId) minutes.set(s.onId, minutes.get(s.onId)! + (periodMs - s.atMs));
    }
  }
  return { plan, minutes, rangeMs: spread(minutes.values()) };
}

/** What the Keepers step names beside each keeper (B7): their goal time and times kept this season. */
export interface SeasonKeeping extends SeasonInput {
  /** Matches this season with any time in goal. */
  timesKept: number;
}

/**
 * The season's inputs, from the Squad views' own folds (invariant 1: worked
 * out on each read, never stored). `matches` are the season's matches with
 * each child's minutes; `owed` is Going into Saturday's figure, in whole
 * minutes, null for a Main keeper or a fill-in.
 */
export function seasonInputs(
  matches: readonly { minutes: ReadonlyMap<UUID, { goalMs: number }> }[],
  owed: readonly { playerId: UUID; owed: number | null }[]
): Map<UUID, SeasonKeeping> {
  const out = new Map<UUID, SeasonKeeping>();
  const row = (id: UUID) => {
    let r = out.get(id);
    if (!r) out.set(id, (r = { goalMs: 0, owedMs: null, timesKept: 0 }));
    return r;
  };
  for (const m of matches) {
    for (const [id, mins] of m.minutes) {
      if (mins.goalMs <= 0) continue;
      const r = row(id);
      r.goalMs += mins.goalMs;
      r.timesKept += 1;
    }
  }
  for (const o of owed) row(o.playerId).owedMs = o.owed === null ? null : o.owed * 60_000;
  return out;
}
