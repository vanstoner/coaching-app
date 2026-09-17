# Session Handoff — read this first

You are picking up the Android Coaching App project from a Cowork session that
ran on 2026-09-17. This file is the complete context transfer. Read it, then
read `docs/README.md`.

**Product Owner:** Rob — Director of Engineering, DevOps/platform specialism,
not a full-time developer, working on this in spare time. Acting as Product
Owner with human-in-the-loop approval at defined gates.

---

## Where things stand

**Phase:** Specification complete, awaiting Product Owner approval. **No
application code exists yet — deliberately.**

| Area | Status |
|---|---|
| Domain model spec | Drafted, awaiting approval |
| Match engine spec | Drafted, awaiting approval |
| Fairness ledger spec | Drafted (revised once), awaiting approval |
| 5 ADRs | Written, accepted |
| Squad role charters | Defined (BA, Architect, Engineer, QA) |
| Delivery process | Defined |
| 12 requirement issues | Written in `docs/issues/issues.json`, **not yet created on GitHub** |
| Git repo | Committed locally, **never pushed** |
| Implementation | Not started |

---

## Immediate next actions

**1. Push the repo.** It has one commit and no remote.

```bash
gh repo create coaching-app --private --source=. --push
```

Private matters — this is children's-data-adjacent. `.gitignore` already blocks
squad data patterns.

**2. Create the issues.**

```bash
bash docs/issues/create-issues.sh
```

Creates 11 labels, 2 milestones (MVP, Post-MVP) and 12 issues. Re-runnable —
skips anything that already exists. `DRY_RUN=1` to preview.

**3. Ask the Product Owner** to approve the three specs and answer the open
questions at the foot of each. The blocking ones are in spec 03.

**4. Then build** the match engine (TECH-02) — pure TypeScript, no React
dependency, full test suite. It can be verified without a device.

---

## The five invariants — do not break these

Each is an ADR in `docs/decisions/`. They are not style preferences; each one is
load-bearing for the product's defensibility.

1. **Minutes are derived by folding intervals, never stored as running totals.**
   Guarantees the displayed figure and the audit trail cannot disagree.
   (ADR-003)

2. **Elapsed time comes from wall-clock anchors, never tick counting.**
   Android throttles background JS timers; a tick counter silently loses
   minutes and corrupts the fairness ledger. (ADR-002)

3. **Fairness is total outfield playing time, never per position.**
   The coach assigns positions deliberately by player affinity. Per-position
   measurement would flag his own selections as anomalies. (ADR-004)

4. **First names only. No PII.** Children's data. A 2-character disambiguation
   suffix exists so it cannot become a surname field by convention.

5. **Corrections are explicit, noted, and never destructive.** An audit trail
   that can be silently edited is not an audit trail.

---

## Product Owner decisions, in his own words

Quote these when they matter — they are the authority for the specs.

**On fairness scope:**
> *"Fairness wasn't supposed to be per position, just total playing time. We are
> likely to lock players into certain positions or a couple of positions so
> their distribution will be higher into those affinities."*

**On season-long fairness:**
> *"Each outfield player gets equal allocation of time over a multi-match period
> or season. This will allow us to fix anomalies, data will need to be recorded
> and observed for fairness and dispute arbitration."*

**On the clock:**
> *"I think continuously because chances are until a hard stop (e.g. quarter
> end) it will be difficult to reliably stop the clock, too much other stuff
> going on. Alarms for subs should take into account any stoppage that happens
> but the risk is the ref and the coach may not reliably stop the clock."*

**On goalkeeper time:** keep GK out of the fairness measure entirely.

**On position time:** track it and report it, but never flag it.

**On the docs site:**
> *"I don't want pages to always have to be generated on demand, there should be
> some deterministic routine to convert the markdown into a site. The site will
> also show metrics on squad health, delivery performance etc so this will grow
> into an analytics."*

---

## One correction already made — learn from it

The first draft of the fairness ledger measured equity **per position** and
included anomaly flags for uneven position distribution. The Product Owner
corrected it: fairness is total playing time only.

This cost three specs and six issues to fix. Had it reached code it would have
been the domain model, the ledger, the planner and their tests.

**The lesson for you:** when the spec is ambiguous, escalate rather than
choosing. An ambiguity resolved by a confident guess is the most expensive
failure mode in this project.

---

## Open questions awaiting the Product Owner

