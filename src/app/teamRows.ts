/**
 * Teams as the coach sees them — #224 AC1, AC5, AC9; Dee's prototype.
 *
 * Pure TypeScript: what a team's row in the switcher reads, whether a new
 * team's name is free, and the three formats a team can play in 2.0.0.
 * A team's name is its squad's name (ADR-022 D2), read from its session.
 */

import { parseLedger } from './ledger';
import { hasMatchUnderway, readSession } from './persistence';
import { currentSeason, seasonLine } from './seasons';
import type { ShapeCode } from './shapes';

/** What one team's row shows, from its stored session and ledger, without writing anything. */
export function readTeamRow(
  session: string | null,
  ledger: string | null
): { name: string | null; season: string; live: boolean } {
  const read = readSession(session);
  const saved = read.status === 'ok' ? read.session : null;
  const parsed = ledger === null ? null : parseLedger(ledger);
  const seasons = parsed?.ok ? parsed.ledger : { seasons: [] };
  return {
    name: saved ? saved.squadName.trim() || 'Unnamed team' : null,
    season: seasonLine(currentSeason(seasons)),
    live: hasMatchUnderway(saved),
  };
}

/** Capitals and spaces at the ends do not make a name different (T7). */
export const sameTeamName = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Why a new team's name cannot be used, or null (AC5: unique on this phone). */
export function teamNameProblem(name: string, others: readonly string[]): string | null {
  if (name.trim() === '') return 'Give the team a name.';
  if (others.some((o) => sameTeamName(o, name))) {
    return 'You already have a team with this name. Add something to tell them apart, like "Sat" or "Sun".';
  }
  return null;
}

/** The three formats a team can play in 2.0.0 (#224 AC5, T9). */
export const TEAM_FORMATS: readonly { shape: ShapeCode; side: number; label: string; detail: string }[] = [
  { shape: '1-2-1', side: 5, label: '5-a-side', detail: '1-2-1 with GK' },
  { shape: '2-2', side: 5, label: '5-a-side', detail: '2-2 with GK' },
  { shape: '2-3-1', side: 7, label: '7-a-side', detail: '2 def · 3 mid · 1 att' },
];

/** The prototype's nudge: U7–U9 usually play 5-a-side, U10–U13 7-a-side. The coach can change it. */
export function formatForAge(age: string, current: ShapeCode): ShapeCode {
  const n = Number(age.slice(1));
  if (n <= 9 && current === '2-3-1') return '2-2';
  if (n >= 10 && n <= 13 && current !== '2-3-1') return '2-3-1';
  return current;
}
