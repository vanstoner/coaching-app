/**
 * The Test kit's past season (#106). Synthetic first names only.
 */

import { describe, expect, it } from 'vitest';
import { MatchEngine } from '../engine/MatchEngine';
import { uuid } from '../types/index';
import { matchChart, matchReport, seasonChart, seasonStats } from './analysis';
import { kickoffTimes, seasonAttendance } from './attendance';
import { emptyLedger, recordMatches, type Ledger } from './ledger';
import { verifyChain } from './ledgerChain';
import { LEDGER_HEAD_KEY, openStoredLedger, saveLedger } from './ledgerStore';
import { chainHead, parseChainHead } from './ledgerAnchor';
import { teamSheetFor } from './lineup';
import { currentQuarter } from './matchClock';
import { endMatch } from './matchClosing';
import { newMatch } from './matchLifecycle';
import { withLiveMatch } from './liveMatch';
import { scoreOf } from './matchEvents';
import { seasonOutfieldShares } from './outfieldTarget';
import { makeSevenASideFormat } from './placeholderSquad';
import { createMemoryStore, loadSession, saveSession, type SavedMatch } from './persistence';
import { addTestData, TEST_NAMES } from './testKit';
import { SEASON, SEASON_KEEPER, addTestSeason, lastSaturdayBefore } from './testSeason';

const MIN = 60_000;
const NOW = new Date('2026-10-04T09:00:00Z'); // a Sunday

function seed(ledger: Ledger | null = emptyLedger(uuid(), 'Test FC', NOW)) {
  const squadId = ledger?.squad.id ?? uuid();
  const format = makeSevenASideFormat();
  const data = addTestSeason({
    players: [],
    matches: [],
    squadId,
    squadName: 'Test FC',
    format,
    totalMinutes: 50,
    periodCount: 4,
    ledger,
    now: NOW,
  });
  const id = (name: string) => data.players.find((p) => p.firstName === name)!.id;
  return { ...data, squadId, format, id };
}

