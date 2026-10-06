/**
 * Which distribution is this build? — ADR-017 §5, #146.
 *
 * The bundle cannot otherwise tell Heart FC Beta Coach from Heart FC Coach (ADR-017,
 * Context), so CI writes the answer into `generated-distribution.ts` before
 * bundling, and this module is its only reader. Pure, tested in Node.
 *
 * - `app`  Heart FC Coach, a build of main. Also what anything unrecognised
 *          reads as, so a missed or garbled write only removes features.
 * - `beta` Heart FC Beta Coach, a pull request's build.
 * - `demo` Heart FC Beta Coach built from main by the demo workflow (#146).
 *
 * This file keeps the prefix and the names apart and never joins them, so the
 * only full marker in a bundle is the one CI wrote.
 */

import { GENERATED_DISTRIBUTION } from './generated-distribution';

export type Distribution = 'app' | 'beta' | 'demo';

const PREFIX = 'distribution:';

/** The distribution a marker names, exactly; `app` for anything else. */
export function parseDistribution(marker: string): Distribution {
  if (typeof marker !== 'string' || !marker.startsWith(PREFIX)) return 'app';
  const name = marker.slice(PREFIX.length);
  return name === 'beta' || name === 'demo' ? name : 'app';
}

/** This build's distribution, from what CI wrote. */
export function currentDistribution(): Distribution {
  return parseDistribution(GENERATED_DISTRIBUTION);
}
