/**
 * Each child's season, in words — #121.
 *
 * Pure TypeScript: no React, no platform imports, nothing stored. Every figure
 * here is `seasonStats` (AC5: same ledger, same figures), read per child for
 * the Squad list and the child's page, plus two things that function does not
 * report and this one folds the same way:
 *
 * - **Played X of Y per competition.** Y is the closed matches of that
 *   competition the child was in the squad for (`countedAttendance`, ruling E),
 *   so a child who joined late is not "missing" matches before they joined.
 * - **In goal and outfield**, a game, over the closed matches, beside the
 *   outfield-share target (ADR-015 §3). The target is shown, never a fairness
 *   input (invariant 3).
 *
 * **The squad average (PO ruling, #121).** The mean of each child's minutes a
 * game, active children with at least one closed match. A child whose in-goal
 * preference is Main keeper is left out of it; when nobody is Main keeper
 * (shared gloves) everyone counts. Backups count. Each child's own figure is
 * still goal plus outfield: only the reference line moves.
 *
 * **Dominating format (ADR-015 §6a, #223).** Every figure here uses the
 * matches of the season's dominating format, as `seasonStats` works it out;
 * a match in the other format is in no count, split or average here.
 */

import type { Player, UUID } from '../types/index';
import { notCountedIds, type Ledger } from './ledger';
import { countedAttendance, firstSeen, type SquadTimeline } from './attendance';
import {
  competitionBucket,
  inFairness,
  offFormatOnlyText,
  seasonStats,
  goalOutfieldSplit,
  wholeMinutes,
  type CompetitionBucket,
  type SeasonOptions,
} from './analysis';
import { outfieldShare, targetOf, type OutfieldShare } from './outfieldTarget';

const MIN = 60_000;

/** The match screens' hint towards the wider figures (#121 AC1). Plain text, not a link. */
export const SEASON_POINTER = "Season figures are on each child's page in Squad";

/** The Main keeper's note on their row and page (PO ruling, #121). */
export const MAIN_KEEPER_NOTE = 'Main keeper, not in the squad average';

/**
 * A fill-in's note on their row and page (#190). Their minutes are recorded
 * and shown; they are left out of the squad average, the fairness figures
 * and "who's owed time" for the whole season (PO ruling, 18 Oct).
 */
export const FILL_IN_NOTE = 'Fill-in, not counted in fairness';

/** The order competitions are read out in. */
export const COMPETITION_LINES: readonly { key: CompetitionBucket; label: string; always: boolean }[] = [
  { key: 'league', label: 'League', always: true },
  { key: 'cup', label: 'Cup', always: true },
  { key: 'friendly', label: 'Friendly', always: true },
  // Only when the child has played one (#121 AC3).
  { key: 'tournament', label: 'Tournament', always: false },
  { key: 'other', label: 'Other', always: false },
];

export interface CompetitionLine {
  key: CompetitionBucket;
  label: string;
  /** Closed matches of this competition attended. */
  played: number;
  /** Closed matches of this competition the child was in the squad for. */
  of: number;
  averageMs: number | null;
  /** "League: 31 min a game, played 4 of 6" or "Cup: did not play, 0 of 2". */
  text: string;
}

export interface ChildSeason {
  playerId: UUID;
  name: string;
  /** Closed matches attended. */
  played: number;
  missed: number;
  /** played + missed: the closed matches they were in the squad for. */
  of: number;
  /** Minutes a game: goal plus outfield, per closed match attended. */
  averageMs: number | null;
  /** In-goal preference is Main keeper: not in the squad average. */
  mainKeeper: boolean;
  /** Marked not counted in fairness (#190): out of the squad average, fairness and owed time. */
  fillIn: boolean;
  competitions: CompetitionLine[];
  /** Per closed match attended; null when none attended. */
  goalMsPerGame: number | null;
  outfieldMsPerGame: number | null;
  share: OutfieldShare;
  /** Counted matches attended in another format than the dominating one (§6a): in no figure here. */
  offFormat: number;
  /**
   * "31 min a game · played 4 of 6", "No matches yet", or (R5) "Played 1
   * five-a-side match, not in fairness".
   */
  summary: string;
}

export interface SquadSeason {
  /** The squad passed in, in its own order (PO ruling: the list keeps its order). */
  children: ChildSeason[];
  /** Null when nobody counted has a closed match. */
  squadAverageMs: number | null;
  /** The bars' scale: the longest closed match, at least the longest average. */
  scaleMs: number;
  countedMatches: number;
  /** §6a: "Fairness uses 7-a-side matches: 1 five-a-side match left out"; null when none is. */
  formatNote: string | null;
}

/** The line for one competition. */
export function competitionText(label: string, played: number, of: number, averageMs: number | null): string {
  if (played === 0 || averageMs === null) return `${label}: did not play, 0 of ${of}`;
  return `${label}: ${wholeMinutes(averageMs)} min a game, played ${played} of ${of}`;
}

/**
 * A keeper's split, a game: "In goal 38 min a game, outfield 12". The two
 * add up to the minutes a game shown above them (#142): rounded one by one,
 * 37.6 and 12.6 read 38 and 13 beside 50. Null before their first match.
 */
