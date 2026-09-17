# Glossary

Shared vocabulary. Ambiguous terms are where misunderstandings start, so
definitions here are authoritative for this project.

---

## Domain terms

**Appearance**
A single continuous interval during which one player occupied one position. The
atomic, auditable unit from which all minutes are derived. Closed by a
substitution, position change, quarter end, or match end.

**BenchStint**
The bench equivalent of an Appearance. Recorded explicitly rather than inferred
by subtraction, so that errors surface instead of hiding.

**Fairness balance**
`actual outfield minutes − expected outfield minutes`, per player per season.
Negative means the player is owed time. **Position-independent** and **excludes
goalkeeper minutes**.

**Expected minutes**
A player's fair share, accrued only for matches where they were *available*. An
absent player is not owed the minutes they missed.

**Position affinity**
A player's preferred position(s), primary or secondary. Constrains team-sheet
*suggestions* only — never fairness arithmetic, and never a constraint on manual
assignment.

**Format**
A match shape: on-field count plus an ordered position list. 7-a-side is the
current default; the model is customisable.

**Quarter**
One of the equal periods a match divides into (4 by default). Ends with a hard
stop of the clock.

**Hard stop**
A point where the clock stops automatically — quarter end or match end. Distinct
from the manual pause, which is an exception control.

**Correction**
An after-the-fact edit to an Appearance. Requires a mandatory note, preserves
the original values, and is flagged in the ledger.

**Short-handed**
A match played with fewer available players than the format's on-field count.
Recorded, and adjusts the expected-minutes arithmetic.

---

## Process terms

**Spec-driven development**
An approach where the specification is the primary authored artefact and code is
derived from it. The spec is reviewed and approved before implementation.

**Acceptance criteria**
Objectively verifiable statements defining done for an issue. True or false —
never a matter of judgement.

**ADR (Architecture Decision Record)**
A short, dated, immutable record of a technical decision: context, decision,
consequences, alternatives. Superseded by a new ADR, never edited.

**Hard gate**
A point where work stops until a human approves. Placed where errors are
expensive or irreversible.

**Soft gate**
A review that happens but does not block progress.

**Escalation**
An agent raising a question rather than guessing. **A success signal, not a
failure** — it means a misunderstanding was caught at the cheapest moment.

**Handoff**
Passing work between roles with a defined payload. A handoff missing its payload
is rejected, not guessed at.

**Traceability**
The chain brief → spec → issue → criteria → test → code. Lets any behaviour be
traced back to a stated intent.

---

## Agentic terms

**Agent**
An AI instance with a defined role, context and boundaries. Here: BA, Architect,
Engineer, QA.

**Subagent**
An agent spawned by another to perform a scoped task, returning a result. Starts
with no prior context.

**Skill**
Packaged, reusable instruction for a *kind* of work — distinct from a spec,
which describes *what* to build. Skills are stable and cross-project; specs are
project-specific and volatile.

**Context**
The information available to an agent in a session. Finite, and does not persist
between sessions — which is why the KB exists.

**Context resets**
The fact that agents begin each session with no memory of previous ones.
Institutional memory must live in artefacts or it does not exist.

**Orchestration**
Running multiple agents with defined handoffs, rather than one at a time.
Faster, less visible; requires explicit opt-in.

**Adversarial verification**
Verification by an agent that did not produce the work and does not share its
reasoning. The independence is the point.

---

## Technical terms

**Wall-clock anchor**
Storing a start timestamp and deriving elapsed time as `now − start`, rather
than incrementing a counter. Survives backgrounding, screen lock and process
death — the reason the clock is trustworthy.

**Tick counting**
Incrementing a counter on a timer callback. **Explicitly forbidden here**:
Android throttles background JS timers, so ticks are silently lost and the
fairness ledger is corrupted.

**Pure function**
A function whose output depends only on its inputs, with no side effects. The
match engine is written this way so it can be tested without a device and ported
without rewriting.

**Derived value**
A value computed from source data rather than stored. All minute totals are
derived, which is what makes them impossible to desynchronise from the audit
trail.

**Append-only**
A record that is added to but not rewritten. Appearances are append-only;
corrections add a correction record rather than mutating history.
