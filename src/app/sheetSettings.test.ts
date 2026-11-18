/**
 * #284: the Team sheet remembers Keepers, Subs and Positions, per fixture.
 * Made-up names only.
 */

import { describe, expect, it } from 'vitest';
import { uuid } from '../types/index';
import { makeSevenASideFormat } from './placeholderSquad';
import { parseSession, toSavedSession, type SavedMatch } from './persistence';
import { readSheetSettings, subsShown } from './teamSheetEdit';

function fixture(sheetSettings?: unknown): SavedMatch {
  return {
    match: {
      id: uuid(),
      squadId: uuid(),
      formatId: uuid(),
      opponent: 'Rovers',
      competition: 'league',
      kickoffAt: '2026-11-14T10:00:00Z',
      totalMinutes: 50,
      quarterCount: 4,
      status: 'planned',
      createdAt: '2026-11-07T00:00:00Z',
    },
    quarters: [],
    appearances: [],
    benchStints: [],
    availability: [],
    ...(sheetSettings === undefined ? {} : { sheetSettings: sheetSettings as SavedMatch['sheetSettings'] }),
  };
}

function roundTrip(matches: SavedMatch[]) {
  const saved = toSavedSession({
    squadName: 'Test FC',
    squadId: uuid(),
    players: [],
    format: makeSevenASideFormat(),
    totalMinutes: 50,
    periodCount: 4,
    plan: {},
    matches,
    state: null,
  });
  return parseSession(JSON.stringify(saved))!;
}

describe('the Team sheet remembers its choices (#284)', () => {
  it('kept per fixture through a save and a restart (C1–C4, C7)', () => {
    const a = fixture();
    const b = fixture({ keepers: 'choose', subs: 0, fill: 'positions' });
    const back = roundTrip([a, b]);
    expect(back.matches[0].sheetSettings).toBeUndefined();
    expect(back.matches[1].sheetSettings).toEqual({ keepers: 'choose', subs: 0, fill: 'positions' });
  });

  it('a 2.3.0 fixture with none opens at the defaults, with no error (C11)', () => {
    expect(roundTrip([fixture()]).matches[0].sheetSettings).toBeUndefined();
  });

  it('a malformed value is read as unset, field by field, never dropping the match (C11)', () => {
    const back = roundTrip([fixture({ keepers: 'sometimes', subs: -1, fill: 'positions' })]);
    expect(back.matches).toHaveLength(1);
    expect(back.matches[0].sheetSettings).toEqual({ fill: 'positions' });
    expect(readSheetSettings('junk')).toBeUndefined();
    expect(readSheetSettings({ subs: 1.5 })).toBeUndefined();
  });

  it('untouched means the fairest, worked out each time; a kept number never exceeds the bench (C5, C6)', () => {
    expect(subsShown(undefined, 1, 2)).toBe(1);
    expect(subsShown({ keepers: 'choose' }, 2, 3)).toBe(2);
    expect(subsShown({ subs: 2 }, 1, 2)).toBe(2);
    // Two marked Can't: the bench is 0, the kept 2 is shown as 0 and not rewritten.
    const kept = { subs: 2 };
    expect(subsShown(kept, 0, 0)).toBe(0);
    expect(kept).toEqual({ subs: 2 });
    expect(subsShown(kept, 1, 2)).toBe(2);
  });
});
