# History

How the coaching app came to be what it is, one entry per full release. The
detail lives in the issues and pull requests linked here; this page is the
thread through them (PO ruling, #98: "log what we did for history of the app,
posterity").

From v2 on, every pull request that becomes a full release adds its dated
entry here, under the version it ships in.

---

## v1 — 17 September to 4 October 2026

**One question at the touchline: who comes off next, and is everyone getting a
fair share?** One coach, one under-10s squad, a 50-minute Saturday match in
quarters or halves, on an Android phone.

### Foundations (17 September)

- The operating model, the five invariants and ADRs 006–011, written before
  any app code (#14, #34). Minutes fold from records; time comes from
  wall-clock anchors; fairness is outfield time, never per position; first
  names only; corrections are explicit and never destructive.
- The match clock engine in pure TypeScript, with three defects found and
  fixed on day one: double-counted quarter time, quarters out of order, and
  state changed before validation (#15, #22, #30, #33).
- A CI test gate from the first day (#37).

### First build on a phone (18 September)

- An Expo app, an APK built in CI, an emulator test that proves the app
  renders rather than merely compiles, and a release cut on every green build
  of `main` (#40, #45, #49, #50).
- The running clock, minutes per player, persistence, and the substitution
  reminder — "ready for Saturday" (#51, #55, #56).

### Match day 1 (19 September)

The first real match on the app, and its field notes became the backlog
(#62). The same weekend: sub timing, a build label on screen, settings,
"no sub this quarter", a keeper who keeps, a device store that survives an
upgrade, plural matches and fixtures, and the fixtures list as the front door
(#57–#69). The six squad roles became skills that bind every session (#67).

### The shell (20 September)

Tabs, Play now, and match length and shape owned by each match rather than by
settings (#71).

### Match day 4 and Release 1.0 (3 October)

Rob coached from the app and noted what got in the way, live (#74). By the
end of the day:

- Plan every period before kick-off, with projected minutes; who comes off
  (#73). Retire rather than delete a player; delete or archive fixtures (#78).
- **Release 1.0 — "Match day 4"** (build 69, #85): the minutes ledger kept
  under its own key and exportable (ADR-013), the pitch view with draggable
  players, goals, saves and goals conceded with a score, and kick-off picked
  from chips.
- Position preferences with the keeper first, and re-planning the rest of a
  match during play (#87). A bundled font to stop the last character being
  clipped, and spaced pills (#90).
- **Coaching Beta**: every pull request installs as a separate app with its
  own id, storage and orange icon, so testing never touches the real squad
  (#79, #90, #91).
- **Merge = release**: Rob's approval merges a pull request, and the build of
  `main` is the full release, marked Latest, with the beta cleared (#92).

### After match day 4 (3–4 October)

- Build 76 bugs fixed, and the one that mattered most: a finished match was
  never listed as Played, and a Play-now match was deleted on leaving its
  summary, score and all. A mock match now plays four quarters through the
  app's own save path in the tests (#93, #94; build 80).
- A Test kit in Coaching Beta — a ×5 and ×10 clock and one-tap test data — so
  a whole match can be played through the real screens in five minutes before
  approving; and the clock no longer skips a second (#95, #96, #97; build 82).

### Where v1 ended

Build 82, 4 October 2026: 520 tests, a beta for every change, a release for
every approval. The pre-v2 assessment (#98) found the tested core sound and
two things to fix before the season's figures are built on it: the match
lifecycle sat in untested app code, and the ledger could drop fields written
by a newer version.

---

## v2 — season fairness, match analysis, iOS

Requirements and rulings: #98. Milestone: "v2 — season fairness, match
analysis, iOS". Entries are added as each release ships.

- **4 October — the foundation (#110).** Before v2 touches the ledger: the
  match lifecycle moved out of untested app code into one tested module; the
  ledger keeps fields a newer version wrote, refuses files that need a newer
  reader, and sets a damaged ledger aside rather than overwriting it; tests,
  lint and coverage now gate every release and every beta. ADRs 014–016
  recorded the hash-chained ledger, fairness on total pitch time, and charts.
  This history began here.
- **4 October — "Same as quarter N" (#111).** Re-planning during a match, the
  link copied the earlier quarter's plan — empty when its lineup had been set
  at kick-off — and silently did nothing. It now copies who was on the pitch
  at the end of a played quarter, and says so when there is nothing to copy.
- **4 October — an icon, a backup, and the first step to iPhone (#107,
  #112).** The app got its own icon — the whistle's cord tied into a heart
  around the ball, on a mown pitch; orange grass and a BETA tag for the beta.
  Coaching App now joins the phone's own backup so a lost phone keeps the
  season (Rob: "backup b"); the beta never does. iPhone bundle ids
  `com.vanstoner.coachingapp` (+ `.beta`), and every change is now compiled
  for iPhone in CI, ahead of TestFlight once Rob has enrolled with Apple.
