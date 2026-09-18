/**
 * Squad entry — REQ-09 (#9).
 *
 * Pure TypeScript. No React, no storage, no platform imports.
 *
 * ---------------------------------------------------------------------------
 * Invariant 4 is enforced here, not merely documented
 * ---------------------------------------------------------------------------
 *
 * These are children. The model holds a first name and nothing else: no
 * surname, no date of birth, no contact details, no photo. `validateName`
 * rejects anything that looks like more than a first name, so the rule is a
 * gate a coach meets at the point of entry rather than a line in a document
 * nobody reads.
 *
 * Rejecting "Alex Smith" is deliberate and will occasionally annoy. That is the
 * correct trade: a surname typed once is a surname in the data forever, and
 * ADR-011 keeps all of this on the device precisely because it cannot be
 * un-leaked afterwards.
 *
 * Two children called Alex is the normal case, not an error — real squads have
 * them. They are disambiguated by a `displaySuffix` the coach controls, which
 * is what the domain model already provides.
 */

import { uuid } from '../types/index';
import type { Player, UUID } from '../types/index';

/** A squad cannot take the field with fewer players than the format needs. */
export const MIN_SQUAD_SIZE = 7;

/** Long enough for any first name, short enough to stay readable at a touchline. */
export const MAX_NAME_LENGTH = 16;

export type NameRejection =
  | 'empty'
  | 'too-long'
  | 'looks-like-a-full-name'
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
  if (cleaned.includes(' ')) {
    return {
      ok: false,
      cleaned,
      reason: 'looks-like-a-full-name',
      message: 'First names only — no surnames. This app never stores them.',
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

  return { ok: true, cleaned, message: '' };
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
 * outfield time, never time per position.
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
