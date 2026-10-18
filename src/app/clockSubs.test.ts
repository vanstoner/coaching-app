/**
 * Tests for the clock's planned subs — #203.
 *
 * The healthy case first: a quarter with subs planned reads as Rob's
 * approved prototype does, line for line. Then the bands at their edges,
 * the buzz, an edit during the quarter, and a phone that slept.
 */

import { describe, expect, it } from 'vitest';
import { MatchEngine } from '../engine/MatchEngine';
import { uuid } from '../types/index';
import type { Format, Position, UUID } from '../types/index';
import { teamSheetFor } from './lineup';
import { makePlayer } from './squad';
import {
  NO_BUZZES,
  NO_SUB_PLANNED,
  checkBuzz,
  subMoment,
  type BuzzLog,
  type PlannedSub,
} from './subPlan';
import {
  LIST_WHILE_PROMPTING,
  NO_NOT_NOW,
  cameOnFor,
  isNotNow,
  moveSubTime,
  notNow,
  offPicks,
  promptAgain,
  promptGroups,
  removeSub,
  subBand,
  subCountdown,
  subList,
  type OnPitch,
} from './clockSubs';

const S = 1_000;
const MIN = 60_000;
const QUARTER = 12.5 * MIN;
const AT_6_15 = 6 * MIN + 15 * S;

/** Invented names only. */
const NAMES = ['Ava', 'Ben', 'Cal', 'Dee', 'Eli', 'Fay', 'Gus', 'Hal', 'Ivy', 'Jo', 'Kit'];

function people() {
  const ids = Object.fromEntries(NAMES.map((n) => [n, uuid() as UUID])) as Record<string, UUID>;
  const nameOf = (id: UUID) => NAMES.find((n) => ids[n] === id) ?? '?';
  return { ids, nameOf };
}

function sub(playerId: UUID, atMs: number, forPlayerId: UUID | null = null, done = false): PlannedSub {
  return { playerId, atMs, forPlayerId, done };
}

/**
 * Quarter 2 of the prototype: Kit, Jo, Ivy, Gus on since kick-off; Ben and
 * Dee since 6:15 of Q1; Hal since 9:00 of Q1 (stints in ms, longest first).
 */
function quarterTwo() {
  const { ids, nameOf } = people();
  const outfieldOn: OnPitch[] = [
    { playerId: ids.Kit, currentStintMs: 20 * MIN },
    { playerId: ids.Jo, currentStintMs: 19 * MIN },
    { playerId: ids.Ivy, currentStintMs: 18 * MIN },
    { playerId: ids.Ben, currentStintMs: 8 * MIN },
    { playerId: ids.Dee, currentStintMs: 7 * MIN },
    { playerId: ids.Hal, currentStintMs: 5 * MIN },
  ];
  const onPitchIds = new Set([...outfieldOn.map((p) => p.playerId), ids.Gus]);
  const plan: PlannedSub[] = [
    sub(ids.Ava, AT_6_15, ids.Ben),
    sub(ids.Cal, AT_6_15, ids.Dee),
    sub(ids.Eli, 9 * MIN),
    sub(ids.Fay, NO_SUB_PLANNED),
  ];
  return { ids, nameOf, outfieldOn, onPitchIds, plan };
}

function listAt(q: ReturnType<typeof quarterTwo>, elapsedMs: number, prompting = false) {
  return subList({
    plan: q.plan,
    periodElapsedMs: elapsedMs,
    prompting,
    nameOf: q.nameOf,
    outfieldOn: q.outfieldOn,
    onPitchIds: q.onPitchIds,
    madeFor: () => null,
  });
}

