# OMP-002: Unified operating model

**Status:** Accepted
**Date:** 2026-09-17
**Decided by:** Product Owner
**Supersedes:** [OMP-001](./OMP-001-defects-and-governance.md), and the
"Project OS / Option A" model described in an out-of-repo session summary

## Context

Two operating models were drafted in parallel on 2026-09-17:

- **OMP-001** (this repo): defect lifecycle, evidence at handoffs, session
  types, actions as GitHub issues.
- **"Project OS / Option A"** (a claude.ai session with no repo access): a
  batched decision queue, a `claude/DECISIONS.md` log, a scheduled task, and
  commits direct to `main`.

They agreed on intent — PO decides at gates only, decisions are batched and
logged, nothing is re-asked. They disagreed on substrate. The second one was
also partly fictional when checked: no scheduled task, no `DECISIONS.md`, and
test counts that didn't match the suite. Its session worked outside the repo,
so it could only hand the PO manual git steps.

## Decision

The PO ruled on four questions:

| Question | Ruling |
|---|---|
| Where do the decision queue and record live? | **GitHub issues (`decision-needed`) for the queue; specs / ADRs / OMPs for the substance.** No `DECISIONS.md`, no scheduled task; `/queue` command on demand |
| How does code reach `main`? | **Branch + PR per unit; Claude merges on PO approval.** PO never runs git |
| Where may agent work happen? | **Claude Code only for anything that changes the repo.** Chat is for thinking |
| Which models? | **Opus for every role. No Haiku** |

OMP-001's defect lifecycle (A) and evidence-at-handoffs rule (B) are carried
into the model; the ruling on git flow required PRs to carry test evidence.

The full model is [operating-model.md](../operating-model.md).

## Consequences

**Easier:** one place to look for anything pending; every gate leaves a PR
record; the PO's time goes to decisions only.

**Harder:** small doc fixes still go through a PR. Accepted — the PR is cheap
and Claude does the mechanics.

## Alternatives considered

The options not chosen for each question: a `DECISIONS.md` log (alone or
alongside GitHub), PO-merged or direct-to-main git flow, chat sessions as a
drafting surface with handoff, and mixed or unconstrained model choice.
