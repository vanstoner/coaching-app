/**
 * Edit a saved fixture before kick-off — #301 (Rob, 20 Nov: "How do I edit
 * the opposition team name when I have saved a fixture placeholder?"; the
 * criteria approved with "approve 300, 301, 302 as 2.5.1").
 *
 * Pure. The match keeps its id, Who's coming and its team sheet. Its length,
 * periods and shape may change: a shape change re-places each period by area
 * (#298, `switchShape`); a length or period change keeps who starts and
 * clears the planned subs (their times belong to the old length).
 */

import type { Competition, Format, Match, UUID } from '../types/index';
import type { SavedMatch } from './persistence';
import { newMatch } from './matchLifecycle';
import { planFor, type MatchPlan, type PlannedPeriod } from './matchPlan';
import { formatForPlannedPeriod, switchShape } from './periodShape';
import { formatForShape, shapeOfFormat, type ShapeCode } from './shapes';
import { cleanReferee } from './pitch';

export interface FixtureEdit {
  opponent: string;
  competition: Competition | null;
  kickoffAt: string | null;
  totalMinutes: number;
  periodCount: number;
  shape: ShapeCode;
  excludeFromStats: boolean;
  pitch: { surface: Match['surface'] | null; condition: Match['condition'] | null; referee: string };
}

/** C4: a fixture may be edited only before kick-off. */
export function canEditFixture(stored: Pick<SavedMatch, 'match' | 'quarters'>): boolean {
  return stored.match.status === 'planned' && stored.quarters.every((q) => q.status === 'pending');
}

/** C3: what an edit will do to a team sheet already made, in the coach's words; empty when nothing. */
export function editWarnings(stored: SavedMatch, draft: Pick<FixtureEdit, 'totalMinutes' | 'periodCount' | 'shape'>): string[] {
  const made = (stored.plan?.periods ?? []).some((p) => Object.values(p.slots).some(Boolean) || p.subs.length > 0);
  if (!made) return [];
  const out: string[] = [];
  const format = stored.format;
  if (format && shapeOfFormat(format) !== draft.shape) out.push('The team sheet will be re-placed: everyone keeps their area');
  if (draft.totalMinutes !== stored.match.totalMinutes || draft.periodCount !== stored.match.quarterCount) {
    out.push('Sub times will be cleared');
  }
  return out;
}

/** C2, C3: the fixture with the edit applied. Unchanged when it has kicked off (C4). */
export function editFixture(stored: SavedMatch, draft: FixtureEdit, matchFormat: Format, now: () => Date): SavedMatch {
  if (!canEditFixture(stored)) return stored;
  const oldFormat = stored.format ?? matchFormat;
  const format = formatForShape(draft.shape, oldFormat);
  const reshaped = format.id !== oldFormat.id;
  const resized = draft.totalMinutes !== stored.match.totalMinutes || draft.periodCount !== stored.match.quarterCount;
  const opponent = draft.opponent.trim() ? draft.opponent.trim() : null;

  // A new length or period count needs new (pending) periods: built the one way a match is made.
  const quarters = resized
    ? newMatch(
        { squadId: stored.match.squadId, format, totalMinutes: draft.totalMinutes, periodCount: draft.periodCount, players: [] },
        now
      ).stored.quarters.map((q) => ({ ...q, matchId: stored.match.id }))
    : stored.quarters;

  const referee = cleanReferee(draft.pitch.referee);
  const match: Match = {
    ...stored.match,
    opponent,
    competition: draft.competition,
    kickoffAt: draft.kickoffAt,
    excludeFromStats: draft.excludeFromStats,
    totalMinutes: draft.totalMinutes,
    quarterCount: draft.periodCount,
    formatId: format.id,
  };
  if (draft.pitch.surface) match.surface = draft.pitch.surface;
  else delete match.surface;
  if (draft.pitch.condition) match.condition = draft.pitch.condition;
  else delete match.condition;
  if (referee) match.referee = referee;
  else delete match.referee;

  let plan: MatchPlan | undefined = stored.plan;
  if (plan) {
    const newShape = shapeOfFormat(format);
    const periods = planFor(plan, draft.periodCount).periods.map((period): PlannedPeriod => {
      let next = period;
      if (reshaped) {
        // Each period by area into its shape under the new match format; an override
        // that is now the match's own shape is no longer an override.
        const keep = period.shape && period.shape !== newShape ? period.shape : undefined;
        const from = formatForPlannedPeriod(oldFormat, period.shape);
        const to = formatForPlannedPeriod(format, keep);
        const { shape: _s, pinned: _p, ...rest } = period;
        void _s;
        void _p;
        next = { ...rest, slots: switchShape(period.slots, from, to), ...(keep ? { shape: keep } : {}) };
      }
      return resized ? { ...next, subs: [] } : next;
    });
    plan = { periods };
  }

  return { ...stored, match, quarters, format, ...(plan ? { plan } : {}) };
}

/** The ids of the children a fixture's team sheet places, for a test or a check. */
export function placedIn(plan: MatchPlan | undefined, period: number): UUID[] {
  return Object.values(plan?.periods[period]?.slots ?? {}).filter((v): v is UUID => v !== null);
}
