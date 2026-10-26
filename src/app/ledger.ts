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
 * - **Leaving a match out (ADR-020, #187)** is an `exclusion` record, kept like
 *   attendance: written once from the fixture at kick-off, then changed only by
 *   `setMatchExcluded` with a mandatory note, on any match, played or not.
 *   It never removes an interval: `foldLedger` and the file's summary stay
 *   all-matches; the season views leave the match out.
 * - **Forward-compatible (#99 AC2).** Unknown fields and record types are
 *   carried and hashed, never dropped. A file whose `minReaderVersion` is
 *   above this build's is refused for writing.
 * - **First names only (invariant 4).**
 */

import { uuid } from '../types/index';
import type {
  Appearance,
  AvailabilityStatus,
  Format,
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
  keyOf,
  latestRecords,
  makeEntry,
  sameRecord,
  verifyChain,
  whenOf,
  type LedgerEntry,
  type LedgerRecord,
} from './ledgerChain';
import { currentSigner, deviceRecord, publishes, signBody } from './entrySigning';
import {
  KEPT_BY_SAVE,
  SETUP_FIELDS,
  setupRecords,
  toFixture,
  toProfile,
  toSettings,
  type LedgerFixture,
  type LedgerProfile,
  type LedgerSettings,
  type SetupInput,
} from './ledgerSetup';
import { shapeOfFormat } from './shapes';

export type { LedgerFixture, LedgerProfile, LedgerSettings, SetupInput } from './ledgerSetup';

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
  /**
   * The position's role code, e.g. 'RB' (#196 AC4, ADR-021 D2). Absent on an
   * interval recorded before roles were, which reads per unit as before.
   */
  role?: string | null;
}

/** Who was available for a match, snapshotted at kick-off (ADR-014 §4). */
export interface LedgerAttendance {
  playerId: UUID;
  status: AvailabilityStatus;
  /** Mandatory on a change after kick-off (invariant 5); null on the snapshot. */
  note: string | null;
}

/**
 * Whether a match is left out of the figures (ADR-020): the latest revision.
 * Absent on a match with none, which counts.
 */
export interface LedgerExclusion {
  excluded: boolean;
  /** Mandatory on a change after the first record (invariant 5); null on the initial choice. */
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
  /** Left out of averages and season totals (ADR-020). Absent: it counts. */
  excluded?: LedgerExclusion;
  /** Test or void: hidden from every screen, kept in the record (#194, ADR-021 D3). */
  matchKind?: LedgerMatchKind;
  /** How it was actually played (#196 AC3). Absent: read as planned (`structureOf`). */
  structure?: LedgerStructure;
  /** Awards standing for this match (#197); absent when none. Every change stays in the chain. */
  awards?: LedgerAward[];
}

/** The periods a match actually ran, as the clock measured them, or as noted afterwards (#196 AC3). */
export interface LedgerStructure {
  periodCount: number;
  /** Each period's length, in order. */
  periodMs: number[];
  shape: string | null;
  onField: number | null;
  /** Mandatory on a correction (invariant 5); null when the clock wrote it. */
  note: string | null;
}

function toStructure(r: LedgerRecord): LedgerStructure | null {
  if (!Array.isArray(r.periodMs)) return null;
  const periodMs = r.periodMs.filter((x): x is number => typeof x === 'number' && x >= 0);
  return {
    periodCount: typeof r.periodCount === 'number' ? r.periodCount : periodMs.length,
    periodMs,
    shape: typeof r.shape === 'string' ? r.shape : null,
    onField: typeof r.onField === 'number' ? r.onField : null,
    note: typeof r.note === 'string' ? r.note : null,
  };
}

/** True when the coach has left this match out of the figures (ADR-020). */
export function isExcluded(match: Pick<LedgerMatch, 'excluded'>): boolean {
  return match.excluded?.excluded === true;
}

/**
 * What a match is, when the coach has said (#194, ADR-021 D3): a `test` or a
 * `void` match is hidden from every screen; `real` undoes that. Latest wins,
 * with a note. An older build carries the record and shows the match.
 */
export interface LedgerMatchKind {
  kind: 'real' | 'test' | 'void' | (string & Record<never, never>);
  note: string | null;
}

/** Hidden from every screen: marked a test or void. The record keeps it. */
export function isHidden(match: Pick<LedgerMatch, 'matchKind'>): boolean {
  return match.matchKind?.kind === 'test' || match.matchKind?.kind === 'void';
}

/**
 * The ledger as every screen sees it: hidden matches gone (#194). Recording,
 * export and import keep using the whole ledger, so nothing leaves the record.
 */
export function visibleLedger(ledger: Ledger): Ledger {
  if (!ledger.matches.some(isHidden)) return ledger;
  return { ...ledger, matches: ledger.matches.filter((m) => !isHidden(m)) };
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
  /**
   * False when the time is not known (#196 AC2, ADR-021 D1): `period` is 0
   * and `atMs` is 0, so the released build, which needs a number, still
   * reads it. Such an event counts in the score and in no per-time figure.
   */
  timeKnown?: false;
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
  /** Fixtures as the coach made them, cancelled ones included (#195 AC2). */
  fixtures: LedgerFixture[];
  /** Each child's profile, where one is recorded (#195 AC3, #190). */
  profiles: LedgerProfile[];
  /** The squad's defaults, once recorded (#195 AC3). */
  settings: LedgerSettings | null;
  /** Award types, the defaults first, retired ones included (#197). */
  awardTypes: LedgerAwardType[];
  /** Tally kinds the coach added in Settings (#198); the built-in ones are not records. */
  eventTypes: LedgerEventType[];
  /** The team's seasons (#243, ADR-022 D5), oldest first. None: one implicit first season. */
  seasons: LedgerSeason[];
  /** Set on a view of one season (`ledgerForSeason`); never on the ledger itself, never stored. */
  viewSeason?: UUID;
}

/**
 * A team's season (#243 AC2, ADR-022 D5): the coach's settings, never a
 * figure. Latest record wins. Absent means absent: nothing is written for
 * the coach (AC11).
 */
export interface LedgerSeason {
  id: UUID;
  /** "2026–27"; null reads "This season". */
  name: string | null;
  startedAt: string;
  /** Players a side; null: the dominating side, as before seasons (ADR-015 §6a). */
  mainSide: number | null;
  /** 'U7' … 'U18'; null: not set, never guessed. */
  ageGroup: string | null;
  level: 'development' | 'competitive' | null;
  /** Only 'full' in 2.0.0. */
  lens: string;
  note: string | null;
}

/** A kind of coach's tally added without a release (#198 AC2). Its events' kind is `tally:<id>`. */
export interface LedgerEventType {
  id: UUID;
  label: string;
  /** Always 'tally' from this build; a later build's 'core' kind is carried, never counted as core here. */
  tier: string;
  /** Credited to the child tapped, or to the team. */
  credited: 'child' | 'team';
  active: boolean;
}

/** A kind of award (#197): Player of the Week, Mr Assister, or one the coach added. */
export interface LedgerAwardType {
  id: UUID;
  name: string;
  /** False once retired: not offered for new awards; past ones still show. */
  active: boolean;
}

/** One child's award in one match (#197). Joint winners are one each. */
export interface LedgerAward {
  awardTypeId: UUID;
  playerId: UUID;
  note: string | null;
}

/**
 * The two every match report names (#197 AC1). Fixed ids, so renaming or
 * retiring one is a record against the same id on every phone.
 */
export const DEFAULT_AWARD_TYPES: readonly LedgerAwardType[] = [
  { id: 'player-of-the-week' as UUID, name: 'Player of the Week', active: true },
  { id: 'mr-assister' as UUID, name: 'Mr Assister', active: true },
];

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
    'role',
  ],
  event: ['type', 'matchId', 'id', 'kind', 'playerId', 'period', 'atMs', 'refersTo', 'note', 'timeKnown'],
  structure: ['type', 'matchId', 'periodCount', 'periodMs', 'shape', 'onField', 'note'],
  'award-type': ['type', 'id', 'name', 'active', 'note'],
  award: ['type', 'matchId', 'awardTypeId', 'playerId', 'given', 'note'],
  'event-type': ['type', 'id', 'label', 'tier', 'credited', 'active', 'note'],
  attendance: ['type', 'matchId', 'playerId', 'status', 'note'],
  exclusion: ['type', 'matchId', 'excluded', 'note'],
  'match-kind': ['type', 'matchId', 'kind', 'note'],
  season: ['type', 'id', 'name', 'startedAt', 'mainSide', 'ageGroup', 'level', 'lens', 'note'],
  ...SETUP_FIELDS,
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
  'fixtures',
  'profiles',
  'settings',
  'awardTypes',
  'eventTypes',
  'seasons',
  'viewSeason',
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
      case 'exclusion':
        return str(r.matchId) && typeof r.excluded === 'boolean';
      case 'match-kind':
        return str(r.matchId) && str(r.kind);
      default:
        return true;
    }
  })();
  if (!ok) throw new DamagedRecord(r.type);
}

