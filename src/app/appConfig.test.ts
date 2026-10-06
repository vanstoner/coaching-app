import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// #79 — the Heart FC Beta Coach must be a different app (its own id) that LOOKS
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
    expect(c.android.package).toBe('com.vanstoner.coachingapp');
    expect(c.name).toBe('Heart FC Coach');
    expect(c.icon).toBe(base().icon);
    expect(c.android.adaptiveIcon).toEqual(base().android.adaptiveIcon);
  });

  it('gives both apps a real icon, adaptive on Android, every image 1024 px', () => {
    for (const variant of [undefined, 'beta']) {
      if (variant) process.env.APP_VARIANT = variant;
      else delete process.env.APP_VARIANT;
      const c = appConfig({ config: base() });
      const { foregroundImage, backgroundImage } = c.android.adaptiveIcon;
      for (const img of [c.icon, foregroundImage, backgroundImage]) {
        expect(existsSync(resolve(root, img))).toBe(true);
        expect(pngSize(img)).toEqual([1024, 1024]);
      }
    }
  });

  it('backs up Heart FC Coach and never Heart FC Beta Coach (#112, PO ruling "backup b")', () => {
    delete process.env.APP_VARIANT;
    const main = appConfig({ config: base() });
    expect(main.android.allowBackup).toBe(true);
    expect(main.ios.infoPlist.RCTAsyncStorageExcludeFromBackup).toBe(false);
    process.env.APP_VARIANT = 'beta';
    const beta = appConfig({ config: base() });
    expect(beta.android.allowBackup).toBe(false);
    expect(beta.ios.infoPlist.RCTAsyncStorageExcludeFromBackup).toBe(true);
  });

  it('gives the beta its own id, name and icon', () => {
    process.env.APP_VARIANT = 'beta';
    const c = appConfig({ config: base() });
    expect(c.android.package).toBe('com.vanstoner.coachingapp.beta');
    expect(c.name).toBe('Heart FC Beta Coach');
    expect(c.icon).toBeTruthy();
    expect(c.icon).not.toBe(base().icon);
    expect(c.android.adaptiveIcon.foregroundImage).toBeTruthy();
    for (const img of [c.icon, c.android.adaptiveIcon.foregroundImage]) {
      expect(existsSync(resolve(root, img))).toBe(true);
      expect(pngSize(img)).toEqual([1024, 1024]);
    }
  });
});

// #107 — iOS. Ruling (PO, 2026-10-04): com.vanstoner.coachingapp, and the
// beta with the same `.beta` suffix as Android. Android ids stay unchanged.
describe('iOS identity, build number and backup exclusion (#107)', () => {
  const keys = ['APP_VARIANT', 'IOS_BUILD_NUMBER', 'ANDROID_VERSION_CODE', 'APP_VERSION_NAME'];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  afterEach(() => {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });
  const clean = () => keys.forEach((k) => delete process.env[k]);

  it('gives the released app the ruled bundle id', () => {
    clean();
    const c = appConfig({ config: base() });
    expect(c.ios.bundleIdentifier).toBe('com.vanstoner.coachingapp');
    expect(c.ios.buildNumber).toBeUndefined();
    expect(c.android.package).toBe('com.vanstoner.coachingapp');
  });

  // #143 AC9, ruling 18 (iPad Level 1), replacing "phone only" from #107:
  // tablet on, portrait only, full screen. requireFullScreen is what keeps
  // the iPad in portrait: without it, Expo adds every iPad orientation so
  // that Split View can be offered (@expo/config-plugins RequiresFullScreen).
  it.each([undefined, 'beta'])('runs on an iPad, portrait and full screen (variant %s)', (variant) => {
    clean();
    if (variant) process.env.APP_VARIANT = variant;
    const c = appConfig({ config: base() });
    expect(c.ios.supportsTablet).toBe(true);
    expect(c.ios.requireFullScreen).toBe(true);
    expect(c.orientation).toBe('portrait');
    expect(c.ios.isTabletOnly).toBeUndefined();
  });

  it('gives the beta the .beta bundle id and the orange icon, on iOS too', () => {
    clean();
    process.env.APP_VARIANT = 'beta';
    const c = appConfig({ config: base() });
    expect(c.ios.bundleIdentifier).toBe('com.vanstoner.coachingapp.beta');
    expect(c.android.package).toBe('com.vanstoner.coachingapp.beta');
    // No ios.icon anywhere, so Expo uses the top-level icon for iOS.
    expect(c.ios.icon).toBeUndefined();
    expect(c.icon).toBe('./assets/images/beta-icon.png');
  });

  it('sets the iOS backup key explicitly in both variants, never leaving it to the library default', () => {
    for (const variant of [undefined, 'beta']) {
      clean();
      if (variant) process.env.APP_VARIANT = variant;
      const c = appConfig({ config: base() });
      // The exact key RNCAsyncStorage.mm reads (async-storage 3.1.1,
      // apple/legacy_storage/RNCAsyncStorage.mm:529). Absent means excluded,
      // so it is always explicit: false for the app, true for the beta (#112).
      expect(typeof c.ios.infoPlist.RCTAsyncStorageExcludeFromBackup).toBe('boolean');
    }
  });

  it('declares no non-exempt encryption in both variants (#108 B1)', () => {
    for (const variant of [undefined, 'beta']) {
      clean();
      if (variant) process.env.APP_VARIANT = variant;
      const c = appConfig({ config: base() });
      expect(c.ios.infoPlist.ITSAppUsesNonExemptEncryption).toBe(false);
    }
  });

  it('injects the iOS build number from IOS_BUILD_NUMBER, as a string', () => {
    clean();
    process.env.IOS_BUILD_NUMBER = '42';
    process.env.APP_VERSION_NAME = '1.0.0';
    const c = appConfig({ config: base() });
    expect(c.ios.buildNumber).toBe('42');
    expect(c.version).toBe('1.0.0');
    // The iOS counter does not leak into Android's.
    expect(c.android.versionCode).toBeUndefined();
    expect(c.ios.bundleIdentifier).toBe('com.vanstoner.coachingapp');
  });

  it('keeps injecting Android versionCode and versionName as before', () => {
    clean();
    process.env.ANDROID_VERSION_CODE = '61';
    process.env.APP_VERSION_NAME = '1.2.3';
    const c = appConfig({ config: base() });
    expect(c.android.versionCode).toBe(61);
    expect(c.version).toBe('1.2.3');
    expect(c.ios.buildNumber).toBeUndefined();
  });

  it.each(['0', '-1', '1.5', 'abc'])('refuses IOS_BUILD_NUMBER=%s', (bad) => {
    clean();
    process.env.IOS_BUILD_NUMBER = bad;
    expect(() => appConfig({ config: base() })).toThrow(/IOS_BUILD_NUMBER/);
  });

  // Ruling 42: the version is MAJOR.MINOR.PATCH. The pre-v1 date form, and
  // anything a store would reject or sort wrongly, fails before a build.
  it.each(['2026.10.06', '1.0', '01.0.0', '1.0.0-beta'])('refuses APP_VERSION_NAME=%s', (bad) => {
    clean();
    process.env.APP_VERSION_NAME = bad;
    expect(() => appConfig({ config: base() })).toThrow(/APP_VERSION_NAME/);
  });
});
