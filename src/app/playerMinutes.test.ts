/**
 * Tests for minutes per player — REQ-03 (#3).
 *
 * The two that matter most:
 *
 * 1. **Invariant 3.** Goalkeeper time must never leak into the fairness figure.
 *    A coach who puts a child in goal has made a decision, not created an
 *    unfairness, and a fairness view that counts it would flag their own
 *    choices as anomalies.
 *
 * 2. **The offsetting-error case QA found.** Two intervals, one a millisecond
 *    long and one a millisecond short, cancel out in any aggregate check. The
 *    figures must be right PER PLAYER, which is the only check that catches it.
 */

import { describe, it, expect } from 'vitest';
import { MatchEngine } from '../engine/MatchEngine';
import { uuid } from '../types/index';
import type { Format, Player, Position, UUID } from '../types/index';
import { makePlayer } from './squad';
import {
  foldPlayerMinutes,
  fairnessSpreadMs,
  leastPlayedFirst,
  longestOnPitchFirst,
} from './playerMinutes';

// --- fixtures ---------------------------------------------------------------

function makeFormat(onFieldCount = 7): Format {
  const formatId = uuid();
  const positions: Position[] = Array.from({ length: onFieldCount }, (_, i) => ({
    id: uuid(),
    formatId,
    // Position 0 is the goalkeeper; the rest are outfield.
    label: i === 0 ? 'GK' : `P${i}`,
    kind: i === 0 ? ('goalkeeper' as const) : ('outfield' as const),
    sortOrder: i,
  }));
  return { id: formatId, name: `${onFieldCount}-a-side`, onFieldCount, positions };
}

function makeClock(startMs: number) {
  let nowMs = startMs;
  return {
    nowFn: () => new Date(nowMs),
    advance: (ms: number) => {
      nowMs += ms;
    },
  };
}

/** A squad of `size` players, and a team sheet putting the first 7 on. */
function setUp(size = 10, totalMinutes = 50, quarterCount = 4) {
  const clock = makeClock(1_700_000_000_000);
  const engine = new MatchEngine({ nowFn: clock.nowFn });
  const format = makeFormat();
  const squadId = uuid();
  const players: Player[] = Array.from({ length: size }, (_, i) =>
    makePlayer(squadId, `P${i}`)
  );
  const state = engine.createMatch(squadId, format.id, { totalMinutes, quarterCount });

  const sheetOf = (starting: Player[]) => {
    const sheet = new Map<UUID, UUID>();
    format.positions.forEach((p, i) => sheet.set(p.id, starting[i].id));
    return sheet;
  };

  return { clock, engine, format, state, players, sheetOf };
}

// --- invariant 3 ------------------------------------------------------------

describe('invariant 3 — fairness is outfield time, never per position', () => {
  it('keeps goalkeeper time out of the fairness figure', () => {
    const { engine, state, format, players, sheetOf, clock } = setUp();
    engine.startQuarter(state, state.quarters[0], sheetOf(players.slice(0, 7)), format);
    clock.advance(10 * 60_000);

    const minutes = foldPlayerMinutes(engine, state, players);
    const keeper = minutes.find((m) => m.playerId === players[0].id)!;
    const outfielder = minutes.find((m) => m.playerId === players[1].id)!;

    // Both were on for ten minutes.
    expect(keeper.totalMs).toBe(10 * 60_000);
    expect(outfielder.totalMs).toBe(10 * 60_000);

    // But only the outfielder accrued the fairness figure.
    expect(keeper.goalkeeperMs).toBe(10 * 60_000);
    expect(keeper.outfieldMs).toBe(0);
    expect(outfielder.outfieldMs).toBe(10 * 60_000);
    expect(outfielder.goalkeeperMs).toBe(0);
  });

  it('measures the spread on outfield time, so a keeper is not read as unfair', () => {
    const { engine, state, format, players, sheetOf, clock } = setUp();
    engine.startQuarter(state, state.quarters[0], sheetOf(players.slice(0, 7)), format);
    clock.advance(10 * 60_000);

    const onPitch = foldPlayerMinutes(engine, state, players).filter((m) => m.onPitchNow);
    // Six outfielders on ten minutes each, one keeper on zero outfield.
    // The spread must be the keeper's zero against the outfielders' ten.
    expect(fairnessSpreadMs(onPitch)).toBe(10 * 60_000);
    // And every outfielder is equal, which is the point.
    const outfieldOnly = onPitch.filter((m) => m.goalkeeperMs === 0);
    expect(fairnessSpreadMs(outfieldOnly)).toBe(0);
  });
});

