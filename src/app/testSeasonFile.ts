/**
 * A made-up test season as a minutes file — #157.
 *
 * A TestFlight build is the build App Review sees (#108 H1), so it cannot
 * carry test data. A tester brings it in instead, through Settings › Import
 * minutes file, which every build has (ADR-014 §9). This makes that file from
 * the Test kit's own code: its squad (`addTestData`), then its past season
 * (`addTestSeason`), played through the engine and recorded into a ledger,
 * written by `serialiseLedger` exactly as Export minutes file writes one.
 *
 * Made-up first names only (invariant 4): the Test kit's list. Nothing here
 * comes from a phone (CLAUDE.md, Data protection).
 *
 * Pure. `npm run test-season-file` writes it to test-data/test-season.json.
 */

import type { UUID } from '../types/index';
import { emptyLedger, serialiseLedger, type Ledger } from './ledger';
import { DEFAULT_QUARTER_COUNT, DEFAULT_TOTAL_MINUTES, PLACEHOLDER_SQUAD_NAME, makeSevenASideFormat } from './placeholderSquad';
import { addTestData } from './testKit';
import { addTestSeason } from './testSeason';

/** A fixed squad id, so the file's squad is the same each time it is made. */
export const TEST_FILE_SQUAD_ID = '7e57da7a-0000-4000-8000-000000000157' as UUID;

/** The test season's ledger, as the Test kit's two buttons would leave it. */
export function testSeasonLedger(now: Date): Ledger {
  const format = makeSevenASideFormat();
  const kit = addTestData([], [], TEST_FILE_SQUAD_ID, format, DEFAULT_TOTAL_MINUTES, DEFAULT_QUARTER_COUNT, now);
  const season = addTestSeason({
    players: kit.players,
    matches: kit.matches,
    squadId: TEST_FILE_SQUAD_ID,
    squadName: PLACEHOLDER_SQUAD_NAME,
    format,
    totalMinutes: DEFAULT_TOTAL_MINUTES,
    periodCount: DEFAULT_QUARTER_COUNT,
    ledger: emptyLedger(TEST_FILE_SQUAD_ID, PLACEHOLDER_SQUAD_NAME, now),
    now,
  });
  if (!season.ledger) throw new Error(`the test season was not recorded: ${season.summary}`);
  return season.ledger;
}

/** The file's text, as Export minutes file writes it. */
export function testSeasonFile(now: Date): string {
  return serialiseLedger(testSeasonLedger(now));
}
