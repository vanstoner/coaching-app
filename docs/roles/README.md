# Squad Roles

Five roles, each a separate agent with its own charter, context and boundaries.
Separation is deliberate: it creates the independent verification that makes
output trustworthy.

**See [squad.md](./squad.md) for the diagrams** — who hands off to whom, where
the approval gates sit, and the boundaries that must never be crossed.

The agents have first names — Bea, Ada, Ellis, Quinn, Pip — so handoffs read as
a chain of custody rather than as process documentation, and so
`git log --grep="Squad-Role: Quinn"` is a useful query. First names only, the
same rule the app applies to the children whose minutes it tracks.

## Why separate agents rather than one capable one

A single agent asked to spec, build and test will produce code that passes its
own tests — because it wrote both from one interpretation. If that
interpretation is wrong, nothing catches it. Separation means the QA agent reads
the *acceptance criteria*, not the Engineer's reasoning, and can therefore
disagree.

This is the same principle as separating the person who deploys from the person
who approves. It is not about capability; it is about independence.

## The squad

| Name | Role | Owns | Hands off to | Never does |
|---|---|---|---|---|
| **Bea** | [Business Analyst](./business-analyst.md) | Specs, issues, acceptance criteria | Architect, Engineer, Platform | Write implementation code |
| **Ada** | [Architect](./architect.md) | Technical design, ADRs, domain integrity | Engineer, Platform | Write feature code |
| **Ellis** | [Engineer](./engineer.md) | Feature implementation | QA | Write its own acceptance criteria |
| **Quinn** | [QA](./qa.md) | Verification, tests, edge cases | Product Owner | Fix the code it finds faults in |
| **Pip** | [Platform Engineer](./platform-engineer.md) | CI/CD, builds, artifacts, releases | QA | Write product features |

**Product Owner (you)** sits above all five: sets intent, approves specs,
arbitrates trade-offs, merges.

## The critical boundaries

Three separations carry most of the value. If you keep only three rules, keep
these:

**1. The Engineer does not write its own acceptance criteria.**
Otherwise it defines success as whatever it built.

**2. QA does not fix what it finds.**
A QA agent that fixes bugs starts optimising for fixable bugs and stops looking
for design-level problems. It reports; the Engineer fixes.

**3. The BA does not implement.**
A BA that writes code starts writing specs that describe code it has already
imagined, rather than the behaviour you actually asked for.

## Handoff protocol

Each handoff carries a defined payload. A handoff missing its payload is
rejected rather than guessed at.

```
Product Owner  ──intent──▶  BA
BA  ──draft spec──▶  Product Owner        [HARD GATE: approval]
BA  ──approved spec──▶  Architect
Architect  ──design + ADRs──▶  Product Owner   [HARD GATE if architectural]
Architect  ──approved design──▶  BA
BA  ──issues + acceptance criteria──▶  Engineer
Engineer  ──implementation──▶  QA
QA  ──verdict──▶  Product Owner           [HARD GATE: merge]
QA  ──defects──▶  Engineer                [loop until clean]
```

### Handoff payloads

| Handoff | Must include |
|---|---|
| BA → Architect | Approved spec, open questions, constraints |
| Architect → BA | Design decisions, ADR references, technical constraints |
| BA → Engineer | Issue, acceptance criteria, spec reference, out-of-scope note |
| Engineer → QA | PR link, what changed, how to run it, **pasted test output against the PR head**, deviations from spec and why |
| QA → Engineer | Failing criterion, reproduction, expected vs actual (as a PR comment or `DEF-NNN` issue) |
| QA → PO | Criteria met/unmet, **pasted output of QA's own run**, risks accepted, recommendation |

A handoff that asserts a result without the output is rejected. See
[operating-model.md](../process/operating-model.md).

## Escalation

Any role escalates to the Product Owner rather than guessing when it hits:

- Ambiguity in the spec that changes behaviour
- A trade-off between two stated requirements
- Anything touching real player data or GDPR
- Scope that appears to have grown
- A spec that appears wrong once implementation has begun

**Escalation is success, not failure.** An agent that escalates has caught
something at the cheapest possible moment. This is stated in every role charter
because the default agent behaviour is to guess confidently instead.

## Running the squad

These roles map to subagents. Two modes:

**Sequential (default).** One role at a time, output reviewed between steps.
Slower, maximum visibility — start here while you're learning the model.

**Orchestrated.** A workflow runs several agents with defined handoffs, and you
review at the gates. Faster, less visible. Move here once you trust the
handoffs. Requires explicit opt-in — it can spawn many agents and consume
significant budget, so it never happens implicitly.

Given the educational goal, sequential is the right default. You see each
handoff, which is where the model is actually learned.
