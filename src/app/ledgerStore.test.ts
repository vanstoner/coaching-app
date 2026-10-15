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
import { LEDGER_STORAGE_KEY, clearLedger, ledgerWriter, loadLedger, sameRecords, saveLedger } from './ledgerStore';
import { forgetSession, saveSessionIfWritable } from './sessionStore';
import { makeSevenASideFormat } from './placeholderSquad';
import type { KeyValueStore } from './persistence';

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

describe('writes that failed, and the order of writes (#177)', () => {
  /** A memory store whose ledger writes fail while `down` is true. */
  function flaky() {
    const memory = createMemoryStore();
    let writes = 0;
    const state = { down: false };
    const store: KeyValueStore = {
      ...memory,
      setItem: async (key, value) => {
        if (key === LEDGER_STORAGE_KEY) {
          writes += 1;
          if (state.down) throw new Error('disk full');
        }
        return memory.setItem(key, value);
      },
    };
    return { store, state, writes: () => writes };
  }

  it('an unchanged ledger is not written again', async () => {
    const { store, writes } = flaky();
    const write = ledgerWriter(store);
    const ledger = sampleLedger();
    await write(null, ledger);
    expect(write(ledger, ledger)).toBeNull();
    expect(writes()).toBe(1);
  });

  it('item 1: after a failed write, the same ledger is written again until it lands', async () => {
    const { store, state } = flaky();
    const write = ledgerWriter(store);
    const ledger = sampleLedger();

    state.down = true;
    expect(await write(null, ledger)).toBe(false);
    expect(await loadLedger(store)).toBeNull();

    // Nothing a coach cares about changed, but the stored copy is behind.
    state.down = false;
    expect(await write(ledger, ledger)).toBe(true);
    expect(sameRecords((await loadLedger(store))!, ledger)).toBe(true);

    // Landed: back to skipping.
    expect(write(ledger, ledger)).toBeNull();
  });

  /** A store whose writes take turns resolving in reverse, to tempt reordering. */
  function slowFirst(): KeyValueStore {
    const memory = createMemoryStore();
    let delay = 20;
    return {
      ...memory,
      setItem: async (key, value) => {
        const wait = delay;
        delay = Math.max(0, delay - 10);
        await new Promise((r) => setTimeout(r, wait));
        return memory.setItem(key, value);
      },
      removeItem: (key) => memory.removeItem(key),
    };
  }

  const squadId = uuid();
  const session = (squadName: string) => ({
    squadName,
    squadId,
    players: [makePlayer(squadId, 'Ava')],
    format: makeSevenASideFormat(),
    totalMinutes: 50,
    periodCount: 4,
    plan: {},
    matches: [],
    state: null,
  });

  it('item 2: session saves land in the order they were asked for', async () => {
    const store = slowFirst();
    await Promise.all([
      saveSessionIfWritable(store, true, session('First')),
      saveSessionIfWritable(store, true, session('Second')),
      saveSessionIfWritable(store, true, session('Third')),
    ]);
    expect((await loadSession(store))?.squadName).toBe('Third');
  });

  it('Forget everything is not overtaken by a save asked for before it', async () => {
    const store = slowFirst();
    await Promise.all([
      saveSessionIfWritable(store, true, session('Before')),
      saveLedger(store, sampleLedger()),
      forgetSession(store),
      clearLedger(store),
    ]);
    expect(await store.getItem(STORAGE_KEY)).toBeNull();
    expect(await loadLedger(store)).toBeNull();
  });
});

