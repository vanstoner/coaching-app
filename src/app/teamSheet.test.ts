/**
 * Tests for the whistle reading the plan — #72 PR 2 (AC7–AC10).
 */

import { describe, it, expect } from 'vitest';
import { MatchEngine } from '../engine/MatchEngine';
import { uuid } from '../types/index';
import type { Format, Player, UUID } from '../types/index';
import { makePlayer } from './squad';
import { makeFormat } from './shapes';
import { foldPlayerMinutes } from './playerMinutes';
import { NO_SUB_PLANNED, planSubs, setSubFor, whoComesOff } from './subPlan';
import {
  addSwap,
  emptyPlan,
  lineupFromPlan,
  periodHasContent,
  setSlot,
  updateSwap,
  type PlannedPeriod,
} from './matchPlan';
import {
  addToSheet,
  keeperOf,
  makeKeeper,
  placeInSlot,
  playersOn,
  removeFromSheet,
  sheetFromSelection,
  sheetIsComplete,
  toTeamSheet,
  editSheet,
  liveMove,
  liveSheet,
  reverseOf,
  type Sheet,
} from './teamSheet';

const MIN = 60_000;

function squad(n: number): Player[] {
  const squadId = uuid();
  return Array.from({ length: n }, (_, i) => makePlayer(squadId, `P${i + 1}`));
}

function pos(format: Format, label: string): UUID {
  return format.positions.find((p) => p.label === label)!.id;
}

const labelsOf = (format: Format, sheet: Sheet) =>
  Object.fromEntries(format.positions.map((p) => [p.label, sheet[p.id] ?? null]));

describe('AC9 — explicit positions, with back-to-front as the default', () => {
  const format = makeFormat('2-3-1');
  const ids = squad(9).map((p) => p.id);

  it('fills the outfield back to front as players are tapped on, then goal', () => {
    let sheet = sheetFromSelection([], null, format);
    for (const id of ids.slice(0, 7)) sheet = addToSheet(sheet, format, id);
    expect(labelsOf(format, sheet)).toEqual({
      GK: ids[6],
      LB: ids[0],
      RB: ids[1],
      CM: ids[2],
      LW: ids[3],
      RW: ids[4],
      ST: ids[5],
    });
    expect(sheetIsComplete(sheet, format)).toBe(true);
  });

  it('refuses an eighth player rather than dropping one', () => {
    let sheet = sheetFromSelection(ids.slice(0, 7), ids[0], format);
    sheet = addToSheet(sheet, format, ids[7]);
    expect(playersOn(sheet)).not.toContain(ids[7]);
  });

  it('keeps the old order when built from a list and a keeper', () => {
    const sheet = sheetFromSelection(ids.slice(0, 7), ids[3], format);
    expect(keeperOf(sheet, format)).toBe(ids[3]);
    expect(sheet[pos(format, 'LB')]).toBe(ids[0]);
    expect(sheet[pos(format, 'ST')]).toBe(ids[6]);
  });

  it('puts a seventh player with no keeper chosen in goal, not off the sheet', () => {
    // The old list model dealt 7 players into 6 outfield slots and lost one.
    const sheet = sheetFromSelection(ids.slice(0, 7), null, format);
    expect(playersOn(sheet)).toHaveLength(7);
    expect(keeperOf(sheet, format)).toBe(ids[6]);
  });

  it('swaps two players already on, so nobody is lost', () => {
    const sheet = placeInSlot(sheetFromSelection(ids.slice(0, 7), ids[0], format), pos(format, 'ST'), ids[1]);
    expect(sheet[pos(format, 'ST')]).toBe(ids[1]);
    expect(sheet[pos(format, 'LB')]).toBe(ids[6]);
    expect(playersOn(sheet)).toHaveLength(7);
  });

  it('puts a bench player in a slot, sending its occupant to the bench', () => {
    const sheet = placeInSlot(sheetFromSelection(ids.slice(0, 7), ids[0], format), pos(format, 'CM'), ids[8]);
    expect(sheet[pos(format, 'CM')]).toBe(ids[8]);
    expect(playersOn(sheet)).not.toContain(ids[3]);
  });

  it('makes a keeper by swapping with whoever was in goal', () => {
    const sheet = makeKeeper(sheetFromSelection(ids.slice(0, 7), ids[0], format), format, ids[4]);
    expect(keeperOf(sheet, format)).toBe(ids[4]);
    expect(playersOn(sheet)).toContain(ids[0]);
  });

  it('empties a slot when a player is taken off', () => {
    const sheet = removeFromSheet(sheetFromSelection(ids.slice(0, 7), ids[0], format), ids[2]);
    expect(sheetIsComplete(sheet, format)).toBe(false);
    expect(toTeamSheet(sheet).size).toBe(6);
  });
});

