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
// `versionName` IS injected here, from APP_VERSION_NAME — on its own, so the
// iOS job (#107), which sets no ANDROID_VERSION_CODE, gets the same
// commit-date version as CFBundleShortVersionString. iOS's build number comes
// from IOS_BUILD_NUMBER, below.
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

// #79 — Coaching Beta. With APP_VARIANT=beta (set by CI on pull-request
// builds only) the app gets its own application ID and name, so a PR build
// installs NEXT TO the released app instead of replacing it. Android keys
// everything on the application ID, including the app's private storage, so
// the beta also starts empty and never sees the real squad. Unset — every
// build of main, and any local prebuild — the identity is exactly app.json's.
const BETA_SUFFIX = '.beta';
const BETA_NAME = 'Coaching Beta';
// Its own launcher icon too, so the two apps are told apart at a glance on
// the home screen and in the installer (Rob, match day 4). The released app
// keeps whatever app.json gives it.
const BETA_ICON = './assets/images/beta-icon.png';
const BETA_ADAPTIVE_ICON = './assets/images/beta-adaptive-icon.png';
const BETA_ADAPTIVE_BACKGROUND = './assets/images/beta-adaptive-background.png';
// Both drawn by assets/icon/generate_icons.py: the whistle's cord as a heart
// around the ball, on orange-mown grass for the beta (PO, 2026-10-04).

// #112 (PO ruling "backup b"): Coaching App is backed up by the phone's own
// backup so a lost phone keeps the season; Coaching Beta is NOT, so test
// data never reaches a coach's cloud.

function withVariant(config) {
  const variant = process.env.APP_VARIANT;
  if (variant === undefined || variant === '') return config;
  if (variant !== 'beta') {
    throw new Error(`APP_VARIANT must be 'beta' or unset, got ${JSON.stringify(variant)}`);
  }
  return {
    ...config,
    name: BETA_NAME,
    icon: BETA_ICON,
    // The top-level `icon` above is the iOS app icon too (ios.icon is unset),
    // so the beta's orange icon applies on iPhone with no iOS-specific line.
    // #107: the beta's bundle id gets the same `.beta` suffix as Android's
    // package, for the same reason — installs next to the released app, with
    // its own (empty) storage. iOS keys the app sandbox on the bundle id.
    ios: {
      ...config.ios,
      bundleIdentifier: `${config.ios.bundleIdentifier}${BETA_SUFFIX}`,
      infoPlist: { ...config.ios.infoPlist, RCTAsyncStorageExcludeFromBackup: true },
    },
    android: {
      ...config.android,
      package: `${config.android.package}${BETA_SUFFIX}`,
      allowBackup: false,
      adaptiveIcon: { foregroundImage: BETA_ADAPTIVE_ICON, backgroundImage: BETA_ADAPTIVE_BACKGROUND },
    },
  };
}

// A build number read from the environment: unset or empty means "not a CI
// build" and returns undefined; anything else must be a positive integer.
function buildNumberFrom(name) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return undefined;
  if (!/^[0-9]+$/.test(raw) || Number(raw) < 1) {
    throw new Error(`${name} must be a positive integer, got ${JSON.stringify(raw)}`);
  }
  return raw;
}

module.exports = ({ config: base }) => {
  let config = withVariant(base);

  const versionName = process.env.APP_VERSION_NAME;
  if (versionName !== undefined && versionName !== '') {
    if (!/^[0-9]{4}\.[0-9]{2}\.[0-9]{2}$/.test(versionName)) {
      throw new Error(
        `APP_VERSION_NAME must look like YYYY.MM.DD, got ${JSON.stringify(versionName)}`
      );
    }
    config = { ...config, version: versionName };
  }

  const versionCode = buildNumberFrom('ANDROID_VERSION_CODE');
  if (versionCode !== undefined) {
    config = { ...config, android: { ...config.android, versionCode: Number(versionCode) } };
  }

  // #107: iOS's CFBundleVersion, the counterpart of versionCode — the ios.yml
  // run number, set by CI and unknowable until the build runs. It is a STRING
  // in Expo's schema. Its own variable rather than ANDROID_VERSION_CODE,
  // because run numbers are per workflow and the two counters differ.
  const iosBuildNumber = buildNumberFrom('IOS_BUILD_NUMBER');
  if (iosBuildNumber !== undefined) {
    config = { ...config, ios: { ...config.ios, buildNumber: iosBuildNumber } };
  }

  return config;
};
