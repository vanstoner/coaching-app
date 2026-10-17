/**
 * Each install signs what it records — #193, ADR-021 D4.
 *
 * An install holds an Ed25519 key. Every ledger entry it writes carries its
 * `device` id and a `sig` over the entry's canonical form without `hash` and
 * `sig`; the entry's `hash` is then taken over everything, `sig` included,
 * exactly as ADR-014 §6 hashes any field — so a build that knows nothing of
 * signing still verifies the chain. The public key is published once, in a
 * `device` record, so any phone holding the chain can check every entry,
 * wherever the file has travelled.
 *
 * What a signature proves: this install wrote this entry and nothing has
 * changed since. Not that the phone's clock was right (#113).
 *
 * Pure TypeScript and synchronous, like the hash (ADR-014 §5): the shell
 * loads the key once at launch (`deviceKey.ts`) and installs a signer here;
 * with none installed, entries are written unsigned, as before.
 */

import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';

import { canonical, type LedgerEntry, type LedgerRecord } from './ledgerChain';

ed.hashes.sha512 = sha512;

export interface EntrySigner {
  deviceId: string;
  /** Lowercase hex, 32 bytes. */
  publicKey: string;
  sign: (message: Uint8Array) => Uint8Array;
}

let signer: EntrySigner | null = null;

/** Install (or with null, remove) the signer every new entry is signed with. */
export function setEntrySigner(next: EntrySigner | null): void {
  signer = next;
}

export function currentSigner(): EntrySigner | null {
  return signer;
}

/** A signer from a 32-byte secret key. */
export function signerFromSecret(deviceId: string, secretKey: Uint8Array): EntrySigner {
  const secret = Uint8Array.from(secretKey);
  return {
    deviceId,
    publicKey: bytesToHex(ed.getPublicKey(secret)),
    sign: (message) => ed.sign(message, secret),
  };
}

/** The bytes a signature covers: the entry without `hash` and `sig`. */
export function signedBytes(entry: Record<string, unknown>): Uint8Array {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { hash, sig, ...rest } = entry;
  return utf8ToBytes(canonical(rest));
}

/** Add `device` and `sig` to an entry body that has no `hash` yet. */
export function signBody<T extends Record<string, unknown>>(body: T, by: EntrySigner): T & { device: string; sig: string } {
  const withDevice = { ...body, device: by.deviceId };
  return { ...withDevice, sig: bytesToHex(by.sign(signedBytes(withDevice))) };
}

/** The record that publishes an install's public key. */
export function deviceRecord(by: EntrySigner): LedgerRecord {
  return { type: 'device', id: by.deviceId, publicKey: by.publicKey };
}

/** Whether the chain already publishes this install's key. */
export function publishes(entries: readonly LedgerEntry[], deviceId: string): boolean {
  return entries.some((e) => e.records.some((r) => r.type === 'device' && r.id === deviceId));
}

/**
 * How each entry stands:
 * - `unsigned`: written before signing, or by an install with no key;
 * - `valid`: signed by a device the chain publishes, and unchanged since;
 * - `invalid`: its signature does not match (changed after signing, or a
 *   forged one);
 * - `unknown-device`: signed by a device the chain does not publish.
 *
 * A bad signature never refuses the chain (#193 AC3): the hash chain decides
 * whether the record can be read, this decides how far it can be trusted.
 */
export type SignatureStatus = 'unsigned' | 'valid' | 'invalid' | 'unknown-device';

export function signatureStatuses(entries: readonly LedgerEntry[]): SignatureStatus[] {
  const keys = new Map<string, string>();
  for (const e of entries) {
    for (const r of e.records) {
      // The first publication of a device's key stands; a later one cannot replace it.
      if (r.type === 'device' && typeof r.id === 'string' && typeof r.publicKey === 'string' && !keys.has(r.id)) {
        keys.set(r.id, r.publicKey);
      }
    }
  }
  return entries.map((e) => {
    if (typeof e.sig !== 'string' || typeof e.device !== 'string') return 'unsigned';
    const key = keys.get(e.device);
    if (!key) return 'unknown-device';
    try {
      return ed.verify(hexToBytes(e.sig), signedBytes(e), hexToBytes(key)) ? 'valid' : 'invalid';
    } catch {
      return 'invalid';
    }
  });
}

/**
 * How long signing and checking take on this phone (#193 AC6), for the beta's
 * Test kit. A throwaway key and an entry-sized message; nothing is recorded.
 * Elapsed time for a measurement only, never a match clock.
 */
export function timeSigning(runs = 5): { signMs: number; verifyMs: number } {
  const by = signerFromSecret('timing', new Uint8Array(32).fill(9));
  const message = utf8ToBytes('x'.repeat(2000));
  by.sign(message); // the first call builds the curve's tables
  let t = performance.now();
  let sig: Uint8Array = new Uint8Array(0);
  for (let i = 0; i < runs; i++) sig = by.sign(message);
  const signMs = (performance.now() - t) / runs;
  const key = hexToBytes(by.publicKey);
  t = performance.now();
  for (let i = 0; i < runs; i++) ed.verify(sig, message, key);
  return { signMs, verifyMs: (performance.now() - t) / runs };
}
