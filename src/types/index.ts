/**
 * Core domain types for the coaching app.
 * These map directly to Spec 01 (Domain Model).
 */

// UUIDs represented as strings
export type UUID = string & { readonly __brand: 'UUID' };

/**
 * A v4 UUID, on every engine this code runs on.
 *
 * `crypto.randomUUID()` alone was a latent crash. It exists in Node, so vitest
 * and tsc were both satisfied, and it does NOT exist in Hermes — React Native's
 * JS engine — so the app threw on launch the first time the screen imported the
 * engine. The emulator smoke test caught it; nothing else could have.
 *
 * Three tiers, best first. No platform imports and no dependency, so the engine
 * stays pure TypeScript and testable without a device.
 *
 * The last tier uses `Math.random`, which is not cryptographically secure. That
 * is acceptable here and nowhere else: these identify a match, a quarter and an
 * appearance on one coach's phone. They are never secrets, never tokens, and
 * never leave the device (ADR-011). If an id is ever used to authenticate
 * anything, this function is the wrong source and must be revisited.
 */
/**
 * Only the two members this needs. The DOM `Crypto` type is unavailable —
 * tsconfig's `lib` is ES2020 with no DOM — and naming it structurally also
 * states exactly what a host has to provide.
 */
interface MaybeCrypto {
  randomUUID?: () => string;
  getRandomValues?: <T extends Uint8Array>(array: T) => T;
}

export function uuid(): UUID {
  const c: MaybeCrypto | undefined = (globalThis as { crypto?: MaybeCrypto }).crypto;

  if (typeof c?.randomUUID === 'function') {
    return c.randomUUID() as UUID;
  }

  if (typeof c?.getRandomValues === 'function') {
    const bytes = c.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
    return bytesToUuid(bytes) as UUID;
  }

  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return bytesToUuid(bytes) as UUID;
}

function bytesToUuid(bytes: Uint8Array): string {
  const hex: string[] = [];
  for (let i = 0; i < 16; i++) hex.push(bytes[i].toString(16).padStart(2, '0'));
  return (
    hex.slice(0, 4).join('') +
    '-' +
    hex.slice(4, 6).join('') +
    '-' +
    hex.slice(6, 8).join('') +
    '-' +
    hex.slice(8, 10).join('') +
    '-' +
    hex.slice(10, 16).join('')
  );
}

// ============================================================================
// Match & Quarter
// ============================================================================

export type MatchStatus = 'planned' | 'in_progress' | 'completed' | 'abandoned';
export type QuarterStatus = 'pending' | 'running' | 'ended';

export interface Match {
  id: UUID;
  squadId: UUID;
  formatId: UUID;
  opponent: string | null;
  kickoffAt: string | null; // ISO timestamp
  totalMinutes: number; // 40, 50, or 60
  quarterCount: number; // default 4
  status: MatchStatus;
  createdAt: string; // ISO timestamp
}

export interface Quarter {
  id: UUID;
  matchId: UUID;
  index: number; // 1-based
  status: QuarterStatus;
  startedAt: string | null; // wall-clock ISO timestamp
  endedAt: string | null; // wall-clock ISO timestamp
  runningSinceWallClock: string | null; // ISO timestamp — used for crash recovery
  accumulatedMs: number; // Authoritative accumulated play time for this quarter
  elapsedMs: number; // Derived: accumulatedMs + live elapsed if running
}

// ============================================================================
// Player, Squad, Format, Position
// ============================================================================

export interface Player {
  id: UUID;
  squadId: UUID;
  firstName: string; // First name only
  displaySuffix: string | null; // Max 2 chars, for disambiguation
  squadNumber: number | null;
  active: boolean;
  createdAt: string;
}

export interface Squad {
  id: UUID;
  name: string;
  formatId: UUID;
  createdAt: string;
}

export type PositionKind = 'goalkeeper' | 'outfield';

