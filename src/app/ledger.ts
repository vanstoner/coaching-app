/**
 * The minutes ledger — #75, ADR-013.
 *
 * Pure TypeScript. No storage, no I/O.
 *
 * > *"Whatever happens there, player time is what I want to keep hold of."*
 * > — PO, 2026-10-03
 *
 * The working document (`persistence.ts`) holds everything and is allowed to
 * churn as the data model is experimented with. Player time is not. This is a
 * second, small store with a FROZEN contract, holding only what minutes are
 * made of — the closed playing intervals — kept under its own key and
 * exportable as a file.
 *
 * ---------------------------------------------------------------------------
 * Rules this file keeps
 * ---------------------------------------------------------------------------
 *
 * - **Intervals, never totals (invariant 1, PO ruling 1A).** Totals are always
 *   folded from intervals. The `summary` in a written file is for people and
 *   is recomputed and compared on import, never trusted.
 * - **It never shrinks.** Recording a match adds and updates intervals by id
 *   and never removes one, so a bug or a reset in the working document cannot
 *   take player time with it.
 * - **Import merges, never overwrites (invariant 5, AC5).** Same id and same
 *   content: skipped. Same id, different content: the existing entry is kept
 *   and the difference is reported.
 * - **Additive versioning (AC3).** `ledgerVersion` 1 is a contract. A later
 *   version may add optional fields and nothing else.
 * - **Forward-compatible (#99 AC2, ADR-013 addendum).** A field this build
 *   does not know is CARRIED, never dropped: through read, record, merge and
 *   export, at every level (ledger, squad, player, match, interval, event),
 *   and so is an event of a kind it does not know. Before this, an older build
 *   rebuilt each entry from the fields it knew and still labelled the result
 *   with the newer `ledgerVersion` — a silent downgrade. A file whose
 *   `minReaderVersion` is above `LEDGER_READER_VERSION` is refused with a
 *   reason, so it is never merged or written back by a build that cannot keep
 *   it whole.
 * - **First names only (invariant 4).**
 */

import type {
  Appearance,
  MatchEvent,
  MatchEventKind,
  Competition,
  MatchStatus,
  Player,
  PositionKind,
  PositionUnit,
  UUID,
} from '../types/index';

export const LEDGER_ID = 'coaching-app/minutes';
export const LEDGER_VERSION = 1;

/**
 * The newest `minReaderVersion` this build can read and write back safely.
 *
 * A writer raises a file's `minReaderVersion` only for a change an older
 * reader would damage by carrying it blindly. A file without one is read as
 * 1: the v1 contract already promised that later versions only add optional
 * fields, which carrying them handles.
 */
export const LEDGER_READER_VERSION = 1;

export interface LedgerInterval {
  /** The Appearance id: what makes recording and import idempotent. */
  id: UUID;
  playerId: UUID;
  /** 1-based half or quarter. */
  period: number;
  kind: PositionKind;
  unit: PositionUnit | null;
  /** Match-elapsed ms, from the closed Appearance. */
  startMs: number;
  endMs: number;
  corrected: boolean;
  note: string | null;
}

export interface LedgerMatch {
  id: UUID;
  kickoffAt: string | null;
  opponent: string | null;
  competition: Competition | null;
  totalMinutes: number;
  periodCount: number;
  status: MatchStatus;
  intervals: LedgerInterval[];
  /**
   * Goals, saves, goals conceded and withdrawals (#84, PO ruling 13).
   * Optional and additive: a v1 ledger without it is still a v1 ledger.
   */
  events?: LedgerEvent[];
}

/** One entry on a match's time stream, as the ledger keeps it. */
export interface LedgerEvent {
  /** The MatchEvent id: what makes recording and import idempotent. */
  id: UUID;
  /**
   * A `MatchEventKind` when this build wrote it. Widened because an event of
   * a kind a later version added is carried as written, not dropped (#99
   * AC2); nothing here folds a figure from an event's kind.
   */
  kind: MatchEventKind | (string & Record<never, never>);
  playerId: UUID | null;
  period: number;
  atMs: number;
  refersTo: UUID | null;
  note: string | null;
}

