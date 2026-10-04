/**
 * Ledger forward-compatibility — #99 AC2, ADR-013 addendum.
 *
 * A minutes file written by a NEWER build, read by this one. Every field this
 * build does not know must survive read → record → merge → export, at every
 * level; a file that declares this build unsafe must be refused, not
 * silently downgraded. The "v2" file here is synthetic: no such version
 * exists yet. Synthetic first names only.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MatchEngine } from '../engine/MatchEngine';
import { uuid } from '../types/index';
import type { Player } from '../types/index';
import { makePlayer } from './squad';
import { makeFormat } from './shapes';
import { toTeamSheet, sheetFromSelection } from './teamSheet';
import {
  LEDGER_READER_VERSION,
  LEDGER_VERSION,
  emptyLedger,
  foldLedger,
  mergeLedger,
  parseLedger,
  recordMatches,
  serialiseLedger,
  type Ledger,
} from './ledger';
import {
  LEDGER_STORAGE_KEY,
  UNREADABLE_LEDGER_PREFIX,
  loadLedger,
  openStoredLedger,
  readStoredLedger,
} from './ledgerStore';
import { createMemoryStore } from './persistence';

const MIN = 60_000;
const NOW = new Date('2026-10-04T12:00:00Z');

/** One half played: a sub at 10:00 and a goal at 12:00. */
function played() {
  let nowMs = 1_700_000_000_000;
  const engine = new MatchEngine({ nowFn: () => new Date(nowMs) });
  const format = makeFormat('2-3-1');
  const squadId = uuid();
  const players: Player[] = ['Ava', 'Ben', 'Cal', 'Dan', 'Eve', 'Fin', 'Gus', 'Hal'].map((n) =>
    makePlayer(squadId, n)
  );
  const ids = players.map((p) => p.id);
  const state = engine.createMatch(squadId, format.id, { totalMinutes: 50, quarterCount: 2 });
  const sheet = toTeamSheet(sheetFromSelection(ids.slice(0, 7), ids[0], format));
  engine.startQuarter(state, state.quarters[0], sheet, format);
  nowMs += 10 * MIN;
  engine.substitute(state, state.quarters[0], ids[6], ids[7]);
  nowMs += 2 * MIN;
  engine.recordEvent(state, state.quarters[0], 'goal', ids[3]);
  nowMs += 13 * MIN;
  engine.endQuarter(state, state.quarters[0]);
  const ledger = recordMatches(emptyLedger(squadId, 'Test FC'), [state], players, 'Test FC', NOW);
  return { state, players, squadId, ledger };
}

/**
 * The file a hypothetical v2 build would write from the same match: every
 * level carries a field v1 does not know, plus an event of a kind v1 does not
 * know, and it says a v1 reader may carry it.
 */
function v2File(ledger: Ledger) {
  const doc = JSON.parse(serialiseLedger(ledger));
  doc.ledgerVersion = 2;
  doc.minReaderVersion = 1;
  doc.club = { colours: 'blue' };
  doc.squad.ageGroup = 'U10';
  doc.players[0].preferredFoot = 'left';
  doc.matches[0].venue = 'Home';
  doc.matches[0].intervals[0].heartRate = 150;
  doc.matches[0].events[0].assistBy = doc.players[1].id;
  doc.matches[0].events.push({
    id: 'event-from-v2',
    kind: 'assist',
    playerId: doc.players[2].id,
    period: 1,
    atMs: 12 * MIN,
    refersTo: null,
    note: null,
    shotDistance: 'close',
  });
  return doc;
}

/** Every v2 field, read back from a written file. */
function expectV2Fields(text: string) {
  const out = JSON.parse(text);
  expect(out.ledgerVersion).toBe(2);
  expect(out.minReaderVersion).toBe(1);
  expect(out.club).toEqual({ colours: 'blue' });
  expect(out.squad.ageGroup).toBe('U10');
  const ava = out.players.find((p: { preferredFoot?: string }) => p.preferredFoot);
  expect(ava?.preferredFoot).toBe('left');
  expect(out.matches[0].venue).toBe('Home');
  expect(out.matches[0].intervals.some((i: { heartRate?: number }) => i.heartRate === 150)).toBe(true);
  expect(out.matches[0].events.some((e: { assistBy?: string }) => typeof e.assistBy === 'string')).toBe(true);
  expect(out.matches[0].events.find((e: { id: string }) => e.id === 'event-from-v2')).toMatchObject({
    kind: 'assist',
    shotDistance: 'close',
  });
}

