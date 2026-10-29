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
- **4 October — fairness is total time on the pitch (#101).** Invariant 3
  changed by Rob's ruling: fairness now counts goal plus outfield, so a
  dedicated keeper is no longer shown as owed time; the gloves still rotate
  by least time in goal. A player can carry an outfield-share target (25 %
  for the keeper), shown beside their figures and never a fairness input.
- **October — the match report, the season, and a ledger that notices
  (#100, #102–#105).** Full time now opens a short match report, and the
  coach closes the match with End match, the way a quarter is ended; only a
  closed match counts toward the season. Charts show each child's minutes
  beside a shadow average adjusted for the matches they missed, and the season
  splits into League, Cup, Friendly and Tournament. Who was available is
  recorded at kick-off, including late arrivals between periods. The ledger is
  hash-chained with a remembered head, so a damaged or shortened ledger is set
  aside intact rather than trusted, and each export shows a short fingerprint.
- **4 October — a past season in the beta (#106).** Rob: "more historical
  data in the beta so I can see averages." The beta's Test kit can now add
  nine played matches on the Saturdays before today — six league, two cup,
  a friendly — with goals, saves, subs, absences and a dedicated keeper.
  Each is played through the real match engine and ledger, so the charts,
  the season columns and the match report show real-shaped history.
- **4 October — plan a sub by tapping the bench (#120).** In the Plan, tapping
  a bench player opens a menu: bring them on at a time (the midpoint, or the
  next free 15 seconds after it) and pick who comes off. A player with a sub
  already sees it, with Change and Remove. Add a sub still works as before.
- **4 October — the docs tell the truth again (#123).** A review found the
  README still said the app's data was never backed up, and three specs
  claiming to be current had stopped on 18 September. The README was rewritten,
  the specs now say they are the v1 foundation, the September process documents
  moved to `docs/archive/`, and every pull request now updates any doc it makes
  wrong. Shipped issues were checked criterion by criterion against their tests.
- **4 October — season figures live with each child (#121).** Match screens
  now show only the match and point to Squad, where each child's row and page
  carry their minutes a game, played and missed, by competition. The Main
  keeper is left out of the squad average. The Season screen is gone.
- **4 October — two defects from QA's retroactive check (#125, #126).** Every
  pill on the pitch and bench now shows total pitch time, with "GK" on the
  child in goal, so a former keeper no longer reads 00:00. A Play now match
  reports the date and time its first period started instead of "Date TBC".
- **5 October — the Test kit on a local build (#134).** Rob: "how do I run
  the beta version, that lets me add sample data". The Test kit now shows in
  any development build as well as a pull-request beta, and never in a
  release of Coaching App. `npm run ios:beta` and `npm run android:beta`
  build the local copy as Coaching Beta, with its own id, name, icon and
  storage.
- **5 October — the phone buzzes when a sub is due (#137).** The first step
  of ruling 19: with the clock on screen, each planned sub buzzes the phone
  once as it falls due, or on coming back to the app if it fell due while
  away. Settings has "Buzz when a sub is due", on unless turned off.
- **5 October — sub reminders survive Android closing the app (#139).** The
  subs planned at kick-off are saved with the match, so after a relaunch
  mid-period the ones still to come return at their planned times, and buzz.
  Subs already made are read from the record and not offered again.
- **6 October — the squad views, and the iPad (#143).** The design Rob
  approved on #138: four tiles above the Squad list, each showing its answer,
  open a Season grid (each child's minutes in each match), Fairness at a
  glance ("Everyone within 5 min a game of the squad average, 39", and how
  that gap changed match by match), Going into Saturday (who is owed 5
  minutes or more over the season) and Positions tried (a record, not a
  target). A child's page is now a stack of cards, Playing time first. The
  Main keeper stays outside the average, and every list keeps squad order.
  Parts now add up to the total beside them (#142): a keeper's 38 in goal and
  12 outfield beside 50, where it read 38 and 13. On an iPad the app runs
  portrait and full screen, in a centred column; phones are unchanged.
- **6 October — it becomes Heart FC Coach 1.0.0 (#108).** Ready for the App
  Store and for Saturday's first real match, the app takes its own name:
  **Heart FC Coach** under the icon, and **Heart FC Beta Coach** for every
  beta and the demo. The GitHub releases carry the same names. The Android
  package becomes `com.vanstoner.coachingapp`, matching iOS, so the old
  Coaching App is uninstalled once. The version is now **1.0.0** on both
  stores and the releases page, with the build number still counting up.
- **7–9 October — the App Store submission (#162–#164, #181, #183).** A
  listing, a privacy policy and a small website; a first good set of
  screenshots, uploaded by CI; answers to Apple's information request; and a
  TestFlight "What to Test" that walks a tester through the whole version,
  with a made-up test season to import.
- **8 October — Heart FC Coach 1.0.1 (#168, #169, #171).** A match's
  position names can be renamed on the Plan and lineup, and **Share plan**
  makes one picture of the plan for parents: positions, subs and bench, no
  minutes. TestFlight now uploads only when a merge bumps the version (#170).
- **9 October — released data survives every update (#172).** A frozen copy
  of 1.0.0's saved data is opened by every build in CI, so an update can never
  again be the thing that loses a season.
- **14 October — the v1.0.1 audit and its fixes (#178).** A full audit of the
  code against the invariants. Three fixes Rob approved: a squad that will not
  read is set aside, never overwritten by an empty one at launch (#173); a
  forgotten clock asks "Ended at planned time" or "Ended just now" instead of
  crediting everyone on the pitch with the overrun (#180); and Android screens
  no longer draw under the status and navigation bars (#174). Specs 01–03 are
  marked as the approved v1 foundation; three as-built pages and ADRs 018–019
  describe the app as shipped.
- **15 October — persistence hygiene (#184).** A ledger write that fails is
  retried until one lands; session saves queue behind each other; a damaged
  match is left out after the whole document is set aside, so one bad match
  no longer costs a season.
- **16 October — leave a match out; in-play events (#188).** Any match can be
  left out of the averages and totals, retrospectively and with a note,
  without touching its minutes (ADR-020). Tackles, corners won, free kicks
  won and assists join goals and saves as picture buttons.
- **17 October — the record of truth begins (#191, ADR-021 Proposed).** Rob:
  *"there's a future date where the record of truth might be centralised…
  I do want to keep it to a position when we are happy to lock it down."*
  - **Back up this app, restore it (#192, PR #200).** One file holds
    everything the app keeps; a restore shows what the file holds, keeps what
    was on the phone aside, and never deletes. Its first real use moved Rob's
    season from the beta into Heart FC Coach the same day.
  - **Each phone signs what it records (#193, PR #201).** An Ed25519 key per
    install, in the phone's secure store; every entry signed, so a match
    recorded live can later be shown as untouched wherever the file travels.
    Measured on Rob's phone: 10–13 ms to sign, 7–8 ms to check.
  - **Shot on target (#202, PR #204).** A picture button; a goal counts as a
    shot on target, and the report adds the opposition's.
  - **This season's first four matches, from paper.** Rob's Excel sheets and
    match reports were checked (every period adds to 350 pitch-minutes;
    match day 3 corrected from its report), turned into a minutes file on top
    of his own, and imported. Nothing on his phone was changed.
  - **Played lists imported matches (#195, PR #206).** A match in the
    record with no fixture on this phone appears under Played, tagged
    reconstructed, and opens read-only.
  - **Forget everything forgets everything (#207, PR #209).** It now also
    removes the copies kept aside by a restore or an import, as the privacy
    policy says.
- **17 October — Heart FC Coach 1.1.0.** The second store release: app
  backup and restore, signed entries, shot on target, and imported matches
  under Played. 1.0.1's saved data, with signed entries, is frozen as
  `release-1.0.1` and opened by every build in CI (#167).
- **17 October — Heart FC Coach 1.1.1: test matches hidden (#194).** Rob:
  *"the 3 on the 16th lasting a minute look silly being shown in the league
  tables."* Settings › Test matches offers the earlier matches that look like
  tests (no opponent, and left out as a test or over within a period). Once
  the coach confirms, each is marked a test in the record, with a note, and
  disappears from every screen. The record keeps them, and each can be shown
  again.
- **18 October — Heart FC Coach 1.2.0: tables sorted by their numbers
  (#208).** Rob: *"all analytics screens should be in order of their
  numbers … We're trying to highlight discrepancies."* Every analytics table
  opens on its figure, most first (distance from the average in one straight
  run, +6 … −5), and a tap on a heading re-sorts it; charts follow their
  table, the Main keeper stays last in the squad views, and each table
  remembers its sort on the phone. The first version bumped by the rule that
  every coach-visible change moves the version in the same pull request
  (#217).
  Adding squad members keeps the name box focused, so a whole squad goes in
  one name after another (#219).
- **24 October — Heart FC Coach 1.3.0, released.** Rob, 18 Oct: *"I want all
  the stuff above built … as 1.3.0 … that's probably a version I'll draw a
  line under and release."* First published as build 238 on 24 October; the
  latest 1.3.0 build is 246. Its issues were closed with their final criteria
  on 25 October (#239 S3).
  - **A screen reader reaches each part of a fixture card (#226).** A card on
    Home was one spoken element, its links buried inside it. Now its lines
    read as one button, "Open Practice Park, Sat 24 Oct …", and Plan this
    match, Edit the plan, Archive and Remove are each a button of their own.
    A finger works the card exactly as before.
  - **Planned subs start together, and the shared plan shows exact times
    (#205).** Every new sub in Plan the match starts at the half-period (6:15
    in a quarter, 12:30 in a half); nothing is moved to a free slot any more,
    and ± moves only that sub. The picture shared with parents shows each
    sub's exact time ("Ava on for Ben – 6:15"). Saved plans keep their times.
  - **The clock shows this quarter's subs and warns 30 seconds early (#203).**
    A list above the pitch shows every planned sub and its time; made subs
    are ticked, unplanned bench players listed. Tap a line to move it 30 s,
    change who comes off or remove it (the plan, never the record). Thirty
    seconds before each sub its prompt rises green, turns amber at 15 s and
    red counting "late"; the phone buzzes once. "Not now" puts it away for
    the quarter; Done makes the sub, with Undo.
  - **First open shows a new coach how to start (#218).** Home opens with a
    *Getting started* card: what the app is for ("Who comes off next, and is
    everyone getting a fair share?") and three steps (add your squad, add
    your next match, press Play now), each a button that ticks itself off
    from what is on the phone. It goes away once all three are done, or can
    be closed with Undo; Settings offers it back while a step is undone.
    Screens empty because nothing has happened yet say what to do next. An
    empty squad can *Try it with a made-up team*; a yellow line on Home says
    so, and Forget everything clears it. The unnamed team is "Your team"
    instead of "Example FC". A phone with a squad and matches looks as before.
  - **Test matches from Settings, never recorded (#194).** Settings › Test
    matches › Start a test match plays the squad on the real screens, each
    marked "Test match · not recorded", at ×1, ×5 or ×10 (only that match
    runs fast). It never enters the record, Home, Played or any figure, and
    can be opened, deleted or deleted all from Settings. A played real match
    can't be deleted; its report offers "Void, with a note", which takes it
    off every screen, keeps it in the record, and lists it with the hidden
    test matches to show again.
  - **Squad list in order (#222).** The Squad tab lists children by minutes a
    game, most first; tap Name or "a game" to re-sort (remembered). Children
    with no matches keep their order below, the Main keeper last; lineup,
    bench and plan are unchanged.
  - **Clearing the made-up team (#218).** The first player added to the
    made-up team asks "This is the made-up team. Clear it and start your real
    squad?". Clear it and start removes the made-up children, fixtures and
    matches, from the record too; Keep exploring adds them to it.
  - **A phone can be rebuilt from the record; fill-ins (#195, #190).** The
    minutes file now carries fixtures, each child's preferences and Settings:
    imported on an empty phone it brings back the squad, preferences,
    Settings, upcoming fixtures and every played match (not plans; the app
    says so); on a phone with data it only adds what is missing. A deleted
    fixture is recorded as cancelled, never erased. A child from another team
    can be marked a fill-in, with a note: their minutes are kept and they get
    a fair share on the day, but they are left out of the squad average,
    fairness figures and "who's owed time".
  - **Importing onto a squad typed in by hand matches the children by name
    (#195).** A phone that has played nothing but has a squad no longer ends
    up with every child twice. Before importing, Settings › Minutes shows
    which children match by name, which are only in the file and which only
    on this phone, and the coach chooses: Match by name (recommended), Use
    the file's squad, or Keep both. The file's team name is kept (rename it
    in Settings). A name that appears twice is never guessed. Nothing is
    erased: each matched child gets a noted record
    saying which of the file's children it became.
  - **Every match has its result, and goals can be added without a time
    (#196).** Played matches show "W 4 – 1", worked out from their goals. A
    goal or goal against with no known time, scorer optional, can be added
    with a note from a played match's page (how the 3 Oct cup match gets its
    score). The page shows how the match was actually played, correctable
    with a note, and minutes by position.
  - **Awards (#197).** Player of the Week and Mr Assister are ready in
    Settings › Awards; add, rename or retire your own. Give one from a played
    match's page; joint winners allowed; a change after the day needs a note.
  - **The coach's tallies (#198).** Add your own in Settings › Tallies, for a
    child or the team; it gets its own button during play. Saves, shots,
    tackles, corners, free kicks and your tallies sit under "More stats" on a
    report, apart from goals and the result.
  - **How far each match can be trusted (#199).** Signed live matches look as
    before; live matches recorded before signing carry "◐ live, unsigned";
    matches entered afterwards a dashed outline and "◐ reconstructed", with
    the reason on the match page. Squad's "Include reconstructed matches"
    shows every figure without them.
  - **5-a-side, and 40-minute matches (#223).** Two 5-a-side shapes sit
    beside 2-3-1 and 2-2-2 in Settings and on each fixture: 1-2-1 + GK (GK,
    D, LM, RM, F) and 2-2 + GK (GK, LB, RB, LF, RF), renameable like any
    other. Lineup, "enough players", Getting started, the plan, the clock's
    sub list, the pitch and the shared plan follow the match's shape, and
    the record keeps it through a restore. 40 minutes joins the lengths (40,
    50, 60, 75, 90), in halves of 20 or quarters of 10. A fixture opened
    without enough players now counts the squad against its own shape, and
    the squad editor's Start plays that fixture, with its opponent, rather
    than a Play-now match from the defaults.
  - **Fairness uses the season's main format (#223).** If a season mixes 5-
    and 7-a-side, fairness counts the format played most; the other matches'
    minutes stay in each child's totals, and Squad says how many are left out.
  - **The amber sub prompt is readable (#227).** In amber, the countdown,
    the chosen name and Done were brown on dark brown (2.67:1); they are now
    amber on dark brown (7.9:1). Every word of the prompt, in green, amber
    and red, reads at 4.5:1 or better, and a test checks it.
  - **Beta tidy-up (#228).** Rob, 23 Oct: *"Nearly there."*
    - **Shorter labels.** The tap sheet's "Shot on target", "Corner won" and
      "Free kick won" read **Shot**, **Corner** and **Free kick**, and so do
      the time stream, Undo, More stats and Settings › Tallies. Only the
      words changed: the record's kinds are the same, and a shot still means
      on target.
    - **A calmer amber.** The sub prompt's 15-second orange, and End quarter
      once a period runs over, are one sand colour with dark ink (9.6:1). End
      quarter's white label on orange read at 3.3:1.
    - **No speed buttons in the Test kit.** Settings › Test kit › Clock
      speed is gone: Start a test match has its own ×1, ×5 and ×10. A beta
      phone left fast runs at ×1 from its next launch, and its clock never
      goes backwards.
    - **Tally buttons all one size.** The tap sheet is one grid, three
      across, and a tally you add is the same size as Goal or Save. Each of
      your tallies gets its own colour and picture, in the order you added
      them, and keeps it for good.
    - **Awards before the match is closed.** From the first period, tap a
      player and "Give Maya an award ›"; at a break, "Awards: 1 of 2 given ›"
      opens the awards. End match asks for any award still to give, and
      "Give them later" closes the match as before. The report lists the
      awards given. Test matches have none. At full time the clock shows the
      award card straight away, with "Give them later"; End match still asks
      while an award has no winner (Rob's ruling `both`).
    - **Less at the top of the screen.** The clock's period, time left,
      clock and score share one strip, the sub plan folds to its next line
      ("+1 ▾" opens the rest), and the standing hint is gone, so the pitch
      starts much higher. On Home, Getting started is one line with a
      progress bar ("1 of 3 ›", its steps a tap away), and Play now and
      "+ Fixture" sit side by side.
      The match report has the opponent and score on one line, one "Not
      closed" or "Closed" pill, goals added later marked on their own lines,
      and "In the record ›" at the foot.
- **26 October — Heart FC Coach 1.3.1: the match report reads the record
  (#244).** Found by QA in the check ADR-022 D1 asked for: after a goal was
  taken back or added with time unknown in "In the record", or the match's
  structure was corrected there, the match report kept showing the phone's
  copy. Its score was right, but the goals listed and the "50 min, quarters"
  caption contradicted the record page one tap away. A match in the record
  now reads the record for its goals, assists, goals conceded, tallies and
  how it was played ("2 halves of 25:00"), as its record page does. Minutes
  already agreed and are unchanged. A match still being played reads as
  before.
- **Heart FC Coach 2.0.0: teams and seasons (#224, #243; ADR-022), in
  progress.** Rob, 18 Oct: *"if I am a coach of multiple squads I'll need to
  switch to a squad and from there everything is only related to that
  team … thinking like profiles in a browser."* Built in steps on one pull
  request, each step a beta:
  - **Each team keeps its own data, and the phone's data moves into the
    first team.** Nothing changes on screen. On the first launch the phone's
    squad, fixtures, minutes record and settings are copied, byte for byte,
    into team 1, read back, and only then set aside. A launch interrupted
    part-way through picks up where it stopped, and a copy that does not read
    back leaves the data where it was, read-only. Every released version's
    data, 1.0.0 to 1.3.1, moves with identical figures.
  - **Seasons are kept in the record.** A team has seasons, each with its
    name, main format, age group, level and fairness (Full equal time, the
    only one in 2.0.0). A match belongs to the season its fixture was made
    in, never to a date. Until the coach names it, a team is in one first
    season with nothing set, so every figure is what it was.
  - **Teams, switched like profiles.** Home's title is now the team chip:
    its badge, name and season line. A tap opens the team list, with "Match
    on" beside a team whose match is running, and Add a team, which asks for
    the team's name and first season (age group, level, main format;
    fairness is Full equal time). Settings switches team too, and removes
    the open team once its name is typed; a removed team is set aside and
    can be brought back. A new phone opens on "No teams on this phone yet",
    which also restores from a backup, so no team need be made first.
  - **Seasons on screen.** Settings opens with the season: its name, age
    group, level, main format and fairness, when it began and how many
    matches. The first season asks the coach to confirm its age group and
    name (U10 Development offered, nothing saved until Confirm), and to set
    its main format, saying what that would change. Start a new season is
    one screen copied from the last, with the age group moved up a year and
    named on the button; from August a card on Home offers it ("Not yet"
    for a week). Every figure now covers the current season only; past
    seasons open read-only with their own. A match in another format is
    left out of the season's figures unless the coach counts it, with a
    note.
  - **Back up every team in one file.** A backup now holds every team on
    the phone. Restoring it replaces each team the phone already has (its
    data set aside first, as before), adds the others, and leaves alone any
    team not in the file. A backup from 1.x restores into the open team.
- **29 October — Heart FC Coach 2.0.1: Played in date order (#251).** Rob,
  after a Play now match: it went to the bottom of Played, not the top. A
  Play now match has no planned kick-off, and Played sorted by kick-off
  alone, so it sat with the undated. Its card already showed when it was
  played (#126); Played now sorts by that same date, most recent first, with
  ties in one fixed order. A match known only from the record, without a
  kick-off, still has no date (the record keeps no clock time for a period)
  and stays last. Release 2.0.0 is frozen as a fixture, in the team layout
  2.0.0 phones use (#167).
- **2.1.0 (in progress) — first names by default (#54).** Rob, 26 Oct: relax
  the one-name rule to a warning. One word is still added at once; a longer
  name stops at a warning that says why first names are the default and
  recommends an initial ("Alex S"), with Keep and Change it beside it. A
  second child shown by the same name is offered an initial first, and a
  child can be renamed from their page. Invariant 4 now reads "first names
  by default", with still no field for a surname, date of birth, contact or
  photo. Release 2.0.1 is frozen as a fixture (#167).
  The score is now a big band on the pitch, and stays in view between
  quarters and at full time (#252). A fixture can carry its pitch surface
  (3G, 4G, Grass), its condition and the referee, changeable at any time;
  the referee never leaves the phone except in the coach's own backup
  (#254).
