/**
 * Tests for the minutes ledger — #75.
 *
 * The one that matters most is the golden fixture: a v1 ledger file committed
 * to the repository (synthetic names) that every future build must read to the
 * same totals. That is what "survives new versions" means in practice.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { MatchEngine } from '../engine/MatchEngine';
import { uuid } from '../types/index';
import type { Player, UUID } from '../types/index';
import { makePlayer } from './squad';
import { makeFormat } from './shapes';
import { foldPlayerMinutes } from './playerMinutes';
import { toTeamSheet, sheetFromSelection } from './teamSheet';
import {
  LEDGER_ID,
  emptyLedger,
  foldLedger,
  ledgerFileName,
  mergeLedger,
  parseLedger,
  recordMatches,
  serialiseLedger,
  seasonRows,
  describeMerge,
  type Ledger,
} from './ledger';

const MIN = 60_000;
const NOW = new Date('2026-10-03T12:00:00Z');

/** A two-half match: P1 in goal, P2–P7 out, P8 on for P7 at 10:00 of half 1. */
function playedMatch() {
  let nowMs = 1_700_000_000_000;
  const engine = new MatchEngine({ nowFn: () => new Date(nowMs) });
  const format = makeFormat('2-3-1');
  const squadId = uuid();
  const players: Player[] = Array.from({ length: 8 }, (_, i) => makePlayer(squadId, `P${i + 1}`));
  const ids = players.map((p) => p.id);
  const state = engine.createMatch(squadId, format.id, { totalMinutes: 50, quarterCount: 2 });
  const sheet = toTeamSheet(sheetFromSelection(ids.slice(0, 7), ids[0], format));

  engine.startQuarter(state, state.quarters[0], sheet, format);
  nowMs += 10 * MIN;
  engine.substitute(state, state.quarters[0], ids[6], ids[7]);
  nowMs += 15 * MIN;
  engine.endQuarter(state, state.quarters[0]);
  return { engine, state, players, ids, squadId, advance: (ms: number) => (nowMs += ms), format, sheet };
}

describe('recording (AC1, AC2)', () => {
  it('holds the closed intervals and folds to the same minutes the app shows', () => {
    const { engine, state, players, squadId } = playedMatch();
    const ledger = recordMatches(emptyLedger(squadId, 'Test FC'), [state], players, 'Test FC', NOW);
    const folded = new Map(foldLedger(ledger).map((t) => [t.playerId, t]));
    for (const m of foldPlayerMinutes(engine, state, players)) {
      expect(folded.get(m.playerId)!.outfieldMs).toBe(m.outfieldMs);
      expect(folded.get(m.playerId)!.goalkeeperMs).toBe(m.goalkeeperMs);
    }
  });

  it('leaves out a period still running: it has no end yet', () => {
    const { engine, state, players, squadId, advance, format, sheet } = playedMatch();
    engine.startQuarter(state, state.quarters[1], sheet, format);
    advance(5 * MIN);
    const ledger = recordMatches(emptyLedger(squadId, ''), [state], players, '', NOW);
    expect(ledger.matches[0].intervals.every((i) => i.period === 1)).toBe(true);
  });

  it('keeps nothing for a match never played', () => {
    const engine = new MatchEngine();
    const state = engine.createMatch(uuid(), uuid(), { totalMinutes: 50, quarterCount: 2 });
    expect(recordMatches(emptyLedger(uuid(), ''), [state], [], '', NOW).matches).toEqual([]);
  });

  it('never shrinks: a match missing from a later save keeps its minutes', () => {
    const { state, players, squadId } = playedMatch();
    const once = recordMatches(emptyLedger(squadId, ''), [state], players, '', NOW);
    const again = recordMatches(once, [], [], '', NOW);
    expect(again.matches).toHaveLength(1);
    expect(again.players).toHaveLength(8);
    // ...and a save that has lost some appearances keeps the ones it lost.
    const thinned = { ...state, appearances: state.appearances.slice(0, 2) };
    expect(recordMatches(once, [thinned], players, '', NOW).matches[0].intervals).toHaveLength(
      once.matches[0].intervals.length
    );
  });

  it('keeps a retired player and their name (#77)', () => {
    const { state, players, squadId } = playedMatch();
    const retired = players.map((p, i) => (i === 7 ? { ...p, active: false } : p));
    const ledger = recordMatches(emptyLedger(squadId, ''), [state], retired, '', NOW);
    expect(ledger.players.find((p) => p.id === players[7].id)).toMatchObject({
      firstName: 'P8',
      active: false,
    });
  });
});

