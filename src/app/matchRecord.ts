/**
 * The core match record, read back — #196 (PO ruling `approve readiness`,
 * 18 Oct): the result, the structure the match was actually played in,
 * minutes by position, and goals whose time or scorer is not known.
 *
 * Pure TypeScript. Everything is folded from the record on each call and
 * nothing is stored (invariant 1): the result is never a field.
 *
 * - **Result** (AC1): W, D or L and a score, from goal and conceded events.
 * - **Time unknown** (AC2, ruling 7): counts in the score; in no per-period
 *   or per-time figure. A goal with no scorer counts in no child's figure.
 * - **Structure** (AC3, ruling 8): the clock's record or a noted correction;
 *   a match recorded before either reads as its planned structure.
 * - **Positions** (AC4, AC5): minutes per role where the interval carries
 *   one, per unit where it does not. A description: nothing ranks or flags a
 *   child by position (invariant 3, ADR-015).
 */

import type { UUID } from '../types/index';
import { UNIT_LABEL, type LedgerEvent, type LedgerInterval, type LedgerMatch } from './ledger';
import { isCounted } from './analysis';

export interface Score {
  us: number;
  them: number;
}

export type Result = 'W' | 'D' | 'L';

/** Events still standing: a withdrawal takes back the event it names. */
export function standingEvents(events: readonly LedgerEvent[] | undefined): LedgerEvent[] {
  const all = events ?? [];
  const withdrawn = new Set(all.filter((e) => e.kind === 'withdrawn' && e.refersTo).map((e) => e.refersTo));
  return all.filter((e) => e.kind !== 'withdrawn' && !withdrawn.has(e.id));
}

/** The score from standing goal and conceded events, time known or not. */
export function scoreFromEvents(events: readonly LedgerEvent[] | undefined): Score {
  const standing = standingEvents(events);
  return {
    us: standing.filter((e) => e.kind === 'goal').length,
    them: standing.filter((e) => e.kind === 'conceded').length,
  };
}

export function resultOf(score: Score): Result {
  return score.us > score.them ? 'W' : score.us < score.them ? 'L' : 'D';
}

/** "W 4 – 1". */
export function resultLabel(score: Score): string {
  return `${resultOf(score)} ${score.us} – ${score.them}`;
}

/** Only events whose time is known: what a per-period or per-time figure may use (AC2). */
export function timedEvents(events: readonly LedgerEvent[]): LedgerEvent[] {
  return events.filter((e) => e.timeKnown !== false);
}

/**
 * A played match's score: the phone's own events, plus what the record holds
 * that the phone does not (a goal added from the record with time unknown).
 */
export function scoreWithRecord(
  phone: Score,
  phoneEventIds: ReadonlySet<UUID>,
  recorded: Pick<LedgerMatch, 'events'> | undefined
): Score {
  if (!recorded?.events) return phone;
  const extra = standingEvents(recorded.events).filter((e) => !phoneEventIds.has(e.id));
  // A withdrawal recorded only in the record takes back a phone event too.
  const phoneWithdrawn = (recorded.events ?? []).filter(
    (e) => e.kind === 'withdrawn' && !phoneEventIds.has(e.id) && e.refersTo !== null && phoneEventIds.has(e.refersTo)
  );
  const takenBack = (kind: string) =>
    phoneWithdrawn.filter((w) => recorded.events?.find((e) => e.id === w.refersTo)?.kind === kind).length;
  return {
    us: phone.us + extra.filter((e) => e.kind === 'goal').length - takenBack('goal'),
    them: phone.them + extra.filter((e) => e.kind === 'conceded').length - takenBack('conceded'),
  };
}

// --- structure (AC3) ---------------------------------------------------------

export interface Structure {
  periodCount: number;
  periodMs: number[];
  shape: string | null;
  onField: number | null;
  /** Where it comes from: the clock, a noted correction, or the plan (a match recorded before #196). */
  source: 'clock' | 'corrected' | 'planned';
  note: string | null;
}

const MIN = 60_000;

