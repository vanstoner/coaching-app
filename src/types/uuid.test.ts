/**
 * Tests for `uuid()`.
 *
 * These exist because `crypto.randomUUID()` shipped to a device and crashed the
 * app on launch. It is present in Node, so vitest and tsc both passed; it is
 * absent in Hermes, React Native's JS engine.
 *
 * The important cases are the ones that REMOVE capabilities from globalThis.
 * Testing only the environment the test runner happens to have is what let the
 * original defect through, so each tier is exercised as if it were the only one
 * available — including the Math.random fallback, which is the tier a phone
 * without `crypto` actually runs.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { uuid } from './index';

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const realCrypto = (globalThis as { crypto?: Crypto }).crypto;

function setCrypto(value: unknown): void {
  Object.defineProperty(globalThis, 'crypto', {
    value,
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  setCrypto(realCrypto);
});

describe('uuid', () => {
  it('produces a well-formed v4 UUID in this environment', () => {
    expect(uuid()).toMatch(V4);
  });

  it('falls back to getRandomValues when randomUUID is missing', () => {
    // Hermes with a crypto polyfill that stops short of randomUUID.
    setCrypto({ getRandomValues: realCrypto!.getRandomValues.bind(realCrypto) });
    const id = uuid();
    expect(id).toMatch(V4);
  });

  it('falls back to Math.random when crypto is absent entirely', () => {
    // This is the tier that runs on a device with no crypto at all, and the
    // one the original implementation had no answer for — it threw.
    setCrypto(undefined);
    expect(() => uuid()).not.toThrow();
    expect(uuid()).toMatch(V4);
  });

  it('never throws on a globalThis.crypto that exists but is empty', () => {
    // An empty object is the shape that a partial polyfill presents, and
    // `typeof undefined === 'function'` is false, so both guards must miss.
    setCrypto({});
    expect(uuid()).toMatch(V4);
  });

  it('is unique across a realistic number of calls, on every tier', () => {
    for (const [label, value] of [
      ['native', realCrypto],
      ['getRandomValues only', { getRandomValues: realCrypto!.getRandomValues.bind(realCrypto) }],
      ['no crypto', undefined],
    ] as const) {
      setCrypto(value);
      const seen = new Set<string>();
      for (let i = 0; i < 5_000; i++) seen.add(uuid());
      expect(seen.size, `duplicates on the ${label} tier`).toBe(5_000);
    }
  });

  it('sets the version and variant bits on every tier', () => {
    for (const value of [
      realCrypto,
      { getRandomValues: realCrypto!.getRandomValues.bind(realCrypto) },
      undefined,
    ]) {
      setCrypto(value);
      for (let i = 0; i < 200; i++) {
        const id = uuid();
        expect(id[14]).toBe('4');
        expect('89ab').toContain(id[19]);
      }
    }
  });
});
