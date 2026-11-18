/**
 * Text that must show complete at 360 dp (QA on PR #260, D2 and D3). A
 * source guard: Node cannot measure a glyph, so it checks the layout choice
 * that makes the text fit.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = (f: string) => readFileSync(join(__dirname, f), 'utf-8');

describe('Going into Saturday: "16 min under the average" is never cut (#261 AC6, D2)', () => {
  it('the vs-average text wraps rather than clipping to one line', () => {
    const views = src('SquadViews.tsx');
    expect(views).toMatch(/<Text style=\{\[local\.oText, r\.named && local\.oNamed\]\}>\{text\}<\/Text>/);
    expect(views).not.toMatch(/local\.oText[^>]*numberOfLines/);
  });
});

describe('"Excellent" fits its Condition segment (#254 AC1, #264 V12, D3)', () => {
  it('Surface and Condition take the whole row under their label', () => {
    const fields = src('PitchFields.tsx');
    expect(fields).toMatch(/label="Surface"\s+stacked/);
    expect(fields).toMatch(/label="Condition"\s+stacked/);
  });
});

describe('the name warning: Keep is the quieter third button (#54 AC2, D13)', () => {
  it('Use, then Change it, then Keep, which is quiet', () => {
    const warning = src('NameWarning.tsx');
    const use = warning.indexOf('<Action label={`Use');
    const change = warning.indexOf('<BackLink label="Change it"');
    const keep = warning.indexOf('<Action label={`Keep');
    expect(use).toBeGreaterThan(-1);
    expect(use).toBeLessThan(change);
    expect(change).toBeLessThan(keep);
    expect(warning).toMatch(/<Action label=\{`Keep “\$\{cleaned\}”`\} quiet /);
  });

  it('quiet is a colour only, never a weight or a size (theme.ts rule)', () => {
    expect(src('controls/Rows.tsx')).toMatch(/actionQuiet: \{ color: colours\.back \},/);
  });

  it('an action that is off is faded, so it never looks like the quiet one (D17)', () => {
    expect(src('controls/Rows.tsx')).toMatch(/actionDisabled: \{ opacity: 0\.4 \},/);
  });
});

describe('the referee placeholder (#254 AC5, D15)', () => {
  it('says whose name and where it stays', () => {
    expect(src('PitchFields.tsx')).toContain(`placeholder="Referee's name (stays on this phone)"`);
  });
});

describe('four in a row at 360dp (#249 F29, H34)', () => {
  it('PitchView takes its pill width from pillWidthFor, which is 72dp with 11 on the pitch', () => {
    const pitch = src('PitchView.tsx');
    expect(pitch).toMatch(/const pillWidth = pillWidthFor\(format\.onFieldCount, pitch\.width\);/);
    expect(src('../app/pitchLayout.ts')).toMatch(/onFieldCount >= 11 \? NARROW_PILL_WIDTH :/);
    // The drag ghost and the empty-slot outline use the same width.
    expect(pitch).toMatch(/s\.ghost,\s*\{ width: pillWidth,/);
    expect(pitch).toMatch(/style=\{\[s\.empty, \{ width: pillWidth \}/);
  });

  it('the name in a pill is one line that ends in "…", never clipped mid-letter', () => {
    expect(src('PitchView.tsx')).toMatch(/<Text style=\{\[s\.name, onBench && s\.benchName\]\} numberOfLines=\{1\} ellipsizeMode="tail" adjustsFontSizeToFit minimumFontScale=\{0\.75\}>/);
  });

  it('the plan picture is captured at its measured height, never a constant', () => {
    const file = src('../app/planImageFile.ts');
    expect(file).toMatch(/const height = Math\.round\(\(size\.height \* width\) \/ size\.width\);/);
    const view = src('PlanImageView.tsx');
    expect(view).not.toMatch(/style=\{\[local\.paper, \{[^}]*height/);
    expect(view).toMatch(/planSlotBox\(slot, layout, colWidth, pitchHeight, image\.slotWidth\)/);
  });
});

describe('dragging near the edge scrolls on every screen with a pitch (#276)', () => {
  // Rob, 5 Nov: the plan screen did not scroll when a bench player was dragged
  // up, because only the lineup screen had edge scrolling. Every screen that
  // draws a PitchView now takes it from the one hook.
  const screens = ['LineupScreen.tsx', 'PlanScreen.tsx', 'ClockScreen.tsx', 'TeamSheetScreen.tsx'];
  it('each screen that draws a pitch is that list', () => {
    const drawing = readdirSync(__dirname).filter((f) => f.endsWith('.tsx') && src(f).includes('<PitchView'));
    expect(drawing.sort()).toEqual([...screens].sort());
  });
  it.each(screens)('%s scrolls through useEdgeScroll and passes it to the pitch', (f) => {
    const s = src(f);
    expect(s).toContain('const edge = useEdgeScroll(dragging);');
    expect(s).toMatch(/<ScrollView [^>]*\{\.\.\.edge\.scrollProps\}>/);
    expect(s).toContain('{...edge.pitchProps}');
    expect(s).not.toMatch(/<ScrollView[^>]*scrollEnabled=\{!dragging\}/);
  });
});

describe('a pitch fitted to a short screen keeps its full width (Rob, 7 Nov, team talk Lineup)', () => {
  it('never lays `aspectRatio: undefined` over the shaped style: Android keeps the ratio and narrows the pitch', () => {
    const pitch = readFileSync(join(__dirname, 'PitchView.tsx'), 'utf-8');
    expect(pitch).not.toMatch(/aspectRatio:\s*undefined/);
    expect(pitch).toMatch(/\[s\.pitchFrame, \{ width: rootWidth, height: fitPitchHeight\(rootWidth, props\.room\) \}\]/);
  });
});


describe('a power play at 360dp (#255, ADR-026: 11-a-side plus 3 is the widest)', () => {
  it('three extra pills fit one row under the pitch in every format, ring and gaps included', async () => {
    const { extraRowWidth } = await import('../app/pitchLayout');
    const W = 324; // the pitch on a 360dp phone, as pitchLayout.test.ts measures it
    for (const onField of [5, 7, 9, 11]) {
      expect(extraRowWidth(3, onField, W), `${onField}-a-side plus 3`).toBeLessThanOrEqual(W);
    }
  });

  it('PitchView draws the extras in that row, never on the grass, with the same ring and gap', () => {
    const pitch = src('PitchView.tsx');
    expect(pitch).not.toMatch(/extraSpots|EXTRA_AT/);
    expect(pitch).toMatch(/<View style=\{s\.extraStrip\} accessibilityLabel="Power play">/);
    expect(pitch).toContain("extraRing: { borderRadius: 999, borderWidth: EXTRA_RING,");
    expect(pitch).toContain("gap: EXTRA_GAP");
  });
});

describe('a sheet header holds Cancel, a short title and a short action (Rob, 10 Nov)', () => {
  it('every literal saveLabel is a word or two: "Open as a temporary team" wrapped over four lines', () => {
    const files = readdirSync(join(__dirname)).filter((f) => f.endsWith('.tsx')).map((f) => join(__dirname, f));
    files.push(join(__dirname, '..', '..', 'App.tsx'));
    const long: string[] = [];
    for (const f of files) {
      for (const m of readFileSync(f, 'utf8').matchAll(/saveLabel="([^"]*)"/g)) {
        if (m[1].length > 12) long.push(`${f.split('/').pop()}: "${m[1]}"`);
      }
    }
    expect(long).toEqual([]);
  });
});
