/**
 * Renaming a match's positions — #166, PO ruling "approve 166" (2026-10-08).
 *
 * > *"They don't change what we store in the db but they can be used to
 * > reflect a strategy (e.g if we fall the midfield CDM and ADM the kids know
 * > their responsibilities but that might only be for a match"*
 *
 * Pure TypeScript. No React, no storage.
 *
 * A position's **label** is a coaching cue; its **unit** is what time is
 * measured against (`shapes.ts`, `positions.ts`). Everything here changes the
 * label and nothing else: same id, same unit, same kind, same roleCode, same
 * sortOrder. That is what keeps invariants 1 and 3 untouched — appearances
 * reference the position id and snapshot its unit, so no recorded minute can
 * move because a slot was renamed.
 *
 * Every function returns a NEW format. A match's format can be the very
 * object the squad default is (`formatForShape` hands it over unchanged), so
 * editing in place would rename the default along with the match.
 */

import type { Format, Position, PositionUnit, QuarterStatus, UUID } from '../types/index';
import { unitName } from './positions';
import { shapeOfFormat, shapeSpec } from './shapes';

/** The longest name a coach may give a position (AC5). */
export const POSITION_NAME_MAX = 16;

/** Shown on the rename sheet (AC7): a name is a cue, never a person. */
export const POSITION_NAME_HINT = "A coaching cue for the kids, never a child's name.";

/**
 * Names offered as chips beside the text box, by unit. From the mock Rob
 * approved on #166; the slot's standard name is offered first as well.
 */
const SUGGESTIONS: Record<PositionUnit, readonly string[]> = {
  GK: ['Keeper'],
  DEF: ['Sweeper', 'Stopper', 'Full back'],
  MID: ['CDM', 'Holding mid', 'Box to box', 'Wide'],
  ATT: ['Striker', 'Goes wherever', 'Target'],
};

/** Length in characters as a person counts them, not UTF-16 units. */
const length = (s: string) => Array.from(s).length;

const inPitchOrder = (format: Format): Position[] =>
  [...format.positions].sort((a, b) => a.sortOrder - b.sortOrder);

/**
 * The shape's standard name for a position (AC5, AC6): the slot at the same
 * place in pitch order, provided it measures the same unit. Null when the
 * format is no known shape, or the slot there is a different unit — a format
 * migrated from an older version, whose order cannot be trusted to line up.
 * Null is an honest "there is no standard name to go back to".
 */
export function standardName(format: Format, positionId: UUID): string | null {
  const shape = shapeOfFormat(format);
  if (!shape) return null;
  const slots = shapeSpec(shape).slots;
  const at = inPitchOrder(format).findIndex((p) => p.id === positionId);
  if (at === -1) return null;
  const slot = slots[at];
  const position = inPitchOrder(format)[at];
  return slot && slot.unit === position.unit ? slot.label : null;
}

export type NameCheck = { ok: true; label: string } | { ok: false; reason: string };

/**
 * What a typed name becomes (AC5): trimmed; 1 to 16 characters; empty means
 * the standard name. Refused when empty and there is no standard name.
 */
export function checkPositionName(typed: string, standard: string | null): NameCheck {
  const trimmed = typed.trim();
  if (trimmed === '') {
    return standard === null
      ? { ok: false, reason: 'Give the position a name.' }
      : { ok: true, label: standard };
  }
  if (length(trimmed) > POSITION_NAME_MAX) {
    return { ok: false, reason: `A position name is at most ${POSITION_NAME_MAX} characters.` };
  }
  return { ok: true, label: trimmed };
}

export type RenameResult = { ok: true; format: Format } | { ok: false; reason: string };

/** Rename one position (AC1). Only its label changes. */
export function renamePosition(format: Format, positionId: UUID, typed: string): RenameResult {
  if (!format.positions.some((p) => p.id === positionId)) {
    return { ok: false, reason: 'That position is not in this match.' };
  }
  const check = checkPositionName(typed, standardName(format, positionId));
  if (!check.ok) return check;
  return {
    ok: true,
    format: {
      ...format,
      positions: format.positions.map((p) => (p.id === positionId ? { ...p, label: check.label } : p)),
    },
  };
}

/**
 * Reset names (AC6): every position the shape has a standard name for gets
 * it back. A position with no standard name keeps the one it has.
 */
export function resetPositionNames(format: Format): Format {
  return {
    ...format,
    positions: format.positions.map((p) => {
      const standard = standardName(format, p.id);
      return standard === null ? p : { ...p, label: standard };
    }),
  };
}

/** Whether any position differs from its standard name: is Reset worth offering? */
export function hasRenamedPositions(format: Format): boolean {
  return format.positions.some((p) => {
    const standard = standardName(format, p.id);
    return standard !== null && standard !== p.label;
  });
}

/**
 * "Use these names for new matches" (Q2): the squad default with the match's
 * names copied on, position by position in pitch order. The default keeps its
 * own ids. Null when the two are not the same shape: the default holds one
 * shape, so names for another shape have nowhere to go.
 */
export function adoptPositionNames(defaultFormat: Format, matchFormat: Format): Format | null {
  const shape = shapeOfFormat(matchFormat);
  if (!shape || shapeOfFormat(defaultFormat) !== shape) return null;
  const from = inPitchOrder(matchFormat);
  const to = inPitchOrder(defaultFormat);
  if (from.some((p, i) => p.unit !== to[i].unit)) return null;
  const labelOf = new Map(to.map((p, i) => [p.id, from[i].label]));
  return {
    ...defaultFormat,
    positions: defaultFormat.positions.map((p) => ({ ...p, label: labelOf.get(p.id) ?? p.label })),
  };
}

/** The chips under the text box: the standard name, then cues for the unit. */
export function nameSuggestions(format: Format, positionId: UUID): string[] {
  const position = format.positions.find((p) => p.id === positionId);
  if (!position) return [];
  const standard = standardName(format, positionId);
  const unit = position.unit ?? (position.kind === 'goalkeeper' ? 'GK' : null);
  const cues = unit ? SUGGESTIONS[unit] : [];
  return [...new Set([...(standard ? [standard] : []), ...cues])];
}

/** The line under the sheet's title: this match only, and the unit is unmoved. */
export function renameScopeHint(unit: PositionUnit | null): string {
  if (unit === null) return 'Just this match.';
  return `Just this match. Time here still counts as ${unitName(unit)}.`;
}

/**
 * Where names may be changed (ruling Q1): on the Plan before kick-off, and on
 * the lineup before a period starts. Never while a period runs — the live
 * clock is touchline-only and stays one-handed — and never once the last
 * period is over, when there is nothing left to cue.
 */
export function canRenamePositions(
  where: 'plan' | 'lineup',
  quarters: readonly { status: QuarterStatus }[]
): boolean {
  if (quarters.some((q) => q.status === 'running')) return false;
  if (where === 'plan') return quarters.every((q) => q.status === 'pending');
  return quarters.some((q) => q.status === 'pending');
}
