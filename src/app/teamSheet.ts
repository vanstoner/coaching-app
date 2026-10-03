/**
 * The team sheet at the whistle: who is in which named position — #72, AC9.
 *
 * Pure TypeScript.
 *
 * Field note, match day 4 (2026-10-03):
 *
 * > *"Can't assign outfield's positions explicitly - it's fine can work to an
 * > ordered list for now back to front"*
 *
 * The lineup screen used to hold a list of players and a keeper, and
 * `teamSheetFor` dealt them into the outfield slots in tap order. That order is
 * kept as the DEFAULT — a player tapped on fills the first empty outfield slot,
 * back to front — and the coach can now put anyone in any slot on top of it.
 *
 * Invariant 3 is untouched: which outfield slot a player takes is shown and
 * recorded on the appearance, and is never a fairness input.
 */

import type { Format, Position, UUID } from '../types/index';
import { teamSheetFor } from './lineup';

/** Position id → the player in it, or null when empty. */
export type Sheet = Record<UUID, UUID | null>;

function ordered(format: Format): Position[] {
  return [...format.positions].sort((a, b) => a.sortOrder - b.sortOrder);
}

function keeperPosition(format: Format): Position | undefined {
  return ordered(format).find((p) => p.kind === 'goalkeeper');
}

/** The sheet the old list-and-keeper model would have produced. */
export function sheetFromSelection(onPitch: UUID[], goalkeeper: UUID | null, format: Format): Sheet {
  const sheet: Sheet = {};
  for (const p of format.positions) sheet[p.id] = null;
  const dealt = teamSheetFor(onPitch, goalkeeper, {
    ...format,
    positions: ordered(format),
  });
  for (const [positionId, playerId] of dealt) sheet[positionId] = playerId;
  // A player picked with no keeper chosen used to fall off the end of the
  // outfield slots. They go in goal instead, where the coach can see them.
  const placed = new Set(dealt.values());
  const keeper = keeperPosition(format);
  const left = onPitch.filter((id) => !placed.has(id));
  if (keeper && sheet[keeper.id] === null && left.length > 0) sheet[keeper.id] = left[0];
  return sheet;
}

export function playersOn(sheet: Sheet): UUID[] {
  return Object.values(sheet).filter((v): v is UUID => v !== null);
}

export function keeperOf(sheet: Sheet, format: Format): UUID | null {
  const keeper = keeperPosition(format);
  return keeper ? (sheet[keeper.id] ?? null) : null;
}

/** Every position filled: the same rule the engine needs to start a period. */
export function sheetIsComplete(sheet: Sheet, format: Format): boolean {
  return format.positions.every((p) => (sheet[p.id] ?? null) !== null);
}

/**
 * Bring a player on: the first empty outfield slot, back to front, then goal.
 * Unchanged if they are already on or there is no room.
 */
export function addToSheet(sheet: Sheet, format: Format, playerId: UUID): Sheet {
  if (playersOn(sheet).includes(playerId)) return sheet;
  const slots = ordered(format);
  const free =
    slots.find((p) => p.kind !== 'goalkeeper' && (sheet[p.id] ?? null) === null) ??
    slots.find((p) => (sheet[p.id] ?? null) === null);
  if (!free) return sheet;
  return { ...sheet, [free.id]: playerId };
}

export function removeFromSheet(sheet: Sheet, playerId: UUID): Sheet {
  const next: Sheet = {};
  for (const [pos, who] of Object.entries(sheet)) next[pos as UUID] = who === playerId ? null : who;
  return next;
}

/**
 * Put a player in a position.
 *
 * Already on elsewhere: the two swap, so nobody is lost. Not on yet: they
 * replace whoever is there, who goes to the bench.
 */
export function placeInSlot(sheet: Sheet, positionId: UUID, playerId: UUID): Sheet {
  const from = (Object.keys(sheet) as UUID[]).find((pos) => sheet[pos] === playerId);
  const displaced = sheet[positionId] ?? null;
  const next: Sheet = { ...sheet, [positionId]: playerId };
  if (from && from !== positionId) next[from] = displaced;
  return next;
}

/** Make a player the keeper, swapping with whoever is in goal. */
export function makeKeeper(sheet: Sheet, format: Format, playerId: UUID): Sheet {
  const keeper = keeperPosition(format);
  if (!keeper) return sheet;
  return placeInSlot(sheet, keeper.id, playerId);
}

/** What `MatchEngine.startQuarter` takes. Empty positions are left out. */
export function toTeamSheet(sheet: Sheet): Map<UUID, UUID> {
  const map = new Map<UUID, UUID>();
  for (const [pos, who] of Object.entries(sheet)) if (who !== null) map.set(pos as UUID, who);
  return map;
}
