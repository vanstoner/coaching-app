/**
 * The match report of a match in the record reads the record — #244
 * (ADR-022 D1, invariant 1).
 *
 * The report folds the phone's copy of the match (`matchReport`). A goal
 * taken back, a goal added with time unknown, or a corrected structure is
 * written to the record only, so the report's goals, assists, keepers,
 * tallies and "how it was played" drifted from the record page one tap away.
 * Per ADR-022 D1 the screen reads the record; the engine is not reshaped.
 *
 * Pure TypeScript. Everything is folded on each call; nothing is stored.
 *
 * - **Events**: the record's, in its order, plus any the phone holds that
 *   the record has not caught up with yet (every save records them, so once
 *   saved the two are the same set). A match not in the record reads the
 *   phone's events alone, as before (AC4).
 * - **Goals**: scorers from goals whose time is known; a goal with time
 *   unknown is listed on its own line, as the record page lists it.
 * - **Structure**: `structureLabel` of the record's structure, as the record
 *   page shows it, or the planned "50 min, quarters" when not in the record.
 * - **Minutes** are untouched: they already agree (#244, Quinn's run).
 */

import type { MatchEngine, MatchState } from "../engine/MatchEngine";
import type {
  Format,
  MatchEvent,
  MatchEventKind,
  Player,
  UUID,
} from "../types/index";
import type { LedgerMatch } from "./ledger";
import { matchReport, type MatchReport } from "./analysis";
import { standingEvents } from "./matchEvents";
import { structureLabel, structureOf } from "./matchRecord";
import { periodNounPlural } from "./matchClock";

export interface TimeUnknownGoal {
  id: UUID;
  kind: "goal" | "conceded";
  playerId: UUID | null;
}

export interface RecordedReport {
  /** Every figure folded from `events`; minutes from the engine, as before. */
  report: MatchReport;
  /** The events the report reads: the record's, else the phone's. */
  events: MatchEvent[];
  /** Each scorer once, from goals whose time is known, most goals first. */
  scorers: MatchReport["scorers"];
  /** Goals and goals against the record holds with time unknown, still standing. */
  timeUnknown: TimeUnknownGoal[];
  /** "2 halves of 25:00" from the record, or "50 min, quarters" when not in it. */
  structure: string;
}

/**
 * The events a report of this match reads: the record's in its order, the
 * phone's own copy of each event it also holds, then any phone event the
 * record does not hold yet. Without a record, the phone's events.
 */
export function eventsWithRecord(
  phone: readonly MatchEvent[] | undefined,
  recorded: Pick<LedgerMatch, "id" | "events"> | undefined,
): MatchEvent[] {
  const own = phone ?? [];
  if (!recorded) return [...own];
  const byId = new Map(own.map((e) => [e.id, e]));
  const fromRecord = (recorded.events ?? []).map(
    (e): MatchEvent =>
      byId.get(e.id) ?? {
        id: e.id,
        matchId: recorded.id,
        // The record keeps the period's number, not the phone's quarter id.
        quarterId: "" as UUID,
        // A later build's kind is carried; the folds count only kinds they know.
        kind: e.kind as MatchEventKind,
        playerId: e.playerId,
        atElapsedMs: e.atMs,
        recordedAt: "",
        refersTo: e.refersTo,
        note: e.note,
      },
  );
  const inRecord = new Set(fromRecord.map((e) => e.id));
  return [...fromRecord, ...own.filter((e) => !inRecord.has(e.id))];
}

/** The match report, read from the record when the match is in it (#244). */
export function recordedReport(
  engine: MatchEngine,
  state: MatchState,
  players: Player[],
  format: Format | null | undefined,
  recorded: LedgerMatch | undefined,
): RecordedReport {
  const events = eventsWithRecord(state.events, recorded);
  const report = matchReport(engine, { ...state, events }, players, format);
  const unknownIds = new Set(
    (recorded?.events ?? [])
      .filter((e) => e.timeKnown === false)
      .map((e) => e.id),
  );
  const timeUnknown = standingEvents(events)
    .filter(
      (e) =>
        unknownIds.has(e.id) && (e.kind === "goal" || e.kind === "conceded"),
    )
    .map((e) => ({
      id: e.id,
      kind: e.kind as "goal" | "conceded",
      playerId: e.playerId,
    }));
  const unknownBy = new Map<UUID, number>();
  for (const g of timeUnknown) {
    if (g.kind === "goal" && g.playerId)
      unknownBy.set(g.playerId, (unknownBy.get(g.playerId) ?? 0) + 1);
  }
  const scorers = report.scorers
    .map((s) => ({ ...s, goals: s.goals - (unknownBy.get(s.playerId) ?? 0) }))
    .filter((s) => s.goals > 0)
    .sort((a, b) => b.goals - a.goals || a.name.localeCompare(b.name));
  const structure = recorded
    ? structureLabel(structureOf(recorded))
    : `${report.totalMinutes} min, ${periodNounPlural(report.periodCount).toLowerCase()}`;
  return { report, events, scorers, timeUnknown, structure };
}