describe('a newer file keeps every field this build does not know (#99 AC2)', () => {
  it('through parse and export', () => {
    const { ledger } = played();
    const parsed = parseLedger(JSON.stringify(v2File(ledger)));
    if (!parsed.ok) throw new Error(parsed.reason);
    expectV2Fields(serialiseLedger(parsed.ledger));
  });

  it('through parse → record → merge → export: the whole path a phone takes', () => {
    const { ledger, state, players, squadId } = played();
    const text = JSON.stringify(v2File(ledger));

    // Imported onto a fresh phone, which then plays on: the same match is
    // recorded again from its own appearances and events on every save.
    const parsed = parseLedger(text);
    if (!parsed.ok) throw new Error(parsed.reason);
    const merged = mergeLedger(emptyLedger(uuid(), ''), parsed.ledger, NOW);
    const recorded = recordMatches(merged.ledger, [state], players, 'Test FC', NOW);
    expectV2Fields(serialiseLedger(recorded));

    // And merged the other way: this phone's own v1 copy of the same match,
    // then the v2 file imported over it. Nothing conflicts, so nothing is
    // added — but the file's extra fields must still reach this phone's copy.
    const mine = recordMatches(emptyLedger(squadId, 'Test FC'), [state], players, 'Test FC', NOW);
    const again = mergeLedger(mine, parsed.ledger, NOW);
    expect(again.conflicts).toEqual([]);
    expect(again.addedMatches + again.addedPlayers).toBe(0);
    expectV2Fields(serialiseLedger(again.ledger));
    // The minutes are the same minutes.
    expect(foldLedger(again.ledger)).toEqual(foldLedger(mine));
  });

  it('this phone’s known values win a conflict; the file’s unknown ones are still added', () => {
    const { ledger, players, squadId, state } = played();
    const doc = v2File(ledger);
    doc.players[0].firstName = 'Renamed';
    const parsed = parseLedger(JSON.stringify(doc));
    if (!parsed.ok) throw new Error(parsed.reason);
    const mine = recordMatches(emptyLedger(squadId, 'Test FC'), [state], players, 'Test FC', NOW);
    const report = mergeLedger(mine, parsed.ledger, NOW);
    expect(report.conflicts).toHaveLength(1);
    const kept = report.ledger.players.find((p) => p.id === doc.players[0].id)!;
    expect(kept.firstName).toBe(players.find((p) => p.id === kept.id)!.firstName);
    expect((kept as unknown as Record<string, unknown>).preferredFoot).toBe('left');
  });

  it('a second import of the same newer file changes nothing', () => {
    const { ledger } = played();
    const parsed = parseLedger(JSON.stringify(v2File(ledger)));
    if (!parsed.ok) throw new Error(parsed.reason);
    const once = mergeLedger(emptyLedger(uuid(), ''), parsed.ledger, NOW).ledger;
    const twice = mergeLedger(once, parsed.ledger, NOW);
    expect(twice.addedPlayers + twice.addedMatches + twice.addedIntervals).toBe(0);
    expect(twice.ledger).toEqual(once);
  });
});

