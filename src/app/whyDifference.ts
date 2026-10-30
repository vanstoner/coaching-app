/**
 * "Why the difference: <name>" (#261 item 2, AC10 to AC12): the sum behind a
 * child's season figure, and the matches it comes from.
 *
 * Pure TypeScript, folded from the same `SquadViews` the Squad tab draws
 * (invariant 1), so the sheet and the list beside it cannot disagree:
 *
 * - the season line is `owedText` of the same `owedTime` row;
 * - the sum starts from `exactAverages`, as `owedTime` does: (squad average ×
 *   their matches) − their minutes, rounded once at the end;
 * - each match's fair share is `matchFairShare`, the rule the match report
 *   uses (AC1), so a match reads the same here and on its report.
 *
 * It states only what the record holds (AC12): a late arrival is a noted
 * attendance change to available (ruling F). Nothing about injury, illness
 * or the plan until #261 item 3 records them, and nothing suggesting a stint
 * can be corrected. First names only (invariant 4).
 */

import type { UUID } from '../types/index';
import { sideName } from './analysis';
import { FILL_IN_NOTE, MAIN_KEEPER_NOTE } from './childSeason';
import { matchFairShare, type NotInShare } from './fairShare';
import { exactAverages, owedText, type SquadViews } from './squadViews';

export interface WhyMatch {
  matchId: UUID;
  /** "Sat 8 Aug v Mock Albion". */
  label: string;
  minutesMs: number;
  /** That match's fair share; null when nobody is in it. */
  shareMs: number | null;
  /** Their minutes − the share; null when they are not in the share. */
  diffMs: number | null;
  notInShare: NotInShare | null;
  /** Marked here after kick-off in the record (ruling F). */
  late: boolean;
}

export interface WhyNotCounted {
  matchId: UUID;
  label: string;
  reason: string;
}

export interface WhyDifference {
  name: string;
  /** "16 min under the average this season", or why there is no figure. */
  headline: string;
  /** The sum that gives it, step by step; null without a figure. */
  sum: string | null;
  /** Each counted match they were at, oldest first. */
  matches: WhyMatch[];
  /** Missed, left out, another format or not closed, each with its reason. */
  notCounted: WhyNotCounted[];
}

/** "35:25": minutes and seconds, to the second. */
export function minSec(ms: number): string {
  const s = Math.round(Math.abs(ms) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** "+3:20", "−5:00", "0:00". */
export function signedMinSec(ms: number): string {
  const text = minSec(ms);
  if (text === '0:00') return text;
  return `${ms > 0 ? '+' : '−'}${text}`;
}

/** Null when the child is not in the views (left the squad). */
export function whyDifference(v: SquadViews, playerId: UUID): WhyDifference | null {
  const child = v.season.children.find((c) => c.playerId === playerId);
  const row = v.owed.find((r) => r.playerId === playerId);
  if (!child || !row) return null;
  const mainKeeper = new Map(v.season.children.map((c) => [c.playerId, c.mainKeeper]));

  const matches: WhyMatch[] = [];
  const notCounted: WhyNotCounted[] = [];
  for (const m of v.matches) {
    const label = `${m.date} v ${m.opponent}`;
    const mine = m.minutes.get(playerId);
    if (!mine) {
      notCounted.push({ matchId: m.matchId, label, reason: 'Not there' });
      continue;
    }
    if (m.offFormat !== null) {
      notCounted.push({
        matchId: m.matchId,
        label,
        reason: `${sideName(m.offFormat)}, not in fairness`,
      });
      continue;
    }
    if (!m.counted) {
      notCounted.push({
        matchId: m.matchId,
        label,
        reason: 'Left out of the figures',
      });
      continue;
    }
    const share = matchFairShare(
      [...m.minutes].map(([id, mm]) => ({
        playerId: id,
        pitchMs: mm.pitchMs,
        present: true,
        mainKeeper: mainKeeper.get(id) === true,
      })),
    );
    const out = share.out.get(playerId) ?? null;
    matches.push({
      matchId: m.matchId,
      label,
      minutesMs: mine.pitchMs,
      shareMs: share.shareMs,
      diffMs: out === null && share.shareMs !== null ? mine.pitchMs - share.shareMs : null,
      notInShare: out,
      late: m.late?.has(playerId) === true,
    });
  }
  for (const m of v.unclosed) {
    if (!m.players.has(playerId)) continue;
    notCounted.push({
      matchId: m.matchId,
      label: `${m.date} v ${m.opponent}`,
      reason: m.abandoned ? 'Abandoned' : 'Not ended with End match',
    });
  }

  const name = row.name;
  if (row.mainKeeper) {
    return {
      name,
      headline: `${MAIN_KEEPER_NOTE}, so never shown as under or over.`,
      sum: null,
      matches,
      notCounted,
    };
  }
  if (row.fillIn) {
    return {
      name,
      headline: `${FILL_IN_NOTE}, so never shown as under or over.`,
      sum: null,
      matches,
      notCounted,
    };
  }
  const { exact, avg } = exactAverages(v.season, v.matches);
  const own = exact.get(playerId);
  if (row.owed === null || avg === null || own === undefined) {
    return {
      name,
      headline: 'No counted matches yet this season.',
      sum: null,
      matches,
      notCounted,
    };
  }
  const n = matches.length;
  const words = row.owed === 0 ? 'level' : owedText(row.owed).replace(' the average', '');
  const sum = [
    `Squad average ${minSec(avg)} a game × ${n} ${n === 1 ? 'match' : 'matches'} = ${minSec(avg * n)}`,
    `they played ${minSec(own * n)}`,
    `difference ${words}`,
  ].join(' · ');
  const headline = row.owed === 0 ? 'Level with the average this season' : `${owedText(row.owed)} this season`;
  return { name, headline, sum, matches, notCounted };
}
