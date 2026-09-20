/**
 * Tests for persistence — REQ-11 (#53).
 *
 * The two that matter most:
 *
 * 1. **A dead process must not lose time.** The phone dies mid-quarter and is
 *    relaunched ten minutes later. The clock must read the true elapsed time,
 *    because what was persisted is a wall-clock anchor, not a counter.
 *
 * 2. **A corrupt save must not stop the app opening.** A coach standing on a
 *    touchline at 9am on Saturday cannot debug JSON. Losing the squad is
 *    survivable; an app that will not start is not.
 */

import { makeSevenASideFormat } from './placeholderSquad';
import { describe, it, expect } from 'vitest';
import { MatchEngine } from '../engine/MatchEngine';
import { uuid } from '../types/index';
import type { Format, Player, Position, UUID } from '../types/index';
import { makePlayer } from './squad';
import { foldPlayerMinutes } from './playerMinutes';
import { teamSheetFor } from './lineup';
import {
  SCHEMA_VERSION,
  STORAGE_KEY,
  createMemoryStore,
  toSavedSession,
  toMatchState,
  parseSession,
  saveSession,
  loadSession,
  clearSession,
  hasMatchInProgress,
  hasMatchUnderway,
  type KeyValueStore,
  type SavedMatch,
} from './persistence';

function makeFormat(onFieldCount = 7): Format {
  const formatId = uuid();
  const positions: Position[] = Array.from({ length: onFieldCount }, (_, i) => ({
    id: uuid(),
    formatId,
    label: i === 0 ? 'GK' : `P${i}`,
    kind: i === 0 ? ('goalkeeper' as const) : ('outfield' as const),
    sortOrder: i,
  }));
  return { id: formatId, name: `${onFieldCount}-a-side`, onFieldCount, positions };
}

function makeClock(startMs: number) {
  let nowMs = startMs;
  return {
    nowFn: () => new Date(nowMs),
    advance: (ms: number) => {
      nowMs += ms;
    },
  };
}

const T0 = 1_700_000_000_000;

function setUp(size = 10, totalMinutes = 50, quarterCount = 4, startMs = T0) {
  const clock = makeClock(startMs);
  const engine = new MatchEngine({ nowFn: clock.nowFn });
  const format = makeFormat();
  const squadId = uuid();
  const players: Player[] = Array.from({ length: size }, (_, i) =>
    makePlayer(squadId, `P${i}`)
  );
  const state = engine.createMatch(squadId, format.id, { totalMinutes, quarterCount });
  return { clock, engine, format, state, players, squadId };
}

const sessionOf = (x: ReturnType<typeof setUp>, overrides = {}) => ({
  squadName: 'Test FC',
  squadId: x.squadId,
  players: x.players,
  format: x.format,
  totalMinutes: 50,
  periodCount: 4,
  plan: {},
  state: x.state,
  ...overrides,
});

// --- the one that matters most ----------------------------------------------

describe('a dead process does not lose time', () => {
  it('recovers true elapsed after a relaunch, including time the app was gone', async () => {
    const before = setUp();
    const store = createMemoryStore();

    // Kick off, play two minutes, save — as the app does on every change.
    before.engine.startQuarter(
      before.state,
      before.state.quarters[0],
      teamSheetFor(before.players.slice(0, 7).map((p) => p.id), before.players[0].id, before.format),
      before.format
    );
    before.clock.advance(2 * 60_000);
    await saveSession(store, sessionOf(before));

    // The phone dies. Ten minutes pass with no app running at all.
    const DEAD_MS = 10 * 60_000;

    // Relaunch: a brand new engine, whose clock is now T0 + 12 minutes.
    const afterClock = makeClock(T0 + 2 * 60_000 + DEAD_MS);
    const afterEngine = new MatchEngine({ nowFn: afterClock.nowFn });
    const saved = await loadSession(store);
    const restored = toMatchState(saved!)!;

    // Twelve minutes of match time have passed, not two.
    expect(afterEngine.getQuarterElapsedMs(restored.quarters[0])).toBe(12 * 60_000);
    expect(afterEngine.getMatchElapsedMs(restored)).toBe(12 * 60_000);
  });

  it('carries every player’s minutes across the relaunch', async () => {
    const before = setUp();
    const store = createMemoryStore();
    before.engine.startQuarter(
      before.state,
      before.state.quarters[0],
      teamSheetFor(before.players.slice(0, 7).map((p) => p.id), before.players[0].id, before.format),
      before.format
    );
    before.clock.advance(3 * 60_000);
    await saveSession(store, sessionOf(before));

    const afterClock = makeClock(T0 + 3 * 60_000 + 5 * 60_000);
    const afterEngine = new MatchEngine({ nowFn: afterClock.nowFn });
    const restored = toMatchState((await loadSession(store))!)!;
    const minutes = foldPlayerMinutes(afterEngine, restored, before.players);

    // Eight minutes for those on the pitch, nothing invented for the bench.
    expect(minutes[1].outfieldMs).toBe(8 * 60_000);
    expect(minutes[9].outfieldMs).toBe(0);
    expect(minutes[0].goalkeeperMs).toBe(8 * 60_000);
  });

  it('a quarter ended before the crash stays frozen', async () => {
    const before = setUp();
    const store = createMemoryStore();
    before.engine.startQuarter(
      before.state,
      before.state.quarters[0],
      teamSheetFor(before.players.slice(0, 7).map((p) => p.id), before.players[0].id, before.format),
      before.format
    );
    before.clock.advance(4 * 60_000);
    before.engine.endQuarter(before.state, before.state.quarters[0]);
    await saveSession(store, sessionOf(before));

    const afterEngine = new MatchEngine({ nowFn: makeClock(T0 + 60 * 60_000).nowFn });
    const restored = toMatchState((await loadSession(store))!)!;
    // An hour later, the ended quarter still reads four minutes.
    expect(afterEngine.getQuarterElapsedMs(restored.quarters[0])).toBe(4 * 60_000);
  });
});

