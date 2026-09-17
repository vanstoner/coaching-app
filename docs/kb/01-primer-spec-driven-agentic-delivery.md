# Primer — Spec-Driven Development with an Agentic Squad

Audience: Rob — Director of Engineering, DevOps/platform specialism, hands-on by choice
Purpose: the operating model, why it works, and how to drive it
Last updated: 2026-09-17

---

## 1. Why spec-driven development matters *more* with agents, not less

You already know the classic argument for specs: shared understanding, fewer
rewrites, a testable definition of done. All still true. But agentic delivery
changes the economics in a way worth being precise about.

**With human teams, the expensive resource is implementation.** Specs are
overhead you tolerate because rework is costlier. Hence the industry's drift
toward lighter documentation — the spec was a tax on the scarce resource.

**With agents, implementation is cheap and context is the scarce resource.** An
agent will produce a plausible implementation of almost anything in minutes. The
bottleneck moves entirely to *specifying the right thing* and *verifying you got
it*. The spec stops being overhead and becomes the primary artefact — the thing
you actually author.

This inverts a habit. Your instinct from leading human teams is probably to give
outcomes and trust the team on detail. With agents, under-specification doesn't
produce a thoughtful question — it produces confident, wrong output that looks
right.

**The failure mode to internalise:** an agent never says "this requirement is
ambiguous, which did you mean?" unless the ambiguity is stark. It picks an
interpretation and builds it convincingly. Your fairness correction earlier is
the live example — I'd built position-level fairness from a reasonable reading,
and it was wrong. The cost of that was three specs and six issues. Had it
reached code, it would have been the domain model, the ledger, the planner and
their tests.

**The lesson generalises:** with agents, the cost of a misunderstanding scales
with how long it goes undetected, and agents detect their own misunderstandings
poorly. Specs are how you surface them early — they're cheap to review and
cheap to correct.

---

## 2. The three-layer model

Think of it as a control plane over a delivery plane — a structure that should
feel familiar.

```
┌──────────────────────────────────────────────┐
│  INTENT        What and why                  │  ← you own this
│  Product brief, priorities, trade-off calls  │
└──────────────────────────────────────────────┘
                      ↓
┌──────────────────────────────────────────────┐
│  SPECIFICATION  How, precisely               │  ← you review, BA drafts
│  Specs, acceptance criteria, ADRs            │
└──────────────────────────────────────────────┘
                      ↓
┌──────────────────────────────────────────────┐
│  IMPLEMENTATION  Code, tests, docs           │  ← agents own, QA verifies
└──────────────────────────────────────────────┘
```

**The rule that makes it work: information flows down, questions flow up.**

An agent that hits ambiguity at the implementation layer must escalate rather
than invent. Getting this behaviour reliably is a prompting discipline — see §5.

**Where your time goes.** In a healthy run you spend roughly 70% at Intent, 25%
reviewing Specification, and 5% at Implementation — mostly reviewing diffs and
unblocking. If you find yourself deep in implementation regularly, something
upstream was underspecified. Treat that as a signal about the spec, not the
code.

---

## 3. The artefacts and what each is for

| Artefact | Answers | Owner | Changes when |
|---|---|---|---|
| **Product brief** | Why does this exist? | You | Strategy shifts |
| **Spec** | How should it behave? | BA drafts, you approve | Requirements clarified |
| **ADR** | Why this technical choice? | Architect | A decision is made or reversed |
| **Issue** | What's the next unit of work? | BA | Work is planned |
| **Acceptance criteria** | How do we know it's done? | BA, QA verifies | Spec changes |
| **Test** | Does it actually behave that way? | QA | Behaviour changes |
| **Code** | The thing itself | Engineer | Constantly |

**The chain that gives you traceability:**

```
Brief → Spec → Issue → Acceptance criteria → Test → Code
```

Every line of code should trace back to a stated intent. In practice this means
when you ask "why does the app do X?", the answer is a document, not an
archaeology expedition through commits.

