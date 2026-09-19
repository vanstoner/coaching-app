---
name: design
description: Design a screen or a workflow before it is built, as a clickable prototype Rob opens on his own phone rather than a document he has to imagine. Use when a new screen, navigation change or multi-screen flow is proposed, or when Rob asks to see how something could work. The UX discipline.
---

Design it where it will be used: one thumb, a small screen, outdoors, while
watching something more important than the phone.

## The mechanism

**Publish a clickable prototype Rob opens on the phone he coaches with.** Not a
wireframe document, not a description, not a screenshot. A real page at real
size that he can press.

This is the point of the whole discipline. Every UI defect that reached him —
truncated text, clipped boxes, an unreachable settings link, a screen with no
exit — passed code review and passed CI, and every one was obvious within
seconds of a thumb touching it. No amount of describing a screen catches what
holding it catches.

The prototype is **disposable**. Only the decisions persist, as comments on the
issue. Nothing becomes a document that needs maintaining.

## The loop

1. Propose the screen as a prototype, with the open questions named.
2. Rob reacts on his phone.
3. `analyse` turns his reactions into acceptance criteria on the issue.
4. `architect` checks it against the invariants.
5. `implement` builds to it. The prototype is thrown away.

## Test every screen against these

- **Can a coach act on this, here, now?** A screen showing information he
  cannot act on at the moment he is looking at it is decoration.
- **Is it a Tuesday screen or a Saturday screen?** Planning at a kitchen table
  and rotating in the rain are different jobs. Saying which one a screen is for
  decides its density.
- **Is there a way out?** A screen whose only exit commits him to something is
  a trap. The lineup screen was one.
- **Does it survive the small screen?** Centred content that does not scroll
  hides everything below the fold. Assume the shortest phone, not yours.
- **What does it look like with nothing in it?** An empty state is the first
  thing a new user sees and the last thing anyone designs.
- **Can he undo it?** Especially anything that clears a squad.

## Never

- Replace testing on a real device. A prototype narrows what gets built; it
  does not prove what was built.
- Propose A/B testing. One coach and one squad is not a population.
- Put a real child's name in a prototype. Invented names only.

## Learned here

- Rob's own phrasing of an interaction is usually the design. "Always start
  with no sub then increment" arrived as a better default than the one that
  had been reasoned out.
- He finds in seconds what CI cannot see at all. Get it in front of him first.
