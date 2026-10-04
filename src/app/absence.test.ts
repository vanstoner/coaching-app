/**
 * Marking a player absent before kick-off — #102 AC1, AC2. Synthetic names.
 */

import { describe, expect, it } from 'vitest';
import { MatchEngine } from '../engine/MatchEngine';
import { uuid } from '../types/index';
import { makePlayer } from './squad';
import { makeFormat } from './shapes';
import { toTeamSheet, sheetFromSelection } from './teamSheet';
import { suggestLineup } from './lineup';
import { foldPlayerMinutes } from './playerMinutes';
import { absentIds, beforeKickoff, markAbsent, pickablePlayers } from './absence';
import { emptyLedger, recordMatches } from './ledger';
import { gamesMissed } from './attendance';

function setUp() {
  const engine = new MatchEngine({ nowFn: () => new Date(1_700_000_000_000) });
  const format = makeFormat('2-3-1');
  const squadId = uuid();
  const players = ['Ava', 'Ben', 'Cal', 'Dan', 'Eve', 'Fin', 'Gus', 'Hal', 'Ivy'].map((n) =>
    makePlayer(squadId, n)
  );
  const ids = players.map((p) => p.id);
  const state = engine.createMatch(squadId, format.id, {
    totalMinutes: 50,
    quarterCount: 2,
    availablePlayerIds: ids,
  });
  return { engine, format, players, ids, state, squadId };
}

describe('AC1: mark absent before kick-off', () => {
  it('everyone is present by default', () => {
    const { state, players } = setUp();
    expect(absentIds(state).size).toBe(0);
    expect(pickablePlayers(players, state)).toEqual(players);
  });

  it('an absent player cannot be picked, or suggested', () => {
    const { engine, state, players, ids, format } = setUp();
    expect(markAbsent(engine, state, ids[0], true)).toBe(true);
    const pickable = pickablePlayers(players, state);
    expect(pickable.map((p) => p.id)).not.toContain(ids[0]);
    const s = suggestLineup(pickable, foldPlayerMinutes(engine, state, pickable), format);
    expect([...s.onPitch, ...s.bench]).not.toContain(ids[0]);
  });

  it('can be marked present again before kick-off', () => {
    const { engine, state, players, ids } = setUp();
    markAbsent(engine, state, ids[0], true);
    markAbsent(engine, state, ids[0], false);
    expect(pickablePlayers(players, state)).toEqual(players);
  });

  it('an absent player gets no bench time: they were not there', () => {
    const { engine, state, ids, format } = setUp();
    markAbsent(engine, state, ids[8], true);
    engine.startQuarter(state, state.quarters[0], toTeamSheet(sheetFromSelection(ids.slice(0, 7), ids[0], format)), format);
    expect(state.benchStints.map((b) => b.playerId)).toEqual([ids[7]]);
  });
});

describe('AC2: recorded at kick-off; after it, only a noted correction', () => {
  it('reaches the ledger as the kick-off snapshot', () => {
    const { engine, state, ids, format, players, squadId } = setUp();
    markAbsent(engine, state, ids[8], true);
    engine.startQuarter(state, state.quarters[0], toTeamSheet(sheetFromSelection(ids.slice(0, 7), ids[0], format)), format);
    const ledger = recordMatches(emptyLedger(squadId, ''), [state], players, '', new Date(0));
    expect(ledger.matches[0].attendance!.find((a) => a.playerId === ids[8])!.status).toBe('absent');
    state.match.status = 'completed';
    expect(gamesMissed(recordMatches(ledger, [state], players, '', new Date(0)), ids[8])).toBe(1);
  });

  it('cannot be changed here after kick-off', () => {
    const { engine, state, ids, format } = setUp();
    engine.startQuarter(state, state.quarters[0], toTeamSheet(sheetFromSelection(ids.slice(0, 7), ids[0], format)), format);
    expect(beforeKickoff(state)).toBe(false);
    expect(markAbsent(engine, state, ids[8], true)).toBe(false);
    expect(state.playerAvailability.get(ids[8])).toBe('available');
  });
});
