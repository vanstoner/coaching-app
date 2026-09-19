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
import {
  migrateDocument,
  tooNewMessage,
  unknownFields,
  type Migration,
  type VersionedDocument,
} from './schema';
import { inferUnit, unitOfRole } from './positions';

/**
 * The shape this build writes.
 *
 * v1 — the original. One match, positions with a kind but no unit.
 * v2 — positions and appearances carry a `PositionUnit` (#62), and every
 *      document declares `minReaderVersion`.
 *
 * An OLD save is migrated, never discarded (#61). The previous code returned
 * null on any mismatch, which meant the first version bump would have silently
 * emptied a coach's squad with no backup to recover from.
 */
export const SCHEMA_VERSION = 2;

/**
 * The oldest build that can safely read what this one writes.
 *
 * v2 adds fields a v1 reader does not know about, and a v1 reader would drop
 * them on write-back — so v1 is NOT safe and this says so. When a later
 * version only adds optional fields, this stays put and older builds keep
 * working, which is the entire point of tracking it separately from
 * `SCHEMA_VERSION`.
 */
export const MIN_READER_VERSION = 2;

/**
 * Every top-level field this build understands.
 *
 * Anything else found in a document is kept and written back untouched, so an
 * older build cannot destroy a newer one's data — the property that decides
 * whether a second device is ever workable (#61).
 */
const KNOWN_FIELDS = [
  'schemaVersion',
  'minReaderVersion',
  'savedAt',
  'squadName',
  'squadId',
  'players',
  'format',
  'totalMinutes',
  'periodCount',
  'plan',
  'match',
] as const;

/**
 * The migration chain. Each step is pure and individually tested, and the
 * committed fixture in `fixtures/session-v1.json` is a real v1 document that
 * must still load after every future step is added.
 */
export const MIGRATIONS: Migration[] = [
  {
    from: 1,
    to: 2,
    describe: 'v1 → v2: positions and appearances carry a unit',
    up: (doc) => {
      const format = doc.format as Format | undefined;

      // A v1 goalkeeping position is unambiguously GK. A v1 OUTFIELD position
      // could be DEF, MID or ATT and v1 recorded nothing that distinguishes
      // them — so unless the label is a catalogue code, it stays null and the
      // coach is asked. Guessing would write a fabricated value into a child's
      // history where nobody would ever see that it was a guess.
      const positions = (format?.positions ?? []).map((position) => ({
        ...position,
        unit: position.unit ?? inferUnit(position.kind, position.label),
        roleCode: position.roleCode ?? (unitOfRole(position.label) ? position.label : undefined),
      }));

      const unitOfPosition = new Map(positions.map((p) => [p.id, p.unit]));

      const match = doc.match as SavedSession['match'];
      const migratedMatch = match
        ? {
            ...match,
            appearances: match.appearances.map((appearance) => ({
              ...appearance,
              positionUnit:
                appearance.positionUnit ??
                unitOfPosition.get(appearance.positionId) ??
                // The position is gone from the format but the interval still
                // knows whether it was in goal, which is the half we can honour.
                (appearance.positionKind === 'goalkeeper' ? 'GK' : null),
            })),
          }
        : null;

      return {
        ...doc,
        minReaderVersion: MIN_READER_VERSION,
        format: format ? { ...format, positions } : format,
        match: migratedMatch,
      };
    },
  },
];

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
  /** The oldest build that can safely read this. See MIN_READER_VERSION. */
  minReaderVersion: number;
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
    minReaderVersion: MIN_READER_VERSION,
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
/**
 * What a read produced: a session, nothing, or a reason a coach can act on.
 *
 * The middle case used to be the ONLY case for anything unexpected, including
 * "written by a slightly newer build", which is how a version bump would have
 * quietly emptied a squad (#61).
 */
export type ReadResult =
  | { status: 'ok'; session: SavedSession; migrationsApplied: string[] }
  | { status: 'empty' }
  /** Not a document this app wrote, or damaged beyond reading. */
  | { status: 'corrupt' }
  /** Written by a build newer than this one, which said old readers are unsafe. */
  | { status: 'too_new'; message: string };

/**
 * Read a stored document: migrate it forward, then validate it.
 *
 * What changed, and why it matters: this used to say
 *
 *     if (s.schemaVersion !== SCHEMA_VERSION) return null;
 *
 * which discarded every older save the moment the version moved. With
 * `allowBackup="false"` (ADR-011) and no export, that was unrecoverable data
 * loss dressed up as caution. An older save is now UPGRADED; only a genuinely
 * unreadable one is refused, and a newer one says so in words.
 */
export function readSession(raw: string | null): ReadResult {
  if (raw === null || raw === '') return { status: 'empty' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: 'corrupt' };
  }

  const outcome = migrateDocument(parsed, MIGRATIONS, SCHEMA_VERSION, SCHEMA_VERSION);
  if (!outcome.ok) {
    if (outcome.reason === 'too_new') {
      return {
        status: 'too_new',
        message: tooNewMessage(outcome.writtenBy, outcome.needsReader),
      };
    }
    return { status: 'corrupt' };
  }

  const session = validate(outcome.doc);
  if (!session) return { status: 'corrupt' };
  return { status: 'ok', session, migrationsApplied: outcome.applied };
}

/**
 * Check a migrated document is whole, and keep anything this build does not
 * recognise so writing back cannot destroy it.
 */
function validate(doc: VersionedDocument): SavedSession | null {
  const s = doc as Partial<SavedSession> & VersionedDocument;

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
    ...unknownFields(doc, KNOWN_FIELDS),
    schemaVersion: SCHEMA_VERSION,
    minReaderVersion: MIN_READER_VERSION,
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

/**
 * The old shape, kept because callers and tests are written against it.
 * Null for anything that is not a readable session, exactly as before.
 */
export function parseSession(raw: string | null): SavedSession | null {
  const result = readSession(raw);
  return result.status === 'ok' ? result.session : null;
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
