/**
 * First open: show a new coach how to start — #218.
 *
 * Rob, 18 Oct: *"there aren't many clues when you first open the app on how
 * to use it."* PO rulings on #218: criteria 1–7, then the prototype and Dee's
 * eight answers (`approve prototype`).
 *
 * - **The Getting started card** (AC1, AC4) on Home: the purpose line and
 *   three steps. Each step's tick is worked out here from what is on the
 *   phone, on every draw, and never stored (AC7, invariant 1).
 * - **Closing it early** (AC2, Q4) is a view choice on this phone, kept under
 *   `GETTING_STARTED_KEY` like the table sorts (#208). It is in no record, and
 *   Forget everything removes it with every other `coaching-app/` key.
 * - **Empty screens** (AC3, Q3): a sentence and a button only where nothing has
 *   happened yet. A phone with a squad and matches looks as it did (AC6).
 * - **The made-up team** (AC5, Q5, Q6): the Test kit's squad and season, loaded
 *   only while the squad is empty, and recognised by its made-up names.
 *
 * Pure: no React, no device, no clock read. First names only (invariant 4).
 */

import type { Match, Player, UUID } from '../types/index';
import { matchProgress } from './fixtures';
import type { SavedMatch } from './persistence';
import { TEST_NAMES, TEST_OPPONENTS, addTestData } from './testKit';
import { SEASON, addTestSeason, type TestSeasonInput } from './testSeason';

/** The line that says what the app is for (AC4). Approved wording. */
export const PURPOSE_LINE = 'Who comes off next, and is everyone getting a fair share?';
export const CARD_TITLE = 'Getting started';
export const CARD_SUBTITLE = 'Three steps and you are ready for Saturday.';

export const TRY_MADE_UP_TEAM = 'Try it with a made-up team';
export const TRY_HINT = 'A pretend squad and season to look around. Settings › Forget everything removes it.';
export const MADE_UP_BANNER = 'This is a made-up team. Forget everything in Settings clears it.';
export const SHOW_AGAIN = 'Show Getting started again';

export const CLOSED_TOAST = 'Getting started closed.';
export const ALL_DONE_TOAST = 'All three steps done. You are ready for Saturday.';
export const PLAY_NOW_TOAST = 'Press Play now when the game kicks off.';
export const FORGOTTEN_TOAST = 'Everything forgotten. This phone is like a fresh install.';
/** How long the Undo after closing the card is offered (Q4). */
export const UNDO_MS = 5_000;
/** How long any other message stays. */
export const TOAST_MS = 3_500;

/** Home with no matches at all (Q3). The buttons it means are just above it. */
export const NO_MATCHES_YET =
  "No matches yet. Add Saturday's match with the button above, or press Play now when a game starts.";
/** Played, before the first match has been played (Q3). */
export const NOTHING_PLAYED_YET =
  "Nothing played yet. When you end a match it moves here, with everyone's minutes.";

// ---------------------------------------------------------------------------
// The card's memory: a view choice on this phone
// ---------------------------------------------------------------------------

/** Under the app's prefix, so Forget everything removes it (#207). */
export const GETTING_STARTED_KEY = 'coaching-app/getting-started/v1';

/** True when the coach closed the card. Anything unreadable reads as open. */
export function parseCardClosed(raw: string | null): boolean {
  if (raw === null) return false;
  try {
    const v: unknown = JSON.parse(raw);
    return typeof v === 'object' && v !== null && (v as { closed?: unknown }).closed === true;
  } catch {
    return false;
  }
}

export function serialiseCardClosed(): string {
  return JSON.stringify({ closed: true });
}

// ---------------------------------------------------------------------------
// The three steps, worked out from what is on the phone
// ---------------------------------------------------------------------------

export type StepKey = 'squad' | 'match' | 'play';

export interface StartStep {
  key: StepKey;
  name: string;
  /** The smaller line under the name. */
  detail: string;
  done: boolean;
}

/** A match as saved, or the one held live: its status and its periods. */
export type MatchLike = Pick<SavedMatch, 'match' | 'quarters'>;

