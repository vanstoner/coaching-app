/**
 * The demo's first open — #146 AC4, AC6.
 *
 * The demo is Heart FC Beta Coach built from main by a manual run, to share with
 * made-up data in it (PO ruling 31). On first open with nothing on the phone
 * it adds the Test kit's squad and past season, through the buttons' own
 * calls in the order they sit in Settings (`addTestData`, then
 * `addTestSeason`): the season is played through the engine and recorded into
 * the ledger as it is played, exactly as tapping both would. A release and a
 * pull request's beta never do this; a beta still needs the taps.
 *
 * The App Store media build (`store`) gets the same, then `addStoreShots`:
 * the states its screenshots need (#226), reachable by taps from a fresh
 * launch. See `seedFor`.
 *
 * Pure. Launch (App.tsx) passes in what it read, then carries on with the
 * session returned here as if it had loaded it: the save after launch writes
 * it, through the same `saveSession` every change goes through. Synthetic
 * first names only (invariant 4); nothing derived is stored (invariant 1).
 */

import { MatchEngine } from '../engine/MatchEngine';
import type { Format, UUID } from '../types/index';
import { fillSquadAtKickoff } from './absence';
import type { Distribution } from './distribution';
import { kickoffIso, nextSaturday } from './kickoff';
import { recordMatches } from './ledger';
import { newMatch, openMatch } from './matchLifecycle';
import { defaultSwapTimeMs, emptyPlan, lineupFromPlan, periodLengthMs, setSlot, type MatchPlan } from './matchPlan';
import { toSavedSession, type SavedMatch, type SavedSession, type SessionInput } from './persistence';
import { makeFormat } from './shapes';
import { periodSubsToSave } from './subPlan';
import { toTeamSheet } from './teamSheet';
import { TEST_OPPONENTS, addTestData } from './testKit';
import { addTestSeason, type TestSeasonInput } from './testSeason';

type LedgerOrNull = TestSeasonInput['ledger'];

/** What launch found on the phone. */
export interface StoreContents {
  /** Everyone ever in the squad, retired players included. */
  players: number;
  /** Every saved match: fixtures, played and in progress. */
  matches: number;
  /** Players and matches in the ledger launch continues from. */
  ledgerPlayers: number;
  ledgerMatches: number;
  /** False when this build may not write the ledger (#99 AC2). */
  ledgerWritable: boolean;
}

/** Counts only: what launch read, as `loadSession` and `openStoredLedger` return it. */
export function storeContents(
  saved: { players: readonly unknown[]; matches: readonly unknown[] } | null,
  opened: { writable: boolean; ledger: { players: readonly unknown[]; matches: readonly unknown[] } | null }
): StoreContents {
  return {
    players: saved?.players.length ?? 0,
    matches: saved?.matches.length ?? 0,
    ledgerPlayers: opened.ledger?.players.length ?? 0,
    ledgerMatches: opened.ledger?.matches.length ?? 0,
    ledgerWritable: opened.writable,
  };
}

/**
 * Only the demo and the App Store media build (`store`, #108 E), and only an
 * empty store: no squad, no saved match, nothing in the ledger, and a ledger
 * this build may write. Never over existing data.
 */
export function shouldAutoSeed(distribution: Distribution, store: StoreContents): boolean {
  return (
    (distribution === 'demo' || distribution === 'store') &&
    store.players === 0 &&
    store.matches === 0 &&
    store.ledgerPlayers === 0 &&
    store.ledgerMatches === 0 &&
    store.ledgerWritable
  );
}

/** The squad defaults launch holds before anything is loaded. */
export type SessionDefaults = Pick<
  SessionInput,
  'squadName' | 'squadId' | 'format' | 'totalMinutes' | 'periodCount' | 'buzzWhenSubDue'
>;

/**
 * The Test kit's squad and fixtures, then its past season, on top of what
 * launch read (empty, by `shouldAutoSeed`). The squad's name, defaults and
 * id are kept: a saved session's, else the defaults.
 */
export function seedDemo(
  saved: SavedSession | null,
  ledger: LedgerOrNull,
  defaults: SessionDefaults,
  now: Date
): { session: SavedSession; ledger: LedgerOrNull } {
  const squadName = saved?.squadName || defaults.squadName;
  const squadId = saved?.squadId ?? defaults.squadId;
  const format = saved?.format ?? defaults.format;
  const totalMinutes = saved?.totalMinutes ?? defaults.totalMinutes;
  const periodCount = saved?.periodCount ?? defaults.periodCount;

  const kit = addTestData(saved?.players ?? [], saved?.matches ?? [], squadId, format, totalMinutes, periodCount, now);
  const season = addTestSeason({
    players: kit.players,
    matches: kit.matches,
    squadId,
    squadName,
    format,
    totalMinutes,
    periodCount,
    ledger,
    now,
  });

  return {
    session: toSavedSession({
      squadName,
      squadId,
      players: season.players,
      format,
      totalMinutes,
      periodCount,
      buzzWhenSubDue: saved?.buzzWhenSubDue ?? defaults.buzzWhenSubDue,
      plan: saved?.plan ?? {},
      matches: season.matches,
      state: null,
      now,
    }),
    ledger: season.ledger,
  };
}

