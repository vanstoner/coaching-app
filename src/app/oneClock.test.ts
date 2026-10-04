import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// #95 AC3: every screen, and App, reads time from the one app clock. A screen
// reading the device clock would disagree with the engine in fast mode: the
// Undo window and the sub reminders would drift apart.
const root = resolve(__dirname, '../..');
const files = [
  'App.tsx',
  ...readdirSync(resolve(root, 'src/screens'))
    .filter((f) => f.endsWith('.tsx') && !f.includes('.test.'))
    .map((f) => `src/screens/${f}`),
];
const FORBIDDEN = [/Date\.now\(\)/, /new Date\(\)/, /new MatchEngine\(\)/];

describe('one clock (#95 AC3)', () => {
  it('no screen or App reads the device clock, or builds an engine without the app clock', () => {
    const offenders = files.flatMap((f) =>
      readFileSync(resolve(root, f), 'utf8')
        .split('\n')
        .map((line, i) => ({ f, i: i + 1, line }))
        .filter(({ line }) => !line.trim().startsWith('*') && !line.trim().startsWith('//'))
        .filter(({ line }) => FORBIDDEN.some((re) => re.test(line)))
        .map(({ f, i, line }) => `${f}:${i}: ${line.trim()}`)
    );
    expect(offenders).toEqual([]);
  });
});
