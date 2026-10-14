# ADR-019: The shell owns app state; a step machine routes; no state or navigation library

**Status:** Accepted
**Date:** 2026-10-09
**Decision maker:** Architect, recording a choice already shipped in v1.0.0; approved by the Product Owner, 2026-10-09 (`approve 5`)

## Context

The tab bar ruling (#70) rejected React Navigation in a code comment
(`src/screens/TabBar.tsx`), and #70 moved every screen out of `App.tsx`. No ADR
records how state is held or routed. v2 work (#98, #136) will add screens.

## Decision

- **State:** all durable state is `useState` in `App.tsx`. Screens get values
  and callbacks and keep only view state. No Redux, Zustand or Context store.
- **Rules:** every decision the shell makes is a pure function in `src/app/`
  with a test beside it. The match engine stays pure TypeScript.
- **Routing:** a `Step` union (`src/app/tabs.ts`) selects one screen;
  `effectiveStep` collapses a step whose data is missing to Home. Tuesday steps
  draw the tab bar; Saturday steps are full screen with an explicit Leave.
- **Live match:** `{ engine, state, format }`; the engine mutates `state` in
  place and the shell persists and repaints.

## Consequences

- Easier: one place to read what the app is doing; routing rules testable in
  Node; no native navigation dependency.
- Harder: `App.tsx` is 1,378 lines and every new feature adds callbacks to it.
  `persist` depends on 12 values, so every state change rewrites the session.
  In-place mutation means React cannot see engine changes; a missed
  `persist()`/`repaint()` is a silent bug. No back stack: the Android back
  button is unhandled.
- Accepted until the shell passes a size the team names. The 2026-10-09 audit
  recommends feature modules owning their state slice and a reducer for the
  live match before v2.

## Alternatives considered

- **React Navigation**: back stack and Android back for free; a second source
  of truth about where the user is, and a native dependency, for three tabs.
- **A state library**: worth it with several independent writers; today there
  is one shell.
- **`useReducer` over one `AppState`**: the natural next step, and the one the
  audit recommends before v2.