export interface PhoneContents {
  /** Today's squad: active players only. */
  activePlayers: number;
  /** Players on the pitch in the default shape: Pick the lineup's threshold (Q2). */
  onFieldCount: number;
  /** Every saved match, archived and hidden ones included, and the live one. */
  matches: readonly MatchLike[];
  /** Matches in the minutes record, imported ones included. */
  ledgerMatches: number;
}

/** True once any match has been kicked off, here or in an imported record. */
export function anyKickedOff(matches: readonly MatchLike[], ledgerMatches: number): boolean {
  return (
    ledgerMatches > 0 ||
    matches.some((m) => m.match.status !== 'planned' || matchProgress(m.quarters) !== 'not_started')
  );
}

/** AC1, Q2: each step ticks itself off from what is on the phone. */
export function startSteps(phone: PhoneContents): StartStep[] {
  const n = phone.activePlayers;
  const field = phone.onFieldCount;
  const squadDone = n >= field;
  const matchDone = phone.matches.length > 0;
  const playDone = anyKickedOff(phone.matches, phone.ledgerMatches);
  return [
    {
      key: 'squad',
      name: 'Add your squad',
      detail: squadDone ? `${n} players` : `First names only · ${n} of ${field} added`,
      done: squadDone,
    },
    {
      key: 'match',
      name: 'Add your next match',
      detail: matchDone ? 'Done' : 'Who you are playing, and when',
      done: matchDone,
    },
    {
      key: 'play',
      name: 'Press Play now at kick-off',
      detail: playDone ? 'Done' : 'The app keeps time and says who comes off next',
      done: playDone,
    },
  ];
}

export function allStepsDone(steps: readonly StartStep[]): boolean {
  return steps.every((s) => s.done);
}

/** AC2: the card goes by itself once every step is done, or when closed. */
export function showCard(closed: boolean, steps: readonly StartStep[]): boolean {
  return !closed && !allStepsDone(steps);
}

/** Q4: Settings offers it back while it is closed and a step is undone. */
export function offerShowAgain(closed: boolean, steps: readonly StartStep[]): boolean {
  return closed && !allStepsDone(steps);
}

// ---------------------------------------------------------------------------
// Empty screens (AC3, Q3)
// ---------------------------------------------------------------------------

/**
 * True until a first match has been played: nothing on the phone finished,
 * and nothing in the record from elsewhere. Archived and hidden matches count
 * as played, so an established phone never reads as new (AC6).
 */
export function nothingPlayedYet(matches: readonly MatchLike[], recordOnlyCount: number): boolean {
  if (recordOnlyCount > 0) return false;
  return !matches.some(
    (m) =>
      m.match.status === 'completed' || m.match.status === 'abandoned' || matchProgress(m.quarters) === 'finished'
  );
}

/** The button under an empty Played or squad view: what to do next. */
export type NextAction = { kind: 'plan'; matchId: UUID; label: string } | { kind: 'add'; label: string };

/** Plan the next fixture if there is one, else add one. `next` is the first under Coming up. */
export function nextAction(next: Pick<Match, 'id' | 'opponent' | 'status'> | undefined): NextAction {
  if (next && next.status === 'planned') {
    const who = (next.opponent ?? '').trim();
    return { kind: 'plan', matchId: next.id, label: who === '' ? 'Plan your next match' : `Plan the match against ${who}` };
  }
  return { kind: 'add', label: 'Add your next match' };
}

const NUMBER_WORDS = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven'];

/** The empty Squad screen's sentence. Seven for the default 7-a-side. */
export function emptySquadSentence(onFieldCount: number): string {
  const n = NUMBER_WORDS[onFieldCount] ?? String(onFieldCount);
  return `Type each child's first name and press Add. ${n} makes a team; anyone more is a sub.`;
}

