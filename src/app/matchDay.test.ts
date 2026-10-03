/**
 * A whole mock match, end to end, through the same save path the app uses
 * (PO, match day 4: "we need to test and mock a match ... subs are not being
 * retained. Matches that complete are not showing in played section, data is
 * stripped").
 *
 * The app's sequence is replayed step by step: a fixture is saved, opened and
 * played four quarters with subs and a goal, saving after every action as the
 * app does, then let go of from the summary. The document is then read back
 * the way a relaunch reads it. Synthetic first names only.
 */

import { describe, expect, it } from 'vitest';
import { MatchEngine, type MatchState } from '../engine/MatchEngine';
import { uuid } from '../types/index';
import type { Player } from '../types/index';
import { makePlayer } from './squad';
import { makeSevenASideFormat } from './placeholderSquad';
import { teamSheetFor } from './lineup';
import { currentQuarter } from './matchClock';
import { foldPlayerMinutes } from './playerMinutes';
import { fixtureList, inBucket } from './fixtures';
import { progressById, scoresById, withLiveMatch } from './liveMatch';
import { scoreOf } from './matchEvents';
import {
  createMemoryStore,
  loadSession,
  mergeCurrentMatch,
  saveSession,
  toMatchState,
  type SavedMatch,
} from './persistence';

const MIN = 60_000;
const QUARTER = 12.5 * MIN;
const T0 = Date.parse('2026-10-03T09:00:00Z');

function matchDay(kickoffAt: string | null) {
  let now = T0;
  const nowFn = () => new Date(now);
  const advance = (ms: number) => (now += ms);
  const format = makeSevenASideFormat();
  const squadId = uuid();
  const players: Player[] = ['Ava', 'Ben', 'Cal', 'Dan', 'Eve', 'Fin', 'Gus', 'Hal', 'Ivy'].map(
    (n) => makePlayer(squadId, n)
  );
  const store = createMemoryStore();
  const session = (matches: SavedMatch[], state: MatchState | null) => ({
    squadName: 'Test FC',
    squadId,
    players,
    format,
    totalMinutes: 50,
    periodCount: 4,
    plan: {},
    matches,
    state,
    matchFormat: state ? format : null,
    now: nowFn(),
  });

  // Saturday morning: the fixture exists, saved and not yet played.
  const planned = new MatchEngine({ nowFn }).createMatch(squadId, format.id, {
    opponent: 'Rovers',
    kickoffAt,
    totalMinutes: 50,
    quarterCount: 4,
    availablePlayerIds: players.map((p) => p.id),
  });
  const fixture = mergeCurrentMatch([], planned, format)[0];
  return { advance, nowFn, format, players, store, session, fixture, planned };
}

/** Play all four quarters, saving after every action as the app does. */
async function playFourQuarters(day: ReturnType<typeof matchDay>, matches: SavedMatch[]) {
  const engine = new MatchEngine({ nowFn: day.nowFn });
  // Opening the fixture: the live state starts as a copy of the stored one.
  const stored = matches[0];
  const state: MatchState = {
    match: stored.match,
    quarters: stored.quarters,
    appearances: stored.appearances,
    benchStints: stored.benchStints,
    playerAvailability: new Map(stored.availability),
    events: stored.events ?? [],
  };
  const ids = day.players.map((p) => p.id);
  for (let q = 0; q < 4; q++) {
    const quarter = currentQuarter(state)!;
    engine.startQuarter(state, quarter, teamSheetFor(ids.slice(0, 7), ids[0], day.format), day.format);
    await saveSession(day.store, day.session(matches, state));
    day.advance(6 * MIN);
    engine.substitute(state, quarter, ids[6], ids[7]); // a sub every quarter
    await saveSession(day.store, day.session(matches, state));
    if (q === 1) {
      engine.recordEvent(state, quarter, 'goal', ids[5]);
      await saveSession(day.store, day.session(matches, state));
    }
    if (q === 2) {
      engine.recordEvent(state, quarter, 'goal', ids[4]);
      engine.recordEvent(state, quarter, 'conceded', ids[0]);
      await saveSession(day.store, day.session(matches, state));
    }
    day.advance(QUARTER - 6 * MIN);
    engine.endQuarter(state, quarter);
    await saveSession(day.store, day.session(matches, state));
  }
  return { engine, state };
}

