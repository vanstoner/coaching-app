# Project instructions for Claude

Junior football coaching app for one under-10s squad. Android first. Rob is
Product Owner and the only approver.

**Every session ends with a releasable artifact.** Every PR that changes the app
publishes **Heart FC Beta Coach** once it is ready or labelled `ci:full` (#231;
its own app id, one rolling `beta` release). A merge is Rob's approval, so a
green build of `main` publishes the full **Heart FC Coach** release, marked
Latest, and replaces the beta with a note pointing to it, unless a newer open
PR's beta is there (#128). No installable APK means the session produced nothing.

## What we are building

One coach, one squad, one match a week on a Saturday, 50 minutes, quarters or
halves. It answers one question at the touchline: **who comes off next, and is
everyone getting a fair share?**

It is a substitution reminder, not a timing system.

**Heart of the Game:** defaults favour every child playing; competitiveness is
dialled in by the coach, and the cost is always shown.

## Invariants — never break these

Each is an ADR in `docs/decisions/`. Load-bearing, not preferences. If an
implementation would break one, stop and escalate.

1. **Minutes fold from the record; nothing derived is stored as authoritative.**
   The displayed figure and the audit trail must be incapable of disagreeing
   (ADR-022 D1; the record is ADR-013, 014, 021).
2. **Elapsed time comes from wall-clock anchors, never tick counting.** Android
   throttles background timers; ticks are silently lost. Never increment an
   authoritative value in a timer callback. A timer may trigger a *repaint*; the
   value it paints is recomputed from anchors every time.
3. **Fairness is total time on the pitch, in goal plus outfield, never per position.** Positions are assigned by affinity; per-position measurement would flag the coach's own decisions as anomalies. A player's outfield-share target is shown beside their figures, never used as a fairness input (ADR-015).
4. **First names only. No PII.** Children's data. No surnames, DOB, contacts or
   photos — in the model or the UI.
5. **Corrections are explicit, noted, and never destructive.** A correction is a
   new event referencing what it corrects, with a mandatory note.

**Proportionality (PO ruling).** These five are structural guarantees, not a
precision target. Seconds-level accuracy is enough, and surviving a forgotten
clock matters more than refining it. Don't buy precision past that bar.

## How we work

**Delivery first.** Docs once outweighed the app 50 to 1. Before writing a
document, ask whether an issue comment would do.

- **Issues are the audit trail.** Decisions, rulings, findings and status go in
  the issue they affect. `decision-needed` is the label for anything waiting on
  Rob.
- **Build, then test the build.** All else is overhead until proven otherwise.
- **Work an issue, not an idea.** Open issues are the intent. Iterate: each
  release better than the last.