describe('export and import (AC4, AC5, AC6)', () => {
  const recorded = () => {
    const { state, players, squadId } = playedMatch();
    return recordMatches(emptyLedger(squadId, 'Test FC'), [state], players, 'Test FC', NOW);
  };

  it('round-trips through a file to the second', () => {
    const ledger = recorded();
    const back = parseLedger(serialiseLedger(ledger));
    if (!back.ok) throw new Error(back.reason);
    expect(foldLedger(back.ledger)).toEqual(foldLedger(ledger));
  });

  it('AC6: a fresh install gets the squad and every minute back', () => {
    const source = recorded();
    const file = parseLedger(serialiseLedger(source));
    if (!file.ok) throw new Error(file.reason);
    const report = mergeLedger(emptyLedger(uuid(), ''), file.ledger, NOW);
    expect(report.addedPlayers).toBe(8);
    expect(report.addedMatches).toBe(1);
    expect(report.ledger.squad).toEqual(source.squad);
    expect(foldLedger(report.ledger)).toEqual(foldLedger(source));
  });

  it('AC5: importing the same file twice changes nothing', () => {
    const source = recorded();
    const file = parseLedger(serialiseLedger(source));
    if (!file.ok) throw new Error(file.reason);
    const twice = mergeLedger(source, file.ledger, NOW);
    expect(twice.addedPlayers + twice.addedMatches + twice.addedIntervals).toBe(0);
    expect(twice.conflicts).toEqual([]);
    expect(twice.ledger).toEqual(source);
  });

  it('AC5: a conflicting entry keeps this phone’s and says so', () => {
    const mine = recorded();
    const theirs: Ledger = JSON.parse(JSON.stringify(mine));
    theirs.players[0].firstName = 'Renamed';
    theirs.matches[0].intervals[0].endMs += MIN;
    const report = mergeLedger(mine, theirs, NOW);
    expect(report.conflicts).toHaveLength(2);
    expect(report.ledger.players[0].firstName).toBe(mine.players[0].firstName);
    expect(foldLedger(report.ledger)).toEqual(foldLedger(mine));
  });

  it('refuses a file whose summary disagrees with its intervals', () => {
    const text = serialiseLedger(recorded());
    const doc = JSON.parse(text);
    doc.summary[0].outfieldMs += 1000;
    const result = parseLedger(JSON.stringify(doc));
    expect(result.ok).toBe(false);
  });

  it('refuses things that are not a minutes file, with a reason', () => {
    for (const bad of ['not json', '{}', JSON.stringify({ ledger: LEDGER_ID })]) {
      const r = parseLedger(bad);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason.length).toBeGreaterThan(10);
    }
  });

  it('reads a later version, ignoring fields it does not know (AC3)', () => {
    const doc = JSON.parse(serialiseLedger(recorded()));
    doc.ledgerVersion = 7;
    doc.somethingNew = { analytics: true };
    doc.matches[0].intervals[0].heartRate = 150;
    const r = parseLedger(JSON.stringify(doc));
    expect(r.ok).toBe(true);
  });

  it('names the file by date', () => {
    expect(ledgerFileName(NOW)).toBe('minutes-2026-10-03.json');
  });
});

describe('AC3 — the committed v1 ledger still loads', () => {
  it('reads fixtures/ledger-v1.json to the totals it was written with', () => {
    const text = readFileSync(join(__dirname, 'fixtures', 'ledger-v1.json'), 'utf-8');
    const r = parseLedger(text);
    if (!r.ok) throw new Error(r.reason);
    const totals = new Map(foldLedger(r.ledger).map((t) => [t.playerId, t] as [UUID, typeof t]));
    // Written by hand from the AC4 example on #72 (synthetic names): one half.
    expect(totals.get('p1' as UUID)).toEqual({ playerId: 'p1', outfieldMs: 0, goalkeeperMs: 25 * MIN });
    expect(totals.get('p5' as UUID)!.outfieldMs).toBe(7.5 * MIN);
    expect(totals.get('p8' as UUID)!.outfieldMs).toBe(17.5 * MIN);
    expect(r.ledger.players.find((p) => p.id === 'p8')!.active).toBe(false);
  });
});

describe('season minutes and import messages', () => {
  it('lists every player with their season minutes, most outfield first', () => {
    const r = parseLedger(readFileSync(join(__dirname, 'fixtures', 'ledger-v1.json'), 'utf-8'));
    if (!r.ok) throw new Error(r.reason);
    const rows = seasonRows(r.ledger);
    expect(rows[0].outfieldMs).toBe(25 * MIN);
    expect(rows.find((x) => x.playerId === 'p8')).toMatchObject({ name: 'Player8', retired: true });
    expect(rows.find((x) => x.playerId === 'p1')!.goalkeeperMs).toBe(25 * MIN);
  });

  it('says plainly what an import did', () => {
    const none = { addedPlayers: 0, addedMatches: 0, addedIntervals: 0, skipped: 9, conflicts: [] };
    expect(describeMerge(none)).toBe('Nothing new in that file — everything in it is already here.');
    expect(
      describeMerge({ ...none, addedMatches: 2, addedIntervals: 30, addedPlayers: 1, conflicts: ['x'] })
    ).toBe("Added 2 matches and 1 player. 1 entry differs from this phone; this phone's was kept.");
  });
});
