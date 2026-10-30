/**
 * #228 item 1: Dee's clutter fixes 1–3 (clock strip, Home, match report),
 * approved by Rob 23 Oct. Layout cannot be measured in Node, so the screens
 * are source checks; the logic they draw from is tested here. Made-up names.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { uuid, type UUID } from '../types/index';
import { nextSubLine, type SubList, type SubListLine } from './clockSubs';
import { shortPeriodLabel } from './matchClock';
import { recordOnlyGoals } from './matchRecord';

const root = join(__dirname, '..', '..');
const read = (...p: string[]) => readFileSync(join(root, ...p), 'utf8');

describe('fix 1: the clock strip', () => {
  it('names the period short', () => {
    const on = { isMatchOver: false };
    expect(shortPeriodLabel(on, 2, 4)).toBe('Q2');
    expect(shortPeriodLabel(on, 1, 2)).toBe('Half 1');
    expect(shortPeriodLabel(on, 1, 1)).toBe('Match');
    expect(shortPeriodLabel(on, 3, 3)).toBe('Third 3');
    expect(shortPeriodLabel({ isMatchOver: true }, null, 4)).toBe('Full time');
  });

  const line = (name: string, done = false): SubListLine => ({
    playerId: uuid(),
    atMs: 0,
    text: `${name} on for Theo · 10:00`,
    done,
    band: null,
    status: '',
  });

  it('the plan collapses to the next sub not in a prompt, and counts the rest', () => {
    const [made, maya, zara, kit] = [line('Ezra', true), line('Maya'), line('Zara'), line('Kit')];
    const list: SubList = { lines: [made, maya, zara, kit], notPlanned: [] };
    expect(nextSubLine(list, new Set<UUID>([maya.playerId]))).toEqual({ line: zara, more: 1 });
    expect(nextSubLine(list, new Set<UUID>())).toEqual({ line: maya, more: 2 });
    expect(nextSubLine({ lines: [made], notPlanned: [] }, new Set())).toEqual({ line: null, more: 0 });
  });

  it('the screen draws the strip and the one-line plan, and drops the standing hint (source check)', () => {
    const src = read('src', 'screens', 'ClockScreen.tsx');
    expect(src).toMatch(/<View style=\{local\.strip\}/);
    expect(src).toMatch(/shortPeriodLabel\(view, quarter\?\.index \?\? null, state\.match\.quarterCount\)/);
    expect(src).toMatch(/`\$\{formatClock\(view\.quarterRemainingMs\)\} left`/);
    expect(src).toMatch(/v \{opponentLabel\(state\.match\)\}/);
    expect(src).toMatch(/fontSize: 42,/);
    expect(src).not.toMatch(/fontSize: 68/);
    expect(src).toMatch(/<SubPlanNext\b/);
    expect(src).not.toMatch(/<SubPlanList\b/);
    expect(src).not.toMatch(/Tap a player for Goal, Save or Move/);
    expect(src).not.toMatch(/left in this \$\{noun\}/);
    // Overtime still turns the time-left text yellow.
    expect(src).toMatch(/style=\{\[local\.stripSub, view\.isOvertime && screen\.overtime\]\}/);
  });
});

describe('fix 2: Home (source check)', () => {
  const src = read('src', 'screens', 'FixturesScreen.tsx');
  it('Play now and + Fixture share one row; the hint under Play now is gone', () => {
    const row = src.slice(src.indexOf('<View style={local.startRow}>'), src.indexOf('{rows.length === 0'));
    expect(row).toContain('Play now');
    expect(row).toContain('+ Fixture');
    expect(row).toContain('accessibilityLabel="Add a fixture"');
    expect(src).not.toMatch(/An unplanned kickabout/);
  });
});

describe('fix 3: the match report', () => {
  it('lists the goals the record added with time unknown, for a mark on their own lines', () => {
    const phone = uuid();
    const scorer = uuid();
    const ev = (id: string, kind: string, playerId: string | null) => ({
      id,
      kind,
      playerId,
      period: 1,
      atMs: 0,
      refersTo: null,
      note: 'from the paper sheet',
      timeKnown: false,
    });
    const added = uuid();
    const against = uuid();
    const recorded = { events: [ev(phone, 'goal', scorer), ev(added, 'goal', scorer), ev(against, 'conceded', null)] };
    expect(recordOnlyGoals(new Set([phone]), recorded as never)).toEqual([
      { id: added, kind: 'goal', playerId: scorer },
      { id: against, kind: 'conceded', playerId: null },
    ]);
    expect(recordOnlyGoals(new Set(), undefined)).toEqual([]);
  });

  it('one header line, one status pill, the record link at the foot (source check)', () => {
    const src = read('src', 'screens', 'MatchSummaryScreen.tsx');
    expect(src).toMatch(/v \{opponentLabel\(state\.match\)\}/);
    expect(src).toContain('Not closed · End match is at the bottom ↓');
    expect(src).toContain('Closed · counts towards season averages');
    expect(src).not.toMatch(/Not closed yet\. Read it through/);
    expect(src).not.toMatch(/Includes goals added in the record with time unknown/);
    expect(src).not.toMatch(/In the record: how it was played/);
    // #264: the record link is a Row › (its chevron an icon, not "›" text), still at the foot, before Match analysis.
    const link = src.indexOf('<RowNav label="In the record"');
    expect(link).toBeGreaterThan(src.indexOf('<Text style={screen.fieldLabel}>Minutes on the pitch</Text>'));
    expect(link).toBeLessThan(src.indexOf('<RowNav label="Match analysis"'));
  });
});
