/**
 * Analytics tables sort by their numbers — #208.
 *
 * > *"All analytics screens should be in order of their numbers … We're
 * > trying to highlight discrepancies."* — PO, 2026-10-17
 *
 * This replaces PO ruling Q1 (#143 AC7, "squad order, never ranked by
 * minutes") for the analytics tables only. The folds (`analysis.ts`,
 * `squadViews.ts`, `recordOnly.ts`, `ledger.seasonRows` put back by
 * `inSquadOrder`) still hand their rows over in squad order; that order is
 * now the tie order, and the table's sort is applied on top, here.
 *
 * - **AC1.** Tapping a heading sorts by it; tapping it again reverses. A
 *   number starts most first, a name A–Z (`nextSort`).
 * - **AC2, AC3.** Each table's default (`TABLE_DEFAULTS`): minutes most
 *   first, or the distance from the average in one straight descending order
 *   (ruling 4a: +6 … 0 … −5).
 * - **AC4.** Ties keep squad order: the sort is stable over rows that arrive
 *   in squad order, so equal children never reshuffle.
 * - **AC5.** A Main keeper stays outside the average and is listed last
 *   whatever the sort, in the squad views where the average lives.
 * - **AC6.** The chosen sort is a view choice on this phone (`TABLE_SORT_KEY`),
 *   never written to the record. Forget everything removes it.
 * - **Charts follow the sort** (`approve 208 charts-follow`): each chart is
 *   drawn from the rows this returns, so chart and table always agree.
 *
 * A row with no figure for the column (no matches yet, no average yet) sits
 * after every row that has one, in either direction: a blank is not a zero.
 *
 * Every row sorts on the figure the screen shows (whole minutes, or the
 * seconds a clock shows), so two children who read the same are a tie.
 *
 * Pure TypeScript: no React, no platform imports.
 */

import type { UUID } from '../types/index';
import type { MatchChartRow, ReportPlayer } from './analysis';
import { goalOutfieldSplit, minutesRowSeconds, wholeMinutes } from './analysis';
import type { SeasonRow } from './ledger';
import type { FairnessRow, GridRow, OwedRow, PositionsRow, SeasonMatch } from './squadViews';
import type { RecordMatchPage } from './recordOnly';

export type SortDir = 'desc' | 'asc';

export interface TableSort {
  /** The column sorted by. */
  key: string;
  dir: SortDir;
}

/** Every analytics table (AC3). The id is what the phone remembers the sort under. */
export type TableId =
  | 'settingsMinutes'
  | 'squadGrid'
  | 'squadFairness'
  | 'squadSaturday'
  | 'squadPositions'
  | 'reportMinutes'
  | 'reportAverage'
  | 'analysisMinutes'
  | 'recordMinutes';

export const TABLE_IDS: readonly TableId[] = [
  'settingsMinutes',
  'squadGrid',
  'squadFairness',
  'squadSaturday',
  'squadPositions',
  'reportMinutes',
  'reportAverage',
  'analysisMinutes',
  'recordMinutes',
];

/** The column every table names its children by: sorts A–Z first. */
export const NAME = 'name';

/** AC2, AC3: each table's default sort. */
export const TABLE_DEFAULTS: Record<TableId, TableSort> = {
  settingsMinutes: { key: 'total', dir: 'desc' },
  squadGrid: { key: 'perGame', dir: 'desc' },
  squadFairness: { key: 'offset', dir: 'desc' },
  squadSaturday: { key: 'owed', dir: 'desc' },
  squadPositions: { key: 'total', dir: 'desc' },
  reportMinutes: { key: 'total', dir: 'desc' },
  reportAverage: { key: 'offset', dir: 'desc' },
  analysisMinutes: { key: 'total', dir: 'desc' },
  recordMinutes: { key: 'total', dir: 'desc' },
};

/** The columns each table sorts by. The season grid also sorts by each match (`matchKey`). */
export const TABLE_COLUMNS: Record<TableId, readonly string[]> = {
  settingsMinutes: [NAME, 'out', 'gk', 'total'],
  squadGrid: [NAME, 'perGame'],
  squadFairness: [NAME, 'offset', 'perGame'],
  squadSaturday: [NAME, 'owed', 'perGame', 'played'],
  squadPositions: [NAME, 'GK', 'DEF', 'MID', 'ATT', 'total'],
  reportMinutes: [NAME, 'total', 'gk', 'out', 'delta'],
  reportAverage: [NAME, 'total', 'offset'],
  analysisMinutes: [NAME, 'total', 'offset'],
  recordMinutes: [NAME, 'total', 'gk'],
};