describe('a file this build cannot safely write back is refused (#99 AC2)', () => {
  const tooNew = () => {
    const doc = v2File(played().ledger);
    doc.minReaderVersion = LEDGER_READER_VERSION + 1;
    return JSON.stringify(doc);
  };

  it('refuses a minReaderVersion above this build’s, in plain English, and marks it too new', () => {
    const r = parseLedger(tooNew());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.tooNew).toBe(true);
    expect(r.reason).toBe(
      'This minutes file was saved by a newer version of the app (format 2, needs 2). ' +
        'Update the app to use it. Nothing has been changed.'
    );
  });

  it('refuses it before any structural check: a newer shape is not "damaged"', () => {
    const doc = JSON.parse(tooNew());
    doc.matches = { reshaped: true };
    const r = parseLedger(JSON.stringify(doc));
    expect(!r.ok && r.tooNew).toBe(true);
  });

  it('refuses a damaged minReaderVersion rather than guessing', () => {
    for (const bad of ['1', 0, 1.5, null]) {
      const doc = v2File(played().ledger);
      doc.minReaderVersion = bad;
      const r = parseLedger(JSON.stringify(doc));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.tooNew).toBeUndefined();
    }
  });

  it('reports a stored too-new ledger as too new, not as missing (which would be written over)', async () => {
    const store = createMemoryStore();
    await store.setItem(LEDGER_STORAGE_KEY, tooNew());
    const read = await readStoredLedger(store);
    expect(read.status).toBe('too_new');
    expect(await loadLedger(store)).toBeNull();
    await store.setItem(LEDGER_STORAGE_KEY, '{not json');
    expect((await readStoredLedger(store)).status).toBe('unreadable');
    await store.removeItem(LEDGER_STORAGE_KEY);
    expect((await readStoredLedger(store)).status).toBe('empty');
  });
});

describe('v1 files and this build’s own writing', () => {
  it('reads the committed v1 fixture, which has no minReaderVersion, as reader version 1', () => {
    const r = parseLedger(readFileSync(join(__dirname, 'fixtures', 'ledger-v1.json'), 'utf-8'));
    if (!r.ok) throw new Error(r.reason);
    expect(r.ledger.ledgerVersion).toBe(1);
    expect(r.ledger.minReaderVersion).toBe(1);
  });

  it('writes ledgerVersion 1 and minReaderVersion 1', () => {
    const out = JSON.parse(serialiseLedger(played().ledger));
    expect(out.ledgerVersion).toBe(LEDGER_VERSION);
    expect(LEDGER_VERSION).toBe(1);
    expect(out.minReaderVersion).toBe(1);
  });
});

describe('opening the stored ledger never loses it (QA on #110)', () => {
  const at = new Date('2026-10-04T09:30:00Z');
  const v1 = () => serialiseLedger(emptyLedger(uuid(), 'Test FC'));

  it('carries on from a healthy ledger, and starts one when there is none', async () => {
    const store = createMemoryStore();
    expect(await openStoredLedger(store, at)).toEqual({ ledger: null, writable: true, message: '' });
    await store.setItem(LEDGER_STORAGE_KEY, v1());
    const opened = await openStoredLedger(store, at);
    expect(opened.writable).toBe(true);
    expect(opened.ledger).not.toBeNull();
    expect(opened.message).toBe('');
  });

  it('sets an unreadable ledger aside intact, proved by reading it back, before a new one starts', async () => {
    const store = createMemoryStore();
    await store.setItem(LEDGER_STORAGE_KEY, '{damaged');
    const opened = await openStoredLedger(store, at);
    expect(opened).toMatchObject({ ledger: null, writable: true });
    expect(opened.message).toMatch(/set aside unchanged/);
    expect(await store.getItem(`${UNREADABLE_LEDGER_PREFIX}${at.toISOString()}`)).toBe('{damaged');
  });

  it('writes nothing when the copy cannot be made, or the store cannot be read at all', async () => {
    const failingWrites = createMemoryStore();
    await failingWrites.setItem(LEDGER_STORAGE_KEY, '{damaged');
    failingWrites.setItem = async () => {
      throw new Error('disk full');
    };
    expect(await openStoredLedger(failingWrites, at)).toMatchObject({ ledger: null, writable: false });

    const unreadableStore = createMemoryStore();
    unreadableStore.getItem = async () => {
      throw new Error('I/O');
    };
    const opened = await openStoredLedger(unreadableStore, at);
    expect(opened).toMatchObject({ ledger: null, writable: false });
    expect(opened.message).toMatch(/Nothing has been changed or deleted/);
  });

  it('writes nothing over a ledger a newer build said this one must not write', async () => {
    const store = createMemoryStore();
    const doc = v2File(played().ledger);
    doc.minReaderVersion = LEDGER_READER_VERSION + 1;
    await store.setItem(LEDGER_STORAGE_KEY, JSON.stringify(doc));
    expect(await openStoredLedger(store, at)).toMatchObject({ ledger: null, writable: false });
  });
});
