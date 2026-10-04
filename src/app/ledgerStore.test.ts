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
import { emptyLedger, foldLedger, recordMatches, type Ledger } from './ledger';
import { makePlayer } from './squad';
import { LEDGER_STORAGE_KEY, clearLedger, loadLedger, sameRecords, saveLedger } from './ledgerStore';

/** A ledger with one player and one completed match, built as the app builds it. */
function sampleLedger(): Ledger {
  const squadId = uuid();
  const player = makePlayer(squadId, 'Ann');
  const quarterId = uuid();
  const matchId = uuid();
  return recordMatches(
    emptyLedger(squadId, 'Test FC', new Date(0)),
    [
      {
        match: {
          id: matchId,
          kickoffAt: null,
          opponent: null,
          competition: null,
          totalMinutes: 50,
          quarterCount: 2,
          status: 'completed',
        },
        quarters: [{ id: quarterId, index: 1, status: 'ended' }],
        appearances: [
          {
            id: uuid(),
            matchId,
            quarterId,
            playerId: player.id,
            positionId: uuid(),
            positionKind: 'outfield',
            positionUnit: 'MID',
            startElapsedMs: 0,
            endElapsedMs: 600_000,
            endReason: 'quarter_end',
            corrected: false,
            correctionNote: null,
          },
        ],
      },
    ],
    [player],
    'Test FC',
    new Date(1000)
  );
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
    expect(sameRecords(a, { ...a, entries: a.entries.slice(0, 1) })).toBe(false);
  });
});
