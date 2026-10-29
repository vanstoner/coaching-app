/**
 * The demo's first open (#146 AC4, AC6). Synthetic first names only.
 */

import { describe, expect, it } from 'vitest';
import { uuid } from '../types/index';
import { seasonStats } from './analysis';
import { seasonAttendance } from './attendance';
import type { Distribution } from './distribution';
import { emptyLedger, recordMatches, type Ledger } from './ledger';
import { verifyChain } from './ledgerChain';
import { clearLedger, openStoredLedger, saveLedger } from './storage/ledgerStore';
import { fixtureList, inBucket, listedFixtures } from './fixtures';
import { progressById } from './liveMatch';
import { createMemoryStore, clearSession, loadSession, saveSession } from './persistence';
import { DEFAULT_QUARTER_COUNT, DEFAULT_TOTAL_MINUTES, PLACEHOLDER_SQUAD_NAME, makeSevenASideFormat } from './placeholderSquad';
import { BUZZ_WHEN_SUB_DUE_DEFAULT } from './settings';
import { makePlayer } from './squad';
import { TEST_NAMES, TEST_OPPONENTS } from './testKit';
import { SEASON, addTestSeason } from './testSeason';
import { STORE_OPPONENTS, STORE_SUB_DUE_AFTER_LAUNCH_MS, seedDemo, seedFor, shouldAutoSeed, storeContents, type SessionDefaults, type StoreContents } from './demoSeed';
import { MatchEngine } from '../engine/MatchEngine';
import { subBand, subCountdown } from './clockSubs';
import { MADE_UP_OPPONENTS, isMadeUpTeam, showCard, startSteps } from './gettingStarted';
import { planHasContent } from './matchPlan';
import { scoreOf } from './matchEvents';
import { hasMatchUnderway, savedMatchById, toMatchState, type SavedSession } from './persistence';
import { shapeOfFormat } from './shapes';
import { restoreSubPlan } from './subPlan';

const toSavedMatch = (s: SavedSession) => savedMatchById(s, s.currentMatchId)!;

const NOW = new Date('2026-10-06T09:00:00Z'); // a Tuesday
const EMPTY: StoreContents = { players: 0, matches: 0, ledgerPlayers: 0, ledgerMatches: 0, ledgerWritable: true };

function defaults(): SessionDefaults {
  return {
    squadName: PLACEHOLDER_SQUAD_NAME,
    squadId: uuid(),
    format: makeSevenASideFormat(),
    totalMinutes: DEFAULT_TOTAL_MINUTES,
    periodCount: DEFAULT_QUARTER_COUNT,
    buzzWhenSubDue: BUZZ_WHEN_SUB_DUE_DEFAULT,
  };
}

/**
 * Launch, as App.tsx runs it: load the session, open the ledger, back-fill,
 * then seed if the demo's rule says so, then the save after launch. Returns
 * what launch would show and what is now on the phone.
 */
async function launch(store: ReturnType<typeof createMemoryStore>, distribution: Distribution, d = defaults()) {
  let saved = await loadSession(store);
  const opened = await openStoredLedger(store, NOW);
  const base = opened.ledger ?? emptyLedger(saved?.squadId ?? d.squadId, saved?.squadName ?? d.squadName, NOW, opened.follows);
  let ledger: Ledger | null = opened.writable
    ? saved
      ? recordMatches(base, saved.matches, saved.players, saved.squadName, NOW)
      : base
    : null;
  const seeds = shouldAutoSeed(distribution, storeContents(saved, opened));
  if (seeds) {
    const seeded = seedFor(distribution)(saved, ledger, d, NOW);
    ledger = seeded.ledger;
    saved = seeded.session;
  }
  // The save after launch: the session, then the ledger from the same records.
  if (saved) {
    await saveSession(store, { ...saved, state: null, now: NOW });
    if (ledger) ledger = recordMatches(ledger, saved.matches, saved.players, saved.squadName, NOW);
  }
  if (ledger) await saveLedger(store, ledger);
  return { seeds, saved, ledger };
}