describe('a past season in the Test kit (#106 AC1)', () => {
  const s = seed();
  const ledger = s.ledger!;

  it('plays at least 6 league and 2 cup matches, closed, on Saturdays before today', () => {
    const by = (c: string) => s.matches.filter((m) => m.match.competition === c);
    expect(by('league').length).toBeGreaterThanOrEqual(6);
    expect(by('cup').length).toBeGreaterThanOrEqual(2);
    for (const m of s.matches) {
      expect(m.match.status).toBe('completed');
      expect(m.quarters.every((q) => q.status === 'ended')).toBe(true);
      const at = new Date(m.match.kickoffAt!);
      expect(at.getDay()).toBe(6);
      expect(at.getTime()).toBeLessThan(NOW.getTime());
      // The periods were played on that Saturday morning.
      expect(new Date(m.quarters[0].startedAt!).toDateString()).toBe(at.toDateString());
    }
    expect(ledger.matches.filter((m) => m.status === 'completed')).toHaveLength(SEASON.length);
  });

  it('has goals, saves and subs in every match, as specified', () => {
    SEASON.forEach((spec) => {
      const m = s.matches.find((x) => x.match.opponent === spec.opponent)!;
      expect(scoreOf(m.events)).toEqual({ us: spec.goals, them: spec.conceded });
      expect((m.events ?? []).filter((e) => e.kind === 'save')).toHaveLength(spec.saves);
      expect(m.appearances.some((a) => a.endReason === 'substitution')).toBe(true);
    });
  });

  it('every period holds exactly seven players for its whole length', () => {
    const engine = new MatchEngine({ nowFn: () => NOW });
    for (const m of s.matches) {
      const state = stateOf(m);
      for (const q of state.quarters) engine.validateQuarterAppearanceInvariant(state, q, s.format);
    }
  });

  it('marks different children absent from different matches, in the kick-off snapshot', () => {
    const att = seasonAttendance(ledger);
    const missed = (n: string) => att.get(s.id(n))!.missed;
    expect(missed('Jo')).toBe(3);
    expect(missed('Ben')).toBe(3);
    expect(missed('Ava')).toBe(1);
    expect(missed('Ivy')).toBe(0);
    for (const m of ledger.matches) {
      expect(m.attendance?.length).toBe(TEST_NAMES.length);
      expect(m.attendance?.every((a) => a.note === null)).toBe(true);
    }
  });

  it('has a dedicated keeper with an outfield share near her 25% target', () => {
    const keeper = s.players.find((p) => p.firstName === SEASON_KEEPER)!;
    expect(keeper.keeper).toBe('main');
    expect(keeper.outfieldTargetPct).toBe(25);
    const share = seasonOutfieldShares(ledger, s.players).get(keeper.id)!;
    expect(share.sharePct).toBeGreaterThanOrEqual(22);
    expect(share.sharePct).toBeLessThanOrEqual(28);
    // Mostly in goal: she keeps two thirds of the season's goal time; the
    // backup covers her outfield spells and the match she missed.
    const gkMs = (id: string | null) =>
      ledger.matches
        .flatMap((m) => m.intervals)
        .filter((i) => (id === null || i.playerId === id) && i.kind === 'goalkeeper')
        .reduce((sum, i) => sum + i.endMs - i.startMs, 0);
    expect(gkMs(keeper.id) / gkMs(null)).toBeGreaterThan(0.6);
  });

  it('uses first names only from the test list', () => {
    expect(s.players.map((p) => p.firstName).sort()).toEqual([...TEST_NAMES].sort());
    expect(ledger.players.every((p) => TEST_NAMES.includes(p.firstName))).toBe(true);
  });

  it('groups the season view League 6+ and Cup 2+, with differing averages', () => {
    const chart = seasonChart(ledger, s.players);
    expect(chart.countedMatches).toBe(SEASON.length);
    expect(chart.inferredMatches).toBe(0);
    const stats = seasonStats(ledger, s.players);
    const ivy = stats.players.find((p) => p.playerId === s.id('Ivy'))!;
    expect(ivy.byCompetition.league.attended).toBeGreaterThanOrEqual(6);
    expect(ivy.byCompetition.cup.attended).toBeGreaterThanOrEqual(2);
    expect(ivy.byCompetition.friendly.attended).toBe(1);
    const averages = new Set(stats.players.map((p) => Math.round((p.averageMs ?? 0) / MIN)));
    expect(averages.size).toBeGreaterThan(2);
  });

  it('gives an absent child an absence-adjusted shadow in the match analysis', () => {
    const last = s.matches[s.matches.length - 1];
    const state = stateOf(last);
    const engine = new MatchEngine({ nowFn: () => NOW });
    const report = matchReport(engine, state, s.players, s.format);
    const chart = matchChart(report, ledger, s.players, { kickoffs: kickoffTimes(s.matches) });

    // Jo missed three matches; her shadow is her pitch time over the matches
    // she attended (excluding the one viewed), not over every match.
    const jo = s.id('Jo');
    const others = ledger.matches.filter((m) => m.id !== last.match.id);
    const attendedJo = others.filter((m) => m.attendance!.some((a) => a.playerId === jo && a.status === 'available'));
    expect(attendedJo.length).toBe(others.length - 3);
    const pitch = attendedJo
      .flatMap((m) => m.intervals)
      .filter((i) => i.playerId === jo)
      .reduce((sum, i) => sum + i.endMs - i.startMs, 0);
    const row = chart.rows.find((r) => r.playerId === jo)!;
    expect(row.shadowMs).toBe(Math.round(pitch / attendedJo.length));
    expect(row.shadowMs).toBeGreaterThan(Math.round(pitch / others.length));
    // Those away from the match viewed are named under it, not drawn.
    expect(chart.absent.sort()).toEqual(['Ben', 'Dee']);
  });
});

