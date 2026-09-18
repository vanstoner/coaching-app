/**
 * Persistence — REQ-11 (#53).
 *
 * Pure TypeScript. The storage mechanism is injected as a `KeyValueStore`, so
 * every rule below is provable without a device and swapping AsyncStorage for
 * something else later costs one file.
 *
 * ---------------------------------------------------------------------------
 * What is written, and what is deliberately not
 * ---------------------------------------------------------------------------
 *
 * **Invariant 1 — nothing derived is stored as authoritative.** What goes to
 * disk is the log and the anchors: the quarters with their `accumulatedMs` and
 * `runningSinceWallClock`, and the Appearance and BenchStint records. Minutes,
 * elapsed times and fairness are folded from those on load, never read back.
 *
 * `Quarter.elapsedMs` is a derived mirror the engine never reads. It is
 * **zeroed on save** rather than written out, so a future reader cannot mistake
 * a stale number for the truth. That is cheap insurance against exactly the
 * class of bug invariant 1 exists to prevent.
 *
 * **Invariant 2 — the anchor is what survives.** `runningSinceWallClock` is an
 * ISO wall-clock timestamp. A phone that dies mid-quarter and is relaunched ten
 * minutes later recovers the true elapsed time, because the engine subtracts
 * that anchor from the current clock rather than counting anything.
 *
 * **ADR-011 — device-local.** This writes to one key on the device and nowhere
 * else. No network, no cloud backup (Android auto-backup is off and asserted in
 * CI), no export. Children's first names live here and must not travel.
 */

import type {
  Appearance,
  AvailabilityStatus,
  BenchStint,
  Format,
  Match,
  Player,
  Quarter,
  UUID,
} from '../types/index';
import type { MatchState } from '../engine/MatchEngine';

/**
 * Bumped only when an old saved session can no longer be read. A session
 * written by a newer schema is discarded rather than guessed at.
 */
export const SCHEMA_VERSION = 1;

export const STORAGE_KEY = 'coaching-app/session/v1';

/** The slice of a storage engine this needs. Keeps the native module at arm's length. */
export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/** Everything worth surviving a relaunch. */
export interface SavedSession {
  schemaVersion: number;
  savedAt: string;
  squadName: string;
  squadId: UUID;
  players: Player[];
  format: Format;
  totalMinutes: number;
  periodCount: number;
  /** The mid-week plan: quarter index (1-based) → the players on the pitch. */
  plan: Record<string, UUID[]>;
  /** Null when no match has kicked off yet. */
  match: {
    match: Match;
    quarters: Quarter[];
    appearances: Appearance[];
    benchStints: BenchStint[];
    availability: [UUID, AvailabilityStatus][];
  } | null;
}

export interface SessionInput {
  squadName: string;
  squadId: UUID;
  players: Player[];
  format: Format;
  totalMinutes: number;
  periodCount: number;
  plan: Record<string, UUID[]>;
  state: MatchState | null;
  now?: Date;
}

/** Build the on-disk shape. Pure — no I/O, so the rules above are testable. */
export function toSavedSession(input: SessionInput): SavedSession {
  return {
    schemaVersion: SCHEMA_VERSION,
    savedAt: (input.now ?? new Date()).toISOString(),
    squadName: input.squadName,
    squadId: input.squadId,
    players: input.players,
    format: input.format,
    totalMinutes: input.totalMinutes,
    periodCount: input.periodCount,
    plan: input.plan,
    match: input.state
      ? {
          match: input.state.match,
          // elapsedMs zeroed: see the note at the top. The anchors are
          // accumulatedMs and runningSinceWallClock, and they are kept.
          quarters: input.state.quarters.map((q) => ({ ...q, elapsedMs: 0 })),
          appearances: input.state.appearances,
          benchStints: input.state.benchStints,
          availability: [...input.state.playerAvailability.entries()],
        }
      : null,
  };
}

