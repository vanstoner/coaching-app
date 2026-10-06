/**
 * The demo's first open — #146 AC4, AC6.
 *
 * The demo is Heart FC Beta Coach built from main by a manual run, to share with
 * made-up data in it (PO ruling 31). On first open with nothing on the phone
 * it adds the Test kit's squad and past season, through the buttons' own
 * calls in the order they sit in Settings (`addTestData`, then
 * `addTestSeason`): the season is played through the engine and recorded into
 * the ledger as it is played, exactly as tapping both would. A release and a
 * pull request's beta never do this; a beta still needs the taps.
 *
 * Pure. Launch (App.tsx) passes in what it read, then carries on with the
 * session returned here as if it had loaded it: the save after launch writes
 * it, through the same `saveSession` every change goes through. Synthetic
 * first names only (invariant 4); nothing derived is stored (invariant 1).
 */

import type { Distribution } from './distribution';
import { toSavedSession, type SavedSession, type SessionInput } from './persistence';
import { addTestData } from './testKit';
import { addTestSeason, type TestSeasonInput } from './testSeason';

type LedgerOrNull = TestSeasonInput['ledger'];

/** What launch found on the phone. */
export interface StoreContents {
  /** Everyone ever in the squad, retired players included. */
  players: number;
  /** Every saved match: fixtures, played and in progress. */
  matches: number;
  /** Players and matches in the ledger launch continues from. */
  ledgerPlayers: number;
  ledgerMatches: number;
  /** False when this build may not write the ledger (#99 AC2). */
  ledgerWritable: boolean;
}

/** Counts only: what launch read, as `loadSession` and `openStoredLedger` return it. */
export function storeContents(
  saved: { players: readonly unknown[]; matches: readonly unknown[] } | null,
  opened: { writable: boolean; ledger: { players: readonly unknown[]; matches: readonly unknown[] } | null }
): StoreContents {
  return {
    players: saved?.players.length ?? 0,
    matches: saved?.matches.length ?? 0,
    ledgerPlayers: opened.ledger?.players.length ?? 0,
    ledgerMatches: opened.ledger?.matches.length ?? 0,
    ledgerWritable: opened.writable,
  };
}

/**
 * Only the demo and the App Store media build (`store`, #108 E), and only an
 * empty store: no squad, no saved match, nothing in the ledger, and a ledger
 * this build may write. Never over existing data.
 */
export function shouldAutoSeed(distribution: Distribution, store: StoreContents): boolean {
  return (
    (distribution === 'demo' || distribution === 'store') &&
    store.players === 0 &&
    store.matches === 0 &&
    store.ledgerPlayers === 0 &&
    store.ledgerMatches === 0 &&
    store.ledgerWritable
  );
}

/** The squad defaults launch holds before anything is loaded. */
export type SessionDefaults = Pick<
  SessionInput,
  'squadName' | 'squadId' | 'format' | 'totalMinutes' | 'periodCount' | 'buzzWhenSubDue'
>;

/**
 * The Test kit's squad and fixtures, then its past season, on top of what
 * launch read (empty, by `shouldAutoSeed`). The squad's name, defaults and
 * id are kept: a saved session's, else the defaults.
 */
export function seedDemo(
  saved: SavedSession | null,
  ledger: LedgerOrNull,
  defaults: SessionDefaults,
  now: Date
): { session: SavedSession; ledger: LedgerOrNull } {
  const squadName = saved?.squadName || defaults.squadName;
  const squadId = saved?.squadId ?? defaults.squadId;
  const format = saved?.format ?? defaults.format;
  const totalMinutes = saved?.totalMinutes ?? defaults.totalMinutes;
  const periodCount = saved?.periodCount ?? defaults.periodCount;

  const kit = addTestData(saved?.players ?? [], saved?.matches ?? [], squadId, format, totalMinutes, periodCount, now);
  const season = addTestSeason({
    players: kit.players,
    matches: kit.matches,
    squadId,
    squadName,
    format,
    totalMinutes,
    periodCount,
    ledger,
    now,
  });

  return {
    session: toSavedSession({
      squadName,
      squadId,
      players: season.players,
      format,
      totalMinutes,
      periodCount,
      buzzWhenSubDue: saved?.buzzWhenSubDue ?? defaults.buzzWhenSubDue,
      plan: saved?.plan ?? {},
      matches: season.matches,
      state: null,
      now,
    }),
    ledger: season.ledger,
  };
}
