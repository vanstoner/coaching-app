# OMP-001: Defect handling and the governance layer

**Status:** Superseded by [OMP-002](./OMP-002-unified-operating-model.md)
**Date:** 2026-09-17
**Raised by:** Architect-role review of REQ-01

An *operating model proposal* (OMP) changes how the squad works rather than what
it builds. ADRs cover technical decisions; OMPs cover process. Same rule: drafted
by a role, decided by the Product Owner, never silently adopted.

---

## Why now

Two things surfaced in the REQ-01 review:

1. **A defect escaped with no process to receive it.** [#13](https://github.com/vanstoner/coaching-app/issues/13)
   double-counts minutes. The delivery process covers QA → Engineer defect
   loops *within* an issue, but not a defect found after a commit, by someone
   other than QA, against an issue already "done". There is no defined record,
   owner, or closure rule.
2. **A handoff claimed something unverified.** The REQ-01 summary said tests
   "should pass consistently". They had not been run; 2 of 21 fail. The handoff
   payload table asks for "how to run it" but not for evidence that it was run.

And a broader one: sessions like the REQ-01 review produce decisions and
actions, but there is nowhere defined for actions to land, be prioritised, and
be picked up by the next session.

---

## Proposal A — Defect lifecycle

A defect is **behaviour that contradicts an approved spec, ADR or invariant.**
(Behaviour you've changed your mind about is a spec change, not a defect.)

```
Raised ──▶ Triaged (PO) ──▶ Fixing (Engineer) ──▶ Verifying (QA) ──▶ Closed (PO)
                 │                                     │
                 └──▶ Rejected / Spec change           └──▶ back to Fixing
```

| Step | Who | Record |
|---|---|---|
| **Raise** | Anyone (any role, or PO) | GitHub issue, `DEF-NNN` title prefix, labels `defect` + `severity:*`. Must contain: evidence (command output), reproduction, expected vs actual, invariant/spec reference, layer diagnosis (implementation / spec / intent). |
| **Triage** | PO | Confirm severity; answer any spec conflict; assign. Comment records the ruling and reasoning. |
| **Fix** | Engineer | Branch + PR referencing the issue. **Regression test that fails before the fix is committed first** (visible in history). Spec amended first if triage ruled a spec change. |
| **Verify** | QA | Independent run; comment with criteria met/unmet and pasted output. |
| **Close** | PO | Merge PR; issue closes via `Fixes #NNN`. |

**Severity:**

| Label | Meaning | Response |
|---|---|---|
| `severity:high` | Corrupts authoritative data or breaks an invariant | Blocks new feature work on affected area |
| `severity:medium` | Wrong behaviour, data intact | Next session priority |
| `severity:low` | Cosmetic / message wording | Backlog |

**Audit trail** is the issue itself plus the linked PR: raised-by, evidence,
ruling, failing test commit, fix commit, QA verification, PO close. No separate
register needed — GitHub timestamps and attributes each step.

**Proposed artefacts if approved:** `.github/ISSUE_TEMPLATE/defect.md`, a
`Defects` section in `docs/process/README.md`, and the handoff table amended.

## Proposal B — Evidence, not assertion, at handoffs

Amend the handoff payloads:

| Handoff | Add |
|---|---|
| Engineer → QA | Pasted output of the full test run, against the commit being handed over. "Should pass" is a rejected handoff. |
| QA → PO | Pasted output of QA's own independent run. |

This is a one-line rule with the highest ratio of value to effort in this
proposal. It would have caught #13 before commit.

## Proposal C — The governance layer

### Session types

Sessions remain the unit of work. Naming their type sets what they must produce.

| Session | Purpose | PO role | Must produce |
|---|---|---|---|
| **Delivery** | Spec → build → verify one issue | Gates | Merged PR or reported partial state |
| **Review** | Examine something built (like the REQ-01 review) | Receives findings | Defects, proposals, actions |
| **ADR review** | Decide Proposed ADRs | Presides, decides | Each ADR Accepted / Rejected / Revise, with reasoning |
| **Backlog** | Prioritise actions and issues | Decides | Ordered next-up list |

### Every session ends with an action log

At session end, the active role writes a short record to
`docs/sessions/YYYY-MM-DD-<slug>.md`:

- **Decisions** — what was decided, where it was recorded (ADR/spec/issue link)
- **Raised** — defects, ADRs, proposals created
- **Actions** — each with an owner role and a proposed priority
- **Open questions** — waiting on PO

Actions that need doing become **GitHub issues labelled `action`** so there is
one backlog to prioritise, not two. The session record is the narrative; the
issue is the work item.

### Decision register

Three decision types, three homes — all PO-approved, all immutable once decided:

| Decides | Home | Numbering |
|---|---|---|
| What we build | `docs/specs/` | Spec number + version |
| How it's built (technical) | `docs/decisions/` | ADR-NNN |
| How we work (process) | `docs/process/proposals/` | OMP-NNN |

### Suggested cadence

Not sprints. A **backlog session** whenever the action queue exceeds what you
can hold in your head — likely every 3–5 delivery sessions.

---

## Decisions requested

1. Adopt Proposal A (defect lifecycle)? — Y / N / Revise
2. Adopt Proposal B (evidence at handoffs)? — Y / N / Revise
3. Adopt Proposal C (session types, action logs, `action` issues)? — Y / N / Revise

If accepted, the BA-role updates `docs/process/README.md` and
`docs/roles/README.md`, and this OMP's status moves to Accepted.

---

## Worked example — actions from the REQ-01 review session

What this session would have logged under Proposal C:

**Raised**
- DEF-001 [#13](https://github.com/vanstoner/coaching-app/issues/13) — double-counted minutes (`severity:high`)
- ADR-006 to ADR-011 — Proposed ([index](../../decisions/README.md))
- OMP-001 — this document

**Actions**

| # | Action | Owner | Proposed priority |
|---|---|---|---|
| 1 | PO rules on spec 02 invariant conflict (nominal vs actual quarter length) — blocks #13 | PO | P0 |
| 2 | Fix #13 | Engineer | P0, after 1 |
| 3 | ADR review session for ADR-006–011 — **before REQ-02**, since ADR-007 reshapes the engine | PO + Architect | P0 |
| 4 | Add `.gitignore` — CLAUDE.md says one guards squad data, but none exists; `node_modules/` currently untracked in tree | Engineer | P1 |
| 5 | Decide OMP-001 | PO | P1 |
| 6 | If ADR-007 accepted: BA revises spec 01/02 for events-as-record; Engineer reshapes REQ-01 engine | BA → Engineer | P1 |
| 7 | Retrospective note: REQ-01 skipped the Architect step in the delivery cycle | PO | P2 |

**Open questions for PO**
- Spec 02 invariant conflict (action 1)
- ADR-010: sharing scenario — squad coaches, or club-wide?
