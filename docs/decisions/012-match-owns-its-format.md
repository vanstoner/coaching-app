# ADR-012: A match owns the format it is played in

**Status:** Accepted
**Date:** 2026-09-20
**Decision maker:** Architect; approved by the Product Owner 2026-09-20 (#62, #70)

This is the first ADR numbered 012. An earlier ADR-012 was named in chat and
killed before it was written (see the 2026-09-18 retrospective). That draft
never existed in the tree. The number was free.

## Context

The squad stored one `Format`. Every match pointed at it by `formatId`. That
was enough while every Saturday was the same 7-a-side.

The Product Owner, 2026-09-20:

> *"the match length and format are probably match specific - but happy to
> have defaults in the settings."*

> *"we typically range from 2, 2, 2 GK, to 2, 3, 1, GK."*

If Settings holds a *default* shape, a match that re-reads that default on
open changes shape under the coach the moment they change it. Appearances
reference position ids. Filing those ids against a different slot list would
put a child's minutes under the wrong unit, in a record nobody could see was
wrong.

Spec 01 already said `Match.formatId` is snapshotted at creation. Until now
there was only one format, so nothing had to be kept.

## Decision

1. **The session format is the squad default.** Settings edits that. Play now
   and "new fixture" copy it.
2. **Each stored match carries its own format snapshot.** Length and
   `quarterCount` already lived on `Match`. Shape follows them. Changing the
   default never rewrites a fixture already saved.
3. **Schema v4.** `minReaderVersion` moves to 4: a v3 reader does not know
   `SavedMatch.format` and would play a 2-2-2 fixture on the default slots.
4. **No React Navigation.** Tuesday tabs are three destinations and a tested
   pure function (`src/app/tabs.ts`). A navigator library is machinery this
   slice does not need (ADR-001, proportionality).

Labels on slots remain the coach's. Time is still measured on GK / DEF / MID /
ATT. A slot has one unit; "goes wherever" is a label, not a fifth primitive.

## Consequences

**Easier:** a cup in halves and 2-2-2 does not disturb next Saturday's league
default. Appearances keep resolving to the slots they were recorded against.

**Harder:** two formats can exist on one device. The live match must use
*its* snapshot, not the default, for lineup and `startQuarter`.

**Accepted:** older builds cannot read a v4 save. One phone, one upgrade path.

## Alternatives considered

**Keep one shared format.** Rejected: it cannot honour the PO's ruling.

**Store only a shape code (`2-3-1` | `2-2-2`) on the match.** Rejected: labels
the coach has renamed would be rebuilt from the catalogue and the appearance
position ids would dangle.

**Add React Navigation.** Rejected for this slice. Tabs are not a stack. Cost
to reverse later is low if a real navigator is ever earned.