describe('a mock match, kick-off to Played (match day 4)', () => {
  it('keeps every period, sub and goal after the summary is left, and files it under Played', async () => {
    const day = matchDay('2026-10-03T10:00:00Z');
    // The list the app holds in memory: the fixture as saved before kick-off.
    const matches = [day.fixture];
    const { engine, state } = await playFourQuarters(day, matches);
    const expected = foldPlayerMinutes(engine, state, day.players);

    // Leaving the summary, exactly as the app now does it: fold, then save.
    const after = withLiveMatch(matches, { state, format: day.format });
    await saveSession(day.store, day.session(after, null));

    // A relaunch reads it back.
    const saved = (await loadSession(day.store))!;
    const played = saved.matches.find((m) => m.match.id === day.planned.match.id)!;
    expect(played.quarters.every((q) => q.status === 'ended')).toBe(true);
    // 7 starters + 1 sub each quarter = 8 appearances a quarter.
    expect(played.appearances).toHaveLength(32);
    // The score, 2 – 1, folded from the events read back (PO: "scores are
    // not being retained").
    expect(scoreOf(played.events)).toEqual({ us: 2, them: 1 });
    expect(scoresById(saved.matches, null).get(played.match.id)).toEqual({ us: 2, them: 1 });

    // The minutes read back are the minutes that were played.
    const reloaded = toMatchState(saved, played.match.id)!;
    expect(foldPlayerMinutes(new MatchEngine({ nowFn: day.nowFn }), reloaded, day.players)).toEqual(
      expected
    );
    const total = expected.reduce((sum, p) => sum + p.outfieldMs + p.goalkeeperMs, 0);
    expect(total).toBe(7 * 50 * MIN);

    // And it is listed under Played.
    const rows = fixtureList(
      saved.matches.map((m) => m.match),
      day.nowFn(),
      null,
      progressById(saved.matches, null)
    );
    expect(inBucket(rows, 'past').map((r) => r.match.id)).toEqual([played.match.id]);
  });

  it('reproduces the defect: a Play-now match let go WITHOUT the fold was deleted', async () => {
    // Play now puts the match on the clock without adding it to the list the
    // app holds; only the save folds it in on disk. Leaving its summary then
    // saved the list without it.
    const day = matchDay(null);
    await playFourQuarters(day, [day.fixture]);
    await saveSession(day.store, day.session([], null)); // the old sequence
    expect((await loadSession(day.store))!.matches).toHaveLength(0);
  });

  it('keeps a finished Play-now match when it is folded in first', async () => {
    const day = matchDay(null);
    const { state } = await playFourQuarters(day, [day.fixture]);
    await saveSession(day.store, day.session(withLiveMatch([], { state, format: day.format }), null));
    const saved = (await loadSession(day.store))!;
    expect(saved.matches).toHaveLength(1);
    expect(saved.matches[0].appearances).toHaveLength(32);
    expect(scoreOf(saved.matches[0].events)).toEqual({ us: 2, them: 1 });
  });

  it('does not leave a finished match listed as Now, though its status still says in progress', async () => {
    const day = matchDay('2026-10-03T10:00:00Z');
    const { state } = await playFourQuarters(day, [day.fixture]);
    expect(state.match.status).toBe('in_progress'); // what the engine leaves
    const rows = fixtureList([state.match], day.nowFn(), null, progressById([], { state, format: day.format }));
    expect(inBucket(rows, 'current')).toHaveLength(0);
    expect(inBucket(rows, 'past')).toHaveLength(1);
  });

  it('files a finished Play-now match, which has no date, under Played', async () => {
    const day = matchDay(null);
    const matches = [day.fixture];
    const { state } = await playFourQuarters(day, matches);
    const after = withLiveMatch(matches, { state, format: day.format });
    const rows = fixtureList(
      after.map((m) => m.match),
      day.nowFn(),
      null,
      progressById(after, null)
    );
    expect(inBucket(rows, 'past')).toHaveLength(1);
    expect(inBucket(rows, 'future')).toHaveLength(0);
  });

  it('lists a match under way as Now, read from the live state', async () => {
    const day = matchDay('2026-10-03T10:00:00Z');
    const engine = new MatchEngine({ nowFn: day.nowFn });
    const state = day.planned;
    const ids = day.players.map((p) => p.id);
    engine.startQuarter(state, currentQuarter(state)!, teamSheetFor(ids.slice(0, 7), ids[0], day.format), day.format);
    const rows = fixtureList(
      [day.fixture.match],
      day.nowFn(),
      null,
      progressById([day.fixture], { state, format: day.format })
    );
    expect(inBucket(rows, 'current')).toHaveLength(1);
  });
});

describe('the score on a fixture card (match day 4)', () => {
  it('is shown for a match kicked off, live score included, and not for one to come', async () => {
    const day = matchDay('2026-10-03T10:00:00Z');
    const engine = new MatchEngine({ nowFn: day.nowFn });
    const state = day.planned;
    const ids = day.players.map((p) => p.id);
    const quarter = currentQuarter(state)!;
    engine.startQuarter(state, quarter, teamSheetFor(ids.slice(0, 7), ids[0], day.format), day.format);
    engine.recordEvent(state, quarter, 'conceded', ids[0]);
    const other = matchDay('2026-10-10T10:00:00Z').fixture;
    const scores = scoresById([day.fixture, other], { state, format: day.format });
    expect(scores.get(state.match.id)).toEqual({ us: 0, them: 1 });
    expect(scores.has(other.match.id)).toBe(false);
  });
});
