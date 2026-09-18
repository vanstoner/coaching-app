# Project instructions for Claude

Junior football coaching app for one under-10s squad. Android first. Rob is
Product Owner and the only approver.

**Every session ends with a releasable artifact.** A green build of `main`
publishes a prerelease APK automatically. If a session produces no installable
APK, it produced nothing.

## What we are building

One coach, one squad, one match a week on a Saturday, 50 minutes, quarters or
halves. It answers one question at the touchline: **who comes off next, and is
everyone getting a fair share?**

It is a substitution reminder, not a timing system.

## Invariants — never break these

Each is an ADR in `docs/decisions/`. Load-bearing, not preferences. If an
implementation would break one, stop and escalate.

1. **Minutes fold from events; nothing derived is stored as authoritative.**
   The displayed figure and the audit trail must be incapable of disagreeing
   (ADR-007, supersedes ADR-003).
2. **Elapsed time comes from wall-clock anchors, never tick counting.** Android
   throttles background timers; ticks are silently lost. Never increment an
   authoritative value in a timer callback. A timer may trigger a *repaint*; the
   value it paints is recomputed from anchors every time.
3. **Fairness is total outfield playing time, never per position.** Positions
   are assigned by affinity; per-position measurement would flag the coach's own
   decisions as anomalies.
4. **First names only. No PII.** Children's data. No surnames, DOB, contacts or
   photos — in the model or the UI.
5. **Corrections are explicit, noted, and never destructive.** A correction is a
   new event referencing what it corrects, with a mandatory note.

**Proportionality (PO ruling).** These five are structural guarantees, not a
precision target. Seconds-level accuracy is enough, and surviving a forgotten
clock matters more than refining it. Don't buy precision past that bar.

## How we work

**Delivery first.** At the last count this repository held 6,147 lines of
documentation against 114 lines of app. That ratio is the problem, not the
solution. Before writing a document, ask whether an issue comment would do.

- **Issues are the audit trail.** Decisions, rulings, findings and status go in
  the issue they affect. `decision-needed` is the label for anything waiting on
  Rob. Don't create a document where an issue comment works.
- **Build, then test the build.** Those two together are a working, documented
  codebase. Everything else is overhead until proven otherwise.
- **Work an issue, not an idea.** The 21 open issues are the intent. Iterate:
  each release better than the last.
- **Acceptance criteria come from the issue**, never from whoever implements it.
  No criteria, no merge — infrastructure included.
- **Dry-run every gate against the healthy case**, not just the failure case.
  Five of six CI failures here were assertions rejecting a correct artifact.
- **Verify preconditions before designing on them.** The release pipeline was
  built on a tag push nobody had checked was possible. It wasn't.
- **Escalate ambiguity; never silently "fix" a spec.** A confident wrong guess
  is the most expensive failure mode here.
- **Report partial work as partial.** A known gap reported is a managed risk.
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
  handoff. He replies `approve <n>`; Claude merges.
- **Report only what you verified this session.** Counts, statuses and paths
  must come from a tool result.

## Squad roles

Five agents, charters in `docs/roles/`: **Bea** (BA), **Ada** (Architect),
**Ellis** (Engineer), **Quinn** (QA), **Pip** (Platform). The separations that
matter: the Engineer doesn't write its own acceptance criteria; QA reports and
never fixes; Pip builds no product features.

Agents die to rate limits often. When one does, say so — work silently falling
back to the orchestrator is how the boundaries dissolve.

End every commit with a `Squad-Role:` trailer above `Co-Authored-By`.

## Commands

```bash
npx vitest run                             # tests
npx tsc --noEmit                           # typecheck
python3 docs/process/validate-docs.py      # docs; non-zero on failure
```

## Data protection

Real squad data is **never** committed — it belongs on the device. The
repository is public and release assets are world-readable and permanent, so
nothing captured from a device running a real squad is ever attached to one: no
database export, no screenshot from Rob's phone, no logcat, no crash dump.

## Stack

React Native + Expo, TypeScript strict. iOS is aspirational — avoid gratuitously
Android-only choices, but don't pay real complexity for portability that may
never be used.
