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
 * **Invariant 3 shapes the whole thing.** Fairness is total time on the pitch,
 * goal plus outfield (ADR-015, #101; it superseded the outfield-only rule). A
 * child who keeps for a quarter has played that quarter. The keeper is still
 * CHOSEN on a separate ledger — fewest goalkeeper minutes so far — so that job
 * rotates; that is a choice of who keeps, not a fairness measure.
 *
 * Nothing here decides anything on its own. It suggests, the coach overrides,
 * and the override is the thing that happens.
 */

import type {
  Format,
  Player,
  PlayerPositionAffinity,
  PositionUnit,
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
 * Ordering is deliberate and stable. Least pitch time first; ties broken by
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
 * Invariant 3: the outfielders are then picked on total pitch time, goal
 * included (ADR-015). A dedicated keeper's time in goal counts as time played;
 * their outfield-share target is shown beside their figures and never enters
 * this ordering.
 */
export function suggestLineup(
  players: Player[],
  minutes: PlayerMinutes[],
  format: Format,
  options: { available?: Set<UUID>; affinities?: PlayerPositionAffinity[] } = {}
): Suggestion {
  const rows = byId(minutes);
  const pool = players.filter((p) => options.available?.has(p.id) ?? true);

  const pitchMs = (id: UUID) => rows.get(id)?.totalMs ?? 0;
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

    // #86: the player's own goalkeeping preference, set on the squad screen.
    // It sits alongside the older per-position affinity and means the same:
    // main keeper is primary, back-up is secondary.
    const byLeastKept = (ids: UUID[]) =>
      [...ids].sort((a, b) => goalkeeperMs(a) - goalkeeperMs(b) || squadOrder(a, b));
    const marked = (pref: 'main' | 'backup') =>
      byLeastKept(pool.filter((p) => p.keeper === pref).map((p) => p.id));
    const primary = byLeastKept([...new Set([...withAffinity('primary'), ...marked('main')])]);
    const secondary = byLeastKept([...new Set([...withAffinity('secondary'), ...marked('backup')])]);
    // "Not in goal" is honoured unless nobody else is available.
    const willing = pool.filter((p) => p.keeper !== 'never').map((p) => p.id);

    goalkeeper =
      primary[0] ??
      secondary[0] ??
      byLeastKept(willing.length > 0 ? willing : pool.map((p) => p.id))[0];
  }

  // Then the outfielders, least total pitch time first (ADR-015).
  const outfieldSlots = format.onFieldCount - (hasKeeper ? 1 : 0);
  const outfielders = pool
    .map((p) => p.id)
    .filter((id) => id !== goalkeeper)
    .sort((a, b) => pitchMs(a) - pitchMs(b) || squadOrder(a, b))
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
    .sort((a, b) => (rows.get(b)?.totalMs ?? 0) - (rows.get(a)?.totalMs ?? 0))
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

export interface NamedSlot {
  positionId: UUID;
  /** What the coach reads: 'GK', 'LB', 'LF'. */
  label: string;
  /** The primitive underneath the label. Null only on a v1-migrated format. */
  unit: PositionUnit | null;
  playerId: UUID | null;
  /** Null when the slot is not filled yet. */
  firstName: string | null;
}

/**
 * The team sheet as a list of NAMED POSITIONS — PO ruling, 2026-09-20 (#70).
 *
 * > *"Can live with lists and names of positions for the time being."*
 *
 * A pitch is the target (#2, #10) and this is not it. What this is, is the
 * smallest thing that answers "what shape am I playing and who is where" from
 * the data the app already holds: `teamSheetFor` decides the mapping, this
 * names it.
 *
 * Which outfield slot a player takes is still **not** a fairness input
 * (invariant 3). It is shown because the coach asked to read the positions,
 * not because anything is measured against it.
 */
export function namedSlots(
  onPitch: UUID[],
  goalkeeper: UUID | null,
  format: Format,
  players: Player[]
): NamedSlot[] {
  const sheet = teamSheetFor(onPitch, goalkeeper, format);
  const nameOf = new Map(players.map((p) => [p.id, p.firstName]));
  return [...format.positions]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((position) => {
      const playerId = sheet.get(position.id) ?? null;
      return {
        positionId: position.id,
        label: position.label,
        unit: position.unit,
        playerId,
        firstName: playerId ? (nameOf.get(playerId) ?? null) : null,
      };
    });
}

export interface FairnessRow {
  playerId: UUID;
  firstName: string;
  outfieldMs: number;
  goalkeeperMs: number;
  /** Goal plus outfield: the fairness figure (ADR-015). */
  pitchMs: number;
  /** Difference from the squad's average pitch time. Negative means owed. */
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

  const total = players.reduce((sum, p) => sum + (rows.get(p.id)?.totalMs ?? 0), 0);
  const average = total / players.length;

  return players
    .map((p) => {
      const m = rows.get(p.id);
      const pitchMs = m?.totalMs ?? 0;
      return {
        playerId: p.id,
        firstName: p.firstName,
        outfieldMs: m?.outfieldMs ?? 0,
        goalkeeperMs: m?.goalkeeperMs ?? 0,
        pitchMs,
        deltaMs: Math.round(pitchMs - average),
        onPitchNow: m?.onPitchNow ?? false,
      };
    })
    .sort((a, b) => a.deltaMs - b.deltaMs);
}