/** The ledger's squad, players and matches, folded from its chain. */
function foldView(
  entries: LedgerEntry[]
): Pick<
  Ledger,
  'squad' | 'players' | 'matches' | 'fixtures' | 'profiles' | 'settings' | 'awardTypes' | 'eventTypes' | 'seasons'
> {
  let squad: Ledger['squad'] = { id: '' as UUID, name: '' };
  const players: LedgerPlayer[] = [];
  const matches = new Map<UUID, LedgerMatch>();
  const intervals = new Map<UUID, LedgerInterval[]>();
  const events = new Map<UUID, LedgerEvent[]>();
  const attendance = new Map<UUID, LedgerAttendance[]>();
  const exclusions = new Map<UUID, LedgerExclusion>();
  const kinds = new Map<UUID, LedgerMatchKind>();
  const fixtures: LedgerFixture[] = [];
  const profiles: LedgerProfile[] = [];
  let settings: LedgerSettings | null = null;
  const structures = new Map<UUID, LedgerStructure>();
  const awardTypes = new Map<UUID, LedgerAwardType>(DEFAULT_AWARD_TYPES.map((t) => [t.id, t]));
  const awards = new Map<UUID, LedgerAward[]>();
  const eventTypes = new Map<UUID, LedgerEventType>();
  const seasons = new Map<UUID, LedgerSeason>();
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
          role: typeof r.role === 'string' ? r.role : null,
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
          ...(r.timeKnown === false ? { timeKnown: false as const } : {}),
        });
        break;
      case 'attendance':
        matchFor(r.matchId as UUID);
        push(attendance, r.matchId as UUID, {
          ...untag<LedgerAttendance>(r),
          note: typeof r.note === 'string' ? r.note : null,
        });
        break;
      case 'exclusion':
        matchFor(r.matchId as UUID);
        exclusions.set(r.matchId as UUID, {
          excluded: r.excluded === true,
          note: typeof r.note === 'string' ? r.note : null,
        });
        break;
      case 'match-kind':
        matchFor(r.matchId as UUID);
        kinds.set(r.matchId as UUID, { kind: String(r.kind), note: typeof r.note === 'string' ? r.note : null });
        break;
      // ADR-021 D2. A damaged one is left out rather than refusing the file:
      // the released build, which does not fold them, would read it.
      case 'fixture': {
        const f = toFixture(r);
        if (f) fixtures.push(f);
        break;
      }
      case 'profile': {
        const p = toProfile(r);
        if (p) profiles.push(p);
        break;
      }
      case 'settings':
        settings = toSettings(r);
        break;
      case 'structure': {
        const st = toStructure(r);
        if (st) structures.set(r.matchId as UUID, st);
        break;
      }
      case 'season': {
        const s = toSeason(r);
        if (s) seasons.set(s.id, s);
        break;
      }
      case 'award-type':
        if (typeof r.id === 'string' && typeof r.name === 'string') {
          awardTypes.set(r.id as UUID, { id: r.id as UUID, name: r.name, active: r.active !== false });
        }
        break;
      case 'event-type':
        if (typeof r.id === 'string' && typeof r.label === 'string') {
          eventTypes.set(r.id as UUID, {
            id: r.id as UUID,
            label: r.label,
            tier: typeof r.tier === 'string' ? r.tier : 'tally',
            credited: r.credited === 'team' ? 'team' : 'child',
            active: r.active !== false,
          });
        }
        break;
      case 'award':
        if (typeof r.matchId === 'string' && typeof r.awardTypeId === 'string' && typeof r.playerId === 'string' && r.given !== false) {
          push(awards, r.matchId as UUID, {
            awardTypeId: r.awardTypeId as UUID,
            playerId: r.playerId as UUID,
            note: typeof r.note === 'string' ? r.note : null,
          });
        }
        break;
    }
  }

  return {
    squad,
    players,
    matches: [...matches.values()].map((m) => {
      const ev = events.get(m.id);
      const att = attendance.get(m.id);
      const exc = exclusions.get(m.id);
      const kind = kinds.get(m.id);
      const st = structures.get(m.id);
      const aw = awards.get(m.id);
      return {
        ...m,
        intervals: (intervals.get(m.id) ?? []).sort(byStart),
        ...(ev ? { events: ev.sort(byTime) } : {}),
        ...(att ? { attendance: att } : {}),
        ...(exc ? { excluded: exc } : {}),
        ...(kind ? { matchKind: kind } : {}),
        ...(st ? { structure: st } : {}),
        ...(aw ? { awards: aw } : {}),
      };
    }),
    fixtures,
    profiles,
    settings,
    awardTypes: [...awardTypes.values()],
    eventTypes: [...eventTypes.values()],
    seasons: [...seasons.values()].sort((a, b) => a.startedAt.localeCompare(b.startedAt)),
  };
}