**ADRs deserve a specific mention** given your platform background — they're
the same discipline you'd apply to infrastructure choices. Short, dated,
immutable: context, decision, consequences. You don't edit an ADR when you
change your mind; you write a new one superseding it. The value is that in six
months you can reconstruct *why* the clock uses wall-clock anchors, without
relying on anyone's memory.

---

## 4. Where the human checkpoints go

Agents can run a long way unsupervised. The question is where you *want* to be
in the loop — too many gates and you're the bottleneck; too few and you discover
divergence late.

**Hard gates — always human:**

| Gate | Why |
|---|---|
| Spec approval | Cheapest possible place to catch a misunderstanding |
| Architectural decisions (ADRs) | Expensive and slow to reverse |
| Scope changes | Only you can trade scope against time |
| Anything touching real player data | GDPR consequences are yours |
| Merge to main | Standard, and keeps you seeing the shape of the codebase |

**Soft gates — review async, don't block:**

- Implementation approach within an approved spec
- Test additions
- Refactoring with no behaviour change
- Documentation updates

**No gate — let it run:**

- Formatting, linting, dependency bumps within a major version
- Agent-to-agent handoffs inside one issue

**The principle:** gate on *irreversibility and cost-to-correct*, not on risk of
being wrong. Agents are wrong constantly; most of it is cheap. Gate the
expensive wrongness.

---

## 5. How to prompt better — the practical part

### 5.1 State the decision, not just the goal

Weak: *"Make the fairness tracking good."*

Strong: *"Fairness is total playing time, not per position. Players have
position affinities I assign deliberately, so per-position fairness would flag
my own selections as anomalies."*

The second gives a rule *and* the reasoning. The reasoning matters more than it
might seem — it lets an agent extrapolate correctly to cases you didn't mention.
Given the reasoning above, an agent can work out on its own that a "never played
striker" flag is unwanted. Given only the rule, it might not.

**Heuristic:** include the *because*. It's the difference between an agent that
follows instructions and one that shares your intent.

### 5.2 Correct at the right layer

When output is wrong, ask which layer failed:

- **Wrong behaviour, spec was right** → implementation bug, cheap fix
- **Wrong behaviour, spec was also wrong** → fix the spec first, then regenerate
- **Spec is right but I've changed my mind** → intent change; expect rework and say so

Correcting at the code layer when the spec is wrong is the expensive mistake:
you get a patched implementation that contradicts its own documentation, and the
next agent to read the spec reintroduces the bug.

Your fairness correction was handled at the spec layer, which is why it cost one
rewrite rather than a codebase of contradictions.

### 5.3 Ask for the disagreement

Agents skew agreeable. Counter it explicitly:

> *"Before you build this, tell me what's wrong with it."*
> *"What would a sceptical architect say about this design?"*
> *"What am I likely to regret in six months?"*

Also useful: *"What did I not specify that you had to guess?"* — it surfaces
assumptions that would otherwise be silently baked in.

### 5.4 Separate generation from verification

Never let the same context that produced something be the only thing that
checks it. An agent reviewing its own output is reliably generous about it.

This is the whole reason QA is a separate role in your squad rather than a step
the Engineer performs. Separation of concerns, for the same reason you'd
separate the deployer from the approver.

### 5.5 Make verification concrete

Vague: *"Test the fairness calculation."*

Concrete: *"Two players with identical total minutes in entirely different
positions must produce identical fairness balances. Assert it."*

A worked example with real numbers is worth more than a paragraph of
description — it's unambiguous, and it becomes a test directly. The worked
example in spec 03 exists precisely so it can be lifted into the test suite.

### 5.6 Anti-patterns worth naming

| Anti-pattern | Why it hurts | Instead |
|---|---|---|
| "Make it better" | No definition of better | Name the property you want improved |
| Approving without reading | Gate exists but does nothing | Read it or drop the gate honestly |
| Correcting in chat only | Correction doesn't persist to the artefact | Update the spec too |
| One giant prompt | Agent optimises the last instruction | One concern per exchange |
| Trusting a confident tone | Confidence isn't correlated with correctness | Ask for the uncertainty |

---

## 6. Skills — and where they fit

