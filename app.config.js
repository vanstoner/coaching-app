// Dynamic Expo config — the one thing app.json cannot express.
//
// `app.json` stays the single source of truth for the manifest (PO ruling on
// #11). This file adds exactly one thing to it: the Android `versionCode`,
// which per D2 (#47) is the `android-apk.yml` Actions run number, and is
// therefore not knowable until the build runs.
//
// Expo reads app.json first and hands it here as `config`, so everything in
// app.json still applies unchanged. With ANDROID_VERSION_CODE unset — any
// local `expo prebuild` — the config is returned untouched and Expo's own
// default (1) applies. CI always sets it, and the APK job asserts the value
// read back out of the built APK equals the run number, so a silently missing
// injection fails the build rather than shipping versionCode 1.
//
// `versionName` is NOT set here. It comes from app.json's `version`, because
// D2 Option A puts a real version in the repository rather than injecting one.

module.exports = ({ config }) => {
  const raw = process.env.ANDROID_VERSION_CODE;
  if (raw === undefined || raw === '') {
    return config;
  }
  if (!/^[0-9]+$/.test(raw) || Number(raw) < 1) {
    throw new Error(
      `ANDROID_VERSION_CODE must be a positive integer, got ${JSON.stringify(raw)}`
    );
  }
  return {
    ...config,
    android: { ...config.android, versionCode: Number(raw) },
  };
};
