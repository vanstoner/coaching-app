/**
 * #54 AC7: every screen shows `displayName`, so "Alex S" and "Alex T" read
 * apart. QA on PR #260 (D1) found the match-day screens building names from
 * `firstName` alone. A source guard, in the manner of figuresHelpGuard: it
 * reads the files, it draws nothing.
 *
 * Exempt: `PlanImageView.tsx`, which draws `planImage.ts`'s picture shared
 * with parents. Whether that shows a confirmed second word is Rob's call.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makePlayer } from '../app/squad';
import { childrenInMatch } from '../app/matchAwards';
import { uuid } from '../types/index';

const root = join(__dirname, '..', '..');
const screenFiles = readdirSync(__dirname)
  .filter((f) => f.endsWith('.tsx') && !f.includes('.test.'))
  .map((f) => join('src', 'screens', f));
const files = [
  'App.tsx',
  ...screenFiles,
  // The match-day names the screens draw come from these.
  'src/app/matchPlan.ts',
  'src/app/matchEvents.ts',
  'src/app/matchAwards.ts',
  'src/app/childSeason.ts',
];
const EXEMPT = new Set([join('src', 'screens', 'PlanImageView.tsx')]);

/** A `.firstName` read that does not also build the full name from `displaySuffix`. */
function bareFirstNames(file: string): string[] {
  return readFileSync(join(root, file), 'utf-8')
    .split('\n')
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => /\.firstName\b/.test(line) && !/displaySuffix/.test(line))
    .map(({ line, n }) => `${file}:${n}: ${line.trim()}`);
}

describe('names on screen come from displayName (#54 AC7)', () => {
  it('the guard reads the screens it means to', () => {
    expect(screenFiles.length).toBeGreaterThan(20);
    expect(screenFiles).toContain(join('src', 'screens', 'LineupScreen.tsx'));
  });

  it.each(files.filter((f) => !EXEMPT.has(f)))('%s builds no visible name from firstName alone', (file) => {
    expect(bareFirstNames(file)).toEqual([]);
  });

  it('the award card lists "Alex S" and "Alex T" apart', () => {
    const squadId = uuid();
    const s = makePlayer(squadId, 'Alex', 'S');
    const t = makePlayer(squadId, 'Alex', 'T');
    const names = childrenInMatch([s, t], [{ playerId: s.id }, { playerId: t.id }]).map((c) => c.name);
    expect(names).toEqual(['Alex S', 'Alex T']);
  });
});
