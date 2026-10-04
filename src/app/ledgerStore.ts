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
  /** `raw` is what was stored, or null when the store itself failed to read. */
  | { status: 'unreadable'; raw: string | null }
  | { status: 'too_new'; reason: string };

export async function readStoredLedger(store: KeyValueStore): Promise<StoredLedger> {
  let raw: string | null;
  try {
    raw = await store.getItem(LEDGER_STORAGE_KEY);
  } catch {
    return { status: 'unreadable', raw: null };
  }
  if (raw === null) return { status: 'empty' };
  const parsed = parseLedger(raw);
  if (parsed.ok) return { status: 'ok', ledger: parsed.ledger };
  return parsed.tooNew ? { status: 'too_new', reason: parsed.reason } : { status: 'unreadable', raw };
}

/** Where a ledger that would not read is kept, intact, before anything else is written. */
export const UNREADABLE_LEDGER_PREFIX = `${LEDGER_STORAGE_KEY}/unreadable/`;

export interface OpenedLedger {
  /** What recording continues from: the stored ledger, or null to start a new one. */
  ledger: Ledger | null;
  /** False when nothing may be written to the ledger key this session. */
  writable: boolean;
  /** For the coach, in plain English; empty when there is nothing to say. */
  message: string;
}

/**
 * Open the stored ledger at launch without ever losing it (PO: "the ledger
 * spine is key here"; #99, QA on #110).
 *
 * - ok / empty: carry on.
 * - too_new: written by a newer build that said this one must not write it.
 *   Nothing is written this session.
 * - unreadable, with its text: the text is first copied aside under its own
 *   key and read back to prove the copy; only then does recording start a
 *   new ledger. If the copy cannot be made and proved, nothing is written.
 * - unreadable because the store itself failed: nothing is written — the
 *   ledger may be perfectly fine and only out of reach for now.
 */
export async function openStoredLedger(store: KeyValueStore, now: Date): Promise<OpenedLedger> {
  const read = await readStoredLedger(store);
  switch (read.status) {
    case 'ok':
      return { ledger: read.ledger, writable: true, message: '' };
    case 'empty':
      return { ledger: null, writable: true, message: '' };
    case 'too_new':
      return { ledger: null, writable: false, message: read.reason };
    case 'unreadable': {
      const blocked = (why: string): OpenedLedger => ({
        ledger: null,
        writable: false,
        message: `${why} Nothing has been changed or deleted; player minutes will not be recorded until this is resolved.`,
      });
      if (read.raw === null) return blocked('The minutes ledger could not be read from this phone just now.');
      const key = `${UNREADABLE_LEDGER_PREFIX}${now.toISOString()}`;
      try {
        await store.setItem(key, read.raw);
        if ((await store.getItem(key)) !== read.raw) throw new Error('copy did not read back');
      } catch {
        return blocked('The minutes ledger on this phone would not read, and could not be set aside safely.');
      }
      return {
        ledger: null,
        writable: true,
        message:
          'The minutes ledger on this phone would not read, so it has been set aside unchanged and a new one started. ' +
          'Nothing was deleted.',
      };
    }
  }
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
