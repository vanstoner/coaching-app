/**
 * Matches the minutes record holds but this phone has no fixture for — #195
 * AC1 (PO: `approve played`, `approve tag`, 2026-10-17).
 *
 * A minutes file brings matches into the record and never into the fixtures,
 * so Played could not see a season imported from paper. These are listed in
 * Played beside the phone's own, and open as a read-only page folded from the
 * record. Nothing here is stored: every figure is folded from the intervals
 * and events each time (invariant 1).
 *
 * Such a match was entered after the fact by definition — it was never played
 * on this phone — so its card carries the reconstructed tag. The full
 * pristine / live-unsigned / reconstructed view is #199.
 *
 * Its score is folded from goal and conceded events. A match with no events
 * at all (3 Oct: goals known from the report, not when they came) shows "score
 * not recorded", never a 0–0 that did not happen.
 */

import type { Competition, UUID } from '../types/index';
import { isExcluded, type Ledger, type LedgerMatch } from './ledger';
import {
  positionMinutes,
  resultOf,
  scoreFromEvents,
  standingEvents,
  structureOf,
  type PositionMinutes,
  type Result,
  type Structure,
} from './matchRecord';
import { matchTalliesWithGoals, type TallyLine } from './tallies';

export interface RecordOnlyMatch {
  id: UUID;
  kickoffAt: string | null;
  opponent: string | null;
  competition: Competition | null;
  totalMinutes: number;
  periodCount: number;
  /** Null when the record holds no events for it: the score is not known. */
  score: { us: number; them: number } | null;
  /** The coach's note when it is left out of the figures (ADR-020); null when it counts. */
  leftOut: string | null;
  /** Archived by the coach on the phone that played it (#76), carried by its `fixture` record (#195). */
  archived: boolean;
}

function scoreOf(m: LedgerMatch): RecordOnlyMatch['score'] {
  if ((m.events ?? []).length === 0) return null;
  return scoreFromEvents(m.events);
}

const kickoffTime = (m: { kickoffAt: string | null }): number | null => {
  const t = m.kickoffAt ? Date.parse(m.kickoffAt) : NaN;
  return Number.isFinite(t) ? t : null;
};

/**
 * Every completed match in the record with no fixture among `fixtureIds`,
 * most recent first, undated last. The record holds no clock time for a
 * period, so the date is the planned kick-off; Played merges these with this
 * phone's by the date each card shows (`playedAt`, #251).
 */
export function recordOnlyMatches(ledger: Ledger | null, fixtureIds: ReadonlySet<UUID>): RecordOnlyMatch[] {
  if (!ledger) return [];
  const archived = new Set((ledger.fixtures ?? []).filter((f) => f.archived).map((f) => f.id));
  return ledger.matches
    .filter((m) => m.status === 'completed' && !fixtureIds.has(m.id))
    .map((m) => ({
      id: m.id,
      kickoffAt: m.kickoffAt,
      opponent: m.opponent,
      competition: m.competition,
      totalMinutes: m.totalMinutes,
      periodCount: m.periodCount,
      score: scoreOf(m),
      leftOut: isExcluded(m) ? (m.excluded?.note ?? '') : null,
      archived: archived.has(m.id),
    }))
    .sort((a, b) => {
      const ta = kickoffTime(a);
      const tb = kickoffTime(b);
      if (ta === null && tb === null) return 0;
      if (ta === null) return 1;
      if (tb === null) return -1;
      return tb - ta;
    });
}

/** "W 4 – 1" (#196 AC1), or "Score not recorded". */
export function scoreLabel(score: RecordOnlyMatch['score']): string {
  return score ? `${resultOf(score)} ${score.us} – ${score.them}` : 'Score not recorded';
}

/** One goal for or against on the page. */
export interface PageGoal {
  id: UUID;
  /** The scorer's name; "Scorer unknown" for a goal with none; empty for a goal against. */
  name: string;
  period: number;
  atMs: number;
  /** False for a goal entered with time unknown (#196 AC2). */
  timeKnown: boolean;
  /** Where it is known from, for a goal entered from the record. */
  note: string | null;
}

