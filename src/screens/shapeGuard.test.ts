/**
 * #298 (ADR-027): the screens give each period its own shape. Source guards,
 * like the other screen guards here: the logic itself is tested in
 * src/app/periodShape.test.ts.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = (f: string) => readFileSync(join(__dirname, f), 'utf8');
const app = src('../../App.tsx');

describe('a shape per period on screen (#298)', () => {
  it('C3, C5: the Lineup offers Shape only at a break in a match with shapes to switch between (7-a-side)', () => {
    expect(app).toMatch(/const atBreak = match\.state\.quarters\.some\(\(q\) => q\.status === 'ended'\);/);
    expect(app).toMatch(/atBreak && matchShape && shapeOptions\.length > 1/);
    expect(src('LineupScreen.tsx')).toMatch(/label="Shape"/);
    expect(src('LineupScreen.tsx')).toMatch(/setSheet\(switchShape\(before, prev, format\)\)/);
  });

  it('C3, C4: Start hands the engine the coming period\'s shape; the Lineup draws it; the clock draws the period\'s own', () => {
    expect(app).toMatch(/const periodFormat = comingFormat\(match, keptDraftRef\.current, matches\);/);
    expect(app).toMatch(/match\.engine\.startQuarter\(match\.state, quarter, toTeamSheet\(sheet\), periodFormat, startedAt\)/);
    expect(app).toMatch(/format=\{lineupFormat\}/);
    expect(app).toMatch(/format=\{formatNow\(match\)\}/);
  });

  it('C2, C2a: the Team sheet and Plan the rest have a Shape row per period, and draw the period in its shape', () => {
    for (const f of ['TeamSheetScreen.tsx', 'PlanScreen.tsx']) {
      const s = src(f);
      expect(s, f).toMatch(/label="Shape"/);
      expect(s, f).toMatch(/formatForPlannedPeriod\(format, (period|code)/);
      expect(s, f).toMatch(/switchShape\(/);
    }
    expect(src('TeamSheetViews.tsx')).toMatch(/const spots = slotSpots\(periodFormat\);/);
  });
});