A **skill** is packaged, reusable instruction: a procedure an agent loads when a
task matches. The distinction that matters for you:

- **Spec** = what to build (project-specific, changes constantly)
- **Skill** = how to do a kind of work (reusable, stable across projects)

Your platform instinct is the right one: a skill is closer to a module in a
shared library than to a runbook for one system. Good candidates here:

| Skill | What it standardises |
|---|---|
| `write-spec` | House format for specs, mandatory sections, acceptance criteria style |
| `write-adr` | ADR template and the bar for what warrants one |
| `review-code` | Your review checklist, applied consistently |
| `create-issue` | Issue format, labels, milestone conventions |
| `domain-primer` | Football coaching domain context every agent should share |

**The test for whether something should be a skill:** have you explained it more
than twice, and will you need it again? If yes, it's a skill. If it's specific
to this one feature, it's a spec.

**Worth flagging:** skills are where inconsistency creeps in most quietly. Four
agents each inventing their own spec format produces four incompatible
documents, and you won't notice until you try to read them as a set. A skill is
how you enforce a house style without re-stating it every time.

---

## 7. Your operating model, concretely

A normal cycle:

```
1.  You state intent                      "I want X, because Y"
2.  BA drafts a spec                      Questions asked, ambiguities flagged
3.  YOU APPROVE THE SPEC                  ← hard gate, cheapest correction point
4.  Architect reviews approach            ADR if a real decision is involved
5.  BA writes issues + acceptance criteria
6.  Engineer implements against the spec
7.  QA verifies against acceptance criteria — adversarially, separate context
8.  YOU REVIEW AND MERGE                  ← hard gate
9.  KB and metrics update
```

**Your weekly rhythm**, given this is spare-time work:

- **Session start:** read what changed, approve or correct pending specs
- **Mid-session:** answer escalated questions — these are the highest-value
  minutes you spend, since each one prevents a wrong branch
- **Session end:** review what shipped, set next priority

**Signals something is off:**

| Signal | Likely cause |
|---|---|
| You're debugging implementation regularly | Specs are underspecified |
| Agents rarely ask questions | They're guessing; prompt for escalation explicitly |
| QA never finds anything | QA isn't adversarial enough, or shares too much context with the Engineer |
| Specs drift from code | Missing the "update the spec" step after corrections |
| You approve without reading | Too many gates — remove some honestly rather than rubber-stamping |

---

## 8. What's genuinely different from leading a human team

Worth stating plainly, because the analogy misleads in specific places.

| | Human team | Agentic squad |
|---|---|---|
| Ambiguity | Surfaces as a question | Surfaces as confident wrong output |
| Context | Accumulates across time | Resets; must be re-supplied |
| Consistency | Drifts slowly | Drifts instantly without shared instruction |
| Cost of a retry | High — morale, time | Near zero |
| Institutional memory | In people's heads | Only in artefacts |
| Pushback | Given freely | Must be explicitly requested |

**The two that should change your behaviour most:**

**Retries are cheap.** With a human team you'd think hard before asking for a
rewrite. Here, "throw that away and try a different approach" costs minutes. You
can afford to explore options you'd never have commissioned from people.

**Institutional memory lives only in artefacts.** There's no one who "just
knows" why the clock works the way it does. If it isn't written down, it's gone
at the end of the session. This is why the KB isn't documentation overhead —
it's the squad's entire memory. Underinvesting in it is the single most
expensive mistake available to you in this model.

---

## 9. Where this goes next

The obvious extension of what you're building here: this operating model is
itself a product. The metrics layer you've asked for — squad health, delivery
performance — is the beginning of an evidence base for how agentic delivery
actually performs, which is a question your day job will be asking within a
year or two.

Worth keeping notes on what breaks, not just what ships. The failure modes will
be more instructive than the successes.

---

## Related documents

- [Squad roles and charters](../roles/README.md)
- [Delivery process](../process/README.md)
- [Decision log (ADRs)](../decisions/README.md)
- [Specifications](../specs/)
- [Glossary](./02-glossary.md)
