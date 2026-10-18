/**
 * First open — #218. Made-up first names only (invariant 4).
 */

import { describe, expect, it } from 'vitest';
import { uuid, type Player, type UUID } from '../types/index';
import { fixtureList, inBucket } from './fixtures';
import { emptyLedger } from './ledger';
import { newMatch } from './matchLifecycle';
import { progressById } from './liveMatch';
import type { SavedMatch } from './persistence';
import { DEFAULT_QUARTER_COUNT, DEFAULT_TOTAL_MINUTES, PLACEHOLDER_SQUAD_NAME, makeSevenASideFormat } from './placeholderSquad';
import { makePlayer } from './squad';
import { TEST_NAMES, TEST_OPPONENTS } from './testKit';
import { SEASON } from './testSeason';
import {
  GETTING_STARTED_KEY,
  MADE_UP_OPPONENTS,
  PURPOSE_LINE,
  allStepsDone,
  anyKickedOff,
  emptySquadSentence,
  isMadeUpTeam,
  loadMadeUpTeam,
  nextAction,
  nothingPlayedYet,
  offerMadeUpTeam,
  offerShowAgain,
  parseCardClosed,
  serialiseCardClosed,
  showCard,
  startSteps,
} from './gettingStarted';

const NOW = new Date('2026-10-20T18:00:00Z'); // a Tuesday evening
const format = makeSevenASideFormat();

function squad(names: string[], squadId: UUID = uuid()): Player[] {
  return names.map((n) => makePlayer(squadId, n));
}

function fixture(opponent: string | null, players: Player[] = []): SavedMatch {
  return newMatch(
    {
      squadId: uuid(),
      format,
      totalMinutes: DEFAULT_TOTAL_MINUTES,
      periodCount: DEFAULT_QUARTER_COUNT,
      players,
      opponent: opponent ?? undefined,
      kickoffAt: '2026-10-24T09:00:00.000Z',
    },
    () => NOW
  ).stored;
}

/** The made-up team, loaded onto an empty phone as "Try it" does. */
function madeUp() {
  const squadId = uuid();
  return loadMadeUpTeam({
    players: [],
    matches: [],
    squadId,
    squadName: PLACEHOLDER_SQUAD_NAME,
    format,
    totalMinutes: DEFAULT_TOTAL_MINUTES,
    periodCount: DEFAULT_QUARTER_COUNT,
    ledger: emptyLedger(squadId, PLACEHOLDER_SQUAD_NAME, NOW),
    now: NOW,
  });
}

const steps = (activePlayers: number, matches: SavedMatch[] = [], ledgerMatches = 0) =>
  startSteps({ activePlayers, onFieldCount: format.onFieldCount, matches, ledgerMatches });

describe('the purpose line (AC4)', () => {
  it('is the approved wording', () => {
    expect(PURPOSE_LINE).toBe('Who comes off next, and is everyone getting a fair share?');
  });
});

describe('the three steps (AC1, Q2)', () => {
  it('a fresh install: nothing ticked, "0 of 7 added"', () => {
    const s = steps(0);
    expect(s.map((x) => x.key)).toEqual(['squad', 'match', 'play']);
    expect(s.map((x) => x.done)).toEqual([false, false, false]);
    expect(s[0].detail).toBe('First names only · 0 of 7 added');
  });

  it('the squad ticks at seven players, Pick the lineup\'s threshold, and counts until then', () => {
    expect(format.onFieldCount).toBe(7);
    expect(steps(6)[0]).toMatchObject({ done: false, detail: 'First names only · 6 of 7 added' });
    expect(steps(7)[0]).toMatchObject({ done: true, detail: '7 players' });
    expect(steps(10)[0]).toMatchObject({ done: true, detail: '10 players' });
  });

  it('a saved fixture ticks "Add your next match"; kicking one off ticks Play now', () => {
    const planned = fixture('Hill Lane');
    expect(steps(8, [planned]).map((x) => x.done)).toEqual([true, true, false]);
    const kicked: SavedMatch = { ...planned, match: { ...planned.match, status: 'in_progress' } };
    expect(steps(8, [kicked]).map((x) => x.done)).toEqual([true, true, true]);
  });

  it('a played period counts as kicked off whatever the status says (the app never sets completed)', () => {
    const planned = fixture('Hill Lane');
    const started: SavedMatch = {
      ...planned,
      quarters: planned.quarters.map((q, i) => (i === 0 ? { ...q, status: 'ended' as const } : q)),
    };
    expect(anyKickedOff([started], 0)).toBe(true);
    expect(anyKickedOff([planned], 0)).toBe(false);
  });

  it('a minutes record brought in from another phone counts as having played', () => {
    expect(steps(8, [], 3)[2].done).toBe(true);
  });

  it('is worked out, never stored: the same phone always gives the same ticks', () => {
    const m = [fixture('Hill Lane')];
    expect(steps(3, m)).toEqual(steps(3, m));
  });
});

