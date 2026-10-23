/**
 * The clock's planned subs: the list, the warning and its colour — #203.
 *
 * > *"Can't see the subs while the quarter is in progress. It should sit
 * > above the timeline and be a very simple 'A on for B' with the time ...
 * > The popup should arrive 30 s before the sub is required, with perhaps a
 * > green, amber, red indication as the sub time gets closer."* — Rob,
 * > 17 Oct match.
 *
 * Pure TypeScript. Every function takes the period's elapsed time, which the
 * screen reads from the wall-clock anchors on each paint (invariant 2), so a
 * phone that slept shows the right band on its first paint after waking
 * (AC5). Nothing here counts, and nothing is stored but the coach's own
 * "Not now", which is screen state, never a record.
 *
 * The plan is intent, never a record (#72 AC8): nothing here moves a minute.
 */

import type { Appearance, UUID } from '../types/index';
import { formatSubTime } from './matchClock';
import {
  SUB_WARNING_LEAD_MS,
  clearSubTime,
  isPlanned,
  nudgeSubTime,
  setSubFor,
  setSubTime,
  subMoment,
  warnedSubs,
  whoComesOff,
  type PlannedSub,
} from './subPlan';

/** Amber from 15 s to the due time (#203 AC3; C3 keeps it at 15 s). */
export const SUB_AMBER_MS = 15_000;

/** Green from 30 s to 15 s, amber from 15 s to 0, red from the due time on. */
export type SubBand = 'green' | 'amber' | 'red';

/**
 * Where a sub is in its warning (#203 AC3), or null when it has none: not
 * planned, already made, or more than 30 s away.
 */
export function subBand(sub: PlannedSub, periodElapsedMs: number): SubBand | null {
  if (!isPlanned(sub) || sub.done) return null;
  const toGo = sub.atMs - periodElapsedMs;
  if (toGo > SUB_WARNING_LEAD_MS) return null;
  if (toGo > SUB_AMBER_MS) return 'green';
  if (toGo > 0) return 'amber';
  return 'red';
}

/**
 * The words beside the colour, so colour is never the only signal (AC3):
 * "in 0:24" while it counts down, "late 0:40" from the due time. The
 * countdown rounds up, so it reads "in 0:01" until the moment itself.
 */
export function subCountdown(sub: PlannedSub, periodElapsedMs: number): string {
  const toGo = sub.atMs - periodElapsedMs;
  return toGo > 0
    ? `in ${formatSubTime(Math.ceil(toGo / 1000) * 1000)}`
    : `late ${formatSubTime(-toGo)}`;
}

// ---------------------------------------------------------------------------
// "Not now" (C5): no second nag
// ---------------------------------------------------------------------------

/**
 * The moments the coach has said "Not now" to, in one period of one match.
 *
 * Screen state, never saved and never a record. Held by the shell, as the
 * buzz log is, so leaving the clock and coming back does not raise the
 * prompt again. A moment is the player AND the time (`subMoment`), so a sub
 * moved to a new time is a new moment and prompts again when it comes.
 */
export interface NotNowLog {
  periodKey: string;
  moments: ReadonlySet<string>;
}

export const NO_NOT_NOW: NotNowLog = { periodKey: '', moments: new Set() };

function momentsFor(log: NotNowLog, periodKey: string): ReadonlySet<string> {
  return log.periodKey === periodKey ? log.moments : new Set();
}

export function isNotNow(log: NotNowLog, periodKey: string, sub: PlannedSub): boolean {
  return momentsFor(log, periodKey).has(subMoment(sub));
}

/** "Not now" on these subs: their prompt goes, and stays gone. */
export function notNow(log: NotNowLog, periodKey: string, subs: PlannedSub[]): NotNowLog {
  return { periodKey, moments: new Set([...momentsFor(log, periodKey), ...subs.map(subMoment)]) };
}

/** "Show the prompt again", from the sub's sheet. */
export function promptAgain(log: NotNowLog, periodKey: string, sub: PlannedSub): NotNowLog {
  const moments = new Set(momentsFor(log, periodKey));
  moments.delete(subMoment(sub));
  return { periodKey, moments };
}

// ---------------------------------------------------------------------------
// The prompts (AC3, C2)
// ---------------------------------------------------------------------------

/**
 * The prompts showing now, grouped: subs planned for the same time share one
 * panel (C2), earliest first. Every sub whose warning has started and that
 * the coach has not put off with "Not now".
 */
