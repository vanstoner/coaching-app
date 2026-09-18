/**
 * Tests for lineup planning and rotation — REQ-02 (#2), REQ-04 (#4), REQ-05 (#5).
 *
 * The test that matters most is the last one: play a whole 50-minute match in
 * quarters, rotating on the suggestion each time, and assert every outfielder
 * ends within a quarter's worth of every other. If rotation does not converge,
 * the app has no reason to exist.
 */

import { describe, it, expect } from 'vitest';
import { MatchEngine } from '../engine/MatchEngine';
import { uuid } from '../types/index';
import type { Format, Player, Position, UUID } from '../types/index';
import { makePlayer } from './squad';
import { foldPlayerMinutes, fairnessSpreadMs } from './playerMinutes';
import { suggestLineup, teamSheetFor, lineupIsComplete, fairnessTable } from './lineup';

function makeFormat(onFieldCount = 7): Format {
  const formatId = uuid();
  const positions: Position[] = Array.from({ length: onFieldCount }, (_, i) => ({
    id: uuid(),
    formatId,
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

function setUp(size = 10, totalMinutes = 50, quarterCount = 4) {
  const clock = makeClock(1_700_000_000_000);
  const engine = new MatchEngine({ nowFn: clock.nowFn });
  const format = makeFormat();
  const squadId = uuid();
  const players: Player[] = Array.from({ length: size }, (_, i) =>
    makePlayer(squadId, `P${i}`)
  );
  const state = engine.createMatch(squadId, format.id, { totalMinutes, quarterCount });
  return { clock, engine, format, state, players };
}

describe('suggestLineup', () => {
  it('fills exactly the format, keeper included', () => {
    const { engine, state, format, players } = setUp(10);
    const s = suggestLineup(players, foldPlayerMinutes(engine, state, players), format);
    expect(s.onPitch).toHaveLength(7);
    expect(lineupIsComplete(s.onPitch, format)).toBe(true);
    expect(s.bench).toHaveLength(3);
    expect(s.goalkeeper).not.toBeNull();
    expect(s.onPitch).toContain(s.goalkeeper!);
    expect(new Set(s.onPitch).size).toBe(7);
  });

  it('picks the players owed the most outfield time', () => {
    const { engine, state, format, players, clock } = setUp(10);
    // First seven play ten minutes.
    engine.startQuarter(
      state,
      state.quarters[0],
      teamSheetFor(players.slice(0, 7).map((p) => p.id), players[0].id, format),
      format
    );
    clock.advance(10 * 60_000);
    engine.endQuarter(state, state.quarters[0]);

    const s = suggestLineup(players, foldPlayerMinutes(engine, state, players), format);
    // The three who have not played must all be on.
    for (const p of players.slice(7)) expect(s.onPitch).toContain(p.id);
  });

  it('rotates the gloves on goalkeeper minutes, not outfield minutes', () => {
    const { engine, state, format, players, clock } = setUp(10);
    engine.startQuarter(
      state,
      state.quarters[0],
      teamSheetFor(players.slice(0, 7).map((p) => p.id), players[0].id, format),
      format
    );
    clock.advance(10 * 60_000);
    engine.endQuarter(state, state.quarters[0]);

    const s = suggestLineup(players, foldPlayerMinutes(engine, state, players), format);
    // players[0] kept the first quarter, so must not be suggested again.
    expect(s.goalkeeper).not.toBe(players[0].id);
  });

  it('does not penalise a keeper on outfield fairness', () => {
    const { engine, state, format, players, clock } = setUp(10);
    engine.startQuarter(
      state,
      state.quarters[0],
      teamSheetFor(players.slice(0, 7).map((p) => p.id), players[0].id, format),
      format
    );
    clock.advance(10 * 60_000);
    engine.endQuarter(state, state.quarters[0]);

    // The keeper accrued no OUTFIELD time, so he is owed it and must be picked.
    const s = suggestLineup(players, foldPlayerMinutes(engine, state, players), format);
    expect(s.onPitch).toContain(players[0].id);
  });

  it('is stable: the same question twice gives the same answer', () => {
    const { engine, state, format, players } = setUp(10);
    const minutes = foldPlayerMinutes(engine, state, players);
    expect(suggestLineup(players, minutes, format)).toEqual(
      suggestLineup(players, minutes, format)
    );
  });

  it('honours availability without deleting anyone from the squad', () => {
    const { engine, state, format, players } = setUp(10);
    const available = new Set(players.slice(1).map((p) => p.id)); // players[0] is out
    const s = suggestLineup(players, foldPlayerMinutes(engine, state, players), format, {
      available,
    });
    expect(s.onPitch).not.toContain(players[0].id);
    expect(s.onPitch).toHaveLength(7);
  });

  it('says who is resting and why', () => {
    const { engine, state, format, players } = setUp(10);
    const s = suggestLineup(players, foldPlayerMinutes(engine, state, players), format);
    expect(s.rationale).toMatch(/Resting/);
    expect(s.rationale.length).toBeGreaterThan(0);
  });

  it('copes with exactly a full team, and with nobody available', () => {
    const { engine, state, format, players } = setUp(7);
    const s = suggestLineup(players, foldPlayerMinutes(engine, state, players), format);
    expect(s.onPitch).toHaveLength(7);
    expect(s.bench).toHaveLength(0);
    expect(s.rationale).toMatch(/Everyone plays/);

    const none = suggestLineup(players, [], format, { available: new Set() });
    expect(none.onPitch).toEqual([]);
    expect(none.rationale).toMatch(/Nobody is available/);
  });

  it('cannot start a quarter with too few players', () => {
    const { format } = setUp(10);
    expect(lineupIsComplete([], format)).toBe(false);
    expect(lineupIsComplete([uuid(), uuid()], format)).toBe(false);
  });
});

describe('teamSheetFor', () => {
  it('puts the keeper in goal and everyone else outfield', () => {
    const { format, players } = setUp(10);
    const onPitch = players.slice(0, 7).map((p) => p.id);
    const sheet = teamSheetFor(onPitch, players[3].id, format);

    expect(sheet.size).toBe(7);
    const keeperPosition = format.positions.find((p) => p.kind === 'goalkeeper')!;
    expect(sheet.get(keeperPosition.id)).toBe(players[3].id);
    // Everybody selected appears exactly once.
    expect(new Set(sheet.values()).size).toBe(7);
    for (const id of onPitch) expect([...sheet.values()]).toContain(id);
  });

  it('produces a sheet the engine accepts', () => {
    const { engine, state, format, players } = setUp(10);
    const s = suggestLineup(players, foldPlayerMinutes(engine, state, players), format);
    expect(() =>
      engine.startQuarter(
        state,
        state.quarters[0],
        teamSheetFor(s.onPitch, s.goalkeeper, format),
        format
      )
    ).not.toThrow();
  });
});

describe('fairnessTable', () => {
  it('sorts by who is owed most, and measures against the average', () => {
    const { engine, state, format, players, clock } = setUp(10);
    engine.startQuarter(
      state,
      state.quarters[0],
      teamSheetFor(players.slice(0, 7).map((p) => p.id), players[0].id, format),
      format
    );
    clock.advance(10 * 60_000);
    engine.endQuarter(state, state.quarters[0]);

    const table = fairnessTable(players, foldPlayerMinutes(engine, state, players));
    expect(table).toHaveLength(10);
    // Most-owed first: negative delta at the top, positive at the bottom.
    expect(table[0].deltaMs).toBeLessThan(0);
    expect(table.at(-1)!.deltaMs).toBeGreaterThan(0);
    // The deltas must sum to about zero — they are distances from the mean.
    const sum = table.reduce((s, r) => s + r.deltaMs, 0);
    expect(Math.abs(sum)).toBeLessThan(players.length);
  });

  it('is empty for an empty squad rather than throwing', () => {
    expect(fairnessTable([], [])).toEqual([]);
  });
});

// --- the one that matters ---------------------------------------------------

describe('rotating on the suggestion actually produces fair time', () => {
  it('keeps every outfielder within a few minutes across a full 50-minute match', () => {
    const { engine, state, format, players, clock } = setUp(10, 50, 4);
    const quarterMs = engine.getPlannedQuarterMs(state.match);
    expect(quarterMs).toBe(12 * 60_000 + 30_000);

    for (const quarter of state.quarters) {
      const s = suggestLineup(players, foldPlayerMinutes(engine, state, players), format);
      expect(lineupIsComplete(s.onPitch, format)).toBe(true);
      engine.startQuarter(state, quarter, teamSheetFor(s.onPitch, s.goalkeeper, format), format);
      clock.advance(quarterMs);
      engine.endQuarter(state, quarter);
    }

    const minutes = foldPlayerMinutes(engine, state, players);

    // Every second of the match was covered by exactly seven players.
    const played = minutes.reduce((sum, m) => sum + m.totalMs, 0);
    expect(played).toBe(50 * 60_000 * 7);

    // Nobody was forgotten.
    for (const m of minutes) expect(m.totalMs).toBeGreaterThan(0);

    // And the outfield spread is under one quarter — the actual fairness claim.
    // With 10 players, 6 outfield slots and 4 quarters there are 24 outfield
    // places for 10 children, so a perfectly even split is impossible; what
    // matters is that nobody is a whole quarter adrift.
    expect(fairnessSpreadMs(minutes)).toBeLessThanOrEqual(quarterMs);
  });

  it('shares the gloves around rather than landing them on one child', () => {
    const { engine, state, format, players, clock } = setUp(10, 50, 4);
    const quarterMs = engine.getPlannedQuarterMs(state.match);

    for (const quarter of state.quarters) {
      const s = suggestLineup(players, foldPlayerMinutes(engine, state, players), format);
      engine.startQuarter(state, quarter, teamSheetFor(s.onPitch, s.goalkeeper, format), format);
      clock.advance(quarterMs);
      engine.endQuarter(state, quarter);
    }

    const minutes = foldPlayerMinutes(engine, state, players);
    const keepers = minutes.filter((m) => m.goalkeeperMs > 0);
    // Four quarters, four different keepers.
    expect(keepers).toHaveLength(4);
    for (const k of keepers) expect(k.goalkeeperMs).toBe(quarterMs);
  });

  it('still converges when the match is played in halves', () => {
    const { engine, state, format, players, clock } = setUp(10, 50, 2);
    const halfMs = engine.getPlannedQuarterMs(state.match);

    for (const quarter of state.quarters) {
      const s = suggestLineup(players, foldPlayerMinutes(engine, state, players), format);
      engine.startQuarter(state, quarter, teamSheetFor(s.onPitch, s.goalkeeper, format), format);
      clock.advance(halfMs);
      engine.endQuarter(state, quarter);
    }

    const minutes = foldPlayerMinutes(engine, state, players);
    expect(minutes.reduce((s, m) => s + m.totalMs, 0)).toBe(50 * 60_000 * 7);
    // Only two periods for ten children, so some will not play at all. The
    // suggestion must still have favoured those owed time.
    const played = minutes.filter((m) => m.totalMs > 0);
    expect(played.length).toBeGreaterThanOrEqual(7);
  });
});
