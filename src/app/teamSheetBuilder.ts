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
 * - **Mid-period subs** (B9; Rob, 6 Nov "B approved"): n pairs a period, all
 *   at its midpoint (#205); `fairestSubs` gives the fewest n with the fairest
 *   split, which is where the coach's stepper starts.
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

/**
 * Fill the rest (Rob, 6 Nov): Fairly rotates positions; Using positions puts
 * each child in their preferred area (`Player.prefers`) where the minutes
 * allow. Either way the minutes come first (invariant 3).
 */
export type Fill = 'fair' | 'positions';

export interface BuildInput {
  format: Format;
  totalMinutes: number;
  periodCount: number;
  /** The children coming, in squad order. */
  coming: readonly Player[];
  /** Each period's keeper (see `rotateKeepers`); null leaves goal to the fill. */
  keepers: readonly (UUID | null)[];
  /** Subs a period, all at its midpoint (B9; Rob 6 Nov: a number, not one or none). */
  subs: number;
  fill: Fill;
  season: ReadonlyMap<UUID, SeasonInput>;
  /**
   * What is already on the sheet (Rob, 6 Nov: "place people", then fill the
   * rest). Every child placed stays where they are, a keeper in goal included,
   * and a period with a sub keeps it. Only the empty places are filled.
   */
  existing?: MatchPlan;
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
 * Each period's keeper (B7; Rob, 6 Nov). A Main keeper who is coming keeps
 * every period; the coach may move them by hand. With no Main keeper coming,
 * a Back-up keeps every period (the least kept this season, if several), as
 * the Lineup suggestion already does. Otherwise each period takes the
 * eligible child with the least time in goal, the season's plus this plan's
 * so far; ties to the most owed, then squad order. Null for a period when
 * nobody coming may go in goal.
 */
export function rotateKeepers(
  coming: readonly Player[],
  periodCount: number,
  periodMs: number,
  season: ReadonlyMap<UUID, SeasonInput>
): (UUID | null)[] {
  const main = coming.find((p) => p.keeper === 'main');
  if (main) return Array.from({ length: periodCount }, () => main.id);
  const order0 = new Map(coming.map((p, i) => [p.id, i]));
  const backup = coming
    .filter((p) => p.keeper === 'backup')
    .sort((a, b) => (season.get(a.id)?.goalMs ?? 0) - (season.get(b.id)?.goalMs ?? 0) || order0.get(a.id)! - order0.get(b.id)!)[0];
  if (backup) return Array.from({ length: periodCount }, () => backup.id);
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

/** What a period already holds before the fill: who plays it all, who half (a sub's pair), and whether it has its sub. */
interface Fixed {
  full: UUID[];
  half: UUID[];
  /** Sub pairs already on the sheet; a period with any keeps them and gets no more. */
  pairs: number;
}

/** One period's time, in half-periods: who is full (2), who start and come off, who come on (pairwise). */
interface PeriodTime {
  keeper: UUID | null;
  full: UUID[];
  off: UUID[];
  on: UUID[];
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
  subsPer: number,
  season: ReadonlyMap<UUID, SeasonInput>,
  fixed: readonly Fixed[]
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
    // Already on the sheet: their time counts, and they are not moved.
    const here = fixed[p];
    for (const id of here.full) halves.set(id, halves.get(id)! + 2);
    for (const id of here.half) halves.set(id, halves.get(id)! + 1);
    const placed = new Set([...here.full, ...here.half]);
    const slotsLeft = outfieldSlots - here.full.length - here.pairs;
    const left = periodCount - p;
    const need = (id: UUID) => target.get(id)! - halves.get(id)!;
    // Most need first; a child whose need cannot wait (it fills every half
    // left) is never left out. Then the order.
    const candidates = ids
      .filter((id) => id !== keeper && !placed.has(id))
      .sort((a, b) => need(b) - need(a) || rank.get(a)! - rank.get(b)!);
    // n pairs, never more than the places left or the children beyond them.
    const pairs =
      here.pairs > 0 ? 0 : Math.max(0, Math.min(subsPer, slotsLeft, candidates.length - slotsLeft));
    const fullCount = Math.max(0, Math.min(candidates.length, slotsLeft - pairs));
    // A child who needs an odd number of halves takes a single when one is going.
    let full: UUID[];
    let singles: UUID[] = [];
    if (pairs > 0) {
      const odd = candidates.filter((id) => need(id) % 2 === 1 && need(id) < 2 * left);
      const pick = odd.slice(0, 2 * pairs);
      for (const id of candidates) {
        if (pick.length >= 2 * pairs) break;
        if (!pick.includes(id) && candidates.indexOf(id) >= fullCount) pick.push(id);
      }
      for (const id of candidates) {
        if (pick.length >= 2 * pairs) break;
        if (!pick.includes(id)) pick.push(id);
      }
      singles = pick;
      full = candidates.filter((id) => !singles.includes(id)).slice(0, fullCount);
    } else {
      full = candidates.slice(0, fullCount);
    }
    for (const id of full) halves.set(id, halves.get(id)! + 2);
    for (const id of singles) halves.set(id, halves.get(id)! + 1);
    // B9: whoever has played most so far (before this period) comes off, for
    // whoever has played least; ties to the less owed, so the more owed comes on.
    const before = (id: UUID) => halves.get(id)! - 1;
    const ranked = [...singles].sort(
      (a, b) => before(b) - before(a) || owed(season, a) - owed(season, b) || rank.get(a)! - rank.get(b)!
    );
    const off = ranked.slice(0, pairs);
    const on = ranked.slice(pairs).reverse();
    periods.push({ keeper, full, off, on });
  });
  return { periods, halves };
}

const spread = (values: Iterable<number>) => {
  const all = [...values];
  return all.length === 0 ? 0 : Math.max(...all) - Math.min(...all);
};

/** How many orders the search tries (D4: fast, and the same answer every time). */
const TRIES = 300;
/** The search's fixed seed. */
const EVEN_SEED = 277;

/** Positions, the keeper's first, then outfield front to back by sort order. */
function positionsOf(format: Format): { keeper: Position | null; outfield: Position[] } {
  const sorted = [...format.positions].sort((a, b) => a.sortOrder - b.sortOrder);
  return {
    keeper: sorted.find((p) => p.kind === 'goalkeeper') ?? null,
    outfield: sorted.filter((p) => p.kind !== 'goalkeeper'),
  };
}

/**
 * Rob, 9 Nov ("approve 3"): subs at the same moment, paired so each child
 * coming on takes the place of someone going off in their preferred area
 * where one is free. All swap at once, so every child's minutes are the
 * same whichever way they pair (invariant 3); only the places change.
 */
export function pairByArea(
  off: readonly UUID[],
  on: readonly UUID[],
  unitOf: (id: UUID) => string | null,
  prefers: ReadonlyMap<UUID, string | null>
): (readonly [UUID, UUID | undefined])[] {
  const left = [...on];
  const chosen = new Map<UUID, UUID | undefined>();
  for (const o of off) {
    const unit = unitOf(o);
    const k = unit ? left.findIndex((id) => prefers.get(id) === unit) : -1;
    if (k >= 0) chosen.set(o, left.splice(k, 1)[0]);
  }
  for (const o of off) if (!chosen.has(o)) chosen.set(o, left.shift());
  return off.map((o) => [o, chosen.get(o)] as const);
}

/** Make the team sheet (B11). */
export function buildTeamSheet(input: BuildInput): BuiltSheet {
  const { format, totalMinutes, periodCount, coming, keepers, subs, fill, season, existing } = input;
  const periodMs = periodLengthMs(totalMinutes, periodCount);
  const atMs = defaultSwapTimeMs(periodMs);
  const ids = coming.map((p) => p.id);
  const isComing = new Set(ids);
  const prefers = new Map(coming.map((p) => [p.id, p.prefers ?? null]));
  const { keeper: goal, outfield } = positionsOf(format);

  // What is already on the sheet, period by period: kept as it is.
  const before = Array.from({ length: periodCount }, (_, p) => existing?.periods[p]);
  const fixed: Fixed[] = before.map((period) => {
    const subsHere = (period?.subs ?? []).filter((s) => s.offId && s.onId && isComing.has(s.offId) && isComing.has(s.onId));
    const offs = new Set(subsHere.map((s) => s.offId!));
    const inSlots = outfield
      .map((pos) => period?.slots[pos.id] ?? null)
      .filter((id): id is UUID => id !== null && isComing.has(id));
    return {
      full: inSlots.filter((id) => !offs.has(id)),
      half: subsHere.flatMap((s) => [s.offId!, s.onId!]),
      pairs: subsHere.length,
    };
  });
  const periodKeepers = Array.from({ length: periodCount }, (_, i) => {
    const placed = goal ? (before[i]?.slots[goal.id] ?? null) : null;
    if (placed && isComing.has(placed)) return placed;
    return goal && keepers[i] && isComing.has(keepers[i]!) ? keepers[i]! : null;
  });

  // The search: the same rule tried with ties broken in other orders, the
  // smallest spread kept. A fixed seed, so the answer is the same every time.
  // A Main keeper is out of the comparison, as they are out of the fair share
  // (ADR-015): their full match must not decide which arrangement is fairest.
  const mainKeeper = coming.find((p) => p.keeper === 'main')?.id;
  const shared = (halves: Map<UUID, number>) => [...halves].filter(([id]) => id !== mainKeeper).map(([, n]) => n);
  const next = random(EVEN_SEED);
  let best: { periods: PeriodTime[]; halves: Map<UUID, number> } | null = null;
  for (let t = 0; t < TRIES && ids.length > 0; t++) {
    const order = t === 0 ? ids : shuffled(ids, next);
    const tried = allocate(ids, order, periodKeepers, outfield.length, subs, season, fixed);
    if (!best || spread(shared(tried.halves)) < spread(shared(best.halves))) best = tried;
    if (spread(shared(best.halves)) <= 1) break;
  }

  const plan: MatchPlan = { periods: [] };
  const lastPlace = new Map<UUID, number>();
  for (let p = 0; p < periodCount; p++) {
    const time = best?.periods[p] ?? { keeper: null, full: [], off: [], on: [] };
    const slots: Record<UUID, UUID | null> = {};
    for (const position of format.positions) slots[position.id] = null;
    if (goal && time.keeper) slots[goal.id] = time.keeper;
    const taken = new Set<number>();
    // Children already placed stay exactly where they are.
    outfield.forEach((pos, i) => {
      const who = before[p]?.slots[pos.id] ?? null;
      if (who && isComing.has(who)) {
        slots[pos.id] = who;
        taken.add(i);
        lastPlace.set(who, i);
      }
    });
    // The rest: Fairly rotates each child one place on from where they last
    // played (B10); Using positions takes a free place in their preferred
    // area first (Rob, 6 Nov), else rotates.
    const starters = [...time.full, ...time.off].sort((a, b) => ids.indexOf(a) - ids.indexOf(b));
    const free = () => outfield.map((_, i) => i).filter((i) => !taken.has(i));
    const ordered =
      fill === 'positions'
        ? [...starters.filter((id) => prefers.get(id)), ...starters.filter((id) => !prefers.get(id))]
        : [...starters.filter((id) => lastPlace.has(id)), ...starters.filter((id) => !lastPlace.has(id))];
    for (const id of ordered) {
      const open = free();
      if (open.length === 0) break;
      const unit = prefers.get(id);
      const inArea = fill === 'positions' && unit ? open.filter((i) => outfield[i].unit === unit) : [];
      let i: number;
      if (inArea.length > 0) {
        // In their area, still moving on from where they last played.
        const from = lastPlace.get(id) ?? -1;
        i = inArea.find((x) => x > from) ?? inArea[0];
      } else {
        i = lastPlace.has(id) ? (lastPlace.get(id)! + 1) % outfield.length : open[0];
        while (taken.has(i)) i = (i + 1) % outfield.length;
      }
      taken.add(i);
      lastPlace.set(id, i);
      slots[outfield[i].id] = id;
    }
    const kept = before[p]?.subs.filter((s) => s.offId && s.onId && isComing.has(s.offId) && isComing.has(s.onId)) ?? [];
    const period: PlannedPeriod = {
      slots,
      subs:
        kept.length > 0
          ? kept
          : (fill === 'positions'
              ? pairByArea(time.off, time.on, (id) => outfield.find((pos) => slots[pos.id] === id)?.unit ?? null, prefers)
              : time.off.map((offId, i) => [offId, time.on[i]] as const)
            ).map(([offId, onId]) => ({ offId, onId: onId ?? null, atMs })),
    };
    // The child who comes on takes the place; they rotate from it next time.
    for (const s of period.subs) if (s.offId && s.onId && lastPlace.has(s.offId)) lastPlace.set(s.onId, lastPlace.get(s.offId)!);
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

/**
 * Where the coach's Subs stepper starts (Rob, 6 Nov): the fewest subs a
 * period that give the fairest split the coming children allow. Worked out
 * by building the sheet for each number, from none up to the bench.
 */
export function fairestSubs(input: Omit<BuildInput, 'subs'>): number {
  const outfield = input.format.positions.filter((p) => p.kind !== 'goalkeeper').length;
  const keepers = input.keepers.filter((k) => k !== null).length > 0 ? 1 : 0;
  const bench = Math.max(0, input.coming.length - outfield - keepers);
  const main = input.coming.find((p) => p.keeper === 'main')?.id;
  const rangeOf = (n: number) => {
    const built = buildTeamSheet({ ...input, subs: n });
    return spread([...built.minutes].filter(([id]) => id !== main).map(([, ms]) => ms));
  };
  let best = 0;
  let bestRange = rangeOf(0);
  for (let n = 1; n <= bench; n++) {
    const r = rangeOf(n);
    if (r < bestRange) {
      best = n;
      bestRange = r;
    }
  }
  return best;
}
