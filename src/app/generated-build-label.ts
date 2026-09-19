/**
 * GENERATED AT BUILD TIME — do not edit by hand. — #52
 *
 * Checked in EMPTY on purpose. A local run needs no build step and gets the
 * `local dev` label from that emptiness; CI overwrites this file with the
 * release tag immediately before the bundle is built.
 *
 * ---------------------------------------------------------------------------
 * Why a generated file and not `process.env.EXPO_PUBLIC_*`
 * ---------------------------------------------------------------------------
 *
 * The env-var route (`process.env.EXPO_PUBLIC_BUILD_LABEL`) was tried first
 * and its CI check went red — but the RED WAS THE CHECK'S FAULT, not the
 * mechanism's. Hermes stores a string as UTF-16LE the moment one character is
 * non-ASCII, and the label carried a `·`, so a byte-grep for the UTF-8 form
 * found nothing in a bundle that may well have contained it. Whether the env
 * route worked in the Gradle path was never actually established.
 *
 * This is kept anyway, on its own merits rather than the other's supposed
 * failure: a generated module is an ordinary import with no bundler-specific
 * substitution semantics to be wrong about, and one fewer thing that behaves
 * differently between `expo export` and Gradle's embed path.
 */

/** The release tag, or empty for a local run. CI overwrites this line. */
export const GENERATED_BUILD_LABEL = '';
