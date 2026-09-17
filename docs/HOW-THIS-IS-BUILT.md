# How this programme is run

An account of building a real application with a squad of AI agents under human
approval gates — written for people outside the project.

This is not a manifesto. It is a description of what is actually happening in
this repository, including the parts that have gone wrong.

---

## What is being built

A junior football coaching app. One coach, one squad of under-10s, one match a
week on a Saturday. It exists to answer a small, real question at the touchline:
*who should come off next, and is everyone getting a fair share of the game?*

It is a spare-time project. That constraint shapes everything below: the
bottleneck is not how fast agents can work, it is how fast one human can review
what they produce.

## The shape of the team

One human — Rob, the Product Owner. Five AI agents, each a separate role with its
own charter, context and boundaries.

| Name | Role | Owns | Never does |
|---|---|---|---|
| **Bea** | Business Analyst | Specs, issues, acceptance criteria | Write implementation code |
| **Ada** | Architect | Technical design, ADRs | Write feature code |
| **Ellis** | Engineer | Feature implementation | Write its own acceptance criteria |
| **Quinn** | QA | Adversarial verification | Fix what it finds |
| **Pip** | Platform Engineer | CI/CD, builds, releases | Write product features |

See [`roles/squad.md`](./roles/squad.md) for the diagrams.

### Why five agents rather than one

A single capable agent asked to specify, build and test will produce code that
passes its own tests — because it wrote both from a single interpretation. If
that interpretation is wrong, nothing catches it.

Separation creates disagreement. Quinn reads the *acceptance criteria*, not
Ellis's reasoning, and can therefore find that the criteria were not met. That is
the same principle as separating the person who deploys from the person who
approves: not about capability, about independence.

The boundaries are enforced by charter, and each exists because of a specific
failure it prevents:

| Boundary | The failure it prevents |
|---|---|
| Ellis never writes acceptance criteria | Code that passes because it set its own pass mark |
| Quinn never fixes | A verifier invested in its own fix stops looking |
| Bea never implements | A spec bent toward what is easy to build |
| Ada never approves its own ADR | A preference dressed as a decision |
| Pip never builds features | Build infrastructure becoming where product logic hides |

## How a decision gets made

Three hard gates where work stops until the human rules.

```
intent → spec (Bea) → ⟨PO approves⟩ → design + ADR (Ada) → ⟨PO approves⟩
       → build (Ellis, Pip) → verify (Quinn) → ⟨PO approves⟩ → merged
```

Decisions are put to the Product Owner **in conversation, before the work**, in a
fixed shape: what is being decided, the options with their consequences, **a
recommendation with reasoning**, the cost to reverse, what it unblocks, and a
link to the detail.

A menu without a recommendation is recorded as an unfinished handoff. The human
is there to rule, not to do the analysis.

Approval of finished work is one word in chat — `approve 40` — and the agent
merges. The human never touches the GitHub merge button.

**GitHub issues are the queue, not the interface.** They are where a decision
waits so it survives between sessions; they are not where it is made. Navigating
to a web UI, reading prose and typing a reply is high friction per decision, and
the human's response time is the binding constraint.

## Where decisions live

The rule that does the most work here: **a decision that exists only in a chat
log has not been made.**

| What | Where it lives |
|---|---|
| A decision waiting on the human | GitHub issue, labelled `decision-needed` |
| A technical decision, made | An ADR in `docs/decisions/` |
| What the product does | A spec in `docs/specs/` |
| How the programme runs | `docs/process/` |
| Why an alternative was rejected | Written into the same document, not deleted |

That last row matters more than it looks. When the human ruled against a
recommendation, the document records **both the accepted cost and the accepted
benefit**, so the argument is not re-run next session by an agent with no memory
of it.

Five invariants sit above everything, each backed by an ADR. They are not
preferences, and an implementation that would break one stops and escalates.

## What actually happened

The honest parts.

### The programme built a beautiful spine and nothing that ran

After several sessions the repository contained 4,245 lines of specification,
eleven architecture decision records, a 438-line match engine and 66 passing
tests. It also contained **zero lines of app code and no CI pipeline at all**.
`package.json` declared no runtime dependencies. There was no way to run
anything.

The Product Owner opened a session with:

> "I want to ensure we're not deviating from a thin slice goal, we've spent a lot
> of time on 'the spine' but not necessarily much moving towards production."

He was right, and the ratio proved it: seven lines of documentation for every
line of production code, and nothing a coach could hold.

The response was to measure it rather than argue, write a
[delivery-slices](./process/delivery-slices.md) document naming the six stages
between source and an app on a phone, and start closing them. Within one session
there was a signed, downloadable APK produced by CI on every pull request.

**The lesson is not "write fewer specs".** The engine's invariants have held
under every change since. It is that *a spine with nothing running on it cannot
be validated*, and the human noticed before the agents did.

### Evidence was on trust for far too long

