/**
 * Play out a match as planned — #280 (Rob, 7 Nov: "play out the match as
 * planned … saved with the same status as a reconstructed match … for when a
 * coach couldn't make the match and noone recorded it").
 *
 * Pure TypeScript. The plan is run through the real match engine on a clock
 * that starts at the planned kick-off and steps from sub to sub, so the
 * record is written exactly as a live match writes it (the one record path):
 * every period started from its lineup, each planned sub made at its time,
 * every period ended, the match closed. Attendance is Who's coming:
 * `unconfirmed` is recorded as absent (ADR-024 D1). No goal or other event is
 * written; the coach may add them on the match page (#196).
 *
 * The caller then marks the match reconstructed (`markReconstructed`), so
 * provenance says "Its times may be approximate" and the toggle can leave it
 * out (#199). Nothing here is stored by itself (invariant 1).
 */

import { MatchEngine } from '../engine/MatchEngine';
import type { MatchState } from '../engine/MatchEngine';
import type { Format, Player, UUID } from '../types/index';
import { availabilityForOpening } from './matchLifecycle';
import { periodLengthMs, planFor, type MatchPlan } from './matchPlan';
import { periodNoun } from './matchClock';
import type { SavedMatch } from './persistence';
import { toTeamSheet } from './teamSheet';
import { markReconstructed, recordMatches, type Ledger } from './ledger';

/** Why a match cannot be played out from its plan, or null when it can. */
export function playOutRefusal(stored: SavedMatch, plan: MatchPlan | undefined, format: Format, players: Player[]): string | null {
  if (stored.quarters.some((q) => q.status !== 'pending')) return 'This match has already kicked off.';
  const periods = planFor(plan, stored.match.quarterCount).periods;
  const noun = periodNoun(stored.match.quarterCount);
  const available = availabilityForOpening(stored, players);
  for (const [i, period] of periods.entries()) {
    for (const pos of format.positions) {
      const who = period.slots[pos.id] ?? null;
      if (!who) return `The team sheet has an empty place in ${noun} ${i + 1}.`;
      if (available.get(who) !== 'available') return 'Someone on the team sheet is not marked Coming.';
    }
    for (const s of period.subs) {
      if (s.onId && available.get(s.onId) !== 'available') return 'Someone on the team sheet is not marked Coming.';
    }
    // QA on #279 (D1): a sub left out of date by a move by hand, e.g. its
    // child placed in a position, would stop the engine part way. Walk the
    // subs in time order as the engine will.
    const on = new Set(Object.values(period.slots).filter((id): id is UUID => id !== null));
    const inOrder = period.subs.map((s, k) => ({ s, k })).sort((x, y) => x.s.atMs - y.s.atMs || x.k - y.k);
    for (const { s } of inOrder) {
      if (!s.onId || !s.offId) continue;
      if (on.has(s.onId) || !on.has(s.offId)) return `A sub in ${noun} ${i + 1} no longer fits the team sheet. Open the sub and pick again.`;
      on.delete(s.offId);
      on.add(s.onId);
    }
  }
  return null;
}

/** A copy of a match's state at one moment (no structuredClone: Hermes lacks it). */
function copyOf(state: MatchState): MatchState {
  return {
    match: { ...state.match },
    quarters: state.quarters.map((q) => ({ ...q })),
    appearances: state.appearances.map((a) => ({ ...a })),
    benchStints: state.benchStints.map((b) => ({ ...b })),
    playerAvailability: new Map(state.playerAvailability),
    events: [...(state.events ?? [])],
  };
}

export interface PlayedOut {
  /** Just after kick-off: the record takes attendance from this, as from a live match. */
  atKickoff: MatchState;
  /** The match closed, every period played as planned. */
  played: MatchState;
}

/** The played match, as the engine records it, from the plan. */
export function playOutAsPlanned(input: {
  stored: SavedMatch;
  format: Format;
  plan: MatchPlan;
  players: Player[];
  /** The planned kick-off, else now. */
  start: Date;
}): PlayedOut {
  const { stored, format, players } = input;
  let now = input.start.getTime();
  const engine = new MatchEngine({ nowFn: () => new Date(now) });
  const state: MatchState = {
    match: { ...stored.match },
    quarters: stored.quarters.map((q) => ({ ...q })),
    appearances: [...stored.appearances],
    benchStints: [...stored.benchStints],
    playerAvailability: availabilityForOpening(stored, players),
    events: [...(stored.events ?? [])],
  };
  const periodMs = periodLengthMs(stored.match.totalMinutes, stored.match.quarterCount);
  const periods = planFor(input.plan, stored.match.quarterCount).periods;
  let atKickoff: MatchState | null = null;
  state.quarters.forEach((quarter, i) => {
    const period = periods[i];
    engine.startQuarter(state, quarter, toTeamSheet(period.slots), format);
    if (i === 0) atKickoff = copyOf(state);
    let at = 0;
    const subs = period.subs
      .filter((s): s is typeof s & { onId: UUID; offId: UUID } => s.onId !== null && s.offId !== null)
      .sort((a, b) => a.atMs - b.atMs);
    for (const sub of subs) {
      const atMs = Math.min(Math.max(sub.atMs, at), periodMs);
      now += atMs - at;
      at = atMs;
      engine.substitute(state, quarter, sub.offId, sub.onId);
    }
    now += periodMs - at;
    engine.endQuarter(state, quarter);
  });
  engine.completeMatch(state);
  return { atKickoff: atKickoff ?? copyOf(state), played: state };
}

/**
 * Write a played-out match to the record (#280): the kick-off snapshot first
 * (attendance, as a live match records it), then the match as played, then
 * the coach's statement that it was reconstructed from the plan.
 */
export function recordPlayedOut(
  ledger: Ledger,
  out: PlayedOut,
  format: Format,
  players: Player[],
  teamName: string,
  now: Date
): Ledger {
  const atKickoff = recordMatches(ledger, [{ ...out.atKickoff, format }], players, teamName, now);
  const played = recordMatches(atKickoff, [{ ...out.played, format }], players, teamName, now);
  const marked = markReconstructed(played, out.played.match.id, 'plan', 'Played out as planned: nobody recorded it live', now);
  return marked.ok ? marked.ledger : played;
}
