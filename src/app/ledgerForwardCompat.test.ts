/**
 * Ledger forward-compatibility — #99 AC2, ADR-013 addendum, ADR-014 §10.
 *
 * A minutes file written by a NEWER build, read by this one. Every field and
 * record type this build does not know must survive read → record → import →
 * export; a file that declares this build unsafe must be refused, never
 * written back. The "v3" file here is synthetic: no such version exists.
 * Synthetic first names only.
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
  importLedger,
  parseLedger,
  recordMatches,
  serialiseLedger,
  type Ledger,
  type LedgerEntry,
} from './ledger';
import { hashOf } from './ledgerChain';
import {
  LEDGER_STORAGE_KEY,
  LEDGER_V1_STORAGE_KEY,
  UNREADABLE_LEDGER_PREFIX,
  loadLedger,
  openStoredLedger,
  readStoredLedger,
  saveLedger,
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
  for (const id of ids) engine.setAvailability(state, id, 'available');
  engine.startQuarter(state, state.quarters[0], sheet, format);
  // Recorded at kick-off, as the app does: the attendance snapshot.
  const kicked = recordMatches(emptyLedger(squadId, 'Test FC', NOW), [state], players, 'Test FC', NOW);
  nowMs += 10 * MIN;
  engine.substitute(state, state.quarters[0], ids[6], ids[7]);
  nowMs += 2 * MIN;
  engine.recordEvent(state, state.quarters[0], 'goal', ids[3]);
  nowMs += 13 * MIN;
  engine.endQuarter(state, state.quarters[0]);
  const ledger = recordMatches(kicked, [state], players, 'Test FC', NOW);
  return { state, players, squadId, ledger };
}

/** Re-link and re-hash a chain after editing it, as its own writer would have. */
function rehash(entries: LedgerEntry[]): LedgerEntry[] {
  const out: LedgerEntry[] = [];
  for (const e of entries) {
    const body = { ...e, seq: out.length, prev: out.length ? out[out.length - 1].hash : null };
    out.push({ ...body, hash: hashOf(body) });
  }
  return out;
}

/**
 * The file a hypothetical v3 build would write: fields this build does not
 * know on the file, an entry and every record type, plus a record of a type
 * this build does not know — all hashed by their writer. It says a v2 reader
 * may carry it.
 */
function v3File(ledger: Ledger) {
  const doc = JSON.parse(serialiseLedger(ledger));
  doc.ledgerVersion = 3;
  doc.minReaderVersion = 2;
  doc.club = { colours: 'blue' };
  const entries: LedgerEntry[] = doc.entries;
  entries[1].device = 'tablet';
  for (const r of entries.flatMap((e) => e.records)) {
    if (r.type === 'squad') r.ageGroup = 'U10';
    if (r.type === 'player' && r.firstName === 'Ava') r.preferredFoot = 'left';
    if (r.type === 'match') r.venue = 'Home';
    if (r.type === 'interval') r.heartRate = 150;
    if (r.type === 'event') r.assistBy = 'someone';
    if (r.type === 'attendance') r.arrivedAt = '09:15';
  }
  entries[1].records.push({ type: 'weather', matchId: 'x', sky: 'grey' });
  doc.entries = rehash(entries);
  return doc;
}

/** Every v3 field, read back from a written file. */
function expectV3Fields(text: string) {
  const out = JSON.parse(text);
  expect(out.ledgerVersion).toBe(3);
  expect(out.minReaderVersion).toBe(2);
  expect(out.club).toEqual({ colours: 'blue' });
  const entries: LedgerEntry[] = out.entries;
  expect(entries[1].device).toBe('tablet');
  const records = entries.flatMap((e) => e.records);
  expect(records.some((r) => r.type === 'squad' && r.ageGroup === 'U10')).toBe(true);
  expect(records.some((r) => r.type === 'player' && r.preferredFoot === 'left')).toBe(true);
  expect(records.some((r) => r.type === 'match' && r.venue === 'Home')).toBe(true);
  expect(records.some((r) => r.type === 'interval' && r.heartRate === 150)).toBe(true);
  expect(records.some((r) => r.type === 'event' && r.assistBy === 'someone')).toBe(true);
  expect(records.some((r) => r.type === 'attendance' && r.arrivedAt === '09:15')).toBe(true);
  expect(records.some((r) => r.type === 'weather' && r.sky === 'grey')).toBe(true);
}

