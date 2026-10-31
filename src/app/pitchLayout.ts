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
 *
 * A row of four (#249 F25, Dee's option A): 0.13 / 0.377 / 0.623 / 0.87,
 * for NARROW_PILL_WIDTH pills, about 8dp apart on a 324dp pitch.
 */
function rowX(n: number, i: number): number {
  const table: Record<number, number[]> = {
    1: [0.5],
    2: [0.3, 0.7],
    3: [0.18, 0.5, 0.82],
    4: [0.13, 0.377, 0.623, 0.87],
  };
  return table[n]?.[i] ?? (i + 1) / (n + 1);
}

/** The width of a pill, as a fraction of the pitch's width. */
export const PILL_WIDTH_FRACTION = 0.28;

/** The narrowest pill below 11-a-side: two touch targets (#83). */
export const MIN_PILL_WIDTH = 96;

/**
 * Every pill's width at 11-a-side, the keeper's included: one width for the
 * whole pitch (#249 F25; Rob, 30 Oct, `approve 1`).
 */
export const NARROW_PILL_WIDTH = 72;

/** A pill's height in every format: a full touch target (#264 V1; #249 F26). */
export const PILL_HEIGHT = 48;

/** The gold position name above a pill: 13dp of line and 2 of margin. */
export const SLOT_LABEL_HEIGHT = 15;

/** The drawn pitch's width over its height. */
export const PITCH_ASPECT = 3 / 3.8;

/**
 * How wide a pill is on a pitch `pitchWidth` across: 72dp when the format
 * has 11 on the pitch, otherwise today's max(96dp, 28 % of the pitch) (#249
 * F24, F25). The drag ghost and the empty-slot outline use the same width.
 */
export function pillWidthFor(onFieldCount: number, pitchWidth: number): number {
  return onFieldCount >= 11 ? NARROW_PILL_WIDTH : Math.max(MIN_PILL_WIDTH, pitchWidth * PILL_WIDTH_FRACTION);
}

/**
 * Where a slot is drawn, in the pitch's own dp: the position name above the
 * pill, the pill centred 14dp above the spot. PitchView draws exactly this,
 * so the geometry test measures what is on screen.
 */
export function slotBox(
  spot: Pick<SlotSpot, 'x' | 'y'>,
  pitchWidth: number,
  pitchHeight: number,
  pillWidth: number
): Rect {
  return {
    x: spot.x * pitchWidth - pillWidth / 2,
    y: spot.y * pitchHeight - PILL_HEIGHT / 2 - 14,
    width: pillWidth,
    height: SLOT_LABEL_HEIGHT + PILL_HEIGHT,
  };
}

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