export interface LedgerPlayer {
  id: UUID;
  firstName: string;
  displaySuffix: string | null;
  /** False for a retired player (#77). Their minutes are kept regardless. */
  active: boolean;
}

export interface PlayerTotal {
  playerId: UUID;
  outfieldMs: number;
  goalkeeperMs: number;
}

export interface Ledger {
  ledger: typeof LEDGER_ID;
  ledgerVersion: number;
  /** The oldest reader that can safely carry this file. See LEDGER_READER_VERSION. */
  minReaderVersion: number;
  writtenAt: string;
  squad: { id: UUID; name: string };
  players: LedgerPlayer[];
  matches: LedgerMatch[];
  /** Written for people; recomputed and checked on read. */
  summary?: PlayerTotal[];
}

// --- forward compatibility (#99 AC2) ---------------------------------------
//
// The fields this build knows, per level. Anything else on a parsed object is
// a later version's, and rides along untouched.

const LEDGER_FIELDS = [
  'ledger',
  'ledgerVersion',
  'minReaderVersion',
  'writtenAt',
  'squad',
  'players',
  'matches',
  // Recomputed on every write and checked on read: never carried.
  'summary',
] as const;
const SQUAD_FIELDS = ['id', 'name'] as const;
const PLAYER_FIELDS = ['id', 'firstName', 'displaySuffix', 'active'] as const;
const MATCH_FIELDS = [
  'id',
  'kickoffAt',
  'opponent',
  'competition',
  'totalMinutes',
  'periodCount',
  'status',
  'intervals',
  'events',
] as const;
const INTERVAL_FIELDS = [
  'id',
  'playerId',
  'period',
  'kind',
  'unit',
  'startMs',
  'endMs',
  'corrected',
  'note',
] as const;
const EVENT_FIELDS = ['id', 'kind', 'playerId', 'period', 'atMs', 'refersTo', 'note'] as const;

/** The fields on `from` this build does not know — a later version's. */
function unknownOf(from: object | undefined, known: readonly string[]): Record<string, unknown> {
  const keep: Record<string, unknown> = {};
  if (!from) return keep;
  for (const [key, value] of Object.entries(from)) {
    if (!known.includes(key)) keep[key] = value;
  }
  return keep;
}

/**
 * The unknown fields of two copies of the same entry: `ours` wins where both
 * have one, and a field only `theirs` has is added. Nothing is removed.
 */
function unknownOfBoth(
  ours: object,
  theirs: object,
  known: readonly string[]
): Record<string, unknown> {
  return { ...unknownOf(theirs, known), ...unknownOf(ours, known) };
}

/** What to tell a coach whose app is older than the minutes file. */
export function tooNewLedgerMessage(writtenBy: number, needsReader: number): string {
  return (
    `This minutes file was saved by a newer version of the app (format ${writtenBy}, ` +
    `needs ${needsReader}). Update the app to use it. Nothing has been changed.`
  );
}

export function emptyLedger(squadId: UUID, squadName: string): Ledger {
  return {
    ledger: LEDGER_ID,
    ledgerVersion: LEDGER_VERSION,
    minReaderVersion: LEDGER_READER_VERSION,
    writtenAt: new Date(0).toISOString(),
    squad: { id: squadId, name: squadName },
    players: [],
    matches: [],
  };
}

/** The slice of a stored match the ledger reads. */
export interface MatchRecord {
  match: {
    id: UUID;
    kickoffAt: string | null;
    opponent: string | null;
    competition: Competition | null;
    totalMinutes: number;
    quarterCount: number;
    status: MatchStatus;
  };
  quarters: { id: UUID; index: number }[];
  appearances: Appearance[];
  events?: MatchEvent[];
}

function ledgerEvents(record: MatchRecord): LedgerEvent[] {
  const periodOf = new Map(record.quarters.map((q) => [q.id, q.index]));
  return (record.events ?? []).map((e) => ({
    id: e.id,
    kind: e.kind,
    playerId: e.playerId,
    period: periodOf.get(e.quarterId) ?? 0,
    atMs: e.atElapsedMs,
    refersTo: e.refersTo,
    note: e.note,
  }));
}

