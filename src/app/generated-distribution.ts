/**
 * GENERATED AT BUILD TIME by CI — do not edit by hand. — ADR-017 §5, #146
 *
 * Which distribution this bundle is. CI rewrites the string literal below,
 * whole, immediately before bundling, as it writes the build label (#52,
 * generated-build-label.ts): `beta` for a pull request's build, `app` for a
 * build of main, `demo` for the demo workflow's build.
 *
 * Checked in as `app` on purpose. A missed or garbled write reads as Heart FC
 * Coach, which only ever removes features (the Test kit, the demo's seed).
 *
 * The full marker is written here and nowhere else in the app, so CI can
 * assert the value it wrote is in the bundle and know it came from this line.
 * Read only through `distribution.ts`.
 */

/** CI replaces this string literal, whole. */
export const GENERATED_DISTRIBUTION = 'distribution:app';
