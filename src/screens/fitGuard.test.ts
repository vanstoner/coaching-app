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
