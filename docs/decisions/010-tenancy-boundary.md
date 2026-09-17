# ADR-010: Squad is the data-ownership boundary

**Status:** Accepted
**Date:** 2026-09-17
**Decision maker:** Architect; approved by the Product Owner 2026-09-17 (#19)

## Context

If data is ever shared, something has to define "the dataset" that a set of
coaches can see: a squad, a club, or a coach's personal collection. Every
entity's foreign keys and every future access rule follow from that choice.

Today `Squad` is the top-level entity, and `Match`, `Player` and `Season` hang
off `squadId`. `Format` and `Position` are not squad-scoped.

## Decision

1. **Squad is the unit of ownership and sharing.** Every event and every entity
   is reachable from exactly one `squadId`. Access, export, deletion and (later)
   sync all operate per squad.
2. **Formats become squad-owned** (copied from a built-in template on use) so
   that no shared mutable reference crosses squads.
3. **No `Club` entity now.** If clubs arrive, a club *groups* squads; it does
   not own their data. This keeps a squad exportable and deletable as one unit —
   useful for GDPR erasure too.
4. A player belongs to one squad. Cross-squad appearance (spec 01 open question
   1) stays out of scope; if needed it is modelled as a separate player record
   per squad, never a shared one.

### Product Owner ruling, 2026-09-17 (#19)

The open question — sharing between **coaches of one squad** or **a club seeing
all its squads** — is ruled: **coaches of one squad**. The scenario this design
serves is a head coach and an assistant sharing one squad's data. No club-level
read model is designed, and none is implied by anything in this ADR.

Decision 3 is therefore unchanged and load-bearing: if clubs ever arrive they
group squads, they do not own their data.

## Consequences

**Easier:**
- One squad = one exportable, erasable, shareable bundle.
- Access control later is a single check.

**Harder:**
- Format templates are copied rather than referenced; editing a template does
  not change existing squads. Arguably correct for audit.

**Accepted:**
- A player moving squads is a new record. Their history stays with the old
  squad.

## Alternatives considered

**Club as root now.** Rejected: adds an entity and a layer of ownership rules
for an uncommitted scenario.

**Coach as root.** Rejected: data would belong to a person rather than the team,
making handover between coaches painful.
