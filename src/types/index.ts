/**
 * Core domain types for the coaching app.
 * These map directly to Spec 01 (Domain Model).
 */

// UUIDs represented as strings
export type UUID = string & { readonly __brand: 'UUID' };

export function uuid(): UUID {
  return crypto.randomUUID() as UUID;
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

export interface Position {
  id: UUID;
  formatId: UUID;
  label: string; // e.g. "GK", "LB", "CM", "ST"
  kind: PositionKind;
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
