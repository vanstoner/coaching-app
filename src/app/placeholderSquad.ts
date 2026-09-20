/**
 * A placeholder squad, so the clock has a match to keep time for.
 *
 * THIS IS NOT A REAL SQUAD. Real squad data is never committed (CLAUDE.md,
 * Data protection) and never ships inside an APK — the repository is public and
 * release assets are permanent. Squad and player management is REQ-09 (#9);
 * until it lands, the clock needs a format and a team sheet to satisfy the
 * engine, and these are it.
 *
 * First names only, as invariant 4 requires of real players. The rule applies
 * to placeholders too: a fixture that models the wrong shape is how the wrong
 * shape gets built.
 */

import { uuid } from '../types/index';
import type { Format, UUID } from '../types/index';
import { DEFAULT_SHAPE, makeFormat } from './shapes';

/** Default match length: the PO's under-10s play 50 minutes in quarters. */
export const DEFAULT_TOTAL_MINUTES = 50;
export const DEFAULT_QUARTER_COUNT = 4;

export const PLACEHOLDER_SQUAD_NAME = 'Example FC';

const PLACEHOLDER_FIRST_NAMES = [
  'Alex',
  'Sam',
  'Jo',
  'Casey',
  'Riley',
  'Jamie',
  'Morgan',
] as const;

export interface PlaceholderSquad {
  squadId: UUID;
  format: Format;
  /** positionId → playerId, which is what `startQuarter` takes. */
  teamSheet: Map<UUID, UUID>;
  /** playerId → first name, for when the screen starts naming players. */
  playerNames: Map<UUID, string>;
}

/** Build the placeholder squad. Called once, at app start. */
export function makePlaceholderSquad(): PlaceholderSquad {
  const format = makeFormat(DEFAULT_SHAPE);

  const teamSheet = new Map<UUID, UUID>();
  const playerNames = new Map<UUID, string>();
  format.positions.forEach((position, i) => {
    const playerId = uuid();
    teamSheet.set(position.id, playerId);
    playerNames.set(playerId, PLACEHOLDER_FIRST_NAMES[i]);
  });

  return { squadId: uuid(), format, teamSheet, playerNames };
}

/**
 * The 7-a-side format on its own, without placeholder players.
 *
 * The squad's DEFAULT shape, which is all this is now: the shape a match is
 * actually played in belongs to the match (#70). Custom position sets are
 * REQ-10 (#10), still open.
 */
export function makeSevenASideFormat(): Format {
  return makeFormat(DEFAULT_SHAPE);
}