// ---------------------------------------------------------------------------
// The App Store screenshots (#226): the store build only
// ---------------------------------------------------------------------------

/**
 * The seed this build opens an empty phone with: the store build's, with its
 * screenshot states, or the demo's. Only ever called when `shouldAutoSeed`
 * says so, which is never for a release (`app`) or a pull request's beta.
 */
export function seedFor(distribution: Distribution): typeof seedDemo {
  return distribution === 'store' ? seedStore : seedDemo;
}

/**
 * Shot 1's timing (#226, Dee): how long after the seed runs the live match's
 * first planned sub falls due. The prompt is amber for the last 15 s before
 * a sub (`SUB_AMBER_MS`), so at launch it is already amber, "in 0:14", and
 * stays amber for 14 s. Elapsed time comes from the quarter's wall-clock
 * anchor (invariant 2), so it is right on the first paint however long the
 * launch took; a fresh launch seeds a fresh anchor.
 */
export const STORE_SUB_DUE_AFTER_LAUNCH_MS = 14_000;

/** The made-up opponents the store's shots name. All already in `MADE_UP_OPPONENTS`. */
export const STORE_OPPONENTS = {
  /** Shot 1: the match being played. */
  live: 'Sample Town',
  /** Shot 3: next Saturday's fixture, its plan saved. A return match from the season. */
  planned: 'Mock Albion',
  /** Shot 7: a 5-a-side fixture, 40 minutes in quarters. A return match from the season. */
  fiveASide: 'Practice Park',
} as const;

/** Shot 1's line-up: Ava in goal, then the outfield in the shape's order. Hal, Ivy and Jo start on the bench. */
const LIVE_STARTERS = ['Ava', 'Ben', 'Cal', 'Dee', 'Eli', 'Fay', 'Gus'];
/** Shot 1's plan: Hal on for Eli at the half-period (6:15), Jo on for Fay three minutes later (9:15). */
const LIVE_SUBS: { on: string; off: string; afterFirstMs: number }[] = [
  { on: 'Hal', off: 'Eli', afterFirstMs: 0 },
  { on: 'Jo', off: 'Fay', afterFirstMs: 3 * 60_000 },
];
/** Shot 1's score, 1–0: Gus, this long before launch. */
const LIVE_GOAL = { by: 'Gus', beforeLaunchMs: 2 * 60_000 + 20_000 };

function seedStore(
  saved: SavedSession | null,
  ledger: LedgerOrNull,
  defaults: SessionDefaults,
  now: Date
): { session: SavedSession; ledger: LedgerOrNull } {
  return addStoreShots(seedDemo(saved, ledger, defaults, now), now);
}

/**
 * The demo's seed, plus what the App Store shots need (#226, Dee's shot list):
 *
 * - **Shot 1**, the amber sub prompt: the Test kit's match due today becomes
 *   one in progress against Sample Town, 1–0, Quarter 1 running, Hal planned
 *   on for Eli and Jo for Fay. Hal's sub falls due
 *   `STORE_SUB_DUE_AFTER_LAUNCH_MS` after this runs. Launch opens on Resume.
 * - **Shot 3**, the shared plan: the kit's next-Saturday fixture, against
 *   Mock Albion, with the kit's plan saved (everyone placed every quarter,
 *   a sub at 6:15 in each).
 * - **Shot 7**, 5-a-side: a fixture against Practice Park the Saturday
 *   after, 1-2-1 + GK, 40 minutes in quarters, not yet planned.
 *
 * Shots 2, 4, 5 and 6 are the made-up season, as before. Shot 8 (Getting
 * started) is reached by taps after the others; see the #226 commit.
 * Made-up first names and opponents only (invariant 4). The live match's
 * minutes are the engine's own, from its anchors; nothing is stored that
 * is derived (invariant 1).
 */
