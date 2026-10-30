/**
 * Forget everything — #207.
 *
 * The privacy policy promises that Forget everything removes the squad, its
 * matches and every recorded minute from the phone. The live keys were never
 * the only copies: a squad or minutes record that would not read is kept
 * aside (#173, ADR-014 §8), and every restore keeps what was there before
 * (#192). Each holds children's first names. So this removes every key this
 * app owns, found by listing the store, not only the keys it knows by name.
 *
 * The Getting started card's closed choice (#218) is a view choice like the
 * table sorts, and goes with them, so a forgotten phone opens as a fresh one.
 * So do the open Settings sections and the last-backup date (#263).
 *
 * Kept: the beta's test-clock setting, a test preference rather than squad
 * data, and the install's signing key (#193), which lives in the secure store,
 * not here, and holds nothing about anyone.
 */

import { GETTING_STARTED_KEY } from '../gettingStarted';
import { LEDGER_HEAD_KEY, LEDGER_STORAGE_KEY, LEDGER_V1_STORAGE_KEY } from './ledgerStore';
import { STORAGE_KEY, inTurn, type KeyValueStore } from '../persistence';
import { LAST_BACKUP_KEY, SETTINGS_SECTIONS_KEY } from '../settingsSections';
import { TABLE_SORT_KEY } from '../tableSort';
import { TEST_CLOCK_KEY } from '../testKit';

/** Every key this app writes starts with this. */
export const APP_KEY_PREFIX = 'coaching-app/';

/** The keys known by name, removed even by a store that cannot list its keys. */
const KNOWN = [
  STORAGE_KEY,
  LEDGER_STORAGE_KEY,
  LEDGER_HEAD_KEY,
  LEDGER_V1_STORAGE_KEY,
  TABLE_SORT_KEY,
  GETTING_STARTED_KEY,
  // #263 AC5, AC10: which Settings sections are open, and the last backup.
  SETTINGS_SECTIONS_KEY,
  LAST_BACKUP_KEY,
];

export interface Forgotten {
  removed: number;
  /** False when the store could not list its keys or a removal failed: copies may remain. */
  complete: boolean;
}

/**
 * Remove every key this app owns but the test clock. Queued behind any save
 * still running, so an older save cannot write anything back after it.
 */
export function forgetAppData(store: KeyValueStore): Promise<Forgotten> {
  return inTurn(store, async () => {
    let complete = true;
    let listed: readonly string[] = [];
    try {
      if (store.allKeys) listed = await store.allKeys();
      else complete = false;
    } catch {
      complete = false;
    }
    const doomed = [...new Set([...KNOWN, ...listed.filter((k) => k.startsWith(APP_KEY_PREFIX))])].filter(
      (k) => k !== TEST_CLOCK_KEY
    );
    let removed = 0;
    for (const key of doomed) {
      try {
        await store.removeItem(key);
        removed++;
      } catch {
        complete = false;
      }
    }
    return { removed, complete };
  });
}