**Spec 01 — domain model**
1. Can a player appear for more than one squad in a season?
2. Record match results (score), or out of scope for MVP?
3. Does the arbitration export need to be human-readable (PDF/CSV), or is
   on-screen review enough?

**Spec 02 — match engine**
1. Support extra time / a fifth period, or are 4 quarters fixed?
2. When a quarter overruns (ref plays 12 minutes of a 10-minute quarter), does
   the extra count toward fairness? (Recommendation: yes — it was played.)

**Spec 03 — fairness ledger** *(these block implementation)*
1. Should the app flag a player keeping goal every week, or stay silent?
2. Is CSV/print export needed for MVP?
3. Should there be a minimum minutes-per-match floor, independent of the season
   balance?

**Process**
1. Public or private docs site?
2. Metrics collection on a schedule, or only on merge?
3. Should the KB stay coaching-app specific, or be generalised for reuse?

---

## How this project works

Spec-driven development with an agentic squad. Four roles, each a separate agent
with its own charter in `docs/roles/`:

| Role | Owns | Never does |
|---|---|---|
| Business Analyst | Specs, issues, acceptance criteria | Writes code |
| Architect | Design, ADRs, domain integrity | Writes feature code |
| Engineer | Implementation | Writes its own acceptance criteria |
| QA | Adversarial verification | Fixes what it finds |

**Hard gates (human approval required):** spec approval, ADR approval, merge.

**The separations that matter:** the Engineer doesn't write its own acceptance
criteria; QA doesn't fix what it finds; the BA doesn't implement. Each exists to
preserve independent verification.

Full process in `docs/process/README.md`. The reasoning behind the whole model
is in `docs/kb/01-primer-spec-driven-agentic-delivery.md` — worth reading if you
want to understand *why* it's shaped this way.

**Run sequentially, not orchestrated**, unless the Product Owner asks
otherwise. He wants visibility into each handoff for learning purposes, not just
throughput.

---

## Tech stack (ADR-001)

React Native + Expo, TypeScript strict mode. Android first, iOS aspirational but
not committed — avoid gratuitously Android-only choices, but don't pay
significant complexity cost for portability that may never be exercised.

The match engine must be **pure TypeScript with no React or platform
dependencies**, so it can be tested without a device and ported without a
rewrite.

---

## Suggested skills (scoped, not yet built)

The Product Owner wants these partly for educational value:

| Skill | Standardises |
|---|---|
| `write-spec` | House spec format, mandatory sections, criteria style |
| `write-adr` | ADR template and the bar for what warrants one |
| `review-code` | Review checklist applied consistently |
| `create-issue` | Issue format, labels, milestone conventions |
| `domain-primer` | Football coaching domain context for every agent |

Test for whether something should be a skill: explained more than twice, and
needed again.

---

## Repository map

```
README.md                      Repo front page
HANDOFF.md                     This file
.gitignore                     Blocks squad data from being committed
docs/
├── README.md                  KB entry point and map
├── SETUP-GITHUB.md            GitHub setup guide
├── kb/
│   ├── 01-primer-...          The operating model and prompting guidance
│   └── 02-glossary.md         Domain, process and agentic vocabulary
├── roles/                     Four role charters + squad structure
├── process/
│   ├── README.md              Workflow, gates, escalation
│   ├── site-and-metrics.md    Deterministic site build, metrics model
│   └── validate-docs.py       Docs validator — run it, it gates CI
├── specs/
│   ├── 01-domain-model.md
│   ├── 02-match-engine.md
│   └── 03-fairness-ledger.md
├── decisions/                 ADRs 001–005 + index
└── issues/
    ├── issues.json            12 issues ready to create
    └── create-issues.sh       Import script (re-runnable)
```

Validate the docs at any time:

```bash
python3 docs/process/validate-docs.py
```

Checks internal links resolve, ADRs are well-formed, and no spec has sat in
Draft too long. Exits non-zero on failure.

---

## Notes on working with this Product Owner

- Technical, platform/DevOps background, leadership role. Skip fundamentals;
  he's fluent in delivery and infrastructure.
- Explicitly wants to learn the agentic operating model, not just ship. Explain
  the *why* behind design choices.
- Values being told when something is wrong. He caught the fairness error
  himself — he reads carefully and pushes back.
- Spare-time project. Respect the constraint: his escalation-response time is
  the real bottleneck, not agent throughput.
