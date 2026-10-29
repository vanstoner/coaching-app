/**
 * Squad entry — REQ-09 (#9).
 *
 * Pure TypeScript. No React, no storage, no platform imports.
 *
 * ---------------------------------------------------------------------------
 * Invariant 4 is enforced here, not merely documented
 * ---------------------------------------------------------------------------
 *
 * These are children. The model holds a name and nothing else: no surname
 * field, no date of birth, no contact details, no photo. First names are the
 * default (Rob, 26 Oct, #54): one word is added at once; a name of more than
 * one word ("Alex S", "Alex Smith", "The Cat") is allowed only after the
 * coach confirms a warning that says why. `validateName` reports it as
 * `more-than-one-word`, never as ok, so no path can save it unconfirmed.
 *
 * A surname typed once is kept in the phone's record and every backup, and
 * ADR-011 keeps all of this on the device because it cannot be un-leaked; so
 * the warning recommends an initial first.
 *
 * Two children called Alex is the normal case, not an error — real squads have
 * them. A confirmed name is split at the first space into `firstName` and a
 * `displaySuffix` (Ada, #54 AC7), which is how two of them are told apart.
 */

import { uuid } from '../types/index';
import type { KeeperPreference, OutfieldUnit, Player, UUID } from '../types/index';

/** Long enough for any first name, short enough to stay readable at a touchline. */
export const MAX_NAME_LENGTH = 16;

export type NameRejection =
  | 'empty'
  | 'too-long'
  /** Allowed, but only after the coach confirms (#54 AC2, AC3): see `nameWarning`. */
  | 'more-than-one-word'
  | 'not-a-name';

export interface NameCheck {
  ok: boolean;
  /** The name as it should be stored: trimmed, internal spacing collapsed. */
  cleaned: string;
  reason?: NameRejection;
  /** What to show the coach. Empty when ok. */
  message: string;
}

/**
 * Check a typed name before it becomes a player.
 *
 * Permissive about real first names — "Síobhán", "O'Neill" as a given name,
 * "Jean-Luc" all pass — and strict about the one thing invariant 4 forbids: a
 * second word, which is almost always a surname.
 */
export function validateName(raw: string): NameCheck {
  const cleaned = raw.trim().replace(/\s+/g, ' ');

  if (cleaned.length === 0) {
    return { ok: false, cleaned, reason: 'empty', message: 'Enter a first name.' };
  }
  if (cleaned.length > MAX_NAME_LENGTH) {
    return {
      ok: false,
      cleaned,
      reason: 'too-long',
      message: `Keep it to ${MAX_NAME_LENGTH} characters.`,
    };
  }
  // At least one letter. Rejects "123" and punctuation-only input without
  // trying to enumerate which letters a name may contain.
  if (!/\p{L}/u.test(cleaned)) {
    return {
      ok: false,
      cleaned,
      reason: 'not-a-name',
      message: 'That does not look like a name.',
    };
  }
  if (cleaned.includes(' ')) {
    return {
      ok: false,
      cleaned,
      reason: 'more-than-one-word',
      message: `“${cleaned}” is more than a first name`,
    };
  }

  return { ok: true, cleaned, message: '' };
}

/** What the warning for a name of more than one word offers (#54 AC2; Dee's prototype). */
export interface NameWarning {
  /** The first word and the second word's initial: "Alex S". The recommended choice. */
  initial: string;
  /** The second word is already an initial ("Alex S", "Alex S."): no "Keep" button is needed. */
  isInitial: boolean;
}

/** For a cleaned name of more than one word. */
export function nameWarning(cleaned: string): NameWarning {
  const [first, ...rest] = cleaned.split(' ');
  const second = rest.join(' ');
  const letter = [...second].find((c) => /\p{L}/u.test(c)) ?? '';
  return {
    initial: letter === '' ? first : `${first} ${letter.toLocaleUpperCase()}`,
    isInitial: /^\p{L}\.?$/u.test(second),
  };
}

