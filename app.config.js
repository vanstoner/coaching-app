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
// `versionName` IS injected here, from APP_VERSION_NAME.
//
// D2 originally put the version of record in app.json. Nobody bumped it, so
// every build for two days reported 2026.09.18-4 — including build 42, cut on
// the 19th. A version of record that nobody maintains is worse than none,
// because it looks authoritative while being wrong.
//
// CI now derives it from the build commit's date (.github/scripts/build-label.sh)
// and passes it here, so the versionName in the APK, the label on screen and
// the tag on the releases page all come from one computation and cannot
// disagree. With the variable unset — any local prebuild — app.json's value
// applies unchanged.

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
  const versionName = process.env.APP_VERSION_NAME;
  if (versionName !== undefined && versionName !== '') {
    if (!/^[0-9]{4}\.[0-9]{2}\.[0-9]{2}$/.test(versionName)) {
      throw new Error(
        `APP_VERSION_NAME must look like YYYY.MM.DD, got ${JSON.stringify(versionName)}`
      );
    }
  }

  return {
    ...config,
    ...(versionName ? { version: versionName } : {}),
    android: { ...config.android, versionCode: Number(raw) },
  };
};
