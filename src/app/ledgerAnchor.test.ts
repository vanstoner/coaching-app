/**
 * The remembered chain head and the fingerprint — PO ruling N1 (#98).
 *
 * Every healthy path is dry-run first (CLAUDE.md: five of six CI failures
 * here were gates rejecting a correct artifact), then the two failures the
 * head exists for: newest entries cut off, and the last entry replaced.
 * Synthetic first names only.
 */

import { describe, expect, it } from 'vitest';
import { uuid } from '../types/index';
import type { UUID } from '../types/index';
import { makePlayer } from './squad';
import { createMemoryStore } from './persistence';
import { emptyLedger, importLedger, parseLedger, recordMatches, serialiseLedger, type Ledger } from './ledger';
import { hashOf, type LedgerEntry } from './ledgerChain';
import {
  anchorDamage,
  chainHead,
  exportedMessage,
  extendsHead,
  fingerprint,
  importedMessage,
  parseChainHead,
} from './ledgerAnchor';
import {
  LEDGER_HEAD_KEY,
  LEDGER_STORAGE_KEY,
  LEDGER_V1_STORAGE_KEY,
  UNREADABLE_LEDGER_PREFIX,
  clearLedger,
  openStoredLedger,
  saveLedger,
} from './ledgerStore';

const NOW = new Date('2026-10-04T12:00:00Z');

/**
 * One chain as it grew: `[k]` holds k + 1 entries — the genesis, then one
 * new player per entry. Each is a whole ledger, as a save writes it.
 */
function growth(n: number, squadId: UUID = uuid()): Ledger[] {
  let l = emptyLedger(squadId, 'Test FC', NOW);
  const out = [l];
  const names = ['Ava', 'Ben', 'Cal', 'Dan', 'Eve', 'Fin', 'Gus', 'Hal'];
  const players = [];
  for (let i = 1; i < n; i++) {
    players.push(makePlayer(squadId, names[i - 1]));
    l = recordMatches(l, [], players, 'Test FC', new Date(NOW.getTime() + i * 60_000));
    out.push(l);
  }
  expect(l.entries).toHaveLength(n);
  return out;
}

/** A chain of `n` entries. */
const chain = (n: number): Ledger => growth(n)[n - 1];

/** The stored head, read back. */
async function headIn(store: ReturnType<typeof createMemoryStore>) {
  return parseChainHead(await store.getItem(LEDGER_HEAD_KEY));
}

describe('the head and the fingerprint (pure)', () => {
  it('is the count and the last hash; the fingerprint is "N entries · 6 hex"', () => {
    const l = chain(3);
    const head = chainHead(l);
    expect(head).toEqual({ entryCount: 3, headHash: l.entries[2].hash });
    expect(fingerprint(l)).toBe(`3 entries · ${l.entries[2].hash.slice(0, 6)}`);
    expect(fingerprint(l)).toMatch(/^3 entries · [0-9a-f]{6}$/);
    expect(fingerprint(chain(1))).toMatch(/^1 entry · [0-9a-f]{6}$/);
  });

  it('a chain that only grew still holds the head; a shorter or different one does not', () => {
    const l = chain(4);
    const head = chainHead({ entries: l.entries.slice(0, 3) });
    expect(extendsHead(l, head)).toBe(true);
    expect(anchorDamage(l, head)).toBeNull();
    expect(anchorDamage(l, null)).toBeNull();
    expect(anchorDamage({ entries: l.entries.slice(0, 2) }, head)).toMatch(
      /^its newest entries are missing: it held 3 entries and now holds 2/
    );
    expect(anchorDamage(chain(4), head)).toMatch(/has been changed or replaced/);
    expect(anchorDamage(null, head)).toMatch(/is missing/);
  });

  it('reads only a well-formed head', () => {
    expect(parseChainHead(null)).toBeNull();
    expect(parseChainHead('not json')).toBeNull();
    expect(parseChainHead('{"entryCount":0,"headHash":"ab"}')).toBeNull();
    expect(parseChainHead('{"entryCount":2}')).toBeNull();
    expect(parseChainHead('{"entryCount":2,"headHash":"ab"}')).toEqual({ entryCount: 2, headHash: 'ab' });
  });

  it('export and import say what was written, read and now held', () => {
    const file = chain(3);
    const phone = chain(2);
    expect(exportedMessage(file)).toBe(
      `Exported 3 entries · ${file.entries[2].hash.slice(0, 6)}. Another phone that imports it should show the same.`
    );
    expect(importedMessage('Added 0 matches and 1 player.', file, phone)).toBe(
      `Added 0 matches and 1 player. The file held 3 entries · ${file.entries[2].hash.slice(0, 6)}. ` +
        `This phone now holds 2 entries · ${phone.entries[1].hash.slice(0, 6)}.`
    );
  });
});