describe('showing the card (AC2, Q4)', () => {
  const none = steps(0);
  const all = madeUp();
  const done = startSteps({
    activePlayers: all.players.length,
    onFieldCount: 7,
    matches: all.matches,
    ledgerMatches: all.ledger?.matches.length ?? 0,
  });

  it('shows on a fresh install, goes by itself when all three are done', () => {
    expect(showCard(false, none)).toBe(true);
    expect(allStepsDone(done)).toBe(true);
    expect(showCard(false, done)).toBe(false);
  });

  it('closed early, it stays closed and Settings offers it back while a step is undone', () => {
    expect(showCard(true, none)).toBe(false);
    expect(offerShowAgain(true, none)).toBe(true);
    expect(offerShowAgain(false, none)).toBe(false);
    expect(offerShowAgain(true, done)).toBe(false);
  });
});

describe('the closed choice on this phone (AC2, AC7)', () => {
  it('lives under the app prefix, so Forget everything removes it', () => {
    expect(GETTING_STARTED_KEY.startsWith('coaching-app/')).toBe(true);
  });

  it('reads back what was written; nothing, or anything unreadable, reads as open', () => {
    expect(parseCardClosed(serialiseCardClosed())).toBe(true);
    expect(parseCardClosed(null)).toBe(false);
    expect(parseCardClosed('not json')).toBe(false);
    expect(parseCardClosed('{"closed":"yes"}')).toBe(false);
    expect(parseCardClosed('null')).toBe(false);
  });

  it('holds no name: nothing about a child is in it', () => {
    expect(serialiseCardClosed()).toBe('{"closed":true}');
  });
});

describe('empty screens only where nothing has happened yet (AC3, Q3, AC6)', () => {
  it('nothing played on a new phone, or with only fixtures saved', () => {
    expect(nothingPlayedYet([], 0)).toBe(true);
    expect(nothingPlayedYet([fixture('Hill Lane')], 0)).toBe(true);
  });

  it('an established phone has played: its archived and hidden matches still count', () => {
    const { matches } = madeUp();
    expect(nothingPlayedYet(matches, 0)).toBe(false);
    const archived = matches.map((m) => ({ ...m, archived: true }));
    expect(nothingPlayedYet(archived, 0)).toBe(false);
  });

  it('a match from the record with no fixture here counts as played', () => {
    expect(nothingPlayedYet([], 1)).toBe(false);
  });

  it('the next thing to do: plan the next fixture, else add one', () => {
    const m = fixture('Hill Lane').match;
    expect(nextAction(m)).toEqual({ kind: 'plan', matchId: m.id, label: 'Plan the match against Hill Lane' });
    expect(nextAction({ ...m, opponent: null })).toMatchObject({ kind: 'plan', label: 'Plan your next match' });
    expect(nextAction(undefined)).toEqual({ kind: 'add', label: 'Add your next match' });
  });

  it('the empty squad says how many make a team', () => {
    expect(emptySquadSentence(7)).toBe(
      "Type each child's first name and press Add. Seven makes a team; anyone more is a sub."
    );
    expect(emptySquadSentence(5)).toContain('Five makes a team');
  });
});

