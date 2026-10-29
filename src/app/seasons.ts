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
import { isCounted, sideOf } from './analysis';
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

const DAY = 24 * 60 * 60 * 1000;

/**
 * When a season began: its record's start, or, for a first season with no
 * record, its earliest match (kick-off, else when the record first saw it).
 * Null when it has neither.
 */
export function seasonBegan(season: LedgerSeason, view: Pick<Ledger, 'matches'>): number | null {
  const times = view.matches.map((m) => (m.kickoffAt ? Date.parse(m.kickoffAt) : NaN)).filter(Number.isFinite);
  const firstMatch = times.length > 0 ? Math.min(...times) : null;
  // The first season began with its first match, whenever the coach confirmed
  // it (QA D8); a season the coach started began when they started it.
  if (season.id === FIRST_SEASON_ID && firstMatch !== null) return firstMatch;
  if (season.startedAt !== '') return Date.parse(season.startedAt);
  return firstMatch;
}

/**
 * The August prompt (#243 AC4; Rob's rulings Q2, Q3): due once a 1 August
 * has passed since the season began and it is at least 10 months old; "Not
 * yet" quiets it until `quietUntil`, a week on. Settings always has the button.
 */
export function newSeasonPromptDue(began: number | null, now: Date, quietUntil: number | null): boolean {
  if (began === null) return false;
  const t = now.getTime();
  if (quietUntil !== null && t < quietUntil) return false;
  if (t - began < 304 * DAY) return false;
  const lastAugust = new Date(now.getFullYear() - (now.getMonth() >= 7 ? 0 : 1), 7, 1).getTime();
  return lastAugust > began;
}

/** "Not yet" brings the prompt back after this (#243 Q2). */
export const PROMPT_QUIET_MS = 7 * DAY;

/** Where "Not yet" is kept: a view choice on this phone, per team, never in the record. */
export const SEASON_PROMPT_KEY = 'coaching-app/season-prompt/v1';

/** How many counted matches a season has of each side (#243 AC9), for "Set the main format". */
export function sideCounts(view: Pick<Ledger, 'matches'>): Map<number, number> {
  const out = new Map<number, number>();
  for (const m of view.matches) {
    const side = sideOf(m);
    if (side !== null && isCounted(m)) out.set(side, (out.get(side) ?? 0) + 1);
  }
  return out;
}

/**
 * A season's closed matches, left-out ones included and marked by the
 * caller, as Played lists them: for its match count and its list (#243 AC6).
 * Never a figure: every figure folds from `ledgerForSeason` through
 * `isCounted`.
 */
export function playedIn(view: Pick<Ledger, 'matches'>): Ledger['matches'] {
  return view.matches.filter((m) => m.status === 'completed');
}
