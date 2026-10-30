/**
 * Restore a phone from the record — #195 AC4, AC5; ADR-021 D5 (approved to
 * build on, PO 18 Oct, #191).
 *
 * A minutes file holds the squad, players, profiles, settings, fixtures and
 * played matches. On a phone with nothing on it, importing one rebuilds the
 * squad, each child with their preferences, the Settings defaults and the
 * planned fixtures (`restoreFromRecord`). Played matches need no rebuilding:
 * Played lists them straight from the record (`recordOnly.ts`).
 *
 * On a phone that already has data, the import only ADDS: players and
 * planned fixtures it does not have (`extendFromRecord`). Nothing already on
 * the phone is overwritten.
 *
 * A plan for an upcoming match is not in the record, and a restored fixture
 * has none: `PLANS_NOT_RESTORED` says so on screen.
 *
 * **A formation this build does not know is refused, never swapped** (ADR-023
 * D4; #249 J42, J43, Rob's Q4): a planned fixture in one is left out and
 * counted, a Settings default in one leaves this phone's own, and the rest of
 * the file comes back. Played matches are not affected: minutes fold from
 * intervals.
 *
 * Pure TypeScript. No minute is made here: minutes fold from intervals.
 */

import type { Format, Match, Player, UUID } from '../types/index';
import { isHidden, type Ledger, type LedgerFixture, type LedgerPlayer, type LedgerSettings } from './ledger';
import { newMatch } from './matchLifecycle';
import type { SavedMatch } from './persistence';
import { DEFAULT_SHAPE, formatForShape, makeFormat, readShapeCode } from './shapes';

export const PLANS_NOT_RESTORED = 'Plans for upcoming matches are not in a minutes file, so none were restored.';

/** What `formatFromRecord` gives: the format, or why it was refused. */
export type FormatFromRecord = { ok: true; format: Format } | { ok: false; shape: string; reason: string };

/**
 * A refused shape as the coach reads it: the code, or "unnamed" for an empty
 * one (QA Q3 on #269). No build writes "", so only a damaged or hand-edited
 * file carries it, and updating will not help.
 */
const shownShape = (shape: string): string => (shape.trim() === '' ? 'unnamed' : shape);

/** Why a stored shape was refused (ADR-023 D4). */
export const unknownShapeReason = (shape: string): string =>
  shape.trim() === ''
    ? 'This file names a formation with no code, so it could not be read. Check the file came from Heart FC Coach.'
    : `This version does not know the formation ${shape}. Update Heart FC Coach, then import again.`;

/**
 * The shape and names a record gives, as a format. Fresh ids: a format
 * belongs to one phone.
 *
 * A shape this build does not know is **refused** with a reason, never
 * replaced by a format of another size (ADR-023 D4). A null shape, one the
 * writing build could not name, keeps the fallback as before (#249 J44).
 */
export function formatFromRecord(shape: string | null, labels: readonly string[], fallback?: Format): FormatFromRecord {
  // Every shape this build knows, the 5-, 9- and 11-a-side ones included.
  const code = readShapeCode(shape);
  if (shape !== null && code === null) return { ok: false, shape: shownShape(shape), reason: unknownShapeReason(shape) };
  const base = code ? makeFormat(code) : (fallback ?? formatForShape(DEFAULT_SHAPE, null));
  if (labels.length !== base.positions.length) return { ok: true, format: base };
  return {
    ok: true,
    format: {
      ...base,
      positions: base.positions.map((p, i) => ({ ...p, label: labels[i] || p.label })),
    },
  };
}

/** What an import left out because this build does not know its formation (#249 J43). */
export interface UnknownShapes {
  /** The codes of the planned fixtures not brought back, one per fixture. */
  fixtures: string[];
  /** The Settings default's code, when this phone kept its own; else null. */
  settings: string | null;
}

/**
 * The line an import adds when something was left out (#249 J43): the item,
 * the code and the remedy. Null when nothing was.
 */
