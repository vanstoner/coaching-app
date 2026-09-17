---
name: queue
description: Show the Product Owner's decision queue for coaching-app — pending decisions, PRs awaiting approval, defects, Proposed ADRs/OMPs and local repo state — as one batch with recommendations. Use when Rob says "/queue", "clear the decision queue", "what's pending" or starts a session.
---

Build the PO decision queue from **live sources only**. Never report an item you
did not just read from a command.

## Gather

```bash
gh issue list --label decision-needed --state open --json number,title,body,labels
gh pr list --state open --json number,title,isDraft,headRefName,reviewDecision,body
gh issue list --label defect --state open --json number,title,labels
grep -l '^\*\*Status:\*\* Proposed' docs/decisions/*.md docs/process/proposals/*.md
git status --short
git branch -vv
git log origin/main..main --oneline
```

## Present

1. **Status line** — counts of each category.
2. **Decisions needing you** — numbered. For each: the question, options,
   recommendation, cost to reverse, what it unblocks.
3. **PRs awaiting approval** — for each: what changed, evidence present in the
   body (yes/no — a PR without pasted test output is not ready), recommendation.
   Drafts listed separately as not ready.
4. **Defects** — by severity.
5. **Repo hygiene** — uncommitted changes, unpushed commits, local `main` ahead
   of `origin/main` (work that bypassed a PR).
6. **Next up** — the highest-priority unblocked item.

Ask for rulings in one batch (AskUserQuestion where options are clear).

## Record

For each ruling, follow `docs/process/operating-model.md` §3: write it where it
takes effect (spec / ADR / OMP) via a PR, or in the issue's closing comment if
small; close the `decision-needed` issue linking the record. For "approve #NN" on
a PR: confirm evidence is present, squash-merge, delete the branch.
