/**
 * The frozen 1.2.0 reader (`fixtures/reader-1.2.0/`) is what older phones run
 * (ADR-021 D1). Tests read this build's files with it, so it must stay exactly
 * as released: a reader edited to pass would prove nothing.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const FROZEN: Record<string, string> = {
  'entrySigning.ts': 'ef8087c96b415ad11fa7542b78468357d9e44ba2cec13d32cb1d0431119c759e',
  'ledger.ts': '95797a6234cb9d06caa2f086f3f7bf1dea66bb7dc68baa1ff44b091e89c124d4',
  'ledgerChain.ts': '65ea715bb05cb4438505d1a872f2b0fbb30d4f953a2770f2eabb0d64a3b9eb10',
  'sha256.ts': 'b2b6ba6327f63493da5947cca4be11fade90d0aec644e4c9aebcb97729cbad1f',
  'types.ts': 'dac4fba49977c7d257e13053906bffe322a14b7a2318249122f0b115eb677734',
};

describe('the released 1.2.0 reader is frozen', () => {
  it.each(Object.entries(FROZEN))('%s is unedited', (file, sha) => {
    const text = readFileSync(resolve(__dirname, 'fixtures', 'reader-1.2.0', file));
    expect(createHash('sha256').update(text).digest('hex')).toBe(sha);
  });
});

// ---------------------------------------------------------------------------
// #249 L50: a record with 9- and 11-a-side matches and seasons, read by the
// frozen 1.2.0 reader: parsed, the seasons carried untouched, and every
// child's pitch minutes the same as this build's, to the second.
// ---------------------------------------------------------------------------

import { MatchEngine } from '../engine/MatchEngine';
import { uuid, type Format, type Player, type UUID } from '../types/index';
import * as released from './fixtures/reader-1.2.0/ledger';
import { FIRST_SEASON_ID, emptyLedger, foldLedger, recordMatches, saveSeason, serialiseLedger, type Ledger } from './ledger';
import { teamSheetFor } from './lineup';
import { currentQuarter } from './matchClock';
import { mergeCurrentMatch } from './persistence';
import { makeFormat } from './shapes';
import { makePlayer } from './squad';

const MIN = 60_000;

/** A closed match in halves, the bench coming on halfway through each half for the front of the pitch. */
function play(players: Player[], squadId: UUID, format: Format, totalMinutes: number, kickoffAt: string) {
  let now = Date.parse(kickoffAt);
  const engine = new MatchEngine({ nowFn: () => new Date(now) });
  const state = engine.createMatch(squadId, format.id, {
    opponent: 'Sample Rovers',
    kickoffAt,
    competition: 'league',
    totalMinutes,
    quarterCount: 2,
    availablePlayerIds: players.map((p) => p.id),
  });
  const ids = players.map((p) => p.id);
  const k = format.onFieldCount;
  const half = (totalMinutes * MIN) / 2;
  for (let p = 0; p < 2; p++) {
    const on = ids.slice(0, k);
    const quarter = currentQuarter(state)!;
    engine.startQuarter(state, quarter, teamSheetFor(on, on[0], format), format);
    now += half / 2;
    ids.slice(k).forEach((bench, i) => engine.substitute(state, quarter, on[k - 1 - i], bench));
    now += half / 2;
    engine.endQuarter(state, quarter);
  }
  engine.completeMatch(state);
  return mergeCurrentMatch([], state, format)[0];
}

describe('the released 1.2.0 reader reads 9- and 11-a-side (#249 L50, ADR-021 D1)', () => {
  it('parses the record, keeps the 9- and 11-a-side seasons, and gives every child the same minutes', () => {
    const squadId = uuid();
    const names = ['Ava', 'Ben', 'Cal', 'Dee', 'Eli', 'Fay', 'Gus', 'Hal', 'Ivy', 'Jo', 'Kai', 'Lia', 'Mo', 'Ned'];
    const players = names.map((n) => ({ ...makePlayer(squadId, n), createdAt: '2026-01-01T00:00:00.000Z' }));
    const NOW = new Date('2026-10-30T09:00:00Z');
    let ledger: Ledger = emptyLedger(squadId, 'Test FC', NOW);
    const nine = play(players.slice(0, 12), squadId, makeFormat('3-3-2'), 60, '2026-10-17T09:00:00Z');
    const eleven = play(players, squadId, makeFormat('4-4-2'), 70, '2026-10-24T09:00:00Z');
    ledger = recordMatches(ledger, [nine, eleven], players, 'Test FC', NOW);
    for (const [id, side] of [[FIRST_SEASON_ID, 9], [uuid(), 11]] as const) {
      const saved = saveSeason(ledger, { id, name: `S${side}`, mainSide: side, ageGroup: 'U12', level: 'development' }, NOW);
      if (!saved.ok) throw new Error(saved.reason);
      ledger = saved.ledger;
    }
    expect(ledger.matches.map((m) => [m.structure?.shape, m.structure?.onField])).toEqual([
      ['3-3-2', 9],
      ['4-4-2', 11],
    ]);

    const old = released.parseLedger(serialiseLedger(ledger));
    if (!old.ok) throw new Error(old.reason);
    const seasons = JSON.stringify(old.ledger.entries);
    expect(seasons).toContain('"mainSide":9');
    expect(seasons).toContain('"mainSide":11');

    const mine = new Map(foldLedger(ledger).map((t) => [t.playerId, t]));
    const theirs = released.foldLedger(old.ledger);
    expect(theirs).toHaveLength(names.length);
    for (const t of theirs) {
      const m = mine.get(t.playerId as UUID)!;
      expect(m.outfieldMs + m.goalkeeperMs).toBeGreaterThan(0);
      expect(Math.floor(t.outfieldMs / 1000)).toBe(Math.floor(m.outfieldMs / 1000));
      expect(Math.floor(t.goalkeeperMs / 1000)).toBe(Math.floor(m.goalkeeperMs / 1000));
    }
  });
});
