/**
 * Starting a fixture through the squad editor — #223 AC2, QA finding 3 on
 * #221, PO ruling 22 Oct (`fix fixture start in 1.3.0`): when a fixture is
 * opened without enough players, both the "enough players" check and the
 * match Start begins follow THAT fixture's format and opponent. Start never
 * begins a Play-now match from the Settings defaults on that route. The
 * Play-now route itself is unchanged.
 *
 * The decision is pure and tested here with the real openMatch and
 * openDestination. The wiring in App.tsx can only be proved by a source check
 * (there are no screen-render tests in Node), and is, at the end.
 * Made-up first names only (invariant 4).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { uuid, type Player, type UUID } from '../types/index';
import { openDestination } from './fixtures';
import type { HeldMatch } from './liveMatch';
import { newMatch, openMatch } from './matchLifecycle';
import { PLAY_NOW_ROUTE, routeFormat, startOnRoute, type MatchRoute } from './matchRoute';
import { makeFormat } from './shapes';
import { makePlayer, squadReadiness } from './squad';

const NOW = new Date('2026-10-24T09:00:00Z');
const FIVE = makeFormat('2-2'); // the Settings default in these tests
const SEVEN = makeFormat('2-3-1');

function squadOf(squadId: UUID, names: string[]): Player[] {
  return names.map((n) => makePlayer(squadId, n));
}

/** A 7-a-side fixture against a named opponent, saved with the given squad. */
function sevenASideFixture(squadId: UUID, players: Player[]) {
  return newMatch(
    { squadId, format: SEVEN, totalMinutes: 50, periodCount: 4, players, opponent: 'Elm Park' },
    () => NOW
  );
}

/** What opening a fixture does in App.tsx, minus the React: hold it, decide where it lands. */
function open(matches: ReturnType<typeof sevenASideFixture>['stored'][], held: HeldMatch | null, id: UUID, squad: Player[]) {
  const outcome = openMatch(matches, held, id, squad, FIVE);
  if (outcome.kind === 'not_found') throw new Error('fixture not found');
  const to = openDestination(
    outcome.held.state.quarters,
    outcome.held.state.match.status,
    squadReadiness(squad, outcome.held.format.onFieldCount).ready
  );
  return { held: outcome.held, to };
}

describe('the squad errand for a fixture follows that fixture (#223 AC2)', () => {
  it('with a 5-a-side default, a 7-a-side fixture needs 7 players', () => {
    const squadId = uuid();
    const six = squadOf(squadId, ['Ava', 'Ben', 'Cal', 'Dee', 'Eli', 'Fay']);
    const fixture = sevenASideFixture(squadId, six);
    const route: MatchRoute = { kind: 'fixture', matchId: fixture.stored.match.id };

    // Held (opening a fixture holds it) or only stored: either way, 7.
    expect(routeFormat(route, fixture.held, [fixture.stored], FIVE).onFieldCount).toBe(7);
    expect(routeFormat(route, null, [fixture.stored], FIVE).onFieldCount).toBe(7);

    // Six is enough for the default, and not for this fixture.
    expect(squadReadiness(six, FIVE.onFieldCount).ready).toBe(true);
    const count = routeFormat(route, fixture.held, [fixture.stored], FIVE).onFieldCount;
    expect(squadReadiness(six, count)).toMatchObject({ ready: false, shortBy: 1 });
    const seven = [...six, makePlayer(squadId, 'Gus')];
    expect(squadReadiness(seven, count).ready).toBe(true);
  });

  it('a different match held does not lend the fixture its shape', () => {
    const squadId = uuid();
    const fixture = sevenASideFixture(squadId, []);
    const other = newMatch({ squadId, format: FIVE, totalMinutes: 40, periodCount: 2, players: [] }, () => NOW);
    const route: MatchRoute = { kind: 'fixture', matchId: fixture.stored.match.id };
    expect(routeFormat(route, other.held, [fixture.stored, other.stored], FIVE).onFieldCount).toBe(7);
  });

  it('Start from the errand starts the fixture, with its opponent and shape', () => {
    const squadId = uuid();
    const six = squadOf(squadId, ['Ava', 'Ben', 'Cal', 'Dee', 'Eli', 'Fay']);
    const fixture = sevenASideFixture(squadId, six);
    const matches = [fixture.stored];
    const id = fixture.stored.match.id;

    // Opened with six against a 7-a-side shape: to the squad editor.
    const first = open(matches, null, id, six);
    expect(first.to).toBe('squad');
    const route: MatchRoute = { kind: 'fixture', matchId: id };

    // The coach adds a seventh, then presses Start.
    const seven = [...six, makePlayer(squadId, 'Gus')];
    const playNow = vi.fn();
    const openFixture = vi.fn();
    startOnRoute(route, { playNow, openFixture });
    expect(playNow).not.toHaveBeenCalled();
    expect(openFixture).toHaveBeenCalledWith(id);

    // Opening it again goes back to the match held, now to the lineup.
    const again = open(matches, first.held, id, seven);
    expect(again.to).toBe('lineup');
    expect(again.held.state.match.id).toBe(id);
    expect(again.held.state.match.opponent).toBe('Elm Park');
    expect(again.held.format.onFieldCount).toBe(7);
    expect(again.held.format).toBe(first.held.format);
    expect(again.held.state.match.totalMinutes).toBe(50);
  });

  it('the plain Play-now route is unchanged: the default shape, and Start plays now', () => {
    const squadId = uuid();
    const fixture = sevenASideFixture(squadId, []);
    // Even with a 7-a-side fixture held, Play now counts against the default.
    expect(routeFormat(PLAY_NOW_ROUTE, fixture.held, [fixture.stored], FIVE)).toBe(FIVE);

    const playNow = vi.fn();
    const openFixture = vi.fn();
    startOnRoute(PLAY_NOW_ROUTE, { playNow, openFixture });
    expect(playNow).toHaveBeenCalledTimes(1);
    expect(openFixture).not.toHaveBeenCalled();
  });
});

describe('App.tsx wires the route (source check: no screen-render tests in Node)', () => {
  const app = readFileSync(join(__dirname, '..', '..', 'App.tsx'), 'utf8');
  const squadBlock = app.slice(app.indexOf("if (effectiveStep === 'squad')"), app.indexOf('<LineupScreen'));
  const openFixtureBlock = app.slice(app.indexOf('const openFixture = useCallback'), app.indexOf('const beginMatch = useCallback'));
  const playNowBlock = app.slice(app.indexOf('const playNow = useCallback'), app.indexOf('const resume = useCallback'));

  it('opening a fixture short of players routes the errand to that fixture', () => {
    expect(openFixtureBlock).toMatch(/setSquadErrand\('match'\);\s*setMatchRoute\(\{ kind: 'fixture', matchId \}\)/);
  });

  it('Play now routes the errand to Play now', () => {
    expect(playNowBlock).toMatch(/setSquadErrand\('match'\);\s*setMatchRoute\(PLAY_NOW_ROUTE\)/);
  });

  it("Squad's count and Start follow the route, never beginMatch(false) directly", () => {
    expect(squadBlock).toContain('routeFormat(matchRoute, match, matches, format).onFieldCount');
    expect(squadBlock).toContain("startOnRoute(matchRoute, { playNow: () => beginMatch(false), openFixture })");
    expect(squadBlock).not.toMatch(/onStartMatch=\{forMatch \? \(\) => beginMatch\(false\)/);
  });
});