export function unknownShapesMessage(left: UnknownShapes): string | null {
  const parts: string[] = [];
  const codes = [...new Set(left.fixtures)].join(', ');
  const n = left.fixtures.length;
  if (n > 0) {
    parts.push(
      `${n} planned ${n === 1 ? 'fixture uses a formation' : 'fixtures use formations'} this version does not know (${codes}), so ${n === 1 ? 'it was' : 'they were'} not brought back.`
    );
  }
  if (left.settings !== null) {
    parts.push(
      `The file's Match defaults use a formation this version does not know (${left.settings}), so this phone kept its own.`
    );
  }
  if (parts.length === 0) return null;
  // The remedy fits the code: a newer version for a code, a check of the
  // file for one with no code (QA Q3 on #269).
  const all = [...left.fixtures, ...(left.settings === null ? [] : [left.settings])];
  const remedies = [
    ...(all.some((c) => c !== 'unnamed') ? ['Update Heart FC Coach, then import again.'] : []),
    ...(all.includes('unnamed') ? ['A formation with no code means the file was changed outside the app.'] : []),
  ];
  return `${parts.join(' ')} ${remedies.join(' ')}`;
}

/** A child from the record, with their profile where one was recorded. */
export function playerFromRecord(ledger: Ledger, p: LedgerPlayer, squadId: UUID, now: Date): Player {
  const profile = ledger.profiles.find((x) => x.playerId === p.id);
  return {
    id: p.id,
    squadId,
    firstName: p.firstName,
    displaySuffix: p.displaySuffix,
    squadNumber: null,
    active: profile ? profile.active && p.active : p.active,
    createdAt: now.toISOString(),
    keeper: profile?.keeperPreference ?? null,
    prefers: profile?.prefers ?? null,
    outfieldTargetPct: profile?.outfieldTarget ?? null,
  };
}

/** Players the record holds who belong in a squad: not taken out before ever playing. */
export function restorablePlayers(ledger: Ledger): LedgerPlayer[] {
  // Time in a test or voided match (e.g. the made-up team's) does not keep a child.
  const played = new Set(
    ledger.matches.filter((m) => !isHidden(m)).flatMap((m) => m.intervals.map((i) => i.playerId))
  );
  return ledger.players.filter((p) => {
    const profile = ledger.profiles.find((x) => x.playerId === p.id);
    return !profile?.removed || played.has(p.id);
  });
}

/**
 * Fixtures still to be played: planned, not cancelled, not hidden, and with
 * no match in the record yet (a played one is listed from the record).
 */
export function plannedFixtures(ledger: Ledger): LedgerFixture[] {
  const recorded = new Set(ledger.matches.map((m) => m.id));
  const hidden = new Set(ledger.matches.filter(isHidden).map((m) => m.id));
  return ledger.fixtures.filter((f) => f.state === 'planned' && !recorded.has(f.id) && !hidden.has(f.id));
}

/**
 * A planned fixture rebuilt on this phone, with its own id, so later
 * recording lines up. Null when its formation is one this build does not
 * know (ADR-023 D4): it is left out, never rebuilt at another size.
 */
export function fixtureFromRecord(
  f: LedgerFixture,
  players: Player[],
  squadId: UUID,
  defaults: Format,
  nowFn: () => Date
): SavedMatch | null {
  const read = formatFromRecord(f.shape, f.labels, defaults);
  if (!read.ok) return null;
  const { stored } = newMatch(
    {
      squadId,
      format: read.format,
      totalMinutes: f.totalMinutes,
      periodCount: f.periodCount,
      players,
      opponent: f.opponent,
      competition: f.competition,
      kickoffAt: f.kickoffAt,
      excludeFromStats: f.excludeFromStats,
      // #254 (QA D1): the pitch comes back with the fixture, a later build's value
      // as written, so the next save writes it again rather than dropping it.
      surface: (f.surface ?? undefined) as Match['surface'],
      condition: (f.condition ?? undefined) as Match['condition'],
    },
    nowFn
  );
  return {
    ...stored,
    match: { ...stored.match, id: f.id },
    quarters: stored.quarters.map((q) => ({ ...q, matchId: f.id })),
    ...(f.archived ? { archived: true } : {}),
  };
}

