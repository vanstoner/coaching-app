/**
 * #277 A1 and #278: source guards, because Node cannot draw a screen. They
 * check the wiring a coach meets: Who's coming on every fixture to come, and
 * Play now going to Which match? with no ad-hoc match.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = (f: string) => readFileSync(join(__dirname, f), 'utf-8');
const app = readFileSync(join(__dirname, '../../App.tsx'), 'utf-8');

describe("Who's coming on each fixture to come (#277 A1)", () => {
  it('the card shows the row, with its summary, before the plan row', () => {
    const card = src('FixturesScreen.tsx');
    const coming = card.indexOf('<RowNav label="Who\'s coming" value={coming.get(match.id)}');
    const plan = card.indexOf("label={planned ? 'Edit the plan' : 'Plan this match'}");
    expect(coming).toBeGreaterThan(-1);
    expect(coming).toBeLessThan(plan);
  });

  it('Home and Which match? read the summary from the match’s own availability', () => {
    expect(app.match(/comingSummary\(comingRows\(m\.availability, squad\)\)/g)?.length).toBe(2);
  });

  it('each tap saves at once with ✓ Saved (A2)', () => {
    const screen = src('WhosComingScreen.tsx');
    expect(screen).toMatch(/onChange\(setComing\([^)]*nextComing\(coming\)\)\);\s*tick\.mark\(\);/);
  });

  it('a state changes colour only, never weight (the last-glyph trap)', () => {
    const screen = src('WhosComingScreen.tsx');
    expect(screen).not.toMatch(/cant: \{[^}]*fontWeight/);
    expect(screen).not.toMatch(/notHeard: \{[^}]*fontWeight/);
    expect(screen).not.toContain('colours.warn');
  });
});

describe('Play now picks a fixture (#278)', () => {
  it('lists Coming up only, and offers + Fixture when there is none (AC1, AC3)', () => {
    const which = src('WhichMatchScreen.tsx');
    expect(which).toContain("inBucket(fixtureList(matches, now, null, progress), 'future')");
    expect(which).toContain('<MainButton label="+ Fixture" onPress={onAdd} />');
  });

  it('a tap opens the fixture as its card does (AC2)', () => {
    expect(app).toMatch(/<WhichMatchScreen[\s\S]*?onOpen=\{openFixture\}/);
  });

  it('is hidden while a match is under way, as before (AC4)', () => {
    expect(app).toContain('onPlayNow={liveReal && matchIsUnderway(liveReal.state.quarters) ? null : playNow}');
  });
});

describe('Build the team sheet (#277 B6–B12)', () => {
  const sheet = src('TeamSheetScreen.tsx');

  it('each fixture to come has a Team sheet row (B6)', () => {
    expect(src('FixturesScreen.tsx')).toContain('<RowNav label="Team sheet" onPress={() => onTeamSheet(match.id)} />');
  });

  it('the four steps are on one screen, in the coach’s order (B6, P1)', () => {
    const order = ["1. Who's coming", '2. Keepers', '3. Mid-', '4. Everyone else'].map((t) => sheet.indexOf(t));
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('the defaults are Rotate for me, Place them and Even (B6, P3)', () => {
    expect(sheet).toContain("useState<'rotate' | 'choose'>('rotate')");
    expect(sheet).toContain('const [subs, setSubs] = useState(true);');
    expect(sheet).toContain("useState<Fill>('even')");
  });

  it('Make it again asks first and comes with Undo (B12)', () => {
    expect(sheet).toContain("onPress={() => (made ? setAsking(true) : make())}");
    expect(sheet).toMatch(/onUndo\('Team sheet made again', \(\) => onChange\(before\)\)/);
  });

  it('it saves to the match’s ordinary plan (B12, D6)', () => {
    expect(app).toMatch(/<TeamSheetScreen[\s\S]*?onChange=\{\(plan\) => savePlan\(sheetMatch\.match\.id, plan\)\}/);
  });

  it('the nudge and the short mark are neutral, never the warning colour (B8, C16)', () => {
    expect(sheet).not.toContain('colours.warn');
    expect(sheet).not.toContain('screen.overtime');
  });
});

describe('the sheet: Formation and Table (#277 C13–C18)', () => {
  const views = src('TeamSheetViews.tsx');
  const sheet = src('TeamSheetScreen.tsx');

  it('Formation | Table, remembered on this phone and cleared by Forget everything (C13, D5)', () => {
    expect(views).toContain("{ value: 'formation', label: 'Formation' }");
    expect(views).toContain("{ value: 'table', label: 'Table' }");
    expect(app).toContain('void store.setItem(SHEET_VIEW_KEY, v)');
    expect(readFileSync(join(__dirname, '../app/storage/forget.ts'), 'utf-8')).toContain('SHEET_VIEW_KEY,');
  });

  it('Formation is 2 × 2 in portrait and four in a row in landscape, with ⤢ to enlarge (C14)', () => {
    expect(views).toContain('width > height ? Math.min(4, plan.periods.length) : Math.min(2, plan.periods.length)');
    expect(views).toContain('onPress={() => onEnlarge(p)}');
  });

  it('the enlarged period is the full pitch, where dragging works (C17, P4)', () => {
    expect(sheet).toMatch(/enlarged !== null && \([\s\S]*?<PitchView[\s\S]*?onDragging=\{setDragging\}/);
  });

  it('the Table keeps the position column still while the periods scroll (C15)', () => {
    expect(views).toMatch(/<View style=\{\{ width: LABEL_W \}\}>[\s\S]*?<ScrollView horizontal/);
  });

  it('a second tap in the same period swaps, with Undo (C17)', () => {
    expect(views).toContain('if (picked.id !== id) onSwap(period, picked.id, id);');
    expect(sheet).toMatch(/onUndo\(`Swapped \$\{name\(a\)\} and \$\{name\(b\)\}`, \(\) => onChange\(before\)\)/);
  });

  it('every target is at least a touch target tall (C18)', () => {
    for (const style of ['chip', 'benchChip']) expect(views).toMatch(new RegExp(`${style}: \\{[^}]*minHeight: TOUCH_TARGET`));
    expect(views).toMatch(/cell: \{\s*height: TOUCH_TARGET/);
  });
});

describe('match day (#277 D19, D20)', () => {
  it('the Lineup starts from the plan’s period, as before (D19)', () => {
    expect(src('LineupScreen.tsx')).toContain('const initial = () => (hasPlan ? fromPlan() : fromSuggestion());');
  });

  it('it names who is in the plan but not here today, from this period on, and re-plans nothing (D20)', () => {
    expect(app).toMatch(/planGaps=\{planGaps\([\s\S]*?absentIds\(match\.state\)[\s\S]*?\(currentQuarter\(match\.state\)\?\.index \?\? 1\) - 1/);
    expect(src('LineupScreen.tsx')).toMatch(/\{planGaps\.map\(\(line\) => \(\s*<Text key=\{line\} style=\{screen\.hint\}>/);
  });
});