export interface RecordMatchPage {
  match: RecordOnlyMatch;
  /**
   * Each child who played, total and the part in goal, in the record's squad
   * order: the tie order the screen's sort keeps (#208).
   */
  minutes: { playerId: UUID; name: string; totalMs: number; goalMs: number }[];
  /** Our goals, in match order, time unknown last (by name); a goal with no scorer reads "Scorer unknown". */
  goals: PageGoal[];
  /** Goals against, folded from the events. */
  conceded: number;
  /** Each goal against, for taking one back. */
  concededGoals: PageGoal[];
  /** W, D or L; null when the score is not recorded (#196 AC1). */
  result: Result | null;
  /** How it was played (#196 AC3). */
  structure: Structure;
  /** Each child's minutes per position (#196 AC4), by player id. */
  positions: Map<UUID, PositionMinutes[]>;
  /** Awards standing for this match, in the award types' order (#197). One match: open to the coach (ADR-017 §3). */
  awards: { awardTypeId: UUID; award: string; playerId: UUID; name: string; note: string | null }[];
  /** Award types that can be given now: not retired (#197 AC1). */
  awardTypes: { id: UUID; name: string }[];
  /** The coach's tallies, apart from the core (#198 AC3). */
  tallies: TallyLine[];
}

/** The read-only page for one match in the record. Null if the record has no such match. */
export function recordMatchPage(ledger: Ledger | null, matchId: UUID): RecordMatchPage | null {
  const m = ledger?.matches.find((x) => x.id === matchId);
  if (!ledger || !m) return null;
  const nameOf = new Map(ledger.players.map((p) => [p.id, p.firstName]));
  const name = (id: UUID | null) => (id ? (nameOf.get(id) ?? 'Unknown') : 'Unknown');
  const at = new Map(ledger.players.map((p, i) => [p.id, i]));
  const squadAt = (id: UUID) => at.get(id) ?? ledger.players.length;

  const rows = new Map<UUID, { totalMs: number; goalMs: number }>();
  for (const i of m.intervals) {
    const ms = Math.max(0, i.endMs - i.startMs);
    const row = rows.get(i.playerId) ?? { totalMs: 0, goalMs: 0 };
    row.totalMs += ms;
    if (i.kind === 'goalkeeper') row.goalMs += ms;
    rows.set(i.playerId, row);
  }
  const events = standingEvents(m.events);
  const [match] = recordOnlyMatches({ ...ledger, matches: [m] }, new Set());
  const page = (e: (typeof events)[number], who: string): PageGoal => ({
    id: e.id,
    name: who,
    period: e.period,
    atMs: e.atMs,
    timeKnown: e.timeKnown !== false,
    note: e.timeKnown === false ? e.note : null,
  });
  // Known times in match order; time unknown after them, by scorer's name.
  const order = (a: (typeof events)[number], b: (typeof events)[number]) =>
    (a.timeKnown === false ? 1 : 0) - (b.timeKnown === false ? 1 : 0) ||
    (a.timeKnown === false
      ? (a.playerId ? name(a.playerId) : '~').localeCompare(b.playerId ? name(b.playerId) : '~')
      : a.period - b.period || a.atMs - b.atMs);
  const goals = events.filter((e) => e.kind === 'goal').sort(order);
  const against = events.filter((e) => e.kind === 'conceded').sort(order);
  return {
    match,
    minutes: [...rows]
      .map(([playerId, r]) => ({ playerId, name: name(playerId), ...r }))
      .sort((a, b) => squadAt(a.playerId) - squadAt(b.playerId)),
    goals: goals.map((e) => page(e, e.playerId ? name(e.playerId) : 'Scorer unknown')),
    conceded: against.length,
    concededGoals: against.map((e) => page(e, '')),
    result: match.score ? resultOf(match.score) : null,
    structure: structureOf(m),
    positions: new Map([...rows.keys()].map((id) => [id, positionMinutes(m.intervals, id)])),
    awards: (m.awards ?? [])
      .map((a) => ({
        awardTypeId: a.awardTypeId,
        award: ledger.awardTypes.find((t) => t.id === a.awardTypeId)?.name ?? 'Award',
        playerId: a.playerId,
        name: name(a.playerId),
        note: a.note,
      }))
      .sort(
        (a, b) =>
          ledger.awardTypes.findIndex((t) => t.id === a.awardTypeId) -
            ledger.awardTypes.findIndex((t) => t.id === b.awardTypeId) || a.name.localeCompare(b.name)
      ),
    awardTypes: ledger.awardTypes.filter((t) => t.active).map((t) => ({ id: t.id, name: t.name })),
    tallies: matchTalliesWithGoals(m.events, ledger.eventTypes, (id) => name(id)),
  };
}
