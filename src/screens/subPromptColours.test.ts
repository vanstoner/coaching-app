/**
 * #227: every word on the clock's sub prompt reads at WCAG 2.2 AA, at least
 * 4.5:1 against its own background, in the green, amber and red states (AC1),
 * computed from the colours the component draws with (AC3), and the three
 * states stay told apart green → amber → red (AC2).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SUB_PROMPT, UNDO_TOAST } from './subPromptColours';

/** WCAG 2.2 relative luminance of a `#rrggbb` colour. */
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

const AA = 4.5;

describe('the contrast arithmetic', () => {
  it('matches the WCAG reference points', () => {
    expect(contrast('#ffffff', '#000000')).toBeCloseTo(21, 5);
    expect(contrast('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
    // The defect as reported: 2.67:1.
    expect(contrast('#8a5600', '#2b1d00')).toBeCloseTo(2.67, 2);
  });
});

describe('the sub prompt reads at 4.5:1 in every state (#227 AC1)', () => {
  for (const band of ['green', 'amber', 'red'] as const) {
    const t = SUB_PROMPT[band];
    it(`${band}: the question, names, who comes off and Not now, on the panel`, () => {
      expect(contrast(t.ink, t.bg)).toBeGreaterThanOrEqual(AA);
    });
    it(`${band}: the countdown or "late", the chosen name and Done, on their fill`, () => {
      expect(contrast(t.onInk, t.ink)).toBeGreaterThanOrEqual(AA);
    });
  }

  it('the Undo toast: its message and the Undo button', () => {
    expect(contrast(UNDO_TOAST.text, UNDO_TOAST.bg)).toBeGreaterThanOrEqual(AA);
    expect(contrast(UNDO_TOAST.buttonText, UNDO_TOAST.buttonBg)).toBeGreaterThanOrEqual(AA);
  });
});

describe('the three states stay apart, green → amber → red (#227 AC2)', () => {
  it('three different panels, in hue order', () => {
    const hue = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
      const max = Math.max(r, g, b);
      const d = max - Math.min(r, g, b);
      const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      return (h * 60 + 360) % 360;
    };
    const [g, a, r] = (['green', 'amber', 'red'] as const).map((b) => hue(SUB_PROMPT[b].bg));
    expect(g).toBeGreaterThan(90);
    expect(g).toBeLessThan(180);
    expect(a).toBeGreaterThan(20);
    expect(a).toBeLessThan(60);
    expect(r).toBeLessThan(20);
  });
});

describe('these are the colours actually drawn (#227 AC3)', () => {
  const root = join(__dirname, '..', '..');
  it('the prompt takes every band colour from SUB_PROMPT', () => {
    const src = readFileSync(join(root, 'src', 'screens', 'ClockSubs.tsx'), 'utf-8');
    expect(src).toMatch(/const BAND = SUB_PROMPT;/);
    const prompts = src.slice(src.indexOf('export function SubPrompts'), src.indexOf('export function SubPlanList'));
    expect(prompts).not.toMatch(/#[0-9a-f]{3,6}\b/i);
  });
  it('the Undo toast takes its colours from UNDO_TOAST', () => {
    const src = readFileSync(join(root, 'src', 'screens', 'ClockScreen.tsx'), 'utf-8');
    const toast = src.slice(src.indexOf('  toast: {'), src.indexOf('toastButtonText'));
    expect(toast).not.toMatch(/#[0-9a-f]{3,6}\b/i);
    expect(src).toMatch(/toastButtonText: \{ color: UNDO_TOAST\.buttonText/);
  });
});
