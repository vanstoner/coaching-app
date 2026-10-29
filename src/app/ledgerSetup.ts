/**
 * What a phone needs besides minutes, in the record — #195 AC2, AC3, AC6;
 * #190 AC4; ADR-021 D2 (approved to build on, PO 18 Oct, #191).
 *
 * Three record types, each "latest wins" like every other (ADR-014 §3):
 *
 * - `fixture` (key `id`): a fixture as the coach made it. A cancelled one is
 *   a new record with `state: 'cancelled'`, never a deletion. `archived`
 *   (#76) rides on it, so a restored phone lists what the coach listed.
 * - `profile` (key `playerId`): what restore needs about a child: in-goal and
 *   outfield preferences, outfield-share target, active or retired, and the
 *   fairness mark (#190). The mark is changed only by `setPlayerFairness`,
 *   with a mandatory note (invariant 5); every other field follows the squad.
 * - `settings` (key `squad`): the squad's default shape, length and periods.
 *
 * Pure TypeScript. Nothing here is a figure: minutes still fold from
 * intervals alone (invariant 1). The released build has no key for these
 * types, so it carries them untouched and never folds them (ADR-021 D1).
 *
 * **Deviation from ADR-021's table, recorded there:** a fixture keeps the
 * app's own `totalMinutes` rather than `periodMinutes`, because 50 minutes in
 * quarters is 12.5 a period and the chain holds whole numbers only
 * (ADR-014 §6). `homeAway` and `venue` are not written: the app has neither.
 */

import type {
  Competition,
  Format,
  KeeperPreference,
  Match,
  OutfieldUnit,
  Player,
  UUID,
} from '../types/index';
import type { LedgerRecord } from './ledgerChain';
import { shapeOfFormat } from './shapes';

export type FixtureState = 'planned' | 'cancelled' | (string & Record<never, never>);
export type Fairness = 'counted' | 'not-counted' | (string & Record<never, never>);

export interface LedgerFixture {
  id: UUID;
  kickoffAt: string | null;
  opponent: string | null;
  competition: Competition | null;
  totalMinutes: number;
  periodCount: number;
  /** '2-3-1', '2-2-2', or null for a shape this build cannot name. */
  shape: string | null;
  /** What the coach calls each position, in order (#166). */
  labels: string[];
  excludeFromStats: boolean;
  state: FixtureState;
  archived: boolean;
  note: string | null;
  /** The season it was made in (ADR-022 D5); null: the team's first season. */
  season: UUID | null;
  /** #254: the pitch, as the record holds it; a value this build doesn't know is kept, shown as nothing. */
  surface: string | null;
  condition: string | null;
}

export interface LedgerProfile {
  playerId: UUID;
  keeperPreference: KeeperPreference | null;
  prefers: OutfieldUnit | null;
  outfieldTarget: number | null;
  active: boolean;
  /** #190: counted in the squad's fairness figures, or a fill-in who is not. */
  fairness: Fairness;
  /** Taken out of the squad before ever playing: a restore leaves them out. */
  removed: boolean;
  /** Mandatory on a fairness change (invariant 5); null otherwise. */
  note: string | null;
  /**
   * On a removal written by an import that matched this phone's child to the
   * file's (#195, ADR-021 D2): the file child's id. Absent otherwise. Not in
   * `SETUP_FIELDS`, so a save carries it like a later build's field.
   */
  matchedTo?: UUID;
}

export interface LedgerSettings {
  shape: string | null;
  labels: string[];
  totalMinutes: number;
  periodCount: number;
  buzzWhenSubDue: boolean;
}

/** What `recordMatches` is given to write fixtures, profiles and settings. */
export interface SetupInput {
  players: readonly Player[];
  fixtures: readonly { match: Match; format?: Format; archived?: boolean }[];
  settings: { format: Format; totalMinutes: number; periodCount: number; buzzWhenSubDue: boolean };
}

/** A test match (#194): never in the record, so never a fixture in it. */
const isTest = (m: Match) => m.test !== undefined && m.test !== null;

/** Fields this build writes on each new type. Anything else is a later build's, and is carried. */
export const SETUP_FIELDS: Record<string, readonly string[]> = {
  fixture: [
    'type',
    'id',
    'kickoffAt',
    'opponent',
    'competition',
    'totalMinutes',
    'periodCount',
    'shape',
    'labels',
    'excludeFromStats',
    'state',
    'archived',
    'note',
    'season',
    'surface',
    'condition',
  ],
  profile: ['type', 'playerId', 'keeperPreference', 'prefers', 'outfieldTarget', 'active', 'fairness', 'removed', 'note'],
  settings: ['type', 'squad', 'shape', 'labels', 'totalMinutes', 'periodCount', 'buzzWhenSubDue'],
};

/**
 * Fields a save never decides: they change only by an explicit, noted act.
 * A save carries them from the latest record.
 */
export const KEPT_BY_SAVE: Record<string, readonly string[]> = {
  // The season is set when the fixture is made, never re-derived (ADR-022 D5).
  fixture: ['note', 'season'],
  profile: ['fairness', 'note'],
  settings: [],
};

const whole = (n: number) => (Number.isFinite(n) ? Math.round(n) : 0);

const labelsOf = (format: Format | undefined): string[] =>
  format ? [...format.positions].sort((a, b) => a.sortOrder - b.sortOrder).map((p) => p.label) : [];