- **Definition of Ready (#231).** No code before the issue's feature form is
  complete and Rob has approved it once. Bea writes the criteria, never whoever
  implements them; Dee agrees the screens with her first. No criteria, no
  merge — infrastructure included.
- **Scope freeze.** Once a release PR enters QA, new asks go to the next
  version, except regressions and release blockers.
- **Decisions are batched daily** through the `queue` skill, each with a
  recommendation. Urgent blockers go straight away.
- **Dry-run every gate against the healthy case** too: five of six CI failures
  here rejected a correct artifact. **Verify preconditions before designing on
  them**: the release pipeline was built on a tag push that was not possible.
- **Escalate ambiguity; never silently "fix" a spec.** A confident wrong guess
  is the most expensive failure mode here.
- **Report partial work as partial.** A known gap reported is a managed risk.
- **Lean loops.** Agent hand-backs are at most 15 lines; detail goes in one
  issue comment or commit message. QA checks the diff since its last pass plus
  the regression suite. Claude pushes once per integrated step. After two failed
  Mac runs, a diagnostic run that captures every screen precedes another guess.
- **Every handoff that stops short leaves Rob a checklist (#229):** what is his
  (merge, approve a run), what he *could* do by hand, and a copy-paste prompt
  for anything a fresh session can pick up.
- **Every app change moves the version and brings its notes (#217).** A PR
  that touches `App.tsx`, `src/` or `assets/` opens its description with
  `## Version`: **minor** (something new a coach can see or do), **patch** (a
  fix), **major** (Rob's call), or **none** plus a reason. The same PR bumps
  `app.json` by that step, adds its `HISTORY.md` entry and freezes the release
  it supersedes, and updates the spec row, docs and any Mermaid diagram it
  makes wrong. CI (`version-impact.yml`) checks the first three.
- **Closing a release (Rob, 27 Oct).** A major or minor release is not done
  until the repo is clean enough that a fresh agent can pick it up from
  CLAUDE.md, HISTORY.md and the issue stack alone:
  - **The spec matches what is built.** Bea checks every row of
    `docs/feature-specs.md`, the data model and the architecture doc
    (diagrams included) against the code; fixes go in the release PR, and a
    disagreement with an approved criterion goes to Rob before merge.
  - **The issue stack is minimal.** Every issue the release finished is
    closed naming its PR; superseded ones are closed pointing to what
    replaced them; what stays open is live intent or waiting on Rob, and
    labelled so.
  - **No open PRs** once the release merges, and merged branches deleted.
  - **HISTORY.md** has the release's entry.
- **The match engine stays pure TypeScript** — no React or platform imports.

## Git and approval

- **Claude does all git.** Branch per unit of work, commit, push, PR. Nothing
  goes to `main` directly. Claude merges only when Rob approves.
- **Never hand Rob manual steps.** No "copy this file", no "run these commands".
- **PRs carry pasted evidence**, not assertions: `npx vitest run` and
  `python3 docs/process/validate-docs.py` against the PR head.
- **Rob's interface is chat.** Put decisions to him *before* the work, each with:
  what, the options, **a recommendation with reasoning**, cost to reverse, what
  it unblocks, and a link. A menu with no recommendation is an unfinished
  handoff. He replies `approve <n>`; Claude merges. **Every step that is Rob's
  (approve a run, tick a box, delete a branch) comes with its direct link**
  (Rob, 29 Oct).
- **Report only what you verified this session.** Counts, statuses and paths
  must come from a tool result.

## Squad roles

Six disciplines, each a **skill** in `.claude/skills/` — `analyse`, `design`,
`architect`, `implement`, `verify`, `ship`. The skill is the charter, so it
binds a single session as well as a spawned agent. Index in
`docs/roles/README.md`.

The separations that matter: the Engineer doesn't write its own acceptance
criteria; QA reports and never fixes; Platform builds no product features.

Agents die to rate limits often. When one does, say so — work silently falling
back to the orchestrator is how the boundaries dissolve.

End every commit with a `Refs:` trailer naming the issue it serves, then
`Squad-Role:`, above `Co-Authored-By`. `Refs:` is CI-gated (#47 D5); a
subject-line `(#NN)` does not count, as it names a PR on some commits.

```
Refs: #4, #9
Squad-Role: Ellis (Engineer)
Co-Authored-By: ...
```

## Commands

```bash
npx vitest run                             # tests
npx tsc --noEmit                           # typecheck
python3 docs/process/validate-docs.py      # docs; non-zero on failure
```

In a cloud session a `SessionStart` hook (`.claude/hooks/session-start.sh`)
runs `npm ci` when `node_modules` is missing or stale, so these work at once.

## Data protection

Real squad data is **never** committed — it belongs on the device. The
repository is public and release assets are world-readable and permanent, so
nothing captured from a device running a real squad is ever attached to one: no
database export, no screenshot from Rob's phone, no logcat, no crash dump.

## Stack

React Native + Expo, TypeScript strict. iOS is aspirational — avoid gratuitously
Android-only choices, but don't pay real complexity for portability that may
never be used.
