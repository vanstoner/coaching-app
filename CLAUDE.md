# Project instructions for Claude

Junior football coaching app. Android first, iOS later. Spec-driven development
with an agentic squad; Rob is Product Owner with approval gates.

**On first working in this repo, read `HANDOFF.md`** — full context transfer
from the session that created these specs.

## Invariants — never break these

Each is an ADR in `docs/decisions/`. They are load-bearing, not preferences.

1. **Minutes are derived by folding intervals, never stored as running totals.**
   The displayed figure and the audit trail must be incapable of disagreeing.
2. **Elapsed time comes from wall-clock anchors, never tick counting.** Android
   throttles background JS timers; ticks are silently lost. Never increment an
   authoritative value in a timer callback.
3. **Fairness is total outfield playing time, never per position.** Positions
   are assigned deliberately by affinity; per-position measurement would flag
   the coach's own decisions as anomalies.
4. **First names only. No PII.** Children's data. No surnames, DOB, contacts or
   photos — in the model or the UI.
5. **Corrections are explicit, noted, and never destructive.**

If an implementation would break one of these, stop and escalate.

## Working rules

- **Specs are approved before implementation.** Don't write feature code against
  an unapproved spec.
- **Escalate ambiguity rather than guessing.** A confident wrong guess is the
  most expensive failure mode here. Escalation is success, not failure.
- **Never silently "fix" a spec you think is wrong.** It may encode reasoning
  you can't see. Propose the change.
- **The match engine stays pure TypeScript** — no React or platform imports.
  It must be testable without a device.
- **Report partial work as partial.** A known gap reported is a managed risk; a
  concealed one is a latent defect.
- **Update the spec when behaviour changes.** A decision that lives only in a
  chat log is lost at the end of the session.

## How we operate

Full model: `docs/process/operating-model.md` (decided in OMP-002). The rules
that matter every session:

- **Repo work happens only in Claude Code, in this repo.** Never hand Rob
  manual steps — no "copy this file", no "run these git commands".
- **Claude does all git.** Branch per unit of work, commit, push, open a PR.
  Nothing goes to `main` directly. Claude merges only when Rob approves.
- **PRs carry evidence.** Paste `npx vitest run` and
  `python3 docs/process/validate-docs.py` output against the PR head. Partial
  work is a draft PR titled `WIP:` listing what's missing.
- **Decisions queue as GitHub issues labelled `decision-needed`**; rulings are
  recorded in the spec/ADR/OMP they affect. `/queue` presents the batch.
- **Report only what you verified in this session.** Counts, statuses, file
  paths and "scheduled"/"running" claims must come from a tool result.
- **All roles run on Opus.** Use the role agents in `.claude/agents/`.
- **End of session:** every decision reached a document or issue; every change
  is on a pushed branch; nothing is left for Rob to do by hand.

## Squad roles

Four separate agents, charters in `docs/roles/`. Key separations:

- The Engineer does **not** write its own acceptance criteria.
- QA does **not** fix what it finds — it reports, the Engineer fixes.
- The BA does **not** implement.

Run sequentially rather than orchestrated unless Rob asks otherwise — he wants
visibility into each handoff.

## Commands

```bash
python3 docs/process/validate-docs.py      # validate docs; exits non-zero on failure
bash docs/issues/create-issues.sh          # create GitHub issues (re-runnable)
DRY_RUN=1 bash docs/issues/create-issues.sh  # preview without creating
```

## Data protection

Real squad data must **never** be committed. `.gitignore` guards common
patterns, but the rule matters more than the guard. Player data belongs on the
device, not in version control.

## Stack

React Native + Expo, TypeScript strict. iOS is aspirational, not committed —
avoid gratuitously Android-only choices, but don't pay real complexity cost for
portability that may never be used.
