/**
 * Which build am I looking at? — #52.
 *
 * Pure TypeScript apart from one env read, which is why the formatting rules
 * are tested in Node with no device.
 *
 * ---------------------------------------------------------------------------
 * The property worth having
 * ---------------------------------------------------------------------------
 *
 * On a CI build the label is **character-for-character the release tag**, so a
 * label read off a phone can be pasted into the releases page and find the
 * exact artifact. That is the whole point: four defects have been reported
 * against this app and every one of them needed "which build was that?"
 * answered before it could be reproduced.
 *
 * A local run must never be mistakable for a release, so it says `local dev`
 * in words rather than showing a version and hoping.
 *
 * ---------------------------------------------------------------------------
 * Why no new dependency
 * ---------------------------------------------------------------------------
 *
 * #52 proposed `expo-constants` to read `extra.buildLabel`. It is not
 * installed, and adding it means every contributor needs `npm ci` rather than
 * `git pull` for a diagnostic string.
 *
 * Expo's Metro config substitutes `process.env.EXPO_PUBLIC_*` with a string
 * literal at bundle time, so the value is baked into the bundle with no
 * dependency and no generated file in the tree. That substitution is asserted
 * against the built APK in `android-apk.yml`, because on this project an
 * injection that silently does not happen is the expected failure, not the
 * surprising one.
 */

import appJson from '../../app.json';

/** What a local run says. Words, never a version-shaped string. */
export const LOCAL_DEV_LABEL = 'local dev';

/** The version in `app.json` — the one `versionName` in the APK comes from. */
export const APP_VERSION: string = appJson.expo.version;

/**
 * The label to show, given whatever the build injected.
 *
 * A tag wins outright and is shown verbatim: it is the release tag, and
 * reformatting it would break the paste-into-the-releases-page property.
 * Anything else — unset, empty, or whitespace — is a local run.
 */
export function formatBuildLabel(injectedTag: string | undefined | null, version: string): string {
  const tag = (injectedTag ?? '').trim();
  if (tag !== '') return tag;
  return `${version} · ${LOCAL_DEV_LABEL}`;
}

/**
 * Read the injected tag.
 *
 * Written as a direct static member expression because that is the form Metro
 * substitutes; assigning `process.env` to a variable first would defeat it.
 *
 * The try/catch is for Hermes, where `process` is not guaranteed to exist and
 * the reference would throw rather than yield undefined. `crypto.randomUUID`
 * crashed this app on launch for exactly that reason, so the guard is a scar,
 * not a superstition. When Metro has substituted, this is a string literal and
 * the guard costs nothing.
 */
export function injectedBuildTag(): string | undefined {
  try {
    return process.env.EXPO_PUBLIC_BUILD_LABEL;
  } catch {
    return undefined;
  }
}

/** The label this running build should show. */
export function currentBuildLabel(): string {
  return formatBuildLabel(injectedBuildTag(), APP_VERSION);
}
