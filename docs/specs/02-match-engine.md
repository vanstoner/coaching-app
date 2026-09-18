# Spec 02 — Match Engine & Clock

Status: **Approved** by the Product Owner, 2026-09-18.

> Approved 2026-09-18 — the engine is built and 66 tests pass against it. A line-by-line alignment audit of this spec is still outstanding; discrepancies will be raised as issues rather than held against approval.
Owner: Rob (Product Owner)
Last updated: 2026-09-17

## Purpose

Defines how time is kept, how it survives real-world conditions (backgrounded
app, locked phone, killed process), and how minutes are attributed.

## Match configuration

A match is configured with `totalMinutes` and `quarterCount` (Spec 01), and
every quarter has the same planned length, `plannedQuarterMs`. This section
defines which configurations are valid. It does not change which totals are
offered; that is set by Spec 01 and REQ-01 (#1).

### Fractional quarter lengths are allowed

**PO ruling, 2026-09-17 (issue #16):** fractional quarter lengths are allowed,
e.g. 50 minutes over 4 quarters gives 12.5-minute quarters (750 000 ms).
Reason recorded on issue #16: 12.5-minute quarters are real usage. This
replaces the earlier rule that `totalMinutes` must divide evenly by
`quarterCount` into whole minutes.

### Validity rule

A configuration is **valid** when all of these hold:

1. `totalMinutes` is a **whole number** of minutes;
2. `totalMinutes` is between **20 and 120** inclusive;
3. `quarterCount` is **exactly 2 (halves) or 4 (quarters)**;
4. `totalMinutes × 60 000` is divisible by `quarterCount` with no remainder.

> **Rules 1–3 tightened 2026-09-17 (#19).** They previously read only
> *"`totalMinutes` is positive"* and *"`quarterCount` is positive"*, which
> accepted nonsense: 40 minutes over 2.5 quarters built two quarters totalling
> 1 920 000 ms, and 50 over 0.5 built a match with **zero** quarters. QA raised
> this on PR #17 and it went to `main` with #15 as a known open item. The bounds
> come from [Spec 01 § Match length](./01-domain-model.md#match-length), which
> also explains why this is a sanity check rather than an FA rulebook.
>
> Rule 3 also records that matches are played in **quarters or halves** (PO,
> 2026-09-17). The field is still named `quarterCount`; a rename to
> `periodCount` is proposed with the ADR-007 reshape.

Then `plannedQuarterMs = totalMinutes × 60 000 / quarterCount`, a whole number
of milliseconds.

Any other configuration is **rejected with a clear message** that names the
values given (`totalMinutes` and `quarterCount`), and no match is created.

**Authority.** The fractional-quarter ruling is the PO's (issue #16). The
whole-millisecond validity rule above is **proposed** in the latest comment on
issue #16, as a technical consequence of every authoritative time being a whole
number of milliseconds (Spec 01 types every elapsed-time field as `int`). It is
**confirmed by the PO at the approval gate of the PR that adds this section**;
until that PR is approved it is not a ruling.

**Why not round.** Rounding a quarter length that is not a whole number of
milliseconds would make the quarters of a match add up to something other than
the match length. Minutes are derived by folding intervals (invariant 1,
[ADR-003](../decisions/003-intervals-as-source-of-truth.md)), so the planned
lengths the intervals are checked against must be exact. Rejecting the
configuration keeps them exact; rounding would hide a discrepancy in the record.

**Worked examples:**

| `totalMinutes` | `quarterCount` | `totalMinutes × 60 000` | Result | `plannedQuarterMs` |
|---|---|---|---|---|
| 40 | 4 | 2 400 000 | Valid | 600 000 (10 min) |
| 50 | 4 | 3 000 000 | Valid | 750 000 (12.5 min) |
| 60 | 4 | 3 600 000 | Valid | 900 000 (15 min) |
| 40 | 3 | 2 400 000 | Valid | 800 000 (13 min 20 s) |
| 50 | 3 | 3 000 000 | Valid | 1 000 000 (16 min 40 s) |
| 50 | 7 | 3 000 000 | **Rejected** — 3 000 000 ÷ 7 = 428 571.43 ms, not whole | — |
| 0 | 4 | 0 | **Rejected** — `totalMinutes` not positive | — |
| 40 | 0 | 2 400 000 | **Rejected** — `quarterCount` not positive | — |
| −40 | 4 | — | **Rejected** — `totalMinutes` not positive | — |
| 40 | −4 | — | **Rejected** — `quarterCount` not positive | — |

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

matchElapsedMs = sum(elapsedMs(q) for q in quarters where q.status !== 'pending')
```

`matchElapsedMs` is defined in full, with a worked example, in
[Current quarter and match elapsed](#current-quarter-and-match-elapsed).

### Persistence and crash recovery

State is written to durable storage on every state transition (quarter start/end,
substitution, position change) — not on every tick. Because elapsed time is
derived from wall-clock anchors, a crash mid-quarter loses **zero** time: on
relaunch the engine reads `runningSinceWallClock` and recomputes.

#### Opening the app into a match in progress

What the coach sees when the app is opened into an `in_progress` match depends
on **how** it was opened. Per the PO ruling on open question 13 (PR #23
comment, 2026-09-17), which refines ruling 11a on issue #21:

> *"**Fresh launch** with a match in progress (any elapsed time)"* — *"Show the
> Match in progress prompt, as for crash recovery."*
>
> *"**Return from background, before planned length + margin**"* — *"**No
> prompt.** Show the running clock only."*
>
> *"**Return from background, at or past planned length + margin**"* — *"Show
> **one** prompt, never two."*

Below, "the threshold" means quarter elapsed `plannedQuarterMs + marginMs` for
the running quarter.

- **Fresh launch** (including relaunch after the process was killed), at any
  elapsed time — a prompt is always shown, with the computed elapsed time so
  the coach can sanity-check it:
  - No quarter running, or the running quarter is **below** the threshold: the
    **"Match in progress — resume?"** prompt. It offers no end-time choices.
  - The running quarter is **at or beyond** the threshold: the
    [quarter-end prompt](#the-quarter-end-prompt).
- **Return from background** with a running quarter:
  - **Below** the threshold: **no prompt**. The running clock is shown.
  - **At or beyond** the threshold: the
    [quarter-end prompt](#the-quarter-end-prompt) — exactly **one** prompt,
    never two.
- **Return from background** when **no quarter is running** (e.g. between
  quarters): **no prompt**. The next quarter's team sheet is shown — the team
  sheet of the [current quarter](#current-quarter-and-match-elapsed), which
  with no quarter running is the lowest-index `pending` quarter. Per the PO
  ruling on open question 14, item 1 (issue #26, 2026-09-17): *"**No
  prompt.** Returning from the background with no quarter running shows the
  next-quarter team sheet."* Reasoning given: *"There is no running quarter to
  end."*
- **Return from background** when **no quarter is running and no quarter can
  start next** (after the final quarter has ended, or once the match is
  [abandoned](#abandoning-a-match)): **no prompt**. The **match summary** is
  shown. Per the PO ruling on open question 16 (issue #29, 2026-09-17):
  *"**The match summary, with no prompt.**"*

**Worked example** — `plannedQuarterMs` = 600 000, `marginMs` = 60 000
(threshold 660 000):

| Running quarter elapsed when opened | Fresh launch | Return from background |
|---|---|---|
| 05:00 (300 000) | "Match in progress — resume?" | No prompt; running clock shown |
| 10:30 (630 000) | "Match in progress — resume?" | No prompt; running clock shown |
| 11:00 (660 000) | Quarter-end prompt (one) | Quarter-end prompt (one) |
| 11:40 (700 000) | Quarter-end prompt (one) | Quarter-end prompt (one) |

## Quarter lifecycle

```
pending → running → ended
```

### Quarters are strictly sequential

Per the acceptance criteria of **issue #24 (DEF-002)**, agreed by the PO when
confirming the defect on 2026-09-17: *"quarters run strictly in order: quarter
N can start only when quarter N−1 has ended (Q1 has no predecessor), and at
most one quarter runs at a time."*

- Only a `pending` quarter can start (the lifecycle above only runs forward).
- **Quarter N can start only when quarter N−1 is `ended`.** Q1 has no
  predecessor, so this condition does not restrict it.
- **At most one quarter is running at a time.** This follows from the rule
  above: N−1 must have ended before N starts. A manually paused quarter has not
  ended, so it still blocks the next quarter.
- A start that breaks either rule is **rejected with a clear message**, and the
  match state is **unchanged**: no quarter changes status, no anchor is set, and
  no Appearance or BenchStint is opened or closed.
- Consequence: at any moment the started quarters (status `running` or
  `ended`) are exactly Q1…Qk for some k, and at most the last of them, Qk, is
  `running`.

**Why** (issue #24): the engine derived match elapsed from an undefined
"current quarter". Starting Q3 while Q2 was still `pending` recorded ten played
minutes as zero (F1), and nothing stopped Q2 starting while Q1 was still
running (F2). Both break invariant 1, because intervals are opened and closed
at the wrong match-elapsed times.

### Current quarter and match elapsed

**Current quarter:**

1. The `running` quarter, if there is one (by the rule above, at most one);
2. otherwise the lowest-index `pending` quarter, which is the only quarter that
   may start next;
3. otherwise (every quarter `ended`) there is **no** current quarter.

**Exception — abandoned match:** once the match is `abandoned`, there is **no**
current quarter, whatever the quarters' statuses, because no further quarters
can start (issue #29; see [Abandoning a match](#abandoning-a-match)). Any
quarter still `pending` stays `pending` and never starts.

This is the engine's definition, derived from the sequencing rule. It does not
decide how the UI labels the gap between quarters, and match elapsed does not
depend on it.

**Match elapsed** is the sum of the elapsed time of every quarter that has
started:

```
matchElapsedMs = sum(elapsedMs(q) for q in quarters where q.status !== 'pending')
```

- An `ended` quarter contributes its elapsed at its **effective end** (see
  [Ending a quarter](#ending-a-quarter)), not the wall-clock time the coach
  tapped.
- A `running` quarter contributes its live elapsed (wall-clock anchor,
  [ADR-002](../decisions/002-wall-clock-time-derivation.md)).
- A `pending` quarter contributes nothing. Time between quarters is not match
  elapsed.

This one definition holds in every state:

| State | Match elapsed |
|---|---|
| A quarter is running | Sum of the ended quarters + the running quarter's live elapsed |
| Between quarters (none running, some ended, some pending) | Sum of the ended quarters; constant however long the gap lasts |
| After the final quarter (all ended) | Sum of all quarters; constant from then on |
| Match abandoned | Sum of the ended quarters (including the quarter ended through the abandonment prompt); `pending` quarters contribute nothing; constant from then on |

**Worked example** — 4 quarters, `plannedQuarterMs` = 600 000:

| Moment | Quarter statuses | Match elapsed |
|---|---|---|
| Before kickoff | Q1–Q4 pending | 0 |
| Q1 running at 04:00 | Q1 running (240 000) | 240 000 |
| Q1 ended at 10:00 | Q1 ended (600 000) | 600 000 |
| Q2 starts | Q1 ended, Q2 running (0) | 600 000 — Q2's Appearances and BenchStints open at 600 000 |
| Q2 running at 03:00 | Q1 ended (600 000), Q2 running (180 000) | 780 000 |
| Q2 ended at 13:00 ("Ended just now"); 5 min gap before Q3 | Q1 600 000, Q2 780 000 ended; Q3, Q4 pending | 1 380 000 throughout the gap |
| Q3 starts | Q3 running (0) | 1 380 000 — Q3's intervals open at 1 380 000 |
| Q3 ended at 10:00, Q4 ended at 09:20 (all ended) | 600 000, 780 000, 600 000, 560 000 | 2 540 000, unchanged on any later read |
| Attempt to start Q3 when Q1 is ended at 600 000 and Q2 is pending (F1) | Rejected; Q1 ended, Q2–Q4 pending | 600 000 (unchanged) |
| Attempt to start Q2 while Q1 is running (F2) | Rejected; Q1 running, Q2–Q4 pending | Q1's live elapsed (unchanged) |

### Abandoning a match

Per the PO ruling on open question 15 (issue #29, 2026-09-17, Rob: *"agree 15
and 16"*):

> *"**The running quarter ends through the normal quarter-end prompt** (same
> choices, same earliest-end rule), so its minutes count, as spec 02 already
> says. The match status becomes `abandoned`. **No further quarters can
> start.**"*

- **With a quarter running**, abandoning the match shows the single
  [quarter-end prompt](#the-quarter-end-prompt) (trigger 5), with the same
  [end-time choices](#end-time-choices), hiding rules and
  [last-event floor](#earliest-allowed-end-last-event-floor) as every other
  trigger.
- When the coach picks an ending choice, the quarter ends exactly as any
  quarter ends ([On quarter end](#starting-a-quarter), steps 1–5): status →
  `ended`, every open Appearance, vacancy and BenchStint closed at the
  **effective end** chosen, both the effective end and `recordedAt` retained,
  pending quarter-end notifications cancelled. The quarter's minutes count
  toward the season ledger. The match status becomes **`abandoned`**.
- The intervals close at the chosen effective end, **not** at the moment the
  coach tapped "abandon" — the same rule as every other quarter end.
- **No further quarters can start** once the match is `abandoned`. An attempt
  to start any quarter is **rejected with a clear message**, and the match state
  is **unchanged** (no status, anchor or interval changes). Quarters still
  `pending` stay `pending`.
- Because no quarter can start, the "next quarter's planned team sheet"
  (On quarter end, step 6) is not presented for an abandoned match.
- Match elapsed is the sum of the ended quarters and is constant from then on
  (see [Current quarter and match elapsed](#current-quarter-and-match-elapsed)).
- **Returning from the background** to an abandoned match shows the **match
  summary with no prompt** (issue #29, open question 16; see
  [Opening the app into a match in progress](#opening-the-app-into-a-match-in-progress)).

Not decided by this ruling, and listed as open question 17: what "Ended at
planned time", "Still playing (resume)" and the early-end confirmation mean
when a match is abandoned **before** planned length, what abandoning with no
quarter running does, and what is shown immediately after abandonment.

**Worked example** — 4 quarters, `plannedQuarterMs` = 600 000, `marginMs` =
60 000; Q1 ended at 600 000, Q2 running:

| Moment | Quarter statuses | Match status | Match elapsed |
|---|---|---|---|
| Q2 at 11:20 (680 000), sub recorded at 07:00; coach abandons | Q1 ended (600 000), Q2 running | `in_progress` (prompt showing; clock keeps running) | 1 280 000 and rising |
| Coach taps **Time of last recorded event** at 11:30 | Q1 600 000, Q2 ended (420 000), Q3–Q4 pending | `abandoned` | 1 020 000; Q2's intervals close at 1 020 000 |
| Coach instead taps **Ended just now** at 11:30 (690 000) | Q1 600 000, Q2 ended (690 000), Q3–Q4 pending | `abandoned` | 1 290 000; Q2's intervals close at 1 290 000 |
| Attempt to start Q3 after either answer | Rejected; statuses unchanged | `abandoned` | unchanged |
| App returns from background later | unchanged | `abandoned` | unchanged; match summary shown, no prompt |

### Starting a quarter

**Starting a quarter** is subject to the
[sequencing rule](#quarters-are-strictly-sequential) (and cannot happen once
the match is [abandoned](#abandoning-a-match)) and requires a complete team sheet: exactly `onFieldCount`
players assigned to distinct positions. The engine refuses to start otherwise,
with a clear message naming the unfilled positions.

**On quarter start:**
1. Set `startedAt`, `runningSinceWallClock`, status → `running`.
2. Open an Appearance for each on-field player at `startElapsedMs = matchElapsedMs`
   (at this instant, the sum of the ended quarters' elapsed).
3. Open a BenchStint for each available, unselected player.

**On quarter end (always a coach action):**
1. Set the quarter's elapsed to the **effective end** the coach chose (see
   [Ending a quarter](#ending-a-quarter)); status → `ended`. The clock is not
   frozen by any timer or threshold — only by this action.
2. Close every open Appearance at the effective end, with `endReason: quarter_end`.
3. Close every open vacancy at the effective end
   ([Spec 01 § Vacancy](./01-domain-model.md#vacancy)). Nothing creates one
   before REQ-04, so today this step is a no-op.
4. Close every open BenchStint at the effective end.
5. Cancel any pending quarter-end notification for this quarter.
6. Recompute totals and present the **next quarter's planned team sheet**
   (Spec 04), which is editable before the coach confirms.

Closing every interval at the quarter boundary means quarter totals are exact
and independently checkable against the **actual** length of the quarter, not
its planned length:

`sum(Appearance durations) + sum(vacancy durations) === actualQuarterElapsedMs × onFieldCount`

where `actualQuarterElapsedMs` is the quarter's elapsed time at its effective
end. The check is strict and always enforced; the test suite asserts it.
Vacancy records are defined in
[Spec 01 § Vacancy](./01-domain-model.md#vacancy) (added with #19); the term is
zero only while a quarter has no vacancies. See
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
open question 4, and the overrun prompt and forgotten-quarter question were
made **one prompt** by the PR #23 ruling on open question 13: see
[The quarter-end prompt](#the-quarter-end-prompt). The bench / team-sheet
review offer was made that same prompt, and backdated choices exempted from the
early-end confirmation, by the issue #26 ruling on open question 14. Abandoning
a match was made a trigger of the same prompt by the issue #29 ruling on open
question 15.

### Why

- **Actual, not planned, time is checked.** Early whistles and abandoned
  matches are normal, and Spec 03's fairness maths uses actual minutes. A check
  against planned length would push the record toward crediting minutes nobody
  played, which breaks invariant 1 (minutes derived from intervals). The
  actual-time check still catches interval double-counting (DEF-001, issue #13).
- **Its blind spot is a clock that ran too long** — a coach who forgot to end
  the quarter produces a record that is internally consistent but wrong. The
  deviation warning and the quarter-end prompt cover that.
- **The clock is never paused by the app.** If play is still going, a pause
  would silently lose real played time.
- **Time past planned length counts.** Per the PO ruling on open question 2
  (PR #20 comment): *"**Yes.** Minutes count up to the end time the coach
  chooses."* A quarter ended "now" at 12:00 credits 12 minutes of intervals;
  one ended at planned length credits 10.

### Terms

| Term | Meaning |
|---|---|
| `plannedQuarterMs` | The quarter's planned length (`quarterMinutes`, Spec 01, in ms): `totalMinutes × 60 000 / quarterCount`, a whole number of ms — see [Match configuration](#match-configuration) |
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
- The field that holds the copied margin on the match record is
  **`Match.marginMs`**, defined in [Spec 01 § Match](./01-domain-model.md#match).
  The squad setting it is copied from is **`Squad.marginMs`**
  ([Spec 01 § Squad](./01-domain-model.md#squad)). Both were added by the Spec 01
  amendment that went with the ADR review (#19, 2026-09-17), resolving the note
  that previously stood here.
- One margin value drives the quarter-end prompt (and its repeats), the early-end
  confirmation and the deviation warning. There are not separate margins for
  each.

### End-time choices

**In the [quarter-end prompt](#the-quarter-end-prompt)** the choices are:

| Choice | Effective end | Quarter status | Shown |
|---|---|---|---|
| **Ended at planned time** (the default; called "planned length" in the PR #20 ruling) | `plannedQuarterMs`, floored at the last recorded event | `ended` | Always |
| **Time of last recorded event** | The last recorded event's quarter elapsed | `ended` | Unless hidden (below) |
| **Ended just now** (called "now" in the PR #20 ruling) | Quarter elapsed at the moment of the tap | `ended` | Always |
| **Still playing (resume)** | — | Stays `running`; clock untouched; no end or `recordedAt` recorded | Always |

**Hiding "Time of last recorded event".** Per the PO rulings on issue #21
(2026-09-17, open question 11): *"**Hide that choice.**"* — when nothing has
happened since kickoff (11c); *"**Hide the duplicate.**"* — when it gives the
same time as planned length (11d).

- **Hidden when there is no last recorded event** in the running quarter, i.e.
  no substitution or position change since the quarter started. Quarter start
  itself is not a recorded event for this purpose.
- **Hidden when its effective end is identical to the "Ended at planned time"
  choice's effective end.** After the last-event floor is applied, this is the
  case whenever the last recorded event is at or after `plannedQuarterMs` (when
  it is after, that choice already reads "Ended at <last event time> (last
  sub)").
- Otherwise it is shown.

**The [bench / team-sheet review offer](#bench--team-sheet-review-offer)** is
the same single quarter-end prompt, with the same choices, hiding rules and
last-event floor. Per the PO ruling on open question 14, item 2 (issue #26,
2026-09-17): *"**Use the same single quarter-end prompt** past planned length,
with the same choices, including "Time of last recorded event" and its hiding
rules and last-event floor."* Reasoning given: *"One set of choices
everywhere."* This supersedes the three-choice offer in the issue #18 ruling.

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
- The same floor applies to every ending choice in the
  [quarter-end prompt](#the-quarter-end-prompt), however it was triggered
  (including the bench / team-sheet review offer, issue #26).
- "Ended just now" / "Now" is always at or after the last event, so it is never
  adjusted.

### The quarter-end prompt

The overrun prompt and the "when did it end?" question asked on opening the app
are **one prompt**, described only here. Per the PO ruling on open question 13
(PR #23 comment, 2026-09-17):

> *"**Treat them as one prompt.** Past planned length + margin they ask the same
> question with the same choices ("Still playing (resume)", end-time choices
> with the last-event floor and hiding rules). Describe it once in the spec,
> triggered by the due time, a fresh launch, or a return from background."*

Earlier rulings it carries forward: the PR #20 ruling on open question 4
(*"**Merged with the existing "Match in progress — resume?" prompt** into one
prompt. It appears when the app opens on a running quarter past planned +
margin. Choices: planned length / time of last recorded event / now."*) and
issue #21 ruling 11b (*"**Add "Still playing (resume)"** to the Match in
progress prompt when past planned + margin."*).

**Triggers.** The prompt is shown for a running quarter when any of these
happens:

1. **Due time reached** — quarter elapsed reaches a due point (below), whether
   the app is in the foreground or not (see
   [Locked phone](#locked-phone-local-notification)).
2. **Fresh launch** with quarter elapsed at or beyond
   `plannedQuarterMs + marginMs`.
3. **Return from background** with quarter elapsed at or beyond
   `plannedQuarterMs + marginMs`.
4. **Bench or team-sheet review opened** with quarter elapsed at or beyond
   `plannedQuarterMs` (issue #26, item 2; see
   [Bench / team-sheet review offer](#bench--team-sheet-review-offer)).
5. **Match abandoned** by the coach while the quarter is running (issue #29,
   open question 15; see [Abandoning a match](#abandoning-a-match)). Its
   behaviour below planned length is open question 17.

Whichever trigger fires, it is the **same prompt with the same choices**.
**At most one is shown at a time:** a trigger that fires while the prompt is
already showing does not show a second one. Below the threshold, triggers 2
and 3 do not show this prompt, and before `plannedQuarterMs` trigger 4 does
not (see
[Opening the app into a match in progress](#opening-the-app-into-a-match-in-progress)).

**Choices:** see [End-time choices](#end-time-choices) — Ended at planned time /
Time of last recorded event (unless hidden) / Ended just now / Still playing
(resume) — with the [last-event floor](#earliest-allowed-end-last-event-floor).

**Behaviour:**

- The clock **keeps running and is not paused** while the prompt is showing or
  after it is dismissed.
- The quarter is **never** ended silently: nothing changes until the coach
  picks an ending choice, and that answer is recorded with both its effective
  end and `recordedAt`.
- **Due points and repeats.** Per the PO ruling on open question 3 (PR #20
  comment): *"**Yes, once per margin** (every 1 min by default), vibrating each
  time."* Per the PO rulings on issue #21 (2026-09-17, open question 10):
  *"**From the previous due time.** "Still playing" tapped at 11:40 brings the
  prompt back at 12:00."* (10a) and *"**Yes.** It keeps repeating once per
  margin."* (10b)
  - The prompt is due at `plannedQuarterMs + k × marginMs` for k = 1, 2, 3, …
    (quarter elapsed). Each repeat is timed from the **previous due time**, not
    from when the coach tapped (issue #21, ruling 10a). With 10 min planned and
    a 1 min margin: due 11:00, 12:00, 13:00, …; "Still playing (resume)" tapped
    at 11:40 brings the prompt back at **12:00**, not 12:40.
  - The schedule is the same whichever trigger showed the prompt: "Still
    playing (resume)" chosen at 13:30 after a fresh launch or return from
    background brings the prompt back at the next due point, 14:00.
  - It **repeats whether or not the coach answers** (issue #21, ruling 10b):
    an unanswered prompt (e.g. phone stays locked) is followed by the next one
    at the next due point, with vibration.
  - Repeats stop only when the quarter ends. "Still playing (resume)" never
    stops them.
- Because elapsed time excludes manually paused time, due points are defined
  in quarter-elapsed terms, not as fixed wall-clock instants. The engine
  computes when the prompt is due (as quarter elapsed, and — while the clock is
  running — the corresponding wall-clock instant derived from
  `runningSinceWallClock`). It does not deliver anything itself.

**Worked example — choices shown** (`plannedQuarterMs` = 600 000, `marginMs` =
60 000). The choices are identical for every trigger:

| Quarter elapsed when shown | Recorded events this quarter | Choices shown (effective end) |
|---|---|---|
| 11:00 (660 000) | none | Ended at planned time (600 000) / Ended just now (660 000) / Still playing (resume) |
| 13:30 (810 000) | none | Ended at planned time (600 000) / Ended just now (810 000) / Still playing (resume) |
| 13:30 (810 000) | sub at 07:00 | Ended at planned time (600 000) / Time of last recorded event (420 000) / Ended just now (810 000) / Still playing (resume) |
| 13:30 (810 000) | sub at 10:00 | Ended at planned time (600 000) / Ended just now (810 000) / Still playing (resume) — last event hidden as identical |
| 13:30 (810 000) | sub at 10:30 | "Ended at 10:30 (last sub)" (630 000) / Ended just now (810 000) / Still playing (resume) — last event hidden as identical |
| 10:20 (620 000), bench review opened (trigger 4) | sub at 07:00 | Ended at planned time (600 000) / Time of last recorded event (420 000) / Ended just now (620 000) / Still playing (resume) |
| 10:20 (620 000), bench review opened (trigger 4) | none | Ended at planned time (600 000) / Ended just now (620 000) / Still playing (resume) |

### Early-end confirmation

- When the coach ends a quarter **live** (at the current quarter elapsed) with
  quarter elapsed **less than** `plannedQuarterMs − marginMs`, a **one-tap
  confirmation** is required before the quarter ends. Declining leaves the
  quarter `running`, clock untouched.
- Ending at or after `plannedQuarterMs − marginMs` needs no confirmation.
- A confirmed early end records actual elapsed, not the planned figure.
- **A backdated choice never needs the confirmation**, even when its effective
  end is below `plannedQuarterMs − marginMs`. A backdated choice is one of the
  quarter-end prompt's choices whose effective end is not taken from the
  moment of the tap: "Time of last recorded event", or "Ended at planned time"
  (including its "Ended at <last event time> (last sub)" form). In practice
  only "Time of last recorded event" can fall below that point, since "Ended
  at planned time" is never earlier than `plannedQuarterMs`. The
  [deviation warning](#deviation-warning) still applies to it. Per the PO
  ruling on open question 14, item 3 (issue #26, 2026-09-17): *"**No early-end
  confirmation** for a backdated choice. The deviation warning still records
  it."* Reasoning given: *"The coach chose that time deliberately; the
  confirmation exists to catch accidental taps when ending live."*

### Deviation warning

- Raised for a closed quarter when
  `|actualQuarterElapsedMs − plannedQuarterMs| > marginMs`, in either direction.
- **Non-blocking:** it never prevents the quarter from ending, never alters any
  interval, and never changes the strict invariant check.
- It is a flag for the coach and for dispute review, not a correction.

### Locked phone: local notification

- When a quarter starts, a **local notification with vibration** is scheduled
  for the quarter-end prompt's first due point.
- Repeat prompts (at each `plannedQuarterMs + k × marginMs`, answered or not,
  see [The quarter-end prompt](#the-quarter-end-prompt)) are also delivered
  with vibration.
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
  **offers** to end the quarter by showing the single
  [quarter-end prompt](#the-quarter-end-prompt) (trigger 4), with its choices,
  hiding rules and [last-event floor](#earliest-allowed-end-last-event-floor)
  (issue #26, item 2).
- The offer can always be declined ("Still playing"). The quarter is **never**
  ended automatically.
- Before `plannedQuarterMs`, **no offer is made**.

### Forgotten quarter

Handled by the single [quarter-end prompt](#the-quarter-end-prompt), shown on
fresh launch or return from background at or beyond planned + margin (PR #20
ruling on open question 4; PR #23 ruling on open question 13). There is no
separate prompt.

### Technical constraint — for the Architect

Delivering the quarter-end prompt while the phone is locked or the app is
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
| Prompt at 11:00; coach taps **Still playing (resume)** at 11:00; prompt repeats at 12:00; coach taps **Ended just now** at 12:10 | 730 000 | No | Yes (11:00, 12:00) | Yes (130 s) | 5 110 000 |
| Prompt at 11:00; coach taps **Still playing (resume)** at 11:40; prompt repeats at 12:00 (not 12:40); coach taps **Ended just now** at 12:05 | 725 000 | No | Yes (11:00, 12:00) | Yes (125 s) | 5 075 000 |
| Prompt at 11:00, 12:00 and 13:00 all unanswered (phone locked); coach taps **Ended just now** at 13:10 | 790 000 | No | Yes (11:00, 12:00, 13:00) | Yes (190 s) | 5 530 000 |
| Sub recorded at 10:30; prompt at 11:00 shows **"Ended at 10:30 (last sub)"**; coach taps it at 11:20 | 630 000 | No | Yes | No (30 s) | 4 410 000 |
| Sub recorded at 07:00; prompt at 11:00; coach taps **Time of last recorded event** at 11:10 | 420 000 | No (backdated choice, issue #26) | Yes | Yes (180 s) | 2 940 000 |
| Sub recorded at 07:00; bench review opened at 10:20 shows the quarter-end prompt; coach taps **Time of last recorded event** | 420 000 | No (backdated choice, issue #26) | Yes (trigger 4) | Yes (180 s) | 2 940 000 |

**With a vacancy** (vacancy records are defined in
[Spec 01 § Vacancy](./01-domain-model.md#vacancy); nothing creates one until
REQ-04): a player is injured at 06:00 with no replacement, and the coach ends
the quarter at 10:00 (600 000).

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
**one exception** is the quarter-end prompt, which the PO ruled
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

**Vacancy term — now defined.** Per the PO ruling on open question 9 (PR #20
comment): *"**#13 proceeds now** with the actual-time check and no vacancy term
(zero until vacancies exist). **Spec 01 is amended as part of the ADR review
(#19)**, because ADR-007 would reshape those records anyway."*

That amendment has landed. [Spec 01 § Vacancy](./01-domain-model.md#vacancy)
defines vacancy records, so `sum(vacancy durations)` is a **real term** and
identity 1 is asserted in full:
`sum(Appearance durations) + sum(vacancy durations) === actualQuarterElapsedMs × onFieldCount`.

The engine shipped in #15 has no vacancies yet — nothing can create one until
REQ-04 (substitutions and injuries) — so the term evaluates to zero in every
current test. The difference is that it is now zero *because there are no
vacancies*, not because the concept is undefined.

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
| Match abandoned mid-quarter | The running quarter ends through the single [quarter-end prompt](#the-quarter-end-prompt) (trigger 5), with the same choices, hiding rules and last-event floor; the quarter becomes `ended` and all its intervals close at the chosen effective end, with `recordedAt` retained. Match status → `abandoned`. Minutes still count toward the season ledger. No further quarters can start (issue #29). Behaviour before planned length, and "Still playing (resume)" in this prompt, are open question 17. See [Abandoning a match](#abandoning-a-match). |
| Starting a quarter once the match is `abandoned` | Rejected with a clear message; match state unchanged. Issue #29. |
| Quarter ended early (ref's whistle) | Coach ends the quarter (as always). Ending live with quarter elapsed below `plannedQuarterMs − marginMs` requires a one-tap confirmation; declining leaves the quarter running. A backdated choice ("Time of last recorded event", "Ended at planned time") never requires it, even below that point (issue #26). Actual elapsed is recorded, not the planned figure. A deviation beyond the margin raises the non-blocking warning. |
| Quarter overruns (coach has not ended it by planned length + margin) | The single [quarter-end prompt](#the-quarter-end-prompt) is due at `plannedQuarterMs + marginMs` (local notification with vibration if the phone is locked or the app backgrounded). The clock keeps running and is **not** paused. Choices: Ended at planned time / Time of last recorded event (unless hidden) / Ended just now / Still playing (resume). It repeats at `plannedQuarterMs + k × marginMs`, timed from the previous due time not from the tap (a "Still playing (resume)" tap at 11:40 → next prompt 12:00), whether or not the coach answers, vibrating each time (issue #21). Effective end and `recordedAt` are both retained. Never ended automatically. |
| Quarter forgotten (app freshly launched, or returning from background, on a running quarter at or beyond planned + margin) | The same single [quarter-end prompt](#the-quarter-end-prompt), with the same choices, hiding rules and last-event floor as when triggered by the due time. Exactly one prompt is shown, never two (PR #23). Nothing is ended until the coach answers; an ending answer and its `recordedAt` are retained. Never ended silently. |
| App returns from background on a running quarter below planned + margin | No prompt; the running clock is shown (PR #23). |
| App returns from background with no quarter running (between quarters) | No prompt; the next quarter's team sheet is shown (issue #26). |
| App returns from background with no quarter running and no quarter able to start (final quarter ended, or match abandoned) | No prompt; the match summary is shown (issue #29). |
| App freshly launched on a match in progress below planned + margin, or with no quarter running | "Match in progress — resume?" prompt (PR #23). |
| Chosen end would be before the last recorded event | Not allowed. The earliest end offered is the last recorded event; "Ended at planned time" is relabelled "Ended at <last event time> (last sub)" when an event came after planned length. |
| Margin set outside 30 s – 5 min (inclusive), or the match's margin changed once the match has started (mid-quarter or between quarters) | Rejected. 30 000 and 300 000 ms are accepted. The match uses the squad margin copied at match start for the whole match (issue #21). |
| Bench / team-sheet review opened during a running quarter | At or beyond planned length: the single [quarter-end prompt](#the-quarter-end-prompt) is shown, with the same choices, hiding rules and last-event floor (issue #26); "Still playing (resume)" keeps it running. Before planned length: no offer. |
| Starting a quarter out of order (quarter N−1 not `ended`, e.g. Q3 while Q2 is `pending`) | Rejected with a clear message; match state unchanged (no status, anchor or interval changes). Issue #24 (F1). |
| Starting a quarter while another quarter is running (e.g. Q2 while Q1 is `running`, including manually paused) | Rejected with a clear message; match state unchanged. Issue #24 (F2). |
| Match configured with `totalMinutes × 60 000` not divisible by `quarterCount` (e.g. 50/7), or either value zero or negative | Rejected with a clear message naming the values; no match created. Fractional whole-ms quarter lengths (e.g. 50/4 → 750 000) are accepted. Issue #16. See [Match configuration](#match-configuration). |
| Match configured with a non-whole `totalMinutes` (e.g. 40.5), `totalMinutes` outside 20–120, or `quarterCount` not 2 or 4 (e.g. 2.5, 0.5, 3) | Rejected with a clear message naming the values; no match created. Closes the gap QA raised on PR #17. Issue #19. |
| Same player assigned to two positions | Rejected by the engine with a validation error. |
| Clock adjusted after the fact | Treated as a correction: requires a note, flagged in the ledger. |

## Revision history

| Date | Change | Authority |
|---|---|---|
| 2026-09-17 | Quarter end is always a coach action (no automatic hard stop). Quarter check uses actual elapsed time including vacancies. Added quarter-end safety net: overrun prompt, early-end confirmation, deviation warning, local notification, bench/team-sheet review offer, forgotten-quarter question. Invariants, edge cases and open questions updated. | PO ruling on GitHub issue #18 |
| 2026-09-17 | Open questions 2–9 moved into the body as rules: overrun time counts (Q2); prompt repeats once per margin with vibration (Q3); forgotten-quarter question merged into the single "Match in progress" prompt with three choices (Q4); margin is a squad setting copied onto the match at start, fixed mid-quarter, 30 s–5 min (Q5); backdated end is not a correction (Q6); end floored at last recorded event with adjusted label (Q7); mid-quarter availability deferred to REQ-04 (Q8); vacancy term zero until Spec 01 is amended with #19 (Q9). New open questions 10–12 raised. | PO rulings comment on PR #20 |
| 2026-09-17 | Open questions 10–12 moved into the body as rules: overrun prompt due at planned + k × margin, repeats timed from the previous due time and repeat when unanswered (Q10); Match in progress prompt shows on fresh launch and return from background, gains "Still playing (resume)" past planned + margin, hides "Time of last recorded event" when there is none or it duplicates planned length (Q11); match margin fixed for the whole match, range 30 000–300 000 ms inclusive (Q12). Definition of "last recorded event" confirmed; copied-margin field assigned to the Spec 01 amendment with #19. Worked examples and edge cases updated. New open question 13 raised. | PO rulings comment on issue #21 |
| 2026-09-17 | Open question 13 moved into the body as rules: a fresh launch always shows a prompt; return from background below planned + margin shows no prompt, at or beyond it shows exactly one. The overrun prompt and the Match in progress "when did it end?" question merged into one quarter-end prompt, described once, with three triggers (due time, fresh launch, return from background past the threshold) and one choice set (Ended at planned time / Time of last recorded event / Ended just now / Still playing (resume)); Q10 repeat timing and Q11 hiding and floor rules carried over. Cross-references, worked examples and edge cases updated. New open question 14 raised. | PO ruling comment on PR #23 |
| 2026-09-17 | Quarters are strictly sequential: quarter N starts only when N−1 is ended, at most one quarter runs at a time; out-of-order or concurrent starts rejected with state unchanged. Defined "current quarter" and replaced the ambiguous `q.index <= current` match-elapsed formula with the sum over started quarters, with a worked example for running, between-quarters and after-final states. Quarter start step 2 and abandoned-match row cross-referenced; two edge-case rows added. New open question 15 raised. | Acceptance criteria of issue #24 (DEF-002), agreed by the PO when confirming the defect (2026-09-17) |
| 2026-09-17 | Open question 14 moved into the body as rules: return from background with no quarter running shows no prompt, only the next quarter's team sheet (item 1); the bench / team-sheet review offer is the single quarter-end prompt past planned length, with its choices, hiding rules and last-event floor (item 2, new trigger 4); a backdated choice needs no early-end confirmation but the deviation warning still applies (item 3). Worked examples, edge cases and cross-references updated. New open question 16 raised. | PO ruling comment on issue #26 |
| 2026-09-17 | Validity rule tightened: `totalMinutes` whole and within 20–120, `quarterCount` exactly 2 or 4 — closing the arbitrary-input gap QA raised on PR #17 and recording that matches are played in quarters or halves. Vacancy records now defined in Spec 01, so the vacancy term is real; the margin field pointers resolve to `Squad.marginMs` / `Match.marginMs`. | PO rulings, #19 |
| 2026-09-17 | Added Match configuration: fractional quarter lengths allowed (e.g. 50/4 → 750 000 ms); a configuration is valid when `totalMinutes` and `quarterCount` are positive and `totalMinutes × 60 000` is divisible by `quarterCount`, otherwise rejected with a clear message and no match created; rounding rejected because of invariant 1. Worked examples (40/4, 50/4, 60/4, 40/3, 50/3 valid; 50/7, zero and negative rejected); `plannedQuarterMs` term and an edge-case row updated. | PO ruling on issue #16 (fractional quarters allowed); whole-millisecond validity rule proposed in the latest issue #16 comment, confirmed at this PR's approval gate |
| 2026-09-17 | Open questions 15 and 16 moved into the body as rules: abandoning a match with a quarter running ends that quarter through the single quarter-end prompt (new trigger 5, same choices, hiding rules and last-event floor), the match becomes `abandoned` and no further quarters can start (Q15); returning from background with no quarter able to start (after the final quarter or abandonment) shows the match summary with no prompt (Q16). New section Abandoning a match with worked example; current-quarter definition, match-elapsed table, triggers, edge cases and cross-references updated. New open questions 17 and 18 raised. | PO ruling on issue #29 |

## Open questions for Product Owner

1. Should the app support extra time / a fifth period, or is 4 quarters fixed?

Questions 2–9 were ruled on 2026-09-17 (PO rulings comment on PR #20),
questions 10–12 on 2026-09-17 (PO rulings comment on issue #21), question 13
on 2026-09-17 (PO ruling comment on PR #23), question 14 on 2026-09-17 (PO
ruling comment on issue #26) and questions 15 and 16 on 2026-09-17 (PO ruling
on issue #29); all are now rules in the body above.

Raised by applying the issue #29 ruling (not decided here):

17. **Abandonment prompt details.** The ruling ends the running quarter through
    the normal quarter-end prompt, whose choices were designed for a quarter at
    or past planned length. When a match is abandoned:
    - **(a) Before planned length:** "Ended at planned time" would give an
      effective end *later* than the quarter elapsed at the tap (e.g. abandoned
      at 05:00, effective end 10:00), crediting minutes nobody played. Is that
      choice shown, hidden, or replaced?
    - **(b) "Still playing (resume)":** does choosing it cancel the abandonment
      (quarter stays `running`, match stays `in_progress`)?
    - **(c) Early-end confirmation:** does "Ended just now" below
      `plannedQuarterMs − marginMs` still ask for the one-tap confirmation, or
      does the abandon action itself count as confirmation?
    - **(d) No quarter running** (between quarters, or before kickoff): does the
      match become `abandoned` immediately, with no prompt?
    - **(e) Immediately after abandonment:** what is shown — the match summary
      (as on return from background), or something else?

Raised by applying the issue #29 ruling on question 16 (not decided here):

18. **Fresh launch with no quarter able to start.** The ruling covers return
    from background. On a **fresh launch** after the final quarter has ended,
    or into an abandoned match, is the match summary shown with no prompt as
    well, or the "Match in progress — resume?" prompt that a fresh launch
    otherwise always shows?