const LEVELS: readonly string[] = ['development', 'competitive'];

function toSeason(r: LedgerRecord): LedgerSeason | null {
  if (typeof r.id !== 'string' || typeof r.startedAt !== 'string') return null;
  const text = (v: unknown) => (typeof v === 'string' && v !== '' ? v : null);
  return {
    id: r.id as UUID,
    name: text(r.name),
    startedAt: r.startedAt,
    mainSide: typeof r.mainSide === 'number' && r.mainSide > 0 ? r.mainSide : null,
    ageGroup: text(r.ageGroup),
    level: LEVELS.includes(String(r.level)) ? (r.level as LedgerSeason['level']) : null,
    lens: text(r.lens) ?? 'full',
    note: text(r.note),
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
  const { records, seal } = signing([], [{ type: 'squad', id: squadId, name: squadName }]);
  const genesis = makeEntry(null, 'genesis', records, now, follows ? { from: 'new', follows } : { from: 'new' }, seal);
  return fromEntries([genesis], {
    ledgerVersion: LEDGER_VERSION,
    minReaderVersion: LEDGER_READER_VERSION,
    writtenAt: now.toISOString(),
  });
}

/**
 * How this install signs a new entry (#193): with no signer installed,
 * unchanged. The first entry it signs in a chain also publishes its key.
 */
function signing(
  entries: readonly LedgerEntry[],
  records: LedgerRecord[]
): { records: LedgerRecord[]; seal: (body: Record<string, unknown>) => Record<string, unknown> } {
  const by = currentSigner();
  if (!by) return { records, seal: (body) => body };
  return {
    records: publishes(entries, by.deviceId) ? records : [deviceRecord(by), ...records],
    seal: (body) => signBody(body, by),
  };
}

/** Append one entry holding `records`. Nothing to record, nothing appended. */
function appendRecords(ledger: Ledger, changed: LedgerRecord[], now: Date): Ledger {
  if (changed.length === 0) return ledger;
  const last = ledger.entries[ledger.entries.length - 1] ?? null;
  const { records, seal } = signing(ledger.entries, changed);
  const entries = [...ledger.entries, makeEntry(last, last ? 'record' : 'genesis', records, now, {}, seal)];
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

/**
 * Append `from`'s records whose key `pick` keeps onto `into`, one entry per
 * entry of `from` that holds any, at that entry's time, so each record's
 * history (and its notes) comes too. Nothing kept, nothing appended.
 */
export function carryRecords(into: Ledger, from: Ledger, pick: (key: string) => boolean): Ledger {
  let next = into;
  for (const entry of from.entries) {
    const records = entry.records.filter((r) => {
      const key = keyOf(r);
      return key !== null && pick(key);
    });
    const at = new Date(entry.at);
    next = appendRecords(next, records, Number.isNaN(at.getTime()) ? new Date(0) : at);
  }
  // Older entries' times are kept on the entries; the file is written now-ish.
  return next === into || next.writtenAt >= into.writtenAt ? next : { ...next, writtenAt: into.writtenAt };
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
    /** The fixture's initial choice (ADR-020); taken over by the ledger on first sight. */
    excludeFromStats?: boolean;
    /** A test match (#194, ADR-021 D3): never recorded. */
    test?: unknown;
  };
  quarters: { id: UUID; index: number; status?: string; accumulatedMs?: number }[];
  appearances: Appearance[];
  events?: MatchEvent[];
  /** The shape it is played in: each interval's role (#196 AC4) and the structure (AC3). */
  format?: Format;
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
  const roleOf = new Map((record.format?.positions ?? []).map((p) => [p.id, p.roleCode ?? null]));
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
      role: roleOf.get(a.positionId) ?? null,
    }));
}

/**
 * The structure the clock ran (#196 AC3, PO ruling 18 Oct): the periods
 * that ended, each as long as it was played, so a match ended early says
 * so. Null before the first period ends.
 */
function structureRecord(record: MatchRecord): LedgerRecord | null {
  const ended = record.quarters
    .filter((q) => q.status === 'ended')
    .sort((a, b) => a.index - b.index);
  if (ended.length === 0) return null;
  return {
    type: 'structure',
    matchId: record.match.id,
    periodCount: ended.length,
    periodMs: ended.map((q) => ms(q.accumulatedMs ?? 0)),
    shape: record.format ? shapeOfFormat(record.format) : null,
    onField: record.format ? record.format.onFieldCount : null,
    note: null,
  };
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
  now: Date,
  /**
   * Fixtures, profiles and settings (#195 AC2, AC3). Only from a session this
   * launch read and may write: defaults from an unreadable one must never be
   * recorded over the coach's real settings.
   */
  setup?: SetupInput
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
    // A test match never enters the record (#194, ADR-021 D3). The app never
    // passes one (`recordable`); this is the second lock on the same door.
    if (record.match.test !== undefined && record.match.test !== null) continue;
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
    // The fixture's choice, taken over the first time the ledger sees the
    // match. After that the ledger is the only truth: a later change is
    // `setMatchExcluded`, and the working document is never read again.
    if (record.match.excludeFromStats === true && !latest.has(`exclusion:${id}`)) {
      put(`exclusion:${id}`, { type: 'exclusion', matchId: id, excluded: true, note: null });
    }
    if (started && intervals.length === 0 && !played.has(id) && !attended.has(id)) {
      for (const [playerId, status] of availabilityOf(record)) {
        put(`attendance:${id}:${playerId}`, { type: 'attendance', matchId: id, playerId, status, note: null });
      }
      attended.add(id);
    }
    const freshIntervals = intervals.some((i) => !latest.has(`interval:${id}:${String(i.id)}`));
    for (const i of intervals) {
      // An interval already in the chain keeps the role it was recorded with,
      // or none (#196 AC4): it is never rewritten for a role; older ones read per unit.
      const key = `interval:${id}:${String(i.id)}`;
      const have = latest.get(key);
      put(key, have ? { ...i, role: have.role } : i);
    }
    // How it was played, written by the save that closes a period (#196
    // AC3): the one bringing new intervals. Never over a noted correction;
    // never for a match first seen already played (one from before this
    // build reads as planned).
    const st = structureRecord(record);
    const stHave = latest.get(`structure:${id}`);
    if (st && freshIntervals && (stHave === undefined || stHave.note === null)) {
      put(`structure:${id}`, st);
    }
    for (const e of events) put(`event:${id}:${String(e.id)}`, e);
  }

  if (setup) {
    // A save never decides a fairness mark, a cancellation or a note: those
    // are explicit acts (`setPlayerFairness`, `cancelFixture`). It carries
    // them, and a record it does write for another reason starts without the
    // earlier note, which belonged to the earlier change.
    const squadId = ((latest.get('squad')?.id as string | undefined) ?? ledger.squad.id) as UUID;
    for (const [key, record] of setupRecords(squadId, setup)) {
      const have = latest.get(key);
      const next: LedgerRecord = { ...unknownOf(have, FIELDS[record.type]), ...record };
      if (have) {
        for (const f of KEPT_BY_SAVE[record.type] ?? []) if (have[f] !== undefined) next[f] = have[f];
        if (record.type === 'fixture' && have.state === 'cancelled') next.state = 'cancelled';
        if (sameRecord(have, next)) continue;
        if ('note' in next) next.note = null;
      }
      latest.set(key, next);
      changed.push(next);
    }
  }

  return appendRecords(ledger, changed, now);
}

