/**
 * #222 (PO, `approve 222`, 18 Oct): the Squad tab's list sorts by minutes a
 * game, most first, overriding #208 AC7 for this list only. Made-up first
 * names (invariant 4).
 */

import { describe, expect, it } from 'vitest';
import { NAME, TABLE_COLUMNS, TABLE_DEFAULTS, nextSort, parseTableSorts, serialiseTableSorts, sortFor, sortSquadList } from './tableSort';

const MIN = 60_000;
/** In squad order: the order they were added. */
const rows = [
  { name: 'Zed', averageMs: 30 * MIN, mainKeeper: false },
  { name: 'Ava', averageMs: null, mainKeeper: false }, // no matches yet
  { name: 'Moe', averageMs: 40 * MIN, mainKeeper: false },
  { name: 'Kit', averageMs: 50 * MIN, mainKeeper: true }, // Main keeper: outside the average
  { name: 'Bea', averageMs: 30 * MIN + 20_000, mainKeeper: false }, // reads 30, as Zed does
  { name: 'Cy', averageMs: null, mainKeeper: false }, // no matches yet
  { name: 'Dee', averageMs: 45 * MIN, mainKeeper: false },
];
const names = (r: readonly { name: string }[]) => r.map((x) => x.name);

describe('the Squad list sorts by minutes a game (#222)', () => {
  it('AC1: by default minutes a game, most first', () => {
    expect(TABLE_DEFAULTS.squadList).toEqual({ key: 'perGame', dir: 'desc' });
    expect(names(sortSquadList(rows, sortFor({}, 'squadList')))).toEqual(['Dee', 'Moe', 'Zed', 'Bea', 'Ava', 'Cy', 'Kit']);
  });

  it('AC2: tapping "a game" again reverses; no-match children and the Main keeper stay below', () => {
    const reversed = nextSort(TABLE_DEFAULTS.squadList, 'perGame');
    expect(reversed).toEqual({ key: 'perGame', dir: 'asc' });
    expect(names(sortSquadList(rows, reversed))).toEqual(['Zed', 'Bea', 'Moe', 'Dee', 'Ava', 'Cy', 'Kit']);
  });

  it('AC2: Name sorts A–Z, then Z–A on a second tap; the Main keeper is still last', () => {
    const az = nextSort(TABLE_DEFAULTS.squadList, NAME);
    expect(az).toEqual({ key: NAME, dir: 'asc' });
    expect(names(sortSquadList(rows, az))).toEqual(['Ava', 'Bea', 'Cy', 'Dee', 'Moe', 'Zed', 'Kit']);
    expect(names(sortSquadList(rows, nextSort(az, NAME)))).toEqual(['Zed', 'Moe', 'Dee', 'Cy', 'Bea', 'Ava', 'Kit']);
  });

  it('AC2: the choice is remembered on this phone under the table-sort key, like the #208 tables', () => {
    const stored = serialiseTableSorts({ squadList: { key: NAME, dir: 'asc' } });
    expect(sortFor(parseTableSorts(stored), 'squadList')).toEqual({ key: NAME, dir: 'asc' });
    expect(TABLE_COLUMNS.squadList).toEqual([NAME, 'perGame']);
    // A column the list does not have falls back to the default.
    expect(sortFor({ squadList: { key: 'owed', dir: 'asc' } }, 'squadList')).toEqual(TABLE_DEFAULTS.squadList);
  });

  it('AC3: ties on the minutes shown keep squad order', () => {
    // Zed (30:00) was added before Bea (30:20): both read 30, so Zed stays first.
    const sorted = names(sortSquadList(rows, TABLE_DEFAULTS.squadList));
    expect(sorted.indexOf('Zed')).toBeLessThan(sorted.indexOf('Bea'));
  });

  it('AC3: a brand-new squad, with no matches, keeps squad order', () => {
    const fresh = ['Nia', 'Abe', 'Lou'].map((name) => ({ name, averageMs: null, mainKeeper: false }));
    expect(names(sortSquadList(fresh, TABLE_DEFAULTS.squadList))).toEqual(['Nia', 'Abe', 'Lou']);
  });

  it('AC4: the Main keeper is last, even with the most minutes a game', () => {
    expect(names(sortSquadList(rows, TABLE_DEFAULTS.squadList)).at(-1)).toBe('Kit');
  });

  it('sorting returns a new list and leaves squad order itself alone (AC5: lineup, bench and plan read squad order)', () => {
    const before = names(rows);
    sortSquadList(rows, TABLE_DEFAULTS.squadList);
    expect(names(rows)).toEqual(before);
  });
});