describe('only the demo and the store build auto-seed (#146 AC6, #108 E)', () => {
  const distributions: Distribution[] = ['app', 'beta', 'demo', 'store'];
  const nonEmpty: [string, StoreContents][] = [
    ['a player', { ...EMPTY, players: 1 }],
    ['a saved match', { ...EMPTY, matches: 1 }],
    ['a player in the ledger', { ...EMPTY, ledgerPlayers: 1 }],
    ['a match in the ledger', { ...EMPTY, ledgerMatches: 1 }],
    ['a ledger this build may not write', { ...EMPTY, ledgerWritable: false }],
  ];

  it('healthy case: the demo seeds an empty store', () => {
    expect(shouldAutoSeed('demo', EMPTY)).toBe(true);
  });

  it('healthy case: the App Store media build (store) seeds an empty store (#108 E)', () => {
    expect(shouldAutoSeed('store', EMPTY)).toBe(true);
  });

  it('the store build never seeds over existing data', () => {
    for (const [what, store] of nonEmpty) {
      expect(shouldAutoSeed('store', store), what).toBe(false);
    }
  });

  it('a release (app) and a PR beta (beta) never auto-seed, whatever the store holds', () => {
    for (const d of ['app', 'beta'] as const) {
      expect(shouldAutoSeed(d, EMPTY)).toBe(false);
      for (const [, store] of nonEmpty) expect(shouldAutoSeed(d, store)).toBe(false);
    }
  });

  it('the demo never seeds over existing data', () => {
    for (const [what, store] of nonEmpty) {
      expect(shouldAutoSeed('demo', store), what).toBe(false);
    }
  });

  it('a release and a PR beta open an empty phone empty, through the real store', async () => {
    for (const d of distributions.filter((x) => x !== 'demo' && x !== 'store')) {
      const store = createMemoryStore();
      const first = await launch(store, d);
      expect(first.seeds).toBe(false);
      expect(first.saved).toBeNull();
      expect(await loadSession(store)).toBeNull();
    }
  });
});

describe('the demo seeds on first open, through the real save path (#146 AC4)', () => {
  it('healthy case: an empty phone opens with the Test kit squad, its fixtures and the past season', async () => {
    const store = createMemoryStore();
    const d = defaults();
    const first = await launch(store, 'demo', d);
    expect(first.seeds).toBe(true);

    const saved = (await loadSession(store))!;
    expect(saved.players.map((p) => p.firstName).sort()).toEqual([...TEST_NAMES].sort());
    expect(saved.matches).toHaveLength(2 + SEASON.length);
    expect(saved.squadId).toBe(d.squadId);
    expect(saved.squadName).toBe(PLACEHOLDER_SQUAD_NAME);
    expect(saved.currentMatchId).toBeNull();

    const opened = await openStoredLedger(store, NOW);
    expect(opened.writable).toBe(true);
    expect(opened.message).toBe('');
    expect(verifyChain(opened.ledger!.entries)).toEqual({ ok: true });
    expect(opened.ledger!.matches.filter((m) => m.status === 'completed')).toHaveLength(SEASON.length);
    expect(opened.ledger!.players.every((p) => TEST_NAMES.includes(p.firstName))).toBe(true);
  });

  it('records the season as it was played: the save after it finds nothing new', () => {
    const d = defaults();
    const { session, ledger } = seedDemo(null, emptyLedger(d.squadId, d.squadName, NOW), d, NOW);
    const again = recordMatches(ledger!, session.matches, session.players, session.squadName, NOW);
    expect(again).toBe(ledger);
  });

  it('gives the same season as tapping "Add a past season" alone: attendance and averages by name', () => {
    const d = defaults();
    const ledger = emptyLedger(d.squadId, d.squadName, NOW);
    const demo = seedDemo(null, ledger, d, NOW);
    const alone = addTestSeason({ ...d, players: [], matches: [], ledger, now: NOW });

    const byName = (l: Ledger, players: { id: string; firstName: string }[]) => {
      const name = new Map(players.map((p) => [p.id, p.firstName]));
      const att = seasonAttendance(l);
      const stats = seasonStats(l, players as never);
      return Object.fromEntries(
        stats.players.map((p) => [name.get(p.playerId), [att.get(p.playerId)!.missed, Math.round(p.averageMs ?? 0)]])
      );
    };
    expect(byName(demo.ledger!, demo.session.players)).toEqual(byName(alone.ledger!, alone.players));
  });

  it('keeps a team name and defaults saved before any player was added', async () => {
    const store = createMemoryStore();
    const d = defaults();
    await saveSession(store, { ...d, squadName: 'Lions', periodCount: 2, players: [], plan: {}, matches: [], state: null, now: NOW });
    const first = await launch(store, 'demo', d);
    expect(first.seeds).toBe(true);
    const saved = (await loadSession(store))!;
    expect(saved.squadName).toBe('Lions');
    expect(saved.periodCount).toBe(2);
    expect(saved.squadId).toBe(d.squadId);
  });

  it('seeds once: the next open finds data and adds nothing', async () => {
    const store = createMemoryStore();
    await launch(store, 'demo');
    const before = (await loadSession(store))!;
    const ledgerBefore = (await openStoredLedger(store, NOW)).ledger!;
    const second = await launch(store, 'demo');
    expect(second.seeds).toBe(false);
    const after = (await loadSession(store))!;
    expect(after.players).toEqual(before.players);
    expect(after.matches).toEqual(before.matches);
    expect((await openStoredLedger(store, NOW)).ledger!.entries).toHaveLength(ledgerBefore.entries.length);
  });

  it('never seeds over a squad, or over a ledger whose session is gone', async () => {
    const withSquad = createMemoryStore();
    const d = defaults();
    await saveSession(withSquad, { ...d, players: [makePlayer(d.squadId, 'Ben')], plan: {}, matches: [], state: null, now: NOW });
    expect((await launch(withSquad, 'demo', d)).seeds).toBe(false);
    expect((await loadSession(withSquad))!.players).toHaveLength(1);

    // A ledger with a season in it and no session: the ledger is data.
    const ledgerOnly = createMemoryStore();
    await launch(ledgerOnly, 'demo');
    await clearSession(ledgerOnly);
    expect((await launch(ledgerOnly, 'demo')).seeds).toBe(false);
  });

  it('after Forget everything, the next open of a demo seeds again (accepted consequence)', async () => {
    const store = createMemoryStore();
    await launch(store, 'demo');
    // Forget everything: both cleared, then the save of the empty squad.
    await clearSession(store);
    await clearLedger(store);
    const d = defaults();
    await saveSession(store, { ...d, players: [], plan: {}, matches: [], state: null, now: NOW });
    expect((await launch(store, 'demo', d)).seeds).toBe(true);
    expect((await loadSession(store))!.matches).toHaveLength(2 + SEASON.length);
  });
});

