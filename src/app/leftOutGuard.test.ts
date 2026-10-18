/**
 * #187 / ADR-020: a match left out of the figures stays out of EVERY figure,
 * including ones written later (PO, on the first beta: "if we create analysis
 * across multiple games I'd want those matches we've ignored not to feature in
 * those stats too").
 *
 * The way a new cross-game figure would go wrong is the way three already did:
 * it filters `ledger.matches` on `status === 'completed'` and never asks
 * whether the match was left out. This scans the source for that comparison.
 * A line that adds one must either say `isExcluded` / `isCounted` on the same
 * line, or sit in a file listed here with the reason it is not a cross-game
 * figure. A new figure should simply use `isCounted` (analysis.ts).
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..', '..');

/** Files where a bare status check is about ONE match or is deliberate. */
const NOT_CROSS_GAME: Record<string, string> = {
  'src/engine/MatchEngine.ts': 'the engine runs one match',
  'src/app/matchClosing.ts': 'closing one match',
  'src/app/fixtures.ts': 'which list or screen one fixture belongs to',
  'src/app/recordOnly.ts': 'lists played matches for Played (#195), left-out ones included and marked, as Played always has',
  'src/app/phoneBackup.ts': 'counts what a backup file holds (#192), not a figure: a left-out match is still in the file',
  'src/screens/MatchSummaryScreen.tsx': 'one match report',
  'src/app/gettingStarted.ts':
    'asks whether anything has been played at all (#218), not a figure: a left-out match has still been played',
  'src/app/provenance.ts': 'judges one match: whether anything was added after it ended (#199)',
  'src/screens/FixturesScreen.tsx': 'one card: a closed match shows its result (#196 AC1)',
  'src/app/squadViews.ts':
    'seasonMatches lists every closed match on purpose and marks each with isCounted; every average then skips !counted',
};

function sources(dir: string): string[] {
  return readdirSync(join(root, dir))
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
    .map((f) => `${dir}/${f}`);
}

describe('a match left out of the figures stays out of future cross-game stats (#187)', () => {
  it('every status check for completed matches also asks whether the match was left out', () => {
    const files = [...sources('src/app'), ...sources('src/screens'), ...sources('src/engine'), 'App.tsx'];
    const offenders: string[] = [];
    for (const file of files) {
      if (NOT_CROSS_GAME[file]) continue;
      readFileSync(join(root, file), 'utf-8')
        .split('\n')
        .forEach((line, i) => {
          if (/[!=]==\s*'completed'/.test(line) && !/isExcluded|isCounted/.test(line)) {
            offenders.push(`${file}:${i + 1}: ${line.trim()}`);
          }
        });
    }
    expect(offenders).toEqual([]);
  });

  it('the exceptions are still real files, so the list cannot rot', () => {
    for (const file of Object.keys(NOT_CROSS_GAME)) {
      expect(readFileSync(join(root, file), 'utf-8').length).toBeGreaterThan(0);
    }
  });
});
