/**
 * #193: each install signs what it records. Acceptance criteria are on the
 * issue; each test names the one it proves.
 */

import { afterEach, describe, it, expect } from 'vitest';
import { emptyLedger, importLedger, parseLedger, recordMatches, serialiseLedger, type Ledger } from './ledger';
import { hashOf, verifyChain, type LedgerEntry } from './ledgerChain';
import { setEntrySigner, signBody, signatureStatuses, signerFromSecret, type EntrySigner } from './entrySigning';
import { testSeasonLedger } from './testSeasonFile';

const NOW = new Date('2026-10-17T09:00:00.000Z');

/** A fixed key per install, so a failure is reproducible. */
function install(n: number): EntrySigner {
  return signerFromSecret(`device-${n}`, new Uint8Array(32).fill(n));
}

afterEach(() => setEntrySigner(null));

/** A whole played season, recorded by one install. */
function recordedBy(by: EntrySigner | null): Ledger {
  setEntrySigner(by);
  const ledger = testSeasonLedger(NOW);
  setEntrySigner(null);
  return ledger;
}

/** Re-hash every entry from `from` on, as someone editing a file would. */
function rehashFrom(entries: LedgerEntry[], from: number): LedgerEntry[] {
  const out = entries.map((e) => ({ ...e }));
  for (let i = from; i < out.length; i++) {
    if (i > 0) out[i].prev = out[i - 1].hash;
    out[i].hash = hashOf(out[i]);
  }
  return out;
}

const reread = (l: Ledger): Ledger => {
  const p = parseLedger(serialiseLedger(l));
  if (!p.ok) throw new Error(p.reason);
  return p.ledger;
};

describe('signing (#193)', () => {
  it('AC1: the install publishes its public key once, in a device record', () => {
    const by = install(1);
    const ledger = recordedBy(by);
    const published = ledger.entries.flatMap((e) => e.records).filter((r) => r.type === 'device');
    expect(published).toEqual([{ type: 'device', id: 'device-1', publicKey: by.publicKey }]);
    expect(ledger.entries[0].records[0]).toEqual(published[0]);
  });

  it('AC2: every entry is signed, and the chain still verifies and reads back', () => {
    const ledger = reread(recordedBy(install(1)));
    expect(ledger.entries.length).toBeGreaterThan(5);
    for (const e of ledger.entries) {
      expect(e.device).toBe('device-1');
      expect(typeof e.sig).toBe('string');
    }
    expect(verifyChain(ledger.entries).ok).toBe(true);
    expect(signatureStatuses(ledger.entries).every((s) => s === 'valid')).toBe(true);
  });

  it('AC2: the hash covers the signature, as it covers any field a build does not know', () => {
    const ledger = recordedBy(install(1));
    const stripped = ledger.entries.map((e) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { sig, ...rest } = e;
      return rest as LedgerEntry;
    });
    expect(verifyChain(stripped).ok).toBe(false);
  });

  it('AC3: a record changed after signing fails its signature, and the chain still opens', () => {
    const ledger = recordedBy(install(1));
    const entries = ledger.entries.map((e) => ({ ...e, records: e.records.map((r) => ({ ...r })) }));
    const target = entries.findIndex((e) => e.records.some((r) => r.type === 'interval'));
    const interval = entries[target].records.find((r) => r.type === 'interval')!;
    interval.endMs = (interval.endMs as number) + 60_000; // a minute added to someone
    const edited = rehashFrom(entries, target);

    expect(verifyChain(edited).ok).toBe(true); // re-hashed: the chain alone cannot tell
    // A careful forger also drops the file's summary, which would no longer agree.
    const file = JSON.parse(serialiseLedger(ledger));
    file.entries = edited;
    delete file.summary;
    const parsed = parseLedger(JSON.stringify(file));
    expect(parsed.ok).toBe(true);
    const statuses = signatureStatuses(edited);
    // Each signature covers its `prev`, so re-hashing after an edit breaks every
    // later signature too: without the key, an edit cannot be hidden anywhere.
    expect(statuses.slice(0, target).every((s) => s === 'valid')).toBe(true);
    expect(statuses.slice(target).every((s) => s === 'invalid')).toBe(true);
  });

  it('AC3: an entry signed by a device the chain does not publish is unknown', () => {
    const ledger = recordedBy(install(1));
    const entries = ledger.entries.map((e) => ({ ...e }));
    const last = entries.length - 1;
    entries[last] = { ...entries[last], device: 'device-9' };
    expect(signatureStatuses(rehashFrom(entries, last))[last]).toBe('unknown-device');
  });

  it('AC3: a second key published for the same device cannot take over its signatures', () => {
    const ledger = recordedBy(install(1));
    // A forger publishes their own key under device-1 and signs a new entry with it.
    const forger = signerFromSecret('device-1', new Uint8Array(32).fill(7));
    const entries = [...ledger.entries];
    const lastEntry = entries[entries.length - 1];
    const signed = signBody(
      {
        seq: lastEntry.seq + 1,
        prev: lastEntry.hash,
        at: NOW.toISOString(),
        kind: 'record',
        records: [{ type: 'device', id: 'device-1', publicKey: forger.publicKey }],
      },
      forger
    );
    entries.push({ ...signed, hash: hashOf(signed) } as LedgerEntry);
    expect(verifyChain(entries).ok).toBe(true);
    expect(signatureStatuses(entries)[entries.length - 1]).toBe('invalid');
  });

  it('AC4: a signed season imported onto another phone stays signed and valid there', () => {
    const season = recordedBy(install(1));
    setEntrySigner(install(2)); // the receiving phone has its own key
    const receiving = emptyLedger(season.squad.id, season.squad.name, NOW);
    setEntrySigner(null);
    const imported = importLedger({ ...receiving, entries: [] } as Ledger, reread(season));
    if (!imported.ok) throw new Error(imported.reason);
    expect(signatureStatuses(imported.ledger.entries).every((s) => s === 'valid')).toBe(true);
  });

  it('AC5: a restored phone signs new entries with a new key; the old ones still verify', () => {
    const season = recordedBy(install(1));
    const fresh = install(2);
    setEntrySigner(fresh);
    // The new install records one more thing: a renamed squad.
    const next = recordMatches(reread(season), [], [], 'Renamed FC', NOW);
    setEntrySigner(null);
    const added = next.entries.slice(season.entries.length);
    expect(added).toHaveLength(1);
    expect(added[0].device).toBe('device-2');
    expect(added[0].records[0]).toEqual({ type: 'device', id: 'device-2', publicKey: fresh.publicKey });
    expect(signatureStatuses(next.entries).every((s) => s === 'valid')).toBe(true);
  });

  it('AC7: a chain from before signing reads as unsigned, never as broken', () => {
    const old = reread(recordedBy(null));
    expect(old.entries.every((e) => e.sig === undefined)).toBe(true);
    expect(signatureStatuses(old.entries).every((s) => s === 'unsigned')).toBe(true);
    expect(verifyChain(old.entries).ok).toBe(true);
  });
});