function sameEvent(a: LedgerEvent, b: LedgerEvent): boolean {
  return (
    a.kind === b.kind &&
    a.playerId === b.playerId &&
    a.period === b.period &&
    a.atMs === b.atMs &&
    a.refersTo === b.refersTo &&
    a.note === b.note
  );
}

const byTime = (a: LedgerEvent, b: LedgerEvent) => a.atMs - b.atMs || a.id.localeCompare(b.id);

/** Closed appearances only: a running one has no end yet (#75 design). */
function closedIntervals(record: MatchRecord): LedgerInterval[] {
  const periodOf = new Map(record.quarters.map((q) => [q.id, q.index]));
  return record.appearances
    .filter((a) => a.endElapsedMs !== null)
    .map((a) => ({
      id: a.id,
      playerId: a.playerId,
      period: periodOf.get(a.quarterId) ?? 0,
      kind: a.positionKind,
      unit: a.positionUnit ?? null,
      startMs: a.startElapsedMs,
      endMs: a.endElapsedMs as number,
      corrected: a.corrected,
      note: a.correctionNote,
    }));
}

function samePlayer(a: LedgerPlayer, b: LedgerPlayer): boolean {
  return a.firstName === b.firstName && a.displaySuffix === b.displaySuffix;
}

function sameInterval(a: LedgerInterval, b: LedgerInterval): boolean {
  return (
    a.playerId === b.playerId &&
    a.period === b.period &&
    a.kind === b.kind &&
    a.unit === b.unit &&
    a.startMs === b.startMs &&
    a.endMs === b.endMs &&
    a.corrected === b.corrected &&
    a.note === b.note
  );
}

/**
 * Write this device's matches and squad into the ledger.
 *
 * This device is the authority for its own records, so an interval it holds
 * replaces the ledger's copy with the same id — a later correction flag lands.
 * Nothing absent from `records` is removed: matches, intervals and players
 * only ever accumulate. Players are updated by id, so a corrected spelling
 * reaches every match, and retired players stay (#77).
 */
export function recordMatches(
  ledger: Ledger,
  records: MatchRecord[],
  players: Player[],
  squadName: string,
  now: Date
): Ledger {
  const playersById = new Map(ledger.players.map((p) => [p.id, p]));
  for (const p of players) {
    playersById.set(p.id, {
      ...unknownOf(playersById.get(p.id), PLAYER_FIELDS),
      id: p.id,
      firstName: p.firstName,
      displaySuffix: p.displaySuffix,
      active: p.active !== false,
    });
  }

  const matches = new Map(ledger.matches.map((m) => [m.id, m]));
  for (const record of records) {
    const fresh = closedIntervals(record);
    const freshEvents = ledgerEvents(record);
    // Nothing played and nothing recorded yet: nothing to keep.
    if (fresh.length === 0 && freshEvents.length === 0) continue;
    const existing = matches.get(record.match.id);
    const intervals = new Map((existing?.intervals ?? []).map((i) => [i.id, i]));
    for (const i of fresh) {
      intervals.set(i.id, { ...unknownOf(intervals.get(i.id), INTERVAL_FIELDS), ...i });
    }
    // Events are append-only, so this phone's copy of one never changes;
    // the union by id is the whole rule.
    const events = new Map((existing?.events ?? []).map((e) => [e.id, e]));
    for (const e of freshEvents) {
      events.set(e.id, { ...unknownOf(events.get(e.id), EVENT_FIELDS), ...e });
    }
    matches.set(record.match.id, {
      ...unknownOf(existing, MATCH_FIELDS),
      id: record.match.id,
      kickoffAt: record.match.kickoffAt,
      opponent: record.match.opponent,
      competition: record.match.competition,
      totalMinutes: record.match.totalMinutes,
      periodCount: record.match.quarterCount,
      status: record.match.status,
      intervals: [...intervals.values()].sort(
        (a, b) => a.startMs - b.startMs || a.id.localeCompare(b.id)
      ),
      ...(events.size > 0 ? { events: [...events.values()].sort(byTime) } : {}),
    });
  }

  // `...ledger` carries the ledger's own unknown fields. Its version and
  // reader version stay as the newest writer set them, which is honest now
  // that nothing that writer added is dropped.
  return {
    ...ledger,
    ledgerVersion: Math.max(ledger.ledgerVersion, LEDGER_VERSION),
    minReaderVersion: Math.max(ledger.minReaderVersion ?? LEDGER_READER_VERSION, LEDGER_READER_VERSION),
    writtenAt: now.toISOString(),
    squad: { ...ledger.squad, name: squadName || ledger.squad.name },
    players: [...playersById.values()],
    matches: [...matches.values()],
  };
}

