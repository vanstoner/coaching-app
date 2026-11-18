/**
 * The team sheet's moves and its table — #277 C13–C17.
 *
 * Pure TypeScript. A move is a swap inside one period: tap one child, then
 * another, and they change places, the bench included (C17). A planned sub
 * belongs to a place, not a child, so it follows whoever now holds that
 * place: swapping two children swaps their ids everywhere in the period, in
 * the slots and in the subs alike.
 *
 * The table (C15, Rob 5 Nov) is one row per position, front to back, then a
 * row per bench place; one column per period.
 */

import type { Format, Position, PositionUnit, UUID } from '../types/index';
import { formatSubTime } from './matchClock';
import { benchSubIndex, projectPlan, type MatchPlan, type PlannedPeriod } from './matchPlan';
import type { Player } from '../types/index';

/**
 * The view a coach last chose, on this phone only (C13, D5): the real pitch
 * one quarter at a time (Rob, 6 Nov: "pitch view need to remain awesome"),
 * all quarters side by side, or the table.
 */
export type SheetView = 'formation' | 'all' | 'table';
export const SHEET_VIEW_KEY = 'coaching-app/sheet-view/v1';

export function parseSheetView(raw: string | null): SheetView {
  return raw === 'table' || raw === 'all' ? raw : 'formation';
}

/** Each period's keeper as the plan has it: whoever is in goal, or null. */
export function keepersOf(plan: MatchPlan, format: Format): (UUID | null)[] {
  const goal = format.positions.find((p) => p.kind === 'goalkeeper');
  return plan.periods.map((period) => (goal ? (period.slots[goal.id] ?? null) : null));
}

/**
 * Put each period's keeper in goal (Rob, 6 Nov: the quarters show "with the
 * keepers already in goal"). A keeper who was elsewhere in that period swaps
 * with whoever was in goal, so nobody is lost and a sub follows its place.
 */
export function applyKeepers(plan: MatchPlan, format: Format, keepers: readonly (UUID | null)[]): MatchPlan {
  const goal = format.positions.find((p) => p.kind === 'goalkeeper');
  if (!goal) return plan;
  let next = plan;
  keepers.forEach((keeper, p) => {
    const period = next.periods[p];
    if (!period || !keeper) return;
    const now = period.slots[goal.id] ?? null;
    if (now === keeper) return;
    const placed = Object.values(period.slots).includes(keeper) || period.subs.some((s) => s.onId === keeper);
    if (now && placed) {
      next = swapInPeriod(next, p, now, keeper);
      return;
    }
    const slots: Record<UUID, UUID | null> = {};
    for (const [pos, who] of Object.entries(period.slots) as [UUID, UUID | null][]) slots[pos] = who === keeper ? null : who;
    slots[goal.id] = keeper;
    // A keeper never comes on or off at the sub (B9): drop a sub that named them.
    const subs = period.subs.filter((s) => s.onId !== keeper && s.offId !== keeper);
    next = { periods: next.periods.map((x, i) => (i === p ? { ...period, slots, subs } : x)) };
  });
  return next;
}

/** Who is on the bench in a period: the coming children not in a slot, in squad order. */
export function benchOf(period: PlannedPeriod, coming: readonly UUID[]): UUID[] {
  const on = new Set(Object.values(period.slots).filter((id): id is UUID => id !== null));
  return coming.filter((id) => !on.has(id));
}

/** Swap two children inside one period (C17). */
export function swapInPeriod(plan: MatchPlan, periodIndex: number, a: UUID, b: UUID): MatchPlan {
  if (a === b) return plan;
  const swap = (id: UUID | null) => (id === a ? b : id === b ? a : id);
  return {
    periods: plan.periods.map((period, i) => {
      if (i !== periodIndex) return period;
      const slots: Record<UUID, UUID | null> = {};
      for (const [pos, who] of Object.entries(period.slots) as [UUID, UUID | null][]) slots[pos] = swap(who);
      return {
        ...period,
        slots,
        subs: period.subs.map((s) => ({ ...s, onId: swap(s.onId), offId: swap(s.offId) })),
      };
    }),
  };
}

const UNIT_ORDER: Record<PositionUnit, number> = { ATT: 0, MID: 1, DEF: 2, GK: 3 };

/** Positions front to back: forwards first, the keeper last, then by sort order. */
export function frontToBack(format: Format): Position[] {
  const unit = (p: Position) => (p.unit ? UNIT_ORDER[p.unit] : p.kind === 'goalkeeper' ? 3 : 1);
  return [...format.positions].sort((x, y) => unit(x) - unit(y) || x.sortOrder - y.sortOrder);
}

/** A short label for a position: its role code, else its label. */
export const shortLabel = (p: Position) => p.roleCode ?? p.label;

export interface TableCell {
  /** Who starts here (or sits in this bench place); null when empty. */
  playerId: UUID | null;
  /** "Kai on 6:15" under a starter who comes off; "on 6:15 at LB" on the bench. */
  note: string | null;
}

