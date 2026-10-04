/**
 * Where the minutes ledger lives on the device — #75.
 *
 * Its OWN key, never the session's. Resetting, migrating or corrupting the
 * working document (`coaching-app/session/v1`) cannot reach it, which is the
 * whole point of having it. Takes a `KeyValueStore`, so it is testable in
 * Node like persistence is.
 */

import type { KeyValueStore } from './persistence';
import { parseLedger, serialiseLedger, type Ledger } from './ledger';

export const LEDGER_STORAGE_KEY = 'coaching-app/ledger/v1';

/**
 * What is stored, and whether this build may write over it (#99 AC2).
 *
 * `too_new` is the case that must not be collapsed into "none": a ledger a
 * newer build wrote and declared unsafe for this one. Treating it as absent
 * would start an empty ledger and save it over the season.
 */
export type StoredLedger =
  | { status: 'ok'; ledger: Ledger }
  | { status: 'empty' }
  | { status: 'unreadable' }
  | { status: 'too_new'; reason: string };

export async function readStoredLedger(store: KeyValueStore): Promise<StoredLedger> {
  let raw: string | null;
  try {
    raw = await store.getItem(LEDGER_STORAGE_KEY);
  } catch {
    return { status: 'unreadable' };
  }
  if (raw === null) return { status: 'empty' };
  const parsed = parseLedger(raw);
  if (parsed.ok) return { status: 'ok', ledger: parsed.ledger };
  return parsed.tooNew ? { status: 'too_new', reason: parsed.reason } : { status: 'unreadable' };
}

/** The stored ledger, or null if there is none or it cannot be read. */
export async function loadLedger(store: KeyValueStore): Promise<Ledger | null> {
  const stored = await readStoredLedger(store);
  return stored.status === 'ok' ? stored.ledger : null;
}

/** Fire and forget, like the session: a full disk loses the save, not the match. */
export async function saveLedger(store: KeyValueStore, ledger: Ledger): Promise<boolean> {
  try {
    await store.setItem(LEDGER_STORAGE_KEY, serialiseLedger(ledger));
    return true;
  } catch {
    return false;
  }
}

export async function clearLedger(store: KeyValueStore): Promise<void> {
  try {
    await store.removeItem(LEDGER_STORAGE_KEY);
  } catch {
    // Nothing to do: a store that cannot delete cannot have saved much.
  }
}

/** True when two ledgers hold the same records — `writtenAt` aside. */
export function sameRecords(a: Ledger, b: Ledger): boolean {
  const strip = (l: Ledger) => JSON.stringify({ ...l, writtenAt: '', summary: undefined });
  return strip(a) === strip(b);
}
