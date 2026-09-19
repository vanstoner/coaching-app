/**
 * Planning who plays each quarter — REQ-02 (#2), REQ-05 (#5), REQ-04 (#4).
 *
 * Pure TypeScript.
 *
 * ---------------------------------------------------------------------------
 * How this squad actually works
 * ---------------------------------------------------------------------------
 *
 * The coach picks a lineup for each quarter, in the week if he can and at the
 * whistle if he cannot. Substitutions happen **between quarters**, not in the
 * middle of one. So "the substitution reminder" is not an alarm that goes off
 * mid-play — it is the app stopping at each quarter boundary and saying *these
 * are the ones who are owed minutes*.
 *
 * That is a much better fit for a touchline than a mid-quarter alert, and it is
 * what the engine already supports: `startQuarter` takes a fresh team sheet
 * every time.
 *
 * **Invariant 3 shapes the whole thing.** Fairness is total outfield time.
 * Goalkeeping is excluded, so a child who keeps for a quarter is not thereby
 * "ahead" on minutes and will still be picked on outfield fairness next time.
 * The keeper is chosen on a separate ledger — fewest goalkeeper minutes so far —
 * so that job rotates too.
 *
 * Nothing here decides anything on its own. It suggests, the coach overrides,
 * and the override is the thing that happens.
 */

import type {
  Format,
  Player,
  PlayerPositionAffinity,
  PreferenceLevel,
  UUID,
} from '../types/index';
import type { PlayerMinutes } from './playerMinutes';

/** Who is on the pitch for one quarter. `plan[quarterIndex]` is 1-based. */
export type QuarterPlan = Record<string, UUID[]>;

export interface Suggestion {
  /** Every player on the pitch, goalkeeper included. */
  onPitch: UUID[];
  /** The suggested keeper, or null if the format has no goalkeeper position. */
  goalkeeper: UUID | null;
  /** Everyone not selected. */
  bench: UUID[];
  /** Plain English, for the screen. Never empty. */
  rationale: string;
}

const byId = (minutes: PlayerMinutes[]) => {
  const m = new Map<UUID, PlayerMinutes>();
  for (const row of minutes) m.set(row.playerId, row);
  return m;
};

/**
 * Suggest the next quarter's lineup: the players owed the most minutes.
 *
 * Ordering is deliberate and stable. Least outfield time first; ties broken by
 * squad order, never randomly, so asking twice gives the same answer. A coach
 * who sees the list change under his thumb stops trusting it.
 *
 * `available` lets a coach exclude someone who is injured or absent without
 * deleting them from the squad.
 */
/**
 * Who keeps goal, when the coach has said.
 *
 * Field note, 2026-09-19 (#62), after the first real match:
 *
 * > *"I'd like a bit of affinity for the goalkeeper, they tend not to change
 * > between 3 out of 4 quarters so trying to rotate was slight annoyance"*
 *
 * Rotating the gloves every period is what picking the keeper by least
 * goalkeeper time does by construction. Real squads have a keeper who keeps,
 * and a suggestion that fights the coach every period is one they stop reading.
 *
 * This reads `PlayerPositionAffinity`, which has been in the domain model since
 * the start and unused. A `primary` affinity for a goalkeeping position means
 * that player keeps whenever they are available; `secondary` is the deputy,
 * used when no primary is. With neither, the old behaviour stands exactly.
 *
 * Invariant 3 is untouched. Goalkeeping time is still excluded from the
 * fairness figure, so a child who keeps every week is still picked on outfield
 * fairness for the rest of the match — which is the protection that makes a
 * fixed keeper safe rather than unfair.
 */