// --- invariant 1 ------------------------------------------------------------

describe('invariant 1 — nothing derived is written as authoritative', () => {
  it('zeroes the derived elapsedMs mirror on save', () => {
    const x = setUp();
    x.engine.startQuarter(
      x.state,
      x.state.quarters[0],
      teamSheetFor(x.players.slice(0, 7).map((p) => p.id), x.players[0].id, x.format),
      x.format
    );
    x.clock.advance(5 * 60_000);
    // Simulate something having written the derived mirror.
    x.state.quarters[0].elapsedMs = 999_999;

    const saved = toSavedSession(sessionOf(x));
    for (const q of saved.matches[0].quarters) expect(q.elapsedMs).toBe(0);
  });

  it('keeps the anchors, which are what the elapsed time is rebuilt from', () => {
    const x = setUp();
    x.engine.startQuarter(
      x.state,
      x.state.quarters[0],
      teamSheetFor(x.players.slice(0, 7).map((p) => p.id), x.players[0].id, x.format),
      x.format
    );
    const saved = toSavedSession(sessionOf(x));
    const q = saved.matches[0].quarters[0];
    expect(q.runningSinceWallClock).not.toBeNull();
    expect(typeof q.accumulatedMs).toBe('number');
  });
});

// --- corrupt and hostile input ----------------------------------------------

describe('a corrupt save starts a clean session rather than crashing', () => {
  it('returns null for every kind of rubbish', () => {
    for (const raw of [
      null,
      '',
      'not json',
      '{',
      '[]',
      'null',
      '"a string"',
      '{"schemaVersion":1}',
      '{"schemaVersion":1,"players":[]}',
      '{"schemaVersion":999,"players":[],"squadId":"x","totalMinutes":50,"periodCount":4}',
    ]) {
      expect(parseSession(raw), `input: ${raw}`).toBeNull();
    }
  });

  it('rejects a session whose match is half written', () => {
    const x = setUp();
    const saved = toSavedSession(sessionOf(x));
    const broken = JSON.parse(JSON.stringify(saved));
    delete broken.matches[0].quarters;
    expect(parseSession(JSON.stringify(broken))).toBeNull();
  });

  it('rejects impossible match configuration rather than trusting it', () => {
    const x = setUp();
    const saved = JSON.parse(JSON.stringify(toSavedSession(sessionOf(x))));
    saved.totalMinutes = 0;
    expect(parseSession(JSON.stringify(saved))).toBeNull();

    const saved2 = JSON.parse(JSON.stringify(toSavedSession(sessionOf(x))));
    saved2.periodCount = -1;
    expect(parseSession(JSON.stringify(saved2))).toBeNull();
  });

  it('survives a storage engine that throws on every call', async () => {
    const broken: KeyValueStore = {
      async getItem() {
        throw new Error('disk full');
      },
      async setItem() {
        throw new Error('disk full');
      },
      async removeItem() {
        throw new Error('disk full');
      },
    };
    const x = setUp();
    // None of these may throw: losing the save must never lose the match.
    expect(await saveSession(broken, sessionOf(x))).toBe(false);
    expect(await loadSession(broken)).toBeNull();
    expect(await clearSession(broken)).toBe(false);
  });
});

