/**
 * Match Engine — Pure TypeScript implementation of Spec 02 (Match Engine & Clock)
 *
 * Core responsibilities:
 * 1. Wall-clock time derivation (never tick counting)
 * 2. Quarter lifecycle management (pending → running → ended)
 * 3. Appearance & BenchStint tracking
 * 4. Crash recovery with zero time loss
 */

import {
  UUID,
  uuid,
  Match,
  Quarter,
  QuarterStatus,
  Player,
  Format,
  Appearance,
  BenchStint,
  PositionKind,
  AvailabilityStatus,
} from '../types/index.js';

// ============================================================================
// Configuration
// ============================================================================

export interface MatchEngineConfig {
  nowFn?: () => Date; // Injected for testing
}

// ============================================================================
// Exceptions
// ============================================================================

export class MatchEngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MatchEngineError';
  }
}

// ============================================================================
// In-Memory State
// ============================================================================

export interface MatchState {
  match: Match;
  quarters: Quarter[];
  appearances: Appearance[];
  benchStints: BenchStint[];
  playerAvailability: Map<UUID, AvailabilityStatus>; // playerId → status
}

// ============================================================================
// Match Engine
// ============================================================================

export class MatchEngine {
  private config: MatchEngineConfig;

  constructor(config: MatchEngineConfig = {}) {
    this.config = config;
  }

  private now(): Date {
    return this.config.nowFn?.() ?? new Date();
  }

  // ========================================================================
  // Match Setup
  // ========================================================================

  /**
   * Create a new match. Validates totalMinutes divides evenly by quarterCount.
   */
  createMatch(
    squadId: UUID,
    formatId: UUID,
    options: {
      opponent?: string | null;
      kickoffAt?: string | null;
      totalMinutes?: number;
      quarterCount?: number;
    } = {}
  ): MatchState {
    const totalMinutes = options.totalMinutes ?? 60;
    const quarterCount = options.quarterCount ?? 4;

    if (totalMinutes % quarterCount !== 0) {
      throw new MatchEngineError(
        `totalMinutes (${totalMinutes}) must be evenly divisible by quarterCount (${quarterCount})`
      );
    }

    const match: Match = {
      id: uuid(),
      squadId,
      formatId,
      opponent: options.opponent ?? null,
      kickoffAt: options.kickoffAt ?? null,
      totalMinutes,
      quarterCount,
      status: 'planned',
      createdAt: this.now().toISOString(),
    };

    const quarters: Quarter[] = Array.from({ length: quarterCount }, (_, i) => ({
      id: uuid(),
      matchId: match.id,
      index: i + 1,
      status: 'pending' as QuarterStatus,
      startedAt: null,
      endedAt: null,
      runningSinceWallClock: null,
      accumulatedMs: 0,
      elapsedMs: 0,
    }));

    return {
      match,
      quarters,
      appearances: [],
      benchStints: [],
      playerAvailability: new Map(),
    };
  }

  // ========================================================================
  // Clock Derivation (the core of REQ-01)
  // ========================================================================

  /**
   * Compute elapsed time for a quarter.
   * This is the authoritative time derivation: never tick counting.
   *
   * elapsedMs = accumulatedMs + (running ? now - runningSinceWallClock : 0)
   */
  getQuarterElapsedMs(quarter: Quarter): number {
    if (quarter.status !== 'running' || !quarter.runningSinceWallClock) {
      return quarter.accumulatedMs;
    }

    const runningSince = new Date(quarter.runningSinceWallClock);
    const liveElapsed = this.now().getTime() - runningSince.getTime();
    return quarter.accumulatedMs + liveElapsed;
  }

  /**
   * Compute total match elapsed time (sum of all closed quarters + current).
   */
  getMatchElapsedMs(state: MatchState): number {
    const currentQuarterIndex = state.match.status === 'planned'
      ? 0
      : state.quarters.find((q) => q.status !== 'ended')?.index ?? state.quarters.length;

    let total = 0;
    for (let i = 0; i < currentQuarterIndex; i++) {
      total += this.getQuarterElapsedMs(state.quarters[i]);
    }
    return total;
  }

  // ========================================================================
  // Quarter Lifecycle
  // ========================================================================