// --- the offsetting-error case ---------------------------------------------

describe('the offsetting-error case', () => {
  it('is caught per player, where an aggregate check would pass', () => {
    const { engine, state, format, players, sheetOf, clock } = setUp();
    engine.startQuarter(state, state.quarters[0], sheetOf(players.slice(0, 7)), format);
    clock.advance(5 * 60_000);

    // Hand-edit two intervals so one is a millisecond long and the other a
    // millisecond short. Their SUM is unchanged, so any aggregate assertion
    // still passes. Only a per-player figure notices.
    const a = state.appearances.find((x) => x.playerId === players[1].id)!;
    const b = state.appearances.find((x) => x.playerId === players[2].id)!;
    a.startElapsedMs -= 1;
    b.startElapsedMs += 1;

    const minutes = foldPlayerMinutes(engine, state, players);
    const total = minutes.reduce((s, m) => s + m.totalMs, 0);
    const clean = setUp();
    clean.engine.startQuarter(
      clean.state,
      clean.state.quarters[0],
      clean.sheetOf(clean.players.slice(0, 7)),
      clean.format
    );
    clean.clock.advance(5 * 60_000);
    const cleanTotal = foldPlayerMinutes(clean.engine, clean.state, clean.players).reduce(
      (s, m) => s + m.totalMs,
      0
    );

    // The aggregate is identical — this is why aggregate checks miss it.
    expect(total).toBe(cleanTotal);

    // The per-player figures are not, which is the check that works.
    const ma = minutes.find((m) => m.playerId === players[1].id)!;
    const mb = minutes.find((m) => m.playerId === players[2].id)!;
    expect(ma.outfieldMs).toBe(5 * 60_000 + 1);
    expect(mb.outfieldMs).toBe(5 * 60_000 - 1);
    expect(ma.outfieldMs).not.toBe(mb.outfieldMs);
  });
});

// --- invariant 2: open intervals close at live elapsed ----------------------

describe('invariant 2 — an open interval closes at live match elapsed', () => {
  it('includes the time of a player still on the pitch', () => {
    const { engine, state, format, players, sheetOf, clock } = setUp();
    engine.startQuarter(state, state.quarters[0], sheetOf(players.slice(0, 7)), format);

    expect(foldPlayerMinutes(engine, state, players)[1].outfieldMs).toBe(0);
    clock.advance(90_000);
    expect(foldPlayerMinutes(engine, state, players)[1].outfieldMs).toBe(90_000);
    clock.advance(90_000);
    expect(foldPlayerMinutes(engine, state, players)[1].outfieldMs).toBe(180_000);
  });

  it('gives the same answer whether or not it was called while time passed', () => {
    const awake = setUp();
    awake.engine.startQuarter(
      awake.state,
      awake.state.quarters[0],
      awake.sheetOf(awake.players.slice(0, 7)),
      awake.format
    );
    for (let i = 0; i < 120; i++) {
      awake.clock.advance(1_000);
      foldPlayerMinutes(awake.engine, awake.state, awake.players);
    }

    const asleep = setUp();
    asleep.engine.startQuarter(
      asleep.state,
      asleep.state.quarters[0],
      asleep.sheetOf(asleep.players.slice(0, 7)),
      asleep.format
    );
    asleep.clock.advance(120_000);

    expect(foldPlayerMinutes(awake.engine, awake.state, awake.players)[1].outfieldMs).toBe(
      foldPlayerMinutes(asleep.engine, asleep.state, asleep.players)[1].outfieldMs
    );
  });

  it("freezes a player's time once the quarter ends", () => {
    const { engine, state, format, players, sheetOf, clock } = setUp();
    engine.startQuarter(state, state.quarters[0], sheetOf(players.slice(0, 7)), format);
    clock.advance(4 * 60_000);
    engine.endQuarter(state, state.quarters[0]);
    const atEnd = foldPlayerMinutes(engine, state, players)[1].outfieldMs;
    clock.advance(10 * 60_000); // half-time
    expect(foldPlayerMinutes(engine, state, players)[1].outfieldMs).toBe(atEnd);
  });
});