export function suggestLineup(
  players: Player[],
  minutes: PlayerMinutes[],
  format: Format,
  options: { available?: Set<UUID>; affinities?: PlayerPositionAffinity[] } = {}
): Suggestion {
  const rows = byId(minutes);
  const pool = players.filter((p) => options.available?.has(p.id) ?? true);

  const outfieldMs = (id: UUID) => rows.get(id)?.outfieldMs ?? 0;
  const goalkeeperMs = (id: UUID) => rows.get(id)?.goalkeeperMs ?? 0;
  const order = new Map(players.map((p, i) => [p.id, i]));
  const squadOrder = (a: UUID, b: UUID) => (order.get(a) ?? 0) - (order.get(b) ?? 0);

  const hasKeeper = format.positions.some((p) => p.kind === 'goalkeeper');

  if (pool.length === 0) {
    return { onPitch: [], goalkeeper: null, bench: [], rationale: 'Nobody is available.' };
  }

  // The keeper first, on the goalkeeping ledger, so the job rotates rather than
  // landing on whoever happens to be least played outfield.
  let goalkeeper: UUID | null = null;
  if (hasKeeper) {
    const keeperPositions = new Set(
      format.positions.filter((p) => p.kind === 'goalkeeper').map((p) => p.id)
    );
    const available = new Set(pool.map((p) => p.id));
    const withAffinity = (level: PreferenceLevel) =>
      (options.affinities ?? [])
        .filter(
          (a) =>
            a.preference === level &&
            keeperPositions.has(a.positionId) &&
            available.has(a.playerId)
        )
        .map((a) => a.playerId)
        // More than one nominated keeper is a real possibility in a squad that
        // shares the gloves; the least-kept of them goes in, so the coach's
        // shortlist is honoured and fairness still decides within it.
        .sort((a, b) => goalkeeperMs(a) - goalkeeperMs(b) || squadOrder(a, b));

    goalkeeper =
      withAffinity('primary')[0] ??
      withAffinity('secondary')[0] ??
      [...pool]
        .map((p) => p.id)
        .sort((a, b) => goalkeeperMs(a) - goalkeeperMs(b) || squadOrder(a, b))[0];
  }

  // Then the outfielders, least outfield time first.
  const outfieldSlots = format.onFieldCount - (hasKeeper ? 1 : 0);
  const outfielders = pool
    .map((p) => p.id)
    .filter((id) => id !== goalkeeper)
    .sort((a, b) => outfieldMs(a) - outfieldMs(b) || squadOrder(a, b))
    .slice(0, Math.max(0, outfieldSlots));

  const onPitch = (goalkeeper ? [goalkeeper, ...outfielders] : outfielders).sort(squadOrder);
  const chosen = new Set(onPitch);
  const bench = players.filter((p) => !chosen.has(p.id)).map((p) => p.id);

  return { onPitch, goalkeeper, bench, rationale: describe(players, rows, onPitch, bench) };
}

function describe(
  players: Player[],
  rows: Map<UUID, PlayerMinutes>,
  onPitch: UUID[],
  bench: UUID[]
): string {
  const name = (id: UUID) => players.find((p) => p.id === id)?.firstName ?? 'someone';
  if (onPitch.length === 0) return 'Nobody is available.';
  if (bench.length === 0) return 'Everyone plays — nobody on the bench.';

  const sitting = [...bench]
    .sort((a, b) => (rows.get(b)?.outfieldMs ?? 0) - (rows.get(a)?.outfieldMs ?? 0))
    .slice(0, 3)
    .map(name);

  return `Resting ${sitting.join(', ')} — they have had the most time so far.`;
}

/**
 * Turn a chosen set of players into the position map `startQuarter` wants.
 *
 * The goalkeeper takes the goalkeeper position; everyone else fills the
 * outfield positions in squad order. **Which outfield position a player takes
 * is not a fairness input** (invariant 3) — it is a convenience, and choosing
 * positions by affinity is still REQ-02's open half.
 */
export function teamSheetFor(
  onPitch: UUID[],
  goalkeeper: UUID | null,
  format: Format
): Map<UUID, UUID> {
  const sheet = new Map<UUID, UUID>();
  const keeperPosition = format.positions.find((p) => p.kind === 'goalkeeper');
  const outfieldPositions = format.positions.filter((p) => p.kind !== 'goalkeeper');

  const remaining = onPitch.filter((id) => id !== goalkeeper);
  if (keeperPosition && goalkeeper) sheet.set(keeperPosition.id, goalkeeper);

  outfieldPositions.forEach((position, i) => {
    const playerId = remaining[i];
    if (playerId) sheet.set(position.id, playerId);
  });
  return sheet;
}

/** True when this set can actually start a quarter for this format. */
export function lineupIsComplete(onPitch: UUID[], format: Format): boolean {
  return onPitch.length === format.onFieldCount;
}

export interface FairnessRow {
  playerId: UUID;
  firstName: string;
  outfieldMs: number;
  goalkeeperMs: number;
  /** Difference from the squad's average outfield time. Negative means owed. */
  deltaMs: number;
  onPitchNow: boolean;
}

/**
 * The fairness table the coach looks at: who is owed time, who has had plenty.
 *
 * Measured against the squad average rather than the maximum, because "everyone
 * within a couple of minutes of average" is the actual goal. Sorted by who is
 * owed most, so the top of the list is who to put on.
 */
export function fairnessTable(players: Player[], minutes: PlayerMinutes[]): FairnessRow[] {
  const rows = byId(minutes);
  if (players.length === 0) return [];

  const total = players.reduce((sum, p) => sum + (rows.get(p.id)?.outfieldMs ?? 0), 0);
  const average = total / players.length;

  return players
    .map((p) => {
      const m = rows.get(p.id);
      const outfieldMs = m?.outfieldMs ?? 0;
      return {
        playerId: p.id,
        firstName: p.firstName,
        outfieldMs,
        goalkeeperMs: m?.goalkeeperMs ?? 0,
        deltaMs: Math.round(outfieldMs - average),
        onPitchNow: m?.onPitchNow ?? false,
      };
    })
    .sort((a, b) => a.deltaMs - b.deltaMs);
}