export function goalOutfieldLine(
  c: Pick<ChildSeason, 'averageMs' | 'goalMsPerGame' | 'outfieldMsPerGame'>
): string | null {
  if (c.goalMsPerGame === null || c.outfieldMsPerGame === null) return null;
  const { goal, outfield } = goalOutfieldSplit(
    c.goalMsPerGame,
    c.outfieldMsPerGame,
    c.averageMs ?? c.goalMsPerGame + c.outfieldMsPerGame
  );
  return `In goal ${goal} min a game, outfield ${outfield}`;
}

/**
 * The Squad row's line. `offFormatSides`: the sides of the matches they
 * played that are left out for their format (§6a). With no fairness figure,
 * those are said (R5), never "No matches yet".
 */
export function seasonSummary(
  averageMs: number | null,
  played: number,
  of: number,
  offFormatSides: readonly number[] = []
): string {
  if (averageMs === null) return offFormatSides.length > 0 ? offFormatOnlyText(offFormatSides) : 'No matches yet';
  return `${wholeMinutes(averageMs)} min a game · played ${played} of ${of}`;
}

/**
 * The squad average under the keeper ruling: Main keepers out when there is
 * one, everyone in otherwise. Children without a closed match do not count.
 */
export function squadAverage(
  children: readonly (Pick<ChildSeason, 'averageMs' | 'mainKeeper'> & { fillIn?: boolean })[]
): number | null {
  const anyMain = children.some((c) => c.mainKeeper && !c.fillIn);
  const counted = children
    .filter((c) => !c.fillIn && !(anyMain && c.mainKeeper))
    .map((c) => c.averageMs)
    .filter((ms): ms is number => ms !== null);
  if (counted.length === 0) return null;
  return Math.round(counted.reduce((sum, ms) => sum + ms, 0) / counted.length);
}

/**
 * Every active child's season, and the squad average. `players` is the
 * working squad; retired children are left out of the list and the average.
 */
export function squadSeason(
  ledger: Ledger | null,
  players: Player[],
  options: Pick<SeasonOptions, 'kickoffs'> = {}
): SquadSeason {
  const active = players.filter((p) => p.active !== false);
  const stats = ledger ? seasonStats(ledger, players, options) : null;
  const fillIns = notCountedIds(ledger);

  // Per competition, who was in the squad; and goal / outfield over closed matches.
  const ofBucket = new Map<UUID, Record<CompetitionBucket, number>>();
  const goalMs = new Map<UUID, number>();
  const outMs = new Map<UUID, number>();
  let longestMs = 0;
  if (ledger) {
    const timeline: SquadTimeline = { players, kickoffs: options.kickoffs };
    const seen = firstSeen(ledger);
    // The same dominating format as the averages, or the counts disagree with them.
    const side = stats?.side ?? null;
    for (const m of ledger.matches) {
      if (!inFairness(m, side)) continue;
      longestMs = Math.max(longestMs, m.totalMinutes * MIN);
      const bucket = competitionBucket(m.competition);
      const { attended, missed } = countedAttendance(ledger, m, timeline, seen);
      for (const id of [...attended, ...missed]) {
        let row = ofBucket.get(id);
        if (!row) {
          row = { league: 0, cup: 0, friendly: 0, tournament: 0, other: 0 };
          ofBucket.set(id, row);
        }
        row[bucket]++;
      }
      for (const i of m.intervals) {
        const ms = Math.max(0, i.endMs - i.startMs);
        const into = i.kind === 'goalkeeper' ? goalMs : outMs;
        into.set(i.playerId, (into.get(i.playerId) ?? 0) + ms);
      }
    }
  }

  const children: ChildSeason[] = active.map((p) => {
    const s = stats?.players.find((x) => x.playerId === p.id);
    const played = s?.attended ?? 0;
    const missed = s?.missed ?? 0;
    const averageMs = s?.averageMs ?? null;
    const of = played + missed;
    const competitions: CompetitionLine[] = COMPETITION_LINES.flatMap(({ key, label, always }) => {
      const b = s?.byCompetition[key];
      const bPlayed = b?.attended ?? 0;
      const bOf = Math.max(ofBucket.get(p.id)?.[key] ?? 0, bPlayed);
      const show = always ? bOf > 0 : bPlayed > 0;
      if (!show) return [];
      const bAvg = b?.averageMs ?? null;
      return [{ key, label, played: bPlayed, of: bOf, averageMs: bAvg, text: competitionText(label, bPlayed, bOf, bAvg) }];
    });
    const g = goalMs.get(p.id) ?? 0;
    const o = outMs.get(p.id) ?? 0;
    return {
      playerId: p.id,
      name: s?.name ?? p.firstName,
      played,
      missed,
      of,
      averageMs,
      mainKeeper: p.keeper === 'main',
      fillIn: fillIns.has(p.id),
      competitions,
      goalMsPerGame: played === 0 ? null : Math.round(g / played),
      outfieldMsPerGame: played === 0 ? null : Math.round(o / played),
      share: outfieldShare(o, g, targetOf(p)),
      offFormat: s?.offFormatSides.length ?? 0,
      summary: seasonSummary(averageMs, played, of, s?.offFormatSides ?? []),
    };
  });

  const scaleMs = Math.max(longestMs, MIN, ...children.map((c) => c.averageMs ?? 0));
  return {
    children,
    squadAverageMs: squadAverage(children),
    scaleMs,
    countedMatches: stats?.countedMatches ?? 0,
    formatNote: stats?.formatNote ?? null,
  };
}
