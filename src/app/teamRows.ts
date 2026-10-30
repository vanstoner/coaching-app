/**
 * Teams as the coach sees them — #224 AC1, AC5, AC9; Dee's prototype.
 *
 * Pure TypeScript: what a team's row in the switcher reads, whether a new
 * team's name is free, the formats a team can play (every shape, #249), and
 * what a new team or season is offered for its age and format.
 * A team's name is its squad's name (ADR-022 D2), read from its session.
 */

import { parseLedger } from './ledger';
import { hasMatchUnderway, readSession } from './persistence';
import { currentSeason, seasonLine } from './seasons';
import { DEFAULT_SHAPE, SHAPES, defaultShapeFor, sideOfShape, type ShapeCode } from './shapes';

/** What one team's row shows, from its stored session and ledger, without writing anything. */
export function readTeamRow(
  session: string | null,
  ledger: string | null
): { name: string | null; season: string; live: boolean } {
  const read = readSession(session);
  const saved = read.status === 'ok' ? read.session : null;
  const parsed = ledger === null ? null : parseLedger(ledger);
  const seasons = parsed?.ok ? parsed.ledger : { seasons: [] };
  return {
    name: saved ? saved.squadName.trim() || 'Unnamed team' : null,
    season: seasonLine(currentSeason(seasons)),
    live: hasMatchUnderway(saved),
  };
}

/** Capitals and spaces at the ends do not make a name different (T7). */
export const sameTeamName = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Why a new team's name cannot be used, or null (AC5: unique on this phone). */
export function teamNameProblem(name: string, others: readonly string[]): string | null {
  if (name.trim() === '') return 'Give the team a name.';
  if (others.some((o) => sameTeamName(o, name))) {
    return 'You already have a team with this name. Add something to tell them apart, like "Sat" or "Sun".';
  }
  return null;
}

/**
 * The formats a team can play: one line for each shape, worked out from
 * `SHAPES` (#249 B6, ADR-023 D1), in size order 5, 7, 9, 11 and in `SHAPES`
 * order within a size. Rob, 30 Oct (Q3): all eight, one line each.
 */
export const TEAM_FORMATS: readonly { shape: ShapeCode; side: number; label: string; detail: string }[] = SHAPES.map(
  (spec, i) => ({ spec, i })
)
  .sort((a, b) => a.spec.slots.length - b.spec.slots.length || a.i - b.i)
  .map(({ spec }) => ({ shape: spec.code, side: spec.slots.length, label: spec.formatName, detail: spec.label }));

/**
 * The FA's format for an age group (#249 E20; Rob, 30 Oct, "U9 fix"): U7–U8
 * 5-a-side, U9–U10 7, U11–U12 9, U13 and up 11. Null for an age it does not
 * read.
 */
export function sideForAge(age: string): number | null {
  const n = Number(age.slice(1));
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n <= 8) return 5;
  if (n <= 10) return 7;
  if (n <= 12) return 9;
  return 11;
}

/**
 * The nudge on Add a team and Start a new season (#249 E20, E23): a shape
 * already at the age's size is kept (3-2-3 stays 3-2-3 at U12); any other
 * becomes that size's default. The coach can still pick any format after.
 */
export function formatForAge(age: string, current: ShapeCode): ShapeCode {
  const side = sideForAge(age);
  if (side === null || sideOfShape(current) === side) return current;
  return defaultShapeFor(side) ?? current;
}

/**
 * Start a new season's suggested format (#243 AC4; #249 B9): the team's own
 * default shape when it fits the last season's size, else that size's
 * default shape, else `DEFAULT_SHAPE`. Named, never picked by its place in a
 * list.
 */
export function seasonStartShape(ownShape: ShapeCode | null, mainSide: number | null): ShapeCode {
  if (ownShape !== null && (mainSide === null || sideOfShape(ownShape) === mainSide)) return ownShape;
  return (mainSide === null ? null : defaultShapeFor(mainSide)) ?? DEFAULT_SHAPE;
}

/**
 * The format Start a new season opens on (#249 E23, Rob's Q2; QA Q1 on
 * #269): `seasonStartShape`, then the age nudge when the suggested age group
 * differs from last season's, because the age moved up a year is itself a
 * change of age group. A season with no age group set is not nudged.
 */
export function newSeasonShape(
  ownShape: ShapeCode | null,
  mainSide: number | null,
  lastAge: string | null,
  suggestedAge: string
): ShapeCode {
  const shape = seasonStartShape(ownShape, mainSide);
  return lastAge !== null && suggestedAge !== lastAge ? formatForAge(suggestedAge, shape) : shape;
}

/**
 * What a new team's matches start at (#249 D14–D16, ruling 4a): 9-a-side 60
 * minutes in halves, 11-a-side 70 minutes in halves (every age, Q6). Null for
 * 5- and 7-a-side, which open with today's defaults. The length follows the
 * format, never the age.
 */
export function startingDefaults(side: number): { totalMinutes: number; periodCount: number } | null {
  if (side === 9) return { totalMinutes: 60, periodCount: 2 };
  if (side === 11) return { totalMinutes: 70, periodCount: 2 };
  return null;
}

/** The hint under Main format on Add a team (#249 D18, Q1); null where today's stands alone. */
export function startingHint(side: number): string | null {
  const d = startingDefaults(side);
  if (!d) return null;
  return `Matches start at ${d.totalMinutes} min in ${d.periodCount === 2 ? 'halves' : 'quarters'}. Change it in Settings › Match defaults.`;
}
