/**
 * Where each position sits on the drawn pitch, and what a drop landed on — #83.
 *
 * Pure TypeScript, so the geometry is tested in Node rather than eyeballed on
 * a device. The screen only draws what this returns.
 *
 * The pitch is drawn attacking upwards: goal at the bottom, then defence,
 * midfield, forwards. Within a row, a position whose role starts with L sits
 * left and R sits right, so LB is on the left as a coach expects. The role
 * code, not the label: a slot renamed "Sweeper" (#166) stays where it was.
 */

import type { Format, Position, PositionUnit, UUID } from '../types/index';
import { formatClock } from './matchClock';

/** Row heights as a fraction of the pitch, by unit. */
const ROW_Y: Record<PositionUnit, number> = { ATT: 0.14, MID: 0.4, DEF: 0.65, GK: 0.88 };

/** Where an unknown unit (a v1 position) is drawn: midfield, the honest middle. */
const FALLBACK_Y = ROW_Y.MID;

export interface SlotSpot {
  positionId: UUID;
  label: string;
  unit: PositionUnit | null;
  /** Centre, as fractions of the pitch's width and height. */
  x: number;
  y: number;
}

function side(label: string): number {
  const first = label.trim().charAt(0).toUpperCase();
  return first === 'L' ? 0 : first === 'R' ? 2 : 1;
}

/**
 * Across-the-pitch centres for a row of n (#89). Spread wider than even
 * spacing so three pills of PILL_WIDTH_FRACTION never touch: at 0.18 / 0.5 /
 * 0.82 the gap between pills is 0.32 - 0.28 = 0.04 of the pitch, about 13dp
 * on a 360dp phone, where even spacing (0.25 apart) overlapped them.
 */
function rowX(n: number, i: number): number {
  const table: Record<number, number[]> = { 1: [0.5], 2: [0.3, 0.7], 3: [0.18, 0.5, 0.82] };
  return table[n]?.[i] ?? (i + 1) / (n + 1);
}

/** The width of a pill, as a fraction of the pitch's width. */
export const PILL_WIDTH_FRACTION = 0.28;

/** Every position's spot on the pitch. */
export function slotSpots(format: Format): SlotSpot[] {
  const rows = new Map<number, Position[]>();
  for (const p of format.positions) {
    const y = p.unit ? ROW_Y[p.unit] : p.kind === 'goalkeeper' ? ROW_Y.GK : FALLBACK_Y;
    rows.set(y, [...(rows.get(y) ?? []), p]);
  }
  const spots: SlotSpot[] = [];
  for (const [y, row] of rows) {
    const ordered = [...row].sort(
      (a, b) =>
        side(a.roleCode ?? a.label) - side(b.roleCode ?? b.label) || a.sortOrder - b.sortOrder
    );
    ordered.forEach((p, i) => {
      spots.push({
        positionId: p.id,
        label: p.label,
        unit: p.unit,
        x: rowX(ordered.length, i),
        y,
      });
    });
  }
  return spots;
}

/** A drop target: a position on the pitch, a bench player, or the bench itself. */
export type DropTarget =
  | { kind: 'slot'; positionId: UUID }
  | { kind: 'player'; playerId: UUID }
  | { kind: 'bench' };

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const inside = (px: number, py: number, r: Rect) =>
  px >= r.x && px <= r.x + r.width && py >= r.y && py <= r.y + r.height;

/**
 * What a finger released at (px, py) is over, in the pitch component's own
 * coordinates. A bench pill first, then the bench, then the nearest position
 * within reach — a drop a little short of a pill still lands, because a drag
 * that misses by a few pixels on a touchline is a drag that failed.
 */
export function dropTargetAt(
  px: number,
  py: number,
  pitch: Rect,
  spots: SlotSpot[],
  benchPills: { playerId: UUID; rect: Rect }[],
  bench: Rect | null
): DropTarget | null {
  for (const b of benchPills) if (inside(px, py, b.rect)) return { kind: 'player', playerId: b.playerId };
  if (bench && inside(px, py, bench)) return { kind: 'bench' };
  if (!inside(px, py, pitch)) return null;
  const reach = pitch.width * 0.2;
  let best: { id: UUID; d: number } | null = null;
  for (const s of spots) {
    const d = Math.hypot(px - (pitch.x + s.x * pitch.width), py - (pitch.y + s.y * pitch.height));
    if (d <= reach && (!best || d < best.d)) best = { id: s.positionId, d };
  }
  return best ? { kind: 'slot', positionId: best.id } : null;
}

/**
 * The time under a pill on the pitch: total time on the pitch, goal plus
 * outfield (invariant 3, ADR-015; PO ruling on #125). The child in goal now
 * is marked "GK", so "GK 12:30" is 12:30 on the pitch in total, not 12:30 in
 * goal. One figure, meaning the same thing on every pill.
 */
export function pillDetail(
  minutes: { outfieldMs: number; goalkeeperMs: number } | undefined,
  inGoal: boolean
): string {
  const total = formatClock((minutes?.outfieldMs ?? 0) + (minutes?.goalkeeperMs ?? 0));
  return inGoal ? `GK ${total}` : total;
}