export interface TableRow {
  /** "ST", or "Bench" for each bench place. */
  label: string;
  /** The position's id; null for a bench row. */
  positionId: UUID | null;
  cells: TableCell[];
}

/**
 * The table (C15). Position rows front to back, then as many bench rows as
 * the longest bench. `name` turns an id into a name.
 */
export function sheetTable(
  plan: MatchPlan,
  format: Format,
  coming: readonly UUID[],
  name: (id: UUID) => string
): TableRow[] {
  const positions = frontToBack(format);
  const byId = new Map(format.positions.map((p) => [p.id, p]));
  const rows: TableRow[] = positions.map((position) => ({
    label: shortLabel(position),
    positionId: position.id,
    cells: plan.periods.map((period) => {
      const who = period.slots[position.id] ?? null;
      const sub = period.subs.find((s) => s.offId !== null && s.offId === who && s.onId !== null);
      return { playerId: who, note: sub ? `${name(sub.onId!)} on ${formatSubTime(sub.atMs)}` : null };
    }),
  }));
  const benches = plan.periods.map((period) => benchOf(period, coming));
  const longest = Math.max(0, ...benches.map((b) => b.length));
  for (let i = 0; i < longest; i++) {
    rows.push({
      label: 'Bench',
      positionId: null,
      cells: plan.periods.map((period, p) => {
        const who = benches[p][i] ?? null;
        const sub = who ? period.subs.find((s) => s.onId === who && s.offId !== null) : undefined;
        const at = sub ? Object.entries(period.slots).find(([, id]) => id === sub.offId)?.[0] : undefined;
        const place = at ? byId.get(at as UUID) : undefined;
        return {
          playerId: who,
          note: sub ? `on ${formatSubTime(sub.atMs)}${place ? ` at ${shortLabel(place)}` : ''}` : null,
        };
      }),
    });
  }
  return rows;
}

/**
 * #277 D20: a child who was coming but is unticked on match day, and every
 * period of the plan they are placed in (in a slot, or coming on). The app
 * never re-plans by itself; the Lineup says where, so the coach can tweak.
 * "Ivy is in Q1 and Q3 of the plan but not here today." One line per child.
 */
export function planGaps(
  plan: MatchPlan | undefined,
  absent: ReadonlySet<UUID>,
  name: (id: UUID) => string,
  short: string,
  fromPeriod = 0
): string[] {
  if (!plan) return [];
  const where = new Map<UUID, number[]>();
  plan.periods.forEach((period, p) => {
    if (p < fromPeriod) return;
    const placed = new Set<UUID>();
    for (const id of Object.values(period.slots)) if (id) placed.add(id);
    for (const s of period.subs) if (s.onId) placed.add(s.onId);
    for (const id of placed) if (absent.has(id)) where.set(id, [...(where.get(id) ?? []), p]);
  });
  return [...where].map(([id, periods]) => {
    const labels = periods.map((p) => `${short}${p + 1}`);
    const list = labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
    return `${name(id)} is in ${list} of the plan but not here today.`;
  });
}

/** Mark positions in a period as filled by hand (Rob, 6 Nov: the green dot). */
export function pinPlaces(plan: MatchPlan, periodIndex: number, positionIds: readonly UUID[]): MatchPlan {
  return {
    periods: plan.periods.map((period, i) =>
      i === periodIndex ? { ...period, pinned: [...new Set([...(period.pinned ?? []), ...positionIds])] } : period
    ),
  };
}

/** Is this position in this period one the coach filled by hand, with someone still in it? */
export function isPinned(period: PlannedPeriod, positionId: UUID): boolean {
  return (period.pinned ?? []).includes(positionId) && (period.slots[positionId] ?? null) !== null;
}

/**
 * What Fill starts from (#277, Rob 6 Nov): each period keeps its keeper and
 * every place filled by hand; everything else, the subs included, is cleared
 * for the fill to decide again.
 */
export function keepPinned(plan: MatchPlan, format: Format): MatchPlan {
  const goal = format.positions.find((p) => p.kind === 'goalkeeper')?.id;
  return {
    periods: plan.periods.map((period) => {
      const slots: Record<UUID, UUID | null> = {};
      for (const pos of format.positions) {
        const keep = pos.id === goal || isPinned(period, pos.id);
        slots[pos.id] = keep ? (period.slots[pos.id] ?? null) : null;
      }
      return { slots, subs: [], pinned: (period.pinned ?? []).filter((id) => slots[id]) };
    }),
  };
}

/**
 * ⟳ Rearrange one period (Rob, 6 Nov): the same children on the pitch and on
 * the bench, in new places, so nobody's minutes move. The keeper and every
 * place filled by hand stay. `turn` moves each child that many places on;
 * with `prefers`, a child goes to a free place in their own area first.
 */
