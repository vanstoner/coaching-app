/**
 * The shape of the team — PO ruling, 2026-09-20 (#62, #70).
 *
 * Pure TypeScript. No React, no storage.
 *
 * > *"we typically range from 2, 2, 2 GK, to 2, 3, 1, GK. We might call the
 * > positions in attack midfield and defence different things depending on
 * > what we want the kids to focus on e.g. sweeper, goes wherever, CDM plays
 * > wing plus swooping defence."*
 *
 * > *"the match length and format are probably match specific - but happy to
 * > have defaults in the settings."*
 *
 * Two shapes, both 7-a-side. A shape is a list of slots, and a slot carries a
 * **label the coach reads** and a **unit time is measured against**. The label
 * is a coaching cue for this match and may be renamed; the unit is one of the
 * four fixed primitives and never is. Renaming "LW" to "goes wherever" must
 * not move a child's minutes from MID into some new bucket — invariant 3 is
 * "outfield is one bucket", and the primitives are what keep it that way.
 *
 * Nothing here decides which shape a match is played in. Settings holds the
 * **default**; the match holds the one it is actually played in.
 */

import { uuid } from '../types/index';
import type { Format, Position, PositionUnit } from '../types/index';

/** The shapes this squad plays. Two, because those are the two the PO named. */
export type ShapeCode = '2-3-1' | '2-2-2';

export interface ShapeSlot {
  /** What the coach sees. Theirs to rename; nothing is measured against it. */
  label: string;
  /** The primitive. Fixed forever — see `PositionUnit`. */
  unit: PositionUnit;
  /** The catalogue role the label came from, for when a coach renames it. */
  roleCode: string;
}

export interface ShapeSpec {
  code: ShapeCode;
  /** The chip a coach taps. */
  label: string;
  /** The cue underneath it, in the PO's own units. */
  description: string;
  /** In pitch order, back to front. `sortOrder` follows this. */
  slots: readonly ShapeSlot[];
}

/**
 * What a new squad plays until the coach says otherwise, and the fallback for
 * a stored format whose shape cannot be read.
 */
export const DEFAULT_SHAPE: ShapeCode = '2-3-1';

export const SHAPES: readonly ShapeSpec[] = [
  {
    code: '2-3-1',
    label: '2-3-1',
    description: '2 defence · 3 midfield · 1 attack',
    // Deliberately the SAME seven labels the released app already uses, so a
    // coach upgrading sees the shape they have been playing named rather than
    // their position list quietly rewritten underneath them.
    slots: [
      { label: 'GK', unit: 'GK', roleCode: 'GK' },
      { label: 'LB', unit: 'DEF', roleCode: 'LB' },
      { label: 'RB', unit: 'DEF', roleCode: 'RB' },
      { label: 'CM', unit: 'MID', roleCode: 'CM' },
      { label: 'LW', unit: 'MID', roleCode: 'LW' },
      { label: 'RW', unit: 'MID', roleCode: 'RW' },
      { label: 'ST', unit: 'ATT', roleCode: 'ST' },
    ],
  },
  {
    code: '2-2-2',
    label: '2-2-2',
    description: '2 defence · 2 midfield · 2 attack',
    slots: [
      { label: 'GK', unit: 'GK', roleCode: 'GK' },
      { label: 'LB', unit: 'DEF', roleCode: 'LB' },
      { label: 'RB', unit: 'DEF', roleCode: 'RB' },
      { label: 'LM', unit: 'MID', roleCode: 'LM' },
      { label: 'RM', unit: 'MID', roleCode: 'RM' },
      { label: 'LF', unit: 'ATT', roleCode: 'ST' },
      { label: 'RF', unit: 'ATT', roleCode: 'ST' },
    ],
  },
] as const;

/** The spec for a shape code. */
export function shapeSpec(code: ShapeCode): ShapeSpec {
  const found = SHAPES.find((s) => s.code === code);
  // Unreachable through the type, kept so a future third shape added to the
  // union and forgotten here fails loudly rather than rendering nothing.
  if (!found) throw new Error(`unknown shape ${code}`);
  return found;
}

/** "2-3-1 + GK" — how a shape is named on screen. */
export function shapeLabel(code: ShapeCode): string {
  return `${shapeSpec(code).label} + GK`;
}

/** Build the format for a shape. Fresh ids: a format belongs to one squad. */
export function makeFormat(code: ShapeCode): Format {
  const spec = shapeSpec(code);
  const formatId = uuid();
  const positions: Position[] = spec.slots.map((slot, i) => ({
    id: uuid(),
    formatId,
    label: slot.label,
    kind: slot.unit === 'GK' ? ('goalkeeper' as const) : ('outfield' as const),
    // Taken from the shape, never inferred from the label. A coach who renames
    // a slot must not be able to change what it measures.
    unit: slot.unit,
    roleCode: slot.roleCode,
    sortOrder: i,
  }));
  return {
    id: formatId,
    name: '7-a-side',
    onFieldCount: spec.slots.length,
    positions,
  };
}

/**
 * Which shape a format is, read from the units it holds.
 *
 * By unit counts, not by label, so a coach who has renamed every position to
 * "sweeper" and "goes wherever" still has a recognisable 2-3-1. Null when the
 * counts match no shape — a custom format, or one migrated from v1 with
 * outfield units still unknown. Null is a real answer here: the caller must
 * decide what to do rather than be handed a guess.
 */
export function shapeOfFormat(format: Format): ShapeCode | null {
  const count = (unit: PositionUnit) => format.positions.filter((p) => p.unit === unit).length;
  const actual = { GK: count('GK'), DEF: count('DEF'), MID: count('MID'), ATT: count('ATT') };
  for (const spec of SHAPES) {
    if (format.onFieldCount !== spec.slots.length) continue;
    if (format.positions.length !== spec.slots.length) continue;
    const wanted = {
      GK: spec.slots.filter((s) => s.unit === 'GK').length,
      DEF: spec.slots.filter((s) => s.unit === 'DEF').length,
      MID: spec.slots.filter((s) => s.unit === 'MID').length,
      ATT: spec.slots.filter((s) => s.unit === 'ATT').length,
    };
    if (
      actual.GK === wanted.GK &&
      actual.DEF === wanted.DEF &&
      actual.MID === wanted.MID &&
      actual.ATT === wanted.ATT
    ) {
      return spec.code;
    }
  }
  return null;
}

/**
 * The format a match played in `code` should use.
 *
 * `existing` is the squad's default format. When it is already that shape it
 * is returned unchanged — including whatever the coach has renamed the slots
 * to, which is the whole reason this is not simply `makeFormat`. Only a
 * genuine change of shape builds a new one.
 */
export function formatForShape(code: ShapeCode, existing: Format | null): Format {
  if (existing && shapeOfFormat(existing) === code) return existing;
  return makeFormat(code);
}