describe('the first screen of a fresh demo (#146, for the smoke test)', () => {
  it('Home lists no Now card, Test Rovers first under Coming up, the latest season match first under Played', () => {
    const d = defaults();
    const { session } = seedDemo(null, emptyLedger(d.squadId, d.squadName, NOW), d, NOW);
    // As App.tsx draws Home: no live match is held after launch.
    const rows = fixtureList(listedFixtures(session.matches, false).map((m) => m.match), NOW, null, progressById(session.matches, null));
    expect(inBucket(rows, 'current')).toEqual([]);
    expect(inBucket(rows, 'future').map((r) => r.match.opponent)).toEqual([...TEST_OPPONENTS]);
    expect(inBucket(rows, 'past')[0].match.opponent).toBe(SEASON[SEASON.length - 1].opponent);
    // #218 Q7: the placeholder is "Your team", no longer "Example FC".
    expect(session.squadName).toBe('Your team');
  });

  it('Test Rovers stays first under Coming up after its kick-off time passes, unplayed', () => {
    const d = defaults();
    const { session } = seedDemo(null, emptyLedger(d.squadId, d.squadName, NOW), d, NOW);
    const later = new Date(NOW.getTime() + 3 * 86_400_000);
    const rows = fixtureList(session.matches.map((m) => m.match), later, null, progressById(session.matches, null));
    expect(rows[0].bucket).toBe('future');
    expect(rows[0].match.opponent).toBe('Test Rovers');
  });
});

// ---------------------------------------------------------------------------
// The App Store screenshots' states (#226): the store build only
// ---------------------------------------------------------------------------