/**
 * A confirmed name as stored (#54 AC7, Ada): split at the first space into
 * `firstName` and `displaySuffix`. The record already holds both fields, so
 * nothing about its format changes.
 */
export function splitName(cleaned: string): { firstName: string; displaySuffix: string | null } {
  const at = cleaned.indexOf(' ');
  return at < 0
    ? { firstName: cleaned, displaySuffix: null }
    : { firstName: cleaned.slice(0, at), displaySuffix: cleaned.slice(at + 1) };
}

/**
 * Another player already shown by this name (#54 AC4), so the coach can be
 * offered an initial. Matching ignores case; `selfId` is the child being
 * renamed.
 */
export function sameNameAs(players: Player[], name: string, selfId: UUID | null = null): Player | undefined {
  const wanted = name.toLocaleLowerCase();
  return players.find((p) => p.id !== selfId && displayName(p).toLocaleLowerCase() === wanted);
}

/** Build a Player. The only field carrying anything about a child is the name. */
export function makePlayer(
  squadId: UUID,
  firstName: string,
  displaySuffix: string | null = null
): Player {
  return {
    id: uuid(),
    squadId,
    firstName,
    displaySuffix,
    squadNumber: null,
    active: true,
    createdAt: new Date().toISOString(),
  };
}

/**
 * What to call a player on screen: the first name, plus a suffix only when it
 * is needed to tell two of them apart.
 */
export function displayName(player: Player): string {
  return player.displaySuffix ? `${player.firstName} ${player.displaySuffix}` : player.firstName;
}

/**
 * True when another player in the squad shares this first name.
 *
 * Not an error — it is how the screen knows to ask the coach for an initial.
 */
export function hasDuplicateName(players: Player[], player: Player): boolean {
  const name = player.firstName.toLocaleLowerCase();
  return players.some(
    (p) => p.id !== player.id && p.firstName.toLocaleLowerCase() === name
  );
}

