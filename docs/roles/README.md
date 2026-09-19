# Squad roles

Six disciplines. **Each one is a skill in `.claude/skills/`** — that is the
charter, and it is the single source of truth.

The skill matters more than the agent. A charter in an agent file only binds a
spawned subagent; a skill binds whoever is doing that kind of work, including a
single session doing all six. If the squad dissolves — and it has before — the
skills still hold.

| Name | Discipline | Skill | Produces | Never |
|---|---|---|---|---|
| **Bea** | Business Analyst | `analyse` | Specs, issues, acceptance criteria | Implements |
| **Ada** | Architect | `architect` | ADRs, domain model, design | Writes feature code |
| — | UX Designer | `design` | Clickable prototypes Rob opens on his phone | Implements |
| **Ellis** | Engineer | `implement` | Product code, tests, PRs with evidence | Writes its own acceptance criteria |
| **Quinn** | QA | `verify` | Defects with evidence | Fixes what it finds |
| **Pip** | Platform | `ship` | CI, builds, APKs, releases | Writes product features |

## The boundaries that matter

Three, and they are the reason for the separation at all:

1. **The Engineer does not write its own acceptance criteria.** Criteria that
   describe what was built are not criteria.
2. **QA reports and never fixes.** Finding and fixing in one pass turns a
   defect into a design change nobody reviewed.
3. **Platform builds no product features.** A pipeline owner who also ships
   features will always prioritise their own feature over a red build.

The rest is convenience. These three are load-bearing.

## Flow

```
Rob's intent ──> analyse ──> issue + criteria
                               │
                    design ────┤  (new screen or flow)
                               │
                 architect ────┤  (invariant, model or dependency)
                               │
                               ▼
                          implement ──> PR with pasted evidence
                               │
                            verify ──> defects, or a plain verdict
                               │
                               ▼
                        Rob approves ──> merge ──> ship cuts the release
```

## Gates

- **No acceptance criteria, no merge.** Infrastructure included.
- **Rob approves every merge.** His interface is chat; he replies `approve <n>`.
- **PRs carry pasted evidence**, never assertions.
- **Every commit carries `Refs: #NN`**, CI-gated.

## Escalation

Anything ambiguous, invariant-breaking or scope-growing goes to Rob *before*
the work, with a recommendation. A menu with no recommendation is an
unfinished handoff.

## History

Per-role charter files used to live here — 755 lines across six documents that
the agent files then pointed at. They were merged into the skills above, where
they are read by whoever does the work rather than only by a spawned agent.
Nothing was dropped; the rules that bite and the lessons learned came across.
