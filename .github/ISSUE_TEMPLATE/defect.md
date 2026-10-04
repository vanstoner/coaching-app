---
name: Defect
about: Behaviour that contradicts an approved spec, ADR or invariant
title: "DEF-NNN: "
labels: defect
---

## Defect
<!-- One sentence. Which invariant, spec or ADR does it contradict? -->

**Severity:** high / medium / low <!-- add matching severity:* label -->

## Found
- **By:**
- **Against:** commit / file
- **Related:**

## Evidence
<!-- Pasted command output. Not a description of it. -->

## Reproduction
1.

**Expected:**
**Actual:**

## Layer diagnosis
<!-- implementation (behaviour wrong, criteria right: fix the code) / specification (criteria also wrong: fix them on the issue first) / intent (Rob changed his mind: new criteria, expect rework) -->

## Acceptance criteria for the fix
- [ ] Regression test that fails before the fix, committed first
- [ ] Full suite run; output pasted in the PR
- [ ] QA verifies independently

## Out of scope
