/**
 * A shape per period — #298, ADR-027 (Rob, 20 Nov: "The default will be same
 * formatting through out with options to over ride per quarter when needed").
 *
 * The match's format is every period's shape unless that period was started
 * in another (`quarter.format`, D2) or the plan overrides it (`shape` on a
 * planned period, D4). Pure: no React, no storage.
 */

import type { Format, Quarter, UUID } from '../types/index';
import { matchFormatInShape, shapeOfFormat, type ShapeCode } from './shapes';

/** The shape a period was played in: its own snapshot, else the match's (D2). */
export function formatOfPeriod(matchFormat: Format, quarter: Pick<Quarter, 'format'> | null | undefined): Format {
  return quarter?.format ?? matchFormat;
}

/**
 * The format for a planned period: its override when it names a shape this
 * match may switch to, else the match's (D4). An unknown or other-side code
 * falls back, never throws.
 */
export function formatForPlannedPeriod(matchFormat: Format, shape: ShapeCode | null | undefined): Format {
  if (!shape) return matchFormat;
  return matchFormatInShape(matchFormat, shape) ?? matchFormat;
}

/** "1-4-1" for a period whose shape is not the match's, else null (criterion 2a's mark). */
export function overrideLabel(matchFormat: Format, periodFormat: Format): string | null {
  if (periodFormat.id === matchFormat.id) return null;
  return shapeOfFormat(periodFormat);
}

/**
 * Criterion 3, ADR-027 D5: the same children in another shape, each in their
 * area. Each unit's children keep their order (the old shape's slot order)
 * and fill the new shape's places of that unit in order; the keeper stays in
 * goal. Whoever does not fit goes to the nearest unit with room, midfield
 * first. Nobody is added or dropped: an empty place stays empty.
 */
export function switchShape(
  sheet: Readonly<Record<UUID, UUID | null>>,
  from: Format,
  to: Format
): Record<UUID, UUID | null> {
  const sorted = (f: Format) => [...f.positions].sort((a, b) => a.sortOrder - b.sortOrder);
  const byUnit = new Map<string, UUID[]>();
  for (const p of sorted(from)) {
    const who = sheet[p.id] ?? null;
    if (who === null) continue;
    const unit = p.unit ?? (p.kind === 'goalkeeper' ? 'GK' : 'MID');
    byUnit.set(unit, [...(byUnit.get(unit) ?? []), who]);
  }
  const out: Record<UUID, UUID | null> = {};
  const target = sorted(to);
  for (const p of target) out[p.id] = null;
  const placeIn = (unit: string, who: UUID): boolean => {
    const free = target.find((p) => (p.unit ?? (p.kind === 'goalkeeper' ? 'GK' : 'MID')) === unit && out[p.id] === null);
    if (!free) return false;
    out[free.id] = who;
    return true;
  };
  const leftover: UUID[] = [];
  for (const unit of ['GK', 'DEF', 'MID', 'ATT']) {
    for (const who of byUnit.get(unit) ?? []) if (!placeIn(unit, who)) leftover.push(who);
  }
  // Nearest unit with room, midfield first; never in goal.
  for (const who of leftover) {
    if (!['MID', 'DEF', 'ATT'].some((u) => placeIn(u, who))) {
      const any = target.find((p) => p.kind !== 'goalkeeper' && out[p.id] === null);
      if (any) out[any.id] = who;
    }
  }
  return out;
}
