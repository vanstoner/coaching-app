/**
 * SHA-256 against the NIST vectors (FIPS 180-2, appendix B) — ADR-014 §5.
 * The non-ASCII name is checked against Node's own crypto, which is not
 * available on the phone and so is used here only as the reference.
 */

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sha256, utf8 } from './sha256';

describe('sha256', () => {
  it('matches the NIST vectors', () => {
    expect(sha256('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'
    );
    expect(sha256('a'.repeat(1_000_000))).toBe(
      'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0'
    );
  });

  it('hashes non-ASCII first names as UTF-8', () => {
    for (const name of ['Zoë', 'Siân', 'Łukasz', 'Ōta', '😀 Kai', 'Renée-Æsa']) {
      expect(sha256(name)).toBe(createHash('sha256').update(name, 'utf8').digest('hex'));
      expect([...utf8(name)]).toEqual([...Buffer.from(name, 'utf8')]);
    }
  });

  it('is right at every padding boundary', () => {
    for (let n = 50; n < 135; n++) {
      const s = 'x'.repeat(n);
      expect(sha256(s)).toBe(createHash('sha256').update(s).digest('hex'));
    }
  });

  it('needs nothing from globalThis.crypto (Hermes has no crypto.subtle)', () => {
    const saved = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
    try {
      expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    } finally {
      if (saved) Object.defineProperty(globalThis, 'crypto', saved);
    }
  });
});