describe('the list (AC1): healthy case', () => {
  it('one line per planned sub, in time order, worded as approved', () => {
    const q = quarterTwo();
    const list = listAt(q, 2 * MIN);
    expect(list.lines.map((l) => l.text)).toEqual([
      'Ava on for Ben · 6:15',
      'Cal on for Dee · 6:15',
      'Eli on · 9:00 (who comes off: suggested Kit)',
    ]);
    expect(list.lines.every((l) => l.band === null && l.status === '')).toBe(true);
    expect(list.notPlanned.map(q.nameOf)).toEqual(['Fay']);
  });

  it('a sub made is ticked and greyed with who came off, from the record', () => {
    const q = quarterTwo();
    q.plan[0] = { ...q.plan[0], done: true };
    const list = subList({
      plan: q.plan,
      periodElapsedMs: 7 * MIN,
      prompting: false,
      nameOf: q.nameOf,
      outfieldOn: q.outfieldOn.filter((p) => p.playerId !== q.ids.Ben),
      onPitchIds: q.onPitchIds,
      madeFor: (id) => (id === q.ids.Ava ? q.ids.Hal : null),
    });
    const ava = list.lines[0];
    expect(ava.done).toBe(true);
    expect(ava.text).toBe('Ava on for Hal · 6:15'); // what happened, not what was planned
    expect(ava.band).toBeNull();
  });

  it('lists times as "6:15" (C9), not "06:15"', () => {
    const q = quarterTwo();
    q.plan[2] = sub(q.ids.Eli, 45 * S);
    expect(listAt(q, 0).lines[0].text).toBe('Eli on · 0:45 (who comes off: suggested Kit)');
  });

  it('two unnamed subs at once are not both told to take off the same player', () => {
    const q = quarterTwo();
    q.plan = [sub(q.ids.Eli, AT_6_15), sub(q.ids.Fay, AT_6_15)];
    expect(listAt(q, 0).lines.map((l) => l.text)).toEqual([
      'Eli on · 6:15 (who comes off: suggested Kit)',
      'Fay on · 6:15 (who comes off: suggested Jo)',
    ]);
  });

  it('a named player already off falls back to the suggestion', () => {
    const q = quarterTwo();
    q.outfieldOn = q.outfieldOn.filter((p) => p.playerId !== q.ids.Ben);
    const picks = offPicks(q.plan, q.outfieldOn);
    expect(picks.get(q.ids.Ava)).toEqual({ offId: q.ids.Kit, named: false });
    expect(picks.get(q.ids.Cal)).toEqual({ offId: q.ids.Dee, named: true });
  });

  it('"Not planned" names only bench players with no time, never anyone on the pitch', () => {
    const q = quarterTwo();
    q.plan.push(sub(q.ids.Hal, NO_SUB_PLANNED)); // somehow in the plan, but on the pitch
    expect(listAt(q, 0).notPlanned.map(q.nameOf)).toEqual(['Fay']);
  });

  it('while a prompt shows, only the next two subs still to make (C1)', () => {
    const q = quarterTwo();
    q.plan[0] = { ...q.plan[0], done: true };
    q.plan.push(sub(q.ids.Hal, 11 * MIN));
    const list = listAt(q, 6 * MIN, true);
    expect(LIST_WHILE_PROMPTING).toBe(2);
    expect(list.lines.map((l) => q.nameOf(l.playerId))).toEqual(['Cal', 'Eli']);
    expect(list.notPlanned).toEqual([]);
  });
});

describe('the warning (AC3): the colour band at its edges', () => {
  const s = sub(uuid() as UUID, AT_6_15);
  const at = (secondsBefore: number) => AT_6_15 - secondsBefore * S;

  it('none at 31 s, green at 30 s, amber at 15 s, red at 0, red late', () => {
    expect(subBand(s, at(31))).toBeNull();
    expect(subBand(s, at(30))).toBe('green');
    expect(subBand(s, at(16))).toBe('green');
    expect(subBand(s, at(15))).toBe('amber');
    expect(subBand(s, at(1))).toBe('amber');
    expect(subBand(s, at(0))).toBe('red');
    expect(subBand(s, at(-40))).toBe('red');
  });

  it('always says it in words too: "in 0:30" down to "in 0:01", then "late 0:40"', () => {
    expect(subCountdown(s, at(30))).toBe('in 0:30');
    expect(subCountdown(s, at(15))).toBe('in 0:15');
    expect(subCountdown(s, at(0.5))).toBe('in 0:01');
    expect(subCountdown(s, at(0))).toBe('late 0:00');
    expect(subCountdown(s, at(-40))).toBe('late 0:40');
    expect(subCountdown(s, at(-75))).toBe('late 1:15');
  });

  it('nothing for a sub made, or one not planned', () => {
    expect(subBand({ ...s, done: true }, AT_6_15)).toBeNull();
    expect(subBand({ ...s, atMs: NO_SUB_PLANNED }, AT_6_15)).toBeNull();
  });

  it('the list carries the band and the words', () => {
    const q = quarterTwo();
    const lines = listAt(q, AT_6_15 - 20 * S).lines;
    expect(lines.map((l) => [l.band, l.status])).toEqual([
      ['green', 'in 0:20'],
      ['green', 'in 0:20'],
      [null, ''],
    ]);
  });
});

