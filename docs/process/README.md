# Delivery Process

How work moves from intent to merged code, and where you sit in it.

---

## The cycle

```
1.  Product Owner states intent
         │
2.  BA drafts spec ───────────── questions escalated back to PO
         │
3.  ╔═══ PO APPROVES SPEC ═══╗   ← HARD GATE
         │
4.  Architect reviews design ─── ADR written if significant
         │
5.  ╔═══ PO APPROVES ADR ════╗   ← HARD GATE (if architectural)
         │
6.  BA writes issues + acceptance criteria
         │
7.  Engineer implements ──────── escalates rather than guessing
         │
8.  QA verifies adversarially ── defects loop back to Engineer
         │
9.  ╔═══ PO REVIEWS & MERGES ╗   ← HARD GATE
         │
10. KB and metrics update
```

---

## The gates

**Hard gates — work stops:**

| Gate | What you're checking |
|---|---|
| Spec approval | Does this describe what I actually want? |
| ADR approval | Am I happy to live with this, knowing it's expensive to reverse? |
| Merge | Does this do what was asked, and do I understand the shape of it? |

**Soft gates — review without blocking:**

- Implementation approach inside an approved spec
- Test additions
- Documentation updates

**No gate:**

- Formatting, linting, dependency patches
- Agent-to-agent handoffs within an issue

**The principle:** gate on *cost to correct*, not on *probability of error*.
Agents are wrong often; most of it is cheap. Gate the expensive wrongness.

---

## Reviewing a spec

The highest-leverage thing you do. Questions worth asking:

1. **Does this match what I meant?** Not "is it reasonable" — is it *right*?
2. **What has it assumed?** Look for detail you never supplied.
3. **What's missing?** Which cases aren't covered?
4. **Would two people read this the same way?**
5. **Are the acceptance criteria objectively checkable?**
6. **Have the open questions actually been answered?**

**Read the worked examples carefully.** They are where a misunderstanding
becomes concrete and visible. A spec's prose can hide an error; its arithmetic
cannot.

---

## Handling an escalation

An escalation is an agent saying "I don't want to guess." It is the process
working, not failing.

**Answer with the reasoning, not just the ruling.** Compare:

> *"Fairness is total time, not per position."*

> *"Fairness is total time, not per position — because I deliberately lock
> players into positions they suit, so per-position measurement would flag my own
> selection decisions as anomalies."*

The second lets the agent extrapolate correctly to cases you haven't considered.
The first has to be re-asked every time a new case comes up.

**Then make sure it reaches the spec.** An answer given only in chat is lost at
the end of the session. If it changes behaviour, it belongs in the document.

---

## Handling a wrong output

Diagnose which layer failed before correcting:

| Symptom | Layer | Action |
|---|---|---|
| Behaviour wrong, spec right | Implementation | Fix the code |
| Behaviour wrong, spec also wrong | Specification | Fix spec first, then regenerate |
| Spec right, you've changed your mind | Intent | New spec version; expect rework |

**Correcting code when the spec is wrong is the expensive error.** You get an
implementation that contradicts its own documentation, and the next agent to
read the spec faithfully reintroduces the bug.

---

## Definition of done

An issue is done when **all** hold:

- [ ] Every acceptance criterion objectively met
- [ ] Tests written and passing
- [ ] QA verified independently
- [ ] No unresolved escalations
- [ ] Spec updated if behaviour changed during implementation
- [ ] ADR written if a technical decision was made
- [ ] Product Owner has reviewed and merged

---

## Working sessions

Given this is spare-time work, sessions are the natural unit rather than sprints.

**Start of session**

1. Read what changed since last time
2. Clear the queue: pending escalations, specs awaiting approval
3. Set one priority

**During**

- Answer escalations promptly — they block work and are your highest-value minutes
- Resist going hands-on in implementation; it usually means something upstream
  was underspecified

**End of session**

1. Review what shipped
2. Make sure decisions made in conversation reached the documents
3. Note the next priority, so the next session starts with context

**The end-of-session documentation step is not optional.** Agents retain nothing
between sessions. A decision that exists only in a chat log is gone.

---

## Running the squad

**Sequential (default).** One role at a time, output reviewed between steps.
Maximum visibility — the right choice while you're learning the model, because
you see each handoff.

**Orchestrated.** Multiple agents with automated handoffs, you reviewing at the
gates. Faster, less visible. Requires explicit opt-in, since it can spawn many
agents and consume substantial budget.

Move to orchestration once you trust the handoffs — not before, or you lose the
thing you're trying to learn.
