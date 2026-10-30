/**
 * #264 E6: source guards for the control vocabulary, in the manner of
 * fonts.test.ts. They read the files; they draw nothing.
 *
 * - No ▾ ▴ ✓ ⌄ drawn as text anywhere (V2): Barlow has none, and the fallback
 *   font is what clipped in #89.
 * - `TOUCH_TARGET` is 48 (V1).
 * - Screens take their controls from `src/screens/controls/`, not from the
 *   old underlined-link and quiet-button styles, except where an exception
 *   is named here with its reason.
 * - Danger appears only in the Danger zone, and beside the two deletes Rob
 *   ruled keep it (Q1(a)).
 * - At most one Main button per screen, except where a file holds two
 *   screens or two states that never show together.
 * - Pitch and referee writes only on Save (C3).
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..', '..');
const screensDir = join(root, 'src', 'screens');
const controlsDir = join(screensDir, 'controls');

const screenFiles = readdirSync(screensDir)
  .filter((f) => f.endsWith('.tsx'))
  .map((f) => ({ name: f, src: readFileSync(join(screensDir, f), 'utf-8') }));
const controlFiles = readdirSync(controlsDir)
  .filter((f) => f.endsWith('.tsx') || f.endsWith('.ts'))
  .map((f) => ({ name: `controls/${f}`, src: readFileSync(join(controlsDir, f), 'utf-8') }));
const app = { name: 'App.tsx', src: readFileSync(join(root, 'App.tsx'), 'utf-8') };

/** The source without its comments, so a comment may name a glyph it replaced. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('icons, not glyphs (#264 V2)', () => {
  it('no ▾ ▴ ✓ ⌄ is drawn as text in any screen, control or App.tsx', () => {
    const offenders = [...screenFiles, ...controlFiles, app]
      .filter((f) => /[▾▴✓⌄]/.test(code(f.src)))
      .map((f) => f.name);
    expect(offenders).toEqual([]);
  });

  it('the controls draw their chevrons, ticks and warning sign with MaterialCommunityIcons', () => {
    const icon = readFileSync(join(controlsDir, 'Icon.tsx'), 'utf-8');
    expect(icon).toMatch(/@expo\/vector-icons\/MaterialCommunityIcons/);
    for (const name of ['Rows.tsx', 'Section.tsx', 'Choice.tsx', 'Sheets.tsx', 'Danger.tsx']) {
      expect(readFileSync(join(controlsDir, name), 'utf-8')).toMatch(/<Icon /);
    }
  });
});

describe('targets (#264 V1)', () => {
  it('TOUCH_TARGET is 48', () => {
    expect(readFileSync(join(screensDir, 'theme.ts'), 'utf-8')).toMatch(/export const TOUCH_TARGET = 48;/);
  });
});

describe('screens use the shared controls (#264 E6)', () => {
  /**
   * Files still allowed the old link and button styles, each with its reason.
   * Every other screen must not use `screen.link`, `screen.buttonQuiet`,
   * `screen.dangerLink` or the full-width `screen.button`.
   */
  const OLD_STYLES_ALLOWED: Record<string, string> = {
    'ClockScreen.tsx':
      "Rob, Q4 and v6: the clock's sub prompt, tiles, Withdraw and other links stay as they are in 2.1.0; only the twisty, glyphs and targets change",
    'GettingStarted.tsx': 'Bea, table B: GettingStarted takes V1 and V3 only',
    'ResumeScreen.tsx': 'Bea, table B: Resume takes V1 and V3 only',
  };
  const OLD = /screen\.(link|buttonQuiet|dangerLink|button)\b(?!Label|Pressed|Disabled|Urgent)/;

  it('no screen draws an action as an underlined link or an old button, outside the named exceptions', () => {
    const offenders = screenFiles
      .filter((f) => !(f.name in OLD_STYLES_ALLOWED))
      .filter((f) => OLD.test(code(f.src)))
      .map((f) => f.name);
    expect(offenders).toEqual([]);
  });

  it('every exception still needs its exception (a stale one is removed)', () => {
    for (const name of Object.keys(OLD_STYLES_ALLOWED)) {
      const f = screenFiles.find((s) => s.name === name);
      expect(f, name).toBeDefined();
      expect(OLD.test(code(f!.src)), name).toBe(true);
    }
  });

  /** Files that draw a Pressable without the controls, each with its reason. */
  const OWN_PRESSABLES: Record<string, string> = {
    'Charts.tsx': 'content: a tapped column or cell says its figure (B2)',
    'Chip.tsx': 'the old chip, kept for the award card and the clock (Rob, Q4)',
    'EventButtons.tsx': "the clock's event tiles, unchanged (Rob, Q4)",
    'GettingStarted.tsx': 'V1 and V3 only (table B)',
    'PitchView.tsx': 'content: the pitch diagram and its pills (B2)',
    'ResumeScreen.tsx': 'V1 and V3 only (table B)',
    'Sheet.tsx': 'the action sheet, unchanged (Dee: menus keep their look)',
    'TabBar.tsx': 'V1 and V3 only (table B)',
    'TableSort.tsx': 'V1 and V3 only (table B)',
  };

  it('every other file that draws a Pressable imports the controls', () => {
    const offenders = screenFiles
      .filter((f) => /\bPressable\b/.test(f.src) && !(f.name in OWN_PRESSABLES))
      .filter((f) => !/from '\.\/controls'/.test(f.src))
      .map((f) => f.name);
    expect(offenders).toEqual([]);
  });
});

describe('Danger only where it is earned (#264 V33, Q1(a))', () => {
  const DANGER_ALLOWED = ['SettingsScreen.tsx', 'FixturesScreen.tsx', 'TestMatchesSection.tsx'];
  it('only the Danger zone, the fixture delete and the test-match deletes draw Danger', () => {
    const users = screenFiles.filter((f) => /<Danger(Row)?\b/.test(f.src)).map((f) => f.name);
    expect(users.sort()).toEqual([...DANGER_ALLOWED].sort());
  });
});

describe('one Main button per screen (#264 V26)', () => {
  const TWO_ALLOWED: Record<string, string> = {
    'MatchSummaryScreen.tsx': 'End match is pinned, or inside the awards card when it asks: never both at once',
    'Teams.tsx': 'two screens in one file: Add a team and No teams on this phone yet',
  };
  it('no file draws more than one, outside the named exceptions', () => {
    const offenders = screenFiles
      .filter((f) => (f.src.match(/<MainButton\b/g) ?? []).length > (f.name in TWO_ALLOWED ? 2 : 1))
      .map((f) => f.name);
    expect(offenders).toEqual([]);
  });
});

describe('Pitch and referee writes only on Save (#264 C3)', () => {
  const src = readFileSync(join(screensDir, 'PitchFields.tsx'), 'utf-8');
  it('Cancel, a tap outside and Back close the sheet without calling onChange', () => {
    const cancel = /onCancel=\{\(\) => setDraft\(null\)\}/;
    expect(src).toMatch(cancel);
    expect(src).not.toMatch(/onClose=\{\(\) => \{\s*if \(draft\) onChange/);
  });
  it('Save is the one place it writes', () => {
    expect((code(src).match(/onChange\(keepUnknown/g) ?? []).length).toBe(1);
    expect(src).toMatch(/sheetCommit\('save', draft\)/);
  });
});
