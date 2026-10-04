/**
 * The minutes ledger — #75, ADR-013; v2 hash chain and attendance — #100,
 * ADR-014.
 *
 * Pure TypeScript. No storage, no I/O.
 *
 * > *"Whatever happens there, player time is what I want to keep hold of."*
 * > — PO, 2026-10-03
 * >
 * > *"The ledger spine is key here, almost blockchainesque in the importance i
 * > place on it."* — PO, 2026-10-04
 *
 * ---------------------------------------------------------------------------
 * Rules this file keeps
 * ---------------------------------------------------------------------------
 *
 * - **The chain is the ledger (ADR-014 §1).** What is stored and exported is
 *   `entries`: a hash chain (`ledgerChain.ts`). `squad`, `players` and
 *   `matches` on a `Ledger` are FOLDED from the entries every time one is
 *   built, and are never written (invariant 1).
 * - **Intervals, never totals (ADR-013, PO ruling 1A).** The `summary` in a
 *   written file is for people and is recomputed and compared on read.
 * - **It only grows (§2).** Recording appends one entry holding exactly the
 *   records that changed; nothing is ever removed or rewritten, and a revised
 *   interval is a new record, with the old one still in the chain.
 * - **Verified on every read and import (§8).** A chain that does not verify
 *   is refused, never repaired.
 * - **Import extends, never merges (§9, #100 AC2).** A diverged chain is
 *   refused (PO ruling A: one recording phone per match).
 * - **Attendance (§4, #102)** is snapshotted at kick-off; a later change is a
 *   new record with a mandatory note (invariant 5). Games missed are derived
 *   (`attendance.ts`), never stored.
 * - **Forward-compatible (#99 AC2).** Unknown fields and record types are
 *   carried and hashed, never dropped. A file whose `minReaderVersion` is
 *   above this build's is refused for writing.
 * - **First names only (invariant 4).**
 */

import type {
  Appearance,
  AvailabilityStatus,
  MatchEvent,
  MatchEventKind,
  Competition,
  MatchStatus,
  Player,
  PositionKind,
  PositionUnit,
  UUID,
} from '../types/index';
import {
  latestRecords,
  makeEntry,
  sameRecord,
  verifyChain,
  whenOf,
  type LedgerEntry,
  type LedgerRecord,
} from './ledgerChain';

export type { LedgerEntry, LedgerRecord } from './ledgerChain';

export const LEDGER_ID = 'coaching-app/minutes';
/** The format this build writes (ADR-014 §10). It reads 1 by upgrading it. */
export const LEDGER_VERSION = 2;

/**
 * The newest `minReaderVersion` this build can read and write back safely.
 * v2 files say 2, so a v1 reader built with #99 refuses to write one back.
 */
export const LEDGER_READER_VERSION = 2;

