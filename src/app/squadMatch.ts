/**
 * Matching children on import — #195, QA finding N1 on 1.3.0 (PO ruling
 * "approve match by name, and the coach chooses", 23 Oct; Ada's design on
 * #195).
 *
 * A phone whose squad was typed in by hand, and which has played nothing,
 * adopts a minutes file's chain on import. The same children then exist
 * twice: once under the phone's ids, once under the file's. Before anything
 * is applied, the coach is shown the phone's squad against the file's, paired
 * by name, and chooses:
 *
 * - **Match by name** (default): each paired phone child becomes the file's
 *   child; children only on this phone are kept.
 * - **Use the file's squad**: as above, and children only on this phone leave
 *   the squad, with a note. Nobody is removed on a guess (criterion 33).
 * - **Keep both**: no matching, which is the import as it was.
 *
 * The match is a statement by the coach, never a figure (invariant 1); it is
 * appended, never a rewrite (invariant 5): see `importLedger`.
 *
 * Pure TypeScript: no React, no device clock.
 */

import type { Player, UUID } from '../types/index';
import type { ImportChoice, Ledger, LedgerPlayer } from './ledger';
import { adoptsFile } from './ledger';
import type { SavedMatch } from './persistence';
import { playerFromRecord, restorablePlayers } from './recordRestore';

export type SquadOption = 'match' | 'file' | 'both';

/** The three choices, in the order the step shows them; the first is the default. */
export const SQUAD_OPTIONS: readonly { option: SquadOption; label: string; hint: string }[] = [
  {
    option: 'match',
    label: 'Match by name',
    hint: "Recommended. Each matched child becomes the file's child. Children only on this phone are kept.",
  },
  {
    option: 'file',
    label: "Use the file's squad",
    hint: 'Matched as above. Children only on this phone leave the squad, with a note.',
  },
  {
    option: 'both',
    label: 'Keep both',
    hint: 'No matching: every child from both. Only for the same name really being two children.',
  },
];

export const HELD_MATCH_REFUSAL = 'Finish or clear the match on this phone, then import.';

/** A phone child and the file child with the same name. */
export interface Pair {
  phone: Player;
  file: LedgerPlayer;
  /** What the coach should know before choosing, e.g. "retired in the file". */
  notes: string[];
}

export interface SquadMatching {
  pairs: Pair[];
  /** Candidates with no phone child of that name: added. */
  fileOnly: LedgerPlayer[];
  /** Phone children with no candidate of that name. */
  phoneOnly: Player[];
  /** Names that appear more than once on either side: never guessed. */
  notMatched: { side: 'phone' | 'file'; id: UUID; name: string }[];
}

/**
 * The name key: first name and suffix, each NFC-normalised, trimmed, with
 * runs of spaces collapsed and lower-cased. Accents are not folded: Zoe and
 * Zoë are different names.
 */
export function nameKey(firstName: string, displaySuffix: string | null | undefined): string {
  const part = (s: string | null | undefined) =>
    (s ?? '').normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
  return `${part(firstName)}\u0000${part(displaySuffix)}`;
}

const shown = (p: { firstName: string; displaySuffix?: string | null }) =>
  p.displaySuffix ? `${p.firstName} ${p.displaySuffix}` : p.firstName;

const fairnessOf = (ledger: Ledger | undefined, id: UUID) => {
  const profile = ledger?.profiles.find((x) => x.playerId === id);
  return { fairness: profile?.fairness ?? 'counted', note: profile?.note ?? null, active: profile?.active };
};

const word = (f: string) => (f === 'not-counted' ? 'fill-in' : 'counted');

/**
 * Pair this phone's squad with the file's candidates (`restorablePlayers`:
 * a child removed in the file is not one). A pair needs the name key exactly
 * once on each side. A phone child already carrying a file child's id is that
 * child, not a pair (criterion 34). `ours` gives the phone's fairness marks,
 * so a pair can say where they differ.
 */