/** Every player's minutes, folded from the intervals. Never stored as truth. */
export function foldLedger(ledger: Ledger): PlayerTotal[] {
  const totals = new Map<UUID, PlayerTotal>();
  for (const p of ledger.players) {
    totals.set(p.id, { playerId: p.id, outfieldMs: 0, goalkeeperMs: 0 });
  }
  for (const m of ledger.matches) {
    for (const i of m.intervals) {
      let row = totals.get(i.playerId);
      if (!row) {
        row = { playerId: i.playerId, outfieldMs: 0, goalkeeperMs: 0 };
        totals.set(i.playerId, row);
      }
      const ms = Math.max(0, i.endMs - i.startMs);
      if (i.kind === 'goalkeeper') row.goalkeeperMs += ms;
      else row.outfieldMs += ms;
    }
  }
  return [...totals.values()];
}

/** The file: the ledger plus a summary a person can read. */
export function serialiseLedger(ledger: Ledger): string {
  return JSON.stringify({ ...ledger, summary: foldLedger(ledger) }, null, 2);
}

export type ParseResult =
  | { ok: true; ledger: Ledger }
  /** `tooNew`: written by a build this one must not write back over (#99 AC2). */
  | { ok: false; reason: string; tooNew?: true };

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The events in a file. A damaged one (no id, kind or time) is skipped; one of
 * a kind a later version added is carried as written (#99 AC2), so writing
 * the file back cannot lose it.
 */
function parseEvents(raw: unknown[]): LedgerEvent[] {
  const out: LedgerEvent[] = [];
  for (const e of raw) {
    if (!isObj(e) || typeof e.id !== 'string' || typeof e.kind !== 'string') continue;
    if (typeof e.atMs !== 'number') continue;
    out.push({
      ...unknownOf(e, EVENT_FIELDS),
      id: e.id as UUID,
      kind: e.kind,
      playerId: typeof e.playerId === 'string' ? (e.playerId as UUID) : null,
      period: typeof e.period === 'number' ? e.period : 0,
      atMs: e.atMs,
      refersTo: typeof e.refersTo === 'string' ? (e.refersTo as UUID) : null,
      note: typeof e.note === 'string' ? e.note : null,
    });
  }
  return out;
}

/**
 * Read a ledger file. Unknown fields are kept, to be written back as they
 * came (#99 AC2). A missing required field, a summary that disagrees with the
 * intervals, or a `minReaderVersion` newer than this build refuses the file
 * with a reason a coach can act on.
 */
export function parseLedger(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'This is not a minutes file — it could not be read.' };
  }
  if (!isObj(raw) || raw.ledger !== LEDGER_ID) {
    return { ok: false, reason: 'This is not a minutes file from this app.' };
  }
  if (typeof raw.ledgerVersion !== 'number' || raw.ledgerVersion < 1) {
    return { ok: false, reason: 'This minutes file has no version and cannot be trusted.' };
  }
  // Before any structural check: a newer file may well be shaped differently,
  // and "update the app" is the reason a coach can act on.
  const minReader = raw.minReaderVersion === undefined ? LEDGER_READER_VERSION : raw.minReaderVersion;
  if (typeof minReader !== 'number' || !Number.isInteger(minReader) || minReader < 1) {
    return { ok: false, reason: 'This minutes file has a damaged version and cannot be trusted.' };
  }
  if (minReader > LEDGER_READER_VERSION) {
    return { ok: false, reason: tooNewLedgerMessage(raw.ledgerVersion, minReader), tooNew: true };
  }
  if (!isObj(raw.squad) || !Array.isArray(raw.players) || !Array.isArray(raw.matches)) {
    return { ok: false, reason: 'This minutes file is incomplete.' };
  }

  const players: LedgerPlayer[] = [];
  for (const p of raw.players) {
    if (!isObj(p) || typeof p.id !== 'string' || typeof p.firstName !== 'string') {
      return { ok: false, reason: 'A player in this file is damaged.' };
    }
    players.push({
      ...unknownOf(p, PLAYER_FIELDS),
      id: p.id as UUID,
      firstName: p.firstName,
      displaySuffix: typeof p.displaySuffix === 'string' ? p.displaySuffix : null,
      active: p.active !== false,
    });
  }

  const matches: LedgerMatch[] = [];
  for (const m of raw.matches) {
    if (!isObj(m) || typeof m.id !== 'string' || !Array.isArray(m.intervals)) {
      return { ok: false, reason: 'A match in this file is damaged.' };
    }
    const intervals: LedgerInterval[] = [];
    for (const i of m.intervals) {
      if (
        !isObj(i) ||
        typeof i.id !== 'string' ||
        typeof i.playerId !== 'string' ||
        (i.kind !== 'goalkeeper' && i.kind !== 'outfield') ||
        typeof i.startMs !== 'number' ||
        typeof i.endMs !== 'number' ||
        i.endMs < i.startMs
      ) {
        return { ok: false, reason: 'A playing interval in this file is damaged.' };
      }
      intervals.push({
        ...unknownOf(i, INTERVAL_FIELDS),
        id: i.id as UUID,
        playerId: i.playerId as UUID,
        period: typeof i.period === 'number' ? i.period : 0,
        kind: i.kind,
        unit: typeof i.unit === 'string' ? (i.unit as PositionUnit) : null,
        startMs: i.startMs,
        endMs: i.endMs,
        corrected: i.corrected === true,
        note: typeof i.note === 'string' ? i.note : null,
      });
    }
    matches.push({
      ...unknownOf(m, MATCH_FIELDS),
      id: m.id as UUID,
      kickoffAt: typeof m.kickoffAt === 'string' ? m.kickoffAt : null,
      opponent: typeof m.opponent === 'string' ? m.opponent : null,
      competition: typeof m.competition === 'string' ? (m.competition as Competition) : null,
      totalMinutes: typeof m.totalMinutes === 'number' ? m.totalMinutes : 0,
      periodCount: typeof m.periodCount === 'number' ? m.periodCount : 0,
      status: typeof m.status === 'string' ? (m.status as MatchStatus) : 'completed',
      intervals,
      ...(Array.isArray(m.events) ? { events: parseEvents(m.events) } : {}),
    });
  }

  const ledger: Ledger = {
    ...unknownOf(raw, LEDGER_FIELDS),
    ledger: LEDGER_ID,
    ledgerVersion: raw.ledgerVersion,
    minReaderVersion: minReader,
    writtenAt: typeof raw.writtenAt === 'string' ? raw.writtenAt : new Date(0).toISOString(),
    squad: {
      ...unknownOf(raw.squad, SQUAD_FIELDS),
      id: (typeof raw.squad.id === 'string' ? raw.squad.id : '') as UUID,
      name: typeof raw.squad.name === 'string' ? raw.squad.name : '',
    },
    players,
    matches,
  };

  // The summary is for people. If it is present it must agree with the
  // intervals, or the file was damaged or edited by hand.
  if (Array.isArray(raw.summary)) {
    const folded = new Map(foldLedger(ledger).map((t) => [t.playerId, t]));
    for (const s of raw.summary) {
      if (!isObj(s) || typeof s.playerId !== 'string') continue;
      const f = folded.get(s.playerId as UUID);
      if (!f || f.outfieldMs !== s.outfieldMs || f.goalkeeperMs !== s.goalkeeperMs) {
        return {
          ok: false,
          reason:
            "This file's totals do not match its playing times. It has been damaged or edited, so nothing was imported.",
        };
      }
    }
  }

  return { ok: true, ledger };
}

