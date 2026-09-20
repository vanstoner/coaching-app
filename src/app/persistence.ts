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
 * v3 — matches are PLURAL (#62). One saved match becomes a list of them, with
 *      the one being played named separately. This is what makes fixtures,
 *      history and season fairness possible.
 * v4 — each match carries its own FORMAT (#70). The session's format becomes
 *      the squad's default; the shape a match is played in belongs to the
 *      match, because a cup game in 2-2-2 must not change next Saturday's
 *      league default. See ADR-012.
 *
 * An OLD save is migrated, never discarded (#61). The previous code returned
 * null on any mismatch, which meant the first version bump would have silently
 * emptied a coach's squad with no backup to recover from.
 */
export const SCHEMA_VERSION = 4;

/**
 * The oldest build that can safely read what this one writes.
 *
 * v2 adds fields a v1 reader does not know about, and a v1 reader would drop
 * them on write-back — so v1 is NOT safe and this says so. When a later
 * version only adds optional fields, this stays put and older builds keep
 * working, which is the entire point of tracking it separately from
 * `SCHEMA_VERSION`.
 *
 * **v4 moves it.** A v3 reader knows nothing of `SavedMatch.format`, so it
 * would play a fixture saved as 2-2-2 using the squad's DEFAULT positions and
 * write appearances against slots the coach never picked — a child's minutes
 * filed under the wrong unit, in a record nobody could see was wrong. That is
 * precisely the case this number exists to refuse.
 */
export const MIN_READER_VERSION = 4;

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
  'matches',
  'currentMatchId',
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

      const match = doc.match as SavedMatch | null | undefined;
      const migratedMatch = match
        ? {
            ...match,
            appearances: match.appearances.map((appearance: Appearance) => ({
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
  {
    from: 2,
    to: 3,
    describe: 'v2 \u2192 v3: matches become plural',
    up: (doc) => {
      // A v2 document held at most one match. It becomes a list of one, and
      // that match stays current — a coach mid-match must relaunch into the
      // match they were playing, not into a fixture list.
      const match = doc.match as SavedMatch | null | undefined;
      const { match: _dropped, ...rest } = doc;
      return {
        ...rest,
        minReaderVersion: MIN_READER_VERSION,
        matches: match ? [match] : [],
        currentMatchId: match ? match.match.id : null,
      };
    },
  },
  {
    from: 3,
    to: 4,
    describe: 'v3 \u2192 v4: each match carries the format it is played in',
    up: (doc) => {
      // Up to v3 there was exactly ONE format and every match used it, so
      // attaching it to each match states what was already true. Nothing is
      // invented: a match whose positions came from this format keeps those
      // same position ids, which is what its appearances already reference.
      const format = doc.format as Format | undefined;
      const matches = (doc.matches as SavedMatch[] | undefined) ?? [];
      return {
        ...doc,
        minReaderVersion: MIN_READER_VERSION,
        matches: matches.map((m) => ({ ...m, format: m.format ?? format })),
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

/** One match on disk: the log and the anchors, never a computed total. */
export interface SavedMatch {
  match: Match;
  quarters: Quarter[];
  appearances: Appearance[];
  benchStints: BenchStint[];
  availability: [UUID, AvailabilityStatus][];
  /**
   * The shape this match is played in — #70, ADR-012.
   *
   * A snapshot, not a reference. `Match.formatId` has always said "snapshotted
   * at creation" (Spec 01); until v4 there was only one format so nothing had
   * to be kept. Now that Settings holds a DEFAULT shape, a stored match that
   * read the default back would change shape under the coach the moment they
   * changed it — and its appearances reference position ids only this snapshot
   * still knows.
   *
   * Optional so a v3 document that somehow arrives unmigrated is readable
   * rather than corrupt; callers fall back to the squad default.
   */
  format?: Format;
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
  /**
   * Every match: planned fixtures, the one underway, and everything played.
   *
   * A fixture IS a match with status 'planned' — the domain model said so from
   * the start, and inventing a separate Fixture entity would have created two
   * things meaning the same.
   */
  matches: SavedMatch[];
  /** The match being played or set up. Null between matches. */
  currentMatchId: UUID | null;
}

export interface SessionInput {
  squadName: string;
  squadId: UUID;
  players: Player[];
  /** The squad's DEFAULT shape. The one a match is played in is on the match. */
  format: Format;
  totalMinutes: number;
  periodCount: number;
  plan: Record<string, UUID[]>;
  /** Every match already on disk, other than the one being played. */
  matches?: SavedMatch[];
  /** The match being played or set up, if there is one. */
  state: MatchState | null;
  /**
   * The format `state` is being played in (#70).
   *
   * Passed alongside rather than read off the session default, because those
   * are now two different things. Omitted, the stored match keeps whatever
   * format it already had — so a save that forgot it cannot erase one.
   */
  matchFormat?: Format | null;
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
    matches: mergeCurrentMatch(input.matches ?? [], input.state, input.matchFormat ?? null),
    currentMatchId: input.state?.match.id ?? null,
  };
}

/**
 * Fold the match being played into the stored list, replacing its earlier
 * version rather than appending a second copy of the same match.
 *
 * Matching on id rather than position is the point: a coach who opens a
 * planned fixture and kicks off must end up with ONE match that changed
 * status, not a planned one and an in-progress one that disagree.
 */
function mergeCurrentMatch(
  existing: SavedMatch[],
  state: MatchState | null,
  matchFormat: Format | null
): SavedMatch[] {
  if (!state) return existing;
  const at = existing.findIndex((m) => m.match.id === state.match.id);
  const current: SavedMatch = {
    match: state.match,
    // elapsedMs zeroed: see the note at the top. The anchors are
    // accumulatedMs and runningSinceWallClock, and they are kept.
    quarters: state.quarters.map((q) => ({ ...q, elapsedMs: 0 })),
    appearances: state.appearances,
    benchStints: state.benchStints,
    availability: [...state.playerAvailability.entries()],
    // A caller that does not know the format must not be able to drop one that
    // is already stored: the appearances reference position ids that only this
    // snapshot still explains.
    format: matchFormat ?? (at === -1 ? undefined : existing[at].format),
  };
  if (at === -1) return [...existing, current];
  return existing.map((m, i) => (i === at ? current : m));
}

/** The stored match with this id, or undefined. */
export function savedMatchById(
  saved: SavedSession,
  matchId: UUID | null
): SavedMatch | undefined {
  if (!matchId) return undefined;
  return saved.matches.find((m) => m.match.id === matchId);
}

/**
 * Rebuild a MatchState the engine can be handed.
 *
 * Defaults to the current match, so callers that do not care which one — the
 * resume screen, the clock — keep working unchanged.
 */
export function toMatchState(saved: SavedSession, matchId?: UUID): MatchState | null {
  const stored = savedMatchById(saved, matchId ?? saved.currentMatchId);
  if (!stored) return null;
  return {
    match: stored.match,
    quarters: stored.quarters,
    appearances: stored.appearances,
    benchStints: stored.benchStints,
    playerAvailability: new Map(stored.availability ?? []),
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

  // Matches are optional — a squad with no fixtures yet is a valid session —
  // but each one present must be whole. A half-written match is discarded
  // along with the session rather than loaded into a screen that will then
  // read a quarter that does not exist.
  if (!Array.isArray(s.matches)) return null;
  for (const m of s.matches) {
    if (!m || !m.match || !Array.isArray(m.quarters) || !Array.isArray(m.appearances)) {
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
    matches: s.matches.map((m) => ({
      ...m,
      availability: Array.isArray(m.availability) ? m.availability : [],
    })),
    // A currentMatchId naming a match that is not there is dropped rather
    // than trusted: it would send the app to a screen with nothing behind it.
    currentMatchId:
      typeof s.currentMatchId === 'string' &&
      s.matches.some((m) => m.match.id === s.currentMatchId)
        ? (s.currentMatchId as UUID)
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

/** The match the app should open into, if any. */
function currentMatch(saved: SavedSession | null): SavedMatch | undefined {
  if (!saved) return undefined;
  return savedMatchById(saved, saved.currentMatchId);
}

/** True when the current match has a quarter still running — i.e. offer a resume. */
export function hasMatchInProgress(saved: SavedSession | null): boolean {
  const m = currentMatch(saved);
  if (!m) return false;
  return m.quarters.some((q) => q.status === 'running');
}

/** True when the current match has started but not finished every quarter. */
export function hasMatchUnderway(saved: SavedSession | null): boolean {
  const m = currentMatch(saved);
  if (!m) return false;
  const started = m.quarters.some((q) => q.status !== 'pending');
  const finished = m.quarters.every((q) => q.status === 'ended');
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
