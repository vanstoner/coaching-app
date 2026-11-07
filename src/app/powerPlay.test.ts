/**
 * #255 power play (ADR-026): the engine commands, the identity with extras,
 * the allowance, the order, the rule and its record. Made-up names only.
 */

import { describe, expect, it } from 'vitest';
import { MatchEngine, MAX_EXTRA_SLOTS } from '../engine/MatchEngine';
import { uuid } from '../types/index';
import type { MatchEvent, UUID } from '../types/index';
import { makePlayer } from './squad';
import { makeFormat } from './shapes';
import { emptyLedger, setPowerPlayRule } from './ledger';
import {
  mostTimeFirst,
  powerPlayAllowance,
  powerPlayCue,
  powerPlayLine,
  readPowerPlayBoxes,
  theirPowerPlayOffered,
  theyUsedPowerPlay,
  timeNeededOrder,
} from './powerPlay';

const squadId = uuid();
const players = ['Ava', 'Ben', 'Cal', 'Dan', 'Eve', 'Fin', 'Gus', 'Hal', 'Ivy', 'Jo', 'Kit'].map((n) => makePlayer(squadId, n));
const format = makeFormat('2-3-1');

function running() {
  let now = new Date('2026-11-08T10:00:00Z');
  const engine = new MatchEngine({ nowFn: () => now });
  const state = engine.createMatch(squadId, format.id, { totalMinutes: 50, quarterCount: 4, availablePlayerIds: players.map((p) => p.id) });
  const sheet = new Map<UUID, UUID>();
  format.positions.forEach((p, i) => sheet.set(p.id, players[i].id));
  engine.startQuarter(state, state.quarters[0], sheet, format);
  const at = (ms: number) => (now = new Date(Date.parse('2026-11-08T10:00:00Z') + ms));
  return { engine, state, q: state.quarters[0], at };
}

const ev = (kind: MatchEvent['kind'], id = uuid(), refersTo: UUID | null = null): MatchEvent => ({
  id, matchId: uuid(), quarterId: uuid(), kind, playerId: null, atElapsedMs: 0, recordedAt: '', refersTo, note: null,
});

describe('power play in the engine (ADR-026 D2)', () => {
  it('adds a bench child in an extra outfield slot, nobody off; the identity holds with extras (C9, C14)', () => {
    const { engine, state, q, at } = running();
    at(60_000);
    engine.addExtraPlayer(state, q, players[7].id, 'MID', format);
    const extras = engine.openExtraSlots(state, q, format);
    expect(extras).toHaveLength(1);
    expect(extras[0]).toMatchObject({ playerId: players[7].id, positionKind: 'outfield', positionUnit: 'MID', startElapsedMs: 60_000 });
    at(5 * 60_000);
    engine.endQuarter(state, q);
    expect(() => engine.validateQuarterAppearanceInvariant(state, q, format)).not.toThrow();
    const total = state.appearances.filter((a) => a.quarterId === q.id).reduce((n, a) => n + (a.endElapsedMs! - a.startElapsedMs), 0);
    expect(total).toBe(5 * 60_000 * format.onFieldCount + 4 * 60_000);
  });

  it('refuses a fourth slot, a child already on, a keeper slot, or a period not running (C11)', () => {
    const { engine, state, q } = running();
    for (let i = 0; i < MAX_EXTRA_SLOTS; i++) engine.addExtraPlayer(state, q, players[7 + i].id, 'ATT', format);
    expect(() => engine.addExtraPlayer(state, q, players[10].id, 'MID', format)).toThrow(/3 extra slots/);
    const fresh = running();
    expect(() => fresh.engine.addExtraPlayer(fresh.state, fresh.q, players[0].id, 'MID', format)).toThrow(/already on the pitch/);
    expect(() => fresh.engine.addExtraPlayer(fresh.state, fresh.q, players[7].id, 'GK', format)).toThrow(/goalkeeper/);
    fresh.engine.endQuarter(fresh.state, fresh.q);
    expect(() => fresh.engine.addExtraPlayer(fresh.state, fresh.q, players[7].id, 'MID', format)).toThrow(/expected running/);
  });

  it('off from an extra slot closes it; off from a base slot moves the newest extra child in (C19)', () => {
    const { engine, state, q, at } = running();
    engine.addExtraPlayer(state, q, players[7].id, 'MID', format);
    engine.addExtraPlayer(state, q, players[8].id, 'DEF', format);
    at(60_000);
    engine.removeExtraPlayer(state, q, players[8].id, format);
    expect(engine.openExtraSlots(state, q, format).map((a) => a.playerId)).toEqual([players[7].id]);
    at(120_000);
    const baseSpot = state.appearances.find((a) => a.playerId === players[1].id && a.endElapsedMs === null)!.positionId;
    engine.removeExtraPlayer(state, q, players[1].id, format);
    expect(engine.openExtraSlots(state, q, format)).toHaveLength(0);
    const moved = state.appearances.find((a) => a.playerId === players[7].id && a.endElapsedMs === null)!;
    expect(moved.positionId).toBe(baseSpot);
    expect(state.benchStints.some((b) => b.playerId === players[1].id && b.endElapsedMs === null)).toBe(true);
    at(300_000);
    engine.endQuarter(state, q);
    expect(() => engine.validateQuarterAppearanceInvariant(state, q, format)).not.toThrow();
  });

  it('their power play is one event, credited to no one (C23)', () => {
    const { engine, state, q } = running();
    const e = engine.recordTheirPowerPlay(state, q);
    expect(e).toMatchObject({ kind: 'opp_power_play', playerId: null });
    expect(theyUsedPowerPlay(state.events)).toBe(true);
  });
});