export function matchSquads(phone: readonly Player[], file: Ledger, ours?: Ledger): SquadMatching {
  const fileIds = new Set(file.players.map((p) => p.id));
  const phoneIds = new Set(phone.map((p) => p.id));
  const mine = phone.filter((p) => !fileIds.has(p.id));
  const candidates = restorablePlayers(file).filter((p) => !phoneIds.has(p.id));

  const count = (keys: string[]) => {
    const m = new Map<string, number>();
    for (const k of keys) m.set(k, (m.get(k) ?? 0) + 1);
    return m;
  };
  const phoneKey = (p: Player) => nameKey(p.firstName, p.displaySuffix);
  const fileKey = (p: LedgerPlayer) => nameKey(p.firstName, p.displaySuffix);
  const onPhone = count(mine.map(phoneKey));
  const inFile = count(candidates.map(fileKey));

  const out: SquadMatching = { pairs: [], fileOnly: [], phoneOnly: [], notMatched: [] };
  const twice = (k: string) => (onPhone.get(k) ?? 0) > 1 || (inFile.get(k) ?? 0) > 1;
  const both = (k: string) => onPhone.has(k) && inFile.has(k);

  for (const p of mine) {
    const k = phoneKey(p);
    if (!inFile.has(k)) out.phoneOnly.push(p);
    else if (twice(k)) out.notMatched.push({ side: 'phone', id: p.id, name: shown(p) });
    else {
      const f = candidates.find((c) => fileKey(c) === k) as LedgerPlayer;
      out.pairs.push({ phone: p, file: f, notes: pairNotes(p, f, file, ours) });
    }
  }
  for (const f of candidates) {
    const k = fileKey(f);
    if (!onPhone.has(k)) out.fileOnly.push(f);
    else if (twice(k) && both(k)) out.notMatched.push({ side: 'file', id: f.id, name: shown(f) });
  }
  return out;
}

function pairNotes(phone: Player, f: LedgerPlayer, file: Ledger, ours: Ledger | undefined): string[] {
  const theirs = fairnessOf(file, f.id);
  if (f.active === false || theirs.active === false) return ['retired in the file'];
  const mine = fairnessOf(ours, phone.id);
  if (mine.note === null || mine.note.trim() === '') return [];
  if (mine.fairness !== theirs.fairness) return [`${word(mine.fairness)} on this phone, ${word(theirs.fairness)} in the file`];
  if (mine.note !== theirs.note) return [`${word(mine.fairness)} on both, noted differently: this phone's note is kept`];
  return [];
}

/** What `importLedger` is told for the coach's option. "Keep both" is no choice at all. */
export function importChoice(matching: SquadMatching, option: SquadOption): ImportChoice | undefined {
  if (option === 'both') return undefined;
  return {
    matched: matching.pairs.map((p) => ({ phoneId: p.phone.id, fileId: p.file.id })),
    // Criterion 33: a child unmatched only because their name appears twice stays.
    leaving: option === 'file' ? matching.phoneOnly.map((p) => p.id) : [],
  };
}

export type ImportPlan =
  | { kind: 'straight' }
  | { kind: 'step'; matching: SquadMatching }
  | { kind: 'refuse'; reason: string };

/**
 * Whether an import shows the step (#195 criteria 20, 28 to 30): only on the
 * adopt path, with children on this phone and at least one pair. A match held
 * before kick-off holds this phone's ids in engine state, which is never
 * re-keyed, so with any pair the import is refused.
 */
export function planImport(input: {
  ours: Ledger;
  file: Ledger;
  players: readonly Player[];
  matchHeld: boolean;
}): ImportPlan {
  if (!adoptsFile(input.ours) || input.players.length === 0) return { kind: 'straight' };
  const matching = matchSquads(input.players, input.file, input.ours);
  if (matching.pairs.length === 0) return { kind: 'straight' };
  if (input.matchHeld) return { kind: 'refuse', reason: HELD_MATCH_REFUSAL };
  return { kind: 'step', matching };
}

/** Every string value equal to a key of `ids` replaced by its value; keys and other values untouched. */
function remap<T>(value: T, ids: ReadonlyMap<string, string>): T {
  if (typeof value === 'string') return (ids.get(value) ?? value) as T;
  if (Array.isArray(value)) return value.map((v) => remap(v, ids)) as T;
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = remap(v, ids);
    return out as T;
  }
  return value;
}

/**
 * The session after the import (Ada §5, criteria 21, 22): each matched child
 * is built from the record (`playerFromRecord`, keeping the phone child's
 * `createdAt`), never the phone's `Player` with its id swapped; children
 * leaving are dropped; and planned fixtures name the file's ids wherever they
 * named the phone's (availability, appearances, bench stints, plans). That
 * is the session only: no ledger record is rewritten. Must be committed with
 * the ledger, or the next save undoes the match (Ada §1).
 */
export function rekeySession(
  players: readonly Player[],
  matches: readonly SavedMatch[],
  choice: ImportChoice | undefined,
  ledger: Ledger,
  squadId: UUID,
  now: Date
): { players: Player[]; matches: SavedMatch[] } {
  if (!choice) return { players: [...players], matches: [...matches] };
  const ids = new Map<string, string>(choice.matched.map((m) => [m.phoneId, m.fileId]));
  const leaving = new Set<string>(choice.leaving);
  const next: Player[] = [];
  for (const p of players) {
    if (leaving.has(p.id)) continue;
    const fileId = ids.get(p.id);
    const record = fileId ? ledger.players.find((x) => x.id === fileId) : undefined;
    next.push(record ? { ...playerFromRecord(ledger, record, squadId, now), createdAt: p.createdAt } : p);
  }
  return { players: next, matches: matches.map((m) => remap(m, ids)) };
}
