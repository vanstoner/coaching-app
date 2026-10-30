/**
 * #261 item 2: the help is one set of words (AC14), and "owed" is gone from
 * everything a coach or a parent reads (AC19). Comments and identifiers may
 * keep it.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { ABOUT_FIGURES, aboutFiguresText } from './aboutFigures';

const root = resolve(__dirname, '..', '..');

describe('How the figures are worked out (#261 AC13, AC14)', () => {
  it('has the ten approved steps, the share steps by Rob’s ruling 1b', () => {
    expect(ABOUT_FIGURES).toHaveLength(10);
    expect(ABOUT_FIGURES[7].text).toMatch(/Main keepers are not in it; fill-ins are/);
    expect(ABOUT_FIGURES[8].text).toMatch(/children available/);
  });

  it('the spec section says exactly what the app says', () => {
    const spec = readFileSync(join(root, 'docs', 'feature-specs.md'), 'utf8');
    const section = spec.split('<!-- about-figures:start -->\n')[1]?.split('\n<!-- about-figures:end -->')[0];
    expect(section).toBe(aboutFiguresText());
  });
});

/** Every string literal in a source file: '…', "…" and `…`, comments stripped. */
function literals(src: string): string[] {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  return [...code.matchAll(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g)].map((m) => m[0]);
}

function files(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) {
      if (f !== 'fixtures' && f !== 'node_modules') files(p, out);
    } else if (/\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f)) out.push(p);
  }
  return out;
}

describe('no "owed" in anything a coach or parent reads (#261 AC19)', () => {
  // Identifiers and sort keys that are not shown (AC9).
  const ALLOWED = new Set(["'owed'", '"owed"']);

  it('app strings', () => {
    const hits: string[] = [];
    for (const f of [...files(join(root, 'src')), join(root, 'App.tsx')]) {
      for (const l of literals(readFileSync(f, 'utf8'))) {
        // `${owed}` is a variable, not words: only the text around it is read.
        const shown = l.replace(/\$\{[^}]*\}/g, '');
        if (/\bowed?\b/i.test(shown) && !ALLOWED.has(l)) hits.push(`${f.slice(root.length)}: ${l.slice(0, 80)}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it('store text', () => {
    for (const f of ['description.txt', 'screenshot_captions.txt', 'whats_new.txt', 'subtitle.txt']) {
      let text = '';
      try {
        text = readFileSync(join(root, 'store', 'app-store', 'en-GB', f), 'utf8');
      } catch {
        continue;
      }
      // What's New lists past versions too; only its newest block is new text.
      if (f === 'whats_new.txt') text = text.split(/\n\nNew in /)[0];
      expect(text, f).not.toMatch(/\bowed?\b/i);
    }
  });
});