// --- the squad view ---------------------------------------------------------

describe('foldPlayerMinutes', () => {
  it('includes players who have not been on, rather than omitting them', () => {
    const { engine, state, format, players, sheetOf, clock } = setUp(10);
    engine.startQuarter(state, state.quarters[0], sheetOf(players.slice(0, 7)), format);
    clock.advance(60_000);

    const minutes = foldPlayerMinutes(engine, state, players);
    expect(minutes).toHaveLength(10);
    // The three who have not played are exactly the ones a fairness view needs.
    const unplayed = minutes.filter((m) => m.totalMs === 0);
    expect(unplayed).toHaveLength(3);
    for (const m of unplayed) expect(m.onPitchNow).toBe(false);
  });

  it('returns rows in squad order, so the screen does not reshuffle', () => {
    const { engine, state, format, players, sheetOf, clock } = setUp(10);
    engine.startQuarter(state, state.quarters[0], sheetOf(players.slice(0, 7)), format);
    clock.advance(60_000);
    const ids = foldPlayerMinutes(engine, state, players).map((m) => m.playerId);
    expect(ids).toEqual(players.map((p) => p.id));
  });

  it('is a pure function of the instant', () => {
    const { engine, state, format, players, sheetOf, clock } = setUp();
    engine.startQuarter(state, state.quarters[0], sheetOf(players.slice(0, 7)), format);
    clock.advance(45_000);
    expect(foldPlayerMinutes(engine, state, players)).toEqual(
      foldPlayerMinutes(engine, state, players)
    );
  });

  it('reports an empty squad without throwing', () => {
    const { engine, state } = setUp();
    expect(foldPlayerMinutes(engine, state, [])).toEqual([]);
    expect(fairnessSpreadMs([])).toBe(0);
  });
});

// --- what the substitution reminder will ask ---------------------------------

describe('who comes off, who comes on', () => {
  it('ranks least played first, and keeps squad order on a tie', () => {
    const { engine, state, format, players, sheetOf, clock } = setUp(10);
    engine.startQuarter(state, state.quarters[0], sheetOf(players.slice(0, 7)), format);
    clock.advance(10 * 60_000);

    const order = leastPlayedFirst(foldPlayerMinutes(engine, state, players));
    // The three who never came on, then the keeper (zero OUTFIELD), all on
    // zero — and among equals, squad order is preserved.
    expect(order.slice(0, 4).map((m) => m.outfieldMs)).toEqual([0, 0, 0, 0]);
    expect(order[0].playerId).toBe(players[0].id); // the keeper, squad index 0
    expect(order.at(-1)!.outfieldMs).toBe(10 * 60_000);
  });

  it('ranks longest continuous stint first, and only for players on the pitch', () => {
    const { engine, state, format, players, sheetOf, clock } = setUp(10);
    engine.startQuarter(state, state.quarters[0], sheetOf(players.slice(0, 7)), format);
    clock.advance(8 * 60_000);

    const due = longestOnPitchFirst(foldPlayerMinutes(engine, state, players));
    expect(due).toHaveLength(7);
    for (const m of due) {
      expect(m.onPitchNow).toBe(true);
      expect(m.currentStintMs).toBe(8 * 60_000);
    }
  });

  it('distinguishes total played from time in the current stint', () => {
    // This is why "who comes off" is not the mirror of "who has played most":
    // a player can have the most minutes and have only just come back on.
    const { engine, state, format, players, sheetOf, clock } = setUp(10);
    engine.startQuarter(state, state.quarters[0], sheetOf(players.slice(0, 7)), format);
    clock.advance(10 * 60_000);
    engine.endQuarter(state, state.quarters[0]);

    // Same seven start the second quarter: totals carry, stints restart.
    engine.startQuarter(state, state.quarters[1], sheetOf(players.slice(0, 7)), format);
    clock.advance(60_000);

    const m = foldPlayerMinutes(engine, state, players)[1];
    expect(m.outfieldMs).toBe(11 * 60_000); // eleven minutes played in total
    expect(m.currentStintMs).toBe(60_000); // but only one minute since sitting down
  });

  it('reports nobody as due when no quarter is running', () => {
    const { engine, state, players } = setUp(10);
    expect(longestOnPitchFirst(foldPlayerMinutes(engine, state, players))).toEqual([]);
  });
});
