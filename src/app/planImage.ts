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
 *   (#166 renames included) and each child's first name as stored;
 * - under each pitch, that period's planned subs, "Hal on for Eli – 6m",
 *   the minute counted from the start of that period, or "No subs this
 *   quarter"; then a "Bench: …" line;
 * - a header (us v them, date, kick-off, "4 quarters of 12½ min") and the
 *   footer that says it is a plan, not a promise.
 *
 * What it never carries (Q1, Q3, ADR-017 §3): minutes figures, who is
 * unavailable, anything from another match, surnames. A child marked absent
 * is left off the bench line rather than listed as absent.
 *
 * Nothing here is stored. The image is built when the coach shares and
 * thrown away after.
 */

import type { Format, Match, Player, PositionUnit, UUID } from '../types/index';
import { opponentLabel } from './fixtures';
import { periodNoun } from './matchClock';
import { planFor, type MatchPlan } from './matchPlan';
import { slotSpots } from './pitchLayout';

/** 2×2 is the default: it reads better on a phone (Rob, #165). */
export type PlanImageLayout = 'grid' | 'row';

/** The PNG's width in pixels, not the phone's screen width (#165 ruling). */
export const PLAN_IMAGE_WIDTH: Record<PlanImageLayout, number> = { grid: 1200, row: 1600 };

export const PLAN_IMAGE_FOOTER = 'The plan, not a promise: it can change on the day.';

export interface PlanImageSlot {
  positionId: UUID;
  /** This match's name for the position, renames included. */
  label: string;
  unit: PositionUnit | null;
  keeper: boolean;
  /** The child's first name as stored; null when nobody is planned there. */
  firstName: string | null;
  /** Centre, as fractions of the pitch's width and height. */
  x: number;
  y: number;
}

export interface PlanImagePeriod {
  /** "Quarter 1", "Half 2". */
  title: string;
  slots: PlanImageSlot[];
  /** "Hal on for Eli – 6m", in plan order; empty when none. */
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
 * The minute a sub reads as, counted from the start of its period: the
 * nearest whole minute. Sub times move in 15-second steps, so the midpoint
 * of a 12½-minute quarter is 06:15, and a parent reads that as "6m".
 */
export function subMinute(atMs: number): number {
  return Math.round(atMs / 60_000);
}

/** "Hal on for Eli – 6m". The dash is an en dash, as Rob wrote it. */
export function subLine(onName: string, offName: string, atMs: number): string {
  return `${onName} on for ${offName} – ${subMinute(atMs)}m`;
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
  const nameOf = new Map(players.map((p) => [p.id, p.firstName]));
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
        firstName: known ? nameOf.get(who)! : null,
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
      .map((p) => p.firstName);

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
    footer: PLAN_IMAGE_FOOTER,
  };
}