  /**
   * Start a quarter.
   * Requires: exactly onFieldCount players assigned to distinct positions.
   */
  startQuarter(
    state: MatchState,
    quarter: Quarter,
    teamSheet: Map<UUID, UUID>, // positionId → playerId
    format: Format
  ): void {
    if (quarter.status !== 'pending') {
      throw new MatchEngineError(
        `Cannot start quarter ${quarter.index}; status is ${quarter.status} (expected pending)`
      );
    }

    if (teamSheet.size !== format.onFieldCount) {
      const assigned = Array.from(teamSheet.keys());
      const unassigned = format.positions
        .filter((p) => !assigned.includes(p.id))
        .map((p) => p.label);
      throw new MatchEngineError(
        `Team sheet incomplete. Unfilled positions: ${unassigned.join(', ')}`
      );
    }

    // Assign distinct players to positions
    const playerIds = new Set(teamSheet.values());
    if (playerIds.size !== teamSheet.size) {
      throw new MatchEngineError('Same player assigned to multiple positions');
    }

    const matchElapsedMs = this.getMatchElapsedMs(state);
    const now = this.now();

    // Update quarter
    quarter.status = 'running';
    quarter.startedAt = now.toISOString();
    quarter.runningSinceWallClock = now.toISOString();
    quarter.accumulatedMs = 0;

    // Open Appearance for each on-field player
    for (const [positionId, playerId] of teamSheet) {
      const position = format.positions.find((p) => p.id === positionId);
      if (!position) {
        throw new MatchEngineError(`Position ${positionId} not found in format`);
      }

      state.appearances.push({
        id: uuid(),
        matchId: state.match.id,
        quarterId: quarter.id,
        playerId,
        positionId,
        positionKind: position.kind,
        startElapsedMs: matchElapsedMs,
        endElapsedMs: null,
        endReason: null,
        corrected: false,
        correctionNote: null,
      });
    }

    // Open BenchStint for each available, unselected player
    const selectedPlayerIds = new Set(teamSheet.values());
    for (const [playerId, status] of state.playerAvailability) {
      if (status === 'available' && !selectedPlayerIds.has(playerId)) {
        state.benchStints.push({
          id: uuid(),
          matchId: state.match.id,
          quarterId: quarter.id,
          playerId,
          startElapsedMs: matchElapsedMs,
          endElapsedMs: null,
        });
      }
    }

    state.match.status = 'in_progress';
  }

  /**
   * End a quarter (hard stop).
   * Closes all open Appearances and BenchStints.
   */
  endQuarter(state: MatchState, quarter: Quarter): void {
    if (quarter.status !== 'running') {
      throw new MatchEngineError(
        `Cannot end quarter ${quarter.index}; status is ${quarter.status} (expected running)`
      );
    }

    const elapsedMs = this.getQuarterElapsedMs(quarter);

    // Freeze the clock
    quarter.accumulatedMs = elapsedMs;
    quarter.runningSinceWallClock = null;
    quarter.status = 'ended';
    quarter.endedAt = this.now().toISOString();

    // Close all open Appearances
    for (const appearance of state.appearances) {
      if (appearance.quarterId === quarter.id && appearance.endElapsedMs === null) {
        appearance.endElapsedMs = this.getMatchElapsedMs(state) + elapsedMs;
        appearance.endReason = 'quarter_end';
      }
    }

    // Close all open BenchStints
    for (const stint of state.benchStints) {
      if (stint.quarterId === quarter.id && stint.endElapsedMs === null) {
        stint.endElapsedMs = this.getMatchElapsedMs(state) + elapsedMs;
      }
    }
  }

  // ========================================================================
  // Validation Invariants (asserted in tests)
  // ========================================================================

  /**
   * For a closed quarter:
   * sum(Appearance durations) === quarterMinutes × onFieldCount
   */
  validateQuarterAppearanceInvariant(
    state: MatchState,
    quarter: Quarter,
    format: Format
  ): void {
    if (quarter.status !== 'ended') {
      return; // Only validate closed quarters
    }

    const quarterMinutes = state.match.totalMinutes / state.match.quarterCount;
    const expectedMs = quarterMinutes * 60 * 1000 * format.onFieldCount;

    let actualMs = 0;
    for (const appearance of state.appearances) {
      if (appearance.quarterId === quarter.id && appearance.endElapsedMs !== null) {
        actualMs += appearance.endElapsedMs - appearance.startElapsedMs;
      }
    }

    if (actualMs !== expectedMs) {
      throw new MatchEngineError(
        `Quarter ${quarter.index} appearance total (${actualMs}ms) != expected (${expectedMs}ms)`
      );
    }
  }

  /**
   * At any elapsed time, every available player is in exactly one of:
   * - an open Appearance, or
   * - an open BenchStint
   */
  validatePlayerTrackingInvariant(state: MatchState): void {
    const currentQuarter = state.quarters.find((q) => q.status === 'running');
    if (!currentQuarter) {
      return; // Only validate during a running quarter
    }

    for (const [playerId, status] of state.playerAvailability) {
      if (status !== 'available') {
        continue; // Only available players must be tracked
      }

      const inAppearance = state.appearances.some(
        (a) =>
          a.quarterId === currentQuarter.id &&
          a.playerId === playerId &&
          a.endElapsedMs === null
      );

      const inBench = state.benchStints.some(
        (b) =>
          b.quarterId === currentQuarter.id &&
          b.playerId === playerId &&
          b.endElapsedMs === null
      );

      if (!inAppearance && !inBench) {
        throw new MatchEngineError(
          `Player ${playerId} not tracked in quarter ${currentQuarter.index}`
        );
      }

      if (inAppearance && inBench) {
        throw new MatchEngineError(
          `Player ${playerId} in both Appearance and BenchStint in quarter ${currentQuarter.index}`
        );
      }
    }
  }
}
