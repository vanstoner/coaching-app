/**
 * Tests for the minutes ledger — #75, #100.
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
  importLedger,
  parseLedger,
  recordMatches,
  serialiseLedger,
  seasonRows,
  describeImport,
} from './ledger';

const MIN = 60_000;
const NOW = new Date('2026-10-03T12:00:00Z');

function parseOk(text: string) {
  const r = parseLedger(text);
  if (!r.ok) throw new Error(r.reason);
  return r.ledger;
}

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

  it('ADR-014 §2: one entry per recording that changes something; none when nothing does', () => {
    const { state, players, squadId } = playedMatch();
    const genesis = emptyLedger(squadId, 'Test FC', NOW);
    const once = recordMatches(genesis, [state], players, 'Test FC', NOW);
    expect(once.entries).toHaveLength(2);
    expect(recordMatches(once, [state], players, 'Test FC', NOW)).toBe(once);
  });

  it('ADR-014 §2: a revised interval is a new record; the earlier one stays in the chain', () => {
    const { state, players, squadId } = playedMatch();
    const once = recordMatches(emptyLedger(squadId, ''), [state], players, '', NOW);
    const a = state.appearances[0];
    const corrected = {
      ...state,
      appearances: state.appearances.map((x) =>
        x === a ? { ...x, endElapsedMs: (x.endElapsedMs as number) - MIN, corrected: true, correctionNote: 'late off' } : x
      ),
    };
    const twice = recordMatches(once, [corrected], players, '', NOW);
    expect(twice.entries).toHaveLength(once.entries.length + 1);
    expect(twice.entries[twice.entries.length - 1].records).toHaveLength(1);
    const revisions = twice.entries.flatMap((e) => e.records).filter((r) => r.id === a.id);
    expect(revisions.map((r) => r.corrected)).toEqual([false, true]);
    expect(twice.matches[0].intervals.find((i) => i.id === a.id)!.note).toBe('late off');
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
    expect(back.ledger.entries).toEqual(ledger.entries);
  });

  it('writes the chain and a summary, never the folded players or matches (ADR-014 §1)', () => {
    const doc = JSON.parse(serialiseLedger(recorded()));
    expect(Object.keys(doc).sort()).toEqual(
      ['entries', 'ledger', 'ledgerVersion', 'minReaderVersion', 'summary', 'writtenAt'].sort()
    );
  });

  it('AC6: a fresh install gets the squad and every minute back', () => {
    const source = recorded();
    const file = parseLedger(serialiseLedger(source));
    if (!file.ok) throw new Error(file.reason);
    const report = importLedger(emptyLedger(uuid(), '', NOW), file.ledger);
    if (!report.ok) throw new Error(report.reason);
    expect(report.addedPlayers).toBe(8);
    expect(report.addedMatches).toBe(1);
    expect(report.ledger.squad).toEqual(source.squad);
    expect(report.ledger.entries).toEqual(source.entries);
    expect(foldLedger(report.ledger)).toEqual(foldLedger(source));
  });

  it('importing the same file twice changes nothing', () => {
    const source = recorded();
    const twice = importLedger(source, parseOk(serialiseLedger(source)));
    if (!twice.ok) throw new Error(twice.reason);
    expect(twice.addedEntries).toBe(0);
    expect(twice.ledger).toBe(source);
  });

  // Replaces "a conflicting entry keeps this phone's and says so": ADR-014 §9
  // and #100 AC2 (PO ruling A) overturned merge-by-id. A diverged chain is
  // refused, and nothing is imported.
  it('#100 AC2: a file whose chain has diverged from this phone’s is refused', () => {
    const { state, players, squadId, engine, advance, format, sheet } = playedMatch();
    const base = recordMatches(emptyLedger(squadId, 'Test FC', NOW), [state], players, 'Test FC', NOW);
    // Two phones carry on from the same chain and each records something.
    const mine = recordMatches(base, [state], players, 'Renamed here', NOW);
    engine.startQuarter(state, state.quarters[1], sheet, format);
    advance(5 * MIN);
    engine.endQuarter(state, state.quarters[1]);
    const theirs = recordMatches(base, [state], players, 'Test FC', NOW);
    const r = importLedger(mine, parseOk(serialiseLedger(theirs)));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/differs from this phone's.*Nothing was imported/);
  });

  it('#100 AC2: a file that extends this phone’s chain is appended verbatim; an older one adds nothing', () => {
    const { state, players, squadId, engine, advance, format, sheet } = playedMatch();
    const mine = recordMatches(emptyLedger(squadId, 'Test FC', NOW), [state], players, 'Test FC', NOW);
    engine.startQuarter(state, state.quarters[1], sheet, format);
    advance(5 * MIN);
    engine.endQuarter(state, state.quarters[1]);
    const theirs = recordMatches(mine, [state], players, 'Test FC', NOW);
    const r = importLedger(mine, parseOk(serialiseLedger(theirs)));
    if (!r.ok) throw new Error(r.reason);
    expect(r.addedEntries).toBe(1);
    expect(r.ledger.entries.slice(0, mine.entries.length)).toEqual(mine.entries);
    expect(foldLedger(r.ledger)).toEqual(foldLedger(theirs));
    const older = importLedger(r.ledger, mine);
    expect(older.ok && older.addedEntries).toBe(0);
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

  it('reads a later version, carrying top-level fields it does not know (AC3)', () => {
    const doc = JSON.parse(serialiseLedger(recorded()));
    doc.ledgerVersion = 7;
    doc.somethingNew = { analytics: true };
    const back = parseOk(JSON.stringify(doc));
    expect(JSON.parse(serialiseLedger(back)).somethingNew).toEqual({ analytics: true });
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
    // #83 AC6: time per unit, from the unit on every interval.
    expect(rows.find((x) => x.playerId === 'p4')!.byUnit).toEqual({ GK: 0, DEF: 0, MID: 25 * MIN, ATT: 0 });
    expect(rows.find((x) => x.playerId === 'p7')!.byUnit.ATT).toBe(7.5 * MIN);
  });

  it('says plainly what an import did', () => {
    const ledger = emptyLedger(uuid(), '', NOW);
    const none = { ok: true as const, ledger, addedEntries: 0, addedPlayers: 0, addedMatches: 0 };
    expect(describeImport(none)).toBe('Nothing new in that file — everything in it is already here.');
    expect(describeImport({ ...none, addedEntries: 3, addedMatches: 2, addedPlayers: 1 })).toBe(
      'Added 2 matches and 1 player.'
    );
  });
});

describe('events in the ledger (#84 AC7, PO ruling 13)', () => {
  it('keeps goals and withdrawals, through a file and an import, idempotently', () => {
    const { engine, state, players, squadId, ids, advance, format, sheet } = playedMatch();
    engine.startQuarter(state, state.quarters[1], sheet, format);
    advance(MIN);
    const goal = engine.recordEvent(state, state.quarters[1], 'goal', ids[3]);
    engine.withdrawEvent(state, goal.id, 'wrong scorer');
    engine.recordEvent(state, state.quarters[1], 'goal', ids[4]);

    const ledger = recordMatches(emptyLedger(squadId, ''), [state], players, '', NOW);
    expect(ledger.matches[0].events).toHaveLength(3);
    expect(ledger.matches[0].events!.every((e) => e.period === 2)).toBe(true);

    const file = parseLedger(serialiseLedger(ledger));
    if (!file.ok) throw new Error(file.reason);
    expect(file.ledger.matches[0].events).toEqual(ledger.matches[0].events);

    const fresh = importLedger(emptyLedger(uuid(), '', NOW), file.ledger);
    if (!fresh.ok) throw new Error(fresh.reason);
    expect(fresh.ledger.matches[0].events).toHaveLength(3);
    const twice = importLedger(fresh.ledger, file.ledger);
    expect(twice.ok && twice.addedEntries).toBe(0);
    // Recording the same match again appends nothing.
    expect(recordMatches(ledger, [state], players, '', NOW)).toBe(ledger);
  });

  it('a v1 file with no events still loads (the field is optional)', () => {
    const r = parseLedger(readFileSync(join(__dirname, 'fixtures', 'ledger-v1.json'), 'utf-8'));
    expect(r.ok && r.ledger.matches[0].events).toBeUndefined();
  });
});
