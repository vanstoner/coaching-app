/**
 * #255 (Rob, 7 Nov; ADR-026): power play. Pure TypeScript.
 *
 * Our side: the score prompts and the coach adds up to 3 extra outfield
 * players; nothing is stored about it but the intervals (D1). The allowance
 * is worked out on every draw from the standing goal and conceded events and
 * the season's rule (D3, D5). The opposition's power play is one
 * `opp_power_play` event (D4).
 */

import type { MatchEvent, UUID } from '../types/index';
import { standingEvents } from './matchEvents';

/** The three boxes as typed: steps, or why they are not saved (C4). */
export function readPowerPlayBoxes(boxes: readonly string[]): { ok: true; steps: number[] } | { ok: false; reason: string; box: number } {
  const steps: number[] = [];
  let emptySeen = false;
  for (let i = 0; i < 3; i++) {
    const raw = (boxes[i] ?? '').trim();
    if (raw === '') {
      emptySeen = true;
      continue;
    }
    const n = Number(raw);
    if (emptySeen) return { ok: false, reason: `Fill the ${['1st', '2nd'][i - 1]} box first.`, box: i };
    if (!Number.isInteger(n) || n < 1) return { ok: false, reason: 'A goal difference is a whole number, 1 or more.', box: i };
    const prev = steps[steps.length - 1];
    if (prev !== undefined && n <= prev) return { ok: false, reason: `Each box must be more than the one before (${prev}). Not saved yet.`, box: i };
    steps.push(n);
  }
  return { ok: true, steps };
}

/** "Behind by 4: 1 extra · 6: 2 extra. …" or the hint for no rule (C1, C3). */
export function powerPlayLine(steps: readonly number[]): string {
  if (steps.length === 0) return 'No power play prompts this season. Many leagues use 4, then 6.';
  return `Behind by ${steps.map((s, i) => `${s}: ${i + 1} extra`).join(' · ')}. The clock prompts you; it never adds anyone.`;
}

/** Goals for and against, from the standing events (a withdrawn one does not count). */
function margin(events: readonly MatchEvent[] | undefined): { us: number; them: number } {
  const standing = standingEvents(events as MatchEvent[] | undefined);
  return {
    us: standing.filter((e) => e.kind === 'goal').length,
    them: standing.filter((e) => e.kind === 'conceded').length,
  };
}

/** How many extra players the opposition's lead allows now (D3). */
export function powerPlayAllowance(events: readonly MatchEvent[] | undefined, steps: readonly number[]): number {
  const { us, them } = margin(events);
  const behind = them - us;
  return steps.filter((s) => behind >= s).length;
}

/** Whether our lead has reached the first step: the band offers "They used a power play" (C21). */
export function theirPowerPlayOffered(events: readonly MatchEvent[] | undefined, steps: readonly number[]): boolean {
  if (steps.length === 0) return false;
  const { us, them } = margin(events);
  return us - them >= steps[0];
}

/** Whether a standing `opp_power_play` event exists for the match (C21, C24). */
export function theyUsedPowerPlay(events: readonly MatchEvent[] | undefined): boolean {
  return standingEvents(events as MatchEvent[] | undefined).some((e) => e.kind === 'opp_power_play');
}

export type PowerPlayCue = { kind: 'add'; allowance: number } | { kind: 'over'; allowance: number } | null;

/** The cue under the score (C6, C7, C17): add while allowed and under 3, over while extras exceed it. */
export function powerPlayCue(allowance: number, extrasOn: number): PowerPlayCue {
  if (extrasOn > allowance) return { kind: 'over', allowance };
  if (allowance > extrasOn && extrasOn < 3) return { kind: 'add', allowance };
  return null;
}

/**
 * #255 (Rob, 9 Nov, "approve 1"): Power play is the FA's optional
 * mini-soccer law, "available through all mini soccer football formats 5v5
 * and 7v7" (Mini-Soccer Handbook 2025/26; NEHYL the same). No prompts at 9-
 * or 11-a-side, whatever the season's steps say.
 */
export const POWER_PLAY_MAX_SIDE = 7;
export function powerPlayFormat(onFieldCount: number | null): boolean {
  return onFieldCount === null || onFieldCount <= POWER_PLAY_MAX_SIDE;
}

/** The season's owed minutes as milliseconds, for ties in time-needed order; a keeper or fill-in (null) is left out. */
export function owedMsOf(rows: readonly { playerId: UUID; owed: number | null }[]): Map<UUID, number> {
  return new Map(rows.filter((r) => r.owed !== null).map((r) => [r.playerId, (r.owed as number) * 60_000]));
}

/** Bench children, least pitch time in this match first, ties by owed time, then squad order (C8). */
export function timeNeededOrder(
  bench: readonly UUID[],
  pitchMs: ReadonlyMap<UUID, number>,
  owedMs: ReadonlyMap<UUID, number> = new Map()
): UUID[] {
  return bench
    .map((id, i) => ({ id, i }))
    .sort(
      (a, b) =>
        (pitchMs.get(a.id) ?? 0) - (pitchMs.get(b.id) ?? 0) ||
        (owedMs.get(b.id) ?? 0) - (owedMs.get(a.id) ?? 0) ||
        a.i - b.i
    )
    .map((x) => x.id);
}

/** Children on the pitch, most pitch time first, the keeper left out (C18). */
export function mostTimeFirst(onPitch: readonly UUID[], keeper: UUID | null, pitchMs: ReadonlyMap<UUID, number>): UUID[] {
  return onPitch
    .filter((id) => id !== keeper)
    .map((id, i) => ({ id, i }))
    .sort((a, b) => (pitchMs.get(b.id) ?? 0) - (pitchMs.get(a.id) ?? 0) || a.i - b.i)
    .map((x) => x.id);
}
