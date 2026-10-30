/**
 * The plan image for parents — #165.
 *
 * > *"On the plan page I want to generate a shareable image of the 4 quarter
 * > formations with planned subs ... this is to show parents the night before
 * > a game."* — Rob, 2026-10-08.
 *
 * Pure TypeScript: this turns a match plan into exactly the words and slots
 * the image shows, and the screen only draws them. Everything a parent sees
 * is decided here, so it is tested here.
 *
 * What it carries, by Rob's rulings on #165:
 * - every period's starting pitch, with this match's own position names
 *   (#166 renames included) and each child's name as the app shows it
 *   (`displayName`: "Alex S" when the coach confirmed a second word; Rob,
 *   30 Oct, #54);
 * - under each pitch, that period's planned subs, "Hal on for Eli – 6:15",
 *   the exact planned time counted from the start of that period (#205 AC3,
 *   which replaced the earlier rounding to whole minutes), or "No subs this
 *   quarter"; then a "Bench: …" line;
 * - a header (us v them, date, kick-off, "4 quarters of 12½ min") and the
 *   footer that says it is a plan, not a promise.
 *
 * What it never carries (Q1, Q3, ADR-017 §3): minutes figures, who is
 * unavailable, anything from another match. A second word reaches it only
 * as the coach confirmed it under #54's warning. A child marked absent is
 * left off the bench line rather than listed as absent.
 *
 * Nothing here is stored. The image is built when the coach shares and
 * thrown away after.
 */

import type { Format, Match, Player, PositionUnit, UUID } from '../types/index';
import type { Distribution } from './distribution';
import { opponentLabel } from './fixtures';
import { formatSubTime, periodNoun } from './matchClock';
import { planFor, type MatchPlan } from './matchPlan';
import { slotSpots, type Rect } from './pitchLayout';
import { displayName } from './squad';

/** 2×2 is the default: it reads better on a phone (Rob, #165). */
export type PlanImageLayout = 'grid' | 'row';

/** The PNG's width in pixels, not the phone's screen width (#165 ruling). */
export const PLAN_IMAGE_WIDTH: Record<PlanImageLayout, number> = { grid: 1200, row: 1600 };

/**
 * What Share plan does first (#165, #226). Quarters ask "2 × 2 or four in a
 * row"; halves sit side by side either way, so they go straight to the grid.
 *
 * The `store` build (screenshots only, simulator only, ADR-017) goes straight
 * to the 2 × 2 as well: the question is an ActionSheet, a Modal whose buttons
 * Maestro cannot find on iOS, and shot 03-plan is that 2 × 2. Every coach's
 * build (`app`, `beta`, `demo`) asks as before.
 */
export function shareFirstStep(periodCount: number, distribution: Distribution): 'ask' | 'grid' {
  if (distribution === 'store') return 'grid';
  return periodCount === 4 ? 'ask' : 'grid';
}

/**
 * Image pixels, per layout. The grid's pitches are wider, so its type is
 * larger. Here rather than in the view so the geometry is tested in Node.
 */
export const PLAN_IMAGE_SIZES = {
  grid: { pad: 40, gap: 32, title: 60, details: 30, period: 36, position: 26, name: 40, sub: 34, bench: 30, footer: 26 },
  row: { pad: 36, gap: 28, title: 60, details: 30, period: 32, position: 20, name: 30, sub: 28, bench: 24, footer: 24 },
} as const;

/**
 * A name box's width as a fraction of its pitch: 30 %, three in a row at
 * 0.18 / 0.5 / 0.82 never touch; 22 % at 11-a-side, the whole pitch, with
 * the phone's four-across spacing (#249 H33; Rob, 30 Oct, `approve 1`).
 */
export function planSlotWidth(onFieldCount: number): number {
  return onFieldCount >= 11 ? 0.22 : 0.3;
}

