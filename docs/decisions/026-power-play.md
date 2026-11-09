# ADR-026: Power play

**Status:** Proposed. Rob ruled #255's rule on 7 Nov; this ADR records the
design under it and is accepted when Rob approves it, before Dee's screens and
Bea's criteria. Q3 (the margin closing) is open, below.
**Date:** 2026-11-07
**Decision maker:** Architect, for the Product Owner's ruling (#255)

**Rulings.** [#255](https://github.com/vanstoner/coaching-app/issues/255),
Rob, 7 Nov: *"for the power play for the opposition I just need to know it
was used. For our side I need to add to the team formation in that
exceptional case, so something indicating power play is needed from the
scoreline to prompt me, then allows me to add players suggesting them in time
needed order. Keep powerplay rules entirely configurable from season
settings. Goal difference needed for up to 3 players, 3 input boxes in a row
should cover it."* This replaces the 29 Oct rule (steps at 4 and 6, 5- and
7-a-side only) and the on/off button for the opposition.

**Relationship:** keeps invariants 1–3. Stays inside
[ADR-021](./021-the-record-of-truth.md) D1 (one new record type, one new
event kind, no version bump), [ADR-022](./022-teams-and-seasons.md) D5 (the
season record) and [ADR-023](./023-formats-at-9-and-11.md) (shapes stay a
code catalogue; no shape is added). Keeps
[ADR-015](./015-fairness-is-total-pitch-time.md): fairness is total pitch
time.

## Context

A side losing by a set margin may add an outfield player, and more as the
margin grows (#255). Verified on `claude/2.4.0`:

- **The number on the pitch is fixed per match.** `startQuarter` requires
  exactly `format.onFieldCount` children (`src/engine/MatchEngine.ts:285`), and
  `substitute` swaps one for one. The engine's checked identity is
  *sum of a closed period's Appearances = its elapsed time × onFieldCount*
  (`MatchEngine.ts:790-818`). It is the only place in `src/` that multiplies
  by `onField`.
- **Pitch time already sums.** Season figures fold per interval
  (`foldLedger`), and a match's fair share is the children's total pitch time
  divided by how many are in it (`matchFairShare`, `src/app/fairShare.ts`). An
  extra child's time adds to the total; nothing assumes a fixed pool.
- **The match's side is `structure.onField`** (`sideOf`,
  `src/app/analysis.ts:387`), which votes for the season's main format.
- **An event's `kind` is any string** to the reader (`ledger.ts:449`), so a new
  kind reads in 2.3.0 and is ignored by every reader that switches on kind.
- **A 2.3.0 season save rebuilds the `season` record from known fields**
  (`seasonRecord`, `ledger.ts:1224`), so a new field on it would be dropped by
  an older build. A record type it does not know is carried untouched
  (ADR-014 §10). ADR-022 already chose its own record, `format-count`, over a
  new meaning for an existing one.

## Decision

**D1. Our power play is extra Appearances, nothing more.** The number on the
pitch is never stored. At any moment it is the count of open intervals, folded
from the record (invariant 1). There is no "power play on" event for our side:
it would be a second statement of what the intervals already say, and could
disagree with them.

- **The format is unchanged.** `onFieldCount` and `structure.onField` stay
  the base side: a 7-a-side match with a power play is still 7-a-side, for the
  season's main format, the plan and the lineup.