/**
 * AC1: the sort after tapping `key`. The heading in use reverses; any other
 * starts most first, or A–Z for the name.
 */
export function nextSort(current: TableSort, key: string): TableSort {
  if (current.key === key) return { key, dir: current.dir === 'desc' ? 'asc' : 'desc' };
  return { key, dir: key === NAME ? 'asc' : 'desc' };
}

/** What a heading's arrow says, for the screen reader: "most first", "A to Z". */
export function sortWords(sort: TableSort): string {
  if (sort.key === NAME) return sort.dir === 'asc' ? 'A to Z' : 'Z to A';
  return sort.dir === 'desc' ? 'most first' : 'least first';
}

/** A column's figure for a row: a number, a name, or null for "nothing to show". */
export type SortValue = number | string | null;

export interface SortOptions<T> {
  /** Listed after everyone else whatever the sort, in the order given (AC5). */
  pinLast?: (row: T) => boolean;
}

/**
 * The rows in the table's order. `rows` arrive in squad order, which is kept
 * for ties (AC4); an unknown column leaves them in it.
 */
export function sortRows<T>(
  rows: readonly T[],
  sort: TableSort,
  value: (row: T, key: string) => SortValue,
  options: SortOptions<T> = {}
): T[] {
  const sign = sort.dir === 'desc' ? -1 : 1;
  const group = (row: T, v: SortValue) => (options.pinLast?.(row) ? 2 : v === null ? 1 : 0);
  return rows
    .map((row, i) => {
      const v = value(row, sort.key);
      return { row, i, v, g: group(row, v) };
    })
    .sort((a, b) => {
      if (a.g !== b.g) return a.g - b.g;
      if (a.g === 0 && a.v !== null && b.v !== null) {
        const c =
          typeof a.v === 'number' && typeof b.v === 'number'
            ? a.v - b.v
            : String(a.v).localeCompare(String(b.v));
        if (c !== 0) return sign * c;
      }
      return a.i - b.i;
    })
    .map(({ row }) => row);
}

// ============================================================================
// The tables (AC3). Each sorts on the figures it shows.
// ============================================================================

/** Settings › Player minutes: Player · Out · GK · Total, in the seconds the clock shows. */
export function sortSettingsMinutes(rows: readonly SeasonRow[], sort: TableSort): SeasonRow[] {
  return sortRows(rows, sort, (r, key) => {
    if (key === NAME) return r.name;
    const s = minutesRowSeconds(r);
    if (key === 'out') return s.outfield;
    if (key === 'gk') return s.goal;
    if (key === 'total') return s.total;
    return null;
  });
}

/** A season grid column for one match. */
export const matchKey = (matchId: UUID): string => `match:${matchId}`;

/**
 * Squad › Season grid: Child · a game · each match's minutes. A child who was
 * not at the match sorted by has no figure for it, so sits below those who were.
 */
export function sortGrid(rows: readonly GridRow[], matches: readonly SeasonMatch[], sort: TableSort): GridRow[] {
  const column = new Map(matches.map((m, j) => [matchKey(m.matchId), j]));
  return sortRows(
    rows,
    sort,
    (r, key) => {
      if (key === NAME) return r.name;
      if (key === 'perGame') return r.perGame;
      const j = column.get(key);
      return j === undefined ? null : (r.cells[j]?.total ?? null);
    },
    { pinLast: (r) => r.mainKeeper }
  );
}

/** Squad › Fairness, "Where everyone is": Child · distance from the squad average · a game. */
export function sortFairness(rows: readonly FairnessRow[], sort: TableSort): FairnessRow[] {
  return sortRows(
    rows,
    sort,
    (r, key) => (key === NAME ? r.name : key === 'offset' ? r.offset : key === 'perGame' ? r.perGame : null),
    { pinLast: (r) => r.mainKeeper }
  );
}

/** Squad › Going into Saturday: Child · owed · a game · played. */
export function sortOwed(rows: readonly OwedRow[], sort: TableSort): OwedRow[] {
  return sortRows(
    rows,
    sort,
    (r, key) => {
      if (key === NAME) return r.name;
      if (r.perGame === null) return null; // no matches yet: nothing to rank
      if (key === 'owed') return r.owed;
      if (key === 'perGame') return r.perGame;
      if (key === 'played') return r.played;
      return null;
    },
    { pinLast: (r) => r.mainKeeper }
  );
}