export interface MergeReport {
  ledger: Ledger;
  addedPlayers: number;
  addedMatches: number;
  addedIntervals: number;
  skipped: number;
  /** Same id, different content. The existing entry was kept. Plain English. */
  conflicts: string[];
}

/**
 * Merge an imported ledger into this one — AC5.
 *
 * By id. New: added. Identical: skipped. Different: the existing entry is
 * kept and the difference listed. Nothing is overwritten or deleted, so
 * importing the same file twice changes nothing.
 */
export function mergeLedger(into: Ledger, from: Ledger, now: Date): MergeReport {
  let addedPlayers = 0;
  let addedMatches = 0;
  let addedIntervals = 0;
  let skipped = 0;
  const conflicts: string[] = [];

  const players = new Map(into.players.map((p) => [p.id, p]));
  for (const p of from.players) {
    const mine = players.get(p.id);
    if (!mine) {
      players.set(p.id, p);
      addedPlayers++;
      continue;
    }
    if (samePlayer(mine, p)) {
      skipped++;
    } else {
      conflicts.push(`A player is called ${mine.firstName} here and ${p.firstName} in the file; kept ${mine.firstName}.`);
    }
    // This phone's entry is kept; a later version's field only the file has
    // is added to it, never dropped (#99 AC2).
    players.set(p.id, { ...unknownOfBoth(mine, p, PLAYER_FIELDS), ...mine });
  }

  const matches = new Map(into.matches.map((m) => [m.id, m]));
  for (const m of from.matches) {
    const mine = matches.get(m.id);
    if (!mine) {
      matches.set(m.id, m);
      addedMatches++;
      addedIntervals += m.intervals.length;
      continue;
    }
    const intervals = new Map(mine.intervals.map((i) => [i.id, i]));
    let changed = false;
    const events = new Map((mine.events ?? []).map((e) => [e.id, e]));
    for (const e of m.events ?? []) {
      const have = events.get(e.id);
      if (!have) {
        events.set(e.id, e);
        addedIntervals++;
        changed = true;
        continue;
      }
      if (sameEvent(have, e)) {
        skipped++;
      } else {
        conflicts.push(
          `A goal or save in the match against ${mine.opponent ?? 'an unnamed opponent'} differs from the file; kept this phone's.`
        );
      }
      events.set(e.id, { ...unknownOfBoth(have, e, EVENT_FIELDS), ...have });
    }
    for (const i of m.intervals) {
      const have = intervals.get(i.id);
      if (!have) {
        intervals.set(i.id, i);
        addedIntervals++;
        changed = true;
        continue;
      }
      if (sameInterval(have, i)) {
        skipped++;
      } else {
        conflicts.push(
          `A playing time in the match against ${mine.opponent ?? 'an unnamed opponent'} differs from the file; kept this phone's.`
        );
      }
      intervals.set(i.id, { ...unknownOfBoth(have, i, INTERVAL_FIELDS), ...have });
    }
    // Rebuilt every time, so a later version's field only the file has
    // reaches this phone's copy too. Order is only re-sorted when something
    // was added, as before.
    matches.set(m.id, {
      ...unknownOfBoth(mine, m, MATCH_FIELDS),
      ...mine,
      intervals: changed
        ? [...intervals.values()].sort((a, b) => a.startMs - b.startMs || a.id.localeCompare(b.id))
        : mine.intervals.map((i) => intervals.get(i.id) ?? i),
      ...(changed && events.size > 0
        ? { events: [...events.values()].sort(byTime) }
        : mine.events
          ? { events: mine.events.map((e) => events.get(e.id) ?? e) }
          : {}),
    });
  }

  const changed = addedPlayers + addedMatches + addedIntervals > 0;
  return {
    ledger: {
      ...unknownOfBoth(into, from, LEDGER_FIELDS),
      ...into,
      ledgerVersion: Math.max(into.ledgerVersion, from.ledgerVersion, LEDGER_VERSION),
      // The file's fields are carried, so its reader requirement comes too.
      minReaderVersion: Math.max(
        into.minReaderVersion ?? LEDGER_READER_VERSION,
        from.minReaderVersion ?? LEDGER_READER_VERSION
      ),
      writtenAt: changed ? now.toISOString() : into.writtenAt,
      // A fresh install takes the squad's identity from the file, so its
      // later matches line up with the imported ones.
      squad:
        into.players.length === 0 && into.matches.length === 0
          ? from.squad
          : { ...unknownOfBoth(into.squad, from.squad, SQUAD_FIELDS), ...into.squad },
      players: [...players.values()],
      matches: [...matches.values()],
    },
    addedPlayers,
    addedMatches,
    addedIntervals,
    skipped,
    conflicts,
  };
}

