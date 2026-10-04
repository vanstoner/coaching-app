/**
 * Each child's season and the squad average (#121), from matches played
 * through the real engine and recorded through the real ledger. Synthetic
 * first names only (invariant 4).
 */

import { describe, expect, it } from 'vitest';
import { MatchEngine, type MatchState } from '../engine/MatchEngine';
import { uuid, type Competition, type KeeperPreference, type Player, type UUID } from '../types/index';
import { makePlayer } from './squad';
import { makeSevenASideFormat } from './placeholderSquad';
import { teamSheetFor } from './lineup';
import { currentQuarter } from './matchClock';
import { emptyLedger, recordMatches, type Ledger } from './ledger';
import { mergeCurrentMatch } from './persistence';
import { seasonStats } from './analysis';
import { competitionText, seasonSummary, squadAverage, squadSeason } from './childSeason';

const MIN = 60_000;
const QUARTER = 12.5 * MIN;

function squad() {
  const squadId = uuid();
  const players: Player[] = ['Ava', 'Ben', 'Cal', 'Dan', 'Eve', 'Fin', 'Gus', 'Hal', 'Ivy', 'Jo'].map(
    (n) => makePlayer(squadId, n)
  );
  return { squadId, players, format: makeSevenASideFormat() };
}
type Squad = ReturnType<typeof squad>;

/**
 * A closed 50-minute match: the first seven available, not-benched players
 * start, the first in goal throughout; the eighth comes on for the seventh at
 * six minutes each quarter (seventh 24 min, eighth 26). The rest sit out.
 */
function play(sq: Squad, opts: { competition?: Competition | null; absent?: UUID[]; benched?: UUID[] } = {}) {
  let now = Date.parse('2026-10-03T09:00:00Z');
  const engine = new MatchEngine({ nowFn: () => new Date(now) });
  const state = engine.createMatch(sq.squadId, sq.format.id, {
    opponent: 'Rovers',
    competition: opts.competition ?? null,
    totalMinutes: 50,
    quarterCount: 4,
    availablePlayerIds: sq.players.map((p) => p.id),
  });
  for (const id of opts.absent ?? []) engine.setAvailability(state, id, 'absent');
  const ids = sq.players
    .map((p) => p.id)
    .filter((id) => !(opts.absent ?? []).includes(id) && !(opts.benched ?? []).includes(id));
  for (let q = 0; q < 4; q++) {
    const quarter = currentQuarter(state)!;
    engine.startQuarter(state, quarter, teamSheetFor(ids.slice(0, 7), ids[0], sq.format), sq.format);
    now += 6 * MIN;
    engine.substitute(state, quarter, ids[6], ids[7]);
    now += QUARTER - 6 * MIN;
    engine.endQuarter(state, quarter);
  }
  engine.completeMatch(state);
  return state;
}

function ledgerOf(sq: Squad, states: MatchState[]): Ledger {
  const records = states.map((s) => mergeCurrentMatch([], s, sq.format)[0]);
  return recordMatches(emptyLedger(sq.squadId, 'Test FC'), records, sq.players, 'Test FC', new Date(0));
}

function withKeeper(players: Player[], prefs: Record<string, KeeperPreference>): Player[] {
  return players.map((p) => (prefs[p.firstName] ? { ...p, keeper: prefs[p.firstName] } : p));
}

describe('squad average and the keeper ruling (#121)', () => {
  // One league match: Ava in goal 50, Ben–Fin 50, Gus 24, Hal 26; Ivy and Jo
  // never on (not attended, v1 inference).
  const sq = squad();
  const ledger = ledgerOf(sq, [play(sq)]);

  it('shared gloves: with no Main keeper, everyone counts', () => {
    const s = squadSeason(ledger, sq.players);
    expect(s.squadAverageMs).toBe(Math.round((6 * 50 + 24 + 26) * MIN / 8));
  });

  it('leaves the Main keeper out of the squad average, but keeps their own figure', () => {
    const s = squadSeason(ledger, withKeeper(sq.players, { Ava: 'main' }));
    expect(s.squadAverageMs).toBe(Math.round((5 * 50 + 24 + 26) * MIN / 7));
    const ava = s.children.find((c) => c.name === 'Ava')!;
    expect(ava.mainKeeper).toBe(true);
    // Goal plus outfield, unchanged (invariant 3, ADR-015).
    expect(ava.averageMs).toBe(50 * MIN);
  });

  it('counts a Backup keeper as normal', () => {
    const main = squadSeason(ledger, withKeeper(sq.players, { Ava: 'main', Ben: 'backup' }));
    expect(main.squadAverageMs).toBe(Math.round((5 * 50 + 24 + 26) * MIN / 7));
    expect(main.children.find((c) => c.name === 'Ben')!.mainKeeper).toBe(false);
    const backupOnly = squadSeason(ledger, withKeeper(sq.players, { Ava: 'backup' }));
    expect(backupOnly.squadAverageMs).toBe(Math.round((6 * 50 + 24 + 26) * MIN / 8));
  });

  it('squadAverage: no figures, no average; children without a match do not count', () => {
    expect(squadAverage([])).toBeNull();
    expect(squadAverage([{ averageMs: null, mainKeeper: false }])).toBeNull();
    expect(
      squadAverage([
        { averageMs: 50 * MIN, mainKeeper: true },
        { averageMs: 30 * MIN, mainKeeper: false },
        { averageMs: null, mainKeeper: false },
      ])
    ).toBe(30 * MIN);
    // Only a Main keeper has figures: nobody left to average.
    expect(squadAverage([{ averageMs: 50 * MIN, mainKeeper: true }])).toBeNull();
  });
});

