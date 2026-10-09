# Domain models

Status: **Draft**, retrofitted from `src/types/index.ts`, `src/engine/MatchEngine.ts`, `src/app/persistence.ts` and `src/app/ledger.ts` at `e04fbb0`, 2026-10-09.
Last updated: 2026-10-09

The types are the source of truth; this page names the rules the types cannot
express. Spec 01 ([01-domain-model.md](./specs/01-domain-model.md)) is the
approved v1 foundation; this is the shape actually shipped.

## Identity

```ts
type UUID = string & { readonly __brand: 'UUID' };  // uuid(): Hermes-safe, no crypto.randomUUID dependency
```

## Squad and players

```ts
interface Player {
  id: UUID; squadId: UUID;
  firstName: string;              // validateName: trimmed, ≤16 chars, ONE word (invariant 4)
  displaySuffix: string | null;   // ≤2 chars, to tell two Alexes apart
  squadNumber: number | null;
  active: boolean;                // false = retired; kept forever, never deleted once played
  createdAt: string;
  keeper?: 'main' | 'backup' | 'never' | null;
  prefers?: 'DEF' | 'MID' | 'ATT' | null;
  outfieldTargetPct?: number | null;  // shown beside figures, never a fairness input (ADR-015)
}
```

- No surname, DOB, contact or photo field may be added (invariant 4).
- A player who has played is retired, not deleted (`playedPlayerIds`).

## Format and positions

```ts
interface Format   { id: UUID; name: string; onFieldCount: number; positions: Position[] }
interface Position { id: UUID; formatId: UUID; label: string; kind: 'goalkeeper' | 'outfield';
                     unit: 'GK' | 'DEF' | 'MID' | 'ATT' | null; roleCode?: string; sortOrder: number }
```

