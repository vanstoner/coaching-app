/**
 * #261 AC10, AC13, AC15: source guards, in the manner of controlsGuard.test.ts.
 * They read the files; they draw nothing.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const screens = join(__dirname);
const src = (f: string) => readFileSync(join(screens, f), 'utf-8');

describe('an info tap beside each figure (AC15)', () => {
  it.each([
    ['ChildScreen.tsx', 'perGame'],
    ['SquadScreen.tsx', 'perGame'],
    ['SquadViews.tsx', 'squadAverage'],
    ['SquadViews.tsx', 'gap'],
    ['SquadViews.tsx', 'underOver'],
    ['MatchSummaryScreen.tsx', 'matchShare'],
    ['PlanScreen.tsx', 'planShare'],
    ['MinutesSection.tsx', 'playerMinutes'],
  ])('%s: %s', (file, figure) => {
    expect(src(file)).toContain(`<InfoTap figure="${figure}" />`);
  });

  it('its accessible name is "How <figure> is worked out"', () => {
    expect(src('FiguresHelp.tsx')).toMatch(/accessibilityLabel=\{`How \$\{FIGURE_NAME\[figure\]\.toLowerCase\(\)\} is worked out`\}/);
  });
});

describe('Why the difference (AC10)', () => {
  it('Going into Saturday and Fairness rows open it, not the child page', () => {
    const views = src('SquadViews.tsx');
    expect(views.match(/<WhySheet/g)).toHaveLength(2);
    expect(views.match(/onPress=\{\(\) => setWhy\(r\.playerId\)\}/g)).toHaveLength(3);
  });

  it('the child page’s Playing time opens it', () => {
    expect(src('ChildScreen.tsx')).toMatch(/<WhySheet views=\{views\} playerId=\{why \? player\.id : null\}/);
  });

  it('it is read-only: Close, no Save', () => {
    const sheet = src('WhySheet.tsx');
    expect(sheet).toContain('cancelLabel="Close"');
    expect(sheet).not.toMatch(/onSave=/);
  });
});

describe('About the figures (AC13)', () => {
  it('is the first row of Settings › Player minutes', () => {
    const minutes = src('MinutesSection.tsx');
    expect(minutes.indexOf('<AboutFiguresRow')).toBeGreaterThan(-1);
    expect(minutes.indexOf('<AboutFiguresRow')).toBeLessThan(minutes.indexOf('<SortHeading'));
  });
});
