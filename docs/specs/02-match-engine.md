# Spec 02 — Match Engine & Clock

Status: Draft for Product Owner review — **revised 2026-09-17 following PO rulings on issue #18 (quarter end), PR #20 (open questions 2–9) and issue #21 (open questions 10–12)**
Owner: Rob (Product Owner)
Last updated: 2026-09-17

## Purpose

Defines how time is kept, how it survives real-world conditions (backgrounded
app, locked phone, killed process), and how minutes are attributed.

## The clock model

### Product Owner decision

> *"Continuously, because chances are until a hard stop (e.g. quarter end) it
> will be difficult to reliably stop the clock, too much other stuff going on.
> Alarms for subs should take into account any stoppage that happens but the
> risk is the ref and the coach may not reliably stop the clock."*

This is the correct call for touchline reality, and it drives the design below.

> **Superseded in part (issue #18, PO ruling 2026-09-17):** the quarter end is
> no longer an automatic hard stop. *"The coach always ends the quarter. The
> clock never stops on its own. When players walk off, the coach stops it.
> Small differences from the ref's watch don't matter."* The continuous-running
> rule above is unchanged. See [Ending a quarter](#ending-a-quarter).

### Rules

- The clock **runs continuously within a quarter**. There is no routine pause.
- The clock **never stops on its own**. The **coach always ends the quarter**,
  when the players walk off. Reaching the planned quarter length does not stop,
  pause or end anything; it only triggers the safety net described in
  [Ending a quarter](#ending-a-quarter).
- A manual pause exists but is an **exception control**, not part of the normal
  flow: it is deliberately not a primary button, to avoid the failure mode where
  a coach pauses for a throw-in and forgets to resume.
- Elapsed time is therefore the honest measure: it is what the players actually
  experienced, including stoppages.

### Why wall-clock deltas, not tick counting

The clock must **never** be implemented as a counter incremented by a timer
callback. Backgrounded JS timers on Android are throttled or suspended, so a
tick counter silently loses time — which would corrupt the fairness ledger.

**Implementation:** each quarter stores `startedAtWallClock`. Elapsed time is
always computed as `now - startedAtWallClock + previouslyAccumulatedMs`. The
display timer is purely cosmetic; the authoritative value is derived on every
read. This makes the engine correct across app backgrounding, screen lock, and
process death.

```
elapsedMs(quarter) =
  quarter.accumulatedMs
  + (quarter.status === 'running' ? now() - quarter.runningSinceWallClock : 0)

matchElapsedMs = sum(elapsedMs(q) for q in quarters where q.index <= current)
```

### Persistence and crash recovery

State is written to durable storage on every state transition (quarter start/end,
substitution, position change) — not on every tick. Because elapsed time is
derived from wall-clock anchors, a crash mid-quarter loses **zero** time: on
relaunch the engine reads `runningSinceWallClock` and recomputes.

#### The "Match in progress" prompt

This is the **single** prompt shown when the app opens into an `in_progress`
match. This section is the one place it is described; other sections link here.
Per the PO ruling on open question 4 (PR #20 comment, 2026-09-17), the
forgotten-quarter question is **merged into it** — there is no separate
forgotten-quarter prompt:

> *"**Merged with the existing "Match in progress — resume?" prompt** into one
> prompt. It appears when the app opens on a running quarter past planned +
> margin. Choices: planned length / time of last recorded event / now."*

Refined by the PO rulings on issue #21 (2026-09-17, open question 11):

> *"**On a fresh launch and when the app comes back from the background.**"*
> (11a)
>
> *"**Add "Still playing (resume)"** to the Match in progress prompt when past
> planned + margin."* (11b)
>
> *"**Hide that choice.**"* — "last recorded event" when nothing has happened
> since kickoff (11c)
>
> *"**Hide the duplicate.**"* — "last event" gives the same time as planned
> length (11d)

**When it shows** (issue #21, ruling 11a): both when the app is **freshly
launched** (including relaunch after the process was killed) **and** when the
app **returns from the background** into an `in_progress` match. (See open
question 13.)

- It always shows the computed elapsed time, so the coach can sanity-check it.
- **No quarter running, or the running quarter's elapsed is below
  `plannedQuarterMs + marginMs`:** the prompt asks "Match in progress — resume?"
  (behaviour unchanged).
- **The running quarter's elapsed is at or beyond `plannedQuarterMs + marginMs`:**
  the same prompt asks when the quarter ended. The choices are:
  1. **Planned length** (the default, per the issue #18 ruling)
  2. **Time of last recorded event** — shown only when not hidden by the rules
     below
  3. **Now**
  4. **Still playing (resume)** (issue #21, ruling 11b) — the quarter stays
     `running`, the clock is untouched, nothing is recorded as an end, and the
     overrun prompt continues on its schedule (see
     [Overrun prompt](#overrun-prompt)).

  **Hiding "Time of last recorded event"** (issue #21, rulings 11c and 11d):
  - **Hidden when there is no last recorded event** in the running quarter, i.e.
    no substitution or position change since the quarter started. Quarter start
    itself is not a recorded event for this purpose.
  - **Hidden when its effective end is identical to the Planned length
    choice's effective end.** After the last-event floor is applied, this is the
    case whenever the last recorded event is at or after `plannedQuarterMs`
    (when it is after, the Planned length choice already reads "Ended at <last
    event time> (last sub)").
  - Otherwise it is shown.

  Each ending choice is subject to the last-event floor
  ([Earliest allowed end](#earliest-allowed-end-last-event-floor)). The
  quarter is **never** ended silently: nothing changes until the coach answers,
  and an ending answer is recorded with both its effective end and
  `recordedAt`.

**Worked example** — `plannedQuarterMs` = 600 000, `marginMs` = 60 000. The app
comes back from the background (or is freshly launched — the behaviour is the
same) with the running quarter at the elapsed shown:

| Quarter elapsed on open | Recorded events this quarter | Prompt | Choices shown (effective end) |
|---|---|---|---|
| 08:00 (480 000) | any | "Match in progress — resume?" | Resume only; no end-time choices |
| 11:00 (660 000) | none | Asks when it ended | Planned length (600 000) / Now (660 000) / Still playing (resume) |
| 13:30 (810 000) | none | Asks when it ended | Planned length (600 000) / Now (810 000) / Still playing (resume) |
| 13:30 (810 000) | sub at 07:00 | Asks when it ended | Planned length (600 000) / Time of last recorded event (420 000) / Now (810 000) / Still playing (resume) |
| 13:30 (810 000) | sub at 10:00 | Asks when it ended | Planned length (600 000) / Now (810 000) / Still playing (resume) — last event hidden as identical |
| 13:30 (810 000) | sub at 10:30 | Asks when it ended | "Ended at 10:30 (last sub)" (630 000) / Now (810 000) / Still playing (resume) — last event hidden as identical |

In the 13:30 rows, choosing **Still playing (resume)** leaves the quarter
running; the next overrun prompt is due at 14:00 (840 000), the next point on
the `plannedQuarterMs + k × marginMs` schedule.

## Quarter lifecycle

```
pending → running → ended
```

**Starting a quarter** requires a complete team sheet: exactly `onFieldCount`
players assigned to distinct positions. The engine refuses to start otherwise,
with a clear message naming the unfilled positions.

**On quarter start:**
1. Set `startedAt`, `runningSinceWallClock`, status → `running`.
2. Open an Appearance for each on-field player at `startElapsedMs = matchElapsedMs`.
3. Open a BenchStint for each available, unselected player.

**On quarter end (always a coach action):**
1. Set the quarter's elapsed to the **effective end** the coach chose (see
   [Ending a quarter](#ending-a-quarter)); status → `ended`. The clock is not
   frozen by any timer or threshold — only by this action.
2. Close every open Appearance at the effective end, with `endReason: quarter_end`.
3. Close every open vacancy at the effective end (once vacancy records exist —
   see [Invariants](#invariants-asserted-in-tests)).
4. Close every open BenchStint at the effective end.
5. Cancel any pending quarter-end notification for this quarter.
6. Recompute totals and present the **next quarter's planned team sheet**
   (Spec 04), which is editable before the coach confirms.

Closing every interval at the quarter boundary means quarter totals are exact
and independently checkable against the **actual** length of the quarter, not
its planned length:

`sum(Appearance durations) + sum(vacancy durations) === actualQuarterElapsedMs × onFieldCount`

where `actualQuarterElapsedMs` is the quarter's elapsed time at its effective
end. The check is strict and always enforced; the test suite asserts it. Until
Spec 01 defines vacancy records, the vacancy term is zero. See
[Invariants](#invariants-asserted-in-tests) for the full statement.

## Ending a quarter

### Product Owner ruling (issue #18, 2026-09-17)

> *"**Check:** for a closed quarter, `sum(Appearance durations) + sum(vacancy
> durations) === actualQuarterElapsedMs × onFieldCount`. It is strict and always
> enforced."*
>
> *"**Warning:** a separate, non-blocking warning when the actual length differs
> from the planned length by more than the margin, in either direction."*
>
> *"**The coach always ends the quarter.** The clock never stops on its own.
> When players walk off, the coach stops it. Small differences from the ref's
> watch don't matter."*
>
> *"**Overrun prompt:** at planned length + margin, the app prompts. **The clock
> keeps running and is not paused.** Pausing would lose real time if play is
> still going. The choices are **Ended at planned time / Ended just now / Still
> playing**. The chosen end time and the time the coach tapped are both
> recorded."*
>
> *"**Margin:** default **1 minute**, **customisable** by the coach. The same
> margin sets off the overrun prompt and the early-end confirmation."*
>
> *"**Early end:** ending more than the margin before planned length asks for a
> one-tap confirmation."*
>
> *"**Locked phone:** the prompt is delivered as a **local notification with
> vibration**, scheduled when the quarter starts and cancelled if the quarter
> ends first. An in-app timer won't fire in the background (ADR-002)."*
>
> *"**Bench/team-sheet review opened after planned length:** the app **offers**
> to end the quarter, with the same end-time choices. It never ends the quarter
> automatically. Before planned length, no offer is made."*
>
> *"**Forgotten quarter:** when the app is next opened, it asks "still running,
> when did it end?", defaulting to planned length. It never ends a quarter
> silently."*

The forgotten-quarter part of this ruling was refined by the PR #20 ruling on
open question 4: it is now part of the single
[Match in progress prompt](#the-match-in-progress-prompt).

### Why

- **Actual, not planned, time is checked.** Early whistles and abandoned
  matches are normal, and Spec 03's fairness maths uses actual minutes. A check
  against planned length would push the record toward crediting minutes nobody
  played, which breaks invariant 1 (minutes derived from intervals). The
  actual-time check still catches interval double-counting (DEF-001, issue #13).
- **Its blind spot is a clock that ran too long** — a coach who forgot to end
  the quarter produces a record that is internally consistent but wrong. The
  deviation warning and the overrun prompt cover that.
- **The clock is never paused by the app.** If play is still going, a pause
  would silently lose real played time.
- **Time past planned length counts.** Per the PO ruling on open question 2
  (PR #20 comment): *"**Yes.** Minutes count up to the end time the coach
  chooses."* A quarter ended "now" at 12:00 credits 12 minutes of intervals;
  one ended at planned length credits 10.

### Terms

| Term | Meaning |
|---|---|
| `plannedQuarterMs` | The quarter's planned length (`quarterMinutes`, Spec 01, in ms) |
| `marginMs` | The quarter-end margin applying to this match — see [Margin](#margin) |
| Effective end | The quarter-elapsed time at which the quarter is recorded as having ended |
| `recordedAt` | The wall-clock time at which the coach made the end-of-quarter choice |
| Last recorded event | The latest event recorded in the quarter that opened or closed a player's time on the pitch or bench — a substitution or position change. Quarter start is not a recorded event for this purpose. **Confirmed by the PO on issue #21** (2026-09-17): *"the latest event that opened or closed a player's time on the pitch or bench (sub, position change)."* |
| `actualQuarterElapsedMs` | The quarter's elapsed time at its effective end |

### Margin

Per the PO ruling on open question 5 (PR #20 comment):

> *"**A squad setting, copied onto each match at start** so the record shows
> which margin applied. It cannot change mid-quarter. Range 30 s to 5 min."*

Refined by the PO rulings on issue #21 (2026-09-17, open question 12):

> *"**No.** It is fixed for the whole match once it starts."* — can the margin
> be edited between quarters (12a)
>
> *"**Yes.**"* — is the 30 s–5 min range inclusive (12b)

- The margin is a **squad setting**. Default 60 000 ms (1 minute, issue #18).
- Allowed range: **30 000 ms to 300 000 ms, inclusive of both ends** (issue #21,
  ruling 12b). 30 000 and 300 000 are accepted; 29 999 and 300 001 are rejected
  with a clear message and the setting is not saved.
- When a match starts, the squad's margin is **copied onto the match**. That copy
  is the `marginMs` used for the match and is retained in the match record.
  Changing the squad setting later does not alter an already-started match.
- The match's margin is **fixed for the whole match once it starts** (issue #21,
  ruling 12a). It cannot be changed while a quarter is running **nor between
  quarters** of the same match; an attempt is rejected and the match keeps its
  copied value.
- The field that holds the copied margin on the match record belongs to
  **Spec 01**, and is added in the Spec 01 amendment that goes with the ADR
  review (tracked with #19), as confirmed by the PO on issue #21. Spec 01 is not
  edited in this change.
- One margin value drives the overrun prompt (and its repeats), the early-end
  confirmation and the deviation warning. There are not separate margins for
  each.

### The three end-time choices

Wherever the app asks when a quarter ended during play (overrun prompt,
bench/team-sheet review offer), the choices are:

| Choice | Effective end | Quarter status |
|---|---|---|
| **Ended at planned time** | `plannedQuarterMs`, floored at the last recorded event | `ended` |
| **Ended just now** | Quarter elapsed at the moment of the tap | `ended` |
| **Still playing** | — | Stays `running`; clock untouched |

(When the app opens past planned + margin, the choices are those of the
[Match in progress prompt](#the-match-in-progress-prompt) instead.)

For every ending choice, the engine retains **both** the effective end and
`recordedAt`. Neither overwrites the other, so the gap between when the quarter
ended and when the coach said so is always visible in the record.

**An effective end earlier than `recordedAt` is not a correction.** Per the PO
ruling on open question 6 (PR #20 comment): *"**No.** It is the coach's
statement at the time, with both times kept. Corrections are later edits."* It
does not set `corrected`, does not require a note, and does not create a
correction log entry. Invariant 5 applies to later edits of a closed quarter.

### Earliest allowed end (last-event floor)

Per the PO ruling on open question 7 (PR #20 comment):

> *"**Not allowed.** The earliest allowed end is the last recorded event, and
> "Ended at planned time" shows as "Ended at <last event time> (last sub)" when
> an event came after planned length."*

- A quarter's effective end can **never** be earlier than its last recorded
  event. This keeps every interval inside its quarter: an end before the last
  event would leave an interval opening after the quarter had ended.
- If the last recorded event is **after** `plannedQuarterMs`, the "Ended at
  planned time" choice becomes **"Ended at <last event time> (last sub)"**, with
  the event type in the label (e.g. "(last sub)" for a substitution), and its
  effective end is the last event's time.
- If the last recorded event is at or before `plannedQuarterMs`, the choice is
  shown and behaves as "Ended at planned time".
- The same floor applies to the choices in the
  [Match in progress prompt](#the-match-in-progress-prompt).
- "Ended just now" / "Now" is always at or after the last event, so it is never
  adjusted.

### Overrun prompt

- Due when quarter elapsed reaches `plannedQuarterMs + marginMs`.
- The clock **keeps running and is not paused** while the prompt is showing or
  after it is dismissed.
- Offers the three choices above.
- **Repeats once per margin.** Per the PO ruling on open question 3
  (PR #20 comment): *"**Yes, once per margin** (every 1 min by default),
  vibrating each time."* Per the PO rulings on issue #21 (2026-09-17, open
  question 10): *"**From the previous due time.** "Still playing" tapped at
  11:40 brings the prompt back at 12:00."* (10a) and *"**Yes.** It keeps
  repeating once per margin."* (10b)
  - The prompt is due at `plannedQuarterMs + k × marginMs` for k = 1, 2, 3, …
    (quarter elapsed). Each repeat is timed from the **previous due time**, not
    from when the coach tapped (issue #21, ruling 10a). With 10 min planned and
    a 1 min margin: due 11:00, 12:00, 13:00, …; "Still playing" tapped at 11:40
    brings the prompt back at **12:00**, not 12:40.
  - It **repeats whether or not the coach answers** (issue #21, ruling 10b):
    an unanswered prompt (e.g. phone stays locked) is followed by the next one
    at the next due time, with vibration.
  - Repeats stop only when the quarter ends. "Still playing" never stops them.
- Because elapsed time excludes manually paused time, the due point is defined
  in quarter-elapsed terms, not as a fixed wall-clock instant. The engine
  computes when the prompt is due (as quarter elapsed, and — while the clock is
  running — the corresponding wall-clock instant derived from
  `runningSinceWallClock`). It does not deliver anything itself.

### Early-end confirmation

- When the coach ends a quarter with quarter elapsed **less than**
  `plannedQuarterMs − marginMs`, a **one-tap confirmation** is required before
  the quarter ends. Declining leaves the quarter `running`, clock untouched.
- Ending at or after `plannedQuarterMs − marginMs` needs no confirmation.
- A confirmed early end records actual elapsed, not the planned figure.

### Deviation warning

- Raised for a closed quarter when
  `|actualQuarterElapsedMs − plannedQuarterMs| > marginMs`, in either direction.
- **Non-blocking:** it never prevents the quarter from ending, never alters any
  interval, and never changes the strict invariant check.
- It is a flag for the coach and for dispute review, not a correction.

### Locked phone: local notification

- When a quarter starts, a **local notification with vibration** is scheduled
  for the overrun prompt's due point.
- Repeat prompts (at each `plannedQuarterMs + k × marginMs`, answered or not,
  see [Overrun prompt](#overrun-prompt)) are also delivered with vibration.
- When the quarter ends, every pending quarter-end notification for it is
  cancelled.
- Delivery is an **app-layer** concern. The engine stays pure TypeScript (no
  platform imports) and only computes when the prompt is due; scheduling,
  cancelling and delivering the notification sit outside the engine.
- This is a deliberate exception to "background notifications are out of MVP
  scope" (see [Substitution alarms](#substitution-alarms-under-a-free-running-clock)),
  limited to the quarter-end prompt.

### Bench / team-sheet review offer

- If the coach opens the bench or team-sheet review while the quarter is
  running and quarter elapsed is **at or beyond** `plannedQuarterMs`, the app
  **offers** to end the quarter with the three choices above (including the
  last-event floor).
- The offer can always be declined ("Still playing"). The quarter is **never**
  ended automatically.
- Before `plannedQuarterMs`, **no offer is made**.

### Forgotten quarter

Handled by the single [Match in progress prompt](#the-match-in-progress-prompt)
(PR #20 ruling, open question 4). There is no separate prompt.

### Technical constraint — for the Architect

Delivering the overrun prompt while the phone is locked or the app is
backgrounded **depends on a scheduled local notification** (a platform
capability). An in-app JS timer cannot be relied on, because Android suspends
or throttles background timers ([ADR-002](../decisions/002-wall-clock-time-derivation.md)).
This introduces a platform dependency (notification scheduling, vibration, and
the permission to post notifications) that the Architect needs to assess,
including rescheduling when a manual pause/resume moves the due point, and
repeating notifications once per margin. No ADR is written in this change.

### Worked example

7-a-side (`onFieldCount = 7`), squad of 10 available, `plannedQuarterMs` =
600 000 (10 min), `marginMs` = 60 000 (1 min).

| Scenario | Effective end | Confirmation? | Prompt? | Warning? | `actualQuarterElapsedMs × 7` |
|---|---|---|---|---|---|
| Coach ends at 09:20 | 560 000 | No (40 s early ≤ margin) | No | No | 3 920 000 |
| Coach ends at 08:30 | 510 000 | Yes (90 s early > margin) | No | Yes (90 s) | 3 570 000 |
| Coach ends at 10:45 | 645 000 | No | No (before 11:00) | No (45 s) | 4 515 000 |
| Prompt at 11:00; at 11:40 coach taps **Ended at planned time** | 600 000, `recordedAt` = wall-clock of the 11:40 tap | No | Yes | No | 4 200 000 |
| Prompt at 11:00; at 11:40 coach taps **Ended just now** | 700 000 | No | Yes | Yes (100 s) | 4 900 000 |
| Prompt at 11:00; coach taps **Still playing** at 11:00; prompt repeats at 12:00; coach taps **Ended just now** at 12:10 | 730 000 | No | Yes (11:00, 12:00) | Yes (130 s) | 5 110 000 |
| Prompt at 11:00; coach taps **Still playing** at 11:40; prompt repeats at 12:00 (not 12:40); coach taps **Ended just now** at 12:05 | 725 000 | No | Yes (11:00, 12:00) | Yes (125 s) | 5 075 000 |
| Prompt at 11:00, 12:00 and 13:00 all unanswered (phone locked); coach taps **Ended just now** at 13:10 | 790 000 | No | Yes (11:00, 12:00, 13:00) | Yes (190 s) | 5 530 000 |
| Sub recorded at 10:30; prompt at 11:00 shows **"Ended at 10:30 (last sub)"**; coach taps it at 11:20 | 630 000 | No | Yes | No (30 s) | 4 410 000 |

**With a vacancy** (applies once Spec 01 defines vacancy records; until then the
vacancy term is zero): a player is injured at 06:00 with no replacement, and the
coach ends the quarter at 10:00 (600 000).

- Appearances: 6 × 600 000 + 360 000 = 3 960 000.
- Vacancy: 600 000 − 360 000 = 240 000.
- `3 960 000 + 240 000 = 4 200 000 = 600 000 × 7`. ✓



## Substitution alarms under a free-running clock

The Product Owner correctly identified the risk: if the clock never stops but
the game does, an alarm fired on raw elapsed time may arrive while the ball is
out of play, or while a stoppage has eaten the window.

**Design response — alarms are advisory, with a window and a deferral:**

1. **Alarm window, not an instant.** A sub due at 10:00 raises at 10:00 and
   stays active until actioned or the quarter ends. It is a standing flag, not a
   notification that can be missed while the coach is watching the game.
2. **Next-stoppage framing.** The alarm's wording is "Sub due — Ellie for Sam at
   next break in play", acknowledging that the coach acts at a natural stoppage,
   not on the exact second.
3. **Deferral is recorded, not hidden.** If a sub is actioned late, the
   Appearance records the true time. The variance between planned and actual is
   retained and surfaced in the fairness ledger, so a systematic drift becomes
   visible rather than silently accumulating.
4. **Quarter-end backstop.** Any sub not actioned by quarter end is carried into
   the next quarter's planned team sheet automatically, so a missed alarm
   self-corrects at the next quarter end.
5. **Escalation.** An alarm unactioned for more than a configurable threshold
   (default 3 minutes) escalates its visual prominence, since the free-running
   clock means a missed sub costs real fairness minutes.

**Alert delivery:** in-app visual (persistent banner, colour-coded) plus optional
haptic and sound. Must work with the screen on and the app foregrounded — the
expected touchline usage. Background notifications for substitution alarms are
explicitly out of MVP scope; the app is expected to be open during a match. The
**one exception** is the quarter-end overrun prompt, which the PO ruled
(issue #18) is delivered as a local notification with vibration — see
[Ending a quarter](#ending-a-quarter).

## Attribution of minutes

- A player accrues time only while holding an open Appearance.
- Each interval records the exact position held, so time-per-position is always
  derivable for reporting.
- For **fairness**, only the `outfield` / `goalkeeper` distinction matters: all
  outfield minutes sum into one figure regardless of position, and goalkeeper
  minutes are excluded from the fairness measure entirely. A player who keeps for
  one quarter and plays outfield for three has 3 quarters of fairness-counting
  time and 1 quarter of GK time.
- Position is never a fairness dimension — see Spec 03 for why (deliberate
  position affinities would otherwise be flagged as anomalies).
- Substitutions are instantaneous at the recorded `elapsedMs`. The outgoing
  player's interval closes and the incoming player's opens at the same instant,
  so no time is double-counted or lost.

### Invariants (asserted in tests)

For any closed quarter, with `actualQuarterElapsedMs` the quarter's elapsed
time at its effective end (never the planned length):

1. **Positions:**
   `sum(Appearance durations) + sum(vacancy durations) === actualQuarterElapsedMs × onFieldCount`
2. **Players:**
   `sum(Appearance durations) + sum(BenchStint durations) === actualQuarterElapsedMs × availablePlayerCount`

**How vacancies apply.** Identity 1 counts *positions*: every position is, at
every instant, either held (an Appearance) or vacant. Identity 2 counts
*players*: every available player is, at every instant, either on the field (an
Appearance) or on the bench (a BenchStint) — the Spec 01 invariant. A vacancy is
a position with no player, so it has **no term in identity 2**. A player who
leaves the field without replacement (e.g. injured) moves from an Appearance to
a BenchStint if they remain available, never into the vacancy.

Identity 2 holds as stated only while `availablePlayerCount` is constant for
the whole quarter. A player stopping being available mid-quarter is **deferred
to REQ-04** (substitutions and injuries) per the PO ruling on open question 8
(PR #20 comment); it is not specified here.

**Vacancy term until Spec 01 is amended.** Per the PO ruling on open question 9
(PR #20 comment): *"**#13 proceeds now** with the actual-time check and no
vacancy term (zero until vacancies exist). **Spec 01 is amended as part of the
ADR review (#19)**, because ADR-007 would reshape those records anyway."* Until
Spec 01 defines vacancy records (tracked with #19), `sum(vacancy durations)` is
**zero** and identity 1 is asserted as
`sum(Appearance durations) === actualQuarterElapsedMs × onFieldCount`. Spec 01
is not edited in this change.

Subtracting 1 from 2 gives a consistency cross-check:
`sum(BenchStint durations) === actualQuarterElapsedMs × (availablePlayerCount − onFieldCount) + sum(vacancy durations)`.

**Worked example** (once vacancy records exist; same injury case as above: 7-a-side, 10 available, quarter
ended at 600 000, one player injured at 360 000 and not replaced, and assuming
the injured player remains available on the bench):

- Identity 1: `3 960 000 + 240 000 = 4 200 000 = 600 000 × 7`. ✓
- BenchStints: 3 × 600 000 (unselected) + 240 000 (injured player) = 2 040 000.
- Identity 2: `3 960 000 + 2 040 000 = 6 000 000 = 600 000 × 10`. ✓
- Cross-check: `2 040 000 = 600 000 × 3 + 240 000`. ✓

A short-handed quarter (fewer available than `onFieldCount`) is covered by the
same identities, with the unfilled positions vacant from quarter start.

Separately, a **non-blocking deviation warning** is raised when
`|actualQuarterElapsedMs − plannedQuarterMs| > marginMs` (see
[Deviation warning](#deviation-warning)). The warning never relaxes either
identity.

## Corrections

Because the clock runs continuously and coaches are busy, mistakes will happen:
a sub tapped 90 seconds after it occurred, or the wrong player tapped.

- Any Appearance may be corrected after the fact by editing its start/end.
- A correction sets `corrected: true` and **requires** a note.
- Corrections never delete the original values; the prior state is retained in a
  correction log entry.
- The fairness ledger displays corrected figures but flags that corrections
  exist, so an arbitration conversation starts from full information.

This is the mechanism that makes the Product Owner's stated goal — *"fix
anomalies, data recorded and observed for fairness and dispute arbitration"* —
actually defensible.

## Edge cases the engine must handle

| Case | Behaviour |
|---|---|
| Player injured mid-quarter, no replacement | Position becomes vacant; team plays short. Vacancy is recorded, not backfilled silently. |
| Fewer available players than `onFieldCount` | Match can still start with a recorded short-handed flag. |
| Match abandoned mid-quarter | Close all intervals at current elapsed; status → `abandoned`. Minutes still count toward the season ledger. |
| Quarter ended early (ref's whistle) | Coach ends the quarter (as always). Ending with quarter elapsed below `plannedQuarterMs − marginMs` requires a one-tap confirmation; declining leaves the quarter running. Actual elapsed is recorded, not the planned figure. A deviation beyond the margin raises the non-blocking warning. |
| Quarter overruns (coach has not ended it by planned length + margin) | Overrun prompt fires at `plannedQuarterMs + marginMs` (local notification with vibration if the phone is locked or the app backgrounded). The clock keeps running and is **not** paused. Choices: Ended at planned time / Ended just now / Still playing. It repeats at each further margin (`plannedQuarterMs + k × marginMs`), timed from the previous due time not from the tap (a "Still playing" tap at 11:40 → next prompt 12:00), and repeats whether or not the coach answers, vibrating each time (issue #21). Effective end and `recordedAt` are both retained. Never ended automatically. |
| Quarter forgotten (app freshly launched or returning from background on a running quarter at or beyond planned + margin) | The single [Match in progress prompt](#the-match-in-progress-prompt) asks when it ended: planned length (default) / time of last recorded event / now / still playing (resume), ending choices floored at the last recorded event. "Time of last recorded event" is hidden when no sub or position change has been recorded since quarter start, or when it gives the same end as planned length (issue #21). Nothing is ended until the coach answers; an ending answer and its `recordedAt` are retained. Never ended silently. |
| Chosen end would be before the last recorded event | Not allowed. The earliest end offered is the last recorded event; "Ended at planned time" is relabelled "Ended at <last event time> (last sub)" when an event came after planned length. |
| Margin set outside 30 s – 5 min (inclusive), or the match's margin changed once the match has started (mid-quarter or between quarters) | Rejected. 30 000 and 300 000 ms are accepted. The match uses the squad margin copied at match start for the whole match (issue #21). |
| Bench / team-sheet review opened during a running quarter | At or beyond planned length: app **offers** to end the quarter with the three end-time choices; declining keeps it running. Before planned length: no offer. |
| Same player assigned to two positions | Rejected by the engine with a validation error. |
| Clock adjusted after the fact | Treated as a correction: requires a note, flagged in the ledger. |

## Revision history

| Date | Change | Authority |
|---|---|---|
| 2026-09-17 | Quarter end is always a coach action (no automatic hard stop). Quarter check uses actual elapsed time including vacancies. Added quarter-end safety net: overrun prompt, early-end confirmation, deviation warning, local notification, bench/team-sheet review offer, forgotten-quarter question. Invariants, edge cases and open questions updated. | PO ruling on GitHub issue #18 |
| 2026-09-17 | Open questions 2–9 moved into the body as rules: overrun time counts (Q2); prompt repeats once per margin with vibration (Q3); forgotten-quarter question merged into the single "Match in progress" prompt with three choices (Q4); margin is a squad setting copied onto the match at start, fixed mid-quarter, 30 s–5 min (Q5); backdated end is not a correction (Q6); end floored at last recorded event with adjusted label (Q7); mid-quarter availability deferred to REQ-04 (Q8); vacancy term zero until Spec 01 is amended with #19 (Q9). New open questions 10–12 raised. | PO rulings comment on PR #20 |
| 2026-09-17 | Open questions 10–12 moved into the body as rules: overrun prompt due at planned + k × margin, repeats timed from the previous due time and repeat when unanswered (Q10); Match in progress prompt shows on fresh launch and return from background, gains "Still playing (resume)" past planned + margin, hides "Time of last recorded event" when there is none or it duplicates planned length (Q11); match margin fixed for the whole match, range 30 000–300 000 ms inclusive (Q12). Definition of "last recorded event" confirmed; copied-margin field assigned to the Spec 01 amendment with #19. Worked examples and edge cases updated. New open question 13 raised. | PO rulings comment on issue #21 |

## Open questions for Product Owner

1. Should the app support extra time / a fifth period, or is 4 quarters fixed?

Questions 2–9 were ruled on 2026-09-17 (PO rulings comment on PR #20) and
questions 10–12 on 2026-09-17 (PO rulings comment on issue #21); all are now
rules in the body above. Raised by applying the issue #21 rulings (not decided
here):

13. **Match in progress prompt on every return from background (Q11a).** Ruling
    11a shows the prompt when the app comes back from the background. Read
    literally, that includes a running quarter **below** planned + margin, so
    the coach would be asked "Match in progress — resume?" each time they unlock
    the phone or switch back to the app mid-quarter — a routine touchline
    action. Is that intended, or should a return from background show the
    prompt only when the running quarter is at or beyond planned + margin?
    Relatedly, when the app returns from the background past planned + margin
    (e.g. the coach taps the overrun notification), this spec shows the single
    Match in progress prompt in place of the overrun prompt, not both — please
    confirm.
