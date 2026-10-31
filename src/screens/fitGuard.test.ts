/**
 * Text that must show complete at 360 dp (QA on PR #260, D2 and D3). A
 * source guard: Node cannot measure a glyph, so it checks the layout choice
 * that makes the text fit.
 */

import { readFileSync } from 'node:fs';
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
    expect(src('PitchView.tsx')).toMatch(/<Text style=\{\[s\.name, onBench && s\.benchName\]\} numberOfLines=\{1\} ellipsizeMode="tail">/);
  });

  it('the plan picture is captured at its measured height, never a constant', () => {
    const file = src('../app/planImageFile.ts');
    expect(file).toMatch(/const height = Math\.round\(\(size\.height \* width\) \/ size\.width\);/);
    const view = src('PlanImageView.tsx');
    expect(view).not.toMatch(/style=\{\[local\.paper, \{[^}]*height/);
    expect(view).toMatch(/planSlotBox\(slot, layout, colWidth, pitchHeight, image\.slotWidth\)/);
  });
});