describe('the made-up team (AC5, Q5)', () => {
  it('is offered only while the squad is empty, retired players included', () => {
    expect(offerMadeUpTeam([])).toBe(true);
    const retired = { ...makePlayer(uuid(), 'Rosa'), active: false };
    expect(offerMadeUpTeam([retired])).toBe(false);
    expect(offerMadeUpTeam(squad(['Rosa']))).toBe(false);
  });

  it('loads the Test kit squad, its two fixtures and its nine-match season, into the ledger too', () => {
    const team = madeUp();
    expect(team.players.map((p) => p.firstName)).toEqual(TEST_NAMES);
    expect(team.matches).toHaveLength(2 + SEASON.length);
    expect(team.ledger?.matches.length).toBe(SEASON.length);
    expect(team.message).toBe(`Made-up team loaded: 10 players, 2 fixtures, ${SEASON.length} played matches.`);
  });

  it('says so when the minutes cannot be written, and still adds the squad and fixtures', () => {
    const squadId = uuid();
    const team = loadMadeUpTeam({
      players: [],
      matches: [],
      squadId,
      squadName: PLACEHOLDER_SQUAD_NAME,
      format,
      totalMinutes: DEFAULT_TOTAL_MINUTES,
      periodCount: DEFAULT_QUARTER_COUNT,
      ledger: null,
      now: NOW,
    });
    expect(team.players).toHaveLength(10);
    expect(team.matches).toHaveLength(2);
    expect(team.message).toContain('no season was added');
  });

  it('once loaded, every step is done: the card goes and Home has a Played list', () => {
    const team = madeUp();
    const s = startSteps({
      activePlayers: team.players.length,
      onFieldCount: 7,
      matches: team.matches,
      ledgerMatches: team.ledger?.matches.length ?? 0,
    });
    expect(allStepsDone(s)).toBe(true);
    const rows = fixtureList(team.matches.map((m) => m.match), NOW, null, progressById(team.matches, null));
    expect(inBucket(rows, 'past')).toHaveLength(SEASON.length);
  });
});

describe('recognising the made-up team without a flag (Q6)', () => {
  it('the made-up team, as loaded, is recognised', () => {
    const team = madeUp();
    expect(isMadeUpTeam(team.players, team.matches)).toBe(true);
  });

  it('recognised by every made-up opponent, the fixtures and the season alike', () => {
    expect([...MADE_UP_OPPONENTS]).toEqual([...TEST_OPPONENTS, ...SEASON.map((s) => s.opponent)]);
    for (const opp of MADE_UP_OPPONENTS) {
      expect(isMadeUpTeam(squad(['Ava', 'Ben']), [fixture(opp)])).toBe(true);
    }
  });

  it('a real squad is not: names alone are not enough, nor an opponent alone', () => {
    expect(isMadeUpTeam(squad(['Ava', 'Ben', 'Cal']), [fixture('Hill Lane')])).toBe(false);
    expect(isMadeUpTeam(squad(['Ava', 'Rosa']), [fixture('Test Rovers')])).toBe(false);
    expect(isMadeUpTeam(squad(['Ava', 'Ben']), [])).toBe(false);
  });

  it('an empty phone, or one with only retired players, is not', () => {
    expect(isMadeUpTeam([], [fixture('Test Rovers')])).toBe(false);
    const retired = squad(['Ava']).map((p) => ({ ...p, active: false }));
    expect(isMadeUpTeam(retired, [fixture('Test Rovers')])).toBe(false);
  });

  it('is exact: a near name or opponent does not count', () => {
    expect(isMadeUpTeam(squad(['ava']), [fixture('Test Rovers')])).toBe(false);
    expect(isMadeUpTeam(squad(['Ava']), [fixture('Test Rovers FC')])).toBe(false);
    expect(isMadeUpTeam(squad(['Ava']), [fixture(null)])).toBe(false);
  });

  it('a real child added to the made-up team takes the line away (a documented limit)', () => {
    const team = madeUp();
    const mixed = [...team.players, makePlayer(team.players[0].squadId, 'Rosa')];
    expect(isMadeUpTeam(mixed, team.matches)).toBe(false);
  });
});