export interface LedgerInterval {
  /** The Appearance id: what makes recording idempotent. */
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

/** Who was available for a match, snapshotted at kick-off (ADR-014 §4). */
export interface LedgerAttendance {
  playerId: UUID;
  status: AvailabilityStatus;
  /** Mandatory on a change after kick-off (invariant 5); null on the snapshot. */
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
  /** Goals, saves, goals conceded and withdrawals (#84). Absent when none. */
  events?: LedgerEvent[];
  /**
   * Latest revision per player. Absent for a match recorded before attendance
   * existed (every v1 match): `attendance.ts` infers it from play (ADR-015 §5).
   */
  attendance?: LedgerAttendance[];
}

/** One entry on a match's time stream, as the ledger keeps it. */
export interface LedgerEvent {
  /** The MatchEvent id: what makes recording idempotent. */
  id: UUID;
  /** Widened: an event of a kind a later version added is carried (#99 AC2). */
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
  /** The chain: the only thing stored (ADR-014 §1). */
  entries: LedgerEntry[];
  // --- folded from `entries`; never stored -----------------------------------
  squad: { id: UUID; name: string };
  players: LedgerPlayer[];
  matches: LedgerMatch[];
}

// --- fields this build knows, per record type ---------------------------------
//
// Anything else on a record is a later version's and rides along untouched.

const FIELDS: Record<string, readonly string[]> = {
  squad: ['type', 'id', 'name'],
  player: ['type', 'id', 'firstName', 'displaySuffix', 'active'],
  match: ['type', 'id', 'kickoffAt', 'opponent', 'competition', 'totalMinutes', 'periodCount', 'status'],
  interval: [
    'type',
    'matchId',
    'id',
    'playerId',
    'period',
    'kind',
    'unit',
    'startMs',
    'endMs',
    'corrected',
    'note',
  ],
  event: ['type', 'matchId', 'id', 'kind', 'playerId', 'period', 'atMs', 'refersTo', 'note'],
  attendance: ['type', 'matchId', 'playerId', 'status', 'note'],
};

/** Top-level fields of a file this build knows. The rest are carried. */
const FILE_FIELDS = [
  'ledger',
  'ledgerVersion',
  'minReaderVersion',
  'writtenAt',
  'entries',
  // Folded or recomputed, never carried from a file:
  'squad',
  'players',
  'matches',
  'summary',
] as const;

/** v1 fields per level, for reading a v1 file (ADR-013). */
const V1_FILE_FIELDS = ['ledger', 'ledgerVersion', 'minReaderVersion', 'writtenAt', 'squad', 'players', 'matches', 'summary'];
const V1_MATCH_FIELDS = [...FIELDS.match.filter((f) => f !== 'type'), 'intervals', 'events'];

/** The fields on `from` this build does not know — a later version's. */
function unknownOf(from: object | undefined, known: readonly string[]): Record<string, unknown> {
  const keep: Record<string, unknown> = {};
  if (!from) return keep;
  for (const [key, value] of Object.entries(from)) {
    if (!known.includes(key)) keep[key] = value;
  }
  return keep;
}

/** A record without its `type` and `matchId` tags: the shape a screen reads. */
function untag<T>(record: LedgerRecord): T {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { type, matchId, ...rest } = record;
  return rest as T;
}

/** What to tell a coach whose app is older than the minutes file. */
export function tooNewLedgerMessage(writtenBy: number, needsReader: number): string {
  return (
    `This minutes file was saved by a newer version of the app (format ${writtenBy}, ` +
    `needs ${needsReader}). Update the app to use it. Nothing has been changed.`
  );
}

// --- the fold ---------------------------------------------------------------

const byStart = (a: LedgerInterval, b: LedgerInterval) =>
  a.startMs - b.startMs || a.id.localeCompare(b.id);
const byTime = (a: LedgerEvent, b: LedgerEvent) => a.atMs - b.atMs || a.id.localeCompare(b.id);

/** A record of a known type that is not shaped as that type: a damaged file. */
class DamagedRecord extends Error {}

function checkRecord(r: LedgerRecord): void {
  const str = (v: unknown) => typeof v === 'string';
  const num = (v: unknown) => typeof v === 'number';
  const ok = (() => {
    switch (r.type) {
      case 'squad':
        return str(r.id) && str(r.name);
      case 'player':
        return str(r.id) && str(r.firstName);
      case 'match':
        return str(r.id);
      case 'interval':
        return (
          str(r.id) &&
          str(r.matchId) &&
          str(r.playerId) &&
          (r.kind === 'goalkeeper' || r.kind === 'outfield') &&
          num(r.startMs) &&
          num(r.endMs) &&
          (r.endMs as number) >= (r.startMs as number)
        );
      case 'event':
        return str(r.id) && str(r.matchId) && str(r.kind) && num(r.atMs);
      case 'attendance':
        return str(r.matchId) && str(r.playerId) && str(r.status);
      default:
        return true;
    }
  })();
  if (!ok) throw new DamagedRecord(r.type);
}

/** The ledger's squad, players and matches, folded from its chain. */
function foldView(entries: LedgerEntry[]): Pick<Ledger, 'squad' | 'players' | 'matches'> {
  let squad: Ledger['squad'] = { id: '' as UUID, name: '' };
  const players: LedgerPlayer[] = [];
  const matches = new Map<UUID, LedgerMatch>();
  const intervals = new Map<UUID, LedgerInterval[]>();
  const events = new Map<UUID, LedgerEvent[]>();
  const attendance = new Map<UUID, LedgerAttendance[]>();
  const push = <T>(m: Map<UUID, T[]>, id: UUID, v: T) => {
    const list = m.get(id);
    if (list) list.push(v);
    else m.set(id, [v]);
  };
  const matchFor = (id: UUID) => {
    if (!matches.has(id)) {
      matches.set(id, {
        id,
        kickoffAt: null,
        opponent: null,
        competition: null,
        totalMinutes: 0,
        periodCount: 0,
        status: 'completed',
        intervals: [],
      });
    }
  };

  for (const r of latestRecords(entries).values()) {
    checkRecord(r);
    switch (r.type) {
      case 'squad':
        squad = untag(r);
        break;
      case 'player':
        players.push({
          ...untag<LedgerPlayer>(r),
          displaySuffix: typeof r.displaySuffix === 'string' ? r.displaySuffix : null,
          active: r.active !== false,
        });
        break;
      case 'match': {
        const id = r.id as UUID;
        matches.set(id, {
          ...untag<LedgerMatch>(r),
          kickoffAt: typeof r.kickoffAt === 'string' ? r.kickoffAt : null,
          opponent: typeof r.opponent === 'string' ? r.opponent : null,
          competition: typeof r.competition === 'string' ? (r.competition as Competition) : null,
          totalMinutes: typeof r.totalMinutes === 'number' ? r.totalMinutes : 0,
          periodCount: typeof r.periodCount === 'number' ? r.periodCount : 0,
          status: typeof r.status === 'string' ? (r.status as MatchStatus) : 'completed',
          intervals: [],
        });
        break;
      }
      case 'interval':
        matchFor(r.matchId as UUID);
        push(intervals, r.matchId as UUID, {
          ...untag<LedgerInterval>(r),
          period: typeof r.period === 'number' ? r.period : 0,
          unit: typeof r.unit === 'string' ? (r.unit as PositionUnit) : null,
          corrected: r.corrected === true,
          note: typeof r.note === 'string' ? r.note : null,
        });
        break;
      case 'event':
        matchFor(r.matchId as UUID);
        push(events, r.matchId as UUID, {
          ...untag<LedgerEvent>(r),
          playerId: typeof r.playerId === 'string' ? (r.playerId as UUID) : null,
          period: typeof r.period === 'number' ? r.period : 0,
          refersTo: typeof r.refersTo === 'string' ? (r.refersTo as UUID) : null,
          note: typeof r.note === 'string' ? r.note : null,
        });
        break;
      case 'attendance':
        matchFor(r.matchId as UUID);
        push(attendance, r.matchId as UUID, {
          ...untag<LedgerAttendance>(r),
          note: typeof r.note === 'string' ? r.note : null,
        });
        break;
    }
  }

  return {
    squad,
    players,
    matches: [...matches.values()].map((m) => {
      const ev = events.get(m.id);
      const att = attendance.get(m.id);
      return {
        ...m,
        intervals: (intervals.get(m.id) ?? []).sort(byStart),
        ...(ev ? { events: ev.sort(byTime) } : {}),
        ...(att ? { attendance: att } : {}),
      };
    }),
  };
}

/** A ledger built from its chain: the only way one is made. */
function fromEntries(
  entries: LedgerEntry[],
  header: { ledgerVersion: number; minReaderVersion: number; writtenAt: string },
  carried: Record<string, unknown> = {}
): Ledger {
  return {
    ...carried,
    ledger: LEDGER_ID,
    ledgerVersion: header.ledgerVersion,
    minReaderVersion: header.minReaderVersion,
    writtenAt: header.writtenAt,
    entries,
    ...foldView(entries),
  } as Ledger;
}

/** The top-level fields a later version added, which ride along outside the chain. */
function carriedOf(ledger: Ledger): Record<string, unknown> {
  return unknownOf(ledger, FILE_FIELDS);
}

/**
 * A new ledger: a genesis entry holding the squad (ADR-014 §7). `follows`
 * names where an unreadable predecessor was set aside (#100 AC7), so the new
 * chain says what it follows.
 */
export function emptyLedger(
  squadId: UUID,
  squadName: string,
  now: Date = new Date(0),
  follows?: string
): Ledger {
  const genesis = makeEntry(
    null,
    'genesis',
    [{ type: 'squad', id: squadId, name: squadName }],
    now,
    follows ? { from: 'new', follows } : { from: 'new' }
  );
  return fromEntries([genesis], {
    ledgerVersion: LEDGER_VERSION,
    minReaderVersion: LEDGER_READER_VERSION,
    writtenAt: now.toISOString(),
  });
}

/** Append one entry holding `records`. Nothing to record, nothing appended. */
function appendRecords(ledger: Ledger, records: LedgerRecord[], now: Date): Ledger {
  if (records.length === 0) return ledger;
  const last = ledger.entries[ledger.entries.length - 1] ?? null;
  const entries = [...ledger.entries, makeEntry(last, last ? 'record' : 'genesis', records, now)];
  return fromEntries(
    entries,
    {
      ledgerVersion: Math.max(ledger.ledgerVersion, LEDGER_VERSION),
      minReaderVersion: Math.max(ledger.minReaderVersion, LEDGER_READER_VERSION),
      writtenAt: now.toISOString(),
    },
    carriedOf(ledger)
  );
}

/** True when this build may append to the ledger (#99 AC2, ADR-014 §10). */
export function isWritable(ledger: Ledger): boolean {
  return ledger.minReaderVersion <= LEDGER_READER_VERSION;
}

// --- recording ----------------------------------------------------------------

/** The slice of a stored or live match the ledger reads. */
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
  quarters: { id: UUID; index: number; status?: string }[];
  appearances: Appearance[];
  events?: MatchEvent[];
  /** A stored match's availability (`SavedMatch`). */
  availability?: [UUID, AvailabilityStatus][];
  /** A live match's availability (`MatchState`). */
  playerAvailability?: Map<UUID, AvailabilityStatus>;
}