/** The latest record under `key`, or undefined. */
function latestOf(ledger: Ledger, key: string): LedgerRecord | undefined {
  return latestRecords(ledger.entries).get(key);
}

const READ_ONLY: CorrectionResult = { ok: false, reason: 'This ledger was written by a newer version of the app.' };

/**
 * Mark a child as not counted in the squad's fairness figures, or counted
 * again (#190 AC1, AC4). A new `profile` record with a mandatory note
 * (invariant 5); the earlier one stays in the chain. The mark applies to the
 * whole season (PO ruling, 18 Oct). No interval is touched (AC5).
 */
export function setPlayerFairness(
  ledger: Ledger,
  playerId: UUID,
  counted: boolean,
  note: string,
  now: Date
): CorrectionResult {
  if (!isWritable(ledger)) return READ_ONLY;
  const trimmed = note.trim();
  if (trimmed === '') return { ok: false, reason: 'A change needs a note saying why.' };
  if (!ledger.players.some((p) => p.id === playerId)) {
    return { ok: false, reason: 'That player is not in the record yet.' };
  }
  if (isCountedInFairness(ledger, playerId) === counted) {
    return { ok: false, reason: counted ? 'They are already counted.' : 'They are already not counted.' };
  }
  const have = latestOf(ledger, `profile:${playerId}`);
  const player = ledger.players.find((p) => p.id === playerId);
  const base: LedgerRecord = have ?? {
    type: 'profile',
    playerId,
    keeperPreference: null,
    prefers: null,
    outfieldTarget: null,
    active: player?.active !== false,
    removed: false,
  };
  return {
    ok: true,
    ledger: appendRecords(
      ledger,
      [{ ...base, type: 'profile', playerId, fairness: counted ? 'counted' : 'not-counted', note: trimmed }],
      now
    ),
  };
}

/** True unless the record marks this child not counted in fairness (#190). */
export function isCountedInFairness(ledger: Pick<Ledger, 'profiles'> | null, playerId: UUID): boolean {
  return ledger?.profiles.find((p) => p.playerId === playerId)?.fairness !== 'not-counted';
}

/** Children the record marks not counted in fairness (#190): fill-ins. */
export function notCountedIds(ledger: Pick<Ledger, 'profiles'> | null): Set<UUID> {
  return new Set((ledger?.profiles ?? []).filter((p) => p.fairness === 'not-counted').map((p) => p.playerId));
}

export interface FairnessChange {
  at: string;
  counted: boolean;
  note: string | null;
}

/** Every time the mark changed, oldest first, with its note (#190 AC4: kept with their history). */
export function fairnessHistory(ledger: Ledger, playerId: UUID): FairnessChange[] {
  const out: FairnessChange[] = [];
  let was = 'counted';
  for (const entry of ledger.entries) {
    for (const r of entry.records) {
      if (r.type !== 'profile' || r.playerId !== playerId) continue;
      const now = typeof r.fairness === 'string' ? r.fairness : 'counted';
      if (now === was) continue;
      out.push({ at: entry.at, counted: now !== 'not-counted', note: typeof r.note === 'string' ? r.note : null });
      was = now;
    }
  }
  return out;
}

/**
 * A fixture deleted before it was played (#195 AC2): a new `fixture` record
 * saying it was cancelled, never a deletion from the record. Nothing to do
 * for one the record never held, or one already cancelled.
 */
export function cancelFixture(ledger: Ledger, matchId: UUID, now: Date): Ledger {
  if (!isWritable(ledger)) return ledger;
  const have = latestOf(ledger, `fixture:${matchId}`);
  if (!have || have.state === 'cancelled') return ledger;
  return appendRecords(ledger, [{ ...have, state: 'cancelled', note: 'Deleted before it was played' }], now);
}

/**
 * Players taken out of the squad before they ever played (`removePlayer`
 * deletes them from the squad): a `profile` saying so, so a restore from the
 * record leaves them out. Their `player` record stays, as everything does.
 */
export function recordRemovedPlayers(ledger: Ledger, playerIds: readonly UUID[], now: Date): Ledger {
  if (!isWritable(ledger)) return ledger;
  const records: LedgerRecord[] = [];
  for (const playerId of playerIds) {
    const have = latestOf(ledger, `profile:${playerId}`);
    const player = ledger.players.find((p) => p.id === playerId);
    if (have?.removed === true || (!have && !player)) continue;
    records.push({
      ...(have ?? {
        type: 'profile',
        playerId,
        keeperPreference: null,
        prefers: null,
        outfieldTarget: null,
        active: player?.active !== false,
        fairness: 'counted',
      }),
      removed: true,
      note: null,
    });
  }
  return appendRecords(ledger, records, now);
}

export type CorrectionResult = { ok: true; ledger: Ledger } | { ok: false; reason: string };

/** The first season's fixed id (ADR-022 D5): a match whose fixture names no season belongs to it. */
export const FIRST_SEASON_ID = 'first-season' as UUID;

/** Age groups a season may name (#224 AC5): U7 to U18. */
export const AGE_GROUPS: readonly string[] = Array.from({ length: 12 }, (_, i) => `U${i + 7}`);

