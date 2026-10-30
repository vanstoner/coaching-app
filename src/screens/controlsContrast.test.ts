/**
 * #264 E5 (V3, V4): every control colour reads in sunlight, on both the pitch
 * and the raised surface — every text colour at least 4.5:1, every edge,
 * icon and boundary at least 3:1. The approach of subPromptColours.test.ts,
 * on the colours the controls actually draw with.
 */

import { describe, expect, it } from 'vitest';
import { colours } from './colours';

function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`not a #rrggbb colour: ${hex}`);
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(m[1].slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const GROUNDS = { pitch: colours.pitch, pitchRaised: colours.pitchRaised };

describe('V3 tokens, as Bea listed them', () => {
  it('carry v6 values, but for `back` (see colours.ts)', () => {
    expect(colours.edge).toBe('#4fb88a');
    expect(colours.action).toBe('#7fe0b0');
    expect(colours.main).toBe('#12855a');
    expect(colours.saved).toBe('#ffd166');
    expect(colours.danger).toBe('#ffb4a2');
  });
});

describe('text reads at 4.5:1 on both surfaces (V4)', () => {
  const texts = {
    ink: colours.ink,
    // QA on PR #260 (D4): the body text tokens, not only the controls'.
    inkMuted: colours.inkMuted,
    inkFaint: colours.inkFaint,
    action: colours.action,
    back: colours.back,
    saved: colours.saved,
    danger: colours.danger,
  };
  for (const [name, ink] of Object.entries(texts)) {
    for (const [ground, bg] of Object.entries(GROUNDS)) {
      it(`${name} on ${ground}`, () => {
        expect(contrast(ink, bg)).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  it('white on the Main button and a chosen segment', () => {
    expect(contrast(colours.ink, colours.main)).toBeGreaterThanOrEqual(4.5);
  });

  it('the Undo toast', () => {
    expect(contrast(colours.pitch, colours.toast)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('edges and icons at 3:1 on both surfaces (V4)', () => {
  for (const [ground, bg] of Object.entries(GROUNDS)) {
    it(`the edge on ${ground}`, () => {
      expect(contrast(colours.edge, bg)).toBeGreaterThanOrEqual(3);
    });
    it(`the chevron (back) on ${ground}`, () => {
      expect(contrast(colours.back, bg)).toBeGreaterThanOrEqual(3);
    });
  }

  it('a filled control keeps its edge, because the fill alone is under 3:1 on the pitch', () => {
    expect(contrast(colours.main, colours.pitch)).toBeLessThan(3);
    expect(contrast(colours.edge, colours.pitch)).toBeGreaterThanOrEqual(3);
  });
});
