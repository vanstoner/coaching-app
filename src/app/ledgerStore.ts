/**
 * Where the minutes ledger lives on the device — #75, ADR-013; v2 — #100,
 * ADR-014 §7.
 *
 * Its OWN key, never the session's. Resetting, migrating or corrupting the
 * working document (`coaching-app/session/v1`) cannot reach it. Takes a
 * `KeyValueStore`, so it is testable in Node like persistence is.
 *
 * v2 is written under `coaching-app/ledger/v2`. The v1 key is read once, to
 * upgrade it, and is never written again; Forget everything clears both.
 */

import type { KeyValueStore } from './persistence';
import { parseLedger, serialiseLedger, type Ledger } from './ledger';

export const LEDGER_STORAGE_KEY = 'coaching-app/ledger/v2';
/** ADR-013's key. Read to upgrade; never written by this build. */
export const LEDGER_V1_STORAGE_KEY = 'coaching-app/ledger/v1';

/**
 * What is stored, and whether this build may write over it (#99 AC2).
 *
 * `too_new` is the case that must not be collapsed into "none": a ledger a
 * newer build wrote and declared unsafe for this one. Treating it as absent
 * would start an empty ledger and save it over the season.
 */
export type StoredLedger =
  /** `upgraded`: read from the v1 key and not yet written under v2. */
  | { status: 'ok'; ledger: Ledger; upgraded: boolean }
  | { status: 'empty' }
  /**
   * `raw` is what was stored, or null when the store itself failed to read.
   * `detail` says why, when the chain failed verification (ADR-014 §8).
   */
  | { status: 'unreadable'; raw: string | null; key: string; detail?: string }
  | { status: 'too_new'; reason: string; view?: Ledger };

async function readKey(store: KeyValueStore, key: string): Promise<StoredLedger> {
  let raw: string | null;
  try {
    raw = await store.getItem(key);
  } catch {
    return { status: 'unreadable', raw: null, key };
  }
  if (raw === null) return { status: 'empty' };
  const parsed = parseLedger(raw);
  if (parsed.ok) return { status: 'ok', ledger: parsed.ledger, upgraded: key !== LEDGER_STORAGE_KEY };
  if (parsed.tooNew) return { status: 'too_new', reason: parsed.reason, view: parsed.view };
  return { status: 'unreadable', raw, key, detail: parsed.detail };
}

/** The v2 ledger; failing that, the v1 ledger upgraded; failing that, empty. */
export async function readStoredLedger(store: KeyValueStore): Promise<StoredLedger> {
  const v2 = await readKey(store, LEDGER_STORAGE_KEY);
  if (v2.status !== 'empty') return v2;
  return readKey(store, LEDGER_V1_STORAGE_KEY);
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
  /**
   * Where an unreadable predecessor was set aside, when a new chain must
   * start; the new chain's genesis names it (#100 AC7).
   */
  follows?: string;
  /** A too-new ledger that verified, to be shown and never written (ADR-014 §10). */
  view?: Ledger;
}

/**
 * Open the stored ledger at launch without ever losing it (PO: "the ledger
 * spine is key here"; #99, #100 AC7).
 *
 * - ok / empty: carry on. A v1 ledger arrives upgraded, its genesis holding
 *   everything it held.
 * - too_new: written by a newer build that said this one must not write it.
 *   Nothing is written this session; it is shown if it verified.
 * - unreadable, or a chain that fails verification: the text is first copied
 *   aside under its own key and read back to prove the copy; only then does
 *   recording start a new chain, whose genesis names the copy. The broken
 *   chain is never repaired, appended to or deleted.
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
      return { ledger: null, writable: false, message: read.reason, view: read.view };
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
      const why = read.detail
        ? `The minutes ledger on this phone cannot be trusted: ${read.detail}.`
        : 'The minutes ledger on this phone would not read.';
      return {
        ledger: null,
        writable: true,
        follows: key,
        message: `${why} It has been set aside unchanged and a new one started. Nothing was deleted.`,
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
    await store.setItem(LEDGER_STORAGE_KEY, serialiseLedger(ledger, false));
    return true;
  } catch {
    return false;
  }
}

/** Forget everything: both keys (ADR-014 §7). */
export async function clearLedger(store: KeyValueStore): Promise<void> {
  for (const key of [LEDGER_STORAGE_KEY, LEDGER_V1_STORAGE_KEY]) {
    try {
      await store.removeItem(key);
    } catch {
      // Nothing to do: a store that cannot delete cannot have saved much.
    }
  }
}

/** True when two ledgers hold the same chain. */
export function sameRecords(a: Ledger, b: Ledger): boolean {
  const last = (l: Ledger) => l.entries[l.entries.length - 1]?.hash;
  return a.entries.length === b.entries.length && last(a) === last(b);
}
