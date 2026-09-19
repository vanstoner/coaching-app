/**
 * Tests for planned substitutions — REQ-04 (#4).
 *
 * Includes the engine-level swap, because a reminder that does not change who
 * the app thinks is on the pitch would leave the minutes lying. That is the
 * failure invariant 1 exists to prevent, so it is tested here alongside the
 * plan that triggers it.
 */

import { describe, it, expect } from 'vitest';
import { MatchEngine, MatchEngineError } from '../engine/MatchEngine';
import { uuid } from '../types/index';
import type { Format, Player, Position, UUID } from '../types/index';
import { makePlayer } from './squad';
import { foldPlayerMinutes } from './playerMinutes';
import { teamSheetFor } from './lineup';
import { formatClock } from './matchClock';
import {
  NO_SUB_PLANNED,
  isPlanned,
  clearSubTime,
  defaultSubTimeMs,
  planSubs,
  setSubTime,
  nudgeSubTime,
  markDone,
  dueSubs,
  nextSub,
  msUntilNextSub,
  whoComesOff,
} from './subPlan';

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

function setUp(size = 9, totalMinutes = 50, quarterCount = 4) {
  const clock = makeClock(1_700_000_000_000);
  const engine = new MatchEngine({ nowFn: clock.nowFn });
  const format = makeFormat();
  const squadId = uuid();
  const players: Player[] = Array.from({ length: size }, (_, i) =>
    makePlayer(squadId, `P${i}`)
  );
  const state = engine.createMatch(squadId, format.id, { totalMinutes, quarterCount });
  for (const p of players) state.playerAvailability.set(p.id, 'available');
  return { clock, engine, format, state, players };
}

// --- the default the PO asked for -------------------------------------------

describe('defaultSubTimeMs', () => {
  it('is the midpoint of the period — 6:15 into a 12:30 quarter', () => {
    // The PO's own example: a 50-minute match in quarters.
    const quarterMs = (50 * 60_000) / 4;
    expect(formatClock(quarterMs)).toBe('12:30');
    expect(formatClock(defaultSubTimeMs(quarterMs))).toBe('06:15');
  });

  it('works the same way for halves', () => {
    const halfMs = (50 * 60_000) / 2;
    expect(formatClock(halfMs)).toBe('25:00');
    expect(formatClock(defaultSubTimeMs(halfMs))).toBe('12:30');
  });

  it('does not produce nonsense for a nonsense period', () => {
    expect(defaultSubTimeMs(0)).toBe(0);
    expect(defaultSubTimeMs(-1)).toBe(0);
    expect(defaultSubTimeMs(Number.NaN)).toBe(0);
  });
});

describe('planSubs', () => {
  it('plans every bench player at the default time', () => {
    const ids = [uuid(), uuid()] as UUID[];
    const plan = planSubs(ids, 12 * 60_000 + 30_000);
    expect(plan).toHaveLength(2);
    for (const s of plan) {
      expect(formatClock(s.atMs)).toBe('06:15');
      expect(s.done).toBe(false);
      expect(s.forPlayerId).toBeNull();
    }
  });

  it('is empty when nobody is on the bench', () => {
    expect(planSubs([], 60_000)).toEqual([]);
  });
});

// --- the coach moving a time ------------------------------------------------

describe('setting the time next to a name', () => {
  const periodMs = 12 * 60_000 + 30_000;

  it('moves only that player', () => {
    const [a, b] = [uuid(), uuid()] as UUID[];
    const plan = setSubTime(planSubs([a, b], periodMs), a, 3 * 60_000, periodMs);
    expect(formatClock(plan[0].atMs)).toBe('03:00');
    expect(formatClock(plan[1].atMs)).toBe('06:15');
  });

  it('will not plan a sub after the whistle, where it could never fire', () => {
    const a = uuid() as UUID;
    const plan = setSubTime(planSubs([a], periodMs), a, 99 * 60_000, periodMs);
    expect(plan[0].atMs).toBeLessThan(periodMs);
  });

  it('treats zero as "not coming on this period", not as kick-off', () => {
    // Was clamped to 1s, which made the coach's actual intention
    // inexpressible. Field note from the first real match, #62.
    const a = uuid() as UUID;
    expect(setSubTime(planSubs([a], periodMs), a, 0, periodMs)[0].atMs).toBe(NO_SUB_PLANNED);
    expect(setSubTime(planSubs([a], periodMs), a, -60_000, periodMs)[0].atMs).toBe(
      NO_SUB_PLANNED
    );
  });

  it('nudges by a step and stays inside the period', () => {
    const a = uuid() as UUID;
    let plan = planSubs([a], periodMs);
    plan = nudgeSubTime(plan, a, 60_000, periodMs);
    expect(formatClock(plan[0].atMs)).toBe('07:15');
    plan = nudgeSubTime(plan, a, -2 * 60_000, periodMs);
    expect(formatClock(plan[0].atMs)).toBe('05:15');
    // Nudging far past the end clamps rather than escaping.
    plan = nudgeSubTime(plan, a, 60 * 60_000, periodMs);
    expect(plan[0].atMs).toBeLessThan(periodMs);
  });

  it('ignores a nudge for somebody not in the plan', () => {
    const a = uuid() as UUID;
    const plan = planSubs([a], periodMs);
    expect(nudgeSubTime(plan, uuid() as UUID, 60_000, periodMs)).toEqual(plan);
  });
});

