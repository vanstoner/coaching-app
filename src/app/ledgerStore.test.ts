/**
 * The ledger's own storage — #75 AC1: player time survives the working data
 * being reset, because it is not in the working data.
 */

import { describe, it, expect } from 'vitest';
import { uuid } from '../types/index';
import {
  STORAGE_KEY,
  clearSession,
  createMemoryStore,
  loadSession,
} from './persistence';
import { emptyLedger, foldLedger, type Ledger } from './ledger';
import { LEDGER_STORAGE_KEY, clearLedger, loadLedger, sameRecords, saveLedger } from './ledgerStore';

function sampleLedger(): Ledger {
  const ledger = emptyLedger(uuid(), 'Test FC');
  const p = uuid();
  return {
    ...ledger,
    players: [{ id: p, firstName: 'Ann', displaySuffix: null, active: true }],
    matches: [
      {
        id: uuid(),
        kickoffAt: null,
        opponent: null,
        competition: null,
        totalMinutes: 50,
        periodCount: 2,
        status: 'completed',
        intervals: [
          {
            id: uuid(),
            playerId: p,
            period: 1,
            kind: 'outfield',
            unit: 'MID',
            startMs: 0,
            endMs: 600_000,
            corrected: false,
            note: null,
          },
        ],
      },
    ],
  };
}

describe('the ledger store', () => {
  it('uses its own key, not the session one', () => {
    expect(LEDGER_STORAGE_KEY).not.toBe(STORAGE_KEY);
  });

  it('round-trips', async () => {
    const store = createMemoryStore();
    const ledger = sampleLedger();
    expect(await saveLedger(store, ledger)).toBe(true);
    const back = await loadLedger(store);
    expect(back && foldLedger(back)).toEqual(foldLedger(ledger));
  });

  it('AC1: survives the working document being wiped or corrupted', async () => {
    const store = createMemoryStore();
    await saveLedger(store, sampleLedger());
    await store.setItem(STORAGE_KEY, '{ not json');
    expect(await loadSession(store)).toBeNull();
    await clearSession(store);
    expect(await loadLedger(store)).not.toBeNull();
  });

  it('reads nothing rather than rubbish', async () => {
    const store = createMemoryStore();
    await store.setItem(LEDGER_STORAGE_KEY, 'garbage');
    expect(await loadLedger(store)).toBeNull();
  });

  it('is removed only when asked — Forget everything', async () => {
    const store = createMemoryStore();
    await saveLedger(store, sampleLedger());
    await clearLedger(store);
    expect(await loadLedger(store)).toBeNull();
  });

  it('knows when nothing worth writing has changed', () => {
    const a = sampleLedger();
    expect(sameRecords(a, { ...a, writtenAt: new Date().toISOString() })).toBe(true);
    expect(sameRecords(a, { ...a, players: [] })).toBe(false);
  });
});
