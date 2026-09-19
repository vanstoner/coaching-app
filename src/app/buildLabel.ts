/**
 * Which build am I looking at? — #52.
 *
 * Pure TypeScript, so the formatting rules are tested in Node with no device.
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
 * Instead the value arrives in a module CI generates immediately before the
 * bundle is built. No dependency, and no bundler-specific behaviour to be
 * wrong about.
 *
 * `process.env.EXPO_PUBLIC_BUILD_LABEL` was tried first and looked proven: the
 * literal appeared in the bytecode under `expo export`. It then did nothing at
 * all in the Gradle embed path that actually ships the APK, with the variable
 * correctly set in the job environment (run 35428198347). A mechanism proven
 * on one path is not proven on the path that ships — the lesson this project
 * keeps paying for.
 *
 * The CI assertion that caught it greps the built APK's embedded bundle for
 * the exact expected label, and fails if the `local dev` fallback survives
 * into a release build. That assertion turned a silently wrong label into a
 * red build, which is the whole argument for gating this rather than
 * trusting it.
 */

import appJson from '../../app.json';
import { GENERATED_BUILD_LABEL } from './generated-build-label';

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
 * The tag CI wrote into the generated module, or undefined for a local run.
 *
 * An ordinary import of an ordinary constant: nothing to substitute, nothing
 * to cache, nothing that behaves differently between two bundlers.
 */
export function injectedBuildTag(): string | undefined {
  const tag = GENERATED_BUILD_LABEL.trim();
  return tag === '' ? undefined : tag;
}

/** The label this running build should show. */
export function currentBuildLabel(): string {
  return formatBuildLabel(injectedBuildTag(), APP_VERSION);
}
