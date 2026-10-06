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
import { clearLedger, openStoredLedger, saveLedger } from './ledgerStore';
import { fixtureList, inBucket, listedFixtures } from './fixtures';
import { progressById } from './liveMatch';
import { createMemoryStore, clearSession, loadSession, saveSession } from './persistence';
import { DEFAULT_QUARTER_COUNT, DEFAULT_TOTAL_MINUTES, PLACEHOLDER_SQUAD_NAME, makeSevenASideFormat } from './placeholderSquad';
import { BUZZ_WHEN_SUB_DUE_DEFAULT } from './settings';
import { makePlayer } from './squad';
import { TEST_NAMES, TEST_OPPONENTS } from './testKit';
import { SEASON, addTestSeason } from './testSeason';
import { seedDemo, shouldAutoSeed, storeContents, type SessionDefaults, type StoreContents } from './demoSeed';

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
    const seeded = seedDemo(saved, ledger, d, NOW);
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

describe('only the demo auto-seeds (#146 AC6)', () => {
  const distributions: Distribution[] = ['app', 'beta', 'demo'];
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
    for (const d of distributions.filter((x) => x !== 'demo')) {
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
    expect(session.squadName).toBe('Example FC');
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
