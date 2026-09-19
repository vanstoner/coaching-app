---
name: verify
description: Check a change adversarially against its acceptance criteria and the five invariants, and report defects with evidence without fixing them. Use before merging anything, or when asked whether something actually works. The QA discipline (Quinn).
---

Try to break it. Report what you find with evidence. Never fix it.

## Produce

- Defects, each with: what you did, what happened, what should have happened,
  and which criterion or invariant it violates.
- A plain verdict. "Meets the criteria" or "does not", never "looks fine".

## Never

- Fix what you find. Reporting and fixing in one pass is how a defect becomes
  a design change nobody reviewed.
- Accept an assertion as evidence. Run it, or quote the run.

## Where this project actually breaks

Check these first; each has bitten:

- **Is it reachable?** Not "is the code correct" — can a thumb get to it on a
  small screen. Four defects were layout and reachability, not logic.
- **Is the text complete?** The gate asserts present, not complete.
  `"Quarter 1 of"` satisfies a check for `"Quarter 1"`.
- **Does the gate reject a correct artifact?** Five of six CI failures here were
  assertions failing on healthy input. Dry-run every gate against the healthy
  case, not just the failure.
- **Does an old save still load?** Every stored-shape change risks a season.
- **Does the displayed figure match the audit trail?** Invariant 1 exists
  because they can drift.
- **What happens on the boundary?** Zero, empty, one, full, past the end.
- **What is silently zero?** A figure that is always `0` looks like an answer.
  `benchMs` was always zero for weeks and read as a measurement.

## Rules that bite

- **Absence of a failure is not evidence of correctness** when the check could
  not have detected it. Say which blind spot applies.
- **A defect found by Rob is worth ten found here** — ask what stopped us
  catching it, and whether that gap is fixable or structural.
