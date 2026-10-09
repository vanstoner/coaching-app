# Docs

The live set: each of these is kept true by every pull request that would make
it wrong (#123). Anything not listed here is either code or archive.

| If you want to... | Read |
|---|---|
| Know the rules every change follows | [CLAUDE.md](../CLAUDE.md) |
| Know what the app is and how to install it | [README.md](../README.md) |
| Know what shipped, when and why | [HISTORY.md](../HISTORY.md) |
| Know why a load-bearing choice was made | [Decision log (ADRs)](./decisions/README.md) |
| See how v1 is built: layout, state, storage, navigation | [System architecture](./system-architecture.md) |
| Look up a type, its rules and its state transitions | [Domain models](./domain-models.md) |
| See what each shipped feature does and where it is stored | [Feature specs](./feature-specs.md) |
| Read the v1 domain, engine and fairness specs | [Specifications](./specs/) |
| See what the v1.0.1 audit found and what is left to do | [Audit, 2026-10-09](./audit/2026-10-09-v1.0.1.md) |
| Know who does what | [Squad roles](./roles/README.md), and each skill in `.claude/skills/` |
| See the delivery slice plan | [Delivery slices](./process/delivery-slices.md) |
| Hand the project to a new team | [Handover prompt](./HANDOVER-PROMPT.md) |

**Requirements, acceptance criteria and Rob's rulings live in the GitHub
issues**, not here. The specs are the v1 foundation (intent); the three as-built pages describe
the code. Where a later issue or ADR differs, that wins.

`python3 docs/process/validate-docs.py` checks that internal links resolve,
ADRs are well formed and no spec sits in Draft. CI runs it on every pull
request.

[`archive/`](./archive/README.md) holds the September process documents. They
are frozen: kept for the record and never updated.