describe('a newer file keeps every field this build does not know (#99 AC2)', () => {
  it('through parse and export', () => {
    const { ledger } = played();
    const parsed = parseLedger(JSON.stringify(v3File(ledger)));
    if (!parsed.ok) throw new Error(parsed.reason);
    expectV3Fields(serialiseLedger(parsed.ledger));
  });

  it('through parse → import → record → export: the whole path a phone takes', () => {
    const { ledger, state, players } = played();
    const parsed = parseLedger(JSON.stringify(v3File(ledger)));
    if (!parsed.ok) throw new Error(parsed.reason);
    const imported = importLedger(emptyLedger(uuid(), '', NOW), parsed.ledger);
    if (!imported.ok) throw new Error(imported.reason);
    // The phone plays on: the same match recorded again from its own records.
    const recorded = recordMatches(imported.ledger, [state], players, 'Test FC', NOW);
    expectV3Fields(serialiseLedger(recorded));
    // Unknown fields on a known record are carried, so re-recording the same
    // facts is not a change: nothing appended.
    expect(recorded).toBe(imported.ledger);
    expect(foldLedger(recorded)).toEqual(foldLedger(ledger));
  });
});

describe('a file this build cannot safely write back is refused (#99 AC2, ADR-014 §10)', () => {
  const tooNew = () => {
    const doc = v3File(played().ledger);
    doc.minReaderVersion = LEDGER_READER_VERSION + 1;
    return JSON.stringify(doc);
  };

  it('refuses a minReaderVersion above this build’s, in plain English, and marks it too new', () => {
    const r = parseLedger(tooNew());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.tooNew).toBe(true);
    expect(r.reason).toBe(
      'This minutes file was saved by a newer version of the app (format 3, needs 3). ' +
        'Update the app to use it. Nothing has been changed.'
    );
    // Verified and viewable, never written (ADR-014 §10).
    expect(r.view?.matches).toHaveLength(1);
  });

  it('refuses it before any structural check: a newer shape is not "damaged"', () => {
    const doc = JSON.parse(tooNew());
    doc.entries = { reshaped: true };
    const r = parseLedger(JSON.stringify(doc));
    expect(!r.ok && r.tooNew).toBe(true);
  });

  it('refuses a damaged minReaderVersion rather than guessing', () => {
    for (const bad of ['1', 0, 1.5, null]) {
      const doc = v3File(played().ledger);
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

  it('does not append to a too-new ledger even if handed one', () => {
    const { state, players } = played();
    const view = parseLedger(tooNew());
    if (view.ok || !view.view) throw new Error('expected a view');
    expect(recordMatches(view.view, [state], players, 'x', NOW)).toBe(view.view);
  });
});

describe('v1 files and this build’s own writing', () => {
  it('reads the committed v1 fixture, which has no minReaderVersion, by upgrading it', () => {
    const r = parseLedger(readFileSync(join(__dirname, 'fixtures', 'ledger-v1.json'), 'utf-8'));
    if (!r.ok) throw new Error(r.reason);
    expect(r.ledger.ledgerVersion).toBe(2);
    expect(r.ledger.minReaderVersion).toBe(2);
    expect(r.ledger.entries).toHaveLength(1);
    expect(r.ledger.entries[0]).toMatchObject({ seq: 0, prev: null, kind: 'genesis', from: 'v1' });
  });

  it('writes ledgerVersion 2 and minReaderVersion 2, so a v1 reader refuses to write it back', () => {
    const out = JSON.parse(serialiseLedger(played().ledger));
    expect(LEDGER_VERSION).toBe(2);
    expect(out.ledgerVersion).toBe(2);
    // A #99 v1 reader refuses any minReaderVersion above 1 and writes nothing.
    expect(out.minReaderVersion).toBe(2);
    // A pre-#99 v1 reader requires these arrays and refuses the file without them.
    expect(out.players).toBeUndefined();
    expect(out.matches).toBeUndefined();
  });
});

describe('opening the stored ledger never loses it (#100 AC7, QA on #110)', () => {
  const at = new Date('2026-10-04T09:30:00Z');
  const v2 = () => serialiseLedger(emptyLedger(uuid(), 'Test FC', at));

  it('carries on from a healthy ledger, and starts one when there is none', async () => {
    const store = createMemoryStore();
    expect(await openStoredLedger(store, at)).toEqual({ ledger: null, writable: true, message: '' });
    await store.setItem(LEDGER_STORAGE_KEY, v2());
    const opened = await openStoredLedger(store, at);
    expect(opened.writable).toBe(true);
    expect(opened.ledger).not.toBeNull();
    expect(opened.message).toBe('');
  });

  it('upgrades a v1 ledger from its own key, and never writes that key', async () => {
    const store = createMemoryStore();
    const v1 = readFileSync(join(__dirname, 'fixtures', 'ledger-v1.json'), 'utf-8');
    await store.setItem(LEDGER_V1_STORAGE_KEY, v1);
    const opened = await openStoredLedger(store, at);
    expect(opened.ledger?.entries[0].from).toBe('v1');
    await saveLedger(store, opened.ledger!);
    expect(await store.getItem(LEDGER_V1_STORAGE_KEY)).toBe(v1);
    const again = await openStoredLedger(store, at);
    expect(again.ledger?.entries).toEqual(opened.ledger?.entries);
  });

  it('sets an unreadable ledger aside intact, proved by reading it back, before a new one starts', async () => {
    const store = createMemoryStore();
    await store.setItem(LEDGER_STORAGE_KEY, '{damaged');
    const opened = await openStoredLedger(store, at);
    expect(opened).toMatchObject({ ledger: null, writable: true });
    expect(opened.message).toMatch(/set aside unchanged/);
    const key = `${UNREADABLE_LEDGER_PREFIX}${at.toISOString()}`;
    expect(opened.follows).toBe(key);
    expect(await store.getItem(key)).toBe('{damaged');
    // The new chain says what it follows.
    expect(emptyLedger(uuid(), '', at, opened.follows).entries[0].follows).toBe(key);
  });

  it('ADR-014 §8: a stored chain that fails verification is set aside, never repaired, and says why', async () => {
    const store = createMemoryStore();
    const doc = JSON.parse(serialiseLedger(played().ledger));
    doc.entries[doc.entries.length - 1].records.find((r: { type: string }) => r.type === 'interval').endMs += MIN;
    delete doc.summary;
    const text = JSON.stringify(doc);
    await store.setItem(LEDGER_STORAGE_KEY, text);
    const opened = await openStoredLedger(store, at);
    expect(opened.ledger).toBeNull();
    expect(opened.message).toMatch(/cannot be trusted: the entry recorded on .* has been changed since it was written/);
    expect(await store.getItem(`${UNREADABLE_LEDGER_PREFIX}${at.toISOString()}`)).toBe(text);
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

  it('writes nothing over a ledger a newer build said this one must not write, but can show it', async () => {
    const store = createMemoryStore();
    const doc = v3File(played().ledger);
    doc.minReaderVersion = LEDGER_READER_VERSION + 1;
    await store.setItem(LEDGER_STORAGE_KEY, JSON.stringify(doc));
    const opened = await openStoredLedger(store, at);
    expect(opened).toMatchObject({ ledger: null, writable: false });
    expect(opened.view?.matches).toHaveLength(1);
  });
});
