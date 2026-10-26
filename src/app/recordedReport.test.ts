/**
 * The match report of a match in the record reads the record — #244
 * (Bea's criteria, approved by Rob 26 Oct; ADR-022 D1, invariant 1).
 *
 * Quinn's scenario, played through the real engine, recorded through
 * `recordMatches`, then corrected in the record with `withdrawRecordEvent`,
 * `addUnknownTimeEvent` and `correctStructure`. The report's goals, assists,
 * conceded, tallies and structure must equal the record page's (AC6).
 * Made-up first names only (invariant 4).
 */

import { describe, expect, it } from "vitest";
import { MatchEngine, type MatchState } from "../engine/MatchEngine";
import { uuid, type MatchEvent, type Player, type UUID } from "../types/index";
import {
  addUnknownTimeEvent,
  correctStructure,
  emptyLedger,
  recordMatches,
  withdrawRecordEvent,
  type Ledger,
} from "./ledger";
import { matchReport } from "./analysis";
import { standingEvents } from "./matchEvents";
import { structureLabel } from "./matchRecord";
import {
  eventsWithRecord,
  recordedReport,
  type RecordedReport,
} from "./recordedReport";
import { recordMatchPage } from "./recordOnly";
import { makeFormat } from "./shapes";
import { makePlayer } from "./squad";
import { matchTalliesWithGoals, tallyLineText } from "./tallies";
import { sheetFromSelection, toTeamSheet } from "./teamSheet";

const MIN = 60_000;
const NOW = new Date("2026-10-26T12:00:00Z");
const squadId = uuid();
const names = ["Kit", "Eve", "Ben", "Cal", "Dot", "Fay", "Gus", "Hob", "Ira"];
const players: Player[] = names.map((n) => makePlayer(squadId, n));
const ids = players.map((p) => p.id);
const [KEEPER, EVE, BEN, CAL] = ids;
const format = makeFormat("2-3-1");
const nameOf = (id: UUID) =>
  players.find((p) => p.id === id)?.firstName ?? "Unknown";

/**
 * 50 minutes in quarters. Q1: Eve scores, Cal assists, a goal conceded, a
 * tackle by Ben. Q2: Eve scores again, Ben assists. Returns the goal and
 * conceded ids the record will take back.
 */
function quinnsMatch() {
  let nowMs = Date.parse("2026-10-24T09:00:00Z");
  const engine = new MatchEngine({ nowFn: () => new Date(nowMs) });
  const state = engine.createMatch(squadId, format.id, {
    totalMinutes: 50,
    quarterCount: 4,
  });
  state.match.kickoffAt = "2026-10-24T09:00:00Z";
  state.match.opponent = "Mock Rovers";
  for (const id of ids) engine.setAvailability(state, id, "available");
  let firstGoal = "" as UUID;
  let conceded = "" as UUID;
  for (const q of state.quarters) {
    engine.startQuarter(
      state,
      q,
      toTeamSheet(sheetFromSelection(ids.slice(0, 7), KEEPER, format)),
      format,
    );
    nowMs += 6 * MIN;
    if (q.index === 1) {
      firstGoal = engine.recordEvent(state, q, "goal", EVE).id;
      engine.recordAssist(state, firstGoal, CAL);
      conceded = engine.recordEvent(state, q, "conceded", KEEPER).id;
      engine.recordEvent(state, q, "tackle", BEN);
    }
    if (q.index === 2) {
      const second = engine.recordEvent(state, q, "goal", EVE).id;
      engine.recordAssist(state, second, BEN);
    }
    nowMs += 6.5 * MIN;
    engine.endQuarter(state, q);
  }
  engine.completeMatch(state);
  return { engine, state, firstGoal, conceded };
}

const record = (ledger: Ledger, state: MatchState) =>
  recordMatches(ledger, [{ ...state, format }], players, "Test FC", NOW);

const ok = (
  r: { ok: true; ledger: Ledger } | { ok: false; reason: string },
): Ledger => {
  if (!r.ok) throw new Error(r.reason);
  return r.ledger;
};

/** Quinn's three corrections, each made in the record only. */
function corrected() {
  const m = quinnsMatch();
  const id = m.state.match.id;
  let ledger = record(emptyLedger(squadId, "Test FC", NOW), m.state);
  ledger = ok(
    withdrawRecordEvent(
      ledger,
      id,
      m.firstGoal,
      "Ref gave it as an own goal",
      NOW,
    ),
  );
  ledger = ok(
    withdrawRecordEvent(ledger, id, m.conceded, "Disallowed, offside", NOW),
  );
  ledger = ok(
    addUnknownTimeEvent(ledger, id, "goal", BEN, "From the league report", NOW),
  );
  ledger = ok(
    correctStructure(
      ledger,
      id,
      [25 * MIN, 25 * MIN],
      "Played in halves after all",
      NOW,
    ),
  );
  // The phone saves again afterwards, as it does on every change: nothing it
  // holds may undo a correction.
  ledger = record(ledger, m.state);
  return { ...m, ledger, recorded: ledger.matches.find((x) => x.id === id) };
}

/** The Goals list as lines a reader sees: "Eve 1", "Ben 1 time unknown". */
const goalLines = (r: RecordedReport) =>
  [
    ...r.scorers.flatMap((s) => Array<string>(s.goals).fill(s.name)),
    ...r.timeUnknown
      .filter((g) => g.kind === "goal")
      .map(
        (g) => `${g.playerId ? nameOf(g.playerId) : "Unknown"} time unknown`,
      ),
  ].sort();

