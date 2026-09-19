import { describe, expect, it, afterEach } from 'vitest';

import {
  APP_VERSION,
  LOCAL_DEV_LABEL,
  currentBuildLabel,
  formatBuildLabel,
  injectedBuildTag,
} from './buildLabel';

describe('formatBuildLabel', () => {
  it('shows a CI tag verbatim, character for character', () => {
    // The property #52 asks for: paste this into the releases page and it
    // finds the artifact. Any reformatting breaks that.
    const tag = 'v2026.09.18-4-build.33';
    expect(formatBuildLabel(tag, '2026.09.18-4')).toBe(tag);
  });

  it('does not invent a tag when none was injected', () => {
    expect(formatBuildLabel(undefined, '2026.09.18-4')).toBe(
      `2026.09.18-4 · ${LOCAL_DEV_LABEL}`
    );
  });

  it('treats an empty or whitespace injection as a local run', () => {
    // An env var set to "" is the shape a broken CI injection takes, and it
    // must read as local rather than as a blank release.
    for (const empty of ['', '   ', '\n', '\t']) {
      expect(formatBuildLabel(empty, '2026.09.18-4')).toContain(LOCAL_DEV_LABEL);
    }
  });

  it('treats null as a local run', () => {
    expect(formatBuildLabel(null, '2026.09.18-4')).toContain(LOCAL_DEV_LABEL);
  });

  it('trims a tag that arrived with stray whitespace', () => {
    expect(formatBuildLabel('  v1.2.3-build.9\n', '1.2.3')).toBe('v1.2.3-build.9');
  });

  it('never lets a local label look like a release tag', () => {
    // A release tag starts with "v". A local label must not, or the two are
    // confusable at a glance on a phone screen.
    const local = formatBuildLabel(undefined, '2026.09.18-4');
    expect(local.startsWith('v')).toBe(false);
    expect(local).toContain(LOCAL_DEV_LABEL);
  });
});

describe('APP_VERSION', () => {
  it('is the version from app.json, which is what versionName in the APK comes from', () => {
    expect(APP_VERSION).toMatch(/^\d{4}\.\d{2}\.\d{2}-\d+$/);
  });
});

describe('injectedBuildTag', () => {
  const original = process.env.EXPO_PUBLIC_BUILD_LABEL;

  afterEach(() => {
    if (original === undefined) delete process.env.EXPO_PUBLIC_BUILD_LABEL;
    else process.env.EXPO_PUBLIC_BUILD_LABEL = original;
  });

  it('reads the injected value when there is one', () => {
    process.env.EXPO_PUBLIC_BUILD_LABEL = 'v2026.09.19-1-build.40';
    expect(injectedBuildTag()).toBe('v2026.09.19-1-build.40');
    expect(currentBuildLabel()).toBe('v2026.09.19-1-build.40');
  });

  it('falls back to the local label when nothing was injected', () => {
    delete process.env.EXPO_PUBLIC_BUILD_LABEL;
    expect(injectedBuildTag()).toBeUndefined();
    expect(currentBuildLabel()).toContain(LOCAL_DEV_LABEL);
  });

  it('survives `process` being absent, as it is under Hermes', () => {
    // crypto.randomUUID() crashed this app on launch for exactly this reason:
    // a global that exists in Node and not on the device. The guard is tested
    // with the capability removed rather than assumed to work.
    const saved = globalThis.process;
    try {
      // @ts-expect-error — deliberately removing a global to model Hermes.
      delete globalThis.process;
      expect(() => injectedBuildTag()).not.toThrow();
      expect(injectedBuildTag()).toBeUndefined();
    } finally {
      globalThis.process = saved;
    }
  });
});
