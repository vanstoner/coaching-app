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
 * Pure TypeScript. No minute is made here: minutes fold from intervals.
 */

import type { Format, Player, UUID } from '../types/index';
import { isHidden, type Ledger, type LedgerFixture, type LedgerPlayer, type LedgerSettings } from './ledger';
import { newMatch } from './matchLifecycle';
import type { SavedMatch } from './persistence';
import { DEFAULT_SHAPE, formatForShape, makeFormat, readShapeCode } from './shapes';

export const PLANS_NOT_RESTORED = 'Plans for upcoming matches are not in a minutes file, so none were restored.';

/** The shape and names a record gives, as a format. Fresh ids: a format belongs to one phone. */
export function formatFromRecord(shape: string | null, labels: readonly string[], fallback?: Format): Format {
  // Every shape this build knows, the 5-a-side ones included (#223).
  const code = readShapeCode(shape);
  const base = code ? makeFormat(code) : (fallback ?? formatForShape(DEFAULT_SHAPE, null));
  if (labels.length !== base.positions.length) return base;
  return {
    ...base,
    positions: base.positions.map((p, i) => ({ ...p, label: labels[i] || p.label })),
  };
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

/** A planned fixture rebuilt on this phone, with its own id, so later recording lines up. */
export function fixtureFromRecord(
  f: LedgerFixture,
  players: Player[],
  squadId: UUID,
  defaults: Format,
  nowFn: () => Date
): SavedMatch {
  const { stored } = newMatch(
    {
      squadId,
      format: formatFromRecord(f.shape, f.labels, defaults),
      totalMinutes: f.totalMinutes,
      periodCount: f.periodCount,
      players,
      opponent: f.opponent,
      competition: f.competition,
      kickoffAt: f.kickoffAt,
      excludeFromStats: f.excludeFromStats,
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

export interface Restored {
  squadId: UUID;
  squadName: string;
  players: Player[];
  /** Null when the record holds no settings (a ledger from before 1.3.0). */
  settings: { format: Format; totalMinutes: number; periodCount: number; buzzWhenSubDue: boolean } | null;
  fixtures: SavedMatch[];
}

function settingsFrom(s: LedgerSettings | null): Restored['settings'] {
  if (!s || s.totalMinutes <= 0 || s.periodCount <= 0) return null;
  return {
    format: formatFromRecord(s.shape, s.labels),
    totalMinutes: s.totalMinutes,
    periodCount: s.periodCount,
    buzzWhenSubDue: s.buzzWhenSubDue,
  };
}

/** #195 AC4: everything a phone with nothing on it gets back from the record. */
export function restoreFromRecord(ledger: Ledger, fallbackSquadId: UUID, defaults: Format, now: Date): Restored {
  const squadId = (ledger.squad.id || fallbackSquadId) as UUID;
  const players = restorablePlayers(ledger).map((p) => playerFromRecord(ledger, p, squadId, now));
  const settings = settingsFrom(ledger.settings);
  const format = settings?.format ?? defaults;
  return {
    squadId,
    squadName: ledger.squad.name,
    players,
    settings,
    fixtures: plannedFixtures(ledger).map((f) => fixtureFromRecord(f, players, squadId, format, () => now)),
  };
}

export interface Extended {
  players: Player[];
  matches: SavedMatch[];
  addedPlayers: number;
  addedFixtures: number;
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
  const newFixtures = plannedFixtures(ledger)
    .filter((f) => !knownMatches.has(f.id))
    .map((f) => fixtureFromRecord(f, nextPlayers, squadId, defaults, () => now));
  return {
    players: nextPlayers,
    matches: [...matches, ...newFixtures],
    addedPlayers: newPlayers.length,
    addedFixtures: newFixtures.length,
  };
}