/** "minutes-2026-10-03.json". */
export function ledgerFileName(now: Date): string {
  return `minutes-${now.toISOString().slice(0, 10)}.json`;
}

export interface SeasonRow {
  playerId: UUID;
  name: string;
  outfieldMs: number;
  goalkeeperMs: number;
  retired: boolean;
  /** Time per unit (#83 AC6): GK, DEF, MID, FWD. Unknown-unit time is left out. */
  byUnit: Record<'GK' | 'DEF' | 'MID' | 'ATT', number>;
}

/** What the coach calls each unit. The stored code stays ATT; the screen says FWD. */
export const UNIT_LABEL: Record<'GK' | 'DEF' | 'MID' | 'ATT', string> = {
  GK: 'GK',
  DEF: 'DEF',
  MID: 'MID',
  ATT: 'FWD',
};

/** Season minutes per player, from the ledger alone (AC6). Most outfield first. */
export function seasonRows(ledger: Ledger): SeasonRow[] {
  const names = new Map(ledger.players.map((p) => [p.id, p]));
  const units = new Map<UUID, Record<'GK' | 'DEF' | 'MID' | 'ATT', number>>();
  for (const m of ledger.matches) {
    for (const i of m.intervals) {
      if (!i.unit) continue;
      const row = units.get(i.playerId) ?? { GK: 0, DEF: 0, MID: 0, ATT: 0 };
      row[i.unit] += Math.max(0, i.endMs - i.startMs);
      units.set(i.playerId, row);
    }
  }
  return foldLedger(ledger)
    .map((t) => {
      const p = names.get(t.playerId);
      return {
        playerId: t.playerId,
        name: p ? (p.displaySuffix ? `${p.firstName} ${p.displaySuffix}` : p.firstName) : 'Unknown',
        outfieldMs: t.outfieldMs,
        goalkeeperMs: t.goalkeeperMs,
        retired: p ? !p.active : false,
        byUnit: units.get(t.playerId) ?? { GK: 0, DEF: 0, MID: 0, ATT: 0 },
      };
    })
    .sort((a, b) => b.outfieldMs - a.outfieldMs || a.name.localeCompare(b.name));
}

/** What an import did, in one or two sentences a coach can read. */
export function describeMerge(report: Omit<MergeReport, 'ledger'>): string {
  const added = report.addedMatches + report.addedIntervals + report.addedPlayers;
  const parts: string[] = [];
  if (added === 0) {
    parts.push('Nothing new in that file — everything in it is already here.');
  } else {
    parts.push(
      `Added ${report.addedMatches} ${report.addedMatches === 1 ? 'match' : 'matches'} and ${report.addedPlayers} ${report.addedPlayers === 1 ? 'player' : 'players'}.`
    );
  }
  if (report.conflicts.length > 0) {
    parts.push(
      `${report.conflicts.length} ${report.conflicts.length === 1 ? 'entry differs' : 'entries differ'} from this phone; this phone's ${report.conflicts.length === 1 ? 'was' : 'were'} kept.`
    );
  }
  return parts.join(' ');
}