/**
 * A whole number. Every elapsed value is already whole ms (wall-clock
 * differences), and the canonical form refuses anything else (ADR-014 §6);
 * rounding here means a stray fraction costs under a millisecond rather than
 * stopping the recording of a match (proportionality ruling).
 */
const ms = (n: number) => (Number.isFinite(n) ? Math.round(n) : 0);

function eventRecords(record: MatchRecord): LedgerRecord[] {
  const periodOf = new Map(record.quarters.map((q) => [q.id, q.index]));
  return (record.events ?? []).map((e) => ({
    type: 'event',
    matchId: record.match.id,
    id: e.id,
    kind: e.kind,
    playerId: e.playerId ?? null,
    period: periodOf.get(e.quarterId) ?? 0,
    atMs: ms(e.atElapsedMs),
    refersTo: e.refersTo ?? null,
    note: e.note ?? null,
  }));
}

/** Closed appearances only: a running one has no end yet (#75 design). */
function intervalRecords(record: MatchRecord): LedgerRecord[] {
  const periodOf = new Map(record.quarters.map((q) => [q.id, q.index]));
  return record.appearances
    .filter((a) => a.endElapsedMs !== null)
    .map((a) => ({
      type: 'interval',
      matchId: record.match.id,
      id: a.id,
      playerId: a.playerId,
      period: periodOf.get(a.quarterId) ?? 0,
      kind: a.positionKind,
      unit: a.positionUnit ?? null,
      startMs: ms(a.startElapsedMs),
      endMs: ms(a.endElapsedMs as number),
      corrected: a.corrected === true,
      note: a.correctionNote ?? null,
    }));
}

