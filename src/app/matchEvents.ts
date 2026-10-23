/**
 * The time stream and the score — #84.
 *
 * Pure TypeScript.
 *
 * > *"in match, I click on players name, and select goal which creates a score
 * > update. If I click on the goalkeeper I get 3 options, Goal (unlikely),
 * > Save, Concede (which updates the score)."* — PO, 2026-10-03
 *
 * The score is FOLDED from the events every time it is shown (invariant 1).
 * There is no stored score to disagree with them, and a withdrawn event
 * stops counting the moment its withdrawal is appended.
 */

import type { Appearance, MatchEvent, Player, TapEventKind, UUID } from '../types/index';

/** How long the touchline Undo is offered after a tap (PO ruling 12). */
export const UNDO_WINDOW_MS = 10_000;

/** The fixed note an Undo inside the window writes (PO ruling 12, invariant 5). */
export const UNDO_NOTE = 'undone straight after entry';

/**
 * Events that still count: not withdrawals, not withdrawn, and not an assist
 * whose goal was withdrawn (#185 AC4). The assist stays in the log.
 */
export function standingEvents(events: MatchEvent[] | undefined): MatchEvent[] {
  const list = events ?? [];
  return list.filter((e) => e.kind !== 'withdrawn' && !isWithdrawn(list, e.id));
}

/** Withdrawn itself, or an assist that fell with its goal. */
export function isWithdrawn(events: MatchEvent[] | undefined, id: UUID): boolean {
  const list = events ?? [];
  const taken = (x: UUID) => list.some((e) => e.kind === 'withdrawn' && e.refersTo === x);
  if (taken(id)) return true;
  const event = list.find((e) => e.id === id);
  return event?.kind === 'assist' && event.refersTo !== null && taken(event.refersTo);
}

export interface Score {
  us: number;
  them: number;
}

/** Our goals and theirs, counted from the events (AC3). */
export function scoreOf(events: MatchEvent[] | undefined): Score {
  const standing = standingEvents(events);
  return {
    us: standing.filter((e) => e.kind === 'goal').length,
    them: standing.filter((e) => e.kind === 'conceded').length,
  };
}

export interface PlayerTally {
  playerId: UUID;
  goals: number;
  saves: number;
  conceded: number;
  /** #202: tapped shots plus goals, since a goal is a shot on target. Derived. */
  shotsOnTarget: number;
  /** #185 */
  assists: number;
  tackles: number;
  corners: number;
  freeKicks: number;
}

const TALLY: Partial<Record<MatchEvent['kind'], keyof Omit<PlayerTally, 'playerId'>>> = {
  goal: 'goals',
  shot_on_target: 'shotsOnTarget',
  save: 'saves',
  conceded: 'conceded',
  assist: 'assists',
  tackle: 'tackles',
  corner: 'corners',
  free_kick: 'freeKicks',
};

/** Each player's events, by kind (#84 AC6, #185 AC7). Players with none omitted. */
export function talliesOf(events: MatchEvent[] | undefined): PlayerTally[] {
  const rows = new Map<UUID, PlayerTally>();
  for (const e of standingEvents(events)) {
    const field = TALLY[e.kind];
    if (!e.playerId || !field) continue;
    const row = rows.get(e.playerId) ?? {
      playerId: e.playerId,
      goals: 0,
      saves: 0,
      conceded: 0,
      shotsOnTarget: 0,
      assists: 0,
      tackles: 0,
      corners: 0,
      freeKicks: 0,
    };
    row[field]++;
    rows.set(e.playerId, row);
  }
  // #202 AC2: every goal was a shot on target; the coach never taps twice.
  return [...rows.values()].map((r) => ({ ...r, shotsOnTarget: r.shotsOnTarget + r.goals }));
}

/**
 * The word under each picture button (#185 AC1). #228 item 3: the words are
 * short so they never truncate; the kinds (`shot_on_target`, `corner`,
 * `free_kick`) are unchanged, and "Shot" still means on target (Q1).
 */
export const TAP_LABEL: Record<TapEventKind, string> = {
  goal: 'Goal',
  shot_on_target: 'Shot',
  tackle: 'Tackle',
  corner: 'Corner',
  free_kick: 'Free kick',
  save: 'Save',
  conceded: 'Conceded',
};

/**
 * The picture buttons a tap on a player on the pitch offers, in order
 * (#185 AC1). The keeper's own two come first for the keeper.
 */
export function tapEventsFor(isKeeper: boolean): TapEventKind[] {
  const anyone: TapEventKind[] = ['goal', 'shot_on_target', 'tackle', 'corner', 'free_kick'];
  return isKeeper ? ['save', 'conceded', ...anyone] : anyone;
}

/**
 * How many picture buttons sit side by side for `count` of them. Four are a
 * 2 x 2 square, not three and a lonely one; everything else is up to three
 * across (PO feedback on the first beta: the tiles did not fill the box evenly).
 */
export function eventGridColumns(count: number): number {
  if (count <= 3) return Math.max(1, count);
  return count === 4 ? 2 : 3;
}

/**
 * The buttons split into rows of `eventGridColumns`; a short last row is
 * centred by the screen, so five read as 3 + 2 and never as a left-hand stub.
 */
