/**
 * #208: analytics tables sort by their numbers (AC8).
 *
 * The default order of each table on the Test kit's made-up season (#138),
 * a reversed sort, ties kept in squad order, and the Main keeper last.
 * Synthetic first names only (invariant 4).
 */

import { describe, expect, it } from 'vitest';
import { MatchEngine } from '../engine/MatchEngine';
import { uuid, type UUID } from '../types/index';
import { inSquadOrder, matchChart, matchReport, type MatchChartRow, type ReportPlayer } from './analysis';
import { kickoffTimes } from './attendance';
import { emptyLedger, seasonRows, type Ledger } from './ledger';
import { createMemoryStore } from './persistence';
import { makeSevenASideFormat } from './placeholderSquad';
import { recordMatchPage } from './recordOnly';
import { squadViews } from './squadViews';
import { addTestSeason } from './testSeason';
import {
  NAME,
  TABLE_COLUMNS,
  TABLE_DEFAULTS,
  TABLE_IDS,
  TABLE_SORT_KEY,
  averageOffset,
  matchKey,
  nextSort,
  parseTableSorts,
  serialiseTableSorts,
  sortFairness,
  sortFor,
  sortGrid,
  sortMatchBars,
  sortOwed,
  sortPositions,
  sortRecordMinutes,
  sortReportMinutes,
  sortRows,
  sortSettingsMinutes,
  sortWords,
} from './tableSort';

const MIN = 60_000;
const NOW = new Date('2026-10-04T09:00:00Z'); // the season's last match is Sat 3 Oct

function testSeason() {
  const ledger = emptyLedger(uuid(), 'Test FC', NOW);
  const data = addTestSeason({
    players: [],
    matches: [],
    squadId: ledger.squad.id,
    squadName: 'Test FC',
    format: makeSevenASideFormat(),
    totalMinutes: 50,
    periodCount: 4,
    ledger,
    now: NOW,
  });
  return { ...data, ledger: data.ledger as Ledger };
}

const s = testSeason();
const v = squadViews(s.ledger, s.players);
const squad = s.players.map((p) => p.firstName); // Ava (Main keeper), Ben, Cal, Dee, Eli, Fay, Gus, Hal, Ivy, Jo
const names = (rows: readonly { name: string }[]) => rows.map((r) => r.name);

describe('tapping a heading (AC1)', () => {
  it('sorts by it: a number most first, a name A–Z; tapping it again reverses', () => {
    const total = { key: 'total', dir: 'desc' as const };
    expect(nextSort(total, 'total')).toEqual({ key: 'total', dir: 'asc' });
    expect(nextSort(nextSort(total, 'total'), 'total')).toEqual(total);
    expect(nextSort(total, 'gk')).toEqual({ key: 'gk', dir: 'desc' });
    expect(nextSort(total, NAME)).toEqual({ key: NAME, dir: 'asc' });
    expect(nextSort({ key: NAME, dir: 'asc' }, NAME)).toEqual({ key: NAME, dir: 'desc' });
  });

  it('says what the arrow means, for the screen reader', () => {
    expect(sortWords({ key: 'total', dir: 'desc' })).toBe('most first');
    expect(sortWords({ key: 'total', dir: 'asc' })).toBe('least first');
    expect(sortWords({ key: NAME, dir: 'asc' })).toBe('A to Z');
  });
});

describe('the defaults (AC2, AC3)', () => {
  it('is minutes most first, or the distance from the average for the tables that show one', () => {
    expect(TABLE_DEFAULTS).toEqual({
      settingsMinutes: { key: 'total', dir: 'desc' },
      squadGrid: { key: 'perGame', dir: 'desc' },
      squadFairness: { key: 'offset', dir: 'desc' },
      squadSaturday: { key: 'owed', dir: 'desc' },
      squadPositions: { key: 'total', dir: 'desc' },
      reportMinutes: { key: 'total', dir: 'desc' },
      reportAverage: { key: 'offset', dir: 'desc' },
      analysisMinutes: { key: 'total', dir: 'desc' },
      recordMinutes: { key: 'total', dir: 'desc' },
      // #222 (approve 222) brings the Squad tab's list in, overriding #208 AC7 for it.
      squadList: { key: 'perGame', dir: 'desc' },
    });
  });
});