describe('AC10 — who comes off', () => {
  const [a, b, c] = squad(3).map((p) => p.id);

  it('the coach can name who a sub replaces, and that is who comes off', () => {
    const plan = setSubFor(planSubs([a], 12.5 * MIN), a, b);
    const onPitch = [
      { playerId: b, currentStintMs: 1 },
      { playerId: c, currentStintMs: 999 },
    ];
    expect(whoComesOff(plan[0], onPitch)).toBe(b);
  });

  it('clearing it goes back to whoever has been on longest', () => {
    const plan = setSubFor(setSubFor(planSubs([a], 12.5 * MIN), a, b), a, null);
    const onPitch = [
      { playerId: b, currentStintMs: 1 },
      { playerId: c, currentStintMs: 999 },
    ];
    expect(whoComesOff(plan[0], onPitch)).toBe(c);
  });
});

describe('AC7 — the whistle reads the plan', () => {
  const format = makeFormat('2-3-1');
  const players = squad(10);
  const ids = players.map((p) => p.id);
  const labels = ['GK', 'LB', 'RB', 'CM', 'LW', 'RW', 'ST'];

  const planned = (): PlannedPeriod => {
    let plan = emptyPlan(2);
    labels.forEach((l, i) => (plan = setSlot(plan, 0, pos(format, l), ids[i])));
    plan = addSwap(plan, 0, 25 * MIN);
    plan = updateSwap(plan, 0, 0, { onId: ids[7], offId: ids[5], atMs: 7.5 * MIN });
    return plan.periods[0];
  };

  it('starts the sheet from the plan, position by position', () => {
    const { sheet } = lineupFromPlan(planned(), format, players);
    expect(labelsOf(format, sheet)).toEqual(
      Object.fromEntries(labels.map((l, i) => [l, ids[i]]))
    );
  });

  it('carries the planned sub time and who it replaces; other bench players get no sub', () => {
    const { subs } = lineupFromPlan(planned(), format, players);
    expect(subs.map((s) => s.playerId)).toEqual(ids.slice(7));
    expect(subs[0]).toEqual({ playerId: ids[7], atMs: 7.5 * MIN, forPlayerId: ids[5], done: false });
    expect(subs[1].atMs).toBe(NO_SUB_PLANNED);
    expect(subs[2].atMs).toBe(NO_SUB_PLANNED);
  });

  it('leaves out a player no longer in the squad, and a player in two places', () => {
    const period = planned();
    period.slots[pos(format, 'ST')] = uuid();
    period.slots[pos(format, 'RW')] = ids[0];
    const { sheet } = lineupFromPlan(period, format, players);
    expect(sheet[pos(format, 'ST')]).toBeNull();
    expect(sheet[pos(format, 'RW')]).toBeNull();
    expect(sheet[pos(format, 'GK')]).toBe(ids[0]);
  });

  it('a period with nothing planned is not treated as a plan', () => {
    expect(periodHasContent(undefined)).toBe(false);
    expect(periodHasContent(emptyPlan(2).periods[0])).toBe(false);
    expect(periodHasContent(planned())).toBe(true);
  });
});