export function eventGridRows<T>(items: T[]): T[][] {
  if (items.length === 0) return [];
  // Balanced, so the keeper's seven (#202) read as 3 + 2 + 2, never 3 + 3 + 1:
  // as many rows as the column count needs, the longer ones first.
  const count = Math.ceil(items.length / eventGridColumns(items.length));
  const base = Math.floor(items.length / count);
  const extra = items.length % count;
  const rows: T[][] = [];
  let at = 0;
  for (let r = 0; r < count; r++) {
    const size = base + (r < extra ? 1 : 0);
    rows.push(items.slice(at, at + size));
    at += size;
  }
  return rows;
}

/** Who can be offered as a goal's assist: everyone on the pitch but the scorer (#185 AC3). */
export function assistCandidates(onPitch: UUID[], scorer: UUID): UUID[] {
  return onPitch.filter((id) => id !== scorer);
}

/** The Undo button is offered while the tap is under ten seconds old. */
export function canQuickUndo(event: MatchEvent, now: Date): boolean {
  return now.getTime() - Date.parse(event.recordedAt) < UNDO_WINDOW_MS;
}

export interface StreamRow {
  atMs: number;
  text: string;
  /** Set for an event, so the row can be withdrawn. */
  eventId: UUID | null;
  withdrawn: boolean;
}

/**
 * Everything that happened, in match-time order: events, substitutions and
 * position swaps (AC4). Subs and swaps are read off the stints, which already
 * record them, so there is nothing to keep in step.
 */
export function timeStream(
  appearances: Appearance[],
  events: MatchEvent[] | undefined,
  players: Player[],
  /** The coach's own tally kinds' names (#198), by kind. */
  tallyLabels: ReadonlyMap<string, string> = new Map()
): StreamRow[] {
  const name = (id: UUID | null) =>
    (id && players.find((p) => p.id === id)?.firstName) || 'someone';
  const rows: StreamRow[] = [];

  // A substitution: a stint ending 'substitution' and another starting at the
  // same moment in the same position.
  for (const off of appearances.filter((a) => a.endReason === 'substitution')) {
    const on = appearances.find(
      (a) =>
        a.quarterId === off.quarterId &&
        a.positionId === off.positionId &&
        a.startElapsedMs === off.endElapsedMs &&
        a.playerId !== off.playerId
    );
    rows.push({
      atMs: off.endElapsedMs ?? 0,
      text: `Sub: ${name(on?.playerId ?? null)} on for ${name(off.playerId)}`,
      eventId: null,
      withdrawn: false,
    });
  }

  // A swap ends two stints with 'position_change' at the same moment.
  const changes = appearances.filter((a) => a.endReason === 'position_change');
  const seen = new Set<UUID>();
  for (const a of changes) {
    if (seen.has(a.id)) continue;
    const b = changes.find(
      (x) => x.id !== a.id && !seen.has(x.id) && x.quarterId === a.quarterId && x.endElapsedMs === a.endElapsedMs
    );
    seen.add(a.id);
    if (b) seen.add(b.id);
    rows.push({
      atMs: a.endElapsedMs ?? 0,
      text: b ? `Swap: ${name(a.playerId)} and ${name(b.playerId)}` : `${name(a.playerId)} changed position`,
      eventId: null,
      withdrawn: false,
    });
  }

  // Events after subs and swaps, so that at the same instant the change of
  // personnel reads first. The sort below is stable, so this order holds.
  for (const e of events ?? []) {
    if (e.kind === 'withdrawn') {
      rows.push({ atMs: e.atElapsedMs, text: `Withdrawn: ${e.note ?? ''}`, eventId: null, withdrawn: false });
      continue;
    }
    const custom = tallyLabels.get(e.kind);
    const text = custom ? `${custom}: ${e.playerId ? name(e.playerId) : 'team'}` : eventText(e, events ?? [], name);
    rows.push({ atMs: e.atElapsedMs, text, eventId: e.id, withdrawn: isWithdrawn(events, e.id) });
  }

  return rows.sort((x, y) => x.atMs - y.atMs);
}

/** How one event reads on the time stream (#84, #185). */
function eventText(e: MatchEvent, events: MatchEvent[], name: (id: UUID | null) => string): string {
  switch (e.kind) {
    case 'goal':
      return `Goal: ${name(e.playerId)}`;
    case 'save':
      return `Save: ${name(e.playerId)}`;
    case 'conceded':
      return `Conceded (${name(e.playerId)} in goal)`;
    case 'shot_on_target':
      return `${TAP_LABEL.shot_on_target}: ${name(e.playerId)}`;
    case 'tackle':
      return `Tackle: ${name(e.playerId)}`;
    case 'corner':
      return `${TAP_LABEL.corner}: ${name(e.playerId)}`;
    case 'free_kick':
      return `${TAP_LABEL.free_kick}: ${name(e.playerId)}`;
    case 'assist': {
      const scorer = events.find((g) => g.id === e.refersTo)?.playerId ?? null;
      return `Assist: ${name(e.playerId)} (${name(scorer)}'s goal)`;
    }
    default:
      // A kind a later version added: shown, never mistaken for another.
      return `${String(e.kind)}: ${name(e.playerId)}`;
  }
}