/** Main formats 2.0.0 offers, as players a side (#224 T9): 5 and 7. */
export const MAIN_SIDES: readonly number[] = [5, 7];

/** A season name's limit (#243 Q4). */
export const SEASON_NAME_MAX = 16;

export interface SeasonInput {
  id: UUID;
  name: string | null;
  mainSide: number | null;
  ageGroup: string | null;
  level: 'development' | 'competitive' | null;
  note?: string | null;
}

/**
 * Write a season's settings (#243 AC1, AC2, AC4, AC9; ADR-022 D5): start a
 * new one, confirm the first, or set its main format later. Only the
 * coach's inputs; nothing is filled in on their behalf. A season keeps the
 * time it started; only 'full' fairness exists in 2.0.0.
 */
export function saveSeason(ledger: Ledger, input: SeasonInput, now: Date): CorrectionResult {
  if (!isWritable(ledger)) return READ_ONLY;
  const name = input.name?.trim() ?? '';
  if (name.length > SEASON_NAME_MAX) return { ok: false, reason: `A season name is up to ${SEASON_NAME_MAX} characters.` };
  if (input.ageGroup !== null && !AGE_GROUPS.includes(input.ageGroup)) {
    return { ok: false, reason: 'The age group is U7 to U18.' };
  }
  if (input.mainSide !== null && !MAIN_SIDES.includes(input.mainSide)) {
    return { ok: false, reason: 'The main format is 5-a-side or 7-a-side.' };
  }
  const have = ledger.seasons.find((x) => x.id === input.id);
  return {
    ok: true,
    ledger: appendRecords(
      ledger,
      [
        {
          type: 'season',
          id: input.id,
          name: name === '' ? null : name,
          startedAt: have?.startedAt ?? now.toISOString(),
          mainSide: input.mainSide,
          ageGroup: input.ageGroup,
          level: input.level,
          lens: 'full',
          note: input.note?.trim() || null,
        },
      ],
      now
    ),
  };
}

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

/**
 * Leave a match out of the figures, or count it again (ADR-020, #187). Works
 * on any match in the ledger, played or not, so it can be applied
 * retrospectively. A new `exclusion` record with a mandatory note (invariant
 * 5): the earlier choice stays in the chain, and no interval is touched.
 */
export function setMatchExcluded(
  ledger: Ledger,
  matchId: UUID,
  excluded: boolean,
  note: string,
  now: Date
): CorrectionResult {
  if (!isWritable(ledger)) {
    return { ok: false, reason: 'This ledger was written by a newer version of the app.' };
  }
  const trimmed = note.trim();
  if (trimmed === '') return { ok: false, reason: 'A change needs a note saying why.' };
  const match = ledger.matches.find((m) => m.id === matchId);
  if (!match) return { ok: false, reason: 'That match is not in the ledger.' };
  if (isExcluded(match) === excluded) {
    return {
      ok: false,
      reason: excluded ? 'That match is already left out of the figures.' : 'That match already counts.',
    };
  }
  return {
    ok: true,
    ledger: appendRecords(ledger, [{ type: 'exclusion', matchId, excluded, note: trimmed }], now),
  };
}

/**
 * Mark a match as a test or void, or as real again (#194). A new `match-kind`
 * record with a mandatory note (invariant 5); no interval is touched, and the
 * earlier record stays in the chain.
 */
export function setMatchKind(
  ledger: Ledger,
  matchId: UUID,
  kind: 'real' | 'test' | 'void',
  note: string,
  now: Date
): CorrectionResult {
  if (!isWritable(ledger)) {
    return { ok: false, reason: 'This ledger was written by a newer version of the app.' };
  }
  const trimmed = note.trim();
  if (trimmed === '') return { ok: false, reason: 'A change needs a note saying why.' };
  const match = ledger.matches.find((m) => m.id === matchId);
  if (!match) return { ok: false, reason: 'That match is not in the ledger.' };
  if ((match.matchKind?.kind ?? 'real') === kind) return { ok: false, reason: 'That match is already marked so.' };
  return {
    ok: true,
    ledger: appendRecords(ledger, [{ type: 'match-kind', matchId, kind, note: trimmed }], now),
  };
}

/**
 * A goal or a goal against whose time is not known, entered from a played
 * match's page (#196 AC2, PO ruling 18 Oct): e.g. the 3 Oct cup match,
 * imported from paper with no goal events. A new `event` record with
 * `timeKnown: false`, period 0 and `atMs` 0, so the released build still
 * reads it (ADR-021 D1). A goal's scorer may be unknown (null). The note is
 * mandatory: it says where the goal is known from (invariant 5).
 */
export function addUnknownTimeEvent(
  ledger: Ledger,
  matchId: UUID,
  kind: 'goal' | 'conceded',
  playerId: UUID | null,
  note: string,
  now: Date
): CorrectionResult {
  if (!isWritable(ledger)) return READ_ONLY;
  const trimmed = note.trim();
  if (trimmed === '') return { ok: false, reason: 'Say where this is known from, e.g. "Match report".' };
  if (!ledger.matches.some((m) => m.id === matchId)) return { ok: false, reason: 'That match is not in the ledger.' };
  if (kind === 'conceded' && playerId !== null) return { ok: false, reason: 'A goal against is credited to no one here.' };
  return {
    ok: true,
    ledger: appendRecords(
      ledger,
      [
        {
          type: 'event',
          matchId,
          id: uuid(),
          kind,
          playerId,
          period: 0,
          atMs: 0,
          refersTo: null,
          note: trimmed,
          timeKnown: false,
        },
      ],
      now
    ),
  };
}

/**
 * Take back an event from the record (#196, invariant 5): a `withdrawn`
 * event naming it, with a mandatory note. The event stays in the chain.
 */
export function withdrawRecordEvent(
  ledger: Ledger,
  matchId: UUID,
  eventId: UUID,
  note: string,
  now: Date
): CorrectionResult {
  if (!isWritable(ledger)) return READ_ONLY;
  const trimmed = note.trim();
  if (trimmed === '') return { ok: false, reason: 'Taking a goal back needs a note saying why.' };
  const match = ledger.matches.find((m) => m.id === matchId);
  const events = match?.events ?? [];
  const target = events.find((e) => e.id === eventId);
  if (!target || target.kind === 'withdrawn') return { ok: false, reason: 'That is not in the record for this match.' };
  if (events.some((e) => e.kind === 'withdrawn' && e.refersTo === eventId)) {
    return { ok: false, reason: 'That has already been taken back.' };
  }
  return {
    ok: true,
    ledger: appendRecords(
      ledger,
      [
        {
          type: 'event',
          matchId,
          id: uuid(),
          kind: 'withdrawn',
          playerId: null,
          period: target.period,
          atMs: target.atMs,
          refersTo: eventId,
          note: trimmed,
          ...(target.timeKnown === false ? { timeKnown: false } : {}),
        },
      ],
      now
    ),
  };
}