// --- the ordinary round trip ------------------------------------------------

describe('round trip', () => {
  it('brings back the squad, the team name and the match shape', async () => {
    const x = setUp();
    const store = createMemoryStore();
    await saveSession(store, sessionOf(x, { squadName: 'Barnton Under 10s' }));

    const saved = (await loadSession(store))!;
    expect(saved.squadName).toBe('Barnton Under 10s');
    expect(saved.players).toHaveLength(10);
    expect(saved.players[0].firstName).toBe('P0');
    expect(saved.totalMinutes).toBe(50);
    expect(saved.periodCount).toBe(4);
    expect(saved.format.onFieldCount).toBe(7);
    expect(saved.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it('saves a squad with no match yet', async () => {
    const x = setUp();
    const store = createMemoryStore();
    await saveSession(store, sessionOf(x, { state: null }));
    const saved = (await loadSession(store))!;
    expect(saved.matches).toEqual([]);
    expect(saved.currentMatchId).toBeNull();
    expect(toMatchState(saved)).toBeNull();
    expect(saved.players).toHaveLength(10);
  });

  it('keeps the mid-week plan', async () => {
    const x = setUp();
    const store = createMemoryStore();
    const plan = { '1': [x.players[0].id, x.players[1].id], '2': [x.players[2].id] };
    await saveSession(store, sessionOf(x, { plan }));
    expect((await loadSession(store))!.plan).toEqual(plan);
  });

  it('clears everything when asked, so a phone can be handed on', async () => {
    const x = setUp();
    const store = createMemoryStore();
    await saveSession(store, sessionOf(x));
    expect(await loadSession(store)).not.toBeNull();
    await clearSession(store);
    expect(await loadSession(store)).toBeNull();
  });

  it('writes to one key and nothing else', async () => {
    const x = setUp();
    const seen: string[] = [];
    const spy: KeyValueStore = {
      async getItem() {
        return null;
      },
      async setItem(key) {
        seen.push(key);
      },
      async removeItem(key) {
        seen.push(key);
      },
    };
    await saveSession(spy, sessionOf(x));
    await clearSession(spy);
    expect(seen).toEqual([STORAGE_KEY, STORAGE_KEY]);
  });
});

// --- what the resume prompt asks --------------------------------------------

describe('resume detection', () => {
  it('knows a quarter was left running', async () => {
    const x = setUp();
    const store = createMemoryStore();
    x.engine.startQuarter(
      x.state,
      x.state.quarters[0],
      teamSheetFor(x.players.slice(0, 7).map((p) => p.id), x.players[0].id, x.format),
      x.format
    );
    await saveSession(store, sessionOf(x));
    const saved = await loadSession(store);
    expect(hasMatchInProgress(saved)).toBe(true);
    expect(hasMatchUnderway(saved)).toBe(true);
  });

  it('knows a match is underway between quarters, with nothing running', async () => {
    const x = setUp();
    const store = createMemoryStore();
    x.engine.startQuarter(
      x.state,
      x.state.quarters[0],
      teamSheetFor(x.players.slice(0, 7).map((p) => p.id), x.players[0].id, x.format),
      x.format
    );
    x.clock.advance(60_000);
    x.engine.endQuarter(x.state, x.state.quarters[0]);
    await saveSession(store, sessionOf(x));
    const saved = await loadSession(store);
    expect(hasMatchInProgress(saved)).toBe(false);
    expect(hasMatchUnderway(saved)).toBe(true);
  });

  it('does not offer to resume a match that never started, or one that finished', async () => {
    const x = setUp(10, 40, 2);
    const store = createMemoryStore();
    await saveSession(store, sessionOf(x));
    expect(hasMatchUnderway(await loadSession(store))).toBe(false);

    for (const q of x.state.quarters) {
      x.engine.startQuarter(
        x.state,
        q,
        teamSheetFor(x.players.slice(0, 7).map((p) => p.id), x.players[0].id, x.format),
        x.format
      );
      x.clock.advance(20 * 60_000);
      x.engine.endQuarter(x.state, q);
    }
    await saveSession(store, sessionOf(x));
    expect(hasMatchUnderway(await loadSession(store))).toBe(false);
    expect(hasMatchInProgress(null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// History survives a save — #62, slice 3
// ---------------------------------------------------------------------------

describe('many matches', () => {
  it('keeps played matches when the current one is saved', () => {
    // The property that protects a season. `saveSession` writes the WHOLE
    // document, so anything not passed is not written — a save that forgot to
    // carry the history would silently delete it, one match at a time, with
    // nothing failing.
    const played = toSavedSession({
      squadName: 'Rovers',
      squadId: uuid(),
      players: [],
      format: makeSevenASideFormat(),
      totalMinutes: 50,
      periodCount: 4,
      plan: {},
      state: null,
    });

    const history: SavedMatch[] = [
      {
        match: {
          id: uuid(),
          squadId: played.squadId,
          formatId: played.format.id,
          opponent: 'Last week',
          competition: 'league',
          kickoffAt: '2026-09-12T10:00:00Z',
          totalMinutes: 50,
          quarterCount: 4,
          status: 'completed',
          createdAt: '2026-09-01T00:00:00Z',
        },
        quarters: [],
        appearances: [],
        benchStints: [],
        availability: [],
      },
    ];

    const saved = toSavedSession({
      squadName: 'Rovers',
      squadId: played.squadId,
      players: [],
      format: played.format,
      totalMinutes: 50,
      periodCount: 4,
      plan: {},
      matches: history,
      state: null,
    });

    expect(saved.matches).toHaveLength(1);
    expect(saved.matches[0].match.opponent).toBe('Last week');

    // And it round-trips.
    const back = parseSession(JSON.stringify(saved))!;
    expect(back.matches).toHaveLength(1);
    expect(back.matches[0].match.opponent).toBe('Last week');
    expect(back.matches[0].match.competition).toBe('league');
  });

  it('replaces the current match rather than appending a second copy', () => {
    // A coach who opens a planned fixture and kicks off must end up with ONE
    // match that changed status, not a planned one and an in-progress one
    // that disagree about the same game.
    const engine = new MatchEngine();
    const squadId = uuid();
    const format = makeSevenASideFormat();
    const state = engine.createMatch(squadId, format.id, {
      totalMinutes: 50,
      quarterCount: 4,
      opponent: 'Riverside',
    });

    const base = {
      squadName: 'Rovers',
      squadId,
      players: [],
      format,
      totalMinutes: 50,
      periodCount: 4,
      plan: {},
    };

    const first = toSavedSession({ ...base, state });
    expect(first.matches).toHaveLength(1);
    expect(first.currentMatchId).toBe(state.match.id);

    // Save again, same match, now mutated.
    state.match.status = 'in_progress';
    const second = toSavedSession({ ...base, matches: first.matches, state });

    expect(second.matches).toHaveLength(1);
    expect(second.matches[0].match.status).toBe('in_progress');
  });

  it('keeps the format the current match is played in', () => {
    const x = setUp();
    const played = makeSevenASideFormat();
    const saved = toSavedSession(sessionOf(x, { matchFormat: played }));
    expect(saved.matches[0].format?.id).toBe(played.id);
    // And it survives the round trip, positions and all.
    const back = parseSession(JSON.stringify(saved))!;
    expect(back.matches[0].format?.positions.map((p) => p.label)).toEqual(
      played.positions.map((p) => p.label)
    );
  });

  it('does not drop a stored format when the save does not name one', () => {
    // A caller that does not know which format the match is played in must not
    // be able to erase one: its appearances reference position ids that only
    // that snapshot still explains.
    const x = setUp();
    const played = makeSevenASideFormat();
    const first = toSavedSession(sessionOf(x, { matchFormat: played }));
    const second = toSavedSession(sessionOf(x, { matches: first.matches }));
    expect(second.matches[0].format?.id).toBe(played.id);
  });

  it('leaves saved matches alone when the squad DEFAULT shape changes', () => {
    // The PO ruling, in one test: "A cup game can be halves without changing
    // next Saturday's league default." Same for the shape.
    const x = setUp();
    const cupShape = makeSevenASideFormat();
    const stored = toSavedSession(sessionOf(x, { matchFormat: cupShape, state: x.state }));

    const newDefault = makeSevenASideFormat();
    expect(newDefault.id).not.toBe(cupShape.id);

    const after = toSavedSession(
      sessionOf(x, { format: newDefault, matches: stored.matches, state: null })
    );
    expect(after.format.id).toBe(newDefault.id);
    expect(after.matches[0].format?.id).toBe(cupShape.id);
  });

  it('drops a currentMatchId that names a match which is not there', () => {
    // It would otherwise send the app to a screen with nothing behind it.
    const saved = toSavedSession({
      squadName: 'Rovers',
      squadId: uuid(),
      players: [],
      format: makeSevenASideFormat(),
      totalMinutes: 50,
      periodCount: 4,
      plan: {},
      state: null,
    });
    const tampered = { ...saved, currentMatchId: uuid() };
    const back = parseSession(JSON.stringify(tampered))!;
    expect(back.currentMatchId).toBeNull();
  });
});
