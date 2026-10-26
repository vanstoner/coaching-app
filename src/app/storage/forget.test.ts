/**
 * #207: Forget everything removes every key this app owns — copies kept aside
 * included — so the privacy policy's sentence is true.
 */

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { APP_KEY_PREFIX, forgetAppData } from './forget';
import { GETTING_STARTED_KEY, parseCardClosed, serialiseCardClosed } from '../gettingStarted';
import { emptyLedger } from '../ledger';
import { LEDGER_HEAD_KEY, LEDGER_STORAGE_KEY, LEDGER_V1_STORAGE_KEY, saveLedger } from './ledgerStore';
import { STORAGE_KEY, createMemoryStore, saveSession, toSavedSession, type KeyValueStore } from '../persistence';
import { makePhoneBackup, readPhoneBackup, restorePhoneBackup } from './phoneBackup';
import { makeSevenASideFormat } from '../placeholderSquad';
import { makePlayer } from '../squad';
import { UNREADABLE_SESSION_PREFIX, openStoredSession } from './sessionStore';
import { TABLE_SORT_KEY } from '../tableSort';
import { TEST_CLOCK_KEY } from '../testKit';
import { uuid } from '../../types/index';

const NOW = new Date('2026-10-17T12:00:00.000Z');

/** A phone that has restored once and set a damaged squad aside once. */
async function usedPhone(): Promise<KeyValueStore> {
  const store = createMemoryStore();
  const squadId = uuid();
  const input = {
    squadName: 'Test FC', squadId, players: [makePlayer(squadId, 'Ava')], format: makeSevenASideFormat(),
    totalMinutes: 50, periodCount: 4, plan: {}, matches: [], state: null, now: NOW,
  };
  await saveSession(store, input);
  await saveLedger(store, emptyLedger(squadId, 'Test FC', NOW));
  await store.setItem(LEDGER_V1_STORAGE_KEY, '{"v1":true}');
  await store.setItem(TEST_CLOCK_KEY, '{"offsetMs":0,"speed":1}');
  await store.setItem('someone-else/key', 'not ours');

  // A restore keeps what was there aside (#192)…
  const backup = readPhoneBackup(makePhoneBackup(toSavedSession(input), null, { app: 'Heart FC Coach', build: '' }, NOW));
  if (!backup.ok) throw new Error(backup.reason);
  const restored = await restorePhoneBackup(store, backup, NOW);
  if (!restored.ok) throw new Error(restored.reason);
  // …and a squad that will not read is set aside (#173).
  await store.setItem(STORAGE_KEY, '{"schemaVersion": 6, "players": [');
  await openStoredSession(store, new Date(NOW.getTime() + 1000));
  return store;
}

describe('Forget everything (#207)', () => {
  it('the phone really does hold copies kept aside before forgetting', async () => {
    const keys = await (await usedPhone()).allKeys!();
    expect(keys.some((k) => k.startsWith('coaching-app/before-restore/'))).toBe(true);
    expect(keys.some((k) => k.startsWith(UNREADABLE_SESSION_PREFIX))).toBe(true);
  });

  it('AC1, AC5: removes every key this app owns except the test clock', async () => {
    const store = await usedPhone();
    const outcome = await forgetAppData(store);
    expect(outcome.complete).toBe(true);
    const left = await store.allKeys!();
    expect(left.filter((k) => k.startsWith(APP_KEY_PREFIX))).toEqual([TEST_CLOCK_KEY]);
    for (const key of [STORAGE_KEY, LEDGER_STORAGE_KEY, LEDGER_HEAD_KEY, LEDGER_V1_STORAGE_KEY]) {
      expect(await store.getItem(key)).toBeNull();
    }
  });

  it('leaves keys that are not this app’s alone', async () => {
    const store = await usedPhone();
    await forgetAppData(store);
    expect(await store.getItem('someone-else/key')).toBe('not ours');
  });

  it('a store that cannot list its keys still loses the known ones, and says it may be incomplete', async () => {
    const memory = await usedPhone();
    const store: KeyValueStore = { getItem: memory.getItem, setItem: memory.setItem, removeItem: memory.removeItem };
    const outcome = await forgetAppData(store);
    expect(outcome.complete).toBe(false);
    expect(await memory.getItem(STORAGE_KEY)).toBeNull();
    expect(await memory.getItem(LEDGER_STORAGE_KEY)).toBeNull();
  });

  it('#208 AC6: the tables\' remembered sorts go too, even from a store that cannot list its keys', async () => {
    const listed = await usedPhone();
    await listed.setItem(TABLE_SORT_KEY, '{"squadFairness":{"key":"name","dir":"asc"}}');
    await forgetAppData(listed);
    expect(await listed.getItem(TABLE_SORT_KEY)).toBeNull();

    const memory = await usedPhone();
    await memory.setItem(TABLE_SORT_KEY, '{"squadFairness":{"key":"name","dir":"asc"}}');
    const unlisted: KeyValueStore = { getItem: memory.getItem, setItem: memory.setItem, removeItem: memory.removeItem };
    await forgetAppData(unlisted);
    expect(await memory.getItem(TABLE_SORT_KEY)).toBeNull();
  });

  it('#218 Q4: a closed Getting started card opens again, even from a store that cannot list its keys', async () => {
    const listed = await usedPhone();
    await listed.setItem(GETTING_STARTED_KEY, serialiseCardClosed());
    await forgetAppData(listed);
    expect(await listed.getItem(GETTING_STARTED_KEY)).toBeNull();
    expect(parseCardClosed(await listed.getItem(GETTING_STARTED_KEY))).toBe(false);

    const memory = await usedPhone();
    await memory.setItem(GETTING_STARTED_KEY, serialiseCardClosed());
    const unlisted: KeyValueStore = { getItem: memory.getItem, setItem: memory.setItem, removeItem: memory.removeItem };
    await forgetAppData(unlisted);
    expect(await memory.getItem(GETTING_STARTED_KEY)).toBeNull();
  });

  it('AC5: the privacy policy says what this does', () => {
    const policy = readFileSync(new URL('../../../PRIVACY.md', import.meta.url), 'utf8').replace(/\s+/g, ' ');
    expect(policy).toContain(
      'Settings › Forget everything** removes the squad, its matches, every recorded minute and any copies the app kept aside'
    );
  });
});