describe("a child's season in words (#121 AC2, AC3)", () => {
  it('reads each competition; League, Cup and Friendly when in the squad for one, Tournament only when played', () => {
    const sq = squad();
    const hal = sq.players[7];
    const states = [
      play(sq, { competition: 'league' }),
      play(sq, { competition: 'cup', absent: [hal.id] }),
      play(sq, { competition: 'tournament', benched: [hal.id] }),
    ];
    const s = squadSeason(ledgerOf(sq, states), sq.players);
    const child = (n: string) => s.children.find((c) => c.name === n)!;

    expect(child('Hal').competitions.map((c) => c.text)).toEqual([
      'League: 26 min a game, played 1 of 1',
      'Cup: did not play, 0 of 1',
    ]);
    expect(child('Hal').summary).toBe('26 min a game · played 1 of 3');
    expect(child('Hal').missed).toBe(2);
    expect(child('Ava').competitions.map((c) => c.text)).toEqual([
      'League: 50 min a game, played 1 of 1',
      'Cup: 50 min a game, played 1 of 1',
      'Tournament: 50 min a game, played 1 of 1',
    ]);
    // No friendly this season: no Friendly line for anyone.
    expect(s.children.every((c) => c.competitions.every((l) => l.key !== 'friendly'))).toBe(true);
    expect(s.countedMatches).toBe(3);
    expect(s.scaleMs).toBe(50 * MIN);
  });

  it('keeps the squad order and leaves retired children out', () => {
    const sq = squad();
    const players = sq.players.map((p) => (p.firstName === 'Cal' ? { ...p, active: false } : p));
    const s = squadSeason(ledgerOf(sq, [play(sq)]), players);
    expect(s.children.map((c) => c.name)).toEqual(['Ava', 'Ben', 'Dan', 'Eve', 'Fin', 'Gus', 'Hal', 'Ivy', 'Jo']);
  });

  it('splits a keeper into in goal and outfield, beside their target', () => {
    const sq = squad();
    const players = sq.players.map((p) => (p.firstName === 'Ava' ? { ...p, keeper: 'main' as const, outfieldTargetPct: 25 } : p));
    const s = squadSeason(ledgerOf(sq, [play(sq), play(sq)]), players);
    const ava = s.children.find((c) => c.name === 'Ava')!;
    expect(ava.goalMsPerGame).toBe(50 * MIN);
    expect(ava.outfieldMsPerGame).toBe(0);
    expect(ava.share).toEqual({ sharePct: 0, targetPct: 25, status: 'below' });
    const gus = s.children.find((c) => c.name === 'Gus')!;
    expect(gus.goalMsPerGame).toBe(0);
    expect(gus.outfieldMsPerGame).toBe(24 * MIN);
  });

  it('with no ledger, nobody has matches yet', () => {
    const sq = squad();
    const s = squadSeason(null, sq.players);
    expect(s.squadAverageMs).toBeNull();
    expect(s.countedMatches).toBe(0);
    expect(s.children.every((c) => c.summary === 'No matches yet' && c.competitions.length === 0)).toBe(true);
  });

  it('changes no figure: every average and count is seasonStats (AC5)', () => {
    const sq = squad();
    const ledger = ledgerOf(sq, [play(sq, { competition: 'cup' }), play(sq, { absent: [sq.players[2].id] })]);
    const stats = seasonStats(ledger, sq.players);
    const s = squadSeason(ledger, sq.players);
    for (const c of s.children) {
      const p = stats.players.find((x) => x.playerId === c.playerId)!;
      expect(c.averageMs).toBe(p.averageMs);
      expect(c.played).toBe(p.attended);
      expect(c.missed).toBe(p.missed);
      for (const line of c.competitions) {
        expect(line.played).toBe(p.byCompetition[line.key].attended);
        expect(line.averageMs).toBe(p.byCompetition[line.key].averageMs);
      }
    }
    // Calling it twice changes nothing: nothing is stored.
    expect(seasonStats(ledger, sq.players)).toEqual(stats);
  });

  it('words', () => {
    expect(competitionText('League', 4, 6, 31 * MIN)).toBe('League: 31 min a game, played 4 of 6');
    expect(competitionText('Cup', 0, 2, null)).toBe('Cup: did not play, 0 of 2');
    expect(seasonSummary(null, 0, 0)).toBe('No matches yet');
    expect(seasonSummary(41 * MIN + 20_000, 7, 9)).toBe('41 min a game · played 7 of 9');
  });
});