describe('the prompts (AC3, C2, C5)', () => {
  it('rise 30 s before, and two at the same time share one panel', () => {
    const q = quarterTwo();
    const none = () => false;
    expect(promptGroups(q.plan, AT_6_15 - 31 * S, none)).toEqual([]);
    const groups = promptGroups(q.plan, AT_6_15 - 30 * S, none);
    expect(groups.map((g) => g.map((s) => q.nameOf(s.playerId)))).toEqual([['Ava', 'Cal']]);
    // At 9:00 Eli's panel is its own; Ava and Cal are still waiting, late.
    const later = promptGroups(q.plan, 9 * MIN, none);
    expect(later.map((g) => g.map((s) => q.nameOf(s.playerId)))).toEqual([['Ava', 'Cal'], ['Eli']]);
  });

  it('"Not now" puts a prompt away for good, and "Show the prompt again" brings it back', () => {
    const q = quarterTwo();
    const key = 'match-1/q2';
    let log = notNow(NO_NOT_NOW, key, [q.plan[0], q.plan[1]]);
    const putOff = (s: PlannedSub) => isNotNow(log, key, s);
    for (const t of [AT_6_15, AT_6_15 + MIN, QUARTER + MIN]) {
      expect(promptGroups(q.plan, t, putOff).flat().map((s) => q.nameOf(s.playerId))).not.toContain('Ava');
    }
    log = promptAgain(log, key, q.plan[0]);
    expect(promptGroups(q.plan, AT_6_15 + MIN, putOff).flat().map((s) => q.nameOf(s.playerId))).toEqual([
      'Ava',
    ]);
  });

  it('"Not now" belongs to one period: the next starts with nothing put off', () => {
    const q = quarterTwo();
    const log = notNow(NO_NOT_NOW, 'match-1/q2', [q.plan[0]]);
    expect(isNotNow(log, 'match-1/q2', q.plan[0])).toBe(true);
    expect(isNotNow(log, 'match-1/q3', q.plan[0])).toBe(false);
  });
});

describe('changing it during the quarter (AC2, C6, C7)', () => {
  it('±30 s moves one sub only, and moves its warning with it', () => {
    const q = quarterTwo();
    const later = moveSubTime(q.plan, q.ids.Ava, 30 * S, QUARTER);
    expect(later.map((s) => s.atMs)).toEqual([AT_6_15 + 30 * S, AT_6_15, 9 * MIN, NO_SUB_PLANNED]);
    // At 5:50 Ava was green; moved to 6:45, nothing yet, then green at 6:15.
    expect(subBand(q.plan[0], 5 * MIN + 50 * S)).toBe('green');
    expect(subBand(later[0], 5 * MIN + 50 * S)).toBeNull();
    expect(subBand(later[0], AT_6_15)).toBe('green');
    // Earlier: a sub moved into the past is due now.
    const earlier = moveSubTime(q.plan, q.ids.Eli, -30 * S, QUARTER);
    expect(earlier[2].atMs).toBe(8 * MIN + 30 * S);
  });

  it('"−" never takes a sub out of the plan; it stops at 0:01', () => {
    const q = quarterTwo();
    let plan = [sub(q.ids.Ava, 20 * S)];
    plan = moveSubTime(plan, q.ids.Ava, -30 * S, QUARTER);
    expect(plan[0].atMs).toBe(1_000);
  });

  it('a "Not planned" player gets the midpoint on the first "+" (C7)', () => {
    const q = quarterTwo();
    const plan = moveSubTime(q.plan, q.ids.Fay, 30 * S, QUARTER);
    expect(plan[3].atMs).toBe(AT_6_15);
    expect(moveSubTime(q.plan, q.ids.Fay, -30 * S, QUARTER)).toBe(q.plan);
  });

  it('"Remove this sub" takes the time and the pick away, and nothing else (C6)', () => {
    const q = quarterTwo();
    const plan = removeSub(q.plan, q.ids.Ava);
    expect(plan[0]).toEqual(sub(q.ids.Ava, NO_SUB_PLANNED));
    expect(plan.slice(1)).toEqual(q.plan.slice(1));
    expect(listAt({ ...q, plan }, 0).notPlanned.map(q.nameOf)).toEqual(['Ava', 'Fay']);
  });

  it('a moved sub is a new moment, so an old "Not now" does not hide it', () => {
    const q = quarterTwo();
    const key = 'm/q';
    const log = notNow(NO_NOT_NOW, key, [q.plan[0]]);
    const moved = moveSubTime(q.plan, q.ids.Ava, 30 * S, QUARTER);
    expect(isNotNow(log, key, moved[0])).toBe(false);
  });
});