/** One period's column width and pitch height, in image pixels. */
export function planPitchSize(layout: PlanImageLayout, periodCount: number): { colWidth: number; pitchHeight: number } {
  const s = PLAN_IMAGE_SIZES[layout];
  // Four in a row is for quarters; halves sit side by side either way.
  const cols = layout === 'row' ? periodCount : Math.min(2, periodCount);
  const colWidth = (PLAN_IMAGE_WIDTH[layout] - 2 * s.pad - s.gap * (cols - 1)) / cols;
  return { colWidth, pitchHeight: (colWidth * 4) / 3 };
}

/**
 * Where a name box is drawn on its pitch, in image pixels: the position name
 * and the pill together, centred on the spot. PlanImageView draws exactly
 * this, so the geometry test measures what is in the picture.
 */
export function planSlotBox(
  slot: Pick<PlanImageSlot, 'x' | 'y'>,
  layout: PlanImageLayout,
  colWidth: number,
  pitchHeight: number,
  slotWidth: number
): Rect {
  const s = PLAN_IMAGE_SIZES[layout];
  // The label (with its 4px margin) and the pill (6px padding each side).
  const height = s.position * 1.2 + 4 + s.name * 1.2 + 12;
  return {
    x: colWidth * (slot.x - slotWidth / 2),
    y: pitchHeight * slot.y - (s.position * 1.2 + s.name * 1.2 + 16) / 2,
    width: colWidth * slotWidth,
    height,
  };
}

export const PLAN_IMAGE_FOOTER = 'The plan, not a promise: it can change on the day.';

export interface PlanImageSlot {
  positionId: UUID;
  /** This match's name for the position, renames included. */
  label: string;
  unit: PositionUnit | null;
  keeper: boolean;
  /** The child's `displayName`, as every screen shows it (#54); null when nobody is planned there. */
  name: string | null;
  /** Centre, as fractions of the pitch's width and height. */
  x: number;
  y: number;
}

export interface PlanImagePeriod {
  /** "Quarter 1", "Half 2". */
  title: string;
  slots: PlanImageSlot[];
  /** "Hal on for Eli – 6:15", in plan order; empty when none. */
  subLines: string[];
  /** "No subs this quarter" when `subLines` is empty, else null. */
  noSubs: string | null;
  /** "Bench: Ava, Ben". */
  bench: string;
}

export interface PlanImage {
  /** "Heart FC v Sample Town". */
  title: string;
  /** "Saturday 10 October · kick-off 10:00 · 4 quarters of 12½ min". */
  details: string;
  periods: PlanImagePeriod[];
  /** A name box's width as a fraction of its pitch (`planSlotWidth`). */
  slotWidth: number;
  footer: string;
}

// Spelled out here rather than with toLocale*: Hermes is not Node, and its
// Intl support is not something this image should depend on.
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** "Saturday 10 October · kick-off 10:00", in the phone's local time; "Date TBC" when unknown. */
export function kickoffLine(kickoffAt: string | null): string {
  const at = kickoffAt ? new Date(kickoffAt) : null;
  if (!at || Number.isNaN(at.getTime())) return 'Date TBC';
  const hh = String(at.getHours()).padStart(2, '0');
  const mm = String(at.getMinutes()).padStart(2, '0');
  return `${DAYS[at.getDay()]} ${at.getDate()} ${MONTHS[at.getMonth()]} · kick-off ${hh}:${mm}`;
}

const FRACTIONS: Record<number, string> = { 0.25: '¼', 0.5: '½', 0.75: '¾' };

/** 12.5 → "12½", 25 → "25". Anything without a vulgar fraction keeps one decimal. */
export function minutesLabel(minutes: number): string {
  const whole = Math.floor(minutes);
  const part = minutes - whole;
  if (part === 0) return String(whole);
  const glyph = FRACTIONS[part];
  return glyph ? `${whole}${glyph}` : minutes.toFixed(1);
}

