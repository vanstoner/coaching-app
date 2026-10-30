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