/** Rebuild a MatchState the engine can be handed. Null when nothing was saved. */
export function toMatchState(saved: SavedSession): MatchState | null {
  if (!saved.match) return null;
  return {
    match: saved.match.match,
    quarters: saved.match.quarters,
    appearances: saved.match.appearances,
    benchStints: saved.match.benchStints,
    playerAvailability: new Map(saved.match.availability ?? []),
  };
}

/**
 * Parse what came off the device.
 *
 * Returns null for anything it cannot trust — absent, malformed, wrong schema,
 * or structurally wrong. **A corrupt save must start a clean session, never
 * crash on launch**: a coach standing on a touchline at 9am cannot debug JSON,
 * and an app that will not open is worse than one that forgot the squad.
 */
export function parseSession(raw: string | null): SavedSession | null {
  if (raw === null || raw === '') return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;

  const s = parsed as Partial<SavedSession>;

  // A session from a future version of the app. Discard rather than guess:
  // half-understanding a newer shape is how a fairness figure goes quietly
  // wrong.
  if (s.schemaVersion !== SCHEMA_VERSION) return null;

  if (!Array.isArray(s.players)) return null;
  if (typeof s.squadId !== 'string') return null;
  if (typeof s.totalMinutes !== 'number' || !(s.totalMinutes > 0)) return null;
  if (typeof s.periodCount !== 'number' || !(s.periodCount > 0)) return null;
  if (!s.format || !Array.isArray((s.format as Format).positions)) return null;

  // The match is optional, but if present it must be whole.
  if (s.match !== null && s.match !== undefined) {
    const m = s.match;
    if (!m.match || !Array.isArray(m.quarters) || !Array.isArray(m.appearances)) {
      return null;
    }
    if (!Array.isArray(m.benchStints)) return null;
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    savedAt: typeof s.savedAt === 'string' ? s.savedAt : new Date(0).toISOString(),
    squadName: typeof s.squadName === 'string' ? s.squadName : '',
    squadId: s.squadId as UUID,
    players: s.players as Player[],
    format: s.format as Format,
    totalMinutes: s.totalMinutes,
    periodCount: s.periodCount,
    plan: (s.plan ?? {}) as Record<string, UUID[]>,
    match: s.match
      ? {
          ...s.match,
          availability: Array.isArray(s.match.availability) ? s.match.availability : [],
        }
      : null,
  };
}

/** True when the saved match has a quarter still running — i.e. offer a resume. */
export function hasMatchInProgress(saved: SavedSession | null): boolean {
  if (!saved?.match) return false;
  return saved.match.quarters.some((q) => q.status === 'running');
}

/** True when a saved match has started but not finished every quarter. */
export function hasMatchUnderway(saved: SavedSession | null): boolean {
  if (!saved?.match) return false;
  const started = saved.match.quarters.some((q) => q.status !== 'pending');
  const finished = saved.match.quarters.every((q) => q.status === 'ended');
  return started && !finished;
}

// --- I/O --------------------------------------------------------------------
//
// Every one of these swallows storage failure. A phone with a full disk should
// lose the save, not the match: the app keeps running on in-memory state, which
// is exactly how it behaved before persistence existed.

export async function saveSession(
  store: KeyValueStore,
  input: SessionInput
): Promise<boolean> {
  try {
    await store.setItem(STORAGE_KEY, JSON.stringify(toSavedSession(input)));
    return true;
  } catch {
    return false;
  }
}

export async function loadSession(store: KeyValueStore): Promise<SavedSession | null> {
  try {
    return parseSession(await store.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

export async function clearSession(store: KeyValueStore): Promise<boolean> {
  try {
    await store.removeItem(STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

/** An in-memory store. Used by the tests, and as a fallback if the native one fails to load. */
export function createMemoryStore(): KeyValueStore {
  const map = new Map<string, string>();
  return {
    async getItem(key) {
      return map.get(key) ?? null;
    },
    async setItem(key, value) {
      map.set(key, value);
    },
    async removeItem(key) {
      map.delete(key);
    },
  };
}