describe('each table on the Test kit season: default, reversed, ties, keeper last (AC4, AC5, AC8)', () => {
  it('Settings › Player minutes: Total most first; Ava and Hal tie on 400:00 and keep squad order', () => {
    const rows = inSquadOrder(seasonRows(s.ledger), s.players);
    expect(names(sortSettingsMinutes(rows, TABLE_DEFAULTS.settingsMinutes))).toEqual([
      'Ava', 'Hal', 'Eli', 'Ivy', 'Cal', 'Fay', 'Dee', 'Gus', 'Ben', 'Jo',
    ]);
    // Reversed: least first, and the tie still in squad order.
    expect(names(sortSettingsMinutes(rows, { key: 'total', dir: 'asc' }))).toEqual([
      'Jo', 'Ben', 'Gus', 'Dee', 'Fay', 'Cal', 'Ivy', 'Eli', 'Ava', 'Hal',
    ]);
    // By name, A–Z and back.
    expect(names(sortSettingsMinutes(rows, { key: NAME, dir: 'asc' }))).toEqual([...squad].sort());
    expect(names(sortSettingsMinutes(rows, { key: NAME, dir: 'desc' }))).toEqual([...squad].sort().reverse());
    // GK: Ava most, then Hal, then everyone with none, in squad order.
    expect(names(sortSettingsMinutes(rows, { key: 'gk', dir: 'desc' })).slice(0, 2)).toEqual(['Ava', 'Hal']);
  });

  it('Squad › Season grid: a game most first, ties in squad order, the Main keeper last', () => {
    const grid = sortGrid(v.grid, v.matches, TABLE_DEFAULTS.squadGrid);
    expect(grid.map((r) => `${r.name} ${r.perGame}`)).toEqual([
      'Hal 44', 'Eli 40', 'Cal 39', 'Ben 38', 'Dee 38', 'Fay 38', 'Gus 38', 'Ivy 36', 'Jo 36', 'Ava 50',
    ]);
    // Reversed: least first; Ava, on 50, is still last.
    expect(names(sortGrid(v.grid, v.matches, { key: 'perGame', dir: 'asc' }))).toEqual([
      'Ivy', 'Jo', 'Ben', 'Dee', 'Fay', 'Gus', 'Cal', 'Eli', 'Hal', 'Ava',
    ]);
    // By name: Ava still last.
    expect(names(sortGrid(v.grid, v.matches, { key: NAME, dir: 'asc' }))).toEqual([
      'Ben', 'Cal', 'Dee', 'Eli', 'Fay', 'Gus', 'Hal', 'Ivy', 'Jo', 'Ava',
    ]);
    // By one match: those not there sit below those who were, either way.
    const first = v.matches[0];
    for (const dir of ['desc', 'asc'] as const) {
      const sorted = sortGrid(v.grid, v.matches, { key: matchKey(first.matchId), dir }).filter((r) => !r.mainKeeper);
      const there = sorted.map((r) => r.cells[0]?.total ?? null);
      const firstBlank = there.indexOf(null);
      if (firstBlank >= 0) expect(there.slice(firstBlank).every((t) => t === null)).toBe(true);
      const shown = there.filter((t): t is number => t !== null);
      expect(shown).toEqual([...shown].sort((a, b) => (dir === 'desc' ? b - a : a - b)));
    }
  });

  it('Squad › Fairness: one straight descending order from the average (ruling 4a), the Main keeper last', () => {
    const rows = sortFairness(v.fairness!.rows, TABLE_DEFAULTS.squadFairness);
    expect(rows.map((r) => `${r.name} ${r.offset}`)).toEqual([
      'Hal 5', 'Eli 1', 'Cal 0', 'Ben -1', 'Dee -1', 'Fay -1', 'Gus -1', 'Ivy -3', 'Jo -3', 'Ava null',
    ]);
    expect(names(sortFairness(v.fairness!.rows, { key: 'offset', dir: 'asc' }))).toEqual([
      'Ivy', 'Jo', 'Ben', 'Dee', 'Fay', 'Gus', 'Cal', 'Eli', 'Hal', 'Ava',
    ]);
  });

  it('Squad › Going into Saturday: most owed first, the Main keeper last', () => {
    const rows = sortOwed(v.owed, TABLE_DEFAULTS.squadSaturday);
    expect(rows.map((r) => `${r.name} ${r.owed}`)).toEqual([
      'Ivy 20', 'Jo 14', 'Gus 9', 'Dee 6', 'Ben 4', 'Fay 4', 'Cal -4', 'Eli -10', 'Hal -53', 'Ava null',
    ]);
    expect(names(sortOwed(v.owed, { key: 'owed', dir: 'asc' }))).toEqual([
      'Hal', 'Eli', 'Cal', 'Ben', 'Fay', 'Dee', 'Gus', 'Jo', 'Ivy', 'Ava',
    ]);
    // Played: Ben and Jo missed three.
    expect(names(sortOwed(v.owed, { key: 'played', dir: 'asc' })).slice(0, 2)).toEqual(['Ben', 'Jo']);
  });

  it('Squad › Positions tried: total most first, the Main keeper last', () => {
    const rows = sortPositions(v.positions, TABLE_DEFAULTS.squadPositions);
    expect(rows.map((r) => `${r.name} ${r.total}`)).toEqual([
      'Hal 400', 'Eli 358', 'Ivy 328', 'Cal 313', 'Fay 305', 'Dee 303', 'Gus 300', 'Ben 228', 'Jo 218', 'Ava 400',
    ]);
    // By GK: Hal, the backup keeper, first; Ava (Main keeper) still last.
    const gk = sortPositions(v.positions, { key: 'GK', dir: 'desc' });
    expect(gk[0].name).toBe('Hal');
    expect(gk[gk.length - 1].name).toBe('Ava');
  });

  it('Match report › Minutes on the pitch and Against their average; Match analysis; one chart, one order', () => {
    const last = s.matches[s.matches.length - 1];
    const state = {
      match: last.match,
      quarters: last.quarters,
      appearances: last.appearances,
      benchStints: last.benchStints,
      playerAvailability: new Map(last.availability),
      events: last.events ?? [],
    } as unknown as Parameters<typeof matchReport>[1];
    const report = matchReport(new MatchEngine({ nowFn: () => NOW }), state, s.players, makeSevenASideFormat());
    const minutes = sortReportMinutes(report.players, TABLE_DEFAULTS.reportMinutes).map((r) => r.totalMs);
    expect(minutes).toEqual([...minutes].sort((a, b) => b - a));
    const reversed = sortReportMinutes(report.players, { key: 'total', dir: 'asc' }).map((r) => r.totalMs);
    expect(reversed).toEqual([...reversed].sort((a, b) => a - b));

    const chart = matchChart(report, s.ledger, s.players, { kickoffs: kickoffTimes(s.matches) });
    const byOffset = sortMatchBars(chart.rows, TABLE_DEFAULTS.reportAverage);
    const offsets = byOffset.map(averageOffset);
    const shown = offsets.filter((o): o is number => o !== null);
    expect(shown.length).toBeGreaterThan(0);
    expect(shown).toEqual([...shown].sort((a, b) => b - a));
    // No average yet: below everyone with one.
    expect(offsets.slice(shown.length).every((o) => o === null)).toBe(true);
    const byMinutes = sortMatchBars(chart.rows, TABLE_DEFAULTS.analysisMinutes).map((r) => r.thisMatchMs);
    expect(byMinutes.map((ms) => Math.round(ms / MIN))).toEqual(
      [...byMinutes].map((ms) => Math.round(ms / MIN)).sort((a, b) => b - a)
    );
  });

  it('Played › a match from the record: most minutes first, ties in the record\'s squad order', () => {
    const last = s.matches[s.matches.length - 1];
    const page = recordMatchPage(s.ledger, last.match.id)!;
    const rows = sortRecordMinutes(page.minutes, TABLE_DEFAULTS.recordMinutes);
    const order = new Map(s.ledger.players.map((p, i) => [p.id, i]));
    for (let i = 1; i < rows.length; i++) {
      const [a, b] = [rows[i - 1], rows[i]];
      const [sa, sb] = [Math.floor(a.totalMs / 1000), Math.floor(b.totalMs / 1000)];
      expect(sa).toBeGreaterThanOrEqual(sb);
      if (sa === sb) expect(order.get(a.playerId)!).toBeLessThan(order.get(b.playerId)!);
    }
    expect(sortRecordMinutes(page.minutes, { key: 'total', dir: 'asc' })[0].totalMs).toBe(
      Math.min(...page.minutes.map((m) => m.totalMs))
    );
  });
});