describe('the season goes through the real ledger path (#106 AC2)', () => {
  it('verifies, and a relaunch opens it writable with nothing set aside', async () => {
    const s = seed();
    const store = createMemoryStore();
    await saveSession(store, session(s, s.matches));
    await saveLedger(store, s.ledger!);

    expect(verifyChain(s.ledger!.entries)).toEqual({ ok: true });
    expect(parseChainHead(await store.getItem(LEDGER_HEAD_KEY))).toEqual(chainHead(s.ledger!));

    const opened = await openStoredLedger(store, NOW);
    expect(opened.writable).toBe(true);
    expect(opened.message).toBe('');
    expect(opened.follows).toBeUndefined();
    expect(opened.ledger!.entries).toHaveLength(s.ledger!.entries.length);

    // Launch's back-fill finds nothing new: the season was recorded as played.
    const saved = (await loadSession(store))!;
    const backfilled = recordMatches(opened.ledger!, saved.matches, saved.players, saved.squadName, NOW);
    expect(backfilled.entries).toHaveLength(opened.ledger!.entries.length);
  });

  it('healthy case: seed, then a normal live match, then relaunch — no tamper path', async () => {
    const s = seed();
    const store = createMemoryStore();
    await saveSession(store, session(s, s.matches));
    await saveLedger(store, s.ledger!);

    // Launch.
    let opened = await openStoredLedger(store, NOW);
    expect(opened.message).toBe('');
    let ledger = opened.ledger!;

    // A normal match, today, saving the ledger after each step as the app does.
    let t = NOW.getTime();
    const nowFn = () => new Date(t);
    const engine = new MatchEngine({ nowFn });
    const { held } = newMatch(
      { squadId: s.squadId, format: s.format, totalMinutes: 50, periodCount: 4, players: s.players, opponent: 'Test Rovers' },
      nowFn
    );
    const { state } = held;
    const ids = s.players.map((p) => p.id);
    for (let q = 0; q < 4; q++) {
      engine.startQuarter(state, currentQuarter(state)!, teamSheetFor(ids.slice(q, q + 7), ids[q], s.format), s.format);
      ledger = recordMatches(ledger, [...s.matches, state], s.players, 'Test FC', nowFn());
      await saveLedger(store, ledger);
      t += 12.5 * MIN;
      engine.endQuarter(state, currentQuarter(state)!);
      ledger = recordMatches(ledger, [...s.matches, state], s.players, 'Test FC', nowFn());
      await saveLedger(store, ledger);
    }
    endMatch(engine, state);
    const matches = withLiveMatch(s.matches, held);
    ledger = recordMatches(ledger, matches, s.players, 'Test FC', nowFn());
    await saveLedger(store, ledger);
    await saveSession(store, session(s, matches));

    // Relaunch.
    opened = await openStoredLedger(store, new Date(t));
    expect(opened.writable).toBe(true);
    expect(opened.message).toBe('');
    expect(opened.follows).toBeUndefined();
    expect(opened.ledger!.matches.filter((m) => m.status === 'completed')).toHaveLength(SEASON.length + 1);
    expect(verifyChain(opened.ledger!.entries)).toEqual({ ok: true });
  });
});

describe('the season is additive and gated (#106 AC3)', () => {
  it('a second tap adds nothing', () => {
    const s = seed();
    const again = addTestSeason({
      players: s.players,
      matches: s.matches,
      squadId: s.squadId,
      squadName: 'Test FC',
      format: s.format,
      totalMinutes: 50,
      periodCount: 4,
      ledger: s.ledger,
      now: NOW,
    });
    expect(again.matches).toBe(s.matches);
    expect(again.ledger).toBe(s.ledger);
    expect(again.summary).toMatch(/already there/);
  });

  it('adds nothing without a ledger it may write', () => {
    const s = seed(null);
    expect(s.matches).toHaveLength(0);
    expect(s.ledger).toBeNull();
    expect(s.summary).toMatch(/cannot be written/);
  });

  it('sits beside the test fixtures, using the same players', () => {
    const format = makeSevenASideFormat();
    const squadId = uuid();
    const kit = addTestData([], [], squadId, format, 50, 4, NOW);
    const data = addTestSeason({
      players: kit.players,
      matches: kit.matches,
      squadId,
      squadName: 'Test FC',
      format,
      totalMinutes: 50,
      periodCount: 4,
      ledger: emptyLedger(squadId, 'Test FC', NOW),
      now: NOW,
    });
    expect(data.players).toHaveLength(TEST_NAMES.length);
    expect(data.matches).toHaveLength(kit.matches.length + SEASON.length);
    // Untouched: the fixtures already there.
    expect(data.matches.slice(0, kit.matches.length)).toEqual(kit.matches);
  });

  it('dates the season from the Saturday before today, never today', () => {
    const saturday = new Date(2026, 9, 3, 15, 0);
    expect(lastSaturdayBefore(saturday).getDate()).toBe(26);
    expect(lastSaturdayBefore(new Date(2026, 9, 4, 9, 0)).getDate()).toBe(3);
  });
});

// --- helpers ------------------------------------------------------------------

function stateOf(m: SavedMatch) {
  return {
    match: m.match,
    quarters: m.quarters,
    appearances: m.appearances,
    benchStints: m.benchStints,
    playerAvailability: new Map(m.availability),
    events: m.events ?? [],
  };
}

function session(s: ReturnType<typeof seed>, matches: SavedMatch[]) {
  return {
    squadName: 'Test FC',
    squadId: s.squadId,
    players: s.players,
    format: s.format,
    totalMinutes: 50,
    periodCount: 4,
    plan: {},
    matches,
    state: null,
    matchFormat: null,
  };
}
