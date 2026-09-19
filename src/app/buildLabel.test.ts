import { describe, expect, it } from 'vitest';

import {
  APP_VERSION,
  LOCAL_DEV_LABEL,
  currentBuildLabel,
  formatBuildLabel,
  injectedBuildTag,
} from './buildLabel';
import { GENERATED_BUILD_LABEL } from './generated-build-label';

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
  it('is a date, which is what a build is actually stamped with', () => {
    // app.json is the LOCAL fallback; CI injects the build commit's date into
    // the APK's versionName (#62). Both are YYYY.MM.DD — the trailing "-N"
    // went when the hand-maintained version did, because nobody maintained it
    // and every build for two days claimed to be the 18th.
    expect(APP_VERSION).toMatch(/^\d{4}\.\d{2}\.\d{2}$/);
  });
});

describe('injectedBuildTag', () => {
  it('is undefined in the repository, because the generated file ships empty', () => {
    // The checked-in value must stay empty. If it is ever committed with a tag
    // in it, every local run would claim to be that release — which is the
    // exact confusion #52 exists to end, arriving by the back door.
    expect(GENERATED_BUILD_LABEL).toBe('');
    expect(injectedBuildTag()).toBeUndefined();
  });

  it('falls back to the local label when nothing was generated', () => {
    expect(currentBuildLabel()).toContain(LOCAL_DEV_LABEL);
    expect(currentBuildLabel()).toContain(APP_VERSION);
  });

  it('needs no global that Hermes might not have', () => {
    // The previous implementation read process.env, which does not exist under
    // Hermes and — worse — silently did nothing in the Gradle bundle path.
    // An imported constant has neither failure mode. Proven by removing the
    // global entirely: crypto.randomUUID() crashed this app on launch for
    // exactly this class of reason.
    const saved = globalThis.process;
    try {
      // @ts-expect-error — deliberately removing a global to model Hermes.
      delete globalThis.process;
      expect(() => currentBuildLabel()).not.toThrow();
      expect(currentBuildLabel()).toContain(LOCAL_DEV_LABEL);
    } finally {
      globalThis.process = saved;
    }
  });
});

describe('the label CI will generate', () => {
  it('is shown verbatim once written', () => {
    // What .github/scripts/write-build-label.py puts in the generated file.
    const tag = 'v2026.09.18-4-build.34';
    expect(formatBuildLabel(tag, APP_VERSION)).toBe(tag);
  });

  it('is shown verbatim even with the PR suffix the script writes', () => {
    const tag = 'v2026.09.18-4-build.34 · pr 59';
    expect(formatBuildLabel(tag, APP_VERSION)).toBe(tag);
  });
});
