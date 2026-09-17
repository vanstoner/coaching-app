# Spec 02 — Match Engine & Clock

Status: Draft for Product Owner review
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

### Rules

- The clock **runs continuously within a quarter**. There is no routine pause.
- The clock **stops automatically at quarter end** (a hard stop).
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

A recovery prompt appears if the app relaunches into an `in_progress` match:
"Match in progress — resume?" with the computed elapsed time shown so the coach
can sanity-check it before continuing.

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

**On quarter end (the hard stop):**
1. Freeze the clock; accumulate into `accumulatedMs`; status → `ended`.
2. Close every open Appearance with `endReason: quarter_end`.
3. Close every open BenchStint.
4. Recompute totals and present the **next quarter's planned team sheet**
   (Spec 04), which is editable before the coach confirms.

Closing every interval at the quarter boundary means quarter totals are exact
and independently checkable — a quarter's Appearance durations must sum to
`quarterMinutes × onFieldCount`. The test suite asserts this identity.

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
   self-corrects at the next hard stop.
5. **Escalation.** An alarm unactioned for more than a configurable threshold
   (default 3 minutes) escalates its visual prominence, since the free-running
   clock means a missed sub costs real fairness minutes.

**Alert delivery:** in-app visual (persistent banner, colour-coded) plus optional
haptic and sound. Must work with the screen on and the app foregrounded — the
expected touchline usage. Background notifications are explicitly out of MVP
scope; the app is expected to be open during a match.

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

**Invariant (asserted in tests):** for any closed quarter,
`sum(all Appearance durations) === quarterMinutes × onFieldCount`
and
`sum(Appearance durations) + sum(BenchStint durations) === quarterMinutes × availablePlayerCount`.

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
| Quarter ended early (ref's whistle) | Coach ends quarter manually; actual elapsed is recorded, not the nominal figure. |
| Same player assigned to two positions | Rejected by the engine with a validation error. |
| Clock adjusted after the fact | Treated as a correction: requires a note, flagged in the ledger. |

## Open questions for Product Owner

1. Should the app support extra time / a fifth period, or is 4 quarters fixed?
2. When a quarter runs long (ref plays 12 minutes of a 10-minute quarter), should
   the extra time count toward fairness totals? (Recommendation: yes — it is time
   the players actually played.)
