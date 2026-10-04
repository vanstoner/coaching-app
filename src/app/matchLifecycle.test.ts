/**
 * A match's life on the device — #99 AC1.
 *
 * Every rule `App.tsx` used to hold untested, and each defect a coach found
 * in one of them, replayed without a phone. Synthetic first names only.
 */

import { describe, expect, it } from 'vitest';
import { MatchEngine, type MatchState } from '../engine/MatchEngine';
import { uuid } from '../types/index';
import type { Player } from '../types/index';
import { makePlayer } from './squad';
import { makeSevenASideFormat } from './placeholderSquad';
import { formatForShape } from './shapes';
import { teamSheetFor } from './lineup';
import { currentQuarter } from './matchClock';
import { scoreOf } from './matchEvents';
import { addTestData } from './testKit';
import { createMemoryStore, loadSession, mergeCurrentMatch, saveSession, type SavedMatch } from './persistence';
import {
  availabilityForOpening,
  deleteMatch,
  matchesOnRelease,
  newMatch,
  openMatch,
  storedFromHeld,
} from './matchLifecycle';

const MIN = 60_000;
const T0 = Date.parse('2026-10-03T09:00:00Z');

function squadDay() {
  let now = T0;
  const nowFn = () => new Date(now);
  const format = makeSevenASideFormat();
  const squadId = uuid();
  const players: Player[] = ['Ava', 'Ben', 'Cal', 'Dan', 'Eve', 'Fin', 'Gus', 'Hal', 'Ivy'].map(
    (n) => makePlayer(squadId, n)
  );
  const create = (extra: { opponent?: string | null; kickoffAt?: string | null } = {}) =>
    newMatch({ squadId, format, totalMinutes: 50, periodCount: 4, players, ...extra }, nowFn);
  /** Kick off the first quarter with the first seven. */
  const kickOff = (state: MatchState, engine = new MatchEngine({ nowFn })) => {
    const ids = players.map((p) => p.id);
    engine.startQuarter(state, currentQuarter(state)!, teamSheetFor(ids.slice(0, 7), ids[0], format), format);
    return engine;
  };
  return { nowFn, advance: (ms: number) => (now += ms), format, squadId, players, create, kickOff };
}

describe('one builder for a new match (#99 AC1)', () => {
  it('records everyone in the active squad as available at creation, retired players left out', () => {
    const day = squadDay();
    const retired = { ...day.players[8], active: false };
    const players = [...day.players.slice(0, 8), retired];
    const { held, stored } = newMatch(
      { squadId: day.squadId, format: day.format, totalMinutes: 50, periodCount: 4, players },
      day.nowFn
    );
    const expected = players.slice(0, 8).map((p) => [p.id, 'available']);
    expect(stored.availability).toEqual(expected);
    expect([...held.state.playerAvailability.entries()]).toEqual(expected);
  });

  it('regression: a fixture saved from the form no longer stores an empty availability list', () => {
    // The fixture form hand-built its SavedMatch with `availability: []`, so
    // a fixture's availability was only ever invented later, at opening.
    const { stored } = squadDay().create({ opponent: 'Rovers', kickoffAt: '2026-10-10T09:00:00Z' });
    expect(stored.availability).toHaveLength(9);
    expect(stored.match.status).toBe('planned');
    expect(stored.appearances).toEqual([]);
    expect(stored.benchStints).toEqual([]);
  });

  it('snapshots the shape, length and periods onto the match (#70)', () => {
    const day = squadDay();
    const halves = formatForShape('2-3-1', day.format);
    const { stored } = newMatch(
      { squadId: day.squadId, format: halves, totalMinutes: 40, periodCount: 2, players: day.players },
      day.nowFn
    );
    expect(stored.format).toEqual(halves);
    expect(stored.match.formatId).toBe(halves.id);
    expect(stored.match.totalMinutes).toBe(40);
    expect(stored.quarters).toHaveLength(2);
  });

  it('trims the opponent, and a blank one is no opponent', () => {
    const day = squadDay();
    expect(day.create({ opponent: '  Rovers ' }).stored.match.opponent).toBe('Rovers');
    expect(day.create({ opponent: '   ' }).stored.match.opponent).toBeNull();
    expect(day.create().stored.match.opponent).toBeNull();
  });

  it('stores exactly what a save of the same match held live would write', () => {
    const day = squadDay();
    const { held, stored } = day.create({ opponent: 'Rovers' });
    expect(stored).toEqual(mergeCurrentMatch([], held.state, held.format)[0]);
  });

  it('is what the Test kit builds its fixtures with: availability recorded on each', () => {
    const day = squadDay();
    const data = addTestData(day.players, [], day.squadId, day.format, 50, 4, day.nowFn());
    expect(data.matches).toHaveLength(2);
    const active = data.players.filter((p) => p.active).map((p) => p.id);
    for (const m of data.matches) {
      expect(m.availability.map(([id]) => id)).toEqual(active);
      expect(m.format).toEqual(day.format);
    }
  });
});

