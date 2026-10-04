# Operating Model

How this squad actually runs: where work happens, how it reaches `main`, where
decisions live, and what the Product Owner does. Decided in
[OMP-002](./proposals/OMP-002-unified-operating-model.md).

The [delivery process](./README.md) describes the cycle and the gates. This
document describes the machinery that makes the gates real.

---

## 1. Where work happens

**Anything that changes the repository happens in a Claude Code session opened
on `~/github/coaching-app`.** That session reads, writes, runs tests, commits,
pushes and opens PRs itself.

claude.ai chat and Cowork sessions are for thinking and discussion. They cannot
see the repo, so what they produce is an *input* to a Claude Code session, never
a deliverable. If a session ever asks the Product Owner to copy files, run git,
or "commit locally", it is on the wrong surface — stop and move the work.

## 2. How code reaches `main`

```
issue ──▶ branch ──▶ commits ──▶ PR (with evidence) ──▶ QA ──▶ PO approves ──▶ Claude merges
```

| Rule | Detail |
|---|---|
| One branch per unit of work | `req-NN/<slug>`, `def-NNN/<slug>`, `adr/<slug>`, `process/<slug>` |
| Nothing is committed to `main` directly | Including docs. The PR is the merge gate's record |
| Claude does all git | Branch, commit, push, open PR, merge. The PO never runs git by hand |
| PRs carry evidence | Pasted output of `npx vitest run` and `python3 docs/process/validate-docs.py` against the PR head. "Should pass" is a rejected handoff |
| Partial work is a draft PR | Title prefixed `WIP:`, body lists what is not done. Never reported as complete |
| PR body links its issue | `Fixes #NN` so closure is automatic and traceable |
| Merge on PO approval | PO says "approve #NN" (chat or PR review); Claude merges (squash) and deletes the branch |

## 2a. How the Product Owner interacts

Decided 2026-09-17. The binding constraint on this project is **the PO's
response time, not agent throughput** — so the interface optimises for the
fewest seconds between "a decision is needed" and "a decision is made", while
keeping the detail one click away.

Three activities, three surfaces. Using one surface for all three is the mistake
this section exists to prevent.

| Activity | Surface | Why |
|---|---|---|
| **Deciding direction** | Options presented in chat, PO picks | Arrives *before* the work, when changing course is free |
| **Approving finished work** | PO says `approve <n>` in chat; Claude merges | The PO never touches the GitHub merge button |
| **Interrogating detail** | PR body, issue, repo docs — always linked | An archive and a reference, never the entry point |

### Every decision put to the PO uses the same shape

1. **What** is being decided, in one line
2. **The options**, each with its consequence
3. **A recommendation**, with reasoning — never a neutral menu
4. **Cost to reverse** — cheap decisions should feel cheap
5. **What it unblocks**
6. **A link** to the full detail

A decision presented without a recommendation is an unfinished handoff. The PO
is not there to do the analysis; he is there to rule on it.

### GitHub issues are the queue, not the interface

Issues are where a decision **waits** so it survives between sessions and
resurfaces in `/queue`. They are not where a decision is **made** — navigating
to GitHub, reading prose and typing a reply is high friction per decision.
`/queue` pulls issues *into* the conversation; keep that direction of travel.

A decision that lives only in a spec's open-questions list will go quiet. If it
needs the PO, it gets an issue labelled `decision-needed`.

### The known weakness

This works while a session is running. It has **no path for a decision that
arrives between sessions** — overnight CI, or async work needing a ruling. For a
spare-time project where sessions are the interaction model this is acceptable,
and it is recorded here rather than hidden.

### The gate is a convention, not an enforcement

GitHub attributes every commit, PR and comment here to the PO's own account, so
nothing at the platform level distinguishes agent work from human work or
enforces the approval gate. The `Co-Authored-By` trailer is the only marker, and
it is added by hand.

Formalising this — CODEOWNERS, branch protection and per-role identities — is
tracked in **#38**, deliberately deferred. Until it lands, the approval gate
holds because Claude honours it, which is worth stating plainly rather than
implying the platform is enforcing something it is not.

## 3. Where decisions live

One source of truth: **GitHub for the queue, repo docs for the substance.**

| What | Where | Label / numbering |
|---|---|---|
| A decision waiting on the PO | GitHub issue | `decision-needed` |
| A piece of work to be picked up | GitHub issue | `action`, or `requirement` / `tech` |
| A defect | GitHub issue | `defect` + `severity:*`, title `DEF-NNN:` |
| What we build | `docs/specs/` | Spec number |
| How it's built | `docs/decisions/` | ADR-NNN |
| How we work | `docs/process/proposals/` | OMP-NNN |

**Recording a ruling.** When the PO decides, the ruling and its reasoning are
written where they take effect — the spec, ADR or OMP — in a PR, and the
`decision-needed` issue is closed with a comment linking that PR. Small rulings
with no document home are recorded in the closing comment itself.

A decision that exists only in chat has not been made.

## 4. The decision queue

Run `/queue` in a Claude Code session. It gathers, from live sources only:

- open `decision-needed` issues
- PRs awaiting PO approval (and their evidence)
- open defects by severity
- ADRs and OMPs in `Proposed`
- local repo state that needs attention (uncommitted work, unpushed branches)

and presents them as one batch, each with context, a recommendation and cost to
reverse. The PO answers in one pass. No scheduled task, no separate log file.

## 5. Defects

A defect is behaviour contradicting an approved spec, ADR or invariant.

| Step | Who | Record |
|---|---|---|
| Raise | Anyone | Issue: evidence, reproduction, expected vs actual, invariant/spec reference, layer diagnosis |
| Triage | PO | Severity confirmed; any spec conflict ruled on (a `decision-needed` issue if not immediate) |
| Fix | Engineer | `def-NNN/` branch; **failing regression test committed before the fix**; spec amended first if triage said so |
| Verify | QA | PR comment: criteria met/unmet, pasted output of own run |
| Close | PO approves, Claude merges | `Fixes #NN` closes the issue |

| Severity | Meaning | Response |
|---|---|---|
| `severity:high` | Corrupts authoritative data or breaks an invariant | Blocks further feature work on that area |
| `severity:medium` | Wrong behaviour, data intact | Next session |
| `severity:low` | Cosmetic | Backlog |

## 6. Sessions

| Type | Purpose | Ends with |
|---|---|---|
| **Delivery** | One issue through build and verify | PR opened (or draft PR with gaps listed) |
| **Review** | Examine something built | Defects / `decision-needed` / `action` issues raised |
| **ADR review** | PO decides Proposed ADRs | Each Accepted / Rejected / Revise, in a PR |
| **Queue** | `/queue` — clear pending decisions | Rulings recorded, issues closed |

**Every session ends** by checking: every decision reached a document or issue,
every change is on a pushed branch, and nothing is left for the PO to do by hand.

## 7. Models

All squad roles run on **Opus**. No Haiku for any role. The product is an audit
ledger; a confident wrong claim costs far more than the tokens saved. Role
agents in `.claude/agents/` pin this.

## 8. Truthfulness rules

These exist because a session summary once reported a scheduled task, a
decision log file and 30 passing tests — none of which existed.

- Report only what was checked: run the command, list the file, query the API.
- A count, a status or a file path in a summary must come from a tool result in
  that session.
- If something was intended but not done, say "not done".
