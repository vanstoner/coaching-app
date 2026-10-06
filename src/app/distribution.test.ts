import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { currentDistribution, parseDistribution } from './distribution';
import { GENERATED_DISTRIBUTION } from './generated-distribution';

const root = resolve(__dirname, '../..');

describe('the distribution CI writes (ADR-017 §5, #146 AC6)', () => {
  it('healthy case: reads each value CI writes', () => {
    expect(parseDistribution('distribution:app')).toBe('app');
    expect(parseDistribution('distribution:beta')).toBe('beta');
    expect(parseDistribution('distribution:demo')).toBe('demo');
  });

  it('reads anything unrecognised as app, so a bad write only removes features', () => {
    for (const bad of [
      '',
      'demo',
      'beta',
      'distribution:',
      'distribution:DEMO',
      'Distribution:demo',
      ' distribution:demo',
      'distribution:demo ',
      'distribution:demo\n',
      'distribution:release',
      'distribution:beta:demo',
      'x-distribution:demo',
    ]) {
      expect(parseDistribution(bad)).toBe('app');
    }
    expect(parseDistribution(undefined as unknown as string)).toBe('app');
  });

  it('is checked in as app, so a missed write is Coaching App', () => {
    // As buildLabel.test.ts holds the label empty: committed with anything
    // else, every local run and any build CI failed to write would claim it.
    expect(GENERATED_DISTRIBUTION).toBe('distribution:app');
    expect(currentDistribution()).toBe('app');
  });

  it('needs no global that Hermes might not have', () => {
    const saved = globalThis.process;
    try {
      // @ts-expect-error — deliberately removing a global to model Hermes.
      delete globalThis.process;
      expect(currentDistribution()).toBe('app');
    } finally {
      globalThis.process = saved;
    }
  });

  it('the full marker is in the generated module and in no other app file', () => {
    // CI asserts the marker it wrote is in the bundle; a second copy in app
    // code would make that assertion pass whatever CI wrote.
    const marker = /distribution:(app|beta|demo)/;
    const files = [join(root, 'App.tsx'), join(root, 'index.ts'), ...walk(join(root, 'src'))].filter(
      (f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f)
    );
    const holding = files.filter((f) => marker.test(readFileSync(f, 'utf8')));
    expect(holding.map((f) => f.slice(root.length + 1))).toEqual(['src/app/generated-distribution.ts']);
    // And only on the line CI replaces: never in its comments.
    const lines = readFileSync(join(root, 'src/app/generated-distribution.ts'), 'utf8')
      .split('\n')
      .filter((l) => marker.test(l));
    expect(lines).toEqual(["export const GENERATED_DISTRIBUTION = 'distribution:app';"]);
  });
});

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}