/** Each squad view's sentence before the first match (Q3, the prototype's wording). */
export const VIEW_NOTHING_YET = {
  grid: "Nothing played yet. Each match you play becomes a column here, with every child's minutes in it.",
  fairness: 'Nothing played yet. After your first match, this shows how evenly the minutes are shared.',
  saturday: 'Nobody is owed time yet. After your first match, this shows who to give more minutes to.',
  positions:
    'Nobody has played yet. After your first match, this shows the time each child spent in goal, defence, midfield and up front.',
} as const;

// ---------------------------------------------------------------------------
// The made-up team (AC5, Q5, Q6)
// ---------------------------------------------------------------------------

/** Q5: offered only while the squad is empty, retired players included. */
export function offerMadeUpTeam(everyone: readonly Player[]): boolean {
  return everyone.length === 0;
}

/** Every opponent the made-up team plays: the Test kit's fixtures and its season. */
export const MADE_UP_OPPONENTS: ReadonlySet<string> = new Set([...TEST_OPPONENTS, ...SEASON.map((s) => s.opponent)]);

/**
 * Q6: is the team on this phone the made-up one? Worked out on every draw
 * from what is there; no flag is stored (invariant 1, AC7).
 *
 * The rule: there is a squad, EVERY active player has one of the Test kit's
 * made-up first names (`TEST_NAMES`, exact), and at least one match is against
 * one of its made-up opponents (`MADE_UP_OPPONENTS`, exact).
 *
 * Its limits, for the Architect (ruling Q6 asks Ada to check this):
 *
 * - **A false yes** needs a real squad named only from Ava, Ben, Cal, Dee, Eli,
 *   Fay, Gus, Hal, Ivy and Jo, playing a team called Test Rovers, Sample Town,
 *   Mock Albion, Practice Park, Example Wanderers, Dummy Athletic, Trial Town,
 *   Fixture Forest, Demo Dynamos, Placeholder City or Sample United. The cost
 *   is one yellow line pointing at Forget everything; nothing is changed.
 * - **A false no**: once a coach adds a real child, or removes every made-up
 *   fixture, the line goes. "Try it" is offered only on an empty squad, so
 *   mixing takes a deliberate step after loading it, and Forget everything
 *   is still in Settings.
 * - The Test kit and the demo load the same squad, so a beta or demo phone
 *   with that data shows the line too. That is true of them as well.
 * - Renaming either list in `testKit.ts` or `testSeason.ts` moves this rule
 *   with it; a phone loaded under the old names would stop showing the line.
 */
export function isMadeUpTeam(
  players: readonly Pick<Player, 'firstName' | 'active'>[],
  matches: readonly { match: Pick<Match, 'opponent'> }[]
): boolean {
  const squad = players.filter((p) => p.active);
  if (squad.length === 0) return false;
  if (!squad.every((p) => TEST_NAMES.includes(p.firstName))) return false;
  return matches.some((m) => MADE_UP_OPPONENTS.has(m.match.opponent ?? ''));
}

export interface MadeUpTeam {
  players: Player[];
  matches: SavedMatch[];
  /** The ledger with the season recorded, or as it was when it may not be written. */
  ledger: TestSeasonInput['ledger'];
  message: string;
}

/**
 * AC5: the Test kit's squad and fixtures, then its past season, through the
 * Test kit's own calls in the order the demo uses (`demoSeed.ts`). Nothing
 * beta-only is turned on: this only adds data, as a coach typing it would.
 */
export function loadMadeUpTeam(input: TestSeasonInput): MadeUpTeam {
  const kit = addTestData(
    input.players,
    input.matches,
    input.squadId,
    input.format,
    input.totalMinutes,
    input.periodCount,
    input.now
  );
  const season = addTestSeason({ ...input, players: kit.players, matches: kit.matches });
  const added = season.players.length - input.players.length;
  const fixtures = kit.matches.length - input.matches.length;
  const played = season.matches.length - kit.matches.length;
  const message =
    played > 0
      ? `Made-up team loaded: ${added} players, ${fixtures} fixtures, ${played} played matches.`
      : `Made-up team loaded: ${added} players and ${fixtures} fixtures. ${season.summary}`;
  return { players: season.players, matches: season.matches, ledger: season.ledger, message };
}
