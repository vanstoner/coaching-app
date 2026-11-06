/**
 * #277 A1 and #278: source guards, because Node cannot draw a screen. They
 * check the wiring a coach meets: Who's coming and the Team sheet on every
 * fixture to come, and Home as the one way into a match.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = (f: string) => readFileSync(join(__dirname, f), 'utf-8');
const app = readFileSync(join(__dirname, '../../App.tsx'), 'utf-8');

describe("Who's coming on each fixture to come (#277 A1)", () => {
  it('the card shows the row, with its summary, before the Team sheet row', () => {
    const card = src('FixturesScreen.tsx');
    const coming = card.indexOf('<RowNav label="Who\'s coming" value={coming.get(match.id)}');
    const plan = card.indexOf('label="Team sheet"');
    expect(coming).toBeGreaterThan(-1);
    expect(coming).toBeLessThan(plan);
  });

  it('Home reads the summary from the match’s own availability', () => {
    expect(app.match(/comingSummary\(comingRows\(m\.availability, squad\)\)/g)?.length).toBe(1);
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

describe('no Play now: Home is the list of matches (#278; Rob, 5 Nov)', () => {
  it('+ Fixture is the Main button and there is no Which match? screen', () => {
    expect(src('FixturesScreen.tsx')).toContain('<MainButton label="+ Fixture" accessibilityLabel="Add a fixture" onPress={onAdd} />');
    expect(app).not.toContain('WhichMatchScreen');
  });

  it('a card opens its match, as before', () => {
    expect(src('FixturesScreen.tsx')).toContain('onPress={() => onOpen(match.id)}');
  });
});

describe('the team sheet, built to mock v2 (#277; Rob, 6 Nov "Let\'s build this")', () => {
  const sheet = src('TeamSheetScreen.tsx');

  it('each fixture to come has one Team sheet row, and no separate plan row (B6)', () => {
    const card = src('FixturesScreen.tsx');
    expect(card).toMatch(/<RowNav\s+label="Team sheet"[\s\S]*?onPress=\{\(\) => onTeamSheet\(match\.id\)\}/);
    expect(card).not.toContain("'Plan this match'");
  });

  it('one screen in the mock’s order: Who’s coming, Keepers and subs, the view, Fill, Minutes, Share plan', () => {
    const order = ['label="Who\'s coming"', 'title="Keepers and subs"', 'name="View"', 'name="Positions"', 'title="Minutes"', '<SharePlanFoot'].map((t) =>
      sheet.indexOf(t)
    );
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('Keepers and subs and Minutes are Sections, closed until opened', () => {
    expect(sheet).toContain('const [setupOpen, setSetupOpen] = useState(false);');
    expect(sheet).toContain('const [minutesOpen, setMinutesOpen] = useState(false);');
  });

  it('keepers: Automatic | I\'ll choose; subs: a Stepper starting at the fairest number', () => {
    expect(sheet).toContain("{ value: 'auto', label: 'Automatic' }");
    expect(sheet).toContain("{ value: 'choose', label: \"I'll choose\" }");
    expect(sheet).toContain('const subs = Math.min(subsChosen ?? fairest, benchSize);');
    expect(sheet).toMatch(/<Stepper[\s\S]*?plusDisabled=\{subs >= benchSize\}/);
  });

  it('Fill keeps the keepers and hand-placed places; Reset keeps the keepers; both with Undo', () => {
    expect(sheet).toContain('const start = keepPinned(sheet, format);');
    expect(sheet).toContain("undoable(applyKeepers(emptyPlan(periodCount), format, keepers), 'Reset: keepers kept')");
    expect(sheet).toMatch(/onUndo\(text, \(\) => onChange\(before \?\? emptyPlan\(periodCount\)\)\)/);
  });

  it('a place filled by hand is marked, and Rearrange works one quarter at a time', () => {
    expect(sheet).toContain('undoable(pinPlaces(next, p, changed), text);');
    expect(sheet).toMatch(/rearrangePeriod\(sheet, p, format, turn/);
  });

  it('Share plan is off until every place is filled', () => {
    expect(sheet).toContain('disabled={!full}');
    expect(sheet).toContain("note={full ? undefined : 'Fill every place first'}");
  });

  it('it saves to the match’s ordinary plan (B12, D6)', () => {
    expect(app).toMatch(/<TeamSheetScreen[\s\S]*?onChange=\{\(plan\) => savePlan\(sheetMatch\.match\.id, plan\)\}/);
  });

  it('the never-in-goal line is neutral text, never the warning colour (B8)', () => {
    expect(sheet).toMatch(/never\.length > 0 && \([\s\S]*?<Text style=\{local\.why\}>/);
  });

  it('Who’s coming flows on with Next: team sheet (6 Nov)', () => {
    expect(src('WhosComingScreen.tsx')).toContain('<MainButton label="Next: team sheet" onPress={onNext} />');
    expect(app).toMatch(/onNext=\{\(\) => \{\s*setSheetId\(comingMatch\.match\.id\);\s*setStep\('teamSheet'\);/);
  });
});

describe('the sheet: Pitch, All quarters and Table (#277 C13–C18; Rob, 6 Nov)', () => {
  const views = src('TeamSheetViews.tsx');
  const sheet = src('TeamSheetScreen.tsx');

  it('Pitch | All quarters | Table, remembered on this phone and cleared by Forget everything (C13, D5)', () => {
    expect(sheet).toContain("{ value: 'formation', label: 'Pitch' }");
    expect(sheet).toContain("{ value: 'table', label: 'Table' }");
    expect(app).toContain('void store.setItem(SHEET_VIEW_KEY, v)');
    expect(readFileSync(join(__dirname, '../app/storage/forget.ts'), 'utf-8')).toContain('SHEET_VIEW_KEY,');
  });

  it('the Pitch is the real pitch, one quarter at a time, with drag and edge scrolling ("remain awesome")', () => {
    expect(sheet).toMatch(/view === 'formation' && \([\s\S]*?<PitchView[\s\S]*?onDragging=\{setDragging\}[\s\S]*?\{\.\.\.edge\.pitchProps\}/);
  });

  it('All quarters is 2 × 2 in portrait and four in a row in landscape; Open shows one on the pitch', () => {
    expect(views).toContain('width > height ? Math.min(4, plan.periods.length) : Math.min(2, plan.periods.length)');
    expect(views).toContain('onPress={() => onOpen(p)}');
    expect(views).not.toMatch(/[⤢⇄]/);
  });

  it('the Table keeps the position column still while the periods scroll (C15)', () => {
    expect(views).toMatch(/<View style=\{\{ width: LABEL_W \}\}>[\s\S]*?<ScrollView horizontal/);
  });

  it('a second tap swaps, or places a picked child in an empty spot; swaps come with Undo (C17)', () => {
    expect(views).toContain('if (picked.id !== id) onSwap(period, picked.id, id);');
    expect(views).toContain('if (picked && picked.period === period && positionId) onPlace(period, picked.id, positionId);');
    expect(sheet).toMatch(/byHand\(p, swapInPeriod\(sheet, p, a, b\), `Swapped \$\{name\(a\)\} and \$\{name\(b\)\}`\)/);
  });

  it('every target is at least a touch target tall (C18)', () => {
    for (const style of ['chipHit', 'benchHit']) expect(views).toMatch(new RegExp(`${style}: \\{[^}]*minHeight: TOUCH_TARGET`));
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