function availabilityOf(record: MatchRecord): [UUID, AvailabilityStatus][] {
  if (record.playerAvailability) return [...record.playerAvailability.entries()];
  return record.availability ?? [];
}

const kickedOff = (record: MatchRecord) =>
  record.quarters.some((q) => q.status !== undefined && q.status !== 'pending');

/**
 * Write this device's matches and squad into the ledger: one new entry
 * holding exactly the records whose canonical form differs from the folded
 * copy (ADR-014 §2). No change, no entry — the same ledger is returned.
 *
 * Nothing absent from `records` is touched, so nothing is ever removed.
 *
 * **Attendance (§4)** is snapshotted the first time the ledger sees a match
 * kicked off with no closed interval yet — that is, at kick-off. A match the
 * ledger first sees already part-played (one recorded before this build, or
 * back-filled into a new chain) gets none: its stored availability is the
 * all-available default, not a measurement, and `attendance.ts` infers its
 * attendance from play instead (ADR-015 §5). Once recorded, attendance is
 * never rewritten from the working document; a change is `correctAttendance`.
 */
export function recordMatches(
  ledger: Ledger,
  records: MatchRecord[],
  players: Player[],
  squadName: string,
  now: Date
): Ledger {
  if (!isWritable(ledger)) return ledger;
  const latest = new Map(latestRecords(ledger.entries));
  const changed: LedgerRecord[] = [];
  const put = (key: string, record: LedgerRecord) => {
    const have = latest.get(key);
    const next = { ...unknownOf(have, FIELDS[record.type]), ...record };
    if (have && sameRecord(have, next)) return;
    latest.set(key, next);
    changed.push(next);
  };

  const squad = latest.get('squad');
  put('squad', {
    type: 'squad',
    id: (squad?.id as string | undefined) ?? ledger.squad.id,
    name: squadName || ((squad?.name as string | undefined) ?? ''),
  });
  for (const p of players) {
    put(`player:${p.id}`, {
      type: 'player',
      id: p.id,
      firstName: p.firstName,
      displaySuffix: p.displaySuffix ?? null,
      active: p.active !== false,
    });
  }

  // Which matches already have intervals or attendance in the chain.
  const played = new Set<string>();
  const attended = new Set<string>();
  for (const r of latest.values()) {
    if (r.type === 'interval') played.add(String(r.matchId));
    if (r.type === 'attendance') attended.add(String(r.matchId));
  }

  for (const record of records) {
    const intervals = intervalRecords(record);
    const events = eventRecords(record);
    const started = kickedOff(record);
    // Not kicked off and nothing recorded: nothing to keep yet.
    if (!started && intervals.length === 0 && events.length === 0) continue;
    const id = record.match.id;
    put(`match:${id}`, {
      type: 'match',
      id,
      kickoffAt: record.match.kickoffAt ?? null,
      opponent: record.match.opponent ?? null,
      competition: record.match.competition ?? null,
      totalMinutes: ms(record.match.totalMinutes),
      periodCount: ms(record.match.quarterCount),
      status: record.match.status,
    });
    if (started && intervals.length === 0 && !played.has(id) && !attended.has(id)) {
      for (const [playerId, status] of availabilityOf(record)) {
        put(`attendance:${id}:${playerId}`, { type: 'attendance', matchId: id, playerId, status, note: null });
      }
      attended.add(id);
    }
    for (const i of intervals) put(`interval:${id}:${String(i.id)}`, i);
    for (const e of events) put(`event:${id}:${String(e.id)}`, e);
  }

  return appendRecords(ledger, changed, now);
}

