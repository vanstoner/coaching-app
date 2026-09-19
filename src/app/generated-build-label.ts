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
 * The env-var route was tried first and PROVEN to work under `expo export` —
 * the literal appeared in the Hermes bytecode. It then FAILED in the Android
 * release build, where the bundle is produced by Gradle's embed path rather
 * than by `expo export`: run 35428198347 built with
 * EXPO_PUBLIC_BUILD_LABEL correctly set in the job environment, and the
 * label was still absent from the APK while the `local dev` fallback was
 * still present.
 *
 * The lesson is the one this project keeps relearning: a mechanism proven on
 * one path is not proven on the path that ships. A generated module has no
 * bundler-specific semantics to be wrong about — it is an ordinary import.
 *
 * The CI assertion that caught this is unchanged and still gates the build.
 */

/** The release tag, or empty for a local run. CI overwrites this line. */
export const GENERATED_BUILD_LABEL = '';