- **Extra slots are the match's, not the shape's.** Up to **3** extra
  outfield positions (`MAX_EXTRA_SLOTS = 3`, Rob's three boxes) are held in
  the match's working state, each with the unit the coach drops the child into
  (DEF, MID or ATT; Dee places them). No shape is added to `SHAPES` and no
  shape code changes (ADR-023 D1). An interval in an extra slot records
  `kind: 'outfield'`, its `unit`, and `role: null`: a position is a record,
  never a target (invariant 3).
- **Never a second keeper.** An extra slot is outfield only.

**D2. Two engine commands, timed from wall-clock anchors.**

- `addExtraPlayer(state, quarter, playerId, unit)`: a child on the bench and
  available comes on in a new extra slot. Its Appearance opens at the match
  elapsed time, folded from the anchors (invariant 2). Refused when 3 extra
  slots are open, or the period is not running.
- `removeExtraPlayer(state, quarter, playerId)`: any child on the pitch comes
  off, with no one coming on (the old rule's flexibility, kept). If that child
  was in a base slot, the child in the highest extra slot moves into it as a
  position change, so **the base slots are always filled** and only extra
  slots close. Dee may let the coach choose who moves; the engine rule is that
  base slots stay filled.
- `startQuarter` accepts the base team sheet plus up to 3 extras, so a power
  play still due after a break carries into the next period by the coach's
  choice. Nothing carries by itself.
- **The engine identity becomes:** *sum of a closed period's Appearances =
  elapsed × onFieldCount + the time each extra slot was open*. The engine
  stays pure TypeScript and knows nothing of scores or seasons.

**D3. The score prompts; the engine does not gate.** The allowance is never
stored. It is worked out each time from the goal and conceded events (a
withdrawn one does not count) and the season's rule (D5): the number of steps
the opposition's lead has reached. When the allowance is more than the open
extra slots, the score band shows the power play is due, and **Add a player**
offers children **in time-needed order: least pitch time in this match first,
ties by owed time** (ADR-024 D3), folded each time. The coach confirms each
one. The engine enforces only its structural cap of 3: the record holds what
the coach did, and a goal tapped late or withdrawn can move the allowance
either way.

**D4. The opposition's power play is one event.** A new event kind,
`opp_power_play`, credited to no one, at its match time: "their power play
was used". No count, no end, no formation change, no child's minutes. It is
withdrawn like any other event (invariant 5). The score band offers it when
our lead reaches the season's first step; the coach can tap it at any time.

**D5. The rule is a season setting, in its own record.** A new record type,
`power-play-rule`, keyed by `season` (the season's id), latest wins:
`{ season, steps, note }`, where `steps` holds 0 to 3 whole goal differences,
each larger than the one before (the three boxes; an empty box ends the
list). No steps, or no record, means no power play prompts for that season.
Nothing is written for the coach and no default is guessed: Settings may show
Rob's league (4, then 6) as a hint, written only when he saves. **Mini-soccer only** (Rob, 9 Nov, "approve 1"): the FA's Power Play is an
optional law "available through all mini soccer football formats 5v5 and
7v7" (Mini-Soccer Handbook 2025/26), and NEHYL says the same. A 9- or
11-a-side match never prompts, whatever the steps, and Settings shows the
boxes only for a 5- or 7-a-side season (or one whose main format is not set). It is its own
record, never a field on `season`, so an older build that saves the season
cannot drop it. The rule is not snapshot on the match: it only prompts, and
the match records what the coach did, so a later edit rewrites no history.

**D6. Fairness is unchanged (invariant 3).** An extra child's time is pitch
time like any other. A match's fair share rises during a power play because
the total rises (`matchFairShare` needs no change). The plan is intent and is
not rewritten; during a power play the "who comes off next" cue counts the
extra children as on the pitch.

**D7. When the margin closes (Q3, recommended for Rob).** When the allowance
drops below the open extra slots, the app prompts "Power play over: who comes
off?" with the usual cue (most time on the pitch first), and the coach
chooses. **Nothing comes off by itself**: the clock never writes a record the
coach did not make, and a withdrawn goal can reopen the allowance. If the
margin falls past two steps at once, the prompt asks for each.

## Consequences

**Easier:**
- Every figure, the season's main format and the minutes file need no change:
  extra time is ordinary intervals.
- The #281 timeline can show "Power play: Ava on (8 v 7)" folded from the
  intervals and `structure.onField`.
- A recorder (ADR-025) gets the same prompts: the pack carries the rule.

**Harder:**
- The engine's identity, `startQuarter`'s check and the lineup grow a second
  term. The pitch draws up to 3 extra pills in a **Power play** row under
  the pitch, not on the grass: at 11-a-side a row of four leaves no room
  for one more, and the gap between rows is shorter than a pill. A
  `fitGuard` case checks the row at 360dp, with 11-a-side plus 3 the widest.
- The sub cue and the plan's "next sub" must read the open set, not the
  format's size.

**Accepted:**
- **No record says "our power play started".** It is read from the intervals.
  An extra child can come on only through D2's command, which the app offers
  on the power play prompt, so an extra interval means a power play.
- **Older builds** show a power-play match's extra child as an ordinary
  interval (correct minutes), ignore `opp_power_play`, and carry
  `power-play-rule` without prompting.

**Destructive changes:** none.

**Cost to reverse:** the event kind `opp_power_play` and the record type
`power-play-rule` are permanent once written. D2, D3 and D7 are low.

## Alternatives considered

- **Power-play shapes in the catalogue** (a 2-3-1 plus one as `2-3-2+`). Up
  to 3 extras over 8 shapes is 24 codes that are permanent once written
  (ADR-023 D1), and the match would change shape mid-period. Rejected for
  slots held by the match.
- **A stored player count, or on/off events for our side.** A second
  statement of what the intervals say, able to disagree (invariant 1).
  Rejected.
- **A field on the `season` record.** Dropped by a 2.3.0 season save
  (`seasonRecord` rebuilds it). Rejected for its own record, as ADR-022 did
  for `format-count`.
- **The engine enforcing the allowance.** Puts scores and season rules into
  the engine, and blocks a coach correcting a late tap. Rejected (D3).
- **Taking the extra child off automatically when the margin closes.** A
  record the coach did not make. Rejected (D7).
- **An on/off button for their power play with a count** (29 Oct). Rob's
  7 Nov ruling needs only that it was used. Rejected (D4).