/**
 * Correct how a match was played (#196 AC3, PO ruling 18 Oct), e.g. halves
 * that turned into quarters: a new `structure` record with a mandatory note.
 * The clock's record stays in the chain. Minutes are never touched: they
 * fold from the intervals.
 */
export function correctStructure(
  ledger: Ledger,
  matchId: UUID,
  periodMs: readonly number[],
  note: string,
  now: Date
): CorrectionResult {
  if (!isWritable(ledger)) return READ_ONLY;
  const trimmed = note.trim();
  if (trimmed === '') return { ok: false, reason: 'A correction needs a note saying why.' };
  const match = ledger.matches.find((m) => m.id === matchId);
  if (!match) return { ok: false, reason: 'That match is not in the ledger.' };
  if (periodMs.length === 0 || periodMs.some((p) => !Number.isFinite(p) || p <= 0)) {
    return { ok: false, reason: 'Each period needs a length.' };
  }
  const have = latestOf(ledger, `structure:${matchId}`);
  return {
    ok: true,
    ledger: appendRecords(
      ledger,
      [
        {
          type: 'structure',
          matchId,
          periodCount: periodMs.length,
          periodMs: periodMs.map(ms),
          shape: (have?.shape as string | null | undefined) ?? match.structure?.shape ?? null,
          onField: (have?.onField as number | null | undefined) ?? match.structure?.onField ?? null,
          note: trimmed,
        },
      ],
      now
    ),
  };
}

// --- the coach's tallies (#198) ---------------------------------------------------

const TALLY_LABEL_MAX = 20;
/** Built-in kinds' words, so a new kind cannot be confused with one (#198 AC1). */
const BUILT_IN_WORDS = [
  'goal',
  'assist',
  'conceded',
  'save',
  'tackle',
  // #228 AC6: the short labels and the old words are both taken.
  'shot',
  'corner',
  'free kick',
  'corner won',
  'free kick won',
  'shot on target',
];

/**
 * Settings › Tallies: a new kind of coach's tally, without a release (#198
 * AC2). An `event-type` record; the released build carries it untouched.
 */
export function addEventType(ledger: Ledger, label: string, credited: 'child' | 'team', now: Date): CorrectionResult {
  if (!isWritable(ledger)) return READ_ONLY;
  const clean = label.trim().replace(/\s+/g, ' ');
  if (clean === '' || clean.length > TALLY_LABEL_MAX) {
    return { ok: false, reason: `A tally needs a name of up to ${TALLY_LABEL_MAX} letters.` };
  }
  const lower = clean.toLowerCase();
  if (BUILT_IN_WORDS.includes(lower) || ledger.eventTypes.some((t) => t.label.toLowerCase() === lower)) {
    return { ok: false, reason: 'There is already a tally with that name.' };
  }
  return {
    ok: true,
    ledger: appendRecords(
      ledger,
      [{ type: 'event-type', id: uuid(), label: clean, tier: 'tally', credited, active: true, note: null }],
      now
    ),
  };
}

/** Stop offering a tally kind, or offer it again (#198). Its events stay in the record. */
export function setEventTypeActive(ledger: Ledger, id: UUID, active: boolean, now: Date): CorrectionResult {
  if (!isWritable(ledger)) return READ_ONLY;
  const have = ledger.eventTypes.find((t) => t.id === id);
  if (!have) return { ok: false, reason: 'That tally is not in the record.' };
  if (have.active === active) return { ok: false, reason: 'Nothing has changed.' };
  return { ok: true, ledger: appendRecords(ledger, [{ type: 'event-type', ...have, active, note: null }], now) };
}

// --- awards (#197) ---------------------------------------------------------------

const AWARD_NAME_MAX = 24;

function awardName(raw: string): string | null {
  const name = raw.trim().replace(/\s+/g, ' ');
  return name === '' || name.length > AWARD_NAME_MAX ? null : name;
}

/** Settings › Awards: a new kind of award (#197 AC1). */
export function addAwardType(ledger: Ledger, name: string, now: Date): CorrectionResult {
  if (!isWritable(ledger)) return READ_ONLY;
  const clean = awardName(name);
  if (!clean) return { ok: false, reason: `An award needs a name of up to ${AWARD_NAME_MAX} letters.` };
  if (ledger.awardTypes.some((t) => t.name.toLowerCase() === clean.toLowerCase())) {
    return { ok: false, reason: 'There is already an award with that name.' };
  }
  return { ok: true, ledger: appendRecords(ledger, [{ type: 'award-type', id: uuid(), name: clean, active: true, note: null }], now) };
}

/** Rename, retire or bring back an award type (#197 AC1). Retiring keeps every past award. */
export function updateAwardType(
  ledger: Ledger,
  id: UUID,
  change: { name?: string; active?: boolean },
  now: Date
): CorrectionResult {
  if (!isWritable(ledger)) return READ_ONLY;
  const have = ledger.awardTypes.find((t) => t.id === id);
  if (!have) return { ok: false, reason: 'That award is not in the record.' };
  const name = change.name === undefined ? have.name : awardName(change.name);
  if (!name) return { ok: false, reason: `An award needs a name of up to ${AWARD_NAME_MAX} letters.` };
  if (ledger.awardTypes.some((t) => t.id !== id && t.name.toLowerCase() === name.toLowerCase())) {
    return { ok: false, reason: 'There is already an award with that name.' };
  }
  const active = change.active ?? have.active;
  if (name === have.name && active === have.active) return { ok: false, reason: 'Nothing has changed.' };
  return { ok: true, ledger: appendRecords(ledger, [{ type: 'award-type', id, name, active, note: null }], now) };
}

/** The day a match was played, for "a change after the day needs a note": kick-off, else when the record first saw it. */
function matchDayOf(ledger: Ledger, match: LedgerMatch): string | null {
  if (match.kickoffAt) return match.kickoffAt;
  for (const e of ledger.entries) {
    if (e.records.some((r) => r.type === 'match' && r.id === match.id)) return e.at;
  }
  return null;
}

const localDay = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

