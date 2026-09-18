# Android Coaching App — Knowledge Base

## Start here

**New to this project, or want to know how it is run?** Read
[HOW-THIS-IS-BUILT.md](./HOW-THIS-IS-BUILT.md) — an outward-facing account of the
agent squad, the approval gates, and what has gone wrong as well as right.


The working memory of this project. Agents have no institutional memory between
sessions; this is where it lives instead.

**If you read one thing first:** the
[Primer](./kb/01-primer-spec-driven-agentic-delivery.md).

---

## Start here

| If you want to... | Read |
|---|---|
| Understand the operating model | [Primer](./kb/01-primer-spec-driven-agentic-delivery.md) |
| Know who does what | [Squad roles](./roles/README.md) |
| Know how work flows | [Delivery process](./process/README.md) |
| Understand what we're building | [Specifications](./specs/) |
| Know why a technical choice was made | [Decision log](./decisions/README.md) |
| Look up a term | [Glossary](./kb/02-glossary.md) |
| Set up GitHub | [GitHub setup](./SETUP-GITHUB.md) |
| Understand the site and metrics plan | [Site & metrics](./process/site-and-metrics.md) |

---

## Map

```
docs/
├── README.md                    ← you are here
├── kb/
│   ├── 01-primer-...            The operating model, and how to prompt well
│   └── 02-glossary.md           Terms, domain and process
├── roles/
│   ├── README.md                Squad structure, handoffs, escalation
│   ├── business-analyst.md      Specs, issues, acceptance criteria
│   ├── architect.md             Design, ADRs, domain integrity
│   ├── engineer.md              Implementation
│   └── qa.md                    Adversarial verification
├── process/
│   ├── README.md                Delivery workflow and gates
│   └── site-and-metrics.md      Deterministic site build, metrics model
├── specs/
│   ├── 01-domain-model.md       Entities and relationships
│   ├── 02-match-engine.md       Clock, quarters, minutes attribution
│   └── 03-fairness-ledger.md    Season-scoped fair play time
├── decisions/
│   └── README.md                ADR index
└── issues/
    ├── issues.json              Requirement issues, ready to create
    └── create-issues.sh         One-shot import script
```

---

## The product, in one paragraph

A coaching app for junior football. Build a squad (first names only, for GDPR),
set up a match of configurable length in equal quarters, assign players to
positions in a customisable format (7-a-side today), run the clock, manage
substitutions with alerts when a sub is due, and track playing time so that
**every player gets a fair share of pitch time across the season** — with an
audit trail solid enough to settle a disagreement with a parent.

---

## The five things that must stay true

Decisions with reasoning behind them. Breaking any one silently undermines the
product.

1. **Minutes are derived from intervals, never stored as running totals.**
   Guarantees the displayed figure and the audit trail cannot disagree.

2. **Elapsed time comes from wall-clock anchors, never tick counting.**
   Android throttles background timers; counting ticks silently loses minutes.

3. **Fairness is total playing time, never per position.**
   Position affinities are deliberate coach policy. Measuring them would flag
   the coach's own selections as anomalies.

4. **First names only. No PII.**
   Children's data. The model makes adding PII awkward by design.

5. **Corrections are explicit, noted, and never destructive.**
   An audit trail that can be silently edited is not an audit trail.

---

## Current state

**Phase:** specification. No code yet — deliberately.

| Area | Status |
|---|---|
| Domain model | Spec drafted, awaiting PO approval |
| Match engine | Spec drafted, awaiting PO approval |
| Fairness ledger | Spec revised after PO correction, awaiting approval |
| Squad roles | Defined |
| GitHub | Blocked — needs laptop link, see [setup](./SETUP-GITHUB.md) |
| Implementation | Not started |

**Waiting on the Product Owner:**

- Approve the three specs
- Open questions at the foot of each spec
- GitHub access, so issues can be created

---

## Conventions

- **Specs** describe behaviour, not implementation. Status: Draft / Approved / Superseded.
- **ADRs** are immutable. Superseded, never edited.
- **Issues** trace to a spec and carry testable acceptance criteria.
- **Cross-references** are relative links, so they work in GitHub, in VS Code,
  and in the generated site.
- **This KB is authored by hand (or by agents) in markdown.** The site is built
  from it deterministically — never generated on demand.
