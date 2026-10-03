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

import type { Format, OutfieldUnit, Position, UUID } from '../types/index';
import { teamSheetFor } from './lineup';

/** Position id → the player in it, or null when empty. */
export type Sheet = Record<UUID, UUID | null>;

function ordered(format: Format): Position[] {
  return [...format.positions].sort((a, b) => a.sortOrder - b.sortOrder);
}

function keeperPosition(format: Format): Position | undefined {
  return ordered(format).find((p) => p.kind === 'goalkeeper');
}

/** A player's preferred outfield unit (#86), or nothing. */
export type PrefersOf = (playerId: UUID) => OutfieldUnit | null | undefined;

/**
 * The sheet for a chosen set of players and a keeper.
 *
 * With `prefersOf` (#86 AC3), players who prefer a unit are placed in an
 * empty position of that unit first; everyone else then fills back to front
 * exactly as before. Without it, the old list-and-keeper behaviour stands.
 */
export function sheetFromSelection(
  onPitch: UUID[],
  goalkeeper: UUID | null,
  format: Format,
  prefersOf?: PrefersOf
): Sheet {
  if (prefersOf) {
    let sheet: Sheet = {};
    for (const p of format.positions) sheet[p.id] = null;
    const keeper = keeperPosition(format);
    if (keeper && goalkeeper && onPitch.includes(goalkeeper)) sheet[keeper.id] = goalkeeper;
    const rest = onPitch.filter((id) => id !== goalkeeper);
    // Those with a preference first, so they get first pick of their unit.
    const ordered = [...rest.filter((id) => prefersOf(id)), ...rest.filter((id) => !prefersOf(id))];
    for (const id of ordered) sheet = addToSheet(sheet, format, id, prefersOf(id) ?? null);
    return sheet;
  }
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
 * Bring a player on: an empty position in their preferred unit if they have
 * one (#86), else the first empty outfield slot back to front, then goal.
 * Unchanged if they are already on or there is no room.
 */
export function addToSheet(
  sheet: Sheet,
  format: Format,
  playerId: UUID,
  prefers: OutfieldUnit | null = null
): Sheet {
  if (playersOn(sheet).includes(playerId)) return sheet;
  const slots = ordered(format);
  const free =
    (prefers ? slots.find((p) => p.unit === prefers && (sheet[p.id] ?? null) === null) : undefined) ??
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

// ---------------------------------------------------------------------------
// During play — #83 AC4, #82
// ---------------------------------------------------------------------------

/** Who is in which position right now, from the open stints of a period. */
export function liveSheet(
  appearances: { quarterId: UUID; playerId: UUID; positionId: UUID; endElapsedMs: number | null }[],
  quarterId: UUID
): Sheet {
  const sheet: Sheet = {};
  for (const a of appearances) {
    if (a.quarterId === quarterId && a.endElapsedMs === null) sheet[a.positionId] = a.playerId;
  }
  return sheet;
}

/** What a move during play means for the engine, or null when it means nothing. */
export type LiveMove =
  | { kind: 'swap'; a: UUID; b: UUID }
  | { kind: 'sub'; out: UUID; in: UUID };

/**
 * Turn a drop (or a tap-tap) during play into an engine command.
 *
 * - on the pitch, onto another position: the two swap positions;
 * - from the bench, onto a position: a substitution for whoever is there;
 * - on the pitch, onto a bench player: a substitution the other way;
 * - onto the bench itself, or onto yourself: nothing. A position cannot be
 *   left empty while the clock runs, so taking a player off needs someone to
 *   come on.
 */
export function liveMove(
  sheet: Sheet,
  playerId: UUID,
  target: { kind: 'slot'; positionId: UUID } | { kind: 'player'; playerId: UUID } | { kind: 'bench' }
): LiveMove | null {
  const on = (id: UUID) => Object.values(sheet).includes(id);
  if (target.kind === 'bench') return null;
  if (target.kind === 'slot') {
    const there = sheet[target.positionId] ?? null;
    if (!there || there === playerId) return null;
    return on(playerId) ? { kind: 'swap', a: playerId, b: there } : { kind: 'sub', out: there, in: playerId };
  }
  const other = target.playerId;
  if (other === playerId) return null;
  if (on(playerId) && !on(other)) return { kind: 'sub', out: playerId, in: other };
  if (!on(playerId) && on(other)) return { kind: 'sub', out: other, in: playerId };
  if (on(playerId) && on(other)) return { kind: 'swap', a: playerId, b: other };
  return null;
}

/** The move that puts a live move back (the 10-second Undo, #83). */
export function reverseOf(move: LiveMove): LiveMove {
  return move.kind === 'swap' ? move : { kind: 'sub', out: move.in, in: move.out };
}

/**
 * A move before kick-off (#83 AC5): it edits the sheet and records nothing.
 *
 * - onto a position: that player goes there (swapping with a player already
 *   on, or sending the occupant to the bench);
 * - a player on the pitch onto a bench player: the bench player takes their
 *   place;
 * - onto the bench: that player comes off, leaving the position empty.
 */
export function editSheet(
  sheet: Sheet,
  playerId: UUID,
  target: { kind: 'slot'; positionId: UUID } | { kind: 'player'; playerId: UUID } | { kind: 'bench' }
): Sheet {
  if (target.kind === 'slot') return placeInSlot(sheet, target.positionId, playerId);
  if (target.kind === 'bench') return removeFromSheet(sheet, playerId);
  const slotOf = (id: UUID) => (Object.keys(sheet) as UUID[]).find((p) => sheet[p] === id);
  const mine = slotOf(playerId);
  const theirs = slotOf(target.playerId);
  if (mine && !theirs) return placeInSlot(sheet, mine, target.playerId);
  if (!mine && theirs) return placeInSlot(sheet, theirs, playerId);
  if (mine && theirs) return placeInSlot(sheet, theirs, playerId);
  return sheet;
}
