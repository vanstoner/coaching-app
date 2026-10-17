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
import { isExcluded, type Ledger, type LedgerEvent, type LedgerMatch } from './ledger';

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
}

/** Events still standing: a withdrawal takes back the event it names. */
function standing(events: readonly LedgerEvent[] | undefined): LedgerEvent[] {
  const all = events ?? [];
  const withdrawn = new Set(all.filter((e) => e.kind === 'withdrawn' && e.refersTo).map((e) => e.refersTo));
  return all.filter((e) => e.kind !== 'withdrawn' && !withdrawn.has(e.id));
}

function scoreOf(m: LedgerMatch): RecordOnlyMatch['score'] {
  if ((m.events ?? []).length === 0) return null;
  const events = standing(m.events);
  return {
    us: events.filter((e) => e.kind === 'goal').length,
    them: events.filter((e) => e.kind === 'conceded').length,
  };
}

const kickoffTime = (m: { kickoffAt: string | null }): number | null => {
  const t = m.kickoffAt ? Date.parse(m.kickoffAt) : NaN;
  return Number.isFinite(t) ? t : null;
};

/**
 * Every completed match in the record with no fixture among `fixtureIds`,
 * most recent first, undated last — the order Played uses (`fixtureList`).
 */
export function recordOnlyMatches(ledger: Ledger | null, fixtureIds: ReadonlySet<UUID>): RecordOnlyMatch[] {
  if (!ledger) return [];
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

/** "4 – 1", or "Score not recorded". */
export function scoreLabel(score: RecordOnlyMatch['score']): string {
  return score ? `${score.us} – ${score.them}` : 'Score not recorded';
}

export interface RecordMatchPage {
  match: RecordOnlyMatch;
  /**
   * Each child who played, total and the part in goal, in the record's squad
   * order: the tie order the screen's sort keeps (#208).
   */
  minutes: { playerId: UUID; name: string; totalMs: number; goalMs: number }[];
  /** Our goals, in match order; a goal with no scorer reads "Unknown". */
  goals: { name: string; period: number; atMs: number }[];
  /** Goals against, folded from the events. */
  conceded: number;
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
  const events = standing(m.events);
  const [match] = recordOnlyMatches({ ...ledger, matches: [m] }, new Set());
  return {
    match,
    minutes: [...rows]
      .map(([playerId, r]) => ({ playerId, name: name(playerId), ...r }))
      .sort((a, b) => squadAt(a.playerId) - squadAt(b.playerId)),
    goals: events
      .filter((e) => e.kind === 'goal')
      .sort((a, b) => a.atMs - b.atMs)
      .map((e) => ({ name: name(e.playerId), period: e.period, atMs: e.atMs })),
    conceded: events.filter((e) => e.kind === 'conceded').length,
  };
}
