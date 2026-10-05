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
import { CLOCK_SPEEDS, NORMAL_CLOCK, virtualNowMs, withSpeed } from './appClock';
import {
  NO_BUZZES,
  NO_SUB_PLANNED,
  isPlanned,
  checkBuzz,
  clearSubTime,
  defaultSubTimeMs,
  planSubs,
  setSubTime,
  nudgeSubTime,
  markDone,
  dueSubs,
  nextSub,
  msUntilNextSub,
  subMoment,
  subsToBuzz,
  whoComesOff,
  type BuzzLog,
  type PlannedSub,
} from './subPlan';

function makeFormat(onFieldCount = 7): Format {
  const formatId = uuid();
  const positions: Position[] = Array.from({ length: onFieldCount }, (_, i) => ({
    id: uuid(),
    formatId,
    label: i === 0 ? 'GK' : `P${i}`,
    kind: i === 0 ? ('goalkeeper' as const) : ('outfield' as const),
    unit: i === 0 ? ('GK' as const) : null,
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

/**
 * The plan after a coach has scheduled EVERY bench player at the default time.
 *
 * `planSubs` now starts with nobody scheduled (PO ruling, #62), so tests about
 * what a scheduled sub does have to schedule one first. That is the point of
 * the ruling: scheduling is a deliberate act, including here.
 */
function allScheduled(ids: UUID[], periodMs: number) {
  return ids.reduce(
    (plan, id) => setSubTime(plan, id, defaultSubTimeMs(periodMs), periodMs),
    planSubs(ids, periodMs)
  );
}

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
  it('plans every bench player at the default time once scheduled', () => {
    const ids = [uuid(), uuid()] as UUID[];
    const plan = allScheduled(ids, 12 * 60_000 + 30_000);
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
    const plan = setSubTime(allScheduled([a, b], periodMs), a, 3 * 60_000, periodMs);
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
    let plan = allScheduled([a], periodMs);
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
    const plan = allScheduled([a], periodMs);
    expect(dueSubs(plan, 6 * 60_000)).toHaveLength(0);
    expect(dueSubs(plan, 6 * 60_000 + 15_000)).toHaveLength(1);
  });

  it('stays due when the coach forgets — that is the entire point', () => {
    const a = uuid() as UUID;
    const plan = allScheduled([a], periodMs);
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
    const plan = allScheduled([a], periodMs);
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
    let plan = allScheduled([off, on], periodMs);
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

  it('starts with NOBODY scheduled, so a sub is opted into', () => {
    // PO ruling, second round of field testing: defaulting everyone to the
    // midpoint meant a coach wanting two of three substitutes on had to turn
    // one OFF — undoing something they never asked for.
    const ids = [uuid(), uuid(), uuid()] as UUID[];
    const plan = planSubs(ids, periodMs);
    expect(plan.every((s) => !isPlanned(s))).toBe(true);
    expect(dueSubs(plan, periodMs)).toEqual([]);
    expect(nextSub(plan, 0)).toBeNull();
  });

  it('takes one press to schedule a sub, landing halfway through', () => {
    // "first increment should be half way through the half or quarter"
    const a = uuid() as UUID;
    const plan = nudgeSubTime(planSubs([a], periodMs), a, 30_000, periodMs);
    expect(plan[0].atMs).toBe(defaultSubTimeMs(periodMs));
    expect(plan[0].atMs).toBe(375_000); // 6:15 into a 12:30 quarter
  });

  it('then steps by 30 seconds in either direction', () => {
    // "then + and - should just increment or decrement by as appropriate 30s"
    const a = uuid() as UUID;
    let plan = nudgeSubTime(planSubs([a], periodMs), a, 30_000, periodMs);
    const mid = plan[0].atMs;

    plan = nudgeSubTime(plan, a, 30_000, periodMs);
    expect(plan[0].atMs).toBe(mid + 30_000);

    plan = nudgeSubTime(plan, a, -30_000, periodMs);
    expect(plan[0].atMs).toBe(mid);

    plan = nudgeSubTime(plan, a, -30_000, periodMs);
    expect(plan[0].atMs).toBe(mid - 30_000);
  });

  it('walks all the way back down to no sub, and no further', () => {
    const a = uuid() as UUID;
    let plan = nudgeSubTime(planSubs([a], periodMs), a, 30_000, periodMs);
    for (let i = 0; i < 40; i++) plan = nudgeSubTime(plan, a, -30_000, periodMs);
    expect(plan[0].atMs).toBe(NO_SUB_PLANNED);
  });
});

// ---------------------------------------------------------------------------
// The buzz — #137, ruling 19 (R1): once, when a sub falls due, app open
// ---------------------------------------------------------------------------

describe('subsToBuzz (#137 AC5)', () => {
  const periodMs = 750_000; // a 12:30 quarter
  const due = defaultSubTimeMs(periodMs); // 6:15

  it('buzzes a planned sub the moment it falls due, and not before', () => {
    const a = uuid() as UUID;
    const plan = allScheduled([a], periodMs);
    expect(subsToBuzz(plan, due - 1, new Set())).toEqual([]);
    expect(subsToBuzz(plan, due, new Set()).map((s) => s.playerId)).toEqual([a]);
  });

  it('never buzzes the same moment twice, however late the swap is', () => {
    const a = uuid() as UUID;
    const plan = allScheduled([a], periodMs);
    const buzzed = new Set([subMoment(plan[0])]);
    for (const t of [due, due + 1_000, 9 * 60_000, periodMs, periodMs * 2]) {
      expect(subsToBuzz(plan, t, buzzed)).toEqual([]);
    }
    // The clock still shows it as due: only the buzz is once.
    expect(dueSubs(plan, 9 * 60_000)).toHaveLength(1);
  });

  it('never buzzes a sub already made, or one taken out of the plan', () => {
    const [made, removed, waiting] = [uuid(), uuid(), uuid()] as UUID[];
    let plan = allScheduled([made, removed, waiting], periodMs);
    plan = markDone(plan, made);
    plan = clearSubTime(plan, removed);
    expect(subsToBuzz(plan, periodMs, new Set()).map((s) => s.playerId)).toEqual([waiting]);
    expect(subsToBuzz([], periodMs, new Set())).toEqual([]);
  });

  it('buzzes a sub moved to a later time again, at its new time', () => {
    const a = uuid() as UUID;
    let plan = allScheduled([a], periodMs);
    const buzzed = new Set(subsToBuzz(plan, due, new Set()).map(subMoment));
    expect(buzzed.size).toBe(1);
    plan = setSubTime(plan, a, 8 * 60_000, periodMs);
    expect(subsToBuzz(plan, 7 * 60_000, buzzed)).toEqual([]);
    expect(subsToBuzz(plan, 8 * 60_000, buzzed).map((s) => s.playerId)).toEqual([a]);
  });

  it('hands back subs that fell due together in one go, oldest first, for one buzz', () => {
    const [a, b, c] = [uuid(), uuid(), uuid()] as UUID[];
    let plan = allScheduled([a, b, c], periodMs); // all at 6:15
    plan = setSubTime(plan, c, 4 * 60_000, periodMs);
    expect(subsToBuzz(plan, 7 * 60_000, new Set()).map((s) => s.playerId)).toEqual([c, a, b]);
  });
});

describe('checkBuzz: the clock, repaint by repaint (#137 AC1–AC3)', () => {
  const periodMs = 750_000;
  const due = defaultSubTimeMs(periodMs);

  /** One repaint of the clock: in front, buzzing on, the period running, unless told otherwise. */
  function repaint(
    log: BuzzLog,
    plan: PlannedSub[],
    elapsedMs: number,
    { enabled = true, foreground = true, running = true, periodKey = 'match-1/q1' } = {}
  ) {
    return checkBuzz(log, {
      enabled,
      foreground,
      running: running ? { periodKey, elapsedMs } : null,
      plan,
    });
  }

  it('buzzes each planned sub once, at its moment, across a whole period of repaints', () => {
    const [ava, ben, cal, dee] = [uuid(), uuid(), uuid(), uuid()] as UUID[];
    const names = new Map([
      [ava, 'Ava'],
      [ben, 'Ben'],
      [cal, 'Cal'],
      [dee, 'Dee'],
    ]);
    let plan = allScheduled([ava, ben, cal, dee], periodMs); // all at 6:15
    plan = setSubTime(plan, ava, 3 * 60_000, periodMs);
    plan = clearSubTime(plan, dee); // not coming on this quarter

    // A repaint every second, as the clock does: 751 of them.
    let log = NO_BUZZES;
    const heard: string[] = [];
    for (let t = 0; t <= periodMs; t += 1_000) {
      const r = repaint(log, plan, t);
      log = r.log;
      if (r.buzz.length > 0) {
        heard.push(`${formatClock(t)} ${r.buzz.map((s) => names.get(s.playerId)).join(' + ')}`);
      }
    }
    expect(heard).toEqual(['03:00 Ava', '06:15 Ben + Cal']);
  });

  it('buzzes nothing for a period that is not running', () => {
    const a = uuid() as UUID;
    const plan = allScheduled([a], periodMs);
    const r = repaint(NO_BUZZES, plan, periodMs, { running: false });
    expect(r.buzz).toEqual([]);
    expect(r.log).toBe(NO_BUZZES);
  });

  it('uses nothing up in the background, then buzzes once on coming back (AC3)', () => {
    // Android drops a vibration from an app in the background, so a buzz
    // spent there would be lost for good.
    const a = uuid() as UUID;
    const plan = allScheduled([a], periodMs);
    let log = repaint(NO_BUZZES, plan, 5 * 60_000).log; // 5:00, nothing due yet
    for (const t of [6 * 60_000, due, 7 * 60_000]) {
      const away = repaint(log, plan, t, { foreground: false });
      expect(away.buzz).toEqual([]);
      log = away.log;
    }
    const back = repaint(log, plan, 9 * 60_000);
    expect(back.buzz.map((s) => s.playerId)).toEqual([a]);
    expect(repaint(back.log, plan, 9 * 60_000 + 1_000).buzz).toEqual([]);
  });

  it('buzzes nothing while switched off in Settings, and uses nothing up', () => {
    const a = uuid() as UUID;
    const plan = allScheduled([a], periodMs);
    const off = repaint(NO_BUZZES, plan, 7 * 60_000, { enabled: false });
    expect(off.buzz).toEqual([]);
    expect(off.log).toBe(NO_BUZZES);
    // Switched back on with the sub still waiting: it has not buzzed yet.
    expect(repaint(off.log, plan, 8 * 60_000).buzz).toHaveLength(1);
  });

  it('does not buzz again for a sub undone and due again', () => {
    // The coach is looking at the screen: they have just pressed Undo.
    const a = uuid() as UUID;
    let plan = allScheduled([a], periodMs);
    const first = repaint(NO_BUZZES, plan, due);
    expect(first.buzz).toHaveLength(1);
    plan = markDone(plan, a);
    plan = plan.map((s) => (s.playerId === a ? { ...s, done: false } : s)); // as App.tsx undoes it
    expect(repaint(first.log, plan, due + 5_000).buzz).toEqual([]);
  });

  it('starts each new period, and each new match, with nothing buzzed', () => {
    // The same player at the same time next quarter is a new reminder.
    const a = uuid() as UUID;
    const plan = allScheduled([a], periodMs);
    const q1 = repaint(NO_BUZZES, plan, due, { periodKey: 'match-1/q1' });
    expect(q1.buzz).toHaveLength(1);
    expect(repaint(q1.log, plan, due + 1_000, { periodKey: 'match-1/q1' }).buzz).toEqual([]);
    const q2 = repaint(q1.log, plan, due, { periodKey: 'match-1/q2' });
    expect(q2.buzz).toHaveLength(1);
    expect(repaint(q2.log, plan, due, { periodKey: 'match-2/q1' }).buzz).toHaveLength(1);
  });

  it('follows the Test kit clock: due when the anchors say so, at ×1, ×5 and ×10 (AC2)', () => {
    // Nothing is counted. Each repaint reads the elapsed time off the
    // engine's anchors, which read the app clock.
    for (const speed of CLOCK_SPEEDS) {
      const T = 1_800_000_000_000;
      let real = T;
      const setting = withSpeed(NORMAL_CLOCK, speed, T);
      const engine = new MatchEngine({ nowFn: () => new Date(virtualNowMs(setting, real)) });
      const format = makeFormat();
      const squadId = uuid();
      const ids = Array.from({ length: 8 }, (_, i) => makePlayer(squadId, `P${i}`).id);
      const state = engine.createMatch(squadId, format.id, { totalMinutes: 50, quarterCount: 4 });
      const quarter = state.quarters[0];
      engine.startQuarter(state, quarter, teamSheetFor(ids.slice(0, 7), ids[0], format), format);
      const plan = allScheduled([ids[7]], periodMs); // 6:15
      const paint = (log: BuzzLog) =>
        repaint(log, plan, engine.getQuarterElapsedMs(quarter), {
          periodKey: `${state.match.id}/${quarter.id}`,
        });

      const realToDue = due / speed; // 375 s at ×1, 75 s at ×5, 37.5 s at ×10
      real = T + realToDue - 1;
      const early = paint(NO_BUZZES);
      expect(early.buzz).toEqual([]);
      real = T + realToDue;
      const onTime = paint(early.log);
      expect(onTime.buzz.map((s) => s.playerId)).toEqual([ids[7]]);
      real = T + realToDue + 1_000;
      expect(paint(onTime.log).buzz).toEqual([]);
    }
  });
});