describe('ties, blanks and the keeper, on rows made up here (AC4, AC5)', () => {
  const id = (n: string) => n as UUID;
  const report = (name: string, totalMin: number, deltaMin: number): ReportPlayer => ({
    playerId: id(name),
    name,
    totalMs: totalMin * MIN,
    goalMs: 0,
    outfieldMs: totalMin * MIN,
    deltaMs: deltaMin * MIN,
  });

  it('equal figures keep the order they arrived in, in both directions', () => {
    const rows = [report('Cal', 20, 0), report('Ava', 30, 10), report('Ben', 20, 0), report('Dee', 30, 10)];
    expect(names(sortReportMinutes(rows, { key: 'total', dir: 'desc' }))).toEqual(['Ava', 'Dee', 'Cal', 'Ben']);
    expect(names(sortReportMinutes(rows, { key: 'total', dir: 'asc' }))).toEqual(['Cal', 'Ben', 'Ava', 'Dee']);
    // Seconds apart but the same whole minute on screen: a tie.
    const close = [{ ...report('Eli', 20, 0), totalMs: 20 * MIN + 10_000 }, report('Fay', 20, 0)];
    close[0].outfieldMs = close[0].totalMs;
    expect(names(sortReportMinutes(close, { key: 'total', dir: 'asc' }))).toEqual(['Eli', 'Fay']);
  });

  it('vs fair: one straight descending order, +6 … 0 … −5 (ruling 4a)', () => {
    const rows = [-2, 6, 0, -5, 3, -1, 1].map((d, i) => report(`P${i}`, 20 + d, d));
    expect(sortReportMinutes(rows, { key: 'delta', dir: 'desc' }).map((r) => r.deltaMs! / MIN)).toEqual([
      6, 3, 1, 0, -1, -2, -5,
    ]);
  });

  it('a row with nothing to show sits below the rest whichever way the sort runs; a pinned row below that', () => {
    const rows = [
      { name: 'Ava', n: 5, keeper: true },
      { name: 'Ben', n: null, keeper: false },
      { name: 'Cal', n: 2, keeper: false },
      { name: 'Dee', n: 9, keeper: false },
    ];
    const value = (r: (typeof rows)[number], key: string) => (key === NAME ? r.name : r.n);
    const pinLast = (r: (typeof rows)[number]) => r.keeper;
    expect(names(sortRows(rows, { key: 'n', dir: 'desc' }, value, { pinLast }))).toEqual(['Dee', 'Cal', 'Ben', 'Ava']);
    expect(names(sortRows(rows, { key: 'n', dir: 'asc' }, value, { pinLast }))).toEqual(['Cal', 'Dee', 'Ben', 'Ava']);
    expect(names(sortRows(rows, { key: NAME, dir: 'desc' }, value, { pinLast }))).toEqual(['Dee', 'Cal', 'Ben', 'Ava']);
  });

  it('the match bars: no average yet is below everyone with one', () => {
    const bar = (name: string, thisMin: number, shadowMin: number | null): MatchChartRow => ({
      playerId: id(name),
      name,
      thisMatchMs: thisMin * MIN,
      goalMs: 0,
      outfieldMs: thisMin * MIN,
      shadowMs: shadowMin === null ? null : shadowMin * MIN,
      label: name,
    });
    const rows = [bar('Ava', 30, null), bar('Ben', 20, 30), bar('Cal', 40, 30), bar('Dee', 25, 25)];
    expect(names(sortMatchBars(rows, { key: 'offset', dir: 'desc' }))).toEqual(['Cal', 'Dee', 'Ben', 'Ava']);
    expect(names(sortMatchBars(rows, { key: 'offset', dir: 'asc' }))).toEqual(['Ben', 'Dee', 'Cal', 'Ava']);
    expect(names(sortMatchBars(rows, { key: 'total', dir: 'desc' }))).toEqual(['Cal', 'Ava', 'Dee', 'Ben']);
  });
});

