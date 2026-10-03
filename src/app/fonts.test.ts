/**
 * #89: the clipped-last-glyph defect, fixed at the cause. These keep it fixed.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FONT, MAX_FONT_SCALE, familyFor } from './fonts';

const root = join(__dirname, '..', '..');

describe('every screen draws text through the shared Text (#89 AC2)', () => {
  it('no screen imports Text from react-native directly', () => {
    const files = [
      join(root, 'App.tsx'),
      ...readdirSync(join(root, 'src', 'screens'))
        .filter((f) => f.endsWith('.tsx') && f !== 'Text.tsx')
        .map((f) => join(root, 'src', 'screens', f)),
    ];
    const offenders = files.filter((f) => {
      const src = readFileSync(f, 'utf-8');
      const m = /import\s*\{([^}]*)\}\s*from\s*'react-native'/.exec(src);
      return m !== null && m[1].split(',').map((n) => n.trim()).includes('Text');
    });
    expect(offenders).toEqual([]);
  });
});

describe('the bundled face (#89 AC1)', () => {
  it('maps weights to real font files, never a synthesised bold', () => {
    expect(familyFor(undefined)).toBe(FONT.regular);
    expect(familyFor('300')).toBe(FONT.regular);
    expect(familyFor('normal')).toBe(FONT.regular);
    expect(familyFor('600')).toBe(FONT.semibold);
    expect(familyFor('700')).toBe(FONT.bold);
    expect(familyFor('bold')).toBe(FONT.bold);
  });

  it('ships every file it names, and registers them with the build', () => {
    const files = readdirSync(join(root, 'assets', 'fonts'));
    const app = JSON.parse(readFileSync(join(root, 'app.json'), 'utf-8'));
    const plugin = app.expo.plugins.find((p: unknown) => Array.isArray(p) && p[0] === 'expo-font');
    for (const family of Object.values(FONT)) {
      expect(files).toContain(`${family}.ttf`);
      expect(plugin[1].fonts).toContain(`./assets/fonts/${family}.ttf`);
    }
  });

  it('caps font scaling so a large system size cannot push text out of its box', () => {
    expect(MAX_FONT_SCALE).toBeGreaterThan(1);
    expect(MAX_FONT_SCALE).toBeLessThanOrEqual(1.3);
  });
});
