/**
 * The frozen 1.2.0 reader (`fixtures/reader-1.2.0/`) is what older phones run
 * (ADR-021 D1). Tests read this build's files with it, so it must stay exactly
 * as released: a reader edited to pass would prove nothing.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const FROZEN: Record<string, string> = {
  'entrySigning.ts': 'ef8087c96b415ad11fa7542b78468357d9e44ba2cec13d32cb1d0431119c759e',
  'ledger.ts': '95797a6234cb9d06caa2f086f3f7bf1dea66bb7dc68baa1ff44b091e89c124d4',
  'ledgerChain.ts': '65ea715bb05cb4438505d1a872f2b0fbb30d4f953a2770f2eabb0d64a3b9eb10',
  'sha256.ts': 'b2b6ba6327f63493da5947cca4be11fade90d0aec644e4c9aebcb97729cbad1f',
  'types.ts': 'dac4fba49977c7d257e13053906bffe322a14b7a2318249122f0b115eb677734',
};

describe('the released 1.2.0 reader is frozen', () => {
  it.each(Object.entries(FROZEN))('%s is unedited', (file, sha) => {
    const text = readFileSync(resolve(__dirname, 'fixtures', 'reader-1.2.0', file));
    expect(createHash('sha256').update(text).digest('hex')).toBe(sha);
  });
});