export function addStoreShots(
  seeded: { session: SavedSession; ledger: LedgerOrNull },
  now: Date
): { session: SavedSession; ledger: LedgerOrNull } {
  const { session } = seeded;
  const squad = session.players.filter((p) => p.active);
  const idOf = (name: string) => squad.find((p) => p.firstName === name)?.id;
  const kitFixture = (opponent: string) =>
    session.matches.find((m) => m.match.status === 'planned' && m.match.opponent === opponent);
  const today = kitFixture(TEST_OPPONENTS[0]);
  const saturday = kitFixture(TEST_OPPONENTS[1]);
  const named = [...LIVE_STARTERS, ...LIVE_SUBS.map((s) => s.on)].map(idOf);
  if (!today || !saturday || named.some((id) => id === undefined)) return seeded;

  const format = session.format;
  const periodMs = periodLengthMs(session.totalMinutes, session.periodCount);
  const firstSubMs = defaultSwapTimeMs(periodMs);
  const quarterStart = now.getTime() - (firstSubMs - STORE_SUB_DUE_AFTER_LAUNCH_MS);

  // Shot 3: next Saturday's fixture takes the plan the kit made for today's.
  const planned: SavedMatch = {
    ...saturday,
    match: { ...saturday.match, opponent: STORE_OPPONENTS.planned },
    plan: today.plan,
  };

  // Shot 1: today's fixture, planned for the shot, then kicked off through
  // the engine with the quarter's anchor in the past.
  const livePlan = shotOnePlan(today.plan ?? emptyPlan(session.periodCount), format, idOf, firstSubMs);
  const fixture: SavedMatch = {
    ...today,
    match: { ...today.match, opponent: STORE_OPPONENTS.live, kickoffAt: new Date(quarterStart).toISOString() },
    plan: livePlan,
  };
  let matches = session.matches.map((m) =>
    m.match.id === today.match.id ? fixture : m.match.id === saturday.match.id ? planned : m
  );

  let t = quarterStart;
  const engine = new MatchEngine({ nowFn: () => new Date(t) });
  const opened = openMatch(matches, null, fixture.match.id, session.players, format);
  if (opened.kind !== 'open') return seeded;
  const state = opened.held.state;
  fillSquadAtKickoff(engine, state, session.players);
  const quarter = [...state.quarters].sort((a, b) => a.index - b.index)[0];
  const present = session.players.filter((p) => state.playerAvailability.get(p.id) === 'available');
  const lineup = lineupFromPlan(livePlan.periods[0], format, present);
  engine.startQuarter(state, quarter, toTeamSheet(lineup.sheet), format);
  t = now.getTime() - LIVE_GOAL.beforeLaunchMs;
  engine.recordEvent(state, quarter, 'goal', idOf(LIVE_GOAL.by) as UUID);
  t = now.getTime();

  // Shot 7: a 5-a-side fixture, the Saturday after next.
  const fiveFormat = makeFormat('1-2-1');
  const fiveDay = nextSaturday(new Date(Date.parse(saturday.match.kickoffAt ?? now.toISOString()) + 86_400_000));
  const five = newMatch(
    {
      squadId: session.squadId,
      format: fiveFormat,
      totalMinutes: 40,
      periodCount: 4,
      players: session.players,
      opponent: STORE_OPPONENTS.fiveASide,
      kickoffAt: kickoffIso(fiveDay, '10:00'),
    },
    () => now
  ).stored;
  matches = [...matches, five];

  return {
    session: toSavedSession({
      squadName: session.squadName,
      squadId: session.squadId,
      players: session.players,
      format,
      totalMinutes: session.totalMinutes,
      periodCount: session.periodCount,
      buzzWhenSubDue: session.buzzWhenSubDue,
      plan: session.plan,
      matches,
      state,
      matchFormat: format,
      periodSubs: periodSubsToSave(state.quarters, lineup.subs),
      now,
    }),
    // Kick-off and the goal into the record, as a save during play writes them.
    ledger: seeded.ledger ? recordMatches(seeded.ledger, [state], session.players, session.squadName, now) : null,
  };
}

/** Quarter 1 for shot 1: `LIVE_STARTERS` placed, `LIVE_SUBS` planned. The other quarters as the kit planned them. */
function shotOnePlan(
  kitPlan: MatchPlan,
  format: Format,
  idOf: (name: string) => UUID | undefined,
  firstSubMs: number
): MatchPlan {
  const positions = [...format.positions].sort((a, b) => a.sortOrder - b.sortOrder);
  let plan: MatchPlan = { periods: [{ slots: {}, subs: [] }, ...kitPlan.periods.slice(1)] };
  positions.forEach((pos, i) => {
    plan = setSlot(plan, 0, pos.id, idOf(LIVE_STARTERS[i]) ?? null);
  });
  const subs = LIVE_SUBS.map((s) => ({
    onId: idOf(s.on) ?? null,
    offId: idOf(s.off) ?? null,
    atMs: firstSubMs + s.afterFirstMs,
  }));
  return { periods: plan.periods.map((p, i) => (i === 0 ? { ...p, subs } : p)) };
}
