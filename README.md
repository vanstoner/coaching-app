# Heart FC Coach

A junior football coaching app for one under-10s squad. It answers one question
at the touchline: **who comes off next, and is everyone getting a fair share?**
It is a substitution reminder, not a timing system. Android first; iPhone
builds are compiled in CI ahead of TestFlight.

What it does today: a squad of first names with position preferences; fixtures
and Play now; a plan for every period with projected minutes; a match clock
with substitution reminders, a pitch you drag players around, goals, saves and
a score; a match report closed with **End match**; each child's minutes against
their season average; and a hash-chained ledger of every match's minutes. The
story of how it got here is in [HISTORY.md](./HISTORY.md).

## Install it

From the [releases page](https://github.com/vanstoner/coaching-app/releases):

- **Heart FC Coach** — the release marked **Latest**. Every merge to `main` that
  builds green publishes one.
- **Heart FC Beta Coach** — the `beta` prerelease, rebuilt from each open pull
  request. It installs as a separate app (its own id, storage and orange icon),
  so testing never touches the real squad. Its Test kit adds made-up players, a
  past season and a faster clock. After a merge, `beta` holds no APK, just a
  note pointing at the new Heart FC Coach build, until the next pull request.
- **Heart FC Beta Coach — demo** — the [`demo` prerelease](https://github.com/vanstoner/coaching-app/releases/tag/demo),
  for sharing. It is Heart FC Beta Coach, built from `main` when asked, and it opens
  with the made-up Test kit squad and past season already loaded (on a phone
  with no Heart FC Beta Coach data). Its link never changes; each refresh replaces it.
  Android only.

Each page opens with the pull request it contains, the issues that closes and
what changed; the beta also lists its test steps.

## Run it on a Mac (iPhone simulator)

iPhone: waiting on Apple enrolment ([#108](https://github.com/vanstoner/coaching-app/issues/108)).
Until then it runs only in the simulator that comes with Xcode. A real iPhone
needs that enrolment.

**Route 1: download the build CI made.** Each release carries
`coaching-app-ios-simulator_….zip` (the beta: `coaching-beta-ios-simulator_….zip`),
added by the iOS workflow a while after the APK.

```bash
unzip coaching-app-ios-simulator_*.zip        # gives HeartFCCoach.app (beta: HeartFCBetaCoach.app)
open -a Simulator                             # boots the default iPhone
xcrun simctl install booted HeartFCCoach.app   # or drag the .app onto the simulator window
xcrun simctl launch booted com.vanstoner.coachingapp   # beta: com.vanstoner.coachingapp.beta
```

The beta zip is the one with the **Test kit** (made-up players, a past season,
a faster clock): install `HeartFCBetaCoach.app` and open Settings › Test kit.

To build the beta yourself, with the Test kit, use `npm run ios:beta` (or
`npm run android:beta`) once route 2 below works. It builds **Coaching
Beta**, with its own id, orange icon and storage, so test data never sits
beside a real squad. Any development build shows the Test kit, and a release
of Heart FC Coach never does (#134).

**Route 2: build it yourself.** A *development* build: it loads the app's code
live from your Mac, so `npx expo start` must be running while you use it.
Route 1 is standalone. Each step below is one that failed when skipped (#133):

1. **Current code and packages.** `git pull`, then `npm ci`. Stale packages
   fail with *Failed to resolve plugin for module "expo-font"*.
2. **Xcode 26.6**, what CI uses. Xcode 26.0 fails with *'weak' must be a
   mutable variable*; newer versions are untested. Several Xcodes can sit side
   by side; install one with [`xcodes`](https://github.com/XcodesOrg/xcodes)
   (`brew install xcodes && xcodes install 26.6`) and select it:
   ```bash
   ls -d /Applications/Xcode*.app                      # the real name, e.g. Xcode-26.6.0.app
   sudo xcode-select -s /Applications/Xcode-26.6.0.app
   xcodebuild -version                                 # Xcode 26.6
   ```
3. **That Xcode's iOS simulator.** Each Xcode needs its own: Xcode › Settings ›
   Components, or `xcodebuild -downloadPlatform iOS`. Without it the build
   stops with *iOS 26.5 is not installed* (error 70).
4. **Regenerate the iOS project and run it:**
   ```bash
   npx expo prebuild --platform ios --clean   # a stale ios/ keeps an old app id
   npx expo run:ios --device                  # pick an iPhone simulator
   ```
5. **Let Terminal control the Simulator.** System Settings › Privacy &
   Security › Automation › Terminal › System Events. Without it the app
   installs but the last step fails with an `osascript` error; then
   `open -a Simulator` and `npx expo start` and tap the app.

## On a real iPhone

- **Coaches: TestFlight**, once Apple enrolment is done
  ([#108](https://github.com/vanstoner/coaching-app/issues/108)). A
  standalone install that works at the touchline.
- **Development only: Expo Go.** Install Expo Go from the App Store, put the
  phone on the same Wi-Fi as the Mac, run `npx expo start` and scan its QR
  code with the Camera. It runs only while the Mac is serving it, keeps its
  data inside Expo Go, and has not been tested against this project's Expo
  SDK (57) and storage library — use the test squad, never the real one.

## The five things that must stay true

1. **Minutes fold from events; nothing derived is stored as authoritative.**
2. **Elapsed time comes from wall-clock anchors, never tick counting.**
3. **Fairness is total time on the pitch, in goal plus outfield, never per
   position.**
4. **First names only. No PII.**
5. **Corrections are explicit, noted, and never destructive.**

[CLAUDE.md](./CLAUDE.md) states them in full; each is an ADR in
[`docs/decisions/`](./docs/decisions/).

## Data protection

The app holds children's participation data: first names only, and no
surnames, dates of birth, contact details or photographs. **Real squad data is
never committed to this repository** and never attached to a release.

Data stays on the phone. **Heart FC Coach** is included in the phone's own
backup, so a lost or replaced phone keeps the season; **Heart FC Beta Coach** is not.
CI checks both against the built APK. See
[ADR-011](./docs/decisions/011-player-data-stays-on-device.md) and its
amendment.

## Build and check

Node 22, JDK 17 and the Android SDK. From a fresh clone:

```bash
npm ci
npx vitest run                          # tests
npx tsc --noEmit                        # typecheck
npm run lint
python3 docs/process/validate-docs.py   # docs links, ADRs, specs
npm run apk                             # sideloadable debug APK
```

`android/` and `ios/` are generated by `expo prebuild` and never committed, so
`app.json` and `app.config.js` stay the single source of truth.

## How it is run

Rob is the Product Owner and the only approver. Work is an issue with
acceptance criteria, built on a branch, released as a beta from its pull
request and merged on Rob's approval. The rules are in [CLAUDE.md](./CLAUDE.md);
the docs are indexed in [`docs/README.md`](./docs/README.md).

Copyright (c) 2026 Stephen Robert Vanstone. All rights reserved. See [LICENSE](./LICENSE).
