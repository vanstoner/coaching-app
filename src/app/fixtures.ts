/**
 * Fixtures — the front door (#62).
 *
 * Pure TypeScript.
 *
 * ---------------------------------------------------------------------------
 * What the PO asked for
 * ---------------------------------------------------------------------------
 *
 * > *"when I enter the app I should immediately see a list of Future, Current,
 * > Past Fixtures if they exist. A fixture should have an opposition team,
 * > formation (7x7 right now), format (cup, league), date and time. I should
 * > be able to create a fixture in advance and pick my squad and positions in
 * > advance."*
 *
 * **A fixture IS a `Match` with status `planned`.** The domain model said so
 * from the start — `opponent`, `kickoffAt`, `formatId` and a status of
 * `planned | in_progress | completed | abandoned` were all there. Inventing a
 * separate Fixture entity would have created two things meaning the same, and
 * then a rule about which one wins.
 *
 * So this file classifies and orders matches. It creates nothing the engine
 * does not already own.
 */

import type { Competition, Match, MatchStatus, UUID } from '../types/index';

/** Where a match sits relative to now. */
export type FixtureBucket = 'current' | 'future' | 'past';

export interface FixtureRow {
  match: Match;
  bucket: FixtureBucket;
  /** True when this is the match the app would open into. */
  isCurrent: boolean;
}

/** What to call a competition on screen. Labels change; the code does not. */
export function competitionLabel(competition: Competition | null): string {
  switch (competition) {
    case 'league':
      return 'League';
    case 'cup':
      return 'Cup';
    case 'friendly':
      return 'Friendly';
    case 'tournament':
      return 'Tournament';
    default:
      return '';
  }
}

export const COMPETITIONS: readonly Competition[] = [
  'league',
  'cup',
  'friendly',
  'tournament',
] as const;

/** Who the match is against, in a form that is always safe to render. */
export function opponentLabel(match: Match): string {
  const name = (match.opponent ?? '').trim();
  return name === '' ? 'Opponent TBC' : name;
}

/**
 * Which bucket a match belongs in.
 *
 * Status decides before the clock does, deliberately. A match in progress is
 * CURRENT even if its kick-off time was yesterday and the coach forgot to end
 * it — which is exactly the situation this app exists to survive. A completed
 * match is PAST even if its kick-off is somehow in the future, because it has
 * been played and no clock reading changes that.
 *
 * Only a planned match is placed by time, and only then does "no kick-off yet"
 * matter: a fixture with no date is still something to come, so it is future.
 */
export function bucketOf(match: Match, now: Date): FixtureBucket {
  const status: MatchStatus = match.status;
  if (status === 'in_progress') return 'current';
  if (status === 'completed' || status === 'abandoned') return 'past';

  if (!match.kickoffAt) return 'future';
  const kickoff = Date.parse(match.kickoffAt);
  if (!Number.isFinite(kickoff)) return 'future';
  return kickoff < now.getTime() ? 'past' : 'future';
}

/**
 * The list a coach sees on opening the app.
 *
 * Ordered the way a Saturday morning works: whatever is happening NOW first,
 * then the next thing to prepare for, then history newest-first. A coach
 * opening this at 9am wants the top of the list to be the thing they are about
 * to do, not the oldest fixture of the season.
 */
export function fixtureList(
  matches: Match[],
  now: Date,
  currentMatchId: UUID | null = null
): FixtureRow[] {
  const rows = matches.map((match) => ({
    match,
    bucket: bucketOf(match, now),
    isCurrent: match.id === currentMatchId,
  }));

  const rank: Record<FixtureBucket, number> = { current: 0, future: 1, past: 2 };
  const time = (m: Match) => {
    const t = m.kickoffAt ? Date.parse(m.kickoffAt) : NaN;
    return Number.isFinite(t) ? t : null;
  };

  return rows.sort((a, b) => {
    if (rank[a.bucket] !== rank[b.bucket]) return rank[a.bucket] - rank[b.bucket];
    const ta = time(a.match);
    const tb = time(b.match);
    // A fixture with no date sits after dated ones in its bucket: it is real
    // but unschedulable, and it must not push a known kick-off down the list.
    if (ta === null && tb === null) return 0;
    if (ta === null) return 1;
    if (tb === null) return -1;
    // Soonest first when looking forward, most recent first when looking back.
    return a.bucket === 'past' ? tb - ta : ta - tb;
  });
}

/** The rows of one bucket, in list order. */
export function inBucket(rows: FixtureRow[], bucket: FixtureBucket): FixtureRow[] {
  return rows.filter((r) => r.bucket === bucket);
}

/**
 * What to show when there is nothing at all.
 *
 * An empty state is the first thing a new coach sees and the last thing
 * anybody designs, so it is decided here rather than left to a screen.
 */
export const NO_FIXTURES_YET = 'No fixtures yet. Add your first match.';

/** A short, sortable date for a fixture row. Empty when there is no kick-off. */
export function kickoffLabel(match: Match, now: Date): string {
  if (!match.kickoffAt) return 'Date TBC';
  const at = new Date(match.kickoffAt);
  if (Number.isNaN(at.getTime())) return 'Date TBC';

  const time = at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const sameYear = at.getFullYear() === now.getFullYear();
  const date = at.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
  return `${date} · ${time}`;
}
