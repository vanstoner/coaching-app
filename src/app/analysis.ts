/**
 * The match report and the analysis charts' numbers — #104, #105, #103.
 *
 * Pure TypeScript: no React, no platform imports, no storage (ADR-016 §3).
 * Every figure is folded on read from the match record and the ledger, and
 * nothing here is stored (invariant 1). The screens only draw what this
 * returns.
 *
 * Figures follow ADR-015:
 *
 * - **Pitch time** is goal plus outfield (§1). Bench time is not pitch time.
 * - **Attended** means `available` at kick-off (§4). A match recorded before
 *   attendance existed has none, and attended is inferred as "played any
 *   interval" (§5), computed here and never stored.
 * - **Counted matches** are the closed ones (§6): `completed`, which only
 *   the coach's End match sets (PO ruling D, #98). A match whose periods
 *   have all ended but which has not been closed does not count yet; an
 *   abandoned one never does.
 * - **In the squad at kick-off** (ruling E): who attended and missed each
 *   match is `attendance.countedAttendance`, the one rule the Settings
 *   figures fold with too.
 * - **Season average** = pitch time over counted matches attended ÷ counted
 *   matches attended; null when none, never zero (§7).
 * - **Competition split**: league, cup, friendly and tournament each have
 *   their own column (PO ruling N3, #98, settling #103 AC3); a null
 *   competition is league (§8). A competition this build does not know (a
 *   later version's, carried in the ledger) goes to "Other", shown only
 *   when it holds something.
 * - **The shadow** excludes the match being viewed (§9).
 *
 * Synthetic first names only in tests (invariant 4).
 */

import type { MatchEngine, MatchState } from '../engine/MatchEngine';
import type {
  AvailabilityStatus,
  Competition,
  Format,
  Player,
  UUID,
} from '../types/index';
import type { Ledger, LedgerMatch, LedgerPlayer } from './ledger';
import { countedAttendance, firstSeen, type SquadTimeline } from './attendance';
import { foldPlayerMinutes } from './playerMinutes';
import { scoreOf, talliesOf, type Score } from './matchEvents';
import { displayName } from './squad';

const MIN = 60_000;

/** Whole minutes, as every chart label shows them. */
export function wholeMinutes(ms: number): number {
  return Math.round(ms / MIN);
}

/**
 * Whole numbers for parts that add up to the whole number shown for their
 * total (#142, #143 AC10). Rounding each part on its own does not: 37.6 and
 * 12.6 round to 38 and 13 beside a total of 50.
 *
 * Largest remainder: every part is floored, then the units still missing go
 * to the largest fractions, the earlier part first on a tie. `total` is the
 * figure the screen shows for the total. If it is a unit away from the parts'
 * own sum (each was rounded from slightly different ms), units are taken back
 * from the smallest fractions, never below zero, so the parts still add up.
 */
export function largestRemainder(parts: readonly number[], total: number): number[] {
  const safe = parts.map((p) => (Number.isFinite(p) && p > 0 ? p : 0));
  const out = safe.map((p) => Math.floor(p));
  const target = Number.isFinite(total) ? Math.max(0, Math.round(total)) : 0;
  let rest = target - out.reduce((sum, n) => sum + n, 0);
  const byFraction = safe
    .map((p, i) => ({ i, f: p - Math.floor(p) }))
    .sort((a, b) => b.f - a.f || a.i - b.i);
  for (let k = 0; rest > 0 && byFraction.length > 0; k = (k + 1) % byFraction.length, rest--) {
    out[byFraction[k].i]++;
  }
  // Too many: smallest fractions give one back first.
  const smallestFirst = [...byFraction].reverse();
  while (rest < 0) {
    const from = smallestFirst.find(({ i }) => out[i] > 0);
    if (!from) break;
    out[from.i]--;
    rest++;
  }
  return out;
}

/** Whole-minute parts that add up to `wholeMinutes(totalMs)`, the total shown beside them. */
export function wholeMinuteParts(partsMs: readonly number[], totalMs: number): number[] {
  return largestRemainder(
    partsMs.map((ms) => ms / MIN),
    wholeMinutes(totalMs)
  );
}

/**
 * In goal and outfield beside their total, in whole minutes that add up
 * (#142): the one split the match report, the season grid and a child's page
 * all draw. `totalMs` defaults to the two parts' sum; the child page passes
 * its minutes a game, which is rounded from slightly different ms.
 */