export function fixtureRecord(f: SetupInput['fixtures'][number]): LedgerRecord {
  return {
    type: 'fixture',
    id: f.match.id,
    kickoffAt: f.match.kickoffAt ?? null,
    opponent: f.match.opponent ?? null,
    competition: f.match.competition ?? null,
    totalMinutes: whole(f.match.totalMinutes),
    periodCount: whole(f.match.quarterCount),
    shape: f.format ? shapeOfFormat(f.format) : null,
    labels: labelsOf(f.format),
    excludeFromStats: f.match.excludeFromStats === true,
    state: 'planned',
    archived: f.archived === true,
    note: null,
    // Absent, not null, on a fixture made before seasons: its record is unchanged.
    ...(f.match.seasonId ? { season: f.match.seasonId } : {}),
    // #254: absent when not set, so a fixture without them is unchanged. The match official stays on the phone (Q2).
    ...(f.match.surface ? { surface: f.match.surface } : {}),
    ...(f.match.condition ? { condition: f.match.condition } : {}),
  };
}

export function profileRecord(p: Player): LedgerRecord {
  return {
    type: 'profile',
    playerId: p.id,
    keeperPreference: p.keeper ?? null,
    prefers: p.prefers ?? null,
    outfieldTarget: typeof p.outfieldTargetPct === 'number' ? whole(p.outfieldTargetPct) : null,
    active: p.active !== false,
    fairness: 'counted',
    removed: false,
    note: null,
  };
}

export function settingsRecord(squadId: UUID, s: SetupInput['settings']): LedgerRecord {
  return {
    type: 'settings',
    squad: squadId,
    shape: shapeOfFormat(s.format),
    labels: labelsOf(s.format),
    totalMinutes: whole(s.totalMinutes),
    periodCount: whole(s.periodCount),
    buzzWhenSubDue: s.buzzWhenSubDue,
  };
}

/** Every setup record a save would write, keyed as the chain keys them. */
export function setupRecords(squadId: UUID, input: SetupInput): [string, LedgerRecord][] {
  const out: [string, LedgerRecord][] = [];
  out.push(['settings', settingsRecord(squadId, input.settings)]);
  for (const p of input.players) out.push([`profile:${p.id}`, profileRecord(p)]);
  // Second lock on the door `recordable` keeps (#194, ADR-021 D3).
  for (const f of input.fixtures) if (!isTest(f.match)) out.push([`fixture:${f.match.id}`, fixtureRecord(f)]);
  return out;
}

// --- reading them back ---------------------------------------------------------

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown, fallback: number): number => (typeof v === 'number' ? v : fallback);
const labelsFrom = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** A fixture record as a screen reads it; null when it is too damaged to use. */
export function toFixture(r: LedgerRecord): LedgerFixture | null {
  if (typeof r.id !== 'string') return null;
  return {
    id: r.id as UUID,
    kickoffAt: str(r.kickoffAt),
    opponent: str(r.opponent),
    competition: str(r.competition) as Competition | null,
    totalMinutes: num(r.totalMinutes, 0),
    periodCount: num(r.periodCount, 0),
    shape: str(r.shape),
    labels: labelsFrom(r.labels),
    excludeFromStats: r.excludeFromStats === true,
    state: str(r.state) ?? 'planned',
    archived: r.archived === true,
    note: str(r.note),
    season: str(r.season) as UUID | null,
    surface: str(r.surface),
    condition: str(r.condition),
  };
}

const KEEPER: readonly string[] = ['main', 'backup', 'never'];
const UNITS: readonly string[] = ['DEF', 'MID', 'ATT'];

export function toProfile(r: LedgerRecord): LedgerProfile | null {
  if (typeof r.playerId !== 'string') return null;
  const keeper = str(r.keeperPreference);
  const prefers = str(r.prefers);
  return {
    playerId: r.playerId as UUID,
    keeperPreference: keeper && KEEPER.includes(keeper) ? (keeper as KeeperPreference) : null,
    prefers: prefers && UNITS.includes(prefers) ? (prefers as OutfieldUnit) : null,
    outfieldTarget: typeof r.outfieldTarget === 'number' ? r.outfieldTarget : null,
    active: r.active !== false,
    fairness: str(r.fairness) ?? 'counted',
    removed: r.removed === true,
    note: str(r.note),
    ...(typeof r.matchedTo === 'string' ? { matchedTo: r.matchedTo as UUID } : {}),
  };
}

export function toSettings(r: LedgerRecord): LedgerSettings {
  return {
    shape: str(r.shape),
    labels: labelsFrom(r.labels),
    totalMinutes: num(r.totalMinutes, 0),
    periodCount: num(r.periodCount, 0),
    buzzWhenSubDue: r.buzzWhenSubDue !== false,
  };
}

/**
 * What a save hands `recordMatches`: the stored matches, the one held live
 * (which may not be stored yet: Play now writes it on the next save), and
 * the Settings defaults.
 */
export function setupFrom(input: {
  players: readonly Player[];
  matches: readonly { match: Match; format?: Format; archived?: boolean }[];
  live: { match: Match; format: Format } | null;
  format: Format;
  totalMinutes: number;
  periodCount: number;
  buzzWhenSubDue: boolean;
}): SetupInput {
  const fixtures = input.matches.map((m) =>
    input.live && m.match.id === input.live.match.id ? { ...m, match: input.live.match, format: input.live.format } : m
  );
  if (input.live && !fixtures.some((m) => m.match.id === input.live?.match.id)) fixtures.push(input.live);
  return {
    players: input.players,
    fixtures,
    settings: {
      format: input.format,
      totalMinutes: input.totalMinutes,
      periodCount: input.periodCount,
      buzzWhenSubDue: input.buzzWhenSubDue,
    },
  };
}