describe('the allowance and the cue (ADR-026 D3, D7)', () => {
  const steps = [4, 6];
  it('counts the steps the opposition lead has reached; a withdrawn goal does not count (C7, C10, C17)', () => {
    const four = Array.from({ length: 4 }, () => ev('conceded'));
    expect(powerPlayAllowance(four, steps)).toBe(1);
    const six = [...four, ev('conceded'), ev('conceded')];
    expect(powerPlayAllowance(six, steps)).toBe(2);
    const goal = ev('goal');
    expect(powerPlayAllowance([...six, goal, ev('goal')], steps)).toBe(1);
    expect(powerPlayAllowance([...six, goal, ev('withdrawn', uuid(), goal.id)], steps)).toBe(2);
    expect(powerPlayAllowance(six, [])).toBe(0);
  });

  it('add while allowed and under 3; over while extras exceed it, two steps at once included (C6, C17, C20)', () => {
    expect(powerPlayCue(1, 0)).toEqual({ kind: 'add', allowance: 1 });
    expect(powerPlayCue(1, 1)).toBeNull();
    expect(powerPlayCue(0, 2)).toEqual({ kind: 'over', allowance: 0 });
    expect(powerPlayCue(3, 3)).toBeNull();
  });

  it('their power play is offered once our lead reaches the first step (C21, C25)', () => {
    expect(theirPowerPlayOffered(Array.from({ length: 4 }, () => ev('goal')), steps)).toBe(true);
    expect(theirPowerPlayOffered(Array.from({ length: 3 }, () => ev('goal')), steps)).toBe(false);
    expect(theirPowerPlayOffered(Array.from({ length: 9 }, () => ev('goal')), [])).toBe(false);
  });

  it('time-needed order: least pitch time first, ties by owed time; off: most time first, keeper left out (C8, C18)', () => {
    const [a, b, c] = [uuid(), uuid(), uuid()];
    expect(timeNeededOrder([a, b, c], new Map([[a, 600_000], [b, 450_000], [c, 450_000]]), new Map([[c, 60_000]]))).toEqual([c, b, a]);
    expect(mostTimeFirst([a, b, c], c, new Map([[a, 1], [b, 2], [c, 9]]))).toEqual([b, a]);
  });
});

describe('the season rule (ADR-026 D5)', () => {
  it('the three boxes: in order, no gap, whole and 1 or more (C1, C3, C4)', () => {
    expect(readPowerPlayBoxes(['4', '6', ''])).toEqual({ ok: true, steps: [4, 6] });
    expect(readPowerPlayBoxes(['', '', ''])).toEqual({ ok: true, steps: [] });
    expect(readPowerPlayBoxes(['5', '3', ''])).toMatchObject({ ok: false, box: 1, reason: 'Each box must be more than the one before (5). Not saved yet.' });
    expect(readPowerPlayBoxes(['4', '', '6'])).toMatchObject({ ok: false, box: 2, reason: 'Fill the 2nd box first.' });
    expect(powerPlayLine([4, 6])).toBe('Behind by 4: 1 extra · 6: 2 extra. The clock prompts you; it never adds anyone.');
    expect(powerPlayLine([])).toBe('No power play prompts this season. Many leagues use 4, then 6.');
  });

  it('is its own record per season, latest wins, and folds back (C2, C5)', () => {
    const season = uuid();
    let ledger = emptyLedger(squadId, 'Test FC', new Date('2026-11-08T10:00:00Z'));
    const r1 = setPowerPlayRule(ledger, season, [4, 6], new Date());
    if (!r1.ok) throw new Error(r1.reason);
    ledger = r1.ledger;
    expect(ledger.powerPlayRules.get(season)).toEqual([4, 6]);
    const recs = ledger.entries.flatMap((e) => e.records).filter((r) => r.type === 'power-play-rule');
    expect(recs).toEqual([{ type: 'power-play-rule', season, steps: [4, 6], note: null }]);
    const r2 = setPowerPlayRule(ledger, season, [5], new Date());
    if (!r2.ok) throw new Error(r2.reason);
    expect(r2.ledger.powerPlayRules.get(season)).toEqual([5]);
    expect(setPowerPlayRule(ledger, season, [6, 4], new Date()).ok).toBe(false);
  });
});