export function goalOutfieldSplit(
  goalMs: number,
  outfieldMs: number,
  totalMs: number = goalMs + outfieldMs
): { total: number; goal: number; outfield: number } {
  const [goal, outfield] = wholeMinuteParts([goalMs, outfieldMs], totalMs);
  return { total: wholeMinutes(totalMs), goal, outfield };
}

/**
 * Whole-second parts that add up to the seconds `formatClock(totalMs)` shows
 * (it floors), for a table of mm:ss parts beside their total.
 */
export function wholeSecondParts(partsMs: readonly number[], totalMs: number): number[] {
  return largestRemainder(
    partsMs.map((ms) => ms / 1000),
    Math.floor(Math.max(0, totalMs) / 1000)
  );
}

/**
 * One row of the Settings minutes table, in whole seconds that add up
 * (#142, #143 AC10): Out and GK to Total; DEF, MID and FWD to Out when every
 * outfield minute has a unit. Time from an early match with no unit cannot be
 * shared out, so then each unit is floored as before.
 */
export function minutesRowSeconds(row: {
  outfieldMs: number;
  goalkeeperMs: number;
  byUnit: Record<'DEF' | 'MID' | 'ATT', number>;
}): { outfield: number; goal: number; total: number; byUnit: Record<'DEF' | 'MID' | 'ATT', number> } {
  const totalMs = row.outfieldMs + row.goalkeeperMs;
  const [outfield, goal] = wholeSecondParts([row.outfieldMs, row.goalkeeperMs], totalMs);
  const unitsMs = [row.byUnit.DEF, row.byUnit.MID, row.byUnit.ATT];
  const placed = unitsMs.reduce((sum, ms) => sum + ms, 0) === row.outfieldMs;
  const [DEF, MID, ATT] = placed
    ? largestRemainder(
        unitsMs.map((ms) => ms / 1000),
        outfield
      )
    : unitsMs.map((ms) => Math.floor(Math.max(0, ms) / 1000));
  return { outfield, goal, total: outfield + goal, byUnit: { DEF, MID, ATT } };
}

/**
 * Rows in squad order: the order of `players`, as the Squad list and the
 * squad views show them (#143 AC7, PO ruling Q1: nothing is ranked). Anyone
 * not in `players` (known to the ledger only) follows, in the order given.
 * Never by minutes.
 */
export function inSquadOrder<T extends { playerId: UUID }>(
  rows: readonly T[],
  players: readonly Pick<Player, 'id'>[]
): T[] {
  const at = new Map(players.map((p, i) => [p.id, i]));
  return rows
    .map((row, i) => ({ row, i, k: at.get(row.playerId) ?? players.length }))
    .sort((a, b) => a.k - b.k || a.i - b.i)
    .map(({ row }) => row);
}

function nameOf(players: Player[], ledgerPlayers: LedgerPlayer[], id: UUID): string {
  const p = players.find((x) => x.id === id);
  if (p) return displayName(p);
  const l = ledgerPlayers.find((x) => x.id === id);
  if (l) return l.displaySuffix ? `${l.firstName} ${l.displaySuffix}` : l.firstName;
  return 'Unknown';
}

// ============================================================================
// #104: the match report
// ============================================================================

export interface ReportPlayer {
  playerId: UUID;
  name: string;
  /** Goal plus outfield (ADR-015 §1). */
  totalMs: number;
  goalMs: number;
  outfieldMs: number;
  /** totalMs minus the match's fair share. */
  deltaMs: number;
}

export interface ReportSub {
  atMs: number;
  onId: UUID | null;
  offId: UUID;
}

export interface MatchReport {
  matchId: UUID;
  opponent: string | null;
  competition: Competition | null;
  kickoffAt: string | null;
  totalMinutes: number;
  periodCount: number;
  /** "7-a-side", when the match's own shape is known (ADR-012). */
  formatName: string | null;
  score: Score;
  /** Each scorer once, most goals first. */
  scorers: { playerId: UUID; name: string; goals: number }[];
  /** Each keeper who made a save or was in goal for a goal against. */
  keepers: { playerId: UUID; name: string; saves: number; conceded: number }[];
  saves: number;
  conceded: number;
  /** Everyone available at kick-off, in squad order (PO ruling Q1, #143). */
  players: ReportPlayer[];
  /**
   * Total pitch time this match ÷ the players who attended it: what each
   * would have had if it had been shared equally (ADR-015 §1).
   */
  fairShareMs: number;
  subs: ReportSub[];
  absentees: { playerId: UUID; name: string; status: AvailabilityStatus }[];
}