describe('opening a stored match', () => {
  it('goes back to the match already held as it is, never rebuilt from the stored copy', () => {
    // Rebuilding the held match from the list would drop everything since it
    // was last folded in: here, a whole quarter just kicked off.
    const day = squadDay();
    const { held, stored } = day.create();
    day.kickOff(held.state);
    const outcome = openMatch([stored], held, held.state.match.id, day.players, day.format);
    expect(outcome.kind).toBe('already_held');
    if (outcome.kind !== 'already_held') return;
    expect(outcome.held).toBe(held);
    expect(outcome.held.state.appearances).toHaveLength(7);
  });

  it('rebuilds another match from its stored copy, in its own shape', () => {
    const day = squadDay();
    const a = day.create({ opponent: 'A' });
    const b = day.create({ opponent: 'B' });
    const outcome = openMatch([a.stored, b.stored], a.held, b.held.state.match.id, day.players, day.format);
    expect(outcome.kind).toBe('open');
    if (outcome.kind !== 'open') return;
    expect(outcome.held.state.match).toEqual(b.stored.match);
    expect(outcome.held.format).toBe(b.stored.format);
  });

  it('falls back to the squad default shape for a match stored without one', () => {
    const day = squadDay();
    const { stored } = day.create();
    const bare: SavedMatch = { ...stored, format: undefined };
    const fallback = formatForShape('2-3-1', day.format);
    const outcome = openMatch([bare], null, stored.match.id, day.players, fallback);
    expect(outcome.kind === 'open' && outcome.held.format).toBe(fallback);
  });

  it('says so for a match that is not there', () => {
    const day = squadDay();
    expect(openMatch([], null, uuid(), day.players, day.format).kind).toBe('not_found');
  });

  it('regression (#84): carries the events, so the next goal is added to them, not over them', async () => {
    const day = squadDay();
    const first = day.create();
    const engine = day.kickOff(first.held.state);
    const q = currentQuarter(first.held.state)!;
    engine.recordEvent(first.held.state, q, 'goal', day.players[3].id);
    engine.recordEvent(first.held.state, q, 'goal', day.players[4].id);
    const list = matchesOnRelease([first.stored], first.held, null);

    const reopened = openMatch(list, null, first.held.state.match.id, day.players, day.format);
    if (reopened.kind !== 'open') throw new Error(reopened.kind);
    expect(reopened.held.state.events).toHaveLength(2);
    new MatchEngine({ nowFn: day.nowFn }).recordEvent(
      reopened.held.state,
      currentQuarter(reopened.held.state)!,
      'conceded',
      day.players[0].id
    );
    const store = createMemoryStore();
    await saveSession(store, {
      squadName: 'Test FC',
      squadId: day.squadId,
      players: day.players,
      format: day.format,
      totalMinutes: 50,
      periodCount: 4,
      plan: {},
      matches: list,
      state: reopened.held.state,
      matchFormat: reopened.held.format,
    });
    const saved = (await loadSession(store))!;
    expect(scoreOf(saved.matches[0].events)).toEqual({ us: 2, them: 1 });
  });
});

describe('availability when a match is opened', () => {
  it('back-fills a not-started fixture stored with none, from today’s squad (#64)', () => {
    const day = squadDay();
    const { stored } = day.create();
    const legacy = { ...stored, availability: [] };
    const map = availabilityForOpening(legacy, day.players);
    expect([...map.keys()]).toEqual(day.players.map((p) => p.id));
    expect([...map.values()].every((s) => s === 'available')).toBe(true);
  });

  it('never back-fills a match that has been played: no invented bench', () => {
    const day = squadDay();
    const { held } = day.create();
    day.kickOff(held.state);
    const played = { ...storedFromHeld(held), availability: [] };
    expect(availabilityForOpening(played, day.players).size).toBe(0);
  });

  it('adds a player who joined after the fixture was saved, and changes no recorded entry', () => {
    const day = squadDay();
    const { stored } = day.create();
    const absent = stored.availability[2][0];
    const recorded: SavedMatch = {
      ...stored,
      availability: stored.availability.map(([id, s]) => [id, id === absent ? 'absent' : s]),
    };
    const late = makePlayer(day.squadId, 'Jo');
    const map = availabilityForOpening(recorded, [...day.players, late]);
    expect(map.get(late.id)).toBe('available');
    expect(map.get(absent)).toBe('absent');
    expect(map.size).toBe(10);
  });

  it('does not add a retired player', () => {
    const day = squadDay();
    const { stored } = day.create();
    const retired = { ...makePlayer(day.squadId, 'Jo'), active: false };
    expect(availabilityForOpening(stored, [...day.players, retired]).has(retired.id)).toBe(false);
  });

  it('gives a late joiner a bench stint when the fixture is played', () => {
    const day = squadDay();
    const { stored } = day.create();
    const late = makePlayer(day.squadId, 'Jo');
    const outcome = openMatch([stored], null, stored.match.id, [...day.players, late], day.format);
    if (outcome.kind !== 'open') throw new Error(outcome.kind);
    day.kickOff(outcome.held.state);
    expect(outcome.held.state.benchStints.some((b) => b.playerId === late.id)).toBe(true);
  });
});

