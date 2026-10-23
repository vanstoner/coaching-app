/**
 * The Squad row's figure line wraps to two lines (#223, QA N2 on 1.3.0): the
 * R5 text "Played 1 five-a-side match, not in fairness" plus a bar lost its
 * tail to "…" on one line on a narrow phone. A source check: layout itself is
 * only seen on a device.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Squad row figures (#223 N2)', () => {
  it('lets the figure line wrap to two lines, never one', () => {
    const src = readFileSync(join(__dirname, '..', 'screens', 'SquadScreen.tsx'), 'utf-8');
    expect(src).toMatch(/<Text style=\{local\.figures\} numberOfLines=\{2\}>\s*\{figures\}/);
    expect(src).not.toMatch(/<Text style=\{local\.figures\} numberOfLines=\{1\}>/);
  });
});