function periodsPlural(periodCount: number): string {
  if (periodCount === 2) return 'halves';
  if (periodCount === 4) return 'quarters';
  return `${periodNoun(periodCount).toLowerCase()}s`;
}

/** "4 quarters of 12½ min", "2 halves of 25 min". */
export function lengthLine(totalMinutes: number, periodCount: number): string {
  return `${periodCount} ${periodsPlural(periodCount)} of ${minutesLabel(totalMinutes / periodCount)} min`;
}

/**
 * "Hal on for Eli – 6:15". The dash is an en dash, as Rob wrote it.
 *
 * The exact planned time, in the same form as the clock's sub list (#205
 * AC3, #203 C9). It used to round to the nearest whole minute ("6m"); Rob
 * overturned that on 2026-10-17 because parents see it: "They need to be a
 * bit more precise really."
 */
export function subLine(onName: string, offName: string, atMs: number): string {
  return `${onName} on for ${offName} – ${formatSubTime(atMs)}`;
}

/**
 * Everything the plan image shows.
 *
 * `players` is the squad the plan screen picks from; `absent` is who is
 * marked unavailable for this match, kept off the bench line. A slot or sub
 * naming someone no longer in the squad is drawn empty or left out, never
 * named from anywhere else.
 */
export function planImage(input: {
  match: Match;
  squadName: string;
  format: Format;
  plan: MatchPlan | undefined;
  players: Player[];
  absent?: ReadonlySet<UUID>;
}): PlanImage {
  const { match, squadName, format, players } = input;
  const absent = input.absent ?? new Set<UUID>();
  const periodCount = match.quarterCount;
  const noun = periodNoun(periodCount);
  const nameOf = new Map(players.map((p) => [p.id, displayName(p)]));
  const kindOf = new Map(format.positions.map((p) => [p.id, p.kind]));
  const spots = slotSpots(format);
  // Draw order: top of the pitch first, then left to right.
  spots.sort((a, b) => a.y - b.y || a.x - b.x);

  const periods = planFor(input.plan, periodCount).periods.map((period, i) => {
    const placed = new Set<UUID>();
    const slots: PlanImageSlot[] = spots.map((s) => {
      const who = period.slots[s.positionId] ?? null;
      const known = who !== null && nameOf.has(who) && !placed.has(who);
      if (known) placed.add(who);
      return {
        positionId: s.positionId,
        label: s.label,
        unit: s.unit,
        keeper: kindOf.get(s.positionId) === 'goalkeeper',
        name: known ? nameOf.get(who)! : null,
        x: s.x,
        y: s.y,
      };
    });

    // Plan order: the order the subs happen in, by time, ties in the order
    // the coach added them, as the plan's own projection walks them.
    const subLines = period.subs
      .map((swap, order) => ({ swap, order }))
      .sort((a, b) => a.swap.atMs - b.swap.atMs || a.order - b.order)
      .filter(({ swap }) => swap.onId !== null && swap.offId !== null)
      .filter(({ swap }) => nameOf.has(swap.onId!) && nameOf.has(swap.offId!))
      .map(({ swap }) => subLine(nameOf.get(swap.onId!)!, nameOf.get(swap.offId!)!, swap.atMs));

    const bench = players
      .filter((p) => !placed.has(p.id) && !absent.has(p.id))
      .map((p) => displayName(p));

    return {
      title: `${noun} ${i + 1}`,
      slots,
      subLines,
      noSubs: subLines.length === 0 ? `No subs this ${noun.toLowerCase()}` : null,
      bench: `Bench: ${bench.length === 0 ? 'nobody' : bench.join(', ')}`,
    };
  });

  return {
    title: `${squadName} v ${opponentLabel(match)}`,
    details: `${kickoffLine(match.kickoffAt)} · ${lengthLine(match.totalMinutes, periodCount)}`,
    periods,
    slotWidth: planSlotWidth(format.onFieldCount),
    footer: PLAN_IMAGE_FOOTER,
  };
}