/** How the match was played, or as planned when nothing says otherwise. */
export function structureOf(m: Pick<LedgerMatch, 'structure' | 'periodCount' | 'totalMinutes'>): Structure {
  if (m.structure) {
    return {
      periodCount: m.structure.periodCount,
      periodMs: m.structure.periodMs,
      shape: m.structure.shape,
      onField: m.structure.onField,
      source: m.structure.note === null ? 'clock' : 'corrected',
      note: m.structure.note,
    };
  }
  const count = Math.max(0, m.periodCount);
  const each = count > 0 ? Math.round((m.totalMinutes * MIN) / count) : 0;
  return { periodCount: count, periodMs: Array(count).fill(each), shape: null, onField: null, source: 'planned', note: null };
}

const clock = (ms: number) => {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** "4 quarters of 12:30", "2 halves of 20:00", or "3 periods: 20:00, 20:00, 10:00". */
export function structureLabel(st: Pick<Structure, 'periodCount' | 'periodMs'>): string {
  if (st.periodCount === 0) return 'Not known';
  const noun = st.periodCount === 4 ? 'quarters' : st.periodCount === 2 ? 'halves' : 'periods';
  const one = st.periodCount === 1 ? 'period' : noun;
  const same = st.periodMs.every((p) => p === st.periodMs[0]);
  if (same && st.periodMs.length === st.periodCount) return `${st.periodCount} ${one} of ${clock(st.periodMs[0])}`;
  return `${st.periodCount} ${one}: ${st.periodMs.map(clock).join(', ')}`;
}

// --- minutes in positions (AC4) ------------------------------------------------

export interface PositionMinutes {
  /** The role code ('RB'), or the unit ('DEF') for an interval recorded without one. */
  label: string;
  ms: number;
}

/**
 * One child's minutes per position over these intervals, in the order first
 * played. Role where recorded, unit where not; time with neither is
 * "Unplaced". The parts add up to the child's total.
 */
export function positionMinutes(intervals: readonly LedgerInterval[], playerId: UUID): PositionMinutes[] {
  const out = new Map<string, number>();
  for (const i of intervals) {
    if (i.playerId !== playerId) continue;
    const label = i.role ?? (i.unit ? UNIT_LABEL[i.unit] : i.kind === 'goalkeeper' ? 'GK' : 'Unplaced');
    out.set(label, (out.get(label) ?? 0) + Math.max(0, i.endMs - i.startMs));
  }
  return [...out].map(([label, ms]) => ({ label, ms }));
}

/**
 * Period lengths typed by the coach, in minutes: "20 20 10 10", "12.5, 12.5".
 * Null unless every one is a length above zero and at most 90 minutes.
 */
export function parsePeriodLengths(text: string): number[] | null {
  const parts = text
    .split(/[\s,;]+/)
    .map((p) => p.trim())
    .filter((p) => p !== '');
  if (parts.length === 0 || parts.length > 8) return null;
  const out: number[] = [];
  for (const p of parts) {
    const n = Number(p);
    if (!Number.isFinite(n) || n <= 0 || n > 90) return null;
    out.push(Math.round(n * MIN));
  }
  return out;
}

/**
 * A child's season by position (#196 AC4, the child page): every counted
 * match (closed, not left out), roles where recorded, units where not.
 */
export function seasonPositionMinutes(
  matches: readonly Pick<LedgerMatch, 'status' | 'excluded' | 'intervals'>[],
  playerId: UUID
): PositionMinutes[] {
  const counted = matches.filter(isCounted);
  const out = new Map<string, number>();
  for (const m of counted) for (const p of positionMinutes(m.intervals, playerId)) out.set(p.label, (out.get(p.label) ?? 0) + p.ms);
  return [...out].map(([label, ms]) => ({ label, ms }));
}

/** "RB 20 · LW 15 · GK 12 min". */
export function positionLine(parts: readonly PositionMinutes[]): string {
  if (parts.length === 0) return '';
  return `${parts.map((p) => `${p.label} ${Math.round(p.ms / MIN)}`).join(' · ')} min`;
}

/**
 * The child page's position line, from the ledger the page is showing (#196
 * AC4). With reconstructed matches left out (#199 AC4), it is given the
 * filtered ledger, so this figure follows the toggle like every other.
 */
export function childPositionLine(shown: { matches: readonly LedgerMatch[] } | null, playerId: UUID): string {
  return positionLine(seasonPositionMinutes(shown?.matches ?? [], playerId));
}
