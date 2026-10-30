/**
 * Pitch surface, pitch condition and referee for a fixture (#254, Rob 29 Oct).
 *
 * Pure TypeScript. Surface and condition describe the pitch, not a person, so
 * they go on the `fixture` record (absent when not set, so an older fixture's
 * record is unchanged). The referee is an adult's name, kept on this phone's
 * match and in the coach's own backup only: never in the minutes record,
 * which is exported whole and cannot have a field stripped (Q2).
 */

export type PitchSurface = '3g' | '4g' | 'grass';
export type PitchCondition = 'excellent' | 'good' | 'poor';

/** Rob's values, in his order (Q1). */
export const SURFACES: readonly { value: PitchSurface; label: string }[] = [
  { value: '3g', label: '3G' },
  { value: '4g', label: '4G' },
  { value: 'grass', label: 'Grass' },
];

export const CONDITIONS: readonly { value: PitchCondition; label: string }[] = [
  { value: 'excellent', label: 'Excellent' },
  { value: 'good', label: 'Good' },
  { value: 'poor', label: 'Poor' },
];

export const REFEREE_MAX_LENGTH = 30;

/** A value this build knows, else null: a later build's value shows as nothing (AC4). */
export function surfaceOf(v: unknown): PitchSurface | null {
  return SURFACES.some((s) => s.value === v) ? (v as PitchSurface) : null;
}

export function conditionOf(v: unknown): PitchCondition | null {
  return CONDITIONS.some((c) => c.value === v) ? (v as PitchCondition) : null;
}

/** The card's tags (AC3; Dee): "3G", "Good pitch". Each only when set. */
export function pitchTags(surface: unknown, condition: unknown): string[] {
  const s = SURFACES.find((x) => x.value === surface);
  const c = CONDITIONS.find((x) => x.value === condition);
  return [...(s ? [s.label] : []), ...(c ? [`${c.label} pitch`] : [])];
}

/** The referee as stored: trimmed, at most 30 characters; blank is none (AC5). */
export function cleanReferee(raw: string | null | undefined): string | null {
  const t = (raw ?? '').trim().replace(/\s+/g, ' ').slice(0, REFEREE_MAX_LENGTH).trim();
  return t === '' ? null : t;
}

/** "3G · Good pitch · Referee: Sam", for the "Pitch and referee" row; null when nothing is set. */
export function pitchAndRefereeLine(surface: unknown, condition: unknown, referee: string | null | undefined): string | null {
  const parts = [...pitchTags(surface, condition), ...(referee ? [`Referee: ${referee}`] : [])];
  return parts.length === 0 ? null : parts.join(' · ');
}

/**
 * A match with its pitch and referee set as given (#254 AC12): a field not
 * set is removed, never stored as null, so the fixture record stays as an
 * older build wrote it.
 */
export function withPitch<M extends { surface?: PitchSurface; condition?: PitchCondition; referee?: string }>(
  m: M,
  v: { surface: PitchSurface | null; condition: PitchCondition | null; referee: string | null }
): M {
  const { surface: _s, condition: _c, referee: _r, ...rest } = m;
  const referee = cleanReferee(v.referee);
  return {
    ...(rest as M),
    ...(v.surface ? { surface: v.surface } : {}),
    ...(v.condition ? { condition: v.condition } : {}),
    ...(referee ? { referee } : {}),
  };
}

/**
 * QA N1 on #260 (#254 AC4): a value from a later build shows as nothing in
 * the sheet, so a field the coach left alone keeps it rather than being
 * cleared by Done.
 */
export function keepUnknown<V extends { surface: PitchSurface | null; condition: PitchCondition | null }>(
  match: { surface?: unknown; condition?: unknown },
  draft: V
): V {
  const unknownSurface = typeof match.surface === 'string' && surfaceOf(match.surface) === null;
  const unknownCondition = typeof match.condition === 'string' && conditionOf(match.condition) === null;
  return {
    ...draft,
    surface: unknownSurface && draft.surface === null ? (match.surface as PitchSurface) : draft.surface,
    condition: unknownCondition && draft.condition === null ? (match.condition as PitchCondition) : draft.condition,
  };
}