/** Every first name that more than one player in the squad answers to. */
export function duplicatedNames(players: Player[]): string[] {
  const counts = new Map<string, number>();
  for (const p of players) {
    const key = p.firstName.toLocaleLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  // Deduped on the same case-insensitive key the count uses. Deduping on the
  // raw name instead returned both "Alex" and "alex", which would have asked
  // the coach to disambiguate a name that appears twice as though it were two
  // different problems.
  const out: string[] = [];
  const emitted = new Set<string>();
  for (const p of players) {
    const key = p.firstName.toLocaleLowerCase();
    if ((counts.get(key) ?? 0) > 1 && !emitted.has(key)) {
      emitted.add(key);
      out.push(p.firstName);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Retire, don't delete — #77 (PO ruling 2026-10-03: option A)
// ---------------------------------------------------------------------------
//
// > *"if squad is deleted or changed fixtures lose info from that match"*
//
// Removing a player used to delete them, and every match they had played then
// named them "Unknown": the minutes survived, who they belonged to did not.
// A player who has played is now RETIRED — `active: false`, the field the
// model has carried since the start — and stays the one source of their name.

/** In the squad today. A save from before `active` was used reads as active. */
export function isActive(player: Player): boolean {
  return player.active !== false;
}

export function activePlayers(players: Player[]): Player[] {
  return players.filter(isActive);
}

/** Everyone with at least one recorded appearance, in any match given. */
export function playedPlayerIds(
  matches: { appearances: { playerId: UUID }[] }[]
): Set<UUID> {
  const ids = new Set<UUID>();
  for (const m of matches) for (const a of m.appearances) ids.add(a.playerId);
  return ids;
}

/**
 * Take a player out of the squad.
 *
 * Retired if they have played, so history keeps their name (AC1). Removed
 * outright if they never have: there is no history to keep (AC3).
 */
export function removePlayer(
  players: Player[],
  playerId: UUID,
  played: ReadonlySet<UUID>
): Player[] {
  if (!played.has(playerId)) return players.filter((p) => p.id !== playerId);
  return players.map((p) => (p.id === playerId ? { ...p, active: false } : p));
}

/** Bring a retired player back, history intact (AC4). */
export function restorePlayer(players: Player[], playerId: UUID): Player[] {
  return players.map((p) => (p.id === playerId ? { ...p, active: true } : p));
}

/**
 * The players a match screen should show: today's squad, plus anyone who has
 * played in THIS match even if they have since been retired. A retired player
 * must not appear as "did not play" in next week's game, and must not vanish
 * from the game they did play in.
 */
export function playersForMatch(
  players: Player[],
  appearances: { playerId: UUID }[]
): Player[] {
  const here = new Set(appearances.map((a) => a.playerId));
  return players.filter((p) => isActive(p) || here.has(p.id));
}

export interface SquadReadiness {
  ready: boolean;
  /** How many more players are needed before a match can start. */
  shortBy: number;
  message: string;
}

/**
 * Whether this squad can take the field for a format needing `onFieldCount`.
 *
 * A squad exactly the size of the team is legal and worth flagging: it plays,
 * but nobody can be substituted, which is the whole point of the app.
 */
export function squadReadiness(players: Player[], onFieldCount: number): SquadReadiness {
  const n = players.length;
  if (n < onFieldCount) {
    const shortBy = onFieldCount - n;
    return {
      ready: false,
      shortBy,
      message: `${shortBy} more ${shortBy === 1 ? 'player' : 'players'} needed to field a team.`,
    };
  }
  if (n === onFieldCount) {
    return {
      ready: true,
      shortBy: 0,
      message: 'Exactly a full team — nobody on the bench, so no substitutions.',
    };
  }
  const subs = n - onFieldCount;
  return {
    ready: true,
    shortBy: 0,
    message: `${onFieldCount} on the pitch, ${subs} on the bench.`,
  };
}

/**
 * Assign the starting team to the format's positions.
 *
 * The first `onFieldCount` players start, in entry order, which is a
 * placeholder: choosing who plays where by affinity is REQ-02 (#2). Position
 * assignment is deliberately NOT a fairness input — invariant 3 measures total
 * time on the pitch, goal plus outfield, never time per position (ADR-015).
 */
export function buildTeamSheet(
  players: Player[],
  positions: { id: UUID }[]
): Map<UUID, UUID> {
  const sheet = new Map<UUID, UUID>();
  positions.forEach((position, i) => {
    const player = players[i];
    if (player) sheet.set(position.id, player.id);
  });
  return sheet;
}

// ---------------------------------------------------------------------------
// Position preference — #86
// ---------------------------------------------------------------------------
//
// > *"for the squad screen allow a position preference most important for the
// > GK"* — PO, 2026-10-03
//
// On the player, by unit. A suggestion only: never a fairness input.

export const KEEPER_LABEL: Record<KeeperPreference, string> = {
  main: 'Main keeper',
  backup: 'Back-up',
  never: 'Not in goal',
};

export const UNIT_PREF_LABEL: Record<OutfieldUnit, string> = { DEF: 'DEF', MID: 'MID', ATT: 'FWD' };

/** Set, or with null clear, a player's goalkeeping preference. */
export function setKeeperPreference(
  players: Player[],
  playerId: UUID,
  keeper: KeeperPreference | null
): Player[] {
  return players.map((p) => (p.id === playerId ? { ...p, keeper } : p));
}

/** Set, or with null clear, a player's preferred outfield unit. */
export function setUnitPreference(
  players: Player[],
  playerId: UUID,
  prefers: OutfieldUnit | null
): Player[] {
  return players.map((p) => (p.id === playerId ? { ...p, prefers } : p));
}

/**
 * "Main keeper · MID · Outfield 25%", or '' with no preference. For the squad
 * list. The outfield-share target (#101) is shown, never a fairness input.
 */
export function preferenceSummary(player: Player): string {
  const target = player.outfieldTargetPct;
  return [
    player.keeper ? KEEPER_LABEL[player.keeper] : null,
    player.prefers ? UNIT_PREF_LABEL[player.prefers] : null,
    typeof target === 'number' ? `Outfield ${target}%` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}
