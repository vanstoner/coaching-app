/**
 * The hash chain — #100 AC1, AC4, AC5; ADR-014 §1, §6, §8.
 *
 * `fixtures/ledger-v2.json` is the committed golden v2 file (synthetic
 * names): the v1 fixture upgraded (its genesis), then a cup match recorded at
 * kick-off with one player absent, and again when it ended. Every build must
 * read it; a copy altered by hand in any way must fail (AC5).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { UUID } from '../types/index';
import { canonical, hashOf, verifyChain, type LedgerEntry } from './ledgerChain';
import { emptyLedger, foldLedger, importLedger, parseLedger } from './ledger';
import { attendanceOf, gamesMissed } from './attendance';

const MIN = 60_000;
const v2Text = () => readFileSync(join(__dirname, 'fixtures', 'ledger-v2.json'), 'utf-8');
const v1Text = () => readFileSync(join(__dirname, 'fixtures', 'ledger-v1.json'), 'utf-8');

/** The fixture, edited by hand. The summary is dropped so only the chain can catch it. */
function altered(edit: (entries: LedgerEntry[]) => void): string {
  const doc = JSON.parse(v2Text());
  edit(doc.entries);
  delete doc.summary;
  return JSON.stringify(doc);
}

function reasonOf(text: string): string {
  const r = parseLedger(text);
  if (r.ok) throw new Error('expected the file to be refused');
  return r.reason;
}

describe('canonical form (ADR-014 §6)', () => {
  it('sorts keys by code unit, drops undefined, keeps null, no whitespace', () => {
    expect(canonical({ b: 1, a: [true, null, 'x'], c: undefined, B: 'é' })).toBe(
      '{"B":"é","a":[true,null,"x"],"b":1}'
    );
  });

  it('refuses a number that is not a safe integer', () => {
    expect(() => canonical({ a: 1.5 })).toThrow();
    expect(() => canonical(2 ** 53)).toThrow();
    expect(() => canonical(NaN)).toThrow();
  });
});

describe('the golden v2 fixture', () => {
  it('verifies and reads to the totals and attendance it was written with', () => {
    const r = parseLedger(v2Text());
    if (!r.ok) throw new Error(r.reason);
    expect(verifyChain(r.ledger.entries)).toEqual({ ok: true });
    expect(r.ledger.entries.map((e) => e.kind)).toEqual(['genesis', 'record', 'record']);
    expect(r.ledger.entries[0].from).toBe('v1');
    const totals = new Map(foldLedger(r.ledger).map((t) => [t.playerId, t]));
    // v1's half (25:00 in goal) plus the cup match's (25:00 in goal).
    expect(totals.get('p1' as UUID)!.goalkeeperMs).toBe(50 * MIN);
    const cup = r.ledger.matches.find((m) => m.id === 'm2')!;
    expect(cup).toMatchObject({ status: 'completed', competition: 'cup' });
    expect(attendanceOf(cup).players.find((a) => a.playerId === 'p9')).toMatchObject({
      attended: false,
      status: 'absent',
    });
    expect(gamesMissed(r.ledger, 'p9' as UUID)).toBe(1);
  });

  it('AC4: its genesis is the v1 fixture, upgraded, byte for byte the same chain', () => {
    const fromV1 = parseLedger(v1Text());
    const v2 = parseLedger(v2Text());
    if (!fromV1.ok || !v2.ok) throw new Error('fixture did not read');
    expect(v2.ledger.entries[0]).toEqual(fromV1.ledger.entries[0]);
    // So a phone still on the v1 fixture can take the v2 file as an extension.
    const r = importLedger(fromV1.ledger, v2.ledger);
    expect(r.ok && r.addedEntries).toBe(2);
  });
});

describe('AC1, AC5: any hand edit to the file is detected and refused', () => {
  it('an edited value', () => {
    const text = altered((e) => {
      e[2].records.find((r) => r.type === 'interval')!.endMs = 26 * MIN;
    });
    expect(reasonOf(text)).toMatch(
      /^This minutes file cannot be trusted: the entry recorded on \d+ Oct at \d\d:\d\d has been changed since it was written\. Nothing was imported\.$/
    );
  });

  it('an edited first name in the genesis', () => {
    const text = altered((e) => {
      e[0].records.find((r) => r.type === 'player')!.firstName = 'Edited';
    });
    expect(reasonOf(text)).toMatch(/has been changed since it was written/);
  });

  it('a deleted entry', () => {
    expect(reasonOf(altered((e) => e.splice(1, 1)))).toMatch(/an entry is missing after/);
  });

  it('a deleted entry with the rest renumbered', () => {
    const text = altered((e) => {
      e.splice(1, 1);
      e[1].seq = 1;
    });
    expect(reasonOf(text)).toMatch(/an entry is missing after/);
  });

  it('an inserted (repeated) entry', () => {
    expect(reasonOf(altered((e) => e.splice(2, 0, e[1])))).toMatch(/an entry has been added or moved after/);
  });

  it('two entries swapped', () => {
    expect(reasonOf(altered((e) => e.reverse()))).toMatch(/cannot be trusted/);
  });

  it('a missing start', () => {
    expect(reasonOf(altered((e) => e.shift()))).toMatch(/its start is missing/);
  });

  it('an entry edited and re-hashed alone no longer links to the next', () => {
    const text = altered((e) => {
      e[1].records.find((r) => r.type === 'attendance' && r.playerId === 'p9')!.status = 'available';
      e[1].hash = hashOf(e[1]);
    });
    expect(reasonOf(text)).toMatch(/cannot be trusted/);
  });

  it('a whole chain re-hashed after an edit verifies alone, but a phone holding the original refuses it', () => {
    // ADR-014 Consequences: no key, so this is the documented limit.
    const doc = JSON.parse(altered((e) => {
      e[1].records.find((r) => r.type === 'attendance' && r.playerId === 'p9')!.status = 'available';
    }));
    for (let i = 1; i < doc.entries.length; i++) {
      if (i > 1) doc.entries[i].prev = doc.entries[i - 1].hash;
      doc.entries[i].hash = hashOf(doc.entries[i]);
    }
    const forged = parseLedger(JSON.stringify(doc));
    if (!forged.ok) throw new Error(forged.reason);
    const original = parseLedger(v2Text());
    if (!original.ok) throw new Error(original.reason);
    const r = importLedger(original.ledger, forged.ledger);
    expect(r.ok).toBe(false);
  });

  it('refused files import nothing: the phone’s ledger is untouched', () => {
    const mine = emptyLedger('s' as UUID, 'Test FC');
    const r = parseLedger(altered((e) => e.splice(1, 1)));
    expect(r.ok).toBe(false);
    expect(mine.entries).toHaveLength(1);
  });
});
