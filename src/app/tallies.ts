/**
 * The coach's tallies: the second layer of the record — #198 (PO ruling
 * `approve readiness`, 18 Oct: save and shot on target are tallies; assist
 * is core; a kind added in Settings gets its own button during play).
 *
 * Every event kind has a tier:
 * - **core**: goal, assist, conceded. It feeds the result and is validated.
 * - **tally**: shot on target, save, tackle, corner won, free kick won, and
 *   any kind the coach adds (`tally:<id>`). Labelled "coach's tally" wherever
 *   it shows, and never feeds fairness, minutes or the result.
 *
 * Pure TypeScript; folded on every call, nothing stored (invariant 1).
 */

import type { TallyKind, UUID } from '../types/index';
import type { LedgerEventType } from './ledger';

export type Tier = 'core' | 'tally';

/** The words under every tally, wherever it shows (#198 AC1, AC3). */
export const TALLY_CAPTION = "Coach's tally, not validated";

export const CORE_KINDS: readonly string[] = ['goal', 'assist', 'conceded'];

/** The built-in tallies, in the order they are read out. #228: short words; the kinds are unchanged. */
export const BUILT_IN_TALLIES: readonly { kind: string; one: string; many: string }[] = [
  { kind: 'shot_on_target', one: 'shot', many: 'shots' },
  { kind: 'save', one: 'save', many: 'saves' },
  { kind: 'tackle', one: 'tackle', many: 'tackles' },
  { kind: 'corner', one: 'corner', many: 'corners' },
  { kind: 'free_kick', one: 'free kick', many: 'free kicks' },
];

/** Core, tally, or null for a withdrawal (not something that happened). A kind this build does not know is a tally: never core. */
export function tierOf(kind: string): Tier | null {
  if (kind === 'withdrawn') return null;
  return CORE_KINDS.includes(kind) ? 'core' : 'tally';
}

export const tallyKindOf = (id: UUID): TallyKind => `tally:${id}`;

/**
 * The buttons a coach's own kinds add during play (#198 ruling 12): active
 * ones, in the order added. `slot` is the kind's place in the order kinds were
 * created, retired ones included (#228 item 2, Q3 (a)): its look is worked out
 * from it on every draw, so nothing is stored and a look is never handed on.
 */
export function tallyButtons(
  types: readonly LedgerEventType[]
): { kind: TallyKind; label: string; team: boolean; slot: number }[] {
  return types
    .map((t, slot) => ({ t, slot }))
    .filter(({ t }) => t.active)
    .map(({ t, slot }) => ({ kind: tallyKindOf(t.id), label: t.label, team: t.credited === 'team', slot }));
}

interface EventLike {
  id: string;
  kind: string;
  playerId: string | null;
  refersTo: string | null;
}

export interface TallyLine {
  kind: string;
  /** "3 tackles", "1 save". */
  text: string;
  count: number;
  /** Who it is credited to, with counts; empty for a team tally. */
  children: { playerId: UUID; name: string; count: number }[];
}

/**
 * One match's tallies (#198 AC3): built-in kinds then the coach's own, each
 * with who it is credited to. Standing events only; core kinds never appear,
 * and a goal is not counted as a shot on target here
 * (`matchTalliesWithGoals` does, for #202).
 */
export function matchTallies(
  events: readonly EventLike[] | undefined,
  types: readonly LedgerEventType[],
  nameOf: (id: UUID) => string
): TallyLine[] {
  return tallyLines(events, types, nameOf, false);
}

/**
 * As `matchTallies`, but shots on target count every goal too (#202: a goal
 * is a shot on target and the coach never taps twice). The goals still
 * belong to the core; this line only reads them.
 */
export function matchTalliesWithGoals(
  events: readonly EventLike[] | undefined,
  types: readonly LedgerEventType[],
  nameOf: (id: UUID) => string
): TallyLine[] {
  return tallyLines(events, types, nameOf, true);
}

function tallyLines(
  events: readonly EventLike[] | undefined,
  types: readonly LedgerEventType[],
  nameOf: (id: UUID) => string,
  goalsAreShots: boolean
): TallyLine[] {
  const all = events ?? [];
  const withdrawn = new Set(all.filter((e) => e.kind === 'withdrawn' && e.refersTo).map((e) => e.refersTo));
  const standing = all.filter((e) => e.kind !== 'withdrawn' && !withdrawn.has(e.id) && tierOf(e.kind) === 'tally');
  const kinds = [
    ...BUILT_IN_TALLIES,
    ...types.map((t) => ({ kind: tallyKindOf(t.id), one: t.label, many: t.label })),
  ];
  const known = new Set(kinds.map((k) => k.kind));
  // A tally of a kind this phone has no record of (a later build's) is still shown, by its code.
  for (const e of standing) {
    if (!known.has(e.kind)) {
      known.add(e.kind);
      kinds.push({ kind: e.kind, one: e.kind, many: e.kind });
    }
  }
  const lines: TallyLine[] = [];
  for (const k of kinds) {
    const of = all.filter(
      (e) =>
        !withdrawn.has(e.id) &&
        (standing.includes(e) ? e.kind === k.kind : goalsAreShots && k.kind === 'shot_on_target' && e.kind === 'goal')
    );
    if (of.length === 0) continue;
    const counts = new Map<UUID, number>();
    for (const e of of) if (e.playerId) counts.set(e.playerId as UUID, (counts.get(e.playerId as UUID) ?? 0) + 1);
    lines.push({
      kind: k.kind,
      count: of.length,
      text: `${of.length} ${of.length === 1 ? k.one : k.many}`,
      children: [...counts]
        .map(([playerId, count]) => ({ playerId, name: nameOf(playerId), count }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    });
  }
  return lines;
}

/** "3 tackles: Ada 2, Bo 1", or "2 throw-ins" for a team tally. */
export function tallyLineText(line: TallyLine): string {
  if (line.children.length === 0) return line.text;
  return `${line.text}: ${line.children.map((c) => `${c.name} ${c.count}`).join(', ')}`;
}
