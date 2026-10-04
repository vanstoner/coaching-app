import { describe, expect, it } from 'vitest';
import { MatchEngine } from '../engine/MatchEngine';
import { uuid } from '../types/index';
import type { UUID } from '../types/index';
import { makePlayer } from './squad';
import { makeSevenASideFormat } from './placeholderSquad';
import { teamSheetFor } from './lineup';
import { currentQuarter } from './matchClock';
import { lineupAtPeriodEnd } from './teamSheet';
import { addSwap, emptyPlan, sameAsPrevious, setSlot } from './matchPlan';

// #111: "Same as quarter N" did nothing when quarter N had been played (its
// lineup lives in the match record, not the plan) or was not planned.

const MIN = 60_000;

function playedFirstQuarter() {
  let now = Date.parse('2026-10-04T10:00:00Z');
  const engine = new MatchEngine({ nowFn: () => new Date(now) });
  const format = makeSevenASideFormat();
  const squadId = uuid();
  const players = ['Ava', 'Ben', 'Cal', 'Dee', 'Eli', 'Fay', 'Gus', 'Hal'].map((n) => makePlayer(squadId, n));
  const ids = players.map((p) => p.id);
  const state = engine.createMatch(squadId, format.id, {
    totalMinutes: 50,
    quarterCount: 4,
    availablePlayerIds: ids,
  });
  const q1 = currentQuarter(state)!;
  engine.startQuarter(state, q1, teamSheetFor(ids.slice(0, 7), ids[0], format), format);
  const start = lineupAtPeriodEnd(state.appearances, q1.id); // on now = the start
  now += 4 * MIN;
  engine.substitute(state, q1, ids[6], ids[7]); // Hal on for Gus
  now += 2 * MIN;
  engine.swapPositions(state, q1, ids[1], ids[2]); // Ben and Cal change places
  now += 6.5 * MIN;
  engine.endQuarter(state, q1);
  return { state, q1, ids, format, start };
}

describe('who finished a period (#111 AC1, AC4)', () => {
  it('reflects a sub and a swap: who finished, not who started', () => {
    const { state, q1, ids, start } = playedFirstQuarter();
    const end = lineupAtPeriodEnd(state.appearances, q1.id);
    const posOf = (sheet: Record<UUID, UUID | null>, id: UUID) =>
      Object.keys(sheet).find((p) => sheet[p as UUID] === id);
    expect(Object.values(end)).toContain(ids[7]); // Hal came on
    expect(Object.values(end)).not.toContain(ids[6]); // Gus went off
    expect(posOf(end, ids[1])).toBe(posOf(start, ids[2])); // Ben in Cal's old place
    expect(posOf(end, ids[2])).toBe(posOf(start, ids[1]));
    expect(Object.keys(end)).toHaveLength(7);
  });
});

describe('"Same as the previous period" (#111)', () => {
  it('AC1: a played period copies who finished it, keeping this period’s planned subs', () => {
    const { state, q1, ids, format } = playedFirstQuarter();
    let plan = emptyPlan(4);
    plan = addSwap(plan, 1, 12.5 * MIN); // a sub already planned for quarter 2
    const next = sameAsPrevious(plan, 1, lineupAtPeriodEnd(state.appearances, q1.id))!;
    expect(Object.values(next.periods[1].slots)).toContain(ids[7]);
    expect(Object.values(next.periods[1].slots)).not.toContain(ids[6]);
    expect(next.periods[1].subs).toHaveLength(1);
    expect(Object.keys(next.periods[1].slots)).toHaveLength(format.positions.length);
  });

  it('AC2: a period still to come copies its plan, subs and all', () => {
    const format = makeSevenASideFormat();
    let plan = emptyPlan(4);
    const who = uuid() as UUID;
    plan = setSlot(plan, 0, format.positions[0].id, who);
    plan = addSwap(plan, 0, 12.5 * MIN);
    const next = sameAsPrevious(plan, 1, null)!;
    expect(next.periods[1].slots[format.positions[0].id]).toBe(who);
    expect(next.periods[1].subs).toHaveLength(1);
  });

  it('AC3: nothing to copy is null, so the screen can say so', () => {
    expect(sameAsPrevious(emptyPlan(4), 1, null)).toBeNull(); // previous not planned
    expect(sameAsPrevious(emptyPlan(4), 1, {})).toBeNull(); // played, but nobody recorded
    expect(sameAsPrevious(emptyPlan(4), 0, null)).toBeNull(); // no previous period
  });
});