/**
 * Who attended this match, from the match record.
 *
 * The availability map is recorded at creation and is what kick-off played
 * with. A player with time but no entry (impossible through the engine, but a
 * damaged record must not lose a child's time) is counted as attended.
 */
function attendedIn(state: MatchState): Set<UUID> {
  const ids = new Set<UUID>();
  for (const [id, status] of state.playerAvailability) if (status === 'available') ids.add(id);
  for (const a of state.appearances) ids.add(a.playerId);
  return ids;
}

/**
 * The full-time report (#104 AC2). Folded from the match record every time
 * (AC3): nothing it returns is kept. During a match the open intervals are
 * closed at the engine's live elapsed time, from the wall-clock anchors
 * (invariant 2).
 */
export function matchReport(
  engine: MatchEngine,
  state: MatchState,
  players: Player[],
  format?: Format | null
): MatchReport {
  const name = (id: UUID) => nameOf(players, [], id);
  const attended = attendedIn(state);
  const minutes = foldPlayerMinutes(engine, state, players).filter((m) => attended.has(m.playerId));
  const totalPitch = minutes.reduce((sum, m) => sum + m.outfieldMs + m.goalkeeperMs, 0);
  const fairShareMs = minutes.length === 0 ? 0 : Math.round(totalPitch / minutes.length);

  // PO ruling Q1 (#143 AC7): squad order, never by minutes.
  const rows: ReportPlayer[] = inSquadOrder(minutes, players)
    .map((m) => {
      const totalMs = m.outfieldMs + m.goalkeeperMs;
      return {
        playerId: m.playerId,
        name: name(m.playerId),
        totalMs,
        goalMs: m.goalkeeperMs,
        outfieldMs: m.outfieldMs,
        deltaMs: totalMs - fairShareMs,
      };
    });

  const tallies = talliesOf(state.events);
  const score = scoreOf(state.events);

  // A substitution: a stint ending 'substitution', and the stint that starts
  // in the same position at the same moment (as matchEvents.timeStream reads it).
  const subs: ReportSub[] = state.appearances
    .filter((a) => a.endReason === 'substitution')
    .map((off) => {
      const on = state.appearances.find(
        (a) =>
          a.quarterId === off.quarterId &&
          a.positionId === off.positionId &&
          a.startElapsedMs === off.endElapsedMs &&
          a.playerId !== off.playerId
      );
      return { atMs: off.endElapsedMs ?? 0, onId: on?.playerId ?? null, offId: off.playerId };
    })
    .sort((a, b) => a.atMs - b.atMs);

  const absentees = [...state.playerAvailability]
    .filter(([id, status]) => status !== 'available' && !attended.has(id))
    .map(([playerId, status]) => ({ playerId, name: name(playerId), status }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    matchId: state.match.id,
    opponent: state.match.opponent,
    competition: state.match.competition,
    kickoffAt: state.match.kickoffAt,
    totalMinutes: state.match.totalMinutes,
    periodCount: state.match.quarterCount,
    formatName: format?.name ?? null,
    score,
    scorers: tallies
      .filter((t) => t.goals > 0)
      .map((t) => ({ playerId: t.playerId, name: name(t.playerId), goals: t.goals }))
      .sort((a, b) => b.goals - a.goals || a.name.localeCompare(b.name)),
    keepers: tallies
      .filter((t) => t.saves > 0 || t.conceded > 0)
      .map((t) => ({ playerId: t.playerId, name: name(t.playerId), saves: t.saves, conceded: t.conceded }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    saves: tallies.reduce((sum, t) => sum + t.saves, 0),
    conceded: score.them,
    players: rows,
    fairShareMs,
    subs,
    absentees,
  };
}

// ============================================================================
// Season figures (ADR-015 §4–§8, #102 AC3, #103)
// ============================================================================

/** Whether a ledger match counts towards averages: closed (ADR-015 §6, ruling D). */
export function isCounted(match: Pick<LedgerMatch, 'status'>): boolean {
  return match.status === 'completed';
}

const KNOWN_COMPETITIONS: readonly string[] = ['league', 'cup', 'friendly', 'tournament'];

/** A competition, or "other" for one this build does not know. */
export type CompetitionBucket = Competition | 'other';

/**
 * The bucket a match sits in. Null counts as league (#103 AC3). A competition
 * this build does not know — a later version's, carried in the ledger
 * (#99 AC2) — goes to "other" (PO ruling N3): never another column, and
 * never a crash (QA on #103).
 */
export function competitionBucket(c: Competition | null): CompetitionBucket {
  if (c === null) return 'league';
  return KNOWN_COMPETITIONS.includes(c) ? c : 'other';
}

export interface Bucket {
  attended: number;
  pitchMs: number;
  /** pitchMs ÷ attended; null when none attended, never zero. */
  averageMs: number | null;
}

export interface SeasonPlayer {
  playerId: UUID;
  name: string;
  retired: boolean;
  /** Counted matches attended. */
  attended: number;
  /**
   * Counted matches missed: recorded absent, injured or unavailable, or (v1)
   * in the squad at kick-off and did not play.
   */
  missed: number;
  /** All pitch time in the ledger, every match, abandoned included (§6). */
  pitchMs: number;
  /** ADR-015 §7. Null when no counted match attended. */
  averageMs: number | null;
  byCompetition: Record<CompetitionBucket, Bucket>;
}

export interface SeasonStats {
  players: SeasonPlayer[];
  countedMatches: number;
  /** Counted matches whose attendance was inferred (§5): the season view says so. */
  inferredMatches: number;
}

export interface SeasonOptions {
  /** Left out of the averages (§9: the shadow excludes the match viewed). */
  excludeMatchId?: UUID | null;
  /**
   * Kick-off of a match with no `kickoffAt`: its first period's start
   * (`attendance.kickoffTimes`), for ruling E.
   */
  kickoffs?: ReadonlyMap<UUID, string>;
}

const emptyBucket = (): Bucket => ({ attended: 0, pitchMs: 0, averageMs: null });
const average = (b: Bucket): Bucket => ({
  ...b,
  averageMs: b.attended === 0 ? null : Math.round(b.pitchMs / b.attended),
});

/**
 * Each player's season (#102 AC3, #103): attended, missed, pitch time and the
 * average per match attended, overall and per competition.
 *
 * Players listed are the squad passed in plus anyone the ledger has time or
 * attendance for, so a retired child's season is not dropped.
 */
export function seasonStats(ledger: Ledger, players: Player[], options: SeasonOptions = {}): SeasonStats {
  const ids: UUID[] = players.map((p) => p.id);
  const add = (id: UUID) => {
    if (!ids.includes(id)) ids.push(id);
  };

  interface Acc {
    attended: number;
    missed: number;
    pitchMs: number;
    buckets: Record<CompetitionBucket, Bucket>;
  }
  const acc = new Map<UUID, Acc>();
  const of = (id: UUID): Acc => {
    let a = acc.get(id);
    if (!a) {
      a = {
        attended: 0,
        missed: 0,
        pitchMs: 0,
        buckets: {
          league: emptyBucket(),
          cup: emptyBucket(),
          friendly: emptyBucket(),
          tournament: emptyBucket(),
          other: emptyBucket(),
        },
      };
      acc.set(id, a);
      add(id);
    }
    return a;
  };
  // Everyone the ledger knows, too, so a v1 match's "missed" (below) does not
  // depend on the order players were first seen in.
  for (const p of ledger.players) add(p.id);
  for (const id of ids) of(id);

  let countedMatches = 0;
  let inferredMatches = 0;
  const timeline: SquadTimeline = { players, kickoffs: options.kickoffs };
  const seen = firstSeen(ledger);

  for (const m of ledger.matches) {
    const pitch = new Map<UUID, number>();
    for (const i of m.intervals) {
      pitch.set(i.playerId, (pitch.get(i.playerId) ?? 0) + Math.max(0, i.endMs - i.startMs));
    }
    // Season totals: every match's minutes (§6).
    for (const [id, ms] of pitch) of(id).pitchMs += ms;

    if (!isCounted(m) || m.id === options.excludeMatchId) continue;
    countedMatches++;

    const { inferred, attended, missed } = countedAttendance(ledger, m, timeline, seen);
    if (inferred) inferredMatches++;

    const bucket = competitionBucket(m.competition);
    for (const id of attended) {
      const a = of(id);
      a.attended++;
      a.buckets[bucket].attended++;
      a.buckets[bucket].pitchMs += pitch.get(id) ?? 0;
    }
    for (const id of missed) of(id).missed++;
  }

  const rows: SeasonPlayer[] = ids.map((id) => {
    const a = of(id);
    const squadPlayer = players.find((p) => p.id === id);
    const ledgerPlayer = ledger.players.find((p) => p.id === id);
    const byCompetition = {
      league: average(a.buckets.league),
      cup: average(a.buckets.cup),
      friendly: average(a.buckets.friendly),
      tournament: average(a.buckets.tournament),
      other: average(a.buckets.other),
    };
    const countedMs = Object.values(a.buckets).reduce((sum, b) => sum + b.pitchMs, 0);
    return {
      playerId: id,
      name: nameOf(players, ledger.players, id),
      retired: squadPlayer ? squadPlayer.active === false : ledgerPlayer ? !ledgerPlayer.active : false,
      attended: a.attended,
      missed: a.missed,
      pitchMs: a.pitchMs,
      averageMs: a.attended === 0 ? null : Math.round(countedMs / a.attended),
      byCompetition,
    };
  });

  return { players: rows, countedMatches, inferredMatches };
}

// ============================================================================
// #105 AC1: this match against the shadow
// ============================================================================

export interface MatchChartRow {
  playerId: UUID;
  name: string;
  thisMatchMs: number;
  goalMs: number;
  outfieldMs: number;
  /** Season average per counted match attended, excluding this match. */
  shadowMs: number | null;
  /** "Ava 32 · avg 28", or "Ava 12 · no average yet". Also the a11y label. */
  label: string;
}

export interface MatchChart {
  rows: MatchChartRow[];
  /** One axis for the chart (ADR-016 §4): the longest of the match, a bar, a shadow. */
  maxMs: number;
  /** Not available at kick-off: named underneath, never a zero bar. */
  absent: string[];
}

/**
 * The this-match chart (#105 AC1, ADR-016 §4).
 *
 * **The shadow excludes this match** (ADR-015 §9), but includes every other
 * counted match, later ones too when an old match is reopened. Excluding it
 * keeps a live match from being compared with itself (its partial minutes
 * would drag its own "usual" down while it is played), and keeps a finished
 * match's bar from being half of its own shadow. It is "their usual, from the
 * other matches", which is the question asked when subbing.
 *
 * **Order: furthest below their usual first** (ADR-016 §4), the subbing
 * question. Players with no average yet follow, least played first. Ties by
 * name, so the order does not shuffle between repaints.
 */
export function matchChart(
  report: MatchReport,
  ledger: Ledger | null,
  players: Player[],
  options: Omit<SeasonOptions, 'excludeMatchId'> = {}
): MatchChart {
  const season = ledger
    ? seasonStats(ledger, players, { ...options, excludeMatchId: report.matchId })
    : null;
  const shadowOf = (id: UUID) => season?.players.find((p) => p.playerId === id)?.averageMs ?? null;

  const rows: MatchChartRow[] = report.players.map((p) => {
    const shadowMs = shadowOf(p.playerId);
    return {
      playerId: p.playerId,
      name: p.name,
      thisMatchMs: p.totalMs,
      goalMs: p.goalMs,
      outfieldMs: p.outfieldMs,
      shadowMs,
      label: `${p.name} ${wholeMinutes(p.totalMs)} · ${
        shadowMs === null ? 'no average yet' : `avg ${wholeMinutes(shadowMs)}`
      }`,
    };
  });

  rows.sort((a, b) => {
    if (a.shadowMs !== null && b.shadowMs !== null) {
      return (
        a.thisMatchMs - a.shadowMs - (b.thisMatchMs - b.shadowMs) || a.name.localeCompare(b.name)
      );
    }
    if (a.shadowMs !== null) return -1;
    if (b.shadowMs !== null) return 1;
    return a.thisMatchMs - b.thisMatchMs || a.name.localeCompare(b.name);
  });

  const maxMs = Math.max(
    report.totalMinutes * MIN,
    ...rows.map((r) => r.thisMatchMs),
    ...rows.map((r) => r.shadowMs ?? 0)
  );

  return { rows, maxMs, absent: report.absentees.map((a) => a.name) };
}