// --- the reminder ------------------------------------------------------------

describe('when the reminder fires', () => {
  const periodMs = 12 * 60_000 + 30_000;

  it('is not due before the time, and is due at it', () => {
    const a = uuid() as UUID;
    const plan = planSubs([a], periodMs);
    expect(dueSubs(plan, 6 * 60_000)).toHaveLength(0);
    expect(dueSubs(plan, 6 * 60_000 + 15_000)).toHaveLength(1);
  });

  it('stays due when the coach forgets — that is the entire point', () => {
    const a = uuid() as UUID;
    const plan = planSubs([a], periodMs);
    // Three minutes late and still shouting.
    expect(dueSubs(plan, 9 * 60_000)).toHaveLength(1);
  });

  it('stops once the coach has made the swap', () => {
    const a = uuid() as UUID;
    const plan = markDone(planSubs([a], periodMs), a);
    expect(dueSubs(plan, 12 * 60_000)).toHaveLength(0);
  });

  it('reports the oldest due substitution first', () => {
    const [a, b] = [uuid(), uuid()] as UUID[];
    let plan = planSubs([a, b], periodMs);
    plan = setSubTime(plan, a, 8 * 60_000, periodMs);
    plan = setSubTime(plan, b, 4 * 60_000, periodMs);
    expect(dueSubs(plan, 10 * 60_000)[0].playerId).toBe(b);
  });

  it('counts down to the next one', () => {
    const a = uuid() as UUID;
    const plan = planSubs([a], periodMs);
    expect(formatClock(msUntilNextSub(plan, 0)!)).toBe('06:15');
    expect(formatClock(msUntilNextSub(plan, 5 * 60_000)!)).toBe('01:15');
    // Once it is due there is nothing left to count down to.
    expect(nextSub(plan, 7 * 60_000)).toBeNull();
    expect(msUntilNextSub(plan, 7 * 60_000)).toBeNull();
  });

  it('has nothing to count down to with an empty plan', () => {
    expect(msUntilNextSub([], 0)).toBeNull();
    expect(dueSubs([], 99 * 60_000)).toEqual([]);
  });
});

describe('whoComesOff', () => {
  const [a, b, c] = [uuid(), uuid(), uuid()] as UUID[];
  const onPitch = [
    { playerId: a, currentStintMs: 2 * 60_000 },
    { playerId: b, currentStintMs: 9 * 60_000 },
    { playerId: c, currentStintMs: 5 * 60_000 },
  ];

  it('suggests whoever has been on longest without a break', () => {
    const sub = { playerId: uuid() as UUID, atMs: 0, forPlayerId: null, done: false };
    expect(whoComesOff(sub, onPitch)).toBe(b);
  });

  it('respects the coach’s own choice', () => {
    const sub = { playerId: uuid() as UUID, atMs: 0, forPlayerId: c, done: false };
    expect(whoComesOff(sub, onPitch)).toBe(c);
  });

  it('falls back when the coach’s choice already came off', () => {
    const gone = uuid() as UUID;
    const sub = { playerId: uuid() as UUID, atMs: 0, forPlayerId: gone, done: false };
    expect(whoComesOff(sub, onPitch)).toBe(b);
  });

  it('returns null when there is nobody to take off', () => {
    const sub = { playerId: uuid() as UUID, atMs: 0, forPlayerId: null, done: false };
    expect(whoComesOff(sub, [])).toBeNull();
  });
});

// --- the swap itself, which is what keeps the minutes honest ----------------