describe('healthy paths never trip the head (N1)', () => {
  it('first launch: no ledger, no head', async () => {
    const store = createMemoryStore();
    expect(await openStoredLedger(store, NOW)).toEqual({ ledger: null, writable: true, message: '' });
  });

  it('every save remembers the head, and a chain that grew reopens cleanly', async () => {
    const store = createMemoryStore();
    const g = growth(5);
    const l = g[4];
    for (let n = 1; n <= 5; n++) {
      await saveLedger(store, g[n - 1]);
      expect(await headIn(store)).toEqual({ entryCount: n, headHash: l.entries[n - 1].hash });
      const opened = await openStoredLedger(store, NOW);
      expect(opened.message).toBe('');
      expect(opened.ledger?.entries).toHaveLength(n);
    }
  });

  it('saves fired without waiting land in order: the head matches the last', async () => {
    const store = createMemoryStore();
    const g = growth(4);
    const l = g[3];
    void saveLedger(store, g[1]);
    void saveLedger(store, g[2]);
    await saveLedger(store, l);
    expect(await headIn(store)).toEqual(chainHead(l));
    expect((await openStoredLedger(store, NOW)).message).toBe('');
  });

  it('an import that appends, and one adopted over a new phone, reopen cleanly', async () => {
    const store = createMemoryStore();
    const g = growth(5);
    const full = g[4];
    // The phone saved a prefix of the file's chain; the import's result
    // extends it, so the remembered head is still in it.
    await saveLedger(store, g[2]);
    const appended = importLedger(g[2], full);
    if (!appended.ok) throw new Error(appended.reason);
    await saveLedger(store, appended.ledger);
    expect((await openStoredLedger(store, NOW)).message).toBe('');

    // A fresh phone adopts a different chain wholesale: the head is replaced.
    const fresh = createMemoryStore();
    await saveLedger(fresh, chain(3));
    const adopted = importLedger(chain(1), full);
    if (!adopted.ok) throw new Error(adopted.reason);
    await saveLedger(fresh, adopted.ledger);
    expect(await headIn(fresh)).toEqual(chainHead(full));
    expect((await openStoredLedger(fresh, NOW)).message).toBe('');
  });

  it('a v1 ledger is upgraded with no head to trip', async () => {
    const store = createMemoryStore();
    const v1 = {
      ledger: 'coaching-app/minutes',
      ledgerVersion: 1,
      writtenAt: NOW.toISOString(),
      squad: { id: 's1', name: 'Test FC' },
      players: [{ id: 'p1', firstName: 'Ava', displaySuffix: null, active: true }],
      matches: [],
    };
    await store.setItem(LEDGER_V1_STORAGE_KEY, JSON.stringify(v1));
    const opened = await openStoredLedger(store, NOW);
    expect(opened.message).toBe('');
    expect(opened.ledger?.entries).toHaveLength(1);
    await saveLedger(store, opened.ledger!);
    expect((await openStoredLedger(store, NOW)).message).toBe('');
  });

  it('Forget everything clears the head with the ledger', async () => {
    const store = createMemoryStore();
    await saveLedger(store, chain(4));
    await clearLedger(store);
    expect(await store.getItem(LEDGER_HEAD_KEY)).toBeNull();
    expect(await openStoredLedger(store, NOW)).toEqual({ ledger: null, writable: true, message: '' });
    // A save still running when Forget everything is pressed cannot write back after it.
    const store2 = createMemoryStore();
    void saveLedger(store2, chain(3));
    await clearLedger(store2);
    expect(await store2.getItem(LEDGER_STORAGE_KEY)).toBeNull();
    expect(await store2.getItem(LEDGER_HEAD_KEY)).toBeNull();
  });

  it('after a set-aside, the new chain is saved and reopens cleanly', async () => {
    const store = createMemoryStore();
    await saveLedger(store, chain(4));
    await store.setItem(LEDGER_STORAGE_KEY, '{ damaged');
    const opened = await openStoredLedger(store, NOW);
    expect(opened.follows).toMatch(new RegExp(`^${UNREADABLE_LEDGER_PREFIX}`));
    expect(await store.getItem(LEDGER_HEAD_KEY)).toBeNull();
    // App starts a new chain naming the copy, and saves it.
    await saveLedger(store, emptyLedger(uuid(), 'Test FC', NOW, opened.follows));
    const again = await openStoredLedger(store, NOW);
    expect(again.message).toBe('');
    expect(again.ledger?.entries).toHaveLength(1);
  });
});