/** True when `now` is on a later day than the match (#197 AC2): a change then needs a note. */
export function afterMatchDay(ledger: Ledger, matchId: UUID, now: Date): boolean {
  const match = ledger.matches.find((m) => m.id === matchId);
  const day = match ? matchDayOf(ledger, match) : null;
  return day !== null && localDay(now.toISOString()) !== localDay(day) && now.getTime() > Date.parse(day);
}

/**
 * Give an award to a child for a match (#197 AC2). Joint winners are allowed
 * (PO ruling, 18 Oct): giving the same award to another child adds a winner.
 * The note is optional.
 */
export function giveAward(
  ledger: Ledger,
  matchId: UUID,
  awardTypeId: UUID,
  playerId: UUID,
  note: string,
  now: Date
): CorrectionResult {
  if (!isWritable(ledger)) return READ_ONLY;
  const match = ledger.matches.find((m) => m.id === matchId);
  if (!match) return { ok: false, reason: 'That match is not in the ledger.' };
  const type = ledger.awardTypes.find((t) => t.id === awardTypeId);
  if (!type || !type.active) return { ok: false, reason: 'That award is not offered any more.' };
  if (!ledger.players.some((p) => p.id === playerId)) return { ok: false, reason: 'That player is not in the record.' };
  if ((match.awards ?? []).some((a) => a.awardTypeId === awardTypeId && a.playerId === playerId)) {
    return { ok: false, reason: 'They already have that award for this match.' };
  }
  const trimmed = note.trim();
  return {
    ok: true,
    ledger: appendRecords(
      ledger,
      [{ type: 'award', matchId, awardTypeId, playerId, given: true, note: trimmed === '' ? null : trimmed }],
      now
    ),
  };
}

/**
 * Change who has an award, or take it back (`toPlayerId` null) — #197 AC2.
 * New records; the earlier one stays in the chain. After the day of the
 * match the change needs a note (invariant 5).
 */
export function changeAward(
  ledger: Ledger,
  matchId: UUID,
  awardTypeId: UUID,
  fromPlayerId: UUID,
  toPlayerId: UUID | null,
  note: string,
  now: Date
): CorrectionResult {
  if (!isWritable(ledger)) return READ_ONLY;
  const match = ledger.matches.find((m) => m.id === matchId);
  const standing = match?.awards ?? [];
  if (!standing.some((a) => a.awardTypeId === awardTypeId && a.playerId === fromPlayerId)) {
    return { ok: false, reason: 'That award is not in the record for this match.' };
  }
  const trimmed = note.trim();
  if (trimmed === '' && afterMatchDay(ledger, matchId, now)) {
    return { ok: false, reason: 'A change after the day of the match needs a note saying why.' };
  }
  if (toPlayerId === fromPlayerId) return { ok: false, reason: 'Nothing has changed.' };
  if (toPlayerId !== null && standing.some((a) => a.awardTypeId === awardTypeId && a.playerId === toPlayerId)) {
    return { ok: false, reason: 'They already have that award for this match.' };
  }
  const n = trimmed === '' ? null : trimmed;
  const records: LedgerRecord[] = [{ type: 'award', matchId, awardTypeId, playerId: fromPlayerId, given: false, note: n }];
  if (toPlayerId !== null) records.push({ type: 'award', matchId, awardTypeId, playerId: toPlayerId, given: true, note: n });
  return { ok: true, ledger: appendRecords(ledger, records, now) };
}

/**
 * A child's awards for the season, oldest match first (#197 AC3). Across
 * matches, so individual performance under ADR-017 §3: not drawn on any
 * screen until the gate's ceiling and switch exist (see #197).
 */
export function childAwards(ledger: Ledger, playerId: UUID): { matchId: UUID; award: string; note: string | null }[] {
  const out: { matchId: UUID; award: string; note: string | null; at: string }[] = [];
  for (const m of ledger.matches) {
    for (const a of m.awards ?? []) {
      if (a.playerId !== playerId) continue;
      out.push({
        matchId: m.id,
        award: ledger.awardTypes.find((t) => t.id === a.awardTypeId)?.name ?? 'Award',
        note: a.note,
        at: m.kickoffAt ?? '',
      });
    }
  }
  return out.sort((a, b) => a.at.localeCompare(b.at)).map(({ matchId, award, note }) => ({ matchId, award, note }));
}

/**
 * Every player's minutes, folded from the intervals. Never stored as truth.
 *
 * All matches, unless `leaveOutExcluded`: the file's summary and its check on
 * import are the audit figure and keep every interval (ADR-020 §4); the
 * season totals a coach reads leave out what they chose not to count.
 */