describe('letting go of the live match', () => {
  it('regression (match day 4): folds a finished match in first, so the stale pre-kick-off copy is replaced', () => {
    const day = squadDay();
    const { held, stored } = day.create({ opponent: 'Rovers' });
    const engine = day.kickOff(held.state);
    day.advance(12.5 * MIN);
    engine.endQuarter(held.state, held.state.quarters[0]);
    const after = matchesOnRelease([stored], held, null);
    expect(after).toHaveLength(1);
    expect(after[0].appearances).toHaveLength(7);
    expect(after[0].quarters[0].status).toBe('ended');
  });

  it('regression (match day 4): a Play-now match, never in the list, is added rather than lost', () => {
    const day = squadDay();
    const { held } = day.create();
    day.kickOff(held.state);
    const after = matchesOnRelease([], held, null);
    expect(after.map((m) => m.match.id)).toEqual([held.state.match.id]);
  });

  it('folds the old match in when another is opened over it', () => {
    const day = squadDay();
    const a = day.create();
    const b = day.create();
    day.kickOff(a.held.state);
    const after = matchesOnRelease([a.stored, b.stored], a.held, b.held);
    expect(after[0].appearances).toHaveLength(7);
    expect(after[1]).toBe(b.stored);
  });

  it('changes nothing when nothing is held, or the same match stays held', () => {
    const day = squadDay();
    const { held, stored } = day.create();
    const list = [stored];
    expect(matchesOnRelease(list, null, held)).toBe(list);
    expect(matchesOnRelease(list, held, held)).toBe(list);
  });
});

describe('deleting a fixture', () => {
  it('removes one never played', () => {
    const day = squadDay();
    const a = day.create();
    const b = day.create();
    const outcome = deleteMatch([a.stored, b.stored], null, a.stored.match.id);
    expect(outcome).toEqual({ ok: true, matches: [b.stored], releaseLive: false });
  });

  it('refuses one that has been played (invariant 5)', () => {
    const day = squadDay();
    const { held } = day.create();
    day.kickOff(held.state);
    expect(deleteMatch([storedFromHeld(held)], null, held.state.match.id)).toEqual({ ok: false });
  });

  it('regression: judges a match kicked off a moment ago on its live state, not its unplayed stored copy', () => {
    const day = squadDay();
    const { held, stored } = day.create();
    // The stored copy as read from disk: sharing no object with the live
    // state, so the engine's changes cannot leak into it.
    const onDisk: SavedMatch = JSON.parse(JSON.stringify(stored));
    day.kickOff(held.state);
    expect(onDisk.quarters.every((q) => q.status === 'pending')).toBe(true);
    expect(onDisk.match.status).toBe('planned');
    expect(deleteMatch([onDisk], held, held.state.match.id)).toEqual({ ok: false });
  });

  it('refuses one that is not there', () => {
    expect(deleteMatch([], null, uuid())).toEqual({ ok: false });
  });

  it('regression: lets go of a deleted fixture that is held, so the next save cannot write it back', async () => {
    // Opened and left without kicking off, the fixture is still the live
    // match; saving while still holding it wrote it straight back.
    const day = squadDay();
    const { held, stored } = day.create();
    const outcome = deleteMatch([stored], held, held.state.match.id);
    if (!outcome.ok) throw new Error('refused');
    expect(outcome.releaseLive).toBe(true);
    const session = (state: MatchState | null) => ({
      squadName: 'Test FC',
      squadId: day.squadId,
      players: day.players,
      format: day.format,
      totalMinutes: 50,
      periodCount: 4,
      plan: {},
      matches: outcome.matches,
      state,
      matchFormat: state ? day.format : null,
    });
    const store = createMemoryStore();
    await saveSession(store, session(held.state)); // still holding it: back it comes
    expect((await loadSession(store))!.matches).toHaveLength(1);
    await saveSession(store, session(null)); // let go of, as releaseLive says
    expect((await loadSession(store))!.matches).toHaveLength(0);
  });
});

describe('a planned fixture, end to end through the lifecycle', () => {
  it('saved, opened, played and let go of: one match, every period kept', () => {
    const day = squadDay();
    const { stored } = day.create({ opponent: 'Rovers', kickoffAt: '2026-10-03T10:00:00Z' });
    let list: SavedMatch[] = [stored];
    const outcome = openMatch(list, null, stored.match.id, day.players, day.format);
    if (outcome.kind !== 'open') throw new Error(outcome.kind);
    const live = outcome.held;
    const engine = new MatchEngine({ nowFn: day.nowFn });
    for (let q = 0; q < 4; q++) {
      day.kickOff(live.state, engine);
      day.advance(12.5 * MIN);
      engine.endQuarter(live.state, live.state.quarters[q]);
    }
    list = matchesOnRelease(list, live, null);
    expect(list).toHaveLength(1);
    expect(list[0].quarters.every((q) => q.status === 'ended')).toBe(true);
    expect(list[0].appearances).toHaveLength(28);
    // Two on the bench each quarter, recorded because availability was.
    expect(list[0].benchStints).toHaveLength(8);
    expect(deleteMatch(list, null, stored.match.id)).toEqual({ ok: false });
  });
});