describe('remembered on this phone, never in the record (AC6)', () => {
  it('reads back what was chosen, per table', async () => {
    const store = createMemoryStore();
    const chosen = { squadFairness: { key: NAME, dir: 'asc' as const }, reportMinutes: { key: 'gk', dir: 'desc' as const } };
    await store.setItem(TABLE_SORT_KEY, serialiseTableSorts(chosen));
    const read = parseTableSorts(await store.getItem(TABLE_SORT_KEY));
    expect(read).toEqual(chosen);
    expect(sortFor(read, 'squadFairness')).toEqual({ key: NAME, dir: 'asc' });
    // A table never chosen shows its default.
    expect(sortFor(read, 'squadSaturday')).toEqual(TABLE_DEFAULTS.squadSaturday);
  });

  it('lives under the app\'s prefix, so Forget everything removes it', () => {
    expect(TABLE_SORT_KEY.startsWith('coaching-app/')).toBe(true);
  });

  it('falls back to the default for anything that does not read, or a column the table no longer has', () => {
    expect(parseTableSorts(null)).toEqual({});
    expect(parseTableSorts('not json')).toEqual({});
    expect(parseTableSorts('[1]')).toEqual({});
    expect(parseTableSorts('{"squadGrid":{"key":"perGame","dir":"sideways"},"nope":{"key":"x","dir":"asc"}}')).toEqual(
      {}
    );
    expect(sortFor({ settingsMinutes: { key: 'owed', dir: 'asc' } }, 'settingsMinutes')).toEqual(
      TABLE_DEFAULTS.settingsMinutes
    );
    // A season grid's match column holds while the match is there.
    const key = matchKey(v.matches[0].matchId);
    const has = (k: string) => v.matches.some((m) => matchKey(m.matchId) === k);
    expect(sortFor({ squadGrid: { key, dir: 'asc' } }, 'squadGrid', has)).toEqual({ key, dir: 'asc' });
    expect(sortFor({ squadGrid: { key: matchKey(uuid()), dir: 'asc' } }, 'squadGrid', has)).toEqual(
      TABLE_DEFAULTS.squadGrid
    );
  });

  it('every table has a default, and the default is one of its columns', () => {
    for (const t of TABLE_IDS) {
      expect(sortFor({}, t)).toEqual(TABLE_DEFAULTS[t]);
      expect(TABLE_COLUMNS[t]).toContain(TABLE_DEFAULTS[t].key);
      expect(TABLE_COLUMNS[t]).toContain(NAME);
    }
  });

  it('sorting writes nothing to the record', () => {
    const before = JSON.stringify(s.ledger);
    sortGrid(v.grid, v.matches, { key: NAME, dir: 'desc' });
    sortSettingsMinutes(inSquadOrder(seasonRows(s.ledger), s.players), { key: 'gk', dir: 'asc' });
    expect(JSON.stringify(s.ledger)).toBe(before);
  });
});