The operating model required pull requests to "carry evidence" — pasted test
output. For weeks, that output was pasted by the same agent that wrote the code.
Nothing independently ran the tests. The rule was enforced by hand, on trust.

A CI gate now runs the test suite, the typechecker and the documentation
validator on every pull request. Pasted evidence remains the convention; it is
now corroborated rather than believed.

### An agent recommended over-engineering and was overruled

The Architect drafted an ADR for event schema versioning: version checks, a bump
taxonomy, golden fixtures per version, a compatibility contract. The orchestrating
agent walked the Product Owner through it and **recommended accepting it whole**.

He rejected it:

> "I have zero idea what this is about even with the walk through. In plain
> English what is the worry and what are we defending against? ... The coaching
> app really is for operational use ... All this other baloney feels a bit
> overkill."

He was right again. The apparatus defended against a rate of schema change a
one-coach app will never reach. What survived was a single line — stamp a version
number on each event — because that is the only part that cannot be added later.

Two things are worth drawing out. First, **the failure was the explanation**: an
agent using its own jargon ("an event written in season one must replay in season
three") rather than the human's reality ("you update the app and last month's
matches still add up"). Second, the reversal is recorded in the issue, so the
next session inherits the ruling rather than re-proposing the ADR.

### The human's throwaway remark reshaped a requirement

While rejecting the above, the Product Owner mentioned in passing that between
Tuesday training and the Saturday match, a teamsheet is shared with children and
parents so they can indicate absence.

No specification described this. The engine was about to gain a field for "the
available squad at match creation" — and this was the workflow that *produces*
that value. It was captured as a product note within minutes of being said.

**Agents cannot ask about what they do not know exists.** The most valuable
inputs arrive as asides, and the discipline is to notice and capture them.

### Specialisms turned out to be real

An Engineer spent five CI runs and about fifty minutes on Android build
infrastructure: an NDK failing to install mid-Gradle, a shell pipeline dying of
`SIGPIPE` under `pipefail`, `aapt2` changing its output format between
build-tools versions.

It handled all of it correctly, diagnosing each from the job log and dry-running
each fix against stubs before pushing. But none of it was feature work. The
Product Owner — a platform engineer by background — spotted the pattern and a
fifth role was created.

**Roles here are added when the evidence demands one, not designed up front.**

### Agents found defects before any code was written

Asked to draft acceptance criteria for an engine rewrite, the Business Analyst
ran the existing engine against every match configuration rather than reasoning
about it. It found six accepted-but-invalid configurations beyond the two already
known — including one that silently produced a match with **zero** periods.

Separately, QA had earlier found that a duration check passed when one interval
was one millisecond too long and another one millisecond too short. Two
offsetting errors that every aggregate check misses. The fix — a per-player
identity — was written into the criteria before implementation began.

## What is still weak

Stated plainly, because a programme that only reports its successes is not
being audited.

- **The approval gate is a convention, not an enforcement.** GitHub attributes
  every commit, pull request and comment to the human's own account. Nothing at
  the platform level distinguishes agent work from human work or enforces the
  gate. A `Squad-Role:` commit trailer is the only marker, and it is added
  voluntarily. Formalising this — bot identities, CODEOWNERS, branch protection —
  is [tracked](https://github.com/vanstoner/coaching-app/issues/38) and deferred.
- **There is no path for a decision that arrives between sessions.** The
  interface works while a session runs. Overnight CI has nowhere to put a ruling.
- **A green build proves compilation, not behaviour.** The pipeline builds,
  signs and asserts an APK. Every one of those assertions would pass on an app
  that shows a blank screen. An emulator smoke test is
  [raised](https://github.com/vanstoner/coaching-app/issues/43) and not yet built.
- **Nothing has run on real hardware.** At the time of writing, no human has
  installed the app.
- **Parallelism is constrained by one branch.** Two agents were briefly run as
  parallel lanes; they must share a single branch in this environment, so they
  were sequenced instead.

## What has transferred

Things that are not specific to AI agents, and would improve a human team.

1. **Write the rejected alternative down, with its cost.** Most re-litigation is
   caused by the loser of an argument being deleted rather than recorded.
2. **Make the pass mark someone else's job.** Whoever builds should not define
   what "done" means.
3. **Measure the complaint before answering it.** "We have too many specs" became
   actionable the moment it became "4,245 lines of docs, 0 lines of app".
4. **A gate that arrives with the work cannot guard the work.** The CI gate was
   landed *before* the large rewrite it was meant to protect, deliberately.
5. **Proportionality is a decision, and it needs recording.** "This is a
   substitution reminder, not audit-grade timing" is now written into the project
   instructions, and it has stopped three separate pieces of over-engineering.
6. **Ask what the person actually does on a Saturday.** The most useful
   requirement in this repository arrived as an aside.

---

*This document describes the programme, not the product. For the product, start
with [`specs/01-domain-model.md`](./specs/01-domain-model.md). For how work
reaches `main`, see [`process/operating-model.md`](./process/operating-model.md).*