/** Squad › Positions tried: Child · GK · DEF · MID · FWD · Total. */
export function sortPositions(rows: readonly PositionsRow[], sort: TableSort): PositionsRow[] {
  return sortRows(
    rows,
    sort,
    (r, key) => {
      if (key === NAME) return r.name;
      if (r.played === 0) return null; // no matches yet
      if (key === 'total') return r.total;
      if (key === 'GK' || key === 'DEF' || key === 'MID' || key === 'ATT') return r.minutes[key];
      return null;
    },
    { pinLast: (r) => r.keeper === 'main' }
  );
}

/** "+4", "-6", "0": whole minutes from the fair share, as the report shows it. */
export function signedMinutes(ms: number): string {
  const m = wholeMinutes(ms);
  return m > 0 ? `+${m}` : `${m}`;
}

/** Match report › Minutes on the pitch: Player · Total · GK · Out · vs fair. */
export function sortReportMinutes(rows: readonly ReportPlayer[], sort: TableSort): ReportPlayer[] {
  return sortRows(rows, sort, (r, key) => {
    if (key === NAME) return r.name;
    const { total, goal, outfield } = goalOutfieldSplit(r.goalMs, r.outfieldMs, r.totalMs);
    if (key === 'total') return total;
    if (key === 'gk') return goal;
    if (key === 'out') return outfield;
    if (key === 'delta') return wholeMinutes(r.deltaMs);
    return null;
  });
}

/**
 * This match against their average, in the whole minutes the label shows
 * ("Ava 32 · avg 28" is +4). Null with no average yet.
 */
export function averageOffset(row: Pick<MatchChartRow, 'thisMatchMs' | 'shadowMs'>): number | null {
  return row.shadowMs === null ? null : wholeMinutes(row.thisMatchMs) - wholeMinutes(row.shadowMs);
}

/**
 * The match bars (report's "Against their average", analysis's "This match,
 * minutes"): Child · this match · against their average.
 */
export function sortMatchBars(rows: readonly MatchChartRow[], sort: TableSort): MatchChartRow[] {
  return sortRows(rows, sort, (r, key) => {
    if (key === NAME) return r.name;
    if (key === 'total') return wholeMinutes(r.thisMatchMs);
    if (key === 'offset') return averageOffset(r);
    return null;
  });
}

/** Played › a match from the record (#195): Player · Minutes · GK, in the seconds the clock shows. */
export function sortRecordMinutes(
  rows: readonly RecordMatchPage['minutes'][number][],
  sort: TableSort
): RecordMatchPage['minutes'] {
  return sortRows(rows, sort, (r, key) => {
    if (key === NAME) return r.name;
    if (key === 'total') return Math.floor(r.totalMs / 1000);
    if (key === 'gk') return Math.floor(r.goalMs / 1000);
    return null;
  });
}

// ============================================================================
// Remembered on this phone (AC6): a view choice, never the record
// ============================================================================

/** Under the app's prefix, so Forget everything removes it (#207). */
export const TABLE_SORT_KEY = 'coaching-app/table-sort/v1';

export type TableSorts = Partial<Record<TableId, TableSort>>;

/** What was stored, keeping only what reads as a sort for a known table. Anything else is ignored. */
export function parseTableSorts(raw: string | null): TableSorts {
  if (raw === null) return {};
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return {};
  const out: TableSorts = {};
  for (const id of TABLE_IDS) {
    const s = (data as Record<string, unknown>)[id];
    if (typeof s !== 'object' || s === null) continue;
    const { key, dir } = s as Record<string, unknown>;
    if (typeof key === 'string' && key !== '' && (dir === 'desc' || dir === 'asc')) out[id] = { key, dir };
  }
  return out;
}

export function serialiseTableSorts(sorts: TableSorts): string {
  return JSON.stringify(sorts);
}

/**
 * The sort a table shows: the one chosen on this phone while the table still
 * has that column, else the table's default. `extra` names columns beyond
 * `TABLE_COLUMNS`: the season grid's matches, which come and go.
 */
export function sortFor(sorts: TableSorts, id: TableId, extra: (key: string) => boolean = () => false): TableSort {
  const chosen = sorts[id];
  return chosen && (TABLE_COLUMNS[id].includes(chosen.key) || extra(chosen.key)) ? chosen : TABLE_DEFAULTS[id];
}
