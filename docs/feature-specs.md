# Feature specs

Status: **Draft**, retrofitted from the code at `e04fbb0` (v1.0.1), 2026-10-09.
Last updated: 2026-10-17

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

## Fixtures

| Feature | Trigger | Pre-conditions | Business invariant / rule | Persistence key | Error / edge state |
|---|---|---|---|---|---|
| Add fixture | Home → Add | — | `newMatch` snapshots format, length, periods; today's active squad recorded as available | session `matches[]` | Saved immediately with the live match kept (a half-time add once dropped it) |
| Delete fixture | Home | No period started (judged on the **live** state) | Played matches are never deleted (invariant 5) | session | Releases a held, unstarted match first so it is not written back |
| Archive | Home | Match finished | Listing only; no event, no minutes change | session `archived` | — |
| Plan a match | Home → Plan, or "Plan the rest" mid-match | — | Intent only; pre-fills the lineup; never moves a minute | session `matches[].plan` | Malformed plan dropped on load, match kept |
| Rename positions | Plan or lineup | No period running (#166 Q1) | Labels only; optional copy to the squad default | session `matches[].format` | — |
| Share plan | Plan | Plan has content | One image; absent players kept off the bench | none (shared file) | Share sheet cancelled: nothing happens |

## Match day (Saturday)

| Feature | Trigger | Pre-conditions | Business invariant / rule | Persistence key | Error / edge state |
|---|---|---|---|---|---|
| Play now | Home | No match under way | Builds a match from defaults, no fixture form | session on next save | Too few players → squad editor, then lineup |
| Mark absent / here | Lineup | Before kick-off | Absent players cannot be picked; snapshot at kick-off | session `availability`; ledger `attendance` | Between periods only "arrived" (a late arrival correction) |
| Start period | Lineup → Start | Valid sheet, one GK, no duplicates | Records the actual sheet, never the plan; opens Appearances and BenchStints | session, `periodSubs` | Engine throws → nothing starts |
| Clock | Clock screen | Period running | Elapsed from wall-clock anchors; timer only repaints (invariant 2) | `runningSinceWallClock` | Overtime shown, never auto-ended; phone clock change moves the figure |
| Sub reminder + buzz | Clock | Planned sub due | Buzzes once per sub per period, foreground only | `periodSubs` | Screen off / app backgrounded: no buzz |
| Substitute / swap | Due-sub Done, drag, or tap sheet | Period running | Engine closes one Appearance and opens the next at the same instant | session | Engine refuses → reminder left due, "could not be made" |
| Goal, shot on target, tackle, corner won, free kick won; save / conceded | Tap a player: picture buttons | Period running | Anyone on the pitch; save/conceded GK only. A goal asks who set it up (assist). A goal counts as a shot on target (#185, #202) | session `events`; ledger `event` | Refused → "could not be recorded" |
| Undo / withdraw | 10s toast, or Withdraw in time stream | Event not already withdrawn | Withdrawal is a new event with a mandatory note (invariant 5); undo of a move is a reverse move | session `events` | Blank note: button disabled |
| End period | Clock | Period running | Freezes `accumulatedMs`; closes open stretches at the chosen end. Past planned + 1 min it asks: "Ended at planned time" (floored at the last thing recorded, e.g. "Ended at 13:00 (last sub)") or "Ended just now" (#180) | session; ledger `interval` | Last period → full time; "Still playing" changes nothing |
| End match | Summary | Every period ended | `completed`; counts towards season averages | session; ledger `match` | — |
| Correct attendance | Summary | Ledger writable | Noted correction appended, never edited | ledger `attendance` | Ledger blocked → refused with reason |
| Leave | Every Saturday screen | — | Match keeps running and stays current | session `currentMatchId` | — |
| Resume | Launch | A started, unfinished match | Running period → clock; between periods → lineup | session | Cannot rebuild → Home |

## Minutes ledger

| Feature | Trigger | Pre-conditions | Business invariant / rule | Persistence key | Error / edge state |
|---|---|---|---|---|---|
| Record | Every save | Ledger writable | Only closed intervals; idempotent by id; hash-chained (ADR-013/014); each entry signed by the install (#193) | ledger | A failed write is retried on the next commit until one lands (#184) |
| Leave a match out | Match report | — | An `exclusion` record with a note; out of averages, totals and games missed, still listed (ADR-020) | ledger `exclusion` | — |
| Open at launch | Launch | — | Never overwrites: unreadable → set aside; too new → read-only. Same rules for the session (#173) | ledger, head, session, `unreadable/*` | Store read fails → blocked this session |
| Export | Settings → Minutes | — | Explicit act to a place the coach chooses (ADR-011) | none | Shows count + fingerprint |
| Import | Settings → Minutes | Not blocked | Extends the chain or is refused; never merged | ledger, session `players` | Diverged chain refused with reason |
| Back up this app | Settings → Backup | — | One file: session + ledger. This app's data only (#192) | none (shared file) | Share cancelled: nothing happens |
| Restore from a backup | Settings → Backup | Confirm after preview | Damaged or too-new file refused. Current data copied aside and read back first; then the launch re-runs (#192) | session, ledger, head, `before-restore/*` | Copy not proved → nothing restored |
| Forget everything | Settings | Confirm | Clears session and ledger keys; fresh squad id | session, ledger, head | Irreversible; confirm text says export first. **Copies kept aside remain (#207)** |

## Views

| Feature | Trigger | Pre-conditions | Business invariant / rule | Persistence key | Error / edge state |
|---|---|---|---|---|---|
| Match summary / analysis | End of match, or from the clock | Match held | Folded from the record each render; nothing stored | none | — |
| Season and child views | Squad tab / child page | — | Fairness = total pitch time, never per position (invariant 3) | none (read ledger) | Ledger blocked → shown, not written |
| Played: matches from the record | Home | A completed match in the record with no fixture here (e.g. imported) | Listed by date with "◐ reconstructed"; opens read-only. No events → "Score not recorded" (#195 AC1) | none (read ledger) | — |
| Test kit | Settings, beta/demo/dev only | `showTestKit` | Clock speed ×1/×5/×10; test squad and season; time signing on this phone (#193) | `TEST_CLOCK_KEY` | Never in Heart FC Coach |
