/**
 * After the subs — #304 (Rob, 20 Nov: "In Q4 ... I am going to bring on 4
 * subs ... I am also moving those people into different positions. I kind
 * of need a post sub view of the field"; criteria approved).
 *
 * One rearrangement per quarter, at its (last) sub time. Pure: no React, no
 * storage. Intent only, like the rest of the plan (#72 AC8): what the coach
 * actually does on the day is what is recorded.
 */

import type { UUID } from '../types/index';
import type { PlannedPeriod } from './matchPlan';

export type Slots = Record<UUID, UUID | null>;

/** The quarter's pitch just after its subs: each child coming on in the place of the one going off. */
export function subbedSlots(period: Pick<PlannedPeriod, 'slots' | 'subs'>): Slots {
  const out: Slots = { ...period.slots };
  const ordered = [...period.subs].sort((a, b) => a.atMs - b.atMs);
  for (const s of ordered) {
    if (!s.offId || !s.onId) continue;
    const at = (Object.keys(out) as UUID[]).find((pos) => out[pos] === s.offId);
    if (at) out[at] = s.onId;
  }
  return out;
}

/** When the rearrangement applies: the quarter's last planned sub (C3); null with no subs. */
export function afterSubsAt(period: Pick<PlannedPeriod, 'subs'>): number | null {
  const times = period.subs.filter((s) => s.offId && s.onId).map((s) => s.atMs);
  return times.length ? Math.max(...times) : null;
}

/**
 * The planned pitch after the subs (C1, C3): the coach's rearrangement where
 * it still fits, else as subbed. A child the rearrangement places who is no
 * longer on after the subs is dropped, and anyone it misses goes back to
 * their place as subbed. Nobody is added or lost.
 */
export function afterSlots(period: Pick<PlannedPeriod, 'slots' | 'subs' | 'after'>): Slots {
  const subbed = subbedSlots(period);
  if (!period.after) return subbed;
  const onAfter = new Set(Object.values(subbed).filter((v): v is UUID => v !== null));
  const out: Slots = {};
  const used = new Set<UUID>();
  for (const pos of Object.keys(subbed) as UUID[]) {
    const who = period.after[pos] ?? null;
    if (who && onAfter.has(who) && !used.has(who)) {
      out[pos] = who;
      used.add(who);
    } else out[pos] = null;
  }
  // Anyone not placed goes to their subbed place if free, else the first free place.
  for (const pos of Object.keys(subbed) as UUID[]) {
    const who = subbed[pos];
    if (!who || used.has(who)) continue;
    const spot = out[pos] === null ? pos : (Object.keys(out) as UUID[]).find((p) => out[p] === null);
    if (spot) {
      out[spot] = who;
      used.add(who);
    }
  }
  return out;
}

/** Each child who moves from their subbed place, and to where (C2, C4). */
export interface Move {
  playerId: UUID;
  from: UUID;
  to: UUID;
}

export function movesOf(period: Pick<PlannedPeriod, 'slots' | 'subs' | 'after'>): Move[] {
  const subbed = subbedSlots(period);
  const after = afterSlots(period);
  const placeIn = (slots: Slots, id: UUID) => (Object.keys(slots) as UUID[]).find((p) => slots[p] === id);
  const moves: Move[] = [];
  for (const to of Object.keys(after) as UUID[]) {
    const who = after[to];
    if (!who) continue;
    const from = placeIn(subbed, who);
    if (from && from !== to) moves.push({ playerId: who, from, to });
  }
  return moves;
}

/** C2: "As subbed", or "Rearranged · 3 moves". */
export function afterSubsSummary(period: Pick<PlannedPeriod, 'slots' | 'subs' | 'after'>): string {
  const n = movesOf(period).length;
  return n === 0 ? 'As subbed' : `Rearranged · ${n} ${n === 1 ? 'move' : 'moves'}`;
}

/**
 * C4: the swaps that turn the pitch as it is into the planned one, each
 * between two children on the pitch (the engine's `swapPositions`). Only
 * children on the pitch now are moved; a planned place whose child is not on
 * is left alone.
 */
export function swapsTo(current: Slots, target: Slots): [UUID, UUID][] {
  const now: Slots = { ...current };
  const onPitch = new Set(Object.values(now).filter((v): v is UUID => v !== null));
  const swaps: [UUID, UUID][] = [];
  for (const pos of Object.keys(target) as UUID[]) {
    const want = target[pos];
    const here = now[pos] ?? null;
    if (!want || !here || want === here || !onPitch.has(want)) continue;
    const from = (Object.keys(now) as UUID[]).find((p) => now[p] === want);
    if (!from) continue;
    swaps.push([here, want]);
    now[from] = here;
    now[pos] = want;
  }
  return swaps;
}
