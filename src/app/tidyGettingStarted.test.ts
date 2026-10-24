/**
 * #228, PO ruling `both` (Rob, 23 Oct): Getting started on Home is one line
 * with a progress bar, superseding #218 AC4's full card on a fresh Home. The
 * screen is a source check; the count it draws is tested.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PURPOSE_LINE, progressLabel, stepsDone, type StartStep } from './gettingStarted';

const root = join(__dirname, '..', '..');
const read = (...p: string[]) => readFileSync(join(root, ...p), 'utf8');

describe('Getting started on Home is one line (ruling `both`, supersedes #218 AC4’s full card)', () => {
  const step = (done: boolean): StartStep => ({ key: 'squad', name: 'x', detail: 'y', done }) as StartStep;

  it('counts the steps for the bar and the "1 of 3"', () => {
    expect(progressLabel([step(true), step(false), step(false)])).toBe('1 of 3');
    expect(progressLabel([step(false), step(false), step(false)])).toBe('0 of 3');
    expect(stepsDone([step(true), step(true), step(false)])).toBe(2);
  });

  it('Home draws the line; the purpose line and steps move into its sheet (source check)', () => {
    const app = read('App.tsx');
    expect(app).toMatch(/<GettingStartedLine\b/);
    expect(app).not.toMatch(/<GettingStartedCard\b/);
    const gs = read('src', 'screens', 'GettingStarted.tsx');
    const line = gs.slice(gs.indexOf('export function GettingStartedLine'), gs.indexOf('<ActionSheet'));
    expect(line).toContain('{CARD_TITLE}');
    expect(line).toContain('{progressLabel(steps)} ›');
    expect(line).toContain('accessibilityLabel="Close Getting started"');
    expect(line).not.toContain('PURPOSE_LINE');
    const sheet = gs.slice(gs.indexOf('<ActionSheet'), gs.indexOf('</ActionSheet>'));
    expect(sheet).toContain('{PURPOSE_LINE}');
    expect(sheet).toContain('steps.map');
    expect(PURPOSE_LINE).toBe('Who comes off next, and is everyone getting a fair share?');
  });
});