/** Planned fixtures rebuilt, and the codes of those refused (ADR-023 D4). */
function rebuildFixtures(
  fixtures: readonly LedgerFixture[],
  players: Player[],
  squadId: UUID,
  defaults: Format,
  now: Date
): { rebuilt: SavedMatch[]; refused: string[] } {
  const rebuilt: SavedMatch[] = [];
  const refused: string[] = [];
  for (const f of fixtures) {
    const made = fixtureFromRecord(f, players, squadId, defaults, () => now);
    if (made) rebuilt.push(made);
    else refused.push(shownShape(f.shape ?? ''));
  }
  return { rebuilt, refused };
}

export interface Restored {
  squadId: UUID;
  squadName: string;
  players: Player[];
  /** Null when the record holds no settings (a ledger from before 1.3.0). */
  settings: { format: Format; totalMinutes: number; periodCount: number; buzzWhenSubDue: boolean } | null;
  fixtures: SavedMatch[];
  /** What was left out for a formation this build does not know (#249 J43). */
  unknownShapes: UnknownShapes;
}

/** The record's settings; refused (`unknown`) when their formation is one this build does not know. */
function settingsFrom(s: LedgerSettings | null): { settings: Restored['settings']; unknown: string | null } {
  if (!s || s.totalMinutes <= 0 || s.periodCount <= 0) return { settings: null, unknown: null };
  const read = formatFromRecord(s.shape, s.labels);
  // ADR-023 D4: this phone keeps its own defaults, length and periods included.
  if (!read.ok) return { settings: null, unknown: read.shape };
  return {
    settings: {
      format: read.format,
      totalMinutes: s.totalMinutes,
      periodCount: s.periodCount,
      buzzWhenSubDue: s.buzzWhenSubDue,
    },
    unknown: null,
  };
}

/** #195 AC4: everything a phone with nothing on it gets back from the record. */
export function restoreFromRecord(ledger: Ledger, fallbackSquadId: UUID, defaults: Format, now: Date): Restored {
  const squadId = (ledger.squad.id || fallbackSquadId) as UUID;
  const players = restorablePlayers(ledger).map((p) => playerFromRecord(ledger, p, squadId, now));
  const { settings, unknown } = settingsFrom(ledger.settings);
  const format = settings?.format ?? defaults;
  const { rebuilt, refused } = rebuildFixtures(plannedFixtures(ledger), players, squadId, format, now);
  return {
    squadId,
    squadName: ledger.squad.name,
    players,
    settings,
    fixtures: rebuilt,
    unknownShapes: { fixtures: refused, settings: unknown },
  };
}

export interface Extended {
  players: Player[];
  matches: SavedMatch[];
  addedPlayers: number;
  addedFixtures: number;
  /**
   * Fixtures left out for a formation this build does not know (#249 J43).
   * Settings are never taken from a file on this path, so `settings` is null.
   */
  unknownShapes: UnknownShapes;
}

/** #195 AC5: a phone with data gets what it is missing, and nothing it has is changed. */
export function extendFromRecord(
  ledger: Ledger,
  players: readonly Player[],
  matches: readonly SavedMatch[],
  squadId: UUID,
  defaults: Format,
  now: Date
): Extended {
  const knownPlayers = new Set(players.map((p) => p.id));
  const newPlayers = restorablePlayers(ledger)
    .filter((p) => !knownPlayers.has(p.id))
    .map((p) => playerFromRecord(ledger, p, squadId, now));
  const nextPlayers = [...players, ...newPlayers];
  const knownMatches = new Set(matches.map((m) => m.match.id));
  const { rebuilt, refused } = rebuildFixtures(
    plannedFixtures(ledger).filter((f) => !knownMatches.has(f.id)),
    nextPlayers,
    squadId,
    defaults,
    now
  );
  return {
    players: nextPlayers,
    matches: [...matches, ...rebuilt],
    addedPlayers: newPlayers.length,
    addedFixtures: rebuilt.length,
    unknownShapes: { fixtures: refused, settings: null },
  };
}

/**
 * The team name the session takes after an import (#195, QA F2; ruling
 * `file name wins`). When the file's chain was adopted, its name stands, or
 * the next save would write this phone's typed name over it. A later rename
 * in Settings is recorded as usual. On the extend path, and when the file
 * held nothing new, the session keeps its own name, as before.
 */
export function squadNameAfterImport(result: { ledger: Ledger; adopted?: true }, current: string): string {
  return result.adopted ? result.ledger.squad.name || current : current;
}