export type CorrectionResult = { ok: true; ledger: Ledger } | { ok: false; reason: string };

/**
 * Change a player's attendance after kick-off (ADR-014 §4, #102 AC2,
 * invariant 5): a new record carrying a mandatory note. The snapshot it
 * corrects stays in the chain.
 */
export function correctAttendance(
  ledger: Ledger,
  matchId: UUID,
  playerId: UUID,
  status: AvailabilityStatus,
  note: string,
  now: Date
): CorrectionResult {
  if (!isWritable(ledger)) {
    return { ok: false, reason: 'This ledger was written by a newer version of the app.' };
  }
  const trimmed = note.trim();
  if (trimmed === '') return { ok: false, reason: 'A correction needs a note saying why.' };
  if (!ledger.matches.some((m) => m.id === matchId)) {
    return { ok: false, reason: 'That match is not in the ledger.' };
  }
  return {
    ok: true,
    ledger: appendRecords(
      ledger,
      [{ type: 'attendance', matchId, playerId, status, note: trimmed }],
      now
    ),
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

// --- the file -----------------------------------------------------------------

/**
 * The file: the chain, plus a summary a person can read (ADR-014 §10). The
 * folded squad, players and matches are not written. Pretty for an export;
 * compact for the phone's own store.
 */
export function serialiseLedger(ledger: Ledger, pretty = true): string {
  const file = {
    ...carriedOf(ledger),
    ledger: ledger.ledger,
    ledgerVersion: ledger.ledgerVersion,
    minReaderVersion: ledger.minReaderVersion,
    writtenAt: ledger.writtenAt,
    entries: ledger.entries,
    summary: foldLedger(ledger),
  };
  return pretty ? JSON.stringify(file, null, 2) : JSON.stringify(file);
}

export type ParseResult =
  | { ok: true; ledger: Ledger }
  | {
      ok: false;
      reason: string;
      /** Written by a build this one must not write back over (#99 AC2). */
      tooNew?: true;
      /** The chain did not verify: `detail` says where, in plain English (ADR-014 §8). */
      broken?: true;
      detail?: string;
      /** A too-new file that verifies, for viewing only (ADR-014 §10). */
      view?: Ledger;
    };

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const SUMMARY_MISMATCH =
  "This file's totals do not match its playing times. It has been damaged or edited, so nothing was imported.";

/** The summary is for people. If present it must agree with the intervals. */
function summaryAgrees(ledger: Ledger, summary: unknown): boolean {
  if (!Array.isArray(summary)) return true;
  const folded = new Map(foldLedger(ledger).map((t) => [t.playerId, t]));
  for (const s of summary) {
    if (!isObj(s) || typeof s.playerId !== 'string') continue;
    const f = folded.get(s.playerId as UUID);
    if (!f || f.outfieldMs !== s.outfieldMs || f.goalkeeperMs !== s.goalkeeperMs) return false;
  }
  return true;
}

/**
 * Read a ledger file — v2 (a chain) or v1 (upgraded, ADR-014 §7).
 *
 * A v2 chain is verified before anything else is believed. Unknown fields are
 * kept. A `minReaderVersion` newer than this build, a chain that does not
 * verify, or a summary that disagrees is refused with a reason a coach can
 * act on.
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
  const minReader = raw.minReaderVersion === undefined ? 1 : raw.minReaderVersion;
  if (typeof minReader !== 'number' || !Number.isInteger(minReader) || minReader < 1) {
    return { ok: false, reason: 'This minutes file has a damaged version and cannot be trusted.' };
  }
  const header = {
    ledgerVersion: raw.ledgerVersion,
    minReaderVersion: minReader,
    writtenAt: typeof raw.writtenAt === 'string' ? raw.writtenAt : new Date(0).toISOString(),
  };

  if (minReader > LEDGER_READER_VERSION) {
    // Viewable if it is a chain that verifies; never appended to or imported.
    const reason = tooNewLedgerMessage(raw.ledgerVersion, minReader);
    if (Array.isArray(raw.entries) && verifyChain(raw.entries).ok) {
      try {
        const view = fromEntries(raw.entries as LedgerEntry[], header, unknownOf(raw, FILE_FIELDS));
        return { ok: false, reason, tooNew: true, view };
      } catch {
        // A newer shape this build cannot fold: refused, without a view.
      }
    }
    return { ok: false, reason, tooNew: true };
  }

  if (!Array.isArray(raw.entries)) return parseV1(raw, header);

  const verified = verifyChain(raw.entries);
  if (!verified.ok) {
    return {
      ok: false,
      broken: true,
      detail: verified.detail,
      reason: `This minutes file cannot be trusted: ${verified.detail}. Nothing was imported.`,
    };
  }
  let ledger: Ledger;
  try {
    ledger = fromEntries(raw.entries as LedgerEntry[], header, unknownOf(raw, FILE_FIELDS));
  } catch {
    return { ok: false, reason: 'A record in this minutes file is damaged.' };
  }
  if (!summaryAgrees(ledger, raw.summary)) return { ok: false, reason: SUMMARY_MISMATCH };
  return { ok: true, ledger };
}

/**
 * A v1 file (ADR-013), upgraded: its whole content becomes the genesis entry,
 * `from: 'v1'` (ADR-014 §7, #100 AC4). The genesis is stamped with the v1
 * file's own `writtenAt`, so the same v1 file always upgrades to the same
 * chain — two phones that upgrade one export agree, and a failed first save
 * upgrades identically on the next launch.
 */
function parseV1(
  raw: Record<string, unknown>,
  header: { ledgerVersion: number; minReaderVersion: number; writtenAt: string }
): ParseResult {
  if (!isObj(raw.squad) || !Array.isArray(raw.players) || !Array.isArray(raw.matches)) {
    return { ok: false, reason: 'This minutes file is incomplete.' };
  }
  const records: LedgerRecord[] = [
    {
      ...raw.squad,
      type: 'squad',
      id: typeof raw.squad.id === 'string' ? raw.squad.id : '',
      name: typeof raw.squad.name === 'string' ? raw.squad.name : '',
    },
  ];
  for (const p of raw.players) {
    if (!isObj(p) || typeof p.id !== 'string' || typeof p.firstName !== 'string') {
      return { ok: false, reason: 'A player in this file is damaged.' };
    }
    records.push({
      ...p,
      type: 'player',
      displaySuffix: typeof p.displaySuffix === 'string' ? p.displaySuffix : null,
      active: p.active !== false,
    });
  }
  const tail: LedgerRecord[] = [];
  for (const m of raw.matches) {
    if (!isObj(m) || typeof m.id !== 'string' || !Array.isArray(m.intervals)) {
      return { ok: false, reason: 'A match in this file is damaged.' };
    }
    records.push({
      ...unknownOf(m, V1_MATCH_FIELDS),
      type: 'match',
      id: m.id,
      kickoffAt: typeof m.kickoffAt === 'string' ? m.kickoffAt : null,
      opponent: typeof m.opponent === 'string' ? m.opponent : null,
      competition: typeof m.competition === 'string' ? m.competition : null,
      totalMinutes: typeof m.totalMinutes === 'number' ? m.totalMinutes : 0,
      periodCount: typeof m.periodCount === 'number' ? m.periodCount : 0,
      status: typeof m.status === 'string' ? m.status : 'completed',
    });
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
      tail.push({
        ...i,
        type: 'interval',
        matchId: m.id,
        period: typeof i.period === 'number' ? i.period : 0,
        unit: typeof i.unit === 'string' ? i.unit : null,
        corrected: i.corrected === true,
        note: typeof i.note === 'string' ? i.note : null,
      });
    }
    for (const e of Array.isArray(m.events) ? m.events : []) {
      // A damaged event (no id, kind or time) is skipped, as v1 did.
      if (!isObj(e) || typeof e.id !== 'string' || typeof e.kind !== 'string') continue;
      if (typeof e.atMs !== 'number') continue;
      tail.push({
        ...e,
        type: 'event',
        matchId: m.id,
        playerId: typeof e.playerId === 'string' ? e.playerId : null,
        period: typeof e.period === 'number' ? e.period : 0,
        refersTo: typeof e.refersTo === 'string' ? e.refersTo : null,
        note: typeof e.note === 'string' ? e.note : null,
      });
    }
  }

  let ledger: Ledger;
  try {
    const at = new Date(header.writtenAt);
    const genesis = makeEntry(
      null,
      'genesis',
      [...records, ...tail],
      Number.isNaN(at.getTime()) ? new Date(0) : at,
      { from: 'v1' }
    );
    ledger = fromEntries(
      [genesis],
      {
        ledgerVersion: LEDGER_VERSION,
        minReaderVersion: LEDGER_READER_VERSION,
        writtenAt: header.writtenAt,
      },
      unknownOf(raw, V1_FILE_FIELDS)
    );
  } catch {
    // canonical() refused a value — a number that is not a safe integer.
    return { ok: false, reason: 'A value in this minutes file is damaged.' };
  }
  if (!summaryAgrees(ledger, raw.summary)) return { ok: false, reason: SUMMARY_MISMATCH };
  return { ok: true, ledger };
}

// --- import -------------------------------------------------------------------

export type ImportResult =
  | {
      ok: true;
      ledger: Ledger;
      /** Entries appended from the file; 0 when there was nothing new. */
      addedEntries: number;
      addedMatches: number;
      addedPlayers: number;
    }
  | { ok: false; reason: string };

/** True when the ledger holds any match: player time a phone must not lose. */
function holdsPlayerTime(ledger: Ledger): boolean {
  return ledger.matches.length > 0;
}

/**
 * Import a verified file (ADR-014 §9, #100 AC2). Extends, never merges:
 *
 * - this phone holds no player time yet: the file's chain is adopted (a new
 *   phone's own genesis and squad are not player time; the working document
 *   still holds its squad and records it again on the next save);
 * - this phone's chain is a prefix of the file's: the extra entries are
 *   appended verbatim;
 * - the file's chain is a prefix of this phone's: nothing new;
 * - otherwise the chains have diverged and the import is refused (PO ruling
 *   A: one recording phone per match).
 */
export function importLedger(ours: Ledger, file: Ledger): ImportResult {
  if (!isWritable(file)) {
    return { ok: false, reason: tooNewLedgerMessage(file.ledgerVersion, file.minReaderVersion) };
  }
  const counts = (next: Ledger) => ({
    addedMatches: next.matches.filter((m) => !ours.matches.some((o) => o.id === m.id)).length,
    addedPlayers: next.players.filter((p) => !ours.players.some((o) => o.id === p.id)).length,
  });

  if (!holdsPlayerTime(ours)) {
    return { ok: true, ledger: file, addedEntries: file.entries.length, ...counts(file) };
  }

  const shared = Math.min(ours.entries.length, file.entries.length);
  for (let i = 0; i < shared; i++) {
    if (ours.entries[i].hash !== file.entries[i].hash) {
      return {
        ok: false,
        reason:
          `This file's record of the season differs from this phone's from the entry of ` +
          `${whenOf(ours.entries[i].at)}. Only one phone should record matches; import onto a ` +
          `phone that has not recorded its own. Nothing was imported.`,
      };
    }
  }
  if (file.entries.length <= ours.entries.length) {
    return { ok: true, ledger: ours, addedEntries: 0, addedMatches: 0, addedPlayers: 0 };
  }
  const next = fromEntries(
    [...ours.entries, ...file.entries.slice(shared)],
    {
      ledgerVersion: Math.max(ours.ledgerVersion, file.ledgerVersion),
      minReaderVersion: Math.max(ours.minReaderVersion, file.minReaderVersion),
      writtenAt: file.writtenAt,
    },
    { ...carriedOf(file), ...carriedOf(ours) }
  );
  return { ok: true, ledger: next, addedEntries: file.entries.length - shared, ...counts(next) };
}

/** What an import did, in a sentence a coach can read. */
export function describeImport(result: Extract<ImportResult, { ok: true }>): string {
  if (result.addedEntries === 0) return 'Nothing new in that file — everything in it is already here.';
  return (
    `Added ${result.addedMatches} ${result.addedMatches === 1 ? 'match' : 'matches'} and ` +
    `${result.addedPlayers} ${result.addedPlayers === 1 ? 'player' : 'players'}.`
  );
}

/** "minutes-2026-10-03.json". */
export function ledgerFileName(now: Date): string {
  return `minutes-${now.toISOString().slice(0, 10)}.json`;
}

// --- season view ----------------------------------------------------------------

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