describe('the store build opens with every screenshot state (#226)', () => {
  const seedStore = (d = defaults()) =>
    seedFor('store')(null, emptyLedger(d.squadId, d.squadName, NOW), d, NOW);
  const nameOf = (session: { players: { id: string; firstName: string }[] }, id: string | null) =>
    session.players.find((p) => p.id === id)?.firstName;

  it('only the store build gets the store seed; the demo keeps its own', () => {
    expect(seedFor('store')).not.toBe(seedDemo);
    expect(seedFor('demo')).toBe(seedDemo);
    // Neither is ever called for these: shouldAutoSeed says no (above).
    expect(seedFor('app')).toBe(seedDemo);
    expect(seedFor('beta')).toBe(seedDemo);
  });

  it('shot 1: a match in progress against Sample Town, 1–0, and Hal for Eli amber from launch', () => {
    const { session } = seedStore();
    expect(hasMatchUnderway(session)).toBe(true);
    const state = toMatchState(session)!;
    expect(state.match.opponent).toBe(STORE_OPPONENTS.live);
    expect(scoreOf(state.events)).toEqual(expect.objectContaining({ us: 1, them: 0 }));

    const running = state.quarters.find((q) => q.status === 'running')!;
    expect(running.index).toBe(1);
    const at = (ms: number) => new MatchEngine({ nowFn: () => new Date(NOW.getTime() + ms) }).getQuarterElapsedMs(running);
    // 6:01 into Quarter 1 at launch, from the anchor (invariant 2).
    expect(at(0)).toBe(6 * 60_000 + 15_000 - STORE_SUB_DUE_AFTER_LAUNCH_MS);

    const plan = restoreSubPlan(toSavedMatch(session).periodSubs, state);
    const planned = plan.filter((s) => s.atMs > 0).map((s) => [nameOf(session, s.playerId), nameOf(session, s.forPlayerId), s.atMs]);
    expect(planned).toEqual([
      ['Hal', 'Eli', 6 * 60_000 + 15_000],
      ['Jo', 'Fay', 9 * 60_000 + 15_000],
    ]);
    const hal = plan.find((s) => nameOf(session, s.playerId) === 'Hal')!;
    // Amber at launch, and for the next 14 s; red from then.
    expect(subBand(hal, at(0))).toBe('amber');
    expect(subCountdown(hal, at(0))).toBe('in 0:14');
    expect(subBand(hal, at(STORE_SUB_DUE_AFTER_LAUNCH_MS - 1))).toBe('amber');
    expect(subBand(hal, at(STORE_SUB_DUE_AFTER_LAUNCH_MS))).toBe('red');
    // Eli and Fay are on; Hal and Jo are not.
    const on = new Set(state.appearances.filter((a) => a.endElapsedMs === null).map((a) => nameOf(session, a.playerId)));
    expect([...on].sort()).toEqual(['Ava', 'Ben', 'Cal', 'Dee', 'Eli', 'Fay', 'Gus']);
  });

  it('shot 3: next Saturday against Mock Albion, its plan saved with a sub at 6:15 each quarter', () => {
    const { session } = seedStore();
    const fixture = session.matches.find((m) => m.match.status === 'planned' && m.match.opponent === STORE_OPPONENTS.planned)!;
    expect(new Date(fixture.match.kickoffAt!).getDay()).toBe(6);
    expect(planHasContent(fixture.plan)).toBe(true);
    expect(fixture.plan!.periods).toHaveLength(4);
    for (const period of fixture.plan!.periods) {
      expect(Object.values(period.slots).filter(Boolean)).toHaveLength(7);
      expect(period.subs.map((s) => s.atMs)).toEqual([6 * 60_000 + 15_000]);
    }
  });

  it('shot 7: a 5-a-side fixture, 1-2-1 + GK, 40 minutes in quarters', () => {
    const { session } = seedStore();
    const five = session.matches.find((m) => m.match.status === 'planned' && m.match.opponent === STORE_OPPONENTS.fiveASide)!;
    expect(shapeOfFormat(five.format!)).toBe('1-2-1');
    expect(five.match.totalMinutes).toBe(40);
    expect(five.quarters).toHaveLength(4);
  });

  it('shots 2, 4, 5, 6: the made-up season is all there, and Test Rovers is not', () => {
    const { session } = seedStore();
    for (const s of SEASON) expect(session.matches.some((m) => m.match.opponent === s.opponent)).toBe(true);
    expect(session.matches.some((m) => m.match.opponent === TEST_OPPONENTS[0])).toBe(false);
  });

  it('invented first names and made-up opponents only (invariant 4); still read as the made-up team', () => {
    const { session } = seedStore();
    expect(session.players.every((p) => TEST_NAMES.includes(p.firstName))).toBe(true);
    for (const m of session.matches) expect(MADE_UP_OPPONENTS.has(m.match.opponent ?? '')).toBe(true);
    expect(isMadeUpTeam(session.players, session.matches)).toBe(true);
  });

  it('through the real launch and save: the record verifies and holds the match in progress', async () => {
    const store = createMemoryStore();
    const first = await launch(store, 'store');
    expect(first.seeds).toBe(true);
    const opened = await openStoredLedger(store, NOW);
    expect(verifyChain(opened.ledger!.entries)).toEqual({ ok: true });
    expect(opened.ledger!.matches.filter((m) => m.status === 'completed')).toHaveLength(SEASON.length);
    // The match in progress: its opponent and its goal, as a save during play writes them.
    const live = opened.ledger!.matches.find((m) => m.id === first.saved!.currentMatchId)!;
    expect(live.opponent).toBe(STORE_OPPONENTS.live);
    expect(live.events?.filter((e) => e.kind === 'goal')).toHaveLength(1);
    // A second launch finds data and seeds nothing over it.
    expect((await launch(store, 'store')).seeds).toBe(false);
  });

  it('shot 8: after Forget everything, seven names typed in show Getting started with step 1 ticked', () => {
    const steps = startSteps({ activePlayers: 7, onFieldCount: 7, matches: [], ledgerMatches: 0 });
    expect(steps.map((s) => s.done)).toEqual([true, false, false]);
    expect(showCard(false, steps)).toBe(true);
  });
});