describe('the buzz (AC4): once, as the prompt rises', () => {
  function paint(log: BuzzLog, plan: PlannedSub[], elapsedMs: number) {
    return checkBuzz(log, {
      enabled: true,
      foreground: true,
      running: { periodKey: 'm/q2', elapsedMs },
      plan,
    });
  }

  it('fires once at 30 s before, never again at the due time or while late', () => {
    const q = quarterTwo();
    let log = NO_BUZZES;
    const heard: number[] = [];
    for (let t = 0; t <= QUARTER; t += S) {
      const r = paint(log, q.plan, t);
      log = r.log;
      if (r.buzz.length > 0) heard.push(t);
    }
    expect(heard).toEqual([AT_6_15 - 30 * S, 9 * MIN - 30 * S]);
  });

  it('an edit during the quarter moves the buzz with the warning', () => {
    const q = quarterTwo();
    // Paint to 7:00: Eli's 9:00 sub has not warned yet.
    let log = NO_BUZZES;
    for (let t = 0; t <= 7 * MIN; t += S) log = paint(log, q.plan, t).log;
    const plan = moveSubTime(moveSubTime(q.plan, q.ids.Eli, -30 * S, QUARTER), q.ids.Eli, -30 * S, QUARTER); // 8:00
    expect(paint(log, plan, 7 * MIN + 29 * S).buzz).toEqual([]);
    const at = paint(log, plan, 7 * MIN + 30 * S);
    expect(at.buzz.map((s) => s.playerId)).toEqual([q.ids.Eli]);
    expect(at.log.buzzed.has(subMoment(plan[2]))).toBe(true);
  });
});

describe('a phone that slept (AC5): the right band on its next paint', () => {
  function makeFormat(): Format {
    const formatId = uuid();
    const positions: Position[] = Array.from({ length: 7 }, (_, i) => ({
      id: uuid(),
      formatId,
      label: i === 0 ? 'GK' : `P${i}`,
      kind: i === 0 ? ('goalkeeper' as const) : ('outfield' as const),
      unit: i === 0 ? ('GK' as const) : null,
      sortOrder: i,
    }));
    return { id: formatId, name: '7-a-side', onFieldCount: 7, positions };
  }

  it('reads elapsed time from the anchors, so a jump lands in the right band', () => {
    let now = 1_800_000_000_000;
    const engine = new MatchEngine({ nowFn: () => new Date(now) });
    const format = makeFormat();
    const squadId = uuid();
    const ids = Array.from({ length: 8 }, (_, i) => makePlayer(squadId, `P${i}`).id);
    const state = engine.createMatch(squadId, format.id, { totalMinutes: 50, quarterCount: 4 });
    const quarter = state.quarters[0];
    engine.startQuarter(state, quarter, teamSheetFor(ids.slice(0, 7), ids[0], format), format);
    const planned = sub(ids[7], AT_6_15);
    const bandNow = () => subBand(planned, engine.getQuarterElapsedMs(quarter));

    now += 2 * MIN; // awake at 2:00
    expect(bandNow()).toBeNull();
    now += 4 * MIN; // asleep through 5:45, first paint at 6:00
    expect(bandNow()).toBe('amber');
    expect(subCountdown(planned, engine.getQuarterElapsedMs(quarter))).toBe('in 0:15');
    now += 2 * MIN; // asleep again, first paint at 8:00
    expect(bandNow()).toBe('red');
    expect(subCountdown(planned, engine.getQuarterElapsedMs(quarter))).toBe('late 1:45');
  });
});

describe('cameOnFor: who a sub replaced, from the record', () => {
  it('finds the stint that ended by substitution where and when theirs began', () => {
    const [q, ava, ben, cal, pos, pos2] = Array.from({ length: 6 }, () => uuid() as UUID);
    const apps = [
      { quarterId: q, playerId: ben, positionId: pos, startElapsedMs: 0, endElapsedMs: 375_000, endReason: 'substitution' as const },
      { quarterId: q, playerId: cal, positionId: pos2, startElapsedMs: 0, endElapsedMs: 375_000, endReason: 'substitution' as const },
      { quarterId: q, playerId: ava, positionId: pos, startElapsedMs: 375_000, endElapsedMs: null, endReason: null },
    ];
    expect(cameOnFor(apps, q, ava)).toBe(ben);
    expect(cameOnFor(apps, q, uuid() as UUID)).toBeNull();
  });
});
