# Feature specs

Status: **Draft**, retrofitted from the code at `e04fbb0` (v1.0.1), 2026-10-09.
Last updated: 2026-10-18

One row per shipped feature. Acceptance criteria live in the issue; this is
the contract the code enforces today. `session` = `coaching-app/session/v1`,
`ledger` = `coaching-app/ledger/v2` (+ `/head`).

## Squad (Tuesday)

| Feature | Trigger | Pre-conditions | Business invariant / rule | Persistence key | Error / edge state |
|---|---|---|---|---|---|
| Add player | Squad tab, type a name | — | One word, ≤16 chars, trimmed (`validateName`); duplicate first names need a `displaySuffix` | session `players` | "Alex Smith" refused as a likely surname (#54 open: nicknames too) |
| Remove / retire player | Squad tab → Remove | — | Never deleted once played; `active=false` keeps their history | session, ledger `player` | Played → retired (listed under "Removed, still in past matches"); never played → deleted |
| Keeper preference, unit, outfield target | Child page | — | Target is displayed beside figures, never a fairness input (ADR-015) | session `players` | — |
| Defaults | Settings | — | Length, periods, shape are **defaults**; a match copies them at creation | session root | Changing them never touches a saved match |

## First open (#218)

| Feature | Trigger | Pre-conditions | Business invariant / rule | Persistence key | Error / edge state |
|---|---|---|---|---|---|
| Getting started card | Home | A step undone, not closed | Purpose line and three steps, each a button to its screen. Ticks worked out from the phone on every draw, never stored: squad at the default shape's on-field count (7, Pick the lineup's threshold), "N of 7 added" until then; any match saved; any match kicked off or any match in the record. Goes by itself when all three tick, with one message | `coaching-app/getting-started/v1`, only once closed; a view choice, never the record | Closed early: 5 s Undo. A key that does not read is treated as open |
| Show Getting started again | Settings | Closed, a step undone | Removes the closed choice and returns Home | removes `coaching-app/getting-started/v1` | Forget everything also brings it back |
| First-time empty states | Home (no matches), Played, empty Squad, each squad view | Nothing played yet: no match finished on this phone (archived and hidden count) and none from the record | One sentence and the next step's button (plan the next fixture, else add one). Otherwise each screen is as before (AC6) | none | All fixtures archived: "Every fixture is archived." as before |
| Try it with a made-up team | Getting started, or empty Squad | No player ever in the squad | The Test kit's squad, two fixtures and nine-match season, through `addTestData` and `addTestSeason` as the demo seeds them. Nothing beta-only is turned on | session, ledger | Ledger may not be written: squad and fixtures only, and the message says so |
| Made-up team line | Home | `isMadeUpTeam`: every active player has a Test kit name and a match is against a made-up opponent | Derived on every draw, no flag stored; points to Forget everything | none | A real child added, or every made-up fixture gone: the line goes (documented limit) |

## Fixtures

