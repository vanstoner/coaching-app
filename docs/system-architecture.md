# System architecture

Status: **Draft**, retrofitted from the code at `e04fbb0` (v1.0.1), 2026-10-09.
Last updated: 2026-10-17

One page. Where it and the code disagree, the code wins. Fix this page.

## Stack

| | Version | Note |
|---|---|---|
| Expo (managed, `expo prebuild` in CI) | 57.0.23 | No `android/` or `ios/` checked in |
| React Native | 0.86.3 | New Architecture, Hermes, edge-to-edge mandatory on Android |
| React | 19.2.3 | |
| TypeScript | 5.9 | `strict: true`; no `any` in `src/` outside tests |
| Storage | `@react-native-async-storage/async-storage` 3.1.1 | Behind `KeyValueStore` |
| Safe areas | `react-native-safe-area-context` ~5.7.0 | The shell pads once; bottom sheets add the bottom inset (#174) |
| Signing (#193) | `@noble/ed25519` 3.2, `@noble/hashes` 2.4 (pure TS); `expo-secure-store`, `expo-crypto` ~57.0.4 | Key made from `expo-crypto` bytes, kept in the Keystore/Keychain; the biometric permissions the store brings are blocked in `app.json` |
| Other native modules | `expo-file-system`, `expo-sharing`, `expo-font`, `react-native-view-shot` | Minutes file and app backup export/import, Share plan image |

No navigation library, no state library, no network client. See [ADR-001](./decisions/001-react-native-expo.md), [ADR-018](./decisions/018-session-and-ledger-in-asyncstorage.md) and [ADR-019](./decisions/019-shell-owns-state-step-machine-routes.md).

## Layout

```
index.ts            registerRootComponent(App)
App.tsx             the shell: all app state, every action, the router (1,582 lines)
src/engine/         MatchEngine — pure TS, mutates a MatchState in place
src/types/          domain types, uuid() (Hermes-safe)
src/app/            pure rules, each with a *.test.ts beside it; storage adapters
src/screens/        React components; take props, hold only view state
.github/            CI, APK/IPA builds, releases, store listing
```

Rule: `src/engine` and `src/app` import no React and no platform module, with
five exceptions in `src/app`: `storage.ts` (AsyncStorage), `ledgerFile.ts`,
`planImageFile.ts` (file system, sharing), `fonts.ts` and `deviceKey.ts`
(secure store, random bytes).

## State lifecycle

```mermaid
sequenceDiagram
    participant A as App.tsx
    participant S as AsyncStorage
    participant E as MatchEngine
    A->>A: installDeviceSigner (key from the secure store, #193)
    A->>S: openStoredSession (session/v1; unreadable → set aside, #173)
    A->>S: openStoredLedger (ledger/v2 + head)
    A->>A: recordMatches(back-fill) → commitLedger
    A->>S: saveLedger (queued)
    A->>A: step = resume | fixtures
    Note over A: every state change
    A->>E: engine.substitute / startQuarter / endQuarter (mutates state)
    A->>S: saveSession (whole document, not queued)
    A->>S: saveLedger (only if records changed)
```

- **All durable state lives in `App.tsx`** `useState`s. Screens receive values
  and callbacks.
- **The live match** is `{ engine, state, format }`. The engine mutates
  `state` in place; the shell then calls `persist()` (and `repaint()` where no
  other state changes).
- **Time** is never counted. `getQuarterElapsedMs` = `accumulatedMs + now −
  runningSinceWallClock`. `ClockScreen` reschedules a `setTimeout` to the next
  displayed second, only to repaint. `appNow()` (`src/app/appClock.ts`) is the
  single clock, sped up by the Test kit in beta builds.
- **Saves are fire-and-forget.** A failed write keeps the match running in
  memory. The ledger's writes run one at a time per store; the session's do not.

## Storage

| Key | Contents | Writer | Versioning |
|---|---|---|---|
| `coaching-app/session/v1` | `SavedSession`: squad, defaults, every match (planned, live, played), plans | `saveSession` | `schemaVersion` 6, `MIGRATIONS` in `persistence.ts`, unknown fields kept |
| `coaching-app/ledger/v2` | Minutes ledger: hash-chained entries (ADR-013, ADR-014) | `saveLedger` (serialised queue) | own format version; too-new → read-only |
| `coaching-app/ledger/head` | Last chain head, guards rollback | `saveLedger` | |
| `coaching-app/ledger/v1` | Pre-v2 ledger, read for upgrade only | none | |
| `coaching-app/ledger/v2/unreadable/<iso>` | A ledger that failed to verify, set aside intact | `openStoredLedger` | |
| `coaching-app/session/v1/unreadable/<iso>` | A session that would not read, set aside intact (#173, #184) | `openStoredSession` | |
| `coaching-app/before-restore/<iso>/…` | What was on the phone before a restore (#192) | `restorePhoneBackup` | Removed by Forget everything (#207) |
| `coaching-app/table-sort/v1` | Each analytics table's chosen sort, a view choice on this phone (#208) | `TableSortProvider` | Never in the record; removed by Forget everything |
| Secure store `coaching-app.device-key.v1` | This install's signing key (#193); only its public half reaches the ledger | `installDeviceSigner` | Never exported or backed up by the app |
| `TEST_CLOCK_KEY` | Beta clock offset and speed | Test kit only | |

Nothing leaves the device except a minutes file, an app backup (#192) or a
plan image the coach shares explicitly (ADR-011). Android `allowBackup` is **true** for Heart FC Coach and
false for the beta (#112).

## Navigation topology

A `Step` (`src/app/tabs.ts`) picks one screen. No navigator, no back stack.

```mermaid
stateDiagram-v2
    [*] --> loading
    loading --> resume: match under way
    loading --> fixtures
    resume --> playing: Resume (period running)
    resume --> lineup: Resume (between periods)
    resume --> fixtures: Leave
    state "Tuesday · tab bar" as T {
        fixtures --> fixtureForm: Add
        fixtureForm --> fixtures: Save / Cancel
        fixtures --> plan: Plan
        squad
        settings
    }
    fixtures --> squad: Play now, too few players (errand=match)
    squad --> lineup: Start
    fixtures --> lineup: Open / Play now
    fixtures --> playing: Open (period running)
    fixtures --> summary: Open (played)
    lineup --> playing: Start period
    playing --> lineup: End period
    playing --> summary: See the minutes
    playing --> analysis: Playing time chart
    summary --> analysis
    analysis --> summary: Back
    analysis --> playing: Back
    summary --> fixtures: Back (match released)
    fixtures --> record: Open a match from the record (#195)
    record --> fixtures: Back
    playing --> plan: Plan the rest
    lineup --> plan: Plan the rest
    plan --> playing: Done (planReturn)
    playing --> fixtures: Leave (match keeps running)
    lineup --> fixtures: Leave
```

Every Saturday screen (lineup, playing, summary, analysis, plan from a match)
is full screen with an explicit exit; the match keeps running when left.

`effectiveStep` collapses any Saturday step without a held match to
`fixtures`. The Android hardware back button is not handled: it backgrounds
the app from every screen (#175).

## Builds

`APP_VARIANT=beta` (pull requests) gives Heart FC Beta Coach its own app id,
icon and empty storage. `main` builds Heart FC Coach. Version from `app.json`,
build numbers from CI run numbers (`app.config.js`).
