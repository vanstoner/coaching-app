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

import type { Appearance, MatchEvent, Player, UUID } from '../types/index';

/** How long the touchline Undo is offered after a tap (PO ruling 12). */
export const UNDO_WINDOW_MS = 10_000;

/** The fixed note an Undo inside the window writes (PO ruling 12, invariant 5). */
export const UNDO_NOTE = 'undone straight after entry';

/** Events that still count: not withdrawals, and not withdrawn. */
export function standingEvents(events: MatchEvent[] | undefined): MatchEvent[] {
  const list = events ?? [];
  const withdrawn = new Set(
    list.filter((e) => e.kind === 'withdrawn' && e.refersTo).map((e) => e.refersTo as UUID)
  );
  return list.filter((e) => e.kind !== 'withdrawn' && !withdrawn.has(e.id));
}

export function isWithdrawn(events: MatchEvent[] | undefined, id: UUID): boolean {
  return (events ?? []).some((e) => e.kind === 'withdrawn' && e.refersTo === id);
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
}

/** Each player's goals, saves and goals conceded (AC6). Players with none omitted. */
export function talliesOf(events: MatchEvent[] | undefined): PlayerTally[] {
  const rows = new Map<UUID, PlayerTally>();
  for (const e of standingEvents(events)) {
    if (!e.playerId) continue;
    const row = rows.get(e.playerId) ?? { playerId: e.playerId, goals: 0, saves: 0, conceded: 0 };
    if (e.kind === 'goal') row.goals++;
    else if (e.kind === 'save') row.saves++;
    else if (e.kind === 'conceded') row.conceded++;
    rows.set(e.playerId, row);
  }
  return [...rows.values()];
}

/** The Undo button is offered while the tap is under ten seconds old. */
export function canQuickUndo(event: MatchEvent, now: Date): boolean {
  return now.getTime() - Date.parse(event.recordedAt) < UNDO_WINDOW_MS;
}

export interface StreamRow {
  atMs: number;
  text: string;
  /** Set for a goal, save or conceded event, so the row can be withdrawn. */
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
  players: Player[]
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
    const text =
      e.kind === 'goal'
        ? `Goal: ${name(e.playerId)}`
        : e.kind === 'save'
          ? `Save: ${name(e.playerId)}`
          : `Conceded (${name(e.playerId)} in goal)`;
    rows.push({ atMs: e.atElapsedMs, text, eventId: e.id, withdrawn: isWithdrawn(events, e.id) });
  }

  return rows.sort((x, y) => x.atMs - y.atMs);
}
