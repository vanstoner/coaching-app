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
import type { MatchPlan, PlannedPeriod } from './matchPlan';

/** The view a coach last chose, on this phone only (C13, D5). */
export type SheetView = 'formation' | 'table';
export const SHEET_VIEW_KEY = 'coaching-app/sheet-view/v1';

export function parseSheetView(raw: string | null): SheetView {
  return raw === 'table' ? 'table' : 'formation';
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
  /** "⇄ Kai 6:15" under a starter who comes off; "on 6:15 at LB" on the bench. */
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
      return { playerId: who, note: sub ? `⇄ ${name(sub.onId!)} ${formatSubTime(sub.atMs)}` : null };
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