| Feature | Trigger | Pre-conditions | Business invariant / rule | Persistence key | Error / edge state |
|---|---|---|---|---|---|
| Add fixture | Home → Add | — | `newMatch` snapshots format, length, periods; today's active squad recorded as available | session `matches[]` | Saved immediately with the live match kept (a half-time add once dropped it) |
| Delete fixture | Home | No period started (judged on the **live** state) | Played real matches are never deleted (invariant 5): on the report they are left out of the figures or voided, with a note. A test match deletes, from Settings › Test matches (#194) | session | Releases a held, unstarted match first so it is not written back |
| Archive | Home | Match finished | Listing only; no event, no minutes change | session `archived` | — |
| Plan a match | Home → Plan, or "Plan the rest" mid-match | — | Intent only; pre-fills the lineup; never moves a minute. Every new sub starts at the period's midpoint, the second and third too; none is staggered, and ± moves one sub only (#205) | session `matches[].plan` | Malformed plan dropped on load, match kept |
| Rename positions | Plan or lineup | No period running (#166 Q1) | Labels only; optional copy to the squad default | session `matches[].format` | — |
| Share plan | Plan | Plan has content | One image; absent players kept off the bench; each sub at its exact planned time, "Ava on for Ben – 6:15", one line each in plan order (#205) | none (shared file) | Share sheet cancelled: nothing happens |

## Match day (Saturday)

| Feature | Trigger | Pre-conditions | Business invariant / rule | Persistence key | Error / edge state |
|---|---|---|---|---|---|
| Play now | Home | No match under way | Builds a match from defaults, no fixture form | session on next save | Too few players → squad editor, then lineup |
| Start a test match | Settings › Test matches | Enough players; no real match under way | Today's squad on the real screens, each with a "Test match · not recorded" banner and its own ×1/×5/×10 clock (Heart FC Coach too). Never passed to `recordMatches`; on no list, view, attendance or figure; listed only in Settings with Open, Delete and Delete all, which remove it from the phone (#194) | session `matches[].match.test` only, never the ledger | Too few players or a match under way: the button is disabled and says why. Leave and Back return to Settings |
| Mark absent / here | Lineup | Before kick-off | Absent players cannot be picked; snapshot at kick-off | session `availability`; ledger `attendance` | Between periods only "arrived" (a late arrival correction) |
| Start period | Lineup → Start | Valid sheet, one GK, no duplicates | Records the actual sheet, never the plan; opens Appearances and BenchStints | session, `periodSubs` | Engine throws → nothing starts |
| Clock | Clock screen | Period running | Elapsed from wall-clock anchors; timer only repaints (invariant 2) | `runningSinceWallClock` | Overtime shown, never auto-ended; phone clock change moves the figure |
| Planned subs list | Clock, above the pitch | Period running | One line per planned sub in time order, "Ava on for Ben · 6:15" (or "Ava on · 6:15 (who comes off: suggested Ben)"); made subs ticked; "Not planned: Cal" names bench players with no time. While a prompt shows, only the next two. Worked out on each paint from the anchors (#203) | none (from `periodSubs` and the record) | — |
| Change a planned sub mid-period | Tap a line, or a "Not planned" name | Period running | ±30 s, who comes off, or remove (no confirm). The plan only, never the record (#203 AC2) | `periodSubs` | A first "+" on a sub with no time gives the midpoint |
| Sub warning + buzz | Clock | 30 s before a planned sub | Prompt rises: green 30–15 s, amber 15–0 s, red and "late m:ss" after, countdown always in words. Subs at the same time share a panel. One buzz as it rises, foreground only. "Not now" puts it away for the period; tap the line to bring it back (#203) | `periodSubs`; "Not now" is screen state | Screen off / app backgrounded: no buzz, one on return |
| Substitute / swap | Sub prompt Done (with Undo), drag, or tap sheet | Period running | Engine closes one Appearance and opens the next at the same instant | session | Engine refuses → reminder left due, "could not be made" |
| Goal, shot on target, tackle, corner won, free kick won; save / conceded | Tap a player: picture buttons | Period running | Anyone on the pitch; save/conceded GK only. A goal asks who set it up (assist). A goal counts as a shot on target (#185, #202) | session `events`; ledger `event` | Refused → "could not be recorded" |
| Undo / withdraw | 10s toast, or Withdraw in time stream | Event not already withdrawn | Withdrawal is a new event with a mandatory note (invariant 5); undo of a move is a reverse move | session `events` | Blank note: button disabled |
| End period | Clock | Period running | Freezes `accumulatedMs`; closes open stretches at the chosen end. Past planned + 1 min it asks: "Ended at planned time" (floored at the last thing recorded, e.g. "Ended at 13:00 (last sub)") or "Ended just now" (#180) | session; ledger `interval` | Last period → full time; "Still playing" changes nothing |
| End match | Summary | Every period ended | `completed`; counts towards season averages | session; ledger `match` | — |
| Correct attendance | Summary | Ledger writable | Noted correction appended, never edited | ledger `attendance` | Ledger blocked → refused with reason |
| Leave | Every Saturday screen | — | Match keeps running and stays current. A test match goes back to Settings (#194) | session `currentMatchId` | — |
| Resume | Launch | A started, unfinished match | Running period → clock; between periods → lineup | session | Cannot rebuild → Home |

## Minutes ledger

| Feature | Trigger | Pre-conditions | Business invariant / rule | Persistence key | Error / edge state |
|---|---|---|---|---|---|
| Record | Every save | Ledger writable | Only closed intervals; idempotent by id; hash-chained (ADR-013/014); each entry signed by the install (#193) | ledger | A failed write is retried on the next commit until one lands (#184) |
| Leave a match out | Match report | — | An `exclusion` record with a note; out of averages, totals and games missed, still listed (ADR-020) | ledger `exclusion` | — |
| Void a match | Match report → "Void, with a note" | In the ledger; not a test match | A `match-kind` record (`void`, with a mandatory note) hides it from every screen and figure; the chain keeps it. Listed with the hidden test matches in Settings › Test matches, with Show it again (#194, PO 18 Oct) | ledger `match-kind` | Blank note: Void disabled. Ledger blocked → refused with reason |
| Hide test matches | Settings › Test matches | #194 | Offers earlier matches with no opponent that were left out as a test or ended within a period; the coach confirms. A `match-kind` record (`test`, with a note) hides each from every screen (`visibleLedger`); listed only here with voided matches, each can be shown again | ledger `match-kind` | — |
| Open at launch | Launch | — | Never overwrites: unreadable → set aside; too new → read-only. Same rules for the session (#173) | ledger, head, session, `unreadable/*` | Store read fails → blocked this session |
| Export | Settings → Minutes | — | Explicit act to a place the coach chooses (ADR-011) | none | Shows count + fingerprint |
| Import | Settings → Minutes | Not blocked | Extends the chain or is refused; never merged | ledger, session `players` | Diverged chain refused with reason |
| Back up this app | Settings → Backup | — | One file: session + ledger. This app's data only (#192) | none (shared file) | Share cancelled: nothing happens |
| Restore from a backup | Settings → Backup | Confirm after preview | Damaged or too-new file refused. Current data copied aside and read back first; then the launch re-runs (#192) | session, ledger, head, `before-restore/*` | Copy not proved → nothing restored |
| Forget everything | Settings | Confirm | Clears session and ledger keys; fresh squad id; the placeholder name "Your team" (#218); Getting started shows again | session, ledger, head, view choices | Irreversible; confirm text says export first. **Copies kept aside remain (#207)** |

## Views

| Feature | Trigger | Pre-conditions | Business invariant / rule | Persistence key | Error / edge state |
|---|---|---|---|---|---|
| Match summary / analysis | End of match, or from the clock | Match held | Folded from the record each render; nothing stored | none | — |
| Season and child views | Squad tab / child page | — | Fairness = total pitch time, never per position (invariant 3) | none (read ledger) | Ledger blocked → shown, not written |
| Sort an analytics table | Tap a column heading (Settings › Player minutes, the squad views, match report, match analysis, a match from the record, the Squad tab's list) | — | Default minutes most first, or distance from the average in one straight descending order; tap again reverses, ▼/▲ on the heading in use; ties in squad order; Main keeper last in the squad views; charts drawn in the table's order. The Squad tab's list sorts the same way (Name, a game), minutes a game most first, children with no matches below in squad order, Main keeper last (#222, overriding #208 AC7 for that list). Lineup, bench and plan: squad order (#208, overturning ruling Q1) | `coaching-app/table-sort/v1`, a view choice, never the record; removed by Forget everything | A stored sort that does not read, or a column no longer there, falls back to the default |
| Played: matches from the record | Home | A completed match in the record with no fixture here (e.g. imported) | Listed by date with "◐ reconstructed"; opens read-only. No events → "Score not recorded" (#195 AC1) | none (read ledger) | — |
| Test kit | Settings, beta/demo/dev only | `showTestKit` | Clock speed ×1/×5/×10; test squad and season; time signing on this phone (#193) | `TEST_CLOCK_KEY` | Never in Heart FC Coach |