- Exactly one `goalkeeper` position per format.
- A match **snapshots** its format (ADR-012). Changing the squad default never
  reshapes a saved fixture. Renaming positions changes labels only (#166).

## Match

```ts
type MatchStatus = 'planned' | 'in_progress' | 'completed' | 'abandoned';
interface Match {
  id: UUID; squadId: UUID; formatId: UUID;
  opponent: string | null; competition: 'league' | 'cup' | 'friendly' | 'tournament' | null;
  kickoffAt: string | null;
  totalMinutes: number;       // default 50
  quarterCount: number;       // periods: 4 (quarters) or 2 (halves)
  status: MatchStatus; createdAt: string;
}
```

| From | To | Trigger | Guard |
|---|---|---|---|
| `planned` | `in_progress` | `engine.startQuarter` (first period) | lineup valid, enough players |
| `in_progress` | `completed` | `endMatch` → `engine.completeMatch` (ruling D) | every period `ended` |
| any | `abandoned` | **nothing sets it** | read in `fixtures.ts`, `matchClosing.ts` only |

Only a match with no started period may be deleted (`canDeleteFixture`).

## Period (`Quarter`)

```ts
type QuarterStatus = 'pending' | 'running' | 'ended';
interface Quarter {
  id: UUID; matchId: UUID; index: number;   // 1-based
  status: QuarterStatus;
  startedAt: string | null; endedAt: string | null;
  runningSinceWallClock: string | null;     // anchor; non-null iff running
  accumulatedMs: number;                    // frozen at end; 0 while running
  elapsedMs: number;                        // derived mirror; the engine never reads it
}
```

- `pending → running → ended`, one way, in index order; at most one `running`.
- Elapsed = `accumulatedMs + (now − runningSinceWallClock)` (invariant 2).
  Never incremented by a timer.

## Time on the pitch

```ts
interface Appearance {                      // a player in a position, one stretch
  id: UUID; matchId: UUID; quarterId: UUID; playerId: UUID; positionId: UUID;
  positionKind: 'goalkeeper' | 'outfield';  // snapshotted
  positionUnit: PositionUnit | null;
  startElapsedMs: number; endElapsedMs: number | null;  // match-elapsed; null while open
  endReason: 'substitution' | 'position_change' | 'quarter_end' | 'match_end' | 'correction' | null;
  corrected: boolean; correctionNote: string | null;
}
interface BenchStint { id; matchId; quarterId; playerId; startElapsedMs: number; endElapsedMs: number | null }
```

- In a running period every available player has exactly one open Appearance
  **or** one open BenchStint (`validatePlayerTrackingInvariant`).
- Player minutes are **folded**, never stored: `foldPlayerMinutes` sums closed
  and open stretches, clamped at 0. Fairness = outfield + goalkeeper (ADR-015).

## Events and corrections

```ts
interface MatchEvent {
  id: UUID; matchId: UUID; quarterId: UUID;
  kind: 'goal' | 'save' | 'conceded' | 'withdrawn';
  playerId: UUID | null; atElapsedMs: number; recordedAt: string;
  refersTo: UUID | null;    // set iff kind = 'withdrawn'
  note: string | null;      // required (non-blank) iff kind = 'withdrawn'
}
```

- `goal`: scorer on the pitch. `save` / `conceded`: the goalkeeper only.
- A withdrawal cannot be withdrawn; an event is withdrawn at most once.
- Attendance after kick-off changes only by a noted correction in the ledger
  (ruling F). Nothing is ever deleted (invariant 5).

## Availability

`'available' | 'absent' | 'injured' | 'unavailable'`, per match, keyed by
player. Editable freely before kick-off; afterwards only via a late arrival or
a noted correction. The ledger snapshots it at kick-off (ADR-014 §4).

## Plans (intent, never minutes)

```ts
interface MatchPlan     { periods: PlannedPeriod[] }
interface PlannedPeriod { slots: Record<UUID /*positionId*/, UUID | null /*playerId*/>; subs: PlannedSwap[] }
interface PlannedSwap   { onId: UUID | null; offId: UUID | null; atMs: number }
interface PlannedSub    { playerId: UUID; atMs: number; forPlayerId: UUID | null; done: boolean }  // live reminders
```

A plan only pre-fills the lineup. The running period's subs are saved as
`periodSubs` so a relaunch restores reminders (#139).

## Persisted documents

```ts
interface SavedSession {                    // key coaching-app/session/v1, schemaVersion 6
  schemaVersion: number; minReaderVersion: number; savedAt: string;
  squadName: string; squadId: UUID; players: Player[];
  format: Format; totalMinutes: number; periodCount: number; buzzWhenSubDue: boolean;
  matches: SavedMatch[]; currentMatchId: UUID | null;
  // + any unknown fields from a newer build, preserved on write
}
interface SavedMatch {
  match: Match; quarters: Quarter[]; appearances: Appearance[]; benchStints: BenchStint[];
  availability: [UUID, AvailabilityStatus][];
  format?: Format; plan?: MatchPlan; archived?: boolean; events?: MatchEvent[]; periodSubs?: PeriodSubs;
}
```

```ts
interface Ledger {                          // key coaching-app/ledger/v2
  ledger: 'coaching-app/minutes'; ledgerVersion: number; minReaderVersion: number; writtenAt: string;
  entries: LedgerEntry[];                   // the only stored part: hash-chained (ADR-014)
  // folded from entries, never stored:
  squad: { id: UUID; name: string }; players: LedgerPlayer[]; matches: LedgerMatch[];
}
// entry record types: squad | player | match | interval | event | attendance
```

- Ledger: append-only, each entry hashes its predecessor; recording is
  idempotent by id; an import extends the chain or is refused, never merged.
- Ledger, unreadable or failing verification: set aside under its own key,
  never overwritten. Too new for this build: shown, never written.
- Session: older versions are migrated (`MIGRATIONS`). **Known gap:** a
  session that is too new or fails `validate()` loads as "none", and the first
  save after launch writes an empty squad over it. The ledger survives; the
  fixtures, plans and squad list do not. See #173.
