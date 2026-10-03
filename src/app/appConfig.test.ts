import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// #79 — the Coaching Beta must be a different app (its own id) that LOOKS
// different (its own icon), and the released app must be untouched.
const root = resolve(__dirname, '../..');
const require = createRequire(import.meta.url);
const appConfig = require(resolve(root, 'app.config.js')) as (ctx: { config: any }) => any;
const base = () => JSON.parse(readFileSync(resolve(root, 'app.json'), 'utf8')).expo;

const pngSize = (path: string) => {
  const b = readFileSync(resolve(root, path));
  expect(b.subarray(1, 4).toString()).toBe('PNG');
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
};

describe('app identity per variant (#79)', () => {
  const saved = process.env.APP_VARIANT;
  afterEach(() => {
    if (saved === undefined) delete process.env.APP_VARIANT;
    else process.env.APP_VARIANT = saved;
  });

  it('leaves the released app exactly as app.json says', () => {
    delete process.env.APP_VARIANT;
    const c = appConfig({ config: base() });
    expect(c.android.package).toBe('com.example.coachingapp');
    expect(c.name).toBe('Coaching App');
    expect(c.icon).toBe(base().icon);
    expect(c.android.adaptiveIcon).toBe(base().android.adaptiveIcon);
  });

  it('gives the beta its own id, name and icon', () => {
    process.env.APP_VARIANT = 'beta';
    const c = appConfig({ config: base() });
    expect(c.android.package).toBe('com.example.coachingapp.beta');
    expect(c.name).toBe('Coaching Beta');
    expect(c.icon).toBeTruthy();
    expect(c.icon).not.toBe(base().icon);
    expect(c.android.adaptiveIcon.foregroundImage).toBeTruthy();
    for (const img of [c.icon, c.android.adaptiveIcon.foregroundImage]) {
      expect(existsSync(resolve(root, img))).toBe(true);
      expect(pngSize(img)).toEqual([1024, 1024]);
    }
  });
});
