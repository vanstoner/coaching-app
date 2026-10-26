/**
 * A team's seasons, read from its record — #243, ADR-022 D5 and D6.
 *
 * Pure TypeScript. Nothing here is stored: which season is current, and
 * which season a match belongs to, are worked out on every read.
 *
 * - **Membership** comes from the fixture, never from dates (AC11): a match
 *   whose fixture names no season belongs to the first season, as does
 *   every match recorded before 2.0.0.
 * - **The first season** has a fixed id. Until the coach confirms or names
 *   it, it has no record and reads "This season", with nothing set (AC9).
 * - **The current season** is the latest one started after the first;
 *   with none, the first (AC1). A season ends when the next one starts.
 */

import { FIRST_SEASON_ID, type Ledger, type LedgerSeason } from './ledger';
import type { UUID } from '../types/index';

/** The first season before the coach has said anything about it: all fields absent. */
function implicitFirst(): LedgerSeason {
  return {
    id: FIRST_SEASON_ID,
    name: null,
    startedAt: '',
    mainSide: null,
    ageGroup: null,
    level: null,
    lens: 'full',
    note: null,
  };
}

/** Every season, first first: the first season is listed even with no record. */
export function seasonsOf(ledger: Pick<Ledger, 'seasons'>): LedgerSeason[] {
  const first = ledger.seasons.find((s) => s.id === FIRST_SEASON_ID) ?? implicitFirst();
  return [first, ...ledger.seasons.filter((s) => s.id !== FIRST_SEASON_ID)];
}

/** The season the team is in now (AC1). */
export function currentSeason(ledger: Pick<Ledger, 'seasons'>): LedgerSeason {
  const all = seasonsOf(ledger);
  return all[all.length - 1];
}

/** "2026–27", or "This season" before it is named (AC1). */
export function seasonName(season: Pick<LedgerSeason, 'name'>): string {
  return season.name ?? 'This season';
}

/** The season a match belongs to: its fixture's, else the first (AC11). */
export function seasonOfMatch(ledger: Pick<Ledger, 'fixtures'>, matchId: UUID): UUID {
  return ledger.fixtures.find((f) => f.id === matchId)?.season ?? FIRST_SEASON_ID;
}

/**
 * The ledger as one season sees it (D6): only that season's matches and
 * fixtures. Every figure folded from it covers that season alone (AC5). On
 * a team with one season this is the whole ledger, so its figures are
 * exactly as before seasons.
 */
export function ledgerForSeason(ledger: Ledger, seasonId: UUID): Ledger {
  const inSeason = (id: UUID) => seasonOfMatch(ledger, id) === seasonId;
  return {
    ...ledger,
    matches: ledger.matches.filter((m) => inSeason(m.id)),
    fixtures: ledger.fixtures.filter((f) => (f.season ?? FIRST_SEASON_ID) === seasonId),
    viewSeason: seasonId,
  };
}

/** "2026–27" → "2027–28", "2026/27" → "2027/28", "2027" → "2028"; else the name unchanged (#243 Q4). */
export function nextSeasonName(name: string | null): string {
  if (name === null) return '';
  const pair = /^(\d{4})([–\-/])(\d{2})$/.exec(name);
  if (pair) {
    const y = Number(pair[1]) + 1;
    return `${y}${pair[2]}${String((y + 1) % 100).padStart(2, '0')}`;
  }
  const year = /^(\d{4})$/.exec(name);
  return year ? String(Number(year[1]) + 1) : name;
}

/** "U10" → "U11", capped at U18 (#243 Q1: moved up a year by default). */
export function nextAgeGroup(ageGroup: string | null): string | null {
  const n = ageGroup ? Number(ageGroup.slice(1)) : NaN;
  return Number.isFinite(n) ? `U${Math.min(18, n + 1)}` : null;
}

const LEVEL_WORD: Record<string, string> = { development: 'development', competitive: 'competitive' };

/**
 * One line for a season (#224 AC1, Dee's prototype): "2026–27 · U10
 * development · 7-a-side". Only what the coach has set is shown: a first
 * season with nothing set reads "This season".
 */
export function seasonLine(season: LedgerSeason): string {
  const who = [season.ageGroup, season.level ? LEVEL_WORD[season.level] : null].filter(Boolean).join(' ');
  return [seasonName(season), who, season.mainSide ? `${season.mainSide}-a-side` : null].filter(Boolean).join(' · ');
}

/** The season a team made today starts with (#224 AC5): "2026–27" from August, else the year before's. */
export function seasonNameFor(now: Date): string {
  const y = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
  return `${y}–${String((y + 1) % 100).padStart(2, '0')}`;
}