describe("the report reads the record: Quinn's scenario (#244 AC1–AC3, AC6)", () => {
  it("AC1: Eve 1 goal, Ben 1 goal with time unknown, score 2–0", () => {
    const { engine, state, recorded } = corrected();
    const r = recordedReport(engine, state, players, format, recorded);
    expect(r.scorers.map((s) => [s.name, s.goals])).toEqual([["Eve", 1]]);
    expect(
      r.timeUnknown.map((g) => [g.kind, g.playerId && nameOf(g.playerId)]),
    ).toEqual([["goal", "Ben"]]);
    expect(r.report.score).toEqual({ us: 2, them: 0 });
  });

  it("the phone's own copy still says Eve 2 and 1 conceded: why the report must not read it", () => {
    const { engine, state } = corrected();
    const phone = matchReport(engine, state, players, format);
    expect(phone.scorers.map((s) => [s.name, s.goals])).toEqual([["Eve", 2]]);
    expect(phone.conceded).toBe(1);
  });

  it("AC2: an assist whose goal was taken back is not shown; the other stands", () => {
    const { engine, state, recorded } = corrected();
    const r = recordedReport(engine, state, players, format, recorded);
    const assists = r.report.play
      .filter((p) => p.assists > 0)
      .map((p) => [p.name, p.assists]);
    expect(assists).toEqual([["Ben", 1]]);
  });

  it("AC2: the conceded line and the keeper’s line follow the record", () => {
    const { engine, state, recorded } = corrected();
    const r = recordedReport(engine, state, players, format, recorded);
    expect(r.report.conceded).toBe(0);
    expect(r.report.keepers.filter((k) => k.conceded > 0)).toEqual([]);
  });

  it('AC3: how it was played reads "2 halves of 25:00", not "50 min, quarters"', () => {
    const { engine, state, recorded } = corrected();
    expect(
      recordedReport(engine, state, players, format, recorded).structure,
    ).toBe("2 halves of 25:00");
  });

  it("AC6: goals, assists, conceded, tallies and structure equal the record page’s", () => {
    const { engine, state, ledger, recorded } = corrected();
    const r = recordedReport(engine, state, players, format, recorded);
    const page = recordMatchPage(ledger, state.match.id);
    if (!page || !recorded) throw new Error("not in the record");

    expect(goalLines(r)).toEqual(
      page.goals
        .map((g) => (g.timeKnown ? g.name : `${g.name} time unknown`))
        .sort(),
    );
    expect(r.report.score).toEqual(page.match.score);
    expect(r.report.conceded).toBe(page.conceded);
    expect(r.timeUnknown.filter((g) => g.kind === "conceded").length).toBe(
      page.concededGoals.filter((g) => !g.timeKnown).length,
    );
    // The record page shows no assists: they are folded from the record's events.
    const recordAssists = standingEvents(r.events as MatchEvent[]).filter(
      (e) => e.kind === "assist",
    );
    expect(r.report.play.reduce((n, p) => n + p.assists, 0)).toBe(
      recordAssists.length,
    );
    expect(
      matchTalliesWithGoals(r.events, ledger.eventTypes, nameOf).map(
        tallyLineText,
      ),
    ).toEqual(page.tallies.map(tallyLineText));
    expect(r.structure).toBe(structureLabel(page.structure));
  });

  it("AC5: minutes are unchanged by reading the record", () => {
    const { engine, state, recorded } = corrected();
    const before = matchReport(engine, state, players, format);
    const after = recordedReport(
      engine,
      state,
      players,
      format,
      recorded,
    ).report;
    expect(after.players).toEqual(before.players);
    expect(after.fairShareMs).toBe(before.fairShareMs);
  });
});

describe("a match not in the record keeps today’s report (#244 AC4)", () => {
  it('reads the phone’s events and the planned "50 min, quarters"', () => {
    const { engine, state } = quinnsMatch();
    const r = recordedReport(engine, state, players, format, undefined);
    const phone = matchReport(engine, state, players, format);
    expect(r.events).toEqual(state.events);
    expect(r.report).toEqual(phone);
    expect(r.scorers).toEqual(phone.scorers);
    expect(r.timeUnknown).toEqual([]);
    expect(r.structure).toBe("50 min, quarters");
  });

  it("uncorrected, in the record: the same goals, conceded and tallies as the phone", () => {
    const { engine, state } = quinnsMatch();
    const ledger = record(emptyLedger(squadId, "Test FC", NOW), state);
    const r = recordedReport(engine, state, players, format, ledger.matches[0]);
    const phone = matchReport(engine, state, players, format);
    expect(r.scorers).toEqual(phone.scorers);
    expect(r.report.score).toEqual(phone.score);
    expect(r.report.keepers).toEqual(phone.keepers);
    expect(r.report.play).toEqual(phone.play);
  });
});

describe("eventsWithRecord", () => {
  it("a phone event the record has not caught up with is still counted", () => {
    const { state } = quinnsMatch();
    const ledger = record(emptyLedger(squadId, "Test FC", NOW), state);
    const late: MatchEvent = {
      ...state.events![0],
      id: uuid(),
      kind: "goal",
      playerId: CAL,
      refersTo: null,
    };
    const merged = eventsWithRecord(
      [...state.events!, late],
      ledger.matches[0],
    );
    expect(merged.map((e) => e.id)).toEqual([
      ...ledger.matches[0].events!.map((e) => e.id),
      late.id,
    ]);
  });

  it("keeps the phone’s own copy of an event both hold", () => {
    const { state } = quinnsMatch();
    const ledger = record(emptyLedger(squadId, "Test FC", NOW), state);
    const merged = eventsWithRecord(state.events, ledger.matches[0]);
    const byId = (es: readonly MatchEvent[]) =>
      [...es].sort((a, b) => a.id.localeCompare(b.id));
    expect(byId(merged)).toEqual(byId(state.events!));
  });
});
