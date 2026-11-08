/**
 * #283 (Rob, 7 Nov: "I keep forgetting to start the quarter after the team
 * talk"): the team talk between periods, counted down on the Lineup, and the
 * late Start's "from when it was due".
 *
 * Pure TypeScript. The due moment is the previous period's `endedAt` plus the
 * talk's length, worked out on every paint from that anchor (invariant 2); a
 * timer only asks for a repaint. Nothing here is stored in the record: only
 * the coach's Start writes a start, and the clock never starts by itself.
 */

import type { Quarter } from '../types/index';

export interface TalkLengths {
  /** Between quarters (and between thirds). */
  betweenMs: number;
  /** At half-time. */
  halfMs: number;
}

export const TALK_DEFAULT: TalkLengths = { betweenMs: 3 * 60_000, halfMs: 5 * 60_000 };
export const TALK_MIN_MS = 60_000;
export const TALK_MAX_MS = 15 * 60_000;
export const TALK_STEP_MS = 30_000;
/** On this phone, per team, beside the other view choices; never the record. */
export const TEAM_TALK_KEY = 'coaching-app/team-talk/v1';

const clamp = (ms: number) =>
  Math.min(TALK_MAX_MS, Math.max(TALK_MIN_MS, Math.round(ms / TALK_STEP_MS) * TALK_STEP_MS));

export function parseTalkLengths(raw: string | null): TalkLengths {
  try {
    const v = raw ? (JSON.parse(raw) as Partial<TalkLengths>) : {};
    return {
      betweenMs: typeof v.betweenMs === 'number' && Number.isFinite(v.betweenMs) ? clamp(v.betweenMs) : TALK_DEFAULT.betweenMs,
      halfMs: typeof v.halfMs === 'number' && Number.isFinite(v.halfMs) ? clamp(v.halfMs) : TALK_DEFAULT.halfMs,
    };
  } catch {
    return TALK_DEFAULT;
  }
}

/** One Stepper tap: 30 s, inside 1:00 to 15:00. */
export function stepTalk(ms: number, direction: 1 | -1): number {
  return clamp(ms + direction * TALK_STEP_MS);
}

export interface TeamTalk {
  /** The period to start next (1-based), e.g. 2 for Q2. */
  nextIndex: number;
  halfTime: boolean;
  lengthMs: number;
  endedAtMs: number;
  dueAtMs: number;
}

/**
 * The break the match is in, or null: none before kick-off, while a period
 * runs, or after the last. In quarters the talk after Q2 is half-time; in
 * halves the only talk is half-time.
 */
export function teamTalkOf(quarters: readonly Quarter[], quarterCount: number, lengths: TalkLengths): TeamTalk | null {
  if (quarters.some((q) => q.status === 'running')) return null;
  const ended = quarters.filter((q) => q.status === 'ended').sort((a, b) => b.index - a.index)[0];
  if (!ended || ended.index >= quarterCount) return null;
  const next = quarters.find((q) => q.index === ended.index + 1);
  if (!next || next.status !== 'pending') return null;
  const endedAtMs = ended.endedAt ? Date.parse(ended.endedAt) : NaN;
  if (!Number.isFinite(endedAtMs)) return null;
  const halfTime = (quarterCount === 2 && ended.index === 1) || (quarterCount === 4 && ended.index === 2);
  const lengthMs = halfTime ? lengths.halfMs : lengths.betweenMs;
  return { nextIndex: next.index, halfTime, lengthMs, endedAtMs, dueAtMs: endedAtMs + lengthMs };
}

/**
 * Start's question: "Start Q2 from when it was due?" only when Start comes at
 * least a second after the due moment and less than one period after it
 * (C7). Earlier, or that late, Start just starts now.
 */
export function asksFromDue(nowMs: number, dueAtMs: number, periodMs: number): boolean {
  const late = nowMs - dueAtMs;
  return late >= 1000 && late < periodMs;
}

/**
 * C13: the lengths a break uses are the ones set when it began; a change
 * made during it takes effect from the next break. `held` is what this
 * screen last pinned; `breakKey` names the break (the period just ended),
 * null outside one. Kept in memory only: lengths are settings, never record.
 */
export function lengthsForBreak(
  held: { breakKey: string; lengths: TalkLengths } | null,
  breakKey: string | null,
  current: TalkLengths
): { breakKey: string; lengths: TalkLengths } | null {
  if (breakKey === null) return null;
  return held && held.breakKey === breakKey ? held : { breakKey, lengths: current };
}