describe('MatchEngine.substitute', () => {
  it('moves the minutes from one player to the other at the moment of the swap', () => {
    const { engine, state, format, players, clock } = setUp(9);
    const starters = players.slice(0, 7);
    engine.startQuarter(
      state,
      state.quarters[0],
      teamSheetFor(starters.map((p) => p.id), starters[0].id, format),
      format
    );

    clock.advance(6 * 60_000 + 15_000); // the 6:15 the PO asked for
    engine.substitute(state, state.quarters[0], players[1].id, players[7].id);
    clock.advance(6 * 60_000 + 15_000);

    const minutes = foldPlayerMinutes(engine, state, players);
    const off = minutes.find((m) => m.playerId === players[1].id)!;
    const on = minutes.find((m) => m.playerId === players[7].id)!;

    expect(formatClock(off.outfieldMs)).toBe('06:15');
    expect(formatClock(on.outfieldMs)).toBe('06:15');
    expect(off.onPitchNow).toBe(false);
    expect(on.onPitchNow).toBe(true);
  });

  it('keeps the pitch full — exactly seven players throughout', () => {
    const { engine, state, format, players, clock } = setUp(9);
    const starters = players.slice(0, 7);
    engine.startQuarter(
      state,
      state.quarters[0],
      teamSheetFor(starters.map((p) => p.id), starters[0].id, format),
      format
    );
    clock.advance(4 * 60_000);
    engine.substitute(state, state.quarters[0], players[1].id, players[7].id);
    clock.advance(4 * 60_000);
    engine.substitute(state, state.quarters[0], players[2].id, players[8].id);
    clock.advance(4 * 60_000);
    engine.endQuarter(state, state.quarters[0]);

    const minutes = foldPlayerMinutes(engine, state, players);
    // Twelve minutes played by seven players at every instant.
    expect(minutes.reduce((s, m) => s + m.totalMs, 0)).toBe(12 * 60_000 * 7);
    expect(minutes.filter((m) => m.onPitchNow)).toHaveLength(0);
  });

  it('puts the substitute into the position the other player vacated', () => {
    const { engine, state, format, players, clock } = setUp(9);
    const starters = players.slice(0, 7);
    engine.startQuarter(
      state,
      state.quarters[0],
      teamSheetFor(starters.map((p) => p.id), starters[0].id, format),
      format
    );
    const before = state.appearances.find((a) => a.playerId === players[3].id)!;
    clock.advance(60_000);
    engine.substitute(state, state.quarters[0], players[3].id, players[7].id);
    const after = state.appearances.find(
      (a) => a.playerId === players[7].id && a.endElapsedMs === null
    )!;
    expect(after.positionId).toBe(before.positionId);
    expect(after.positionKind).toBe(before.positionKind);
  });

  it('records why the appearance ended, rather than losing the reason', () => {
    const { engine, state, format, players, clock } = setUp(9);
    const starters = players.slice(0, 7);
    engine.startQuarter(
      state,
      state.quarters[0],
      teamSheetFor(starters.map((p) => p.id), starters[0].id, format),
      format
    );
    clock.advance(60_000);
    engine.substitute(state, state.quarters[0], players[1].id, players[7].id);
    const closed = state.appearances.find(
      (a) => a.playerId === players[1].id && a.endElapsedMs !== null
    )!;
    expect(closed.endReason).toBe('substitution');
  });

  it('a substitute who comes on and off again keeps both spells', () => {
    const { engine, state, format, players, clock } = setUp(9);
    const starters = players.slice(0, 7);
    engine.startQuarter(
      state,
      state.quarters[0],
      teamSheetFor(starters.map((p) => p.id), starters[0].id, format),
      format
    );
    clock.advance(2 * 60_000);
    engine.substitute(state, state.quarters[0], players[1].id, players[7].id);
    clock.advance(3 * 60_000);
    engine.substitute(state, state.quarters[0], players[7].id, players[1].id);
    clock.advance(1 * 60_000);

    const minutes = foldPlayerMinutes(engine, state, players);
    const sub = minutes.find((m) => m.playerId === players[7].id)!;
    const starter = minutes.find((m) => m.playerId === players[1].id)!;
    expect(formatClock(sub.outfieldMs)).toBe('03:00');
    expect(formatClock(starter.outfieldMs)).toBe('03:00'); // 2:00 + 1:00
    // Back on, so the current stint restarts rather than counting the first.
    expect(formatClock(starter.currentStintMs)).toBe('01:00');
  });

  it('refuses the swaps that would corrupt the record', () => {
    const { engine, state, format, players, clock } = setUp(9);
    const starters = players.slice(0, 7);

    // Not running yet.
    expect(() =>
      engine.substitute(state, state.quarters[0], players[1].id, players[7].id)
    ).toThrow(MatchEngineError);

    engine.startQuarter(
      state,
      state.quarters[0],
      teamSheetFor(starters.map((p) => p.id), starters[0].id, format),
      format
    );
    clock.advance(60_000);

    // Somebody who is not on.
    expect(() =>
      engine.substitute(state, state.quarters[0], players[8].id, players[7].id)
    ).toThrow(/not currently on the pitch/);
    // Somebody already on.
    expect(() =>
      engine.substitute(state, state.quarters[0], players[1].id, players[2].id)
    ).toThrow(/already on the pitch/);
    // For themselves.
    expect(() =>
      engine.substitute(state, state.quarters[0], players[1].id, players[1].id)
    ).toThrow(/themselves/);
  });

  it('does not touch state when it refuses', () => {
    const { engine, state, format, players, clock } = setUp(9);
    const starters = players.slice(0, 7);
    engine.startQuarter(
      state,
      state.quarters[0],
      teamSheetFor(starters.map((p) => p.id), starters[0].id, format),
      format
    );
    clock.advance(60_000);
    const before = JSON.stringify(state.appearances);
    try {
      engine.substitute(state, state.quarters[0], players[8].id, players[7].id);
    } catch {
      // expected
    }
    expect(JSON.stringify(state.appearances)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// "Not coming on this period" — field note #62, from the first real match
// ---------------------------------------------------------------------------

describe('a substitute with no planned time', () => {
  const periodMs = 750_000; // a 12:30 quarter

  it('never becomes due, however long the period runs', () => {
    const a = uuid() as UUID;
    const plan = clearSubTime(planSubs([a], periodMs), a);

    // The whole period, and well past it. A plan of "not this quarter" that
    // starts shouting at 6:15 is the exact bug this fixes.
    for (const t of [0, 1_000, 375_000, 749_000, periodMs, periodMs * 3]) {
      expect(dueSubs(plan, t)).toEqual([]);
    }
  });

  it('is not counted as the next sub, so the countdown ignores it', () => {
    const a = uuid() as UUID;
    const plan = clearSubTime(planSubs([a], periodMs), a);
    expect(nextSub(plan, 0)).toBeNull();
    expect(msUntilNextSub(plan, 0)).toBeNull();
  });

  it('does not hide a real sub planned for someone else', () => {
    // The case from the match: three on the bench, two coming on.
    const off = uuid() as UUID;
    const on = uuid() as UUID;
    let plan = planSubs([off, on], periodMs);
    plan = clearSubTime(plan, off);

    expect(isPlanned(plan[0])).toBe(false);
    expect(isPlanned(plan[1])).toBe(true);

    const due = dueSubs(plan, periodMs);
    expect(due).toHaveLength(1);
    expect(due[0].playerId).toBe(on);
  });

  it('turns off by nudging down past the start, and back on at the default', () => {
    // One button a coach is already pressing, rather than a separate control.
    const a = uuid() as UUID;
    let plan = setSubTime(planSubs([a], periodMs), a, 30_000, periodMs);

    plan = nudgeSubTime(plan, a, -60_000, periodMs);
    expect(plan[0].atMs).toBe(NO_SUB_PLANNED);

    // Nudging down again has nothing below it to reach.
    plan = nudgeSubTime(plan, a, -60_000, periodMs);
    expect(plan[0].atMs).toBe(NO_SUB_PLANNED);

    // Back on means "about halfway", not "immediately".
    plan = nudgeSubTime(plan, a, 60_000, periodMs);
    expect(plan[0].atMs).toBe(defaultSubTimeMs(periodMs));
  });

  it('can be set back to a real time directly', () => {
    const a = uuid() as UUID;
    let plan = clearSubTime(planSubs([a], periodMs), a);
    plan = setSubTime(plan, a, 400_000, periodMs);
    expect(plan[0].atMs).toBe(400_000);
    expect(isPlanned(plan[0])).toBe(true);
  });

  it('leaves the default plan fully planned, so nothing changes by accident', () => {
    // The regression that would matter most: every bench player silently
    // becoming "no sub" would turn the reminder off for everyone.
    const ids = [uuid(), uuid(), uuid()] as UUID[];
    const plan = planSubs(ids, periodMs);
    expect(plan.every(isPlanned)).toBe(true);
    expect(dueSubs(plan, periodMs)).toHaveLength(3);
  });
});