export function foldLedger(ledger: Ledger, options: { leaveOutExcluded?: boolean } = {}): PlayerTotal[] {
  const totals = new Map<UUID, PlayerTotal>();
  for (const p of ledger.players) {
    totals.set(p.id, { playerId: p.id, outfieldMs: 0, goalkeeperMs: 0 });
  }
  for (const m of ledger.matches) {
    if (options.leaveOutExcluded && isExcluded(m)) continue;
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
      /** Children on this phone matched to the file's by name (#195 N1); absent when none were. */
      matchedPlayers?: number;
      /** Children who left the squad under "Use the file's squad" (#195 criterion 36). */
      leftPlayers?: number;
      /** The file's chain was adopted (this phone held no player time): its team name stands (#195, QA F2). */
      adopted?: true;
    }
  | { ok: false; reason: string };

/**
 * How the coach chose to line this phone's children up with the file's
 * (#195, QA finding N1; `squadMatch.ts` builds it). No choice is "Keep both":
 * every child from both sides, exactly as before matching existed.
 */
export interface ImportChoice {
  /** Each phone child that is the file's child: a statement by the coach, not a figure. */
  matched: readonly { phoneId: UUID; fileId: UUID }[];
  /** Phone children leaving the squad ("Use the file's squad"); empty otherwise. */
  leaving: readonly UUID[];
}

/** True when the ledger holds any match: player time a phone must not lose. */
function holdsPlayerTime(ledger: Ledger): boolean {
  return ledger.matches.length > 0;
}

/**
 * True when an import onto this ledger adopts the file's chain (no player
 * time here yet), the only path on which children are matched (#195).
 */
export function adoptsFile(ours: Ledger): boolean {
  return !holdsPlayerTime(ours);
}

const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

/**
 * The single entry an import appends for the coach's choice (#195 criteria
 * 6, 7, 16 to 19, 35): a noted removal on each matched phone child's own id,
 * naming the file child it is (`matchedTo`); the phone's noted fairness mark
 * laid over the file child's latest profile (the whole phone profile when the
 * file holds none, criterion 35; nothing when the file child is retired);
 * and, under "Use the file's squad", a noted removal for each child leaving.
 * Nothing is rewritten: the phone child's own records stay under its id.
 */
function choiceRecords(
  choice: ImportChoice,
  mine: ReadonlyMap<string, LedgerRecord>,
  theirs: ReadonlyMap<string, LedgerRecord>,
  file: Ledger
): LedgerRecord[] {
  const out: LedgerRecord[] = [];
  const baseOf = (playerId: UUID): LedgerRecord => {
    const have = mine.get(`profile:${playerId}`);
    if (have) {
      const { matchedTo: _gone, ...rest } = have;
      return rest as LedgerRecord;
    }
    return {
      type: 'profile',
      playerId,
      keeperPreference: null,
      prefers: null,
      outfieldTarget: null,
      active: true,
      fairness: 'counted',
    };
  };
  for (const { phoneId, fileId } of choice.matched) {
    const filePlayer = file.players.find((p) => p.id === fileId);
    const name = filePlayer
      ? filePlayer.displaySuffix
        ? `${filePlayer.firstName} ${filePlayer.displaySuffix}`
        : filePlayer.firstName
      : 'child';
    out.push({
      ...baseOf(phoneId),
      type: 'profile',
      playerId: phoneId,
      removed: true,
      matchedTo: fileId,
      note: `Matched to the file's ${name} on import`,
    });
    const phone = mine.get(`profile:${phoneId}`);
    const theirsNow = theirs.get(`profile:${fileId}`);
    const retired = filePlayer?.active === false || theirsNow?.active === false;
    if (!phone || retired) continue;
    if (!theirsNow) {
      // Criterion 35: nothing in the file to override, so the phone's whole profile crosses.
      const { matchedTo: _gone, ...rest } = phone;
      out.push({ ...rest, type: 'profile', playerId: fileId, removed: false });
      continue;
    }
    // Only a noted mark crosses (Ada §2, criterion 17); the file's preferences stand.
    if (!nonEmpty(phone.note)) continue;
    const fairness = typeof phone.fairness === 'string' ? phone.fairness : 'counted';
    const fileFairness = typeof theirsNow.fairness === 'string' ? theirsNow.fairness : 'counted';
    if (fairness === fileFairness && phone.note === theirsNow.note) continue;
    const { matchedTo: _was, ...fileLatest } = theirsNow;
    out.push({ ...fileLatest, type: 'profile', playerId: fileId, fairness, note: phone.note });
  }
  for (const playerId of choice.leaving) {
    out.push({ ...baseOf(playerId), type: 'profile', playerId, removed: true, note: 'Not in the imported squad' });
  }
  return out;
}

/**
 * Import a verified file (ADR-014 §9, #100 AC2). Extends; a diverged chain is never merged:
 *
 * - this phone holds no player time yet: the file's chain is adopted (a new
 *   phone's own genesis and squad are not player time), and this phone's own
 *   records are appended on top of it, so nothing it held is lost (#195 AC5,
 *   #190 AC4): see `carryRecords`;
 * - this phone's chain is a prefix of the file's: the extra entries are
 *   appended verbatim;
 * - the file's chain is a prefix of this phone's: nothing new;
 * - otherwise the chains have diverged and the import is refused (PO ruling
 *   A: one recording phone per match).
 */
export function importLedger(ours: Ledger, file: Ledger, choice?: ImportChoice, now?: Date): ImportResult {
  if (!isWritable(file)) {
    return { ok: false, reason: tooNewLedgerMessage(file.ledgerVersion, file.minReaderVersion) };
  }
  const counts = (next: Ledger) => ({
    addedMatches: next.matches.filter((m) => !ours.matches.some((o) => o.id === m.id)).length,
    addedPlayers: next.players.filter((p) => !ours.players.some((o) => o.id === p.id)).length,
  });

  // The file's chain is already contained in this phone's: nothing new, on
  // every path. Checked before adopting, or a phone with no player time yet
  // would re-adopt a file it already holds and drop its own later entries
  // (#195 criterion 34, QA F1 on 1.3.0).
  if (
    file.entries.length <= ours.entries.length &&
    file.entries.every((e, i) => ours.entries[i].hash === e.hash)
  ) {
    return { ok: true, ledger: ours, addedEntries: 0, addedMatches: 0, addedPlayers: 0 };
  }

  if (!holdsPlayerTime(ours)) {
    // The file's chain is adopted, and this phone's own records ride on top
    // of it (#195 AC5, #190 AC4): its children, fixtures, profiles, tally
    // kinds and award types. Where the file holds the same key, the file's
    // stands, unless this phone's latest is a noted act (a fill-in mark):
    // that is never overwritten (invariant 5).
    const theirs = latestRecords(file.entries);
    const mine = latestRecords(ours.entries);
    const next = carryRecords(file, ours, (key) => {
      if (key === 'squad') return false;
      const have = theirs.get(key);
      const own = mine.get(key);
      if (!have || !own) return true;
      return typeof own.note === 'string' && own.note !== '' && !sameRecord(have, own);
    });
    if (!choice || (choice.matched.length === 0 && choice.leaving.length === 0)) {
      return { ok: true, ledger: next, addedEntries: file.entries.length, ...counts(next), adopted: true };
    }
    // #195 (QA N1): the coach's matching, in one entry dated at import time.
    const at = now ?? new Date(next.writtenAt);
    const matched = appendRecords(next, choiceRecords(choice, mine, theirs, file), at);
    const c = counts(matched);
    return {
      ok: true,
      ledger: matched,
      addedEntries: file.entries.length,
      addedMatches: c.addedMatches,
      addedPlayers: Math.max(0, c.addedPlayers - choice.matched.length),
      matchedPlayers: choice.matched.length,
      leftPlayers: choice.leaving.length,
      adopted: true,
    };
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
  if (result.matchedPlayers !== undefined) {
    // #195 criteria 4 and 36: a matched child is never counted as added, and no removal is silent.
    const left = result.leftPlayers ? `, ${result.leftPlayers} left the squad` : '';
    return (
      `${result.matchedPlayers} matched, ${result.addedPlayers} added${left}. ` +
      `${result.addedMatches} ${result.addedMatches === 1 ? 'match' : 'matches'} added.`
    );
  }
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
    if (isExcluded(m)) continue; // left out of the season (ADR-020)
    for (const i of m.intervals) {
      if (!i.unit) continue;
      const row = units.get(i.playerId) ?? { GK: 0, DEF: 0, MID: 0, ATT: 0 };
      row[i.unit] += Math.max(0, i.endMs - i.startMs);
      units.set(i.playerId, row);
    }
  }
  return foldLedger(ledger, { leaveOutExcluded: true })
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
