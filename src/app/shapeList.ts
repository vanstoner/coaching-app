/**
 * The Shape list sheet, and the Minutes one — #249 C11, I36 to I41 (Rob, 30
 * Oct, `approve 2b`; Dee's prototype, shape list B).
 *
 * Pure TypeScript: what the sheets list and what the cost line says. The
 * screens only draw it.
 *
 * - **Shape list B**: the season's size first, under a heading with
 *   "· this season", then an **Other team sizes** action that opens the other
 *   sizes in place, each under its own heading, in size order. It opens
 *   already expanded when the current shape is another size.
 * - **The cost line**: a shape of another size than the season's is never
 *   refused (Heart of the Game: the cost is shown). Its wording is Bea's,
 *   matching ADR-015 §6a and the words Start a new season already uses.
 */

import { TOTAL_MINUTES_CHOICES } from './matchClock';
import { SHAPES, SHAPE_SIDES, shapeCue, shapeLabel, sideOfShape, type ShapeCode } from './shapes';

/** The season's size, as the figures read it (ADR-015 §6a, ADR-022 D5). */
export interface SeasonSize {
  /** `seasonSide`: the main format once set, else the dominating side; null when neither. */
  side: number | null;
  /** Whether the coach has set the main format (else `side` is the dominating side). */
  mainSet: boolean;
}

export interface ShapeGroup {
  side: number;
  /** "9-a-side", or "9-a-side · this season" for the first group when the season has a size. */
  heading: string;
  items: { value: ShapeCode; label: string; detail: string }[];
}

const sideName = (n: number) => `${n}-a-side`;

function group(side: number, thisSeason: boolean): ShapeGroup {
  return {
    side,
    heading: thisSeason ? `${sideName(side)} · this season` : sideName(side),
    items: SHAPES.filter((s) => s.slots.length === side).map((s) => ({
      value: s.code,
      label: shapeLabel(s.code),
      // Under a size heading, the cue drops the size (I38).
      detail: shapeCue(s.code),
    })),
  };
}

/**
 * The sheet's groups: `first` is shown at once; `others` behind Other team
 * sizes (I36). With no season size, the first is the current shape's size,
 * without "· this season" (I39).
 */
export function shapeGroups(season: SeasonSize, current: ShapeCode | null): { first: ShapeGroup; others: ShapeGroup[] } {
  const known = season.side !== null && SHAPE_SIDES.includes(season.side);
  const firstSide = known ? season.side! : current ? sideOfShape(current) : SHAPE_SIDES[0];
  return {
    first: group(firstSide, known),
    others: SHAPE_SIDES.filter((n) => n !== firstSide).map((n) => group(n, false)),
  };
}

/** I37: the sheet opens expanded when the current shape is not in the first group. */
export function opensExpanded(season: SeasonSize, current: ShapeCode | null): boolean {
  if (current === null) return false;
  return sideOfShape(current) !== shapeGroups(season, current).first.side;
}

/** The note at the top of the expanded Other team sizes (I40). */
export const OTHER_SIZES_NOTE =
  "A match at another size is kept, but left out of this season's fairness figures unless you count it.";

/**
 * I40: the line under the Shape row when the picked shape is another size
 * than the season's; null when it is the same, or the season has no size.
 * The sizes are worked out, never written into the text.
 */
export function shapeCostLine(season: SeasonSize, picked: ShapeCode | null): string | null {
  if (picked === null || season.side === null) return null;
  const own = sideOfShape(picked);
  if (own === season.side) return null;
  const lead = season.mainSet
    ? `This season is ${sideName(season.side)}.`
    : `This season has been mostly ${sideName(season.side)}.`;
  const article = own === 8 || own === 11 || own === 18 ? 'An' : 'A';
  return `${lead} ${article} ${sideName(own)} match is kept, but left out of the season's fairness figures unless you count it.`;
}

/** C11: the Minutes sheet's lines, ascending, "70 min". */
export const MINUTES_ITEMS: readonly { value: number; label: string }[] = [...TOTAL_MINUTES_CHOICES]
  .sort((a, b) => a - b)
  .map((m) => ({ value: m, label: minutesValue(m) }));

/** What the Minutes row shows: "70 min" (C11). */
export function minutesValue(totalMinutes: number): string {
  return `${totalMinutes} min`;
}
