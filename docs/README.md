# Docs

The live set: each of these is kept true by every pull request that would make
it wrong (#123). Anything not listed here is either code or archive.

| If you want to... | Read |
|---|---|
| Know the rules every change follows | [CLAUDE.md](../CLAUDE.md) |
| Know what the app is and how to install it | [README.md](../README.md) |
| Know what shipped, when and why | [HISTORY.md](../HISTORY.md) |
| Know why a load-bearing choice was made | [Decision log (ADRs)](./decisions/README.md) |
| See how the app is built: layout, state, storage, navigation | [System architecture](./system-architecture.md) |
| Look up a type, its rules and its state transitions | [Domain models](./domain-models.md) |
| Know what the app does today: **the current spec** | [Feature specs](./feature-specs.md) |
| See what the v1.0.1 audit found and what is left to do | [Audit, 2026-10-09](./audit/2026-10-09-v1.0.1.md) |
| Know who does what | [Squad roles](./roles/README.md), and each skill in `.claude/skills/` |
| See the September 2026 delivery slice plan (historical) | [Delivery slices](./process/delivery-slices.md) |

**Requirements, acceptance criteria and Rob's rulings live in the GitHub
issues**, not here. [Feature specs](./feature-specs.md) is the current spec;
domain models and system architecture describe the code beside it. Where a later
issue or ADR differs, that wins.

`python3 docs/process/validate-docs.py` checks that internal links resolve,
ADRs are well formed and no spec sits in Draft. CI runs it on every pull
request.

[`archive/`](./archive/README.md) holds the September process documents and,
since #239, the v1 specs 01–03 and the handover prompt
([`archive/v1-specs/`](./archive/v1-specs/01-domain-model.md)). They are frozen:
kept for the record as v1 intent and never updated.