export function promptGroups(
  plan: PlannedSub[],
  periodElapsedMs: number,
  isPutOff: (sub: PlannedSub) => boolean
): PlannedSub[][] {
  const groups: PlannedSub[][] = [];
  for (const sub of warnedSubs(plan, periodElapsedMs)) {
    if (isPutOff(sub)) continue;
    const same = groups.find((g) => g[0].atMs === sub.atMs);
    if (same) same.push(sub);
    else groups.push([sub]);
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Who comes off
// ---------------------------------------------------------------------------

/** An outfield player on the pitch now, and their unbroken time on it. */
export interface OnPitch {
  playerId: UUID;
  currentStintMs: number;
}

/**
 * Who comes off for each sub still to be made, and whether the coach named
 * them or the app suggests them.
 *
 * Today's rule, per sub (`whoComesOff`): the coach's own pick while that
 * player is still on, otherwise whoever has been on longest without a break.
 * Applied to the list as a whole, so two subs at 6:15 do not both suggest
 * Ben: named picks are kept first, then each suggestion, in time order, is
 * taken from those not already coming off.
 */
export function offPicks(
  plan: PlannedSub[],
  outfieldOn: OnPitch[]
): Map<UUID, { offId: UUID; named: boolean }> {
  const waiting = plan
    .map((sub, order) => ({ sub, order }))
    .filter(({ sub }) => isPlanned(sub) && !sub.done)
    .sort((a, b) => a.sub.atMs - b.sub.atMs || a.order - b.order)
    .map(({ sub }) => sub);
  const picks = new Map<UUID, { offId: UUID; named: boolean }>();
  const taken = new Set<UUID>();
  for (const sub of waiting) {
    if (sub.forPlayerId && outfieldOn.some((p) => p.playerId === sub.forPlayerId)) {
      picks.set(sub.playerId, { offId: sub.forPlayerId, named: true });
      taken.add(sub.forPlayerId);
    }
  }
  for (const sub of waiting) {
    if (picks.has(sub.playerId)) continue;
    const free = outfieldOn.filter((p) => !taken.has(p.playerId));
    const off = whoComesOff({ ...sub, forPlayerId: null }, free.length > 0 ? free : outfieldOn);
    if (off === null) continue;
    picks.set(sub.playerId, { offId: off, named: false });
    taken.add(off);
  }
  return picks;
}

/**
 * Who a player came on for this period, read from the record: the stint
 * that ended by substitution in the same position at the moment theirs
 * began. Null if the record does not say.
 */
export function cameOnFor(
  appearances: readonly Pick<
    Appearance,
    'quarterId' | 'playerId' | 'positionId' | 'startElapsedMs' | 'endElapsedMs' | 'endReason'
  >[],
  quarterId: UUID,
  playerId: UUID
): UUID | null {
  const theirs = appearances
    .filter((a) => a.quarterId === quarterId && a.playerId === playerId)
    .sort((a, b) => a.startElapsedMs - b.startElapsedMs);
  const first = theirs[0];
  if (!first) return null;
  const off = appearances.find(
    (a) =>
      a.quarterId === quarterId &&
      a.endReason === 'substitution' &&
      a.positionId === first.positionId &&
      a.endElapsedMs === first.startElapsedMs &&
      a.playerId !== playerId
  );
  return off?.playerId ?? null;
}

// ---------------------------------------------------------------------------
// The list (AC1, C1, C5, C7, C9)
// ---------------------------------------------------------------------------

export interface SubListLine {
  playerId: UUID;
  atMs: number;
  /** "Ava on for Ben · 6:15", or "Ava on · 6:15 (who comes off: suggested Ben)". */
  text: string;
  /** Made: ticked and greyed, and not tappable. */
  done: boolean;
  /** The warning band, for the dot and the status colour. Null outside it. */
  band: SubBand | null;
  /** "in 0:24" or "late 0:40" inside the warning, else empty. */
  status: string;
}

export interface SubList {
  /** In time order, ties in plan order. */
  lines: SubListLine[];
  /** Bench players with no time this period, for "Not planned: Cal, Dee". */
  notPlanned: UUID[];
}

/** While a prompt shows, the list keeps only the next two subs (C1). */
export const LIST_WHILE_PROMPTING = 2;

/**
 * Everything the clock's list shows, worked out afresh on each paint.
 *
 * - One line per planned sub, in time order (AC1), times as "6:15" (C9).
 * - A sub made is ticked and greyed, with who actually came off.
 * - Bench players with no time are named once, under "Not planned" (AC1),
 *   and can be tapped to give them a time (C7). Anyone on the pitch now is
 *   not on the bench, so is left out.
 * - While a prompt is showing, only the next two subs still to make, so
 *   the pitch stays in reach (C1).
 */
export function subList(input: {
  plan: PlannedSub[];
  periodElapsedMs: number;
  prompting: boolean;
  nameOf: (id: UUID) => string;
  outfieldOn: OnPitch[];
  onPitchIds: ReadonlySet<UUID>;
  /** Who a player came on for, from the record (`cameOnFor`). */
  madeFor: (playerId: UUID) => UUID | null;
}): SubList {
  const { plan, periodElapsedMs, nameOf } = input;
  const picks = offPicks(plan, input.outfieldOn);
  const planned = plan
    .map((sub, order) => ({ sub, order }))
    .filter(({ sub }) => isPlanned(sub))
    .sort((a, b) => a.sub.atMs - b.sub.atMs || a.order - b.order)
    .map(({ sub }) => sub);

  let lines: SubListLine[] = planned.map((sub) => {
    const name = nameOf(sub.playerId);
    const at = formatSubTime(sub.atMs);
    if (sub.done) {
      const off = input.madeFor(sub.playerId);
      return {
        playerId: sub.playerId,
        atMs: sub.atMs,
        text: off ? `${name} on for ${nameOf(off)} · ${at}` : `${name} on · ${at}`,
        done: true,
        band: null,
        status: '',
      };
    }
    const pick = picks.get(sub.playerId);
    const text = pick?.named
      ? `${name} on for ${nameOf(pick.offId)} · ${at}`
      : pick
        ? `${name} on · ${at} (who comes off: suggested ${nameOf(pick.offId)})`
        : `${name} on · ${at}`;
    const band = subBand(sub, periodElapsedMs);
    return {
      playerId: sub.playerId,
      atMs: sub.atMs,
      text,
      done: false,
      band,
      status: band ? subCountdown(sub, periodElapsedMs) : '',
    };
  });

  if (input.prompting) {
    lines = lines.filter((l) => !l.done).slice(0, LIST_WHILE_PROMPTING);
    return { lines, notPlanned: [] };
  }

  const notPlanned = plan
    .filter((s) => !isPlanned(s) && !s.done && !input.onPitchIds.has(s.playerId))
    .map((s) => s.playerId);
  return { lines, notPlanned };
}

// ---------------------------------------------------------------------------
// Changing it during the quarter (AC2): the plan only, never the record
// ---------------------------------------------------------------------------

/** The sheet's step: ±30 s (#203 AC2). */
export const SHEET_STEP_MS = 30_000;

/**
 * Move a sub's time by the sheet's step. A sub with no time gets the
 * midpoint on its first "+" (the #62 rule the lineup uses), which is how
 * "Not planned: Fay" is given a time (C7). Unlike the lineup's stepper,
 * "−" never takes a sub out of the plan: only "Remove this sub" does (C6),
 * so the earliest a sub can be is 0:01.
 */
export function moveSubTime(
  plan: PlannedSub[],
  playerId: UUID,
  deltaMs: number,
  periodMs: number
): PlannedSub[] {
  const sub = plan.find((s) => s.playerId === playerId);
  if (!sub) return plan;
  if (!isPlanned(sub)) return deltaMs > 0 ? nudgeSubTime(plan, playerId, deltaMs, periodMs) : plan;
  return setSubTime(plan, playerId, Math.max(1_000, sub.atMs + deltaMs), periodMs);
}

/** "Remove this sub" (C6): no time, and back to the suggestion. No confirm: it changes only the plan. */
export function removeSub(plan: PlannedSub[], playerId: UUID): PlannedSub[] {
  return setSubFor(clearSubTime(plan, playerId), playerId, null);
}

// ---------------------------------------------------------------------------
// The collapsed list (#228, Dee's clutter fix 1)
// ---------------------------------------------------------------------------

/**
 * The clock's one-line plan: the next sub still to make that is not already
 * in a prompt, and how many more are still to make besides it ("+1 ▾"). The
 * prompt panel above is untouched; the full list opens from this line.
 */
export function nextSubLine(
  list: SubList,
  prompted: ReadonlySet<UUID>
): { line: SubListLine | null; more: number } {
  const pending = list.lines.filter((l) => !l.done && !prompted.has(l.playerId));
  return { line: pending[0] ?? null, more: Math.max(0, pending.length - 1) };
}
