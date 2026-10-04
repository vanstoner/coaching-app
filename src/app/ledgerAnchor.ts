/**
 * The chain head the phone remembers, and the fingerprint people compare —
 * PO ruling N1 (#98, 2026-10-04).
 *
 * Without a key, the hash chain (ADR-014) cannot tell a ledger with its
 * newest entries cut off, or its last entry edited and re-hashed, from a
 * shorter honest one. Two mitigations, approved in place of a signing key
 * (v3, #113):
 *
 * - **The anchor.** After every save the phone keeps the chain head — how
 *   many entries, and the last one's hash — under a key of its own. At
 *   launch, a stored chain shorter than that, or whose entry at that count
 *   hashes differently, has lost or replaced its newest entries: it is set
 *   aside like any damaged ledger (ruling G-a, ADR-014 §8).
 * - **The fingerprint.** Export and import show "142 entries · 7f3a9c", so
 *   two coaches can compare what each holds.
 *
 * Pure TypeScript: no storage here (`ledgerStore.ts` does that).
 */

import type { Ledger } from './ledger';
import { whenOf } from './ledgerChain';

export interface ChainHead {
  entryCount: number;
  headHash: string;
}

/** The head of a chain: its length and its last entry's hash. */
export function chainHead(ledger: Pick<Ledger, 'entries'>): ChainHead {
  const last = ledger.entries[ledger.entries.length - 1];
  return { entryCount: ledger.entries.length, headHash: last?.hash ?? '' };
}

/** "142 entries · 7f3a9c": what two coaches read out to each other. */
export function fingerprint(ledger: Pick<Ledger, 'entries'>): string {
  const { entryCount, headHash } = chainHead(ledger);
  return `${entryCount} ${entryCount === 1 ? 'entry' : 'entries'} · ${headHash.slice(0, 6)}`;
}

/** A stored anchor, or null for anything that is not one (none, or damaged). */
export function parseChainHead(raw: string | null): ChainHead | null {
  if (raw === null) return null;
  try {
    const v = JSON.parse(raw) as Partial<ChainHead>;
    if (
      typeof v.entryCount === 'number' &&
      Number.isInteger(v.entryCount) &&
      v.entryCount > 0 &&
      typeof v.headHash === 'string' &&
      v.headHash !== ''
    ) {
      return { entryCount: v.entryCount, headHash: v.headHash };
    }
  } catch {
    // Not an anchor: treated as none. It only ever guards; it never decides
    // that a ledger is good.
  }
  return null;
}

export function serialiseChainHead(head: ChainHead): string {
  return JSON.stringify(head);
}

/**
 * True when `ledger` holds the remembered head: at least that many entries,
 * and the entry at that count is the one remembered. A chain that has only
 * grown since is fine.
 */
export function extendsHead(ledger: Pick<Ledger, 'entries'>, head: ChainHead): boolean {
  const at = ledger.entries[head.entryCount - 1];
  return at !== undefined && at.hash === head.headHash;
}

/**
 * What is wrong with a stored ledger against the remembered head, in plain
 * English, or null when nothing is. `ledger` null: the ledger is not there
 * at all.
 */
export function anchorDamage(ledger: Pick<Ledger, 'entries'> | null, head: ChainHead | null): string | null {
  if (head === null) return null;
  if (ledger === null || ledger.entries.length === 0) {
    return `the minutes ledger this phone kept (${head.entryCount} entries) is missing`;
  }
  if (extendsHead(ledger, head)) return null;
  const n = ledger.entries.length;
  if (n < head.entryCount) {
    return (
      `its newest entries are missing: it held ${head.entryCount} entries and now holds ${n}, ` +
      `the last of them recorded on ${whenOf(ledger.entries[n - 1].at)}`
    );
  }
  return `the entry this phone last saved (number ${head.entryCount}) has been changed or replaced`;
}

/** What Settings says after an export: what was written, to read out. */
export function exportedMessage(written: Pick<Ledger, 'entries'>): string {
  return `Exported ${fingerprint(written)}. Another phone that imports it should show the same.`;
}

/**
 * What Settings says after an import, done or refused: what was read, and
 * what this phone holds now, so two coaches can compare.
 */
export function importedMessage(
  outcome: string,
  file: Pick<Ledger, 'entries'>,
  phone: Pick<Ledger, 'entries'> | null
): string {
  const held = phone ? ` This phone now holds ${fingerprint(phone)}.` : '';
  return `${outcome} The file held ${fingerprint(file)}.${held}`;
}
