# Coaching App Development Workflow — Session Plan

## What We Have

You've built a sophisticated **spec-driven, agentic delivery system** for your coaching app:

- **Domain Model (Spec 01):** Well-designed for auditability, GDPR compliance (first names only), and fairness tracking across a season. Status: **Draft for PO review**
- **Match Engine (Spec 02):** Clock mechanics, substitutions, quarter management. Status: needs review
- **Fairness Ledger (Spec 03):** Season-long balance tracking, prevents the trap of per-position fairness (which would flag the coach's own decisions as anomalies). Status: needs review
- **9 Acceptance-criterion-heavy requirements** tracked in GitHub issues
- **Five distinct agent roles** (Engineer, BA, Architect, QA, PO) with clear handoff points
- **Hard gates** on Spec approval, ADR approval, and PO merge review — things expensive to get wrong

This is excellent: you're not guessing, and decisions stay in documents where future agents can see them.

---

## The Best Workflow for This Session

Given the current state, the next session should follow this priority:

### Phase 1: Specification Approval (Your Gate)
**Goal:** Confirm specs are right before we build.

1. **Read Spec 01 (Domain Model)** — already staged ✓
   - Questions to ask yourself:
     - Does it capture your coaching reality?
     - The Appearance entity (audit unit) — is that the right grain?
     - The two open questions at the end — do they matter for MVP?

2. **Read Specs 02 & 03** (Match Engine, Fairness Ledger)
   - Match Engine: wall-clock vs tick-counting (the critical one)
   - Fairness: total outfield time, not per-position. Is that the rule you want?

3. **Decide:** Are these ready, or do they need iteration?
   - If ready → mark `Status: Approved by Product Owner` and we move to Phase 2
   - If not → note what's missing and we'll escalate to BA/Architect

### Phase 2: Issues & Acceptance Criteria (if specs approved)
**Goal:** Turn specs into testable stories.

1. **Review the existing 10 requirements** in `docs/issues/issues.json`
   - They're well-written with clear acceptance criteria
   - No bad ones, but check:
     - Do they match your priority?
     - REQ-06 (match events) is marked Post-MVP — that's right for now
     - REQs 01–05 and 07–09 are MVP scope

2. **Create GitHub issues** from the JSON
   - Script is ready: `bash docs/issues/create-issues.sh`
   - Or dry-run first: `DRY_RUN=1 bash docs/issues/create-issues.sh`

### Phase 3: First Implementation Sprint (Sequential)
**Goal:** Build and validate the match engine (pure TypeScript, no React yet).

The natural first build:
- **REQ-01: Match clock with quarter management**
  - This is the spine everything else hangs on
  - Wall-clock derivation, quarter management, time persistence
  - No UI yet — just the engine tests

Then in sequence:
- REQ-02: Assign players to positions (model + engine logic)
- REQ-03: Track total minutes (derived from Appearances)
- REQ-07: Fairness ledger (season totals, balances)

Once the engine is solid and tested, wrap it in React/Native UI for:
- REQ-04: Substitution admin
- REQ-05: Quarter close

**Why this order:**
- No React until the engine is proven. Your invariants (Appearance ledger, wall-clock time) are the costliest things to get wrong.
- Specs → Engine tests → Proof it works → UI wrapping
- Sequential hand-offs (Engineer → QA → PO) keep you seeing the work at each gate

---

## Running the Squad

You've set up **sequential by default** — I like that for learning. Here's the cadence:

1. **You (PO):** Approve specs or note what's wrong
2. **I (BA/Architect):** If specs need iteration, refine them
3. **I (Engineer):** Once approved, implement to spec
4. **I (QA):** Verify against acceptance criteria
5. **You (PO):** Review, merge, note what changed in the spec

No orchestration yet. Once you trust the handoffs, we can batch it.

---

## Right Now

**What I recommend we do in this session:**

1. You read the three specs (or tell me which bits to focus on first)
2. You tell me: "These specs are ready" or "X needs clarification"
3. If ready → we create GitHub issues and I start on REQ-01 (the clock)
4. If not → I ask clarifying questions and we iterate the spec

---

## The Invariants (Never Break)

Keep these in mind while reviewing:

1. **Minutes derived by folding intervals, never running totals** — the audit trail and display must never disagree
2. **Elapsed time from wall clocks, never tick counting** — Android kills background timers; ticks are silently lost
3. **Fairness is total outfield time, not per-position** — per-position would flag your own position assignments as anomalies
4. **First names only** — GDPR-minimal for children's data
5. **Corrections are explicit and noted** — never destructive

These are load-bearing. If an implementation conflicts, we escalate.

---

## What's Ready to Go

- ✓ Specs written
- ✓ Acceptance criteria in issues.json
- ✓ Roles defined (Engineer, BA, Architect, QA, PO)
- ✓ GitHub issue script ready
- ✓ Local repo with `.git` history
- ✓ Validation script for docs

You're not starting from scratch. You're starting from "is this right?"