describe('the head catches what the chain alone cannot (N1, G-a)', () => {
  it('newest entries cut off: set aside intact, a new chain names it, the coach is told', async () => {
    const store = createMemoryStore();
    const g = growth(5);
    const l = g[4];
    const short = serialiseLedger(g[2], false);
    expect(parseLedger(short).ok).toBe(true); // the chain alone verifies
    await saveLedger(store, l);
    await store.setItem(LEDGER_STORAGE_KEY, short);

    const opened = await openStoredLedger(store, NOW);
    expect(opened.ledger).toBeNull();
    expect(opened.writable).toBe(true);
    expect(opened.message).toMatch(
      /^The minutes ledger on this phone cannot be trusted: its newest entries are missing: it held 5 entries and now holds 3, .* It has been set aside unchanged and a new one started\. Nothing was deleted\.$/
    );
    expect(await store.getItem(opened.follows!)).toBe(short);
  });

  it('the last entry edited and re-hashed: set aside', async () => {
    const store = createMemoryStore();
    const l = chain(4);
    await saveLedger(store, l);
    const doc = JSON.parse(serialiseLedger(l, false)) as { entries: LedgerEntry[] };
    const last = doc.entries[3];
    (last.records[0] as unknown as { firstName: string }).firstName = 'Edited';
    last.hash = hashOf(last);
    const tampered = JSON.stringify(doc);
    expect(parseLedger(tampered).ok).toBe(true); // the chain alone verifies
    await store.setItem(LEDGER_STORAGE_KEY, tampered);

    const opened = await openStoredLedger(store, NOW);
    expect(opened.message).toMatch(/the entry this phone last saved \(number 4\) has been changed or replaced/);
    expect(await store.getItem(opened.follows!)).toBe(tampered);
  });

  it('the ledger gone altogether while its head remains: a new one, and the coach is told', async () => {
    const store = createMemoryStore();
    await saveLedger(store, chain(3));
    await store.removeItem(LEDGER_STORAGE_KEY);
    const opened = await openStoredLedger(store, NOW);
    expect(opened.ledger).toBeNull();
    expect(opened.writable).toBe(true);
    expect(opened.message).toMatch(/kept \(3 entries\) is missing/);
    expect(await store.getItem(LEDGER_HEAD_KEY)).toBeNull();
  });
});