/**
 * The primitive a position belongs to — PO ruling, 2026-09-19 (#62).
 *
 * > *"they fall into three categories for now Defence, Midfield, Attack. The
 * > actual positions might change names. So I would build in hard primitives
 * > like the three I just had then allow the user to call the positions what
 * > they want. We will track time at the primitive level so it survives
 * > renaming."*
 *
 * These four values are FIXED and never renamed. A coach may call a position
 * "Left Wing", "LM", "Left Mid" or "out wide" — the label is theirs and can
 * change on a whim. The unit underneath it cannot, which is what makes
 * "40% of the season in midfield" a question that survives the coach changing
 * their vocabulary halfway through it.
 *
 * This is the same discipline as Protobuf field numbers: the wire value is
 * stable, the name is a convenience. Renaming a role must never silently
 * re-bucket a child's recorded minutes.
 *
 * `PositionKind` remains derived from this — GK is goalkeeping, everything
 * else is outfield — so invariant 3 is unchanged: fairness is total outfield
 * time, which is now simply DEF + MID + ATT.
 */
export type PositionUnit = 'GK' | 'DEF' | 'MID' | 'ATT';

/** Invariant 3, expressed once: goalkeeping is the only thing excluded. */
export function kindOfUnit(unit: PositionUnit): PositionKind {
  return unit === 'GK' ? 'goalkeeper' : 'outfield';
}

export interface Position {
  id: UUID;
  formatId: UUID;
  /** What the coach calls it. Free to rename; nothing is measured against it. */
  label: string; // e.g. "GK", "LB", "CM", "ST"
  kind: PositionKind;
  /**
   * The primitive time is measured against.
   *
   * Null on positions created before units existed, and ONLY for outfield
   * ones — a v1 goalkeeping position is unambiguously GK, but a v1 outfield
   * position could be any of DEF, MID or ATT and the app has no way to know
   * which. Guessing would silently put a child's minutes in the wrong bucket,
   * so it stays null until a coach says. See migration v1 → v2.
   */
  unit: PositionUnit | null;
  /** The catalogue role this came from, if any — 'CB', 'CAM', 'ST'. */
  roleCode?: string;
  sortOrder: number;
}

export interface Format {
  id: UUID;
  name: string;
  onFieldCount: number;
  positions: Position[];
}

// ============================================================================
// Appearance (the audit unit)
// ============================================================================

export type EndReason = 'substitution' | 'position_change' | 'quarter_end' | 'match_end' | 'correction';

export interface Appearance {
  id: UUID;
  matchId: UUID;
  quarterId: UUID;
  playerId: UUID;
  positionId: UUID;
  positionKind: PositionKind; // Denormalised & snapshotted
  /**
   * The unit, snapshotted at the moment the interval opened.
   *
   * Snapshotted for the same reason `positionKind` is: re-reading it from the
   * Position later would let a coach reclassifying a position rewrite history
   * that has already been played. Null on intervals recorded before units
   * existed.
   */
  positionUnit: PositionUnit | null;
  startElapsedMs: number; // Match-elapsed time at interval start
  endElapsedMs: number | null; // Null while open
  endReason: EndReason | null;
  corrected: boolean;
  correctionNote: string | null;
}

// ============================================================================
// BenchStint (off-pitch time)
// ============================================================================

export interface BenchStint {
  id: UUID;
  matchId: UUID;
  quarterId: UUID;
  playerId: UUID;
  startElapsedMs: number;
  endElapsedMs: number | null;
}

// ============================================================================
// Season & Fairness Ledger
// ============================================================================

export interface Season {
  id: UUID;
  squadId: UUID;
  name: string;
  startDate: string; // ISO date
  endDate: string; // ISO date
}

export interface PlayerSeasonTotals {
  playerId: UUID;
  seasonId: UUID;
  outfieldMs: number; // The fairness figure
  goalkeeperMs: number;
  totalMs: number; // outfieldMs + goalkeeperMs
  matchesAvailable: number;
  matchesPlayed: number;
  benchMs: number;
}

// ============================================================================
// Availability
// ============================================================================

export type AvailabilityStatus = 'available' | 'absent' | 'injured' | 'unavailable';

export interface Availability {
  matchId: UUID;
  playerId: UUID;
  status: AvailabilityStatus;
  note: string | null;
}

// ============================================================================
// Position Affinity
// ============================================================================

export type PreferenceLevel = 'primary' | 'secondary';

export interface PlayerPositionAffinity {
  playerId: UUID;
  positionId: UUID;
  preference: PreferenceLevel;
}