describe('AC8 — the plan is never the record', () => {
  it('a period played differently from its plan shows the minutes actually played', () => {
    let nowMs = 1_700_000_000_000;
    const engine = new MatchEngine({ nowFn: () => new Date(nowMs) });
    const format = makeFormat('2-3-1');
    const players = squad(8);
    const ids = players.map((p) => p.id);
    const state = engine.createMatch(uuid(), format.id, { totalMinutes: 50, quarterCount: 2 });

    // The plan has P1–P7 starting.
    let plan = emptyPlan(2);
    ['GK', 'LB', 'RB', 'CM', 'LW', 'RW', 'ST'].forEach(
      (l, i) => (plan = setSlot(plan, 0, pos(format, l), ids[i]))
    );
    const { sheet } = lineupFromPlan(plan.periods[0], format, players);

    // At the whistle the coach puts P8 up front instead of P7.
    const played = placeInSlot(sheet, pos(format, 'ST'), ids[7]);
    engine.startQuarter(state, state.quarters[0], toTeamSheet(played), format);
    nowMs += 10 * MIN;

    const minutes = foldPlayerMinutes(engine, state, players);
    const of = (id: UUID) => minutes.find((m) => m.playerId === id)!;
    expect(of(ids[7]).outfieldMs).toBe(10 * MIN);
    expect(of(ids[6]).outfieldMs).toBe(0);
    // And the appearance knows the position it was actually played in.
    const appearance = state.appearances.find((a) => a.playerId === ids[7])!;
    expect(appearance.positionId).toBe(pos(format, 'ST'));
  });
});

describe('moves during play (#83 AC4, #82)', () => {
  const format = makeFormat('2-3-1');
  const ids = squad(9).map((p) => p.id);
  const sheet = sheetFromSelection(ids.slice(0, 7), ids[0], format);
  const posOf = (id: UUID) => (Object.keys(sheet) as UUID[]).find((p) => sheet[p] === id)!;

  it('pitch to another position is a swap', () => {
    expect(liveMove(sheet, ids[1], { kind: 'slot', positionId: posOf(ids[0]) })).toEqual({ kind: 'swap', a: ids[1], b: ids[0] });
  });

  it('bench to a position is a sub for whoever is there', () => {
    expect(liveMove(sheet, ids[8], { kind: 'slot', positionId: posOf(ids[3]) })).toEqual({ kind: 'sub', out: ids[3], in: ids[8] });
  });

  it('pitch onto a bench player is a sub the other way', () => {
    expect(liveMove(sheet, ids[3], { kind: 'player', playerId: ids[8] })).toEqual({ kind: 'sub', out: ids[3], in: ids[8] });
  });

  it('onto the bench itself, or onto yourself, is nothing: no position is left empty', () => {
    expect(liveMove(sheet, ids[3], { kind: 'bench' })).toBeNull();
    expect(liveMove(sheet, ids[3], { kind: 'slot', positionId: posOf(ids[3]) })).toBeNull();
  });

  it('Undo of a sub brings the player back; of a swap, swaps back', () => {
    expect(reverseOf({ kind: 'sub', out: ids[3], in: ids[8] })).toEqual({ kind: 'sub', out: ids[8], in: ids[3] });
    expect(reverseOf({ kind: 'swap', a: ids[1], b: ids[2] })).toEqual({ kind: 'swap', a: ids[1], b: ids[2] });
  });

  it('reads the live sheet from the open stints', () => {
    const live = liveSheet(
      [
        { quarterId: 'q' as UUID, playerId: ids[0], positionId: 'gk' as UUID, endElapsedMs: null },
        { quarterId: 'q' as UUID, playerId: ids[1], positionId: 'lb' as UUID, endElapsedMs: 600 },
      ],
      'q' as UUID
    );
    expect(live).toEqual({ gk: ids[0] });
  });
});

describe('moves before kick-off edit the sheet (#83 AC5)', () => {
  const format = makeFormat('2-3-1');
  const ids = squad(9).map((p) => p.id);
  const sheet = sheetFromSelection(ids.slice(0, 7), ids[0], format);
  const posOf = (s: Sheet, id: UUID) => (Object.keys(s) as UUID[]).find((p) => s[p] === id);

  it('onto a position: goes there, swapping with whoever was there', () => {
    const next = editSheet(sheet, ids[1], { kind: 'slot', positionId: posOf(sheet, ids[2])! });
    expect(posOf(next, ids[1])).toBe(posOf(sheet, ids[2]));
    expect(posOf(next, ids[2])).toBe(posOf(sheet, ids[1]));
  });

  it('a pitch player onto a bench player: the bench player takes the place', () => {
    const next = editSheet(sheet, ids[3], { kind: 'player', playerId: ids[8] });
    expect(posOf(next, ids[8])).toBe(posOf(sheet, ids[3]));
    expect(playersOn(next)).not.toContain(ids[3]);
  });

  it('onto the bench: comes off and leaves the position empty', () => {
    const next = editSheet(sheet, ids[3], { kind: 'bench' });
    expect(playersOn(next)).toHaveLength(6);
  });
});