export function rearrangePeriod(
  plan: MatchPlan,
  periodIndex: number,
  format: Format,
  turn: number,
  prefers?: (id: UUID) => PositionUnit | null
): MatchPlan {
  const period = plan.periods[periodIndex];
  if (!period) return plan;
  const free = frontToBack(format).filter(
    (p) => p.kind !== 'goalkeeper' && (period.slots[p.id] ?? null) !== null && !isPinned(period, p.id)
  );
  if (free.length < 2) return plan;
  const kids = free.map((p) => period.slots[p.id]!);
  const k = 1 + (Math.abs(turn) % (kids.length - 1));
  const moved = [...kids.slice(k), ...kids.slice(0, k)];
  const slots = { ...period.slots };
  if (prefers) {
    const open = [...free];
    const order = [...moved.filter((id) => prefers(id)), ...moved.filter((id) => !prefers(id))];
    for (const id of order) {
      const i = open.findIndex((p) => p.unit === prefers(id));
      const [spot] = open.splice(i >= 0 ? i : 0, 1);
      slots[spot.id] = id;
    }
  } else {
    free.forEach((p, i) => (slots[p.id] = moved[i]));
  }
  return { periods: plan.periods.map((x, i) => (i === periodIndex ? { ...x, slots } : x)) };
}

/** Can this period be rearranged: at least two outfield places not filled by hand? */
export function canRearrange(period: PlannedPeriod, format: Format): boolean {
  return format.positions.filter((p) => p.kind !== 'goalkeeper' && (period.slots[p.id] ?? null) !== null && !isPinned(period, p.id)).length >= 2;
}

/**
 * Each child's planned pitch time up to the end of one period (Rob, 7 Nov,
 * "B"): the number under a name on the team sheet's pitch, so a coach working
 * through the quarters sees who is falling behind so far. Worked out from the
 * plan each draw (invariant 1); the whole match is in Minutes.
 */
export function minutesThrough(
  plan: MatchPlan,
  periodIndex: number,
  format: Format,
  totalMinutes: number,
  periodCount: number,
  players: Player[]
): Map<UUID, number> {
  const upTo: MatchPlan = { periods: plan.periods.map((p, i) => (i <= periodIndex ? p : { slots: {}, subs: [] })) };
  const rows = projectPlan(upTo, format, totalMinutes, periodCount, players).rows;
  return new Map(rows.map((r) => [r.playerId, r.pitchMs]));
}

/** Which sub to open: an existing one (`swapIndex`), or a new one (-1) with who is known. */
export interface SubRequest {
  swapIndex: number;
  onId: UUID | null;
  offId: UUID | null;
}

/**
 * The sub a tap opens. A bench child: their earliest sub on, else a new one
 * bringing them on. A child on the pitch: their earliest sub off, else a new
 * one taking them off.
 */
export function subRequestFor(period: PlannedPeriod, id: UUID, onPitch: boolean): SubRequest {
  if (!onPitch) {
    const i = benchSubIndex(period, id);
    return i === -1 ? { swapIndex: -1, onId: id, offId: null } : { swapIndex: i, onId: id, offId: period.subs[i].offId };
  }
  let found = -1;
  period.subs.forEach((s, i) => {
    if (s.offId === id && (found === -1 || s.atMs < period.subs[found].atMs)) found = i;
  });
  return found === -1
    ? { swapIndex: -1, onId: null, offId: id }
    : { swapIndex: found, onId: period.subs[found].onId, offId: id };
}

/**
 * #284 (QA on #279, D8; Rob, "Approve 1-8"): the Team sheet's own choices,
 * kept with the fixture so reopening shows what the sheet was made with.
 * Only what the coach chose is kept; the fairest number and the Automatic
 * rotation are still worked out on every draw (invariant 1). Planning, never
 * the record.
 */
export interface SheetSettings {
  keepers?: 'auto' | 'choose';
  /** A Subs number the coach set; absent means "the fairest", worked out each time. */
  subs?: number;
  fill?: 'fair' | 'positions';
}

/** What a stored value holds, field by field; anything else is dropped, never an error. */
/**
 * Rob, 9 Nov ("approve 3"): the fill a sheet opens with when the coach has
 * not chosen one for this fixture. By position when any child coming has a
 * preferred area, so squad preferences are used without an extra tap;
 * Fairly when nobody has one. A choice the coach made always wins (#284).
 */
export function fillShown(
  settings: SheetSettings | undefined,
  coming: readonly { prefers?: string | null }[]
): 'fair' | 'positions' {
  return settings?.fill ?? (coming.some((p) => p.prefers) ? 'positions' : 'fair');
}

export function readSheetSettings(raw: unknown): SheetSettings | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  const out: SheetSettings = {};
  if (r.keepers === 'auto' || r.keepers === 'choose') out.keepers = r.keepers;
  if (typeof r.subs === 'number' && Number.isInteger(r.subs) && r.subs >= 0 && r.subs <= 20) out.subs = r.subs;
  if (r.fill === 'fair' || r.fill === 'positions') out.fill = r.fill;
  return Object.keys(out).length ? out : undefined;
}

/** The Subs number shown: the coach's, never more than today's bench; else the fairest. */
export function subsShown(settings: SheetSettings | undefined, fairest: number, benchSize: number): number {
  return Math.min(settings?.subs ?? fairest, Math.max(0, benchSize));
}

