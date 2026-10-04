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
import { periodNounPlural } from './matchClock';

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
/**
 * How far a match has got, read from its periods. The app never rewrites
 * `Match.status` as a match is played, so this, not the status, is what says
 * whether it has been played (PO, match day 4).
 */
export type MatchProgress = 'not_started' | 'underway' | 'finished';

export function matchProgress(quarters: QuarterLike[]): MatchProgress {
  if (quarters.length === 0 || quarters.every((q) => q.status === 'pending')) return 'not_started';
  return quarters.every((q) => q.status === 'ended') ? 'finished' : 'underway';
}

export function bucketOf(match: Match, now: Date, progress?: MatchProgress): FixtureBucket {
  const status: MatchStatus = match.status;
  if (status === 'completed' || status === 'abandoned') return 'past';
  // Progress decides before the status and the clock (PO, match day 4). The
  // engine sets `in_progress` at kick-off and nothing ever sets `completed`,
  // so by status alone a finished match was "Now" for ever and never Played.
  // A finished match is Played even with no date ("Play now" has none). One
  // nobody has kicked off has not been played, whatever the date says: "it
  // says it's played but doesn't seem to have a result".
  if (progress === 'finished') return 'past';
  if (progress === 'underway') return 'current';
  if (progress === 'not_started') return 'future';
  if (status === 'in_progress') return 'current';

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
  currentMatchId: UUID | null = null,
  /** Each match's progress, from its periods; see `matchProgress`. */
  progress: ReadonlyMap<UUID, MatchProgress> = new Map()
): FixtureRow[] {
  const rows = matches.map((match) => ({
    match,
    bucket: bucketOf(match, now, progress.get(match.id)),
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

/** A period as far as when it started: its recorded wall-clock anchor. */
export interface StartedPeriod {
  index: number;
  startedAt: string | null;
}

/**
 * When play actually began: the recorded start of the earliest period that
 * has started. Read from the stored anchor, never a timer (invariant 2).
 */
export function firstStartedAt(periods: readonly StartedPeriod[]): string | null {
  let first: StartedPeriod | null = null;
  for (const p of periods) {
    if (!p.startedAt || Number.isNaN(new Date(p.startedAt).getTime())) continue;
    if (!first || p.index < first.index) first = p;
  }
  return first?.startedAt ?? null;
}

/**
 * A short date and time for a fixture. The planned kick-off when there is
 * one; otherwise, given the match's periods, when its first period started
 * (#126: a Play now match has no planned kick-off but was still played on a
 * date). "Date TBC" only when neither is known.
 */
export function kickoffLabel(
  match: Match,
  now: Date,
  periods: readonly StartedPeriod[] = []
): string {
  const planned = match.kickoffAt ? new Date(match.kickoffAt) : null;
  const started = firstStartedAt(periods);
  const at =
    planned && !Number.isNaN(planned.getTime())
      ? planned
      : started
        ? new Date(started)
        : null;
  if (!at) return 'Date TBC';

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

// ---------------------------------------------------------------------------
// What opening or removing a fixture should do
// ---------------------------------------------------------------------------

/** Where opening a fixture takes the coach. */
export type OpenDestination = 'playing' | 'summary' | 'squad' | 'lineup';

export interface QuarterLike {
  status: 'pending' | 'running' | 'ended';
}

/**
 * Decide where opening a fixture lands, from what the match actually is.
 *
 * Extracted from the screen so it can be tested: two defects lived here at
 * once and neither was catchable by any existing gate.
 *
 * - A FINISHED match used to land on the live clock screen — a running-match
 *   UI for a game that ended weeks ago.
 * - A PLANNED match landed straight on the lineup even with an empty squad,
 *   so opening a fixture on a fresh install showed a team sheet with nobody
 *   in it.
 */
export function openDestination(
  quarters: QuarterLike[],
  status: MatchStatus,
  squadReady: boolean
): OpenDestination {
  if (quarters.some((q) => q.status === 'running')) return 'playing';
  const finished = quarters.length > 0 && quarters.every((q) => q.status === 'ended');
  if (finished || status === 'completed' || status === 'abandoned') return 'summary';
  return squadReady ? 'lineup' : 'squad';
}

/**
 * Whether a fixture can be removed.
 *
 * Only one that has never been played. Deleting a played match would destroy
 * the record its minutes were folded from, and invariant 5 says corrections
 * are explicit, noted and never destructive — a silent delete is none of
 * those. A fixture nobody has kicked off carries no history to lose.
 */
export function canDeleteFixture(quarters: QuarterLike[], status: MatchStatus): boolean {
  if (status === 'completed' || status === 'in_progress' || status === 'abandoned') return false;
  return quarters.every((q) => q.status === 'pending');
}

/**
 * Whether a fixture can be archived — #76.
 *
 * > *"There's no way to delete (or archive) old or useless fixtures"*
 *
 * Only a finished one. A played match cannot be deleted — its minutes come
 * from it (invariant 5) — so archiving is how it leaves the list. One still
 * being played is never archived: it would vanish from the front door with
 * the clock running. One never played is deleted instead.
 */
export function canArchiveFixture(quarters: QuarterLike[], status: MatchStatus): boolean {
  if (status === 'completed' || status === 'abandoned') return true;
  return quarters.length > 0 && quarters.every((q) => q.status === 'ended');
}

/**
 * The fixtures to list. Archived ones are left out unless asked for.
 *
 * Archiving changes ONLY this. It writes no event and touches no record, so
 * an archived match's minutes are exactly what they were (#76, AC4).
 */
export function listedFixtures<T extends { archived?: boolean }>(
  stored: T[],
  showArchived: boolean
): T[] {
  return showArchived ? stored : stored.filter((m) => !m.archived);
}

/**
 * True when a match has been kicked off and not yet finished.
 *
 * What decides whether **Play now** is offered. A coach who has left a running
 * match to look at Home must not be handed a button that starts a second one
 * and orphans the first — the in-progress card at the top of the list is the
 * way back in.
 */
export function matchIsUnderway(quarters: QuarterLike[]): boolean {
  if (quarters.length === 0) return false;
  const started = quarters.some((q) => q.status !== 'pending');
  const finished = quarters.every((q) => q.status === 'ended');
  return started && !finished;
}

/**
 * This match's own length and period count, for the fixture card.
 *
 * On the card because they belong to the FIXTURE, not to settings (PO ruling,
 * 2026-09-20): *"the match length and format are probably match specific"*. A
 * coach who saved a cup game as halves needs to see that on the card, or the
 * only way to know is to kick off and count.
 */
export function lengthLabel(match: Match): string {
  return `${match.totalMinutes} min · ${periodNounPlural(match.quarterCount)}`;
}
