# Privacy policy: Heart of the Game: Coach

<!-- Sources for every section are in an HTML comment beneath its heading, so
     each sentence can be traced (#108 C2, C3). Change a claim, change its
     source note in the same pull request. -->

**Heart of the Game: Coach** (shown on the home screen as **Heart FC Coach**)
helps a grassroots football coach give every child a fair share of time on the
pitch. It is made by Stephen Robert Vanstone.

The short version: the app keeps what you enter on your phone. We, the
developer, receive none of it.

## What the app holds

<!-- Source: invariant 4 (CLAUDE.md); src/types/index.ts Player (firstName,
     displaySuffix, keeper, prefers, outfieldTargetPct; squadNumber exists
     in the model but App.tsx always writes null, so it is not listed);
     src/app/ledger.ts FIELDS (squad, player, match, interval, event,
     attendance, note); src/app/squad.ts validateName rejects a second word;
     ADR-011 amendment, impact table "Data". -->

Only what the coach enters while running the team:

- each child's **first name**, and sometimes a letter or two to tell two
  children with the same name apart. The app turns away a second word, so a
  surname cannot be saved by accident;
- **position preferences**: whether a child likes to play in goal, where they
  prefer to play outfield, and any target for their time outfield;
- the **matches**: date, opponent, competition, and who was available;
- **match minutes and events**: who was on the pitch, where and for how long,
  goals and saves, and any notes the coach writes when correcting a record;
- the team name and the app's settings.

Nothing else about a child: no surnames, dates of birth, contact details or
photos.

## Where it is kept

<!-- Source: ADR-011 decision 1; ADR-011 addendum (AsyncStorage on the
     device); src/app/storage.ts, src/app/ledgerStore.ts. -->

In the app's own storage, on the phone it was entered on.

## What we receive: nothing

<!-- Source: ADR-011 decisions 1 and 3; ADR-011 amendment "Unchanged: no
     server, no sync, no analytics of ours"; ADR-017 Consequences. Code check
     on a0e8ca7: no fetch, XMLHttpRequest, WebSocket, axios, EventSource,
     sendBeacon or http(s) URL in src/, App.tsx or index.ts; package.json
     dependencies are async-storage, expo, expo-file-system, expo-font,
     expo-sharing, expo-status-bar, react, react-native — no analytics,
     advertising, tracking or crash-reporting SDK. Fonts are bundled
     (app.json expo-font plugin), not downloaded. -->

There is no server, no account and no sign-in. The app contains no analytics,
advertising, tracking or crash reporting, and it makes no network requests to
send your data anywhere. We never see the names, the minutes or anything else
you enter.

## Your phone's backup

<!-- Source: ADR-011 amendment (#112, ruling "backup b"): release included in
     Android Auto Backup and iCloud, beta excluded; the coach can turn off
     backup; residual risk of older backups. Asserted in CI by
     check_backup.py and check_ios_app.py. Home-screen names: #108 ruling 40
     (revised 6 Oct). -->

Heart FC Coach is included in your phone's own backup (iCloud on iPhone and
iPad, Google on Android). That backup is held in **your** Apple or Google
account, under their terms, not ours. It means a lost or replaced phone can
get the season back. You can turn this backup off in your phone's settings.

The test version, Heart FC Beta, is never included in the phone's backup.

## Sharing and exports

<!-- Source: ADR-011 decision 4 (export is an explicit, coach-initiated
     action; the coach controls the destination); ADR-017 decision 4 and
     "Not protected, honestly"; src/app/ledgerFile.ts (the only use of
     expo-sharing: "Export minutes file", via the phone's share sheet). -->

The app shares nothing by itself. If you choose **Export minutes file**, the
phone's share sheet opens and you pick where it goes: your email, your files,
another phone. That file is a full copy of the season, children's first names
included. Once it is shared, where it goes and who can read it is up to you
and the service you chose.

## Deleting your data

<!-- Source: App.tsx forgetEverything (clears the saved session and the
     ledger); SettingsScreen.tsx confirm text ("deletes the squad, the team
     name, every saved match and every player's minutes"); ADR-011 amendment,
     impact table "Mitigations" and "Residual". -->

- **Forget everything**, in Settings, deletes the squad, the team name, every
  saved match and every child's minutes from the phone.
- **Uninstalling** the app removes its data from the phone.

An older phone backup can still hold the data until your phone's backup
service replaces it. Files you exported yourself are not touched.

## Children

<!-- Source: invariant 4; src/app/squad.ts validateName; #108 "What v1 is"
     (not in the Kids category, rated 4+). -->

The app is for the adult who coaches the team. It is not aimed at children,
and it is not in the App Store's Kids category. The coach enters children's
first names only, and nothing else about them.

## Changes to this policy

<!-- Source: this page lives in the public repository (#108 ruling Q3), so
     its history is public; ADR-011 decision 3 (any feature that moves player
     data off the device needs a new, approved ADR with a data protection
     impact assessment). The "before that version is released" commitment is
     this page's own. -->

This page lives in the app's public code repository, so every change to it,
and its date, can be seen in its history. Under the project's own rules, the
app may not start sending data off the phone without a recorded decision
first. If that ever happens, this page will say so before that version of the
app is released.

## Contact

<!-- Source: #108 ruling Q4 (the repo's Issues page; no email address). -->

Questions or concerns: open an issue at
[github.com/vanstoner/coaching-app/issues](https://github.com/vanstoner/coaching-app/issues).
Issues are public, so please don't include children's names.

*Last updated: 6 October 2026.*
