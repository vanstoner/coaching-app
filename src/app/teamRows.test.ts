/**
 * What the team switcher reads, and Add a team's checks — #224 AC1, AC5.
 * Made-up names only (invariant 4).
 */

import { describe, expect, it } from 'vitest';

import { FIRST_SEASON_ID, emptyLedger, saveSeason, serialiseLedger } from './ledger';
import { uuid } from '../types/index';
import { formatForAge, readTeamRow, teamNameProblem } from './teamRows';
import { seasonLine, seasonNameFor } from './seasons';

const NOW = new Date('2026-10-26T12:00:00Z');

describe('a team’s row in the switcher (#224 AC1)', () => {
  it('a team whose squad will not read is named so, never hidden', () => {
    expect(readTeamRow('{damaged', null)).toEqual({ name: null, season: 'This season', live: false });
  });

  it('reads the season line from the team’s own record', () => {
    const l = saveSeason(
      emptyLedger(uuid(), 'Mock FC', NOW),
      { id: FIRST_SEASON_ID, name: '2026–27', mainSide: 7, ageGroup: 'U10', level: 'development' },
      NOW
    );
    if (!l.ok) throw new Error(l.reason);
    expect(readTeamRow(null, serialiseLedger(l.ledger)).season).toBe('2026–27 · U10 development · 7-a-side');
  });
});

describe('Add a team (#224 AC5)', () => {
  it('a name must be given and unique on this phone, capitals aside', () => {
    expect(teamNameProblem(' ', [])).not.toBeNull();
    expect(teamNameProblem('unicorns u10 ', ['Unicorns U10'])).not.toBeNull();
    expect(teamNameProblem('Unicorns U10 Sun', ['Unicorns U10'])).toBeNull();
  });

  it('the first season is named for the football year it starts in', () => {
    expect(seasonNameFor(new Date('2026-10-26T12:00:00Z'))).toBe('2026–27');
    expect(seasonNameFor(new Date('2027-03-01T12:00:00Z'))).toBe('2026–27');
    expect(seasonNameFor(new Date('2027-08-01T12:00:00Z'))).toBe('2027–28');
  });

  it('only what the coach set shows in the season line', () => {
    const base = { id: FIRST_SEASON_ID, startedAt: '', lens: 'full', note: null };
    expect(seasonLine({ ...base, name: null, mainSide: null, ageGroup: null, level: null })).toBe('This season');
    expect(seasonLine({ ...base, name: '2026–27', mainSide: 5, ageGroup: 'U8', level: null })).toBe(
      '2026–27 · U8 · 5-a-side'
    );
  });

  it('nudges the format by age, and leaves a choice that already fits', () => {
    expect(formatForAge('U8', '2-3-1')).toBe('2-2');
    expect(formatForAge('U8', '1-2-1')).toBe('1-2-1');
    expect(formatForAge('U11', '2-2')).toBe('2-3-1');
    expect(formatForAge('U15', '2-2')).toBe('2-2');
  });
});
